"""Проверка прогнозом всего рейтинга: новые пары напарников и баллы прошлого сезона."""
import pandas as pd

from rating_f1.validate import predictive


def test_new_pair_predicted_by_previous_season():
    prev = pd.DataFrame({"eligible": [True, True, True], "overall_z": [1.0, 0.0, -1.0], "g_quali": [-1.0, 0.0, 1.0]},
                        index=["a", "b", "c"])
    rows = []
    for rnd in range(1, 7):
        # 2001: новая пара a и c в одной команде; a всегда впереди в квалификации и на финише
        rows += [(2001, rnd, "x", "a", 1, 1, "finished"), (2001, rnd, "x", "c", 2, 2, "finished")]
    records = pd.DataFrame(rows, columns=["season", "round", "constructor_id", "driver_id", "quali_pos",
                                          "finish_pos", "category"])
    out = predictive({"2000": prev}, records)
    assert out["pairs"] == 1
    assert out["quali"]["overall"] == 1.0 and out["race"]["overall"] == 1.0   # итог угадал
    assert out["quali"]["quali"] == 0.0                                        # группа «квала» — нет
