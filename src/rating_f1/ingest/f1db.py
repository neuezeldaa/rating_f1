"""F1DB — открытая база данных Формулы-1 (github.com/f1db/f1db, лицензия CC BY 4.0).

Даёт то, чего нет в Jolpica: настоящие причины сходов (с 2023 года Jolpica пишет
просто «Retired»), штрафы по времени, отыгранные позиции, «гонщика дня»,
рейтинг быстрых кругов гонки и итоговые таблицы чемпионатов.

CSV-релиз весит ~5 МБ и выходит после каждой гонки. Скачиваем его целиком в
data/raw/f1db/<версия>/ и читаем таблицы прямо из архива, ничего не распаковывая.
"""
from __future__ import annotations

import logging
import re
import zipfile
from pathlib import Path

import pandas as pd
import requests

from ..config import RAW

F1DB_DIR = RAW / "f1db"
LATEST_RELEASE = "https://api.github.com/repos/f1db/f1db/releases/latest"
ASSET = "f1db-csv.zip"

log = logging.getLogger(__name__)


def _version_key(path: Path) -> tuple:
    return tuple(int(x) for x in re.findall(r"\d+", path.parent.name))


def latest_release(offline: bool = False) -> Path:
    """Путь к архиву последнего релиза; при необходимости скачивает его."""
    if not offline:
        try:
            release = requests.get(LATEST_RELEASE, timeout=30,
                                   headers={"Accept": "application/vnd.github+json"}).json()
            asset = next(a for a in release["assets"] if a["name"] == ASSET)
            path = F1DB_DIR / release["tag_name"] / ASSET
            if not path.exists():
                log.info("F1DB: скачиваю релиз %s", release["tag_name"])
                resp = requests.get(asset["browser_download_url"], timeout=120)
                resp.raise_for_status()
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(resp.content)
            return path
        except (requests.RequestException, KeyError, StopIteration, ValueError) as exc:
            log.warning("F1DB: не удалось проверить новый релиз (%s), беру последний скачанный", exc)
    cached = sorted(F1DB_DIR.glob(f"*/{ASSET}"), key=_version_key)
    if not cached:
        raise RuntimeError("F1DB: нет скачанного релиза — запустите пайплайн без --offline")
    return cached[-1]


def read_table(archive: Path, name: str, first_season: int | None = None) -> pd.DataFrame:
    """Таблица F1DB по имени без префикса, например 'races-race-results'."""
    with zipfile.ZipFile(archive) as zf, zf.open(f"f1db-{name}.csv") as f:
        df = pd.read_csv(f, low_memory=False)
    if first_season is not None and "year" in df.columns:
        df = df[df["year"] >= first_season]
    return df.reset_index(drop=True)
