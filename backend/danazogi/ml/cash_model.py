from . import regression
from .cohort import FEATURES, FEATURE_KEYS, generate

VERSION = "liquidity-regression-2.0"


def train(train_data: dict | None = None, stress_data: dict | None = None) -> dict:
    return regression.train("liquidity", train_data or generate(),
                            stress_data or generate(5000, seed=103, shock=True), FEATURES, VERSION)


def predict(bundle: dict, features: dict, essential_spend: float) -> dict:
    return regression.predict(bundle, [features[k] for k in FEATURE_KEYS], max(essential_spend, 1.0))
