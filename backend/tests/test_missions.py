from danazogi.agents import missions


def _engine(client, connect, persona="nino"):
    cid, h = connect(persona)
    view = client.get(f"/api/sessions/{cid}/missions", headers=h).json()
    from danazogi.api import store
    from danazogi import orchestrator
    eng, _ = orchestrator.engine(store.get(cid, h["X-Consent-Token"]), None)
    return eng, view


def test_probability_rises_with_monthly_contribution(client, connect):
    eng, _ = _engine(client, connect)
    w, _, glide = eng.mission_weights("goal")
    probs = [eng.probability(w, glide, m) for m in (0, 300, 600, 1200)]
    assert probs == sorted(probs) and probs[-1] > probs[0]


def test_protect_has_the_lowest_tail_risk(client, connect):
    _, view = _engine(client, connect)
    cvar = {m["key"]: m["cvar95"] for m in view["missions"]}
    assert cvar["protect"] <= min(cvar.values()) + 1e-9


def test_extra_monthly_lever_reaches_target(client, connect):
    eng, view = _engine(client, connect)
    lv = view["levers"]
    if lv["on_track"]:
        return
    w, _, glide = eng.mission_weights(view["focus"])
    assert eng.probability(w, glide, view["monthly"] + lv["extra_monthly"] + 1) >= missions.TARGET_PROB


def test_cash_is_the_worst_strategy(client, connect):
    _, view = _engine(client, connect)
    s = {x["key"]: x for x in view["strategies"]}
    assert s["cash"]["probability"] <= min(s["deposit"]["probability"], s["plan"]["probability"])


def test_savings_finder_feeds_the_goal(client, connect):
    _, view = _engine(client, connect)
    boost = view["levers"].get("savings_boost")
    assert boost and boost["probability"] >= view["levers"]["probability"]


def test_goal_mission_has_the_best_chance_within_capacity(client, connect):
    for persona in ("nino", "giorgi"):
        eng, view = _engine(client, connect, persona)
        p = {m["key"]: m["probability"] for m in view["missions"]}
        best = max(eng.probability(w, g) for lvl, w in eng.levels.items() if lvl <= eng.ctx.max_level for g in (True, False))
        assert p["goal"] >= best - 0.005
        if eng.ctx.max_level >= 5:
            assert p["goal"] >= p["balance"] - 1e-9


def test_preserve_goal_uses_no_contributions(client, connect):
    _, view = _engine(client, connect, "lamara")
    assert view["monthly"] == 0 and view["recommended"] == "protect"


def test_recommendation_reason_best_chance_for_demo_personas(client, connect):
    for persona in ("nino", "giorgi", "tamar"):
        cid, h = connect(persona)
        view = client.get(f"/api/sessions/{cid}/missions", headers=h).json()
        rec = next(m for m in view["missions"] if m["key"] == view["recommended"])
        assert view["recommendation_reason"] == "best_chance"
        assert 0.05 <= rec["probability"] <= 0.95


def test_recommendation_reason_none_reach_and_all_reach(client, connect):
    cid, h = connect("nino")
    client.put(f"/api/sessions/{cid}/goal", headers=h,
               json={"kind": "car", "amount": 10_000_000, "currency": "USD", "years": 4})
    view = client.get(f"/api/sessions/{cid}/missions", headers=h).json()
    assert view["recommendation_reason"] == "none_reach"
    en = view["recommendation_text"]["en"]
    assert "What would help" in en or "editing the goal" in en

    client.put(f"/api/sessions/{cid}/goal", headers=h,
               json={"kind": "car", "amount": 100, "currency": "USD", "years": 4})
    view = client.get(f"/api/sessions/{cid}/missions", headers=h).json()
    assert view["recommendation_reason"] == "all_reach_lowest_risk"


def test_recommendation_reason_preserve_goal(client, connect):
    cid, h = connect("lamara")
    view = client.get(f"/api/sessions/{cid}/missions", headers=h).json()
    assert view["recommendation_reason"] == "preserve_goal"


def test_organiser_recommendation_distribution():
    import statistics
    from danazogi import orchestrator as orch
    from danazogi.api import store
    from danazogi.consent import SCOPES
    from danazogi.data.mock_open_banking import PERSONAS
    probs = []
    for pid, p in PERSONAS.items():
        if p.get("source") != "organiser_xlsx":
            continue
        s = store.create(pid, p["banks"], list(SCOPES), 90, p["cash_at_home"], None)
        view = orch.missions_view(s)
        rec = next(m for m in view["missions"] if m["key"] == view["recommended"])
        probs.append(rec["probability"])
    assert len(probs) == 100
    assert 0.30 <= statistics.median(probs) <= 0.70
    assert sum(1 for x in probs if x < 0.005) <= 10
