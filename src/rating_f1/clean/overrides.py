"""Ручные правки из annotations/overrides.yaml."""
from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

import yaml

from .status import CATEGORIES


@dataclass
class Overrides:
    # (сезон, этап, сессия, пилот) -> категория статуса
    status: dict = field(default_factory=dict)
    # (сезон, этап, пилот): пара с этим пилотом не участвует в сравнении квалификаций
    exclude_quali: set = field(default_factory=set)
    # (сезон, этап, сессия, пилот): дуэль с этим пилотом не учитывается
    exclude_race: set = field(default_factory=set)


def _drivers(item: dict) -> list[str]:
    if "drivers" in item:
        return list(item["drivers"])
    return [item["driver"]]


def load_overrides(path: Path) -> Overrides:
    if not path.exists():
        return Overrides()
    raw = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    result = Overrides()
    for item in raw.get("status_overrides") or []:
        category = item["category"]
        if category not in CATEGORIES:
            raise ValueError(f"overrides.yaml: неизвестная категория {category!r}, допустимы {CATEGORIES}")
        for driver in _drivers(item):
            key = (int(item["season"]), int(item["round"]), item.get("session", "R"), driver)
            result.status[key] = category
    for item in raw.get("exclude_quali") or []:
        for driver in _drivers(item):
            result.exclude_quali.add((int(item["season"]), int(item["round"]), driver))
    for item in raw.get("exclude_race") or []:
        for driver in _drivers(item):
            result.exclude_race.add((int(item["season"]), int(item["round"]), item.get("session", "R"), driver))
    return result
