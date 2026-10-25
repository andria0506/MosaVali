"""Train-or-load registry for the models, with versioned artifacts on disk.

`python -m danazogi.ml.registry` retrains the models and writes the
artifacts plus human-readable metrics JSON (used by the deck and the model
card). The API loads the artifacts, or trains on first use if none exist.
Legacy classifier artifacts are retrained, never served.
"""

import json
import threading
from pathlib import Path

import joblib

from . import cash_model, peer_model, regression, spending_model
from .cohort import generate

ARTIFACTS = Path(__file__).parent / "artifacts"
_lock = threading.Lock()
_cache: dict[str, dict] = {}

REGRESSION = {"liquidity": cash_model, "spending": spending_model}
REGRESSION_DROP = ("model", "upper_model")


def _strip(bundle: dict, drop: tuple[str, ...]) -> dict:
    return {k: v for k, v in bundle.items() if k not in drop}


def _current(bundle: dict, name: str) -> bool:
    module = REGRESSION.get(name)
    if module is None:
        return True
    return (bundle.get("schema_version") == regression.SCHEMA_VERSION
            and str(bundle.get("version", "")).startswith(module.VERSION))


def train_all(data: dict | None = None, source: str = "synthetic") -> dict:
    cohort = data or generate()
    liq = cash_model.train(cohort)
    spend = spending_model.train(cohort)
    peers = peer_model.train(cohort)
    if data:
        peers["data"]["source"] = f"External dataset ({source})"
    ARTIFACTS.mkdir(exist_ok=True)
    joblib.dump(liq, ARTIFACTS / "liquidity.joblib")
    joblib.dump(spend, ARTIFACTS / "spending.joblib")
    joblib.dump(peers, ARTIFACTS / "peers.joblib")
    (ARTIFACTS / "liquidity.metrics.json").write_text(
        json.dumps(_strip(liq, REGRESSION_DROP), indent=2, ensure_ascii=False), encoding="utf-8")
    (ARTIFACTS / "spending.metrics.json").write_text(
        json.dumps(_strip(spend, REGRESSION_DROP), indent=2, ensure_ascii=False), encoding="utf-8")
    (ARTIFACTS / "peers.metrics.json").write_text(
        json.dumps(_strip(peers, ("kmeans",)), indent=2, ensure_ascii=False), encoding="utf-8")
    _cache.pop("organiser_dataset", None)
    _cache.update({"liquidity": liq, "spending": spend, "peers": peers})
    return {"liquidity": liq, "spending": spend, "peers": peers}


def get(name: str) -> dict:
    if name not in ("liquidity", "spending", "peers"):
        raise ValueError(f"Unknown model {name}")
    with _lock:
        if name not in _cache:
            path = ARTIFACTS / f"{name}.joblib"
            if path.exists():
                bundle = joblib.load(path)
                if _current(bundle, name):
                    _cache[name] = bundle
            if name not in _cache:
                train_all()
        return _cache[name]


def model_cards() -> dict:
    liq, spend, peers = get("liquidity"), get("spending"), get("peers")
    if "organiser_dataset" not in _cache:
        from .external import evaluate_xlsx
        _cache["organiser_dataset"] = evaluate_xlsx(liq_bundle=liq, spending_bundle=spend, peer_bundle=peers)
    cards = {
        "liquidity": _strip(liq, REGRESSION_DROP),
        "spending": _strip(spend, REGRESSION_DROP),
        "peers": _strip(peers, ("kmeans",)),
        "organiser_dataset": _cache["organiser_dataset"],
    }
    diag = ARTIFACTS / "liquidity.diagnostics.json"
    if diag.exists():
        cards["liquidity"]["diagnostics"] = json.loads(diag.read_text(encoding="utf-8"))
    return cards


if __name__ == "__main__":
    out = train_all()
    for key in ("liquidity", "spending"):
        m = out[key]["metrics"]
        sel, base, stress = m["test"]["selected"], m["test"]["baseline"], m["stress_regime"]["selected"]
        print(out[key]["version"], out[key]["decision"])
        print("test MAE %.2f RMSE %.2f · baseline RMSE %.2f · upper coverage %.3f" % (
            sel["mae_gel"], sel["rmse_gel"], base["rmse_gel"], sel["upper_coverage"]))
        print("stress RMSE %.2f · coverage %.3f" % (stress["rmse_gel"], stress["upper_coverage"]))
    print(out["peers"]["version"], "k =", out["peers"]["k"], "stability ARI %.2f" % out["peers"]["stability_ari"])
