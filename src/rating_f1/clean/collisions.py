"""Виновники столкновений по решениям стюардов FIA (ingest/fia.py, с 2019 года).

Для каждого схода после столкновения (статус Collision или Collision damage):
- пилот сам наказан за столкновение в этой сессии → своя ошибка: дуэль с напарником
  засчитывается как поражение;
- наказан другой пилот, и в решении назван этот пилот, или наказанный ехал рядом (±2 места)
  на последнем пройденном круге → пострадавший: дуэль не учитывается, в «Аккуратность» не идёт;
- иначе неясно, как раньше (столкновение без наказания — гоночный инцидент).
Ручные правки из annotations/overrides.yaml главнее.
"""
from __future__ import annotations

import pandas as pd

from .status import DRIVER_ERROR, UNCLEAR, VICTIM, classify_status, is_collision

ADJACENT = 2  # «рядом» — не дальше двух мест на последнем пройденном круге


def collision_status(results: pd.DataFrame, verdicts: pd.DataFrame, laps: pd.DataFrame) -> dict:
    """{(сезон, этап, сессия, пилот): категория} для сходов после столкновений, где виновник известен."""
    culprits: dict = {}
    named: dict = {}
    for v in verdicts.itertuples(index=False):
        key = (int(v.season), int(v.round), v.session)
        culprits.setdefault(key, set()).add(v.driver_id)
        if isinstance(v.other_driver_id, str):
            named.setdefault(key, set()).add(v.other_driver_id)
    position = {(int(s), int(r), d, int(lap)): p for s, r, d, lap, p in
                zip(laps["season"], laps["round"], laps["driver_id"], laps["lap"], laps["position"])}
    grid = {(int(s), int(r), d): g for s, r, d, g, sess in
            zip(results["season"], results["round"], results["driver_id"], results["grid"], results["session"])
            if sess == "R" and pd.notna(g)}

    def where(season, rnd, driver, lap):
        return position.get((season, rnd, driver, lap)) if lap > 0 else grid.get((season, rnd, driver))

    out = {}
    for row in results.itertuples(index=False):
        if not is_collision(row.status_detail) or classify_status(row.status_detail) != UNCLEAR:
            continue
        key = (int(row.season), int(row.round), row.session)
        who = culprits.get(key, set())
        if row.driver_id in who:
            out[key + (row.driver_id,)] = DRIVER_ERROR
        elif row.driver_id in named.get(key, set()):
            out[key + (row.driver_id,)] = VICTIM
        elif who and row.session == "R" and pd.notna(row.laps):
            lap = int(row.laps)
            mine = where(key[0], key[1], row.driver_id, lap)
            near = [where(key[0], key[1], c, lap) for c in who]
            if mine is not None and any(p is not None and abs(p - mine) <= ADJACENT for p in near):
                out[key + (row.driver_id,)] = VICTIM
    return out
