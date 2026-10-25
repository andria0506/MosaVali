"""Asset universe, macro assumptions, category inflation and stylised Georgian stress episodes.

Only two numbers come from a cited source (the brief, quoting NBG data): the
July 2026 average term-deposit rates of 8.91% (GEL) and 2.52% (FX). Every
other value is a labelled modelling assumption that the UI exposes.
"""

from dataclasses import asdict, dataclass
from datetime import date

AS_OF = date(2026, 10, 19)
FX_SPOT = 2.70  # GEL per USD, demo snapshot (assumption)
CPI_YOY = 0.034  # headline GEL inflation, demo snapshot (assumption)
NBG_RATE = 0.08  # policy rate, demo snapshot (assumption)


@dataclass(frozen=True)
class Asset:
    key: str
    code: str
    name_ka: str
    name_en: str
    currency: str
    rate: float  # nominal annual yield or expected return in its own currency
    vol: float  # annual volatility of the local-currency return (ETF only)
    duration: float  # sensitivity of price to a policy-rate change, in years
    passthrough: float  # share of a policy-rate change passed into next year's yield
    fee: float  # annual all-in fee
    fx_cost: float  # one-off conversion spread for USD exposure
    liquidity_days: int
    source: str

    def public(self) -> dict:
        return asdict(self)


ASSETS: list[Asset] = [
    Asset("CASH", "CA", "ნაღდი ფული და მიმდინარე ანგარიში", "Cash and current accounts", "GEL",
          0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0, "No interest"),
    Asset("LIQ", "LQ", "ლარის ხელმისაწვდომი დანაზოგი", "GEL instant-access savings", "GEL",
          0.030, 0.0, 0.0, 0.5, 0.0, 0.0, 0, "Assumption: typical demand-savings rate"),
    Asset("USD_CASH", "UC", "დოლარის ხელმისაწვდომი ანგარიში", "USD instant-access cash", "USD",
          0.005, 0.0, 0.0, 0.0, 0.0, 0.005, 0, "Assumption: typical USD current/savings rate"),
    Asset("GEL_DEP", "GD", "ლარის ვადიანი ანაბარი", "GEL term deposit", "GEL",
          0.0891, 0.0, 0.0, 0.6, 0.0, 0.0, 365, "NBG average GEL term-deposit rate, July 2026 (quoted in brief)"),
    Asset("USD_DEP", "UD", "დოლარის ვადიანი ანაბარი", "USD term deposit", "USD",
          0.0252, 0.0, 0.0, 0.1, 0.0, 0.005, 365, "NBG average FX term-deposit rate, July 2026 (quoted in brief)"),
    Asset("TBILL", "TB", "სახელმწიფო სახაზინო ფასიანი ქაღალდები", "Georgian treasury securities", "GEL",
          0.092, 0.0, 1.0, 0.9, 0.002, 0.0, 30, "Assumption: blended 6–24 month treasury yield"),
    Asset("ETF", "ET", "გლობალური აქციების ETF (დოლარში)", "Global equity ETF (USD)", "USD",
          0.070, 0.16, 0.0, 0.0, 0.0045, 0.005, 3, "Assumption: long-run global equity return and volatility"),
]

ASSET_INDEX = {a.key: i for i, a in enumerate(ASSETS)}

MACRO = {
    "gel_inflation_mean": 0.035,
    "gel_inflation_sd": 0.015,
    "usd_inflation_mean": 0.025,
    "usd_inflation_sd": 0.010,
    "fx_drift": 0.015,
    "fx_sd": 0.05,
    "crisis_probability": 0.08,
    "crisis_fx_min": 0.12,
    "crisis_fx_max": 0.32,
    "fx_inflation_passthrough": 0.25,
    "crisis_rate_hike_min": 0.01,
    "crisis_rate_hike_max": 0.04,
    "rate_mean_reversion": 0.35,
    "equity_crash_probability": 0.07,
    "equity_crash_mean": -0.28,
}

MACRO_LABELS = {
    "gel_inflation_mean": ("ლარის ინფლაცია (საშუალო)", "GEL inflation (mean)"),
    "fx_drift": ("ლარის წლიური გაუფასურების ტრენდი", "Annual GEL depreciation trend"),
    "crisis_probability": ("სავალუტო შოკის წლიური ალბათობა", "Annual probability of an FX shock year"),
    "crisis_fx_max": ("შოკის მაქსიმალური სიღრმე", "Largest modelled FX shock"),
    "equity_crash_probability": ("გლობალური ბაზრის ვარდნის ალბათობა", "Annual probability of a global equity crash"),
}

# Annual inflation by spending category. Assumption shaped like Geostat CPI by
# COICOP division; replace with the Geostat series when provided. "usd" marks
# categories priced off the dollar (imported goods, travel, USD loans).
CPI_BY_CATEGORY = {
    "groceries": 0.055, "health": 0.065, "utilities": 0.040, "housing": 0.045, "transport": 0.030,
    "fuel": 0.035, "telecom": 0.010, "family": CPI_YOY, "payroll": CPI_YOY, "other": CPI_YOY,
    "dining": 0.060, "delivery": 0.060, "taxi": 0.040, "clothing": 0.020,
    "subscriptions": "usd", "travel": "usd", "electronics": "usd", "building": "usd", "debt_usd": "usd",
}
CPI_SOURCE = "Assumption shaped like Geostat CPI by COICOP division."


def usd_indexed_inflation() -> float:
    """Expected annual GEL price growth of something priced in dollars."""
    return (1 + MACRO["fx_drift"]) * (1 + MACRO["usd_inflation_mean"]) - 1


def category_inflation(category: str) -> float:
    v = CPI_BY_CATEGORY.get(category, CPI_YOY)
    return usd_indexed_inflation() if v == "usd" else float(v)


# One-year stylised shocks. Magnitudes are rounded approximations of the
# episodes for model-risk illustration, not exact historical series.
EPISODES = [
    {"code": "S08", "ka": "2008–09: ომი და გლობალური კრიზისი", "en": "2008–09: war and global crisis",
     "fx": 0.17, "inflation": 0.06, "rate": -0.02, "equity": -0.38},
    {"code": "S15", "ka": "2014–15: ლარის გაუფასურება", "en": "2014–15: lari depreciation",
     "fx": 0.33, "inflation": 0.05, "rate": 0.04, "equity": -0.01},
    {"code": "S20", "ka": "2020: პანდემიის შოკი", "en": "2020: pandemic shock",
     "fx": 0.14, "inflation": 0.06, "rate": -0.01, "equity": -0.20},
    {"code": "S22", "ka": "2021–22: ინფლაციის ზრდა", "en": "2021–22: inflation spike",
     "fx": -0.08, "inflation": 0.12, "rate": 0.025, "equity": -0.18},
]


@dataclass(frozen=True)
class Fund:
    """A fund type (never a named product) or an illustrative single stock, for educational comparison only.
    Yearly return in its own currency: rate + beta * (global equity - its expected return) + own noise
    + crisis (only in lari-crisis years), minus the all-in fee."""
    key: str
    code: str
    name_ka: str
    name_en: str
    desc_ka: str
    desc_en: str
    currency: str
    rate: float
    beta: float
    idio: float
    fee: float
    fx_cost: float
    asset: str | None = None  # reuse an existing asset bucket's returns (deposits, treasuries)
    crisis: float = 0.0
    episodes: tuple = ()  # optional (code, one-year return) overrides where beta alone misleads (bonds in 2022)
    source: str = "Assumption"

    def public(self) -> dict:
        return {k: v for k, v in asdict(self).items() if k != "episodes"}


FUNDS: list[Fund] = [
    Fund("WORLD", "WS", "მსოფლიოს აქციების ინდექსური ფონდი", "World stock index fund",
         "ათასობით კომპანია ათობით ქვეყნიდან", "Thousands of companies in dozens of countries",
         "USD", 0.070, 1.0, 0.0, 0.0045, 0.005, source="Assumption: same as the plan's global equity ETF"),
    Fund("US", "US", "აშშ-ის მსხვილი კომპანიების ინდექსური ფონდი", "US large-company index fund",
         "აშშ-ის დაახლოებით 500 უდიდესი კომპანია", "About 500 of the largest US companies",
         "USD", 0.070, 1.05, 0.05, 0.0040, 0.005, source="Assumption: long-run return and volatility"),
    Fund("EM", "EM", "განვითარებადი ბაზრების ინდექსური ფონდი", "Emerging-markets index fund",
         "კომპანიები ჩინეთიდან, ინდოეთიდან, ბრაზილიიდან და სხვა ქვეყნებიდან", "Companies in China, India, Brazil and other emerging economies",
         "USD", 0.075, 1.2, 0.12, 0.0060, 0.005, source="Assumption: long-run return and volatility"),
    Fund("BOND", "GB", "გლობალური ობლიგაციების ფონდი (დოლარში ჰეჯირებული)", "Global bond index fund (USD-hedged)",
         "მთავრობებისა და კომპანიების ობლიგაციები მთელ მსოფლიოში", "Government and company bonds worldwide",
         "USD", 0.035, 0.1, 0.045, 0.0040, 0.005, episodes=(("S22", -0.11),),
         source="Assumption: long-run return and volatility; 2022 result is an approximation of the hedged global bond index"),
    Fund("TBILL", "TB", "სახელმწიფო სახაზინო ფასიანი ქაღალდები", "Georgian treasury securities",
         "საქართველოს მთავრობის ლარის ობლიგაციები", "Georgian government bonds in lari",
         "GEL", 0.0, 0.0, 0.0, 0.0, 0.0, asset="TBILL", source="Same assumption as the plan's treasury bucket"),
    Fund("GEL_DEP", "GD", "ლარის ვადიანი ანაბარი", "GEL term deposit",
         "12-თვიანი ანაბარი ბანკში", "A 12-month deposit at a bank",
         "GEL", 0.0, 0.0, 0.0, 0.0, 0.0, asset="GEL_DEP", source="NBG average GEL term-deposit rate (quoted in brief)"),
    Fund("USD_DEP", "UD", "დოლარის ვადიანი ანაბარი", "USD term deposit",
         "12-თვიანი დოლარის ანაბარი ბანკში", "A 12-month dollar deposit at a bank",
         "USD", 0.0, 0.0, 0.0, 0.0, 0.0, asset="USD_DEP", source="NBG average FX term-deposit rate (quoted in brief)"),
]

# Illustrative single-stock profiles, not real companies. Used only to show what concentration does.
STOCK_PROFILES: list[Fund] = [
    Fund("big_tech", "ST", "ერთი მსხვილი ამერიკული ტექნოლოგიური კომპანია", "One large US tech company",
         "დიდი ზრდა შეიძლება, მაგრამ ერთ კომპანიას ცალკე ვარდნაც ემართება", "Can grow fast, but one company can also fall on its own",
         "USD", 0.080, 1.2, 0.30, 0.0020, 0.005, source="Assumption: illustrative single-stock profile"),
    Fund("ge_bank", "SB", "ერთი ქართული ბანკის აქცია (ლონდონის ბირჟაზე)", "One Georgian bank share (London-listed)",
         "იმავე ეკონომიკაზეა დამოკიდებული, რაზეც თქვენი ხელფასი", "Tied to the same economy as your salary",
         "USD", 0.090, 0.9, 0.30, 0.0020, 0.005, crisis=-0.25, source="Assumption: illustrative single-stock profile"),
    Fund("local_small", "SL", "ერთი მცირე კომპანია საქართველოს საფონდო ბირჟაზე", "One small company on the Georgian Stock Exchange",
         "ცოტა მყიდველია: გაყიდვა შეიძლება გაგიჭირდეთ", "Few buyers: it may be hard to sell when you need to",
         "GEL", 0.080, 0.3, 0.40, 0.0100, 0.0, crisis=-0.20, source="Assumption: illustrative single-stock profile"),
]
FUNDS_SOURCE = ("Fund types, not products. Returns, volatility, fees and single-stock profiles are labelled assumptions; "
                "the licensed partner chooses actual products.")


def market_snapshot() -> dict:
    return {
        "as_of": AS_OF.isoformat(),
        "fx_spot": FX_SPOT,
        "cpi_yoy": CPI_YOY,
        "nbg_rate": NBG_RATE,
        "labels": "Demo snapshot. Values are assumptions, not live feeds.",
    }
