"""Сезонный рейтинг: от оценок моделей к местам, интервалам и шансу быть №1.

Навык центрируется внутри сезона: 0 — средний пилот сезона (с весом по числу гонок).
Квалификация переводится в шанс опередить в квалификации среднего пилота в такой же
машине, гонка — в шанс финишировать выше него. Общая сила — среднее этих двух шансов
(временно поровну; веса подберём на этапе с байесовской моделью).
"""
from __future__ import annotations

import numpy as np
import pandas as pd
from scipy import special

from .config import INTERVAL, MIN_RACES_FOR_RANK, REFERENCE_LAP_S

Q_LO, Q_HI = (1 - INTERVAL) / 2, 1 - (1 - INTERVAL) / 2


def _band(draws: np.ndarray):
    lo, hi = np.quantile(draws, [Q_LO, Q_HI], axis=1)
    return draws.mean(axis=1), lo, hi


def season_ratings(keys: list, q_draws: np.ndarray, r_draws: np.ndarray, sigma: float,
                   starts: dict, p_draws: np.ndarray, sigma_p: float) -> pd.DataFrame:
    """Места и интервалы по выборкам (квала и темп в %, финиш в логитах) в порядке keys.

    sigma, sigma_p — шум одной сессии: переводят гэп в шанс опередить среднего пилота.
    Общая сила против напарника — среднее трёх шансов: квала, темп, финиш.
    """
    seasons = np.array([season for _, season in keys])

    records = []
    for season in sorted(set(seasons.tolist())):
        idx = np.flatnonzero(seasons == season)
        w = np.array([starts.get(keys[i], 0) for i in idx], dtype=float)
        wn = w / w.sum() if w.sum() > 0 else np.full(len(idx), 1.0 / len(idx))
        q = q_draws[idx] - wn @ q_draws[idx]
        r = r_draws[idx] - wn @ r_draws[idx]
        pc = p_draws[idx] - wn @ p_draws[idx]
        p_quali = special.ndtr(q / sigma)
        p_race = special.expit(r)
        p_pace = special.ndtr(pc / sigma_p)
        overall = (p_quali + p_race + p_pace) / 3

        eligible = w >= MIN_RACES_FOR_RANK
        ranks = np.full(overall.shape, np.nan)
        point_rank = np.full(len(idx), np.nan)
        if eligible.any():
            e = np.flatnonzero(eligible)
            ranks[e] = (-overall[e]).argsort(axis=0).argsort(axis=0) + 1
            point_rank[e] = (-overall[e].mean(axis=1)).argsort().argsort() + 1

        bands = {
            "overall": _band(overall),
            "quali_pct": _band(q),
            "quali_s": _band(q * REFERENCE_LAP_S / 100),
            "quali_p": _band(p_quali),
            "race_logit": _band(r),
            "race_p": _band(p_race),
            "pace_s": _band(pc * REFERENCE_LAP_S / 100),
            "pace_p": _band(p_pace),
        }
        for k, i in enumerate(idx):
            rec = {
                "driver_id": keys[i][0],
                "season": int(season),
                "starts": int(w[k]),
                "eligible": bool(eligible[k]),
            }
            for name, (mean, lo, hi) in bands.items():
                rec[name], rec[f"{name}_lo"], rec[f"{name}_hi"] = float(mean[k]), float(lo[k]), float(hi[k])
            if eligible[k]:
                rank_lo, rank_hi = np.quantile(ranks[k], [Q_LO, Q_HI], method="nearest")
                rec.update(rank=int(point_rank[k]), rank_lo=int(rank_lo), rank_hi=int(rank_hi),
                           p_top1=float(np.mean(ranks[k] == 1)))
            else:
                rec.update(rank=None, rank_lo=None, rank_hi=None, p_top1=None)
            records.append(rec)
    return pd.DataFrame(records)


def raw_stats(quali_pairs: pd.DataFrame, race_duels: pd.DataFrame) -> pd.DataFrame:
    """Сырые счета дуэлей и медианный гэп — для прозрачности рядом с оценками модели."""
    v = quali_pairs[quali_pairs["valid"]]
    q = pd.concat([
        pd.DataFrame({"driver_id": v["driver_a"], "season": v["season"], "gap": v["gap_pct"]}),
        pd.DataFrame({"driver_id": v["driver_b"], "season": v["season"], "gap": -v["gap_pct"]}),
    ])
    q["win"] = q["gap"] < 0
    q_stats = q.groupby(["driver_id", "season"]).agg(
        quali_wins=("win", "sum"), quali_n=("win", "size"), quali_gap_median=("gap", "median"))

    v = race_duels[race_duels["valid"] & (race_duels["session"] == "R")]
    r = pd.concat([
        pd.DataFrame({"driver_id": v["driver_a"], "season": v["season"], "win": v["outcome"] == 1}),
        pd.DataFrame({"driver_id": v["driver_b"], "season": v["season"], "win": v["outcome"] == 0}),
    ])
    r_stats = r.groupby(["driver_id", "season"]).agg(race_wins=("win", "sum"), race_n=("win", "size"))
    return q_stats.join(r_stats, how="outer").reset_index()


def season_context(results: pd.DataFrame, constructors: pd.DataFrame) -> pd.DataFrame:
    """Команды, напарники и число стартов пилота в каждом сезоне (по гонкам, без спринтов)."""
    races = results[results["session"] == "R"].merge(
        constructors[["constructor_id", "constructor_name"]], on="constructor_id", how="left")
    races = races.sort_values(["season", "round"])
    teammates: dict = {}
    for (season, _, _), group in races.groupby(["season", "round", "constructor_id"]):
        ids = group["driver_id"].tolist()
        for driver in ids:
            teammates.setdefault((driver, int(season)), set()).update(x for x in ids if x != driver)
    rows = []
    for (driver, season), group in races.groupby(["driver_id", "season"]):
        rows.append({
            "driver_id": driver,
            "season": int(season),
            "starts": int(len(group)),
            "teams": list(dict.fromkeys(group["constructor_name"])),
            "teammates": sorted(teammates.get((driver, int(season)), set())),
        })
    return pd.DataFrame(rows)
