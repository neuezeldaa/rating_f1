"""Статистика пилота в каждой гонке и её сводка за сезон или период.

Всё, что видно по протоколам (Jolpica, F1DB) и по кругам (RaceData): очки, победы, подиумы,
поулы, выход в Q3, отставание в квалификации, темп и стабильность на чистых кругах,
первый круг, обгоны, отыгранные позиции, сходы по своей ошибке, штрафы, доля очков команды,
результат относительно уровня машины.

Очки считаем по единой шкале 25-18-15-12-10-8-6-4-2-1 только за гонки: без очков
за спринты и лучший круг — так все сезоны периода сравнимы между собой.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from ..clean.status import (DISQUALIFIED, DRIVER_ERROR, FINISHED, MECHANICAL, NOT_STARTED_F1DB, UNCLEAR, VICTIM,
                            classify_status, did_not_start, is_collision)
from ..config import FUEL_Q3_SEASONS
from ..ingest.fia import FIRST_SEASON as FIA_FIRST_SEASON
from .car_level import by_era, summarize_above_car
from .laps import grid_position

BASE_POINTS = {1: 25, 2: 18, 3: 15, 4: 12, 5: 10, 6: 8, 7: 6, 8: 4, 9: 2, 10: 1}
STANDING_POINTS = BASE_POINTS  # место в чемпионате → очки, как в опросе руководителей команд
MAX_QUALI_GAP_PCT = 5.0        # больше — сорванная попытка, а не скорость
# Стартовало меньше — гонку решил не уровень пилотов, а то, кто вышел на старт (Гран-при США 2005:
# команды на шинах Michelin снялись, стартовали 6 машин). В статистику такие гонки не идут.
MIN_STARTERS = 10
KEY = ["season", "round"]


def quali_records(qualifying: pd.DataFrame) -> pd.DataFrame:
    """Место в квалификации и отставание от лучшего времени того сегмента, где пилот выбыл.

    В 2006–2009 годах Q3 ехали с топливом на гонку — отставание считаем по Q2. До 2006 года
    сегментов не было: «выход в Q3» — это место в топ-10 квалификации.
    """
    q = qualifying[KEY + ["driver_id", "position", "q1_s", "q2_s", "q3_s"]].copy()
    q3_time = q["q3_s"].where(~q["season"].isin(FUEL_Q3_SEASONS))
    segment = np.select([q3_time.notna(), q["q2_s"].notna(), q["q1_s"].notna()], ["q3_s", "q2_s", "q1_s"], "")
    q["seg"] = segment
    q["seg_time"] = [row[s] if s else np.nan for row, s in zip(q.to_dict("records"), segment)]
    best = {seg: q.groupby(KEY)[seg].transform("min") for seg in ("q1_s", "q2_s", "q3_s")}
    seg_best = np.select([q["seg"] == s for s in best], [best[s] for s in best], np.nan)
    q["quali_gap"] = 100 * (q["seg_time"] / seg_best - 1)
    q.loc[q["quali_gap"] > MAX_QUALI_GAP_PCT, "quali_gap"] = np.nan
    q["quali_pos"] = q["position"].astype(float)
    q["pole"] = q["quali_pos"] == 1
    no_segments = q.groupby(KEY)["q3_s"].transform("count") == 0
    q["q3"] = q["q3_s"].notna() | (no_segments & (q["quali_pos"] <= 10))
    return q[KEY + ["driver_id", "quali_pos", "quali_gap", "pole", "q3"]]


def race_records(results: pd.DataFrame, qualifying: pd.DataFrame, lap_stats: pd.DataFrame,
                 status: dict | None = None, verdicts: pd.DataFrame | None = None) -> pd.DataFrame:
    """Одна строка на старт пилота в гонке (без спринтов) со всеми исходными признаками.

    status — уточнённые категории сходов {(сезон, этап, сессия, пилот): категория}: ручные правки
    и виновники столкновений; verdicts — наказания стюардов за столкновения (ingest/fia.py).
    """
    r = results[results["session"] == "R"].copy()
    not_started = r["status_detail"].map(did_not_start) | r["status"].map(did_not_start)
    if "f1db_position_text" in r:
        not_started |= r["f1db_position_text"].isin(NOT_STARTED_F1DB)
    r = r[~not_started]
    r = r[r.groupby(KEY)["driver_id"].transform("size") >= MIN_STARTERS].copy()
    r["category"] = r["status_detail"].map(classify_status)
    if status:
        r["category"] = [status.get((int(s), int(n), "R", d), c)
                         for s, n, d, c in zip(r["season"], r["round"], r["driver_id"], r["category"])]
    classified = r["position_text"].astype(str).str.isdigit()
    r["finish_pos"] = r["position"].astype(float).where(classified)
    r["base_points"] = r["finish_pos"].map(BASE_POINTS).fillna(0.0)
    r["win"] = r["finish_pos"] == 1
    r["podium"] = r["finish_pos"] <= 3
    r["top10"] = r["finish_pos"] <= 10

    # Старт с пит-лейна (grid = 0) — последнее место на решётке; нет данных о решётке — пусто.
    field = r.groupby(KEY)["driver_id"].transform("size")
    r["grid_pos"] = grid_position(r["grid"], field)
    r = r.merge(quali_records(qualifying), on=KEY + ["driver_id"], how="left")
    r = r.merge(lap_stats, on=KEY + ["driver_id"], how="left")
    for col in ("pole", "q3", "driver_of_the_day", "fastest_lap", "grand_slam"):
        r[col] = r[col].astype("boolean").fillna(False).astype(bool)

    finished = r["category"] == FINISHED
    r["gain"] = (r["grid_pos"] - r["finish_pos"]).where(finished)

    # Сколько позиций обычно отыгрывают с этого места на старте — по соседним сезонам: в 2000-х
    # обгонов было вдвое меньше, чем в эпоху DRS.
    def expected(near: pd.DataFrame, this: pd.DataFrame) -> pd.DataFrame:
        gain = near.loc[near["category"] == FINISHED].groupby("grid_pos")["gain"].mean()
        lap1 = near.groupby("grid_pos")["lap1_gain"].mean()
        return this.assign(gain_vs_exp=this["gain"] - this["grid_pos"].map(gain),
                           lap1_vs_exp=this["lap1_gain"] - this["grid_pos"].map(lap1))

    r = by_era(r, expected)
    finished = r["category"] == FINISHED

    team = r.groupby(KEY + ["constructor_id"])["base_points"].transform("sum")
    r["mate_points"] = team - r["base_points"]
    collision = r["status_detail"].map(is_collision)
    r["driver_error"] = r["category"] == DRIVER_ERROR
    r["crash"] = r["driver_error"] & ~collision            # своя авария или разворот, без столкновения
    r["mechanical"] = r["category"] == MECHANICAL
    r["contact"] = (r["category"] == UNCLEAR) & collision  # столкновение, за которое никого не наказали
    r["victim"] = (r["category"] == VICTIM) & collision    # пострадал: наказан соперник
    r["finished"] = finished
    r["penalty"] = r["time_penalty_s"].fillna(0) > 0
    r["dotd"] = r["driver_of_the_day"]
    # Наказания стюардов за столкновения в гонке; без данных FIA признак пустой.
    r["fia_covered"] = (r["season"] >= FIA_FIRST_SEASON) if verdicts is not None else False
    caused = (verdicts[verdicts["session"] == "R"].groupby(["season", "round", "driver_id"]).size()
              if verdicts is not None else pd.Series(dtype=float))
    r["collisions_caused"] = [float(caused.get((s, n, d), 0)) for s, n, d in zip(r["season"], r["round"], r["driver_id"])]
    r["penalty_other"] = r["penalty"] & (r["collisions_caused"] == 0)  # штраф не за столкновение
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
        "crashes": g["crash"].sum(),
        "collisions": g["collisions_caused"].sum(),
        "fia_starts": g["fia_covered"].sum(),
        "contacts": g["contact"].sum(),
        "victims": g["victim"].sum(),
        "mechanical": g["mechanical"].sum(),
        "penalties": g["penalty"].sum(),
        "penalties_other": g["penalty_other"].sum(),
        "dotd": g["dotd"].sum(),
        "fastest_laps": g["fastest_lap"].sum(),
        "grand_slams": g["grand_slam"].sum(),
        "mate_points": g["mate_points"].sum(),
    })
    return out.join(summarize_above_car(records, sprints))


def incident_lists(records: pd.DataFrame) -> dict:
    """Что пошло не так в гонках пилота — для карточки «Аккуратность».

    {(пилот, сезон): [[этап, вид, подробность, круг схода], …]}. Идут в балл: error — своя авария
    или разворот; collision — наказан стюардами за столкновение (подробность — причина схода, если
    сошёл, иначе секунды штрафа); penalty — другой штраф по времени (секунды). Не идут: victim —
    пострадал, наказан соперник; contact — столкновение без наказания; mech — поломка; dsq —
    дисквалификация.
    """
    out: dict = {}
    for rec in records.itertuples(index=False):
        items = []
        lap = None if pd.isna(rec.laps) else int(rec.laps) + 1
        if rec.collisions_caused > 0:
            detail = str(rec.status_detail) if rec.driver_error else (float(rec.time_penalty_s) if rec.penalty else "")
            items.append([int(rec.round), "collision", detail, lap if rec.driver_error else None])
        kind = ("error" if rec.crash else "victim" if rec.victim else "contact" if rec.contact
                else "mech" if rec.mechanical else "dsq" if rec.category == DISQUALIFIED else None)
        if kind:
            items.append([int(rec.round), kind, str(rec.status_detail), lap])
        if rec.penalty_other:
            items.append([int(rec.round), "penalty", float(rec.time_penalty_s), None])
        if items:
            out.setdefault((rec.driver_id, int(rec.season)), []).extend(items)
    return out
