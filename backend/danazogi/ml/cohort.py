"""Event-driven synthetic cohort of Georgian savers.

Each saver gets hidden traits (income type, income level, region, age,
household, saving discipline, financial fragility, USD loan) and 24 months of
cash flow. Hidden life events (job loss, business slump, medical costs, a
wedding or funeral, repairs, a remittance stopping, an FX shock in the stress
regime) hit the second year. Regression features use the first 12 months.
Targets are the maximum cumulative essential-cash deficit in months 13-24
and total spending in month 13. Aggregate one-off costs are placed in one
simulated future month. The legacy binary label is retained for compatibility
but is not used to train either active regression.

Protected attributes (gender, age band, region) are never regression inputs.
The legacy peer clustering separately uses age and region. A modest 8%
gender income gap is built in so group-error audits have a signal to detect.
"""

import numpy as np

INCOME_TYPES = ["salaried", "self_employed", "seasonal", "pensioner", "remittance"]
INCOME_TYPE_LABELS = {
    "salaried": ("ხელფასიანი", "Salaried"),
    "self_employed": ("თვითდასაქმებული", "Self-employed"),
    "seasonal": ("სეზონური ბიზნესი", "Seasonal business"),
    "pensioner": ("პენსიონერი", "Pensioner"),
    "remittance": ("გზავნილებზე დამოკიდებული", "Remittance-dependent"),
}
REGIONS = ["tbilisi", "adjara", "imereti", "other"]
REGION_LABELS = {"tbilisi": ("თბილისი", "Tbilisi"), "adjara": ("აჭარა", "Adjara"),
                 "imereti": ("იმერეთი", "Imereti"), "other": ("სხვა რეგიონები", "Other regions")}

ESSENTIAL = ["housing", "groceries", "utilities", "health", "transport", "telecom", "debt_usd"]
DISCRETIONARY = ["delivery", "dining", "taxi", "subscriptions", "clothing", "travel", "electronics"]
CATEGORIES = ESSENTIAL + DISCRETIONARY

FEATURES = [
    ("income_cv", "შემოსავლის არასტაბილურობა", "Income irregularity"),
    ("income_trend", "შემოსავლის ბოლოდროინდელი ცვლილება", "Recent income trend"),
    ("liquid_months", "ხელმისაწვდომი თანხა (ხარჯის თვეები)", "Liquid cash (months of essential costs)"),
    ("obligation_ratio", "ფიქსირებული გადასახადები / შემოსავალი", "Fixed obligations / income"),
    ("fx_debt_ratio", "დოლარის ვალის მომსახურება / შემოსავალი", "USD debt service / income"),
    ("discretionary_share", "არააუცილებელი ხარჯის წილი", "Discretionary share of spending"),
    ("savings_rate", "დანაზოგის განაკვეთი", "Savings rate"),
    ("overdraft_months", "უარყოფითი ნაშთის თვეები", "Months with a negative balance"),
    ("income_sources", "შემოსავლის წყაროების რაოდენობა", "Number of income sources"),
]
FEATURE_KEYS = [f for f, _, _ in FEATURES]
FEATURE_LOW = [0, -1, 0, 0, 0, 0, -1, 0, 1]
FEATURE_HIGH = [3, 1, 60, 2, 1, 1, 1, 1, 4]

SEASON = np.array([0.35, 0.30, 0.40, 0.60, 0.90, 1.60, 2.30, 2.50, 1.50, 0.70, 0.40, 0.45])
SEASON = SEASON / SEASON.mean()
OBS, OUT = 12, 12  # observation and outcome windows, months
LABEL_SHARE = 0.30


def generate(n: int = 20000, seed: int = 7, shock: bool = False) -> dict:
    rng = np.random.default_rng(seed + (1000 if shock else 0))
    T = OBS + OUT
    itype = rng.choice(5, n, p=[0.55, 0.15, 0.08, 0.17, 0.05])
    region = rng.choice(4, n, p=[0.45, 0.12, 0.15, 0.28])
    gender = rng.integers(0, 2, n)  # 0 = female, 1 = male
    pensioner = itype == 3
    age = np.where(pensioner, rng.integers(63, 86, n), rng.integers(21, 63, n))
    lam = np.where(age < 27, 0.3, np.where(age <= 50, 1.2, 0.5))
    dependents = np.clip(rng.poisson(lam), 0, 4)
    discipline = rng.beta(2, 3, n)
    fragility = rng.beta(2, 5, n)

    region_mult = np.array([1.25, 1.0, 0.85, 0.8])[region]
    median = np.array([1900, 2300, 2100, 480, 850])[itype]
    sigma = np.array([0.45, 0.65, 0.5, 0.25, 0.4])[itype]
    gap = np.where((gender == 0) & ~pensioner, 0.92, 1.0)
    level = median * region_mult * gap * rng.lognormal(0, sigma)

    cal = (9 + np.arange(T)) % 12  # month 0 = October
    inc = np.empty((n, T))
    noise_sd = np.array([0.03, 0.30, 0.15, 0.02, 0.25])[itype]
    inc[:] = level[:, None] * rng.lognormal(0, noise_sd[:, None], (n, T))
    seasonal = itype == 2
    inc[seasonal] *= SEASON[cal][None, :]
    has_remit = pensioner & (rng.random(n) < 0.4)
    remit = np.where(has_remit, rng.lognormal(np.log(400), 0.3, n), 0.0)
    inc += remit[:, None]
    gaps = (itype == 4)[:, None] & (rng.random((n, T)) < 0.08)
    inc[gaps] = 0.0
    second_job = (~pensioner) & (rng.random(n) < 0.10)
    side = np.where(second_job, rng.lognormal(np.log(350), 0.4, n), 0.0)
    inc += side[:, None]
    bonus = (itype == 0) & (rng.random(n) < 0.35)
    inc[bonus, 2] += level[bonus] * rng.uniform(0.3, 1.0, bonus.sum())  # December bonus
    income_sources = 1 + has_remit.astype(int) + second_job.astype(int)

    # Spending structure
    inc_mean = inc[:, :OBS].mean(1)
    target_sr = np.clip(0.02 + 0.25 * discipline + 0.05 * np.log(np.maximum(inc_mean, 200) / 1500), -0.05, 0.45)
    budget = inc_mean * (1 - target_sr)
    ess_share = np.clip(0.85 - 0.12 * np.log(np.maximum(inc_mean, 200) / 1000) + rng.normal(0, 0.05, n), 0.45, 0.95)
    fx_loan = rng.random(n) < np.where(np.isin(itype, [1, 2]), 0.25, np.where(pensioner, 0.02, 0.10))
    debt = np.where(fx_loan, inc_mean * rng.uniform(0.08, 0.30, n), 0.0)
    renter = rng.random(n) < np.where(age < 35, 0.55, 0.15) * np.where(region == 0, 1.3, 0.8)
    rent = np.where(renter, rng.uniform(450, 1100, n) * region_mult, 0.0)

    young_urban = (age < 35) & (region == 0)
    ess_w = np.column_stack([
        np.zeros(n),  # housing handled as fixed rent
        0.38 + 0.06 * dependents,
        np.full(n, 0.12),
        0.08 + np.where(age > 60, 0.15, 0.0),
        np.full(n, 0.10),
        np.full(n, 0.04),
        np.zeros(n),
    ]) * rng.lognormal(0, 0.25, (n, len(ESSENTIAL)))
    disc_w = np.column_stack([
        np.where(young_urban, 0.15, 0.05), np.full(n, 0.20), np.where(region == 0, 0.12, 0.04),
        np.full(n, 0.05), np.full(n, 0.25), np.full(n, 0.13), np.full(n, 0.10),
    ]) * rng.lognormal(0, 0.5, (n, len(DISCRETIONARY)))
    ess_w /= ess_w.sum(1, keepdims=True)
    disc_w /= disc_w.sum(1, keepdims=True)
    flexible = np.maximum(budget - rent - debt, budget * 0.3)
    cat_mean = np.column_stack([
        rent[:, None],
        (flexible * ess_share)[:, None] * ess_w[:, 1:6],
        debt[:, None],
        (flexible * (1 - ess_share))[:, None] * disc_w,
    ])
    spend = cat_mean[:, :, None] * rng.lognormal(0, 0.15, (n, len(CATEGORIES), T))

    # Hidden life events in the outcome window
    m = np.arange(T)
    out = m >= OBS
    hazard_job = np.where(itype == 0, 0.006, np.where(itype == 1, 0.012, 0.0)) * (1 + 3 * fragility)
    hazard_job *= np.where(age < 25, 2.0, 1.0) * (1.8 if shock else 1.0)
    job_month = np.where(rng.random(n) < 1 - (1 - hazard_job) ** OUT, rng.integers(OBS, T, n), -1)
    slump = np.isin(itype, [1, 2]) & (rng.random(n) < 0.15 * (1 + fragility) * (2.0 if shock else 1.0))
    slump_month = np.where(slump, rng.integers(OBS, T - 3, n), -1)
    remit_stop = (has_remit | (itype == 4)) & (rng.random(n) < (0.12 if not shock else 0.2))
    remit_month = np.where(remit_stop, rng.integers(OBS, T, n), -1)

    for i in np.where(job_month >= 0)[0]:
        j = job_month[i]
        inc[i, j:min(T, j + rng.integers(3, 7))] *= 0.0 if rng.random() < 0.8 else 0.4
        if j < OBS + 6 and rng.random() < 0.4:  # early warning: reduced hours before the loss
            inc[i, OBS - 3:OBS] *= rng.uniform(0.75, 0.9)
    for i in np.where(slump_month >= 0)[0]:
        j = slump_month[i]
        inc[i, j:j + 4] *= 0.5
        if rng.random() < 0.5:
            inc[i, OBS - 3:OBS] *= rng.uniform(0.7, 0.9)
    for i in np.where(remit_month >= 0)[0]:
        inc[i, remit_month[i]:] -= np.where(itype[i] == 4, level[i], remit[i])
    inc = np.maximum(inc, 0.0)

    if shock:  # a 30% depreciation in month 14 lifts USD-linked costs
        fx = np.ones(T)
        fx[OBS + 2:] = 1.3
        for c in ("debt_usd", "travel", "electronics", "subscriptions"):
            spend[:, CATEGORIES.index(c), :] *= fx[None, :]

    event_cost = np.zeros(n)
    medical = rng.random(n) < 1 - (1 - (0.002 + 0.0004 * np.maximum(age - 40, 0))) ** OUT
    event_cost += np.where(medical, rng.lognormal(np.log(2500), 0.7, n), 0.0)
    family = rng.random(n) < 1 - (1 - 0.004 * (1 + 0.2 * dependents)) ** OUT
    event_cost += np.where(family, rng.lognormal(np.log(4000), 0.6, n), 0.0)
    repair = rng.random(n) < 1 - (1 - 0.003) ** OUT
    event_cost += np.where(repair, rng.lognormal(np.log(1500), 0.6, n), 0.0)

    total_spend = spend.sum(1)
    disc_idx = [CATEGORIES.index(c) for c in DISCRETIONARY]
    cut = (inc[:, out] < 0.6 * inc_mean[:, None])  # people trim discretionary spend when income drops
    total_spend[:, out] -= np.where(cut, 0.3 * spend[:, disc_idx, :][:, :, out].sum(1), 0.0)

    # Balances
    months_saved = rng.gamma(2.0, 2.0 + 6.0 * discipline) * (1 + age / 60)
    savings = inc_mean * months_saved
    liquid_share = rng.uniform(0.3, 1.0, n)
    net = inc - total_spend
    liquid = np.empty((n, OBS + 1))
    liquid[:, 0] = savings * liquid_share - net[:, :OBS].sum(1) * 0.5
    for t in range(OBS):
        liquid[:, t + 1] = liquid[:, t] + net[:, t]
    savings_12 = np.maximum(savings + net[:, :OBS].sum(1) * 0.5, 100.0)
    liquid_12 = np.clip(liquid[:, -1], 0, savings_12)

    withdrawals = np.maximum(-net[:, out], 0).sum(1) + event_cost
    y = (withdrawals > LABEL_SHARE * savings_12).astype(int)

    essential_spend = spend[:, :len(ESSENTIAL), :OBS].sum(1).mean(1)
    obligations = spend[:, [0, 2, 5, 6], :OBS].sum(1).mean(1)
    obs_inc = inc[:, :OBS]
    X = np.column_stack([
        obs_inc.std(1) / np.maximum(obs_inc.mean(1), 1),
        (obs_inc[:, -3:].mean(1) - obs_inc[:, :9].mean(1)) / np.maximum(obs_inc.mean(1), 1),
        liquid_12 / np.maximum(essential_spend, 1),
        obligations / np.maximum(obs_inc.mean(1), 1),
        spend[:, CATEGORIES.index("debt_usd"), :OBS].mean(1) / np.maximum(obs_inc.mean(1), 1),
        spend[:, disc_idx, :OBS].sum(1).mean(1) / np.maximum(total_spend[:, :OBS].mean(1), 1),
        net[:, :OBS].sum(1) / np.maximum(obs_inc.sum(1), 1),
        (liquid[:, 1:] < 0).mean(1),
        income_sources.astype(float),
    ])
    X = np.clip(X, FEATURE_LOW, FEATURE_HIGH)
    from .regression import cash_target

    event_path = np.zeros((n, OUT))
    event_month = np.random.default_rng(seed + 9000).integers(0, OUT, n)
    event_path[np.arange(n), event_month] = event_cost
    essential_history = spend[:, :len(ESSENTIAL), :OBS].sum(1)
    future_essential = spend[:, :len(ESSENTIAL), OBS:].sum(1)
    cash_need = cash_target(inc[:, OBS:], future_essential, event_path)

    return {
        "X": X, "y": y,
        "cash_need_gel": cash_need,
        "next_spend_gel": total_spend[:, OBS] + event_path[:, 0],
        "essential_spend": essential_spend,
        "income_history": inc[:, :OBS].copy(),
        "spend_history": total_spend[:, :OBS].copy(),
        "essential_history": essential_history,
        "gender": gender, "age": age, "region": region, "itype": itype, "dependents": dependents,
        "income": obs_inc.mean(1),
        "category_spend": spend[:, :, :OBS].mean(2),
        "shock": shock, "seed": seed,
    }
