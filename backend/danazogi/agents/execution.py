"""Execution agent: turns a mission into trade proposals the customer approves, rejects or edits.

Nothing is executed. Term deposits are never broken early: their money moves
only at maturity. Approved proposals become a ready-to-sign instruction for
the partner bank or broker.
"""

import math
from datetime import date, timedelta

from ..data.market import AS_OF, ASSETS, FX_SPOT
from .explain import num

CODE = {a.key: a.code for a in ASSETS}
NAME = {a.key: (a.name_ka, a.name_en) for a in ASSETS}
PRODUCT = {"current": ("მიმდინარე ანგარიში", "current account"),
           "savings": ("შემნახველი ანგარიში", "savings account"),
           "term_deposit": ("ვადიანი ანაბარი", "term deposit"),
           "cash": ("ნაღდი ფული სახლში", "cash at home")}
DEST_ORDER = ["LIQ", "USD_CASH", "TBILL", "GEL_DEP", "USD_DEP", "ETF"]
USD_DEST = {"USD_CASH", "USD_DEP", "ETF"}


def _money(amount: float, lang: str) -> str:
    return num(amount, lang, 2 if abs(amount - round(amount)) > 1e-8 else 0)


def _lot(d: date) -> str:
    nxt = date(d.year + (d.month // 12), d.month % 12 + 1, 1)
    return f"TB-{nxt.year}-{nxt.month:02d}"


def action_text(dest: str, gel: float, convert: bool, src_usd: bool, d: date) -> tuple[str, str]:
    g_ka, g_en, u = _money(gel, "ka"), _money(gel, "en"), _money(gel / FX_SPOT, "en")
    conv_ka = f"{g_ka} ლარის კონვერტაცია (~${u}) და " if convert and not src_usd else ""
    conv_en = f"Convert {g_en} GEL (~${u}) and " if convert and not src_usd else ""
    if dest == "TBILL":
        return (f"{g_ka} ლარით მონაწილეობა სახაზინო ფასიანი ქაღალდების აუქციონში პარტნიორი ბანკის მეშვეობით "
                f"(საორიენტაციო ლოტი {_lot(d)})",
                f"Bid {g_en} GEL in the treasury securities auction through the partner bank "
                f"(illustrative lot {_lot(d)})")
    if dest == "ETF":
        return (f"{conv_ka}გლობალური აქციების ETF-ის შეძენა ლიცენზირებული ბროკერის მეშვეობით",
                f"{conv_en}buy a global equity ETF through the licensed partner broker" if convert
                else f"Buy a global equity ETF for ${u} through the licensed partner broker")
    if dest == "USD_DEP":
        return (f"{conv_ka}12-თვიანი დოლარის ვადიანი ანაბრის გახსნა",
                f"{conv_en}open a 12-month USD term deposit" if convert else "Open a 12-month USD term deposit")
    if dest == "GEL_DEP":
        return (f"{g_ka} ლარით 12-თვიანი ლარის ვადიანი ანაბრის გახსნა",
                f"Open a 12-month GEL term deposit with {g_en} GEL")
    if dest == "USD_CASH":
        return (f"{conv_ka}შენახვა დოლარის ხელმისაწვდომ ანგარიშზე (დოლარის ხარჯების ბუფერი)",
                f"{conv_en}keep it in instant-access USD (buffer for USD costs)" if convert
                else "Keep it in instant-access USD (buffer for USD costs)")
    return (f"{g_ka} ლარის განთავსება ხელმისაწვდომ შემნახველ ანგარიშზე (ლიკვიდური ბუფერი, 3%)",
            f"Move {g_en} GEL into instant-access savings (liquidity buffer, 3%)")


def recurring(*, ing: dict, monthly: float, invest: dict) -> dict | None:
    """A monthly auto-invest on the detected pay day, split by the plan's invested weights."""
    if monthly < 10:
        return None
    acc = next((a for a in ing["accounts"] if a["product"] == "current" and a["currency"] == "GEL"), None)
    if acc is None:
        return None
    day = min(ing["pay_day"], 28)
    if AS_OF.day < day:
        nxt = date(AS_OF.year, AS_OF.month, day)
    else:
        y, m = (AS_OF.year + 1, 1) if AS_OF.month == 12 else (AS_OF.year, AS_OF.month + 1)
        nxt = date(y, m, day)
    split = {k: round(v, 4) for k, v in invest.items() if v >= 0.005}
    parts_ka = ", ".join(f"{NAME[k][0]} {v:.0%}" for k, v in split.items())
    parts_en = ", ".join(f"{NAME[k][1]} {v:.0%}" for k, v in split.items())
    monthly_c = math.floor((monthly + 1e-9) * 100) / 100
    return {
        "id": "AI-01", "kind": "recurring", "asset": "PLAN", "asset_ka": "ყოველთვიური გეგმა", "asset_en": "Monthly plan",
        "amount_gel": monthly_c, "proposed_gel": monthly_c,
        "amount_usd": round(monthly_c / FX_SPOT, 2), "convert": any(k in USD_DEST for k in split),
        "date": nxt.isoformat(), "timing": "monthly", "split": split,
        "from": {"account": acc["id"], "bank": acc["bank_name"], "bank_ka": acc["bank_name_ka"], "iban": acc["iban"],
                 "product_ka": PRODUCT["current"][0], "product_en": PRODUCT["current"][1], "currency": "GEL"},
        "action_ka": f"ყოველთვიური შენატანი: {_money(monthly_c, 'ka')} ლარი ყოველი თვის {day} რიცხვში. "
                     f"განაწილება: {parts_ka}.",
        "action_en": f"Monthly auto-invest: {_money(monthly_c, 'en')} GEL on day {day} of each month (pay day). "
                     f"Split: {parts_en}.",
        "when_ka": f"ყოველთვე, {day} რიცხვში", "when_en": f"every month on day {day}",
        "status": "proposed", "checks": [],
    }


def refresh_amount(trade: dict, amount: float, *, pay_day: int) -> None:
    """Apply a customer-edited amount to a proposal: floor to cents and regenerate the action text."""
    amount = math.floor((amount + 1e-9) * 100) / 100
    if amount <= 0:
        raise ValueError("An edit needs a positive amount")
    trade["amount_gel"] = amount
    trade["amount_usd"] = round(amount / FX_SPOT, 2)
    if trade.get("kind") == "recurring":
        day = min(pay_day, 28)
        parts_ka = ", ".join(f"{NAME[k][0]} {v:.0%}" for k, v in trade["split"].items())
        parts_en = ", ".join(f"{NAME[k][1]} {v:.0%}" for k, v in trade["split"].items())
        trade["action_ka"] = (f"ყოველთვიური შენატანი: {_money(amount, 'ka')} ლარი ყოველი თვის {day} რიცხვში. "
                              f"განაწილება: {parts_ka}.")
        trade["action_en"] = (f"Monthly auto-invest: {_money(amount, 'en')} GEL on day {day} of each month (pay day). "
                              f"Split: {parts_en}.")
    else:
        trade["action_ka"], trade["action_en"] = action_text(
            trade["asset"], amount, trade["convert"], trade["from"]["currency"] == "USD",
            date.fromisoformat(trade["date"]))


def proposals(*, ing: dict, weights: dict) -> list[dict]:
    total = ing["totals"]["assets_gel"]
    holdings = ing["holdings_gel"]
    delta = {k: weights.get(k, 0.0) * total - holdings.get(k, 0.0) for k in set(weights) | set(holdings)}
    now = AS_OF + timedelta(days=2)

    sources = []
    excess = {k: -v for k, v in delta.items() if v < 0}
    order = {"current": 0, "savings": 1, "term_deposit": 2}
    cash_at_home = ing.get("cash_at_home", 0.0)
    if cash_at_home > 0 and excess.get("CASH", 0) > 1:
        take = min(excess["CASH"], cash_at_home)
        excess["CASH"] -= take
        sources.append({"acc": {"bank_name": "—", "bank_name_ka": "—", "iban": "—", "product": "cash", "currency": "GEL",
                                "id": "cash-at-home"}, "left": take, "date": now})
    for acc in sorted((a for a in ing["accounts"] if a["asset"]),
                      key=lambda a: (order.get(a["product"], 9), a["maturity"] or "", -a["balance_gel"])):
        left = excess.get(acc["asset"], 0.0)
        if left <= 1:
            continue
        take = min(left, acc["balance_gel"])
        excess[acc["asset"]] = left - take
        when = max(now, date.fromisoformat(acc["maturity"])) if acc["product"] == "term_deposit" else now
        sources.append({"acc": acc, "left": take, "date": when})
    sources.sort(key=lambda s: s["date"])

    out, counters = [], {}
    for dest in DEST_ORDER:
        need = delta.get(dest, 0.0)
        for src in sources:
            if need < 50:
                break
            if src["left"] < 50:
                continue
            amt = math.floor((min(need, src["left"]) + 1e-9) * 100) / 100
            if amt <= 0:
                continue
            src["left"] -= amt
            need -= amt
            acc = src["acc"]
            src_usd = acc["currency"] == "USD"
            convert = (dest in USD_DEST) != src_usd
            counters[dest] = counters.get(dest, 0) + 1
            ka, en = action_text(dest, amt, convert, src_usd, src["date"])
            at_maturity = acc["product"] == "term_deposit"
            out.append({
                "id": f"{CODE[dest]}-{counters[dest]:02d}",
                "asset": dest, "asset_ka": NAME[dest][0], "asset_en": NAME[dest][1],
                "amount_gel": float(amt), "proposed_gel": float(amt),
                "amount_usd": round(amt / FX_SPOT, 2), "convert": convert,
                "date": src["date"].isoformat(), "timing": "at_maturity" if at_maturity else "now",
                "from": {"account": acc["id"], "bank": acc["bank_name"], "bank_ka": acc["bank_name_ka"], "iban": acc["iban"],
                         "product_ka": PRODUCT[acc["product"]][0], "product_en": PRODUCT[acc["product"]][1],
                         "currency": acc["currency"]},
                "action_ka": ka, "action_en": en,
                "when_ka": f"ანაბრის ვადის გასვლისას, {src['date'].isoformat()}" if at_maturity else "ახლა",
                "when_en": f"when the deposit matures on {src['date'].isoformat()}" if at_maturity else "now",
                "status": "proposed", "checks": [], "kind": "one_off",
            })
    return out


def instruction(*, trades: list[dict], psu: dict, consent_id: str, mission: dict, acknowledged: list[str]) -> dict:
    approved = [t for t in trades if t["status"] == "approved"]
    return {
        "id": f"DZ-{consent_id[:6].upper()}-{mission['key'].upper()}",
        "created": AS_OF.isoformat(),
        "client_ka": psu["name_ka"], "client_en": psu["name_en"],
        "mission": {k: mission[k] for k in ("key", "ka", "en", "probability")},
        "steps": approved,
        "total_gel": sum(t["amount_gel"] for t in approved if t.get("kind") != "recurring"),
        "monthly_total_gel": sum(t["amount_gel"] for t in approved if t.get("kind") == "recurring"),
        "projection_basis": "confirmed_full_plan",
        "acknowledged_warnings": acknowledged,
        "fx_rate": FX_SPOT,
        "disclaimer_ka": "პროექტი, არა დავალება. MosaVali არ ასრულებს ტრანზაქციებს. თითოეული ნაბიჯი "
                         "ხელმოწერამდე გადაამოწმეთ პარტნიორ ბანკთან ან ლიცენზირებულ ბროკერთან. "
                         "მიზნის შეფასება სრულ შემოთავაზებულ გეგმას ეხება. თანხების შეცვლა ან მხოლოდ ზოგიერთი "
                         "ნაბიჯის დამტკიცება შედეგს ცვლის.",
        "disclaimer_en": "Draft, not an order. MosaVali does not execute transactions. Check every step with "
                         "the partner bank or licensed broker before signing. "
                         "The goal estimate refers to the full proposed plan. Changed amounts or approval of "
                         "only some steps can change the outcome.",
    }
