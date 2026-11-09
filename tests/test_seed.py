"""Архив начальных данных: в общих файлах-словарях дописываются недостающие и более свежие записи."""
import json

from rating_f1.seed import merge_json


def test_merge_keeps_newer_and_adds_missing(tmp_path):
    target = tmp_path / "bios.json"
    target.write_text(json.dumps({
        "a": {"fetched": "2026-11-01", "extract": "old"},              # в архиве свежее — заменится
        "c": {"fetched": "2026-11-20", "extract": "kept"},             # в кэше свежее — останется
    }), encoding="utf-8")
    seed = {
        "a": {"fetched": "2026-11-09", "extract": "new", "photo": None},
        "b": {"fetched": "2026-11-09", "extract": "added"},
        "c": {"fetched": "2026-11-09", "extract": "older"},
    }
    assert merge_json(target, json.dumps(seed).encode("utf-8")) == 2
    out = json.loads(target.read_text(encoding="utf-8"))
    assert out["a"]["extract"] == "new" and out["b"]["extract"] == "added" and out["c"]["extract"] == "kept"


def test_merge_ignores_broken_files(tmp_path):
    target = tmp_path / "races.json"
    target.write_text("not json", encoding="utf-8")
    assert merge_json(target, b'{"2018-1": {"fetched": "2026-11-08"}}') == 0
    assert target.read_text(encoding="utf-8") == "not json"
