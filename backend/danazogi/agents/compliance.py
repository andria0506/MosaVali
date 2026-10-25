"""Compliance agent: rule checks that can warn, require acknowledgment, or block.

Rules are evaluated before any mission is shown as selectable and again on
every trade edit. A blocked mission or trade cannot be approved. A warning
needs the customer's explicit acknowledgment, which is written to the audit log.
"""

from ..data.market import ASSETS
from . import missions as M
from .stress import CAPS, LIQUID

RULES = {
    "BUF-01": {"ka": "ლიკვიდური ბუფერი დაცულია", "en": "Liquidity buffer stays protected"},
    "CAP-01": {"ka": "მისია ფინანსურ ტევადობას არ აღემატება", "en": "Mission within financial risk capacity"},
    "BEH-01": {"ka": "მისია შეესაბამება კრიზისის სიმულატორში ნაჩვენებ ქცევას", "en": "Mission matches behaviour in the crisis simulator"},
    "VULN-01": {"ka": "მოწყვლადი მომხმარებლის დაცვა", "en": "Vulnerable-customer protection"},
    "CONC-01": {"ka": "კონცენტრაციის ლიმიტები", "en": "Concentration limits"},
    "PROD-01": {"ka": "მხოლოდ დივერსიფიცირებული ფონდები, არა ცალკეული აქციები", "en": "Diversified funds only, no single stocks"},
    "SPEND-01": {"ka": "აუცილებელი ხარჯის შემცირება არასოდეს ირჩევა", "en": "Essential spending is never suggested as a cut"},
    "DATA-01": {"ka": "საბანკო მონაცემები სრულია", "en": "Bank data is complete"},
    "AFF-01": {"ka": "ყოველთვიური შენატანი შემოსავალს შეესაბამება", "en": "Monthly amount fits your cash flow"},
    "SOURCE-01": {"ka": "წყაროს ანგარიშზე საკმარისი თანხაა", "en": "Source account has sufficient funds"},
}
VULNERABLE_AGE = 65
VULNERABLE_HORIZON = 3
VULNERABLE_EQUITY = 0.10


def behaviour_rank(score: int | None) -> int | None:
    if score is None:
        return None
    return 1 if score <= 3 else 2 if score <= 5 else 3 if score <= 7 else 4


def _check(rule: str, status: str, ka: str, en: str) -> dict:
    return {"rule": rule, "status": status, "title_ka": RULES[rule]["ka"], "title_en": RULES[rule]["en"],
            "ka": ka, "en": en}


def check_mission(mission: dict, *, capacity_level: int, behaviour_score: int | None, age: int, horizon: int,
                  high_need: bool, partial: bool, buffer_share: float) -> dict:
    rank, w = mission["rank"], mission["weights"]
    out = []
    liquid = sum(w[k] for k in LIQUID)
    out.append(_check("BUF-01", "pass" if liquid >= buffer_share - 1e-6 else "block",
                      f"ხელმისაწვდომ ანგარიშებზე რჩება {liquid:.0%}, საჭიროა {buffer_share:.0%}.",
                      f"{liquid:.0%} stays in instant-access accounts; {buffer_share:.0%} is required."))
    cap_rank = M.max_rank(capacity_level)
    out.append(_check("CAP-01", "pass" if rank <= cap_rank else "warn",
                      f"თქვენი ფინანსური ტევადობა ({capacity_level}/10) მაქსიმუმ „{M.MISSIONS[cap_rank - 1]['ka']}“ მისიას იტანს.",
                      f"Your financial capacity ({capacity_level}/10) supports up to the {M.MISSIONS[cap_rank - 1]['en']} mission."))
    b_rank = behaviour_rank(behaviour_score)
    if b_rank is None:
        out.append(_check("BEH-01", "info", "კრიზისის სიმულატორი ჯერ არ გაგივლიათ.", "The crisis simulator has not been completed yet."))
    else:
        out.append(_check("BEH-01", "pass" if rank <= b_rank else "warn",
                          f"კრიზისის სიმულატორში თქვენი ქცევა ({behaviour_score}/10) „{M.MISSIONS[b_rank - 1]['ka']}“ მისიას შეესაბამება.",
                          f"Your behaviour in the crisis simulator ({behaviour_score}/10) matches the {M.MISSIONS[b_rank - 1]['en']} mission."))
    vulnerable = (age >= VULNERABLE_AGE or high_need) and horizon <= VULNERABLE_HORIZON
    equity = w.get("ETF", 0.0)
    if vulnerable and (rank >= 3 or equity > VULNERABLE_EQUITY + 1e-6):
        out.append(_check("VULN-01", "block",
                          f"{age} წლის ასაკში და {horizon} წლიან ვადაზე, როცა თანხა შეიძლება მალე დაგჭირდეთ, აქციების "
                          f"მაღალი წილი თქვენს დანაზოგს არასაჭირო რისკის ქვეშ აყენებს. გირჩევთ „დაცვის“ მისიას.",
                          f"At {age}, with money you may need within {horizon} years, a high share of shares puts your "
                          f"savings at unnecessary risk. We recommend the Protect mission."))
    else:
        out.append(_check("VULN-01", "pass",
                          "დამატებითი შეზღუდვა არ მოქმედებს." if not vulnerable else "დაცვის რეჟიმი: აქციები ≤ 10%.",
                          "No additional restriction applies." if not vulnerable else "Protection mode: shares ≤ 10%."))
    over = [a.key for a in ASSETS if a.key not in LIQUID and a.key != "ETF" and w.get(a.key, 0) > CAPS[a.key] + 1e-6]
    out.append(_check("CONC-01", "block" if over else "pass",
                      "ერთ ინსტრუმენტში 40%-ზე მეტი არ იდება." if not over else f"ლიმიტი დარღვეულია: {', '.join(over)}.",
                      "No single instrument above 40%." if not over else f"Limit exceeded: {', '.join(over)}."))
    out.append(_check("PROD-01", "pass", "გეგმა მხოლოდ ანაბრებს, სახაზინო ფასიან ქაღალდებს და დივერსიფიცირებულ ETF-ს იყენებს.",
                      "The plan uses only deposits, treasury securities and a diversified ETF."))
    out.append(_check("DATA-01", "warn" if partial else "pass",
                      "საბანკო მონაცემების ან თანხმობის ფარგლების ნაწილი აკლია: გეგმა კონსერვატიულია და მრჩეველის შემოწმებას საჭიროებს."
                      if partial else "მონაცემები ყველა არჩეული ბანკიდან და ფარგლობიდან მიღებულია.",
                      "Some bank data or consent scopes are missing: the plan is conservative and needs adviser review."
                      if partial else "Data from the selected banks and scopes was received."))
    blocked = [c["rule"] for c in out if c["status"] == "block"]
    warn = [c["rule"] for c in out if c["status"] == "warn"]
    return {"mission": mission["key"], "checks": out, "blocked": bool(blocked), "blocking_rules": blocked,
            "needs_acknowledgment": warn}


def check_recurring(amount: float, affordable_monthly: float) -> list[dict]:
    if amount > max(affordable_monthly, 0.0) + 1e-6:
        return [_check("AFF-01", "block",
                       f"თვეში {amount:,.0f} ლარი აღემატება ფრთხილი ფულადი ნაკადის ლიმიტს ({affordable_monthly:,.0f} ლარი).",
                       f"{amount:,.0f} GEL a month exceeds the cautious cash-flow limit ({affordable_monthly:,.0f} GEL).")]
    return []


def check_portfolio(*, ing: dict, trades: list[dict], buffer_gel: float, equity_cap: float) -> list[dict]:
    """Cumulative check of a set of money moves against real account balances.

    An inherited concentration or reserve shortfall may remain, but these
    steps must not make it worse. Rejected funding steps cannot finance an
    approved investment.
    """
    total = ing["totals"]["assets_gel"]
    original = dict(ing["holdings_gel"])
    projected = dict(original)
    sources = {a["id"]: (a["asset"], a["balance_gel"]) for a in ing["accounts"] if a["asset"]}
    sources["cash-at-home"] = ("CASH", ing.get("cash_at_home", 0.0))
    liquid_assets = (*LIQUID, "CASH")  # cash is accessible during a draft, even though optimizer moves it to savings
    liquid_changes = {}
    used = {}
    for t in trades:
        if t.get("kind") == "recurring":
            continue
        source_id = t["from"]["account"]
        if source_id not in sources:
            raise ValueError("Unknown source account")
        asset, _ = sources[source_id]
        amount = t["amount_gel"]
        used[source_id] = used.get(source_id, 0.0) + amount
        projected[asset] = projected.get(asset, 0.0) - amount
        projected[t["asset"]] = projected.get(t["asset"], 0.0) + amount
        day = t.get("date", "")
        liquid_changes[day] = liquid_changes.get(day, 0.0) + amount * (
            int(t["asset"] in liquid_assets) - int(asset in liquid_assets))
    out = []
    if any(amount > sources[sid][1] + 0.01 for sid, amount in used.items()):
        out.append(_check("SOURCE-01", "block", "ამ ანგარიშიდან ჯამური გადარიცხვა მის ნაშთს აჭარბებს.",
                          "The combined transfers exceed the source account balance."))
    initial_liquid = sum(original.get(k, 0.0) for k in liquid_assets)
    liquid_floor = min(buffer_gel, initial_liquid)
    accessible = initial_liquid
    for day in sorted(liquid_changes):
        accessible += liquid_changes[day]
        if accessible + 0.01 < liquid_floor:
            out.append(_check("BUF-01", "block",
                              "ეს ნაბიჯები ხელმისაწვდომ ფულს დაცულ მინიმუმზე ქვემოთ ამცირებს.",
                              "These steps reduce accessible cash below the protected minimum before later funds become available."))
            break
    for asset, amount in projected.items():
        if asset in liquid_assets:
            continue
        cap = equity_cap if asset == "ETF" else CAPS.get(asset, 1.0)
        if amount > max(original.get(asset, 0.0), cap * total) + 0.01:
            out.append(_check("CONC-01", "block", "ეს ნაბიჯები აქტივის დასაშვებ წილს აჭარბებს.",
                              "These steps exceed the permitted share of an asset."))
            break
    return out
