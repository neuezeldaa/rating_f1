"""Условия гонки — дождь и тип трассы: справка для карточки пилота, в балл не идут.

Дождевые гонки — по разметке annotations/wet_races.yaml (проверено по отчётам о гонках).
Непроверенные этапы размечаются по осадкам Open-Meteo (ingest/weather.py) — это подсказка,
реанализ часто ошибается, поэтому такие гонки перечисляются в логе для проверки.

Тип трассы: уличная — по F1DB; автодромы делятся пополам по средней скорости лучшего круга
гонки: скоростные (от медианы и выше) и технические.

Почему не в балле (проверка как в validate.py — половины гонок пилота сравниваются между собой):
прибавка в дождь против напарника повторяется слабо (r ≈ 0,1–0,3 против 0,86–0,98 у групп
рейтинга), «специализация» по типу трассы — только на уличных трассах (r ≈ 0,6), и та может
идти от машины, которая подходит под такие трассы.
"""
from __future__ import annotations

import logging
from pathlib import Path

import numpy as np
import pandas as pd
import yaml

from ..clean.status import FINISHED

KEY = ["season", "round"]
WET_AUTO_MM = 1.0       # непроверенный этап — мокрый, если в часы гонки выпало от 1 мм
WET_AUTO_BEFORE_MM = 1.5  # или за 3 часа до старта — от 1,5 мм (мокрая трасса на старте)
TRACK_TYPES = {"street": "уличные", "fast": "скоростные", "technical": "технические"}
log = logging.getLogger(__name__)


def wet_races(races: pd.DataFrame, weather: pd.DataFrame, path: Path) -> pd.DataFrame:
    """season, round, wet, checked (по разметке), no_racing — для прошедших гонок."""
    notes = yaml.safe_load(path.read_text(encoding="utf-8")) if path.exists() else {}
    done = races[races["completed"]][KEY + ["race_name"]].merge(weather, on=KEY, how="left")
    rows, unchecked = [], []
    for r in done.itertuples(index=False):
        note = notes.get(int(r.season)) or {}
        checked = int(r.round) <= int(note.get("reviewed", 0))
        if checked:
            wet = r.race_name in (note.get("wet") or [])
        else:
            wet = bool((r.precip_mm or 0) >= WET_AUTO_MM or (r.precip_before or 0) >= WET_AUTO_BEFORE_MM)
            if wet:
                unchecked.append(f"{r.season} {r.race_name}")
        rows.append({"season": int(r.season), "round": int(r.round), "wet": wet, "checked": checked,
                     "no_racing": r.race_name in (note.get("no_racing") or [])})
    if unchecked:
        log.info("Дождь по осадкам Open-Meteo (проверьте и впишите в annotations/wet_races.yaml): %s",
                 ", ".join(unchecked))
    return pd.DataFrame(rows)


def track_types(race_info: pd.DataFrame, fastest_laps: pd.DataFrame) -> pd.DataFrame:
    """season, round, circuit, track_type (street / fast / technical), kmh — средняя скорость круга."""
    best = fastest_laps.groupby(KEY, as_index=False)["fl_time_ms"].min()
    r = race_info.merge(best, on=KEY, how="left")
    r["kmh"] = r["course_km"] / (r["fl_time_ms"] / 3.6e6)
    speed = r.groupby("circuit")["kmh"].median()
    street = set(r.loc[r["circuit_type"] == "STREET", "circuit"])
    cut = speed[~speed.index.isin(street)].median()
    kind = {c: "street" if c in street else "fast" if v >= cut else "technical" for c, v in speed.items()}
    r["track_type"] = r["circuit"].map(kind)
    return r[KEY + ["circuit", "track_type", "kmh"]]


def _teammate_long(pace_pairs: pd.DataFrame, duels: pd.DataFrame):
    """Темп против напарника (% — плюс, если быстрее) и дуэли (1 — выше на финише) по пилоту и гонке."""
    p = pace_pairs[pace_pairs["valid"]]
    pace = pd.concat([
        pd.DataFrame({"season": p["season"], "round": p["round"], "driver_id": p["driver_a"], "pace": -p["gap_pct"]}),
        pd.DataFrame({"season": p["season"], "round": p["round"], "driver_id": p["driver_b"], "pace": p["gap_pct"]}),
    ])
    d = duels[duels["valid"] & (duels["session"] == "R")]
    duel = pd.concat([
        pd.DataFrame({"season": d["season"], "round": d["round"], "driver_id": d["driver_a"], "won": d["outcome"]}),
        pd.DataFrame({"season": d["season"], "round": d["round"], "driver_id": d["driver_b"], "won": 1 - d["outcome"]}),
    ])
    return pace, duel


def driver_conditions(records: pd.DataFrame, pace_pairs: pd.DataFrame, duels: pd.DataFrame,
                      wet: pd.DataFrame, tracks: pd.DataFrame) -> tuple[dict, dict]:
    """Справка для карточек: ({пилот: за все сезоны}, {(пилот, сезон): дождевые гонки сезона})."""
    rain = wet[wet["wet"] & ~wet["no_racing"]][KEY]
    r = records.merge(rain.assign(rainy=True), on=KEY, how="left").merge(tracks[KEY + ["track_type"]], on=KEY, how="left")
    r["rainy"] = r["rainy"].eq(True)  # после left join у сухих гонок NaN → False
    pace, duel = _teammate_long(pace_pairs, duels)
    pace = pace.merge(rain.assign(rainy=True), on=KEY, how="left")
    pace["rainy"] = pace["rainy"].eq(True)
    duel = duel.merge(rain.assign(rainy=True), on=KEY, how="left")
    duel["rainy"] = duel["rainy"].eq(True)

    period = {}
    for driver, g in r.groupby("driver_id"):
        item = {}
        wet_g = g[g["rainy"]]
        if len(wet_g):
            pc, du = pace[pace["driver_id"] == driver], duel[duel["driver_id"] == driver]
            finished = wet_g[wet_g["category"] == FINISHED]
            best = finished.assign(gain=finished["grid_pos"] - finished["finish_pos"]).sort_values(
                ["finish_pos", "gain"], ascending=[True, False]).head(1)
            item["wet"] = {
                "races": int(len(wet_g)),
                "pace_wet": _mean(pc.loc[pc["rainy"].astype(bool), "pace"]),
                "pace_dry": _mean(pc.loc[~pc["rainy"].astype(bool), "pace"]),
                "duels_wet": [int(du.loc[du["rainy"].astype(bool), "won"].sum()), int(du["rainy"].astype(bool).sum())],
                "duels_dry": [int(du.loc[~du["rainy"].astype(bool), "won"].sum()), int((~du["rainy"].astype(bool)).sum())],
                "best": None if best.empty else [int(best["season"].iat[0]), int(best["round"].iat[0]),
                                                 int(best["finish_pos"].iat[0]), int(best["grid_pos"].iat[0])],
            }
        pac = g.dropna(subset=["points_above_car"])
        if len(pac) >= 10:
            base = pac["points_above_car"].mean()
            item["tracks"] = {t: {"races": int(len(sub)), "rel": round(float(sub["points_above_car"].mean() - base), 2)}
                              for t, sub in pac.groupby("track_type") if len(sub) >= 3}
        if item:
            period[driver] = item

    by_season = {}
    for (driver, season), g in r[r["rainy"]].groupby(["driver_id", "season"]):
        by_season[(driver, int(season))] = [
            [int(x.round), None if np.isnan(x.finish_pos) else int(x.finish_pos), int(x.grid_pos), str(x.status_detail)]
            for x in g.sort_values("round").itertuples(index=False)]
    return period, by_season


def _mean(values: pd.Series):
    return None if values.empty else round(float(values.mean()), 3)
