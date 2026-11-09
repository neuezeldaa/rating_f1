"""Рейтинг всех времён: сеть напарников (разреженная цепочка сезонов) и кто кому напарник."""
import numpy as np
import pandas as pd

from rating_f1.alltime import QUALI_PRIOR, _chain_ridge, teammate_skill


def _pairs(rows):
    """rows: (пилот A, пилот B, сезон, y = на сколько A быстрее B), каждая — 10 одинаковых гонок."""
    pairs = pd.DataFrame(rows * 10, columns=["driver_a", "driver_b", "season", "y"])
    return pairs, pairs["y"].to_numpy(float), np.ones(len(pairs))


def _skill(rows):
    pairs, y, w = _pairs(rows)
    out = _chain_ridge(pairs, y, w, **QUALI_PRIOR)
    return out.set_index(["driverId", "year"])["theta"]


def test_chain_is_transitive():
    # A быстрее B, B быстрее C; A и C вместе не ездили — сравнение идёт через B
    theta = _skill([("a", "b", 2000, 0.3), ("b", "c", 2000, 0.3)])
    assert theta[("a", 2000)] > theta[("b", 2000)] > theta[("c", 2000)]


def test_seasons_are_linked():
    # A сильно быстрее B в 2000-м, а в 2001-м вровень с C: C сильнее B, хотя они не встречались
    theta = _skill([("a", "b", 2000, 1.0), ("a", "c", 2001, 0.0)])
    assert theta[("c", 2001)] > theta[("b", 2000)]
    assert abs(theta[("a", 2001)] - theta[("a", 2000)]) < 0.1   # навык за год меняется мало


def test_long_break_weakens_the_link():
    # Чем больше лет между сезонами пилота, тем меньше его прошлый уровень говорит о новом
    near = _skill([("a", "b", 2000, 1.0), ("a", "c", 2001, 0.0)])
    far = _skill([("a", "b", 2000, 1.0), ("a", "c", 2006, 0.0)])
    assert near[("c", 2001)] > far[("c", 2006)]


def test_teammates_are_same_entrant_and_make():
    # У частника на той же марке («ecurie|ferrari») заводских пилотов в напарниках нет
    rows = []
    for race in range(1, 7):
        rows += [(race, 1958, "ferrari|ferrari", "a", 90.0, 1.0),
                 (race, 1958, "ferrari|ferrari", "b", 90.3, 3.0),
                 (race, 1958, "ecurie|ferrari", "x", 89.0, 2.0)]
    starts = pd.DataFrame(rows, columns=["raceId", "year", "team", "driverId", "best", "finish_pos"])
    skill = teammate_skill(starts).set_index("driverId")
    assert "x" not in skill.index
    assert skill.loc["a", "mate_quali"] > skill.loc["b", "mate_quali"]
    assert skill.loc["a", "mate_race"] > skill.loc["b", "mate_race"]
