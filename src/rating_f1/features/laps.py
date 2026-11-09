"""Признаки по кругам: темп на чистых кругах, стабильность, первый круг, обгоны на трассе.

Источник — позиция и время каждого пилота на каждом круге (RaceData, формат Ergast).
Шин в этих данных нет, поэтому работа с резиной — отдельный будущий шаг.

Чистый круг: не первый; не под сейфти-каром, VSC или красным флагом (медиана поля на этом
круге медленнее обычной не больше чем на 7%); не круг заезда в боксы и не круг выезда;
не медленнее эталона круга больше чем на 15% (это уже инцидент, а не темп).

Темп пилота сравнивается с медианой поля на тех же кругах: топливо, эволюция трассы
и фазы гонки одинаковы для всех и сокращаются.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

KEY = ["season", "round"]
NEUTRAL_FACTOR = 1.07   # круг медленнее обычного больше чем на 7% — нейтрализация
OUTLIER_FACTOR = 1.15   # личный круг медленнее эталона больше чем на 15% — инцидент
MIN_CLEAN_FIELD = 5     # эталон круга считаем, если чистых кругов у поля хотя бы столько
MIN_PACE_LAPS = 10      # темп пилота — от 10 чистых кругов
MIN_PAIR_LAPS = 10      # сравнение темпа с напарником — от 10 общих чистых кругов
MAX_PAIR_GAP = 3.0      # гэп к напарнику по темпу больше 3% — повреждение или поломка


def mark_laps(laps: pd.DataFrame, pits: pd.DataFrame) -> pd.DataFrame:
    """Круги с пометками: нейтрализация, заезд/выезд из боксов, чистый круг, эталон круга."""
    marked = laps.copy()
    med = marked.groupby(KEY + ["lap"])["lap_ms"].median().rename("field_med").reset_index()
    ref = med[med["lap"] >= 2].groupby(KEY)["field_med"].median().rename("race_ref").reset_index()
    med = med.merge(ref, on=KEY)
    med["neutral"] = med["field_med"] > NEUTRAL_FACTOR * med["race_ref"]
    marked = marked.merge(med[KEY + ["lap", "neutral"]], on=KEY + ["lap"], how="left")

    stops = pits[KEY + ["driver_id", "lap"]].drop_duplicates()
    marked = marked.merge(stops.assign(pit_in=True), on=KEY + ["driver_id", "lap"], how="left")
    marked = marked.merge(stops.assign(lap=stops["lap"] + 1, pit_out=True), on=KEY + ["driver_id", "lap"], how="left")
    for col in ("neutral", "pit_in", "pit_out"):
        marked[col] = marked[col].astype("boolean").fillna(False).astype(bool)

    marked["clean"] = (marked["lap"] >= 2) & ~marked["neutral"] & ~marked["pit_in"] & ~marked["pit_out"]
    lap_ref = (marked[marked["clean"]].groupby(KEY + ["lap"])["lap_ms"]
               .agg(lap_ref="median", n_ref="size").reset_index())
    marked = marked.merge(lap_ref, on=KEY + ["lap"], how="left")
    marked["rel"] = marked["lap_ms"] / marked["lap_ref"]
    marked["clean"] &= (marked["n_ref"] >= MIN_CLEAN_FIELD) & (marked["rel"] <= OUTLIER_FACTOR)
    return marked


def race_pace(marked: pd.DataFrame) -> pd.DataFrame:
    """Темп (медианное отставание от поля, %; меньше — быстрее) и стабильность (разброс кругов, %)."""
    clean = marked[marked["clean"]].sort_values(KEY + ["driver_id", "lap"])
    groups = clean.groupby(KEY + ["driver_id"])
    # Стабильность: отклонение круга от скользящей медианы соседних кругов (без общего тренда темпа).
    rolling = groups["rel"].transform(lambda s: s.rolling(5, center=True, min_periods=3).median())
    clean = clean.assign(resid=(clean["rel"] - rolling).abs())
    groups = clean.groupby(KEY + ["driver_id"])
    out = pd.DataFrame({
        "pace_gap": 100 * (groups["rel"].median() - 1),
        "consistency": 100 * 1.4826 * groups["resid"].median(),
        "clean_laps": groups.size(),
    }).reset_index()
    return out[out["clean_laps"] >= MIN_PACE_LAPS]


def grid_position(grid: pd.Series, field: pd.Series) -> pd.Series:
    """Место на старте: 0 — старт с пит-лейна, то есть последнее место; нет данных — пусто."""
    g = grid.astype(float)
    return g.where(g > 0, field).where(g.notna())


def lap_one(laps: pd.DataFrame, results: pd.DataFrame) -> pd.DataFrame:
    """Отыгрыш на первом круге: место на старте минус место после первого круга."""
    race = results[results["session"] == "R"][KEY + ["driver_id", "grid"]].copy()
    field = race.groupby(KEY)["driver_id"].transform("size")
    race["grid_pos"] = grid_position(race["grid"], field)
    first = laps[laps["lap"] == 1][KEY + ["driver_id", "position"]]
    out = race.merge(first, on=KEY + ["driver_id"], how="inner")
    out["lap1_gain"] = out["grid_pos"] - out["position"]
    return out[KEY + ["driver_id", "grid_pos", "lap1_gain"]]


def overtakes(marked: pd.DataFrame) -> pd.DataFrame:
    """Обгоны на трассе между соседними кругами.

    Пилот A обогнал B на круге L, если в конце круга L−1 он был позади, а в конце круга L
    впереди; круг L не нейтрализован; ни A, ни B не заезжали в боксы и не выезжали из них
    на круге L; оба проехали круг L (сход соперника обгоном не считается).
    """
    rows = []
    for (season, rnd), race in marked.groupby(KEY, sort=False):
        pos = race.pivot(index="driver_id", columns="lap", values="position")
        pit = (race.assign(pit=(race["pit_in"] | race["pit_out"]).astype(int))
               .pivot(index="driver_id", columns="lap", values="pit").fillna(0).astype(bool))
        neutral = race.groupby("lap")["neutral"].first()
        made = np.zeros(len(pos))
        lost = np.zeros(len(pos))
        laps = list(pos.columns)
        for prev_lap, lap in zip(laps, laps[1:]):
            if neutral.get(lap, False):
                continue
            prev = pos[prev_lap].to_numpy(dtype=float)
            cur = pos[lap].to_numpy(dtype=float)
            ok = np.isfinite(prev) & np.isfinite(cur) & ~pit[lap].to_numpy()
            passed = (prev[:, None] > prev[None, :]) & (cur[:, None] < cur[None, :]) & ok[:, None] & ok[None, :]
            made += passed.sum(axis=1)
            lost += passed.sum(axis=0)
        rows.append(pd.DataFrame({"season": season, "round": rnd, "driver_id": pos.index,
                                  "overtakes_made": made, "overtakes_lost": lost}))
    return pd.concat(rows, ignore_index=True)


def teammate_pace_pairs(marked: pd.DataFrame, results: pd.DataFrame) -> pd.DataFrame:
    """Темп с напарником на общих чистых кругах: медиана 100·ln(t_A / t_B); больше нуля — A медленнее."""
    teams = results[results["session"] == "R"][KEY + ["driver_id", "constructor_id"]]
    clean = marked[marked["clean"]][KEY + ["driver_id", "lap", "lap_ms"]].merge(teams, on=KEY + ["driver_id"])
    pairs = clean.merge(clean, on=KEY + ["constructor_id", "lap"], suffixes=("_a", "_b"))
    pairs = pairs[pairs["driver_id_a"] < pairs["driver_id_b"]]
    pairs = pairs.assign(log_ratio=100 * np.log(pairs["lap_ms_a"] / pairs["lap_ms_b"]))
    out = (pairs.groupby(KEY + ["constructor_id", "driver_id_a", "driver_id_b"])["log_ratio"]
           .agg(gap_pct="median", n_laps="size").reset_index()
           .rename(columns={"driver_id_a": "driver_a", "driver_id_b": "driver_b"}))
    out["valid"] = (out["n_laps"] >= MIN_PAIR_LAPS) & (out["gap_pct"].abs() <= MAX_PAIR_GAP)
    return out


def lap_features(laps: pd.DataFrame, pits: pd.DataFrame, results: pd.DataFrame):
    """Все признаки по кругам на гонку и пилота + пары напарников для модели темпа."""
    marked = mark_laps(laps, pits)
    per_race = (race_pace(marked)
                .merge(lap_one(laps, results)[KEY + ["driver_id", "lap1_gain"]], on=KEY + ["driver_id"], how="outer")
                .merge(overtakes(marked), on=KEY + ["driver_id"], how="outer"))
    neutral_share = marked.groupby(KEY)["neutral"].mean().rename("neutral_share").reset_index()
    return per_race, teammate_pace_pairs(marked, results), neutral_share
