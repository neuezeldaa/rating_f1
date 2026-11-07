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
