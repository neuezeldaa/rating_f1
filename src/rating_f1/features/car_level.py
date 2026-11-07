"""Уровень машины на каждом этапе и результат пилота относительно него.

Скорость машины = средний темп двух её пилотов в гонке (отставание от медианы поля на чистых
кругах). Навык пилотов из модели напарников сюда намеренно не вычитается: иначе разрыв
с напарником засчитывался бы дважды — и в «Против напарника», и здесь. Так сильный пилот
получает здесь примерно половину своего разрыва с напарником.

На каждом этапе машины ранжируются (1 — самая быстрая); если темпа нет (оба сошли рано),
ранг берётся по средней позиции пилотов в квалификации.

По всем гонкам 2018–2026 считается, сколько очков и какое место в среднем привозит машина
каждого ранга. «Сверх уровня машины» = факт − это ожидание. Подиум на машине из середины
пелотона даёт большой плюс, победа на лучшей машине — почти ноль.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from ..clean.status import DRIVER_ERROR, FINISHED

KEY = ["season", "round"]
# Яркая гонка: хотя бы на 8 очков больше, чем обычно у такой машины. Например, подиум на 4-й
# или 5-й по скорости машине, победа на 3-й. Победа на лучшей машине яркой не считается.
STANDOUT_POINTS = 8
STANDOUT_SPRINT_CAR_RANK = 4  # подиум в спринте на машине не из первой тройки — тоже яркий
SPRINT_WEIGHT = 0.5


def car_ranks(pace: pd.DataFrame, quali: pd.DataFrame, teams: pd.DataFrame) -> pd.DataFrame:
    """Ранг машины на каждом этапе: (сезон, этап, команда) → car_rank, car_gap.

    pace — темп пилотов в гонке (pace_gap, % к медиане поля; больше — медленнее).
    """
    p = pace.merge(teams, on=KEY + ["driver_id"])
    car = p.groupby(KEY + ["constructor_id"])["pace_gap"].mean().rename("car_gap").reset_index()
    car["rank_pace"] = car.groupby(KEY)["car_gap"].rank(method="min")

    # Запасной вариант, если темпа нет: средняя позиция пилотов команды в квалификации.
    q = quali.merge(teams, on=KEY + ["driver_id"])
    car_q = q.groupby(KEY + ["constructor_id"])["quali_pos"].mean().reset_index()
    car_q["rank_quali"] = car_q.groupby(KEY)["quali_pos"].rank(method="min")

    out = car_q[KEY + ["constructor_id", "rank_quali"]].merge(car, on=KEY + ["constructor_id"], how="outer")
    out["car_rank"] = out["rank_pace"].fillna(out["rank_quali"])
    return out[KEY + ["constructor_id", "car_rank", "car_gap"]].dropna(subset=["car_rank"])


def above_car(races: pd.DataFrame, sprints: pd.DataFrame, ranks: pd.DataFrame) -> tuple[pd.DataFrame, pd.DataFrame, dict]:
    """Добавить к гонкам и спринтам ожидание по рангу машины и отклонение от него."""
    r = races.merge(ranks, on=KEY + ["constructor_id"], how="left")
    usable = r["category"].isin([FINISHED, DRIVER_ERROR]) & r["car_rank"].notna()
    finished = (r["category"] == FINISHED) & r["car_rank"].notna()
    exp_points = r[usable].groupby("car_rank")["base_points"].mean()
    exp_pos = r[finished].groupby("car_rank")["finish_pos"].mean()
    r["exp_points"] = r["car_rank"].map(exp_points)
    r["points_above_car"] = (r["base_points"] - r["exp_points"]).where(usable)
    r["pos_above_car"] = (r["car_rank"].map(exp_pos) - r["finish_pos"]).where(finished)
    r["standout"] = (r["points_above_car"] >= STANDOUT_POINTS).astype(float)

    s = sprints.merge(ranks, on=KEY + ["constructor_id"], how="left")
    s_finished = (s["category"] == FINISHED) & s["car_rank"].notna()
    exp_sprint = s[s_finished].groupby("car_rank")["finish_pos"].mean()
    s["pos_above_car"] = (s["car_rank"].map(exp_sprint) - s["finish_pos"]).where(s_finished)
    s["standout"] = SPRINT_WEIGHT * ((s["finish_pos"] <= 3) & (s["car_rank"] >= STANDOUT_SPRINT_CAR_RANK)).astype(float)

    expectations = {
        "points": {int(k): round(float(v), 2) for k, v in exp_points.items()},
        "position": {int(k): round(float(v), 2) for k, v in exp_pos.items()},
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
