"""Custom customer builder: a synthetic persona generated from typed values.

The form collects the same numbers the demo personas encode (income, spending,
savings, goal) and turns them into the standard generator spec stored in
``PERSONAS`` — the normal consent → ingestion → plan pipeline then works
unchanged. Everything produced is synthetic and labelled as such.
"""
from __future__ import annotations

import secrets
import threading
from datetime import date

from ..agents import profiler as prof
from .mock_open_banking import AS_OF, BANKS, PERSONAS, _full_payload

CUSTOM_LIMIT = 1000
_LOCK = threading.Lock()


def _add_months(d: date, n: int) -> date:
    """Shift a date by n months, clamping the day to 28 so every month is valid."""
    months = (d.year * 12 + d.month - 1) + n
    return date(months // 12, months % 12 + 1, min(d.day, 28))

CITIES = {"tbilisi": ("თბილისი", "Tbilisi"), "adjara": ("ბათუმი", "Batumi"),
          "imereti": ("ქუთაისი", "Kutaisi"), "other": ("რეგიონი", "Other region")}
_INCOME = {"salary": ("Employer", "Salary"), "pension": ("Pension Fund", "Pension"),
           "business": ("Guesthouse bookings", "Business income (guest booking)")}


def as_persona_spec(body) -> dict:
    """Flat generator spec in the same format ``_full_payload`` consumes."""
    label = (body.label or "Custom customer").strip() or "Custom customer"
    city_ka, city_en = CITIES[body.region]
    spend = sum(float(getattr(body, k)) for k in
                ("rent", "utilities", "groceries", "transport", "delivery", "dining", "taxi", "other"))
    income_name, income_text = _INCOME[body.income_kind]
    goal = prof.custom_goal(body.goal.kind, body.goal.amount, body.goal.currency, body.goal.years)

    accounts = [{"bank": body.bank, "product": "current", "currency": "GEL",
                 "balance": float(body.gel_current)}]
    if body.gel_savings > 0:
        accounts.append({"bank": body.bank, "product": "savings", "currency": "GEL",
                         "balance": float(body.gel_savings), "rate": 0.03})
    if body.usd_savings > 0:
        accounts.append({"bank": body.bank, "product": "savings", "currency": "USD",
                         "balance": float(body.usd_savings), "rate": 0.005})
    if body.gel_term_deposit > 0:
        accounts.append({"bank": body.bank, "product": "term_deposit", "currency": "GEL",
                         "balance": float(body.gel_term_deposit), "rate": 0.090,
                         "opened": AS_OF.isoformat(),
                         "maturity": _add_months(AS_OF, 9).isoformat()})
    if body.usd_loan_balance > 0:
        accounts.append({"bank": body.bank, "product": "loan", "currency": "USD",
                         "balance": -float(body.usd_loan_balance), "rate": 0.075,
                         "opened": _add_months(AS_OF, -12).isoformat(),
                         "maturity": _add_months(AS_OF, 120).isoformat(),
                         "instalment": float(body.usd_loan_instalment)})

    recurring = [(name, mcc, amt, sd, dd, text, usd) for name, mcc, amt, sd, dd, text, usd in (
        ("Landlord", None, float(body.rent), 0, 1, "Rent payment", False),
        ("Utility company", 4900, float(body.utilities), 0.1 * body.utilities, 8, "Electricity", False),
        ("Metro card top-up", 4111, float(body.transport), 0.1 * body.transport, 3, "Transport", False),
    ) if amt > 0]
    weekly = [(name, mcc, amt / 4, 0.15 * amt / 4, text) for name, mcc, amt, text in (
        ("Supermarket", 5411, float(body.groceries), "Groceries"),
        ("Food delivery app", 5814, float(body.delivery), "Food delivery"),
        ("Restaurant", 5812, float(body.dining), "Restaurant"),
        ("Taxi app", 4121, float(body.taxi), "Taxi ride"),
        # No MCC and a keyword-free text, so ingestion classifies it as "other".
        ("Shop", None, float(body.other), "Purchase"),
    ) if amt > 0]
    income = [] if body.monthly_income <= 0 else [
        {"name": income_name, "text": income_text, "amount": float(body.monthly_income),
         "day": int(body.pay_day)}]

    return {
        "id": "custom-" + secrets.token_hex(4),
        "source": "custom",
        "name_ka": label, "name_en": label,
        "birth_year": AS_OF.year - int(body.age), "gender": "u",
        "region": body.region, "city_ka": city_ka, "city_en": city_en,
        "household": int(body.household),
        "occupation_ka": "მომხმარებლის მიერ შეყვანილი", "occupation_en": "Typed by the user",
        "summary_ka": f"სინთეზური მომხმარებელი შეყვანილი მონაცემებით: შემოსავალი {body.monthly_income:,.0f} ₾/თვე, ხარჯი {spend:,.0f} ₾/თვე.",
        "summary_en": f"Synthetic customer generated from typed values: income {body.monthly_income:,.0f} GEL/mo, spending {spend:,.0f} GEL/mo.",
        "banks": [body.bank], "cash_at_home": float(body.cash_at_home),
        "accounts": accounts,
        "income": income, "bonus": None,
        "recurring": recurring, "weekly": weekly, "occasional": [],
        "goal": goal,
        "default_mission": "protect" if goal["kind"] == "preserve" else "goal",
    }


def custom_count() -> int:
    return sum(1 for p in PERSONAS.values() if p.get("source") == "custom")


class LimitReached(Exception):
    """Raised when the number of custom customers reaches CUSTOM_LIMIT."""


def build_custom(body) -> tuple[str, dict, dict]:
    """Validate, register and materialise a custom persona.

    Returns (persona_id, flat spec, full payload); raises LimitReached at the cap
    and ValueError when the bank is unknown.
    """
    if body.bank not in BANKS:
        raise ValueError(f"unknown bank: {body.bank}")
    with _LOCK:
        if custom_count() >= CUSTOM_LIMIT:
            raise LimitReached(f"custom customer limit reached ({CUSTOM_LIMIT})")
        spec = as_persona_spec(body)
        pid = spec["id"]
        PERSONAS[pid] = spec
        try:
            payload = _full_payload(pid)
        except Exception:
            PERSONAS.pop(pid, None)
            raise
    return pid, spec, payload


def create(body) -> str:
    """Register a custom persona and return its id."""
    return build_custom(body)[0]
