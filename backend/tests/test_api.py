import math

import pytest


def _custom_payload(**over):
    body = {"label": "Test User", "age": 30, "region": "tbilisi", "household": 1, "bank": "MT",
            "income_kind": "salary", "monthly_income": 2500, "pay_day": 25,
            "rent": 700, "utilities": 120, "groceries": 500, "transport": 60,
            "delivery": 120, "dining": 100, "taxi": 60, "other": 200,
            "gel_current": 3000, "gel_savings": 6000,
            "goal": {"kind": "car", "amount": 9000, "currency": "USD", "years": 4}}
    body.update(over)
    return body


def test_custom_customer_full_flow(client):
    r = client.post("/api/custom-customers", json=_custom_payload())
    assert r.status_code == 201, r.text
    j = r.json()
    pid = j["persona_id"]
    assert j["persona"]["id"] == pid and "typed" in j["synthetic"].lower()
    assert not any(p["id"] == pid for p in client.get("/api/personas").json()["personas"])
    s = client.post("/api/consents", json={"persona_id": pid, "banks": ["MT"]})
    assert s.status_code == 201, s.text
    s = s.json()
    h = {"X-Consent-Token": s["token"]}
    base = f"/api/sessions/{s['consent_id']}"
    p = client.get(base + "/profile", headers=h).json()
    assert p["ingestion"]["income_type"] == "salaried"
    assert p["ingestion"]["months_of_history"] == 12
    cats = {c["key"] for c in p["ingestion"]["categories"]}
    assert "other" in cats
    assert p["goal_source"] == "custom_input"
    assert p["liquidity"]["reserve_basis"] in ("cash_need_model", "minimum_rule", "fallback_minimum", "all_assets")
    v = client.get(base + "/missions", headers=h).json()
    assert v["recommendation_reason"] and v["recommendation_text"]["en"]
    chosen = next(m for m in v["missions"] if m["key"] == v["recommended"])
    r = client.post(base + "/plan", headers=h,
                    json={"mission": chosen["key"], "acknowledge": chosen["compliance"]["needs_acknowledgment"]})
    assert r.status_code == 200, r.text
    t = r.json()["trades"][0]
    r = client.post(f"{base}/trades/{t['id']}", headers=h, json={"decision": "approve"})
    assert r.status_code == 200, r.text
    assert client.get(base + "/instruction", headers=h).status_code == 200
    assert client.get(base + "/audit", headers=h).json()["verification"]["valid"]
    assert client.delete(f"/api/consents/{s['consent_id']}", headers=h).status_code == 200
    assert client.get(base + "/profile", headers=h).status_code == 404


@pytest.mark.parametrize("kind,expected", [("salary", "salaried"), ("pension", "pensioner")])
def test_custom_customer_income_type(client, kind, expected):
    r = client.post("/api/custom-customers", json=_custom_payload(income_kind=kind))
    assert r.status_code == 201, r.text
    pid = r.json()["persona_id"]
    s = client.post("/api/consents", json={"persona_id": pid, "banks": ["MT"]}).json()
    p = client.get(f"/api/sessions/{s['consent_id']}/profile", headers={"X-Consent-Token": s["token"]}).json()
    assert p["ingestion"]["income_type"] == expected


def test_custom_customer_validation(client):
    assert client.post("/api/custom-customers", json=_custom_payload(age=17)).status_code == 422
    assert client.post("/api/custom-customers", json=_custom_payload(bank="XX")).status_code == 422
    assert client.post("/api/custom-customers",
                       json=_custom_payload(usd_loan_instalment=100, usd_loan_balance=0)).status_code == 422
    r = client.post("/api/custom-customers",
                    content=b'{"age":30,"bank":"MT","monthly_income":NaN,"goal":{"kind":"car","amount":1,"years":1}}',
                    headers={"Content-Type": "application/json"})
    assert r.status_code == 422


def test_custom_customer_zero_flow_uses_all_assets_basis(client):
    r = client.post("/api/custom-customers",
                    json=_custom_payload(monthly_income=0, rent=0, utilities=0, groceries=0, transport=0,
                                         delivery=0, dining=0, taxi=0, gel_savings=2000))
    assert r.status_code == 201, r.text
    pid = r.json()["persona_id"]
    s = client.post("/api/consents", json={"persona_id": pid, "banks": ["MT"]}).json()
    p = client.get(f"/api/sessions/{s['consent_id']}/profile", headers={"X-Consent-Token": s["token"]}).json()
    assert p["liquidity"]["reserve_basis"] == "all_assets"
    assert p["liquidity"]["required_buffer_gel"] == p["ingestion"]["totals"]["assets_gel"]


def test_custom_customer_limit(client, monkeypatch):
    from danazogi.data import custom_customer as cc
    from danazogi.data.mock_open_banking import PERSONAS
    monkeypatch.setattr(cc, "CUSTOM_LIMIT",
                        sum(1 for p in PERSONAS.values() if p.get("source") == "custom"))
    r = client.post("/api/custom-customers", json=_custom_payload())
    assert r.status_code == 409


def test_end_to_end_flow_with_audit_and_purge(client, connect):
    cid, h = connect("nino")
    profile = client.get(f"/api/sessions/{cid}/profile", headers=h).json()
    agents = [t["agent"] for t in profile["trace"]]
    assert agents == ["open_banking", "ingestion", "liquidity_ml", "spending_ml", "profiler", "peers_ml", "personal_inflation"]
    assert profile["models"]["liquidity"].startswith("liquidity-regression-")
    assert profile["models"]["spending"].startswith("spending-regression-")
    assert profile["models"]["peers"].startswith("peers-")
    liq, spend = profile["liquidity"], profile["spending"]
    assert "p12" not in liq
    amounts = (liq["expected_need_gel"], liq["cautious_need_gel"], spend["expected_gel"], spend["cautious_gel"])
    assert all(math.isfinite(v) and v >= 0 for v in amounts)
    assert liq["expected_need_gel"] <= liq["cautious_need_gel"]
    assert spend["expected_gel"] <= spend["cautious_gel"]
    assert 0 <= profile["default_monthly"] <= spend["affordable_monthly_gel"]

    view = client.get(f"/api/sessions/{cid}/missions", headers=h).json()
    assert {m["key"] for m in view["missions"]} == {"protect", "goal", "balance", "growth"}

    plan = client.post(f"/api/sessions/{cid}/plan", headers=h, json={"mission": view["recommended"]}).json()
    exp = client.get(f"/api/sessions/{cid}/explain", headers=h, params={"mission": view["recommended"]}).json()
    assert exp["coalitions"] == 16 and all(s["ka"] and s["en"] for s in exp["narrative"])
    assert exp["narrative"][-1]["id"] == "oversight"

    t = plan["trades"][0]
    assert client.post(f"/api/sessions/{cid}/trades/{t['id']}", headers=h, json={"decision": "approve"}).json()["status"] == "approved"
    assert client.get(f"/api/sessions/{cid}/instruction", headers=h).status_code == 200

    audit = client.get(f"/api/sessions/{cid}/audit", headers=h).json()
    assert audit["verification"]["valid"]
    events = [e["event"] for e in audit["entries"]]
    for e in ("consent.granted", "profile.built", "mission.selected", "trades.proposed", "trade.approved",
              "instruction.generated", "explanation.generated"):
        assert e in events
    assert all(e["models"] for e in audit["entries"] if e["event"] in ("profile.built", "mission.selected"))

    receipt = client.delete(f"/api/consents/{cid}", headers=h).json()
    assert receipt["purged"]["transactions"] > 0 and receipt["audit_head"]
    assert client.get(f"/api/sessions/{cid}/profile", headers=h).status_code == 404


def test_audit_chain_detects_tampering(client, connect):
    cid, h = connect("giorgi")
    client.get(f"/api/sessions/{cid}/profile", headers=h)
    from danazogi.api import store
    s = store.get(cid, h["X-Consent-Token"])
    assert s.audit.verify()["valid"]
    s.audit.entries[0]["details"]["banks"] = ["XX"]
    assert s.audit.verify() == {"valid": False, "broken_at": 1}


def test_bank_timeout_falls_back_to_partial_data(client, connect):
    cid, h = connect("nino", simulate_timeout="RI")
    p = client.get(f"/api/sessions/{cid}/profile", headers=h).json()
    assert p["consent"]["bank_status"] == {"MT": "ok", "RI": "timeout"}
    assert p["partial_data"] and p["liquidity"]["fallback"]["active"]
    assert "partial_bank_data" in p["liquidity"]["fallback"]["reasons"]
    assert p["liquidity"]["buffer_months"] >= 6
    assert p["spending"]["fallback"]["active"] and p["spending"]["affordable_monthly_gel"] == 0.0
    view = client.get(f"/api/sessions/{cid}/missions", headers=h).json()
    goal = next(m for m in view["missions"] if m["key"] == "goal")
    assert "DATA-01" in goal["compliance"]["needs_acknowledgment"]
    events = [e["event"] for e in client.get(f"/api/sessions/{cid}/audit", headers=h).json()["entries"]]
    assert events.count("bank.timeout") == 2 and "fallback.partial_data" in events


def test_wrong_token_is_rejected(client, connect):
    cid, _ = connect("tamar")
    assert client.get(f"/api/sessions/{cid}/profile", headers={"X-Consent-Token": "nope"}).status_code == 404
    import pytest
    from danazogi.api import store
    with pytest.raises(KeyError):
        store.get(cid, "დ")


def test_consent_requires_core_scopes(client):
    r = client.post("/api/consents", json={"persona_id": "nino", "banks": ["MT"], "scopes": ["balances"]})
    assert r.status_code == 422


def test_simulator_score_feeds_compliance(client, connect):
    cid, h = connect("nino")
    f = client.post(f"/api/sessions/{cid}/sandbox", headers=h, json={"mission": "growth"}).json()
    for i in range(f["months"]):
        snap = client.post(f"/api/sessions/{cid}/sandbox/{f['id']}/step", headers=h, json={"action": "hold"}).json()
    assert snap["done"] and snap["result"]
    view = client.get(f"/api/sessions/{cid}/missions", headers=h).json()
    beh = next(c for c in view["missions"][0]["compliance"]["checks"] if c["rule"] == "BEH-01")
    assert (beh["status"] == "info") == (snap["result"]["score"] is None)


def test_goal_update_recomputes_the_plan_and_is_audited(client, connect):
    cid, h = connect("nino")
    before = client.get(f"/api/sessions/{cid}/profile", headers=h).json()["profile"]["goal"]
    r = client.put(f"/api/sessions/{cid}/goal", headers=h, json={"kind": "apartment", "amount": 30000, "currency": "USD", "years": 6})
    assert r.status_code == 200, r.text
    prof = r.json()
    assert prof["goal_source"] == "customer" and prof["profile"]["horizon"] == 6
    assert prof["profile"]["goal"]["target_today_gel"] != before["target_today_gel"]
    view = client.get(f"/api/sessions/{cid}/missions", headers=h).json()
    assert 0 <= view["missions"][1]["probability"] <= 1
    events = [e["event"] for e in client.get(f"/api/sessions/{cid}/audit", headers=h).json()["entries"]]
    assert "goal.updated" in events
    bad = client.put(f"/api/sessions/{cid}/goal", headers=h, json={"kind": "car", "amount": 5000, "currency": "USD", "years": 0})
    assert bad.status_code == 422


def test_simulator_steps_to_each_decision(client, connect):
    cid, h = connect("nino")
    f = client.post(f"/api/sessions/{cid}/sandbox", headers=h, json={"mission": "growth", "chapters": ["S20"]}).json()
    assert f["chapters"] == ["S20"] and f["months"] == 12
    snap = client.post(f"/api/sessions/{cid}/sandbox/{f['id']}/step", headers=h, json={"action": "hold", "until_decision": True}).json()
    assert snap["decision"]["month"] == "2020-03"
    snap = client.post(f"/api/sessions/{cid}/sandbox/{f['id']}/step", headers=h, json={"action": "sell", "until_decision": True}).json()
    assert snap["done"] and snap["result"]["panic_sells"] <= 1


def test_oversized_monthly_is_rejected_at_confirmation(client, connect):
    cid, h = connect("nino")
    limit = client.get(f"/api/sessions/{cid}/profile", headers=h).json()["spending"]["affordable_monthly_gel"]
    view = client.get(f"/api/sessions/{cid}/missions", headers=h, params={"monthly": limit + 100}).json()
    assert view["monthly"] == limit + 100
    r = client.post(f"/api/sessions/{cid}/plan", headers=h, json={"mission": "goal", "monthly": limit + 100})
    assert r.status_code == 409 and r.json()["checks"][0]["rule"] == "AFF-01"
    events = [e["event"] for e in client.get(f"/api/sessions/{cid}/audit", headers=h).json()["entries"]]
    assert "recurring.blocked" in events
    assert "mission.selected" not in events


def test_buffer_shortfall_holds_everything_and_disables_saving(client, connect, monkeypatch):
    from danazogi.agents import liquidity
    real = liquidity.assess

    def wrapped(*args, **kwargs):
        out = real(*args, **kwargs)
        assets = args[2]
        out.update(required_buffer_gel=assets + 5000.0, buffer_gel=assets, buffer_share=1.0,
                   buffer_shortfall_gel=5000.0, free_to_invest_gel=0.0)
        return out

    monkeypatch.setattr(liquidity, "assess", wrapped)
    cid, h = connect("nino")
    p = client.get(f"/api/sessions/{cid}/profile", headers=h).json()
    liq = p["liquidity"]
    assert liq["buffer_shortfall_gel"] > 0 and liq["free_to_invest_gel"] == 0.0
    assert liq["buffer_gel"] == p["ingestion"]["totals"]["assets_gel"]
    assert p["spending"]["affordable_monthly_gel"] == 0.0
    r = client.post(f"/api/sessions/{cid}/plan", headers=h, json={"mission": "goal", "monthly": 100})
    assert r.status_code == 409 and r.json()["checks"][0]["rule"] == "AFF-01"


def test_duplicate_banks_are_canonicalized(client):
    one = client.post("/api/consents", json={"persona_id": "nino", "banks": ["MT", "RI"]}).json()
    dup = client.post("/api/consents", json={"persona_id": "nino", "banks": ["MT", "MT", "RI"]}).json()
    assert dup["banks"] == one["banks"] == ["MT", "RI"]
    p1 = client.get(f"/api/sessions/{one['consent_id']}/profile", headers={"X-Consent-Token": one["token"]}).json()
    p2 = client.get(f"/api/sessions/{dup['consent_id']}/profile", headers={"X-Consent-Token": dup["token"]}).json()
    i1, i2 = p1["ingestion"], p2["ingestion"]
    assert len(i1["accounts"]) == len(i2["accounts"])
    assert i1["totals"]["assets_gel"] == i2["totals"]["assets_gel"]
    assert i1["transaction_count"] == i2["transaction_count"]


def test_unknown_bank_or_scope_is_rejected(client):
    assert client.post("/api/consents", json={"persona_id": "nino", "banks": ["MT", "XX"]}).status_code == 422
    r = client.post("/api/consents", json={"persona_id": "nino", "banks": ["MT"],
                                          "scopes": ["balances", "transactions", "admin"]})
    assert r.status_code == 422


def test_missing_bank_or_scope_is_partial_and_disables_saving(client):
    r = client.post("/api/consents", json={"persona_id": "nino", "banks": ["MT"]})
    assert r.status_code == 201
    body = r.json()
    p = client.get(f"/api/sessions/{body['consent_id']}/profile",
                   headers={"X-Consent-Token": body["token"]}).json()
    assert p["partial_data"] and p["spending"]["affordable_monthly_gel"] == 0.0
    assert p["liquidity"]["fallback"]["active"]

    r = client.post("/api/consents", json={"persona_id": "nino", "banks": ["MT", "RI"],
                                          "scopes": ["balances", "transactions", "deposits"]})
    assert r.status_code == 201
    body = r.json()
    p = client.get(f"/api/sessions/{body['consent_id']}/profile",
                   headers={"X-Consent-Token": body["token"]}).json()
    assert p["partial_data"] and p["spending"]["affordable_monthly_gel"] == 0.0


def test_monthly_query_params_are_validated(client, connect):
    cid, h = connect("nino")
    for route in ("missions", "funds"):
        for bad in (-1, "nan", "inf", 200_000):
            r = client.get(f"/api/sessions/{cid}/{route}", headers=h, params={"monthly": bad})
            assert r.status_code == 422, (route, bad)
    for bad in (-1, "nan", "inf", 200_000):
        r = client.get(f"/api/sessions/{cid}/explain", headers=h, params={"mission": "goal", "monthly": bad})
        assert r.status_code == 422, bad


def test_non_finite_trade_amount_is_422_not_500(client, connect):
    cid, h = connect("nino")
    trades = client.post(f"/api/sessions/{cid}/plan", headers=h, json={"mission": "goal"}).json()["trades"]
    tid = trades[0]["id"]
    for raw in (b'{"decision":"edit","amount_gel":Infinity}', b'{"decision":"edit","amount_gel":NaN}'):
        r = client.post(f"/api/sessions/{cid}/trades/{tid}",
                        headers={**h, "Content-Type": "application/json"}, content=raw)
        assert r.status_code == 422, r.status_code


def test_selected_monthly_is_persisted_and_used(client, connect):
    cid, h = connect("nino")
    client.put(f"/api/sessions/{cid}/goal", headers=h, json={"kind": "car", "amount": 5000, "currency": "USD", "years": 4})
    plan = client.post(f"/api/sessions/{cid}/plan", headers=h, json={"mission": "protect", "monthly": 0}).json()
    assert plan["monthly"] == 0
    t = next(x for x in plan["trades"] if x.get("kind") == "one_off")
    assert client.post(f"/api/sessions/{cid}/trades/{t['id']}", headers=h, json={"decision": "approve"}).status_code == 200
    doc = client.get(f"/api/sessions/{cid}/instruction", headers=h).json()
    view = client.get(f"/api/sessions/{cid}/missions", headers=h, params={"monthly": 0}).json()
    expected = next(m for m in view["missions"] if m["key"] == "protect")
    assert doc["mission"]["probability"] == expected["probability"]
    tr = client.get(f"/api/sessions/{cid}/trades", headers=h).json()
    assert tr["monthly"] == 0


def test_old_trade_ids_fail_after_reselection(client, connect):
    cid, h = connect("nino")
    t1 = client.post(f"/api/sessions/{cid}/plan", headers=h, json={"mission": "goal"}).json()["trades"][0]
    client.post(f"/api/sessions/{cid}/plan", headers=h, json={"mission": "balance"})
    r = client.post(f"/api/sessions/{cid}/trades/{t1['id']}", headers=h, json={"decision": "approve"})
    assert r.status_code == 404


def test_goal_update_clears_selection_flights_and_score(client, connect):
    cid, h = connect("nino")
    f = client.post(f"/api/sessions/{cid}/sandbox", headers=h, json={"mission": "growth"}).json()
    client.post(f"/api/sessions/{cid}/plan", headers=h, json={"mission": "goal"})
    client.put(f"/api/sessions/{cid}/goal", headers=h, json={"kind": "car", "amount": 8000, "currency": "USD", "years": 5})
    assert client.post(f"/api/sessions/{cid}/sandbox/{f['id']}/step", headers=h, json={"action": "hold"}).status_code == 404
    from danazogi.api import store
    s = store.get(cid, h["X-Consent-Token"])
    assert s.selected_mission is None and s.selected_monthly is None
    assert s.behaviour_score is None and not s.flights


def test_trade_edit_to_cents_regenerates_text(client, connect):
    from datetime import date
    from danazogi.agents import execution
    cid, h = connect("nino")
    plan = client.post(f"/api/sessions/{cid}/plan", headers=h, json={"mission": "goal"}).json()
    accounts = client.get(f"/api/sessions/{cid}/profile", headers=h).json()["ingestion"]["accounts"]
    balances = {a["id"]: a["balance_gel"] for a in accounts}
    t = next(x for x in plan["trades"]
             if x.get("kind") == "one_off" and x["convert"]
             and balances.get(x["from"]["account"], 0) > 200)
    r = client.post(f"/api/sessions/{cid}/trades/{t['id']}", headers=h, json={"decision": "edit", "amount_gel": 100.25})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["amount_gel"] == 100.25 and body["proposed_gel"] == t["proposed_gel"]
    assert "100.25" in body["action_en"] and "100,25" in body["action_ka"]
    ka, en = execution.action_text(t["asset"], 100.25, t["convert"], t["from"]["currency"] == "USD",
                                   date.fromisoformat(t["date"]))
    assert body["action_en"] == en and body["action_ka"] == ka
    assert client.post(f"/api/sessions/{cid}/trades/{t['id']}", headers=h, json={"decision": "approve"}).status_code == 200
    doc = client.get(f"/api/sessions/{cid}/instruction", headers=h).json()
    step = next(s for s in doc["steps"] if s["id"] == t["id"])
    assert step["amount_gel"] == 100.25 and step["action_en"] == en


def test_recurring_edit_text_and_fractional_limit(client, connect):
    from danazogi.agents import execution
    cid, h = connect("nino")
    p = client.get(f"/api/sessions/{cid}/profile", headers=h).json()
    limit, pay_day = p["spending"]["affordable_monthly_gel"], p["ingestion"]["pay_day"]
    plan = client.post(f"/api/sessions/{cid}/plan", headers=h, json={"mission": "goal"}).json()
    auto = next(t for t in plan["trades"] if t.get("kind") == "recurring")
    r = client.post(f"/api/sessions/{cid}/trades/{auto['id']}", headers=h, json={"decision": "edit", "amount_gel": 135.5})
    body = r.json()
    assert body["amount_gel"] == 135.5
    assert "135.50" in body["action_en"] and "135,50" in body["action_ka"]
    parts_en = ", ".join(f"{execution.NAME[k][1]} {v:.0%}" for k, v in auto["split"].items())
    assert body["action_en"] == (f"Monthly auto-invest: {execution._money(135.5, 'en')} GEL on day {min(pay_day, 28)} "
                               f"of each month (pay day). Split: {parts_en}.")
    r = client.post(f"/api/sessions/{cid}/trades/{auto['id']}", headers=h, json={"decision": "edit", "amount_gel": limit})
    body = r.json()
    assert body["status"] != "blocked" and body["amount_gel"] <= limit + 1e-9


def test_proposals_floor_to_cents_and_never_overspend():
    from danazogi.agents import execution
    ing = {"totals": {"assets_gel": 55.55}, "holdings_gel": {"CASH": 55.55}, "cash_at_home": 55.55,
           "accounts": [], "pay_day": 31}
    out = execution.proposals(ing=ing, weights={"LIQ": 1.0})
    assert len(out) == 1 and out[0]["amount_gel"] == 55.55 and out[0]["from"]["account"] == "cash-at-home"


def test_proposals_use_future_dates_for_matured_deposits():
    from datetime import date, timedelta
    from danazogi.agents import execution
    from danazogi.data.market import AS_OF
    acc = {"id": "dep1", "bank_name": "B", "bank_name_ka": "B", "iban": "X", "product": "term_deposit",
           "currency": "GEL", "balance_gel": 1000.0, "maturity": "2020-01-01", "asset": "GEL_DEP"}
    ing = {"totals": {"assets_gel": 1000.0}, "holdings_gel": {"GEL_DEP": 1000.0}, "cash_at_home": 0.0,
           "accounts": [acc], "pay_day": 31}
    out = execution.proposals(ing=ing, weights={"TBILL": 1.0})
    assert out and date.fromisoformat(out[0]["date"]) >= AS_OF + timedelta(days=2)


def test_recurring_uses_pay_day_capped_at_28():
    from danazogi.agents import execution
    acc = {"id": "cur1", "bank_name": "B", "bank_name_ka": "B", "iban": "X", "product": "current",
           "currency": "GEL", "balance_gel": 100.0, "maturity": None, "asset": "LIQ"}
    base = {"accounts": [acc]}
    auto = execution.recurring(ing={**base, "pay_day": 31}, monthly=500.0, invest={"LIQ": 1.0})
    assert "day 28" in auto["action_en"] and auto["date"][8:10] == "28"
    auto = execution.recurring(ing={**base, "pay_day": 15}, monthly=500.0, invest={"LIQ": 1.0})
    assert "day 15" in auto["action_en"]


def test_tbc_probe_is_status_only_and_never_authenticated(monkeypatch):
    import urllib.error
    import urllib.request
    from danazogi.data import organiser_xlsx
    monkeypatch.setitem(organiser_xlsx._probe_cache, "result", None)

    def unavailable(req, timeout=None):
        raise urllib.error.HTTPError(req.full_url, 503, "down", {}, None)
    monkeypatch.setattr(urllib.request, "urlopen", unavailable)
    r = organiser_xlsx.probe_tbc_sandbox(force=True)
    assert r["data_source"] == "organiser_xlsx_100_customers"
    assert r["fallback_mode"] == "organiser_xlsx_100_customers"
    assert r["integration_mode"] == "status_probe_only" and r["authenticated"] is False
    assert not r["live_available"]

    def timed_out(req, timeout=None):
        raise TimeoutError("slow")
    monkeypatch.setattr(urllib.request, "urlopen", timed_out)
    monkeypatch.setitem(organiser_xlsx._probe_cache, "result", None)
    r = organiser_xlsx.probe_tbc_sandbox(force=True)
    assert r["data_source"] == "organiser_xlsx_100_customers" and not r["live_available"]

    def unauthorized(req, timeout=None):
        raise urllib.error.HTTPError(req.full_url, 401, "unauthorized", {}, None)
    monkeypatch.setattr(urllib.request, "urlopen", unauthorized)
    monkeypatch.setitem(organiser_xlsx._probe_cache, "result", None)
    r = organiser_xlsx.probe_tbc_sandbox(force=True)
    assert r["live_available"] is True and r["authenticated"] is False
    assert r["fallback_mode"] == "organiser_xlsx_100_customers"


def test_concurrent_profile_requests_are_serialized(client, connect):
    import concurrent.futures
    cid, h = connect("nino")
    with concurrent.futures.ThreadPoolExecutor(max_workers=6) as ex:
        rs = list(ex.map(lambda _: client.get(f"/api/sessions/{cid}/profile", headers=h), range(6)))
    assert all(r.status_code == 200 for r in rs)
    audit = client.get(f"/api/sessions/{cid}/audit", headers=h).json()
    assert audit["verification"]["valid"]
    assert [e["event"] for e in audit["entries"]].count("profile.built") == 1
    client.delete(f"/api/consents/{cid}", headers=h)
    assert client.get(f"/api/sessions/{cid}/profile", headers=h).status_code == 404


def test_organiser_xlsx_customer_and_tbc_sandbox_flow(client, connect):
    r_pers = client.get("/api/personas").json()
    assert len(r_pers["organiser_customers"]) == 100
    assert "tbc_sandbox" in r_pers
    status = client.get("/api/tbc-status").json()
    assert "sandbox_url" in status and "fallback_mode" in status
    cid, h = connect("cus-001")
    prof = client.get(f"/api/sessions/{cid}/profile", headers=h).json()
    assert prof["ingestion"]["months_of_history"] == 6
    assert prof["ingestion"]["transaction_count"] > 50
    audit = client.get(f"/api/sessions/{cid}/audit", headers=h).json()
    assert audit["verification"]["valid"]
    events = [e["event"] for e in audit["entries"]]
    assert "tbc_sandbox.probed" in events


def test_webapp_spa_fallback(client):
    from danazogi.api import WEBAPP_DIST
    if not (WEBAPP_DIST / "index.html").exists():
        pytest.skip("webapp/dist is not built")
    r = client.get("/app/goals")
    assert r.status_code == 200
    assert "text/html" in r.headers["content-type"]


def test_unknown_api_path_stays_json_404(client):
    r = client.get("/api/definitely-not-a-route")
    assert r.status_code == 404
    assert r.headers["content-type"].startswith("application/json")


def test_yahoo_relay_rejects_other_paths(client):
    assert client.get("/api/yahoo/v7/finance/quote?symbols=AAPL").status_code == 404
    assert client.get("/api/yahoo/").status_code == 404


def test_yahoo_relay_upstream_failure_is_502(client, monkeypatch):
    import httpx

    async def fail(self, *a, **kw):
        raise httpx.ConnectError("down")

    monkeypatch.setattr(httpx.AsyncClient, "get", fail)
    r = client.get("/api/yahoo/v8/finance/chart/AAPL")
    assert r.status_code == 502
    assert r.json() == {"error": "upstream unavailable"}


def test_yahoo_relay_passes_through_status_and_query(client, monkeypatch):
    import httpx

    class FakeResp:
        status_code = 200
        content = b'{"chart":{}}'
        headers = {"content-type": "application/json; charset=utf-8"}

    async def get(self, url, headers=None):
        assert url.startswith("https://query1.finance.yahoo.com/v8/finance/chart/AAPL")
        assert "range=5y" in url
        assert headers and headers.get("User-Agent") == "Mozilla/5.0 (MosaVali prototype)"
        return FakeResp()

    monkeypatch.setattr(httpx.AsyncClient, "get", get)
    r = client.get("/api/yahoo/v8/finance/chart/AAPL?range=5y&interval=1wk")
    assert r.status_code == 200
    assert r.headers["cache-control"] == "public, max-age=300"
    assert r.json() == {"chart": {}}
