"""Peer agent: applies Model 2 to find the user's situation group and the money they could redirect."""

from ..ml import peer_model, registry


def compare(ing: dict) -> dict:
    bundle = registry.get("peers")
    psu = ing["psu"]
    group = peer_model.assign(bundle, ing["metrics"]["monthly_income"], psu["age"], max(psu["household"] - 1, 0),
                              ing["income_type"], psu["region"])
    out = peer_model.opportunities(group, ing["peer_spend"])
    out["model_version"] = bundle["version"]
    out["income_type"] = ing["income_type"]
    return out
