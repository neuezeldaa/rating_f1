"""Уточнение результатов Jolpica данными F1DB."""
from __future__ import annotations

import pandas as pd


def enrich_results(results: pd.DataFrame, f1db_results: pd.DataFrame) -> pd.DataFrame:
    """Добавить поля F1DB и столбец status_detail.

    status_detail — причина схода из F1DB, если она есть (с 2023 года Jolpica пишет
    у всех сходов просто «Retired»), иначе статус Jolpica. Дисквалификации помечаются
    отдельно по коду позиции.
    """
    out = results.merge(f1db_results, on=["season", "round", "session", "driver_id"], how="left")
    detail = out["reason_retired"].where(out["reason_retired"].notna(), out["status"])
    disqualified = out["position_text"].isin(["D", "E"]) | (out["f1db_position_text"] == "DSQ")
    out["status_detail"] = detail.where(~disqualified, "Disqualified")
    return out


def fill_missing_grid(results: pd.DataFrame, qualifying: pd.DataFrame) -> pd.DataFrame:
    """Решётка свежей гонки: Jolpica выкладывает результаты раньше, чем места на старте, —
    пока их нет, берём место в квалификации. Пустая решётка — не старт с пит-лейна (там grid = 0).
    """
    places = qualifying.set_index(["season", "round", "driver_id"])["position"]
    keys = list(zip(results["season"], results["round"], results["driver_id"]))
    from_quali = pd.Series(places.reindex(keys).to_numpy(), index=results.index)
    missing = results["grid"].isna() & (results["session"] == "R")
    out = results.copy()
    out.loc[missing, "grid"] = from_quali[missing]
    return out
