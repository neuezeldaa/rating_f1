"""Рейтинг всех времён (1950–2026): упрощённая модель на данных F1DB.

Кругов до 1996 года нет, поэтому здесь только то, что есть для всех эпох:
- «Результаты» — очки за гонку по единой шкале 25-18-15-…, победы, подиумы, место в чемпионате;
- «Квалификация» — поулы, среднее место, отставание от поула;
- «Против напарника» — сеть напарников (квала и финиш, с поправкой на силу напарников через все
  цепочки, _chain_ridge) и доля очков команды. Напарник — пилот того же заявителя на той же
  машине: в 1950-х у одной марки бывало по 4–5 машин частников, это не напарники;
- «Карьера» (только сводка) — сезоны в F1, титулы, сезоны впереди напарника, запас над средним.

Принципы те же, что у основного рейтинга: признак сравнивается внутри сезона (эпохи и системы
очков сравнимы), мало гонок — сильнее сжатие к среднему, балл — 50 + 15·z. Гонки
Индианаполис-500 (1950–1960) не в счёт: это отдельная американская гонка, которую засчитывали
в чемпионат, но гонщики F1 в ней почти не ездили.

Чего нет по сравнению с основным рейтингом (1996+): темпа и обгонов по кругам, уровня машины,
вилок балла и места.
"""
from __future__ import annotations

import logging
from pathlib import Path

import numpy as np
import pandas as pd
from scipy import sparse
from scipy.sparse.linalg import spsolve

from .config import RATING_CENTER, RATING_SCALE, SHRINK_RACES
from .features.career import NOT_STARTED, career_facts
from .ingest import f1db

log = logging.getLogger(__name__)

FIRST_YEAR = 1950
POINTS = {1: 25, 2: 18, 3: 15, 4: 12, 5: 10, 6: 8, 7: 6, 8: 4, 9: 2, 10: 1}
SEASON_POOL = 5        # гонок в сезоне, чтобы пилот попал в пул сезона
ALLTIME_POOL = 30      # гонок за карьеру — в пул всех времён
MAX_GAP_PCT = 5.0      # отставание в квалификации больше — сорванная попытка
FUEL_Q3 = range(2006, 2010)  # Q3 с топливом на гонку — не сравниваем (как в основном рейтинге)

# Признак: (группа, лучше больше: +1 / меньше: −1, счётчик для сжатия)
FEATURES = {
    "ppr": ("results", +1, "starts"),
    "win_rate": ("results", +1, "starts"),
    "podium_rate": ("results", +1, "starts"),
    "champ": ("results", +1, None),
    "pole_rate": ("quali", +1, "quali_n"),
    "quali_pos": ("quali", -1, "quali_n"),
    "quali_gap": ("quali", -1, "gap_n"),
    "mate_quali": ("teammate", +1, None),   # оценки модели напарников уже сжаты к среднему
    "mate_race": ("teammate", +1, None),
    "team_share": ("teammate", +1, None),
}
CAREER = ["seasons", "titles", "ahead", "above_avg", "records"]
# Гиперпараметры сети напарников — из основной модели (1996–2026, models/teammate.py оценивает их
# по данным): квала — шум 0,48%, разброс навыка 0,42%, изменение за сезон 0,08%; финиш в логитах —
# разброс 0,54, изменение за сезон 0,24 (шум 2 — линейное приближение логистической модели).
QUALI_PRIOR = {"sigma": 0.48, "tau0": 0.42, "tau_rw": 0.08}
RACE_PRIOR = {"sigma": 2.0, "tau0": 0.54, "tau_rw": 0.24}
WEIGHTS_SEASON = {"results": 0.35, "quali": 0.25, "teammate": 0.40}
WEIGHTS_ALLTIME = {"results": 0.25, "quali": 0.15, "teammate": 0.35, "career": 0.25}
GROUP_NAMES = {"results": "Результаты", "quali": "Квалификация", "teammate": "Против напарника", "career": "Карьера"}


def _starts(archive: Path) -> pd.DataFrame:
    """Старты с заявителем, местом на финише и очками по единой шкале; без Индианаполиса-500."""
    races = f1db.read_table(archive, "races")
    indy = set(races.loc[(races["circuitId"] == "indianapolis") & (races["year"] <= 1960), "id"])
    res = f1db.read_table(archive, "races-race-results", FIRST_YEAR)
    res = res[~res["positionText"].astype(str).isin(NOT_STARTED) & ~res["raceId"].isin(indy)].copy()
    res["finish_pos"] = pd.to_numeric(res["positionText"], errors="coerce")  # не классифицирован — пусто
    res["base_points"] = res["finish_pos"].map(POINTS).fillna(0.0)
    # Заявитель на этапе: из состава заявок сезона (номера этапов через «;»), иначе — сама марка.
    ed = f1db.read_table(archive, "seasons-entrants-drivers", FIRST_YEAR)
    ed = ed.assign(round=ed["rounds"].astype(str).str.split(";")).explode("round")
    ed["round"] = pd.to_numeric(ed["round"], errors="coerce")
    ed = ed.dropna(subset=["round"]).astype({"round": int})
    ed = ed.drop_duplicates(["year", "round", "driverId", "constructorId"])
    res = res.merge(ed[["year", "round", "driverId", "constructorId", "entrantId"]],
                    on=["year", "round", "driverId", "constructorId"], how="left")
    res["team"] = res["entrantId"].fillna("") + "|" + res["constructorId"]
    return res


def _quali(archive: Path, starts: pd.DataFrame) -> pd.DataFrame:
    """Место и лучшее время в квалификации (без Q3 с топливом), отставание от поула в %."""
    q = f1db.read_table(archive, "races-qualifying-results", FIRST_YEAR)
    q = q[q["raceId"].isin(set(starts["raceId"]))].copy()
    cols = ["timeMillis", "q1Millis", "q2Millis", "q3Millis"]
    q.loc[q["year"].isin(FUEL_Q3), "q3Millis"] = np.nan
    q["best"] = q[cols].min(axis=1)
    q["q_gap"] = 100 * (q["best"] / q.groupby("raceId")["best"].transform("min") - 1)
    q.loc[q["q_gap"] > MAX_GAP_PCT, "q_gap"] = np.nan
    return q[["raceId", "driverId", "positionNumber", "best", "q_gap"]].rename(columns={"positionNumber": "quali_pos"})


def _mates(r: pd.DataFrame) -> pd.DataFrame:
    """Сравнения с напарниками на каждом этапе: сколько их было (для счётчиков признаков)."""
    p = r.merge(r, on=["raceId", "team"], suffixes=("", "_m"))
    p = p[p["driverId"] != p["driverId_m"]]
    q_ok = p["best"].notna() & p["best_m"].notna()
    r_ok = p["finish_pos"].notna() & p["finish_pos_m"].notna()
    return (p.assign(q_ok=q_ok, r_ok=r_ok).groupby(["raceId", "driverId"])
            .agg(mate_q=("q_ok", "max"), mate_r=("r_ok", "max")).reset_index())


def _chain_ridge(pairs: pd.DataFrame, y: np.ndarray, w: np.ndarray, sigma: float, tau0: float,
                 tau_rw: float) -> pd.DataFrame:
    """Навык (пилот, сезон) по разницам с напарниками: y ≈ θ_A − θ_B с шумом sigma; уровень пилота
    в первом сезоне ~ N(0, tau0²), дальше — случайное блуждание с шагом tau_rw за год. Это та же
    постановка, что у модели напарников основного рейтинга, но с готовыми гиперпараметрами
    и разреженным решением: на 77 сезонах полная модель считалась бы десятки минут.
    """
    keys = sorted(set(zip(pairs["driver_a"], pairs["season"])) | set(zip(pairs["driver_b"], pairs["season"])))
    pos = {key: i for i, key in enumerate(keys)}
    ia = np.array([pos[k] for k in zip(pairs["driver_a"], pairs["season"])])
    ib = np.array([pos[k] for k in zip(pairs["driver_b"], pairs["season"])])
    n, p = len(pairs), len(keys)
    x = sparse.csr_matrix((np.r_[np.ones(n), -np.ones(n)], (np.r_[np.arange(n), np.arange(n)], np.r_[ia, ib])),
                          shape=(n, p))
    prec = w / sigma ** 2
    rows, cols, vals = [], [], []
    for i, (driver, season) in enumerate(keys):  # ключи отсортированы: пилот, сезон
        prev = keys[i - 1] if i else None
        if prev is None or prev[0] != driver:
            rows.append(i), cols.append(i), vals.append(1 / tau0 ** 2)
        else:
            v = 1 / (tau_rw ** 2 * (season - prev[1]))
            rows += [i, i - 1, i, i - 1]
            cols += [i, i - 1, i - 1, i]
            vals += [v, v, -v, -v]
    prior = sparse.csr_matrix((vals, (rows, cols)), shape=(p, p))
    theta = spsolve((x.T @ sparse.diags(prec) @ x + prior).tocsc(), x.T @ (prec * y))
    return pd.DataFrame({"driverId": [k[0] for k in keys], "year": [k[1] for k in keys], "theta": theta})


def teammate_skill(r: pd.DataFrame) -> pd.DataFrame:
    """Навык против напарников по сезонам с учётом силы напарников через всю сеть (_chain_ridge).

    Пары — пилоты одного заявителя на одной машине; если машин больше двух, каждая пара весит
    1/(k−1), чтобы у пилота на этапе был один «голос». Квалификация 2003–2005 — с половинным весом
    (круг с топливом на гонку), Q3 2006–2009 не используется (см. _quali). Финиш — линейное
    приближение логистической модели: исход ±2 в логитах при шуме 2.
    """
    k = r.groupby(["raceId", "team"])["driverId"].transform("size")
    r = r.assign(k=k)
    p = r.merge(r, on=["raceId", "team"], suffixes=("_a", "_b"))
    p = p[p["driverId_a"] < p["driverId_b"]].copy()
    p["season"] = p["year_a"]
    p["driver_a"], p["driver_b"] = p["driverId_a"], p["driverId_b"]
    p["weight"] = 1.0 / (p["k_a"] - 1)
    q = p.assign(gap_pct=100 * np.log(p["best_a"] / p["best_b"]))
    q["valid"] = q["gap_pct"].notna() & (q["gap_pct"].abs() <= 3)
    q.loc[q["season"].between(2003, 2005), "weight"] *= 0.5
    d = p.assign(outcome=(p["finish_pos_a"] < p["finish_pos_b"]).astype(float))
    d["valid"] = p["finish_pos_a"].notna() & p["finish_pos_b"].notna()
    q, d = q[q["valid"]], d[d["valid"]]
    quali = _chain_ridge(q, -q["gap_pct"].to_numpy(float), q["weight"].to_numpy(float), **QUALI_PRIOR)
    race = _chain_ridge(d, 4 * (d["outcome"].to_numpy(float) - 0.5), d["weight"].to_numpy(float), **RACE_PRIOR)
    return quali.rename(columns={"theta": "mate_quali"}).merge(
        race.rename(columns={"theta": "mate_race"}), on=["driverId", "year"], how="outer")


def season_table(archive: Path) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Признаки пилота в каждом сезоне (сырые значения и счётчики) и сами старты."""
    r = _starts(archive)
    r = r.merge(_quali(archive, r), on=["raceId", "driverId"], how="left")
    skill = teammate_skill(r)
    r = r.merge(_mates(r), on=["raceId", "driverId"], how="left")
    r["team_points"] = r.groupby(["raceId", "team"])["base_points"].transform("sum")
    g = r.groupby(["year", "driverId"])
    s = pd.DataFrame({
        "starts": g.size(),
        "points": g["base_points"].sum(),
        "wins": g["finish_pos"].apply(lambda x: (x == 1).sum()),
        "podiums": g["finish_pos"].apply(lambda x: (x <= 3).sum()),
        "quali_n": g["quali_pos"].count(),
        "poles": g["quali_pos"].apply(lambda x: (x == 1).sum()),
        "quali_pos": g["quali_pos"].mean(),
        "quali_gap": g["q_gap"].median(),
        "gap_n": g["q_gap"].count(),
        "mate_q_n": g["mate_q"].sum(),
        "mate_r_n": g["mate_r"].sum(),
        "team_points": g["team_points"].sum(),
    }).reset_index()
    s = s.merge(skill, on=["driverId", "year"], how="left")
    s["ppr"] = s["points"] / s["starts"]
    s["win_rate"] = s["wins"] / s["starts"]
    s["podium_rate"] = s["podiums"] / s["starts"]
    s["pole_rate"] = s["poles"] / s["quali_n"].where(s["quali_n"] > 0)
    s["team_share"] = (s["points"] + 12.5) / (s["team_points"] + 25)   # как в основном рейтинге
    st = f1db.read_table(archive, "seasons-driver-standings", FIRST_YEAR)
    champ = st.set_index(["year", "driverId"])["positionDisplayOrder"].map(POINTS).fillna(0.0)
    s["champ"] = champ.reindex(list(zip(s["year"], s["driverId"]))).fillna(0.0).to_numpy()
    return s, r


def _z(values: pd.DataFrame, counts: pd.DataFrame, pool: pd.Series, shrink: bool = True) -> pd.DataFrame:
    """z-оценки признаков по пулу: сначала сжатие к среднему пула (SHRINK_RACES гонок), потом z ±3."""
    out = pd.DataFrame(index=values.index)
    for f, (_, better, count) in FEATURES.items():
        if f not in values:
            continue
        x = values[f].astype(float)
        center = x[pool].mean()
        x = x.fillna(center)
        if shrink and count:
            n = counts[count].fillna(0.0)
            x = (x * n + center * SHRINK_RACES) / (n + SHRINK_RACES)
        sd = x[pool].std(ddof=0)
        out[f] = (better * (x - x[pool].mean()) / sd).clip(-3, 3) if sd > 0 else 0.0
    return out


def _overall(z: pd.DataFrame, pool: pd.Series, weights: dict, extra: pd.DataFrame | None = None):
    """Баллы групп и итог по шкале 50 + 15·z."""
    groups = {}
    for g in weights:
        cols = [f for f, (grp, _, _) in FEATURES.items() if grp == g and f in z]
        if g == "career" and extra is not None:
            groups[g] = extra.mean(axis=1)
        elif cols:
            groups[g] = z[cols].mean(axis=1)
    gz = pd.DataFrame(groups)
    gz = (gz - gz[pool].mean()) / gz[pool].std(ddof=0)
    w = pd.Series({g: weights[g] for g in gz.columns})
    total = (gz[w.index] * w).sum(axis=1) / w.sum()
    total = (total - total[pool].mean()) / total[pool].std(ddof=0)
    return gz, (RATING_CENTER + RATING_SCALE * total).clip(0, 100)


def build(archive: Path) -> dict:
    """Сезонные рейтинги 1950–2026 и рейтинг всех времён (по пилотам F1DB)."""
    all_facts = career_facts(f1db.read_table(archive, "races-race-results"),
                             f1db.read_table(archive, "seasons-driver-standings"), f1db.read_table(archive, "races"))
    seasons, starts = season_table(archive)
    counts_cols = ["starts", "quali_n", "gap_n", "mate_q_n", "mate_r_n"]

    # 1. Сезоны: z внутри сезона, итог сезона
    season_scores, rel_num, rel_den = [], None, None
    for year, s in seasons.groupby("year"):
        s = s.set_index("driverId")
        pool = s["starts"] >= SEASON_POOL
        if pool.sum() < 5:
            continue
        z = _z(s, s[counts_cols], pool)
        gz, rating = _overall(z, pool, WEIGHTS_SEASON)
        season_scores.append(pd.DataFrame({"year": year, "starts": s["starts"], "rating": rating,
                                           "eligible": pool}).join(gz.add_prefix("g_")).reset_index())
        # для всех времён: признак относительно сезона (без сжатия), с весом по счётчику
        zr = _z(s, s[counts_cols], pool, shrink=False)
        w = pd.DataFrame({f: (s[FEATURES[f][2]] if FEATURES[f][2] else s["starts"]).astype(float)
                          for f in zr.columns}, index=s.index)
        num, den = zr * w, w
        rel_num = num if rel_num is None else rel_num.add(num, fill_value=0.0)
        rel_den = den if rel_den is None else rel_den.add(den, fill_value=0.0)
    season_scores = pd.concat(season_scores, ignore_index=True)

    # 2. Все времена: признаки относительно сезонов, сжатие по числу гонок за карьеру
    totals = seasons.groupby("driverId")[counts_cols].sum()
    rel = (rel_num / rel_den.where(rel_den > 0)).reindex(totals.index)
    pool = totals["starts"] >= ALLTIME_POOL
    z = pd.DataFrame(index=totals.index)
    for f, (_, _, count) in FEATURES.items():
        x = rel[f]
        center = x[pool].mean()
        x = x.fillna(center)
        if count:
            n = totals[count]
            x = (x * n + center * SHRINK_RACES) / (n + SHRINK_RACES)
        sd = x[pool].std(ddof=0)
        z[f] = ((x - x[pool].mean()) / sd).clip(-3, 3)

    # Карьера: факты с дебюта (F1DB) и запас над средним по сезонам этой модели
    facts = all_facts.reindex(totals.index)
    sc = season_scores
    share = sc["starts"] / sc.groupby("year")["starts"].transform("max")
    facts["above_avg"] = (share * (sc["rating"] - RATING_CENTER).clip(lower=0)).groupby(sc["driverId"]).sum()
    career = pd.DataFrame({c: facts[c].astype(float) for c in CAREER}, index=totals.index)
    career = ((career - career[pool].mean()) / career[pool].std(ddof=0)).clip(-3, 3).fillna(0.0)

    gz, rating = _overall(z, pool, WEIGHTS_ALLTIME, career)
    table = pd.DataFrame({"rating": rating, "eligible": pool, "starts": totals["starts"]}).join(gz.add_prefix("g_"))
    table["rank"] = table["rating"].where(pool).rank(ascending=False, method="min")
    return {"seasons": season_scores, "alltime": table, "facts": facts, "season_stats": seasons,
            "starts": starts}


def validate(out: dict) -> dict:
    """Проверки модели всех времён — те же, что у основного рейтинга.

    - прогноз новых пар напарников: угадывает ли разница баллов прошлого сезона, кто окажется выше
      в новом сезоне в квалификации и на финише;
    - сохранность итога и групп в соседних сезонах у сменивших марку.
    """
    sc, r = out["seasons"], out["starts"]
    p = r.merge(r, on=["raceId", "team"], suffixes=("_a", "_b"))
    p = p[p["driverId_a"] < p["driverId_b"]]
    both_q = p["quali_pos_a"].notna() & p["quali_pos_b"].notna()
    p["q"] = np.where(both_q, (p["quali_pos_a"] < p["quali_pos_b"]).astype(float), np.nan)
    both_r = p["finish_pos_a"].notna() & p["finish_pos_b"].notna()
    p["r"] = np.where(both_r, (p["finish_pos_a"] < p["finish_pos_b"]).astype(float), np.nan)
    pairs = (p.groupby(["year_a", "driverId_a", "driverId_b"])
             .agg(n=("raceId", "size"), q=("q", "mean"), r=("r", "mean")).reset_index())
    first = pairs.groupby(["driverId_a", "driverId_b"])["year_a"].transform("min")
    new = pairs[(pairs["year_a"] == first) & (pairs["n"] >= 5)]
    prev = sc.set_index(["year", "driverId"])
    hits = {"q": [], "r": []}
    for row in new.itertuples(index=False):
        ka, kb = (row.year_a - 1, row.driverId_a), (row.year_a - 1, row.driverId_b)
        if ka not in prev.index or kb not in prev.index or not (prev.loc[ka, "eligible"] and prev.loc[kb, "eligible"]):
            continue
        diff = prev.loc[ka, "rating"] - prev.loc[kb, "rating"]
        for kind in ("q", "r"):
            share = getattr(row, kind)
            if not np.isnan(share) and share != 0.5 and diff != 0:
                hits[kind].append((diff > 0) == (share > 0.5))

    make = r.groupby(["year", "driverId"])["constructorId"].agg(lambda x: x.mode().iat[0])
    s = sc[sc["eligible"]].set_index(["year", "driverId"])
    s["make"] = make.reindex(s.index)
    s = s.reset_index()
    nxt = s.merge(s.assign(year=s["year"] - 1), on=["driverId", "year"], suffixes=("", "_next"))
    moved = nxt["make"] != nxt["make_next"]
    groups = {g: float(nxt.loc[moved, f"g_{g}"].corr(nxt.loc[moved, f"g_{g}_next"])) for g in WEIGHTS_SEASON}
    return {
        "pairs_quali": len(hits["q"]), "quali": float(np.mean(hits["q"])),
        "pairs_race": len(hits["r"]), "race": float(np.mean(hits["r"])),
        "n_moved": int(moved.sum()),
        "moved": float(nxt.loc[moved, "rating"].corr(nxt.loc[moved, "rating_next"])),
        "stayed": float(nxt.loc[~moved, "rating"].corr(nxt.loc[~moved, "rating_next"])),
        "groups_moved": groups,
    }


COUNTRY_RU = {
    "united-kingdom": "Великобритания", "brazil": "Бразилия", "germany": "Германия", "west-germany": "ФРГ",
    "east-germany": "ГДР", "france": "Франция", "italy": "Италия", "argentina": "Аргентина", "austria": "Австрия",
    "australia": "Австралия", "finland": "Финляндия", "netherlands": "Нидерланды", "spain": "Испания",
    "canada": "Канада", "united-states-of-america": "США", "switzerland": "Швейцария", "belgium": "Бельгия",
    "new-zealand": "Новая Зеландия", "sweden": "Швеция", "south-africa": "ЮАР", "mexico": "Мексика",
    "japan": "Япония", "colombia": "Колумбия", "denmark": "Дания", "poland": "Польша", "russia": "Россия",
    "monaco": "Монако", "thailand": "Таиланд", "china": "Китай", "venezuela": "Венесуэла", "ireland": "Ирландия",
    "portugal": "Португалия", "chile": "Чили", "uruguay": "Уругвай", "hungary": "Венгрия",
    "czech-republic": "Чехия", "india": "Индия", "indonesia": "Индонезия", "malaysia": "Малайзия",
    "liechtenstein": "Лихтенштейн", "rhodesia": "Родезия", "morocco": "Марокко", "israel": "Израиль",
}


def payload(out: dict, archive: Path, check: dict, cards: dict | None = None) -> dict:
    """Данные для страницы: пилоты пула всех времён по месту, баллы групп, лучшие сезоны, факты карьеры.
    cards — пилот F1DB → идентификатор его полной карточки в основном рейтинге (если он там есть)."""
    cards = cards or {}
    table, facts, stats, sc = out["alltime"], out["facts"], out["season_stats"], out["seasons"]
    people = f1db.read_table(archive, "drivers").set_index("id")
    totals = stats.groupby("driverId").agg(wins=("wins", "sum"), podiums=("podiums", "sum"), poles=("poles", "sum"),
                                           first=("year", "min"), last=("year", "max"))
    main_team = out["starts"].groupby("driverId")["constructorId"].agg(lambda s: s.mode().iat[0])  # для цветной метки
    best = (sc[sc["eligible"]].sort_values("rating", ascending=False).groupby("driverId").head(3)
            .sort_values(["driverId", "year"]))
    season_rank = sc[sc["eligible"]].assign(rank=lambda d: d.groupby("year")["rating"].rank(ascending=False, method="min"))
    best = best.merge(season_rank[["year", "driverId", "rank"]], on=["year", "driverId"])
    best_by = {d: [[int(y), round(float(v), 1), int(k)] for y, v, k in zip(g["year"], g["rating"], g["rank"])]
               for d, g in best.groupby("driverId")}
    drivers = []
    for driver, row in table[table["eligible"]].sort_values("rating", ascending=False).iterrows():
        person = people.loc[driver] if driver in people.index else None
        fact, total = facts.loc[driver], totals.loc[driver]
        drivers.append({
            "id": driver,
            "name": str(person["name"]) if person is not None else driver,
            "code": None if person is None or pd.isna(person["abbreviation"]) else str(person["abbreviation"]),
            "country": None if person is None else COUNTRY_RU.get(str(person["nationalityCountryId"]),
                                                                  str(person["nationalityCountryId"])),
            "country_id": None if person is None else str(person["nationalityCountryId"]),  # для английской версии
            "years": [int(total["first"]), int(total["last"])],
            "rank": int(row["rank"]), "rating": float(row["rating"]), "starts": int(row["starts"]),
            "wins": int(total["wins"]), "podiums": int(total["podiums"]), "poles": int(total["poles"]),
            "titles": [int(y) for y in str(fact["title_years"]).split()] if isinstance(fact["title_years"], str) else [],
            "seasons": float(fact["seasons"]), "ahead": int(fact["ahead"]), "compared": int(fact["compared"]),
            "records": float(fact["records"]),
            "s": {g: float(np.clip(RATING_CENTER + RATING_SCALE * row[f"g_{g}"], 0, 100)) for g in WEIGHTS_ALLTIME},
            "best": best_by.get(driver, []),
            "card": cards.get(driver),
            "team": main_team.get(driver),
        })
    return {
        "period": [FIRST_YEAR, int(stats["year"].max())],
        "pool": ALLTIME_POOL,
        "groups": [{"id": g, "name": GROUP_NAMES[g]} for g in WEIGHTS_ALLTIME],
        "weights": WEIGHTS_ALLTIME,
        "validation": check,
        "drivers": drivers,
    }
