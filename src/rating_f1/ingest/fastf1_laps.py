"""Загрузка кругов через FastF1 — задел для этапа «темп в гонке». Без телеметрии, с кэшем.

Важно: с версии 3.9 FastF1 получает хронометраж только через аккаунт Formula 1
с активной подпиской F1 TV. Логин и пароль берутся из переменных окружения
F1_USERNAME и F1_PASSWORD; без них данные по кругам не загрузятся ни за один сезон.

Каждая сессия сохраняется в data/processed/laps/<сезон>_<этап>_<сессия>.parquet.
Уже скачанные сессии пропускаются, поэтому загрузку можно прерывать и продолжать.

    python -m rating_f1.ingest.fastf1_laps --season 2026 --round 19 --session R   # одна сессия
    python -m rating_f1.ingest.fastf1_laps --seasons 2018-2026                     # всё: часы и гигабайты кэша
"""
from __future__ import annotations

import argparse
import logging
import time

import pandas as pd

from ..config import FASTF1_CACHE, LAPS_DIR, PROCESSED

log = logging.getLogger(__name__)

LAP_COLUMNS = [
    "Driver", "DriverNumber", "Team", "LapNumber", "Stint", "LapTime", "Sector1Time", "Sector2Time",
    "Sector3Time", "Compound", "TyreLife", "FreshTyre", "TrackStatus", "IsAccurate", "Deleted",
    "DeletedReason", "PitInTime", "PitOutTime", "Position", "Time", "LapStartTime", "IsPersonalBest",
]


def _fastf1():
    import fastf1  # импорт здесь: модуль тяжёлый и нужен только для этой загрузки

    FASTF1_CACHE.mkdir(parents=True, exist_ok=True)
    fastf1.Cache.enable_cache(str(FASTF1_CACHE))
    fastf1.set_log_level("WARNING")
    return fastf1


def weekend_sessions(season: int, has_sprint: bool) -> list[str]:
    """Сессии, которые нужны рейтингу: квалификации, спринт и гонка."""
    sessions = ["Q", "R"]
    if has_sprint:
        sessions.append("S")
        if season == 2023:
            sessions.append("SS")  # Sprint Shootout
        elif season >= 2024:
            sessions.append("SQ")  # Sprint Qualifying
    return sessions


def load_session_laps(season: int, rnd: int, session: str, retries: int = 3) -> pd.DataFrame | None:
    path = LAPS_DIR / f"{season}_{rnd:02d}_{session}.parquet"
    if path.exists():
        return pd.read_parquet(path)
    fastf1 = _fastf1()
    from fastf1.exceptions import DataNotLoadedError

    for attempt in range(retries):
        try:
            event_session = fastf1.get_session(season, rnd, session)
            event_session.load(laps=True, telemetry=False, weather=False, messages=False)
            laps = event_session.laps
            break
        except ValueError as exc:  # такой сессии на этом этапе нет
            log.info("FastF1: %s/%s %s — сессии нет (%s)", season, rnd, session, exc)
            return None
        except DataNotLoadedError:
            log.error("FastF1: хронометраж %s/%s %s не загрузился. Нужен аккаунт Formula 1 с подпиской F1 TV "
                      "в переменных окружения F1_USERNAME и F1_PASSWORD.", season, rnd, session)
            return None
        except Exception as exc:  # noqa: BLE001 — лимит запросов FastF1 ждём и повторяем
            if "RateLimit" not in type(exc).__name__:
                raise
            delay = 60 * (attempt + 1)
            log.warning("FastF1: лимит запросов, пауза %s с", delay)
            time.sleep(delay)
    else:
        return None

    df = pd.DataFrame(laps[[c for c in LAP_COLUMNS if c in laps.columns]]).copy()
    for col in df.columns:
        if pd.api.types.is_timedelta64_dtype(df[col]):
            df[col] = df[col].dt.total_seconds()
    df.insert(0, "session", session)
    df.insert(0, "round", rnd)
    df.insert(0, "season", season)
    LAPS_DIR.mkdir(parents=True, exist_ok=True)
    df.to_parquet(path, index=False)
    return df


def load_seasons(first: int, last: int) -> None:
    """Все прошедшие этапы сезонов из таблицы races (нужен предварительный запуск пайплайна)."""
    races = pd.read_parquet(PROCESSED / "races.parquet")
    races = races[races["completed"] & races["season"].between(first, last)]
    for rec in races.sort_values(["season", "round"]).to_dict("records"):
        for session in weekend_sessions(int(rec["season"]), bool(rec["has_sprint"])):
            laps = load_session_laps(int(rec["season"]), int(rec["round"]), session)
            log.info("FastF1: %s/%02d %-2s — %s кругов", rec["season"], rec["round"], session,
                     0 if laps is None else len(laps))


def main(argv=None) -> None:
    parser = argparse.ArgumentParser(description="Загрузка кругов через FastF1")
    parser.add_argument("--seasons", help="диапазон сезонов, например 2018-2026")
    parser.add_argument("--season", type=int)
    parser.add_argument("--round", type=int)
    parser.add_argument("--session", default="R", help="Q, R, S, SQ, SS")
    args = parser.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    if args.seasons:
        first, last = (int(x) for x in args.seasons.split("-"))
        load_seasons(first, last)
    elif args.season and args.round:
        laps = load_session_laps(args.season, args.round, args.session)
        if laps is None:
            log.info("Нет данных")
        else:
            log.info("%s кругов, пилотов: %s, составы шин: %s", len(laps), laps["Driver"].nunique(),
                     sorted(laps["Compound"].dropna().unique()))
    else:
        parser.error("укажите --seasons или --season и --round")


if __name__ == "__main__":
    main()
