"""Ingestion agent: consented open-banking accounts -> financial profile.

Zero manual input except an optional declared amount of cash at home, which
open banking cannot see. Everything else comes from balances and the booked
transaction history: income sources and stability, savings velocity, idle
cash, recurring obligations, the essential vs discretionary split and the GEL
vs USD-sensitive split of spending.
"""

from collections import defaultdict
from datetime import date

import numpy as np

from ..data.market import AS_OF, FX_SPOT
from ..ml.cohort import FEATURE_HIGH, FEATURE_KEYS, FEATURE_LOW

CATEGORIES = {  # label_ka, label_en, currency sensitivity, essential
    "housing": ("ქირა", "Rent", "GEL", True),
    "groceries": ("სურსათი", "Groceries", "GEL", True),
    "utilities": ("კომუნალური", "Utilities", "GEL", True),
    "telecom": ("კავშირგაბმულობა", "Telecom", "GEL", True),
    "transport": ("ტრანსპორტი", "Transport", "GEL", True),
    "fuel": ("საწვავი", "Fuel", "GEL", True),
    "health": ("ჯანმრთელობა", "Health", "GEL", True),
    "family": ("ოჯახის დახმარება", "Family support", "GEL", True),
    "payroll": ("თანამშრომლების ხელფასი", "Staff payroll", "GEL", True),
    "debt_usd": ("დოლარის სესხი", "USD loan", "USD", True),
    "delivery": ("საკვების მიტანა", "Food delivery", "GEL", False),
    "dining": ("კვება გარეთ", "Dining out", "GEL", False),
    "taxi": ("ტაქსი", "Taxi", "GEL", False),
    "clothing": ("ტანსაცმელი", "Clothing", "GEL", False),
    "travel": ("მოგზაურობა", "Travel", "USD", False),
    "electronics": ("ელექტრონიკა და აღჭურვილობა", "Electronics & equipment", "USD", False),
    "subscriptions": ("ციფრული გამოწერები", "Digital subscriptions", "USD", False),
    "building": ("სამშენებლო მასალები", "Building materials", "USD", False),
    "other": ("სხვა", "Other", "GEL", False),
}

MCC = {
    5411: "groceries", 5812: "dining", 5814: "delivery", 4121: "taxi", 4900: "utilities", 4814: "telecom",
    4111: "transport", 5541: "fuel", 5912: "health", 5651: "clothing", 4511: "travel", 7011: "travel",
    5732: "electronics", 5815: "subscriptions", 5211: "building",
}
KEYWORDS = [("delivery", "delivery"), ("taxi", "taxi"), ("rent", "housing"), ("salar", "payroll"),
            ("payroll", "payroll"), ("family", "family"), ("mortgage", "debt_usd"), ("loan", "debt_usd")]
INCOME_KEYWORDS = [("pension", "pension"), ("salary", "salary"), ("bonus", "salary"), ("remittance", "remittance"),
                   ("booking", "business"), ("guest", "business"), ("rent received", "rent_income")]
PEER_MAP = {"fuel": "transport"}  # ingestion category -> peer-model category

PRODUCT_TO_ASSET = {
    ("current", "GEL"): "CASH", ("savings", "GEL"): "LIQ", ("term_deposit", "GEL"): "GEL_DEP",
    ("current", "USD"): "USD_CASH", ("savings", "USD"): "USD_CASH", ("term_deposit", "USD"): "USD_DEP",
    ("current", "EUR"): "USD_CASH", ("savings", "EUR"): "USD_CASH", ("term_deposit", "EUR"): "USD_DEP",
}


def classify(tx: dict) -> tuple[str, str]:
    """Return (category, currency sensitivity) for a debit."""
    text = (tx.get("remittanceInformationUnstructured", "") + " " + tx.get("creditorName", "")).lower()
    cat = MCC.get(int(tx["merchantCategoryCode"])) if "merchantCategoryCode" in tx else None
    if cat is None:
        cat = next((c for k, c in KEYWORDS if k in text), "other")
    sensitivity = CATEGORIES[cat][2]
    if tx["transactionAmount"]["currency"] in ("USD", "EUR") or tx.get("currencyExchange", {}).get("sourceCurrency") in ("USD", "EUR"):
        sensitivity = "USD"
    return cat, sensitivity


def income_source(tx: dict) -> str:
    text = (tx.get("remittanceInformationUnstructured", "") + " " + tx.get("debtorName", "")).lower()
    return next((s for k, s in INCOME_KEYWORDS if k in text), "other")


def _clip(features: dict) -> dict:
    return {k: float(np.clip(features[k], lo, hi)) for k, lo, hi in zip(FEATURE_KEYS, FEATURE_LOW, FEATURE_HIGH)}


def _gel(amount: float, currency: str) -> float:
    return amount * FX_SPOT if currency == "USD" else amount * 2.95 if currency == "EUR" else amount


def _mask(iban: str) -> str:
    return f"{iban[:4]} •••• {iban[-4:]}"


def ingest(accounts: list[dict], psu: dict, cash_at_home: float = 0.0, household: int = 1) -> dict:
    accounts_out, holdings = [], defaultdict(float)
    assets_gel = liabilities_gel = liquid_gel = current_gel = 0.0
    monthly = defaultdict(lambda: {"income": 0.0, "spend_gel": 0.0, "spend_usd": 0.0, "essential": 0.0})
    cat_totals = defaultdict(float)
    counterparties = defaultdict(lambda: {"months": set(), "total": 0.0, "category": "other", "sens": "GEL"})
    sources = defaultdict(lambda: {"total": 0.0, "count": 0, "days": []})
    tx_count = 0
    essential_usd = 0.0

    for acc in accounts:
        bal = float(acc["balances"][0]["balanceAmount"]["amount"])
        bal_gel = _gel(bal, acc["currency"])
        maturity = acc.get("maturity")
        asset = PRODUCT_TO_ASSET.get((acc["product"], acc["currency"]))
        accounts_out.append({
            "id": acc["resourceId"], "bank": acc["bank"], "bank_name": acc["bankName"],
            "bank_name_ka": acc["bankNameKa"], "iban": _mask(acc["iban"]), "product": acc["product"],
            "currency": acc["currency"], "balance": bal, "balance_gel": round(bal_gel, 2),
            "rate": acc.get("rate"), "opened": acc.get("opened"), "maturity": maturity,
            "days_to_maturity": (date.fromisoformat(maturity) - AS_OF).days if maturity else None,
            "instalment": acc.get("instalment"), "asset": asset,
        })
        if acc["product"] == "loan":
            liabilities_gel += -bal_gel
        else:
            assets_gel += bal_gel
            holdings[asset] += bal_gel
            if acc["product"] in ("current", "savings"):
                liquid_gel += bal_gel
            if acc["product"] == "current" and acc["currency"] == "GEL":
                current_gel += bal_gel

        for tx in acc.get("transactions", {}).get("booked", []):
            tx_count += 1
            amt = float(tx["transactionAmount"]["amount"])
            amt_gel = _gel(amt, tx["transactionAmount"]["currency"])
            month = tx["bookingDate"][:7]
            if amt > 0:
                monthly[month]["income"] += amt_gel
                s = sources[income_source(tx)]
                s["total"] += amt_gel
                s["count"] += 1
                s["days"].append(int(tx["bookingDate"][8:10]))
                continue
            cat, sens = classify(tx)
            spend = -amt_gel
            monthly[month]["spend_usd" if sens == "USD" else "spend_gel"] += spend
            cat_totals[cat] += spend
            if CATEGORIES[cat][3]:
                monthly[month]["essential"] += spend
            if CATEGORIES[cat][3] and sens == "USD":
                essential_usd += spend
            cp = counterparties[tx.get("creditorName", "?")]
            cp["months"].add(month)
            cp["total"] += spend
            cp["category"], cp["sens"] = cat, sens

    if cash_at_home > 0:
        assets_gel += cash_at_home
        holdings["CASH"] += cash_at_home

    months = sorted(monthly)
    n = max(len(months), 1)
    income = np.array([monthly[m]["income"] for m in months]) if months else np.zeros(1)
    spend_gel = np.array([monthly[m]["spend_gel"] for m in months]) if months else np.zeros(1)
    spend_usd = np.array([monthly[m]["spend_usd"] for m in months]) if months else np.zeros(1)
    spend = spend_gel + spend_usd
    net = income - spend
    income_mean = float(income.mean())

    essential = sum(v for k, v in cat_totals.items() if CATEGORIES[k][3]) / n
    discretionary = sum(v for k, v in cat_totals.items() if not CATEGORIES[k][3]) / n
    recurring = sorted(
        ({"name": name, "category": cp["category"], "monthly": round(cp["total"] / n, 2),
          "sensitivity": cp["sens"], "label_ka": CATEGORIES[cp["category"]][0],
          "label_en": CATEGORIES[cp["category"]][1]}
         for name, cp in counterparties.items() if len(cp["months"]) >= max(n - 2, 1)),
        key=lambda r: -r["monthly"])
    obligations = sum(cat_totals.get(c, 0.0) for c in ("housing", "utilities", "telecom", "debt_usd")) / n

    main_source = max(sources.items(), key=lambda kv: kv[1]["total"])[0] if sources else "other"
    if "pension" in sources:
        main_source = "pension"
    income_cv = float(income.std() / income_mean) if income_mean else 1.0
    income_type = {"salary": "salaried", "pension": "pensioner", "remittance": "remittance",
                   "business": "seasonal" if income_cv > 0.4 else "self_employed",
                   "rent_income": "self_employed"}.get(main_source, "salaried")
    pay_days = sources[main_source]["days"] if main_source in sources else []
    pay_day = max(set(pay_days), key=pay_days.count) if pay_days else 1
    liquid_months = (liquid_gel + cash_at_home) / essential if essential else 0.0
    # Transfers between the customer's own accounts are not visible, so a negative-balance month is
    # approximated as a deficit month when there was less than one month of essential costs in cash.
    overdraft = float((net < 0).mean()) if liquid_months < 1 else 0.0

    categories = sorted(
        ({"key": k, "label_ka": CATEGORIES[k][0], "label_en": CATEGORIES[k][1], "sensitivity": CATEGORIES[k][2],
          "essential": CATEGORIES[k][3], "monthly": round(v / n, 2)} for k, v in cat_totals.items()),
        key=lambda c: -c["monthly"])
    peer_spend = defaultdict(float)
    for k, v in cat_totals.items():
        peer_spend[PEER_MAP.get(k, k)] += v / n

    usd_assets = holdings.get("USD_DEP", 0.0) + holdings.get("USD_CASH", 0.0)
    first9, last3 = income[:-3], income[-3:]
    age = AS_OF.year - psu["birthYear"]
    return {
        "psu": {**psu, "age": age, "household": household},
        "accounts": accounts_out,
        "cash_at_home": cash_at_home,
        "transaction_count": tx_count,
        "months_of_history": len(months),
        "holdings_gel": {k: round(v, 2) for k, v in holdings.items()},
        "current_weights": {k: v / assets_gel for k, v in holdings.items()} if assets_gel else {},
        "totals": {
            "assets_gel": round(assets_gel, 2),
            "liabilities_gel": round(liabilities_gel, 2),
            "net_worth_gel": round(assets_gel - liabilities_gel, 2),
            "usd_share": usd_assets / assets_gel if assets_gel else 0.0,
            "cash_share": holdings.get("CASH", 0.0) / assets_gel if assets_gel else 0.0,
            "liquid_gel": round(liquid_gel + cash_at_home, 2),
        },
        "cashflow": {
            "months": months,
            "income": income.round(2).tolist(),
            "spend_gel": spend_gel.round(2).tolist(),
            "spend_usd": spend_usd.round(2).tolist(),
            "essential": [round(monthly[m]["essential"], 2) for m in months] if months else [0.0],
            "net": net.round(2).tolist(),
        },
        "income_sources": {k: {"monthly": round(v["total"] / n, 2), "count": v["count"]} for k, v in sources.items()},
        "income_type": income_type,
        "pay_day": pay_day,
        "metrics": {
            "monthly_income": round(income_mean, 2),
            "monthly_spend": round(float(spend.mean()), 2),
            "essential_spend": round(essential, 2),
            "essential_usd_share": essential_usd / n / essential if essential else 0.0,
            "savings_velocity": round(float(net.mean()), 2),
            "usd_spend_share": float(spend_usd.sum() / spend.sum()) if spend.sum() else 0.0,
            "idle_cash_gel": round(max(0.0, current_gel + cash_at_home - 1.5 * float(spend.mean())), 2),
        },
        "features": _clip({  # Model 1 inputs, same definitions and ranges as the training cohort
            "income_cv": income_cv,
            "income_trend": float((last3.mean() - first9.mean()) / income_mean) if income_mean and len(income) > 3 else 0.0,
            "liquid_months": liquid_months,
            "obligation_ratio": obligations / income_mean if income_mean else 1.0,
            "fx_debt_ratio": cat_totals.get("debt_usd", 0.0) / n / income_mean if income_mean else 0.0,
            "discretionary_share": discretionary / (essential + discretionary) if essential + discretionary else 0.0,
            "savings_rate": float(net.sum() / income.sum()) if income.sum() else 0.0,
            "overdraft_months": overdraft,
            "income_sources": float(len([s for s in sources.values() if s["count"] >= 3])),
        }),
        "categories": categories,
        "peer_spend": dict(peer_spend),
        "recurring": recurring,
    }
