from danazogi.agents.sandbox import Flight
from danazogi.data.market import ASSET_INDEX

GROWTH = {"TBILL": 0.4, "ETF": 0.4, "GEL_DEP": 0.2}


def _run(actions: dict[int, str], weights=None, goal_usd=13000, mission="growth", chapters=None):
    f = Flight(weights or GROWTH, mission, goal_usd, chapters)
    for i in range(len(f.steps)):
        f.step(actions.get(i, "hold"))
    return f


def _panic(weights=None, mission="growth"):
    f = Flight(weights or GROWTH, mission, 13000)
    sold = False
    while not f.done:
        dd = 1 - f.buying_power / f.peak
        f.step("sell" if dd >= 0.04 and not sold else "hold")
        sold = sold or any(a["action"] == "sell" for a in f.actions)
    return f


def test_holding_matches_the_passive_path():
    f = _run({})
    r = f.result()
    assert abs(r["final_value"] - r["passive_value"]) < 1e-6 and r["panic_sells"] == 0


def test_panic_selling_lowers_the_behaviour_score():
    held = _run({}).result()
    panicked = _panic().result()
    assert panicked["panic_sells"] == 1
    assert panicked["score"] is not None and held["score"] is not None
    assert panicked["score"] <= held["score"]


def test_holding_through_a_real_drop_qualifies_for_the_mission_flown():
    r = _run({}).result()
    assert r["max_drawdown"] >= 0.05
    assert r["score"] >= 8 and "growth" in r["fits"]


def test_a_panic_sale_cannot_qualify_for_the_mission_fled():
    r = _panic().result()
    assert "growth" not in r["fits"]


def test_sell_never_breaks_term_deposits():
    f = Flight({"GEL_DEP": 0.5, "ETF": 0.3, "LIQ": 0.2}, "balance", None)
    before = f.hold[ASSET_INDEX["GEL_DEP"]]
    f.apply("sell")
    assert f.hold[ASSET_INDEX["GEL_DEP"]] == before
    assert f.hold[ASSET_INDEX["ETF"]] == 0


def test_buy_more_needs_market_assets_in_the_plan():
    f = Flight({"GEL_DEP": 0.6, "LIQ": 0.4}, "protect", None)
    assert not f.available()["buy"]["ok"]
    before = f.hold.copy()
    f.apply("buy")
    assert (f.hold == before).all()


def test_until_decision_stops_after_each_decision_month():
    f = Flight(GROWTH, "growth", 13000, ["S15"])
    first = f.advance("hold", until_decision=True)
    assert first["decision"]["month"] == "2015-01" and first["chapters"] == ["S15"]
    second = f.advance("hold", until_decision=True)
    assert second["decision"]["month"] == "2015-08"
    last = f.advance("hold", until_decision=True)
    assert last["done"] and last["result"] is not None


def test_ghost_lines_follow_every_mission():
    ghosts = {"protect": {"LIQ": 1.0}, "growth": GROWTH}
    f = Flight(GROWTH, "growth", 13000, ["S20"], ghosts=ghosts)
    while not f.done:
        f.step("hold")
    assert set(f.history[-1]["ghosts"]) == {"protect", "growth"}
    assert abs(f.history[-1]["ghosts"]["growth"] - f.history[-1]["buying_power"]) < 1e-6


def test_coach_speaks_georgian_and_english():
    f = _run({})
    assert f.coach and all(c["ka"] and c["en"] for c in f.coach)
