"""Runs the agent team for a consent session, records a trace of each agent's work and writes the audit log.

Pipeline: Ingestion → Liquidity (cash-need regression) → Spending regression → Profiler → Peers (clustering)
→ Personal inflation → Missions & CVaR → Compliance → Explainability → Trade proposals → (customer approval)
→ Instruction.
"""

import math
import secrets
import time

from .agents import compliance, execution, explain, funds, inflation, ingestion, liquidity, missions, peers, profiler, sandbox, spending, stress
from .consent import SCOPES, Session
from .data.market import ASSETS, FUNDS_SOURCE, MACRO, MACRO_LABELS, market_snapshot
from .data.mock_open_banking import PERSONAS, BankTimeout, fetch_bank, probe_tbc_sandbox, psu
from .ml import registry

RETRIES = 2
OPTIMIZER_VERSION = "cvar-lp-1.0"
RULES_VERSION = "compliance-1.1"


class ComplianceError(Exception):
    def __init__(self, message: str, detail: dict):
        super().__init__(message)
        self.detail = detail


def model_versions() -> dict:
    return {"liquidity": registry.get("liquidity")["version"], "spending": registry.get("spending")["version"],
            "peers": registry.get("peers")["version"], "optimizer": OPTIMIZER_VERSION, "rules": RULES_VERSION}


def _timed(trace: list, agent: str, summary_fn, fn, *args, **kwargs):
    t = time.perf_counter()
    out = fn(*args, **kwargs)
    trace.append({"agent": agent, "ms": round((time.perf_counter() - t) * 1000, 1), "summary": summary_fn(out)})
    return out


def connect(s: Session, trace: list) -> list[dict]:
    if s.accounts is not None:
        return s.accounts
    t = time.perf_counter()
    accounts = []
    for bank in s.banks:
        if bank == "TBC" and s.timeout_bank != "TBC":
            probe = probe_tbc_sandbox()
            s.audit.append("ingestion_agent", "tbc_sandbox.probed", {
                "sandbox_url": probe["sandbox_url"],
                "http_status": probe["http_status"],
                "code": probe["code"],
                "latency_ms": probe["latency_ms"],
                "mode": probe["fallback_mode"],
            })
        for attempt in range(1, RETRIES + 1):
            try:
                got = fetch_bank(s.persona_id, bank, s.timeout_bank)
                accounts += got
                s.bank_status[bank] = "ok"
                s.audit.append("ingestion_agent", "bank.fetched", {"bank": bank, "accounts": len(got), "attempt": attempt})
                break
            except BankTimeout as e:
                s.audit.append("ingestion_agent", "bank.timeout", {"bank": bank, "attempt": attempt, "error": str(e)})
                if attempt == RETRIES:
                    s.bank_status[bank] = "timeout"
                    s.audit.append("ingestion_agent", "fallback.partial_data",
                                   {"bank": bank, "action": "continue with responding banks; conservative buffer; adviser review"})
    if "deposits" not in s.scopes:
        accounts = [a for a in accounts if a["product"] != "term_deposit"]
    if "loans" not in s.scopes:
        accounts = [a for a in accounts if a["product"] != "loan"]
    s.accounts = accounts
    trace.append({"agent": "open_banking", "ms": round((time.perf_counter() - t) * 1000, 1),
                  "summary": {"banks": dict(s.bank_status), "accounts": len(accounts)}})
    return accounts


def partial(s: Session) -> bool:
    """Bank data is incomplete: a bank failed, the customer did not consent to
    every bank they hold accounts at, or a consent scope (deposits/loans) is missing."""
    return (any(v != "ok" for v in s.bank_status.values())
            or set(s.banks) != set(PERSONAS[s.persona_id]["banks"])
            or not set(SCOPES) <= set(s.scopes))


def profile(s: Session) -> dict:
    if "profile" in s.cache:
        return s.cache["profile"]
    trace: list[dict] = []
    p = PERSONAS[s.persona_id]
    accounts = connect(s, trace)
    ing = _timed(trace, "ingestion", lambda o: {"accounts": len(o["accounts"]), "transactions": o["transaction_count"],
                                                "income_type": o["income_type"]},
                 ingestion.ingest, accounts, psu(s.persona_id), s.cash_at_home, p["household"])
    total = ing["totals"]["assets_gel"]
    liq = _timed(trace, "liquidity_ml", lambda o: {"expected_need_gel": o["expected_need_gel"],
                                                   "cautious_need_gel": o["cautious_need_gel"],
                                                   "buffer_months": round(o["buffer_months"], 1),
                                                   "fallback": o["fallback"]["active"]},
                 liquidity.assess, ing["features"], ing["metrics"]["essential_spend"], total, ing["months_of_history"], partial(s))
    forecast = _timed(trace, "spending_ml", lambda o: {"expected_gel": o["expected_gel"],
                                                      "affordable_monthly_gel": o["affordable_monthly_gel"]},
                      spending.assess, ing, partial(s))
    if liq["buffer_shortfall_gel"] > 0:
        forecast["affordable_monthly_gel"] = 0.0
    prof = _timed(trace, "profiler", lambda o: {"capacity": o["capacity"]["level"], "usd_liability": round(o["usd_liability_share"], 2)},
                  profiler.profile, ing, liq, s.goal or p["goal"])
    peer = _timed(trace, "peers_ml", lambda o: {"group": o["group"]["name"]["en"], "monthly_saving": o["monthly_total"]},
                  peers.compare, ing)
    infl = _timed(trace, "personal_inflation", lambda o: {"personal": round(o["personal"], 4), "national": o["national"]},
                  inflation.personal, ing["categories"])
    out = {"consent": s.public(), "ingestion": ing, "liquidity": liq, "spending": forecast, "profile": prof,
           "peers": peer, "inflation": infl,
           "idle_cash_loss_per_year": round(inflation.idle_cash_loss(ing["holdings_gel"].get("CASH", 0.0), infl["personal"]), 2),
           "default_monthly": default_monthly(ing, prof, forecast), "default_mission": p["default_mission"],
           "goal_source": ("customer" if s.goal else "custom_input" if p.get("source") == "custom"
                           else "organiser_assumed" if p.get("source") == "organiser_xlsx" else "persona"),
           "partial_data": partial(s), "trace": trace, "models": model_versions()}
    s.cache["profile"] = out
    s.audit.append("orchestrator", "profile.built",
                   {"expected_need_gel": liq["expected_need_gel"], "cautious_need_gel": liq["cautious_need_gel"],
                    "spending_expected_gel": forecast["expected_gel"],
                    "affordable_monthly_gel": forecast["affordable_monthly_gel"],
                    "buffer_months": round(liq["buffer_months"], 2),
                    "peer_group": peer["group"]["name"]["en"], "personal_inflation": round(infl["personal"], 4),
                    "fallback": liq["fallback"]}, model_versions())
    return out


def update_goal(s: Session, kind: str, amount: float, currency: str, years: int) -> dict:
    """The customer edits the goal. Bank data is kept; everything derived from the old goal is recomputed."""
    goal = profiler.custom_goal(kind, amount, currency, years)
    old = (s.goal or PERSONAS[s.persona_id]["goal"])
    s.goal = goal
    s.cache = {}
    s.trades = []
    s.selected_mission = None
    s.selected_monthly = None
    s.acknowledged = []
    s.flights = {}
    s.behaviour_score = None
    s.audit.append("customer", "goal.updated", {"from": {k: v for k, v in old.items() if k != "source"},
                                                "to": {k: v for k, v in goal.items() if k != "source"}})
    return profile(s)


def default_monthly(ing: dict, prof: dict, forecast: dict) -> float:
    if prof["goal"]["kind"] == "preserve":
        return 0.0
    v = forecast["affordable_monthly_gel"] * 0.6 * (1 - min(ing["features"]["income_cv"], 0.8))
    return float(max(0, int(v / 10) * 10))


def engine(s: Session, monthly: float | None) -> tuple[missions.Engine, float]:
    p = profile(s)
    monthly = p["default_monthly"] if monthly is None else float(monthly)
    if not math.isfinite(monthly) or not 0 <= monthly <= 100_000:
        raise ValueError("Monthly amount must be finite and between 0 and 100,000 GEL")
    key = f"engine:{monthly}"
    if key not in s.cache:
        ing, liq, prof = p["ingestion"], p["liquidity"], p["profile"]
        preserve = prof["goal"]["kind"] == "preserve"
        cons = stress.Constraints(liq["buffer_share"], prof["capacity"]["equity_cap"], ing["metrics"]["essential_usd_share"])
        ctx = missions.Context(horizon=prof["horizon"], usd_liability=prof["usd_liability_share"], cons=cons,
                               total=ing["totals"]["assets_gel"], start=liq["free_to_invest_gel"], monthly=monthly,
                               target_today=liq["free_to_invest_gel"] if preserve else prof["goal"]["target_today_gel"],
                               goal_usd=prof["goal"]["usd_indexed"], personal_inflation=p["inflation"]["personal"],
                               max_level=prof["capacity"]["level"])
        s.cache[key] = missions.Engine(ctx)
    return s.cache[key], monthly


def _check(s: Session, m: dict) -> dict:
    p = profile(s)
    return compliance.check_mission(m, capacity_level=p["profile"]["capacity"]["level"], behaviour_score=s.behaviour_score,
                                    age=p["ingestion"]["psu"]["age"], horizon=p["profile"]["horizon"],
                                    high_need=p["liquidity"]["high_need"], partial=p["partial_data"],
                                    buffer_share=p["liquidity"]["buffer_share"])


def missions_view(s: Session, monthly: float | None = None, focus: str | None = None) -> dict:
    p = profile(s)
    trace: list[dict] = []
    eng, monthly = _timed(trace, "missions_cvar", lambda o: {"levels": len(o[0].levels)}, engine, s, monthly)
    cards = []
    for m in missions.MISSIONS:
        ev = eng.evaluate(m["key"])
        ev["compliance"] = _check(s, ev)
        cards.append(ev)
    trace.append({"agent": "compliance", "ms": 0.0,
                  "summary": {c["key"]: ("blocked" if c["compliance"]["blocked"] else
                                         "ack" if c["compliance"]["needs_acknowledgment"] else "ok") for c in cards}})
    allowed = [c for c in cards if not c["compliance"]["blocked"] and not c["compliance"]["needs_acknowledgment"]]
    if p["profile"]["goal"]["kind"] == "preserve" or not allowed:
        recommended = "protect"
    else:
        best = max(c["probability"] for c in allowed)
        recommended = min((c for c in allowed if c["probability"] >= best - 0.01), key=lambda c: c["rank"])["key"]
    focus = focus if focus in missions.BY_KEY else (s.selected_mission or recommended)
    lev = eng.levers(focus, p["peers"]["monthly_total"])
    reason, rec_text = _recommendation(p, allowed, cards, lev)
    current = stress.metrics(eng.R, stress.vector(p["ingestion"]["current_weights"]), p["profile"]["horizon"])
    return {
        "monthly": monthly, "recommended": recommended, "selected": s.selected_mission,
        "capacity": p["profile"]["capacity"], "behaviour_score": s.behaviour_score,
        "missions": cards,
        "recommendation_reason": reason, "recommendation_text": rec_text,
        "current": {"weights": p["ingestion"]["current_weights"], "metrics": current,
                    "worst5_loss_gel": max(current["cvar95"], 0) * p["ingestion"]["totals"]["assets_gel"]},
        "strategies": eng.strategies(focus),
        "levers": lev,
        "focus": focus,
        "target_today": eng.ctx.target_today,
        "goal_inflation": inflation.goal_inflation(eng.ctx.goal_usd, eng.ctx.personal_inflation),
        "assets": [a.public() for a in ASSETS],
        "market": market_snapshot(), "macro": MACRO, "macro_labels": MACRO_LABELS,
        "trace": trace, "models": model_versions(),
    }


def _recommendation(p: dict, allowed: list[dict], cards: list[dict], lev: dict) -> tuple[str, dict]:
    """Why this mission is recommended, in one honest bilingual sentence."""
    if p["profile"]["goal"]["kind"] == "preserve":
        return "preserve_goal", {
            "ka": "თქვენი მიზანი დანაზოგის დაცვაა, ამიტომ გირჩევთ მისიას „დაცვა“.",
            "en": "Your goal is to protect savings, so Protect is recommended."}
    if not allowed:
        return "only_safe_allowed", {
            "ka": "ყველა სხვა მისია გაფრთხილების დადასტურებას საჭიროებს ან დაბლოკილია, ამიტომ გირჩევთ მისიას „დაცვა“.",
            "en": "Every other mission needs a warning acknowledged or is blocked, so Protect is recommended."}
    if all(c["probability"] < 0.05 for c in cards):
        parts_ka, parts_en = [], []
        if lev.get("extra_monthly") is not None:
            parts_ka.append(f"+{explain.num(lev['extra_monthly'], 'ka')} ლარი თვეში")
            parts_en.append(f"+{explain.num(lev['extra_monthly'], 'en')} GEL a month")
        if lev.get("extra_months"):
            k = math.ceil(lev["extra_months"] / 12)
            parts_ka.append(f"{k} წლით მეტი დრო")
            parts_en.append(f"{k} more years")
        if lev.get("cheaper_target_by", 0.0) > 0:
            parts_ka.append(f"{explain.num(lev['cheaper_target_by'], 'ka')} ლარით იაფი მიზანი")
            parts_en.append(f"a goal {explain.num(lev['cheaper_target_by'], 'en')} GEL cheaper")
        if parts_en:
            return "none_reach", {
                "ka": f"დღევანდელი მონაცემებით ვერცერთი მისია ამ მიზანს დროულად ვერ აღწევს. "
                      f"რა დაგეხმარებათ: {', '.join(parts_ka)}.",
                "en": f"No mission reaches this goal on time with today's numbers. "
                      f"What would help: {', '.join(parts_en)}."}
        return "none_reach", {
            "ka": "დღევანდელი მონაცემებით ვერცერთი მისია ამ მიზანს დროულად ვერ აღწევს. განიხილეთ მიზნის შეცვლა.",
            "en": "No mission reaches this goal on time with today's numbers. Consider editing the goal."}
    if min(c["probability"] for c in allowed) >= 0.95:
        return "all_reach_lowest_risk", {
            "ka": "ყველა ხელმისაწვდომი მისია მიზანს სცენარების სულ მცირე 95%-ში აღწევს, ამიტომ ყველაზე დაბალი რისკის მისიას გირჩევთ.",
            "en": "Every available mission reaches the goal in at least 95% of scenarios, so the lowest-risk one is recommended."}
    return "best_chance", {
        "ka": "რეკომენდებულია მისია, რომელსაც მიზნის ყველაზე მაღალი ალბათობა აქვს დამატებითი გაფრთხილებების გარეშე (თანაბრობისას — ნაკლები რისკით).",
        "en": "Recommended: the highest chance of the goal among missions you can choose without extra warnings (ties go to lower risk)."}


def _focus(s: Session, mission: str | None) -> str:
    if mission in missions.BY_KEY:
        return mission
    return s.selected_mission or ("protect" if profile(s)["profile"]["goal"]["kind"] == "preserve" else "goal")


def funds_view(s: Session, monthly: float | None = None, mission: str | None = None) -> dict:
    p = profile(s)
    eng, monthly = engine(s, monthly)
    key = _focus(s, mission)
    ck = f"funds:{monthly}:{key}"
    if ck not in s.cache:
        trace: list[dict] = []
        out = _timed(trace, "funds", lambda o: {"funds": len(o["funds"])}, funds.compare, eng, key)
        out.update({"monthly": monthly, "start": eng.ctx.start, "target_today": eng.ctx.target_today,
                    "horizon": eng.ctx.horizon, "preserve": p["profile"]["goal"]["kind"] == "preserve",
                    "mission": key, "source": FUNDS_SOURCE, "trace": trace,
                    "disclaimer_ka": "საგანმანათლებლო შედარება: ფონდის ტიპები და არა კონკრეტული პროდუქტები. პროდუქტს ლიცენზირებული პარტნიორი ირჩევს.",
                    "disclaimer_en": "Educational comparison of fund types, not products. The licensed partner chooses the actual product."})
        s.cache[ck] = out
        s.audit.append("funds_agent", "funds.compared", {"mission": key, "monthly": monthly, "funds": len(out["funds"])})
    return s.cache[ck]


def stock_check(s: Session, profile_key: str, share: float, mission: str | None, monthly: float | None) -> dict:
    profile(s)
    eng, monthly = engine(s, monthly)
    key = _focus(s, mission)
    out = funds.stock_check(eng, key, profile_key, float(share))
    out["monthly"] = monthly
    s.audit.append("customer", "stock_check.viewed", {"profile": profile_key, "share": share, "mission": key,
                                                      "added_to_plan": False})
    return out


def select_mission(s: Session, key: str, acknowledge: list[str], monthly: float | None) -> dict:
    if key not in missions.BY_KEY:
        raise ValueError(f"Unknown mission {key}")
    p = profile(s)
    eng, monthly = engine(s, monthly)
    ev = eng.evaluate(key)
    check = _check(s, ev)
    s.audit.append("compliance_agent", "mission.checked",
                   {"mission": key, "blocked": check["blocking_rules"], "needs_ack": check["needs_acknowledgment"]},
                   model_versions())
    if check["blocked"]:
        s.audit.append("compliance_agent", "mission.blocked", {"mission": key, "rules": check["blocking_rules"]})
        raise ComplianceError("Mission blocked by compliance rules", {"mission": key, "compliance": check})
    missing = [r for r in check["needs_acknowledgment"] if r not in acknowledge]
    if missing:
        raise ComplianceError("Acknowledgment required", {"mission": key, "missing": missing, "compliance": check})
    checks = compliance.check_recurring(monthly, p["spending"]["affordable_monthly_gel"])
    if checks:
        s.audit.append("compliance_agent", "recurring.blocked",
                       {"monthly": monthly, "affordable_monthly_gel": p["spending"]["affordable_monthly_gel"],
                        "rules": [c["rule"] for c in checks]})
        raise ComplianceError("Monthly amount exceeds the cautious cash-flow limit", {"checks": checks})
    s.selected_mission = key
    s.selected_monthly = monthly
    s.acknowledged = sorted(set(acknowledge) & set(check["needs_acknowledgment"]))
    for r in s.acknowledged:
        s.audit.append("customer", "warning.acknowledged", {"rule": r, "mission": key})
    s.audit.append("customer", "mission.selected", {"mission": key, "monthly": monthly, "probability": round(ev["probability"], 4)},
                   model_versions())
    s.trades = execution.proposals(ing=p["ingestion"], weights=ev["weights"])
    auto = execution.recurring(ing=p["ingestion"], monthly=monthly,
                               invest=stress.as_dict(eng.invested(eng.mission_weights(key)[0])))
    if auto:
        s.trades.append(auto)
    plan_id = secrets.token_hex(4)
    for t in s.trades:
        t["id"] = f"{plan_id}-{t['id']}"
    s.audit.append("execution_agent", "trades.proposed", {"count": len(s.trades), "ids": [t["id"] for t in s.trades]})
    s.cache.pop("instruction", None)
    return {"mission": {**ev, "compliance": check}, "trades": s.trades, "levers": eng.levers(key, p["peers"]["monthly_total"]),
            "strategies": eng.strategies(key), "acknowledged": s.acknowledged, "monthly": monthly}


def explanation(s: Session, key: str, monthly: float | None) -> dict:
    p = profile(s)
    eng, monthly = engine(s, monthly)
    ck = f"explain:{key}:{monthly}"
    if ck not in s.cache:
        trace: list[dict] = []
        ev = eng.evaluate(key)
        current = stress.metrics(eng.R, stress.vector(p["ingestion"]["current_weights"]), p["profile"]["horizon"])
        bench = {x["key"]: x for x in eng.strategies(key)}
        out = _timed(trace, "explainability", lambda o: {"coalitions": o["coalitions"], "sentences": len(o["narrative"])},
                     explain.explain, ing=p["ingestion"], liq=p["liquidity"], prof=p["profile"], mission=ev,
                     current=current, monthly=monthly, compliance=_check(s, ev), bench=bench)
        out["liquidity_contributions"] = p["liquidity"]["contributions"]
        out["trace"] = trace
        s.cache[ck] = out
        s.audit.append("explainability_agent", "explanation.generated", {"mission": key, "sentences": len(out["narrative"])},
                       model_versions())
    return s.cache[ck]


def _trade_checks(s: Session, candidates: list[dict]) -> list[dict]:
    p = profile(s)
    checks = compliance.check_portfolio(ing=p["ingestion"], trades=candidates,
                                        buffer_gel=p["liquidity"]["buffer_gel"],
                                        equity_cap=p["profile"]["capacity"]["equity_cap"])
    for t in candidates:
        if t.get("kind") == "recurring":
            checks.extend(compliance.check_recurring(t["amount_gel"], p["spending"]["affordable_monthly_gel"]))
    return checks


def _selected_check(s: Session) -> None:
    if not s.selected_mission:
        raise ComplianceError("No mission selected", {})
    eng, _ = engine(s, s.selected_monthly)
    check = _check(s, eng.evaluate(s.selected_mission))
    missing = sorted(set(check["needs_acknowledgment"]) - set(s.acknowledged))
    if check["blocked"] or missing:
        raise ComplianceError("Review and confirm the mission again", {"compliance": check, "missing": missing})


def decide_trade(s: Session, trade_id: str, decision: str, amount: float | None) -> dict:
    t = next((x for x in s.trades if x["id"] == trade_id), None)
    if t is None:
        raise KeyError(trade_id)
    p = profile(s)
    if decision == "edit":
        if amount is None or not math.isfinite(amount) or amount <= 0 or amount > 10_000_000:
            raise ValueError("An edit needs a positive amount up to 10,000,000 GEL")
        candidate = dict(t)
        execution.refresh_amount(candidate, float(amount), pay_day=p["ingestion"]["pay_day"])
        if t.get("kind") != "recurring":
            src = next((a for a in p["ingestion"]["accounts"] if a["id"] == candidate["from"]["account"]), None)
            available = src["balance_gel"] if src else p["ingestion"]["cash_at_home"]
            if candidate["amount_gel"] > available + 1e-6:
                raise ValueError(f"The source holds only {available:,.0f} GEL")
        candidates = [candidate] + [x for x in s.trades if x["id"] != t["id"] and x["status"] not in ("rejected", "blocked")]
        checks = _trade_checks(s, candidates)
        t.update(candidate)
        t["checks"] = checks
        t["status"] = "blocked" if any(c["status"] == "block" for c in checks) else "edited"
        s.audit.append("customer", "trade.edited", {"id": trade_id, "amount_gel": t["amount_gel"], "status": t["status"],
                                                     "rules": [c["rule"] for c in checks]})
    elif decision == "approve":
        _selected_check(s)
        if t["status"] == "blocked":
            raise ComplianceError("Trade blocked by compliance rules", {"trade": t})
        checks = _trade_checks(s, [x for x in s.trades if x["status"] == "approved" and x["id"] != t["id"]] + [t])
        if checks:
            t["checks"], t["status"] = checks, "blocked"
            s.audit.append("compliance_agent", "trade.blocked",
                           {"id": trade_id, "amount_gel": t["amount_gel"], "rules": [c["rule"] for c in checks]})
            raise ComplianceError("Trade blocked by compliance rules", {"trade": t, "checks": checks})
        if t["status"] != "approved":
            t["status"] = "approved"
            s.audit.append("customer", "trade.approved", {"id": trade_id, "amount_gel": t["amount_gel"], "asset": t["asset"]})
    elif decision == "reject":
        if t["status"] != "rejected":
            t["status"] = "rejected"
            s.audit.append("customer", "trade.rejected", {"id": trade_id})
    else:
        raise ValueError(f"Unknown decision {decision}")
    s.cache.pop("instruction", None)
    return t


def instruction(s: Session) -> dict:
    if not s.selected_mission:
        raise ComplianceError("No mission selected", {})
    approved = [t for t in s.trades if t["status"] == "approved"]
    if not approved:
        raise ComplianceError("Approve at least one trade first", {})
    _selected_check(s)
    checks = _trade_checks(s, approved)
    if checks:
        raise ComplianceError("The approved steps no longer pass the portfolio checks", {"checks": checks})
    eng, _ = engine(s, s.selected_monthly)
    doc = execution.instruction(trades=s.trades, psu=profile(s)["ingestion"]["psu"], consent_id=s.consent_id,
                                mission=eng.evaluate(s.selected_mission), acknowledged=s.acknowledged)
    s.audit.append("execution_agent", "instruction.generated", {"id": doc["id"], "steps": len(doc["steps"]),
                                                                 "total_gel": doc["total_gel"]})
    return doc


def sandbox_start(s: Session, key: str, chapters: list[str] | None = None) -> dict:
    if key not in missions.BY_KEY:
        raise ValueError(f"Unknown mission {key}")
    p = profile(s)
    eng, _ = engine(s, None)
    invested = {m["key"]: stress.as_dict(eng.invested(eng.mission_weights(m["key"])[0])) for m in missions.MISSIONS}
    goal = p["profile"]["goal"]
    flight = sandbox.Flight(invested[key], key, goal.get("amount_usd") if goal["usd_indexed"] >= 0.5 else None,
                            chapters, ghosts=invested)
    s.flights[flight.id] = flight
    s.audit.append("sandbox_agent", "simulator.started", {"flight": flight.id, "mission": key, "chapters": flight.chapters})
    return flight.snapshot()


def sandbox_step(s: Session, flight_id: str, action: str, until_decision: bool = False) -> dict:
    flight = s.flights[flight_id]
    was_done = flight.done
    snap = flight.advance(action, until_decision)
    if action != "hold":
        s.audit.append("customer", "simulator.action", {"flight": flight_id, "action": action,
                                                         "month": flight.actions[-1]["month"] if flight.actions else None})
    if flight.done and not was_done:
        r = flight.result()
        if r["score"] is not None:
            s.behaviour_score = r["score"]
        s.cache = {k: v for k, v in s.cache.items() if not k.startswith("explain:")}
        s.audit.append("sandbox_agent", "simulator.completed", {"flight": flight_id, **r})
    return snap


def audit_view(s: Session) -> dict:
    return {"entries": s.audit.entries, "verification": s.audit.verify()}
