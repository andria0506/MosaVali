"""Loader and NextGenPSD2 adapter for the organiser's `open_banking_synthetic_100_customers.xlsx`
plus live probe for the TBC Open Banking Mock Sandbox (`tbc-bank-mock-open-banking-api.vercel.app`).

Uses only Python's standard library (`zipfile` + `xml.etree.ElementTree` + `urllib.request`)
so no extra packages are required beyond the pinned `requirements.txt`.
"""

from __future__ import annotations

import json
import re
import time
import urllib.error
import urllib.request
import xml.etree.ElementTree as ET
import zipfile
from collections import defaultdict
from datetime import date, timedelta
from functools import lru_cache
from pathlib import Path

from .market import AS_OF

NS = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
REL_NS = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}"

DEFAULT_XLSX = Path(__file__).resolve().parents[3] / "open_banking_synthetic_100_customers.xlsx"
TBC_MOCK_BASE = "https://tbc-bank-mock-open-banking-api.vercel.app"
TBC_STATUS_BASE = "https://tbc-bank-status.vercel.app"

CITY_MAP = {
    "Tbilisi": ("tbilisi", "თბილისი", "Tbilisi"),
    "Batumi": ("adjara", "ბათუმი", "Batumi"),
    "Kutaisi": ("imereti", "ქუთაისი", "Kutaisi"),
    "Zugdidi": ("other", "ზუგდიდი", "Zugdidi"),
    "Gori": ("other", "გორი", "Gori"),
    "Rustavi": ("other", "რუსთავი", "Rustavi"),
}

PROFILE_LABELS = {
    "salaried": ("ხელფასიანი დასაქმებული", "Salaried employee"),
    "professional": ("პროფესიონალი", "Professional"),
    "freelancer": ("ფრილანსერი", "Freelancer"),
    "retired": ("პენსიონერი", "Retiree"),
    "student": ("სტუდენტი", "Student"),
    "self_employed": ("თვითდასაქმებული", "Self-employed"),
    "seasonal_worker": ("სეზონური დასაქმებული", "Seasonal worker"),
}

FIRST_KA = {
    "Nino": "ნინო", "Giorgi": "გიორგი", "Mariam": "მარიამ", "Levan": "ლევან", "Ana": "ანა",
    "Luka": "ლუკა", "Tamar": "თამარ", "Davit": "დავით", "Salome": "სალომე", "Irakli": "ირაკლი",
    "Elene": "ელენე", "Saba": "საბა", "Natia": "ნათია", "Beka": "ბექა", "Keti": "ქეთი",
    "Nikoloz": "ნიკოლოზ", "Sopho": "სოფო", "Giga": "გიგა", "Maka": "მაკა", "Lasha": "ლაშა",
    "Eka": "ეკა", "Zura": "ზურა", "Tako": "თაკო", "Oto": "ოთო", "Nana": "ნანა",
}
LAST_KA = {
    "Beridze": "ბერიძე", "Japaridze": "ჯაფარიძე", "Lobzhanidze": "ლობჟანიძე", "Kapanadze": "კაპანაძე",
    "Chikovani": "ჩიქოვანი", "Kobakhidze": "კობახიძე", "Gelashvili": "გელაშვილი", "Abashidze": "აბაშიძე",
    "Tsereteli": "წერეთელი", "Maisuradze": "მაისურაძე", "Khutsishvili": "ხუციშვილი", "Bregvadze": "ბრეგვაძე",
    "Lomidze": "ლომიძე", "Gogoladze": "გოგოლაძე", "Mchedlishvili": "მჭედლიშვილი", "Kharadze": "ხარაძე",
    "Tsiklauri": "წიკლაური", "Kvaratskhelia": "კვარაცხელია", "Nozadze": "ნოზაძე", "Shengelia": "შენგელია",
}

INTERNAL_TX_CATEGORIES = {
    "own_transfer", "fx_conversion", "deposit_funding", "deposit_maturity",
    "interest_payout", "cash_withdrawal", "cash_deposit", "refund",
}


def _col_idx(ref: str) -> int:
    n = 0
    for ch in re.match(r"([A-Z]+)", ref).group(1):
        n = n * 26 + (ord(ch) - 64)
    return n - 1


def _name_ka(full_name: str) -> str:
    parts = full_name.strip().split()
    if len(parts) == 2:
        return f"{FIRST_KA.get(parts[0], parts[0])} {LAST_KA.get(parts[1], parts[1])}"
    return full_name


def read_xlsx_tables(path: str | Path = DEFAULT_XLSX) -> dict[str, list[dict]]:
    p = Path(path)
    if not p.exists():
        return {}
    with zipfile.ZipFile(p) as z:
        shared: list[str] = []
        if "xl/sharedStrings.xml" in z.namelist():
            root = ET.fromstring(z.read("xl/sharedStrings.xml"))
            for si in root.findall(f"{NS}si"):
                shared.append("".join(t.text or "" for t in si.iter(f"{NS}t")))
        wb = ET.fromstring(z.read("xl/workbook.xml"))
        rels = ET.fromstring(z.read("xl/_rels/workbook.xml.rels"))
        rid_to_target = {r.attrib["Id"]: r.attrib["Target"].lstrip("/") for r in rels}
        tables: dict[str, list[dict]] = {}
        for sh in wb.iter(f"{NS}sheet"):
            name = sh.attrib["name"]
            if name not in ("Customers", "Accounts", "Deposits", "Transactions"):
                continue
            target = rid_to_target[sh.attrib[f"{REL_NS}id"]]
            if not target.startswith("xl/"):
                target = "xl/" + target
            sroot = ET.fromstring(z.read(target))
            rows: list[list] = []
            for row in sroot.iter(f"{NS}row"):
                cells = {}
                for c in row.findall(f"{NS}c"):
                    idx = _col_idx(c.attrib["r"])
                    t = c.attrib.get("t")
                    v = c.find(f"{NS}v")
                    if v is None or v.text is None:
                        is_elem = c.find(f"{NS}is")
                        val = "".join(x.text or "" for x in is_elem.iter(f"{NS}t")) if is_elem is not None else None
                    elif t == "s":
                        val = shared[int(v.text)]
                    elif t == "d":
                        val = v.text[:10]
                    elif t in ("str", "inlineStr"):
                        val = v.text
                    else:
                        try:
                            val = float(v.text) if "." in v.text else int(v.text)
                        except ValueError:
                            val = v.text
                    cells[idx] = val
                if cells:
                    rows.append([cells.get(i) for i in range(max(cells) + 1)])
            if rows:
                headers = [str(h) for h in rows[0]]
                tables[name] = [
                    {headers[i]: (r[i] if i < len(r) else None) for i in range(len(headers))}
                    for r in rows[1:]
                ]
        return tables


def _map_tx(tx: dict) -> dict | None:
    cat = tx["category"]
    if cat in INTERNAL_TX_CATEGORIES:
        return None
    amt = float(tx["amount"])
    curr = str(tx["currency"])
    cp = str(tx.get("counterparty") or "Merchant")
    desc = str(tx.get("description") or cat)
    raw_date = str(tx["booking_date"])[:10]
    # Align the [2026-04-20, 2026-10-19] 6-billing-cycle window into 6 full calendar months (2026-05..2026-10)
    shifted = (date.fromisoformat(raw_date) + timedelta(days=11)).isoformat()

    mcc = None
    fx_source = None
    if amt > 0:
        if cat == "salary":
            desc = f"Salary · {desc}"
        elif cat == "pension":
            desc = f"Pension · {desc}"
        elif cat in ("business_income", "freelance_income", "seasonal_income"):
            desc = f"Booking business income · {desc}"
        elif cat == "interest":
            desc = f"Deposit interest · {desc}"
    else:
        if cat == "groceries":
            mcc = 5411
        elif cat == "dining":
            mcc = 5814 if "wolt" in cp.lower() else 5812
        elif cat == "transport":
            mcc = 4121 if any(k in cp.lower() for k in ("bolt", "yandex")) else 4111
        elif cat == "fuel":
            mcc = 5541
        elif cat == "utilities":
            mcc = 4900
        elif cat == "telecom":
            mcc = 4814
        elif cat == "health":
            mcc = 5912
        elif cat == "subscription":
            mcc = 5815
            fx_source = "USD"
        elif cat == "shopping":
            if "clothing" in cp.lower():
                mcc = 5651
            else:
                mcc = 5732
                fx_source = "USD"
        elif cat == "online_shopping":
            mcc = 5732
            fx_source = "USD"
        elif cat == "rent":
            desc = f"Rent · {desc}"
        elif cat == "family_support":
            desc = f"Family support · {desc}"

    out = {
        "transactionId": str(tx["transaction_id"]),
        "bookingDate": shifted,
        "valueDate": raw_date,
        "transactionAmount": {"amount": f"{amt:.2f}", "currency": curr},
        "creditorName" if amt < 0 else "debtorName": cp,
        "remittanceInformationUnstructured": desc,
        "bankTransactionCode": "RCDT" if amt > 0 else "PMNT-CCRD",
    }
    if mcc is not None:
        out["merchantCategoryCode"] = str(mcc)
    if fx_source:
        out["currencyExchange"] = {"sourceCurrency": fx_source, "targetCurrency": curr}
    return out


GOAL_REAL_GROWTH = 0.045  # assumed real growth of a deposit-heavy plan, used only to size an assumed goal
GOAL_STRETCH = 0.95  # tuned so the typical organiser customer sees a mid-range chance, not 0% or 100%;
# measured 2026-10-24: median recommended-mission chance 49%, IQR 12-75%, 5/100 at 0%, 9/100 at >=95%


def _sized_target(savings_gel: float, monthly_net: float, years: int) -> float:
    """What this customer could plausibly reach: most of today's savings plus half of the observed monthly surplus."""
    g = GOAL_REAL_GROWTH
    free = 0.75 * max(savings_gel, 0.0)
    monthly = 0.5 * max(monthly_net, 0.0)
    future = free * (1 + g) ** years + 12 * monthly * sum((1 + g) ** k for k in range(years))
    return max(1500.0, future * GOAL_STRETCH)


def _round500(x: float) -> int:
    return int(max(500, round(x / 500) * 500))


def _goal_for(profile: str, age: int, savings_gel: float, monthly_net: float = 0.0) -> tuple[dict, str]:
    """The workbook has no goals. MosaVali assumes one from the profile and sizes it to the customer's own
    savings and cash flow; the customer can edit it in the app."""
    if profile == "retired" or age >= 63:
        target = max(5000, int(round(savings_gel * 1.05, -2)))
        return {"kind": "preserve", "years": 2, "amount_gel": target, "usd_indexed": 0.0}, "protect"
    if profile in ("self_employed", "seasonal_worker"):
        usd = _round500(_sized_target(savings_gel, monthly_net, 3) / 2.70)
        return {"kind": "business", "years": 3, "amount_usd": usd, "usd_indexed": 1.0}, "balance"
    if age >= 45:
        return {"kind": "retirement", "years": 7, "amount_gel": _round500(_sized_target(savings_gel, monthly_net, 7)),
                "usd_indexed": 0.0}, "balance"
    if profile == "professional" and age >= 28:
        usd = _round500(_sized_target(savings_gel, monthly_net, 5) / 2.70)
        return {"kind": "apartment", "years": 5, "amount_usd": usd, "usd_indexed": 1.0}, "goal"
    usd = _round500(_sized_target(savings_gel, monthly_net, 4) / 2.70)
    return {"kind": "car", "years": 4, "amount_usd": usd, "usd_indexed": 1.0}, "goal"


def _iban(cid: str, acc_id: str) -> str:
    cnum = int(re.sub(r"\D", "", cid) or "1")
    anum = int(re.sub(r"\D", "", acc_id) or "1")
    check = 10 + (cnum * 31 + anum * 17) % 89
    return f"GE{check:02d}TB{cnum:04d}{anum:012d}"


@lru_cache(maxsize=2)
def load_organiser_customers(path: str = str(DEFAULT_XLSX)) -> dict[str, dict]:
    tables = read_xlsx_tables(path)
    if not tables:
        return {}
    dep_by_acc = {str(d["account_id"]): d for d in tables.get("Deposits", [])}
    accs_by_cust: dict[str, list[dict]] = defaultdict(list)
    for a in tables.get("Accounts", []):
        if a.get("status") == "active":
            accs_by_cust[str(a["customer_id"])].append(a)

    txs_by_acc: dict[str, list[dict]] = defaultdict(list)
    for t in tables.get("Transactions", []):
        mapped = _map_tx(t)
        if mapped is not None:
            txs_by_acc[str(t["account_id"])].append(mapped)

    out: dict[str, dict] = {}
    for c in tables.get("Customers", []):
        cid = str(c["customer_id"]).lower()
        raw_cid = str(c["customer_id"])
        age = int(c["age"])
        city_en = str(c["city"])
        region, city_ka, city_en_clean = CITY_MAP.get(city_en, ("other", city_en, city_en))
        prof = str(c["profile"])
        occ_ka, occ_en = PROFILE_LABELS.get(prof, (prof, prof))
        name_en = str(c["full_name"])
        name_ka = f"{_name_ka(name_en)} ({raw_cid})"
        name_en_display = f"{name_en} ({raw_cid})"

        cust_accs = []
        total_gel = 0.0
        for idx, a in enumerate(accs_by_cust[raw_cid]):
            aid = str(a["account_id"])
            dep = dep_by_acc.get(aid)
            curr = str(a["currency"])
            bal = float(a["closing_balance"] or 0.0)
            fx = 2.72 if curr == "USD" else 2.95 if curr == "EUR" else 1.0
            total_gel += bal * fx
            rate = float(dep["annual_interest_rate"]) if dep and dep.get("annual_interest_rate") is not None else (
                0.025 if a["account_type"] == "savings" else None
            )
            opened = str((dep or {}).get("start_date") or a.get("opened_date") or "2025-10-01")[:10]
            maturity = str(dep["maturity_date"])[:10] if dep and dep.get("maturity_date") else None
            bank_code = "TBC" if idx == 0 or a["account_type"] != "term_deposit" else "MT"
            bank_name = "TBC Bank (Mock Sandbox)" if bank_code == "TBC" else "Mtatsminda Bank"
            bank_name_ka = "თიბისი ბანკი (სატესტო სენდბოქსი)" if bank_code == "TBC" else "მთაწმინდა ბანკი"
            acc_obj = {
                "resourceId": aid.lower(),
                "iban": _iban(raw_cid, aid),
                "bank": bank_code,
                "bankName": bank_name,
                "bankNameKa": bank_name_ka,
                "currency": curr,
                "product": str(a["account_type"]),
                "balances": [{"balanceType": "interimAvailable",
                              "balanceAmount": {"currency": curr, "amount": f"{bal:.2f}"}}],
                "opened": opened,
                "transactions": {"booked": sorted(txs_by_acc.get(aid, []), key=lambda x: x["bookingDate"])},
            }
            if rate is not None:
                acc_obj["rate"] = rate
            if maturity:
                acc_obj["maturity"] = maturity
            cust_accs.append(acc_obj)

        months = {t["bookingDate"][:7] for a in cust_accs for t in a["transactions"]["booked"]} or {"x"}
        net_gel = sum(float(t["transactionAmount"]["amount"]) * {"USD": 2.70, "EUR": 2.95}.get(t["transactionAmount"]["currency"], 1.0)
                      for a in cust_accs for t in a["transactions"]["booked"])
        goal, default_mission = _goal_for(prof, age, total_gel, net_gel / len(months))
        banks = sorted({a["bank"] for a in cust_accs}, key=lambda b: (b != "TBC", b))
        inc_gel = float(c["monthly_income_gel"])
        out[cid] = {
            "id": cid,
            "raw_id": raw_cid,
            "source": "organiser_xlsx",
            "name_ka": name_ka,
            "name_en": name_en_display,
            "birth_year": AS_OF.year - age,
            "gender": "f" if name_en.split()[0] in ("Nino", "Mariam", "Ana", "Tamar", "Salome", "Elene", "Natia", "Keti", "Sopho", "Maka", "Eka", "Tako", "Nana") else "m",
            "region": region,
            "city_ka": city_ka,
            "city_en": city_en_clean,
            "household": int(c["household_size"]),
            "profile": prof,
            "occupation_ka": occ_ka,
            "occupation_en": occ_en,
            "summary_ka": f"ორგანიზატორის ნიმუში ({raw_cid}) · {len(cust_accs)} ანგარიში · ტიპური შემოსავალი {inc_gel:,.0f} ₾/თვე.",
            "summary_en": f"Organiser dataset ({raw_cid}) · {len(cust_accs)} accounts · typical inflow {inc_gel:,.0f} GEL/mo.",
            "goal": goal,
            "default_mission": default_mission,
            "cash_at_home": 0.0,
            "banks": banks,
            "accounts_payload": cust_accs,
            "psu": {
                "name_ka": name_ka,
                "name_en": name_en_display,
                "birthYear": AS_OF.year - age,
                "region": region,
                "city_ka": city_ka,
                "city_en": city_en_clean,
            },
        }
    return out


_probe_cache: dict = {"ts": 0.0, "result": None}


def cached_tbc_status() -> dict | None:
    """Last probe result without touching the network (None before the first probe)."""
    return _probe_cache["result"]


def probe_tbc_sandbox(force: bool = False) -> dict:
    """Check the live TBC Open Banking Mock API and status monitor with a short timeout.

    Reachability only: HTTP 401/403 means the mock is up and enforcing auth —
    it does NOT mean we are authenticated. No accounts are ever read over the
    network; all customer data comes from the local organiser workbook.
    """
    now = time.time()
    if not force and _probe_cache["result"] is not None and now - _probe_cache["ts"] < 60.0:
        return _probe_cache["result"]

    t0 = time.perf_counter()
    http_status = 0
    code = "UNKNOWN"
    detail = ""
    live_ok = False
    try:
        req = urllib.request.Request(
            f"{TBC_MOCK_BASE}/0.8/v1/accounts?withBalance=true",
            headers={
                "X-Request-ID": "00000000-0000-0000-0000-000000000001",
                "Consent-ID": "danazogi-probe",
                "Accept": "application/json",
            },
        )
        with urllib.request.urlopen(req, timeout=2.0) as resp:
            http_status = resp.status
            live_ok = 200 <= http_status < 300
            code = "OK"
            detail = "TBC Mock Sandbox responded"
    except urllib.error.HTTPError as e:
        http_status = e.code
        try:
            body = json.loads(e.read().decode("utf-8", "ignore"))
            code = body.get("code") or body.get("title") or f"HTTP_{http_status}"
            detail = body.get("detail") or str(e)
        except Exception:
            code = f"HTTP_{http_status}"
            detail = str(e)
        # 401/403 means the mock state is up and enforcing auth
        if http_status in (400, 401, 403):
            live_ok = True
    except Exception as e:
        code = "NETWORK_TIMEOUT"
        detail = str(e)

    latency_ms = round((time.perf_counter() - t0) * 1000, 1)
    result = {
        "sandbox_url": f"{TBC_MOCK_BASE}/0.8",
        "docs_url": f"{TBC_MOCK_BASE}/reference/aisapioverview",
        "status_url": f"{TBC_STATUS_BASE}/",
        "http_status": http_status,
        "code": code,
        "detail": detail,
        "latency_ms": latency_ms,
        "live_available": live_ok,
        "data_source": "organiser_xlsx_100_customers",
        "integration_mode": "status_probe_only",
        "authenticated": False,
        "fallback_mode": "organiser_xlsx_100_customers",
        "checked_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }
    _probe_cache["ts"] = now
    _probe_cache["result"] = result
    return result
