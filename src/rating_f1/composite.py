"""Общий рейтинг: признаки → группы → итог по шкале 0–100.

Для каждого охвата (весь период или один сезон):
1. Сводка статистики пилота за охват + оценки модели «сверх машины» (сравнение с напарником).
2. Доли и средние сжимаются к среднему по пулу: чем меньше гонок, тем меньше доверия.
3. Каждый признак переводится в z-оценку среди пилотов пула (у кого хватает гонок);
   знак выбран так, что больше — лучше.
4. Оценка группы — среднее z её признаков; итог — взвешенная сумма групп.
5. Шкала 0–100: 50 — средний пилот пула, +15 за каждое стандартное отклонение.

Средние и разбросы по пулу на каждом шаге — «линейка» охвата. Пересчёты для интервалов
(intervals.py) меряются линейкой основного расчёта, а не своей.
"""
from __future__ import annotations

import warnings
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
SOLID_SEASON = 10  # гонок в сезоне, чтобы он шёл в «лучший сезон» без поправки


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
    Group("clean", "Аккуратность",
          "Свои аварии и развороты, столкновения по решению стюардов, другие штрафы по времени. "
          "Поломки и чужие столкновения не в счёт."),
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
    # Три вида происшествий без пересечений. Столкновение засчитывается только виновнику — по решению
    # стюардов (с 2019 года, ingest/fia.py), штраф за него не считается ещё раз «другим штрафом».
    Feature("err_rate", "clean", "Свои аварии и развороты", "pct", -1, "starts"),
    Feature("collision_rate", "clean", "Столкновения по решению стюардов", "pct", -1, "fia_starts"),
    Feature("penalty_rate", "clean", "Другие штрафы по времени", "pct", -1, "starts"),
    Feature("car_quali", "teammate", "Квала против напарников, с/круг", "sec", +1),
    Feature("car_pace", "teammate", "Темп против напарников, с/круг", "sec", +1),
    Feature("car_race", "teammate", "Финиш против напарников", "pct", +1),
    Feature("team_share", "teammate", "Доля очков команды", "pct", +1),
    Feature("titles", "career", "Титулы", "int", +1),
    Feature("peak", "career", "Лучший сезон", "score", +1),
    Feature("elite", "career", "Сезонов в топ-5", "int", +1),
]


@dataclass
class Ruler:
    """Линейка охвата из основного расчёта: кто в пуле и средние с разбросами на каждом шаге.

    Пересчёты для интервалов меряются ею же. Если бы каждый пересчёт брал свои средние
    и разбросы, баллы в нём сжимались бы к 50: к настоящей разнице между пилотами
    в пересчёте добавляется случайная, и разброс по пулу растёт.
    """
    pool: pd.Series             # индекс — все пилоты охвата, значение — входит ли в пул
    shrink_to: np.ndarray       # среднее сырого признака по пулу: к нему сжимаются доли
    center: np.ndarray          # среднее признака после сжатия
    sd: np.ndarray              # разброс признака после сжатия
    group_center: np.ndarray
    group_sd: np.ndarray
    overall_center: float
    overall_sd: float
    pool_z: np.ndarray          # z признаков пилотов пула (до обрезки ±3): «случайный пилот пула»


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
    raw["err_rate"] = s["crashes"] / n
    raw["collision_rate"] = s["collisions"] / s["fia_starts"].where(s["fia_starts"] > 0)
    raw["penalty_rate"] = s["penalties_other"] / n
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
        "fia_starts": s["fia_starts"],
    })
    return raw, counts


def _moments(values: np.ndarray, pool: np.ndarray):
    """Среднее и разброс (ddof=0) по пулу, по столбцам; пропуски не учитываются."""
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", category=RuntimeWarning)  # столбец без единого значения
        return np.nanmean(values[pool], axis=0), np.nanstd(values[pool], axis=0)


def _scaled(values: np.ndarray, center, sd) -> np.ndarray:
    """(x − среднее) / разброс; где разброса нет — ноль."""
    ok = np.isfinite(sd) & (sd > 0)
    with np.errstate(invalid="ignore", divide="ignore"):
        z = (values - center) / np.where(ok, sd, 1.0)
    return np.where(ok, z, 0.0)


def _grade(raw: pd.DataFrame, counts: pd.DataFrame, pool: np.ndarray, weights: dict,
           ruler: Ruler | None = None, donors: np.ndarray | None = None):
    """z признаков, z групп и итоговое z. Без ruler средние и разбросы берутся по этому пулу.

    donors (только в пересчётах) — для каждого пилота номер случайного пилота пула. Сжатие —
    это SHRINK_RACES воображаемых гонок среднего пилота; в пересчёте их «проезжает» этот
    пилот пула. Иначе балл пилота с 1–2 гонками почти не менялся бы между пересчётами:
    он почти целиком из воображаемых гонок, хотя о его уровне мы почти ничего не знаем.

    Возвращает (признаки, группы, z признаков, z групп, итог, части линейки).
    """
    feats = [f for f in FEATURES if f.id in raw.columns]
    groups = [g for g in GROUPS if any(f.group == g.id for f in feats)]
    x = raw[[f.id for f in feats]].to_numpy(dtype=float)
    if ruler is None:
        shrink_to = _moments(x, pool)[0]
    else:
        shrink_to = ruler.shrink_to
    n = np.column_stack([counts[f.count].to_numpy(dtype=float) if f.count else np.zeros(len(x))
                         for f in feats])
    n = np.nan_to_num(n, nan=0.0)
    filled = np.where(np.isnan(x), shrink_to, x)
    shrunk = (filled * n + shrink_to * SHRINK_RACES) / (n + SHRINK_RACES)
    has_count = np.array([f.count is not None for f in feats])
    x = np.where(has_count, shrunk, filled)

    center, sd = _moments(x, pool) if ruler is None else (ruler.center, ruler.sd)
    better = np.array([f.better for f in feats], dtype=float)
    z = better * _scaled(x, center, sd)
    pool_z = z[pool]
    if donors is not None:
        # Воображаемые гонки на уровне пилота пула вместо среднего: + доля сжатия × его z.
        z = z + has_count * SHRINK_RACES / (n + SHRINK_RACES) * ruler.pool_z[donors]
    z = np.nan_to_num(np.clip(z, -3, 3), nan=0.0)

    members = [[i for i, f in enumerate(feats) if f.group == g.id] for g in groups]
    group_mean = np.column_stack([z[:, m].mean(axis=1) for m in members])
    gc, gs = _moments(group_mean, pool) if ruler is None else (ruler.group_center, ruler.group_sd)
    gz = _scaled(group_mean, gc, gs)

    w = np.array([weights.get(g.id, 0.0) for g in groups])
    total = gz @ w / w.sum()
    oc, os_ = _moments(total, pool) if ruler is None else (ruler.overall_center, ruler.overall_sd)
    overall = _scaled(total, oc, os_)
    parts = dict(shrink_to=shrink_to, center=center, sd=sd, group_center=gc, group_sd=gs,
                 overall_center=float(oc), overall_sd=float(os_), pool_z=pool_z)
    return feats, groups, z, gz, overall, parts


def _ranks(rating: pd.Series, pool: np.ndarray) -> pd.Series:
    """Место среди пула по рейтингу (равные делят место); вне пула — пусто."""
    rank = pd.Series(pd.NA, index=rating.index, dtype="Int64")
    rank[pool] = rating[pool].rank(ascending=False, method="min").astype(int)
    return rank


def score(summary: pd.DataFrame, champ: pd.Series, car: pd.DataFrame, min_starts: int,
          weights: dict, career: pd.DataFrame | None = None) -> tuple[pd.DataFrame, Ruler]:
    """Итоговая таблица охвата и её линейка: значения, z-оценки признаков и групп, рейтинг и место."""
    raw, counts = _features(summary, champ, car, career)
    pool = (summary["starts"] >= min_starts).to_numpy()
    feats, groups, z, gz, overall, parts = _grade(raw, counts, pool, weights)
    cols = {"starts": summary["starts"].to_numpy(), "eligible": pool}
    for i, f in enumerate(feats):
        cols[f"v_{f.id}"] = raw[f.id].to_numpy()
        cols[f"z_{f.id}"] = z[:, i]
    for j, g in enumerate(groups):
        cols[f"g_{g.id}"] = gz[:, j]
        cols[f"s_{g.id}"] = np.clip(RATING_CENTER + RATING_SCALE * gz[:, j], 0, 100)
    cols["overall_z"] = overall
    cols["rating"] = np.clip(RATING_CENTER + RATING_SCALE * overall, 0, 100)
    out = pd.DataFrame(cols, index=summary.index)
    out["rank"] = _ranks(out["rating"], pool)
    ruler = Ruler(pool=pd.Series(pool, index=summary.index), **parts)
    return out.join(summary.drop(columns=["starts"]).add_prefix("st_")), ruler


def score_draw(summary: pd.DataFrame, champ: pd.Series, car: pd.DataFrame, ruler: Ruler, weights: dict,
               rng: np.random.Generator, career: pd.DataFrame | None = None) -> pd.DataFrame:
    """Один пересчёт для интервалов: z групп, рейтинг и место. Пилоты, пул и линейка — основного расчёта."""
    summary = summary.reindex(ruler.pool.index)  # кому не досталось ни одной гонки — как при нуле гонок
    raw, counts = _features(summary, champ, car, career)
    pool = ruler.pool.to_numpy()
    donors = rng.integers(0, len(ruler.pool_z), size=len(summary))
    _, groups, _, gz, overall, _ = _grade(raw, counts, pool, weights, ruler, donors)
    out = pd.DataFrame(gz, index=summary.index, columns=[f"g_{g.id}" for g in groups])
    out["starts"] = summary["starts"].to_numpy()
    out["rating"] = np.clip(RATING_CENTER + RATING_SCALE * overall, 0, 100)
    out["rank"] = _ranks(out["rating"], pool)
    return out


def champ_points(standings: pd.DataFrame) -> pd.DataFrame:
    """Очки за место в чемпионате по шкале 25-18-…-1 (вне топ-10 — 0)."""
    s = standings.copy()
    s["champ"] = s["position"].map(STANDING_POINTS).fillna(0.0)
    return s


def _season_parts(records, sprints, champ, car_by_season, season: int):
    """Входы сезона: сводка по гонкам, очки за место в чемпионате, оценки против напарника."""
    rec = records[records["season"] == season]
    summary = summarize(rec, sprints[sprints["season"] == season])
    champ_s = champ[champ["season"] == season].set_index("driver_id")["champ"]
    car = car_by_season[car_by_season["season"] == season].set_index("driver_id")
    return summary, champ_s, car


def _career(season_tables: dict, standings: pd.DataFrame) -> pd.DataFrame:
    """Признаки карьеры из сезонных рейтингов: лучший сезон, сезоны в топ-5, титулы."""
    rows = pd.concat([df[["starts", "rating", "rank"]].rename_axis("driver_id").reset_index()
                      for df in season_tables.values()], ignore_index=True)
    by = rows["driver_id"]
    starts = rows["starts"].astype(float)
    # Сезон от 10 гонок идёт как есть; если таких нет — короткие сезоны тянем к среднему.
    peak_solid = rows["rating"].where(starts >= SOLID_SEASON).groupby(by).max()
    peak_short = (RATING_CENTER + (rows["rating"] - RATING_CENTER) * starts / SOLID_SEASON).groupby(by).max()
    career = pd.DataFrame({
        "peak": peak_solid.fillna(peak_short),
        "elite": (rows["rank"].fillna(99) <= 5).groupby(by).sum().astype(int),
    })
    titles = standings[standings["champion"]].groupby("driver_id").size()
    career["titles"] = titles.reindex(career.index).fillna(0).astype(int)
    return career


def _period_parts(records, sprints, champ, car_by_season, standings, season_tables: dict):
    """Входы общей сводки: все гонки, средние по сезонам с весом по числу гонок, карьера."""
    summary = summarize(records, sprints)
    starts = records.groupby(["driver_id", "season"]).size().rename("n").reset_index()

    def weighted(df: pd.DataFrame, cols) -> pd.DataFrame:
        sums = df[cols].mul(df["n"], axis=0).groupby(df["driver_id"]).sum()
        return sums.div(df.groupby("driver_id")["n"].sum(), axis=0)

    champ_w = starts.merge(champ, on=["driver_id", "season"], how="left").fillna({"champ": 0.0})
    champ_all = weighted(champ_w, ["champ"])["champ"]
    car_all = weighted(starts.merge(car_by_season, on=["driver_id", "season"], how="inner"),
                       ["quali_s", "race_p", "pace_s"])
    return summary, champ_all, car_all, _career(season_tables, standings)


def build_scopes(records: pd.DataFrame, sprints: pd.DataFrame, standings: pd.DataFrame,
                 car_by_season: pd.DataFrame) -> tuple[dict, dict]:
    """Все охваты: каждый сезон и общий период. Возвращает ({охват: таблица}, {охват: линейка})."""
    champ = champ_points(standings)
    scopes, rulers = {}, {}
    for season in sorted(int(s) for s in records["season"].unique()):
        parts = _season_parts(records, sprints, champ, car_by_season, season)
        scopes[str(season)], rulers[str(season)] = score(*parts, MIN_RACES_FOR_RANK, WEIGHTS_SEASON)
    summary, champ_all, car_all, career = _period_parts(records, sprints, champ, car_by_season, standings, scopes)
    scopes[PERIOD], rulers[PERIOD] = score(summary, champ_all, car_all, MIN_RACES_PERIOD, WEIGHTS_PERIOD, career)
    return scopes, rulers


def draw_scopes(records: pd.DataFrame, sprints: pd.DataFrame, standings: pd.DataFrame,
                car_by_season: pd.DataFrame, rulers: dict, rng: np.random.Generator) -> dict:
    """Один пересчёт всех охватов для интервалов (те же шаги, линейки — из основного расчёта)."""
    champ = champ_points(standings)
    tables = {}
    for key, ruler in rulers.items():
        if key != PERIOD:
            parts = _season_parts(records, sprints, champ, car_by_season, int(key))
            tables[key] = score_draw(*parts, ruler, WEIGHTS_SEASON, rng)
    summary, champ_all, car_all, career = _period_parts(records, sprints, champ, car_by_season, standings, tables)
    tables[PERIOD] = score_draw(summary, champ_all, car_all, rulers[PERIOD], WEIGHTS_PERIOD, rng, career)
    return tables


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
