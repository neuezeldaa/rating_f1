"""Подменные выступления: короткий отрезок пилота в команде за сезон.

Пилот, который проехал за команду всего 1–3 гонки (подмена заболевшего, замена по ходу сезона),
обычно выступает ниже своего уровня: нет тестов, настройки под себя, привычки к машине.
Такие сравнения с напарником и слабые (мало гонок), и смещённые, поэтому в моделях
напарников они идут с половинным весом. В графе напарников то же правило задаёт силу связи.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

SHORT_STINT_RACES = 3
SHORT_STINT_WEIGHT = 0.5


def stint_starts(results: pd.DataFrame) -> dict:
    """(сезон, команда, пилот) → сколько гонок пилот проехал за эту команду в сезоне."""
    races = results[results["session"] == "R"]
    counts = races.groupby(["season", "constructor_id", "driver_id"]).size()
    return {(int(s), t, d): int(n) for (s, t, d), n in counts.items()}


def stint_factor(pairs: pd.DataFrame, starts: dict) -> np.ndarray:
    """Вес сравнения пары: 0,5, если хотя бы один из напарников — на коротком отрезке в команде."""
    factors = []
    for season, team, a, b in zip(pairs["season"], pairs["constructor_id"], pairs["driver_a"], pairs["driver_b"]):
        shortest = min(starts.get((int(season), team, a), 0), starts.get((int(season), team, b), 0))
        factors.append(SHORT_STINT_WEIGHT if shortest <= SHORT_STINT_RACES else 1.0)
    return np.array(factors, dtype=float)
