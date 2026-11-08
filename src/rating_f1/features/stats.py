"""Статистика пилота в каждой гонке и её сводка за сезон или период.

Всё, что видно по протоколам (Jolpica, F1DB) и по кругам (RaceData): очки, победы, подиумы,
поулы, выход в Q3, отставание в квалификации, темп и стабильность на чистых кругах,
первый круг, обгоны, отыгранные позиции, сходы по своей ошибке, штрафы, доля очков команды,
результат относительно уровня машины.

Очки считаем по единой шкале 25-18-15-12-10-8-6-4-2-1 только за гонки: без очков
за спринты и лучший круг — так сезоны 2018–2026 сравнимы между собой.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from ..clean.status import (DISQUALIFIED, DRIVER_ERROR, FINISHED, MECHANICAL, UNCLEAR, classify_status,
                            is_collision)
from .car_level import summarize_above_car

BASE_POINTS = {1: 25, 2: 18, 3: 15, 4: 12, 5: 10, 6: 8, 7: 6, 8: 4, 9: 2, 10: 1}
STANDING_POINTS = BASE_POINTS  # место в чемпионате → очки, как в опросе руководителей команд
MAX_QUALI_GAP_PCT = 5.0        # больше — сорванная попытка, а не скорость
KEY = ["season", "round"]


def quali_records(qualifying: pd.DataFrame) -> pd.DataFrame:
    """Место в квалификации и отставание от лучшего времени того сегмента, где пилот выбыл."""
    q = qualifying[KEY + ["driver_id", "position", "q1_s", "q2_s", "q3_s"]].copy()
    segment = np.select([q["q3_s"].notna(), q["q2_s"].notna(), q["q1_s"].notna()], ["q3_s", "q2_s", "q1_s"], "")
    q["seg"] = segment
    q["seg_time"] = [row[s] if s else np.nan for row, s in zip(q.to_dict("records"), segment)]
    best = {seg: q.groupby(KEY)[seg].transform("min") for seg in ("q1_s", "q2_s", "q3_s")}
    seg_best = np.select([q["seg"] == s for s in best], [best[s] for s in best], np.nan)
    q["quali_gap"] = 100 * (q["seg_time"] / seg_best - 1)
    q.loc[q["quali_gap"] > MAX_QUALI_GAP_PCT, "quali_gap"] = np.nan
    q["quali_pos"] = q["position"].astype(float)
    q["pole"] = q["quali_pos"] == 1
    q["q3"] = q["q3_s"].notna()
    return q[KEY + ["driver_id", "quali_pos", "quali_gap", "pole", "q3"]]


def race_records(results: pd.DataFrame, qualifying: pd.DataFrame, lap_stats: pd.DataFrame) -> pd.DataFrame:
    """Одна строка на старт пилота в гонке (без спринтов) со всеми исходными признаками."""
    r = results[results["session"] == "R"].copy()
    r["category"] = r["status_detail"].map(classify_status)
    classified = r["position_text"].astype(str).str.isdigit()
    r["finish_pos"] = r["position"].astype(float).where(classified)
    r["base_points"] = r["finish_pos"].map(BASE_POINTS).fillna(0.0)
    r["win"] = r["finish_pos"] == 1
    r["podium"] = r["finish_pos"] <= 3
    r["top10"] = r["finish_pos"] <= 10

    # Старт с пит-лейна (grid = 0) считаем последним местом на решётке.
    field = r.groupby(KEY)["driver_id"].transform("size")
    grid = r["grid"].astype(float)
    r["grid_pos"] = grid.where(grid > 0, field)
    r = r.merge(quali_records(qualifying), on=KEY + ["driver_id"], how="left")
    r = r.merge(lap_stats, on=KEY + ["driver_id"], how="left")
    for col in ("pole", "q3", "driver_of_the_day", "fastest_lap", "grand_slam"):
        r[col] = r[col].astype("boolean").fillna(False).astype(bool)

    finished = r["category"] == FINISHED
    r["gain"] = (r["grid_pos"] - r["finish_pos"]).where(finished)
    r["gain_vs_exp"] = r["gain"] - r["grid_pos"].map(r[finished].groupby("grid_pos")["gain"].mean())
    r["lap1_vs_exp"] = r["lap1_gain"] - r["grid_pos"].map(r.groupby("grid_pos")["lap1_gain"].mean())

    team = r.groupby(KEY + ["constructor_id"])["base_points"].transform("sum")
    r["mate_points"] = team - r["base_points"]
    r["driver_error"] = r["category"] == DRIVER_ERROR
    r["mechanical"] = r["category"] == MECHANICAL
    r["contact"] = (r["category"] == UNCLEAR) & r["status_detail"].map(is_collision)
    r["finished"] = finished
    r["penalty"] = r["time_penalty_s"].fillna(0) > 0
    r["dotd"] = r["driver_of_the_day"]
    return r


def summarize(records: pd.DataFrame, sprints: pd.DataFrame) -> pd.DataFrame:
    """Сводка по пилотам за выбранные гонки (и спринты того же охвата)."""
    g = records.groupby("driver_id")
    out = pd.DataFrame({
        "starts": g.size(),
        "points": g["base_points"].sum(),
        "wins": g["win"].sum(),
        "podiums": g["podium"].sum(),
        "top10": g["top10"].sum(),
        "poles": g["pole"].sum(),
        "q3": g["q3"].sum(),
        "quali_n": g["quali_pos"].count(),
        "quali_pos": g["quali_pos"].mean(),
        "quali_gap": g["quali_gap"].median(),
        "quali_gap_n": g["quali_gap"].count(),
        "race_pace": g["pace_gap"].median(),
        "consistency": g["consistency"].median(),
        "pace_n": g["pace_gap"].count(),
        "lap1_vs_exp": g["lap1_vs_exp"].mean(),
        "lap1_n": g["lap1_vs_exp"].count(),
        "overtakes": g["overtakes_made"].mean(),
        "overtaken": g["overtakes_lost"].mean(),
        "ot_n": g["overtakes_made"].count(),
        "overtakes_total": g["overtakes_made"].sum(),
        "gain_vs_exp": g["gain_vs_exp"].mean(),
        "gain_n": g["gain_vs_exp"].count(),
        "finish_pos": g["finish_pos"].mean(),
        "finished": g["finished"].sum(),
        "driver_errors": g["driver_error"].sum(),
        "contacts": g["contact"].sum(),
        "mechanical": g["mechanical"].sum(),
        "penalties": g["penalty"].sum(),
        "dotd": g["dotd"].sum(),
        "fastest_laps": g["fastest_lap"].sum(),
        "grand_slams": g["grand_slam"].sum(),
        "mate_points": g["mate_points"].sum(),
    })
    return out.join(summarize_above_car(records, sprints))


def incident_lists(records: pd.DataFrame) -> dict:
    """Что пошло не так в гонках пилота — для карточки «Аккуратность».

    {(пилот, сезон): [[этап, вид, причина или секунды штрафа, круг схода], …]};
    вид: error — своя ошибка, contact — столкновение, penalty — штраф по времени,
    mech — поломка, dsq — дисквалификация (последние два в балл не идут).
    """
    out: dict = {}
    for rec in records.itertuples(index=False):
        items = []
        lap = None if pd.isna(rec.laps) else int(rec.laps) + 1
        kind = ("error" if rec.driver_error else "contact" if rec.contact else "mech" if rec.mechanical
                else "dsq" if rec.category == DISQUALIFIED else None)
        if kind:
            items.append([int(rec.round), kind, str(rec.status_detail), lap])
        if rec.penalty:
            items.append([int(rec.round), "penalty", float(rec.time_penalty_s), None])
        if items:
            out.setdefault((rec.driver_id, int(rec.season)), []).extend(items)
    return out
