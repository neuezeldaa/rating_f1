"""Квалификация эпохи дозаправок: Q3 с топливом не сравниваем, 2003–2005 — половинный вес, до 2006 — топ-10."""
import numpy as np
import pandas as pd

from rating_f1.clean.overrides import Overrides
from rating_f1.features.quali import quali_pairs
from rating_f1.features.stats import quali_records


def _pair(season, q1, q2, q3):
    return pd.DataFrame({
        "season": [season, season], "round": [1, 1], "constructor_id": ["t", "t"], "driver_id": ["a", "b"],
        "position": [1, 2], "q1_s": q1, "q2_s": q2, "q3_s": q3,
    })


def test_q3_with_fuel_is_skipped_in_2006_2009():
    pairs = quali_pairs(_pair(2008, [80.0, 80.1], [79.0, 79.5], [81.0, 80.0]), Overrides())
    row = pairs.iloc[0]
    assert row["segment"] == "Q2"                    # в 2008 году Q3 ехали с топливом на гонку
    assert np.isclose(row["gap_pct"], 100 * np.log(79.0 / 79.5))


def test_q3_used_after_refuelling():
    pairs = quali_pairs(_pair(2012, [80.0, 80.1], [79.0, 79.5], [78.0, 78.2]), Overrides())
    assert pairs.iloc[0]["segment"] == "Q3"
    assert pairs.iloc[0]["weight"] == 1.0


def test_race_fuel_lap_has_half_weight():
    pairs = quali_pairs(_pair(2004, [80.0, 80.4], [np.nan, np.nan], [np.nan, np.nan]), Overrides())
    assert pairs.iloc[0]["weight"] == 0.5


def test_top10_counts_as_q3_before_knockout():
    q = pd.DataFrame({
        "season": [2002] * 12, "round": [1] * 12, "driver_id": [f"d{i}" for i in range(12)],
        "position": list(range(1, 13)), "q1_s": [80 + i / 10 for i in range(12)],
        "q2_s": [np.nan] * 12, "q3_s": [np.nan] * 12,
    })
    rec = quali_records(q).set_index("driver_id")
    assert rec.loc["d9", "q3"] and not rec.loc["d10", "q3"]   # 10-е место — «в Q3», 11-е — нет
