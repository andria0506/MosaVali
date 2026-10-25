"""Explainability agent: exact Shapley attributions + plain-Georgian narrative.

The optimiser is treated as a function of four saver features: horizon,
share of USD-linked costs, liquidity need (from Model 1) and the mission's
risk level. Each feature is switched between a reference saver's value and
the user's own value, and the optimiser is re-run for all 2^4 coalitions. The
exact Shapley value of a feature is its average marginal effect on every
asset weight. The narrative is deterministic: every sentence is built from
those numbers and carries them as evidence chips.
"""

from itertools import product
from math import factorial

import numpy as np

from ..data.market import ASSETS
from . import stress

FEATURES = [
    ("horizon", "ინვესტირების ჰორიზონტი", "investment horizon"),
    ("usd_share", "დოლარზე მიბმული ხარჯების წილი", "share of USD-linked costs"),
    ("buffer", "ლიკვიდობის საჭიროება", "liquidity need"),
    ("risk", "მისიის რისკის დონე", "mission risk level"),
]
REFERENCE = {"horizon": 3, "usd_share": 0.35, "buffer_months": 6.0, "risk": 5}

FORMS = {  # nominative, genitive, locative (Georgian); English
    "CASH": ("ნაღდი ფული", "ნაღდი ფულის", "ნაღდ ფულში", "cash"),
    "LIQ": ("ლარის ხელმისაწვდომი დანაზოგი", "ლარის ხელმისაწვდომი დანაზოგის", "ხელმისაწვდომ ლარის ანგარიშზე", "instant-access GEL"),
    "USD_CASH": ("დოლარის ხელმისაწვდომი ანგარიში", "დოლარის ხელმისაწვდომი ანგარიშის", "ხელმისაწვდომ დოლარის ანგარიშზე", "instant-access USD"),
    "GEL_DEP": ("ლარის ვადიანი ანაბარი", "ლარის ვადიანი ანაბრის", "ლარის ვადიან ანაბარში", "GEL term deposits"),
    "USD_DEP": ("დოლარის ვადიანი ანაბარი", "დოლარის ვადიანი ანაბრის", "დოლარის ვადიან ანაბარში", "USD term deposits"),
    "TBILL": ("სახელმწიფო სახაზინო ფასიანი ქაღალდები", "სახაზინო ფასიანი ქაღალდების", "სახელმწიფო სახაზინო ფასიან ქაღალდებში", "Georgian treasury securities"),
    "ETF": ("გლობალური აქციების ETF", "გლობალური აქციების ETF-ის", "გლობალური აქციების დოლარის ETF-ში", "a global equity USD ETF"),
}
LIQUID = ("LIQ", "USD_CASH")
WHY = {
    "car": ("ვინაიდან საქართველოში მანქანები ძირითადად იმპორტირებულია და მათი ფასი დოლარზეა მიბმული",
            "Since cars in Georgia are mostly imported and priced in dollars"),
    "apartment": ("ვინაიდან საქართველოში უძრავი ქონება ძირითადად აშშ დოლარშია ინდექსირებული",
                  "Since real estate in Georgia is mostly priced in US dollars"),
    "business": ("ვინაიდან აღჭურვილობა და სამშენებლო მასალები ძირითადად იმპორტირებულია და მათი ფასი დოლარზეა მიბმული",
                 "Since equipment and building materials are mostly imported and priced in dollars"),
    "gel": ("ვინაიდან თქვენი მომავალი ხარჯები ძირითადად ლარშია",
            "Since your future costs are mostly in lari"),
}


def pct(x: float, lang: str, signed: bool = False, digits: int = 0) -> str:
    s = f"{abs(x) * 100:.{digits}f}"
    if lang == "ka":
        s = s.replace(".", ",")
    sign = ("+" if x > 0 else "−" if x < 0 else "") if signed else ("−" if x < 0 else "")
    return f"{sign}{s}%"


def num(x: float, lang: str, digits: int = 0) -> str:
    s = f"{x:,.{digits}f}"
    return s.replace(",", " ").replace(".", ",") if lang == "ka" else s


def _shapley(values: dict[tuple, np.ndarray], m: int) -> np.ndarray:
    phi = np.zeros((m, len(next(iter(values.values())))))
    for i in range(m):
        for mask in values:
            if mask[i]:
                continue
            s = sum(mask)
            w = factorial(s) * factorial(m - s - 1) / factorial(m)
            on = tuple(1 if j == i else v for j, v in enumerate(mask))
            phi[i] += w * (values[on] - values[mask])
    return phi


def attributions(user: dict, essential: float, total: float, equity_cap: float, buffer_usd_share: float) -> dict:
    ref_buffer = min(REFERENCE["buffer_months"] * essential / total, 0.95) if total else 0.95
    ref = {"horizon": REFERENCE["horizon"], "usd_share": REFERENCE["usd_share"], "buffer": ref_buffer,
           "risk": REFERENCE["risk"]}
    keys = [f for f, _, _ in FEATURES]
    values = {}
    for mask in product((0, 1), repeat=len(keys)):
        x = {k: user[k] if on else ref[k] for k, on in zip(keys, mask)}
        R = stress.real_returns(int(x["horizon"]), float(x["usd_share"]))
        cons = stress.Constraints(float(x["buffer"]), equity_cap, buffer_usd_share)
        values[mask] = stress.frontier(R, cons, [int(x["risk"])])[int(x["risk"])]
    phi = _shapley(values, len(keys))
    return {"reference": ref, "base": values[(0,) * len(keys)], "final": values[(1,) * len(keys)],
            "phi": {k: {a.key: float(v) for a, v in zip(ASSETS, row)} for k, row in zip(keys, phi)}}


def _value_text(key: str, value: float, months: float, mission: dict | None, lang: str) -> str:
    if key == "horizon":
        return f"{int(value)} წელი" if lang == "ka" else f"{int(value)} years"
    if key == "usd_share":
        return pct(value, lang)
    if key == "buffer":
        return f"{num(months, lang, 1)} თვე" if lang == "ka" else f"{num(months, lang, 1)} months"
    if mission:
        return f"„{mission['ka']}“, {int(value)}/10" if lang == "ka" else f"{mission['en']}, {int(value)}/10"
    return f"{int(value)}/10"


def _benchmark(bench: dict, preserve: bool) -> dict | None:
    dep, plan = bench.get("deposit"), bench.get("plan")
    if not dep or not plan:
        return None
    dp, pp = dep["probability"], plan["probability"]
    ds, ps = dep["lari_shock_2015"], plan["lari_shock_2015"]
    what_ka = "ინფლაციის დაძლევის" if preserve else "მიზნის დროულად მიღწევის"
    what_en = "of beating inflation" if preserve else "of reaching the goal on time"
    return {"id": "benchmark",
            "ka": f"მხოლოდ ლარის ვადიანი ანაბარი {what_ka} {pct(dp, 'ka')}-იან ალბათობას იძლევა, ეს გეგმა კი — "
                  f"{pct(pp, 'ka')}-იანს. 2014–15 წლების მსგავს შოკში ანაბრის შედეგი იქნებოდა {pct(ds, 'ka', True)}, "
                  f"გეგმის — {pct(ps, 'ka', True)}.",
            "en": f"A GEL term deposit alone gives a {pct(dp, 'en')} chance {what_en}; this plan gives {pct(pp, 'en')}. "
                  f"In a 2014–15 style shock the deposit would end at {pct(ds, 'en', True)} and the plan at {pct(ps, 'en', True)}.",
            "evidence": [{"code": "DEP", "value": pct(dp, "en")}, {"code": "P", "value": pct(pp, "en")},
                         {"code": "S15", "value": f"{pct(ds, 'en', True)} → {pct(ps, 'en', True)}"}]}


def narrative(*, mission: dict, attr: dict, user: dict, goal: dict, horizon: int, usd_share: float, liq: dict,
              current: dict, total: float, monthly: float, compliance: dict, bench: dict | None = None) -> list[dict]:
    w = mission["weights"]
    out = []
    invest = sorted(((k, v) for k, v in w.items() if k not in LIQUID and v >= 0.01), key=lambda kv: -kv[1])
    if not invest:
        out.append({"id": "summary",
                    "ka": "მოდელი გირჩევთ, დანაზოგი ძირითადად ხელმისაწვდომ ანგარიშებზე დატოვოთ, რადგან ლიკვიდობის საჭიროება მაღალია.",
                    "en": "The model suggests keeping your savings mostly in instant-access accounts, because your liquidity need is high.",
                    "evidence": []})
    else:
        top = invest[:2]
        ka_parts = [f"{pct(v, 'ka')} გადაანაწილა {FORMS[k][2]}" if i == 0 else f"{pct(v, 'ka')} — {FORMS[k][2]}"
                    for i, (k, v) in enumerate(top)]
        en_parts = [f"{pct(v, 'en')} of your savings into {FORMS[k][3]}" if i == 0 else f"{pct(v, 'en')} into {FORMS[k][3]}"
                    for i, (k, v) in enumerate(top)]
        out.append({
            "id": "summary",
            "ka": f"მოდელმა თქვენი დანაზოგის {' და '.join(ka_parts)}, რადგან თქვენი მიზანია {goal['ka']} {horizon} წელში.",
            "en": f"The model put {' and '.join(en_parts)}, because your goal is {goal['en']} in {horizon} years.",
            "evidence": [{"code": next(a.code for a in ASSETS if a.key == k), "value": pct(v, "en")} for k, v in top]
                        + [{"code": "H", "value": f"{horizon}y"}],
        })

    why = WHY.get(goal["kind"]) if usd_share >= 0.5 else WHY["gel"]
    why = why or WHY["gel"]
    c_cur, c_plan = current["cvar95"], mission["cvar95"]
    if c_cur > 0.005 and c_plan < c_cur:
        red = (c_cur - c_plan) / c_cur
        out.append({"id": "tail",
                    "ka": f"{why[0]}, ეს სტრუქტურა {pct(red, 'ka')}-ით ამცირებს ყველაზე ცუდი 5% სცენარის საშუალო "
                          f"დანაკარგს (CVaR) თქვენს ამჟამინდელ დანაზოგთან შედარებით.",
                    "en": f"{why[1]}, this structure cuts the average loss in the worst 5% of scenarios (CVaR) by "
                          f"{pct(red, 'en')} compared with your current savings.",
                    "evidence": [{"code": "CVaR", "value": f"{pct(c_cur, 'en', digits=1)} → {pct(c_plan, 'en', digits=1)}"}]})
    else:
        out.append({"id": "tail",
                    "ka": f"{why[0]}, ყველაზე ცუდი 5% სცენარის საშუალო შედეგი {pct(-c_plan, 'ka', True, 1)}-ია, "
                          f"ამჟამინდელ დანაზოგთან ({pct(-c_cur, 'ka', True, 1)}) შედარებით.",
                    "en": f"{why[1]}, the average outcome of the worst 5% of scenarios is {pct(-c_plan, 'en', True, 1)}, "
                          f"against {pct(-c_cur, 'en', True, 1)} for your current savings.",
                    "evidence": [{"code": "CVaR", "value": f"{pct(c_cur, 'en', digits=1)} → {pct(c_plan, 'en', digits=1)}"}]})

    if goal["kind"] == "preserve":
        out.append({"id": "goal",
                    "ka": f"{pct(mission['probability'], 'ka')} ალბათობით თქვენი დანაზოგი {horizon} წელში ინფლაციას აჯობებს.",
                    "en": f"There is a {pct(mission['probability'], 'en')} chance your savings beat inflation over {horizon} years.",
                    "evidence": [{"code": "P", "value": pct(mission["probability"], "en")}]})
    else:
        out.append({"id": "goal",
                    "ka": f"თვეში {num(monthly, 'ka')} ლარის შენატანით მიზნის დროულად მიღწევის ალბათობაა {pct(mission['probability'], 'ka')}.",
                    "en": f"Investing {num(monthly, 'en')} GEL a month gives a {pct(mission['probability'], 'en')} chance of "
                          f"reaching your goal on time.",
                    "evidence": [{"code": "P", "value": pct(mission["probability"], "en")},
                                 {"code": "₾/mo", "value": num(monthly, "en")}]})

    b = _benchmark(bench or {}, goal["kind"] == "preserve")
    if b:
        out.append(b)

    buffer_sentence = {
        "id": "buffer",
        "ka": f"მომდევნო 12 თვის ფულის დანაკლისის პროგნოზია {num(liq['expected_need_gel'], 'ka')} ლარი, "
              f"ფრთხილი შეფასება — {num(liq['cautious_need_gel'], 'ka')} ლარი. პროგნოზისა და მინიმალური "
              f"რეზერვის წესებით დაცულია {num(liq['buffer_gel'], 'ka')} ლარი.",
        "en": f"The 12-month cash-shortfall forecast is {num(liq['expected_need_gel'], 'en')} GEL; the cautious "
              f"estimate is {num(liq['cautious_need_gel'], 'en')} GEL. We protect {num(liq['buffer_gel'], 'en')} GEL "
              f"using the forecast and minimum-reserve rules.",
        "evidence": [{"code": "NEED", "value": f"{num(liq['expected_need_gel'], 'en')} GEL"},
                     {"code": "UPPER", "value": f"{num(liq['cautious_need_gel'], 'en')} GEL"},
                     {"code": "LQ", "value": f"{num(liq['buffer_gel'], 'en')} GEL"},
                     {"code": "BASIS", "value": liq["reserve_basis"]}],
    }
    basis_ka, basis_en = {
        "cash_need_model": ("რეზერვს მოდელის ფრთხილი შეფასება ადგენს.",
                            "The model's cautious estimate sets the reserve."),
        "minimum_rule": ("რეზერვს 3-თვიანი მინიმალური წესი ადგენს, რადგან პროგნოზი ნაკლებია.",
                         "The 3-month minimum rule sets the reserve because the forecast is lower."),
        "fallback_minimum": ("არასრული ან არარეგულარული ისტორიის გამო რეზერვი სულ მცირე 6 თვეა.",
                             "Because the history is incomplete or irregular, the reserve is at least 6 months."),
        "all_assets": ("აუცილებელი ხარჯები ვერ განისაზღვრა, ამიტომ მთელი დანაზოგი დაცულია.",
                       "Essential spending could not be measured, so all savings are protected."),
    }[liq["reserve_basis"]]
    buffer_sentence["ka"] += f" {basis_ka}"
    buffer_sentence["en"] += f" {basis_en}"
    if liq["buffer_shortfall_gel"] > 0:
        buffer_sentence["tone"] = "warn"
        buffer_sentence["ka"] += (f" ყურადღება: რეზერვს {num(liq['buffer_shortfall_gel'], 'ka')} ლარი აკლია — "
                                  f"საჭირო რეზერვი სრულად დაფარული არ არის.")
        buffer_sentence["en"] += (f" Warning: the reserve is {num(liq['buffer_shortfall_gel'], 'en')} GEL short — "
                                  f"the full required reserve is not funded.")
    out.append(buffer_sentence)

    pairs = sorted(((f, a, v) for f, row in attr["phi"].items() for a, v in row.items() if abs(v) >= 0.02),
                   key=lambda t: -abs(t[2]))
    used, labels = set(), {f: (ka, en) for f, ka, en in FEATURES}
    for f, a, v in pairs:
        if f in used or len(used) == 2:
            continue
        used.add(f)
        vka = _value_text(f, user[f], liq["buffer_months"], mission, "ka")
        ven = _value_text(f, user[f], liq["buffer_months"], mission, "en")
        out.append({"id": f"driver-{f}",
                    "ka": f"{labels[f][0]} ({vka}) {FORMS[a][1]} წილს {num(abs(v) * 100, 'ka')} პ.პ.-ით "
                          f"{'ზრდის' if v > 0 else 'ამცირებს'} საორიენტაციო შემნახველთან შედარებით.",
                    "en": f"Your {labels[f][1]} ({ven}) {'raises' if v > 0 else 'lowers'} the {FORMS[a][3]} share by "
                          f"{num(abs(v) * 100, 'en')} pp versus a reference saver.",
                    "evidence": [{"code": "SHAP", "value": f"{'+' if v > 0 else '−'}{num(abs(v) * 100, 'en')} pp"}]})

    for c in compliance["checks"]:
        if c["status"] in ("warn", "block"):
            out.append({"id": f"rule-{c['rule']}", "tone": "block" if c["status"] == "block" else "warn",
                        "ka": f"{c['rule']}: {c['ka']}", "en": f"{c['rule']}: {c['en']}",
                        "evidence": [{"code": c["rule"], "value": c["status"]}]})
    out.append({"id": "oversight",
                "ka": "ეს საგანმანათლებლო ანალიზია და არა ინდივიდუალური საინვესტიციო რჩევა. საბოლოო გადაწყვეტილებას იღებთ თქვენ.",
                "en": "This is educational analysis, not individual investment advice. You make the final decision.",
                "evidence": []})
    return out


def explain(*, ing: dict, liq: dict, prof: dict, mission: dict, current: dict, monthly: float, compliance: dict,
            bench: dict | None = None) -> dict:
    total = ing["totals"]["assets_gel"]
    m = ing["metrics"]
    cap = prof["capacity"]
    user = {"horizon": prof["horizon"], "usd_share": prof["usd_liability_share"], "buffer": liq["buffer_share"],
            "risk": mission["level"]}
    equity_cap = min(cap["equity_cap"], 0.10) if mission["key"] == "protect" else cap["equity_cap"]
    attr = attributions(user, m["essential_spend"], total, equity_cap, m["essential_usd_share"])
    ref = attr["reference"]
    return {
        "mission": mission["key"],
        "features": [{
            "key": f, "label_ka": ka, "label_en": en,
            "user_ka": _value_text(f, user[f], liq["buffer_months"], mission, "ka"),
            "user_en": _value_text(f, user[f], liq["buffer_months"], mission, "en"),
            "reference_ka": _value_text(f, ref[f], REFERENCE["buffer_months"], None, "ka"),
            "reference_en": _value_text(f, ref[f], REFERENCE["buffer_months"], None, "en"),
        } for f, ka, en in FEATURES],
        "phi": attr["phi"],
        "base_weights": stress.as_dict(attr["base"]),
        "final_weights": stress.as_dict(attr["final"]),
        "coalitions": 2 ** len(FEATURES),
        "narrative": narrative(mission=mission, attr=attr, user=user, goal=prof["goal"], horizon=prof["horizon"],
                               usd_share=prof["usd_liability_share"], liq=liq, current=current, total=total,
                               monthly=monthly, compliance=compliance, bench=bench),
    }
