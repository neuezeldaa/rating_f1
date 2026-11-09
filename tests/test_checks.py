"""Проверки перед публикацией ловят сломанные данные."""
from datetime import date

from rating_f1.checks import problems


def _entry(i, rating):
    return {"id": f"d{i}", "eligible": True, "rank": i + 1, "rating": rating, "s": {"results": rating}}


def _good():
    season = [_entry(i, 90 - i) for i in range(20)]
    meta = {"data_through": {"date": "2026-11-08", "race_name": "X", "season": 2026}, "period": [2025, 2026],
            "draws": 200, "validation": {"groups": {"overall": {"reliability": 0.93, "moved": 0.65}},
                                         "expert_spearman": 0.9}}
    scopes = {"all": [_entry(i, 90 - i / 2) for i in range(60)], "2025": season, "2026": season}
    draws = {k: {} for k in scopes}
    return meta, scopes, draws


def test_good_data_passes():
    assert problems(*_good(), today=date(2026, 11, 9)) == []


def test_broken_data_is_caught():
    meta, scopes, draws = _good()
    scopes["2026"] = scopes["2026"][:5]                     # сезон почти пустой
    scopes["all"][0]["rating"] = float("nan")               # пустой балл
    del scopes["2025"]                                      # пропал сезон
    meta["validation"]["groups"]["overall"]["moved"] = 0.1  # модель перестала «следовать за пилотом»
    found = " | ".join(problems(meta, scopes, draws, today=date(2026, 11, 9)))
    for text in ("2026: пилотов в пуле 5", "балл вне 0–100", "нет охватов: 2025", "после смены команды"):
        assert text in found


def test_rounds_must_end_at_the_final_rating():
    import base64

    import numpy as np

    from rating_f1.by_round import encode
    from rating_f1.checks import rounds_problems

    scopes = {"all": [], "2026": [{"id": "a", "g": {"results": 0.5}}, {"id": "b", "g": {"results": -0.5}}]}
    z = np.array([[[0.1, 0.5]], [[np.nan, -0.5]]])       # «b» пропустил первый этап
    rounds = encode({"2026": {"rounds": [1, 2], "ids": ["a", "b"], "groups": ["results"], "z": z}})
    assert rounds_problems(rounds, scopes) == []
    rounds["2026"]["z"] = base64.b64encode(np.array([100, 500, -32768, 300], dtype="<i2").tobytes()).decode()
    assert any("расходится" in p for p in rounds_problems(rounds, scopes))   # «b»: 0,3 вместо −0,5
    assert any("нет рейтинга по ходу сезона" in p for p in rounds_problems({}, scopes))
