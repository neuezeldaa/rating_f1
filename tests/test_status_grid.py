"""Статусы сходов и место на старте."""
import numpy as np
import pandas as pd

from rating_f1.clean.enrich import fill_missing_grid
from rating_f1.clean.status import (DISQUALIFIED, DRIVER_ERROR, FINISHED, MECHANICAL, UNCLEAR, classify_status,
                                    did_not_start)
from rating_f1.features.laps import grid_position


def test_status_categories():
    assert classify_status("Finished") == FINISHED
    assert classify_status("+2 Laps") == FINISHED
    assert classify_status("Spun off") == DRIVER_ERROR
    assert classify_status("Accident") == DRIVER_ERROR
    assert classify_status("Collision") == UNCLEAR          # виновник по статусу неизвестен
    assert classify_status("Disqualified") == DISQUALIFIED
    assert classify_status("Gearbox") == MECHANICAL
    assert classify_status(None) == UNCLEAR


def test_did_not_start():
    assert did_not_start("Withdrew")
    assert did_not_start("Did not start")
    assert not did_not_start("Accident")
    assert not did_not_start(None)


def test_grid_position_pit_lane_and_missing():
    grid = pd.Series([1, 0, np.nan, 5])
    field = pd.Series([20, 20, 20, 20])
    out = grid_position(grid, field)
    assert out.iloc[0] == 1
    assert out.iloc[1] == 20          # старт с пит-лейна — последнее место
    assert np.isnan(out.iloc[2])      # решётки нет в данных — не последнее место, а пусто
    assert out.iloc[3] == 5


def test_fill_missing_grid_from_qualifying():
    results = pd.DataFrame({
        "season": [2026, 2026, 2026], "round": [20, 20, 20], "session": ["R", "R", "S"],
        "driver_id": ["norris", "russell", "norris"],
        "grid": pd.array([pd.NA, 0, pd.NA], dtype="Int64"),
    })
    qualifying = pd.DataFrame({"season": [2026, 2026], "round": [20, 20], "driver_id": ["norris", "russell"],
                               "position": pd.array([1, 2], dtype="Int64")})
    out = fill_missing_grid(results, qualifying)
    assert out.loc[0, "grid"] == 1            # свежая гонка без решётки — место в квалификации
    assert out.loc[1, "grid"] == 0            # настоящий старт с пит-лейна не трогаем
    assert pd.isna(out.loc[2, "grid"])        # спринт не трогаем
