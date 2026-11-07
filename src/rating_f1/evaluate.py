"""Проверка прогнозом: учимся на прошлых сезонах и предсказываем следующий.

Для каждого сезона Y модели обучаются только на сезонах до Y, а затем предсказывают
квалификационные гэпы и гоночные дуэли сезона Y. Самый важный срез — новые пары:
пилоты, которые раньше не были напарниками. Предсказать их можно только через сеть
напарников, поэтому этот срез проверяет, что модель отделяет пилота от машины.

Метрики считаются на двух уровнях:
* отдельная сессия — в ней много шума (трафик, ошибки), поэтому выигрыш скромный;
* пара за сезон (от 5 сравнений) — шум усредняется, видно, угадан ли сильнейший в паре.
"""
from __future__ import annotations

import logging

import numpy as np
import pandas as pd
from scipy import special

from .models.teammate import build_index, fit_quali, fit_race

log = logging.getLogger(__name__)

MIN_SESSIONS_PER_PAIR = 5


def _pair(a: str, b: str) -> str:
    return f"{a}|{b}" if a < b else f"{b}|{a}"


def _quali_metrics(df: pd.DataFrame):
    if df.empty:
        return None
    informative = df[df["pred"] != 0]
    season = (
        df.groupby(["season", "pair"])
        .agg(gap=("gap", "median"), pred=("pred", "mean"), n=("gap", "size"))
        .query(f"n >= {MIN_SESSIONS_PER_PAIR} and pred != 0")
    )
    return {
        "n": int(len(df)),
        "mae_model": float(np.mean(np.abs(df["gap"] - df["pred"]))),
        "mae_baseline": float(np.mean(np.abs(df["gap"]))),
        "sign_accuracy": float(np.mean(np.sign(informative["pred"]) == np.sign(informative["gap"])))
        if len(informative) else None,
        "season_pairs": int(len(season)),
        "season_sign_accuracy": float(np.mean(np.sign(season["pred"]) == np.sign(season["gap"])))
        if len(season) else None,
        "season_corr": float(np.corrcoef(season["pred"], season["gap"])[0, 1]) if len(season) > 2 else None,
    }


def _race_metrics(df: pd.DataFrame):
    if df.empty:
        return None
    p = df["p"].clip(1e-6, 1 - 1e-6)
    y = df["outcome"]
    season = (
        df.groupby(["season", "pair"])
        .agg(share=("outcome", "mean"), p=("p", "mean"), n=("outcome", "size"))
        .query(f"n >= {MIN_SESSIONS_PER_PAIR} and share != 0.5 and p != 0.5")
    )
    return {
        "n": int(len(df)),
        "accuracy": float(np.mean((p > 0.5) == (y == 1))),
        "log_loss": float(-np.mean(y * np.log(p) + (1 - y) * np.log(1 - p))),
        "log_loss_coin": float(np.log(2)),
        "brier": float(np.mean((p - y) ** 2)),
        "brier_coin": 0.25,
        "season_pairs": int(len(season)),
        "season_accuracy": float(np.mean((season["p"] > 0.5) == (season["share"] > 0.5))) if len(season) else None,
    }


def backtest(quali_pairs: pd.DataFrame, race_duels: pd.DataFrame, seasons, debut: dict) -> dict:
    q_rows, r_rows, targets = [], [], []
    for target in list(seasons)[1:]:
        train_q = quali_pairs[quali_pairs["valid"] & (quali_pairs["season"] < target)]
        train_r = race_duels[race_duels["valid"] & (race_duels["season"] < target)]
        test_q = quali_pairs[quali_pairs["valid"] & (quali_pairs["season"] == target)]
        test_r = race_duels[race_duels["valid"] & (race_duels["season"] == target) & (race_duels["session"] == "R")]
        if train_q.empty or train_r.empty or (test_q.empty and test_r.empty):
            continue
        targets.append(int(target))
        index = build_index(train_q, train_r)
        q_model = fit_quali(train_q, index, debut)[0]
        r_model = fit_race(train_r, index, debut)
        known = {driver for driver, _ in index.keys}
        drivers = set(test_q["driver_a"]) | set(test_q["driver_b"]) | set(test_r["driver_a"]) | set(test_r["driver_b"])
        q_pred = {d: q_model.predict(d, target, debut) for d in drivers}
        r_pred = {d: r_model.predict(d, target, debut) for d in drivers}
        seen = {_pair(a, b) for a, b in zip(
            pd.concat([train_q["driver_a"], train_r["driver_a"]]),
            pd.concat([train_q["driver_b"], train_r["driver_b"]]))}

        for a, b, gap in zip(test_q["driver_a"], test_q["driver_b"], test_q["gap_pct"]):
            q_rows.append({
                "season": target, "pair": _pair(a, b), "gap": gap,
                "pred": -(q_pred[a] - q_pred[b]),
                "both_known": a in known and b in known,
                "new_pair": _pair(a, b) not in seen,
            })
        for a, b, outcome in zip(test_r["driver_a"], test_r["driver_b"], test_r["outcome"]):
            r_rows.append({
                "season": target, "pair": _pair(a, b), "outcome": outcome,
                "p": float(special.expit(r_pred[a] - r_pred[b])),
                "both_known": a in known and b in known,
                "new_pair": _pair(a, b) not in seen,
            })
        log.info("Проверка прогнозом: сезон %s", target)

    q = pd.DataFrame(q_rows)
    r = pd.DataFrame(r_rows)
    return {
        "seasons": targets,
        "quali": {
            "all": _quali_metrics(q),
            "known": _quali_metrics(q[q["both_known"]]),
            "new_pairs": _quali_metrics(q[q["both_known"] & q["new_pair"]]),
        },
        "race": {
            "all": _race_metrics(r),
            "known": _race_metrics(r[r["both_known"]]),
            "new_pairs": _race_metrics(r[r["both_known"] & r["new_pair"]]),
        },
    }
