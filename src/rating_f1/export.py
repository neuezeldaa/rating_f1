"""Выгрузка для сайта: JSON-файлы (контракт данных) и data.js для открытия двойным кликом."""
from __future__ import annotations

import json
import math
from datetime import datetime, timezone

import numpy as np
import pandas as pd

from .composite import FEATURES, GROUPS, PERIOD
from .config import (
    INTERVAL,
    MIN_RACES_FOR_RANK,
    MIN_RACES_PERIOD,
    QUALI_MAX_GAP_PCT,
    REFERENCE_LAP_S,
    SHRINK_RACES,
    SPRINT_WEIGHT,
    WEB_DATA,
    WEIGHTS_PERIOD,
    WEIGHTS_SEASON,
)
from .intervals import encode

STAT_COLS = ["points", "wins", "podiums", "top10", "poles", "fastest_laps", "grand_slams", "dotd",
             "driver_errors", "contacts", "mechanical", "penalties", "finished", "overtakes_total", "standouts"]
WIKI_LINK = ("https://ru.wikipedia.org/", "https://en.wikipedia.org/")


def _clean(obj):
    """numpy → обычные типы, NaN → null, округление до 4 знаков."""
    if isinstance(obj, dict):
        return {str(k): _clean(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [_clean(v) for v in obj]
    if isinstance(obj, np.integer):
        return int(obj)
    if isinstance(obj, (float, np.floating)):
        value = float(obj)
        return None if math.isnan(value) else round(value, 4)
    if isinstance(obj, np.bool_):
        return bool(obj)
    if obj is pd.NA or obj is pd.NaT:
        return None
    return obj


def _num(value):
    return None if value is None or value is pd.NA or (isinstance(value, float) and math.isnan(value)) else value


def _teammate_block(rec: dict) -> dict:
    """Оценки модели «пилот против напарника» за сезон (для карточки пилота)."""
    def band(name):
        return [rec[name], rec[f"{name}_lo"], rec[f"{name}_hi"]]

    def pair(wins, n):
        return None if _num(n) is None else [int(wins), int(n)]

    return {
        "strength": band("overall"),
        "skill": [rec["skill_overall"], rec["skill_overall_lo"], rec["skill_overall_hi"]],
        "quali_s": band("quali_s"),
        "pace_s": band("pace_s"),
        "race_p": band("race_p"),
        "rank": _num(rec.get("rank")),
        "h2h_quali": pair(rec.get("quali_wins"), rec.get("quali_n")),
        "h2h_race": pair(rec.get("race_wins"), rec.get("race_n")),
        "quali_gap_pct": _num(rec.get("quali_gap_median")),
    }


def _entries(table: pd.DataFrame, teams: dict, extra: dict) -> list:
    rows = table.sort_values(["eligible", "rating"], ascending=[False, False])
    out = []
    for driver, rec in rows.iterrows():
        entry = {
            "id": driver,
            "starts": int(rec["starts"]),
            "eligible": bool(rec["eligible"]),
            "rank": _num(rec["rank"]),
            "rating": rec["rating"],
            "s": {g.id: rec[f"s_{g.id}"] for g in GROUPS if f"s_{g.id}" in rec},
            "g": {g.id: rec[f"g_{g.id}"] for g in GROUPS if f"g_{g.id}" in rec},
            "f": {f.id: [rec[f"v_{f.id}"], rec[f"z_{f.id}"]] for f in FEATURES if f"v_{f.id}" in rec},
            "stats": {c: rec[f"st_{c}"] for c in STAT_COLS if f"st_{c}" in rec},
            "teams": teams.get(driver, []),
        }
        entry.update(extra.get(driver, {}))
        out.append(entry)
    return out


def export_web(tables, scopes: dict, teammate: pd.DataFrame, raw: pd.DataFrame, context: pd.DataFrame,
               models: dict, backtest, expert: dict, counts: dict, expectations: dict, graph: dict,
               draws: dict | None = None, bios: dict | None = None, incidents: dict | None = None,
               validation: dict | None = None) -> dict:
    """draws — пересчёты для вилок балла и места (intervals.bootstrap); None — без вилок.
    bios — краткие биографии из Википедии; incidents — происшествия по сезонам (stats.incident_lists);
    validation — проверки рейтинга (validate.report).
    """
    bios, incidents = bios or {}, incidents or {}
    races = tables["races"]
    done = races[races["completed"]].sort_values(["season", "round"])
    last = done.iloc[-1]
    standings = tables["standings"]

    # Команды по сезонам и за весь период
    team_lists = {int(s): dict(zip(g["driver_id"], g["teams"])) for s, g in context.groupby("season")}
    period_teams = {}
    for rec in context.sort_values("season").to_dict("records"):
        period_teams.setdefault(rec["driver_id"], [])
        for team in rec["teams"]:
            if team not in period_teams[rec["driver_id"]]:
                period_teams[rec["driver_id"]].append(team)

    tm = teammate.merge(raw, on=["driver_id", "season"], how="left").merge(
        context[["driver_id", "season", "teammates"]], on=["driver_id", "season"], how="left")
    scope_json = {}
    for key, table in scopes.items():
        if key == PERIOD:
            seasons_of = context.groupby("driver_id")["season"].apply(lambda s: sorted(int(x) for x in s))
            best = standings.groupby("driver_id")["position"].min()
            titles = standings[standings["champion"]].groupby("driver_id")["season"].apply(
                lambda s: sorted(int(x) for x in s))
            extra = {
                d: {"seasons": seasons_of.get(d, []), "best_standing": _num(best.get(d)),
                    "titles": titles.get(d, [])}
                for d in table.index
            }
            scope_json[key] = _entries(table, period_teams, extra)
        else:
            season = int(key)
            st = standings[standings["season"] == season].set_index("driver_id")
            tm_season = tm[tm["season"] == season].set_index("driver_id")
            extra = {}
            for d in table.index:
                item = {"standing": _num(st["position"].get(d)) if d in st.index else None,
                        "champion": bool(st["champion"].get(d, False)) if d in st.index else False,
                        "incidents": incidents.get((d, season), [])}
                if d in tm_season.index:
                    rec = tm_season.loc[d].to_dict()
                    item["tm"] = _teammate_block(rec)
                    mates = rec.get("teammates")
                    item["teammates"] = list(mates) if isinstance(mates, (list, np.ndarray)) else []
                extra[d] = item
            scope_json[key] = _entries(table, team_lists.get(season, {}), extra)

    drivers_df = tables["drivers"].set_index("driver_id")
    rated = set(scopes[PERIOD].index)
    drivers = {
        d: {
            "code": drivers_df.at[d, "code"],
            "name": f'{drivers_df.at[d, "given_name"]} {drivers_df.at[d, "family_name"]}',
            "nationality": drivers_df.at[d, "nationality"],
            "dob": drivers_df.at[d, "dob"],
            "debut": _num(drivers_df.at[d, "debut_season"]),
        }
        for d in sorted(rated) if d in drivers_df.index
    }
    for d, bio in bios.items():
        if d in drivers and bio["url"].startswith(WIKI_LINK):
            drivers[d]["bio"] = bio

    meta = {
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "data_through": {"season": int(last["season"]), "round": int(last["round"]),
                         "race_name": last["race_name"], "date": last["date"]},
        "scopes": [PERIOD] + sorted((k for k in scopes if k != PERIOD), reverse=True),
        "period": [int(races["season"].min()), int(races["season"].max())],
        "season_races": {str(int(s)): {"completed": int(g["completed"].sum()), "scheduled": int(len(g))}
                         for s, g in races.groupby("season")},
        "race_names": {str(int(s)): {str(int(r)): n for r, n in zip(g["round"], g["race_name"])}
                       for s, g in races.groupby("season")},
        "groups": [{"id": g.id, "name": g.name, "about": g.about} for g in GROUPS],
        "features": [{"id": f.id, "group": f.group, "name": f.name, "unit": f.unit, "better": f.better}
                     for f in FEATURES],
        "weights": {"period": WEIGHTS_PERIOD, "season": WEIGHTS_SEASON},
        "min_starts": {"period": MIN_RACES_PERIOD, "season": MIN_RACES_FOR_RANK},
        "shrink_races": SHRINK_RACES,
        "interval": INTERVAL,
        "draws": next((d["z"].shape[2] for d in draws.values()), None) if draws else None,
        "reference_lap_s": REFERENCE_LAP_S,
        "sprint_weight": SPRINT_WEIGHT,
        "quali_max_gap_pct": QUALI_MAX_GAP_PCT,
        "models": models,
        "counts": counts,
        "car_expectations": expectations,
        "validation": validation,
        "backtest": backtest,
        "expert": expert,
        "sources": [
            {"name": "Jolpica F1 API", "url": "https://api.jolpi.ca", "what": "результаты, квалификации, спринты"},
            {"name": "F1DB", "url": "https://github.com/f1db/f1db",
             "what": "причины сходов, штрафы, лучшие круги, гонщик дня, таблицы чемпионатов (CC BY 4.0)"},
            {"name": "TracingInsights RaceData", "url": "https://github.com/TracingInsights/RaceData",
             "what": "позиции и время каждого пилота на каждом круге, пит-стопы"},
            {"name": "Опрос руководителей команд F1", "url": "https://www.formula1.com",
             "what": "только для сверки, 2021–2025"},
            {"name": "Википедия", "url": "https://ru.wikipedia.org",
             "what": "краткие биографии пилотов (CC BY-SA 4.0)"},
        ],
    }

    payload = _clean({"meta": meta, "drivers": drivers, "scopes": scope_json, "graph": graph})
    payload["draws"] = encode(draws) if draws else {}
    WEB_DATA.mkdir(parents=True, exist_ok=True)
    for old in ("seasons.json",):
        (WEB_DATA / old).unlink(missing_ok=True)
    for name in ("meta", "drivers", "scopes", "graph", "draws"):
        (WEB_DATA / f"{name}.json").write_text(
            json.dumps(payload[name], ensure_ascii=False, indent=1), encoding="utf-8")
    (WEB_DATA / "data.js").write_text(
        "// Сгенерировано пайплайном: python -m rating_f1.pipeline\n"
        "window.F1_DATA = " + json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + ";\n",
        encoding="utf-8",
    )
    return payload
