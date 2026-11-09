"""Проверки данных сайта перед публикацией: python -I -m rating_f1.checks

Сайт обновляется сам (GitHub Actions), поэтому перед выкладкой проверяем то, что увидит
посетитель: все ли сезоны на месте, баллы в пределах шкалы, места без пропусков, есть ли
пересчёты для вилок, не провалились ли проверки модели. Если источник поменяет формат или
расчёт сломается, проверка остановит выкладку — на сайте останется прошлая версия.
"""
from __future__ import annotations

import base64
import json
import math
import sys
from datetime import date

import numpy as np

from .config import WEB_DATA

SEASON_DRIVERS = (15, 32)   # пилотов в пуле сезона — с запасом на подмены и малые сезоны
PERIOD_DRIVERS = 50         # в общей сводке — не меньше
MAX_DATA_AGE_DAYS = 200     # последняя гонка не старше (межсезонье — около 100 дней)
# Нижние границы проверок модели (сейчас: повторяемость итога 0,93, после смены команды 0,65,
# сверка с экспертами 0,90): ниже — расчёт, скорее всего, сломан.
MIN_RELIABILITY = 0.85
MIN_MOVED = 0.40
MIN_EXPERTS = 0.60


def _load(name: str):
    return json.loads((WEB_DATA / name).read_text(encoding="utf-8"))


def _finite(x) -> bool:
    return isinstance(x, (int, float)) and math.isfinite(x)


def problems(meta: dict, scopes: dict, draws: dict | None, today: date | None = None) -> list[str]:
    """Список найденных проблем; пустой — можно публиковать."""
    out = []
    today = today or date.today()
    through = meta.get("data_through") or {}
    try:
        last = date.fromisoformat(through.get("date", ""))
        if last > today:
            out.append(f"последняя гонка в будущем: {last}")
        elif (today - last).days > MAX_DATA_AGE_DAYS:
            out.append(f"данные устарели: последняя гонка {last}")
    except ValueError:
        out.append("нет даты последней гонки")

    first, last_season = meta.get("period", [None, None])
    expected = {"all"} | {str(y) for y in range(first, last_season + 1)} if first and last_season else {"all"}
    missing = expected - set(scopes)
    if missing:
        out.append(f"нет охватов: {', '.join(sorted(missing))}")

    for key, entries in scopes.items():
        pool = [e for e in entries if e.get("eligible")]
        lo, hi = (PERIOD_DRIVERS, 10_000) if key == "all" else SEASON_DRIVERS
        if not lo <= len(pool) <= hi:
            out.append(f"{key}: пилотов в пуле {len(pool)} (ожидается {lo}–{hi if hi < 10_000 else '…'})")
        bad = [e["id"] for e in pool if not (_finite(e.get("rating")) and 0 <= e["rating"] <= 100)]
        if bad:
            out.append(f"{key}: балл вне 0–100 или пустой у {', '.join(bad[:5])}")
        ranks = sorted(e.get("rank") for e in pool if isinstance(e.get("rank"), int))
        if len(ranks) != len(pool) or (ranks and (ranks[0] != 1 or ranks[-1] > len(pool))):
            out.append(f"{key}: места с пропусками")
        empty = [e["id"] for e in pool if not all(_finite(v) for v in (e.get("s") or {}).values())]
        if empty:
            out.append(f"{key}: пустые баллы групп у {', '.join(empty[:5])}")
        if draws is not None and meta.get("draws") and key not in draws:
            out.append(f"{key}: нет пересчётов для вилок")

    groups = (meta.get("validation") or {}).get("groups") or {}
    overall = groups.get("overall") or {}
    if not _finite(overall.get("reliability")) or overall["reliability"] < MIN_RELIABILITY:
        out.append(f"повторяемость итога {overall.get('reliability')} < {MIN_RELIABILITY}")
    if not _finite(overall.get("moved")) or overall["moved"] < MIN_MOVED:
        out.append(f"итог после смены команды {overall.get('moved')} < {MIN_MOVED}")
    expert = (meta.get("validation") or {}).get("expert_spearman")
    if _finite(expert) and expert < MIN_EXPERTS:
        out.append(f"сверка с экспертами {expert} < {MIN_EXPERTS}")
    return out


def alltime_problems(ever: dict) -> list[str]:
    """Рейтинг всех времён: пилоты на месте, баллы в шкале, проверки модели не провалены."""
    out = []
    people = ever.get("drivers") or []
    if len(people) < 100:
        out.append(f"все времена: пилотов {len(people)} (ожидается от 100)")
    if any(not (_finite(d.get("rating")) and 0 <= d["rating"] <= 100) for d in people):
        out.append("все времена: балл вне 0–100 или пустой")
    check = ever.get("validation") or {}
    if not _finite(check.get("quali")) or check["quali"] < 0.6:
        out.append(f"все времена: прогноз новых пар в квалификации {check.get('quali')} < 0.6")
    if not _finite(check.get("moved")) or check["moved"] < MIN_MOVED:
        out.append(f"все времена: итог после смены марки {check.get('moved')} < {MIN_MOVED}")
    return out


def rounds_problems(rounds: dict, scopes: dict) -> list[str]:
    """Рейтинг по ходу сезона: есть у каждого сезона, а после последнего этапа z групп совпадают
    с итоговыми (с точностью упаковки для страницы)."""
    out = []
    missing = sorted(k for k in scopes if k != "all" and k not in rounds)
    if missing:
        out.append(f"нет рейтинга по ходу сезона: {', '.join(missing)}")
    for key, d in rounds.items():
        entries = {e["id"]: e for e in scopes.get(key, [])}
        shape = (len(d["ids"]), len(d["groups"]), len(d["rounds"]))
        packed = np.frombuffer(base64.b64decode(d["z"]), dtype="<i2")
        if packed.size != math.prod(shape):
            out.append(f"{key}: по ходу сезона — неверный размер данных")
            continue
        packed = packed.reshape(shape)
        worst = 0.0
        for i, driver in enumerate(d["ids"]):
            groups = (entries.get(driver) or {}).get("g") or {}
            for j, group in enumerate(d["groups"]):
                value = packed[i, j, -1]
                if value != d["missing"] and _finite(groups.get(group)):
                    worst = max(worst, abs(value / d["scale"] - groups[group]))
        if worst > 0.01:
            out.append(f"{key}: по ходу сезона после последнего этапа расходится с итогом на {worst:.3f} z")
    return out


def main() -> None:
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8")
    meta, scopes = _load("meta.json"), _load("scopes.json")
    draws = _load("draws.json") if (WEB_DATA / "draws.json").exists() else None
    found = problems(meta, scopes, draws)
    if (WEB_DATA / "alltime.json").exists():
        found += alltime_problems(_load("alltime.json"))
    if (WEB_DATA / "by_round.json").exists():
        found += rounds_problems(_load("by_round.json"), scopes)
    if found:
        print("Проверки перед публикацией НЕ пройдены:")
        for p in found:
            print(" -", p)
        sys.exit(1)
    print(f"Проверки перед публикацией пройдены: {len(scopes)} охватов, "
          f"данные после этапа {meta['data_through']['race_name']} {meta['data_through']['season']}.")


if __name__ == "__main__":
    main()
