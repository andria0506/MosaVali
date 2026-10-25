"""Profiler agent: goal, currency of liabilities, risk capacity and situation alerts."""

import numpy as np

from ..data.market import FX_SPOT

GOALS = {
    "car": {"ka": "მანქანის შეძენა", "en": "buying a car"},
    "apartment": {"ka": "ბინის პირველადი შენატანი", "en": "a down payment on an apartment"},
    "education": {"ka": "განათლების დაფინანსება", "en": "paying for education"},
    "preserve": {"ka": "დანაზოგის ინფლაციისგან დაცვა", "en": "protecting your savings from inflation"},
    "retirement": {"ka": "პენსიისთვის სტაბილური შემოსავლის შექმნა", "en": "building a steady retirement income"},
    "business": {"ka": "ბიზნესის გაფართოება", "en": "expanding the business"},
}
GOAL_KINDS = tuple(GOALS)


def custom_goal(kind: str, amount: float, currency: str, years: int) -> dict:
    """A goal the customer typed in. Dollar-priced goals follow the exchange rate."""
    if kind not in GOALS:
        raise ValueError(f"Unknown goal kind {kind}")
    if currency not in ("GEL", "USD"):
        raise ValueError("Currency must be GEL or USD")
    if not 1 <= int(years) <= 15:
        raise ValueError("The horizon must be between 1 and 15 years")
    if not 0 < float(amount) <= 10_000_000:
        raise ValueError("The amount must be positive")
    key = "amount_usd" if currency == "USD" else "amount_gel"
    return {"kind": kind, "years": int(years), key: round(float(amount), 2),
            "usd_indexed": 1.0 if currency == "USD" else 0.0, "source": "customer"}
CAPACITY_WEIGHTS = {"horizon": 0.30, "buffer": 0.20, "stability": 0.25, "age": 0.15, "obligations": 0.10}


def _pct(x: float) -> str:
    return f"{round(x * 100):.0f}%"


def profile(ing: dict, liq: dict, goal: dict) -> dict:
    m, f, psu = ing["metrics"], ing["features"], ing["psu"]
    age, horizon = psu["age"], goal["years"]
    usd_liability = float(np.clip(0.75 * goal["usd_indexed"] + 0.25 * m["usd_spend_share"], 0, 1))
    target_today = goal["amount_usd"] * FX_SPOT if "amount_usd" in goal else goal["amount_gel"]

    parts = {
        "horizon": min(horizon, 10) / 10,
        "buffer": min(f["liquid_months"] / max(liq["buffer_months"], 1.0), 1.0),
        "stability": 1 - min(f["income_cv"] / 0.6, 1.0),
        "age": 1 - float(np.clip((age - 30) / 40, 0, 1)),
        "obligations": 1 - min(f["obligation_ratio"] / 0.6, 1.0),
    }
    score = float(np.clip(sum(CAPACITY_WEIGHTS[k] * v for k, v in parts.items()), 0.05, 1.0))
    level = int(np.clip(round(1 + 9 * score), 1, 10))

    alerts = []
    for acc in ing["accounts"]:
        d = acc["days_to_maturity"]
        if acc["product"] == "term_deposit" and d is not None and d <= 60:
            alerts.append({
                "kind": "maturity", "tone": "warn", "account": acc["id"], "days": d,
                "ka": f"{acc['bank_name_ka']}: {acc['balance']:,.0f} {acc['currency']} ანაბარს ვადა {d} დღეში "
                      f"გასდის. გადაწყვიტეთ, სად წავა თანხა, სანამ ავტომატურად განახლდება.",
                "en": f"{acc['bank_name']}: {acc['balance']:,.0f} {acc['currency']} deposit matures in {d} days. "
                      f"Decide where it goes before it auto-renews.",
            })
    if m["idle_cash_gel"] > 500:
        alerts.append({
            "kind": "idle", "tone": "info", "amount": m["idle_cash_gel"],
            "ka": f"{m['idle_cash_gel']:,.0f} ლარი ნაღდად ან მიმდინარე ანგარიშზე უმოქმედოდ დევს.",
            "en": f"{m['idle_cash_gel']:,.0f} GEL sits idle in cash or current accounts.",
        })
    if f["liquid_months"] < liq["buffer_months"]:
        basis_ka, basis_en = {
            "cash_need_model": (
                f"ფულის საჭიროების მოდელის ფრთხილი შეფასებით საჭიროა {liq['buffer_months']:.1f} თვე.",
                f"The cash-need model's cautious estimate asks for {liq['buffer_months']:.1f}."),
            "minimum_rule": (
                "მინიმალური რეზერვის წესი 3 თვეს მოითხოვს; მოდელის შეფასება ამაზე ნაკლებია.",
                "The minimum-reserve rule asks for 3 months; the model's estimate is lower."),
            "fallback_minimum": (
                "არასრული ან არარეგულარული ისტორია: საჭიროა სულ მცირე 6 თვე.",
                "Incomplete or irregular history: at least 6 months are required."),
            "all_assets": (
                "აუცილებელი ხარჯები ვერ განისაზღვრა, ამიტომ მთელი დანაზოგი დაცული რჩება.",
                "Essential spending could not be measured, so all savings stay protected."),
        }[liq["reserve_basis"]]
        alerts.append({
            "kind": "buffer", "tone": "critical",
            "ka": f"ხელმისაწვდომი თანხა ფარავს {f['liquid_months']:.1f} თვის აუცილებელ ხარჯს. {basis_ka}",
            "en": f"Liquid cash covers {f['liquid_months']:.1f} months of essential costs. {basis_en}",
        })
    if f["fx_debt_ratio"] > 0.15:
        alerts.append({
            "kind": "fx_debt", "tone": "warn",
            "ka": f"შემოსავლის {_pct(f['fx_debt_ratio'])} დოლარის სესხის მომსახურებას ხმარდება.",
            "en": f"{_pct(f['fx_debt_ratio'])} of income services a USD loan.",
        })

    return {
        "goal": {**goal, **GOALS[goal["kind"]], "target_today_gel": target_today},
        "horizon": horizon,
        "usd_liability_share": usd_liability,
        "capacity": {"score": score, "level": level, "parts": parts, "weights": CAPACITY_WEIGHTS,
                     "equity_cap": round(0.05 + 0.35 * score, 3)},
        "alerts": alerts,
    }
