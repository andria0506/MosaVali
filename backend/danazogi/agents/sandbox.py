"""Flight simulator: practise with 10,000 virtual GEL through real-world-shaped crises.

Chapters: the 2008–09 war and global crisis, the 2014–15 lari shock, the 2020
pandemic and the 2022 inflation spike with a stronger lari. The replay plays
on its own and pauses at one or two decision moments per chapter, where the
customer can hold, sell to cash, rebalance to the plan, or buy more. The agent
records what they actually do under stress and turns it into a behavioural
risk score (1–10), which is compared with the mission they choose (compliance
rule BEH-01). An AI coach comments in Georgian and English.

Action rules follow the product: term deposits are never broken early, so
"sell" and "buy more" only touch market-priced holdings (the equity ETF and
treasury securities).
"""

import uuid

import numpy as np

from ..data import replay
from ..data.market import ASSET_INDEX, ASSETS
from .compliance import behaviour_rank
from .explain import num

START = 10000.0
MARKET = ("ETF", "TBILL")  # market-priced: can be sold or bought at any time
POOL = ("LIQ", "CASH", "USD_CASH")  # instant-access money inside the invested part that "buy more" can use
DEPOSITS = ("GEL_DEP", "USD_DEP")  # move only at maturity
ACTIONS = ("hold", "sell", "rebalance", "buy")
DD_LEVEL = 0.025  # each 2.5% of drawdown tolerated adds one level
USD_INFLATION_MONTHLY = 0.002
MISSION_RANK = {"protect": 1, "goal": 2, "balance": 3, "growth": 4}
RANK_FLOOR = {1: 1, 2: 4, 3: 6, 4: 8}  # lowest score whose behaviour rank equals the mission rank
MISSION_ORDER = ("protect", "goal", "balance", "growth")


def monthly_returns(step: dict, cum_rate: float) -> np.ndarray:
    r = np.zeros(len(ASSETS))
    for a in ASSETS:
        i = ASSET_INDEX[a.key]
        if a.key == "LIQ":
            r[i] = (a.rate + a.passthrough * cum_rate) / 12
        elif a.key == "GEL_DEP":
            r[i] = a.rate / 12
        elif a.key in ("USD_CASH", "USD_DEP"):
            r[i] = (1 + a.rate / 12) * (1 + step["fx"]) - 1
        elif a.key == "TBILL":
            r[i] = (a.rate + a.passthrough * cum_rate) / 12 - a.fee / 12 - a.duration * step["rate"]
        elif a.key == "ETF":
            r[i] = (1 + step["equity"] - a.fee / 12) * (1 + step["fx"]) - 1
    return r


def _vec(weights: dict) -> np.ndarray:
    v = np.array([weights.get(a.key, 0.0) for a in ASSETS], dtype=float)
    return v / v.sum() if v.sum() > 0 else v


class Flight:
    """Drawdowns are measured in what the money buys: against the goal's dollar price for a
    dollar-priced goal, against the customer's prices (CPI) otherwise."""

    def __init__(self, weights: dict, mission: str, goal_usd: float | None, chapters: list[str] | None = None,
                 ghosts: dict[str, dict] | None = None):
        self.id = uuid.uuid4().hex[:10]
        self.mission = mission
        self.rank = MISSION_RANK.get(mission, 2)
        self.chapters = [c for c in replay.CODES if not chapters or c in chapters]
        self.steps = replay.steps(self.chapters)
        self.target = _vec(weights)
        self.hold = START * self.target
        self.passive = self.hold.copy()
        self.ghosts = {k: START * _vec(w) for k, w in (ghosts or {}).items()}
        self.goal_usd = goal_usd
        self.i, self.cum_rate, self.cpi, self.usd_index = 0, 0.0, 1.0, 1.0
        self.peak = START
        self.history = [self._point(None)]
        self.actions: list[dict] = []
        self.coach: list[dict] = []
        self.flags = {"dd5": False, "dd10": False, "dd15": False}

    @property
    def value(self) -> float:
        return float(self.hold.sum())

    @property
    def index(self) -> float:
        return self.usd_index if self.goal_usd else self.cpi

    @property
    def buying_power(self) -> float:
        return self.value / self.index

    def _point(self, step: dict | None) -> dict:
        fx = step["fx_level"] if step else self.steps[0]["fx_level"] / (1 + self.steps[0]["fx"])
        return {"month": step["month"] if step else "start", "value": round(self.value, 2),
                "passive": round(float(self.passive.sum()), 2),
                "buying_power": round(self.buying_power, 2),
                "passive_buying_power": round(float(self.passive.sum()) / self.index, 2),
                "ghosts": {k: round(float(v.sum()) / self.index, 2) for k, v in self.ghosts.items()},
                "fx": fx, "drawdown": round(1 - self.buying_power / self.peak, 4),
                "goal_price_index": round(self.index, 4),
                "chapter": step["chapter"] if step else self.steps[0]["chapter"]}

    def _say(self, kind: str, ka: str, en: str):
        self.coach.append({"month": self.steps[min(self.i, len(self.steps) - 1)]["month"], "kind": kind, "ka": ka, "en": en})

    def _idx(self, keys) -> list[int]:
        return [ASSET_INDEX[k] for k in keys]

    def available(self) -> dict:
        """Which actions make sense right now, with a reason when they do not."""
        market = float(self.hold[self._idx(MARKET)].sum())
        pool = float(self.hold[self._idx(POOL)].sum())
        has_market_target = float(self.target[self._idx(MARKET)].sum()) > 1e-9
        buy_reason = (("ამ გეგმაში აქციები და ფასიანი ქაღალდები არ არის.", "This plan holds no shares or bonds to buy more of.")
                      if not has_market_target else
                      ("საყიდლად თავისუფალი თანხა არ არის: ფული ანაბრებში, აქციებსა და ფასიან ქაღალდებშია, ბუფერი კი ხელუხლებელია.",
                       "No spare cash to buy with: the money is in deposits, shares and bonds, and your safety buffer stays untouched."))
        return {
            "sell": {"ok": market > 1, "reason_ka": "გასაყიდი აქციები ან ფასიანი ქაღალდები არ გაქვთ; ანაბრები ვადამდე არ იყიდება.",
                     "reason_en": "Nothing to sell: you hold no shares or bonds, and deposits cannot be sold before they mature."},
            "buy": {"ok": has_market_target and pool > 1, "reason_ka": buy_reason[0], "reason_en": buy_reason[1]},
            "rebalance": {"ok": True, "reason_ka": "", "reason_en": ""},
            "hold": {"ok": True, "reason_ka": "", "reason_en": ""},
        }

    def apply(self, action: str):
        dd = 1 - self.buying_power / self.peak
        v = self.value
        liq = ASSET_INDEX["LIQ"]
        if action == "sell":
            idx = self._idx(MARKET)
            sold = float(self.hold[idx].sum())
            self.hold[idx] = 0.0
            self.hold[liq] += sold
            if sold <= 1:
                self._say("info", "გასაყიდი არაფერია: ანაბრები ვადამდე არ იყიდება.",
                          "Nothing to sell: deposits cannot be sold before they mature.")
            elif dd >= 0.03:
                self._say("sell", f"თქვენ გაყიდეთ {num(dd * 100, 'ka', 1)}%-იანი ვარდნის დროს. ზარალი ახლა დაფიქსირდა — "
                                  f"ისტორიულად ფასები შემდგომ აღდგა.",
                          f"You sold during a {dd * 100:.1f}% drop. The loss is now locked in; historically, prices "
                          f"recovered later.")
            else:
                self._say("sell", "აქციები და ფასიანი ქაღალდები ლარის ანგარიშზე გადავიდა.",
                          "Your shares and bonds moved into lari savings.")
        elif action == "rebalance":
            nd = [i for i, a in enumerate(ASSETS) if a.key not in DEPOSITS]
            t = self.target[nd]
            if t.sum() > 0:
                self.hold[nd] = float(self.hold[nd].sum()) * t / t.sum()
            self._say("rebalance", "პორტფელი გეგმის წილებს დაუბრუნდა (ანაბრები ხელუხლებელია). დისციპლინირებული ნაბიჯია.",
                      "The portfolio is back to the plan's mix (deposits untouched). A disciplined move.")
        elif action == "buy":
            pool_idx = self._idx(POOL)
            pool = float(self.hold[pool_idx].sum())
            share = self.target[self._idx(MARKET)]
            move = min(0.10 * v, pool) if share.sum() > 1e-9 else 0.0
            if move > 0:
                share = share / share.sum()
                self.hold[pool_idx] -= move * self.hold[pool_idx] / pool
                for k, s in zip(MARKET, share):
                    self.hold[ASSET_INDEX[k]] += move * s
                if dd >= 0.03:
                    self._say("buy_dip", "ვარდნის დროს ყიდვამ საშუალო ფასი შეამცირა. ეს მხოლოდ მაშინ არის გონივრული, როცა ბუფერი დაცულია.",
                              "Buying in the dip lowered your average price. It only makes sense when your buffer is safe.")
                else:
                    self._say("buy", "დანაზოგის 10% აქციებსა და ფასიან ქაღალდებში გადავიდა.",
                              "10% of your savings moved into shares and bonds.")
            else:
                reason = self.available()["buy"]
                self._say("info", reason["reason_ka"], reason["reason_en"])
        self.actions.append({"month": self.steps[self.i]["month"], "action": action, "drawdown": round(dd, 4),
                             "gain_3m": round(self._gain_3m(), 4)})

    def _gain_3m(self) -> float:
        if len(self.history) < 4:
            return 0.0
        return self.history[-1]["buying_power"] / self.history[-4]["buying_power"] - 1

    def step(self, action: str = "hold") -> dict:
        if self.done:
            return self.snapshot()
        if action not in ACTIONS:
            raise ValueError(f"Unknown action {action}")
        if action != "hold":
            self.apply(action)
        s = self.steps[self.i]
        if s["first"]:
            self.cum_rate = 0.0  # each chapter starts from its own policy-rate level
        self.cum_rate += s["rate"]
        r = monthly_returns(s, self.cum_rate)
        self.hold *= 1 + r
        self.passive *= 1 + r
        for g in self.ghosts.values():
            g *= 1 + r
        self.cpi *= 1 + s["cpi"]
        self.usd_index *= (1 + s["fx"]) * (1 + USD_INFLATION_MONTHLY)
        self.peak = max(self.peak, self.buying_power)
        self.history.append(self._point(s))
        dd = 1 - self.buying_power / self.peak
        for key, lvl in (("dd5", 0.05), ("dd10", 0.10), ("dd15", 0.15)):
            if dd >= lvl and not self.flags[key]:
                self.flags[key] = True
                self._say("drawdown", f"პორტფელი პიკიდან {num(dd * 100, 'ka', 1)}%-ით არის ჩამოსული. გაყიდვა ზარალს "
                                      f"დააფიქსირებს; დალოდება ან გადაბალანსება — არა.",
                          f"Your portfolio is {dd * 100:.1f}% below its peak. Selling now would lock in the loss; holding "
                          f"or rebalancing would not.")
        self.i += 1
        if self.done:
            self._summary()
        return self.snapshot()

    def advance(self, action: str = "hold", until_decision: bool = False) -> dict:
        """Apply the action, play one month and, if asked, keep holding until a decision month has played."""
        snap = self.step(action)
        while until_decision and not self.done and not self.steps[self.i - 1]["decision"]:
            snap = self.step("hold")
        return snap

    @property
    def done(self) -> bool:
        return self.i >= len(self.steps)

    def result(self) -> dict:
        sells = [a for a in self.actions if a["action"] == "sell" and a["drawdown"] >= 0.03]
        dips = [a for a in self.actions if a["action"] == "buy" and a["drawdown"] >= 0.03]
        chased = [a for a in self.actions if a["action"] == "buy" and a["gain_3m"] >= 0.04]
        max_dd = max(p["drawdown"] for p in self.history)
        tolerated = sells[0]["drawdown"] if sells else max_dd
        score = None
        if sells:
            # A panic sale shows the drop you could stand. It cannot qualify you for the mission you fled.
            cap = RANK_FLOOR[self.rank] - 1 if self.rank > 1 else 1
            score = int(np.clip(min(round(1 + tolerated / DD_LEVEL), cap), 1, 10))
        elif max_dd >= 0.05:
            # Holding through a real drop qualifies you at least for the mission you flew.
            score = max(int(np.clip(round(1 + max_dd / DD_LEVEL), 1, 10)), RANK_FLOOR[self.rank])
            score = int(np.clip(score + (1 if dips else 0), 1, 10))
        rank = behaviour_rank(score)
        return {"score": score, "evidence": score is not None, "max_drawdown": max_dd, "tolerated_drawdown": tolerated,
                "panic_sells": len(sells), "bought_dips": len(dips), "chased_gains": len(chased),
                "final_value": round(self.value, 2), "passive_value": round(float(self.passive.sum()), 2),
                "final_buying_power": round(self.buying_power, 2),
                "passive_buying_power": round(float(self.passive.sum()) / self.index, 2),
                "actions_cost_gel": round(float(self.passive.sum()) - self.value, 2),
                "fits": [m for m in MISSION_ORDER if rank is not None and MISSION_RANK[m] <= rank],
                "ghost_buying_power": {k: round(float(v.sum()) / self.index, 2) for k, v in self.ghosts.items()},
                "measured_in": "goal_usd_price" if self.goal_usd else "cpi"}

    def _summary(self):
        r = self.result()
        diff = r["actions_cost_gel"]
        if r["score"] is None:
            self._say("summary", "ამ მისიამ მნიშვნელოვანი ვარდნა არ განიცადა, ამიტომ ქცევის შეფასებისთვის საკმარისი "
                                 "მონაცემი არ არის. სცადეთ უფრო რისკიანი მისია ან სხვა კრიზისი.",
                      "This mission never fell far enough to judge your behaviour. Try a riskier mission or another crisis.")
            return
        if abs(diff) < 1:
            ka_diff, en_diff = "თქვენ გეგმას არ გადაუხვიეთ, ამიტომ შედეგი დალოდების ტოლია.", "You stayed with the plan, so your result equals simply holding."
        else:
            ka_diff = (f"თქვენმა ქმედებებმა უბრალოდ დალოდებასთან შედარებით {num(abs(diff), 'ka')} ლარი "
                       f"{'დაგაკარგვინათ' if diff > 0 else 'მოგიტანათ'}.")
            en_diff = f"Your moves {'cost' if diff > 0 else 'earned'} {abs(diff):,.0f} GEL compared with simply holding."
        self._say("summary", f"თქვენი ქცევის ქულაა {r['score']}/10. {ka_diff}", f"Your behaviour score is {r['score']}/10. {en_diff}")

    def snapshot(self) -> dict:
        nxt = self.steps[self.i] if not self.done else None
        last = self.steps[self.i - 1] if self.i > 0 else None
        decision = None
        if last and last["decision"] and not self.done:
            decision = {"month": last["month"], "chapter": last["chapter"], "chapter_ka": last["chapter_ka"],
                        "chapter_en": last["chapter_en"], "drawdown": round(1 - self.buying_power / self.peak, 4),
                        **last["decision"]}
        return {"id": self.id, "mission": self.mission, "month_index": self.i, "months": len(self.steps),
                "chapters": self.chapters, "done": self.done, "value": round(self.value, 2), "history": self.history,
                "next": {"month": nxt["month"], "chapter": nxt["chapter"], "chapter_ka": nxt["chapter_ka"],
                         "chapter_en": nxt["chapter_en"]} if nxt else None,
                "decision": decision, "available": self.available(),
                "coach": self.coach[-6:], "actions": self.actions,
                "result": self.result() if self.done else None,
                "source": replay.SOURCE}
