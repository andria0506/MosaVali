"""Train on longitudinal outcomes or run inference on the unlabelled organiser workbook.

Expected CSV: one row per customer per month, at least 24 consecutive months each.

    customer_id, month (YYYY-MM), income, liquid_balance, total_savings,
    age, gender (f/m), region (tbilisi/adjara/imereti/other),
    income_type (salaried/self_employed/seasonal/pensioner/remittance), dependents,
    spend_<category> for every category in cohort.CATEGORIES

Features come from the first 12 months. Regression outcomes come only from
later observed cash flows. Workbook inference is not accuracy validation. Usage:

    python -m danazogi.ml.external path/to/file.csv
"""

import csv
import sys
from collections import defaultdict
from datetime import datetime

import numpy as np

from .cohort import (CATEGORIES, DISCRETIONARY, ESSENTIAL, FEATURE_HIGH, FEATURE_LOW, INCOME_TYPES, LABEL_SHARE, OBS,
                     OUT, REGIONS)
from .regression import cash_target

REQUIRED = ["customer_id", "month", "income", "liquid_balance", "total_savings", "age", "gender", "region",
            "income_type", "dependents"] + [f"spend_{c}" for c in CATEGORIES]


def load_csv(path: str) -> dict:
    rows = defaultdict(list)
    with open(path, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        missing = [c for c in REQUIRED if c not in (reader.fieldnames or [])]
        if missing:
            raise ValueError(f"Missing columns: {', '.join(missing)}")
        for r in reader:
            rows[r["customer_id"]].append(r)

    X, y, meta = [], [], defaultdict(list)
    spend_obs = []
    cash_needs, next_spends, essentials, incomes, spends, essential_histories = [], [], [], [], [], []
    skipped = 0
    for cid, rs in rows.items():
        rs.sort(key=lambda r: r["month"])
        parsed = [datetime.strptime(r["month"], "%Y-%m") for r in rs]
        serial = [d.year * 12 + d.month for d in parsed]
        if any(b - a != 1 for a, b in zip(serial, serial[1:])):
            raise ValueError(f"Customer {cid} must have unique consecutive months")
        if len(rs) < OBS + OUT:
            skipped += 1
            continue
        rs = rs[: OBS + OUT]
        inc = np.array([float(r["income"]) for r in rs])
        spend = np.array([[float(r[f"spend_{c}"]) for c in CATEGORIES] for r in rs])
        liquid = np.array([float(r["liquid_balance"]) for r in rs])
        savings = np.array([float(r["total_savings"]) for r in rs])
        if not all(np.isfinite(a).all() for a in (inc, spend, liquid, savings)) or (inc < 0).any() or (spend < 0).any():
            raise ValueError(f"Customer {cid} has invalid cash-flow amounts")
        obs_inc, obs_spend = inc[:OBS], spend[:OBS]
        total = obs_spend.sum(1)
        ess = obs_spend[:, [CATEGORIES.index(c) for c in ESSENTIAL]].sum(1).mean()
        disc = obs_spend[:, [CATEGORIES.index(c) for c in DISCRETIONARY]].sum(1).mean()
        obligations = obs_spend[:, [CATEGORIES.index(c) for c in ("housing", "utilities", "telecom", "debt_usd")]].sum(1).mean()
        m_inc = max(obs_inc.mean(), 1.0)
        X.append([
            obs_inc.std() / m_inc,
            (obs_inc[-3:].mean() - obs_inc[:9].mean()) / m_inc,
            liquid[OBS - 1] / max(ess, 1.0),
            obligations / m_inc,
            obs_spend[:, CATEGORIES.index("debt_usd")].mean() / m_inc,
            disc / max(total.mean(), 1.0),
            (obs_inc - total).sum() / max(obs_inc.sum(), 1.0),
            float((liquid[:OBS] < 0).mean()),
            1.0,
        ])
        base = max(savings[OBS - 1], 1.0)
        y.append(int((base - savings[OBS:].min()) > LABEL_SHARE * base))
        r0 = rs[0]
        meta["age"].append(int(float(r0["age"])))
        meta["gender"].append(0 if r0["gender"].strip().lower().startswith("f") else 1)
        meta["region"].append(REGIONS.index(r0["region"].strip().lower()) if r0["region"].strip().lower() in REGIONS else 3)
        meta["itype"].append(INCOME_TYPES.index(r0["income_type"].strip().lower()))
        meta["dependents"].append(int(float(r0["dependents"])))
        meta["income"].append(obs_inc.mean())
        spend_obs.append(obs_spend.mean(0))
        essential_path = spend[:, [CATEGORIES.index(c) for c in ESSENTIAL]].sum(1)
        cash_needs.append(cash_target(inc[None, OBS:], essential_path[None, OBS:], np.zeros((1, OUT)))[0])
        next_spends.append(spend[OBS].sum())
        essentials.append(ess)
        incomes.append(obs_inc)
        spends.append(total)
        essential_histories.append(essential_path[:OBS])

    if not X:
        raise ValueError("No customer has 24 months of data")
    X = np.clip(np.array(X), FEATURE_LOW, FEATURE_HIGH)
    return {"X": X, "y": np.array(y), **{k: np.array(v) for k, v in meta.items()},
            "category_spend": np.array(spend_obs), "shock": False, "seed": None, "skipped": skipped,
            "cash_need_gel": np.array(cash_needs), "next_spend_gel": np.array(next_spends),
            "essential_spend": np.array(essentials), "income_history": np.array(incomes),
            "spend_history": np.array(spends), "essential_history": np.array(essential_histories),
            "source": "External longitudinal CSV; future observed cash-flow outcomes"}


def evaluate_xlsx(path: str | None = None, liq_bundle: dict | None = None, peer_bundle: dict | None = None,
                  spending_bundle: dict | None = None) -> dict | None:
    """Inference-only compatibility check: the workbook has no future regression outcomes."""
    from ..agents import ingestion
    from ..data.organiser_xlsx import DEFAULT_XLSX, load_organiser_customers, read_xlsx_tables
    from . import cash_model, peer_model, registry, spending_model

    target = str(path or DEFAULT_XLSX)
    custs = load_organiser_customers(target)
    if not custs:
        return None
    tables = read_xlsx_tables(target)
    liq_b = liq_bundle or registry.get("liquidity")
    peer_b = peer_bundle or registry.get("peers")
    spending_b = spending_bundle or registry.get("spending")

    needs, next_spends, buffers, opps, high_need = [], [], [], [], []
    groups_seen = set()
    by_prof: dict[str, list[dict]] = defaultdict(list)

    for cid, c in custs.items():
        ing = ingestion.ingest(c["accounts_payload"], c["psu"], c["cash_at_home"], c["household"])
        essential = ing["metrics"]["essential_spend"]
        pred = cash_model.predict(liq_b, ing["features"], essential)
        cf = ing["cashflow"]
        forecast = spending_model.predict(spending_b, cf["income"],
                                         np.array(cf["spend_gel"]) + cf["spend_usd"], cf["essential"])
        minimum = 6.0 if ing["months_of_history"] < 6 or essential <= 0 else 3.0
        required = max(pred["cautious_gel"], minimum * essential)
        if essential <= 0:
            required = max(required, ing["totals"]["assets_gel"])
        buf_m = required / essential if essential > 0 else 0.0
        grp = peer_model.assign(peer_b, ing["metrics"]["monthly_income"], ing["psu"]["age"],
                                max(ing["psu"]["household"] - 1, 0), ing["income_type"], ing["psu"]["region"])
        opp = peer_model.opportunities(grp, ing["peer_spend"])
        needs.append(pred["expected_gel"])
        next_spends.append(forecast["expected_gel"])
        high_need.append(required >= 6 * max(essential, 1.0) or required > ing["totals"]["assets_gel"]
                         or ing["months_of_history"] < 6 or essential <= 0)
        buffers.append(buf_m)
        opps.append(opp["monthly_total"])
        groups_seen.add(grp["id"])
        by_prof[c["profile"]].append({
            "income": ing["metrics"]["monthly_income"],
            "spend": ing["metrics"]["monthly_spend"],
            "cash_need_gel": pred["expected_gel"],
            "next_spend_gel": forecast["expected_gel"],
            "buffer_months": buf_m,
            "monthly_saving": opp["monthly_total"],
        })

    prof_rows = []
    for prof, items in sorted(by_prof.items(), key=lambda kv: -len(kv[1])):
        prof_rows.append({
            "profile": prof,
            "n": len(items),
            "mean_income_gel": round(float(np.mean([x["income"] for x in items])), 1),
            "mean_spend_gel": round(float(np.mean([x["spend"] for x in items])), 1),
            "mean_cash_need_gel": round(float(np.mean([x["cash_need_gel"] for x in items])), 2),
            "mean_next_spend_gel": round(float(np.mean([x["next_spend_gel"] for x in items])), 2),
            "mean_buffer_months": round(float(np.mean([x["buffer_months"] for x in items])), 2),
            "mean_savings_opportunity_gel": round(float(np.mean([x["monthly_saving"] for x in items])), 1),
        })

    return {
        "file": "open_banking_synthetic_100_customers.xlsx",
        "period": "2026-04-20 to 2026-10-19 (183 days · 6 billing cycles)",
        "customers": len(custs),
        "accounts": len(tables.get("Accounts", [])),
        "deposits": len(tables.get("Deposits", [])),
        "transactions": len(tables.get("Transactions", [])),
        "mean_cash_need_gel": round(float(np.mean(needs)), 2),
        "mean_next_spend_gel": round(float(np.mean(next_spends)), 2),
        "high_need_count": int(sum(high_need)),
        "mean_buffer_months": round(float(np.mean(buffers)), 2),
        "peer_groups_covered": len(groups_seen),
        "customers_with_savings_opportunity": int(sum(1 for x in opps if x > 0)),
        "mean_savings_opportunity_gel": round(float(np.mean(opps)), 2),
        "by_profile": prof_rows,
        "validation_kind": "inference_only",
        "limitations": "No future outcomes: these summaries are not accuracy metrics and workbook rows are not used as labelled regression training data.",
    }


def load_xlsx(path: str) -> dict:
    """Return an untouched synthetic cohort; unlabelled workbook rows are not training targets."""
    from ..data.organiser_xlsx import load_organiser_customers
    from .cohort import generate

    custs = load_organiser_customers(path)
    if not custs:
        raise ValueError(f"Could not load customers from {path}")

    base = generate(20000, seed=7)
    # Workbook customers are checked separately; synthetic training rows remain untouched.
    # Future outcomes cannot be inferred from low current balances or high obligations.
    base["source"] = "Synthetic event-driven cohort; organiser workbook is inference-only, not training data"

    base["skipped"] = 0
    base["organiser_customers"] = len(custs)
    return base


if __name__ == "__main__":
    from .registry import train_all

    arg = sys.argv[1]
    if arg.lower().endswith(".xlsx"):
        ev = evaluate_xlsx(arg)
        if ev:
            print(f"Inference only (no training or accuracy claim): {ev['customers']} customers, {ev['transactions']} transactions, "
                  f"mean buffer {ev['mean_buffer_months']} mo, mean savings finder {ev['mean_savings_opportunity_gel']} GEL/mo")
    else:
        data = load_csv(arg)
        out = train_all(data, source=arg)
        print(f"Loaded {len(data['cash_need_gel'])} customers ({data.get('skipped', 0)} skipped)")
        for key in ("liquidity", "spending"):
            print(out[key]["version"], out[key]["decision"])
