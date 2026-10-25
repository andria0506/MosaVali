"""Personal inflation agent: the user's own inflation rate and what doing nothing costs.

Personal inflation weights category inflation by the user's actual spending
basket. The goal's price index follows its currency: dollar-priced goals
(imported cars, apartments) grow with the exchange rate and US inflation, and
GEL goals grow with personal inflation.
"""

from ..data.market import CPI_SOURCE, CPI_YOY, category_inflation, usd_indexed_inflation


def personal(categories: list[dict]) -> dict:
    total = sum(c["monthly"] for c in categories)
    rows = []
    for c in categories:
        share = c["monthly"] / total if total else 0.0
        rate = category_inflation(c["key"])
        rows.append({"key": c["key"], "label_ka": c["label_ka"], "label_en": c["label_en"], "share": share,
                     "inflation": rate, "contribution": share * rate})
    rate = sum(r["contribution"] for r in rows) if total else CPI_YOY
    rows.sort(key=lambda r: -r["contribution"])
    return {"personal": rate, "national": CPI_YOY, "gap": rate - CPI_YOY, "rows": rows, "source": CPI_SOURCE}


def goal_inflation(usd_indexed: float, personal_rate: float) -> float:
    return usd_indexed * usd_indexed_inflation() + (1 - usd_indexed) * personal_rate


def idle_cash_loss(idle_cash: float, personal_rate: float) -> float:
    """Purchasing power that cash at 0% loses in one year at the person's own inflation rate."""
    return idle_cash * (1 - 1 / (1 + personal_rate))


def months_to_goal(start: float, monthly: float, annual: float, target_today: float, goal_infl: float,
                   cap: int = 360) -> int | None:
    r = (1 + annual) ** (1 / 12) - 1
    gi = (1 + goal_infl) ** (1 / 12) - 1
    w = start
    for m in range(1, cap + 1):
        w = w * (1 + r) + monthly
        if w >= target_today * (1 + gi) ** m:
            return m
    return None
