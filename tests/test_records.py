"""Рекорды: годы удержания, совладельцы, бонус за побитие."""
import pandas as pd

from rating_f1.features.records import record_log, record_scores


def _data():
    # «a» выигрывает в 2000-м и держит рекорд побед; «b» повторяет его в 2010-м и бьёт в 2011-м
    races = pd.DataFrame({"id": [1, 2, 3, 4], "year": [2000, 2010, 2011, 2012], "circuitId": ["x"] * 4,
                          "date": ["2000-01-01", "2010-01-01", "2011-01-01", "2012-01-01"]})
    rows = [(1, "a", 1), (1, "b", 2), (2, "b", 1), (2, "a", 2), (3, "b", 1), (3, "a", 2), (4, "c", 1), (4, "b", 2)]
    results = pd.DataFrame(rows, columns=["raceId", "driverId", "positionNumber"]).assign(polePosition=False, fastestLap=False)
    standings = pd.DataFrame({"year": [2000], "driverId": ["a"], "championshipWon": [True]})
    return races, results, standings


def test_holding_sharing_and_breaking():
    held, broke = record_log(*_data())
    assert round(held["wins"]["a"], 1) == 10.5      # 10 лет один и год пополам с «b»
    assert round(held["wins"]["b"], 1) == 1.5       # полгода как совладелец и год один
    assert round(broke["wins"]["b"]) == 11          # побил рекорд, который «a» держал 11 лет
    assert "a" not in broke["wins"] and "c" not in held["wins"]


def test_scores_reward_breadth_over_one_long_record():
    scores = record_scores(*_data())
    assert scores["a"] > scores["b"] > 0            # у «a» ещё и титул, подиумы, серия
    assert "c" not in scores or scores["c"] < scores["b"]
