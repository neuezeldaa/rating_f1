"""Погода на гонках: осадки в окне гонки из исторического архива Open-Meteo.

Open-Meteo (archive-api.open-meteo.com) — бесплатный реанализ погоды без ключа, по часам.
Время старта (UTC) и координаты трассы берутся из Jolpica; окно гонки — три часа от старта.
Если времени старта нет, берётся 14:00 по солнечному времени трассы.

Осадки — по ячейке сетки реанализа (около 9 км), поэтому дождь рядом с трассой может попасть
и в сухую гонку, а короткий ливень — потеряться; порог «мокрой» гонки подобран по гонкам,
про которые известно, шли ли они под дождём (features/weather.py).

Ответы кэшируются в data/raw/weather/races.json: прошлое не меняется, а гонки последних
10 дней перезапрашиваются — архив дописывается с задержкой в несколько дней.
"""
from __future__ import annotations

import json
import logging
import time
from datetime import date, datetime, timedelta

import pandas as pd
import requests

from ..config import RAW

ARCHIVE_URL = "https://archive-api.open-meteo.com/v1/archive"
CACHE = RAW / "weather" / "races.json"
WINDOW_HOURS = 3   # часы гонки, начиная с часа старта
BEFORE_HOURS = 3   # часы перед стартом: дождь до гонки — мокрая трасса на старте
FRESH_DAYS = 10
USER_AGENT = "rating-f1/0.1 (personal F1 driver rating project)"
log = logging.getLogger(__name__)


def utc_start(day: str, start: str | None, lon: float) -> datetime:
    """Старт гонки по UTC. Jolpica пишет местную дату и время по UTC, поэтому у ночных гонок
    (Лас-Вегас: суббота 22:00 по местному = воскресенье 06:00 UTC) дату надо сдвинуть."""
    base = datetime.fromisoformat(day)
    offset = lon / 15  # местное солнечное время ≈ UTC + долгота / 15
    if not start:
        return base + timedelta(hours=round(14 - offset))
    hh, mm = (int(x) for x in start.rstrip("Z").split(":")[:2])
    local = hh + mm / 60 + offset
    shift = 1 if local < 0 else -1 if local >= 24 else 0
    return base + timedelta(days=shift, hours=hh, minutes=mm)


def _fetch(session: requests.Session, lat: float, lon: float, start: datetime) -> list:
    """Осадки по часам (мм): BEFORE_HOURS часов до старта и WINDOW_HOURS часов гонки."""
    first = start.replace(minute=0, second=0) - timedelta(hours=BEFORE_HOURS)
    params = {"latitude": lat, "longitude": lon, "start_date": first.date().isoformat(),
              "end_date": (start + timedelta(hours=WINDOW_HOURS)).date().isoformat(),
              "hourly": "precipitation", "timezone": "UTC"}
    for attempt in range(5):
        resp = session.get(ARCHIVE_URL, params=params, timeout=30)
        if resp.status_code not in (429, 503):
            break
        time.sleep(2 ** attempt)
    resp.raise_for_status()
    hourly = resp.json().get("hourly", {})
    wanted = [(first + timedelta(hours=h)).strftime("%Y-%m-%dT%H:%M") for h in range(BEFORE_HOURS + WINDOW_HOURS)]
    by_time = dict(zip(hourly.get("time", []), hourly.get("precipitation", [])))
    return [by_time.get(t) for t in wanted]


def race_weather(races: pd.DataFrame, offline: bool = False) -> pd.DataFrame:
    """Осадки в окне каждой прошедшей гонки: season, round, precip_mm (сумма), precip_max (за час)."""
    cache = json.loads(CACHE.read_text(encoding="utf-8")) if CACHE.exists() else {}
    span = BEFORE_HOURS + WINDOW_HOURS
    cache = {k: v for k, v in cache.items() if len(v.get("hours", [])) == span}  # старый формат — заново
    done = races[races["completed"]]
    if "lat" not in done:
        log.warning("Погода: в таблице гонок нет координат — запустите пайплайн без --offline")
        return pd.DataFrame(columns=["season", "round", "precip_mm", "precip_max"])
    today = date.today()
    todo = [r for r in done.itertuples(index=False)
            if f"{r.season}-{r.round}" not in cache
            or (today - date.fromisoformat(r.date)).days <= FRESH_DAYS]
    if todo and not offline:
        session = requests.Session()
        session.headers["User-Agent"] = USER_AGENT
        fetched = 0
        try:
            for r in todo:
                hours = _fetch(session, r.lat, r.lon, utc_start(r.date, r.time, r.lon))
                if hours and all(h is not None for h in hours):
                    cache[f"{r.season}-{r.round}"] = {"hours": hours, "fetched": today.isoformat()}
                    fetched += 1
                time.sleep(0.2)
        except requests.RequestException as exc:
            log.warning("Погода: Open-Meteo не ответил (%s), беру сохранённое", exc)
        CACHE.parent.mkdir(parents=True, exist_ok=True)
        CACHE.write_text(json.dumps(cache, indent=1), encoding="utf-8")
        log.info("Погода: осадки скачаны для %s гонок из %s", fetched, len(todo))
    rows = []
    for r in done.itertuples(index=False):
        hours = cache.get(f"{r.season}-{r.round}", {}).get("hours")
        if hours:
            before, during = hours[:BEFORE_HOURS], hours[BEFORE_HOURS:]
            rows.append({"season": int(r.season), "round": int(r.round), "precip_before": float(sum(before)),
                         "precip_mm": float(sum(during)), "precip_max": float(max(during))})
    return pd.DataFrame(rows, columns=["season", "round", "precip_before", "precip_mm", "precip_max"])
