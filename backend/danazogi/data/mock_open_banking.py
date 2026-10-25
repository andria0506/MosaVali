"""Synthetic NBG Open Banking sandbox (NextGenPSD2-style payloads).

Banks, people, merchants and IBANs are fictional. Transactions are generated
from a fixed seed, so every demo run shows the same history. Each bank can be
made to time out, to demonstrate the ingestion fallback.
"""

from datetime import date, timedelta

import numpy as np

from .market import AS_OF, FX_SPOT
from .organiser_xlsx import load_organiser_customers, probe_tbc_sandbox

BANKS = {
    "MT": {"name": "Mtatsminda Bank", "name_ka": "მთაწმინდა ბანკი"},
    "RI": {"name": "Rioni Bank", "name_ka": "რიონი ბანკი"},
    "KB": {"name": "Kartli Bank", "name_ka": "ქართლი ბანკი"},
    "TBC": {"name": "TBC Bank (Mock Sandbox)", "name_ka": "თიბისი ბანკი (სატესტო სენდბოქსი)"},
}


class BankTimeout(Exception):
    """Raised by the sandbox when a bank's API does not answer in time."""


PERSONAS = {
    "nino": {
        "id": "nino",
        "name_ka": "ნინო ბერიძე", "name_en": "Nino Beridze",
        "birth_year": 1997, "gender": "f", "region": "tbilisi", "city_ka": "თბილისი", "city_en": "Tbilisi",
        "household": 1,
        "occupation_ka": "პროდუქტის დიზაინერი", "occupation_en": "Product designer",
        "summary_ka": "დანაზოგი ნაღდად და მიმდინარე ანგარიშზე, მიზანი — მანქანა 4 წელში.",
        "summary_en": "Savings in cash and current accounts, wants a car in 4 years.",
        "goal": {"kind": "car", "years": 4, "amount_usd": 9000, "usd_indexed": 1.0},
        "default_mission": "goal",
        "cash_at_home": 0.0,
        "banks": ["MT", "RI"],
        "accounts": [
            {"bank": "MT", "product": "current", "currency": "GEL", "balance": 4800.0},
            {"bank": "MT", "product": "savings", "currency": "GEL", "balance": 7500.0, "rate": 0.030},
            {"bank": "RI", "product": "current", "currency": "GEL", "balance": 1150.0},
        ],
        "income": [{"name": "Kavkasia Soft LLC", "text": "Salary", "amount": 3000, "day": 25}],
        "bonus": {"month": 12, "amount": 1500, "name": "Kavkasia Soft LLC", "text": "Annual bonus"},
        "recurring": [
            ("Landlord — Saburtalo", None, 850, 0, 1, "Rent payment", False),
            ("Tbilisi Energy", 4900, 55, 20, 8, "Electricity", False),
            ("City Gas", 4900, 45, 30, 9, "Gas", False),
            ("Kartli Telecom", 4814, 45, 0, 12, "Mobile and internet", False),
            ("StreamFlix", 5815, 43, 0, 15, "Subscription USD 15.99", True),
            ("Metro card top-up", 4111, 40, 10, 3, "Transport", False),
        ],
        "weekly": [
            ("Sakhli Market", 5411, 120, 30, "Groceries"),
            ("Gemo Delivery", 5814, 45, 12, "Food delivery"),
            ("TaxiGo", 4121, 28, 8, "Taxi ride"),
            ("Cafe Rustaveli", 5812, 35, 15, "Restaurant"),
        ],
        "occasional": [
            ("SkyGeorgia Airways", 4511, 0.12, 700, 200, "Flight ticket", True),
            ("TechImport", 5732, 0.08, 900, 300, "Electronics", True),
            ("Vita Pharmacy", 5912, 0.40, 35, 15, "Pharmacy", False),
            ("Moda Store", 5651, 0.45, 150, 60, "Clothing", False),
        ],
    },
    "lamara": {
        "id": "lamara",
        "name_ka": "ლამარა ჯაფარიძე", "name_en": "Lamara Japaridze",
        "birth_year": 1955, "gender": "f", "region": "imereti", "city_ka": "ქუთაისი", "city_en": "Kutaisi",
        "household": 1,
        "occupation_ka": "პენსიონერი", "occupation_en": "Pensioner",
        "summary_ka": "12 000 ლარი ნაღდად სახლში, პენსია და შვილის გზავნილი.",
        "summary_en": "12,000 GEL in cash at home, a pension and her son's remittances.",
        "goal": {"kind": "preserve", "years": 2, "amount_gel": 14000, "usd_indexed": 0.0},
        "default_mission": "growth",
        "cash_at_home": 12000.0,
        "banks": ["KB"],
        "accounts": [
            {"bank": "KB", "product": "current", "currency": "GEL", "balance": 2300.0},
        ],
        "income": [
            {"name": "Social Service Agency", "text": "Pension", "amount": 450, "day": 10},
            {"name": "Davit J. (Italy)", "text": "Remittance from abroad", "amount": 500, "day": 15},
        ],
        "bonus": None,
        "recurring": [
            ("Imereti Energy", 4900, 55, 15, 8, "Electricity", False),
            ("City Gas", 4900, 60, 45, 9, "Gas", False),
            ("Kutaisi Water", 4900, 12, 0, 11, "Water", False),
            ("Kartli Telecom", 4814, 20, 0, 12, "Mobile", False),
        ],
        "weekly": [
            ("Sakhli Market", 5411, 95, 20, "Groceries"),
            ("Vita Pharmacy", 5912, 38, 12, "Pharmacy"),
        ],
        "occasional": [
            ("Bus card top-up", 4111, 0.9, 15, 5, "Transport", False),
            ("Moda Store", 5651, 0.15, 60, 20, "Clothing", False),
        ],
    },
    "giorgi": {
        "id": "giorgi",
        "name_ka": "გიორგი ნაკაშიძე", "name_en": "Giorgi Nakashidze",
        "birth_year": 1968, "gender": "m", "region": "imereti", "city_ka": "ქუთაისი", "city_en": "Kutaisi",
        "household": 2,
        "occupation_ka": "კოლეჯის დირექტორი", "occupation_en": "College director",
        "summary_ka": "დოლარის დაბალშემოსავლიანი ანაბრები, პენსიამდე 7 წელი.",
        "summary_en": "Low-yield USD deposits, 7 years to retirement.",
        "goal": {"kind": "retirement", "years": 7, "amount_gel": 140000, "usd_indexed": 0.1},
        "default_mission": "balance",
        "cash_at_home": 0.0,
        "banks": ["KB", "MT"],
        "accounts": [
            {"bank": "KB", "product": "current", "currency": "GEL", "balance": 2100.0},
            {"bank": "KB", "product": "term_deposit", "currency": "USD", "balance": 9500.0, "rate": 0.024,
             "opened": "2025-12-05", "maturity": "2026-12-05"},
            {"bank": "KB", "product": "term_deposit", "currency": "GEL", "balance": 15000.0, "rate": 0.087,
             "opened": "2026-06-20", "maturity": "2027-06-20"},
            {"bank": "MT", "product": "savings", "currency": "USD", "balance": 2300.0, "rate": 0.005},
            {"bank": "MT", "product": "term_deposit", "currency": "GEL", "balance": 6000.0, "rate": 0.090,
             "opened": "2025-11-28", "maturity": "2026-11-28"},
        ],
        "income": [
            {"name": "Imereti Vocational College", "text": "Salary", "amount": 2600, "day": 20},
            {"name": "Tenant — Tsereteli St.", "text": "Apartment rent received", "amount": 600, "day": 5},
        ],
        "bonus": None,
        "recurring": [
            ("Imereti Energy", 4900, 80, 20, 8, "Electricity", False),
            ("City Gas", 4900, 90, 60, 9, "Gas", False),
            ("Kartli Telecom", 4814, 40, 0, 12, "Mobile and internet", False),
            ("Nana N.", None, 300, 0, 21, "Family support", False),
            ("Bus card top-up", 4111, 60, 10, 3, "Transport", False),
        ],
        "weekly": [("Sakhli Market", 5411, 140, 30, "Groceries")],
        "occasional": [
            ("Vita Pharmacy", 5912, 0.90, 110, 40, "Pharmacy", False),
            ("TechImport", 5732, 0.05, 900, 300, "Electronics", True),
            ("Moda Store", 5651, 0.30, 150, 60, "Clothing", False),
        ],
    },
    "tamar": {
        "id": "tamar",
        "name_ka": "თამარ ხალვაში", "name_en": "Tamar Khalvashi",
        "birth_year": 1985, "gender": "f", "region": "adjara", "city_ka": "ბათუმი", "city_en": "Batumi",
        "household": 4,
        "occupation_ka": "საოჯახო სასტუმროს მფლობელი", "occupation_en": "Guesthouse owner",
        "summary_ka": "სეზონური შემოსავალი, დოლარის იპოთეკა, გაფართოება 3 წელში.",
        "summary_en": "Seasonal income, USD mortgage, expansion in 3 years.",
        "goal": {"kind": "business", "years": 3, "amount_usd": 10000, "usd_indexed": 0.7},
        "default_mission": "growth",
        "cash_at_home": 0.0,
        "banks": ["RI", "MT"],
        "accounts": [
            {"bank": "RI", "product": "current", "currency": "GEL", "balance": 7800.0},
            {"bank": "RI", "product": "current", "currency": "USD", "balance": 3100.0},
            {"bank": "MT", "product": "savings", "currency": "GEL", "balance": 12500.0, "rate": 0.030},
            {"bank": "RI", "product": "loan", "currency": "USD", "balance": -38000.0, "rate": 0.075,
             "opened": "2019-05-01", "maturity": "2034-05-01", "instalment": 480.0},
        ],
        "seasonal_income": {"name": "Booking payouts", "text": "Guesthouse bookings",
                            "by_month": {10: 3500, 11: 1800, 12: 2200, 1: 1600, 2: 1500, 3: 2000,
                                         4: 3000, 5: 4800, 6: 8500, 7: 12500, 8: 13800, 9: 7600}},
        "usd_income": {"name": "Foreign guests", "text": "USD guest payments",
                       "by_month": {6: 900, 7: 1500, 8: 1400, 9: 600}},
        "income": [],
        "bonus": None,
        "recurring": [
            ("Adjara Energy", 4900, 220, 80, 8, "Electricity and water", False),
            ("Kartli Telecom", 4814, 70, 0, 12, "Mobile and internet", False),
            ("Fuel station", 5541, 160, 40, 6, "Fuel", False),
        ],
        "seasonal_payroll": {"name": "Staff payroll", "amount": 1200, "months": [4, 5, 6, 7, 8, 9, 10]},
        "weekly": [("Wholesale Market Batumi", 5411, 260, 60, "Guesthouse supplies")],
        "occasional": [
            ("TechImport", 5732, 0.20, 1800, 600, "Equipment", True),
            ("Build Center", 5211, 0.25, 1400, 500, "Building materials", True),
            ("SkyGeorgia Airways", 4511, 0.05, 800, 200, "Flight ticket", True),
        ],
    },
}


def _iban(bank: str, n: int, persona_seed: int) -> str:
    digits = f"{persona_seed:04d}{n:04d}{(persona_seed * 7919 + n * 104729) % 10**8:08d}"
    check = 10 + (persona_seed * 31 + n * 17) % 89
    return f"GE{check}{bank}{digits}"


def _months() -> list[date]:
    y, m = AS_OF.year, AS_OF.month
    out = []
    for _ in range(12):
        m -= 1
        if m == 0:
            y, m = y - 1, 12
        out.append(date(y, m, 1))
    return sorted(out)


def _tx(tid: str, d: date, amount: float, currency: str, name: str, text: str,
        mcc: int | None = None, code: str = "PMNT", fx_source: str | None = None) -> dict:
    tx = {
        "transactionId": tid,
        "bookingDate": d.isoformat(),
        "transactionAmount": {"amount": f"{amount:.2f}", "currency": currency},
        "creditorName" if amount < 0 else "debtorName": name,
        "remittanceInformationUnstructured": text,
        "bankTransactionCode": code,
    }
    if mcc:
        tx["merchantCategoryCode"] = str(mcc)
    if fx_source:
        tx["currencyExchange"] = {"sourceCurrency": fx_source, "targetCurrency": currency}
    return tx


def _full_payload(persona_id: str) -> dict:
    p = PERSONAS[persona_id]
    if "accounts_payload" in p:
        return {
            "standard": "TBC Open Banking Mock / Organiser 100-Customer Ledger",
            "psu": p["psu"],
            "accounts": p["accounts_payload"],
            "retrievedAt": AS_OF.isoformat(),
        }
    seed = sum(ord(c) for c in persona_id)
    rng = np.random.default_rng(seed)
    accounts = []
    for n, acc in enumerate(p["accounts"]):
        accounts.append({
            "resourceId": f"{persona_id}-{acc['bank'].lower()}-{n}",
            "iban": _iban(acc["bank"], n, seed),
            "bank": acc["bank"],
            "bankName": BANKS[acc["bank"]]["name"],
            "bankNameKa": BANKS[acc["bank"]]["name_ka"],
            "currency": acc["currency"],
            "product": acc["product"],
            "balances": [{"balanceType": "interimAvailable",
                          "balanceAmount": {"currency": acc["currency"], "amount": f"{acc['balance']:.2f}"}}],
            **{k: acc[k] for k in ("rate", "opened", "maturity", "instalment") if k in acc},
        })

    main_gel = next(a for a in accounts if a["product"] == "current" and a["currency"] == "GEL")
    usd_acc = next((a for a in accounts if a["product"] == "current" and a["currency"] == "USD"), None)
    loan = next((a for a in accounts if a["product"] == "loan"), None)
    book: dict[str, list] = {a["resourceId"]: [] for a in accounts}
    counter = 0

    def add(acc, d, amount, currency, name, text, mcc=None, code="PMNT", fx_source=None):
        nonlocal counter
        counter += 1
        book[acc["resourceId"]].append(_tx(f"T{counter:05d}", d, amount, currency, name, text, mcc, code, fx_source))

    for month in _months():
        def day(dd: int) -> date:
            return month + timedelta(days=min(dd, 28) - 1)

        for inc in p["income"]:
            add(main_gel, day(inc["day"]), inc["amount"], "GEL", inc["name"], inc["text"], code="RCDT")
        if p.get("bonus") and month.month == p["bonus"]["month"]:
            b = p["bonus"]
            add(main_gel, day(26), b["amount"], "GEL", b["name"], b["text"], code="RCDT")
        if "seasonal_income" in p:
            s = p["seasonal_income"]
            base = s["by_month"][month.month]
            for k, share in enumerate((0.4, 0.35, 0.25)):
                add(main_gel, day(7 + k * 9), round(base * share * rng.uniform(0.9, 1.1), 2), "GEL",
                    s["name"], s["text"], code="RCDT")
        if "usd_income" in p and usd_acc and month.month in p["usd_income"]["by_month"]:
            u = p["usd_income"]
            add(usd_acc, day(15), u["by_month"][month.month], "USD", u["name"], u["text"], code="RCDT")
        if "seasonal_payroll" in p and month.month in p["seasonal_payroll"]["months"]:
            sp = p["seasonal_payroll"]
            add(main_gel, day(28), -sp["amount"], "GEL", sp["name"], "Staff salaries", code="PMNT-STDO")

        for name, mcc, mean, sd, dd, text, usd_priced in p["recurring"]:
            winter = 1.6 if text == "Gas" and month.month in (11, 12, 1, 2, 3) else 0.5 if text == "Gas" else 1.0
            amt = max(5.0, (mean + rng.normal(0, sd)) * winter)
            code = "PMNT-STDO" if mcc is None else "PMNT-CCRD"
            add(main_gel, day(dd), -round(amt, 2), "GEL", name, text, mcc, code, "USD" if usd_priced else None)

        for name, mcc, mean, sd, text in p["weekly"]:
            for w in range(4):
                add(main_gel, day(2 + w * 7), -round(max(5, mean + rng.normal(0, sd)), 2), "GEL",
                    name, text, mcc, "PMNT-CCRD")

        for name, mcc, prob, mean, sd, text, usd_priced in p["occasional"]:
            if rng.random() < prob:
                add(main_gel, day(int(rng.integers(1, 28))), -round(max(5, mean + rng.normal(0, sd)), 2),
                    "GEL", name, text, mcc, "PMNT-CCRD", "USD" if usd_priced else None)

        if loan:
            src = usd_acc or main_gel
            amt = loan["instalment"] if src["currency"] == "USD" else loan["instalment"] * FX_SPOT
            add(src, day(10), -amt, src["currency"], loan["bankName"], "Mortgage instalment (USD loan)",
                code="LDAS")

    for acc in accounts:
        acc["transactions"] = {"booked": sorted(book[acc["resourceId"]], key=lambda t: t["bookingDate"])}
    return {
        "standard": "NextGenPSD2-style synthetic sandbox payload",
        "psu": {"name_ka": p["name_ka"], "name_en": p["name_en"], "birthYear": p["birth_year"],
                "region": p["region"], "city_ka": p["city_ka"], "city_en": p["city_en"]},
        "accounts": accounts,
        "retrievedAt": AS_OF.isoformat(),
    }


def fetch_bank(persona_id: str, bank: str, timeout_bank: str | None = None) -> list[dict]:
    """One bank's accounts (with transactions), as its API would return them."""
    if bank == timeout_bank:
        raise BankTimeout(f"{BANKS[bank]['name']} did not respond within 5 s")
    return [a for a in _full_payload(persona_id)["accounts"] if a["bank"] == bank]


def psu(persona_id: str) -> dict:
    return _full_payload(persona_id)["psu"]


def _card(p: dict) -> dict:
    return {
        "id": p["id"], "name_ka": p["name_ka"], "name_en": p["name_en"],
        "age": AS_OF.year - p["birth_year"], "city_ka": p["city_ka"], "city_en": p["city_en"],
        "occupation_ka": p["occupation_ka"], "occupation_en": p["occupation_en"],
        "summary_ka": p["summary_ka"], "summary_en": p["summary_en"],
        "banks": [{"code": b, **BANKS[b]} for b in p["banks"]],
        "goal": p["goal"], "default_mission": p["default_mission"], "cash_at_home": p["cash_at_home"],
        "source": p.get("source", "demo"),
    }


def persona_cards() -> list[dict]:
    return [_card(p) for p in PERSONAS.values() if p.get("source") not in ("organiser_xlsx", "custom")]


def organiser_cards() -> list[dict]:
    return [_card(p) for p in PERSONAS.values() if p.get("source") == "organiser_xlsx"]


PERSONAS.update(load_organiser_customers())
