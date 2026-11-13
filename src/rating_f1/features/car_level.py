"""Уровень машины на каждом этапе и результат пилота относительно него.

Уровень машины — темп, который показала бы машина со средним пилотом за рулём: средний темп
её пилотов в гонке (отставание от медианы поля на чистых кругах) с поправкой на половину их навыка
из модели напарников (SKILL_SHARE). Без поправки сильный пилот «ускорял» бы свою машину, и группа
сводилась бы к простому сравнению с напарником, которое ломается при смене команды:
так и было — у сменивших команду балл группы между сезонами не сохранялся вовсе (validate.py).
Уровень сглаживается по соседним этапам (±2, веса 3-2-1): машина не меняется скачками,
а у пилотов бывают неудачные гонки.

На каждом этапе считается отрыв машины от лучшей (в %), и по гонкам соседних сезонов (±2 года) —
сколько очков и какое место в среднем привозит машина с таким отрывом (лучшая машина этапа —
отдельная группа, остальные — 11 групп по отрыву, в каждой поровну машино-этапов). Окно, а не
весь период: в 2000-х лучшая машина реже превращала скорость в очки (дозаправки, надёжность),
и общее ожидание занизило бы его для лучших машин эпохи DRS. «Сверх уровня машины» = факт −
ожидание: сколько пилот привёз сверх того, что привёз бы на этой машине средний пилот. Поэтому
группа связана с «Против напарника», но меряет результат, а не дуэли.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from ..clean.status import DRIVER_ERROR, FINISHED

KEY = ["season", "round"]
SMOOTH_ROUNDS = 2   # окно сглаживания: ±2 этапа
# Выбросы до сглаживания: темп машины на этапе, далёкий от её же медианы по соседним ±4 этапам,
# обрезается до двух устойчивых разбросов. Иначе гонка с повреждённой машиной читается как темп
# машины и расползается на соседние этапы: Венгрия-2021 (Ферстаппен с разбитым днищем, Перес выбит
# на первом круге) делала Red Bull на 1,3% медленнее Mercedes и тянула вниз ещё четыре этапа,
# включая Зандворт, который Ферстаппен выиграл с поула. Перебор окна (3/4/5) и порога (1,5/2/2,5):
# при ±4 и 2 сверка с экспертами 0,90 (без обрезки 0,88), Red Bull 2023 — лучшая на 21 этапе из 22.
SPIKE_ROUNDS = 4
SPIKE_SIGMAS = 2.0
GAP_BINS = 12       # групп по отрыву от лучшей машины для ожиданий
LEAD_BINS = 3       # лучшие машины этапа — ещё на три группы по отрыву от второй машины
# Какая доля навыка пилота вычитается из его темпа при оценке машины. Модель напарников уверенно
# знает разницу между напарниками, но абсолютный уровень пары — хуже: при полной поправке Red Bull
# 2023 года (21 победа из 22) «со средним пилотом» выходил не быстрее Mercedes и был лучшей машиной
# лишь на 8 этапах. Перебор долей (1 / 0,75 / 0,5 / 0,25): при 0,5 Red Bull 2023 — лучшая на 19 этапах,
# «лучшая машина» совпадает с командой победителя на 62% этапов (было 57%), сверка с экспертами 0,90
# (было 0,87); итог после смены команды 0,65 (было 0,67). Без поправки вовсе группа «Сверх уровня
# машины» после смены команды не сохранялась (−0,15).
SKILL_SHARE = 0.5
# Яркая гонка: хотя бы на 8 очков больше, чем привёз бы средний пилот на этой машине.
STANDOUT_POINTS = 8
# Яркий спринт: подиум на машине, которая в спринтах обычно финиширует 7-й и ниже.
STANDOUT_SPRINT_EXPECTED = 6.5
SPRINT_WEIGHT = 0.5
# Ожидания (очки машины такого уровня, отыгранные позиции) — по сезонам в окне ±2 года:
# у эпох разная надёжность, число обгонов и разрыв между машинами.
ERA_WINDOW = 2


def by_era(df: pd.DataFrame, expect) -> pd.DataFrame:
    """Для каждого сезона — expect(соседние сезоны в окне ±ERA_WINDOW, строки этого сезона).

    expect возвращает строки этого сезона с добавленными ожиданиями; результат склеивается
    в исходном порядке строк.
    """
    parts = [expect(df[(df["season"] - season).abs() <= ERA_WINDOW], df[df["season"] == season])
             for season in sorted(df["season"].unique())]
    return pd.concat(parts).loc[df.index]


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


def _despike(table: pd.DataFrame, by: str) -> np.ndarray:
    """Обрезать выбросы level: отклонение от медианы команды по этапам ±SPIKE_ROUNDS — не больше
    SPIKE_SIGMAS устойчивых разбросов (1,4826 · медиана |отклонений| по всем машинам и этапам)."""
    median = np.full(len(table), np.nan)
    for _, g in table.groupby(["season", by]):
        rounds = g["round"].to_numpy(float)
        level = g["level"].to_numpy(float)
        near = np.abs(rounds[:, None] - rounds[None, :]) <= SPIKE_ROUNDS
        median[table.index.get_indexer(g.index)] = [
            np.nanmedian(level[row]) if np.isfinite(level[row]).any() else np.nan for row in near]
    resid = table["level"].to_numpy(float) - median
    finite = resid[np.isfinite(resid)]
    if not len(finite):
        return table["level"].to_numpy(float)
    limit = SPIKE_SIGMAS * 1.4826 * float(np.median(np.abs(finite)))
    return median + np.clip(resid, -limit, limit)


def car_levels(pace: pd.DataFrame, teams: pd.DataFrame, skill: pd.DataFrame) -> pd.DataFrame:
    """Уровень машины: (сезон, этап, команда) → car_gap — отрыв от лучшей машины этапа, %.

    pace — pace_gap пилотов (% к медиане поля, больше — медленнее); teams — кто за кого стартовал;
    skill — driver_id, season, skill: на сколько % пилот быстрее среднего в такой же машине.
    """
    p = teams.merge(pace, on=KEY + ["driver_id"], how="left").merge(skill, on=["driver_id", "season"], how="left")
    p["level"] = p["pace_gap"] + SKILL_SHARE * p["skill"].fillna(0.0)  # быстрый пилот — машина без него медленнее
    car = p.groupby(KEY + ["constructor_id"], as_index=False)["level"].mean().reset_index(drop=True)
    car["level"] = _despike(car, "constructor_id")
    car["level"] = _smooth(car, "constructor_id")
    car = car.dropna(subset=["level"]).reset_index(drop=True)
    car["car_gap"] = car["level"] - car.groupby(KEY)["level"].transform("min")
    # У лучшей машины — насколько она впереди второй: доминирующая машина привозит больше,
    # чем лучшая в плотном сезоне. У остальных — пусто.
    second = car.groupby(KEY)["level"].transform(lambda s: s.nsmallest(2).iloc[-1])
    car["lead"] = (second - car["level"]).where(car["car_gap"] <= 0)
    return car[KEY + ["constructor_id", "car_gap", "lead"]]


def _edges(levels: pd.DataFrame) -> tuple[np.ndarray, np.ndarray]:
    """Границы групп: по отрыву от лучшей машины и (у лучших) по отрыву от второй — поровну в каждой."""
    gap = np.unique(np.quantile(levels.loc[levels["car_gap"] > 0, "car_gap"], np.linspace(0, 1, GAP_BINS)))
    lead = np.quantile(levels["lead"].dropna(), np.linspace(0, 1, LEAD_BINS + 1))
    return gap, lead


def _bin(df: pd.DataFrame, edges: tuple[np.ndarray, np.ndarray]) -> np.ndarray:
    """Группы 1..LEAD_BINS — лучшая машина этапа по отрыву от второй, дальше — остальные по отрыву
    от лучшей. Если смешать лучшую машину с близкими к ней, её ожидание размывается и её пилоты
    получают лишние очки «сверх машины»; если не делить лучшие машины, то же выходит у доминирующей."""
    gap_edges, lead_edges = edges
    gap = df["car_gap"]
    best = np.digitize(df["lead"].fillna(0), lead_edges[1:-1]) + 1
    other = np.digitize(gap.fillna(0), gap_edges[1:-1]) + LEAD_BINS + 1
    return np.where(gap.isna(), np.nan, np.where(gap <= 0, best, other))


def above_car(races: pd.DataFrame, sprints: pd.DataFrame, levels: pd.DataFrame) -> tuple[pd.DataFrame, pd.DataFrame, dict]:
    """Добавить к гонкам и спринтам ожидание по отрыву машины от лучшей и отклонение от него.

    Ожидания — по гонкам соседних сезонов (ERA_WINDOW); expectations для страницы — по последнему окну.
    """
    windows = {}  # сезон → границы групп в его окне

    def edges_for(season: int) -> tuple[np.ndarray, np.ndarray]:
        if season not in windows:
            windows[season] = _edges(levels[(levels["season"] - season).abs() <= ERA_WINDOW])
        return windows[season]

    def with_bin(df: pd.DataFrame) -> pd.DataFrame:
        df = df.merge(levels, on=KEY + ["constructor_id"], how="left")
        df["car_bin"] = np.nan
        for season, rows in df.groupby("season").groups.items():
            df.loc[rows, "car_bin"] = _bin(df.loc[rows], edges_for(int(season)))
        return df

    tables = {}

    def race_expectations(near: pd.DataFrame, this: pd.DataFrame) -> pd.DataFrame:
        season = int(this["season"].iat[0])
        near_bin = pd.Series(_bin(near, edges_for(season)), index=near.index)
        usable = near["category"].isin([FINISHED, DRIVER_ERROR]) & near_bin.notna()
        finished = (near["category"] == FINISHED) & near_bin.notna()
        exp_points = near.loc[usable, "base_points"].groupby(near_bin[usable]).mean()
        exp_pos = near.loc[finished, "finish_pos"].groupby(near_bin[finished]).mean()
        tables[season] = (exp_points, exp_pos)
        return this.assign(exp_points=this["car_bin"].map(exp_points), exp_pos=this["car_bin"].map(exp_pos))

    r = by_era(with_bin(races), race_expectations)
    usable = r["category"].isin([FINISHED, DRIVER_ERROR]) & r["car_bin"].notna()
    finished = (r["category"] == FINISHED) & r["car_bin"].notna()
    r["points_above_car"] = (r["base_points"] - r["exp_points"]).where(usable)
    r["pos_above_car"] = (r["exp_pos"] - r["finish_pos"]).where(finished)
    r["standout"] = (r["points_above_car"] >= STANDOUT_POINTS).astype(float)

    def sprint_expectations(near: pd.DataFrame, this: pd.DataFrame) -> pd.DataFrame:
        season = int(this["season"].iat[0])
        near_bin = pd.Series(_bin(near, edges_for(season)), index=near.index)
        done = (near["category"] == FINISHED) & near_bin.notna()
        exp = near.loc[done, "finish_pos"].groupby(near_bin[done]).mean()
        return this.assign(s_expected=this["car_bin"].map(exp))

    s = with_bin(sprints)
    s = by_era(s, sprint_expectations) if len(s) else s.assign(s_expected=np.nan)
    s_finished = (s["category"] == FINISHED) & s["car_bin"].notna()
    s["pos_above_car"] = (s["s_expected"] - s["finish_pos"]).where(s_finished)
    s["standout"] = SPRINT_WEIGHT * ((s["finish_pos"] <= 3) & (s["s_expected"] > STANDOUT_SPRINT_EXPECTED)).astype(float)

    last = max(tables)
    exp_points, exp_pos = tables[last]
    gap_edges, lead_edges = edges_for(last)
    bins = [int(b) for b in sorted(exp_points.index)]
    expectations = {  # по окну последнего сезона; у лучших машин отрыв от лучшей 0, а lead — от второй
        "seasons": [max(last - ERA_WINDOW, int(r["season"].min())), last],
        "gap_from": [0.0 if b <= LEAD_BINS else round(float(gap_edges[b - LEAD_BINS - 1]), 2) for b in bins],
        "gap_to": [0.0 if b <= LEAD_BINS else round(float(gap_edges[b - LEAD_BINS]), 2) for b in bins],
        "lead_from": [round(float(lead_edges[b - 1]), 2) if b <= LEAD_BINS else None for b in bins],
        "lead_to": [round(float(lead_edges[b]), 2) if b <= LEAD_BINS else None for b in bins],
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
