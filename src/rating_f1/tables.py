"""Сборка таблиц из ответов Jolpica: Parquet-файлы и база DuckDB."""
from __future__ import annotations

import logging

import duckdb
import numpy as np
import pandas as pd

from .config import DUCKDB_PATH, FIRST_SEASON, PROCESSED
from .ingest import f1db, racedata
from .ingest.jolpica import JolpicaClient

log = logging.getLogger(__name__)

BASE_TABLES = ("races", "drivers", "constructors", "results", "qualifying",
               "f1db_results", "fastest_laps", "standings", "race_info", "laps", "pit_stops")
DRIVER_COLS = ["driver_id", "code", "given_name", "family_name", "nationality", "dob", "permanent_number", "wiki_url"]
CONSTRUCTOR_COLS = ["constructor_id", "constructor_name", "constructor_nationality"]
INT_COLS = ["number", "position", "grid", "laps", "time_ms", "permanent_number", "debut_season"]


def _int(value):
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _float(value):
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def parse_lap_time(text) -> float:
    """'1:29.708' или '53.377' → секунды; пусто или мусор → NaN."""
    if not isinstance(text, str) or not text.strip():
        return np.nan
    text = text.strip()
    try:
        if ":" in text:
            minutes, seconds = text.split(":", 1)
            return int(minutes) * 60 + float(seconds)
        return float(text)
    except ValueError:
        return np.nan


def _races(pages):
    for page in pages:
        for race in page["MRData"]["RaceTable"]["Races"]:
            circuit = race.get("Circuit", {})
            location = circuit.get("Location", {})
            yield {
                "season": int(race["season"]),
                "round": int(race["round"]),
                "race_name": race.get("raceName"),
                "circuit_id": circuit.get("circuitId"),
                "circuit_name": circuit.get("circuitName"),
                "locality": location.get("locality"),
                "country": location.get("country"),
                "lat": _float(location.get("lat")),
                "lon": _float(location.get("long")),
                "date": race.get("date"),
                "time": race.get("time"),  # старт гонки по UTC, «15:00:00Z» — для погоды
                "has_sprint": "Sprint" in race,
            }


def _entry(race: dict, item: dict) -> dict:
    driver = item.get("Driver", {})
    constructor = item.get("Constructor", {})
    return {
        "season": int(race["season"]),
        "round": int(race["round"]),
        "driver_id": driver.get("driverId"),
        "code": driver.get("code"),
        "given_name": driver.get("givenName"),
        "family_name": driver.get("familyName"),
        "nationality": driver.get("nationality"),
        "dob": driver.get("dateOfBirth"),
        "permanent_number": _int(driver.get("permanentNumber")),
        "wiki_url": driver.get("url"),  # статья в английской Википедии — для краткой биографии
        "constructor_id": constructor.get("constructorId"),
        "constructor_name": constructor.get("name"),
        "constructor_nationality": constructor.get("nationality"),
        "number": _int(item.get("number")),
        "position": _int(item.get("position")),
    }


def _results(pages, session: str):
    key = "Results" if session == "R" else "SprintResults"
    for page in pages:
        for race in page["MRData"]["RaceTable"]["Races"]:
            for item in race.get(key, []):
                row = _entry(race, item)
                row.update(
                    session=session,
                    position_text=item.get("positionText"),
                    points=_float(item.get("points")),
                    grid=_int(item.get("grid")),
                    laps=_int(item.get("laps")),
                    status=item.get("status"),
                    time_ms=_int((item.get("Time") or {}).get("millis")),
                )
                yield row


def _qualifying(pages):
    for page in pages:
        for race in page["MRData"]["RaceTable"]["Races"]:
            for item in race.get("QualifyingResults", []):
                row = _entry(race, item)
                for segment in ("Q1", "Q2", "Q3"):
                    row[segment.lower()] = item.get(segment)
                yield row


def build_f1db_tables(results: pd.DataFrame, offline: bool = False) -> dict[str, pd.DataFrame]:
    """Таблицы из F1DB с идентификаторами пилотов Jolpica.

    Пилотов сопоставляем по (сезон, этап, номер машины) — номер на конкретной гонке
    одинаков в обеих базах.
    """
    archive = f1db.latest_release(offline)
    log.info("F1DB: релиз %s", archive.parent.name)
    race = f1db.read_table(archive, "races-race-results", FIRST_SEASON).assign(session="R")
    sprint = f1db.read_table(archive, "races-sprint-race-results", FIRST_SEASON).assign(session="S")
    rows = pd.concat([race, sprint], ignore_index=True)

    numbers = results[["season", "round", "session", "number", "driver_id"]].dropna(subset=["number"])
    numbers = numbers.astype({"number": int})
    joined = rows.merge(numbers, left_on=["year", "round", "session", "driverNumber"],
                        right_on=["season", "round", "session", "number"], how="inner")
    id_map = joined.groupby("driverId")["driver_id"].agg(lambda s: s.mode().iat[0]).to_dict()
    log.info("F1DB: сопоставлено %s пилотов, строк результатов %s из %s", len(id_map), len(joined), len(rows))

    f1db_results = pd.DataFrame({
        "season": joined["year"].astype(int),
        "round": joined["round"].astype(int),
        "session": joined["session"],
        "driver_id": joined["driver_id"],
        "f1db_position_text": joined["positionText"].astype(str),
        "reason_retired": joined["reasonRetired"],
        "time_penalty_s": joined["timePenaltyMillis"] / 1000,
        "positions_gained": joined["positionsGained"],
        "pit_stops": joined["pitStops"],
        "fastest_lap": joined["fastestLap"].astype("boolean").fillna(False).astype(bool),
        "driver_of_the_day": joined["driverOfTheDay"].astype("boolean").fillna(False).astype(bool),
        "grand_slam": joined["grandSlam"].astype("boolean").fillna(False).astype(bool),
    })

    laps = f1db.read_table(archive, "races-fastest-laps", FIRST_SEASON)
    fastest_laps = pd.DataFrame({
        "season": laps["year"].astype(int),
        "round": laps["round"].astype(int),
        "driver_id": laps["driverId"].map(id_map),
        "fl_rank": laps["positionNumber"],
        "fl_time_ms": laps["timeMillis"],
        "fl_lap": laps["lap"],
    }).dropna(subset=["driver_id"])

    table = f1db.read_table(archive, "seasons-driver-standings", FIRST_SEASON)
    standings = pd.DataFrame({
        "season": table["year"].astype(int),
        "driver_id": table["driverId"].map(id_map),
        "position": table["positionNumber"],
        "points": table["points"],
        "champion": table["championshipWon"].fillna(False).astype(bool),
    }).dropna(subset=["driver_id"])

    # Трасса каждой гонки: тип (STREET — уличная, RACE — автодром, ROAD — дорожная) и длина круга.
    races = f1db.read_table(archive, "races", FIRST_SEASON)
    race_info = pd.DataFrame({
        "season": races["year"].astype(int),
        "round": races["round"].astype(int),
        "circuit": races["circuitId"],
        "circuit_type": races["circuitType"],
        "course_km": races["courseLength"].astype(float),
    })
    return {"f1db_results": f1db_results, "fastest_laps": fastest_laps, "standings": standings,
            "race_info": race_info}


def build_tables(seasons, refresh: bool = False) -> dict[str, pd.DataFrame]:
    """Скачать (или взять из кэша) сезоны и собрать базовые таблицы."""
    client = JolpicaClient()
    races, results, quali = [], [], []
    for season in seasons:
        log.info("Jolpica: сезон %s", season)
        races.extend(_races(client.fetch_pages(season, "races", refresh)))
        results.extend(_results(client.fetch_pages(season, "results", refresh), "R"))
        results.extend(_results(client.fetch_pages(season, "sprint", refresh), "S"))
        quali.extend(_qualifying(client.fetch_pages(season, "qualifying", refresh)))

    results_df = pd.DataFrame(results)
    quali_df = pd.DataFrame(quali)
    for segment in ("q1", "q2", "q3"):
        quali_df[f"{segment}_s"] = quali_df[segment].map(parse_lap_time)

    entries = pd.concat([results_df, quali_df], ignore_index=True).sort_values(["season", "round"])
    drivers = entries[DRIVER_COLS].drop_duplicates("driver_id", keep="last").sort_values("driver_id")
    log.info("Jolpica: годы дебюта %s пилотов", len(drivers))
    drivers["debut_season"] = [min(client.driver_seasons(d)) for d in drivers["driver_id"]]
    constructors = (
        entries[CONSTRUCTOR_COLS].drop_duplicates("constructor_id", keep="last").sort_values("constructor_id")
    )

    races_df = pd.DataFrame(races)
    finished = results_df.loc[results_df["session"] == "R", ["season", "round"]].drop_duplicates()
    races_df = races_df.merge(finished.assign(completed=True), on=["season", "round"], how="left")
    races_df["completed"] = races_df["completed"].astype("boolean").fillna(False).astype(bool)

    detail_cols = DRIVER_COLS[1:] + CONSTRUCTOR_COLS[1:]
    tables = {
        "races": races_df,
        "drivers": drivers.reset_index(drop=True),
        "constructors": constructors.reset_index(drop=True),
        "results": results_df.drop(columns=detail_cols),
        "qualifying": quali_df.drop(columns=detail_cols),
    }
    for df in tables.values():
        for col in INT_COLS:
            if col in df.columns:
                df[col] = df[col].astype("Int64")
    tables.update(build_f1db_tables(tables["results"]))
    tables.update(racedata.read_laps(racedata.latest_archive(), FIRST_SEASON))
    log.info("RaceData: %s кругов, %s пит-стопов", len(tables["laps"]), len(tables["pit_stops"]))
    save_tables(tables)
    return tables


def save_tables(tables: dict[str, pd.DataFrame]) -> None:
    """Сохранить таблицы в Parquet и продублировать в DuckDB."""
    PROCESSED.mkdir(parents=True, exist_ok=True)
    for name, df in tables.items():
        df.to_parquet(PROCESSED / f"{name}.parquet", index=False)
    con = duckdb.connect(str(DUCKDB_PATH))
    try:
        for name, df in tables.items():
            con.register("_frame", df)
            con.execute(f'CREATE OR REPLACE TABLE "{name}" AS SELECT * FROM _frame')
            con.unregister("_frame")
    finally:
        con.close()


def load_tables(names=BASE_TABLES) -> dict[str, pd.DataFrame]:
    """Прочитать ранее собранные таблицы из data/processed."""
    return {name: pd.read_parquet(PROCESSED / f"{name}.parquet") for name in names}
