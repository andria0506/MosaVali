import csv

import numpy as np
import pytest

from danazogi.agents import liquidity, spending
from danazogi.ml import cash_model, external, regression, registry, spending_model
from danazogi.ml.cohort import CATEGORIES, FEATURE_KEYS, generate


def test_cash_target_is_required_starting_reserve_not_sum_of_deficit_months():
    income = np.array([[0, 150, 0], [150, 0, 0], [100, 100, 100]])
    essential = np.array([[100, 0, 100], [0, 100, 100], [0, 0, 0]])
    events = np.array([[0, 0, 0], [0, 0, 0], [0, 250, 0]])
    assert regression.cash_target(income, essential, events).tolist() == [100, 50, 50]


def test_synthetic_regression_targets_are_continuous_and_reproducible():
    a, b = generate(1000, seed=31), generate(1000, seed=31)
    for key in ("cash_need_gel", "next_spend_gel", "income_history", "spend_history", "essential_history"):
        assert np.array_equal(a[key], b[key])
        assert np.isfinite(a[key]).all() and (a[key] >= 0).all()
    assert len(np.unique(a["cash_need_gel"])) > 20
    assert len(np.unique(a["next_spend_gel"])) > 900


def test_four_customer_splits_do_not_overlap():
    parts = regression.split_indices(20000)
    assert [len(p) for p in parts] == [12000, 3000, 2000, 3000]
    assert len(np.unique(np.concatenate(parts))) == 20000


def test_spending_design_does_not_use_protected_attributes_and_is_scale_invariant():
    income = np.array([[2000, 2100, 2200, 2050, 2100, 2200]])
    spend = np.array([[1500, 1700, 1600, 1800, 1700, 1900]])
    essential = spend * .7
    X, scale = regression.spending_design(income, spend, essential)
    XX, ss = regression.spending_design(income * 10, spend * 10, essential * 10)
    assert np.allclose(X, XX) and np.allclose(ss, scale * 10)
    assert not {"age", "gender", "region"} & {f[0] for f in regression.SPENDING_FEATURES}
    with pytest.raises(ValueError):
        regression.spending_design([[1, np.nan]], [[1, 2]], [[1, 1]])


@pytest.mark.parametrize("kind", ["liquidity", "spending"])
def test_regression_predictions_are_nonnegative_ordered_amounts(kind):
    data = generate(50, seed=19)
    bundle = registry.get(kind)
    if kind == "liquidity":
        out = cash_model.predict(bundle, dict(zip(FEATURE_KEYS, data["X"][0])), data["essential_spend"][0])
    else:
        out = spending_model.predict(bundle, data["income_history"][0], data["spend_history"][0],
                                     data["essential_history"][0])
    assert 0 <= out["expected_gel"] <= out["cautious_gel"]
    assert np.isfinite([out["expected_gel"], out["cautious_gel"]]).all()
    assert out["coverage_target"] == .9
    assert "p12" not in out
    assert all("effect_gel" in c and "logit" not in c for c in out["contributions"])


def test_insufficient_assets_are_all_protected_not_forced_to_invest(monkeypatch):
    monkeypatch.setattr(registry, "get", lambda _: {"version": "test"})
    monkeypatch.setattr(cash_model, "predict", lambda *args: {
        "expected_gel": 1000, "cautious_gel": 5000, "coverage_target": .9,
        "contributions": [], "explanation_method": "test",
    })
    out = liquidity.assess({}, 1000, 2000, 12, False)
    assert out["buffer_gel"] == 2000 and out["free_to_invest_gel"] == 0
    assert out["buffer_shortfall_gel"] == 3000
    assert out["buffer_share"] == 1
    short = liquidity.assess({}, 1000, 20000, 3, True)
    assert short["required_buffer_gel"] >= 6000
    assert short["fallback"]["needs_review"]
    zero = liquidity.assess({}, 0, 1000, 0, False)
    assert zero["free_to_invest_gel"] == 0 and zero["fallback"]["active"]


def test_spending_affordability_is_cautious_and_does_not_double_count_obligations(monkeypatch):
    monkeypatch.setattr(registry, "get", lambda _: {"version": "test"})
    monkeypatch.setattr(spending_model, "predict", lambda *args: {
        "expected_gel": 1400, "cautious_gel": 1800, "coverage_target": .9, "contributions": [],
    })
    ing = {"cashflow": {"income": [2400] * 6, "spend_gel": [1500] * 6, "spend_usd": [0] * 6,
                       "essential": [1000] * 6},
           "metrics": {"savings_velocity": 900, "essential_spend": 1000}, "months_of_history": 6}
    assert spending.assess(ing, False)["affordable_monthly_gel"] == 600
    assert spending.assess(ing, True)["affordable_monthly_gel"] == 0
    ing["months_of_history"] = 2
    assert spending.assess(ing, False)["affordable_monthly_gel"] == 0


def _longitudinal_csv(path, future_spend=200, months=None):
    months = months or [f"{2024 + i // 12}-{i % 12 + 1:02d}" for i in range(24)]
    with path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=external.REQUIRED)
        writer.writeheader()
        for i, month in enumerate(months):
            row = dict(customer_id="test", month=month, income=100, liquid_balance=1000,
                       total_savings=2000, age=35, gender="f", region="tbilisi",
                       income_type="salaried", dependents=0)
            row.update({f"spend_{cat}": 0 for cat in CATEGORIES})
            row["spend_groceries"] = 50 if i < 12 else future_spend
            writer.writerow(row)


def test_external_targets_use_future_cash_flows_without_feature_leakage(tmp_path):
    a, b = tmp_path / "a.csv", tmp_path / "b.csv"
    _longitudinal_csv(a, 200)
    _longitudinal_csv(b, 300)
    aa, bb = external.load_csv(str(a)), external.load_csv(str(b))
    assert np.array_equal(aa["X"], bb["X"])
    assert np.array_equal(aa["spend_history"], bb["spend_history"])
    assert aa["cash_need_gel"][0] == 1200 and bb["cash_need_gel"][0] == 2400
    assert aa["next_spend_gel"][0] == 200 and bb["next_spend_gel"][0] == 300


def test_external_loader_rejects_duplicate_or_missing_months(tmp_path):
    path = tmp_path / "gaps.csv"
    months = [f"{2024 + i // 12}-{i % 12 + 1:02d}" for i in range(24)]
    months[10] = months[9]
    _longitudinal_csv(path, months=months)
    with pytest.raises(ValueError, match="unique consecutive"):
        external.load_csv(str(path))


def test_unlabelled_workbook_does_not_fabricate_regression_targets():
    from danazogi.data.organiser_xlsx import DEFAULT_XLSX

    workbook, synthetic = external.load_xlsx(str(DEFAULT_XLSX)), generate(20000, seed=7)
    for key in ("X", "cash_need_gel", "next_spend_gel", "spend_history"):
        assert np.array_equal(workbook[key], synthetic[key])


def _assess(monkeypatch, cautious, expected=0.0, essential=100.0, assets=10000.0, months=12,
            partial=False, cv=0.1):
    pred = {"expected_gel": expected, "cautious_gel": cautious, "coverage_target": 0.9,
            "contributions": {}, "explanation_method": "test"}
    monkeypatch.setattr(cash_model, "predict", lambda *a, **k: pred)
    return liquidity.assess({"income_cv": cv}, essential, assets, months, partial)


def test_reserve_basis_all_assets_when_essential_unmeasurable(monkeypatch):
    r = _assess(monkeypatch, 0.0, essential=0.0, assets=5000.0)
    assert r["reserve_basis"] == "all_assets"
    assert r["required_buffer_gel"] == 5000.0 and r["buffer_shortfall_gel"] == 0.0


def test_reserve_basis_cash_need_model_when_cautious_exceeds_minimum(monkeypatch):
    r = _assess(monkeypatch, 400.0, essential=100.0, months=12, cv=0.1)
    assert r["reserve_basis"] == "cash_need_model"
    assert r["required_buffer_gel"] == 400.0 and r["minimum_months"] == 3.0


def test_reserve_basis_minimum_rule_when_forecast_lower(monkeypatch):
    r = _assess(monkeypatch, 100.0, essential=100.0, months=12, cv=0.1)
    assert r["reserve_basis"] == "minimum_rule"
    assert r["required_buffer_gel"] == 300.0 and r["minimum_gel"] == 300.0


def test_reserve_basis_fallback_minimum_on_short_or_irregular_history(monkeypatch):
    r = _assess(monkeypatch, 100.0, essential=100.0, months=6, cv=0.6)
    assert r["reserve_basis"] == "fallback_minimum" and r["minimum_months"] == 6.0
    assert r["fallback"]["reasons"] == ["short_irregular_history"]

    r = _assess(monkeypatch, 100.0, essential=100.0, months=6, cv=0.1)
    assert not r["fallback"]["reasons"] and r["minimum_months"] == 3.0

    r = _assess(monkeypatch, 100.0, essential=100.0, months=5, cv=0.6)
    assert "short_history" in r["fallback"]["reasons"]

    r = _assess(monkeypatch, 100.0, essential=100.0, months=12, cv=0.6)
    assert not r["fallback"]["reasons"]  # full history: irregularity alone is not a reason


def test_bound_collapsed_flag(monkeypatch):
    assert _assess(monkeypatch, 10.4, expected=10.0)["bound_collapsed"]
    assert not _assess(monkeypatch, 10.6, expected=10.0)["bound_collapsed"]


def test_liquidity_diagnostics_on_small_cohorts():
    from danazogi.ml import diagnostics
    out = diagnostics.run(data=generate(800, seed=11), stress=generate(400, seed=12, shock=True))
    for regime in ("test", "stress"):
        r = out["reserve_effect"][regime]
        for k in ("model_sets_reserve_share", "reserve_coverage_with_model",
                  "reserve_coverage_rule_only", "bound_collapsed_share"):
            assert 0.0 <= r[k] <= 1.0
        assert r["reserve_coverage_with_model"] >= r["reserve_coverage_rule_only"] - 1e-9
        for g in out["short_history"][regime]["groups"].values():
            if g["n"] > 0:
                assert g["reserve_coverage_6m_floor"] >= g["reserve_coverage_3m_floor"] - 1e-9
