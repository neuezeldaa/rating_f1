"""Рейтинг по ходу сезона: разница с напарником по этапам 1…k и упаковка для страницы."""
import base64

import numpy as np
import pandas as pd

from rating_f1.by_round import MISSING, _team_split, encode, mate_deltas


def _pairs(rows):
    return pd.DataFrame(rows, columns=["season", "round", "constructor_id", "driver_a", "driver_b", "y", "w"])


def test_split_sign_and_shrinkage():
    rows = [(2020, r, "red", "a", "b", 0.5, 1.0) for r in range(1, 11)]
    full = _team_split(_pairs(rows), ["a", "b"], "gaussian", tau=0.4, sigma=0.5)
    one = _team_split(_pairs(rows[:1]), ["a", "b"], "gaussian", tau=0.4, sigma=0.5)
    assert full[0] > 0 > full[1]
    assert 0 < one[0] < full[0]          # после одной гонки доверия меньше — ближе к нулю
    race = _team_split(_pairs([(2020, r, "red", "a", "b", 1.0, 1.0) for r in range(1, 9)]),
                       ["a", "b"], "logistic", tau=0.5, sigma=None)
    assert race[0] > 0 > race[1]


def test_deltas_end_at_zero():
    # «a» выигрывал первую половину сезона, «b» — вторую: после 5-го этапа «a» был выше, чем в итоге
    rows = [(2020, r, "red", "a", "b", 0.5 if r <= 5 else -0.5, 1.0) for r in range(1, 11)]
    inputs = {"models": [{"name": "quali", "kind": "gaussian", "tau": 0.4, "sigma": 0.5, "pairs": _pairs(rows)}],
              "team_starts": {(2020, "red"): {"a": 10, "b": 10}}, "keys": {("a", 2020), ("b", 2020)}}
    delta = mate_deltas(inputs, 2020, list(range(1, 11)))["quali"]
    assert abs(delta.loc["a", 10]) < 1e-12 and abs(delta.loc["b", 10]) < 1e-12
    assert delta.loc["a", 5] > 0 > delta.loc["b", 5]


def test_encode_marks_missing():
    z = np.array([[[0.5, np.nan]]])
    out = encode({"2020": {"rounds": [1, 2], "ids": ["a"], "groups": ["results"], "z": z}})
    packed = np.frombuffer(base64.b64decode(out["2020"]["z"]), dtype="<i2")
    assert packed.tolist() == [500, MISSING]
