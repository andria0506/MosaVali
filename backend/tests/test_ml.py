import csv

import numpy as np
import pytest

from danazogi.ml import external, peer_model, registry
from danazogi.ml.cohort import CATEGORIES, ESSENTIAL, FEATURE_KEYS, generate


def test_cohort_is_deterministic():
    a, b = generate(500, seed=3), generate(500, seed=3)
    assert np.array_equal(a["X"], b["X"]) and np.array_equal(a["y"], b["y"])


def test_protected_attributes_are_not_model_inputs():
    assert not {"gender", "age", "region"} & set(FEATURE_KEYS)
    assert registry.get("liquidity")["fairness"]["protected_attributes_used_as_inputs"] is False


@pytest.mark.parametrize("kind", ["liquidity", "spending"])
def test_regression_metrics_and_selection_are_recorded(kind):
    bundle = registry.get(kind)
    assert bundle["schema_version"] == 2
    metrics = bundle["metrics"]
    winner = min(metrics["validation"], key=lambda k: metrics["validation"][k]["rmse_gel"])
    assert bundle["winner"] == winner
    assert "auc" not in metrics["test"]["selected"]
    for regime in ("test", "stress_regime"):
        for candidate in ("champion", "challenger", "selected", "baseline"):
            row = metrics[regime][candidate]
            assert np.isfinite([row["mae_gel"], row["rmse_gel"], row["r2"]]).all()
            assert row["rmse_gel"] >= row["mae_gel"] >= 0
        assert 0 <= metrics[regime]["selected"]["upper_coverage"] <= 1
    assert bundle["data"]["calibration_n"] > 0


def test_champion_challenger_decision_is_recorded():
    bundle = registry.get("liquidity")
    assert bundle["winner"] in ("champion", "challenger") and bundle["decision"]


def test_peer_groups_respect_k_anonymity_and_are_stable():
    peers = registry.get("peers")
    assert min(g["size"] for g in peers["groups"]) >= peer_model.MIN_GROUP
    assert peers["stability_ari"] > 0.5


def test_peer_groups_depend_on_age():
    peers = registry.get("peers")
    young = peer_model.assign(peers, 2150, 25, 1, "salaried", "tbilisi")
    older = peer_model.assign(peers, 2150, 58, 1, "salaried", "tbilisi")
    assert young["id"] != older["id"]


def test_essential_spending_is_never_counted_as_savings():
    group = registry.get("peers")["groups"][0]
    spend = {c: 10_000.0 for c in CATEGORIES}
    out = peer_model.opportunities(group, spend)
    assert all(r["monthly_saving"] == 0 for r in out["rows"] if r["category"] in ESSENTIAL)
    assert out["monthly_total"] > 0


def _write_csv(path, customers=40, months=24, seed=1):
    rng = np.random.default_rng(seed)
    with open(path, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(external.REQUIRED)
        for c in range(customers):
            savings = 5000.0
            for m in range(months):
                inc = 2000 * rng.lognormal(0, 0.2)
                spend = {cat: rng.uniform(10, 200) for cat in CATEGORIES}
                savings += inc - sum(spend.values())
                w.writerow([f"c{c}", f"2024-{m // 12 + 1:02d}-{m % 12 + 1:02d}"[:7] if False else f"{2024 + m // 12}-{m % 12 + 1:02d}",
                            round(inc, 2), round(savings * 0.5, 2), round(savings, 2), 35, "f" if c % 2 else "m",
                            "tbilisi", "salaried", 1] + [round(spend[cat], 2) for cat in CATEGORIES])


def test_external_loader_builds_training_matrix(tmp_path):
    path = tmp_path / "data.csv"
    _write_csv(path)
    data = external.load_csv(str(path))
    assert data["X"].shape == (40, len(FEATURE_KEYS))
    assert set(np.unique(data["y"])) <= {0, 1}
    assert data["category_spend"].shape == (40, len(CATEGORIES))
    assert data["cash_need_gel"].shape == (40,)
    assert data["next_spend_gel"].shape == (40,)
    assert data["income_history"].shape == (40, 12)


def test_external_loader_rejects_missing_columns(tmp_path):
    path = tmp_path / "bad.csv"
    path.write_text("customer_id,month\nc1,2024-01\n", encoding="utf-8")
    with pytest.raises(ValueError, match="Missing columns"):
        external.load_csv(str(path))


def test_organiser_xlsx_evaluation_and_model_cards():
    cards = registry.model_cards()
    org = cards.get("organiser_dataset")
    assert org is not None
    assert org["customers"] == 100 and org["transactions"] == 23869
    assert len(org["by_profile"]) == 7
    assert org["validation_kind"] == "inference_only"
    assert "mean_p12" not in org
    assert cards["spending"]["data"]["label"]
