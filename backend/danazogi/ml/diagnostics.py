"""Diagnostics for the cash-need regression on synthetic cohorts (no retraining).

1. Reserve effect: how often the cautious estimate, rather than the 3-month
   minimum rule, sets the protected reserve, and how much that improves
   coverage of the realised 12-month cash need.
2. Short history: the organiser workbook has 6 months of history while the
   model was trained on 12. History-dependent features are recomputed from
   the last 6 months to show how bound and reserve coverage change, split by
   income irregularity.

Run:  python -m danazogi.ml.diagnostics   (from the backend folder)
"""

import json

import numpy as np

from . import registry
from . import regression as R
from .cohort import FEATURE_HIGH, FEATURE_KEYS, FEATURE_LOW, generate

RULE_MONTHS = 3.0
FALLBACK_MONTHS = 6.0
IRREGULAR_CV = 0.4
SHORT_MONTHS = 6
COLLAPSE_GEL = 0.5
PATH = registry.ARTIFACTS / "liquidity.diagnostics.json"


def _bounds(bundle: dict, X: np.ndarray, scale: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    point = np.maximum(bundle["model"].predict(X), 0) * scale
    upper = np.maximum(point, np.maximum(bundle["upper_model"].predict(X) + bundle["correction"], 0) * scale)
    return point, upper


def _mean(values: np.ndarray) -> float | None:
    return float(np.mean(values)) if len(values) else None


def reserve_effect(bundle: dict, data: dict, idx: np.ndarray) -> dict:
    X, scale, y, _ = R.arrays(data, "liquidity")
    X, scale, y = X[idx], scale[idx], y[idx]
    point, upper = _bounds(bundle, X, scale)
    rule = RULE_MONTHS * scale
    sets = upper > rule
    reserve = np.maximum(upper, rule)
    return {
        "n": int(len(y)),
        "model_sets_reserve_share": float(sets.mean()),
        "mean_uplift_over_rule_gel": _mean((upper - rule)[sets]),
        "reserve_coverage_with_model": float(np.mean(y <= reserve)),
        "reserve_coverage_rule_only": float(np.mean(y <= rule)),
        "model_set_group_coverage_with_model": _mean((y <= reserve)[sets]),
        "model_set_group_coverage_rule_only": _mean((y <= rule)[sets]),
        "bound_collapsed_share": float(np.mean(upper <= point + COLLAPSE_GEL)),
    }


def short_history(bundle: dict, data: dict, idx: np.ndarray) -> dict:
    inc, spend, ess = (np.asarray(data[k], dtype=float)[idx] for k in ("income_history", "spend_history", "essential_history"))
    X12 = np.asarray(data["X"], dtype=float)[idx]
    scale12 = np.maximum(np.asarray(data["essential_spend"], dtype=float)[idx], 1.0)
    y = np.asarray(data["cash_need_gel"], dtype=float)[idx]

    i6, s6 = inc[:, -SHORT_MONTHS:], spend[:, -SHORT_MONTHS:]
    m6 = np.maximum(i6.mean(1), 1.0)
    cv6 = i6.std(1) / m6
    X6 = X12.copy()
    X6[:, FEATURE_KEYS.index("income_cv")] = cv6
    X6[:, FEATURE_KEYS.index("income_trend")] = (i6[:, -3:].mean(1) - i6[:, :3].mean(1)) / m6
    X6[:, FEATURE_KEYS.index("savings_rate")] = (i6 - s6).sum(1) / np.maximum(i6.sum(1), 1.0)
    X6 = np.clip(X6, FEATURE_LOW, FEATURE_HIGH)
    scale6 = np.maximum(ess[:, -SHORT_MONTHS:].mean(1), 1.0)

    p12, u12 = _bounds(bundle, X12, scale12)
    p6, u6 = _bounds(bundle, X6, scale6)
    groups = {}
    for name, mask in (("regular_income", cv6 <= IRREGULAR_CV), ("irregular_income", cv6 > IRREGULAR_CV)):
        groups[name] = {
            "n": int(mask.sum()),
            "bound_coverage_6m": _mean((y <= u6)[mask]),
            "reserve_coverage_3m_floor": _mean((y <= np.maximum(u6, RULE_MONTHS * scale6))[mask]),
            "reserve_coverage_6m_floor": _mean((y <= np.maximum(u6, FALLBACK_MONTHS * scale6))[mask]),
        }
    return {
        "n": int(len(y)),
        "mae_gel_12m": float(np.mean(np.abs(p12 - y))), "mae_gel_6m": float(np.mean(np.abs(p6 - y))),
        "bound_coverage_12m": float(np.mean(y <= u12)), "bound_coverage_6m": float(np.mean(y <= u6)),
        "groups": groups,
    }


def run(bundle: dict | None = None, data: dict | None = None, stress: dict | None = None) -> dict:
    bundle = bundle or registry.get("liquidity")
    data = data if data is not None else generate()
    stress = stress if stress is not None else generate(5000, seed=103, shock=True)
    test = R.split_indices(len(data["cash_need_gel"]))[3]
    every = np.arange(len(stress["cash_need_gel"]))
    return {
        "model_version": bundle["version"],
        "data": "Synthetic held-out test customers (same split as training) and the independent 2014-style stress cohort",
        "rule_months": RULE_MONTHS, "fallback_months": FALLBACK_MONTHS,
        "irregular_income_cv": IRREGULAR_CV, "short_history_months": SHORT_MONTHS,
        "reserve_effect": {"test": reserve_effect(bundle, data, test), "stress": reserve_effect(bundle, stress, every)},
        "short_history": {"test": short_history(bundle, data, test), "stress": short_history(bundle, stress, every)},
        "notes": [
            "Reserve = max(3 months of essential costs, cautious estimate); coverage = share whose realised 12-month cash need is at or below the reserve.",
            "Bound collapsed = cautious estimate within 0.5 GEL of the expected estimate: common when most similar customers need no extra cash (zero-inflated outcome).",
            "Short history recomputes income variability, income trend, savings rate and the essential-cost scale from the last 6 months; obligation, USD-debt, discretionary and negative-balance features keep their 12-month values (approximation).",
            "Synthetic data only; population-level coverage, not a personal guarantee.",
        ],
    }


if __name__ == "__main__":
    out = run()
    PATH.write_text(json.dumps(out, indent=2, ensure_ascii=False), encoding="utf-8")
    for regime in ("test", "stress"):
        r, s = out["reserve_effect"][regime], out["short_history"][regime]
        print(f"{regime}: model sets reserve {r['model_sets_reserve_share']:.1%} (+{r['mean_uplift_over_rule_gel']:.0f} GEL), "
              f"coverage {r['reserve_coverage_rule_only']:.1%} -> {r['reserve_coverage_with_model']:.1%}, collapsed {r['bound_collapsed_share']:.1%}; "
              f"6m bound coverage {s['bound_coverage_12m']:.1%} -> {s['bound_coverage_6m']:.1%}; irregular: "
              f"{s['groups']['irregular_income']}")
    print(PATH)
