"""Stylised monthly paths for the flight simulator.

Shapes and magnitudes approximate four episodes: the 2008–09 war and global
crisis, the 2014–15 lari depreciation, the 2020 pandemic shock and the 2022
inflation spike with a stronger lari. Each month carries the GEL/USD level,
the global equity return in USD, monthly GEL CPI and the NBG policy-rate move.
They are rounded illustrations for training, not exact historical series
(the 2008–09 and 2022 paths are approximations still to be checked against
NBG, Geostat and index data). Today's instruments are replayed through them.

Each chapter has one or two decision moments: the simulator pauses after that
month and asks the customer what they would do.
"""

CHAPTERS = [
    {
        "code": "S08",
        "ka": "2008–09: ომი და გლობალური კრიზისი",
        "en": "2008–09: war and the global crisis",
        "start_fx": 1.42,
        "months": [
            # (label, GEL per USD at month end, global equity return in USD, GEL CPI m/m, policy rate change)
            ("2008-07", 1.41, -0.025, 0.006, 0.0), ("2008-08", 1.42, -0.013, 0.012, 0.0),
            ("2008-09", 1.42, -0.120, 0.004, 0.0), ("2008-10", 1.42, -0.198, 0.002, 0.0),
            ("2008-11", 1.66, -0.070, -0.002, 0.0), ("2008-12", 1.67, 0.034, 0.000, -0.02),
            ("2009-01", 1.67, -0.086, 0.002, 0.0), ("2009-02", 1.67, -0.100, 0.000, 0.0),
            ("2009-03", 1.68, 0.078, -0.002, -0.01), ("2009-04", 1.67, 0.114, -0.003, 0.0),
            ("2009-05", 1.67, 0.099, -0.002, -0.01), ("2009-06", 1.65, -0.003, 0.001, 0.0),
        ],
        "decisions": {
            "2008-10": ("Lehman Brothers-ის გაკოტრების შემდეგ გლობალური ბაზრები ერთ თვეში ეცემა, აგვისტოს ომმა კი საქართველოს ეკონომიკა შეარყია.",
                        "After Lehman Brothers collapsed, global markets plunge within a month, and the August war has shaken Georgia's economy."),
            "2009-02": ("ბაზრები პიკიდან თითქმის ნახევრით არის ჩამოსული, ნოემბერში კი ლარი გაუფასურდა.",
                        "Markets are down almost half from their peak, and the lari was devalued in November."),
        },
    },
    {
        "code": "S15",
        "ka": "2014–15: ლარის გაუფასურება",
        "en": "2014–15: the lari depreciation",
        "start_fx": 1.76,
        "months": [
            ("2014-09", 1.75, -0.028, 0.003, 0.0), ("2014-10", 1.74, 0.006, 0.003, 0.0),
            ("2014-11", 1.80, 0.019, 0.004, 0.0), ("2014-12", 1.86, -0.017, 0.004, 0.0),
            ("2015-01", 1.98, -0.019, 0.005, 0.0), ("2015-02", 2.12, 0.058, 0.006, 0.005),
            ("2015-03", 2.23, -0.016, 0.006, 0.0), ("2015-04", 2.29, 0.023, 0.005, 0.0),
            ("2015-05", 2.24, -0.001, 0.004, 0.0), ("2015-06", 2.24, -0.025, 0.004, 0.0),
            ("2015-07", 2.22, 0.017, 0.003, 0.0), ("2015-08", 2.29, -0.068, 0.004, 0.015),
            ("2015-09", 2.37, -0.038, 0.004, 0.005), ("2015-10", 2.38, 0.079, 0.004, 0.0),
            ("2015-11", 2.40, -0.008, 0.004, 0.005), ("2015-12", 2.39, -0.019, 0.004, 0.010),
        ],
        "decisions": {
            "2015-01": ("ნავთობის ფასის ვარდნა და რეგიონის ვალუტების კრიზისი ლარს აზიანებს.",
                        "Falling oil prices and a regional currency crisis are pulling the lari down."),
            "2015-08": ("ლარი კვლავ ეცემა, ეროვნული ბანკი განაკვეთს ზრდის, გლობალური აქციებიც ეცემა.",
                        "The lari slides again, the NBG raises rates and global shares fall too."),
        },
    },
    {
        "code": "S20",
        "ka": "2020: პანდემიის შოკი",
        "en": "2020: the pandemic shock",
        "start_fx": 2.87,
        "months": [
            ("2020-01", 2.87, -0.006, 0.006, 0.0), ("2020-02", 2.80, -0.086, 0.005, 0.0),
            ("2020-03", 3.27, -0.132, 0.007, 0.0), ("2020-04", 3.21, 0.109, 0.005, -0.0025),
            ("2020-05", 3.18, 0.048, 0.003, -0.0025), ("2020-06", 3.06, 0.026, 0.002, -0.005),
            ("2020-07", 3.07, 0.047, 0.002, 0.0), ("2020-08", 3.09, 0.066, 0.002, 0.0),
            ("2020-09", 3.24, -0.036, 0.003, 0.0), ("2020-10", 3.22, -0.031, 0.004, 0.0),
            ("2020-11", 3.32, 0.127, 0.004, 0.0), ("2020-12", 3.28, 0.042, 0.004, 0.0),
        ],
        "decisions": {
            "2020-03": ("პანდემია: საზღვრები იკეტება, გლობალური ბაზრები და ლარი ერთდროულად ეცემა.",
                        "Pandemic: borders close, and global markets and the lari fall at the same time."),
        },
    },
    {
        "code": "S22",
        "ka": "2022: ინფლაცია და გამყარებული ლარი",
        "en": "2022: inflation and a stronger lari",
        "start_fx": 3.10,
        "months": [
            ("2022-01", 3.07, -0.049, 0.012, 0.0), ("2022-02", 3.08, -0.026, 0.011, 0.0),
            ("2022-03", 3.12, 0.022, 0.012, 0.005), ("2022-04", 3.03, -0.080, 0.010, 0.0),
            ("2022-05", 2.92, 0.001, 0.009, 0.0), ("2022-06", 2.93, -0.084, 0.008, 0.0),
            ("2022-07", 2.79, 0.070, 0.007, 0.0), ("2022-08", 2.81, -0.036, 0.007, 0.0),
            ("2022-09", 2.83, -0.096, 0.008, 0.0), ("2022-10", 2.76, 0.061, 0.007, 0.0),
            ("2022-11", 2.70, 0.078, 0.006, 0.0), ("2022-12", 2.70, -0.039, 0.005, 0.0),
        ],
        "decisions": {
            "2022-06": ("ფასები სწრაფად იზრდება, ცენტრალური ბანკები განაკვეთებს ზრდიან, აქციები ეცემა.",
                        "Prices are rising fast, central banks are raising rates and shares are falling."),
            "2022-09": ("აქციები წლის ახალ მინიმუმზეა, ლარი კი გამყარდა, ამიტომ დოლარის აქტივები ლარში ნაკლები ღირს.",
                        "Shares hit a new low for the year while the lari has strengthened, so dollar assets are worth fewer lari."),
        },
    },
]
CODES = [c["code"] for c in CHAPTERS]

SOURCE = ("Stylised monthly paths approximating 2008–09, 2014–15, 2020 and 2022 (GEL/USD, global equities, GEL CPI, "
          "NBG rate). Illustrative, not exact series; the 2008–09 and 2022 paths are rounded approximations to verify.")


def steps(chapters: list[str] | None = None) -> list[dict]:
    """Flatten the chosen chapters into monthly steps with the GEL/USD change instead of levels.
    Each step also carries running chapter totals, used for the decision-moment headline."""
    out = []
    for ch in CHAPTERS:
        if chapters and ch["code"] not in chapters:
            continue
        prev, eq_cum, cpi_cum = ch["start_fx"], 1.0, 1.0
        for i, (label, fx, eq, cpi, dr) in enumerate(ch["months"]):
            eq_cum *= 1 + eq
            cpi_cum *= 1 + cpi
            context = ch["decisions"].get(label)
            out.append({"chapter": ch["code"], "chapter_ka": ch["ka"], "chapter_en": ch["en"], "month": label,
                        "fx_level": fx, "fx": fx / prev - 1, "equity": eq, "cpi": cpi, "rate": dr, "first": i == 0,
                        "decision": None if context is None else {
                            "context_ka": context[0], "context_en": context[1],
                            "equity_since_start": eq_cum - 1, "lari_since_start": ch["start_fx"] / fx - 1,
                            "prices_since_start": cpi_cum - 1, "fx_level": fx}})
            prev = fx
    return out
