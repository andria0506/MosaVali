"""Fund-type comparison and the single-stock what-if.

Educational only. Every fund is a type, never a named product, and every
parameter is a labelled assumption (data/market.py). Both views reuse the
plan's own scenarios (stress.factors), so a global crash or a lari shock hits
every option in the same scenario-year, and results are measured against the
goal's own price index, exactly like the missions.

A single stock is never added to a plan or a trade (rule PROD-01): the
what-if only shows what concentration would do to the customer's odds.
"""

import numpy as np

from ..data.market import ASSET_INDEX, ASSETS, EPISODES, FUNDS, MACRO, STOCK_PROFILES
from . import stress
from .missions import FX_COST, Engine

SEED = 4242
ETF = ASSETS[ASSET_INDEX["ETF"]]
STOCKS = {f.key: f for f in STOCK_PROFILES}
EPISODE_CODES = ("S08", "S15", "S20", "S22")
_EPISODES = {e["code"]: e for e in EPISODES}
PROD_RULE = {
    "code": "PROD-01",
    "ka": "მხოლოდ დივერსიფიცირებული ფონდები: ეს შემოწმება საგანმანათლებლოა და ცალკეული აქცია თქვენს გეგმასა და ტრანზაქციებში არ დაემატება.",
    "en": "Diversified funds only: this check is educational, and a single stock is never added to your plan or trades.",
}


def fund_returns(fund, f: dict, seed_offset: int) -> np.ndarray:
    """Nominal GEL return of a fund or stock in every scenario-year, after fees. Shape (n, H)."""
    if fund.asset:
        return f["annual"][:, :, ASSET_INDEX[fund.asset]]
    n, h = f["eq"].shape
    rng = np.random.default_rng(SEED + 7919 * seed_offset + h)
    local = (fund.rate + fund.beta * (f["eq"] - ETF.rate) + rng.normal(0.0, fund.idio, (n, h))
             + fund.crisis * f["crisis"] - fund.fee)
    local = np.maximum(local, -0.85)
    return (1 + local) * (1 + f["fx"]) - 1 if fund.currency == "USD" else local


def _fx_cost(fund) -> float:
    return ASSETS[ASSET_INDEX[fund.asset]].fx_cost if fund.asset else fund.fx_cost


def _basket(path: dict, goal_usd: float) -> float:
    return (1 - goal_usd) * path["gel_index"] + goal_usd * path["usd_index"]


def episode_return(fund, code: str, goal_usd: float) -> float:
    """One-year stylised episode (same shocks as the stress tests), real return against the goal's price."""
    ep = _EPISODES[code]
    p = stress.stress_path(1, ep)
    if fund.asset:
        growth = float(p["growth"][ASSET_INDEX[fund.asset]])
    else:
        override = dict(fund.episodes).get(code)
        crisis = ep["fx"] >= MACRO["crisis_fx_min"]
        local = override if override is not None else (
            fund.rate + fund.beta * (ep["equity"] - ETF.rate) + fund.crisis * crisis - fund.fee)
        growth = ((1 + local) * (1 + ep["fx"]) if fund.currency == "USD" else 1 + local) * (1 - fund.fx_cost)
    return float(growth / _basket(p, goal_usd) - 1)


def _plan_episode(wpath0: np.ndarray, code: str, goal_usd: float) -> float:
    p = stress.stress_path(1, _EPISODES[code])
    return float((p["growth"] @ wpath0) / _basket(p, goal_usd) - 1)


def _simulate(eng: Engine, annual: np.ndarray, fx_cost: float) -> tuple[np.ndarray, np.ndarray]:
    c = eng.ctx
    W = np.full(annual.shape[0], c.start * (1 - fx_cost))
    for t in range(c.horizon):
        W = (W + 12 * c.monthly) * (1 + annual[:, t])
    return W, eng.goal_index(stress.factors(c.horizon))


def _summary(eng: Engine, W: np.ndarray, idx: np.ndarray, annual: np.ndarray) -> dict:
    c = eng.ctx
    real = W / idx
    k = max(1, len(W) // 20)
    paid_in = c.start + 12 * c.monthly * c.horizon
    return {
        "probability": float((W >= c.target_today * idx).mean()),
        "median_real_value": float(np.median(real)),
        "worst5_real_value": float(np.sort(real)[:k].mean()),
        "worst5_shortfall_gel": float(np.sort(np.maximum(c.target_today - real, 0.0))[-k:].mean()),
        "prob_loss": float((real < paid_in).mean()),
        "median_annual_return": float(np.median(np.prod(1 + annual, axis=1))) ** (1 / c.horizon) - 1,
        "yearly_swing": float(np.std(annual)),
    }


def plan_annual(eng: Engine, key: str) -> tuple[np.ndarray, np.ndarray]:
    w, _, glide = eng.mission_weights(key)
    wpath = eng.path(w, glide, eng.ctx.horizon)
    f = stress.factors(eng.ctx.horizon)
    return np.einsum("nta,ta->nt", f["annual"], wpath), wpath


def compare(eng: Engine, key: str) -> dict:
    """Every fund type on its own (all the money you invest, plus the monthly amount), next to the mission plan."""
    c = eng.ctx
    f = stress.factors(c.horizon)
    funds = []
    for i, fund in enumerate(FUNDS):
        annual = fund_returns(fund, f, i)
        W, idx = _simulate(eng, annual, _fx_cost(fund))
        a = ASSETS[ASSET_INDEX[fund.asset]] if fund.asset else None
        funds.append({**fund.public(), "fee": a.fee if a else fund.fee, "fx_cost": _fx_cost(fund),
                      "assumed_return": a.rate if a else fund.rate, **_summary(eng, W, idx, annual),
                      "episodes": {code: episode_return(fund, code, c.goal_usd) for code in EPISODE_CODES}})
    pa, wpath = plan_annual(eng, key)
    W, idx = _simulate(eng, pa, float(wpath[0] @ FX_COST))
    plan = {"key": key, **_summary(eng, W, idx, pa),
            "episodes": {code: _plan_episode(wpath[0], code, c.goal_usd) for code in EPISODE_CODES}}
    return {"funds": funds, "plan": plan}


def stock_check(eng: Engine, key: str, profile: str, share: float) -> dict:
    """The mission plan vs the same plan with `share` of the invested money moved into one stock."""
    c = eng.ctx
    f = stress.factors(c.horizon)
    stock = STOCKS[profile]
    pa, wpath = plan_annual(eng, key)
    sa = fund_returns(stock, f, 100 + list(STOCKS).index(profile))
    mix = (1 - share) * pa + share * sa
    plan_fx = float(wpath[0] @ FX_COST)
    Wp, idx = _simulate(eng, pa, plan_fx)
    Wm, _ = _simulate(eng, mix, (1 - share) * plan_fx + share * stock.fx_cost)
    plan_eps = {code: _plan_episode(wpath[0], code, c.goal_usd) for code in EPISODE_CODES}
    stock_eps = {code: episode_return(stock, code, c.goal_usd) for code in EPISODE_CODES}
    growth = np.prod(1 + sa, axis=1)
    return {
        "profile": stock.public(), "share": share, "mission": key, "amount_gel": round(share * c.start, 2),
        "plan": {**_summary(eng, Wp, idx, pa), "episodes": plan_eps},
        "with_stock": {**_summary(eng, Wm, idx, mix),
                       "episodes": {k: (1 - share) * plan_eps[k] + share * stock_eps[k] for k in EPISODE_CODES}},
        "stock": {"halving_probability": float((growth < 0.5).mean()),
                  "worst_year_p5": float(np.quantile(sa, 0.05)),
                  "median_annual_return": float(np.median(growth)) ** (1 / c.horizon) - 1,
                  "episodes": stock_eps},
        "rule": PROD_RULE,
    }
