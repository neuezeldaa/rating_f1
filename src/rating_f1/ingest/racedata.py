"""Покруговые данные из архива TracingInsights/RaceData (github.com/TracingInsights/RaceData).

Это набор в формате Ergast, который собирается из Jolpica и обновляется после каждой гонки:
позиция и время каждого пилота на каждом круге (с 1996 года) и пит-стопы (с 2011 года).
Архив весит ~10 МБ; качаем его целиком в data/raw/racedata/ и читаем таблицы прямо из zip.
Идентификаторы пилотов (driverRef) совпадают с Jolpica.
"""
from __future__ import annotations

import logging
import time
import zipfile
from pathlib import Path

import pandas as pd
import requests

from ..config import RAW

ARCHIVE_URL = "https://raw.githubusercontent.com/TracingInsights/RaceData/main/data.zip"
ARCHIVE = RAW / "racedata" / "data.zip"
MAX_AGE_S = 12 * 3600  # архив обновляется после гонок — перекачиваем, если он старше 12 часов

log = logging.getLogger(__name__)


def latest_archive(offline: bool = False) -> Path:
    fresh = ARCHIVE.exists() and time.time() - ARCHIVE.stat().st_mtime < MAX_AGE_S
    if not offline and not fresh:
        try:
            resp = requests.get(ARCHIVE_URL, timeout=180)
            resp.raise_for_status()
            ARCHIVE.parent.mkdir(parents=True, exist_ok=True)
            ARCHIVE.write_bytes(resp.content)
            log.info("RaceData: архив обновлён (%.1f МБ)", len(resp.content) / 1e6)
        except requests.RequestException as exc:
            log.warning("RaceData: не удалось скачать архив (%s), беру сохранённый", exc)
    if not ARCHIVE.exists():
        raise RuntimeError("RaceData: архива нет — запустите пайплайн без --offline")
    return ARCHIVE


def _read(zf: zipfile.ZipFile, name: str) -> pd.DataFrame:
    member = next(n for n in zf.namelist() if n.endswith(name))
    with zf.open(member) as f:
        return pd.read_csv(f, low_memory=False)


def read_laps(archive: Path, first_season: int) -> dict[str, pd.DataFrame]:
    """Таблицы кругов и пит-стопов с сезоном, этапом и id пилота как в Jolpica."""
    with zipfile.ZipFile(archive) as zf:
        races = _read(zf, "races.csv")[["raceId", "year", "round"]]
        drivers = _read(zf, "drivers.csv")[["driverId", "driverRef"]]
        laps = _read(zf, "lap_times.csv")
        pits = _read(zf, "pit_stops.csv")
    keys = races[races["year"] >= first_season]

    def attach(df: pd.DataFrame) -> pd.DataFrame:
        df = df.merge(keys, on="raceId").merge(drivers, on="driverId")
        return df.rename(columns={"year": "season", "driverRef": "driver_id"})

    laps = attach(laps)[["season", "round", "driver_id", "lap", "position", "milliseconds"]]
    laps = laps.rename(columns={"milliseconds": "lap_ms"})
    pits = attach(pits)[["season", "round", "driver_id", "stop", "lap", "milliseconds"]]
    pits = pits.rename(columns={"milliseconds": "pit_ms"})
    return {"laps": laps.reset_index(drop=True), "pit_stops": pits.reset_index(drop=True)}
