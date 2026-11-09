"""Архив начальных данных data/seed.zip — то, что уже не меняется.

Первый запуск на новом компьютере или в GitHub Actions после очистки кэша иначе скачивает
всё с нуля: около 260 запросов к Jolpica (с общих адресов GitHub она часто отвечает отказом),
около 190 страниц FIA, осадки для каждой гонки. В архиве — страницы Jolpica за прошлые
сезоны и годы дебюта пилотов, документы FIA за прошлые сезоны, осадки и биографии. Текущий
сезон, архивы F1DB и RaceData по-прежнему скачиваются при каждом запуске.

    python -I -m rating_f1.seed pack     # собрать архив из data/raw (после новых сезонов)
    python -I -m rating_f1.seed unpack   # дописать в data/raw недостающие файлы из архива
"""
from __future__ import annotations

import json
import logging
import sys
import zipfile
from datetime import date
from pathlib import Path

from .config import DATA, RAW

SEED = DATA / "seed.zip"
# Общие файлы-словари (запись на гонку или пилота с датой загрузки fetched): если файл уже есть
# (например, из кэша GitHub Actions), из архива дописываются недостающие записи и заменяются старые.
MERGED = {"weather/races.json", "wiki/bios.json"}
log = logging.getLogger("rating_f1")


def _newer(seed_rec, old_rec) -> bool:
    """Запись из архива свежее: скачана позже или в тот же день, но полнее (больше полей)."""
    if not (isinstance(seed_rec, dict) and isinstance(old_rec, dict)):
        return False
    a, b = str(seed_rec.get("fetched", "")), str(old_rec.get("fetched", ""))
    return a > b or (a == b and len(seed_rec) > len(old_rec))


def merge_json(target: Path, data: bytes) -> int:
    """Дописать в словарь target записи из архива, которых нет или которые там старее. → сколько записей."""
    try:
        current = json.loads(target.read_text(encoding="utf-8"))
        seed = json.loads(data.decode("utf-8"))
    except (OSError, ValueError):
        return 0
    if not isinstance(current, dict) or not isinstance(seed, dict):
        return 0
    changed = 0
    for key, rec in seed.items():
        if key not in current or _newer(rec, current[key]):
            current[key] = rec
            changed += 1
    if changed:
        target.write_text(json.dumps(current, ensure_ascii=False, indent=1), encoding="utf-8")
    return changed


def _members(today: date) -> list[Path]:
    """Файлы data/raw, которые больше не меняются (текущий сезон не берём)."""
    current = today.year
    files = []
    for path in sorted((RAW / "jolpica").glob("*/*.json")):
        folder = path.parent.name
        if folder == "drivers" or (folder.isdigit() and int(folder) < current):
            files.append(path)
    files += [p for p in sorted((RAW / "fia").glob("*.json")) if p.stem.isdigit() and int(p.stem) < current]
    files += [p for p in (RAW / "weather" / "races.json", RAW / "wiki" / "bios.json") if p.exists()]
    return files


def pack(today: date | None = None) -> None:
    files = _members(today or date.today())
    with zipfile.ZipFile(SEED, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as zf:
        for path in files:
            zf.write(path, path.relative_to(RAW).as_posix())
    log.info("Начальные данные: %s файлов, архив %.1f МБ — %s", len(files), SEED.stat().st_size / 1e6, SEED)


def unpack() -> None:
    """Дописать недостающие файлы; то, что уже есть в data/raw (свежее), не трогается.
    В общих файлах-словарях (MERGED) дописываются недостающие и более свежие записи."""
    if not SEED.exists():
        log.info("Начальные данные: архива %s нет — всё будет скачано", SEED)
        return
    root = RAW.resolve()
    added = merged = 0
    with zipfile.ZipFile(SEED) as zf:
        for name in zf.namelist():
            target = (RAW / name).resolve()
            if root not in target.parents:  # защита: только внутрь data/raw
                raise ValueError(f"seed.zip: подозрительный путь {name!r}")
            if not target.exists():
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(zf.read(name))
                added += 1
            elif name in MERGED:
                merged += merge_json(target, zf.read(name))
    log.info("Начальные данные: добавлено файлов %s из %s, записей в общих файлах — %s",
             added, len(zf.namelist()), merged)


def main(argv=None) -> None:
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8")
    command = (argv or sys.argv[1:] or ["unpack"])[0]
    {"pack": pack, "unpack": unpack}[command]()


if __name__ == "__main__":
    main()
