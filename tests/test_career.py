"""Карьера с дебюта: сезоны в F1, титулы, сезоны впереди напарника."""
import pandas as pd

from rating_f1.features.career import career_facts


def _results(rows):
    return pd.DataFrame(rows, columns=["year", "raceId", "driverId", "constructorId", "positionText"])


def test_career_facts():
    rows = []
    race_id = 0
    for year, n_races in ((2001, 4), (2002, 4)):
        for _ in range(n_races):
            race_id += 1
            rows += [(year, race_id, "a", "red", "1"), (year, race_id, "b", "red", "2")]
            # «c» в 2002 году провёл половину сезона за другую команду, и один раз не стартовал
            if year == 2002 and race_id % 2 == 0:
                rows.append((year, race_id, "c", "blue", "5" if race_id != 8 else "DNS"))
    standings = pd.DataFrame({
        "year": [2001, 2001, 2002, 2002, 2002], "driverId": ["a", "b", "a", "b", "c"],
        "positionDisplayOrder": [1, 2, 2, 1, 3], "championshipWon": [True, False, False, True, False],
    })
    facts = career_facts(_results(rows), standings)
    assert facts.loc["a", "debut"] == 2001
    assert facts.loc["a", "seasons"] == 2.0
    assert facts.loc["c", "seasons"] == 0.25        # 1 старт из 4 гонок сезона (второй — DNS)
    assert facts.loc["a", "titles"] == 1 and facts.loc["a", "title_years"] == "2001"
    assert facts.loc["a", "ahead"] == 1 and facts.loc["a", "compared"] == 2   # 2001 впереди, 2002 позади
    assert facts.loc["c", "compared"] == 0           # меньше трети гонок за команду — не сравниваем
