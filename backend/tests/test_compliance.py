def test_vulnerable_customer_cannot_choose_growth(client, connect):
    cid, h = connect("lamara")
    view = client.get(f"/api/sessions/{cid}/missions", headers=h).json()
    cards = {m["key"]: m for m in view["missions"]}
    assert "VULN-01" in cards["growth"]["compliance"]["blocking_rules"]
    assert "VULN-01" in cards["balance"]["compliance"]["blocking_rules"]
    assert not cards["protect"]["compliance"]["blocked"]
    r = client.post(f"/api/sessions/{cid}/plan", headers=h, json={"mission": "growth"})
    assert r.status_code == 409 and "VULN-01" in r.json()["compliance"]["blocking_rules"]
    r = client.post(f"/api/sessions/{cid}/plan", headers=h, json={"mission": "protect"})
    assert r.status_code == 200


def test_mission_above_capacity_needs_acknowledgment(client, connect):
    cid, h = connect("nino")
    r = client.post(f"/api/sessions/{cid}/plan", headers=h, json={"mission": "growth"})
    assert r.status_code == 409 and "CAP-01" in r.json()["missing"]
    r = client.post(f"/api/sessions/{cid}/plan", headers=h, json={"mission": "growth", "acknowledge": ["CAP-01"]})
    assert r.status_code == 200 and r.json()["acknowledged"] == ["CAP-01"]
    events = [e["event"] for e in client.get(f"/api/sessions/{cid}/audit", headers=h).json()["entries"]]
    assert "warning.acknowledged" in events


def test_trade_edit_beyond_limit_is_blocked_and_cannot_be_approved(client, connect):
    cid, h = connect("nino")
    trades = client.post(f"/api/sessions/{cid}/plan", headers=h, json={"mission": "goal"}).json()["trades"]
    accounts = client.get(f"/api/sessions/{cid}/profile", headers=h).json()["ingestion"]["accounts"]
    etf = max((t for t in trades if t["asset"] == "ETF"),
              key=lambda t: next(a["balance_gel"] for a in accounts if a["id"] == t["from"]["account"]))
    room = next(a["balance_gel"] for a in accounts if a["id"] == etf["from"]["account"])
    r = client.post(f"/api/sessions/{cid}/trades/{etf['id']}", headers=h, json={"decision": "edit", "amount_gel": room})
    assert r.status_code == 200 and r.json()["status"] == "blocked"
    assert any(c["rule"] == "CONC-01" for c in r.json()["checks"])
    r = client.post(f"/api/sessions/{cid}/trades/{etf['id']}", headers=h, json={"decision": "approve"})
    assert r.status_code == 409


def test_recurring_amount_above_cash_flow_is_blocked(client, connect):
    cid, h = connect("nino")
    trades = client.post(f"/api/sessions/{cid}/plan", headers=h, json={"mission": "goal"}).json()["trades"]
    auto = next(t for t in trades if t.get("kind") == "recurring")
    r = client.post(f"/api/sessions/{cid}/trades/{auto['id']}", headers=h, json={"decision": "edit", "amount_gel": 50_000})
    assert r.json()["status"] == "blocked" and r.json()["checks"][0]["rule"] == "AFF-01"


def test_instruction_requires_an_approved_trade(client, connect):
    cid, h = connect("nino")
    trades = client.post(f"/api/sessions/{cid}/plan", headers=h, json={"mission": "goal"}).json()["trades"]
    assert client.get(f"/api/sessions/{cid}/instruction", headers=h).status_code == 409
    client.post(f"/api/sessions/{cid}/trades/{trades[0]['id']}", headers=h, json={"decision": "approve"})
    doc = client.get(f"/api/sessions/{cid}/instruction", headers=h).json()
    assert [s["id"] for s in doc["steps"]] == [trades[0]["id"]]


def test_buffer_alert_text_follows_reserve_basis():
    from danazogi.agents import profiler
    ing = {"metrics": {"idle_cash_gel": 0.0, "usd_spend_share": 0.0, "essential_usd_share": 0.0},
           "features": {"liquid_months": 1.0, "income_cv": 0.1, "obligation_ratio": 0.1, "fx_debt_ratio": 0.0},
           "psu": {"age": 30, "birthYear": 1996, "household": 1}, "accounts": []}
    goal = profiler.custom_goal("car", 5000, "USD", 4)
    for basis, frag in (("cash_need_model", "cautious estimate asks for"),
                        ("minimum_rule", "minimum-reserve rule asks for 3 months"),
                        ("fallback_minimum", "at least 6 months")):
        liq = {"buffer_months": 3.0, "reserve_basis": basis}
        alert = next(a for a in profiler.profile(ing, liq, goal)["alerts"] if a["kind"] == "buffer")
        assert frag in alert["en"], basis


def _pf_ing(total, holdings, accounts):
    return {"totals": {"assets_gel": total}, "holdings_gel": holdings, "accounts": accounts, "cash_at_home": 0.0}


def _pf_trade(tid, source, asset, amount, date=""):
    return {"id": tid, "kind": "one_off", "status": "proposed", "asset": asset, "date": date,
            "amount_gel": amount, "from": {"account": source}}


def test_portfolio_check_flags_combined_source_overspend():
    from danazogi.agents import compliance
    ing = _pf_ing(1000, {"CASH": 500, "LIQ": 500},
                  [{"id": "c1", "asset": "CASH", "balance_gel": 500}, {"id": "l1", "asset": "LIQ", "balance_gel": 500}])
    trades = [_pf_trade("a", "c1", "GEL_DEP", 300), _pf_trade("b", "c1", "TBILL", 300)]
    rules = [c["rule"] for c in compliance.check_portfolio(ing=ing, trades=trades, buffer_gel=0.0, equity_cap=0.4)]
    assert rules == ["SOURCE-01"]


def test_portfolio_check_flags_buffer_drain_and_concentration():
    from danazogi.agents import compliance
    ing = _pf_ing(1000, {"LIQ": 1000}, [{"id": "l1", "asset": "LIQ", "balance_gel": 1000}])
    trades = [_pf_trade("a", "l1", "ETF", 200), _pf_trade("b", "l1", "TBILL", 400)]
    rules = [c["rule"] for c in compliance.check_portfolio(ing=ing, trades=trades, buffer_gel=500.0, equity_cap=0.4)]
    assert "BUF-01" in rules and "SOURCE-01" not in rules

    ing = _pf_ing(1000, {"CASH": 500, "LIQ": 500},
                  [{"id": "c1", "asset": "CASH", "balance_gel": 500}, {"id": "l1", "asset": "LIQ", "balance_gel": 500}])
    solo = [c["rule"] for c in compliance.check_portfolio(ing=ing, trades=[_pf_trade("a", "c1", "ETF", 250)],
                                                        buffer_gel=0.0, equity_cap=0.4)]
    assert solo == []
    trades = [_pf_trade("a", "c1", "ETF", 250), _pf_trade("b", "l1", "ETF", 250)]
    rules = [c["rule"] for c in compliance.check_portfolio(ing=ing, trades=trades, buffer_gel=0.0, equity_cap=0.4)]
    assert "CONC-01" in rules


def test_future_maturity_cannot_fund_current_buffer():
    from danazogi.agents import compliance
    ing = _pf_ing(1000, {"CASH": 500, "GEL_DEP": 500},
                  [{"id": "c1", "asset": "CASH", "balance_gel": 500},
                   {"id": "d1", "asset": "GEL_DEP", "balance_gel": 500}])
    later = [_pf_trade("a", "d1", "LIQ", 500, date="2026-12-01"),
             _pf_trade("b", "c1", "ETF", 200, date="2026-10-26")]
    rules = [c["rule"] for c in compliance.check_portfolio(ing=ing, trades=later, buffer_gel=500.0, equity_cap=0.4)]
    assert rules == ["BUF-01"]
    same = [_pf_trade("a", "d1", "LIQ", 500, date="2026-12-01"),
            _pf_trade("b", "c1", "ETF", 200, date="2026-12-01")]
    assert compliance.check_portfolio(ing=ing, trades=same, buffer_gel=500.0, equity_cap=0.4) == []


def _controlled_profile(ing):
    return {"ingestion": {**ing, "metrics": {"essential_usd_share": 0.0}, "psu": {"name_ka": "x", "name_en": "x"}},
            "liquidity": {"buffer_gel": 500.0, "buffer_share": 0.0, "free_to_invest_gel": 0.0, "high_need": False},
            "spending": {"affordable_monthly_gel": 0.0},
            "profile": {"capacity": {"equity_cap": 0.4, "level": 5}, "horizon": 4, "usd_liability_share": 0.0,
                        "goal": {"kind": "car", "target_today_gel": 1000.0, "usd_indexed": 1.0}},
            "inflation": {"personal": 0.04}}


def test_rejected_funding_step_invalidates_approved_subset(client, monkeypatch):
    from danazogi import orchestrator as orch
    from danazogi.api import store
    ing = _pf_ing(1000, {"LIQ": 200, "GEL_DEP": 800},
                  [{"id": "l1", "asset": "LIQ", "balance_gel": 200},
                   {"id": "d1", "asset": "GEL_DEP", "balance_gel": 800}])
    monkeypatch.setattr(orch, "profile", lambda s: _controlled_profile(ing))
    monkeypatch.setattr(orch, "_selected_check", lambda s: None)
    s = store.create("nino", ["MT"], ["balances", "transactions"], 90, 0.0, None)
    h = {"X-Consent-Token": s.token}
    s.selected_mission = "goal"
    s.selected_monthly = 0.0
    s.trades = [_pf_trade("p2-f", "d1", "LIQ", 400, date="2026-10-26"),
                _pf_trade("p2-i", "l1", "ETF", 100, date="2026-10-26")]
    url = f"/api/sessions/{s.consent_id}/trades"
    assert client.post(f"{url}/p2-f", headers=h, json={"decision": "approve"}).status_code == 200
    assert client.post(f"{url}/p2-i", headers=h, json={"decision": "approve"}).status_code == 200
    assert client.post(f"{url}/p2-f", headers=h, json={"decision": "reject"}).status_code == 200
    r = client.get(f"/api/sessions/{s.consent_id}/instruction", headers=h)
    assert r.status_code == 409 and any(c["rule"] == "BUF-01" for c in r.json()["checks"])
    assert s.trades[1]["status"] == "approved"


def test_cumulative_approvals_and_instruction_recheck(client, monkeypatch):
    from danazogi import orchestrator as orch
    from danazogi.api import store
    ing = _pf_ing(1000, {"CASH": 500, "LIQ": 500},
                  [{"id": "c1", "asset": "CASH", "balance_gel": 500}, {"id": "l1", "asset": "LIQ", "balance_gel": 500}])
    p = {"ingestion": {**ing, "metrics": {"essential_usd_share": 0.0}, "psu": {"name_ka": "x", "name_en": "x"}},
         "liquidity": {"buffer_gel": 0.0, "buffer_share": 0.0, "free_to_invest_gel": 0.0, "high_need": False},
         "spending": {"affordable_monthly_gel": 0.0},
         "profile": {"capacity": {"equity_cap": 0.4, "level": 5}, "horizon": 4, "usd_liability_share": 0.0,
                     "goal": {"kind": "car", "target_today_gel": 1000.0, "usd_indexed": 1.0}},
         "inflation": {"personal": 0.04}}
    monkeypatch.setattr(orch, "profile", lambda s: p)
    monkeypatch.setattr(orch, "_selected_check", lambda s: None)
    s = store.create("nino", ["MT"], ["balances", "transactions"], 90, 0.0, None)
    h = {"X-Consent-Token": s.token}
    s.selected_mission = "goal"
    s.selected_monthly = 0.0
    s.trades = [_pf_trade("p1-a", "c1", "GEL_DEP", 300), _pf_trade("p1-b", "c1", "TBILL", 300)]
    url = f"/api/sessions/{s.consent_id}/trades"
    assert client.post(f"{url}/p1-a", headers=h, json={"decision": "approve"}).status_code == 200
    assert client.post(f"{url}/p1-a", headers=h, json={"decision": "approve"}).status_code == 200
    assert [e["event"] for e in s.audit.entries].count("trade.approved") == 1
    r = client.post(f"{url}/p1-b", headers=h, json={"decision": "approve"})
    assert r.status_code == 409 and any(c["rule"] == "SOURCE-01" for c in r.json()["checks"])
    assert client.get(f"/api/sessions/{s.consent_id}/instruction", headers=h).status_code == 200
    client.post(f"{url}/p1-a", headers=h, json={"decision": "reject"})
    assert client.get(f"/api/sessions/{s.consent_id}/instruction", headers=h).status_code == 409


def test_changed_simulator_score_is_rechecked(client, connect):
    cid, h = connect("nino")
    plan = client.post(f"/api/sessions/{cid}/plan", headers=h, json={"mission": "goal"}).json()
    first, second = plan["trades"][0], plan["trades"][1]
    assert client.post(f"/api/sessions/{cid}/trades/{first['id']}", headers=h, json={"decision": "approve"}).status_code == 200
    from danazogi.api import store
    s = store.get(cid, h["X-Consent-Token"])
    s.behaviour_score = 1
    r = client.post(f"/api/sessions/{cid}/trades/{second['id']}", headers=h, json={"decision": "approve"})
    assert r.status_code == 409 and "BEH-01" in r.json()["missing"]
    assert client.get(f"/api/sessions/{cid}/instruction", headers=h).status_code == 409
    r = client.post(f"/api/sessions/{cid}/plan", headers=h, json={"mission": "goal", "acknowledge": ["BEH-01"]})
    assert r.status_code == 200 and "BEH-01" in r.json()["acknowledged"]
