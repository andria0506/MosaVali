"""Cash-needs regression plus explicit minimum-reserve safeguards."""

from ..ml import cash_model, registry
from ..ml.cohort import OBS

MIN_HISTORY = 6
FALLBACK_MONTHS = 6.0
IRREGULAR_CV = 0.4


def assess(features: dict, essential_spend: float, total_assets: float, months_of_history: int,
           partial: bool) -> dict:
    bundle = registry.get("liquidity")
    pred = cash_model.predict(bundle, features, essential_spend)
    reasons = []
    if months_of_history < MIN_HISTORY:
        reasons.append("short_history")
    if partial:
        reasons.append("partial_bank_data")
    if essential_spend <= 0:
        reasons.append("missing_essential_spend")
    if months_of_history < OBS and features.get("income_cv", 0.0) > IRREGULAR_CV:
        reasons.append("short_irregular_history")
    assets = max(total_assets, 0.0)
    minimum = FALLBACK_MONTHS if reasons else 3.0
    required = max(pred["cautious_gel"], minimum * max(essential_spend, 0.0))
    if essential_spend <= 0:
        required = max(required, assets)
    protected = min(required, assets)
    share = protected / assets if assets else 1.0
    shortage = max(required - assets, 0.0)
    return {
        "minimum_months": minimum,
        "minimum_gel": round(minimum * max(essential_spend, 0.0), 2),
        "bound_collapsed": pred["cautious_gel"] <= pred["expected_gel"] + 0.5,
        "reserve_basis": ("all_assets" if essential_spend <= 0
                          else "cash_need_model" if pred["cautious_gel"] > minimum * essential_spend + 1e-9
                          else "fallback_minimum" if reasons
                          else "minimum_rule"),
        "expected_need_gel": pred["expected_gel"], "cautious_need_gel": pred["cautious_gel"],
        "horizon_months": 12, "coverage_target": pred["coverage_target"],
        "high_need": required >= 6 * max(essential_spend, 1.0) or shortage > 0 or bool(reasons),
        "buffer_months": required / essential_spend if essential_spend > 0 else 0.0,
        "funded_buffer_months": protected / essential_spend if essential_spend > 0 else 0.0,
        "buffer_gel": round(protected, 2),
        "required_buffer_gel": round(required, 2), "buffer_shortfall_gel": round(shortage, 2),
        "buffer_share": share,
        "free_to_invest_gel": round(assets - protected, 2),
        "contributions": pred["contributions"],
        "explanation_method": pred["explanation_method"],
        "fallback": {"active": bool(reasons), "reasons": reasons, "needs_review": bool(reasons)},
        "model_version": bundle["version"],
    }
