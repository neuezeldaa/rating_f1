"""Полный цикл: данные → признаки → модели → общий рейтинг → проверка → сайт.

Запуск из корня проекта:
    python -m rating_f1.pipeline              # докачает текущий сезон, прошлые — из кэша
    python -m rating_f1.pipeline --refresh    # перекачает все сезоны
    python -m rating_f1.pipeline --offline    # без сети, из data/processed
    python -m rating_f1.pipeline --no-backtest
"""
from __future__ import annotations

import argparse
import logging
import sys
import time

import numpy as np
import pandas as pd
import yaml

from .clean.enrich import enrich_results
from .clean.overrides import load_overrides
from .clean.status import classify_status
from .composite import GROUPS, PERIOD, build_scopes, expert_agreement
from .config import FIRST_SEASON, LAST_SEASON, N_DRAWS, OVERRIDES_PATH, ROOT, SEED
from .evaluate import backtest
from .export import export_web
from .features.car_level import above_car, car_ranks, sprint_records
from .features.laps import lap_features
from .features.quali import quali_pairs
from .features.race import race_duels
from .features.stats import quali_records, race_records
from .features.stints import stint_factor, stint_starts
from .graph import build_graph
from .models.season import season_performance
from .models.teammate import build_index, fit_quali, fit_race
from .ratings import raw_stats, season_context, season_ratings
from .tables import build_tables, load_tables, save_tables

EXPERT_PATH = ROOT / "annotations" / "expert_rankings.yaml"
log = logging.getLogger("rating_f1")


def teammate_model(qp: pd.DataFrame, rd: pd.DataFrame, pp: pd.DataFrame, results: pd.DataFrame, debut: dict):
    """Модели «пилот против напарника» (квала, финиш, темп): навык по сезонам и выступление в сезоне."""
    index = build_index(qp[qp["valid"]], rd[rd["valid"]], pp[pp["valid"]])
    quali_model, q_huber = fit_quali(qp, index, debut)
    pace_model, p_huber = fit_quali(pp, index, debut)  # та же нормальная модель, но на темпе в гонке
    race_model = fit_race(rd, index, debut)
    qh, rh, ph = quali_model.hyper, race_model.hyper, pace_model.hyper
    for label, h in (("Квала", qh), ("Темп", ph)):
        log.info("%s: шум %.3f%%, разброс навыка %.3f%%, изменение за сезон %.3f%% (+%.3f%% у молодых), "
                 "новичок %+.3f%%, рост молодых %+.3f%%/сезон", label, h["sigma"], h["tau0"], h["tau_rw"],
                 h["tau_dev"], h["mu_rookie"], h["mu_dev"])
    log.info("Финиш (логиты): разброс навыка %.3f, изменение за сезон %.3f (+%.3f у молодых), "
             "новичок %+.3f, рост молодых %+.3f/сезон", rh["tau0"], rh["tau_rw"], rh["tau_dev"],
             rh["mu_rookie"], rh["mu_dev"])

    rng = np.random.default_rng(SEED)
    q_draws, r_draws, p_draws = (m.draws(N_DRAWS, rng) for m in (quali_model, race_model, pace_model))
    race_results = results[results["session"] == "R"]
    team_starts: dict = {}
    for (season, team, driver), n in race_results.groupby(["season", "constructor_id", "driver_id"]).size().items():
        team_starts.setdefault((int(season), team), {})[driver] = int(n)
    q_valid, r_valid, p_valid = qp[qp["valid"]], rd[rd["valid"]], pp[pp["valid"]]
    models = [
        {"draws": q_draws, "pairs": q_valid.assign(y=-q_valid["gap_pct"], w=q_huber), "kind": "gaussian",
         "sigma": qh["sigma"], "tau": qh["tau0"]},
        {"draws": r_draws, "pairs": r_valid.assign(y=r_valid["outcome"], w=r_valid["weight"]), "kind": "logistic",
         "tau": rh["tau0"]},
        {"draws": p_draws, "pairs": p_valid.assign(y=-p_valid["gap_pct"], w=p_huber), "kind": "gaussian",
         "sigma": ph["sigma"], "tau": ph["tau0"]},
    ]
    q_perf, r_perf, p_perf = season_performance(index, models, team_starts, rng)

    starts = {(d, int(s)): int(n) for (d, s), n in race_results.groupby(["driver_id", "season"]).size().items()}
    ratings = season_ratings(index.keys, q_perf, r_perf, qh["sigma"], starts, p_perf, ph["sigma"])
    skill = season_ratings(index.keys, q_draws, r_draws, qh["sigma"], starts, p_draws, ph["sigma"])
    skill = skill[["driver_id", "season", "overall", "overall_lo", "overall_hi", "rank"]].rename(
        columns={c: f"skill_{c}" for c in ("overall", "overall_lo", "overall_hi", "rank")})
    pace_skill = {key: float(value) for key, value in zip(index.keys, pace_model.mean)}
    models_hyper = {"quali": qh, "race": rh, "pace": ph}
    return ratings.merge(skill, on=["driver_id", "season"], how="left"), models_hyper, pace_skill


def _log_scope(table: pd.DataFrame, names: pd.Series, title: str, n: int) -> None:
    top = table[table["eligible"]].sort_values("rank").head(n)
    groups = [g for g in GROUPS if f"s_{g.id}" in table]
    log.info("%s (рейтинг 0–100; группы: %s):", title, ", ".join(g.name for g in groups))
    for driver, rec in top.iterrows():
        parts = " ".join(f"{rec[f's_{g.id}']:3.0f}" for g in groups)
        log.info("  %2d. %-12s %5.1f | %s | побед %3d, подиумов %3d, гонок %3d", rec["rank"],
                 names.get(driver, driver), rec["rating"], parts, rec["st_wins"], rec["st_podiums"], rec["starts"])


def main(argv=None) -> None:
    parser = argparse.ArgumentParser(description="Рейтинг пилотов F1: полный цикл")
    parser.add_argument("--refresh", action="store_true", help="перекачать все сезоны из Jolpica")
    parser.add_argument("--offline", action="store_true", help="не ходить в сеть, взять таблицы из data/processed")
    parser.add_argument("--no-backtest", action="store_true", help="пропустить проверку прогнозом")
    args = parser.parse_args(argv)
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8")
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    started = time.time()

    seasons = list(range(FIRST_SEASON, LAST_SEASON + 1))
    tables = load_tables() if args.offline else build_tables(seasons, refresh=args.refresh)
    results = enrich_results(tables["results"], tables["f1db_results"])
    qualifying = tables["qualifying"]
    seasons = sorted(int(s) for s in results["season"].unique())
    debut = {d: int(s) for d, s in zip(tables["drivers"]["driver_id"], tables["drivers"]["debut_season"])}
    names = tables["drivers"].set_index("driver_id")["family_name"]
    log.info("Данные: %s сезонов, %s гонок, %s строк результатов, %s строк квалификаций",
             len(seasons), int(tables["races"]["completed"].sum()), len(results), len(qualifying))

    categories = results["status_detail"].map(classify_status)
    unclear = results.loc[categories == "unclear", "status_detail"].value_counts()
    log.info("Неясные сходы после F1DB (можно уточнить в annotations/overrides.yaml): %s",
             {k: int(v) for k, v in unclear.items()})

    overrides = load_overrides(OVERRIDES_PATH)
    qp = quali_pairs(qualifying, overrides)
    rd = race_duels(results, overrides)
    log.info("Квалификации: %s сравнений с напарником, учтено %s", len(qp), int(qp["valid"].sum()))
    log.info("Гоночные дуэли: %s, учтено %s; исключено: %s", len(rd), int(rd["valid"].sum()),
             {k: int(v) for k, v in rd.loc[~rd["valid"], "reason"].value_counts().items()})

    lap_stats, pace_pairs, _ = lap_features(tables["laps"], tables["pit_stops"], results)

    # Подменные выступления (до 3 гонок за команду в сезоне) — половинный вес во всех моделях напарников.
    starts_map = stint_starts(results)
    qp["weight"] = stint_factor(qp, starts_map)
    pace_pairs["weight"] = stint_factor(pace_pairs, starts_map)
    rd["weight"] = rd["weight"] * stint_factor(rd, starts_map)
    log.info("Подменные выступления с половинным весом: квалификаций %s, дуэлей %s, пар темпа %s",
             int((qp["weight"] < 1).sum()), int((stint_factor(rd, starts_map) < 1).sum()),
             int((pace_pairs["weight"] < 1).sum()))
    log.info("Круги: темп посчитан для %s стартов, обгонов на трассе %s; пар напарников по темпу %s (учтено %s)",
             int(lap_stats["pace_gap"].notna().sum()), int(lap_stats["overtakes_made"].sum()),
             len(pace_pairs), int(pace_pairs["valid"].sum()))

    teammate, models_hyper, pace_skill = teammate_model(qp, rd, pace_pairs, results, debut)
    records = race_records(results, qualifying, lap_stats)
    teams = results[results["session"] == "R"][["season", "round", "driver_id", "constructor_id"]]
    ranks = car_ranks(lap_stats[["season", "round", "driver_id", "pace_gap"]].dropna(),
                      quali_records(qualifying), teams)
    records, sprints, expectations = above_car(records, sprint_records(results), ranks)
    log.info("Ожидаемые очки за гонку по рангу машины: %s", expectations["points"])
    scopes = build_scopes(records, sprints, tables["standings"],
                          teammate[["driver_id", "season", "quali_s", "race_p", "pace_s"]])

    graph = build_graph(results, tables["constructors"], qp, rd, pace_pairs, scopes[PERIOD], starts_map)
    gs = graph["stats"]
    log.info("Граф напарников: %s пилотов, %s пар (слабых, до %s гонок: %s), компонент %s, "
             "в среднем %.1f шага между пилотами", gs["drivers"], gs["pairs"], gs["weak_races"],
             gs["weak_pairs"], gs["components"], gs["mean_hops"])

    expert_raw = yaml.safe_load(EXPERT_PATH.read_text(encoding="utf-8")) if EXPERT_PATH.exists() else {}
    expert_lists = {int(s): v["top10"] for s, v in expert_raw.items()}
    old_ranks = {int(s): g.dropna(subset=["rank"]).set_index("driver_id")["rank"].astype(int).to_dict()
                 for s, g in teammate.groupby("season")}
    agreement = expert_agreement(scopes, expert_lists, old_ranks)
    for season, rep in sorted(agreement.items()):
        log.info("Сверка с опросом руководителей команд %s: совпало в топ-10 %s из 10 (было %s), "
                 "корреляция мест %.2f (было %.2f)", season, rep["overlap"], rep["overlap_old"],
                 rep["spearman"], rep["spearman_old"])

    raw = raw_stats(qp, rd)
    context = season_context(results, tables["constructors"])
    scores = pd.concat([df.assign(scope=k).reset_index() for k, df in scopes.items()], ignore_index=True)
    save_tables({"quali_pairs": qp, "race_duels": rd, "pace_pairs": pace_pairs, "teammate_ratings": teammate,
                 "lap_stats": lap_stats, "car_ranks": ranks,
                 "race_records": records.drop(columns=["status_detail"]).assign(
                     status_detail=records["status_detail"].astype(str)),
                 "scores": scores})

    check = None
    if not args.no_backtest:
        check = backtest(qp, rd, seasons, debut)
        q_new, r_new = check["quali"]["new_pairs"], check["race"]["new_pairs"]
        log.info("Модель напарников, новые пары: квала — сильнейший угадан в %.0f%% из %s пар; "
                 "гонка — в %.0f%% из %s пар", 100 * q_new["season_sign_accuracy"], q_new["season_pairs"],
                 100 * r_new["season_accuracy"], r_new["season_pairs"])

    counts = {
        "quali_valid": int(qp["valid"].sum()), "quali_total": int(len(qp)),
        "race_valid": int(rd["valid"].sum()), "race_total": int(len(rd)),
        "race_excluded": {str(k): int(v) for k, v in rd.loc[~rd["valid"], "reason"].value_counts().items()},
        "starts": int(len(records)),
    }
    expert_meta = {"seasons": agreement,
                   "sources": {str(s): v["source"] for s, v in expert_raw.items()}}
    counts["pace_pairs_valid"] = int(pace_pairs["valid"].sum())
    counts["overtakes"] = int(lap_stats["overtakes_made"].sum())
    export_web(tables, scopes, teammate, raw, context, models_hyper, check, expert_meta, counts, expectations, graph)

    _log_scope(scopes[PERIOD], names, f"Общий рейтинг {seasons[0]}–{seasons[-1]}", 15)
    _log_scope(scopes[str(seasons[-1])], names, f"Сезон {seasons[-1]}", 8)
    log.info("Готово за %.0f с. Сайт: web/index.html", time.time() - started)


if __name__ == "__main__":
    main()
