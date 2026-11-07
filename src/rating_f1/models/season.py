"""Выступление в сезоне: уровень пары — из сети за все годы, разница внутри пары — из этого сезона.

Сглаженная модель (teammate.py) оценивает навык и переносит информацию между сезонами.
Для вопроса «кто лучше провёл сезон» этого мало: если напарники в этом году сравнялись,
сглаженная модель частично спишет это на шум и сохранит прошлогодний разрыв.

Поэтому для каждой команды в каждом сезоне и для каждой модели (квалификация, финиш, темп):
    уровень пары   = средний сглаженный навык её пилотов (с весом по числу гонок за команду);
    разница внутри = оценка только по сравнениям этого сезона (со слабым сжатием к нулю);
    выступление    = уровень пары + отклонение пилота внутри пары.
Если пилот за сезон ездил за две команды, его выступления усредняются по числу гонок.
"""
from __future__ import annotations

import numpy as np
import pandas as pd
from scipy import linalg

from .teammate import SkillIndex, gaussian_draws, map_logistic


def _local_design(group: pd.DataFrame, local: dict) -> tuple[np.ndarray, np.ndarray]:
    mask = (group["driver_a"].isin(local) & group["driver_b"].isin(local)).to_numpy()
    group = group[mask]
    x = np.zeros((len(group), len(local)))
    rows = np.arange(len(group))
    x[rows, [local[d] for d in group["driver_a"]]] = 1.0
    x[rows, [local[d] for d in group["driver_b"]]] = -1.0
    return x, mask


def _split(model: dict, group: pd.DataFrame, local: dict, n_draws: int, rng: np.random.Generator) -> np.ndarray:
    """Разница внутри пары только по данным сезона, со слабым сжатием к нулю."""
    x, mask = _local_design(group, local)
    y = group["y"].to_numpy(dtype=float)[mask]
    w = group["w"].to_numpy(dtype=float)[mask]
    q = np.eye(len(local)) / model["tau"] ** 2
    if model["kind"] == "gaussian":
        precision = (x.T * w) @ x / model["sigma"] ** 2 + q
        mean = linalg.cho_solve(linalg.cho_factor(precision, lower=True), (x.T * w) @ y / model["sigma"] ** 2)
        return gaussian_draws(mean, precision, n_draws, rng)
    theta, hess, _ = map_logistic(x, y, w, q, np.zeros(len(local)))
    return gaussian_draws(theta, hess, n_draws, rng)


def season_performance(index: SkillIndex, models: list[dict], team_starts: dict, rng: np.random.Generator) -> list:
    """Выборки выступления в сезоне для каждой модели, в порядке index.keys.

    models: [{"draws": выборки сглаженного навыка, "pairs": валидные сравнения со столбцами
              season, constructor_id, driver_a, driver_b, y, w, "kind": "gaussian" | "logistic",
              "tau": априорный разброс, "sigma": шум (для gaussian)}]
    team_starts: {(сезон, команда): {пилот: число гонок за эту команду}}.
    """
    p, n_draws = models[0]["draws"].shape
    outs = [np.zeros((p, n_draws)) for _ in models]
    total = np.zeros(p)
    groups = [dict(tuple(m["pairs"].groupby(["season", "constructor_id"]))) for m in models]

    for (season, team), starts in sorted(team_starts.items()):
        drivers = [d for d in sorted(starts) if (d, season) in index.pos]
        if not drivers:
            continue
        idx = np.array([index.pos[(d, season)] for d in drivers])
        n = np.array([starts[d] for d in drivers], dtype=float)
        wn = n / n.sum()
        local = {d: j for j, d in enumerate(drivers)}
        for model, model_groups, out in zip(models, groups, outs):
            group = model_groups.get((season, team))
            if len(drivers) == 1:
                split = np.zeros((1, n_draws))
            elif group is None or group.empty:
                split = rng.normal(0.0, model["tau"], (len(drivers), n_draws))  # данных нет — только разброс
            else:
                split = _split(model, group, local, n_draws, rng)
            split = split - wn @ split
            out[idx] += n[:, None] * (wn @ model["draws"][idx] + split)
        total[idx] += n

    missing = total == 0
    for model, out in zip(models, outs):
        out[missing] = model["draws"][missing]
    total[missing] = 1.0
    return [out / total[:, None] for out in outs]
