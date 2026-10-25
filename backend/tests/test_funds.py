import numpy as np

from danazogi.agents import funds, stress
from danazogi.data.market import ASSET_INDEX, FUNDS


def test_world_fund_matches_the_plan_etf():
    f = stress.factors(4)
    world = next(x for x in FUNDS if x.key == "WORLD")
    assert np.allclose(funds.fund_returns(world, f, 0), f["annual"][:, :, ASSET_INDEX["ETF"]])


def test_fund_comparison_covers_every_fund_type(client, connect):
    cid, h = connect("nino")
    view = client.get(f"/api/sessions/{cid}/funds", headers=h).json()
    assert [x["key"] for x in view["funds"]] == [x.key for x in FUNDS]
    assert all(0 <= x["probability"] <= 1 for x in view["funds"])
    assert set(view["funds"][0]["episodes"]) == {"S08", "S15", "S20", "S22"}
    assert view["plan"]["key"] == "goal" and view["disclaimer_en"]
    events = [e["event"] for e in client.get(f"/api/sessions/{cid}/audit", headers=h).json()["entries"]]
    assert "funds.compared" in events


def test_one_stock_raises_tail_risk_and_never_becomes_a_trade(client, connect):
    cid, h = connect("nino")
    r = client.post(f"/api/sessions/{cid}/stock-check", headers=h, json={"profile": "ge_bank", "share": 0.2}).json()
    assert r["with_stock"]["worst5_real_value"] < r["plan"]["worst5_real_value"]
    assert r["with_stock"]["yearly_swing"] > r["plan"]["yearly_swing"]
    assert r["rule"]["code"] == "PROD-01"
    assert client.get(f"/api/sessions/{cid}/trades", headers=h).json()["trades"] == []
    entry = next(e for e in client.get(f"/api/sessions/{cid}/audit", headers=h).json()["entries"]
                 if e["event"] == "stock_check.viewed")
    assert entry["details"]["added_to_plan"] is False


def test_stock_check_rejects_shares_outside_limits(client, connect):
    cid, h = connect("nino")
    r = client.post(f"/api/sessions/{cid}/stock-check", headers=h, json={"profile": "big_tech", "share": 0.6})
    assert r.status_code == 422
