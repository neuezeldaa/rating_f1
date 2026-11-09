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

# Одна и та же команда под разными названиями (Энстоун: Renault → Lotus → Renault → Alpine и т. д.).
LINEAGE = {"force_india": "aston_martin", "racing_point": "aston_martin", "toro_rosso": "rb", "alphatauri": "rb",
           "alfa": "sauber", "audi": "sauber", "renault": "alpine", "lotus_f1": "alpine",
           "virgin": "manor", "marussia": "manor", "lotus_racing": "caterham",
           # 2000-е: Benetton → Renault, Jordan → MF1 → Spyker → Force India, Minardi → Toro Rosso,
           # BMW Sauber → Sauber, Jaguar → Red Bull, BAR → Honda → Brawn → Mercedes
           "benetton": "alpine", "jordan": "aston_martin", "mf1": "aston_martin", "spyker_mf1": "aston_martin",
           "spyker": "aston_martin", "minardi": "rb", "bmw_sauber": "sauber", "jaguar": "red_bull",
           "bar": "mercedes", "honda": "mercedes", "brawn": "mercedes",
           # 1996–1999: Footwork → Arrows, Ligier → Prost, Tyrrell → BAR, Stewart → Jaguar → Red Bull
           "footwork": "arrows", "ligier": "prost", "tyrrell": "mercedes", "stewart": "red_bull"}
MIN_COMMON = 8  # меньше общих пилотов в половинах сезона — корреляция бессмысленна


def _score_cols(table: pd.DataFrame) -> list:
    return [c for c in table.columns if c.startswith("g_")] + ["overall_z"]


def _corr(a: pd.Series, b: pd.Series) -> float:
    """Корреляция; если у одной из сторон нет разброса (в половине сезона ни одного происшествия), — пусто."""
    if a.std() == 0 or b.std() == 0:
        return np.nan
    return float(np.corrcoef(a, b)[0, 1])


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
        rows += [(c, _corr(a.loc[common, c], b.loc[common, c])) for c in _score_cols(a)]
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


MIN_PAIR_RACES = 5  # новая пара сравнивается, если провела вместе хотя бы столько гонок


def predictive(scopes: dict, records: pd.DataFrame) -> dict:
    """Прогноз новых пар напарников по рейтингу прошлого сезона.

    Для каждой пары, которая впервые ездит вместе, берём баллы обоих в прошлом сезоне и смотрим,
    угадывает ли разница, кто окажется выше в новом сезоне: в квалификации (кто чаще впереди)
    и на финише (кто чаще выше, когда финишировали оба). Машина у напарников одна, поэтому это
    проверка того, мерит ли рейтинг пилота. Отдельно — для итога и для каждой группы.
    """
    r = records[["season", "round", "constructor_id", "driver_id", "quali_pos", "finish_pos", "category"]]
    p = r.merge(r, on=["season", "round", "constructor_id"], suffixes=("_a", "_b"))
    p = p[p["driver_id_a"] < p["driver_id_b"]]
    p["quali"] = np.where(p["quali_pos_a"].notna() & p["quali_pos_b"].notna(),
                          (p["quali_pos_a"] < p["quali_pos_b"]).astype(float), np.nan)
    both = (p["category_a"] == "finished") & (p["category_b"] == "finished")
    p["race"] = np.where(both, (p["finish_pos_a"] < p["finish_pos_b"]).astype(float), np.nan)
    season = (p.groupby(["season", "driver_id_a", "driver_id_b"])
              .agg(races=("round", "size"), quali=("quali", "mean"), race=("race", "mean")).reset_index())
    first = season.groupby(["driver_id_a", "driver_id_b"])["season"].transform("min")
    new = season[(season["season"] == first) & (season["races"] >= MIN_PAIR_RACES)]

    hits = {"quali": {}, "race": {}}
    used = 0
    for row in new.itertuples(index=False):
        prev = scopes.get(str(int(row.season) - 1))
        if prev is None or row.driver_id_a not in prev.index or row.driver_id_b not in prev.index:
            continue
        a, b = prev.loc[row.driver_id_a], prev.loc[row.driver_id_b]
        if not (a["eligible"] and b["eligible"]):
            continue
        used += 1
        for col in [c for c in prev.columns if c.startswith("g_")] + ["overall_z"]:
            diff = a[col] - b[col]
            for kind in ("quali", "race"):
                share = getattr(row, kind)
                if np.isnan(share) or share == 0.5 or diff == 0:
                    continue
                hits[kind].setdefault(col, []).append((diff > 0) == (share > 0.5))
    acc = {kind: {("overall" if c == "overall_z" else c[2:]): float(np.mean(v)) for c, v in cols.items()}
           for kind, cols in hits.items()}
    return {"pairs": used, "quali": acc["quali"], "race": acc["race"]}


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
           "data_weights": data_weights(follow["moved"], groups), "predictive": predictive(scopes, records)}
    if expert:
        out["expert_spearman"] = float(np.mean([r["spearman"] for r in expert.values()]))
    return out
