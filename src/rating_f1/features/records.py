"""Рекорды Формулы-1: кто и сколько лет их держал — признак группы «Карьера».

Семь рекордов по всей истории с 1950 года (F1DB, без Индианаполиса-500): победы, поулы, подиумы,
быстрые круги и титулы за карьеру, победы за один сезон, победы подряд. После каждой гонки
владелец рекорда — пилот с наибольшим значением; повторивший рекорд становится совладельцем,
время между гонками совладельцы делят поровну.

Очки пилота за один рекорд = √(лет удержания + BREAK_SHARE · возраст побитого рекорда), очки
рекордов — сумма по рекордам. Корень — чтобы один очень долгий рекорд (девять побед подряд
у Аскари простояли 60 лет) не перевешивал несколько рекордов сразу. Возраст побитого рекорда —
сколько лет прежние владельцы держали его без перерыва к моменту, когда пилот превзошёл их
(повторить мало): Хэмилтон побил рекорд побед, который Шумахер держал 19 лет.
"""
from __future__ import annotations

from collections import defaultdict

import numpy as np
import pandas as pd

RECORDS = ["wins", "poles", "podiums", "fastest_laps", "titles", "season_wins", "win_streak"]
BREAK_SHARE = 0.25   # год возраста побитого рекорда — как четверть года удержания
YEAR_DAYS = 365.25


def _indy(races: pd.DataFrame) -> set:
    return set(races.loc[(races["circuitId"] == "indianapolis") & (races["year"] <= 1960), "id"])


def record_log(races: pd.DataFrame, results: pd.DataFrame, standings: pd.DataFrame) -> tuple[dict, dict]:
    """→ (held, broke): {рекорд: {пилот: лет удержания}} и {рекорд: {пилот: возраст побитых рекордов}}.

    races, results, standings — таблицы F1DB races, races-race-results, seasons-driver-standings.
    Незавершённый сезон титула не даёт: чемпион известен только после последней гонки.
    """
    races = races[~races["id"].isin(_indy(races))].assign(date=lambda d: pd.to_datetime(d["date"])).sort_values("date")
    by_race = dict(tuple(results[results["raceId"].isin(set(races["id"]))].groupby("raceId")))
    champs = standings[standings["championshipWon"].eq(True)].set_index("year")["driverId"].to_dict()
    last_race = races.groupby("year")["id"].last().to_dict()

    total = {r: defaultdict(float) for r in RECORDS}
    season_wins, streak = defaultdict(float), defaultdict(int)
    held = {r: defaultdict(float) for r in RECORDS}
    broke = {r: defaultdict(float) for r in RECORDS}
    since = {r: {} for r in RECORDS}      # владелец → с какой даты держит рекорд
    value = {r: 0.0 for r in RECORDS}
    prev_date, year = None, None
    for race in races.itertuples(index=False):
        if prev_date is not None:
            dt = (race.date - prev_date).days / YEAR_DAYS
            for r in RECORDS:
                for d in since[r]:
                    held[r][d] += dt / len(since[r])
        if race.year != year:
            season_wins.clear()
            year = race.year
        df = by_race.get(race.id)
        if df is not None:
            winners = set(df.loc[df["positionNumber"] == 1, "driverId"])
            for d in winners:
                total["wins"][d] += 1
                season_wins[d] += 1
                streak[d] += 1
                total["season_wins"][d] = max(total["season_wins"][d], season_wins[d])
                total["win_streak"][d] = max(total["win_streak"][d], streak[d])
            for d in set(df["driverId"]) - winners:   # стартовал и не выиграл — серия прервана
                streak[d] = 0
            for d in set(df.loc[df["positionNumber"] <= 3, "driverId"]):
                total["podiums"][d] += 1
            for d in set(df.loc[df["polePosition"].eq(True), "driverId"]):
                total["poles"][d] += 1
            for d in set(df.loc[df["fastestLap"].eq(True), "driverId"]):
                total["fastest_laps"][d] += 1
        if last_race.get(race.year) == race.id and race.year in champs:
            total["titles"][champs[race.year]] += 1
        for r in RECORDS:
            if not total[r]:
                continue
            best = max(total[r].values())
            holders = {d for d, v in total[r].items() if v == best}
            dropped = set(since[r]) - holders
            if dropped and best > value[r]:
                # рекорд превзойдён: новому владельцу — возраст рекорда тех, кого он обошёл
                age = max((race.date - since[r][d]).days for d in dropped) / YEAR_DAYS
                for d in holders:
                    broke[r][d] += age
            since[r] = {d: since[r].get(d, race.date) for d in holders}
            value[r] = best
        prev_date = race.date
    return held, broke


def record_scores(races: pd.DataFrame, results: pd.DataFrame, standings: pd.DataFrame) -> pd.Series:
    """Очки рекордов по пилотам F1DB (у кого рекордов не было — в ряду нет)."""
    held, broke = record_log(races, results, standings)
    drivers = sorted({d for r in RECORDS for d in held[r]} | {d for r in RECORDS for d in broke[r]})
    score = {d: sum(np.sqrt(held[r].get(d, 0.0) + BREAK_SHARE * broke[r].get(d, 0.0)) for r in RECORDS) for d in drivers}
    return pd.Series(score, dtype=float).round(2)
