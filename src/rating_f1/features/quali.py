"""Гэп к напарнику в квалификации.

Сравниваем время в последнем сегменте (Q3 → Q2 → Q1), где оба напарника поставили время:
так условия на трассе максимально близки. Гэп считаем в % от времени круга
как 100 · ln(t_A / t_B): положительный — пилот A медленнее.

Эпоха дозаправок: в 2006–2009 годах Q3 ехали с топливом на гонку — сравниваем по Q2;
в 2003–2005 годах был один круг с топливом — сравнение идёт с половинным весом (config.py).
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from ..clean.overrides import Overrides
from ..config import FUEL_Q3_SEASONS, QUALI_MAX_GAP_PCT, RACE_FUEL_QUALI_SEASONS, RACE_FUEL_QUALI_WEIGHT

SEGMENTS = ("q3", "q2", "q1")


def segments_for(season: int) -> tuple:
    """Сегменты для сравнения, от последнего к первому; Q3 с топливом на гонку пропускаем."""
    return SEGMENTS[1:] if season in FUEL_Q3_SEASONS else SEGMENTS


def quali_pairs(quali: pd.DataFrame, overrides: Overrides) -> pd.DataFrame:
    rows = []
    for (season, rnd, team), group in quali.groupby(["season", "round", "constructor_id"], sort=True):
        if len(group) != 2:
            continue
        season, rnd = int(season), int(rnd)
        a, b = (row for _, row in group.sort_values("driver_id").iterrows())
        row = {
            "season": int(season),
            "round": int(rnd),
            "constructor_id": team,
            "driver_a": a["driver_id"],
            "driver_b": b["driver_id"],
            "segment": None,
            "time_a": np.nan,
            "time_b": np.nan,
            "gap_pct": np.nan,
            "valid": False,
            "reason": "",
            "weight": RACE_FUEL_QUALI_WEIGHT if season in RACE_FUEL_QUALI_SEASONS else 1.0,
        }
        manual = {(season, rnd, a["driver_id"]), (season, rnd, b["driver_id"])} & overrides.exclude_quali
        if manual:
            row["reason"] = "ручное исключение"
            rows.append(row)
            continue
        for segment in segments_for(season):
            ta, tb = float(a[f"{segment}_s"]), float(b[f"{segment}_s"])
            if np.isfinite(ta) and np.isfinite(tb):
                row.update(segment=segment.upper(), time_a=ta, time_b=tb, gap_pct=100 * np.log(ta / tb))
                break
        if row["segment"] is None:
            row["reason"] = "нет общего времени"
        elif abs(row["gap_pct"]) > QUALI_MAX_GAP_PCT:
            row["reason"] = f"гэп больше {QUALI_MAX_GAP_PCT:g}%"
        else:
            row["valid"] = True
        rows.append(row)
    return pd.DataFrame(rows)
