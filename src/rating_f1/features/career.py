"""Карьера целиком, с дебюта в F1 — для группы «Карьера» общего рейтинга.

Подробные оценки сезона у нас есть с первого сезона периода (config.FIRST_SEASON), а часть
карьер началась раньше: Шумахер — в 1991 году, Баррикелло — в 1993-м. Поэтому долговечность
и титулы считаются по всей карьере — из F1DB, где есть вся история с 1950 года (те же факты,
что в Википедии, только таблицами):

- сезонов в F1 — неполный сезон идёт долей гонок, в которых пилот стартовал;
- титулы;
- сезонов впереди напарника в итоговой таблице чемпионата. Напарник — тот, у кого больше
  всего стартов за ту же команду; сезон идёт в счёт, если оба провели за неё хотя бы треть
  гонок. От машины это не зависит: напарник ездил на такой же.
"""
from __future__ import annotations

import pandas as pd

from .records import record_scores

NOT_STARTED = {"DNQ", "DNPQ", "DNS", "DNP"}  # не прошёл квалификацию или не вышел на старт
MAIN_TEAM_SHARE = 1 / 3  # столько гонок сезона нужно провести за команду, чтобы сравнивать с напарником


def career_facts(results: pd.DataFrame, standings: pd.DataFrame, calendar: pd.DataFrame | None = None) -> pd.DataFrame:
    """По пилоту F1DB: debut, seasons, titles, title_years («2005 2006»), ahead, compared, records.

    results — F1DB races-race-results за все годы, standings — F1DB seasons-driver-standings,
    calendar — F1DB races (даты гонок): с ней считаются очки рекордов (features/records.py).
    """
    started = results[~results["positionText"].astype(str).isin(NOT_STARTED)]
    races = results.groupby("year")["raceId"].nunique()
    per_year = started.groupby(["driverId", "year"]).size().rename("starts").reset_index()
    per_year["share"] = (per_year["starts"] / per_year["year"].map(races)).clip(upper=1.0)
    out = pd.DataFrame({
        "debut": per_year.groupby("driverId")["year"].min(),
        "seasons": per_year.groupby("driverId")["share"].sum().round(2),
    })
    won = standings[standings["championshipWon"].fillna(False).astype(bool)]
    out["titles"] = won.groupby("driverId").size().reindex(out.index).fillna(0).astype(int)
    years = won.groupby("driverId")["year"].apply(lambda y: " ".join(str(int(v)) for v in sorted(y)))
    out["title_years"] = years.reindex(out.index).fillna("")
    mates = _ahead_of_teammate(started, races, standings)
    out["ahead"] = mates["ahead"].reindex(out.index).fillna(0).astype(int)
    out["compared"] = mates["compared"].reindex(out.index).fillna(0).astype(int)
    if calendar is not None:
        out["records"] = record_scores(calendar, results, standings).reindex(out.index).fillna(0.0)
    return out


def _ahead_of_teammate(started: pd.DataFrame, races: pd.Series, standings: pd.DataFrame) -> pd.DataFrame:
    """Сколько сезонов пилот закончил выше напарника и сколько сезонов было с кем сравнить."""
    team = started.groupby(["year", "driverId", "constructorId"]).size().rename("n").reset_index()
    main = team.sort_values("n", ascending=False).drop_duplicates(["year", "driverId"])
    main = main[main["n"] >= main["year"].map(races) * MAIN_TEAM_SHARE]
    pairs = main.merge(main, on=["year", "constructorId"], suffixes=("", "_mate"))
    pairs = pairs[pairs["driverId"] != pairs["driverId_mate"]]
    pairs = pairs.sort_values("n_mate", ascending=False).drop_duplicates(["year", "driverId"])
    place = standings.set_index(["year", "driverId"])["positionDisplayOrder"]
    pairs["me"] = place.reindex(list(zip(pairs["year"], pairs["driverId"]))).to_numpy()
    pairs["mate"] = place.reindex(list(zip(pairs["year"], pairs["driverId_mate"]))).to_numpy()
    pairs = pairs.dropna(subset=["me", "mate"])
    pairs["ahead"] = pairs["me"] < pairs["mate"]
    return pairs.groupby("driverId").agg(ahead=("ahead", "sum"), compared=("ahead", "size"))
