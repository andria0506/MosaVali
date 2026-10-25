import hashlib

import numpy as np
from sklearn.ensemble import HistGradientBoostingRegressor
from sklearn.linear_model import Ridge
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

SCHEMA_VERSION = 2
COVERAGE = 0.90
SPLIT_SEED = 23
SPENDING_FEATURES = [
    ("last_spend_ratio", "ბოლო თვის ხარჯი", "Last month's spending"),
    ("recent_spend_ratio", "ბოლო სამი თვის ხარჯი", "Recent spending"),
    ("spend_cv", "ხარჯების ცვალებადობა", "Spending variability"),
    ("spend_trend", "ხარჯების ცვლილება", "Spending trend"),
    ("essential_share", "აუცილებელი ხარჯების წილი", "Essential spending share"),
    ("income_to_spend", "შემოსავალი ხარჯებთან შედარებით", "Income relative to spending"),
    ("income_cv", "შემოსავლის ცვალებადობა", "Income variability"),
    ("income_trend", "შემოსავლის ცვლილება", "Income trend"),
]


def cash_target(income: np.ndarray, essential: np.ndarray, events: np.ndarray) -> np.ndarray:
    return np.maximum(np.cumsum(essential + events - income, axis=1).max(axis=1), 0.0)


def spending_design(income, spend, essential) -> tuple[np.ndarray, np.ndarray]:
    income, spend, essential = (np.atleast_2d(np.asarray(a, dtype=float)) for a in (income, spend, essential))
    if income.shape != spend.shape or essential.shape != spend.shape or spend.shape[1] == 0:
        raise ValueError("Matching non-empty monthly income, spending and essential spending are required")
    if not all(np.isfinite(a).all() and (a >= 0).all() for a in (income, spend, essential)):
        raise ValueError("Cash-flow histories must be finite and non-negative")
    scale = np.maximum(spend.mean(axis=1), 1.0)
    inc_mean = np.maximum(income.mean(axis=1), 1.0)
    previous = slice(-6, -3) if spend.shape[1] > 3 else slice(None)
    X = np.column_stack([
        spend[:, -1] / scale,
        spend[:, -3:].mean(axis=1) / scale,
        spend.std(axis=1) / scale,
        (spend[:, -3:].mean(axis=1) - spend[:, previous].mean(axis=1)) / scale,
        essential.mean(axis=1) / scale,
        income.mean(axis=1) / scale,
        income.std(axis=1) / inc_mean,
        (income[:, -3:].mean(axis=1) - income[:, previous].mean(axis=1)) / inc_mean,
    ])
    return X, scale


def split_indices(n: int, seed: int = SPLIT_SEED) -> tuple[np.ndarray, ...]:
    if n < 40:
        raise ValueError("At least 40 independent customers with future outcomes are required")
    return tuple(np.split(np.random.default_rng(seed).permutation(n), [int(n * .6), int(n * .75), int(n * .85)]))


def scores(y, predicted, upper=None) -> dict:
    out = {
        "mae_gel": float(mean_absolute_error(y, predicted)),
        "rmse_gel": float(np.sqrt(mean_squared_error(y, predicted))),
        "r2": float(r2_score(y, predicted)),
        "mean_actual_gel": float(np.mean(y)),
        "mean_predicted_gel": float(np.mean(predicted)),
        "underprediction_rate": float(np.mean(predicted < y)),
        "n": int(len(y)),
    }
    if upper is not None:
        out.update(upper_coverage=float(np.mean(y <= upper)), mean_upper_gel=float(np.mean(upper)))
    return out


def arrays(data: dict, kind: str) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    if kind == "liquidity":
        X = np.asarray(data["X"], dtype=float)
        scale = np.maximum(data["essential_spend"], 1.0)
        y = np.asarray(data["cash_need_gel"], dtype=float)
        baseline = np.full(len(y), np.nan)
    else:
        X, scale = spending_design(data["income_history"], data["spend_history"], data["essential_history"])
        y = np.asarray(data["next_spend_gel"], dtype=float)
        baseline = np.asarray(data["spend_history"])[:, -3:].mean(axis=1)
    if not all(np.isfinite(a).all() for a in (X, scale, y)) or (y < 0).any():
        raise ValueError("Regression training requires finite features and non-negative observed outcomes")
    return X, scale, y, baseline


def train(kind: str, data: dict, stress: dict, features: list, version: str) -> dict:
    X, scale, y, baseline = arrays(data, kind)
    tr, va, ca, te = split_indices(len(y))
    normalized = y / scale
    champion = make_pipeline(StandardScaler(), Ridge(alpha=10.0))
    challenger = HistGradientBoostingRegressor(
        loss="squared_error", max_iter=180, learning_rate=.05, max_leaf_nodes=15,
        min_samples_leaf=40, l2_regularization=5.0, early_stopping=False, random_state=SPLIT_SEED)
    for model in (champion, challenger):
        model.fit(X[tr], normalized[tr])
    candidates = {"champion": champion, "challenger": challenger}
    validation = {name: scores(y[va], np.maximum(model.predict(X[va]), 0) * scale[va])
                  for name, model in candidates.items()}
    winner = min(validation, key=lambda name: validation[name]["rmse_gel"])
    chosen = candidates[winner]
    upper_model = HistGradientBoostingRegressor(
        loss="quantile", quantile=COVERAGE, max_iter=180, learning_rate=.05, max_leaf_nodes=15,
        min_samples_leaf=40, l2_regularization=5.0, early_stopping=False, random_state=SPLIT_SEED)
    upper_model.fit(X[tr], normalized[tr])
    residuals = normalized[ca] - upper_model.predict(X[ca])
    rank = min(int(np.ceil((len(ca) + 1) * COVERAGE)), len(ca))
    correction = max(float(np.sort(residuals)[rank - 1]), 0.0)
    baseline_ratio = float(normalized[tr].mean())
    if kind == "liquidity":
        baseline = baseline_ratio * scale
    SX, ss, sy, sb = arrays(stress, kind)
    if kind == "liquidity":
        sb = baseline_ratio * ss

    def evaluate(xx, yy, scales, base):
        point = np.maximum(chosen.predict(xx), 0) * scales
        upper = np.maximum(point, np.maximum(upper_model.predict(xx) + correction, 0) * scales)
        return {
            **{name: scores(yy, np.maximum(m.predict(xx), 0) * scales) for name, m in candidates.items()},
            "selected": scores(yy, point, upper), "baseline": scores(yy, base),
        }

    test = evaluate(X[te], y[te], scale[te], baseline[te])
    point = np.maximum(chosen.predict(X[te]), 0) * scale[te]
    upper = np.maximum(point, np.maximum(upper_model.predict(X[te]) + correction, 0) * scale[te])
    tables = {}
    groups = {
        "gender": {"female": data["gender"][te] == 0, "male": data["gender"][te] == 1},
        "age_band": {label: (data["age"][te] >= lo) & (data["age"][te] <= hi)
                     for lo, hi, label in ((0, 29, "<30"), (30, 49, "30–49"), (50, 64, "50–64"), (65, 200, "65+"))},
        "region": {name: data["region"][te] == i for i, name in enumerate(("tbilisi", "adjara", "imereti", "other"))},
    }
    for name, masks in groups.items():
        tables[name] = [{"group": group, **scores(y[te][mask], point[mask], upper[mask])}
                        for group, mask in masks.items() if mask.sum() >= 2]
    fingerprint = hashlib.sha256(X.tobytes() + y.tobytes() + scale.tobytes()).hexdigest()[:8]
    return {
        "schema_version": SCHEMA_VERSION, "kind": kind, "version": f"{version}+{fingerprint}",
        "model": chosen, "upper_model": upper_model, "winner": winner,
        "decision": f"{winner.title()} selected using validation RMSE in GEL; test customers were not used for selection.",
        "decision_ka": "მოდელი შეირჩა ვალიდაციის მონაცემებზე GEL-ში გამოთვლილი RMSE-ით; ტესტის მომხმარებლები შერჩევაში არ მონაწილეობდნენ.",
        "features": [{"key": k, "label_ka": ka, "label_en": en} for k, ka, en in features],
        "reference": np.median(X[tr], axis=0).tolist(), "correction": correction, "coverage_target": COVERAGE,
        "baseline_ratio": baseline_ratio,
        "baseline_rule": "Training mean cash need in essential-cost months" if kind == "liquidity" else "Last three months' average spending",
        "metrics": {"validation": validation, "test": test, "stress_regime": evaluate(SX, sy, ss, sb)},
        "fairness": {"protected_attributes_used_as_inputs": False, "tables": tables,
                     "note": "Group error and upper-bound coverage on synthetic held-out customers; not proof of fairness."},
        "data": {"train_n": len(tr), "validation_n": len(va), "calibration_n": len(ca),
                 "test_n": len(te), "stress_n": len(sy),
                 "label": "Maximum cumulative essential cash deficit over the next 12 months, including simulated one-off costs"
                          if kind == "liquidity" else "Total spending in the next month, including simulated one-off costs",
                 "source": data.get("source", "Synthetic event-driven cohort"),
                 "split": "Customer-disjoint 60/15/10/15 train/validation/calibration/test; features precede outcomes",
                 "stress_source": stress.get("source", "Independent synthetic 2014-style stress cohort"),
                 "limitations": "Synthetic outcomes only. Upper-bound coverage is population-level, not a personal guarantee; shocks can reduce coverage."},
    }


def predict(bundle: dict, X, scale: float) -> dict:
    x = np.asarray(X, dtype=float).reshape(1, -1)
    if not np.isfinite(x).all() or not np.isfinite(scale) or scale <= 0:
        raise ValueError("Finite features and a positive scale are required")
    point = float(max(bundle["model"].predict(x)[0], 0) * scale)
    upper = float(max(point, (bundle["upper_model"].predict(x)[0] + bundle["correction"]) * scale, 0))
    alternatives = np.repeat(x, x.shape[1], axis=0)
    np.fill_diagonal(alternatives, bundle["reference"])
    changed = np.maximum(bundle["model"].predict(alternatives), 0) * scale
    contributions = [
        {**f, "feature": f["key"], "value": float(x[0, i]), "effect_gel": float(point - changed[i])}
        for i, f in enumerate(bundle["features"])
    ]
    return {"expected_gel": round(point, 2), "cautious_gel": round(upper, 2),
            "coverage_target": bundle["coverage_target"],
            "contributions": sorted(contributions, key=lambda f: -abs(f["effect_gel"])),
            "explanation_method": "One-feature replacement with training median; non-additive, not causal or SHAP"}
