"""Классификация статусов финиша: кто виноват в сходе.

finished      — финишировал (в том числе с отставанием на круги);
driver_error  — авария или разворот: по умолчанию считаем ошибкой пилота;
mechanical    — техника: такой результат ничего не говорит о пилоте;
unclear       — статус не объясняет причину (Collision, Retired и т. п.);
disqualified  — дисквалификация (обычно техническая, то есть вина команды);
victim        — только для ручных правок: пострадал от чужой ошибки.
"""
from __future__ import annotations

import re

FINISHED = "finished"
DRIVER_ERROR = "driver_error"
MECHANICAL = "mechanical"
UNCLEAR = "unclear"
DISQUALIFIED = "disqualified"
VICTIM = "victim"

CATEGORIES = (FINISHED, DRIVER_ERROR, MECHANICAL, UNCLEAR, DISQUALIFIED, VICTIM)

_FINISHED_RE = re.compile(r"^(finished|lapped|\+\d+ laps?)$", re.IGNORECASE)
_DRIVER_ERROR = {"accident", "spun off", "accident damage", "accident on formation lap"}
_DISQUALIFIED = {
    "disqualified",
    "excluded",
    "illegal skid block wear",
    "car underweight",
    "underweight",
    "fuel flow",
    "illegal floor",
}
# Столкновение может быть и по своей, и по чужой вине — без разбора инцидента не решить.
_UNCLEAR = {
    "collision",
    "collision damage",
    "damage",
    "retired",
    "withdrew",
    "did not start",
    "not classified",
    "illness",
    "unwell",
    "injured",
    "injury",
    "debris",
    "accident in qualifying",
    "car damaged in qualifying",
}
_COLLISION = {"collision", "collision damage"}
# Не вышел на старт — это не старт: снялся (Гран-при США 2005 — 14 машин), не стартовал, не прошёл
# квалификацию. В статистику пилота такие записи не идут.
_NOT_STARTED = {"withdrew", "did not start", "did not qualify", "did not prequalify"}
NOT_STARTED_F1DB = {"DNS", "DNQ", "DNPQ", "DNP"}  # то же по F1DB (positionText)


def did_not_start(status) -> bool:
    return isinstance(status, str) and status.strip().lower() in _NOT_STARTED


def is_collision(status) -> bool:
    """Сход после столкновения с другой машиной (виновник по статусу неизвестен)."""
    return isinstance(status, str) and status.strip().lower() in _COLLISION


def classify_status(status) -> str:
    """Категория по текстовому статусу Jolpica; всё неизвестное считаем техникой."""
    text = (status or "").strip().lower()
    if not text:
        return UNCLEAR
    if _FINISHED_RE.match(text):
        return FINISHED
    if text in _DRIVER_ERROR:
        return DRIVER_ERROR
    if text in _DISQUALIFIED:
        return DISQUALIFIED
    if text in _UNCLEAR:
        return UNCLEAR
    return MECHANICAL
