# Model card · MosaVali

Two regression models plus a peer-clustering model support the advice engine. The regressions predict **GEL amounts, not probabilities**. All are trained on **synthetic data**, as the hackathon rules require. They are versioned, and every audit-log entry records the versions used.
Source of truth for the numbers below: `backend/danazogi/ml/artifacts/*.metrics.json`. Running `python -m danazogi.ml.registry` regenerates them.

---

## Model 1 · Cash-need regression (`liquidity-regression-2.0+57e5ab09`)

**Purpose.** Estimate the maximum essential cash shortfall (in GEL) a saver may face over the next 12 months. The estimate plus minimum-reserve rules sets a protected cash reserve, locked before anything is invested.

**Target.** `max(0, max_t cumulative(essential + one-off − income))` over months 13–24 — the largest cumulative shortfall of essential spending plus one-off event costs over income. Each customer's aggregate one-off event cost is placed in one simulated future month.

**Intended use.** Decision support inside a licensed partner's advice workflow. It is **not** for credit decisions, pricing or any automated action without human review.

### Data
- 20,000 synthetic Georgian savers, 24 months each (`ml/cohort.py`). Hidden traits drive cash flows: income type and level, region, age, household, saving discipline, fragility, USD loans.
- Hidden life events hit months 13–24: job loss, business slumps, medical costs, weddings and funerals, repairs, remittances stopping, and an FX shock in the stress regime.
- Features come from the first 12 months only — no future features.
- An 8% gender income gap is built in on purpose so the fairness audit has a real signal to detect.
- Customer-disjoint split: **12,000 train · 3,000 validation · 2,000 calibration · 3,000 test**, plus a separate **5,000-saver stress cohort** modelling a 2014-style year: 30% depreciation, more job losses and slumps.
- Synthetic histories end in September, so target month 13 is October in the generator. There is **no multi-season backtest** — generalisation to other target months is untested.

### Inputs (first 12 months of cash flow only)
Income irregularity, recent income trend, liquid cash in months of essential costs, fixed obligations / income, USD debt service / income, discretionary share of spending, savings rate, months with a negative balance, number of income sources.
**Never inputs:** gender, age band, region.

### Results (held-out test, errors in GEL — lower is better)

| | MAE | RMSE | Cautious-bound coverage |
|---|---|---|---|
| **Selected: gradient boosting (challenger)** | **1,183** | **2,166** | **89.2%** |
| Ridge regression (champion) | 1,263 | 2,222 | – |
| Baseline: training mean cash need in essential-cost months | 1,987 | 2,817 | – |
| Selected, stress regime (5,000 customers) | 1,375 | 2,477 | 84.9% |

**Selection:** lowest validation RMSE; the challenger (gradient boosting) won. Test customers were not used for selection.
**Cautious bound:** a 90% upper bound fitted on held-out calibration residuals. Coverage is a *population* target: 89.2% of test customers and 84.9% of stress customers fell under their bound — it is not a personal guarantee, and shocks reduce it.
**Reserve rule:** `required = max(3 months of essential costs, cautious estimate)`. With incomplete history the required reserve is at least 6 months of essentials. If available assets cannot cover the required reserve, **all** assets are protected, the shortfall is surfaced, and no investment is proposed.
**Explanation per customer:** one-feature-replacement effects in GEL (feature replaced by its training median) — explicitly non-additive and non-causal, not SHAP.

### Fairness (held-out test, selected model)

| Group | n | MAE, GEL | Under-predicted | Bound coverage |
|---|---|---|---|---|
| female | 1,468 | 1,168 | 20.0% | 89.2% |
| male | 1,532 | 1,199 | 20.4% | 89.3% |
| under 30 | 564 | 1,358 | 23.9% | 87.8% |
| 30–49 | 1,138 | 1,113 | 17.6% | 90.9% |
| 50–64 | 818 | 1,094 | 19.2% | 88.9% |
| 65+ | 480 | 1,297 | 23.7% | 87.5% |
| Tbilisi | 1,383 | 1,408 | 21.5% | 87.9% |
| Adjara | 308 | 989 | 14.6% | 91.2% |
| Imereti | 451 | 1,019 | 20.0% | 90.5% |
| Other regions | 858 | 978 | 20.3% | 90.0% |

Group error and upper-bound coverage on synthetic held-out customers; not proof of fairness. A higher estimate means a *larger protective reserve*, not a denial of service.

### Limitations
- Synthetic data: the metrics describe the synthetic cohort, not real customers; real outcome validation has not been done.
- The first pilot step is retraining on partner history — a CSV with 24 consecutive months per customer supports outcome-based training (`ml/external.py`). The organiser XLSX runs inference only.
- Features from bank data omit transfers between the customer's own accounts, so negative-balance months are approximated.
- **Fallback:** under 6 months of history or partial bank data requires a reserve of at least 6 months of essentials, a zero saving limit and an adviser review.

### What the cash-need model adds

Source: `backend/danazogi/ml/artifacts/liquidity.diagnostics.json` (held-out test set).

- The model raises the reserve above the 3-month rule for **38.5%** of test customers, by **+1,817 GEL** on average where it binds.
- Coverage of realised 12-month cash need: **85.0%** with the rule alone vs **92.1%** with the model.
- Stress cohort: the model binds for **40.4%** (+1,717 GEL mean uplift); coverage **81.3%** rule-only vs **88.8%** with the model.
- Among the demo customers it binds for Lamara (`reserve_basis = cash_need_model`).

### Why the cautious estimate can equal the expected one

For **5.1%** of test customers (4.6% under stress) the cautious estimate sits within 0.5 GEL of the expected one. The outcome is zero-inflated — most similar customers need no extra cash at all — so the 90th percentile can sit at or below the mean. In those cases the minimum-reserve rule covers them; the app labels the condition (`bound_collapsed`) rather than hiding it.

### Six months of history

The organiser workbook carries 6 months of history vs the 12 the model trained on. Measured impact (from the diagnostics file; income variability, trend, savings rate and essential-cost scale are recomputed on 6 months while obligation, debt and discretionary features keep their 12-month values — an approximation):

- Cautious-bound coverage falls from **89.2% → 86.5%** (stress: 84.9% → 82.0%).
- For income variability > 0.4 (n=291 test / 484 stress): bound coverage **62.2% / 52.9%**; reserve coverage with the 3-month floor **82.5% / 72.9%**, with a 6-month floor **97.3% / 94.2%**.
- Rule added: fewer than 12 months of history *and* income variability > 0.4 → 6-month reserve floor plus an adviser review flag (`short_irregular_history`).

Custom customers created in the demo ("Try your own numbers") are synthetic — generated from the values typed into the form, not real bank data.

---

## Model 2 · Next-month spending regression (`spending-regression-1.0+71fe66c8`)

**Purpose.** Estimate total spending in the next month, including one-off costs. With the income reference (the lower of past-average and recent three-month income — not an income forecast) it sets the monthly saving limit enforced by AFF-01.

**Target.** Total spending in month 13, including simulated one-off costs. Features from the first 12 months only.

### Results (held-out test, errors in GEL — lower is better)

| | MAE | RMSE | Cautious-bound coverage |
|---|---|---|---|
| **Selected: Ridge regression (champion)** | **159** | **483** | **90.1%** |
| Gradient boosting (challenger) | 173 | 495 | – |
| Baseline: last three months' average spending | 152 | 484 | – |
| Selected, stress regime (5,000 customers) | 168 | 491 | 90.3% |

**Honest result:** Ridge won against the fitted gradient-boosting candidate on validation RMSE. A separate quantile regression supplies the calibrated cautious bound. Held-out results do not establish a material improvement over the recent-average spending baseline (RMSE 483 vs 484; MAE 159 vs 152, slightly worse).
**Limit rule:** `monthly limit = max(0, min(max(historical saving, 0), income reference − max(cautious spending, essential spending)))`. Essential and debt payments are already inside the cautious spending estimate, so they are included once — never double-subtracted. The limit is zero on short (<6 months) or partial history and on a reserve shortfall.

### Fairness (held-out test, selected model)

| Group | n | MAE, GEL | Under-predicted | Bound coverage |
|---|---|---|---|---|
| female | 1,468 | 159 | 30.7% | 90.3% |
| male | 1,532 | 160 | 32.1% | 90.0% |
| under 30 | 564 | 180 | 27.5% | 91.5% |
| 30–49 | 1,138 | 175 | 35.1% | 89.1% |
| 50–64 | 818 | 152 | 36.9% | 89.6% |
| 65+ | 480 | 110 | 17.7% | 91.9% |
| Tbilisi | 1,383 | 189 | 32.5% | 90.6% |
| Adjara | 308 | 170 | 30.2% | 90.9% |
| Imereti | 451 | 127 | 34.4% | 87.8% |
| Other regions | 858 | 125 | 28.6% | 90.3% |

### Limitations
- Same synthetic-cohort limits as Model 1: metrics describe synthetic customers; real outcome validation has not been done.
- Histories end in September with month 13 = October in the generator; there is no multi-season next-month backtest, so seasonality outside October is untested.

---

## Model 3 · Peer groups (`peers-1.0`) — supporting clustering, unchanged

**Purpose.** Compare a customer's optional spending with people in the same situation and estimate money they could redirect to their goal.

- **Method:** k-means on situation features only: log income, age, dependents, income type, region. Spending is benchmarked, never clustered, so the comparison is not circular. Gender is excluded.
- **Feature weights (after standardising):** log income 1.2, age 1.8, dependents 0.8, income type 1.6 (one-hot), region 1.0 (one-hot). The previous version weighted the one-hot blocks at 2.5 and 2.0, which swamped age: a 25-year-old and a 60-year-old landed in the same group. Now the group changes with age for the same income type and region (tested).
- **Number of groups:** chosen by silhouette score over k = 10–16, giving **10 groups** (silhouette 0.25; lower than before because groups now split on age and income, not just type × region).
- **Stability:** adjusted Rand index between independent fits on two halves of the data, **0.92**.
- **Group names** use the members' actual ages: an age band is named only if at least 60% of members are in it, otherwise the 20th–80th percentile range (for example "Salaried · 20–35 · Tbilisi"). 86% of the cohort falls inside its group's named age range; the worst group 66%.
- **Privacy:** k-anonymity floor of 50 people per group. Smallest group: 1,020.
- **Fairness:** the largest share of either gender in any group is 55%.
- **Savings opportunity:** only optional categories (delivery, dining, taxis, subscriptions, clothing, travel, electronics) above the group's 75th percentile, and only half the gap to the median. **Essential spending is never suggested as a cut (rule SPEND-01).**

### Limitations
- Group names summarise the members and are approximate.
- Benchmarks are synthetic until real data is provided.

---

## Optimiser (not ML, documented for model risk)

- **Rockafellar–Uryasev CVaR(95%) linear program** (SciPy HiGHS) over 1,500 simulated Georgian macro paths per horizon.
- **Tested:** the LP's CVaR matches the empirical CVaR, no random feasible portfolio beats it, and the frontier is monotone.
- **Assumptions** (shown in the interface): crisis probability 8% per year with 12–32% depreciation, GEL inflation 3.5%, ETF return 7% with 16% volatility, and the NBG deposit rates quoted in the brief.
- **Known sensitivity:** allocations depend strongly on the crisis probability, expected depreciation and the 40% concentration caps.
