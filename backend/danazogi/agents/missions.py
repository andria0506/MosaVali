"""Missions agent: Protect / Goal / Balance / Growth, the goal planner and "what would get you there".

A mission changes the objective, not just a risk number:
- Protect: the minimum-CVaR portfolio, with equity capped at 10%.
- Goal: the frontier portfolio (within the customer's capacity) with the highest
  Monte Carlo chance of reaching the goal on time. A glide path that de-risks
  toward Protect in the final year is used when it does not lower that chance.
- Balance: the mid-frontier portfolio (risk level 5).
- Growth: the highest expected growth the customer's capacity allows (level 10).

The goal simulation adds the monthly contribution each year, applies
scenario-by-scenario asset returns, and compares terminal wealth with the
goal's own price index (USD-priced goals follow the exchange rate).
"""

from dataclasses import dataclass, replace

import numpy as np

from ..data.market import ASSETS, MACRO
from . import inflation, stress

MISSIONS = [
    {"key": "protect", "rank": 1, "ka": "დაცვა", "en": "Protect",
     "objective_ka": "ყველაზე მცირე დანაკარგი ცუდ წლებში და თქვენს ინფლაციაზე მაღალი შემოსავალი",
     "objective_en": "Smallest losses in bad years while beating your own inflation"},
    {"key": "goal", "rank": 2, "ka": "მიზანი", "en": "Goal",
     "objective_ka": "მიზნის დროულად მიღწევის ყველაზე მაღალი ალბათობა თქვენი რისკის ტევადობის ფარგლებში; ბოლო წელს რისკს ამცირებს, თუ ეს მიზანს არ აზიანებს",
     "objective_en": "Highest chance of reaching your goal on time within your risk capacity; lowers risk in the final year when that does not cost you the goal"},
    {"key": "balance", "rank": 3, "ka": "ბალანსი", "en": "Balance", "level": 5,
     "objective_ka": "ზომიერი ზრდა ზომიერი ვარდნებით",
     "objective_en": "Moderate growth with moderate dips"},
    {"key": "growth", "rank": 4, "ka": "ზრდა", "en": "Growth", "level": 10,
     "objective_ka": "ყველაზე მაღალი მოსალოდნელი ზრდა, რასაც თქვენი ფინანსები იტანს — უფრო დიდი შესაძლო ვარდნით",
     "objective_en": "Highest expected growth your finances allow, with bigger possible drops"},
]
BY_KEY = {m["key"]: m for m in MISSIONS}
PROTECT_EQUITY = 0.10
TARGET_PROB = 0.80
FX_COST = np.array([a.fx_cost for a in ASSETS])


def max_rank(capacity_level: int) -> int:
    return 1 if capacity_level <= 3 else 2 if capacity_level <= 5 else 3 if capacity_level <= 7 else 4


@dataclass
class Context:
    horizon: int
    usd_liability: float
    cons: stress.Constraints
    total: float
    start: float
    monthly: float
    target_today: float
    goal_usd: float
    personal_inflation: float
    max_level: int = 10  # the Goal mission searches only risk levels within the customer's capacity


class Engine:
    def __init__(self, ctx: Context):
        self.ctx = ctx
        f = stress.factors(ctx.horizon)
        self.R = f["growth"] / stress.basket(f, ctx.usd_liability)[:, None]
        self.levels = stress.frontier(self.R, ctx.cons)
        protect_cons = replace(ctx.cons, equity_cap=min(ctx.cons.equity_cap, PROTECT_EQUITY))
        self.protect = stress.frontier(self.R, protect_cons, [1])[1]
        self.lower = stress.vector(ctx.cons.lower())
        self._goal_pick: dict[str, tuple[int, bool]] = {}

    def goal_index(self, f: dict) -> np.ndarray:
        shift = self.ctx.personal_inflation - MACRO["gel_inflation_mean"]
        gel = np.prod(1 + f["infl"] + shift, axis=1)
        return (1 - self.ctx.goal_usd) * gel + self.ctx.goal_usd * f["usd_index"]

    def invested(self, w: np.ndarray) -> np.ndarray:
        rest = np.clip(w - self.lower, 0, None)
        if rest.sum() < 1e-9:
            return stress.vector({"LIQ": 1.0})
        return rest / rest.sum()

    def path(self, w: np.ndarray, glide: bool, horizon: int) -> np.ndarray:
        """Invested weights per year. The glide path holds the mission until the final stretch,
        then moves halfway to Protect in the last year so a late crash cannot wreck the goal."""
        wi, wp = self.invested(w), self.invested(self.protect)
        if not glide:
            return np.tile(wi, (horizon, 1))
        lam = np.clip(2 * (1 - np.arange(horizon) / horizon), 0.5, 1.0)
        return lam[:, None] * wi + (1 - lam[:, None]) * wp

    def simulate(self, weights_by_year: np.ndarray, monthly: float, horizon: int) -> tuple[np.ndarray, np.ndarray]:
        f = stress.factors(horizon)
        W = np.full(f["annual"].shape[0], self.ctx.start * (1 - weights_by_year[0] @ FX_COST))
        for t in range(horizon):
            W = (W + 12 * monthly) * (1 + f["annual"][:, t, :] @ weights_by_year[t])
        return W, self.goal_index(f)

    def median_return(self, wpath: np.ndarray) -> float:
        annual = stress.factors(len(wpath))["annual"]
        growth = np.prod(1 + np.einsum("nta,ta->nt", annual, wpath), axis=1)
        return float(np.median(growth)) ** (1 / len(wpath)) - 1

    def prob_path(self, wpath: np.ndarray, monthly: float, horizon: int) -> float:
        W, idx = self.simulate(wpath, monthly, horizon)
        return float((W >= self.ctx.target_today * idx).mean())

    def probability(self, w: np.ndarray, glide: bool, monthly: float | None = None, horizon: int | None = None) -> float:
        h = horizon or self.ctx.horizon
        return self.prob_path(self.path(w, glide, h), self.ctx.monthly if monthly is None else monthly, h)

    def monthly_for(self, wpath: np.ndarray, target: float = TARGET_PROB) -> float | None:
        """Smallest monthly contribution that reaches the target probability, or None if out of reach."""
        h = self.ctx.horizon
        if self.prob_path(wpath, 0.0, h) >= target:
            return 0.0
        hi = max(self.ctx.target_today / (12 * h), 50.0)
        for _ in range(8):
            if self.prob_path(wpath, hi, h) >= target:
                break
            hi *= 2
        else:
            return None
        lo = 0.0
        for _ in range(30):
            mid = (lo + hi) / 2
            lo, hi = (mid, hi) if self.prob_path(wpath, mid, h) < target else (lo, mid)
        return hi

    def strategies(self, key: str) -> list[dict]:
        """Cash vs GEL deposit vs the mission, on the same scenarios and the same goal price index."""
        h = self.ctx.horizon
        w, _, glide = self.mission_weights(key)
        g = inflation.goal_inflation(self.ctx.goal_usd, self.ctx.personal_inflation)
        out = []
        for skey, ka, en, wpath in (
            ("cash", "ნაღდი ფული", "Cash", np.tile(stress.vector({"CASH": 1.0}), (h, 1))),
            ("deposit", "ლარის ვადიანი ანაბარი", "GEL term deposit", np.tile(stress.vector({"GEL_DEP": 1.0}), (h, 1))),
            ("plan", f"MosaVali · {BY_KEY[key]['ka']}", f"MosaVali · {BY_KEY[key]['en']}", self.path(w, glide, h)),
        ):
            W, idx = self.simulate(wpath, self.ctx.monthly, h)
            annual = self.median_return(wpath)
            needed = self.monthly_for(wpath)
            shortfall = np.maximum(self.ctx.target_today - W / idx, 0.0)
            shock = stress.replay({"s": wpath[0]}, self.ctx.goal_usd)[1]["results"]["s"]
            out.append({
                "key": skey, "label_ka": ka, "label_en": en,
                "probability": float((W >= self.ctx.target_today * idx).mean()),
                "worst5_shortfall_gel": float(np.sort(shortfall)[-max(1, len(W) // 20):].mean()),
                "lari_shock_2015": shock,
                "lari_shock_2015_gel": shock * self.ctx.start,
                "monthly_needed_80": None if needed is None else round(needed, 2),
                "median_real_value": float(np.median(W / idx)),
                "median_annual_return": annual,
                "months_to_goal": inflation.months_to_goal(self.ctx.start, self.ctx.monthly, annual,
                                                           self.ctx.target_today, g),
            })
        return out

    def mission_weights(self, key: str) -> tuple[np.ndarray, int, bool]:
        if key == "protect":
            return self.protect, 1, False
        if key == "goal":
            if "goal" not in self._goal_pick:
                probs = {(lvl, glide): self.probability(w, glide) for lvl, w in self.levels.items()
                         if lvl <= self.ctx.max_level for glide in (True, False)}
                best = max(probs.values())
                lvl, glide = min((k for k, p in probs.items() if p >= best - 0.005), key=lambda k: (not k[1], k[0]))
                self._goal_pick["goal"] = (lvl, glide)
            lvl, glide = self._goal_pick["goal"]
            return self.levels[lvl], lvl, glide
        lvl = BY_KEY[key]["level"]
        return self.levels[lvl], lvl, False

    def evaluate(self, key: str) -> dict:
        w, lvl, glide = self.mission_weights(key)
        h = self.ctx.horizon
        wpath = self.path(w, glide, h)
        W, idx = self.simulate(wpath, self.ctx.monthly, h)
        real = W / idx
        m = stress.metrics(self.R, w, h)
        s15 = stress.replay({"m": w}, self.ctx.goal_usd)[1]["results"]["m"]
        return {
            "key": key, **{k: BY_KEY[key][k] for k in ("rank", "ka", "en", "objective_ka", "objective_en")},
            "level": lvl, "glide": glide,
            "weights": stress.as_dict(w),
            "glide_path": [stress.as_dict(x) for x in self.path(w, glide, h)],
            "probability": float((W >= self.ctx.target_today * idx).mean()),
            "terminal": {"p10": float(np.quantile(W, 0.1)), "median": float(np.median(W)), "p90": float(np.quantile(W, 0.9))},
            "terminal_real": {"p10": float(np.quantile(real, 0.1)), "median": float(np.median(real)),
                              "p90": float(np.quantile(real, 0.9))},
            "plan_return": self.median_return(wpath),
            "cvar95": m["cvar95"],
            "worst5_loss_gel": max(m["cvar95"], 0.0) * self.ctx.total,
            "expected_real_annual": m["expected_real_annual"],
            "prob_loss": m["prob_loss"],
            "replay_2015_gel": s15 * self.ctx.total,
            "replay_2015": s15,
            "equity_share": float(w[[i for i, a in enumerate(ASSETS) if a.key == "ETF"][0]]),
        }

    def levers(self, key: str, extra_monthly: float = 0.0) -> dict:
        w, _, glide = self.mission_weights(key)
        h, c0 = self.ctx.horizon, self.ctx.monthly
        p0 = self.probability(w, glide)
        out = {"target_probability": TARGET_PROB, "probability": p0, "on_track": p0 >= TARGET_PROB}
        if extra_monthly > 0:
            p1 = self.probability(w, glide, c0 + extra_monthly)
            r = self.evaluate(key)["plan_return"]
            g = inflation.goal_inflation(self.ctx.goal_usd, self.ctx.personal_inflation)
            m0 = inflation.months_to_goal(self.ctx.start, c0, r, self.ctx.target_today, g)
            m1 = inflation.months_to_goal(self.ctx.start, c0 + extra_monthly, r, self.ctx.target_today, g)
            out["savings_boost"] = {"extra_monthly": extra_monthly, "probability": p1,
                                    "months_to_goal_before": m0, "months_to_goal_after": m1,
                                    "months_sooner": (m0 - m1) if m0 and m1 else None}
        if p0 >= TARGET_PROB:
            return out
        needed = self.monthly_for(self.path(w, glide, h))
        out["extra_monthly"] = None if needed is None else round(needed - c0, 2)
        prev = p0
        for k in range(1, 7):
            pk = self.probability(w, glide, horizon=h + k)
            if pk >= TARGET_PROB:
                out["extra_months"] = int(round(12 * (k - 1) + 12 * (TARGET_PROB - prev) / max(pk - prev, 1e-9)))
                break
            prev = pk
        W, idx = self.simulate(self.path(w, glide, h), c0, h)
        needed = float(np.quantile(W / idx, 1 - TARGET_PROB))
        out["cheaper_target_by"] = round(max(self.ctx.target_today - needed, 0.0), 2)
        out["target_at_80"] = round(needed, 2)
        return out
