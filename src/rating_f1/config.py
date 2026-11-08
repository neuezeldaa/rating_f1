"""Пути и общие настройки проекта."""
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

DATA = ROOT / "data"
RAW = DATA / "raw"
JOLPICA_RAW = RAW / "jolpica"
FASTF1_CACHE = RAW / "fastf1_cache"
PROCESSED = DATA / "processed"
LAPS_DIR = PROCESSED / "laps"
DUCKDB_PATH = DATA / "f1.duckdb"
OVERRIDES_PATH = ROOT / "annotations" / "overrides.yaml"
WEB_DATA = ROOT / "web" / "data"

# Период: детальные данные по кругам (FastF1) есть с 2018 года.
FIRST_SEASON = 2018
LAST_SEASON = date.today().year

# Квалификация: гэп к напарнику больше этого (в % от времени круга) почти всегда
# означает поломку, дождь или отсутствие нормального круга, а не разницу в скорости.
QUALI_MAX_GAP_PCT = 3.0

# Вес спринта относительно гонки в гоночных дуэлях.
SPRINT_WEIGHT = 0.5

# Порог Хьюбера (в единицах шума): сессии с большим отклонением теряют вес.
HUBER_C = 1.345

# В рейтинг сезона попадают пилоты хотя бы с таким числом гонок, в общий рейтинг периода — с таким.
MIN_RACES_FOR_RANK = 5
MIN_RACES_PERIOD = 20

# Сжатие долей и средних к среднему пилоту: столько «гонок-призраков» среднего уровня
# добавляется к реальным. Пилот с 5 гонками сдвигается к среднему сильно, с 100 — почти нет.
SHRINK_RACES = 10

# Веса групп признаков в общем рейтинге (страница позволяет менять их ползунками).
WEIGHTS_SEASON = {"results": 0.22, "above_car": 0.17, "quali": 0.11, "pace": 0.11, "racecraft": 0.11,
                  "clean": 0.06, "teammate": 0.22}
WEIGHTS_PERIOD = {"results": 0.20, "above_car": 0.15, "quali": 0.10, "pace": 0.10, "racecraft": 0.10,
                  "clean": 0.05, "teammate": 0.20, "career": 0.10}

# Шкала рейтинга: 50 — средний пилот, +15 за каждое стандартное отклонение.
RATING_CENTER = 50.0
RATING_SCALE = 15.0

# Неопределённость: число выборок и ширина интервала (80% — 10-й и 90-й перцентили).
N_DRAWS = 4000
INTERVAL = 0.8
SEED = 2026
# Пересчётов общего рейтинга на перевыбранных этапах — для вилок балла и места (intervals.py).
N_BOOT = 200

# Для перевода % в секунды берём «типичный» 90-секундный круг.
REFERENCE_LAP_S = 90.0
