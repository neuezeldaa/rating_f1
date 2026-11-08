"""Уровень машины на каждом этапе и результат пилота относительно него.

Уровень машины — темп, который показала бы машина со средним пилотом за рулём: средний темп
её пилотов в гонке (отставание от медианы поля на чистых кругах) с поправкой на их навык
из модели напарников. Без поправки сильный пилот «ускорял» бы свою машину, и группа
сводилась бы к простому сравнению с напарником, которое ломается при смене команды:
так и было — у сменивших команду балл группы между сезонами не сохранялся вовсе (validate.py).
Уровень сглаживается по соседним этапам (±2, веса 3-2-1): машина не меняется скачками,
а у пилотов бывают неудачные гонки.

На каждом этапе считается отрыв машины от лучшей (в %), и по всем гонкам 2018–2026 —
сколько очков и какое место в среднем привозит машина с таким отрывом (лучшая машина этапа —
отдельная группа, остальные — 11 групп по отрыву, в каждой поровну машино-этапов). «Сверх уровня машины» = факт − ожидание: сколько пилот
привёз сверх того, что привёз бы на этой машине средний пилот. Поэтому группа связана
с «Против напарника», но меряет результат, а не дуэли.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from ..clean.status import DRIVER_ERROR, FINISHED

KEY = ["season", "round"]
SMOOTH_ROUNDS = 2   # окно сглаживания: ±2 этапа
GAP_BINS = 12       # групп по отрыву от лучшей машины для ожиданий
# Яркая гонка: хотя бы на 8 очков больше, чем привёз бы средний пилот на этой машине.
STANDOUT_POINTS = 8
# Яркий спринт: подиум на машине, которая в спринтах обычно финиширует 7-й и ниже.
STANDOUT_SPRINT_EXPECTED = 6.5
SPRINT_WEIGHT = 0.5


def _smooth(table: pd.DataFrame, by: str) -> np.ndarray:
    """Сгладить level по соседним этапам сезона внутри by: окно ±2, веса 3-2-1, пропуски не в счёт."""
    out = np.full(len(table), np.nan)
    for _, g in table.groupby(["season", by]):
        rounds = g["round"].to_numpy(float)
        level = g["level"].to_numpy(float)
        w = np.clip(SMOOTH_ROUNDS + 1 - np.abs(rounds[:, None] - rounds[None, :]), 0, None)
        ok = ~np.isnan(level)
        num = w @ np.where(ok, level, 0.0)
        den = w @ ok.astype(float)
        with np.errstate(invalid="ignore", divide="ignore"):
            out[table.index.get_indexer(g.index)] = np.where(den > 0, num / den, np.nan)
    return out


def car_levels(pace: pd.DataFrame, teams: pd.DataFrame, skill: pd.DataFrame) -> pd.DataFrame:
    """Уровень машины: (сезон, этап, команда) → car_gap — отрыв от лучшей машины этапа, %.

    pace — pace_gap пилотов (% к медиане поля, больше — медленнее); teams — кто за кого стартовал;
    skill — driver_id, season, skill: на сколько % пилот быстрее среднего в такой же машине.
    """
    p = teams.merge(pace, on=KEY + ["driver_id"], how="left").merge(skill, on=["driver_id", "season"], how="left")
    p["level"] = p["pace_gap"] + p["skill"].fillna(0.0)  # быстрый пилот — машина без него медленнее
    car = p.groupby(KEY + ["constructor_id"], as_index=False)["level"].mean().reset_index(drop=True)
    car["level"] = _smooth(car, "constructor_id")
    car["car_gap"] = car["level"] - car.groupby(KEY)["level"].transform("min")
    return car[KEY + ["constructor_id", "car_gap"]].dropna(subset=["car_gap"]).reset_index(drop=True)


def above_car(races: pd.DataFrame, sprints: pd.DataFrame, levels: pd.DataFrame) -> tuple[pd.DataFrame, pd.DataFrame, dict]:
    """Добавить к гонкам и спринтам ожидание по отрыву машины от лучшей и отклонение от него."""
    # Группа 1 — лучшая машина этапа (отрыв 0), остальные — поровну по отрыву. Если смешать лучшую
    # машину с близкими к ней, её ожидание размывается и её пилоты получают лишние очки «сверх машины».
    edges = np.unique(np.quantile(levels.loc[levels["car_gap"] > 0, "car_gap"], np.linspace(0, 1, GAP_BINS)))

    def with_bin(df: pd.DataFrame) -> pd.DataFrame:
        df = df.merge(levels, on=KEY + ["constructor_id"], how="left")
        gap = df["car_gap"]
        df["car_bin"] = np.where(gap.isna(), np.nan,
                                 np.where(gap <= 0, 1, np.digitize(gap.fillna(0), edges[1:-1]) + 2))
        return df

    r = with_bin(races)
    usable = r["category"].isin([FINISHED, DRIVER_ERROR]) & r["car_bin"].notna()
    finished = (r["category"] == FINISHED) & r["car_bin"].notna()
    exp_points = r[usable].groupby("car_bin")["base_points"].mean()
    exp_pos = r[finished].groupby("car_bin")["finish_pos"].mean()
    r["exp_points"] = r["car_bin"].map(exp_points)
    r["points_above_car"] = (r["base_points"] - r["exp_points"]).where(usable)
    r["pos_above_car"] = (r["car_bin"].map(exp_pos) - r["finish_pos"]).where(finished)
    r["standout"] = (r["points_above_car"] >= STANDOUT_POINTS).astype(float)

    s = with_bin(sprints)
    s_finished = (s["category"] == FINISHED) & s["car_bin"].notna()
    exp_sprint = s[s_finished].groupby("car_bin")["finish_pos"].mean()
    s_expected = s["car_bin"].map(exp_sprint)
    s["pos_above_car"] = (s_expected - s["finish_pos"]).where(s_finished)
    s["standout"] = SPRINT_WEIGHT * ((s["finish_pos"] <= 3) & (s_expected > STANDOUT_SPRINT_EXPECTED)).astype(float)

    bins = [int(b) for b in sorted(exp_points.index)]
    expectations = {  # группа 1 — лучшая машина: отрыв от 0 до 0
        "gap_from": [0.0 if b == 1 else round(float(edges[b - 2]), 2) for b in bins],
        "gap_to": [0.0 if b == 1 else round(float(edges[b - 1]), 2) for b in bins],
        "points": [round(float(exp_points[b]), 2) for b in bins],
        "position": [round(float(exp_pos.get(b, np.nan)), 2) for b in bins],
    }
    return r, s, expectations


def sprint_records(results: pd.DataFrame) -> pd.DataFrame:
    """Спринты: место на финише и категория статуса (для «сверх уровня машины»)."""
    from ..clean.status import classify_status

    s = results[results["session"] == "S"].copy()
    s["category"] = s["status_detail"].map(classify_status)
    classified = s["position_text"].astype(str).str.isdigit()
    s["finish_pos"] = s["position"].astype(float).where(classified)
    return s[KEY + ["driver_id", "constructor_id", "category", "finish_pos"]]


def summarize_above_car(races: pd.DataFrame, sprints: pd.DataFrame) -> pd.DataFrame:
    """Сводка по пилотам: очки и места сверх ожидания, яркие гонки (спринты с весом 0,5)."""
    g = races.groupby("driver_id")
    pos = pd.concat([
        races[["driver_id", "pos_above_car"]].assign(w=1.0),
        sprints[["driver_id", "pos_above_car"]].assign(w=SPRINT_WEIGHT),
    ]).dropna(subset=["pos_above_car"])
    pos_g = pos.assign(wx=pos["pos_above_car"] * pos["w"]).groupby("driver_id")
    out = pd.DataFrame({
        "points_above_car": g["points_above_car"].mean(),
        "pac_n": g["points_above_car"].count(),
        "pos_above_car": pos_g["wx"].sum() / pos_g["w"].sum(),
        "posac_n": pos_g["w"].sum(),
        "standouts": g["standout"].sum().add(sprints.groupby("driver_id")["standout"].sum(), fill_value=0.0),
    })
    return out
