import numpy as np

from ..ml import registry, spending_model


def assess(ing: dict, partial: bool) -> dict:
    cf, metrics = ing["cashflow"], ing["metrics"]
    spend = np.array(cf["spend_gel"]) + np.array(cf["spend_usd"])
    income = np.array(cf["income"])
    reasons = []
    if ing["months_of_history"] < 6:
        reasons.append("short_history")
    if partial:
        reasons.append("partial_bank_data")
    if not len(spend):
        spend, income = np.zeros(1), np.zeros(1)
    bundle = registry.get("spending")
    pred = spending_model.predict(bundle, income, spend, cf["essential"])
    income_reference = max(0.0, min(float(income.mean()), float(income[-3:].mean())))
    historical = max(float(metrics["savings_velocity"]), 0.0)
    available = max(0.0, min(historical, income_reference - max(pred["cautious_gel"], metrics["essential_spend"])))
    return {**pred, "horizon_months": 1, "income_reference_gel": round(income_reference, 2),
            "affordable_monthly_gel": 0.0 if reasons else round(available, 2),
            "fallback": {"active": bool(reasons), "reasons": reasons, "needs_review": bool(reasons)},
            "model_version": bundle["version"],
            "income_basis": "Lower of historical and last-three-month average income; not an ML income forecast"}
