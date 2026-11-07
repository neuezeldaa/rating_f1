"""Гоночные дуэли с напарником: кто финишировал выше.

Дуэль засчитывается, если оба финишировали или один из них сошёл по своей ошибке
(тогда он проиграл). Сходы по технике, дисквалификации и неясные сходы дуэль
не решают: это пропуск данных, а не поражение. Спринты идут с меньшим весом.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from ..clean.overrides import Overrides
from ..clean.status import (
    DISQUALIFIED,
    DRIVER_ERROR,
    FINISHED,
    MECHANICAL,
    UNCLEAR,
    VICTIM,
    classify_status,
)
from ..config import SPRINT_WEIGHT

_EXCLUSION_REASONS = (
    (DISQUALIFIED, "дисквалификация"),
    (MECHANICAL, "техника"),
    (VICTIM, "чужая ошибка"),
    (UNCLEAR, "неясный сход"),
)


def _status(row) -> str:
    """Причина схода из F1DB, если есть, иначе статус Jolpica."""
    detail = row.get("status_detail")
    return detail if isinstance(detail, str) else row["status"]


def _category(overrides: Overrides, season, rnd, session, row) -> str:
    key = (season, rnd, session, row["driver_id"])
    return overrides.status.get(key, classify_status(_status(row)))


def race_duels(results: pd.DataFrame, overrides: Overrides) -> pd.DataFrame:
    rows = []
    groups = results.groupby(["season", "round", "session", "constructor_id"], sort=True)
    for (season, rnd, session, team), group in groups:
        if len(group) != 2:
            continue
        season, rnd = int(season), int(rnd)
        a, b = (row for _, row in group.sort_values("driver_id").iterrows())
        cat_a = _category(overrides, season, rnd, session, a)
        cat_b = _category(overrides, season, rnd, session, b)
        row = {
            "season": int(season),
            "round": int(rnd),
            "session": session,
            "constructor_id": team,
            "driver_a": a["driver_id"],
            "driver_b": b["driver_id"],
            "status_a": _status(a),
            "status_b": _status(b),
            "category_a": cat_a,
            "category_b": cat_b,
            "position_a": a["position"],
            "position_b": b["position"],
            "outcome": np.nan,  # 1 — A выше B, 0 — B выше A
            "weight": 1.0 if session == "R" else SPRINT_WEIGHT,
            "valid": False,
            "reason": "",
        }
        manual = {(season, rnd, session, a["driver_id"]), (season, rnd, session, b["driver_id"])}
        if manual & overrides.exclude_race:
            row["reason"] = "ручное исключение"
        elif cat_a == FINISHED and cat_b == FINISHED:
            row.update(outcome=float(a["position"] < b["position"]), valid=True)
        elif cat_a == FINISHED and cat_b == DRIVER_ERROR:
            row.update(outcome=1.0, valid=True, reason="напарник сошёл по своей ошибке")
        elif cat_a == DRIVER_ERROR and cat_b == FINISHED:
            row.update(outcome=0.0, valid=True, reason="напарник сошёл по своей ошибке")
        elif cat_a == DRIVER_ERROR and cat_b == DRIVER_ERROR:
            row["reason"] = "оба сошли по своей ошибке"
        else:
            cats = {cat_a, cat_b}
            row["reason"] = next(text for cat, text in _EXCLUSION_REASONS if cat in cats)
        rows.append(row)
    return pd.DataFrame(rows)
