"""Сравнение внутри сезонов (эпохи) и уровень машины."""
import numpy as np
import pandas as pd

from rating_f1.composite import Ruler, _across_seasons, _grade, _season_scale
from rating_f1.features import car_level
from rating_f1.features.car_level import car_levels
from rating_f1.ingest.fia import _VERDICT


def _season(shift: float):
    """Сезон из пяти пилотов: обгоны за гонку, сдвинутые на shift (эпоха с другим числом обгонов)."""
    idx = [f"d{i}" for i in range(5)]
    raw = pd.DataFrame({"overtakes": np.arange(5, dtype=float) + shift}, index=idx)
    counts = pd.DataFrame({"starts": [20.0] * 5, "ot_n": [20.0] * 5}, index=idx)
    pool = np.ones(5, dtype=bool)
    *_, parts = _grade(raw, counts, pool, {"racecraft": 1.0})
    return raw, counts, Ruler(pool=pd.Series(pool, index=idx), **parts)


def test_era_shift_does_not_change_relative_values():
    a = _season_scale(*_season(0.0))
    b = _season_scale(*_season(10.0))            # та же картина, но обгонов на 10 больше за гонку
    pd.testing.assert_frame_equal(a[0], b[0])
    period = _across_seasons([a, b])
    assert period.loc["d4", "overtakes"] > 0 > period.loc["d0", "overtakes"]
    assert np.isclose(period["overtakes"].mean(), 0.0)


def test_best_car_lead_and_half_skill():
    pace = pd.DataFrame({"season": [2023] * 4, "round": [1] * 4, "driver_id": ["v", "p", "h", "r"],
                         "pace_gap": [-1.2, -0.7, -0.5, -0.4]})
    teams = pd.DataFrame({"season": [2023] * 4, "round": [1] * 4, "driver_id": ["v", "p", "h", "r"],
                          "constructor_id": ["rbr", "rbr", "merc", "merc"]})
    skill = pd.DataFrame({"driver_id": ["v", "p", "h", "r"], "season": [2023] * 4, "skill": [0.7, 0.3, 0.1, -0.1]})
    old = car_level.SKILL_SHARE
    try:
        car_level.SKILL_SHARE = 0.5
        lv = car_levels(pace, teams, skill).set_index("constructor_id")
    finally:
        car_level.SKILL_SHARE = old
    # с половиной навыка: rbr = (−1,2+0,35 −0,7+0,15)/2 = −0,70; merc = (−0,5+0,05 −0,4−0,05)/2 = −0,45
    assert lv.loc["rbr", "car_gap"] == 0
    assert np.isclose(lv.loc["merc", "car_gap"], 0.25)
    assert np.isclose(lv.loc["rbr", "lead"], 0.25) and np.isnan(lv.loc["merc", "lead"])


def test_fia_verdict_titles():
    m = _VERDICT.search("offence - car 4 - causing a collision with car 81")
    assert m and m.group(1) == "4"
    assert _VERDICT.search("infringement - car 23 (incident with car 10)")
    assert not _VERDICT.search("decision - car 4 - causing a collision")
    assert not _VERDICT.search("offence - car 4 - speeding in the pit lane")


def test_damaged_race_does_not_define_the_car():
    # Один этап с повреждённой машиной (+1,5% к обычному темпу) не должен читаться как темп машины
    import numpy as np
    import pandas as pd

    from rating_f1.features.car_level import _despike

    rows = [(2021, r, team, -1.0 + (1.5 if (team, r) == ("red", 6) else 0.0) + 0.05 * ((r + i) % 3))
            for r in range(1, 13) for i, team in enumerate(("red", "blue", "green"))]
    car = pd.DataFrame(rows, columns=["season", "round", "constructor_id", "level"])
    out = _despike(car, "constructor_id")
    spike = out[(car["constructor_id"] == "red") & (car["round"] == 6)][0]
    assert spike < -0.5                                   # было +0,5, осталось рядом с медианой −1
    same = (car["constructor_id"] != "red") | (car["round"] != 6)
    assert np.allclose(out[same.to_numpy()], car.loc[same, "level"], atol=0.11)


def test_dotd_is_season_only():
    from rating_f1.composite import FEATURES, SEASON_ONLY, _graded
    import pandas as pd

    assert SEASON_ONLY == ["dotd_rate"] and any(f.id == "dotd_rate" for f in FEATURES)
    raw = pd.DataFrame({"ppr": [1.0], "dotd_rate": [0.2]}, index=["a"])
    relative = pd.DataFrame({"ppr": [0.5], "dotd_rate": [1.0]}, index=["a"])
    assert "dotd_rate" in _graded(raw, None)               # сезон: признак есть
    assert "dotd_rate" not in _graded(raw, relative)       # общая сводка: признака нет


def test_short_season_is_shrunk_to_typical_driver():
    # Пилот с 6 гонками без очков не должен выглядеть как полный сезон с очками в середине пелотона
    import numpy as np
    import pandas as pd

    from rating_f1.composite import _grade

    ppr = [16.0, 14.0, 12.0, 9.0, 6.0] + [3.0] * 10 + [1.0] * 4 + [0.0]
    starts = [24] * 19 + [6]
    raw = pd.DataFrame({"ppr": ppr, "win_rate": [0.4, 0.3, 0.2] + [0.0] * 17}, index=[f"d{i}" for i in range(20)])
    counts = pd.DataFrame({"starts": starts}, index=raw.index)
    feats, _, z, _, _, parts = _grade(raw, counts, np.ones(20, bool), {"results": 1.0})
    i = [f.id for f in feats]
    short, midfield = z[19], z[5]
    assert short[i.index("win_rate")] <= midfield[i.index("win_rate")] + 1e-9   # без воображаемых побед
    assert short[i.index("ppr")] < midfield[i.index("ppr")]
    assert parts["prior"][i.index("win_rate")] == 0.0 and parts["shrink_to"][i.index("win_rate")] > 0
