"""Модели «пилот против напарника».

Машина сокращается: сравниваем только напарников в одной сессии.
Одна оценка навыка на пару (пилот, сезон); сезоны пилота связаны цепочкой:

    навык[первый сезон]   ~ N(μ_новичка, tau0²)    (μ_новичка — только если это сезон дебюта)
    навык[след.] − навык[пред.] ~ N(μ_роста · молодые_годы,
                                     tau_rw² · лет_между + tau_dev² · молодые_годы)

«Молодые годы» — переходы после первого и второго сезона в F1: в среднем пилоты
в это время прибавляют (μ_роста), и их уровень меняется сильнее (tau_dev).

По сути это Ridge-регрессия с недиагональным штрафом ½·(θ−m)ᵀQ(θ−m): штрафуются не
сами оценки, а отклонения от ожидаемой траектории. Поэтому сезоны с малым числом гонок
притягиваются к соседним, а пилоты, сменившие команду, связывают команды между собой.

Все гиперпараметры (шум, tau, μ) подбираются по данным — максимизацией обоснованности
(marginal likelihood). Апостериорное распределение нормальное: интервалы и выборки
считаются по готовым формулам.

Две модели:
* квалификация — гэп к напарнику в % (нормальный шум, выбросы ослабляются по Хьюберу);
* гонка — дуэль «кто выше» (Брэдли–Терри: логистическая регрессия на тех же разницах,
  нормальное приближение Лапласа для интервалов).
"""
from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
import pandas as pd
from scipy import linalg, optimize, special

from ..config import HUBER_C

LOG_BOUNDS = (np.log(1e-3), np.log(10.0))
YOUNG_EXPERIENCE = (0, 1)  # переходы после 1-го и 2-го сезона в F1


@dataclass
class SkillIndex:
    """Нумерация параметров: одна оценка навыка на пару (пилот, сезон)."""

    keys: list
    pos: dict

    @classmethod
    def build(cls, keys) -> "SkillIndex":
        keys = sorted(set(keys))
        return cls(keys, {key: i for i, key in enumerate(keys)})

    def __len__(self) -> int:
        return len(self.keys)


def build_index(*frames: pd.DataFrame) -> SkillIndex:
    """Все пары (пилот, сезон), встречающиеся в сравнениях."""
    keys = set()
    for df in frames:
        seasons = df["season"].astype(int).tolist()
        keys.update(zip(df["driver_a"].tolist(), seasons))
        keys.update(zip(df["driver_b"].tolist(), seasons))
    return SkillIndex.build(keys)


def young_transitions(debut, start: int, end: int) -> int:
    """Сколько переходов год→год на отрезке [start, end) приходится на молодые годы пилота."""
    if debut is None:
        return 0
    return sum(1 for year in range(start, end) if year - debut in YOUNG_EXPERIENCE)


class ChainPrior:
    """Цепочка сезонов: средняя траектория m и матрица точности Q (обратная ковариация)."""

    def __init__(self, index: SkillIndex, debut: dict):
        self.p = len(index)
        first, first_debut, li, lj, gap, young = [], [], [], [], [], []
        previous = None
        for i, (driver, season) in enumerate(index.keys):  # ключи отсортированы: пилот, сезон
            if previous is None or previous[0] != driver:
                first.append(i)
                first_debut.append(debut.get(driver) == season)
            else:
                li.append(i - 1)
                lj.append(i)
                gap.append(season - previous[1])
                young.append(young_transitions(debut.get(driver), previous[1], season))
            previous = (driver, season)
        self.first = np.array(first, dtype=int)
        self.first_debut = np.array(first_debut, dtype=float)
        self.li = np.array(li, dtype=int)
        self.lj = np.array(lj, dtype=int)
        self.gap = np.array(gap, dtype=float)
        self.young = np.array(young, dtype=float)

    def mean(self, mu_rookie: float, mu_dev: float) -> np.ndarray:
        m = np.zeros(self.p)
        m[self.first] = mu_rookie * self.first_debut
        for i, j, young in zip(self.li, self.lj, self.young):  # связи идут по порядку цепочек
            m[j] = m[i] + mu_dev * young
        return m

    def _link_var(self, tau_rw: float, tau_dev: float) -> np.ndarray:
        return tau_rw**2 * self.gap + tau_dev**2 * self.young

    def precision(self, tau0: float, tau_rw: float, tau_dev: float) -> np.ndarray:
        q = np.zeros((self.p, self.p))
        q[self.first, self.first] += 1.0 / tau0**2
        w = 1.0 / self._link_var(tau_rw, tau_dev)
        np.add.at(q, (self.li, self.li), w)
        np.add.at(q, (self.lj, self.lj), w)
        np.add.at(q, (self.li, self.lj), -w)
        np.add.at(q, (self.lj, self.li), -w)
        return q

    def logdet(self, tau0: float, tau_rw: float, tau_dev: float) -> float:
        """log|Q| в явном виде: у цепочки определитель — произведение обратных дисперсий."""
        return -len(self.first) * np.log(tau0**2) - float(np.sum(np.log(self._link_var(tau_rw, tau_dev))))


def pair_design(index: SkillIndex, pairs: pd.DataFrame) -> np.ndarray:
    """Строка на сравнение: +1 у пилота A и −1 у пилота B (в их сезоне)."""
    n = len(pairs)
    x = np.zeros((n, len(index)))
    rows = np.arange(n)
    seasons = pairs["season"].astype(int).tolist()
    x[rows, [index.pos[key] for key in zip(pairs["driver_a"].tolist(), seasons)]] = 1.0
    x[rows, [index.pos[key] for key in zip(pairs["driver_b"].tolist(), seasons)]] = -1.0
    return x


def gaussian_draws(mean: np.ndarray, precision: np.ndarray, n: int, rng: np.random.Generator) -> np.ndarray:
    """Выборки из N(mean, precision⁻¹); форма (параметры × выборки)."""
    chol = np.linalg.cholesky(precision)
    z = rng.standard_normal((len(mean), n))
    return mean[:, None] + linalg.solve_triangular(chol.T, z, lower=False)


def map_logistic(x, y, w, q, m, theta0=None, max_iter: int = 100):
    """Самые вероятные θ для P(y=1) = σ(Xθ) с априорным N(m, Q⁻¹): метод Ньютона с дроблением шага."""
    theta = (m if theta0 is None else theta0).copy()

    def objective(t):
        eta = x @ t
        d = t - m
        return float(np.sum(w * (y * eta - np.logaddexp(0.0, eta))) - 0.5 * d @ q @ d)

    def hessian(t):
        p = special.expit(x @ t)
        return (x.T * (w * p * (1 - p))) @ x + q

    f = objective(theta)
    for _ in range(max_iter):
        p = special.expit(x @ theta)
        grad = x.T @ (w * (y - p)) - q @ (theta - m)
        step = linalg.solve(hessian(theta), grad, assume_a="pos")
        t = 1.0
        while True:
            candidate = theta + t * step
            f_new = objective(candidate)
            if f_new >= f - 1e-12 or t < 1e-6:
                break
            t /= 2
        theta, f = candidate, f_new
        if float(np.max(np.abs(t * step))) < 1e-9:
            break
    return theta, hessian(theta), f


@dataclass
class Posterior:
    """Нормальное апостериорное распределение навыков: среднее и матрица точности."""

    index: SkillIndex
    mean: np.ndarray
    precision: np.ndarray
    hyper: dict = field(default_factory=dict)

    def draws(self, n: int, rng: np.random.Generator) -> np.ndarray:
        return gaussian_draws(self.mean, self.precision, n, rng)

    def predict(self, driver: str, season: int, debut: dict) -> float:
        """Прогноз навыка на будущий сезон: последний известный сезон + средний рост молодых."""
        last = None
        for (d, s), value in zip(self.index.keys, self.mean):
            if d == driver and s < season:
                last = (s, value)
        if last is None:
            return self.hyper["mu_rookie"] if debut.get(driver) == season else 0.0
        return last[1] + self.hyper["mu_dev"] * young_transitions(debut.get(driver), last[0], season)


def fit_gaussian(index: SkillIndex, debut: dict, x: np.ndarray, y: np.ndarray, base_weights: np.ndarray,
                 huber_c: float = HUBER_C, max_outer: int = 30) -> tuple[Posterior, np.ndarray]:
    """Нормальная модель y = Xθ + шум с цепочкой сезонов и весами Хьюбера.

    Внешний цикл: подобрать гиперпараметры по обоснованности → посчитать остатки →
    ослабить вес сессий с большими остатками → повторить до сходимости.
    """
    prior = ChainPrior(index, debut)
    n = len(y)
    base_weights = np.asarray(base_weights, dtype=float)
    w = base_weights.copy()
    start = np.array([np.log(max(float(np.std(y)), 0.05)), np.log(0.3), np.log(0.1), np.log(0.1), 0.0, 0.0])
    bounds = [LOG_BOUNDS] * 4 + [(-2.0, 2.0)] * 2

    for outer in range(1, max_outer + 1):
        xtw = x.T * w
        a = xtw @ x
        sum_log_w = float(np.sum(np.log(w)))

        def neg_log_evidence(params):
            sigma, tau0, tau_rw, tau_dev = np.exp(params[:4])
            resid = y - x @ prior.mean(*params[4:])
            p_mat = a / sigma**2 + prior.precision(tau0, tau_rw, tau_dev)
            try:
                factor = linalg.cho_factor(p_mat, lower=True)
            except linalg.LinAlgError:
                return 1e12
            b = (xtw @ resid) / sigma**2
            quad = float(resid @ (w * resid)) / sigma**2 - float(b @ linalg.cho_solve(factor, b))
            logdet_p = 2.0 * float(np.sum(np.log(np.diag(factor[0]))))
            logdet_r = n * np.log(sigma**2) - sum_log_w
            logdet_q = prior.logdet(tau0, tau_rw, tau_dev)
            return 0.5 * (n * np.log(2 * np.pi) + logdet_r - logdet_q + logdet_p + quad)

        res = optimize.minimize(neg_log_evidence, start, method="L-BFGS-B", bounds=bounds)
        start = res.x
        sigma, tau0, tau_rw, tau_dev = np.exp(res.x[:4])
        m = prior.mean(*res.x[4:])
        p_mat = a / sigma**2 + prior.precision(tau0, tau_rw, tau_dev)
        mean = m + linalg.cho_solve(linalg.cho_factor(p_mat, lower=True), xtw @ (y - x @ m) / sigma**2)

        z = (y - x @ mean) * np.sqrt(base_weights) / sigma
        w_new = base_weights * np.minimum(1.0, huber_c / np.maximum(np.abs(z), 1e-12))
        converged = float(np.max(np.abs(w_new - w))) < 1e-4
        w_used, w = w, w_new
        if converged:
            break

    hyper = {
        "sigma": float(sigma),
        "tau0": float(tau0),
        "tau_rw": float(tau_rw),
        "tau_dev": float(tau_dev),
        "mu_rookie": float(res.x[4]),
        "mu_dev": float(res.x[5]),
        "n_obs": int(n),
        "log_evidence": float(-res.fun),
        "iterations": outer,
        "downweighted": int(np.sum(w_used < base_weights * 0.999)),
    }
    return Posterior(index, mean, p_mat, hyper), w_used


def fit_bradley_terry(index: SkillIndex, debut: dict, x: np.ndarray, y: np.ndarray,
                      weights: np.ndarray) -> Posterior:
    """Логистическая модель P(A выше B) = σ(θ_A − θ_B) с той же цепочкой сезонов.

    Самые вероятные значения — методом Ньютона, гиперпараметры — по обоснованности
    в приближении Лапласа, интервалы — из того же приближения.
    """
    prior = ChainPrior(index, debut)
    weights = np.asarray(weights, dtype=float)
    y = np.asarray(y, dtype=float)
    state = {"theta": None}

    def unpack(params):
        logs = np.clip(params[:3], *LOG_BOUNDS)
        mus = np.clip(params[3:], -3.0, 3.0)
        return np.exp(logs), mus

    def neg_log_evidence(params):
        (tau0, tau_rw, tau_dev), mus = unpack(params)
        q = prior.precision(tau0, tau_rw, tau_dev)
        theta, hess, f = map_logistic(x, y, weights, q, prior.mean(*mus), state["theta"])
        state["theta"] = theta
        _, logdet_h = np.linalg.slogdet(hess)
        return -(f + 0.5 * prior.logdet(tau0, tau_rw, tau_dev) - 0.5 * logdet_h)

    start = np.array([np.log(0.5), np.log(0.2), np.log(0.2), 0.0, 0.0])
    res = optimize.minimize(neg_log_evidence, start, method="Nelder-Mead",
                            options={"xatol": 1e-3, "fatol": 1e-4, "maxiter": 1500})
    (tau0, tau_rw, tau_dev), (mu_rookie, mu_dev) = unpack(res.x)
    q = prior.precision(tau0, tau_rw, tau_dev)
    theta, hess, _ = map_logistic(x, y, weights, q, prior.mean(mu_rookie, mu_dev), state["theta"])
    hyper = {
        "tau0": float(tau0),
        "tau_rw": float(tau_rw),
        "tau_dev": float(tau_dev),
        "mu_rookie": float(mu_rookie),
        "mu_dev": float(mu_dev),
        "n_obs": int(len(y)),
        "log_evidence": float(-res.fun),
    }
    return Posterior(index, theta, hess, hyper)


def fit_quali(pairs: pd.DataFrame, index: SkillIndex, debut: dict) -> tuple[Posterior, np.ndarray]:
    """Квалификация: y > 0 — пилот A быстрее напарника (в % от времени круга)."""
    valid = pairs[pairs["valid"]]
    x = pair_design(index, valid)
    y = -valid["gap_pct"].to_numpy(dtype=float)
    return fit_gaussian(index, debut, x, y, np.ones(len(valid)))


def fit_race(duels: pd.DataFrame, index: SkillIndex, debut: dict) -> Posterior:
    """Гоночные дуэли: outcome = 1, если пилот A финишировал выше."""
    valid = duels[duels["valid"]]
    x = pair_design(index, valid)
    return fit_bradley_terry(index, debut, x, valid["outcome"].to_numpy(dtype=float),
                             valid["weight"].to_numpy(dtype=float))
