"""Stress & CVaR engine.

Simulates Georgian macro paths: GEL depreciation with crisis jumps, inflation
with FX pass-through, NBG rate moves with mean reversion and global equity
crashes. It values each asset in GEL after fees, then measures outcomes
against the saver's own liability basket: GEL costs grow with GEL inflation,
and USD-linked costs grow with the exchange rate and US inflation.

Allocation uses the Rockafellar–Uryasev linear program: maximise expected real
growth subject to CVaR(95%) of the purchasing-power loss staying within a
budget. Risk levels 1–10 move that budget along the efficient frontier.
"""

from dataclasses import dataclass
from functools import lru_cache

import numpy as np
from scipy import sparse
from scipy.optimize import linprog

from ..data.market import ASSET_INDEX, ASSETS, EPISODES, MACRO

ALPHA = 0.95
N_SCENARIOS = 1500
SEED = 20260719
LEVELS = 10
CAPS = {"CASH": 0.0, "LIQ": 1.0, "USD_CASH": 1.0, "GEL_DEP": 0.40, "USD_DEP": 0.40, "TBILL": 0.40}
LIQUID = ("LIQ", "USD_CASH")


@dataclass(frozen=True)
class Constraints:
    """The liquidity buffer is held in the currency of near-term essential costs.
    Caps are concentration and suitability limits. Cash at 0% is never part of a plan."""
    buffer_share: float
    equity_cap: float
    buffer_usd_share: float = 0.0

    def lower(self) -> dict[str, float]:
        return {"LIQ": self.buffer_share * (1 - self.buffer_usd_share),
                "USD_CASH": self.buffer_share * self.buffer_usd_share}

    def bounds(self) -> list[tuple[float, float]]:
        lo = self.lower()
        return [(lo.get(a.key, 0.0), self.equity_cap if a.key == "ETF" else CAPS[a.key]) for a in ASSETS]

    def liquid_row(self) -> np.ndarray:
        return np.array([-1.0 if a.key in LIQUID else 0.0 for a in ASSETS])


@lru_cache(maxsize=32)
def factors(horizon: int, n: int = N_SCENARIOS, seed: int = SEED) -> dict:
    rng = np.random.default_rng(seed + horizon)
    M, H = MACRO, horizon
    etf = ASSETS[ASSET_INDEX["ETF"]]
    crisis = rng.random((n, H)) < M["crisis_probability"]
    fx = rng.normal(M["fx_drift"], M["fx_sd"], (n, H)) + crisis * rng.uniform(M["crisis_fx_min"], M["crisis_fx_max"], (n, H))
    fx = np.maximum(fx, -0.2)
    infl = rng.normal(M["gel_inflation_mean"], M["gel_inflation_sd"], (n, H)) \
        + M["fx_inflation_passthrough"] * np.maximum(fx - M["fx_drift"], 0)
    usd_infl = rng.normal(M["usd_inflation_mean"], M["usd_inflation_sd"], (n, H))
    shock = rng.normal(0, 0.005, (n, H)) + crisis * rng.uniform(M["crisis_rate_hike_min"], M["crisis_rate_hike_max"], (n, H))
    level = np.zeros((n, H + 1))
    dr = np.zeros((n, H))
    for t in range(H):
        dr[:, t] = -M["rate_mean_reversion"] * level[:, t] + shock[:, t]
        level[:, t + 1] = level[:, t] + dr[:, t]
    crash = (rng.random((n, H)) < M["equity_crash_probability"]) | (crisis & (rng.random((n, H)) < 0.4))
    # Calibrate the diffusion so the unconditional mean and volatility match the ETF assumptions.
    p = M["equity_crash_probability"] + (1 - M["equity_crash_probability"]) * M["crisis_probability"] * 0.4
    jump_var = p * (1 - p) * M["equity_crash_mean"] ** 2 + p * 0.08 ** 2
    base_mu = etf.rate - p * M["equity_crash_mean"]
    base_sd = float(np.sqrt(max(etf.vol ** 2 - jump_var, 0.05 ** 2)))
    eq = rng.normal(base_mu, base_sd, (n, H)) + crash * rng.normal(M["equity_crash_mean"], 0.08, (n, H))
    eq = np.maximum(eq, -0.6)
    f = {"fx": fx, "infl": infl, "usd_infl": usd_infl, "dr": dr, "level": level, "eq": eq, "crisis": crisis}
    f["annual"] = annual_returns(f)
    f["growth"] = np.prod(1 + f["annual"], axis=1) * np.array([1 - a.fx_cost for a in ASSETS])
    f["gel_index"] = np.prod(1 + infl, axis=1)
    f["usd_index"] = np.prod((1 + fx) * (1 + usd_infl), axis=1)
    return f


def annual_returns(f: dict) -> np.ndarray:
    """Nominal GEL return of every asset in every year, after fees. Shape (n, H, A)."""
    lvl = f["level"][:, :-1]
    fx, dr, eq = f["fx"], f["dr"], f["eq"]
    cols = []
    for a in ASSETS:
        base = a.rate + a.passthrough * lvl
        if a.key == "CASH":
            r = np.zeros_like(fx)
        elif a.key in ("LIQ", "GEL_DEP"):
            r = base
        elif a.key in ("USD_DEP", "USD_CASH"):
            r = (1 + a.rate) * (1 + fx) - 1
        elif a.key == "TBILL":
            r = base - a.fee - a.duration * dr
        else:
            r = (1 + eq - a.fee) * (1 + fx) - 1
        cols.append(r)
    return np.stack(cols, axis=2)


def basket(f: dict, usd_share: float) -> np.ndarray:
    return (1 - usd_share) * f["gel_index"] + usd_share * f["usd_index"]


def real_returns(horizon: int, usd_share: float, n: int = N_SCENARIOS) -> np.ndarray:
    f = factors(horizon, n)
    return f["growth"] / basket(f, usd_share)[:, None]


def cvar(losses: np.ndarray, alpha: float = ALPHA) -> float:
    k = int(np.ceil((1 - alpha) * len(losses)))
    return float(np.sort(losses)[-k:].mean())


def var(losses: np.ndarray, alpha: float = ALPHA) -> float:
    return float(np.quantile(losses, alpha))


def _solve(R: np.ndarray, cons: Constraints, cap: float | None) -> np.ndarray | None:
    """cap=None: minimum-CVaR portfolio. Otherwise: max expected real growth with CVaR <= cap."""
    n, A = R.shape
    k = 1.0 / ((1 - ALPHA) * n)
    mu = R.mean(axis=0)
    a_ub = sparse.vstack([
        sparse.hstack([sparse.csr_matrix(-R), sparse.csr_matrix(-np.ones((n, 1))), -sparse.identity(n)]),
        sparse.csr_matrix(np.concatenate([cons.liquid_row(), [0.0], np.zeros(n)])),
    ], format="csr")
    b_ub = np.append(-np.ones(n), -cons.buffer_share)
    if cap is None:
        c = np.concatenate([-1e-4 * mu, [1.0], np.full(n, k)])
    else:
        c = np.concatenate([-mu, [0.0], np.zeros(n)])
        a_ub = sparse.vstack([a_ub, sparse.csr_matrix(np.concatenate([np.zeros(A), [1.0], np.full(n, k)]))], format="csr")
        b_ub = np.append(b_ub, cap)
    a_eq = np.concatenate([np.ones(A), [0.0], np.zeros(n)])[None, :]
    res = linprog(c, A_ub=a_ub, b_ub=b_ub, A_eq=a_eq, b_eq=[1.0],
                  bounds=cons.bounds() + [(None, None)] + [(0, None)] * n, method="highs")
    if res.status != 0:
        return None
    w = np.clip(res.x[:A], 0, None)
    return w / w.sum()


def _max_return(R: np.ndarray, cons: Constraints) -> np.ndarray:
    res = linprog(-R.mean(axis=0), A_ub=cons.liquid_row()[None, :], b_ub=[-cons.buffer_share],
                  A_eq=np.ones((1, R.shape[1])), b_eq=[1.0], bounds=cons.bounds(), method="highs")
    return res.x


def frontier(R: np.ndarray, cons: Constraints, levels: list[int] | None = None) -> dict[int, np.ndarray]:
    """Optimal weights per risk level. Level 1 is the minimum-CVaR portfolio, level 10 the
    highest-return portfolio the constraints allow. Levels between are equally spaced in CVaR."""
    levels = levels or list(range(1, LEVELS + 1))
    w_min = _solve(R, cons, None)
    w_max = _max_return(R, cons)
    lo, hi = cvar(1 - R @ w_min), cvar(1 - R @ w_max)
    out = {}
    for level in levels:
        if level <= 1 or hi <= lo + 1e-9:
            out[level] = w_min
            continue
        w = _solve(R, cons, lo + (level - 1) / (LEVELS - 1) * (hi - lo))
        out[level] = w if w is not None else w_min
    return out


def metrics(R: np.ndarray, w: np.ndarray, horizon: int) -> dict:
    g = R @ w
    losses = 1 - g
    return {
        "expected_real_annual": float(g.mean()) ** (1 / horizon) - 1,
        "median_real_total": float(np.median(g)) - 1,
        "cvar95": cvar(losses),
        "var95": var(losses),
        "prob_loss": float((g < 1).mean()),
    }


def stress_path(horizon: int, shock: dict) -> dict:
    """One deterministic path: the shock hits in year 1, then the baseline resumes."""
    M = MACRO
    etf = ASSETS[ASSET_INDEX["ETF"]]
    H = horizon
    fx = np.full((1, H), M["fx_drift"])
    infl = np.full((1, H), M["gel_inflation_mean"])
    eq = np.full((1, H), etf.rate)
    shock_r = np.zeros((1, H))
    fx[0, 0] = shock.get("fx", M["fx_drift"])
    infl[0, 0] = shock.get("inflation", M["gel_inflation_mean"])
    eq[0, 0] = shock.get("equity", etf.rate)
    shock_r[0, 0] = shock.get("rate", 0.0)
    level = np.zeros((1, H + 1))
    dr = np.zeros((1, H))
    for t in range(H):
        dr[:, t] = -M["rate_mean_reversion"] * level[:, t] + shock_r[:, t]
        level[:, t + 1] = level[:, t] + dr[:, t]
    f = {"fx": fx, "infl": infl, "usd_infl": np.full((1, H), M["usd_inflation_mean"]), "dr": dr,
         "level": level, "eq": eq}
    growth = np.prod(1 + annual_returns(f)[0], axis=0) * np.array([1 - a.fx_cost for a in ASSETS])
    return {"growth": growth, "gel_index": float(np.prod(1 + infl)),
            "usd_index": float(np.prod((1 + fx) * (1 + f["usd_infl"])))}


def replay(weights: dict[str, np.ndarray], usd_share: float) -> list[dict]:
    """One-year stylised historical episodes applied to each portfolio (real return vs the liability basket)."""
    out = []
    for ep in EPISODES:
        p = stress_path(1, ep)
        b = (1 - usd_share) * p["gel_index"] + usd_share * p["usd_index"]
        real = p["growth"] / b
        out.append({**ep, "results": {k: float(real @ w - 1) for k, w in weights.items()}})
    return out


def vector(weights: dict) -> np.ndarray:
    w = np.zeros(len(ASSETS))
    for k, v in weights.items():
        w[ASSET_INDEX[k]] = v
    return w


def as_dict(w: np.ndarray) -> dict[str, float]:
    return {a.key: float(x) for a, x in zip(ASSETS, w)}
