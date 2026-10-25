"""Model 2: situation-based peer clustering and spending benchmarks.

Savers are grouped by situation (income level, income type, age, household,
region), never by spending, so the comparison is not circular. Within each
group the model stores median, 75th and 90th percentile monthly spend per
category. Groups smaller than 50 people are not allowed (k-anonymity). The
savings opportunity counts only discretionary categories where the user is
above the group's 75th percentile, and only half the gap to the median.
Essential spending (food, medicine, utilities, rent) is never suggested as a cut.
"""

import hashlib

import numpy as np
from sklearn.cluster import KMeans
from sklearn.metrics import adjusted_rand_score, silhouette_score

from .cohort import CATEGORIES, DISCRETIONARY, INCOME_TYPE_LABELS, INCOME_TYPES, REGION_LABELS, REGIONS, generate

VERSION = "peers-1.0"
MIN_GROUP = 50
K_RANGE = range(10, 17)
SHARE_OF_GAP = 0.5
CATEGORY_LABELS = {
    "housing": ("ქირა", "Rent"), "groceries": ("სურსათი", "Groceries"), "utilities": ("კომუნალური", "Utilities"),
    "health": ("ჯანმრთელობა", "Health"), "transport": ("ტრანსპორტი", "Transport"),
    "telecom": ("კავშირგაბმულობა", "Telecom"), "debt_usd": ("დოლარის სესხი", "USD loan"),
    "delivery": ("საკვების მიტანა", "Food delivery"), "dining": ("კვება გარეთ", "Dining out"),
    "taxi": ("ტაქსი", "Taxi"), "subscriptions": ("ციფრული გამოწერები", "Digital subscriptions"),
    "clothing": ("ტანსაცმელი", "Clothing"), "travel": ("მოგზაურობა", "Travel"),
    "electronics": ("ელექტრონიკა", "Electronics"),
}
AGE_BANDS = [(0, 29, "18–29"), (30, 44, "30–44"), (45, 62, "45–62"), (63, 200, "63+")]
# Feature weights after standardising. Earlier one-hot weights (2.5 type, 2.0 region) swamped age and income,
# so a 25-year-old and a 60-year-old landed in the same group.
W_NUM = np.array([1.2, 1.8, 0.8])  # log income, age, dependents
W_TYPE = 1.6
W_REGION = 1.0
BAND_SHARE = 0.6  # a group is named after an age band only if this share of its members is in it


def _design(income, age, dependents, itype, region, center=None, scale=None):
    num = np.column_stack([np.log(np.maximum(income, 100)), age, dependents]).astype(float)
    center = num.mean(0) if center is None else np.asarray(center)
    scale = num.std(0) if scale is None else np.asarray(scale)
    onehot_t = np.eye(len(INCOME_TYPES))[itype] * W_TYPE
    onehot_r = np.eye(len(REGIONS))[region] * W_REGION
    return np.column_stack([(num - center) / scale * W_NUM, onehot_t, onehot_r]), center, scale


def _name(members: dict) -> dict:
    t = INCOME_TYPES[np.bincount(members["itype"], minlength=5).argmax()]
    r_counts = np.bincount(members["region"], minlength=4)
    ages = members["age"]
    shares = {lbl: float(((ages >= lo) & (ages <= hi)).mean()) for lo, hi, lbl in AGE_BANDS}
    top = max(shares, key=shares.get)
    if shares[top] >= BAND_SHARE:
        band = top
    else:
        p20, p80 = np.percentile(ages, [20, 80])
        band = f"{int(5 * np.floor(p20 / 5))}–{int(5 * np.ceil(p80 / 5))}"
    if r_counts.max() / r_counts.sum() >= 0.5:
        r_ka, r_en = REGION_LABELS[REGIONS[r_counts.argmax()]]
    else:
        r_ka, r_en = "სხვადასხვა რეგიონი", "mixed regions"
    return {"ka": f"{INCOME_TYPE_LABELS[t][0]} · {band} · {r_ka}", "en": f"{INCOME_TYPE_LABELS[t][1]} · {band} · {r_en}"}


def train(data: dict | None = None, seed: int = 0) -> dict:
    data = data or generate()
    Z, center, scale = _design(data["income"], data["age"], data["dependents"], data["itype"], data["region"])
    rng = np.random.default_rng(seed)
    sample = rng.choice(len(Z), size=min(4000, len(Z)), replace=False)
    sil = {}
    for k in K_RANGE:
        labels = KMeans(n_clusters=k, n_init=5, random_state=seed).fit_predict(Z[sample])
        sil[k] = float(silhouette_score(Z[sample], labels))
    k_best = max(sil, key=sil.get)
    km = KMeans(n_clusters=k_best, n_init=10, random_state=seed).fit(Z)
    labels = km.labels_

    half = rng.permutation(len(Z))
    a = KMeans(n_clusters=k_best, n_init=5, random_state=seed + 1).fit(Z[half[: len(Z) // 2]])
    b = KMeans(n_clusters=k_best, n_init=5, random_state=seed + 2).fit(Z[half[len(Z) // 2:]])
    stability = float(adjusted_rand_score(a.predict(Z), b.predict(Z)))

    groups = []
    spend = data["category_spend"]
    for g in range(k_best):
        mask = labels == g
        if mask.sum() < MIN_GROUP:
            raise ValueError(f"Group {g} has {mask.sum()} members, below the k-anonymity floor of {MIN_GROUP}")
        members = {k: data[k][mask] for k in ("itype", "region", "age")}
        groups.append({
            "id": g, "name": _name(members), "size": int(mask.sum()),
            "median_income": float(np.median(data["income"][mask])),
            "female_share": float((data["gender"][mask] == 0).mean()),
            "benchmarks": {c: {"p50": float(np.median(spend[mask, i])), "p75": float(np.quantile(spend[mask, i], 0.75)),
                               "p90": float(np.quantile(spend[mask, i], 0.9))} for i, c in enumerate(CATEGORIES)},
        })
    for tag in ("household", "income"):
        names = [g["name"]["en"] for g in groups]
        for g in groups:
            if names.count(g["name"]["en"]) < 2:
                continue
            if tag == "household":
                kids = float(np.mean(data["dependents"][labels == g["id"]])) >= 0.8
                ka, en = ("შვილებით", "with children") if kids else ("შვილების გარეშე", "no children")
            else:
                inc = f"{round(g['median_income'], -2):,.0f}"
                ka, en = f"≈{inc.replace(',', ' ')} ₾", f"≈{inc} GEL"
            g["name"] = {"ka": f"{g['name']['ka']} · {ka}", "en": f"{g['name']['en']} · {en}"}
    fingerprint = hashlib.sha256(Z.tobytes()).hexdigest()[:8]
    return {
        "version": f"{VERSION}+{fingerprint}",
        "kmeans": km, "center": center.tolist(), "scale": scale.tolist(),
        "k": k_best, "silhouette": sil, "stability_ari": stability,
        "groups": groups,
        "min_group": MIN_GROUP,
        "max_gender_dominance": float(max(max(g["female_share"], 1 - g["female_share"]) for g in groups)),
        "inputs": ["income level (log)", "age", "dependents", "income type", "region"],
        "excluded": ["gender", "spending (benchmarked, not clustered)"],
        "data": {"n": int(len(Z)), "source": "Synthetic event-driven cohort (danazogi/ml/cohort.py)"},
    }


def assign(bundle: dict, income: float, age: int, dependents: int, income_type: str, region: str) -> dict:
    Z, _, _ = _design(np.array([income]), np.array([age]), np.array([dependents]),
                      np.array([INCOME_TYPES.index(income_type)]), np.array([REGIONS.index(region)]),
                      bundle["center"], bundle["scale"])
    return bundle["groups"][int(bundle["kmeans"].predict(Z)[0])]


def opportunities(group: dict, user_spend: dict[str, float]) -> dict:
    rows, total = [], 0.0
    for c in CATEGORIES:
        b = group["benchmarks"][c]
        you = float(user_spend.get(c, 0.0))
        discretionary = c in DISCRETIONARY
        save = SHARE_OF_GAP * (you - b["p50"]) if discretionary and you > b["p75"] else 0.0
        total += save
        rows.append({"category": c, "label_ka": CATEGORY_LABELS[c][0], "label_en": CATEGORY_LABELS[c][1],
                     "you": round(you, 2), "p50": round(b["p50"], 2), "p75": round(b["p75"], 2),
                     "discretionary": discretionary, "above_p75": you > b["p75"],
                     "monthly_saving": round(save, 2)})
    rows.sort(key=lambda r: (-r["monthly_saving"], -r["you"]))
    return {"group": {k: group[k] for k in ("id", "name", "size", "median_income")},
            "rows": rows, "monthly_total": round(total, 2),
            "rule": "Only discretionary categories above the group's 75th percentile; half the gap to the median. "
                    "Essential spending is never suggested as a cut."}
