from . import regression
from .cohort import generate

VERSION = "spending-regression-1.0"


def train(train_data: dict | None = None, stress_data: dict | None = None) -> dict:
    return regression.train("spending", train_data or generate(),
                            stress_data or generate(5000, seed=103, shock=True),
                            regression.SPENDING_FEATURES, VERSION)


def predict(bundle: dict, income, spend, essential) -> dict:
    X, scale = regression.spending_design(income, spend, essential)
    return regression.predict(bundle, X[0], float(scale[0]))
