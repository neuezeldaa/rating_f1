"""Короткий отчёт о прогоне в Markdown: по какой гонке данные, топ и проверки рейтинга.

Для страницы запуска в GitHub Actions (Summary):
    python -I -m rating_f1.report >> "$GITHUB_STEP_SUMMARY"

Читает то, что пайплайн выгрузил для сайта (web/data), поэтому запускается после него.
"""
from __future__ import annotations

import json
import sys

from .config import WEB_DATA

PERIOD = "all"
TOP = 10


def _load(name: str):
    return json.loads((WEB_DATA / f"{name}.json").read_text(encoding="utf-8"))


def _num(x, digits=2) -> str:
    return "—" if x is None else f"{x:.{digits}f}".replace("-", "−")


def _pairs(n: int) -> str:
    """«1 пара», «2 пары», «5 пар»."""
    word = "пара" if n % 10 == 1 and n % 100 != 11 else "пары" if 2 <= n % 10 <= 4 and not 12 <= n % 100 <= 14 else "пар"
    return f"{n} {word}"


def _top(entries: list, drivers: dict) -> list:
    ranked = sorted((e for e in entries if e["eligible"]), key=lambda e: -e["rating"])[:TOP]
    lines = ["| Место | Пилот | Рейтинг |", "|---:|---|---:|"]
    for e in ranked:
        name = drivers.get(e["id"], {}).get("name", e["id"])
        lines.append(f"| {e['rank']} | {name} | {e['rating']:.1f} |")
    return lines


def report() -> str:
    meta, scopes, drivers = _load("meta"), _load("scopes"), _load("drivers")
    first, last = meta["period"]
    through = meta["data_through"]
    out = [f"## Рейтинг пилотов F1 {first}–{last}",
           f"Данные по {through['race_name']} {through['season']} ({through['date']}).", ""]

    out += [f"### Общий рейтинг {first}–{last}", *_top(scopes[PERIOD], drivers), ""]
    season = str(through["season"])
    if season in scopes:
        out += [f"### Сезон {season}", *_top(scopes[season], drivers), ""]

    checks = meta.get("validation")
    if checks:
        names = {g["id"]: g["name"] for g in meta["groups"]}
        out += ["### Проверки рейтинга",
                f"Повторяемость внутри сезона; связь баллов в соседних сезонах после смены команды "
                f"({_pairs(checks['n_moved'])}) и у оставшихся ({_pairs(checks['n_stayed'])}).", "",
                "| Группа | Повторяемость | После смены команды | Остались |", "|---|---:|---:|---:|"]
        for key, row in checks["groups"].items():
            label = "**Итог**" if key == "overall" else names.get(key, key)
            out.append(f"| {label} | {_num(row['reliability'])} | {_num(row['moved'])} | {_num(row['stayed'])} |")
        out.append("")

    extra = []
    if checks and checks.get("expert_spearman") is not None:
        extra.append(f"сверка с опросами руководителей команд — корреляция мест {_num(checks['expert_spearman'])}")
    bt = meta.get("backtest")
    if bt:
        q, r = bt["quali"]["new_pairs"], bt["race"]["new_pairs"]
        extra.append(f"модель напарников на новых парах: квала {100 * q['season_sign_accuracy']:.0f}% "
                     f"из {q['season_pairs']}, гонка {100 * r['season_accuracy']:.0f}% из {r['season_pairs']}")
    if extra:
        out.append("Также: " + "; ".join(extra) + ".")
    return "\n".join(out) + "\n"


def main() -> None:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    sys.stdout.write(report())


if __name__ == "__main__":
    main()
