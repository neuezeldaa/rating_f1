"""Решения стюардов FIA о столкновениях: кто наказан за то, что вызвал столкновение.

Документы этапа публикуются на fia.com (раздел Documents, сезоны с 2019 года). Нужны только
заголовки — они есть прямо в именах PDF-файлов: «2023 Australian Grand Prix - Offence - Car 55 -
Causing a collision», «2026_canadian_grand_prix_-_infringement_-_car_81_-_collision_with_car_23».
По дате публикации документ относится к гонке (день гонки и позже) или к спринту (накануне).

Кэш — data/raw/fia/<год>.json: все заголовки с датами по этапам, чтобы разбор можно было
менять без повторной загрузки. Этапы текущего года перезапрашиваются, пока им меньше 10 дней.
"""
from __future__ import annotations

import json
import logging
import re
import time
import unicodedata
from datetime import date, datetime
from urllib.parse import unquote

import pandas as pd
import requests

from ..config import RAW

BASE = "https://www.fia.com"
SEASONS_PAGE = BASE + "/documents/championships/fia-formula-one-world-championship-14/season/season-2024-2043"
CACHE_DIR = RAW / "fia"
FIRST_SEASON = 2019   # раньше документов в этом разделе нет
FRESH_DAYS = 10
PAUSE_S = 1.0
USER_AGENT = "rating-f1/0.1 (personal F1 driver rating project)"
# Наказание — только «Offence» и «Infringement»: «Decision» в 2019–2020 чаще означал «без последствий».
# Столкновение в 2019–2020 называли «incident with car N», позже — «causing a collision».
_VERDICT = re.compile(r"\b(?:offence|infringement)\s*-\s*car\s*(\d+)\s*[-(]\s*(.*(?:collision|incident with car).*)$")
_NOT_GUILTY = re.compile(r"no further action|\bnfa\b|alleged|summons")
_OTHER_CAR = re.compile(r"(?:collision|incident) with car\s*(\d+)")
_DROP_WORDS = {"grand", "prix", "formula", "f", "gp", "the"}
# Одни и те же этапы под разными названиями у FIA и Jolpica.
_ALIASES = {"brazilian": "sao paulo", "mexican": "mexico city", "saudi arabia": "saudi arabian"}
log = logging.getLogger(__name__)


def _get(session: requests.Session, url: str) -> str:
    for attempt in range(4):
        resp = session.get(url, timeout=60)
        if resp.status_code not in (429, 502, 503, 504):
            break
        time.sleep(5 * (attempt + 1))
    resp.raise_for_status()
    time.sleep(PAUSE_S)
    return resp.text


def _documents(html: str) -> list:
    """[(заголовок документа, дата публикации «дд.мм.гг»)] со страницы этапа."""
    out = []
    for row in re.findall(r'<li class="document-row[^"]*">(.*?)</li>', html, flags=re.S):
        href = re.search(r'href="([^"]+\.pdf)"', row)
        when = re.search(r'date-display-single[^>]*>([^<]+)<', row)
        if href:
            name = unquote(href.group(1).rsplit("/", 1)[-1])[:-4]
            out.append((name, when.group(1).strip() if when else ""))
    return out


def _published(text: str) -> date | None:
    try:
        return datetime.strptime(text.split()[0], "%d.%m.%y").date()
    except (ValueError, IndexError):
        return None


def _closed(docs: list, today: date) -> bool:
    """Этап закрыт: итоговая классификация гонки вышла больше FRESH_DAYS дней назад."""
    days = [_published(p) for t, p in docs if "final race classification" in _norm(t)]
    return any(d is not None and (today - d).days > FRESH_DAYS for d in days)


def fetch_documents(seasons, offline: bool = False) -> dict:
    """{год: {этап: [[заголовок, дата публикации], …]}} — из кэша и с fia.com."""
    today = date.today()
    out, session, season_ids = {}, None, None
    for year in [s for s in seasons if s >= FIRST_SEASON]:
        path = CACHE_DIR / f"{year}.json"
        cached = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}
        out[year] = cached
        if offline or (cached and year < today.year):  # прошлый сезон скачан целиком — он уже не меняется
            continue
        try:
            if session is None:
                session = requests.Session()
                session.headers["User-Agent"] = USER_AGENT
                season_ids = {int(y): sid for sid, y in re.findall(r"/season/(season-(\d{4})-\d+)", _get(session, SEASONS_PAGE))}
            if year not in season_ids:
                log.warning("FIA: нет раздела документов сезона %s", year)
                continue
            sid = season_ids[year]
            season_html = _get(session, f"{BASE}/documents/championships/fia-formula-one-world-championship-14/season/{sid}")
            for link in sorted(set(re.findall(rf'value="(/documents/[^"]*/season/{sid}/event/[^"]+)"', season_html))):
                name = unquote(link.rsplit("/event/", 1)[1])
                if "�" in name:  # часть адресов закодирована в latin-1 («S%E3o Paulo»)
                    name = unquote(link.rsplit("/event/", 1)[1], encoding="latin-1")
                if name in cached and _closed(cached[name], today):
                    continue
                cached[name] = _documents(_get(session, BASE + link))
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(json.dumps(cached, ensure_ascii=False, indent=1), encoding="utf-8")
            log.info("FIA: документы сезона %s — этапов %s", year, len(cached))
        except requests.RequestException as exc:
            log.warning("FIA: не удалось скачать документы %s (%s), беру сохранённые", year, exc)
    return out


def _norm(text: str) -> str:
    return re.sub(r"\s+", " ", text.replace("_", " ")).strip().lower()


def _event_key(name: str) -> str:
    """Название этапа без «Grand Prix», цифр и диакритики: «São Paulo Grand Prix» → «sao paulo»."""
    ascii_name = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode().lower()
    key = " ".join(w for w in re.findall(r"[a-z]+", ascii_name) if w not in _DROP_WORDS)
    return _ALIASES.get(key, key)


def _match_round(event: str, rounds: dict):
    """Этап календаря по названию у FIA: точное совпадение, иначе больше половины общих слов."""
    key = _event_key(event)
    if key in rounds:
        return rounds[key]
    words = set(key.split())
    best = max(rounds, key=lambda k: len(words & set(k.split())) / len(words | set(k.split())), default=None)
    if best and len(words & set(best.split())) / len(words | set(best.split())) >= 0.5:
        return rounds[best]
    return None


def collision_verdicts(documents: dict, races: pd.DataFrame, results: pd.DataFrame) -> pd.DataFrame:
    """Наказания за столкновения: season, round, session (R/S), driver_id, other_driver_id (если назван).

    races — season, round, race_name, date, has_sprint; results — номера машин пилотов на этапе.
    """
    numbers = results.dropna(subset=["number"]).astype({"number": int})
    car = {(int(s), int(r), int(n)): d for s, r, n, d in
           zip(numbers["season"], numbers["round"], numbers["number"], numbers["driver_id"])}
    rows = []
    for year, events in documents.items():
        season_races = races[races["season"] == year]
        rounds = {_event_key(n): (int(r), d, bool(sp)) for n, r, d, sp in
                  zip(season_races["race_name"], season_races["round"], season_races["date"], season_races["has_sprint"])}
        for event, docs in events.items():
            if "test" in event.lower():
                continue
            match = _match_round(event, rounds)
            if match is None:
                log.info("FIA: этап «%s» %s не найден в календаре (отменён?)", event, year)
                continue
            rnd, race_day, has_sprint = match
            race_day = date.fromisoformat(race_day)
            for title, published in docs:
                text = _norm(title)
                verdict = _VERDICT.search(text)
                day = _published(published)
                if not verdict or _NOT_GUILTY.search(text) or day is None:
                    continue
                gap = (day - race_day).days
                session = "R" if gap >= 0 else "S" if gap == -1 and has_sprint else None
                driver = car.get((year, rnd, int(verdict.group(1))))
                if session is None or driver is None:
                    continue
                other = _OTHER_CAR.search(verdict.group(2))
                rows.append({"season": year, "round": rnd, "session": session, "driver_id": driver,
                             "other_driver_id": car.get((year, rnd, int(other.group(1)))) if other else None,
                             "title": title})
    return pd.DataFrame(rows, columns=["season", "round", "session", "driver_id", "other_driver_id", "title"])
