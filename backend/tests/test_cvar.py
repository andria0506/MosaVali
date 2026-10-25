import numpy as np

from danazogi.agents import stress
from danazogi.data.market import ASSETS


def _setup():
    R = stress.real_returns(4, 0.7)
    cons = stress.Constraints(buffer_share=0.3, equity_cap=0.25, buffer_usd_share=0.2)
    return R, cons


def test_min_cvar_lp_matches_empirical_cvar_and_respects_bounds():
    R, cons = _setup()
    w = stress._solve(R, cons, None)
    assert abs(w.sum() - 1) < 1e-9
    for x, (lo, hi) in zip(w, cons.bounds()):
        assert lo - 1e-7 <= x <= hi + 1e-7
    assert w[[i for i, a in enumerate(ASSETS) if a.key in stress.LIQUID]].sum() >= cons.buffer_share - 1e-7
    assert w[[i for i, a in enumerate(ASSETS) if a.key == "CASH"]][0] < 1e-9
    # No random feasible portfolio should beat the LP's CVaR.
    rng = np.random.default_rng(0)
    best = stress.cvar(1 - R @ w)
    lo = np.array([b[0] for b in cons.bounds()])
    hi = np.array([b[1] for b in cons.bounds()])
    for _ in range(300):
        x = lo + rng.random(len(w)) * (hi - lo)
        x = x / x.sum()
        if np.all(x <= hi + 1e-9) and np.all(x >= lo - 1e-9):
            assert stress.cvar(1 - R @ x) >= best - 1e-9


def test_frontier_is_monotone():
    R, cons = _setup()
    fr = stress.frontier(R, cons)
    cv = [stress.cvar(1 - R @ fr[k]) for k in sorted(fr)]
    mu = [float((R @ fr[k]).mean()) for k in sorted(fr)]
    assert all(b >= a - 1e-6 for a, b in zip(cv, cv[1:]))
    assert all(b >= a - 1e-6 for a, b in zip(mu, mu[1:]))


def test_lari_shock_hurts_gel_holder_with_usd_goal():
    p = stress.stress_path(1, {"fx": 0.33, "inflation": 0.05, "rate": 0.04, "equity": -0.01})
    gel_dep = p["growth"][[i for i, a in enumerate(ASSETS) if a.key == "GEL_DEP"][0]] / p["usd_index"]
    usd_dep = p["growth"][[i for i, a in enumerate(ASSETS) if a.key == "USD_DEP"][0]] / p["usd_index"]
    assert gel_dep < 0.85 < usd_dep
