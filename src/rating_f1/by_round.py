"""Рейтинг сезона по ходу сезона: каким он был после каждого этапа.

После k-го этапа рейтинг считается так, будто сезон закончился на этом этапе:
- результаты, сверх уровня машины, квалификация, темп, борьба, аккуратность — по гонкам 1…k;
- место в чемпионате — по очкам этапов 1…k, как в пересчётах для вилок (intervals.Championship);
  после последнего этапа — официальная таблица (так учтены решения вроде исключения Шумахера в 1997-м);
- «Против напарника»: уровень пары — из итоговой модели сезона (сеть напарников за все годы),
  разница внутри пары — по сравнениям этапов 1…k со слабым сжатием к нулю, как в models/season.py.
  Технически: итоговая оценка + (разница внутри пары после k-го этапа − она же по итогам сезона).

Линейка — итоговая линейка сезона (composite.Ruler): те же средние и разбросы пула и те же
SHRINK_RACES воображаемых гонок среднего пилота. Поэтому в начале сезона баллы ближе к 50 (гонок
мало, доверия меньше), а после последнего этапа рейтинг совпадает с итоговым.

Странице, как и для вилок, отдаются z групп после каждого этапа: балл собирается при любых весах.
"""
from __future__ import annotations

import base64
import logging
import time

import numpy as np
import pandas as pd
from scipy import linalg, special

from .composite import _features, _grade, champ_points
from .config import REFERENCE_LAP_S, WEIGHTS_SEASON
from .features.stats import summarize
from .intervals import SCALE, Championship
from .models.teammate import map_logistic

log = logging.getLogger("rating_f1")
MISSING = -32768  # на странице: пилот ещё не стартовал к этому этапу


def _team_split(group: pd.DataFrame, drivers: list, kind: str, tau: float, sigma: float | None) -> np.ndarray:
    """Разница внутри пары по сравнениям group — среднее того же расчёта, что models/season._split."""
    local = {d: j for j, d in enumerate(drivers)}
    mask = (group["driver_a"].isin(local) & group["driver_b"].isin(local)).to_numpy()
    group = group[mask]
    if group.empty:
        return np.zeros(len(drivers))
    x = np.zeros((len(group), len(drivers)))
    rows = np.arange(len(group))
    x[rows, [local[d] for d in group["driver_a"]]] = 1.0
    x[rows, [local[d] for d in group["driver_b"]]] = -1.0
    y = group["y"].to_numpy(dtype=float)
    w = group["w"].to_numpy(dtype=float)
    q = np.eye(len(drivers)) / tau ** 2
    if kind == "gaussian":
        precision = (x.T * w) @ x / sigma ** 2 + q
        return linalg.cho_solve(linalg.cho_factor(precision, lower=True), (x.T * w) @ y / sigma ** 2)
    theta, _, _ = map_logistic(x, y, w, q, np.zeros(len(drivers)))
    return theta


def mate_deltas(inputs: dict, season: int, rounds: list) -> dict:
    """Поправки «Против напарника» после каждого этапа: {модель: DataFrame пилот × этап}.

    Поправка — насколько разница с напарником по этапам 1…k отличается от итоговой (в единицах
    модели: % круга для квалы и темпа, логиты для финиша). После последнего этапа она ноль.
    Пилот двух команд за сезон получает среднее по числу гонок, как в models/season.py.
    """
    keys = inputs["keys"]
    teams = {team: starts for (s, team), starts in inputs["team_starts"].items() if s == season}
    out = {}
    for model in inputs["models"]:
        pairs = model["pairs"][model["pairs"]["season"] == season]
        groups = dict(tuple(pairs.groupby("constructor_id")))
        num, den = {}, {}
        for team, starts in sorted(teams.items()):
            drivers = [d for d in sorted(starts) if (d, season) in keys]
            if not drivers:
                continue
            n = np.array([starts[d] for d in drivers], dtype=float)
            wn = n / n.sum()
            group = groups.get(team)
            splits = []
            for k in rounds:
                if group is None or len(drivers) == 1:
                    split = np.zeros(len(drivers))
                else:
                    split = _team_split(group[group["round"] <= k], drivers, model["kind"], model["tau"],
                                        model.get("sigma"))
                splits.append(split - wn @ split)
            delta = np.array(splits) - splits[-1]
            for j, d in enumerate(drivers):
                num[d] = num.get(d, 0.0) + n[j] * delta[:, j]
                den[d] = den.get(d, 0.0) + n[j]
        out[model["name"]] = pd.DataFrame({d: num[d] / den[d] for d in num}, index=rounds).T
    return out


def _mate_at(car: pd.DataFrame, deltas: dict, k: int) -> pd.DataFrame:
    """Оценки «Против напарника» после k-го этапа: итоговые + поправка."""
    out = car.copy()
    for col, name in (("quali_s", "quali"), ("pace_s", "pace")):
        if name in deltas and k in deltas[name]:
            out[col] = out[col] + deltas[name][k].reindex(out.index).fillna(0.0) * REFERENCE_LAP_S / 100
    if "race" in deltas and k in deltas["race"]:
        p = out["race_p"].clip(1e-6, 1 - 1e-6)
        out["race_p"] = special.expit(special.logit(p) + deltas["race"][k].reindex(out.index).fillna(0.0))
    return out


def compute(records: pd.DataFrame, sprints: pd.DataFrame, results: pd.DataFrame, standings: pd.DataFrame,
            car_by_season: pd.DataFrame, rulers: dict, inputs: dict, seasons: list | None = None) -> dict:
    """{сезон: {"rounds", "ids", "groups", "z": пилот × группа × этап (NaN — ещё не стартовал)}}.

    inputs — сравнения напарников и параметры моделей (pipeline.teammate_model, split_inputs).
    """
    started = time.time()
    seasons = seasons or sorted(int(s) for s in records["season"].unique())
    official = champ_points(standings)
    out = {}
    for season in seasons:
        key = str(season)
        if key not in rulers:
            continue
        ruler = rulers[key]
        rec = records[records["season"] == season]
        spr = sprints[sprints["season"] == season]
        rounds = sorted(int(r) for r in rec["round"].unique())
        if not rounds:
            continue
        table = Championship(results, standings, {season: np.array(rounds)})
        deltas = mate_deltas(inputs, season, rounds)
        car = car_by_season[car_by_season["season"] == season].set_index("driver_id")
        ids = list(ruler.pool.index)
        pool = ruler.pool.to_numpy()
        z, groups = None, None
        for j, k in enumerate(rounds):
            summary = summarize(rec[rec["round"] <= k], spr[spr["round"] <= k]).reindex(ids)
            if k == rounds[-1]:
                champ = official[official["season"] == season].set_index("driver_id")["champ"]
            else:
                picks = {season: (np.array(rounds) <= k).astype(float)}
                champ = champ_points(table.standings(picks)).set_index("driver_id")["champ"]
            raw, counts = _features(summary, champ, _mate_at(car, deltas, k), None)
            _, groups, _, gz, _, _ = _grade(raw, counts, pool, WEIGHTS_SEASON, ruler)
            if z is None:
                z = np.full((len(ids), len(groups), len(rounds)), np.nan)
            has = summary["starts"].fillna(0).to_numpy() > 0
            z[has, :, j] = gz[has]
        out[key] = {"rounds": rounds, "ids": ids, "groups": [g.id for g in groups], "z": z}
    log.info("По ходу сезона: %s сезонов, этапов %s, за %.0f с", len(out),
             sum(len(v["rounds"]) for v in out.values()), time.time() - started)
    return out


def final_gap(rounds_out: dict, scopes: dict) -> float:
    """Проверка: z групп после последнего этапа против итоговых z сезона (должно совпасть)."""
    worst = 0.0
    for key, d in rounds_out.items():
        table = scopes[key].loc[d["ids"]]
        final = table[[f"g_{g}" for g in d["groups"]]].to_numpy(dtype=float)
        last = d["z"][:, :, -1]
        ok = np.isfinite(last) & np.isfinite(final)
        if ok.any():
            worst = max(worst, float(np.max(np.abs(last[ok] - final[ok]))))
    return worst


def encode(rounds_out: dict) -> dict:
    """Для страницы: z × 1000 в int16 (little-endian), base64; порядок пилот × группа × этап;
    MISSING — пилот ещё не стартовал."""
    out = {}
    for key, d in rounds_out.items():
        z = np.round(d["z"] * SCALE)
        packed = np.where(np.isfinite(z), np.clip(z, -32767, 32767), MISSING).astype("<i2")
        out[key] = {"rounds": d["rounds"], "ids": d["ids"], "groups": d["groups"], "scale": SCALE,
                    "missing": MISSING, "z": base64.b64encode(packed.tobytes()).decode("ascii")}
    return out
