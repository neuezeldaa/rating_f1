"""Интервалы общего рейтинга: сотни пересчётов на перевыбранных этапах.

Один пересчёт:
1. В каждом сезоне этапы выбираются случайно с повторениями, столько же, сколько их было:
   какой-то уикенд попадёт дважды, какой-то ни разу. Этап берётся целиком — гонка и спринт
   всех пилотов, поэтому в каждой гонке по-прежнему один победитель.
2. Чемпионат пересчитывается по официальным очкам выбранных этапов: место в чемпионате
   и титулы тоже могут смениться.
3. Группа «Против напарника» берёт один из вариантов модели напарников: модель на каждом
   пересчёте не перестраивается, её неопределённость уже в вариантах.
4. Рейтинг считается заново линейкой основного расчёта (см. composite.Ruler).

Вилка балла и места — 10-й и 90-й перцентили пересчётов (80%, как у моделей напарников).
Страница хранит z групп каждого пересчёта и сама собирает из них балл при любых весах.
"""
from __future__ import annotations

import base64
import logging
import time

import numpy as np
import pandas as pd

from .composite import draw_scopes
from .ratings import Q_HI, Q_LO

KEY = ["season", "round"]
COUNTBACK = 20  # при равенстве очков сравниваем число 1-х, 2-х, … 20-х мест
SCALE = 1000    # z групп на странице: целые z × 1000 в int16, base64
# Только то, что нужно сводке (summarize): так пересчёт копирует меньше столбцов.
RACE_COLS = KEY + ["driver_id", "base_points", "win", "podium", "top10", "pole", "q3", "quali_pos", "quali_gap",
                   "pace_gap", "consistency", "lap1_vs_exp", "overtakes_made", "overtakes_lost", "gain_vs_exp",
                   "finish_pos", "finished", "driver_error", "crash", "contact", "victim", "mechanical", "penalty",
                   "penalty_other", "collisions_caused", "fia_covered", "dotd", "fastest_lap",
                   "grand_slam", "mate_points", "points_above_car", "pos_above_car", "standout"]
SPRINT_COLS = KEY + ["driver_id", "pos_above_car", "standout"]
log = logging.getLogger("rating_f1")


class Championship:
    """Чемпионат по выбранным этапам.

    Очки — официальные за уикенд (гонка + спринт). При равенстве очков выше тот, у кого
    больше побед в гонках, потом вторых мест и так далее, как в F1.
    """

    def __init__(self, results: pd.DataFrame, standings: pd.DataFrame, rounds: dict):
        points = results.groupby(KEY + ["driver_id"], as_index=False)["points"].sum()
        race = results[results["session"] == "R"]
        race = race.assign(place=pd.to_numeric(race["position_text"], errors="coerce"))
        self.tables = {}
        for season, rnds in rounds.items():
            matrix = points[points["season"] == season].pivot_table(
                index="driver_id", columns="round", values="points", aggfunc="sum", fill_value=0.0)
            matrix = matrix.reindex(columns=rnds, fill_value=0.0)
            places = race[race["season"] == season].pivot_table(
                index="driver_id", columns="round", values="place", aggfunc="min")
            places = places.reindex(index=matrix.index, columns=rnds).to_numpy()
            finishes = np.stack([places == k for k in range(1, COUNTBACK + 1)], axis=-1).astype(float)
            self.tables[season] = (matrix.index.to_numpy(), matrix.to_numpy(dtype=float), finishes)
        # Титул разыгран, только если F1DB уже назвала чемпиона сезона.
        self.decided = {int(s) for s in standings.loc[standings["champion"], "season"]}

    def standings(self, picks: dict) -> pd.DataFrame:
        """picks — сколько раз выбран каждый этап сезона (в порядке этапов)."""
        frames = []
        for season, (drivers, matrix, finishes) in self.tables.items():
            total = matrix @ picks[season]
            counts = np.einsum("drk,r->dk", finishes, picks[season])
            order = np.lexsort([-counts[:, k] for k in reversed(range(COUNTBACK))] + [-total])
            position = np.empty(len(drivers))
            position[order] = np.arange(1, len(drivers) + 1)
            frames.append(pd.DataFrame({
                "season": season, "driver_id": drivers, "position": position,
                "champion": (position == 1) & (season in self.decided),
            }))
        return pd.concat(frames, ignore_index=True)


def bootstrap(records: pd.DataFrame, sprints: pd.DataFrame, results: pd.DataFrame, standings: pd.DataFrame,
              car: dict, rulers: dict, n: int, rng: np.random.Generator) -> dict:
    """n пересчётов. → {охват: {"ids": пилоты, "groups": группы, "z": массив пилоты × группы × n}}.

    car — варианты модели напарников (ratings.teammate_draws), по столбцу на пересчёт.
    """
    started = time.time()
    records = records[RACE_COLS].reset_index(drop=True)
    sprints = sprints[SPRINT_COLS].reset_index(drop=True)
    rounds = {int(s): np.sort(g.unique()) for s, g in records.groupby("season")["round"]}
    race_rows = records.groupby(KEY).indices
    sprint_rows = sprints.groupby(KEY).indices
    champ = Championship(results, standings, rounds)
    empty = np.array([], dtype=int)

    out, columns = {}, {}
    for b in range(n):
        drawn = {s: rng.integers(0, len(r), size=len(r)) for s, r in rounds.items()}
        picks = {s: np.bincount(d, minlength=len(rounds[s])).astype(float) for s, d in drawn.items()}
        race_idx = np.concatenate([race_rows[(s, rounds[s][i])] for s, d in drawn.items() for i in d])
        sprint_idx = np.concatenate([sprint_rows.get((s, rounds[s][i]), empty) for s, d in drawn.items() for i in d])
        car_b = pd.DataFrame({"driver_id": car["driver_id"], "season": car["season"],
                              "quali_s": car["quali_s"][:, b], "race_p": car["race_p"][:, b],
                              "pace_s": car["pace_s"][:, b]})
        tables = draw_scopes(records.iloc[race_idx], sprints.iloc[sprint_idx], champ.standings(picks), car_b,
                             rulers, rng)
        for key, table in tables.items():
            if key not in out:
                columns[key] = [c for c in table.columns if c.startswith("g_")]
                out[key] = np.empty((len(table), len(columns[key]), n))
            out[key][:, :, b] = table[columns[key]].to_numpy()
    log.info("Интервалы: %s пересчётов рейтинга за %.0f с", n, time.time() - started)
    return {key: {"ids": list(rulers[key].pool.index), "groups": [c[2:] for c in columns[key]], "z": z}
            for key, z in out.items()}


def bands(table: pd.DataFrame, draws: dict, weights: dict) -> pd.DataFrame:
    """Вилки при заданных весах: балл, место, шанс быть первым и выше соседа снизу.

    Тот же расчёт делает страница при любых весах ползунков.
    """
    t = table.loc[draws["ids"]]
    w = np.array([weights.get(g, 0.0) for g in draws["groups"]])
    w = w / w.sum()
    pool = t["eligible"].to_numpy(dtype=bool)
    point = t[[f"g_{g}" for g in draws["groups"]]].to_numpy() @ w
    center, sd = point[pool].mean(), point[pool].std()
    z = (np.einsum("dgb,g->db", draws["z"], w) - center) / sd
    rating = np.clip(50 + 15 * z, 0, 100)
    out = pd.DataFrame(index=t.index)
    out["rating_lo"], out["rating_hi"] = np.quantile(rating, [Q_LO, Q_HI], axis=1)

    places = np.full(z.shape, np.nan)
    places[pool] = (-z[pool]).argsort(axis=0).argsort(axis=0) + 1
    out["rank_lo"] = out["rank_hi"] = np.nan
    out.loc[pool, ["rank_lo", "rank_hi"]] = np.quantile(places[pool], [Q_LO, Q_HI], axis=1, method="nearest").T
    out["p_top1"] = np.where(pool, (places == 1).mean(axis=1), np.nan)

    order = t.index[pool][np.argsort(-t["rating"].to_numpy()[pool], kind="stable")]
    row = {d: i for i, d in enumerate(t.index)}
    out["p_above_next"] = np.nan
    for upper, lower in zip(order[:-1], order[1:]):
        out.loc[upper, "p_above_next"] = float((z[row[upper]] > z[row[lower]]).mean())
    return out


def encode(draws: dict) -> dict:
    """Для страницы: z групп — целые z × 1000 (int16, little-endian), base64; порядок пилот × группа × пересчёт."""
    out = {}
    for key, d in draws.items():
        packed = np.clip(np.round(d["z"] * SCALE), -32767, 32767).astype("<i2")
        out[key] = {"ids": d["ids"], "groups": d["groups"], "n": int(d["z"].shape[2]), "scale": SCALE,
                    "z": base64.b64encode(packed.tobytes()).decode("ascii")}
    return out
