"""Загрузка результатов из Jolpica API (преемник Ergast) с кэшем на диске.

Каждая страница ответа сохраняется как JSON в data/raw/jolpica/<сезон>/.
Прошедшие сезоны берутся из кэша, текущий сезон перекачивается при каждом запуске.
"""
from __future__ import annotations

import json
import logging
import time
from datetime import date

import requests

from ..config import JOLPICA_RAW

BASE_URL = "https://api.jolpi.ca/ergast/f1"
PAGE_LIMIT = 100  # больше Jolpica не отдаёт за один запрос

log = logging.getLogger(__name__)


class JolpicaClient:
    """Простой клиент: пауза между запросами, повторы при 429/5xx, кэш страниц."""

    def __init__(self, pause: float = 1.0, max_retries: int = 8):
        self.pause = pause
        self.max_retries = max_retries
        self.http = requests.Session()
        self.http.headers["User-Agent"] = "rating-f1/0.1 (pet project)"
        self._last_request = 0.0

    def _get(self, url: str, params: dict) -> dict:
        for attempt in range(self.max_retries):
            wait = self.pause - (time.monotonic() - self._last_request)
            if wait > 0:
                time.sleep(wait)
            self._last_request = time.monotonic()
            try:
                resp = self.http.get(url, params=params, timeout=30)
            except requests.RequestException as exc:
                delay = 2 ** attempt
                log.warning("Jolpica: ошибка сети (%s), повтор через %s с", exc, delay)
                time.sleep(delay)
                continue
            if resp.status_code == 429 or resp.status_code >= 500:
                retry_after = resp.headers.get("Retry-After", "")
                delay = float(retry_after) if retry_after.isdigit() else 2 ** (attempt + 1)
                log.warning("Jolpica: ответ %s, повтор через %s с", resp.status_code, delay)
                time.sleep(delay)
                continue
            resp.raise_for_status()
            return resp.json()
        raise RuntimeError(f"Jolpica: не удалось получить {url} {params}")

    def fetch_pages(self, season: int, endpoint: str, refresh: bool = False) -> list[dict]:
        """Все страницы эндпоинта (races, results, qualifying, sprint) за сезон."""
        refresh = refresh or season >= date.today().year
        folder = JOLPICA_RAW / str(season)
        folder.mkdir(parents=True, exist_ok=True)
        pages, offset = [], 0
        while True:
            path = folder / f"{endpoint}_{offset:04d}.json"
            if path.exists() and not refresh:
                data = json.loads(path.read_text(encoding="utf-8"))
            else:
                url = f"{BASE_URL}/{season}/{endpoint}/"
                data = self._get(url, {"limit": PAGE_LIMIT, "offset": offset})
                path.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
            pages.append(data)
            offset += PAGE_LIMIT
            if offset >= int(data["MRData"]["total"]):
                return pages

    def driver_seasons(self, driver_id: str) -> list[int]:
        """Все сезоны пилота в F1 — нужны для года дебюта. Кэшируется навсегда."""
        folder = JOLPICA_RAW / "drivers"
        folder.mkdir(parents=True, exist_ok=True)
        path = folder / f"{driver_id}_seasons.json"
        if path.exists():
            data = json.loads(path.read_text(encoding="utf-8"))
        else:
            data = self._get(f"{BASE_URL}/drivers/{driver_id}/seasons/", {"limit": PAGE_LIMIT})
            path.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
        return sorted(int(s["season"]) for s in data["MRData"]["SeasonTable"]["Seasons"])
