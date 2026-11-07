"""Общий рейтинг: признаки → группы → итог по шкале 0–100.

Для каждого охвата (весь период 2018–2026 или один сезон):
1. Сводка статистики пилота за охват + оценки модели «сверх машины» (сравнение с напарником).
2. Доли и средние сжимаются к среднему по пулу: чем меньше гонок, тем меньше доверия.
3. Каждый признак переводится в z-оценку среди пилотов пула (у кого хватает гонок);
   знак выбран так, что больше — лучше.
4. Оценка группы — среднее z её признаков; итог — взвешенная сумма групп.
5. Шкала 0–100: 50 — средний пилот пула, +15 за каждое стандартное отклонение.
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd
from scipy import stats as scipy_stats

from .config import (
    MIN_RACES_FOR_RANK,
    MIN_RACES_PERIOD,
    RATING_CENTER,
    RATING_SCALE,
    SHRINK_RACES,
    WEIGHTS_PERIOD,
    WEIGHTS_SEASON,
)
from .features.stats import STANDING_POINTS, summarize

PERIOD = "all"


@dataclass(frozen=True)
class Group:
    id: str
    name: str
    about: str


@dataclass(frozen=True)
class Feature:
    id: str
    group: str
    name: str
    unit: str        # как показывать: pct, gap, pos, num1, signed1, sec, int, score
    better: int      # +1 — больше лучше, −1 — меньше лучше
    count: str | None = None  # по какому счётчику сжимать к среднему (None — не сжимать)


GROUPS = [
    Group("results", "Результаты", "Очки, победы, подиумы, место в чемпионате — то, что пилот реально привёз."),
    Group("above_car", "Сверх уровня машины",
          "Очки и места сверх того, что обычно привозит машина такого уровня; яркие гонки — подиум на машине "
          "из середины пелотона."),
    Group("quali", "Квалификация", "Поулы, выход в Q3, отставание от лучшего времени, среднее место."),
    Group("pace", "Темп в гонке", "Отставание от медианы поля на чистых кругах и стабильность темпа."),
    Group("racecraft", "Борьба", "Первый круг, обгоны и защита на трассе, позиции сверх ожидаемого за гонку."),
    Group("clean", "Надёжность", "Сходы по своей ошибке, финиши без поломок, штрафы по времени."),
    Group("teammate", "Против напарника",
          "Модель сети напарников: квалификация, темп и финиш с поправкой на силу напарников; доля очков команды."),
    Group("career", "Карьера", "Только для общей сводки: титулы, лучший сезон, сезоны в топ-5."),
]

FEATURES = [
    Feature("ppr", "results", "Очки за гонку", "num1", +1, "starts"),
    Feature("win_rate", "results", "Победы", "pct", +1, "starts"),
    Feature("podium_rate", "results", "Подиумы", "pct", +1, "starts"),
    Feature("champ", "results", "Место в чемпионате (очки за место)", "num1", +1),
    Feature("points_above_car", "above_car", "Очки сверх уровня машины, за гонку", "signed1", +1, "pac_n"),
    Feature("pos_above_car", "above_car", "Места сверх уровня машины", "signed1", +1, "posac_n"),
    Feature("standout_rate", "above_car", "Яркие гонки", "pct", +1, "starts"),
    Feature("pole_rate", "quali", "Поулы", "pct", +1, "quali_n"),
    Feature("q3_rate", "quali", "Выход в Q3", "pct", +1, "quali_n"),
    Feature("quali_gap", "quali", "Отставание от лучшего в квале", "gap", -1, "quali_gap_n"),
    Feature("quali_pos", "quali", "Среднее место в квале", "pos", -1, "quali_n"),
    Feature("race_pace", "pace", "Темп: отставание от медианы поля", "signedgap", -1, "pace_n"),
    Feature("consistency", "pace", "Разброс времени круга", "gap", -1, "pace_n"),
    Feature("lap1_vs_exp", "racecraft", "Первый круг: места сверх ожидаемого", "signed1", +1, "lap1_n"),
    Feature("overtakes", "racecraft", "Обгоны на трассе за гонку", "num1", +1, "ot_n"),
    Feature("overtaken", "racecraft", "Пропущено обгонов за гонку", "num1", -1, "ot_n"),
    Feature("gain_vs_exp", "racecraft", "Позиции за гонку сверх ожидаемого", "signed1", +1, "gain_n"),
    Feature("err_rate", "clean", "Сходы по своей ошибке", "pct", -1, "starts"),
    Feature("finish_rate", "clean", "Финиши без поломок", "pct", +1, "finish_base"),
    Feature("penalty_rate", "clean", "Штрафы по времени", "pct", -1, "starts"),
    Feature("car_quali", "teammate", "Квала против напарников, с/круг", "sec", +1),
    Feature("car_pace", "teammate", "Темп против напарников, с/круг", "sec", +1),
    Feature("car_race", "teammate", "Финиш против напарников", "pct", +1),
    Feature("team_share", "teammate", "Доля очков команды", "pct", +1),
    Feature("titles", "career", "Титулы", "int", +1),
    Feature("peak", "career", "Лучший сезон", "score", +1),
    Feature("elite", "career", "Сезонов в топ-5", "int", +1),
]


def _features(summary: pd.DataFrame, champ: pd.Series, car: pd.DataFrame,
              career: pd.DataFrame | None) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Сырые значения признаков и счётчики для сжатия."""
    s = summary
    n = s["starts"]
    raw = pd.DataFrame(index=s.index)
    raw["ppr"] = s["points"] / n
    raw["win_rate"] = s["wins"] / n
    raw["podium_rate"] = s["podiums"] / n
    raw["champ"] = champ.reindex(s.index).fillna(0.0)
    raw["pole_rate"] = s["poles"] / s["quali_n"]
    raw["q3_rate"] = s["q3"] / s["quali_n"]
    raw["quali_gap"] = s["quali_gap"]
    raw["quali_pos"] = s["quali_pos"]
    raw["points_above_car"] = s["points_above_car"]
    raw["pos_above_car"] = s["pos_above_car"]
    raw["standout_rate"] = s["standouts"] / n
    raw["race_pace"] = s["race_pace"]
    raw["consistency"] = s["consistency"]
    raw["lap1_vs_exp"] = s["lap1_vs_exp"]
    raw["overtakes"] = s["overtakes"]
    raw["overtaken"] = s["overtaken"]
    raw["gain_vs_exp"] = s["gain_vs_exp"]
    raw["err_rate"] = s["driver_errors"] / n
    finish_base = n - s["mechanical"]
    raw["finish_rate"] = s["finished"] / finish_base.where(finish_base > 0)
    raw["penalty_rate"] = s["penalties"] / n
    raw["car_quali"] = car["quali_s"].reindex(s.index)
    raw["car_pace"] = car["pace_s"].reindex(s.index)
    raw["car_race"] = car["race_p"].reindex(s.index)
    # Доля очков команды с поправкой на малые суммы: +12,5 очка каждому из напарников.
    raw["team_share"] = (s["points"] + 12.5) / (s["points"] + s["mate_points"] + 25)
    if career is not None:
        for col in ("titles", "peak", "elite"):
            raw[col] = career[col].reindex(s.index)
    counts = pd.DataFrame({
        "starts": n,
        "quali_n": s["quali_n"],
        "quali_gap_n": s["quali_gap_n"],
        "pace_n": s["pace_n"],
        "lap1_n": s["lap1_n"],
        "ot_n": s["ot_n"],
        "gain_n": s["gain_n"],
        "pac_n": s["pac_n"],
        "posac_n": s["posac_n"],
        "finish_base": finish_base,
    })
    return raw, counts


def _standardize(values: pd.Series, pool: pd.Series) -> pd.Series:
    ref = values[pool]
    sd = ref.std(ddof=0)
    if not np.isfinite(sd) or sd == 0:
        return pd.Series(0.0, index=values.index)
    return (values - ref.mean()) / sd


def score(summary: pd.DataFrame, champ: pd.Series, car: pd.DataFrame, min_starts: int,
          weights: dict, career: pd.DataFrame | None = None) -> pd.DataFrame:
    """Итоговая таблица охвата: значения, z-оценки признаков и групп, рейтинг и место."""
    raw, counts = _features(summary, champ, car, career)
    pool = summary["starts"] >= min_starts
    out = pd.DataFrame(index=summary.index)
    out["starts"] = summary["starts"]
    out["eligible"] = pool

    feature_z = {}
    for feat in FEATURES:
        if feat.id not in raw:
            continue
        x = raw[feat.id].astype(float)
        mean = x[pool].mean()
        if feat.count:
            n = counts[feat.count].astype(float).fillna(0)
            x = (x.fillna(mean) * n + mean * SHRINK_RACES) / (n + SHRINK_RACES)
        x = x.fillna(mean)
        z = (feat.better * _standardize(x, pool)).clip(-3, 3).fillna(0.0)
        feature_z[feat.id] = z
        out[f"v_{feat.id}"] = raw[feat.id]
        out[f"z_{feat.id}"] = z

    total = pd.Series(0.0, index=summary.index)
    weight_sum = 0.0
    for group in GROUPS:
        members = [f.id for f in FEATURES if f.group == group.id and f.id in feature_z]
        if not members:
            continue
        gz = _standardize(pd.concat([feature_z[m] for m in members], axis=1).mean(axis=1), pool)
        out[f"g_{group.id}"] = gz
        out[f"s_{group.id}"] = (RATING_CENTER + RATING_SCALE * gz).clip(0, 100)
        w = weights.get(group.id, 0.0)
        total += w * gz
        weight_sum += w
    overall = _standardize(total / weight_sum, pool)
    out["overall_z"] = overall
    out["rating"] = (RATING_CENTER + RATING_SCALE * overall).clip(0, 100)
    out["rank"] = pd.Series(pd.NA, index=out.index, dtype="Int64")
    ranked = out.loc[pool, "rating"].rank(ascending=False, method="min").astype(int)
    out.loc[pool, "rank"] = ranked
    return out.join(summary.drop(columns=["starts"]).add_prefix("st_"))


def champ_points(standings: pd.DataFrame) -> pd.DataFrame:
    """Очки за место в чемпионате по шкале 25-18-…-1 (вне топ-10 — 0)."""
    s = standings.copy()
    s["champ"] = s["position"].map(STANDING_POINTS).fillna(0.0)
    return s


def build_scopes(records: pd.DataFrame, sprints: pd.DataFrame, standings: pd.DataFrame,
                 car_by_season: pd.DataFrame) -> dict:
    """Все охваты: каждый сезон и общий период. Возвращает {охват: DataFrame}."""
    champ = champ_points(standings)
    scopes = {}
    seasons = sorted(int(s) for s in records["season"].unique())
    for season in seasons:
        rec = records[records["season"] == season]
        summary = summarize(rec, sprints[sprints["season"] == season])
        champ_s = champ[champ["season"] == season].set_index("driver_id")["champ"]
        car = car_by_season[car_by_season["season"] == season].set_index("driver_id")
        scopes[str(season)] = score(summary, champ_s, car, MIN_RACES_FOR_RANK, WEIGHTS_SEASON)

    # Период: средние по сезонам с весом по числу гонок + признаки карьеры из сезонных рейтингов.
    summary = summarize(records, sprints)
    starts = records.groupby(["driver_id", "season"]).size().rename("n").reset_index()

    def weighted(df: pd.DataFrame, cols) -> pd.DataFrame:
        sums = df[cols].mul(df["n"], axis=0).groupby(df["driver_id"]).sum()
        return sums.div(df.groupby("driver_id")["n"].sum(), axis=0)

    champ_w = starts.merge(champ, on=["driver_id", "season"], how="left").fillna({"champ": 0.0})
    champ_all = weighted(champ_w, ["champ"])["champ"]
    car_all = weighted(starts.merge(car_by_season, on=["driver_id", "season"], how="inner"),
                       ["quali_s", "race_p", "pace_s"])

    season_rows = pd.concat(
        [df.assign(season=int(k)).reset_index() for k, df in scopes.items()], ignore_index=True)
    rows = []
    for driver, g in season_rows.groupby("driver_id"):
        solid = g[g["starts"] >= 10]
        if len(solid):
            peak = solid["rating"].max()
        else:  # только короткие сезоны — сильнее тянем к среднему
            peak = (RATING_CENTER + (g["rating"] - RATING_CENTER) * g["starts"] / 10).max()
        rows.append({
            "driver_id": driver,
            "peak": peak,
            "elite": int((g["rank"].fillna(99) <= 5).sum()),
            "titles": int(standings[(standings["driver_id"] == driver) & standings["champion"]].shape[0]),
        })
    career = pd.DataFrame(rows).set_index("driver_id")
    scopes[PERIOD] = score(summary, champ_all, car_all, MIN_RACES_PERIOD, WEIGHTS_PERIOD, career)
    return scopes


def expert_agreement(scopes: dict, expert: dict, old_ranks: dict) -> dict:
    """Сверка сезонного топ-10 с опросом руководителей команд F1.

    expert: {сезон: [пилоты по порядку]}; old_ranks: {сезон: {пилот: место}} — прошлая
    версия рейтинга (только сравнение с напарником), чтобы показать разницу.
    """
    report = {}
    for season, order in expert.items():
        table = scopes.get(str(season))
        if table is None:
            continue
        ours = table["rank"].dropna().astype(int).to_dict()
        top_ours = {d for d, r in ours.items() if r <= 10}
        old = old_ranks.get(int(season), {})
        top_old = {d for d, r in old.items() if r <= 10}
        experts = list(order)
        ranks_ours = [ours.get(d, 25) for d in experts]
        ranks_old = [old.get(d, 25) for d in experts]
        report[str(season)] = {
            "experts": experts,
            "overlap": len(top_ours & set(experts)),
            "overlap_old": len(top_old & set(experts)),
            "spearman": float(scipy_stats.spearmanr(range(1, len(experts) + 1), ranks_ours).statistic),
            "spearman_old": float(scipy_stats.spearmanr(range(1, len(experts) + 1), ranks_old).statistic),
            "our_ranks": dict(zip(experts, ranks_ours)),
        }
    return report
