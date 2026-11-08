"""Проверки общего рейтинга: меряют ли группы пилота, а не машину и не случай.

1. Повторяемость внутри сезона. Рейтинг считается отдельно по нечётным и по чётным этапам
   (чемпионат — по очкам своей половины), и баллы групп сравниваются между половинами.
   Корреляция половин r переводится в оценку для целого сезона 2r / (1 + r) (формула
   Спирмена — Брауна). Низкая повторяемость — группа в основном случайна.
2. Следует ли за пилотом. Баллы групп в соседних сезонах сравниваются отдельно у тех, кто
   сменил команду, и у тех, кто остался. Группа, которая меряет пилота, держится и после
   перехода; группа, которая меряет машину, — только у оставшихся. Смена названия команды
   (Toro Rosso → AlphaTauri → RB и т. п.) переходом не считается.
3. Сверка с опросами руководителей команд — composite.expert_agreement.

В первой проверке группа «Против напарника» завышена: модель напарников обучена на всех гонках
сезона, пополам делится только доля очков команды.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from .composite import PERIOD, build_scopes
from .intervals import Championship

# Одна и та же команда под разными названиями.
LINEAGE = {"force_india": "aston_martin", "racing_point": "aston_martin", "toro_rosso": "rb", "alphatauri": "rb",
           "alfa": "sauber", "audi": "sauber", "renault": "alpine"}
MIN_COMMON = 8  # меньше общих пилотов в половинах сезона — корреляция бессмысленна


def _score_cols(table: pd.DataFrame) -> list:
    return [c for c in table.columns if c.startswith("g_")] + ["overall_z"]


def split_half(records: pd.DataFrame, sprints: pd.DataFrame, results: pd.DataFrame, standings: pd.DataFrame,
               car_by_season: pd.DataFrame) -> pd.Series:
    """Повторяемость групп и итога за целый сезон: медиана по сезонам, 0 — шум, 1 — всё повторяется."""
    rounds = {int(s): np.sort(g.unique()) for s, g in records.groupby("season")["round"]}
    champ = Championship(results, standings, rounds)
    halves = []
    for parity in (1, 0):
        picks = {s: (r % 2 == parity).astype(float) for s, r in rounds.items()}
        scopes, _ = build_scopes(records[records["round"] % 2 == parity], sprints[sprints["round"] % 2 == parity],
                                 champ.standings(picks), car_by_season)
        halves.append(scopes)
    rows = []
    for key, a in halves[0].items():
        b = halves[1].get(key)
        if key == PERIOD or b is None:
            continue
        common = a.index[a["eligible"]].intersection(b.index[b["eligible"]])
        if len(common) < MIN_COMMON:
            continue
        rows += [(c, np.corrcoef(a.loc[common, c], b.loc[common, c])[0, 1]) for c in _score_cols(a)]
    r = pd.DataFrame(rows, columns=["col", "r"]).groupby("col")["r"].median()
    return 2 * r / (1 + r)


def persistence(scopes: dict, records: pd.DataFrame) -> pd.DataFrame:
    """Корреляция баллов в соседних сезонах: moved — сменили команду, stayed — остались.

    В attrs — число пар сезонов в каждой части.
    """
    team = records.groupby(["driver_id", "season"])["constructor_id"].agg(lambda s: s.mode().iat[0])
    seasons = [k for k in scopes if k != PERIOD]
    cols = _score_cols(scopes[seasons[0]])
    frames = [scopes[k].loc[scopes[k]["eligible"], cols].assign(season=int(k)).rename_axis("driver_id").reset_index()
              for k in seasons]
    s = pd.concat(frames, ignore_index=True)
    s["team"] = [LINEAGE.get(team.get((d, y)), team.get((d, y))) for d, y in zip(s["driver_id"], s["season"])]
    pairs = s.merge(s.assign(season=s["season"] - 1), on=["driver_id", "season"], suffixes=("", "_next"))
    moved = pairs["team"] != pairs["team_next"]
    out = pd.DataFrame({
        "moved": {c: pairs.loc[moved, c].corr(pairs.loc[moved, f"{c}_next"]) for c in cols},
        "stayed": {c: pairs.loc[~moved, c].corr(pairs.loc[~moved, f"{c}_next"]) for c in cols},
    })
    out.attrs.update(n_moved=int(moved.sum()), n_stayed=int((~moved).sum()))
    return out


def data_weights(moved: pd.Series, groups: list) -> dict:
    """Веса «по данным»: доля группы пропорциональна тому, насколько её балл следует за пилотом
    при смене команды (отрицательная связь — ноль). «Карьеру» так проверить нельзя — ей ноль."""
    raw = {g: max(float(moved.get(f"g_{g}", 0.0)), 0.0) for g in groups if g != "career"}
    total = sum(raw.values()) or 1.0
    weights = {g: round(v / total, 3) for g, v in raw.items()}
    weights["career"] = 0.0
    return weights


def report(records: pd.DataFrame, sprints: pd.DataFrame, results: pd.DataFrame, standings: pd.DataFrame,
           car_by_season: pd.DataFrame, scopes: dict, groups: list, expert: dict | None = None) -> dict:
    """Все проверки разом — для лога и для раздела методики на странице."""
    reliability = split_half(records, sprints, results, standings, car_by_season)
    follow = persistence(scopes, records)
    rows = {}
    for col in follow.index:
        key = "overall" if col == "overall_z" else col[2:]
        rows[key] = {"reliability": float(reliability.get(col, np.nan)),
                     "moved": float(follow.loc[col, "moved"]), "stayed": float(follow.loc[col, "stayed"])}
    out = {"groups": rows, "n_moved": follow.attrs["n_moved"], "n_stayed": follow.attrs["n_stayed"],
           "data_weights": data_weights(follow["moved"], groups)}
    if expert:
        out["expert_spearman"] = float(np.mean([r["spearman"] for r in expert.values()]))
    return out
