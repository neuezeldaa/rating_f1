"""Краткие биографии пилотов из Википедии: вводный абзац статьи (русской, если она есть).

Ссылку на статью даёт Jolpica (поле url пилота — английская Википедия), русская статья
находится по межъязыковой ссылке. Запросы идут через API MediaWiki пачками, ответы
кэшируются в data/raw/wiki/bios.json и обновляются раз в 30 дней (или с --refresh).
Текст Википедии распространяется по лицензии CC BY-SA 4.0: на странице рядом с ним
ссылка на статью и на лицензию.

Скачанный текст — только данные: на странице он выводится как текст, не как разметка.
"""
from __future__ import annotations

import json
import logging
import re
import time
import unicodedata
from datetime import date
from urllib.parse import quote, unquote

import pandas as pd
import requests

from ..config import RAW

CACHE = RAW / "wiki" / "bios.json"
MAX_AGE_DAYS = 30
MAX_CHARS = 520  # три-четыре строки в карточке пилота
USER_AGENT = "rating-f1/0.1 (personal F1 driver rating project)"
EN_ARTICLE = re.compile(r"^https?://en\.wikipedia\.org/wiki/(.+)$")
log = logging.getLogger(__name__)


def _api(session: requests.Session, lang: str, params: dict) -> dict:
    """Один запрос к API MediaWiki; при перегрузке — повтор с паузой."""
    params = {"action": "query", "format": "json", "formatversion": 2, **params}
    for attempt in range(5):
        resp = session.get(f"https://{lang}.wikipedia.org/w/api.php", params=params, timeout=30)
        if resp.status_code not in (429, 503):
            break
        time.sleep(2 ** attempt)
    resp.raise_for_status()
    return resp.json()


def _resolve(query: dict, titles: list) -> dict:
    """Запрошенное название → итоговое (после нормализации и перенаправлений)."""
    final = {t: t for t in titles}
    for step in ("normalized", "redirects"):
        moves = {m["from"]: m["to"] for m in query.get(step, [])}
        final = {t: moves.get(f, f) for t, f in final.items()}
    return final


def _ru_titles(session: requests.Session, titles: list) -> dict:
    """Английское название статьи → русское (или None, если русской статьи нет)."""
    out = {}
    for i in range(0, len(titles), 50):
        batch = titles[i:i + 50]
        query = _api(session, "en", {"prop": "langlinks", "lllang": "ru", "lllimit": "max", "redirects": 1,
                                     "titles": "|".join(batch)}).get("query", {})
        links = {page["title"]: link.get("title") or link.get("*")
                 for page in query.get("pages", []) for link in page.get("langlinks", [])}
        final = _resolve(query, batch)
        out.update({t: links.get(final[t]) for t in batch})
    return out


def _extracts(session: requests.Session, lang: str, titles: list) -> dict:
    """Название → (вводная часть статьи простым текстом, адрес статьи)."""
    out = {}
    for i in range(0, len(titles), 20):  # больше 20 вводных частей за запрос API не отдаёт
        batch = titles[i:i + 20]
        params = {"prop": "extracts|info", "exintro": 1, "explaintext": 1, "exlimit": 20, "inprop": "url",
                  "redirects": 1, "titles": "|".join(batch)}
        pages, final = {}, None
        while True:
            data = _api(session, lang, params)
            query = data.get("query", {})
            final = final or _resolve(query, batch)
            for page in query.get("pages", []):
                rec = pages.setdefault(page["title"], {})
                rec.update({k: page[k] for k in ("extract", "fullurl") if page.get(k)})
            if "continue" not in data:
                break
            params = {**params, **data["continue"]}
        for title in batch:
            rec = pages.get(final[title], {})
            if rec.get("extract"):
                out[title] = (rec["extract"], rec.get("fullurl"))
    return out


def _fetch(urls: dict) -> dict:
    """Скачать вводные абзацы для пилотов {пилот: ссылка на английскую статью}."""
    session = requests.Session()
    session.headers["User-Agent"] = USER_AGENT
    en = {d: unquote(m.group(1)).replace("_", " ") for d, u in urls.items() if (m := EN_ARTICLE.match(u))}
    ru_title = _ru_titles(session, sorted(set(en.values())))
    ru_text = _extracts(session, "ru", sorted({t for t in ru_title.values() if t}))
    en_text = _extracts(session, "en", sorted({t for t in en.values() if ru_title.get(t) not in ru_text}))
    today = date.today().isoformat()
    out = {}
    for driver, title in en.items():
        ru = ru_title.get(title)
        if ru in ru_text:
            (text, url), lang, page = ru_text[ru], "ru", ru
        elif title in en_text:
            (text, url), lang, page = en_text[title], "en", title
        else:
            continue
        if not (url or "").startswith(f"https://{lang}.wikipedia.org/"):
            url = f"https://{lang}.wikipedia.org/wiki/{quote(page.replace(' ', '_'))}"
        out[driver] = {"source": urls[driver], "lang": lang, "url": url, "extract": text, "fetched": today}
    return out


def _clean(text: str) -> str:
    """Вводная часть одной строкой, без ударений и пустых скобок (на месте произношения и аудио).

    Первый абзац у русских статей обычно короткий (имя, гражданство, команда), а титулы
    и достижения — во втором, поэтому абзацы склеиваются, а длину режет _short.
    """
    first = " ".join(p.strip() for p in text.split("\n") if p.strip())
    first = unicodedata.normalize("NFC", unicodedata.normalize("NFD", first).replace("́", ""))
    first = re.sub(r"\(\s*[;,]?\s*\)", "", first)
    first = re.sub(r"\(\s+", "(", first)
    first = re.sub(r"\s+([,.;:)])", r"\1", first)
    return re.sub(r"\s{2,}", " ", first).strip()


def _short(text: str, limit: int = MAX_CHARS) -> str:
    """Первые предложения абзаца, не длиннее limit. Точки внутри скобок («род.», «нидерл.») не конец."""
    sentences, depth, start = [], 0, 0
    for i, ch in enumerate(text):
        if ch in "([":
            depth += 1
        elif ch in ")]":
            depth = max(0, depth - 1)
        elif ch in ".!?" and depth == 0 and text[i + 1:i + 2] == " " and text[i + 2:i + 3].isupper():
            sentences.append(text[start:i + 1].strip())
            start = i + 2
    if text[start:].strip():
        sentences.append(text[start:].strip())
    out = ""
    for sentence in sentences:
        if out and len(out) + 1 + len(sentence) > limit:
            break
        out = f"{out} {sentence}".strip()
    if len(out) > limit:  # первое предложение само длиннее лимита
        out = out[:limit].rsplit(" ", 1)[0].rstrip(",;:—– ") + "…"
    return out


def driver_bios(drivers: pd.DataFrame, offline: bool = False, refresh: bool = False) -> dict:
    """{пилот: {"text", "url", "lang"}}: краткая биография и ссылка на статью. Без сети — из кэша."""
    cache = json.loads(CACHE.read_text(encoding="utf-8")) if CACHE.exists() else {}
    if "wiki_url" not in drivers:
        log.warning("Википедия: в таблице пилотов нет ссылок на статьи — запустите пайплайн без --offline")
        return {}
    urls = {d: u for d, u in zip(drivers["driver_id"], drivers["wiki_url"]) if isinstance(u, str)}
    today = date.today()
    stale = [d for d, u in urls.items()
             if refresh or d not in cache or cache[d]["source"] != u
             or (today - date.fromisoformat(cache[d]["fetched"])).days > MAX_AGE_DAYS]
    if stale and not offline:
        try:
            fetched = _fetch({d: urls[d] for d in stale})
            cache.update(fetched)
            CACHE.parent.mkdir(parents=True, exist_ok=True)
            CACHE.write_text(json.dumps(cache, ensure_ascii=False, indent=1), encoding="utf-8")
            log.info("Википедия: биографии %s пилотов (русских статей %s, английских %s)", len(fetched),
                     sum(r["lang"] == "ru" for r in fetched.values()), sum(r["lang"] == "en" for r in fetched.values()))
        except requests.RequestException as exc:
            log.warning("Википедия: не удалось скачать биографии (%s), беру сохранённые", exc)
    return {d: {"text": _short(_clean(rec["extract"])), "url": rec["url"], "lang": rec["lang"]}
            for d, rec in cache.items() if d in urls and rec.get("extract")}
