"""Фото пилотов из Википедии: только свободные лицензии, адреса только Викисклада, подпись без HTML."""
from rating_f1.ingest.wiki import _plain, photo_record


def _info(**changes):
    info = {
        "thumburl": "https://thumb.wikimedia.org/wikipedia/commons/thumb/a/ab/X.jpg/250px-X.jpg",
        "descriptionurl": "https://commons.wikimedia.org/wiki/File:X.jpg",
        "extmetadata": {
            "Artist": {"value": '<a href="//commons.wikimedia.org/wiki/User:Morio" title="User:Morio">Morio</a>'},
            "LicenseShortName": {"value": "CC BY-SA 3.0"},
            "LicenseUrl": {"value": "http://creativecommons.org/licenses/by-sa/3.0/"},
        },
    }
    for key, value in changes.items():
        if key in info:
            info[key] = value
        else:
            info["extmetadata"][key] = {"value": value}
    return info


def test_free_photo_is_kept_with_plain_author():
    rec = photo_record(_info())
    assert rec["author"] == "Morio"
    assert rec["license"] == "CC BY-SA 3.0"
    assert rec["license_url"].startswith("http://creativecommons.org/")
    assert photo_record(_info(LicenseShortName="Public domain")) is not None
    assert photo_record(_info(LicenseShortName="OGL 3")) is not None


def test_non_free_or_foreign_photo_is_dropped():
    assert photo_record(_info(LicenseShortName="Fair use")) is None
    assert photo_record(_info(thumburl="https://example.com/x.jpg")) is None
    assert photo_record(_info(descriptionurl="https://example.com/wiki/File:X.jpg")) is None


def test_license_link_must_be_http():
    assert photo_record(_info(LicenseUrl="javascript:alert(1)"))["license_url"] == ""


def test_plain_text():
    assert _plain("<b>Original:</b> A &amp; B") == "Original: A & B"
    long = _plain("слово " * 40)
    assert len(long) <= 80 and long.endswith("…")
