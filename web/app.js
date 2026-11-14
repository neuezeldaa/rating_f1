/* Рейтинг пилотов F1 — витрина.
 * Данные: window.F1_DATA из data/data.js (генерирует python -m rating_f1.pipeline).
 * В адресе хранится охват, пилот и с кем он сравнивается: #all/max_verstappen, #2026/antonelli,
 * #all/max_verstappen/hamilton
 */
(function () {
  "use strict";

  const DATA = window.F1_DATA;
  const $ = (selector) => document.querySelector(selector);

  // ---------- язык: ?lang=en — английская версия, иначе русская ----------
  const EN = new URLSearchParams(location.search).get("lang") === "en";
  const L = (ru, en) => (EN ? en : ru);  // текст по-русски или по-английски
  const LOCALE = EN ? "en-GB" : "ru-RU";
  // русские названия групп длиннее английских — столбцу подписей в карточке нужно больше места
  if (!EN) document.documentElement.style.setProperty("--label-w", "152px");
  if (EN) {
    document.documentElement.lang = "en";
    document.title = "F1 driver rating";
    for (const node of document.querySelectorAll("[data-en]")) node.textContent = node.dataset.en;
    for (const node of document.querySelectorAll("[data-en-aria]")) node.setAttribute("aria-label", node.dataset.enAria);
    for (const node of document.querySelectorAll("[data-en-title]")) node.title = node.dataset.enTitle;
  }
  // Переключатель языка ведёт на тот же охват, пилота и сравнение (они в #адресе).
  function syncLangLink() {
    const link = $("#lang-switch");
    if (!link) return;
    const params = new URLSearchParams(location.search);
    if (EN) params.delete("lang");
    else params.set("lang", "en");
    const query = params.toString();
    link.href = `${location.pathname}${query ? `?${query}` : ""}${location.hash}`;
    link.textContent = EN ? "Русский" : "English";
    link.lang = EN ? "ru" : "en";
    link.hreflang = EN ? "ru" : "en";
  }
  syncLangLink();

  if (!DATA || !DATA.scopes) {
    $("#subtitle").textContent = L("Нет данных: запустите python -m rating_f1.pipeline",
      "No data: run python -m rating_f1.pipeline");
    return;
  }

  const { meta, drivers, scopes } = DATA;
  const PERIOD = "all";
  const GROUPS = meta.groups;
  const FEATURES = meta.features;
  // Английские названия групп и признаков (в данных — русские, composite.py).
  const GROUP_EN = {
    results: ["Results", "Points, wins, podiums, championship position — what the driver actually delivered."],
    above_car: ["Above the car", "Points and places beyond what a car of this level usually delivers; standout " +
      "races — a podium in a midfield car."],
    quali: ["Qualifying", "Poles, reaching Q3, gap to the fastest time, average position."],
    pace: ["Race pace", "Gap to the median of the field on clean laps and consistency of pace."],
    racecraft: ["Racecraft", "First lap, overtakes and defending on track, places gained beyond expectation."],
    clean: ["Clean driving", "For reference, not in the total by default: it barely repeats in the data. Own crashes " +
      "and spins, collisions per stewards' decisions, other time penalties. Failures and other drivers' collisions " +
      "do not count."],
    teammate: ["Vs teammate", "Teammate network model: qualifying, pace and finish adjusted for the strength of " +
      "teammates; share of the team's points."],
    dotd: ["Driver of the Day", "Season rating only: the share of races where fans voted the driver Driver of the " +
      "Day (Formula 1 poll, since 2016). Not part of the all-season summary."],
    career: ["Career", "All-season summary only: quality and longevity. Since the F1 debut — seasons in F1, seasons " +
      "ahead of the teammate in the championship, titles; over our seasons — margin above average."],
  };
  const FEATURE_EN = {
    ppr: "Points per race", win_rate: "Wins", podium_rate: "Podiums", top10_rate: "Points finishes", champ: "Championship position (points for it)",
    points_above_car: "Points above the car level, per race", pos_above_car: "Places above the car level",
    standout_rate: "Standout races", pole_rate: "Poles", q3_rate: "Reached Q3 (before 2006 — top 10)",
    quali_gap: "Gap to the best in qualifying", quali_pos: "Average qualifying position",
    race_pace: "Pace: gap to the field median", consistency: "Lap time spread",
    lap1_vs_exp: "First lap: places beyond expectation", overtakes: "On-track overtakes per race",
    overtaken: "Times overtaken per race", gain_vs_exp: "Places per race beyond expectation",
    err_rate: "Own crashes and spins", collision_rate: "Collisions per stewards' decisions",
    penalty_rate: "Other time penalties", car_quali: "Quali vs teammates, s/lap", car_pace: "Pace vs teammates, s/lap",
    car_race: "Finish vs teammates", team_share: "Share of team points", dotd_rate: "Driver of the Day: share of races",
    seasons: "Seasons in F1 since debut",
    ahead: "Seasons ahead of teammate", titles: "Career titles", above_avg: "Margin above average over seasons",
    records: "Records: points for years held",
  };
  if (EN) {
    for (const g of GROUPS) if (GROUP_EN[g.id]) [g.name, g.about] = GROUP_EN[g.id];
    for (const f of FEATURES) if (FEATURE_EN[f.id]) f.name = FEATURE_EN[f.id];
  }
  const MINUS = "−";
  // Три раскладки: три колонки (от 1280 px), одна колонка, телефон (до 640 px) — как в style.css.
  const DESKTOP = window.matchMedia("(min-width: 1280px)");
  const MOBILE = window.matchMedia("(max-width: 639px)");
  const SEASON_KEYS = meta.scopes.filter((k) => k !== PERIOD);
  // «Все времена» (1950+, alltime.py) — первая вкладка «Охвата»: та же таблица и карточка, свои группы.
  const EVER = DATA.alltime || {};
  const EVER_KEY = "ever";
  const HAS_EVER = Boolean(EVER.drivers && EVER.drivers.length);
  const everState = { sort: "rating", expanded: false, open: null };  // open — выбранный пилот
  const EVER_TOP = 25;
  // Группы охвата: «Карьера» — только в общей сводке, «Гонщик дня» — только в сезонах, где шло голосование.
  const DOTD_FROM = (meta.counts && meta.counts.dotd_from) || 2016;
  function scopeGroups(key) {
    if (key === PERIOD) return GROUPS.filter((g) => g.id !== "dotd");
    return GROUPS.filter((g) => g.id !== "career" && (g.id !== "dotd" || Number(key) >= DOTD_FROM));
  }

  // ---------- форматирование ----------
  const num = (x, digits) => (EN ? x.toFixed(digits) : x.toFixed(digits).replace(".", ","));
  const signed = (x, digits) => {
    const text = num(Math.abs(x), digits);
    if (Number(Math.abs(x).toFixed(digits)) === 0) return text;
    return (x > 0 ? "+" : MINUS) + text;
  };
  const pct = (x) => {
    if (x == null) return "—";
    const v = 100 * x;
    return `${v > 0 && v < 10 ? num(v, 1) : Math.round(v)}%`;
  };
  const int = (x) => (x == null ? "—" : String(Math.round(x)));
  const dateRu = (iso) =>
    new Date(`${iso}T12:00:00`).toLocaleDateString(LOCALE, { day: "numeric", month: "long", year: "numeric" });
  const esc = (s) =>
    String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const name = (id) => (drivers[id] ? drivers[id].name : id);
  const COUNTRIES = {
    American: "США", Argentine: "Аргентина", Argentinian: "Аргентина", Australian: "Австралия",
    Austrian: "Австрия", Belgian: "Бельгия", Brazilian: "Бразилия", British: "Великобритания",
    Canadian: "Канада", Chinese: "Китай", Danish: "Дания", Dutch: "Нидерланды", Finnish: "Финляндия",
    French: "Франция", German: "Германия", Italian: "Италия", Japanese: "Япония", Mexican: "Мексика",
    Monegasque: "Монако", "New Zealander": "Новая Зеландия", Polish: "Польша", Russian: "Россия",
    Spanish: "Испания", Swedish: "Швеция", Swiss: "Швейцария", Thai: "Таиланд",
  };
  const country = (nationality) => (EN ? nationality : COUNTRIES[nationality] || nationality);

  // Этапы и причины сходов по-русски — для списка происшествий в «Аккуратности».
  const GP_RU = {
    "70th Anniversary Grand Prix": "Гран-при 70-летия", "Abu Dhabi Grand Prix": "Абу-Даби",
    "Australian Grand Prix": "Австралия", "Austrian Grand Prix": "Австрия", "Azerbaijan Grand Prix": "Азербайджан",
    "Bahrain Grand Prix": "Бахрейн", "Bahrain Grand Prix in Malaysia": "Бахрейн (в Малайзии)",
    "Barcelona Grand Prix": "Барселона", "Belgian Grand Prix": "Бельгия", "Brazilian Grand Prix": "Бразилия",
    "British Grand Prix": "Великобритания", "Canadian Grand Prix": "Канада", "Chinese Grand Prix": "Китай",
    "Dutch Grand Prix": "Нидерланды", "Eifel Grand Prix": "Айфель", "Emilia Romagna Grand Prix": "Эмилия-Романья",
    "French Grand Prix": "Франция", "German Grand Prix": "Германия", "Hungarian Grand Prix": "Венгрия",
    "Italian Grand Prix": "Италия", "Japanese Grand Prix": "Япония", "Las Vegas Grand Prix": "Лас-Вегас",
    "Mexican Grand Prix": "Мексика", "Mexico City Grand Prix": "Мехико", "Miami Grand Prix": "Майами",
    "Monaco Grand Prix": "Монако", "Portuguese Grand Prix": "Португалия", "Qatar Grand Prix": "Катар",
    "Russian Grand Prix": "Россия", "Sakhir Grand Prix": "Сахир", "Saudi Arabian Grand Prix": "Саудовская Аравия",
    "Singapore Grand Prix": "Сингапур", "Spanish Grand Prix": "Испания", "Styrian Grand Prix": "Штирия",
    "São Paulo Grand Prix": "Сан-Паулу", "Turkish Grand Prix": "Турция", "Tuscan Grand Prix": "Тоскана",
    "United States Grand Prix": "США", "Korean Grand Prix": "Корея", "Indian Grand Prix": "Индия",
    "European Grand Prix": "Европа", "Malaysian Grand Prix": "Малайзия", "San Marino Grand Prix": "Сан-Марино",
    "Argentine Grand Prix": "Аргентина", "Luxembourg Grand Prix": "Люксембург",
  };
  const CAUSE_RU = {
    Accident: "авария", "Spun off": "разворот", "Accident damage": "повреждения после аварии",
    "Accident on formation lap": "авария на прогревочном круге", Collision: "столкновение",
    "Collision damage": "повреждения после столкновения",
    Engine: "двигатель", Gearbox: "коробка передач", Brakes: "тормоза", Hydraulics: "гидравлика",
    "Power unit": "силовая установка", Suspension: "подвеска", Overheating: "перегрев", "Power loss": "потеря мощности",
    "Oil leak": "утечка масла", Electrical: "электрика", Undertray: "днище", Puncture: "прокол",
    "Water pressure": "давление воды", Wheel: "колесо", Mechanical: "техника", "Fuel system": "топливная система",
    Battery: "батарея", Clutch: "сцепление", "Water leak": "утечка воды", Transmission: "трансмиссия",
    Turbo: "турбина", Turbocharger: "турбина", Exhaust: "выхлоп", "Oil pressure": "давление масла",
    "Fuel pump": "топливный насос", "Fuel leak": "утечка топлива", "Fuel pressure": "давление топлива",
    "Rear wing": "заднее антикрыло", "Front wing": "переднее антикрыло", Vibrations: "вибрации",
    Electronics: "электроника", "Coolant leak": "утечка охлаждающей жидкости", "Wheel nut": "колёсная гайка",
    Handling: "управляемость", Tyre: "шина", Steering: "рулевое управление", Chassis: "шасси",
    Disqualified: "дисквалификация",
  };
  const FIA_FROM = meta.fia_from || 2019;  // с этого года есть решения стюардов о столкновениях

  function gpName(season, round) {
    const en = ((meta.race_names || {})[season] || {})[round];
    if (!en) return L(`${round}-й этап`, `round ${round}`);
    return EN ? en.replace(/ Grand Prix/, " GP") : GP_RU[en] || en.replace(/ Grand Prix$/, "");
  }
  // Причина схода: в данных — по-английски (F1DB), на русской версии — перевод.
  const cause = (detail, fallback) => (EN ? String(detail || fallback).toLowerCase()
    : CAUSE_RU[detail] || String(detail || fallback).toLowerCase());
  // Порядковый: «3-е» / «3rd»
  const ord = (n) => {
    if (!EN) return `${n}-е`;
    const s = ["th", "st", "nd", "rd"];
    const v = n % 100;
    return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
  };

  function fmtFeature(unit, v) {
    if (v == null) return "—";
    switch (unit) {
      case "pct": return pct(v);
      case "gap": return `${num(v, 2)}%`;
      case "signedgap": return `${signed(v, 2)}%`;
      case "pos": case "num1": return num(v, 1);
      case "signed1": return signed(v, 1);
      case "sec": return `${signed(v, 2)} ${L("с", "s")}`;
      default: return int(v);
    }
  }

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  // Русские формы (1, 2–4, 5+); для английской версии — enOne/enMany (без них — множественное по-русски).
  function plural(n, one, few, many, enOne, enMany) {
    if (EN && enOne) return n === 1 ? enOne : enMany || `${enOne}s`;
    const m10 = n % 10;
    const m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return one;
    if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
    return many;
  }

  // band — вилка балла [от, до]: рисуется тонким «усом» поверх шкалы.
  function meter(score, label, band) {
    const box = el("div", "meter");
    box.setAttribute("role", "img");
    box.setAttribute("aria-label", label);
    const fill = el("div", "fill");
    fill.style.width = `${Math.max(0, Math.min(100, score))}%`;
    box.append(fill, el("div", "mid"));
    if (band) {
      const whisker = el("div", "band");
      whisker.style.left = `${band[0]}%`;
      whisker.style.width = `${Math.max(0, band[1] - band[0])}%`;
      box.append(whisker);
    }
    return box;
  }

  // ---------- веса и пересчёт ----------
  const ZERO = { results: 0, above_car: 0, quali: 0, pace: 0, racecraft: 0, clean: 0, teammate: 0, dotd: 0, career: 0 };
  const PRESETS = [
    { id: "default", name: L("Сбалансированный", "Balanced"),
      note: L("Обычная смесь всех групп", "Default mix of all groups") },
    { id: "results", name: L("Важнее результаты", "Results first"),
      note: L("Победы и очки весят больше всего", "Wins and points weigh most"),
      w: { ...ZERO, results: 40, above_car: 15, quali: 10, pace: 10, racecraft: 5, teammate: 15, career: 5 } },
    { id: "skill", name: L("Чистое мастерство", "Pure skill"),
      note: L("Убирает влияние машины", "Strips out the car"),
      w: { ...ZERO, results: 5, above_car: 20, quali: 15, pace: 15, racecraft: 15, teammate: 30 } },
    { id: "only", name: L("Только результаты", "Results only"),
      note: L("Ничего, кроме результатов", "Nothing but results"), w: { ...ZERO, results: 100 } },
  ];
  // «По данным»: вес группы пропорционален тому, насколько её балл следует за пилотом при смене
  // команды (validate.py). Округляем до 5%, как шаг ползунков.
  const DATA_WEIGHTS = meta.validation && meta.validation.data_weights;
  if (DATA_WEIGHTS) {
    PRESETS.push({ id: "data", name: L("По данным", "By the data"),
      note: L("Больше веса тому, что следует за пилотом", "More weight to what follows the driver"),
      w: { ...ZERO, ...Object.fromEntries(Object.entries(DATA_WEIGHTS).map(([k, v]) => [k, 5 * Math.round(20 * v)])) } });
  }

  const TOP_N = 15;  // столько строк показывать в свёрнутой таблице
  const state = {
    scope: PERIOD, showAll: false, driver: null, compare: null, sort: "score", preset: "default", custom: null,
    expanded: false,
    weightTab: "presets",  // вкладка весов: готовые наборы или свои ползунки
    hops: 1,               // граф: 1 — прямые напарники, 2 — два шага, 0 — вся сеть
    more: false,           // раскрыт ли блок «Подробнее» в карточке
  };

  // Веса «Сбалансированного» набора (config.py), в процентах.
  function defaultWeights(isPeriod) {
    const base = isPeriod ? meta.weights.period : meta.weights.season;
    return Object.fromEntries(Object.entries(base).map(([k, v]) => [k, Math.round(100 * v)]));
  }
  const isDefaultWeights = () => !state.custom && state.preset === "default";

  function weightsFor(isPeriod) {
    if (state.custom) return state.custom;
    const preset = PRESETS.find((p) => p.id === state.preset);
    if (preset && preset.w) return preset.w;
    return defaultWeights(isPeriod);
  }

  // ---------- вилки: пересчёты рейтинга на перевыбранных этапах ----------
  // DATA.draws[охват]: z групп каждого пилота в каждом пересчёте (int16 × 1000, base64),
  // порядок — пилот × группа × пересчёт. Балл пересчёта собирается с текущими весами.
  const DRAWS = DATA.draws || {};
  const Q_LO = (1 - meta.interval) / 2;
  const Q_HI = 1 - Q_LO;
  const TIE_P = 0.6;  // «≈»: пилот строкой выше впереди меньше чем в 60% пересчётов — почти монетка
  const decoded = new Map();

  function drawsFor(key) {
    if (!DRAWS[key]) return null;
    if (!decoded.has(key)) {
      const d = DRAWS[key];
      const bin = atob(d.z);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
      decoded.set(key, { ...d, z: new Int16Array(bytes.buffer), row: new Map(d.ids.map((id, i) => [id, i])) });
    }
    return decoded.get(key);
  }

  function quantile(sorted, q) {
    const pos = (sorted.length - 1) * q;
    const lo = Math.floor(pos);
    const hi = Math.ceil(pos);
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
  }

  // Каждый пересчёт меряется той же линейкой, что и основной балл (среднее и разброс по пулу),
  // поэтому вилка согласована с баллом при любых весах.
  function addBands(key, entries, pool, groups, w, total, mean, sd) {
    const d = drawsFor(key);
    if (!d || !(sd > 0) || !(total > 0)) return;
    const n = d.n;
    const parts = groups.map((g) => [d.groups.indexOf(g.id), w[g.id] / total / d.scale]).filter(([i]) => i >= 0);
    for (const e of entries) {
      const row = d.row.get(e.id);
      if (row == null) continue;
      const z = new Float64Array(n);
      for (const [gi, k] of parts) {
        const base = (row * d.groups.length + gi) * n;
        for (let b = 0; b < n; b += 1) z[b] += k * d.z[base + b];
      }
      for (let b = 0; b < n; b += 1) z[b] = (z[b] - mean) / sd;
      const scores = Array.from(z, (x) => Math.max(0, Math.min(100, 50 + 15 * x))).sort((a, b) => a - b);
      e.zDraws = z;
      e.band = [quantile(scores, Q_LO), quantile(scores, Q_HI)];
    }
    const ranked = pool.filter((e) => e.zDraws);
    const places = ranked.map(() => new Uint16Array(n));
    const order = ranked.map((_, i) => i);
    for (let b = 0; b < n; b += 1) {
      order.sort((i, j) => ranked[j].zDraws[b] - ranked[i].zDraws[b]);
      order.forEach((i, place) => { places[i][b] = place + 1; });
    }
    ranked.forEach((e, i) => {
      const sorted = Array.from(places[i]).sort((a, b) => a - b);
      e.rankBand = [sorted[Math.round((n - 1) * Q_LO)], sorted[Math.round((n - 1) * Q_HI)]];
      e.pTop = places[i].filter((p) => p === 1).length / n;
    });
    const byPlace = ranked.slice().sort((a, b) => a.rankNow - b.rankNow);
    for (let i = 0; i + 1 < byPlace.length; i += 1) {
      const upper = byPlace[i];
      const lower = byPlace[i + 1];
      let ahead = 0;
      for (let b = 0; b < n; b += 1) if (upper.zDraws[b] > lower.zDraws[b]) ahead += 1;
      upper.next = { id: lower.id, place: lower.rankNow, p: ahead / n };
      lower.prev = { id: upper.id, place: upper.rankNow, p: ahead / n };
    }
  }

  // ---------- рейтинг по ходу сезона: z групп после каждого этапа (by_round.py) ----------
  // DATA.by_round[сезон]: порядок пилот × группа × этап, int16 × 1000, missing — ещё не стартовал.
  const ROUNDS = DATA.by_round || {};
  const roundsDecoded = new Map();

  function roundsFor(key) {
    if (!ROUNDS[key]) return null;
    if (!roundsDecoded.has(key)) {
      const d = ROUNDS[key];
      const bin = atob(d.z);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
      roundsDecoded.set(key, { ...d, z: new Int16Array(bytes.buffer), row: new Map(d.ids.map((id, i) => [id, i])) });
    }
    return roundsDecoded.get(key);
  }

  // Балл и место после каждого этапа при текущих весах — линейкой итогового балла сезона
  // (среднее и разброс по пулу), поэтому после последнего этапа балл совпадает с итоговым.
  function seasonPath(key) {
    const d = roundsFor(key);
    if (!d) return null;
    const scope = computeScope(key);
    if (scope.path) return scope.path;
    const { groups, w, total, mean, sd } = scope;
    const nR = d.rounds.length;
    const nG = d.groups.length;
    const parts = groups.map((g) => [d.groups.indexOf(g.id), w[g.id] / total / d.scale]).filter(([i]) => i >= 0);
    const scores = new Map();
    for (const [id, row] of d.row) {
      const s = new Float64Array(nR).fill(NaN);
      for (let r = 0; r < nR; r += 1) {
        let z = 0;
        let missing = false;
        for (const [gi, k] of parts) {
          const v = d.z[(row * nG + gi) * nR + r];
          if (v === d.missing) { missing = true; break; }
          z += k * v;
        }
        if (!missing && sd > 0) s[r] = Math.max(0, Math.min(100, 50 + (15 * (z - mean)) / sd));
      }
      scores.set(id, s);
    }
    const pool = scope.entries.filter((e) => e.eligible && scores.has(e.id)).map((e) => e.id);
    const ranks = new Map(pool.map((id) => [id, new Int16Array(nR)]));
    for (let r = 0; r < nR; r += 1) {
      pool.filter((id) => !Number.isNaN(scores.get(id)[r]))
        .sort((a, b) => scores.get(b)[r] - scores.get(a)[r])
        .forEach((id, i) => { ranks.get(id)[r] = i + 1; });
    }
    scope.path = { rounds: d.rounds, scores, ranks };
    return scope.path;
  }

  // «в 62% пересчётов» / «во всех пересчётах»
  function share(p) {
    if (p >= 1) return L("во всех пересчётах", "in all resamples");
    if (p <= 0) return L("ни в одном пересчёте", "in no resample");
    const v = Math.max(1, Math.min(99, Math.round(100 * p)));
    return L(`в ${v}% пересчётов`, `in ${v}% of resamples`);
  }
  const placeText = (pair) => (pair[0] === pair[1] ? ord(pair[0])
    : L(`с ${pair[0]}-го по ${pair[1]}-е`, `${ord(pair[0])}–${ord(pair[1])}`));

  // Строка «точности» для карточек: вилка балла, места, шанс быть первым, соседи по таблице.
  function precisionText(e) {
    if (!e.band) return null;
    const level = L(`${Math.round(100 * meta.interval)}% пересчётов`, `${Math.round(100 * meta.interval)}% of resamples`);
    const band = `${int(e.band[0])}–${int(e.band[1])}`;
    if (!e.rankBand) {
      return L(`Вилка балла ${band} (так выходит в ${level}). Мало гонок, поэтому без места.`,
        `Score range ${band} (in ${level}). Too few races for a place.`);
    }
    const parts = [L(`Вилка балла ${band}, место — ${placeText(e.rankBand)} (так выходит в ${level}).`,
      `Score range ${band}, place ${placeText(e.rankBand)} (in ${level}).`)];
    if (e.pTop > 0) parts.push(L(`Первым оказывается ${share(e.pTop)}.`, `First ${share(e.pTop)}.`));
    const mates = [];
    if (e.prev) {
      mates.push(L(`${name(e.prev.id)} (${e.prev.place}-е место) впереди ${share(e.prev.p)}`,
        `${name(e.prev.id)} (${ord(e.prev.place)}) ahead ${share(e.prev.p)}`));
    }
    if (e.next) {
      mates.push(L(`${name(e.next.id)} (${e.next.place}-е) позади ${share(e.next.p)}`,
        `${name(e.next.id)} (${ord(e.next.place)}) behind ${share(e.next.p)}`));
    }
    if (mates.length) parts.push(`${mates.join(", ")}.`);
    return parts.join(" ");
  }

  const cache = new Map();
  // weights — посчитать охват с другими весами (без вилок): нужны места при «Сбалансированном» наборе.
  function computeScope(key, weights) {
    const isPeriod = key === PERIOD;
    const w = weights || weightsFor(isPeriod);
    const cacheKey = `${key}|${weights ? "base" : ""}|${JSON.stringify(w)}`;
    if (cache.has(cacheKey)) return cache.get(cacheKey);
    const groups = scopeGroups(key).filter((g) => (w[g.id] || 0) > 0);
    const entries = scopes[key].map((e) => ({ ...e }));
    const total = groups.reduce((s, g) => s + w[g.id], 0);
    for (const e of entries) {
      e.raw = total > 0 ? groups.reduce((s, g) => s + w[g.id] * (e.g[g.id] ?? 0), 0) / total : 0;
    }
    const pool = entries.filter((e) => e.eligible);
    const mean = pool.reduce((s, e) => s + e.raw, 0) / pool.length;
    const sd = Math.sqrt(pool.reduce((s, e) => s + (e.raw - mean) ** 2, 0) / pool.length);
    for (const e of entries) {
      const z = sd > 0 ? (e.raw - mean) / sd : 0;
      e.score = Math.max(0, Math.min(100, 50 + 15 * z));
      e.rankNow = null;
    }
    pool.sort((a, b) => b.score - a.score).forEach((e, i) => { e.rankNow = i + 1; });
    if (!weights) addBands(key, entries, pool, groups, w, total, mean, sd);
    // groups, w, total, mean, sd — линейка охвата при текущих весах: разложить разницу двух пилотов
    // по группам (сравнение в карточке) и собрать баллы после каждого этапа (seasonPath)
    const result = { entries, byId: new Map(entries.map((e) => [e.id, e])), groups, w, total, mean, sd };
    cache.set(cacheKey, result);
    return result;
  }

  // ---------- состояние в адресе ----------
  function readHash() {
    const [scope, driver, other] = decodeURIComponent(location.hash.replace(/^#/, "")).split("/");
    if (scope === EVER_KEY && HAS_EVER) {
      state.scope = EVER_KEY;  // #ever/ayrton-senna — раскрытая строка таблицы всех времён
      const opened = driver && EVER.drivers.find((d) => d.id === driver);
      if (opened) {
        everState.open = driver;
        everState.expanded = opened.rank > EVER_TOP;  // пилот ниже топа — показать всю таблицу
      }
      return;
    }
    if (scopes[scope]) state.scope = scope;
    if (driver && drivers[driver]) state.driver = driver;
    if (other && drivers[other] && other !== state.driver) state.compare = other;
  }

  function writeHash() {
    const parts = [state.scope];
    if (state.scope === EVER_KEY) {
      if (everState.open) parts.push(everState.open);
    } else {
      if (state.driver) parts.push(state.driver);
      if (state.driver && state.compare) parts.push(state.compare);
    }
    const hash = `#${parts.join("/")}`;
    if (location.hash !== hash) history.replaceState(null, "", hash);
    syncLangLink();
  }

  // ---------- шапка: охват, ссылки, язык ----------
  function scopeLabel(key) {
    if (key === EVER_KEY) return L(`Все времена ${EVER.period[0]}–${EVER.period[1]}`, `All time ${EVER.period[0]}–${EVER.period[1]}`);
    return key === PERIOD ? L(`Все сезоны ${meta.period[0]}–${meta.period[1]}`, `All seasons ${meta.period[0]}–${meta.period[1]}`)
      : L(`Сезон ${key}`, `Season ${key}`);
  }

  function setScope(key) {
    state.scope = key;
    if (key !== EVER_KEY && !scopes[key].some((e) => e.id === state.driver)) state.driver = null;
    render();
  }

  // Охват — сегменты: «Все времена», весь период и сезон (список сезонов — в третьем сегменте).
  function renderHeader() {
    const through = meta.data_through;
    const lastRace = EN ? through.race_name : GP_RU[through.race_name] || through.race_name;
    const seg = $("#scope-seg");
    seg.replaceChildren();
    for (const key of [...(HAS_EVER ? [EVER_KEY] : []), PERIOD]) {
      const button = el("button", null, scopeLabel(key));
      button.type = "button";
      button.dataset.scope = key;
      button.addEventListener("click", () => setScope(key));
      seg.append(button);
    }
    const select = el("select");
    select.id = "scope-season";
    select.setAttribute("aria-label", L("Сезон", "Season"));
    const placeholder = el("option", null, L("Сезон", "Season"));
    placeholder.value = "";
    select.append(placeholder);
    for (const key of SEASON_KEYS) {
      const option = el("option", null, scopeLabel(key));
      option.value = key;
      select.append(option);
    }
    select.addEventListener("change", () => { if (select.value) setScope(select.value); });
    seg.append(select);
    for (const link of document.querySelectorAll("[data-scroll]")) {
      link.addEventListener("click", (event) => {
        event.preventDefault();  // якорь заменил бы адрес с охватом и пилотом
        document.getElementById(link.dataset.scroll).scrollIntoView({ behavior: "smooth", block: "start" });
      });
    }
    $("#footer").textContent = L(
      "Неофициальный фан-проект, не связан с Formula 1 и FIA. " +
      `Данные: Jolpica F1 API и F1DB (CC BY 4.0), биографии — Википедия (CC BY-SA 4.0), ` +
      "фото — Викисклад (автор и лицензия — под фото). " +
      `Данные после этапа «${lastRace}» ${through.season} года (${dateRu(through.date)}). ` +
      `Сгенерировано ${new Date(meta.generated_at).toLocaleString(LOCALE)}.`,
      "Unofficial fan project, not affiliated with Formula 1 or the FIA. " +
      "Data: Jolpica F1 API and F1DB (CC BY 4.0), biographies — Wikipedia (CC BY-SA 4.0), " +
      "photos — Wikimedia Commons (author and licence under each photo). " +
      `Data through the ${lastRace} ${through.season} (${dateRu(through.date)}). ` +
      `Generated ${new Date(meta.generated_at).toLocaleString(LOCALE)}.`);
  }

  function syncScopeSeg() {
    for (const button of document.querySelectorAll("#scope-seg button")) {
      button.setAttribute("aria-pressed", String(button.dataset.scope === state.scope));
    }
    const select = $("#scope-season");
    const isSeason = state.scope !== PERIOD && state.scope !== EVER_KEY;
    select.value = isSeason ? state.scope : "";
    select.classList.toggle("active", isSeason);
  }

  // ---------- веса: готовые наборы и свои ползунки ----------
  // Доля группы в итоге: итог делится на сумму весов, а она не обязана быть 100.
  function weightShares(weights, key) {
    const groups = scopeGroups(key);
    const total = groups.reduce((s, g) => s + (weights[g.id] || 0), 0);
    const share = (gid) => `${total > 0 ? Math.round(100 * (weights[gid] || 0) / total) : 0}%`;
    return { share, summary: groups.map((g) => `${g.name} ${share(g.id)}`).join(" · ") };
  }

  function applyPreset(id) {
    state.preset = id;
    state.custom = null;
    renderAll();
  }

  function presetLabel() {
    if (state.custom) return L("Свои веса", "Custom weights");
    return (PRESETS.find((p) => p.id === state.preset) || PRESETS[0]).name;
  }

  function renderWeights() {
    const ever = state.scope === EVER_KEY;
    const tabs = $("#weight-tabs");
    const presets = $("#presets");
    const sliders = $("#sliders");
    const fixed = $("#fixed-weights");
    const chips = $("#preset-chips");
    tabs.hidden = ever;
    fixed.hidden = !ever;
    chips.hidden = ever;
    $("#weights-hint").textContent = ever
      ? L("У рейтинга всех времён веса постоянные: в нём только то, что есть для всех эпох.",
        "The all-time rating has fixed weights: it only uses what exists for every era.")
      : L("Выберите готовый взгляд или задайте свои веса. Рейтинг пересчитывается сразу.",
        "Pick a view or set your own weights. The ranking updates live.");
    if (ever) {
      presets.hidden = true;
      sliders.hidden = true;
      const total = EVER.groups.reduce((s, g) => s + (EVER.weights[g.id] || 0), 0);
      fixed.replaceChildren(monoHead(L("Группа", "Group"), L("Доля в итоге", "Share of total")));
      for (const g of EVER.groups) {
        const row = el("div", "fw-row");
        row.append(el("span", null, groupName(g)),
          el("span", "share", `${Math.round((100 * (EVER.weights[g.id] || 0)) / total)}%`));
        fixed.append(row);
      }
      $("#weights-summary").textContent = L("веса постоянные", "fixed weights");
      return;
    }
    const key = state.scope;
    const isPeriod = key === PERIOD;
    const w = weightsFor(isPeriod);
    const { share } = weightShares(w, key);

    tabs.replaceChildren();
    for (const [id, label] of [["presets", L("Готовые", "Presets")], ["custom", L("Свои", "Custom")]]) {
      const button = el("button", null, label + (id === "custom" && state.custom ? " ●" : ""));
      button.type = "button";
      button.dataset.tab = id;
      button.setAttribute("role", "tab");
      button.setAttribute("aria-selected", String(state.weightTab === id));
      button.addEventListener("click", () => { state.weightTab = id; renderWeights(); });
      tabs.append(button);
    }
    presets.hidden = state.weightTab !== "presets";
    sliders.hidden = state.weightTab !== "custom";

    presets.replaceChildren();
    chips.replaceChildren();
    for (const preset of PRESETS) {
      const on = !state.custom && state.preset === preset.id;
      const button = el("button", "preset");
      button.type = "button";
      button.setAttribute("aria-pressed", String(on));
      button.append(el("span", "preset-name", preset.name), el("span", "preset-note", preset.note));
      button.addEventListener("click", () => applyPreset(preset.id));
      presets.append(button);
      const chip = el("button", null, preset.name);
      chip.type = "button";
      chip.setAttribute("aria-pressed", String(on));
      chip.addEventListener("click", () => applyPreset(preset.id));
      chips.append(chip);
    }
    const customChip = el("button", null, L("Свои веса", "Custom weights") + (state.custom ? " ●" : ""));
    customChip.type = "button";
    customChip.setAttribute("aria-pressed", String(Boolean(state.custom)));
    customChip.addEventListener("click", () => {
      state.weightTab = "custom";
      renderWeights();
      openSheet("weights");
    });
    chips.append(customChip);

    sliders.replaceChildren(monoHead(L("Группа", "Group"), L("Доля в итоге", "Share of total")));
    const outputs = new Map();  // подписи ползунков — доли в итоге, меняются все сразу
    for (const group of scopeGroups(key)) {
      const box = el("label", `slider${(w[group.id] || 0) === 0 ? " zero" : ""}`);
      box.title = group.about;
      const output = el("span", "share", share(group.id));
      outputs.set(group.id, { output, box });
      const input = el("input");
      input.type = "range";
      input.min = "0";
      input.max = "100";
      input.step = "5";
      input.value = String(w[group.id] || 0);
      input.setAttribute("aria-label", group.name);
      input.addEventListener("input", () => {
        // свои веса: от текущего набора, с весами групп обоих охватов («Карьера» и «Гонщик дня»)
        const full = { ...defaultWeights(false), ...defaultWeights(true), ...weightsFor(isPeriod) };
        state.custom = { ...full, ...(state.custom || {}), [group.id]: Number(input.value) };
        const now = weightShares(state.custom, key).share;
        for (const [gid, item] of outputs) {
          item.output.textContent = now(gid);
          item.box.classList.toggle("zero", (state.custom[gid] || 0) === 0);
        }
        renderAll(false);
      });
      box.append(el("span", "sname", group.name), output, input);
      sliders.append(box);
    }
    const reset = el("button", "link-btn", L("Сбросить к «Сбалансированному»", "Reset to Balanced"));
    reset.type = "button";
    reset.addEventListener("click", () => applyPreset("default"));
    sliders.append(reset);
    syncWeightLabels();
  }

  // Подписи, которые зависят от текущих весов, но не требуют перерисовки ползунков.
  function syncWeightLabels() {
    if (state.scope === EVER_KEY) return;
    $("#weights-summary").textContent = presetLabel();
    const custom = document.querySelector('#weight-tabs [data-tab="custom"]');
    if (custom) custom.textContent = L("Свои", "Custom") + (state.custom ? " ●" : "");
    const chips = document.querySelectorAll("#preset-chips button");
    PRESETS.forEach((preset, i) => {
      if (chips[i]) chips[i].setAttribute("aria-pressed", String(!state.custom && state.preset === preset.id));
    });
    const customChip = chips[PRESETS.length];
    if (customChip) {
      customChip.textContent = L("Свои веса", "Custom weights") + (state.custom ? " ●" : "");
      customChip.setAttribute("aria-pressed", String(Boolean(state.custom)));
    }
    document.querySelectorAll("#presets .preset").forEach((button, i) => {
      button.setAttribute("aria-pressed", String(!state.custom && state.preset === PRESETS[i].id));
    });
  }

  // Заголовок таблицы, строка под названием сайта и пояснения к шкале — по охвату.
  function renderScopeNote() {
    const key = state.scope;
    const ever = key === EVER_KEY;
    const isPeriod = key === PERIOD;
    const pool = ever ? EVER.drivers.length : scopes[key].filter((e) => e.eligible).length;
    const min = ever ? EVER.pool : isPeriod ? meta.min_starts.period : meta.min_starts.season;
    const span = ever ? `${EVER.period[0]}–${EVER.period[1]}` : isPeriod ? `${meta.period[0]}–${meta.period[1]}` : key;
    $("#subtitle").textContent = L(
      `${span} · ${pool} ${plural(pool, "пилот", "пилота", "пилотов")} от ${min} гонок`,
      `${span} · ${pool} drivers with ${min}+ races`);
    $("#ranking-title").textContent = ever ? L("Рейтинг всех времён", "All-time ranking")
      : isPeriod ? L("Общий рейтинг", "Overall ranking") : L(`Рейтинг сезона ${key}`, `${key} season ranking`);
    const banded = !ever && DRAWS[key];
    $("#ranking-legend").textContent = L(
      "Полоса — балл 0–100" + (banded ? " · тонкая линия — вилка" : "") + " · засечка — средний пилот (50)",
      "Bar = score 0–100" + (banded ? " · whisker = likely range" : "") + " · tick = average driver (50)");
    const notes = [];
    if (!ever && !isPeriod) {
      const races = meta.season_races[key];
      if (races && races.completed < races.scheduled) {
        notes.push(L(`Сезон ещё идёт: учтено ${races.completed} из ${races.scheduled} гонок.`,
          `Season in progress: ${races.completed} of ${races.scheduled} races counted.`));
      }
    }
    if (ever) {
      notes.push(L("Упрощённая модель: результаты, квалификация, сеть напарников и карьера — то, что есть для всех " +
        "эпох. Подробности — в методике.", "A simplified model: results, qualifying, the teammate network and " +
        "career — what exists for every era. Details in the methodology."));
    }
    $("#scope-note").textContent = notes.join(" ");
  }

  // ---------- таблица рейтинга ----------
  // Короткие подписи: три буквы — в шапке цветной полосы, подлиннее — на осях профиля.
  const ABBR = EN
    ? { results: "Res", above_car: "Car", quali: "Qua", pace: "Pac", racecraft: "Rcr", clean: "Cln", teammate: "Tm",
      dotd: "Fan", career: "Crr" }
    : { results: "Рез", above_car: "Маш", quali: "Ква", pace: "Тмп", racecraft: "Брб", clean: "Акк", teammate: "Нап",
      dotd: "ГД", career: "Кар" };
  const SHORT = EN ? {
    results: "Results", above_car: "Above car", quali: "Quali", pace: "Pace", racecraft: "Racecraft",
    clean: "Clean", teammate: "Teammate", dotd: "Fan vote", career: "Career",
  } : {
    results: "Результ.", above_car: "Над маш.", quali: "Квала", pace: "Темп", racecraft: "Борьба",
    clean: "Аккур.", teammate: "Напарник", dotd: "Гонщ. дня", career: "Карьера",
  };
  const groupName = (g) => (EN && GROUP_EN[g.id] ? GROUP_EN[g.id][0] : g.name);

  // Шкала яркости из макета — oklch(0,20+0,58·t  0,015+0,15·t  250). Переводим в rgb сами: один цвет
  // и в таблице, и на графе ECharts, и в браузерах без oklch.
  function ramp(t) {
    const k = Math.max(0, Math.min(1, t));
    const light = 0.2 + 0.58 * k;
    const chroma = 0.015 + 0.15 * k;
    const hue = (250 * Math.PI) / 180;
    const a = chroma * Math.cos(hue);
    const b = chroma * Math.sin(hue);
    const l = (light + 0.3963377774 * a + 0.2158037573 * b) ** 3;
    const m = (light - 0.1055613458 * a - 0.0638541728 * b) ** 3;
    const s = (light - 0.0894841775 * a - 1.291485548 * b) ** 3;
    const linear = [
      4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
      -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
      -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
    ];
    const rgb = linear.map((v) => {
      const c = Math.max(0, Math.min(1, v));
      return Math.round(255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055));
    });
    return `rgb(${rgb.join(",")})`;
  }

  // Цвет команды для метки у имени. Ключ — идентификатор команды (дефис и подчёркивание равны).
  const TEAM_COLORS = {
    ferrari: "#e8463a", mclaren: "#ff8a1f", mercedes: "#27c2b0", red_bull: "#3d5bd9", williams: "#6cc4f2",
    alpine: "#3a8ee6", aston_martin: "#2e8b57", haas: "#b6babd", sauber: "#5a8fd4", kick_sauber: "#52e252",
    alfa: "#a83a45", alfa_romeo: "#a83a45", audi: "#bfb8ae", cadillac: "#d0d0d0", rb: "#6692ff",
    racing_bulls: "#6692ff", alphatauri: "#5e7fa3", toro_rosso: "#4662c4", minardi: "#c9b037",
    renault: "#f5c518", lotus_f1: "#c8a548", benetton: "#4db87a", force_india: "#f48cb6", racing_point: "#f48cb6",
    jordan: "#f2c200", mf1: "#ff7f3f", spyker_mf1: "#ff7f3f", spyker: "#ff7f3f", bmw_sauber: "#7fa8d9",
    toyota: "#f06a6a", honda: "#c7c7c7", bar: "#d9d9d9", brawn: "#d9f25e", jaguar: "#1f9d55", stewart: "#e0e0e0",
    arrows: "#f2762e", footwork: "#d9534f", prost: "#3b6fd4", ligier: "#4a90d9", tyrrell: "#2f6fb5",
    forti: "#e6c100", super_aguri: "#e25555", lotus_racing: "#2f9e5b", caterham: "#2f9e5b", virgin: "#d9483b",
    marussia: "#d9483b", manor: "#e0503f", hrt: "#a89a7c",
    lotus: "#3f9c57", brabham: "#2f8f7a", cooper: "#2c6e49", brm: "#3b7a57", maserati: "#c0392b", march: "#e0703a",
    matra: "#3f7fd9", vanwall: "#2c6e49", lola: "#5b8dd9", dallara: "#d9483b", surtees: "#4a90d9",
    shadow: "#8a8a8a", osella: "#7fa8d9", fittipaldi: "#e6c100", leyton_house: "#63c7c1",
  };
  const teamColor = (team) => (team && TEAM_COLORS[String(team).replace(/-/g, "_")]) || null;

  // Места при «Сбалансированном» наборе — чтобы показать, кого текущие веса подняли или опустили.
  const baseRankCache = new Map();
  function baseRanks(key) {
    if (!baseRankCache.has(key)) {
      const base = computeScope(key, defaultWeights(key === PERIOD));
      baseRankCache.set(key, new Map(base.entries.filter((e) => e.rankNow).map((e) => [e.id, e.rankNow])));
    }
    return baseRankCache.get(key);
  }

  // Строки таблицы для обычного охвата: сортировка, стрелки ▲▼, вилки.
  function scopeView() {
    const key = state.scope;
    const { entries } = computeScope(key);
    const groups = scopeGroups(key);
    if (!["score", ...groups.map((g) => `g:${g.id}`)].includes(state.sort)) state.sort = "score";
    const value = (e) => (state.sort === "score" ? e.score : e.s[state.sort.slice(2)] ?? -1);
    const listed = entries.filter((e) => state.showAll || e.eligible);
    listed.sort((a, b) => value(b) - value(a) || b.score - a.score);
    const base = isDefaultWeights() ? null : baseRanks(key);
    const level = Math.round(100 * meta.interval);
    const rows = listed.map((e) => ({
      id: e.id,
      rank: e.rankNow,
      tie: state.sort === "score" && e.prev && e.prev.p < TIE_P
        ? L(`Почти не отличается от пилота выше: ${name(e.prev.id)} впереди ${share(e.prev.p)}`,
          `Barely different from the driver above: ${name(e.prev.id)} ahead ${share(e.prev.p)}`) : null,
      rankTitle: e.rankBand && e.rankBand[0] !== e.rankBand[1]
        ? L(`Место в ${level}% пересчётов: ${e.rankBand[0]}–${e.rankBand[1]}`,
          `Place in ${level}% of resamples: ${e.rankBand[0]}–${e.rankBand[1]}`) : null,
      delta: base && e.rankNow && base.get(e.id) ? base.get(e.id) - e.rankNow : 0,
      name: name(e.id),
      sub: e.teams.join(", ") + (e.eligible ? "" : ` · ${e.starts} ${plural(e.starts, "гонка", "гонки", "гонок", "race")}`),
      team: e.team,
      score: e.score,
      band: e.band,
      s: e.s,
      eligible: e.eligible,
    }));
    return {
      rows, groups, stats: [], sort: state.sort, top: TOP_N, expanded: state.expanded, selected: state.driver,
      setSort: (id) => { state.sort = id; renderTable(); },
      toggle: () => { state.expanded = !state.expanded; },
      select: (id) => selectDriver(id),
      hidden: state.showAll ? 0 : entries.filter((e) => !e.eligible).length,
    };
  }

  // Строки таблицы «Все времена»: те же столбцы, группы модели всех времён и три счётчика.
  function everView() {
    const stats = [
      ["titles", L("Тит", "Ttl"), L("Титулы", "Titles"), (d) => d.titles.length],
      ["wins", L("Поб", "Win"), L("Победы", "Wins"), (d) => d.wins],
      ["starts", L("Гон", "Rcs"), L("Гонки", "Races"), (d) => d.starts],
    ];
    const groups = EVER.groups.map((g) => ({ id: g.id, name: groupName(g), about: "" }));
    const sorts = ["score", ...groups.map((g) => `g:${g.id}`), ...stats.map(([id]) => id)];
    if (!sorts.includes(everState.sort)) everState.sort = "score";
    const stat = stats.find(([id]) => id === everState.sort);
    const value = (d) => (everState.sort === "score" ? d.rating : stat ? stat[3](d) : d.s[everState.sort.slice(2)]);
    const listed = EVER.drivers.slice().sort((a, b) => value(b) - value(a) || a.rank - b.rank);
    const rows = listed.map((d) => ({
      id: d.id, rank: d.rank, tie: null, rankTitle: null, delta: 0, name: d.name,
      sub: `${d.years[0]}–${d.years[1]}` + ((EN ? everCountry(d.country_id) : d.country) ? ` · ${EN ? everCountry(d.country_id) : d.country}` : ""),
      team: d.team, score: d.rating, band: null, s: d.s, eligible: true, stats: stats.map(([, , , get]) => get(d)),
    }));
    return {
      rows, groups, stats, sort: everState.sort, top: EVER_TOP, expanded: everState.expanded, selected: everState.open,
      setSort: (id) => { everState.sort = id; renderTable(); },
      toggle: () => { everState.expanded = !everState.expanded; },
      select: (id) => { everState.open = id; renderTable(); renderDriver(); renderMobileBar(); writeHash(); },
      hidden: 0,
    };
  }

  function renderTable() {
    const ever = state.scope === EVER_KEY;
    const view = ever ? everView() : scopeView();
    const { rows, groups, stats } = view;
    const cells = groups.length + stats.length;
    const strip = `repeat(${cells}, minmax(0, 1fr))`;

    // Шапка: сортировка — по баллу, по группе или (все времена) по счётчику.
    const head = $("#ranking-head");
    head.replaceChildren();
    const sorter = (label, id, title) => {
      const button = el("button", null, label);
      button.type = "button";
      if (title) button.title = title;
      if (view.sort === id) button.setAttribute("aria-sort", "descending");
      button.addEventListener("click", () => view.setSort(id));
      return button;
    };
    const cell = (cls, child) => {
      const node = el("span", cls);
      node.setAttribute("role", "columnheader");
      if (child != null) node.append(child);
      return node;
    };
    const level = Math.round(100 * meta.interval);
    const rankHead = cell("h-rank", "#");
    if (!ever && DRAWS[state.scope]) {
      rankHead.title = L(`«≈» — порядок с пилотом строкой выше держится меньше чем в ${Math.round(100 * TIE_P)}% ` +
        `пересчётов. Диапазон мест в ${level}% пересчётов — в подсказке к месту.`,
        `“≈” — the order with the row above holds in fewer than ${Math.round(100 * TIE_P)}% of resamples. ` +
        `Hover a place for its range in ${level}% of resamples.`);
    }
    const deltaHead = cell("h-delta", "");
    if (!ever) {
      deltaHead.title = L("▲▼ — на сколько мест пилот выше или ниже, чем при «Сбалансированном» наборе весов",
        "▲▼ — how many places the driver gains or loses versus the Balanced weights");
    }
    const heatHead = cell("h-heat");
    heatHead.style.gridTemplateColumns = strip;
    for (const g of groups) heatHead.append(sorter(ABBR[g.id] || g.name.slice(0, 3), `g:${g.id}`, g.about ? `${g.name}: ${g.about}` : g.name));
    for (const [id, label, title] of stats) heatHead.append(sorter(label, id, title));
    head.append(rankHead, deltaHead, cell("h-driver", L("Пилот", "Driver")),
      cell("h-score", sorter(L("Балл", "Score"), "score",
        L("0–100: 50 — средний пилот, +15 за каждое стандартное отклонение", "0–100: 50 is an average driver, +15 per standard deviation"))),
      heatHead);

    // Свёрнутая таблица: первые строки; выбранный пилот остаётся виден, даже если он ниже.
    let shown = rows;
    let pinned = null;
    if (!view.expanded && rows.length > view.top) {
      shown = rows.slice(0, view.top);
      pinned = rows.slice(view.top).find((r) => r.id === view.selected) || null;
    }
    const visible = pinned ? [...shown, pinned] : shown;
    // Цвет ячейки — балл группы относительно показанных пилотов.
    const range = {};
    for (const g of groups) {
      const values = visible.map((r) => r.s[g.id]).filter((v) => v != null);
      range[g.id] = [Math.min(...values), Math.max(...values)];
    }

    const body = $("#ranking-body");
    body.replaceChildren();
    for (const r of visible) {
      if (r === pinned) body.append(el("div", "rank-gap", "…"));
      const row = el("div", `rank-row${r.id === view.selected ? " selected" : ""}${r.eligible ? "" : " ineligible"}`);
      row.setAttribute("role", "row");
      row.dataset.id = r.id;

      const rank = el("span", "c-rank");
      rank.setAttribute("role", "cell");
      if (r.tie) {
        const tie = el("span", "tie", "≈");
        tie.title = r.tie;
        rank.append(tie);
      }
      rank.append(String(r.rank ?? "—"));
      if (r.rankTitle) rank.title = r.rankTitle;

      const deltaText = r.delta > 0 ? `▲${r.delta}` : r.delta < 0 ? `▼${-r.delta}` : "";
      const deltaClass = r.delta > 0 ? " up" : r.delta < 0 ? " down" : "";
      const delta = el("span", `c-delta${deltaClass}`, deltaText);
      delta.setAttribute("role", "cell");
      if (deltaText) {
        delta.title = L(`${Math.abs(r.delta)} ${plural(Math.abs(r.delta), "место", "места", "мест")} ` +
          `${r.delta > 0 ? "вверх" : "вниз"} относительно «Сбалансированного» набора`,
          `${Math.abs(r.delta)} ${plural(Math.abs(r.delta), "", "", "", "place")} ${r.delta > 0 ? "up" : "down"} vs Balanced`);
      }

      const driver = el("div", "c-driver");
      driver.setAttribute("role", "cell");
      const stripe = el("span", "stripe");
      const color = teamColor(r.team);
      if (color) stripe.style.background = color;
      const button = el("button", "dname", r.name);
      button.type = "button";
      driver.append(stripe, button, el("span", `delta-inline${deltaClass}`, deltaText), el("span", "dteams", r.sub));
      driver.title = `${r.name} · ${r.sub}`;

      const value = el("span", "c-val", int(r.score));
      value.setAttribute("role", "cell");
      const barCell = el("div", "c-bar");
      barCell.setAttribute("role", "cell");
      const bar = el("div", "sbar");
      bar.setAttribute("role", "img");
      bar.setAttribute("aria-label", L(`Балл ${Math.round(r.score)} из 100`, `Score ${Math.round(r.score)} of 100`) +
        (r.band ? L(`, вилка ${int(r.band[0])}–${int(r.band[1])}`, `, range ${int(r.band[0])}–${int(r.band[1])}`) : ""));
      const fill = el("div", "fill");
      fill.style.width = `${Math.max(0, Math.min(100, r.score))}%`;
      bar.append(fill, el("div", "tick"));
      if (r.band) {
        const whisker = el("div", "whisker");
        whisker.style.left = `${r.band[0]}%`;
        whisker.style.width = `${Math.max(0, r.band[1] - r.band[0])}%`;
        bar.append(whisker);
        bar.title = L(`Вилка балла ${int(r.band[0])}–${int(r.band[1])}`, `Score range ${int(r.band[0])}–${int(r.band[1])}`);
      }
      barCell.append(bar);

      const heat = el("div", "c-heat");
      heat.setAttribute("role", "cell");
      heat.style.gridTemplateColumns = strip;
      for (const g of groups) {
        const v = r.s[g.id];
        const [lo, hi] = range[g.id];
        const t = v == null || !(hi > lo) ? 0 : (v - lo) / (hi - lo);
        const box = el("span", "cell", v == null ? "—" : int(v));
        box.style.background = ramp(t);
        box.style.color = t > 0.55 ? "#0b0c0e" : "#cfccc6";
        if (t > 0.85) box.style.fontWeight = "600";
        box.title = `${g.name}: ${v == null ? "—" : int(v)}`;
        heat.append(box);
      }
      (r.stats || []).forEach((v, i) => {
        const box = el("span", "cell stat", String(v));
        box.title = `${stats[i][2]}: ${v}`;
        heat.append(box);
      });

      row.append(rank, delta, driver, value, barCell, heat);
      row.addEventListener("click", () => view.select(r.id));
      body.append(row);
    }

    // Под таблицей: «Показать всех» (вместо галочки над таблицей) и шкала цветной полосы.
    const more = $("#table-more");
    more.replaceChildren();
    if (rows.length > view.top) {
      const button = el("button", "more-btn", view.expanded
        ? L(`Свернуть до топ-${view.top}`, `Collapse to top ${view.top}`)
        : L(`Показать всех: ${rows.length} ${plural(rows.length, "пилот", "пилота", "пилотов")}`, `Show all ${rows.length} drivers`));
      button.type = "button";
      button.setAttribute("aria-expanded", String(view.expanded));
      button.addEventListener("click", () => {
        view.toggle();
        renderTable();
        if (view.expanded) $("#ranking-title").scrollIntoView({ behavior: "smooth", block: "nearest" });
      });
      more.append(button);
    }
    if (!ever) {
      const min = state.scope === PERIOD ? meta.min_starts.period : meta.min_starts.season;
      const few = scopes[state.scope].filter((e) => !e.eligible).length;
      if (few) {
        const toggle = el("button", "link-btn", state.showAll
          ? L(`Скрыть пилотов, у которых меньше ${min} гонок`, `Hide drivers with fewer than ${min} races`)
          : L(`Показать ещё ${few} — у кого меньше ${min} гонок`, `Show ${few} more with fewer than ${min} races`));
        toggle.type = "button";
        toggle.addEventListener("click", () => {
          state.showAll = !state.showAll;
          if (state.showAll) state.expanded = true;
          renderTable();
        });
        more.append(toggle);
      }
    }
    const legend = $("#heat-legend");
    legend.replaceChildren(
      el("span", null, L("Балл группы относительно показанных пилотов", "Group score, relative to this field")),
      el("span", "mono", L("ниже", "low")), el("span", "ramp"), el("span", "mono", L("выше", "high")));
    legend.querySelector(".ramp").style.background = `linear-gradient(90deg, ${ramp(0)}, ${ramp(0.5)}, ${ramp(1)})`;
  }

  // options.scroll = false — не прокручивать к карточке (клик по графу не должен уводить страницу вверх).
  function selectDriver(id, options = {}) {
    if (id !== state.driver) state.compare = null;
    state.driver = id;
    renderTable();  // в свёрнутой таблице выбранный пилот может быть ниже топа — дорисуем его строку
    renderDriver();
    renderMobileBar();
    writeHash();
    syncGraph(id);
    // одна колонка (планшет): карточка под таблицей — прокрутим к ней; на телефоне она открывается листом
    if (options.scroll !== false && !DESKTOP.matches && !MOBILE.matches) {
      $("#driver").scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }

  // ---------- телефон: строка выбранного пилота и нижние листы ----------
  function openSheet(which) {
    document.body.dataset.sheet = which;
    $("#sheet-backdrop").hidden = false;
    if (which === "driver") setTimeout(() => charts.forEach((c) => c.resize()), 220);
  }

  function closeSheet() {
    delete document.body.dataset.sheet;
    $("#sheet-backdrop").hidden = true;
  }

  function renderMobileBar() {
    const bar = $("#mobile-bar");
    const ever = state.scope === EVER_KEY;
    let title = null;
    let sub = "";
    if (ever) {
      const d = EVER.drivers.find((x) => x.id === everState.open);
      if (d) {
        title = d.name;
        sub = `#${d.rank} · ${L("балл", "score")} ${int(d.rating)}`;
      }
    } else {
      const e = state.driver && computeScope(state.scope).byId.get(state.driver);
      if (e) {
        title = name(e.id);
        sub = `${e.rankNow ? `#${e.rankNow} · ` : ""}${L("балл", "score")} ${int(e.score)}` +
          (e.band ? ` · ${int(e.band[0])}–${int(e.band[1])}` : "");
      }
    }
    bar.hidden = !title;
    if (!title) return;
    const text = el("div", "mb-text");
    text.append(el("span", "mb-name", title), el("span", "mb-sub", sub));
    const open = el("button", "mb-open", L("Подробнее ↑", "Details ↑"));
    open.type = "button";
    open.addEventListener("click", () => openSheet("driver"));
    bar.replaceChildren(text, open);
  }

  // ---------- карточка пилота ----------
  let charts = [];
  function disposeCharts() {
    charts.forEach((c) => c.dispose());
    charts = [];
  }
  const cssVar = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
  const FONT = '"IBM Plex Sans", system-ui, -apple-system, "Segoe UI", sans-serif';
  const palette = () => ({
    stage: cssVar("--stage"), accentSoft: cssVar("--accent-soft"),
    s1: cssVar("--series-1"), s2: cssVar("--series-2"),
    text1: cssVar("--text-1"), text2: cssVar("--text-2"), muted: cssVar("--muted"),
    grid: cssVar("--grid"), axis: cssVar("--axis"), surface: cssVar("--surface"), border: cssVar("--border"),
  });

  // Строка-заголовок блока: мелкие прописные слева и (если есть) пояснение справа.
  function monoHead(left, right) {
    const head = el("div", "mono-head");
    head.append(el("span", null, left));
    if (right) head.append(el("span", null, right));
    return head;
  }

  // Три главные цифры карточки: [подпись, значение, мелкое ли].
  function statStrip(cells) {
    const strip = el("div", "stat-strip");
    for (const [label, value, small] of cells) {
      const cell = el("div", "stat-cell");
      cell.append(el("span", "label", label), el("span", `value${small ? " small" : ""}`, value));
      strip.append(cell);
    }
    return strip;
  }

  // Балл группы относительно среднего пилота (50): вправо — выше, влево — ниже.
  // zero — группы с нулевым весом (в итог не идут): их подписи приглушены.
  function groupBars(groups, scores, zero) {
    const block = el("div", "block");
    block.append(monoHead(L("По группам", "By group"), L("к среднему (50)", "vs average (50)")));
    for (const g of groups) {
      const v = scores[g.id];
      if (v == null) continue;
      const row = el("div", `gbar${zero.has(g.id) ? " zero" : ""}`);
      row.title = (g.about ? `${g.name}: ${g.about}` : g.name) +
        (zero.has(g.id) ? L(" (сейчас в итог не входит)", " (not in the total now)") : "");
      const d = Math.max(-50, Math.min(50, v - 50));
      const track = el("div", "gtrack");
      track.setAttribute("role", "img");
      track.setAttribute("aria-label", `${g.name}: ${int(v)}, ${d >= 0 ? L("выше среднего", "above average") : L("ниже среднего", "below average")}`);
      const fill = el("div", `gfill ${d >= 0 ? "pos" : "neg"}`);
      fill.style.left = `${d >= 0 ? 50 : 50 + d}%`;
      fill.style.width = `${Math.abs(d)}%`;
      track.append(fill);
      row.append(el("span", "gname", g.name), track, el("span", "gval", int(v)));
      block.append(row);
    }
    return block;
  }

  // Одна фраза о пилоте: две сильнейшие группы, слабейшая и уровень относительно среднего.
  function summaryText(groups, scores, score, zero) {
    const ranked = groups.filter((g) => !zero.has(g.id) && scores[g.id] != null)
      .map((g) => ({ n: g.name, v: scores[g.id] })).sort((a, b) => b.v - a.v);
    const level = score >= 75 ? L("Заметно выше среднего пилота.", "Clearly above an average driver.")
      : score >= 60 ? L("Выше среднего пилота.", "Above an average driver.")
        : score >= 40 ? L("Близко к среднему пилоту.", "Close to an average driver.")
          : L("Ниже среднего пилота.", "Below an average driver.");
    if (ranked.length < 3) return level;
    const [a, b] = ranked;
    const c = ranked[ranked.length - 1];
    return L(`Сильнее всего — «${a.n}» и «${b.n}», слабее всего — «${c.n}». ${level}`,
      `Strongest in ${a.n.toLowerCase()} and ${b.n.toLowerCase()}; weakest in ${c.n.toLowerCase()}. ${level}`);
  }

  // Дуэли с напарниками: в сводке — каждый напарник за весь период, в сезоне — счёт сезона.
  const H2H_TOP = 6;
  function h2hBlock(id, current, isPeriod) {
    const block = el("div", "block ruled");
    block.append(monoHead(L("Дуэли с напарниками", "Head-to-head with teammates")));
    const row = (label, won, lost, unit, title) => {
      const line = el("div", "h2h-row");
      if (title) line.title = title;
      const total = won + lost;
      const bar = el("div", "hbar");
      const part = el("span");
      part.style.width = `${total ? Math.round((100 * won) / total) : 0}%`;
      bar.append(part);
      bar.setAttribute("role", "img");
      bar.setAttribute("aria-label", `${won}:${lost}`);
      line.append(el("span", "hname", label), bar, el("span", "hval", unit));
      return line;
    };
    if (isPeriod) {
      const mates = (gAdj.get(id) || []).slice().sort((x, y) => y.edge.races - x.edge.races);
      const lines = [];
      for (const { to, edge } of mates) {
        const o = oriented(edge, id);
        const race = o.race && o.race[0] + o.race[1] > 0;
        const pair = race ? o.race : o.quali;
        if (!pair || pair[0] + pair[1] === 0) continue;
        const pct = Math.round((100 * pair[0]) / (pair[0] + pair[1]));
        lines.push(row(name(to), pair[0], pair[1], `${pct}% ${race ? L("гонок", "fin.") : L("квал.", "quali")}`,
          linkText(edge, id, to)));
      }
      if (!lines.length) return null;
      lines.slice(0, H2H_TOP).forEach((line) => block.append(line));
      if (lines.length > H2H_TOP) {
        const rest = el("div", "block");
        rest.hidden = true;
        lines.slice(H2H_TOP).forEach((line) => rest.append(line));
        const toggle = el("button", "link-btn", L(`Ещё напарников: ${lines.length - H2H_TOP}`, `${lines.length - H2H_TOP} more teammates`));
        toggle.type = "button";
        toggle.addEventListener("click", () => { rest.hidden = false; toggle.remove(); });
        block.append(rest, toggle);
      }
      block.append(el("p", "hint", L("Доля гонок, где пилот финишировал выше напарника (когда финишировали оба).",
        "Share of races finished ahead of the teammate (when both finished).")));
      return block;
    }
    const tm = current.tm;
    if (!tm || (!tm.h2h_quali && !tm.h2h_race)) return null;
    const mates = (current.teammates || []).map(name).join(", ");
    if (tm.h2h_quali) {
      const [won, n] = tm.h2h_quali;
      block.append(row(L("Квалификации", "Qualifying"), won, n - won, `${won}:${n - won}`));
    }
    if (tm.h2h_race) {
      const [won, n] = tm.h2h_race;
      block.append(row(L("Гонки", "Races"), won, n - won, `${won}:${n - won}`));
    }
    if (mates) block.append(el("p", "hint", L(`Напарники в сезоне: ${mates}.`, `Teammates this season: ${mates}.`)));
    return block;
  }

  function closeButton() {
    const button = el("button", "sheet-close", "×");
    button.type = "button";
    button.setAttribute("aria-label", L("Закрыть", "Close"));
    button.addEventListener("click", closeSheet);
    return button;
  }

  function renderDriver() {
    const box = $("#driver");
    box.replaceChildren(closeButton());
    disposeCharts();
    if (state.scope === EVER_KEY) {
      renderEverDriver(box);
      return;
    }
    const id = state.driver;
    const driver = drivers[id];
    const scope = computeScope(state.scope);
    const current = scope.byId.get(id);
    if (!driver) {
      box.append(el("p", "empty", L("Выберите пилота в таблице.", "Pick a driver in the table.")));
      return;
    }
    if (!current) {
      box.append(el("h2", null, driver.name),
        el("p", "empty", L(`В сезоне ${state.scope} пилот не выступал. Выберите «Все сезоны», ` +
          "чтобы открыть его полную карточку.", `The driver did not race in ${state.scope}. Choose “All seasons” ` +
          "to open the full card.")));
      return;
    }
    const isPeriod = state.scope === PERIOD;
    const other = state.compare ? scope.byId.get(state.compare) || null : null;
    const groups = scopeGroups(state.scope);
    const zero = new Set(groups.filter((g) => !((scope.w[g.id] || 0) > 0)).map((g) => g.id));

    // Шапка: фото, имя, команды, гонки и годы, главные факты
    const head = el("div", "driver-head");
    const title = el("div", "driver-title");
    const seasons = isPeriod ? current.seasons || [] : [];
    const years = isPeriod
      ? (seasons.length ? (seasons[0] === seasons[seasons.length - 1] ? `${seasons[0]}` : `${seasons[0]}–${seasons[seasons.length - 1]}`) : "")
      : L(`сезон ${state.scope}`, `${state.scope} season`);
    const races = `${current.starts} ${plural(current.starts, "гонка", "гонки", "гонок", "race")}`;
    const wins = Math.round(current.stats.wins);
    const podiums = Math.round(current.stats.podiums);
    const facts = [];
    if (isPeriod) {
      const titles = current.titles || [];
      facts.push(titles.length
        ? `${titles.length} ${plural(titles.length, "титул", "титула", "титулов", "title")} (${titles.join(", ")})`
        : L("без титулов", "no titles"));
    } else if (current.standing) {
      facts.push(current.champion ? L("чемпион", "champion")
        : L(`${current.standing}-й в чемпионате`, `${ord(current.standing)} in the championship`));
    }
    facts.push(`${wins} ${plural(wins, "победа", "победы", "побед", "win")}`,
      `${podiums} ${plural(podiums, "подиум", "подиума", "подиумов", "podium")}`);
    title.append(el("h2", null, driver.name),
      el("span", "meta", (current.teams || []).join(", ")),
      el("span", "meta", [races, years].filter(Boolean).join(" · ")),
      el("span", "meta", facts.join(" · ")), shareButton());
    const photo = photoBlock(driver.photo, driver.name);
    if (photo) head.append(photo.img);
    head.append(title);
    box.append(head);
    if (photo) box.append(photo.credit);

    // Место, балл, вилка
    box.append(statStrip([
      [L("Место", "Rank"), current.rankNow ? String(current.rankNow) : "—"],
      [L("Балл", "Score"), int(current.score)],
      [L("Вилка", "Likely range"), current.band ? `${int(current.band[0])}–${int(current.band[1])}` : "—", true],
    ]));
    box.append(el("p", "summary", summaryText(groups, current.s, current.score, zero)));
    box.append(groupBars(groups, current.s, zero));
    const h2h = h2hBlock(id, current, isPeriod);
    if (h2h) box.append(h2h);

    box.append(compareBlock(id, current, other));
    if (!isPeriod) roundsBlock(box, state.scope, id, other);

    const historyOf = (who) => SEASON_KEYS.slice().reverse()
      .map((key) => ({ season: Number(key), e: computeScope(key).byId.get(who) }))
      .filter((h) => h.e);
    const history = historyOf(id);
    if (history.length > 1) {
      const trend = el("div", "block ruled");
      trend.append(monoHead(L("По сезонам", "By season"), L("рейтинг сезона", "season rating")));
      const trendBox = el("div", "chart");
      trendBox.setAttribute("role", "img");
      trendBox.setAttribute("aria-label", L("Рейтинг по сезонам; значения — в таблице в блоке «Подробнее»",
        "Rating by season; values are in the table under “More”"));
      trend.append(trendBox);
      box.append(trend);
      drawTrend(trendBox, history, other ? { id: other.id, history: historyOf(other.id) } : null);
    }

    // Подробнее: биография, точность, профиль, признаки, таблица сезонов, дождь и трассы
    const more = el("details", "more");
    more.open = state.more;
    more.append(el("summary", null, L("Подробнее о пилоте", `More about ${driver.name}`)));
    const body = el("div", "more-body");
    more.append(body);
    const bio = EN ? driver.bio_en : driver.bio;
    if (bio) body.append(bioBlock(bio));
    const notes = el("div", "block");
    const facts2 = [country(driver.nationality)];
    if (driver.dob) facts2.push(L(`родился ${dateRu(driver.dob)}`, `born ${dateRu(driver.dob)}`));
    if (driver.debut) facts2.push(L(`дебют в F1 — ${driver.debut}`, `F1 debut ${driver.debut}`));
    notes.append(el("p", "hint", facts2.join(" · ")));
    const precision = precisionText(current);
    if (precision) notes.append(el("p", "hint", precision));
    const gn = gNodes.get(id);
    if (gn) {
      notes.append(el("p", "hint", L(
        `Надёжность сравнения с остальными пилотами: ${reliabilityText(gn)} · ` +
        `напарников ${gn.teammates}` + (gn.bridge_cut ? ` · «мост»: без него от сети отрываются пилотов — ${gn.bridge_cut}` : ""),
        `Reliability of comparison with other drivers: ${reliabilityText(gn)} · teammates ${gn.teammates}` +
        (gn.bridge_cut ? ` · “bridge”: without them ${gn.bridge_cut} drivers split off the network` : ""))));
    }
    body.append(notes);

    const profile = el("div", "block");
    profile.append(monoHead(L("Профиль по группам", "Profile by group")));
    const radarBox = el("div", "chart radar");
    radarBox.setAttribute("role", "img");
    const radarText = (e) => groups.map((g) => `${g.name} ${int(e.s[g.id])}`).join(", ");
    radarBox.setAttribute("aria-label", `${L("Баллы по группам", "Group scores")}: ${radarText(current)}` +
      (other ? `. ${name(other.id)}: ${radarText(other)}` : ""));
    profile.append(radarBox);
    body.append(profile);
    body.append(featureList(groups, current));
    if (history.length) {
      const table = el("div", "block");
      table.append(monoHead(L("Сезоны", "Seasons")), historyTable(history));
      body.append(table);
    }
    const conditions = conditionsBlock(id, current);
    if (conditions) body.append(conditions);
    const tmSeason = isPeriod ? history[history.length - 1] : history.find((h) => String(h.season) === state.scope);
    if (tmSeason && tmSeason.e.tm) body.append(teammateBlock(tmSeason));
    box.append(more);
    // Профиль рисуется, только когда блок раскрыт: скрытому графику неоткуда взять размер.
    let drawn = false;
    const drawProfile = () => {
      if (drawn || !more.open) return;
      drawn = true;
      drawRadar(radarBox, groups, current, other);
    };
    more.addEventListener("toggle", () => { state.more = more.open; drawProfile(); });
    drawProfile();
  }

  // Карточка пилота из рейтинга всех времён: те же блоки, группы и факты модели всех времён.
  function renderEverDriver(box) {
    const d = EVER.drivers.find((x) => x.id === everState.open);
    if (!d) {
      box.append(el("p", "empty", L("Выберите пилота в таблице.", "Pick a driver in the table.")));
      return;
    }
    const groups = EVER.groups.map((g) => ({ id: g.id, name: groupName(g), about: "" }));
    const linked = d.card && drivers[d.card] ? drivers[d.card] : null;
    const head = el("div", "driver-head");
    const title = el("div", "driver-title");
    const land = EN ? everCountry(d.country_id) : d.country;
    const span = d.years[0] === d.years[1] ? `${d.years[0]}` : `${d.years[0]}–${d.years[1]}`;
    const facts = [
      d.titles.length ? `${d.titles.length} ${plural(d.titles.length, "титул", "титула", "титулов", "title")} (${d.titles.join(", ")})`
        : L("без титулов", "no titles"),
      `${d.wins} ${plural(d.wins, "победа", "победы", "побед", "win")}`,
      `${d.podiums} ${plural(d.podiums, "подиум", "подиума", "подиумов", "podium")}`,
      `${d.poles} ${plural(d.poles, "поул", "поула", "поулов", "pole")}`,
    ];
    title.append(el("h2", null, d.name),
      el("span", "meta", [land, span].filter(Boolean).join(" · ")),
      el("span", "meta", `${d.starts} ${plural(d.starts, "гонка", "гонки", "гонок", "race")}`),
      el("span", "meta", facts.join(" · ")), shareButton());
    const photo = linked ? photoBlock(linked.photo, d.name) : null;
    if (photo) head.append(photo.img);
    head.append(title);
    box.append(head);
    if (photo) box.append(photo.credit);

    box.append(statStrip([
      [L("Место", "Rank"), String(d.rank)],
      [L("Балл", "Score"), int(d.rating)],
      [L("Титулы", "Titles"), String(d.titles.length)],
    ]));
    box.append(el("p", "summary", summaryText(groups, d.s, d.rating, new Set())));
    box.append(groupBars(groups, d.s, new Set()));

    const career = el("div", "block ruled");
    career.append(monoHead(L("Карьера", "Career")));
    const best = d.best.map(([year, rating, rank]) => `${year} — ${int(rating)} (${L(`${rank}-е место`, ord(rank))})`).join(", ");
    career.append(
      el("p", "hint", L(`Лучшие сезоны: ${best || "—"}.`, `Best seasons: ${best || "—"}.`)),
      el("p", "hint", L(`С дебюта: ${num(d.seasons, 1)} сезона в F1, впереди напарника в чемпионате — в ${d.ahead} из ${d.compared}.`,
        `Since the debut: ${num(d.seasons, 1)} seasons in F1, ahead of the teammate in the championship in ${d.ahead} of ${d.compared}.`)));
    if (d.records > 0) {
      career.append(el("p", "hint", L(`Рекорды F1: ${num(d.records, 1)} очка — корень из лет удержания по каждому из семи ` +
        "рекордов плюс бонус за побитый чужой рекорд.", `F1 records: ${num(d.records, 1)} points — the square root of years ` +
        "held for each of seven records, plus a bonus for breaking someone else's record.")));
    }
    if (linked) {
      const open = el("button", "link-btn", L(`Полная карточка за ${meta.period[0]}–${meta.period[1]} →`,
        `Full card for ${meta.period[0]}–${meta.period[1]} →`));
      open.type = "button";
      open.addEventListener("click", () => {
        state.scope = PERIOD;
        state.compare = null;
        state.driver = d.card;
        render();
      });
      career.append(open);
    }
    box.append(career);
  }

  function featureValue(f, e) {
    const pair = e.f[f.id];
    if (!pair) return "—";
    return f.id === "ahead" && e.career ? L(`${int(pair[0])} из ${e.career.compared}`, `${int(pair[0])} of ${e.career.compared}`)
      : fmtFeature(f.unit, pair[0]);
  }

  function featureList(groups, e) {
    const wrap = el("div", "features");
    for (const g of groups) {
      const block = el("div", "feature-group");
      const title = el("h4");
      title.append(el("span", null, g.name), el("span", null, int(e.s[g.id])));
      block.append(title);
      for (const f of FEATURES.filter((x) => x.group === g.id)) {
        const pair = e.f[f.id];
        if (!pair) continue;
        const row = el("div", "feature");
        const score = 50 + 15 * (pair[1] ?? 0);
        row.append(el("span", "fname", f.name), el("span", "fvalue", featureValue(f, e)),
          meter(score, `${f.name}: ${score > 50 ? L("лучше", "better than") : L("хуже", "worse than")} ${L("среднего", "average")}`));
        block.append(row);
      }
      if (g.id === "clean") block.append(incidentsNote(e));
      if (g.id === "career") block.append(careerNote(e));
      wrap.append(block);
    }
    return wrap;
  }

  // Откуда «Карьера»: факты с дебюта в F1 (F1DB) и запас над средним по нашим сезонам.
  function careerNote(e) {
    const box = el("div", "incidents");
    const c = e.career;
    if (c) {
      const has = (e.titles || []).length;
      box.append(el("p", null, L(`С дебюта в ${c.debut} году: ${num(c.seasons, 1)} сезона в F1, ` +
        `впереди напарника в чемпионате — в ${c.ahead} из ${c.compared}, ` +
        `${has ? `титулы — ${e.titles.join(", ")}` : "титулов нет"}.`,
        `Since the ${c.debut} debut: ${num(c.seasons, 1)} seasons in F1, ahead of the teammate in the championship ` +
        `in ${c.ahead} of ${c.compared}, ${has ? `titles — ${e.titles.join(", ")}` : "no titles"}.`)));
    }
    box.append(el("p", "muted", L("Рекорды — семь рекордов F1 (победы, поулы, подиумы, быстрые круги, титулы, победы " +
      "за сезон и подряд): корень из лет удержания по каждому плюс бонус за побитый чужой рекорд.",
      "Records — seven F1 records (wins, poles, podiums, fastest laps, titles, wins in a season and in a row): " +
      "the square root of years held for each, plus a bonus for breaking someone else's record.")));
    box.append(el("p", "muted", L(`Запас над средним — сумма по сезонам ${meta.period[0]}–${meta.period[1]}: ` +
      "на сколько баллов пилот был выше 50 (сезоны ниже среднего не отнимают ничего).",
      `Margin above average — the sum over ${meta.period[0]}–${meta.period[1]} seasons of how many points the ` +
      "driver was above 50 (below-average seasons take nothing away).")));
    return box;
  }

  // Из чего сложилась «Аккуратность»: в сезоне — сами гонки, в сводке — счёт за все сезоны.
  function incidentsNote(e) {
    const isPeriod = state.scope === PERIOD;
    const kinds = { error: [], collision: [], penalty: [], victim: [], contact: [], mech: [], dsq: [] };
    const seasons = isPeriod ? SEASON_KEYS : [state.scope];
    for (const key of seasons) {
      const entry = key === state.scope ? e : scopes[key].find((x) => x.id === e.id);
      for (const [round, kind, detail, lap] of (entry && entry.incidents) || []) {
        if (kinds[kind]) kinds[kind].push({ key, round, detail, lap });
      }
    }
    const box = el("div", "incidents");
    const count = (list, one, few, many, enOne, enMany) =>
      `${list.length} ${plural(list.length, one, few, many, enOne, enMany)}`;
    const sec = L("с", "s");
    if (isPeriod) {
      box.append(el("p", null, L(
        `За все сезоны: ${count(kinds.error, "своя авария", "свои аварии", "своих аварий")} ` +
        `или разворота, ${count(kinds.collision, "столкновение", "столкновения", "столкновений")} по решению стюардов ` +
        `(с ${FIA_FROM} года), ${count(kinds.penalty, "другой штраф", "других штрафа", "других штрафов")} по времени.`,
        `Over all seasons: ${count(kinds.error, "", "", "", "own crash or spin", "own crashes or spins")}, ` +
        `${count(kinds.collision, "", "", "", "collision", "collisions")} per stewards' decisions (since ${FIA_FROM}), ` +
        `${count(kinds.penalty, "", "", "", "other time penalty", "other time penalties")}.`)));
      const outside = [
        [kinds.victim, "чужое столкновение", "чужих столкновения", "чужих столкновений", "collision caused by others"],
        [kinds.contact, "столкновение без виновника", "столкновения без виновника", "столкновений без виновника",
          "collision with no one to blame", "collisions with no one to blame"],
        [kinds.mech, "поломка", "поломки", "поломок", "failure"],
        [kinds.dsq, "дисквалификация", "дисквалификации", "дисквалификаций", "disqualification"]]
        .filter(([list]) => list.length).map(([list, ...forms]) => count(list, ...forms));
      if (outside.length) box.append(el("p", "muted", L(`Не в счёт: ${outside.join(", ")}.`, `Not counted: ${outside.join(", ")}.`)));
      return box;
    }
    const line = (label, list, fmt) => {
      const p = el("p");
      p.append(el("span", "muted", `${label}: `), list.length ? list.map(fmt).join("; ") : L("нет", "none"));
      return p;
    };
    const lapText = (x) => (x.lap ? L(`, ${x.lap}-й круг`, `, lap ${x.lap}`) : "");
    const collisionText = (x) => `${gpName(x.key, x.round)}` + (x.lap ? L(` (сошёл${lapText(x)})`, ` (retired${lapText(x)})`)
      : typeof x.detail === "number" && x.detail > 0 ? ` (+${int(x.detail)} ${sec})` : "");
    const collisions = Number(state.scope) < FIA_FROM
      ? el("p", null, L(`Столкновения по решению стюардов: нет данных — решения есть с ${FIA_FROM} года`,
        `Collisions per stewards' decisions: no data — decisions are available since ${FIA_FROM}`))
      : line(L("Столкновения по решению стюардов", "Collisions per stewards' decisions"), kinds.collision, collisionText);
    box.append(
      line(L("Свои аварии и развороты", "Own crashes and spins"), kinds.error,
        (x) => `${gpName(x.key, x.round)} — ${cause(x.detail, "accident")}${lapText(x)}`),
      collisions,
      line(L("Другие штрафы по времени", "Other time penalties"), kinds.penalty,
        (x) => `${gpName(x.key, x.round)} +${int(x.detail)} ${sec}`),
    );
    const outside = [
      ...kinds.victim.map((x) => `${gpName(x.key, x.round)} (${L("пострадал, наказан соперник", "victim, the rival was penalised")})`),
      ...kinds.contact.map((x) => `${gpName(x.key, x.round)} (${L("столкновение без виновника", "collision with no one to blame")})`),
      ...kinds.mech.map((x) => `${gpName(x.key, x.round)} (${cause(x.detail, L("поломка", "failure"))})`),
      ...kinds.dsq.map((x) => `${gpName(x.key, x.round)} (${L("дисквалификация", "disqualification")})`)];
    if (outside.length) box.append(el("p", "muted", L(`Не в счёт: ${outside.join("; ")}.`, `Not counted: ${outside.join("; ")}.`)));
    return box;
  }

  // Дождь и типы трасс — справка, в балл не входят (проверка: features/conditions.py).
  const CIRCUIT_RU = {
    monaco: "Монако", "marina-bay": "Сингапур", madring: "Мадрид", baku: "Баку", montreal: "Монреаль",
    miami: "Майами", melbourne: "Мельбурн", "las-vegas": "Лас-Вегас", jeddah: "Джидда", "mexico-city": "Мехико",
    hungaroring: "Хунгароринг", austin: "Остин", sepang: "Сепанг", istanbul: "Стамбул", shanghai: "Шанхай",
    zandvoort: "Зандворт", bahrain: "Бахрейн", nurburgring: "Нюрбургринг", portimao: "Портимао",
    interlagos: "Интерлагос", catalunya: "Барселона", hockenheimring: "Хоккенхайм", "yas-marina": "Яс-Марина",
    sirius: "Сочи", "paul-ricard": "Поль Рикар", suzuka: "Сузука", imola: "Имола", spielberg: "Шпильберг",
    lusail: "Лусаил", "spa-francorchamps": "Спа", silverstone: "Сильверстоун", mugello: "Муджелло", monza: "Монца",
    buddh: "Будда (Индия)", valencia: "Валенсия", yeongam: "Йонам",
    "magny-cours": "Маньи-Кур", indianapolis: "Индианаполис", fuji: "Фудзи",
    "buenos-aires": "Буэнос-Айрес", estoril: "Эшторил", jerez: "Херес",
  };
  const TRACK_RU = EN ? { street: "street", fast: "fast", technical: "technical" }
    : { street: "уличные", fast: "скоростные", technical: "технические" };
  // Трасса по-английски — из идентификатора F1DB: «marina-bay» → «Marina Bay».
  const circuitName = (id) => (EN ? id.split("-").map((w) => w[0].toUpperCase() + w.slice(1)).join(" ")
    : CIRCUIT_RU[id] || id);

  function conditionsBlock(id, e) {
    const isPeriod = state.scope === PERIOD;
    const c = (drivers[id] && drivers[id].conditions) || {};
    const lines = [];
    if (isPeriod && c.wet) {
      const w = c.wet;
      const share = (pair) => (pair && pair[1] ? `${Math.round((100 * pair[0]) / pair[1])}%` : "—");
      const gap = (v) => (v == null ? "—" : `${signed(v, 2)}%`);
      let text = L(`В дождь (${w.races} ${plural(w.races, "гонка", "гонки", "гонок")}): против напарника по темпу ` +
        `${gap(w.pace_wet)} (в сухих — ${gap(w.pace_dry)}), ` +
        `выше напарника на финише в ${share(w.duels_wet)} дождевых гонок (в сухих — ${share(w.duels_dry)}).`,
        `In the wet (${w.races} ${plural(w.races, "", "", "", "race")}): pace vs teammate ${gap(w.pace_wet)} ` +
        `(dry — ${gap(w.pace_dry)}), finished ahead of the teammate in ${share(w.duels_wet)} of wet races ` +
        `(dry — ${share(w.duels_dry)}).`);
      if (w.best) {
        text += L(` Лучшая дождевая гонка: ${gpName(String(w.best[0]), w.best[1])} ${w.best[0]} — ` +
          `${w.best[2]}-е место` + (w.best[3] ? ` со старта ${w.best[3]}-м.` : "."),
          ` Best wet race: ${gpName(String(w.best[0]), w.best[1])} ${w.best[0]} — ${ord(w.best[2])}` +
          (w.best[3] ? ` from ${ord(w.best[3])} on the grid.` : "."));
      }
      lines.push(text);
    }
    if (isPeriod && c.tracks) {
      const parts = ["street", "fast", "technical"].filter((t) => c.tracks[t])
        .map((t) => `${TRACK_RU[t]} ${signed(c.tracks[t].rel, 1)} (${c.tracks[t].races})`);
      if (parts.length) {
        lines.push(L(`По типам трасс — очки сверх машины относительно своего среднего: ${parts.join(", ")}.`,
          `By track type — points above the car relative to the driver's own average: ${parts.join(", ")}.`));
      }
    }
    if (!isPeriod && e.wet_races && e.wet_races.length) {
      const races = e.wet_races.map(([round, pos, grid, status]) => `${gpName(state.scope, round)} — ` +
        (pos ? L(`${pos}-е` + (grid ? ` со старта ${grid}-м` : ""), ord(pos) + (grid ? ` from ${ord(grid)}` : ""))
          : cause(status, L("сход", "retired"))));
      lines.push(L(`Дождевые гонки сезона: ${races.join("; ")}.`, `Wet races of the season: ${races.join("; ")}.`));
    }
    if (!lines.length) return null;
    const box = el("div", "conditions");
    box.append(monoHead(L("Дождь и трассы", "Rain and tracks")));
    for (const line of lines) box.append(el("p", "hint", line));
    box.append(el("p", "hint muted", L("Справка, в балл не входит: на данных она повторяется слабо (см. «Как это посчитано»).",
      "For reference, not in the score: it barely repeats in the data (see “How it is calculated”).")));
    return box;
  }

  const WIKI = /^https:\/\/(ru|en)\.wikipedia\.org\//;
  function bioBlock(bio) {
    // Длинная биография свёрнута до трёх строк: карточка начинается с цифр, а не с текста.
    const wrap = el("div", "bio");
    const text = el("p", "bio-text clamped", bio.text);
    wrap.append(text);
    if (bio.text.length > 220) {
      const more = el("button", "bio-more", L("Ещё", "More"));
      more.type = "button";
      more.addEventListener("click", () => {
        const open = text.classList.toggle("clamped") === false;
        more.textContent = open ? L("Свернуть", "Less") : L("Ещё", "More");
      });
      wrap.append(more);
    } else {
      text.classList.remove("clamped");
    }
    if (WIKI.test(bio.url)) {
      const source = el("p", "bio-source");
      if (EN) {
        source.append("From the Wikipedia article: ", extLink("read in full", bio.url), " · ",
          extLink("CC BY-SA 4.0", "https://creativecommons.org/licenses/by-sa/4.0/"));
      } else {
        source.append("Из статьи «Википедии»", bio.lang === "ru" ? "" : " (англ.)", ": ",
          extLink("читать полностью", bio.url), " · ",
          extLink("CC BY-SA 4.0", "https://creativecommons.org/licenses/by-sa/4.0/deed.ru"));
      }
      wrap.append(source);
    }
    return wrap;
  }

  function extLink(text, href) {
    const a = el("a", null, text);
    a.href = href;
    a.target = "_blank";
    a.rel = "noopener";
    return a;
  }

  // Фото — миниатюра с серверов Викисклада (только свободные лицензии, ingest/wiki.py) и подпись:
  // автор, лицензия, страница файла. Не загрузилось — убираем и фото, и подпись.
  const MEDIA = /^https:\/\/(upload|thumb)\.wikimedia\.org\//;
  const FILE_PAGE = /^https:\/\/(commons\.wikimedia|en\.wikipedia)\.org\/wiki\/File:/;
  function photoBlock(photo, who) {
    if (!photo || !MEDIA.test(photo.src) || !FILE_PAGE.test(photo.page)) return null;
    const img = el("img", "photo");
    img.src = photo.src;
    img.alt = L(`${who}, фото`, `${who}, photo`);
    img.width = 68;
    img.height = 84;
    img.loading = "lazy";
    img.decoding = "async";
    img.referrerPolicy = "no-referrer";
    const credit = el("p", "photo-credit");
    const license = photo.license_url && /^https?:\/\//.test(photo.license_url)
      ? extLink(photo.license, photo.license_url) : photo.license;
    credit.append(extLink(L("Фото", "Photo"), photo.page), photo.author ? `: ${photo.author}` : "", " · ", license,
      L(" · Викисклад", " · Wikimedia Commons"));
    img.addEventListener("error", () => { img.remove(); credit.remove(); });
    return { img, credit };
  }

  // Ссылка на карточку: охват, пилот и сравнение уже в адресе (writeHash), остаётся скопировать.
  function shareButton() {
    const label = L("Скопировать ссылку", "Copy link");
    const button = el("button", "link-btn", label);
    button.type = "button";
    button.addEventListener("click", async () => {
      writeHash();
      let ok = false;
      try {
        await navigator.clipboard.writeText(location.href);
        ok = true;
      } catch (err) {
        ok = copyFallback(location.href);
      }
      button.textContent = ok ? L("Ссылка скопирована", "Link copied")
        : L("Не скопировалось — ссылка в адресной строке", "Could not copy — the link is in the address bar");
      setTimeout(() => { button.textContent = label; }, 2500);
    });
    return button;
  }

  function copyFallback(text) {
    const area = el("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.append(area);
    area.select();
    let ok = false;
    try { ok = document.execCommand("copy"); } catch (err) { ok = false; }
    area.remove();
    return ok;
  }

  // ---------- сравнение двух пилотов в карточке ----------
  function setCompare(id) {
    const card = $("#driver");
    const top = card.scrollTop;
    const refocus = document.activeElement && card.contains(document.activeElement) &&
      document.activeElement.closest(".compare");
    state.compare = id && id !== state.driver ? id : null;
    writeHash();
    renderDriver();
    card.scrollTop = top;
    if (refocus) {
      const select = card.querySelector(".compare select");
      if (select) select.focus();
    }
  }

  // Подписи пары для легенд: фамилии, а если они совпадают (Шумахеры, Ферстаппены) — полные имена.
  function pairLabels(a, b) {
    const [sa, sb] = [surname(a), surname(b)];
    return sa === sb ? [name(a), name(b)] : [sa, sb];
  }

  function compareBlock(id, current, other) {
    const box = el("div", "compare block ruled");
    box.append(monoHead(L("Сравнение", "Comparison"), L("почему один выше другого", "why one ranks above the other")));
    const scope = computeScope(state.scope);
    const controls = el("div", "compare-controls");
    const select = el("select");
    select.setAttribute("aria-label", L("Сравнить с пилотом", "Compare with a driver"));
    const none = el("option", null, L("Сравнить с пилотом…", "Compare with…"));
    none.value = "";
    select.append(none);
    const others = scope.entries.filter((e) => e.id !== id && drivers[e.id])
      .sort((a, b) => (a.rankNow ?? 1e9) - (b.rankNow ?? 1e9) || name(a.id).localeCompare(name(b.id), LOCALE));
    for (const e of others) {
      const option = el("option", null, e.rankNow ? `${e.rankNow}. ${name(e.id)}`
        : `${name(e.id)} (${L("без места", "no place")})`);
      option.value = e.id;
      if (other && e.id === other.id) option.selected = true;
      select.append(option);
    }
    select.addEventListener("change", () => setCompare(select.value || null));
    controls.append(select);
    // Быстрый выбор: соседи по таблице — «почему он выше / ниже».
    if (current.rankNow) {
      const ranked = scope.entries.filter((e) => e.rankNow).sort((a, b) => a.rankNow - b.rankNow);
      for (const [e, arrow] of [[ranked[current.rankNow - 2], "↑"], [ranked[current.rankNow], "↓"]]) {
        if (!e) continue;
        const chip = el("button", "chip", `${arrow} ${name(e.id)}, ${ord(e.rankNow)}`);
        chip.type = "button";
        chip.setAttribute("aria-pressed", String(!!other && other.id === e.id));
        chip.title = L(`Сравнить с соседом по таблице: ${name(e.id)}`, `Compare with the neighbour in the table: ${name(e.id)}`);
        chip.addEventListener("click", () => setCompare(other && other.id === e.id ? null : e.id));
        controls.append(chip);
      }
    }
    box.append(controls);
    if (other) box.append(compareResult(current, other, scope));
    return box;
  }

  function compareResult(a, b, scope) {
    const wrap = el("div", "compare-result");
    const [la, lb] = pairLabels(a.id, b.id);
    const diff = a.score - b.score;
    const leader = diff >= 0 ? a : b;
    let ahead = null;
    if (a.zDraws && b.zDraws) {
      let count = 0;
      for (let i = 0; i < a.zDraws.length; i += 1) if (a.zDraws[i] > b.zDraws[i]) count += 1;
      ahead = count / a.zDraws.length;
    }
    // Разница — по показанным (округлённым) баллам, чтобы «100 и 96» не давали «на 3 балла».
    const points = Math.abs(Math.round(a.score) - Math.round(b.score));
    let headline = `${name(a.id)} — ${int(a.score)}, ${name(b.id)} — ${int(b.score)}. `;
    if (points === 0) {
      headline += L("Почти вровень", "Almost level") +
        (ahead == null ? "." : L(`: ${name(a.id)} впереди ${share(ahead)}.`, `: ${name(a.id)} ahead ${share(ahead)}.`));
    } else {
      const p = share(leader === a ? ahead : 1 - ahead);
      headline += L(`Выше ${name(leader.id)}, на ${points} ${plural(points, "балл", "балла", "баллов")}` +
        (ahead == null ? "." : `; впереди ${p}.`),
        `${name(leader.id)} is higher by ${points} ${plural(points, "", "", "", "point")}` +
        (ahead == null ? "." : `; ahead ${p}.`));
    }
    wrap.append(el("p", "compare-head", headline));

    // Вклад группы в разницу итогов: 15 · доля веса · (z группы A − z группы B) / разброс итога по пулу.
    const { groups, w, total, sd } = scope;
    const parts = groups.map((g) => ({
      g, v: sd > 0 && total > 0 ? (15 * (w[g.id] / total) * ((a.g[g.id] ?? 0) - (b.g[g.id] ?? 0))) / sd : 0,
    }));
    const max = Math.max(1, ...parts.map((p) => Math.abs(p.v)));
    wrap.append(el("h4", null, L("Из чего складывается разница, баллы итога", "Where the gap comes from, rating points")));
    const legend = el("div", "compare-legend");
    const side = (text, cls) => {
      const span = el("span");
      span.append(el("span", `swatch ${cls}`), text);
      return span;
    };
    legend.append(side(L(`← в пользу: ${lb}`, `← favours ${lb}`), "s2"), side(L(`в пользу: ${la} →`, `favours ${la} →`), "s1"));
    wrap.append(legend);
    for (const { g, v } of parts) {
      const row = el("div", "contrib");
      const bar = el("span", "cbar");
      bar.setAttribute("role", "img");
      bar.setAttribute("aria-label", `${g.name}: ${Math.abs(v) < 0.05 ? L("поровну", "even")
        : L(`${signed(v, 1)} в пользу: ${v > 0 ? la : lb}`, `${signed(v, 1)} in favour of ${v > 0 ? la : lb}`)}`);
      if (Math.abs(v) >= 0.05) {
        const fill = el("span", v > 0 ? "pos" : "neg");
        fill.style.width = `${(50 * Math.abs(v)) / max}%`;
        bar.append(fill);
      }
      row.append(el("span", "cname", g.name), bar, el("span", "cval", signed(v, 1)));
      wrap.append(row);
    }
    // Сумма вкладов равна разнице баллов, пока балл не упёрся в границу шкалы 0–100.
    const sum = parts.reduce((s, p) => s + p.v, 0);
    const clipped = [a, b].find((e) => e.score >= 99.95 || e.score <= 0.05);
    if (clipped && Math.abs(sum - diff) >= 0.5) {
      wrap.append(el("p", "muted", L(`Сумма вкладов — ${signed(sum, 1)}: балл ${name(clipped.id)} упирается ` +
        "в границу шкалы 0–100, поэтому на шкале разница меньше.",
        `The contributions sum to ${signed(sum, 1)}: ${name(clipped.id)}'s score hits the edge of the 0–100 scale, ` +
        "so the gap on the scale is smaller.")));
    }

    // Главные различия по признакам: где разница z больше и вес группы выше.
    const rows = [];
    for (const g of groups) {
      const list = FEATURES.filter((f) => f.group === g.id && a.f[f.id] && b.f[f.id]);
      for (const f of list) {
        const dz = (a.f[f.id][1] ?? 0) - (b.f[f.id][1] ?? 0);
        rows.push({ f, dz, weight: Math.abs(dz) * (w[g.id] / total) / list.length });
      }
    }
    const top = rows.filter((r) => Math.abs(r.dz) >= 0.2).sort((x, y) => y.weight - x.weight).slice(0, 5);
    if (top.length) {
      wrap.append(el("h4", null, L("Главные различия", "Main differences")));
      const table = el("table", "mini compare-table");
      const head = el("tr");
      for (const [text, cls] of [[L("Признак", "Feature"), ""], [la, "num"], [lb, "num"]]) {
        const th = el("th", cls, text);
        th.scope = "col";
        head.append(th);
      }
      const thead = el("thead");
      thead.append(head);
      const tbody = el("tbody");
      for (const { f, dz } of top) {
        const tr = el("tr");
        const va = el("td", `num${dz > 0 ? " better" : ""}`, featureValue(f, a));
        const vb = el("td", `num${dz < 0 ? " better" : ""}`, featureValue(f, b));
        tr.append(el("td", null, f.name), va, vb);
        tbody.append(tr);
      }
      table.append(thead, tbody);
      const tableWrap = el("div", "table-wrap");
      tableWrap.append(table);
      wrap.append(tableWrap, el("p", "muted", L("Жирным — лучшее значение в паре.", "Bold — the better value of the two.")));
    }

    // Напарники: прямая дуэль или путь через сеть (за весь период).
    const direct = (gAdj.get(a.id) || []).find((x) => x.to === b.id);
    if (direct) {
      wrap.append(el("p", null, L(`Были напарниками: ${linkText(direct.edge, a.id, b.id)}.`,
        `Teammates: ${linkText(direct.edge, a.id, b.id)}.`)));
    } else if (gNodes.has(a.id) && gNodes.has(b.id)) {
      const path = strongestPath(a.id, b.id);
      if (!path) {
        wrap.append(el("p", null, L("Напарниками не были и через напарников не связаны: «Против напарника» у них не сравнить.",
          "Never teammates and not linked through teammates: “Vs teammate” cannot compare them.")));
      } else {
        const eq = eqRaces(a.id, b.id);
        const n = eq == null ? null : Math.round(eq);
        const chain = [a.id, ...path.map((s) => s.to)].map(surname).join(" → ");
        const line = el("p", null, L("Напарниками не были. " + (n == null ? "" : `Через сеть напарников сравнение стоит ` +
          `примерно ${n} ${plural(n, "гонку", "гонки", "гонок")} прямой дуэли; `) + `самый сильный путь: ${chain}. `,
          "Never teammates. " + (n == null ? "" : `Through the teammate network the comparison is worth about ${n} ` +
          `${plural(n, "", "", "", "race")} of a direct duel; `) + `strongest path: ${chain}. `));
        if (graphState.ready) {
          const go = el("button", "link-btn", L("Показать на графе", "Show on the graph"));
          go.type = "button";
          go.addEventListener("click", () => {
            closeSheet();
            showPath(a.id, b.id);
            $("#graph-card").scrollIntoView({ behavior: "smooth", block: "start" });
          });
          line.append(go);
        }
        wrap.append(line);
      }
    }
    return wrap;
  }

  function historyTable(history) {
    const wrap = el("div", "table-wrap");
    const table = el("table", "mini");
    const head = el("tr");
    for (const [title, cls] of [[L("Сезон", "Season"), ""], [L("Место", "Place"), "num"], [L("Рейтинг", "Rating"), "num"],
      [L("ЧМ", "WDC"), "num"], [L("Победы", "Wins"), "num"], [L("Подиумы", "Podiums"), "num"]]) {
      const th = el("th", cls, title);
      th.scope = "col";
      head.append(th);
    }
    const thead = el("thead");
    thead.append(head);
    const tbody = el("tbody");
    for (const { season, e } of history.slice().reverse()) {
      const tr = el("tr");
      const first = el("td", null, String(season));
      first.append(el("span", "sub", e.teams.join(" → ")));
      const place = el("td", "num", e.rankNow ?? "—");
      if (e.rankBand && e.rankBand[0] !== e.rankBand[1]) place.append(el("span", "sub", `${e.rankBand[0]}–${e.rankBand[1]}`));
      const rating = el("td", "num", int(e.score));
      if (e.band) rating.append(el("span", "sub", `${int(e.band[0])}–${int(e.band[1])}`));
      tr.append(first, place, rating,
        el("td", "num", e.standing ? `${e.standing}${e.champion ? " ★" : ""}` : "—"),
        el("td", "num", int(e.stats.wins)), el("td", "num", int(e.stats.podiums)));
      tbody.append(tr);
    }
    table.append(thead, tbody);
    wrap.append(table);
    return wrap;
  }

  function teammateBlock({ season, e }) {
    const tm = e.tm;
    const block = el("div", "block");
    block.append(monoHead(L(`Против напарника, ${season}`, `Vs teammate, ${season}`)));
    const mates = (e.teammates || []).map(name).join(", ") || "—";
    const band = `${Math.round(100 * tm.strength[1])}–${Math.round(100 * tm.strength[2])}%`;
    const lines = [
      L(`Напарники: ${mates}.`, `Teammates: ${mates}.`),
      L(`Шанс обыграть среднего пилота в такой же машине (квала, темп и финиш вместе): ${pct(tm.strength[0])} ` +
        `(интервал ${band}).`,
        `Chance to beat an average driver in the same car (qualifying, pace and finish together): ${pct(tm.strength[0])} ` +
        `(interval ${band}).`),
      L(`Квала относительно среднего пилота в такой же машине: ${signed(tm.quali_s[0], 2)} с на 90-секундном круге.`,
        `Qualifying vs an average driver in the same car: ${signed(tm.quali_s[0], 2)} s on a 90-second lap.`),
    ];
    if (tm.pace_s) {
      lines.push(L(`Темп в гонке относительно среднего пилота в такой же машине: ${signed(tm.pace_s[0], 2)} с на круге.`,
        `Race pace vs an average driver in the same car: ${signed(tm.pace_s[0], 2)} s per lap.`));
    }
    if (tm.h2h_quali) {
      const score = `${tm.h2h_quali[0]}:${tm.h2h_quali[1] - tm.h2h_quali[0]}`;
      lines.push(L(`Квалификации с напарником: ${score}.`, `Qualifying vs teammate: ${score}.`));
    }
    if (tm.h2h_race) {
      const score = `${tm.h2h_race[0]}:${tm.h2h_race[1] - tm.h2h_race[0]}`;
      lines.push(L(`Гонки с напарником (кто выше на финише): ${score}.`, `Races vs teammate (who finished ahead): ${score}.`));
    }
    for (const line of lines) block.append(el("p", "hint", line));
    return block;
  }

  // По ходу сезона: рейтинг так, будто сезон закончился после этого этапа (by_round.py).
  // Блок сначала встаёт в карточку (parent), потом рисуется: графику нужен настоящий размер.
  function roundsBlock(parent, key, id, other) {
    const path = seasonPath(key);
    if (!path || !path.scores.has(id) || path.rounds.length < 2) return;
    const box = el("div", "rounds block ruled");
    parent.append(box);
    box.append(monoHead(L(`По ходу сезона ${key}`, `Through the ${key} season`), L("балл после этапа", "score after each round")));
    const chartBox = el("div", "chart");
    chartBox.setAttribute("role", "img");
    const s = Array.from(path.scores.get(id));
    const done = s.map((v, i) => [v, i]).filter(([v]) => !Number.isNaN(v));
    if (done.length) {
      const [first, last] = [done[0], done[done.length - 1]];
      const best = done.reduce((a, b) => (b[0] > a[0] ? b : a));
      const after = (i) => path.rounds[i];
      chartBox.setAttribute("aria-label", L(`Рейтинг после каждого этапа: после ${after(first[1])}-го — ` +
        `${int(first[0])}, лучший — ${int(best[0])} после ${after(best[1])}-го, после ${after(last[1])}-го — ${int(last[0])}`,
        `Rating after each round: after round ${after(first[1])} — ${int(first[0])}, best — ${int(best[0])} after ` +
        `round ${after(best[1])}, after round ${after(last[1])} — ${int(last[0])}`));
    }
    box.append(chartBox);
    drawRounds(chartBox, key, path, id, other && path.scores.has(other.id) ? other.id : null);
    box.append(el("p", "hint muted", L("Каким был бы рейтинг, закончись сезон после этого этапа. В начале сезона " +
      "гонок мало, поэтому баллы ближе к 50. Разница с напарником — по этапам до этого, уровень пары — " +
      "из итоговой модели сезона.",
      "What the rating would be if the season ended after that round. Early on there are few races, so scores " +
      "sit closer to 50. The gap to the teammate uses the rounds so far; the pair's level comes from the final " +
      "season model.")));
  }

  function drawRounds(node, key, path, id, otherId) {
    if (!window.echarts) {
      node.replaceWith(el("p", "empty", L("График не загрузился (нет доступа к ECharts).", "The chart did not load (no access to ECharts).")));
      return;
    }
    const c = palette();
    const labels = path.rounds.map((r) => gpName(key, r));
    const [la, lb] = otherId ? pairLabels(id, otherId) : [name(id), null];
    const values = (who) => Array.from(path.scores.get(who), (v) => (Number.isNaN(v) ? null : Math.round(10 * v) / 10));
    // Этапов много — точки только при наведении, линия читается лучше.
    const series = (who, label, color) => ({
      name: label, type: "line", color, lineStyle: { width: 2 }, symbol: "circle", symbolSize: 8,
      showSymbol: path.rounds.length <= 12, itemStyle: { borderColor: c.surface, borderWidth: 2 }, data: values(who),
    });
    const line = (who, label, color, i) => {
      const v = path.scores.get(who)[i];
      if (Number.isNaN(v)) return `<div style="color:${c.muted}">${esc(label)}: ${L("ещё не выступал", "not raced yet")}</div>`;
      const rank = path.ranks.has(who) ? path.ranks.get(who)[i] : 0;
      return `<div><span style="color:${color}">●</span> ${esc(label)}: <b>${Math.round(v)}</b>` +
        (rank ? ` <span style="color:${c.muted}">${L(`${rank}-е место`, ord(rank))}</span>` : "") + "</div>";
    };
    const chart = window.echarts.init(node, null, { renderer: "svg" });
    charts.push(chart);
    chart.setOption({
      animation: false,
      textStyle: { fontFamily: FONT },
      legend: otherId ? { top: 0, left: 0, data: [la, lb], textStyle: { color: c.text2 }, itemWidth: 16, itemHeight: 8 }
        : { show: false },
      grid: { left: 4, right: 12, top: otherId ? 32 : 12, bottom: 4, containLabel: true },
      tooltip: {
        trigger: "axis", backgroundColor: c.surface, borderColor: c.border, textStyle: { color: c.text1, fontSize: 13 },
        axisPointer: { type: "line", lineStyle: { color: c.axis, width: 1 } },
        formatter: (params) => {
          const i = params[0].dataIndex;
          return `<div style="margin-bottom:4px">${L(`После ${path.rounds[i]}-го этапа`, `After round ${path.rounds[i]}`)} · ` +
            `${esc(labels[i])}</div>` +
            line(id, la, c.s1, i) + (otherId ? line(otherId, lb, c.s2, i) : "");
        },
      },
      // На оси — номера этапов (названия не помещаются), название Гран-при — в подсказке.
      xAxis: { type: "category", data: labels, boundaryGap: false, axisLine: { lineStyle: { color: c.axis } },
        axisTick: { show: false }, axisLabel: { color: c.muted, hideOverlap: true, formatter: (_, i) => String(path.rounds[i]) } },
      yAxis: { type: "value", min: 0, max: 100, interval: 25, axisLabel: { color: c.muted },
        splitLine: { lineStyle: { color: c.grid, width: 1 } } },
      series: [...(otherId ? [series(otherId, lb, c.s2)] : []), series(id, la, c.s1)],
    });
  }

  // other — второй пилот из сравнения: рисуется вторым цветом поверх «среднего пилота».
  function drawRadar(node, groups, e, other) {
    if (!window.echarts) {
      node.replaceWith(el("p", "empty", L("График не загрузился (нет доступа к ECharts) — баллы в списке ниже.",
        "The chart did not load (no access to ECharts) — the scores are in the list below.")));
      return;
    }
    const c = palette();
    const avg = L("Средний пилот", "Average driver");
    const [la, lb] = other ? pairLabels(e.id, other.id) : [L("Пилот", "Driver"), null];
    const chart = window.echarts.init(node, null, { renderer: "svg" });
    charts.push(chart);
    const second = other ? [{
      name: lb, value: groups.map((g) => Math.round(other.s[g.id] ?? 0)), symbol: "circle", symbolSize: 6,
      lineStyle: { color: c.s2, width: 2 }, itemStyle: { color: c.s2, borderColor: c.surface, borderWidth: 2 },
      areaStyle: { color: c.s2, opacity: 0.08 },
    }] : [];
    chart.setOption({
      animation: false,
      textStyle: { fontFamily: FONT },
      legend: { top: 0, left: 0, data: [la, ...(other ? [lb] : []), avg], textStyle: { color: c.text2 },
        itemWidth: 16, itemHeight: 8 },
      tooltip: {
        trigger: "item", backgroundColor: c.surface, borderColor: c.border, textStyle: { color: c.text1, fontSize: 13 },
        formatter: (p) => `<div style="margin-bottom:4px">${esc(p.name)}</div>` +
          groups.map((g, i) => `${esc(g.name)}: <b>${Math.round(p.value[i])}</b>`).join("<br>"),
      },
      radar: {
        // на узком экране подписи осей («Напарник») иначе обрезаются по краю
        center: ["50%", "56%"], radius: node.clientWidth < 440 ? "54%" : "62%", splitNumber: 4,
        indicator: groups.map((g) => ({ name: SHORT[g.id] || g.name, min: 0, max: 100 })),
        axisName: { color: c.text2, fontSize: 12 },
        splitLine: { lineStyle: { color: c.grid } },
        splitArea: { show: false },
        axisLine: { lineStyle: { color: c.grid } },
      },
      series: [{
        type: "radar",
        data: [
          { name: avg, value: groups.map(() => 50), symbol: "none",
            lineStyle: { color: c.axis, width: 1 }, itemStyle: { color: c.axis } },
          ...second,
          { name: la, value: groups.map((g) => Math.round(e.s[g.id] ?? 0)), symbol: "circle", symbolSize: 6,
            lineStyle: { color: c.s1, width: 2 }, itemStyle: { color: c.s1, borderColor: c.surface, borderWidth: 2 },
            areaStyle: { color: c.s1, opacity: 0.12 } },
        ],
      }],
    });
  }

  // other — { id, history } второго пилота из сравнения: его линия — вторым цветом, без вилки.
  function drawTrend(node, history, other) {
    if (!window.echarts) {
      node.replaceWith(el("p", "empty", L("График не загрузился — значения в таблице ниже.",
        "The chart did not load — the values are in the table below.")));
      return;
    }
    const c = palette();
    const seasons = history.concat(other ? other.history : []).map((h) => h.season);
    const years = [];
    for (let y = Math.min(...seasons); y <= Math.max(...seasons); y += 1) years.push(y);
    const bySeason = new Map(history.map((h) => [h.season, h.e]));
    const otherBy = new Map(other ? other.history.map((h) => [h.season, h.e]) : []);
    const [la, lb] = other ? pairLabels(history[0].e.id, other.id) : [L("Рейтинг сезона", "Season rating"), null];
    const chart = window.echarts.init(node, null, { renderer: "svg" });
    charts.push(chart);
    const rangeText = (e) => (e.band ? L(` · вилка ${int(e.band[0])}–${int(e.band[1])}`, ` · range ${int(e.band[0])}–${int(e.band[1])}`) : "");
    const statsText = (e) => L(`чемпионат ${e.standing ?? "—"} · побед ${e.stats.wins} · подиумов ${e.stats.podiums}`,
      `championship ${e.standing ?? "—"} · wins ${e.stats.wins} · podiums ${e.stats.podiums}`);
    const line = (e, label, color) => {
      if (!e) return `<div style="color:${c.muted}">${esc(label)}: ${L("не выступал", "did not race")}</div>`;
      return `<div><span style="color:${color}">●</span> ${esc(label)}: <b>${Math.round(e.score)}</b>` +
        ` <span style="color:${c.muted}">${e.rankNow ? L(`${e.rankNow}-е место`, ord(e.rankNow)) : L("без места", "no place")}` +
        `${rangeText(e)}</span></div>` +
        `<div style="color:${c.muted};margin:0 0 4px 14px">${esc(e.teams.join(" → "))} · ${statsText(e)}</div>`;
    };
    chart.setOption({
      animation: false,
      textStyle: { fontFamily: FONT },
      legend: other ? { top: 0, left: 0, data: [la, lb], textStyle: { color: c.text2 }, itemWidth: 16, itemHeight: 8 }
        : { show: false },
      grid: { left: 4, right: 12, top: other ? 32 : 12, bottom: 4, containLabel: true },
      tooltip: {
        trigger: "axis", backgroundColor: c.surface, borderColor: c.border, textStyle: { color: c.text1, fontSize: 13 },
        axisPointer: { type: "line", lineStyle: { color: c.axis, width: 1 } },
        formatter: (params) => {
          const year = years[params[0].dataIndex];
          const e = bySeason.get(year);
          if (other) {
            return `<div style="margin-bottom:4px">${year}</div>` + line(e, la, c.s1) + line(otherBy.get(year), lb, c.s2);
          }
          if (!e) return `${year}: ${L("не выступал", "did not race")}`;
          return `<div style="margin-bottom:4px">${year} · ${esc(e.teams.join(" → "))}</div>` +
            `<div><b>${Math.round(e.score)}</b> <span style="color:${c.muted}">${L("рейтинг сезона", "season rating")}` +
            `${e.rankNow ? `, ${L(`${e.rankNow}-е место`, ord(e.rankNow))}` : ""}${rangeText(e)}</span></div>` +
            `<div style="color:${c.muted};margin-top:4px">${statsText(e)}</div>`;
        },
      },
      xAxis: { type: "category", data: years, boundaryGap: false, axisLine: { lineStyle: { color: c.axis } },
        axisTick: { show: false }, axisLabel: { color: c.muted } },
      yAxis: { type: "value", min: 0, max: 100, interval: 25, axisLabel: { color: c.muted },
        splitLine: { lineStyle: { color: c.grid, width: 1 } } },
      series: [
        // Вилка — полоса между нижней и верхней границей: невидимая нижняя линия + стопка высоты вилки.
        { name: "band-low", type: "line", stack: "band", silent: true, symbol: "none", lineStyle: { opacity: 0 },
          data: years.map((y) => bandAt(y, 0)) },
        { name: "band", type: "line", stack: "band", silent: true, symbol: "none", lineStyle: { opacity: 0 },
          areaStyle: { color: c.s1, opacity: 0.16 },
          data: years.map((y) => (bandAt(y, 0) == null ? null : bandAt(y, 1) - bandAt(y, 0))) },
        ...(other ? [{ name: lb, type: "line", color: c.s2, lineStyle: { width: 2 }, symbol: "circle", symbolSize: 8,
          itemStyle: { borderColor: c.surface, borderWidth: 2 },
          data: years.map((y) => (otherBy.has(y) ? Math.round(otherBy.get(y).score) : null)) }] : []),
        { name: la, type: "line", color: c.s1, lineStyle: { width: 2 }, symbol: "circle", symbolSize: 8,
          itemStyle: { borderColor: c.surface, borderWidth: 2 },
          data: years.map((y) => (bySeason.has(y) ? Math.round(bySeason.get(y).score) : null)) },
      ],
    });

    function bandAt(year, i) {
      const e = bySeason.get(year);
      return e && e.band ? Math.round(10 * e.band[i]) / 10 : null;
    }
  }

  // ---------- граф напарников ----------
  const GRAPH = DATA.graph || null;
  const graphState = { from: null, to: null, ready: false };
  let graphChart = null;
  const gNodes = new Map((GRAPH ? GRAPH.nodes : []).map((n) => [n.id, n]));
  const gAdj = new Map();
  for (const e of GRAPH ? GRAPH.edges : []) {
    for (const [u, v] of [[e.a, e.b], [e.b, e.a]]) {
      if (!gAdj.has(u)) gAdj.set(u, []);
      gAdj.get(u).push({ to: v, edge: e });
    }
  }
  const edgeKey = (e) => `${e.a}|${e.b}`;
  const surname = (id) => (drivers[id] ? drivers[id].family || drivers[id].name.split(" ").slice(-1)[0] : id);
  const reliabilityLabel = (score) => (score >= 80 ? L("высокая", "high") : score >= 50 ? L("средняя", "medium")
    : L("низкая", "low"));
  // У отдельных групп (не было общих напарников с основной сетью) сравнения с остальными нет вовсе.
  const reliabilityText = (n) => (n.group > 0
    ? L("нет — у этой группы не было общих напарников с остальными пилотами",
      "none — this group shared no teammates with the other drivers")
    : `${reliabilityLabel(n.reliability)} (${int(n.reliability)} ${L("из", "of")} 100)`);

  function eqRaces(a, b) {
    const i = GRAPH.order.indexOf(a);
    const j = GRAPH.order.indexOf(b);
    return i < 0 || j < 0 ? null : GRAPH.eq_races[i][j];
  }

  // Самый сильный путь: длина звена = 1 / сила связи (как сопротивление проводника), алгоритм Дейкстры.
  function strongestPath(a, b) {
    if (!a || !b || a === b) return [];
    const dist = new Map([[a, 0]]);
    const prev = new Map();
    const done = new Set();
    for (;;) {
      let u = null;
      let best = Infinity;
      for (const [k, v] of dist) if (!done.has(k) && v < best) { best = v; u = k; }
      if (u === null || u === b) break;
      done.add(u);
      for (const { to, edge } of gAdj.get(u) || []) {
        const d = best + 1 / edge.strength;
        if (d < (dist.get(to) ?? Infinity)) { dist.set(to, d); prev.set(to, { from: u, edge }); }
      }
    }
    if (!prev.has(b)) return null;
    const steps = [];
    for (let cur = b; cur !== a;) {
      const p = prev.get(cur);
      steps.unshift({ from: p.from, to: cur, edge: p.edge });
      cur = p.from;
    }
    return steps;
  }

  // Счёт пары глазами пилота who: [победы, поражения]; темп — гэп в %, минус значит who быстрее.
  function oriented(edge, who) {
    const flip = edge.a !== who;
    const turn = (pair) => (pair ? (flip ? [pair[1], pair[0]] : pair) : null);
    return { quali: turn(edge.quali), race: turn(edge.race), pace: edge.pace ? (flip ? -edge.pace[0] : edge.pace[0]) : null };
  }

  function linkText(edge, who, other) {
    const o = oriented(edge, who);
    const parts = [`${edge.races} ${plural(edge.races, "гонка", "гонки", "гонок", "race")} ${L("вместе", "together")} ` +
      `(${edge.seasons.join(", ")}, ${edge.teams.join(" → ")})`];
    if (o.quali) parts.push(`${L("квала", "qualifying")} ${o.quali[0]}:${o.quali[1]}`);
    if (o.race) parts.push(`${L("гонки", "races")} ${o.race[0]}:${o.race[1]}`);
    if (o.pace != null) {
      parts.push(Math.abs(o.pace) < 0.005 ? L("темп равный", "equal pace")
        : L(`темп: ${surname(o.pace < 0 ? who : other)} быстрее на ${num(Math.abs(o.pace), 2)}%`,
          `pace: ${surname(o.pace < 0 ? who : other)} faster by ${num(Math.abs(o.pace), 2)}%`));
    }
    return parts.join(" · ");
  }

  // Сколько шагов от выбранного пилота до остальных (поиск в ширину, не дальше limit).
  function hopDistances(src, limit) {
    const dist = new Map([[src, 0]]);
    let frontier = [src];
    for (let step = 1; step <= limit && frontier.length; step += 1) {
      const next = [];
      for (const u of frontier) {
        for (const { to } of gAdj.get(u) || []) {
          if (!dist.has(to)) {
            dist.set(to, step);
            next.push(to);
          }
        }
      }
      frontier = next;
    }
    return dist;
  }

  // Что показывать: прямых напарников, два шага или всю сеть (0).
  const HOPS = [[1, L("Прямые напарники", "Direct teammates")], [2, L("Два шага", "Two steps")],
    [0, L("Вся сеть", "Full network")]];
  let graphLayoutKey = null;  // раскладка сменилась (пилот или число шагов) — масштаб и сдвиг сбрасываются

  function drawGraph() {
    const node = $("#graph");
    if (!node) return;
    if (!window.echarts) {
      node.replaceWith(el("p", "empty", L("Граф не загрузился (нет доступа к ECharts) — путь и напарники рядом.",
        "The graph did not load (no access to ECharts) — the path and teammates are next to it.")));
      return;
    }
    const c = palette();
    const sel = graphState.from;
    const path = graphState.to ? strongestPath(sel, graphState.to) || [] : [];
    const pathEdges = new Set(path.map((s) => edgeKey(s.edge)));
    const pathNodes = new Set(path.length ? [sel, ...path.map((s) => s.to)] : []);
    const ratings = GRAPH.nodes.map((n) => n.rating ?? 50);
    const rMin = Math.min(...ratings);
    const rMax = Math.max(...ratings);
    const tone = (n) => ramp(((n.rating ?? 50) - rMin) / (rMax - rMin || 1));
    const full = state.hops === 0;
    const dist = full ? null : hopDistances(sel, state.hops);

    // Раскладка. Вся сеть — готовые координаты; иначе выбранный в центре, напарники — по эллипсу
    // вокруг (чем больше гонок вместе, тем ближе к началу круга), их напарники — по внешнему эллипсу.
    const pos = new Map();
    const anchors = [];
    if (full) {
      for (const n of GRAPH.nodes) pos.set(n.id, [n.x * 1000, n.y * 700]);
    } else {
      const together = new Map((gAdj.get(sel) || []).map((x) => [x.to, x.edge.races]));
      const ring1 = [...dist].filter(([, d]) => d === 1).map(([id]) => id)
        .sort((a, b) => (together.get(b) || 0) - (together.get(a) || 0));
      const angle = new Map();
      pos.set(sel, [0, 0]);
      ring1.forEach((id, i) => {
        const a = -Math.PI / 2 + (i / ring1.length) * 2 * Math.PI;
        angle.set(id, a);
        pos.set(id, [Math.cos(a) * 190, Math.sin(a) * 120]);
      });
      const parent = new Map();
      const ring2 = [...dist].filter(([, d]) => d === 2).map(([id]) => id);
      for (const id of ring2) {
        let best = null;
        for (const { to, edge } of gAdj.get(id) || []) {
          if (dist.get(to) === 1 && (!best || edge.races > best.edge.races)) best = { to, edge };
        }
        parent.set(id, best ? best.to : ring1[0]);
      }
      ring2.sort((a, b) => angle.get(parent.get(a)) - angle.get(parent.get(b)) || name(a).localeCompare(name(b), LOCALE));
      ring2.forEach((id, i) => {
        const a = -Math.PI / 2 + ((i + 0.5) / ring2.length) * 2 * Math.PI - Math.PI / Math.max(ring1.length, 1);
        pos.set(id, [Math.cos(a) * 360, Math.sin(a) * 215]);
      });
      // невидимые углы рамки: масштаб не скачет, когда у пилота один-два напарника
      const [w, h] = state.hops === 2 ? [400, 240] : [250, 160];
      for (const [x, y] of [[-w, -h], [w, h]]) {
        anchors.push({ id: `anchor${x}`, anchor: true, x, y, symbolSize: 0, silent: true, label: { show: false },
          itemStyle: { opacity: 0 }, tooltip: { show: false } });
      }
    }

    const visible = full ? GRAPH.nodes : GRAPH.nodes.filter((n) => dist.has(n.id));
    const shown = new Set(visible.map((n) => n.id));
    const data = visible.map((n) => {
      const d = full ? null : dist.get(n.id);
      const isSel = n.id === sel;
      const inPath = pathNodes.has(n.id);
      const strong = isSel || inPath;
      const [x, y] = pos.get(n.id);
      return {
        id: n.id,
        name: full ? (drivers[n.id] && drivers[n.id].code) || surname(n.id) : surname(n.id),
        x,
        y,
        symbolSize: full ? n.size + (isSel ? 8 : 0) : isSel ? 30 : d === 1 ? 20 : 12,
        itemStyle: {
          color: isSel ? c.accentSoft : tone(n),
          borderColor: inPath && !isSel ? c.s2 : c.stage,
          borderWidth: inPath && !isSel ? 2 : full ? 1 : 3,
        },
        label: {
          show: true, position: full ? "right" : "bottom", distance: full ? 3 : 6,
          fontSize: full ? 11 : isSel ? 14 : d === 1 ? 13 : 11,
          color: strong ? c.text1 : full || d === 1 ? c.text2 : c.muted, fontWeight: isSel ? 600 : 400,
          backgroundColor: full ? "transparent" : c.stage, padding: full ? 0 : [1, 5], borderRadius: 4,
        },
      };
    });
    const links = GRAPH.edges.filter((e) => shown.has(e.a) && shown.has(e.b)
      && (full || dist.get(e.a) < 2 || dist.get(e.b) < 2)).map((e) => {
      const onPath = pathEdges.has(edgeKey(e));
      const incident = e.a === sel || e.b === sel;
      return {
        source: e.a,
        target: e.b,
        edge: e,
        lineStyle: {
          color: onPath ? c.s2 : "rgb(236,234,230)",
          width: onPath ? 3 : full ? 0.6 + 1.1 * Math.log1p(e.races / 4) : 1 + 0.7 * Math.log1p(e.races / 10),
          opacity: onPath ? 1 : incident ? 0.45 : full ? (e.weak ? 0.06 : 0.14) : 0.15,
        },
      };
    });

    const layoutKey = `${state.hops}|${full ? "" : sel}`;
    const view = graphLayoutKey === layoutKey ? graphView() : {};
    graphLayoutKey = layoutKey;
    if (!graphChart) {
      graphChart = window.echarts.init(node, null, { renderer: "svg" });
      graphChart.on("click", (p) => {
        if (p.dataType === "node" && !p.data.anchor) selectDriver(p.data.id, { scroll: false });
      });
    }
    graphChart.setOption({
      animation: false,
      textStyle: { fontFamily: FONT },
      tooltip: {
        backgroundColor: c.surface, borderColor: c.border, textStyle: { color: c.text1, fontSize: 13 },
        formatter: (p) => {
          if (p.dataType === "edge") {
            const e = p.data.edge;
            return `<b>${esc(name(e.a))} — ${esc(name(e.b))}</b><br>${esc(linkText(e, e.a, e.b))}` +
              (e.strength < e.races ? L("<br>подменное выступление: вес связи вполовину",
                "<br>stand-in appearance: the link counts half") : "");
          }
          const n = gNodes.get(p.data.id);
          if (!n) return "";
          return `<b>${esc(name(n.id))}</b> · ${L("рейтинг", "rating")} ${int(n.rating)}` +
            `${n.rank ? `, ${L(`${n.rank}-е место`, ord(n.rank))}` : ""}` +
            L(`<br>напарников ${n.teammates}, гонок с ними ${n.races_with_mates}`,
              `<br>teammates ${n.teammates}, races with them ${n.races_with_mates}`) +
            `<br>${L("надёжность сравнения", "comparison reliability")}: ${reliabilityText(n)}` +
            (n.bridge_cut ? L(`<br>мост: без него от сети отрываются пилотов — ${n.bridge_cut}`,
              `<br>bridge: without them ${n.bridge_cut} drivers split off the network`) : "");
        },
      },
      series: [{
        type: "graph", layout: "none", roam: true, data: [...data, ...anchors], links,
        left: 24, right: 24, top: 16, bottom: 28,
        zoom: view.zoom || 1,
        ...(view.center ? { center: view.center } : {}),
        emphasis: { focus: "adjacency", lineStyle: { width: 3 } },
        labelLayout: { hideOverlap: !full && state.hops === 2 },
      }],
    }, true);
  }

  // Текущий масштаб и центр: пользователь мог приблизить или сдвинуть граф мышью — не сбрасываем.
  function graphView() {
    if (!graphChart) return {};
    const series = (graphChart.getOption().series || [])[0] || {};
    return { zoom: series.zoom, center: series.center };
  }

  function zoomGraph(factor) {
    if (!graphChart) return;
    const zoom = Math.min(8, Math.max(0.5, (graphView().zoom || 1) * factor));
    graphChart.setOption({ series: [{ zoom }] });
  }

  function resetGraph() {
    graphLayoutKey = null;
    drawGraph();
  }

  function renderPath() {
    const list = $("#graph-path");
    list.replaceChildren();
    const summary = $("#graph-summary");
    const { from, to } = graphState;
    if (!from || !to || from === to) {
      summary.textContent = "";
      return;
    }
    const path = strongestPath(from, to);
    if (!path) {
      summary.textContent = L("Эти пилоты не связаны через напарников.", "These drivers are not linked through teammates.");
      return;
    }
    const eq = eqRaces(from, to);
    const n = eq == null ? null : Math.round(eq);
    const eqText = n == null ? "" : L(` Через все пути сети сразу это сравнение стоит примерно ${n} ` +
      `${plural(n, "гонку", "гонки", "гонок")} прямой дуэли.`,
      ` Using all paths of the network at once, this comparison is worth about ${n} ${plural(n, "", "", "", "race")} ` +
      "of a direct duel.");
    summary.textContent = L(`${name(from)} и ${name(to)}: самый сильный путь — ${path.length} ` +
      `${plural(path.length, "звено", "звена", "звеньев")}.`,
      `${name(from)} and ${name(to)}: the strongest path has ${path.length} ${plural(path.length, "", "", "", "link")}.`) + eqText;
    for (const step of path) {
      const li = el("li");
      li.append(el("strong", null, `${surname(step.from)} → ${surname(step.to)}`),
        document.createTextNode(` · ${linkText(step.edge, step.from, step.to)}`));
      if (step.edge.weak) li.append(el("span", "badge", L("слабое звено", "weak link")));
      if (step.edge.strength < step.edge.races) li.append(el("span", "badge", L("подмена, вес ½", "stand-in, weight ½")));
      list.append(li);
    }
  }

  function renderMates() {
    const who = graphState.from;
    const mates = (gAdj.get(who) || []).slice().sort((x, y) => y.edge.races - x.edge.races);
    $("#graph-mates-title").textContent = who
      ? L(`Все напарники: ${name(who)} (${mates.length})`, `All teammates: ${name(who)} (${mates.length})`)
      : L("Напарники", "Teammates");
    const table = $("#graph-mates");
    table.replaceChildren();
    if (!who) return;
    const head = el("tr");
    for (const [title, cls] of [[L("Напарник", "Teammate"), ""], [L("Сезоны", "Seasons"), ""], [L("Гонок", "Races"), "num"],
      [L("Квала", "Quali"), "num"], [L("Гонки", "Ahead"), "num"], [L("Темп", "Pace"), ""]]) {
      const th = el("th", cls, title);
      th.scope = "col";
      head.append(th);
    }
    const thead = el("thead");
    thead.append(head);
    const tbody = el("tbody");
    for (const { to, edge } of mates) {
      const o = oriented(edge, who);
      const row = el("tr");
      const mate = el("td", null, name(to));
      if (edge.weak) mate.append(el("span", "badge", L("слабая связь", "weak link")));
      row.append(mate, el("td", null, edge.seasons.join(", ")), el("td", "num", String(edge.races)),
        el("td", "num", o.quali ? `${o.quali[0]}:${o.quali[1]}` : "—"),
        el("td", "num", o.race ? `${o.race[0]}:${o.race[1]}` : "—"),
        el("td", null, o.pace == null ? "—" : Math.abs(o.pace) < 0.005 ? L("равный", "equal")
          : L(`${o.pace < 0 ? "быстрее" : "медленнее"} на ${num(Math.abs(o.pace), 2)}%`,
            `${o.pace < 0 ? "faster" : "slower"} by ${num(Math.abs(o.pace), 2)}%`)));
      tbody.append(row);
    }
    table.append(thead, tbody);
  }

  function updateGraph() {
    $("#graph-from").value = graphState.from;
    $("#graph-to").value = graphState.to || "";
    $("#graph-title").textContent = L(`Граф напарников · ${name(graphState.from)}`, `Teammate graph · ${name(graphState.from)}`);
    for (const button of document.querySelectorAll("#graph-hops button")) {
      button.setAttribute("aria-pressed", String(Number(button.dataset.hops) === state.hops));
    }
    drawGraph();
    renderPath();
    renderMates();
  }

  // Показать путь между двумя пилотами; если он уходит за показанные шаги — раскрыть всю сеть.
  function showPath(from, to) {
    graphState.from = from;
    graphState.to = to && to !== from ? to : null;
    if (graphState.to && state.hops !== 0) {
      const path = strongestPath(from, graphState.to) || [];
      const dist = hopDistances(from, state.hops);
      if (path.some((s) => !dist.has(s.to))) state.hops = 0;
    }
    updateGraph();
  }

  function syncGraph(id) {
    if (!graphState.ready || !gNodes.has(id)) return;
    graphState.from = id;
    if (graphState.to === id) graphState.to = null;
    updateGraph();
  }

  function initGraph() {
    if (!GRAPH) {
      $("#graph-card").hidden = true;
      return;
    }
    const s = GRAPH.stats;
    $("#graph-hint").textContent = L("Сначала — прямые напарники. Раскройте на два шага или всю сеть.",
      "Showing direct teammates first. Expand to two steps or the full network.");
    const hops = $("#graph-hops");
    for (const [value, label] of HOPS) {
      const button = el("button", null, label);
      button.type = "button";
      button.dataset.hops = String(value);
      button.addEventListener("click", () => { state.hops = value; updateGraph(); });
      hops.append(button);
    }
    const key = $("#graph-key");
    for (const [cls, text] of [
      ["key-dot", L("Яркость узла — балл пилота: чем ярче, тем выше.", "Node brightness is the driver's score. Brighter is higher.")],
      ["key-line", L("Линия — пилоты были напарниками. Чем толще, тем больше гонок вместе.",
        "A line means they shared a car. Thicker means more races together.")],
      ["key-ring", L("Пилоты сравниваются только через эти связи, поэтому у пилотов с большим числом связей вилки уже.",
        "Drivers are only compared directly through these links, so well-connected drivers have tighter ranges.")],
      ["key-path", L("Цветная линия — самый сильный путь сравнения двух пилотов.",
        "The coloured line is the strongest comparison path between two drivers.")],
    ]) {
      const row = el("div", "key-row");
      row.append(el("span", cls), el("span", null, text));
      key.append(row);
    }
    const isolated = s.isolated || [];
    const groupsText = isolated.map((g) => g.map(surname).join(L(" и ", " and "))).join("; ");
    key.append(el("p", "hint", L(`Сеть ${meta.period[0]}–${meta.period[1]}: ${s.drivers} пилотов, ${s.pairs} пар напарников` +
      (isolated.length ? `; без общих напарников с остальными — ${groupsText}.` : "."),
      `Network ${meta.period[0]}–${meta.period[1]}: ${s.drivers} drivers, ${s.pairs} teammate pairs` +
      (isolated.length ? `; no teammates shared with the rest — ${groupsText}.` : "."))));

    const ids = GRAPH.nodes.map((n) => n.id).sort((a, b) => name(a).localeCompare(name(b), LOCALE));
    const none = el("option", null, L("Выберите пилота", "Choose driver"));
    none.value = "";
    $("#graph-to").append(none);
    for (const select of [$("#graph-from"), $("#graph-to")]) {
      for (const id of ids) {
        const option = el("option", null, name(id));
        option.value = id;
        select.append(option);
      }
    }
    const byRank = GRAPH.nodes.filter((n) => n.rank).sort((a, b) => a.rank - b.rank);
    graphState.from = gNodes.has(state.driver) ? state.driver : byRank[0].id;
    graphState.to = null;
    $("#graph-from").addEventListener("change", (event) => selectDriver(event.target.value, { scroll: false }));
    $("#graph-to").addEventListener("change", (event) => showPath(graphState.from, event.target.value || null));
    $("#graph-zoom-in").addEventListener("click", () => zoomGraph(1.4));
    $("#graph-zoom-out").addEventListener("click", () => zoomGraph(1 / 1.4));
    $("#graph-reset").addEventListener("click", resetGraph);
    $("#graph").setAttribute("aria-label", L("Граф напарников: узлы — пилоты, линии — пары напарников. " +
      "Путь сравнения и список напарников — в тексте рядом.",
      "Teammate graph: nodes are drivers, lines are teammate pairs. The comparison path and the list of teammates " +
      "are in the text next to it."));
    graphState.ready = true;
    updateGraph();
  }

  // ---------- методика ----------
  function renderMethod() {
    const body = $("#method-body");
    const wPeriod = weightShares(meta.weights.period, PERIOD).share;
    const wSeason = weightShares(meta.weights.season, SEASON_KEYS[0]).share;
    const groupRows = GROUPS.map((g) => {
      const feats = FEATURES.filter((f) => f.group === g.id).map((f) => f.name.toLowerCase()).join(", ");
      const ws = g.id === "career" ? `${wPeriod("career")} ${L("(только сводка)", "(all seasons only)")}`
        : g.id === "dotd" ? `${wSeason("dotd")} ${L("(только сезон)", "(season only)")}`
        : !meta.weights.period[g.id] && !meta.weights.season[g.id] ? L("справка, в итог не входит", "reference, not in the total")
          : `${wPeriod(g.id)} / ${wSeason(g.id)}`;
      return `<tr><td><strong>${esc(g.name)}</strong></td><td>${esc(feats)}</td><td class="num">${ws}</td></tr>`;
    }).join("");
    const exp = meta.expert && meta.expert.seasons ? Object.entries(meta.expert.seasons) : [];
    const expRows = exp.map(([season, r]) =>
      `<tr><td>${season}</td><td class="num">${r.overlap} ${L("из", "of")} 10 (${L("было", "was")} ${r.overlap_old})</td>` +
      `<td class="num">${num(r.spearman, 2)} (${L("было", "was")} ${num(r.spearman_old, 2)})</td></tr>`).join("");
    const bt = meta.backtest;
    const q = bt && bt.quali.new_pairs;
    const r = bt && bt.race.new_pairs;
    const unclear = meta.counts.race_excluded["неясный сход"] || 0;
    const ce = meta.car_expectations || {};
    const nBins = (ce.points || []).length;
    // Первые группы — лучшая машина этапа по отрыву от второй, дальше — остальные по отрыву от лучшей.
    const nLead = (ce.lead_from || []).filter((x) => x != null).length;
    const gapText = (i) => (i < nLead
      ? L(`лучшая машина, впереди второй на ${num(ce.lead_from[i], 1)}–${num(ce.lead_to[i], 1)}%`,
        `best car, ahead of the second by ${num(ce.lead_from[i], 1)}–${num(ce.lead_to[i], 1)}%`)
      : i === nBins - 1 ? L(`отрыв больше ${num(ce.gap_from[i], 1)}%`, `gap over ${num(ce.gap_from[i], 1)}%`)
        : L(`отрыв ${num(ce.gap_from[i], 1)}–${num(ce.gap_to[i], 1)}%`, `gap ${num(ce.gap_from[i], 1)}–${num(ce.gap_to[i], 1)}%`));
    const expText = nBins
      ? [...new Set([0, nLead - 1, nLead, nLead + 1, Math.round((nBins + nLead) / 2), nBins - 1])]
        .filter((i) => i >= 0 && i < nBins)
        .map((i) => `${gapText(i)} — ${num(ce.points[i], 1)}`).join(", ") + L(" очка за гонку", " points per race")
      : "";
    const expSeasons = ce.seasons ? L(` (по сезонам ${ce.seasons[0]}–${ce.seasons[1]})`, ` (seasons ${ce.seasons[0]}–${ce.seasons[1]})`) : "";
    const v = meta.validation;
    const fmtR = (x) => (x == null ? "—" : num(x, 2).replace("-", MINUS));
    const checkRows = v ? [...GROUPS.map((g) => [g.id, g.name]), ["overall", L("Итог", "Total")]]
      .filter(([id]) => v.groups[id])
      .map(([id, label]) => `<tr><td>${id === "overall" ? `<strong>${label}</strong>` : esc(label)}</td>` +
        `<td class="num">${fmtR(v.groups[id].reliability)}${id === "teammate" ? "*" : ""}</td>` +
        `<td class="num">${fmtR(v.groups[id].moved)}</td><td class="num">${fmtR(v.groups[id].stayed)}</td></tr>`).join("") : "";
    // Прогноз новых пар напарников по рейтингу прошлого сезона: итог и каждая группа.
    const pr = v && v.predictive;
    const predRows = pr && pr.pairs ? [["overall", L("Итог", "Total")], ...GROUPS.map((g) => [g.id, g.name])]
      .filter(([id]) => pr.quali[id] != null)
      .map(([id, label]) => `<tr><td>${id === "overall" ? `<strong>${label}</strong>` : esc(label)}</td>` +
        `<td class="num">${pct(pr.quali[id])}</td><td class="num">${pct(pr.race[id])}</td></tr>`).join("") : "";
    if (EN) {
      body.innerHTML = methodEn({ groupRows, expRows, q, r, unclear, expText, expSeasons, v, checkRows, pr, predRows });
      return;
    }
    body.innerHTML = `
      <p><strong>Идея.</strong> Рейтинг собирает в один балл всё, что видно по протоколам: результаты,
        квалификацию, гонку, аккуратность и то, насколько пилот выжимает из своей машины. Машина объясняет
        бо́льшую часть результата (по исследованиям — около 86–88%), поэтому одних результатов мало,
        но и одного сравнения с напарником тоже мало: чемпион в лучшей машине должен быть наверху.</p>
      <div class="table-wrap"><table class="mini"><thead><tr><th>Группа</th><th>Признаки</th><th class="num">Вес: сводка / сезон</th></tr></thead>
        <tbody>${groupRows}</tbody></table></div>
      <ul>
        <li><strong>Как читать таблицу.</strong> Рейтинг и баллы групп — по шкале 0–100, 50 — средний пилот.
          Тонкая линия на шкале — вилка балла, мелкие цифры под местом — диапазон мест: так выходит
          в ${Math.round(100 * meta.interval)}% из ${meta.draws} пересчётов рейтинга на случайно перевыбранных этапах.
          «≈» — порядок с соседом строкой выше держится меньше чем в ${Math.round(100 * TIE_P)}% пересчётов.
          Нажмите на заголовок столбца, чтобы отсортировать, или на пилота — чтобы открыть карточку.</li>
        <li><strong>Сравнение двух пилотов.</strong> В карточке выберите второго пилота или соседа по таблице.
          Разница итогов раскладывается по группам: вклад группы — её доля в весах × разница баллов группы, сумма
          вкладов — разница итогов (если балл не упёрся в 0 или 100). Там же — в какой доле пересчётов пилот впереди,
          главные различия по признакам и их дуэль, если они были напарниками, или путь через сеть напарников.
          Адрес страницы хранит охват, пилота и сравнение — ссылку можно отправить.</li>
        <li><strong>По ходу сезона.</strong> В карточке пилота за сезон — рейтинг после каждого этапа: каким он был бы,
          закончись сезон на этом этапе. Гонки, квалификации и место в чемпионате — по этапам до этого включительно,
          разница с напарником — по их сравнениям на этих этапах, уровень пары — из итоговой модели сезона.
          Линейка — итогового рейтинга сезона: в начале сезона гонок мало и баллы ближе к 50, после последнего
          этапа балл совпадает с итоговым. Место — среди пилотов, которые получают место по итогам сезона.</li>
        <li><strong>Шкала.</strong> Каждый признак переводится в z-оценку среди пилотов охвата
          (в сводке — от ${meta.min_starts.period} гонок, в сезоне — от ${meta.min_starts.season}).
          Балл группы и итог — 50 + 15·z: 50 — средний пилот, 80 — на два стандартных отклонения лучше.</li>
        <li><strong>Мало гонок — меньше доверия.</strong> Доли и средние сжимаются к типичному пилоту пула (медиане)
          так, будто к реальным гонкам добавили ${meta.shrink_races} его гонок. Медиана, а не среднее: среднее по очкам,
          победам и подиумам тянут вверх несколько лидеров, и пилоту с 6 гонками без очков воображаемые гонки давали бы
          очки уровня 6–7 места.</li>
        <li><strong>Очки</strong> считаются по единой шкале 25-18-15-…-1 только за гонки, без спринтов и бонуса
          за лучший круг, чтобы сезоны ${meta.period[0]}–${meta.period[1]} были сравнимы.</li>
        <li><strong>Эпохи.</strong> Гонки менялись: до 2009 года были дозаправки, обгонов до DRS было вдвое меньше,
          штрафы по времени почти не давали. Поэтому в общей сводке каждый признак сначала сравнивается
          с соперниками своего сезона (в единицах разброса этого сезона), а сезоны складываются с весом по числу
          гонок — иначе пилоты 2000-х выглядели бы иначе не из-за себя, а из-за правил. Ожидания (очки машины
          такого уровня, позиции, которые обычно отыгрывают с этого места) считаются по соседним сезонам.
          Квалификация: в 2006–2009 годах гэпы — по Q2 (Q3 ехали с топливом на гонку), в 2003–2005 годах
          сравнение с напарником идёт с половинным весом (один круг с топливом), до 2006 года «выход в Q3» —
          это топ-10. Не вышедший на старт стартом не считается, а Гран-при США 2005 года (стартовали 6 машин)
          в статистику не идёт.</li>
        <li><strong>Сверх уровня машины.</strong> Уровень машины на этапе — темп, который она показала бы
          со средним пилотом: средний темп двух её пилотов на чистых кругах с поправкой на половину их навыка
          из модели напарников, сглаженный по соседним этапам (машина не меняется скачками). Перед сглаживанием
          выбросы обрезаются: гонка с повреждённой машиной (Венгрия-2021 у Red Bull) не должна читаться как темп машины. Половину — потому что
          модель уверенно знает разницу между напарниками, а абсолютный уровень пары хуже: с полной поправкой
          Red Bull 2023 года (21 победа из 22) «со средним пилотом» выходил не быстрее Mercedes. По гонкам соседних сезонов
          (±2 года — у эпох разная надёжность и разрыв между машинами) считается, сколько очков обычно привозит
          машина с таким отрывом от лучшей, а лучшая — с таким запасом над второй${expSeasons}: ${expText}.
          Пилот получает разницу между фактом и этим ожиданием — сколько он привёз сверх среднего пилота на той же машине.
          Без поправки сильный пилот «ускорял» бы свою машину, и балл группы не сохранялся бы при смене
          команды (см. проверки ниже). «Яркая гонка» — хотя бы на 8 очков больше ожидаемого, яркий спринт —
          подиум на машине, которая обычно финиширует 7-й и ниже. Спринты учитываются с весом 0,5.</li>
        <li><strong>Темп и борьба</strong> — по позициям и времени каждого круга. Чистый круг — без сейфти-кара
          и VSC (их видно по резкому замедлению всего поля), без заезда в боксы и выезда из них. Темп
          сравнивается с медианой поля на тех же кругах, поэтому топливо и эволюция трассы сокращаются.
          Обгон засчитывается, если пилот был позади соперника в конце прошлого круга и впереди в конце
          текущего, а ни один из них не заезжал в боксы (всего ${meta.counts.overtakes || "—"} обгонов).</li>
        <li><strong>Против напарника</strong> — три модели сети напарников (квалификация, темп на общих
          чистых кругах, кто выше на финише): регрессия Ridge с цепочкой сезонов и кривой опыта новичков.
          Плюс доля очков команды, которую привёз пилот. Подменные выступления (до 3 гонок за команду
          в сезоне) идут с половинным весом: без подготовки в чужой машине пилот обычно ниже своего уровня.</li>
        <li><strong>Граф напарников и надёжность.</strong> В модели на разницах с напарником погрешность
          сравнения двух пилотов пропорциональна эффективному сопротивлению между ними в сети, где каждая
          совместная гонка — проводник. Отсюда «надёжность сравнения» каждого пилота и оценка «сколько гонок
          прямой дуэли стоит это сравнение» для любой пары.</li>
        <li><strong>Аккуратность</strong> — три вида происшествий без пересечений: свои аварии и развороты,
          столкновения по решению стюардов и другие штрафы по времени. Виновника столкновения берём из решений
          стюардов FIA (заголовки документов «Offence / Infringement — Car N — causing a collision», с 2019 года):
          столкновение засчитывается только наказанному, а сошедший из-за чужой ошибки не теряет ничего — и его
          дуэль с напарником не учитывается. Если наказан сам сошедший, дуэль засчитывается как поражение.
          Поломки и столкновения без наказания (гоночные инциденты) не в счёт. У большинства пилотов за сезон
          ноль-одно происшествие, поэтому группа почти не повторяется даже внутри сезона и не следует за пилотом
          при смене команды (см. проверки) — это шум, а не навык. Поэтому она справка: в итог по умолчанию
          не входит, но её можно вернуть ползунком. В карточке пилота под группой перечислены сами гонки.</li>
        <li><strong>Гонщик дня</strong> — только в рейтинге сезона, около 5% итога: в какой доле гонок болельщики
          выбрали пилота гонщиком дня (голосование Formula 1, с ${DOTD_FROM} года; в более ранних сезонах группы нет).
          Это мнение зрителей, а не измерение, поэтому вес небольшой; с ним сверка сезонного топ-10 с опросами
          руководителей команд чуть лучше, а в общую сводку группа не входит.</li>
        <li><strong>Карьера</strong> — только в общей сводке: качество и долговечность. Среднее за период само по себе
          наказывает длинную карьеру — годы в слабых машинах и возраст тянут его вниз, а молодой пилот в топ-машине
          их не знает. Поэтому сезоны в F1, титулы и сезоны впереди напарника в итоговой таблице чемпионата
          считаются с дебюта, по F1DB (вся история с 1950 года): у пилотов, начавших раньше ${meta.period[0]} года,
          учитываются и прежние сезоны. Неполный сезон идёт долей гонок; напарник — тот, у кого больше всего
          стартов за ту же команду, сезон в счёт, если оба провели за неё хотя бы треть гонок. Рекорды — семь рекордов
          F1 по всей истории (победы, поулы, подиумы, быстрые круги, титулы, победы за сезон и подряд): за каждый —
          корень из лет удержания (совладельцы делят время), плюс бонус тому, кто побил чужой рекорд, — тем больше,
          чем дольше тот простоял. Запас над средним —
          сумма по нашим сезонам того, на сколько баллов пилот был выше 50: растёт и от уровня, и от длительности.
          Проверить долговечность данными, как остальные группы, нельзя — это часть определения «лучшего пилота
          периода», поэтому её вес можно поменять ползунком.</li>
        ${EVER.drivers ? `<li><strong>Все времена (${EVER.period[0]}–${EVER.period[1]}).</strong> Отдельная упрощённая модель
          на данных F1DB: кругов до 1996 года нет, поэтому в ней только то, что есть для всех эпох, — результаты
          (очки по единой шкале, победы, подиумы, место в чемпионате), квалификация (поулы, место, отставание от поула),
          против напарника (отставание в квалификации и кто выше на финише — с поправкой на силу напарников через всю
          сеть, как в основной модели) и карьера. Напарник — пилот того же заявителя на той же машине: в 1950-х у одной
          марки бывало по 4–5 машин частников. Признаки сравниваются внутри сезона, гонки Индианаполис-500 (1950–1960)
          не в счёт. Проверки: прогноз новых пар напарников по баллу прошлого сезона — квалификация
          ${pct(EVER.validation.quali)} из ${EVER.validation.pairs_quali} пар, финиш ${pct(EVER.validation.race)}
          из ${EVER.validation.pairs_race}; итог после смены марки сохраняется с корреляцией
          ${num(EVER.validation.moved, 2)} (${EVER.validation.n_moved} пар сезонов).</li>` : ""}
        <li><strong>Дождь и типы трасс — справка, а не часть балла.</strong> Дождевые гонки размечены вручную
          по отчётам (${(meta.wet && meta.wet.races) || "—"} за ${meta.period[0]}–${meta.period[1]}, файл
          annotations/wet_races.yaml); для новых гонок подсказку дают осадки из архива Open-Meteo, но реанализ
          часто ошибается: дождь до старта и ливень по соседству он путает. Тип трассы: уличные — по F1DB,
          автодромы — пополам по средней скорости лучшего круга${meta.track_types ? ` (скоростные: ${
            (meta.track_types.fast || []).map(([c, k]) => CIRCUIT_RU[c] || c).join(", ")}; технические: ${
            (meta.track_types.technical || []).map(([c, k]) => CIRCUIT_RU[c] || c).join(", ")})` : ""}.
          В балл не входят, потому что на данных повторяются слабо: прибавка в дождь против напарника,
          посчитанная по половинам дождевых гонок, совпадает на 0,1–0,3 (у групп рейтинга — 0,86–0,98),
          а «специализация» по типу трасс держится только на уличных трассах (0,6) — и может идти от машины.</li>
        <li><strong>Сходы</strong> классифицируются по причинам из F1DB: авария или разворот — ошибка пилота,
          поломка — не его вина. В дуэлях с напарником столкновения без разбора виновника не засчитываются
          никому (${unclear} ${plural(unclear, "гоночная дуэль", "гоночные дуэли", "гоночных дуэлей")}).</li>
        <li><strong>Веса</strong> — это мнение, а не измерение: ползунки над таблицей пересчитывают всё на лету.
          Пресет «По данным» опирается на проверки ниже: больше веса тем группам, которые меряют пилота, а не машину.</li>
        ${meta.draws ? `<li><strong>Вилки балла и места.</strong> Рейтинг пересчитан ${meta.draws} раз. В каждом пересчёте
          этапы сезона выбираются случайно с повторениями (уикенд целиком — гонка и спринт всех пилотов, поэтому
          в каждой гонке по-прежнему один победитель), чемпионат и титулы пересчитываются по очкам выбранных этапов,
          а группа «Против напарника» берёт один из вариантов модели напарников. ${meta.shrink_races} воображаемых
          гонок, которыми сжимаются доли, в пересчёте «проезжает» случайный пилот пула, а не идеально средний:
          так у пилота с одной-двумя гонками вилка выходит широкой, а не узкой. Все пересчёты меряются той же
          линейкой, что и основной балл (средние и разбросы по пулу). Вилка — границы, в которые попадают
          ${Math.round(100 * meta.interval)}% пересчётов; «≈» — порядок пары держится меньше чем
          в ${Math.round(100 * TIE_P)}% пересчётов. Вилка ловит только случайность: веса групп в неё не входят
          (при их смене она пересчитывается вместе с баллом), систематические ошибки — например, неточный
          уровень машины целой команды — тоже, а модель напарников на пересчётах не перестраивается.</li>` : ""}
      </ul>
      ${expRows ? `<p><strong>Сверка с экспертами.</strong> Для сезонов 2021–2025 сравнили наш топ-10 с опросом
        руководителей команд F1 (каждый называет свой топ-10, голоса суммируются). В скобках — прошлая версия,
        где рейтинг строился только на сравнении с напарником.</p>
        <div class="table-wrap"><table class="mini"><thead><tr><th>Сезон</th><th class="num">Совпало в топ-10</th>
        <th class="num">Корреляция мест</th></tr></thead><tbody>${expRows}</tbody></table></div>` : ""}
      ${checkRows ? `<p><strong>Проверки рейтинга.</strong> Каждый прогон проверяет, что меряют группы.
        <em>Повторяемость</em> — насколько совпадают баллы, посчитанные отдельно по нечётным и по чётным этапам
        сезона (1 — полностью, 0 — шум). <em>После смены команды</em> — связь баллов пилота в соседних сезонах
        у тех, кто перешёл в другую команду (${v.n_moved} ${plural(v.n_moved, "пара", "пары", "пар")} сезонов;
        смена названия команды переходом не считается): группа, которая меряет пилота, сохраняется, а та,
        что меряет машину, — нет. <em>Остались</em> — то же у оставшихся (${v.n_stayed}).</p>
        <div class="table-wrap"><table class="mini"><thead><tr><th>Группа</th><th class="num">Повторяемость</th>
        <th class="num">После смены команды</th><th class="num">Остались</th></tr></thead>
        <tbody>${checkRows}</tbody></table></div>
        <p class="hint">* Модель напарников обучена на всех гонках сезона, поэтому её повторяемость завышена.
        «Результаты», «Квалификация» и «Темп» меряют в основном машину: так и задумано, это то, что пилот привёз.
        Пресет «По данным» над таблицей даёт группе вес пропорционально связи после смены команды
        (отрицательная — ноль, «Карьеру» так не проверить). Переходов немного, поэтому цифры приблизительные:
        погрешность около ±0,2.</p>` : ""}
      ${predRows ? `<p><strong>Проверка прогнозом всего рейтинга.</strong> Для пар, которые впервые ездят вместе
        (${pr.pairs} ${plural(pr.pairs, "пара", "пары", "пар")} с баллами обоих в прошлом сезоне), — угадывает ли разница
        их баллов прошлого сезона, кто окажется выше в новом: чаще впереди в квалификации и выше на финише, когда
        финишировали оба. Машина у напарников одна, поэтому это проверка того, мерит ли рейтинг пилота.
        50% — уровень монетки; пар немного, поэтому погрешность около ±11%.</p>
        <div class="table-wrap"><table class="mini"><thead><tr><th>Балл прошлого сезона</th>
        <th class="num">Квалификация</th><th class="num">Финиш</th></tr></thead><tbody>${predRows}</tbody></table></div>` : ""}
      ${q && r ? `<p><strong>Проверка прогнозом модели напарников.</strong> Для пар, которые раньше не ездили вместе,
        модель угадала более быстрого в квалификации по итогам сезона в ${Math.round(100 * q.season_sign_accuracy)}% случаев
        (${q.season_pairs} ${plural(q.season_pairs, "пара", "пары", "пар")}), а победителя сезонной гоночной дуэли —
        в ${Math.round(100 * r.season_accuracy)}% (${r.season_pairs} ${plural(r.season_pairs, "пара", "пары", "пар")}):
        гоночные дуэли новых пар модель предсказывает не лучше монетки.</p>` : ""}
      <p><strong>Основа методики.</strong>
        <a href="https://www.degruyterbrill.com/document/doi/10.1515/jqas-2015-0050/html" target="_blank" rel="noopener">Bell и др. (2016)</a> —
        многоуровневая модель «пилот / команда / команда-сезон»;
        <a href="https://arxiv.org/abs/2203.08489" target="_blank" rel="noopener">ван Кестерен и Бергкамп (2023)</a> —
        байесовская ранговая модель, доля машины ~88%;
        <a href="https://martiningram.github.io/f1-model" target="_blank" rel="noopener">М. Ингрэм</a> — навык как случайное
        блуждание по сезонам и отдельная модель сходов; Э. Филлипс (F1metrics, 2014) — скорректированные очки
        и разделение сходов по вине пилота и техники; AWS Fastest Driver — сравнение с напарником в квалификации.</p>
      <p><strong>Источники данных.</strong>
        <a href="https://api.jolpi.ca" target="_blank" rel="noopener">Jolpica F1 API</a> — результаты и квалификации;
        <a href="https://github.com/f1db/f1db" target="_blank" rel="noopener">F1DB</a> — причины сходов, штрафы,
        таблицы чемпионатов (CC BY 4.0);
        <a href="https://github.com/TracingInsights/RaceData" target="_blank" rel="noopener">TracingInsights RaceData</a> —
        позиция и время каждого пилота на каждом круге, пит-стопы;
        <a href="https://ru.wikipedia.org" target="_blank" rel="noopener">Википедия</a> — краткие биографии пилотов
        (вводная часть статьи, CC BY-SA 4.0);
        <a href="https://commons.wikimedia.org" target="_blank" rel="noopener">Викисклад</a> — фото пилотов
        (только свободные лицензии, автор и лицензия — под фото);
        <a href="https://www.fia.com/documents" target="_blank" rel="noopener">документы FIA</a> — решения стюардов
        о столкновениях (с 2019 года);
        <a href="https://open-meteo.com" target="_blank" rel="noopener">Open-Meteo</a> — осадки на трассах
        (подсказка для разметки дождевых гонок, CC BY 4.0).</p>
      <p><strong>Чего пока нет.</strong> Шин: составы и износ есть только в тяжёлых сезонных архивах TracingInsights.
        Уровень машины берётся из темпа её же пилотов, поэтому сильный пилот слегка «ускоряет» свою машину
        в глазах модели (поправка — половина навыка из модели напарников).</p>`;
  }

  // Методика по-английски: те же разделы, что в renderMethod, короче там, где речь о русских источниках.
  function methodEn({ groupRows, expRows, q, r, unclear, expText, expSeasons, v, checkRows, pr, predRows }) {
    const level = Math.round(100 * meta.interval);
    const tie = Math.round(100 * TIE_P);
    const [p0, p1] = meta.period;
    const tracks = (kind) => ((meta.track_types || {})[kind] || []).map(([c]) => circuitName(c)).join(", ");
    const ev = EVER.validation || {};
    const link = (href, text) => `<a href="${href}" target="_blank" rel="noopener">${text}</a>`;
    return `
      <p><strong>Idea.</strong> The rating combines everything visible in the classification into one score: results,
        qualifying, the race, clean driving and how much the driver gets out of the car. The car explains most of
        the result (about 86–88% according to research), so results alone are not enough — but the teammate
        comparison alone is not enough either: a champion in the best car should be at the top.</p>
      <div class="table-wrap"><table class="mini"><thead><tr><th>Group</th><th>Features</th><th class="num">Weight: all seasons / season</th></tr></thead>
        <tbody>${groupRows}</tbody></table></div>
      <ul>
        <li><strong>Reading the table.</strong> The rating and group scores are on a 0–100 scale, 50 is an average driver.
          The thin line on the bar is the score range and the small numbers under the place are the range of places:
          what ${level}% of ${meta.draws} resamples of the rating on randomly redrawn rounds give. “≈” — the order with
          the row above holds in fewer than ${tie}% of resamples. Click a column header to sort, or a driver to open
          the card.</li>
        <li><strong>Comparing two drivers.</strong> In the card, pick a second driver or a neighbour in the table. The gap
          between the totals is split by group: a group's contribution is its share of the weights × the difference of
          its scores, and the contributions add up to the gap (unless a score hits 0 or 100). It also shows how often the
          driver is ahead across resamples, the main feature differences and their duel if they were teammates — or the
          path through the teammate network. The page address keeps the scope, driver and comparison, so the link can
          be shared.</li>
        <li><strong>Through the season.</strong> The season card shows the rating after each round: what it would be if
          the season ended there. Races, qualifying and championship position use the rounds so far; the gap to the
          teammate uses their comparisons in those rounds, while the pair's level comes from the final season model.
          The ruler is the final season rating's: early on there are few races and scores sit near 50, and after the
          last round the score equals the final one. Places are among the drivers who get a place at the end of the
          season.</li>
        <li><strong>Scale.</strong> Each feature becomes a z-score among the drivers of the scope (all seasons:
          ${meta.min_starts.period}+ races; a season: ${meta.min_starts.season}+). Group scores and the total are
          50 + 15·z: 50 is average, 80 is two standard deviations better.</li>
        <li><strong>Few races, less trust.</strong> Shares and averages are shrunk towards the pool's typical driver
          (the median) as if ${meta.shrink_races} of their races were added. The median, not the mean: a few leaders pull
          the mean of points, wins and podiums up, and a driver with 6 pointless races would otherwise get imaginary
          races worth a 6th–7th place.</li>
        <li><strong>Points</strong> use one scale, 25-18-15-…-1, for races only, without sprints or the fastest-lap bonus,
          so that ${p0}–${p1} are comparable.</li>
        <li><strong>Eras.</strong> Racing changed: refuelling until 2009, half as many overtakes before DRS, hardly any
          time penalties. So in the all-season summary each feature is first compared with the rivals of its own season
          (in that season's spread), and seasons are combined weighted by races — otherwise 2000s drivers would look
          different because of the rules, not because of themselves. Expectations (points for a car of this level,
          places usually gained from this grid slot) use neighbouring seasons. Qualifying: in 2006–2009 the gaps use Q2
          (Q3 was run with race fuel), in 2003–2005 teammate comparisons count half (a single lap with race fuel), and
          before 2006 “reached Q3” means top 10. A driver who did not start is not a starter, and the 2005 US Grand Prix
          (6 cars started) is excluded.</li>
        <li><strong>Above the car.</strong> The car level at a round is the pace it would show with an average driver:
          the average clean-lap pace of its two drivers adjusted by half of their skill from the teammate model,
          smoothed over neighbouring rounds; outliers are clipped first, so a race with a damaged car (Red Bull,
          Hungary 2021) is not read as the car's pace. Half — because the model knows the gap between teammates well but the
          absolute level of the pair less so: with the full adjustment the 2023 Red Bull (21 wins out of 22) came out
          no faster than the Mercedes “with an average driver”. From races in neighbouring seasons (±2 years) we
          estimate how many points a car usually scores with such a gap to the best car, and the best car with such a
          margin over the second${expSeasons}: ${expText}. The driver gets the difference between the result and this
          expectation. A standout race is at least 8 points above expectation; a standout sprint is a podium in a car
          that usually finishes 7th or lower. Sprints count with weight 0.5.</li>
        <li><strong>Pace and racecraft</strong> come from the position and time of every lap. A clean lap has no safety
          car or VSC (seen as a sharp slowdown of the whole field) and no pit entry or exit. Pace is compared with the
          field median on the same laps, so fuel and track evolution cancel out. An overtake counts when a driver was
          behind a rival at the end of the previous lap and ahead at the end of this one, and neither pitted
          (${meta.counts.overtakes || "—"} overtakes in total).</li>
        <li><strong>Vs teammate</strong> — three teammate-network models (qualifying, pace on shared clean laps, who
          finished ahead): Ridge regression with a chain of seasons and a rookie experience curve, plus the driver's
          share of the team's points. Stand-in appearances (up to 3 races for a team in a season) count half: without
          preparation in someone else's car a driver is usually below their level.</li>
        <li><strong>Teammate graph and reliability.</strong> In a model on teammate differences the error of comparing
          two drivers is proportional to the effective resistance between them in a network where each shared race is
          a conductor. Hence each driver's “comparison reliability” and the estimate of how many races of a direct duel
          a comparison is worth.</li>
        <li><strong>Clean driving</strong> — three non-overlapping kinds of incidents: own crashes and spins, collisions per
          stewards' decisions and other time penalties. The culprit of a collision comes from FIA stewards' decisions
          (document titles “Offence / Infringement — Car N — causing a collision”, since 2019): it counts only against
          the penalised driver; a driver who retired because of someone else's mistake loses nothing, and their duel
          with the teammate is not counted, while a penalised driver who retired loses the duel. Failures and
          unpenalised collisions (racing incidents) do not count. Most drivers have zero or one incident per season,
          so the group barely repeats even within a season and does not follow the driver after a team change — it is
          noise, not skill. That is why it is for reference: not in the total by default, but a slider can bring it
          back.</li>
        <li><strong>Driver of the Day</strong> — season rating only, about 5% of the total: the share of races
          where fans voted the driver Driver of the Day (Formula 1 poll, since ${DOTD_FROM}; earlier seasons have no
          such group). It is an opinion, not a measurement, so the weight is small; with it the season top 10 agrees
          slightly better with the team principals' polls. It is not part of the all-season summary.</li>
        <li><strong>Career</strong> — all-season summary only: quality and longevity. A period average punishes a long
          career by itself: years in weak cars and age drag it down, which a young driver in a top car never sees. So
          seasons in F1, titles and seasons ahead of the teammate in the final standings count from the debut, using
          F1DB (the whole history since 1950): drivers who started before ${p0} get their earlier seasons too. A partial
          season counts as a share of races; the teammate is the one with the most starts for the same team, and a
          season counts if both did at least a third of its races. Records are seven all-time F1 records (wins, poles,
          podiums, fastest laps, titles, wins in a season and in a row): for each, the square root of the years held
          (co-holders share the time), plus a bonus for breaking someone else's record that grows with how long it
          had stood. The margin above average is the sum over our seasons
          of how many points the driver was above 50: it grows with both level and length. Longevity cannot be checked
          with data like the other groups — it is part of the definition of the “best driver of the period”, so its
          weight is a slider.</li>
        ${EVER.drivers ? `<li><strong>All time (${EVER.period[0]}–${EVER.period[1]}).</strong> A separate simplified model on
          F1DB data: there are no laps before 1996, so it only uses what exists for every era — results (points on one
          scale, wins, podiums, championship position), qualifying (poles, position, gap to pole), vs teammate
          (qualifying gap and who finished ahead, adjusted for teammate strength across the whole network like the main
          model) and career. A teammate is a driver of the same entrant in the same make: in the 1950s one make often
          had 4–5 privateer cars. Features are compared within the season; the Indianapolis 500 (1950–1960) is excluded.
          Checks: predicting new teammate pairs from last season's score — qualifying ${pct(ev.quali)} of
          ${ev.pairs_quali} pairs, finish ${pct(ev.race)} of ${ev.pairs_race}; the total after a change of make keeps a
          correlation of ${num(ev.moved, 2)} (${ev.n_moved} season pairs).</li>` : ""}
        <li><strong>Rain and track types are for reference, not part of the score.</strong> Wet races are marked by hand
          from race reports (${(meta.wet && meta.wet.races) || "—"} in ${p0}–${p1}, file annotations/wet_races.yaml); for new
          races precipitation from the Open-Meteo archive gives a hint, but reanalysis often errs, confusing rain before
          the start or a downpour nearby. Track type: street circuits from F1DB, permanent circuits split in half by the
          average speed of the fastest lap${meta.track_types ? ` (fast: ${tracks("fast")}; technical: ${tracks("technical")})` : ""}.
          They are not in the score because they barely repeat in the data: the wet-weather gain vs the teammate,
          computed on halves of the wet races, agrees at 0.1–0.3 (rating groups: 0.86–0.98), and track-type
          “specialisation” only holds on street circuits (0.6) — and may come from the car.</li>
        <li><strong>Retirements</strong> are classified by the F1DB cause: an accident or spin is a driver error, a failure
          is not their fault. In teammate duels, collisions without a culprit count for no one (${unclear}
          ${plural(unclear, "", "", "", "race duel")}).</li>
        <li><strong>Weights</strong> are an opinion, not a measurement: the sliders above the table recompute everything on
          the fly. The “By the data” preset relies on the checks below: more weight to groups that measure the driver
          rather than the car.</li>
        ${meta.draws ? `<li><strong>Score and place ranges.</strong> The rating is recomputed ${meta.draws} times. In each
          resample the rounds of a season are drawn at random with replacement (a whole weekend — race and sprint of all
          drivers, so every race still has one winner), the championship and titles are recomputed from the points of
          the drawn rounds, and the “Vs teammate” group takes one of the teammate model's variants. The
          ${meta.shrink_races} imaginary races used for shrinkage are driven by a random pool driver rather than a
          perfectly average one, so a driver with one or two races gets a wide range, not a narrow one. All resamples
          use the same ruler as the main score (pool means and spreads). The range holds ${level}% of resamples; “≈” —
          the order of the pair holds in fewer than ${tie}% of them. It only captures randomness: group weights are not
          part of it (it is recomputed with the score), nor are systematic errors such as an inaccurate car level for a
          whole team, and the teammate model is not refitted in resamples.</li>` : ""}
      </ul>
      ${expRows ? `<p><strong>Expert check.</strong> For 2021–2025 our top 10 is compared with the poll of F1 team
        principals (each names a top 10, the votes are summed). In brackets — the previous version, built only on the
        teammate comparison.</p>
        <div class="table-wrap"><table class="mini"><thead><tr><th>Season</th><th class="num">Overlap in top 10</th>
        <th class="num">Rank correlation</th></tr></thead><tbody>${expRows}</tbody></table></div>` : ""}
      ${checkRows ? `<p><strong>Rating checks.</strong> Each run checks what the groups measure. <em>Repeatability</em> —
        how well the scores computed separately on odd and even rounds of a season agree (1 — fully, 0 — noise).
        <em>After a team change</em> — the correlation of a driver's scores in adjacent seasons for those who moved to
        another team (${v.n_moved} season pairs; a renamed team is not a move): a group that measures the driver
        persists, one that measures the car does not. <em>Stayed</em> — the same for those who stayed (${v.n_stayed}).</p>
        <div class="table-wrap"><table class="mini"><thead><tr><th>Group</th><th class="num">Repeatability</th>
        <th class="num">After a team change</th><th class="num">Stayed</th></tr></thead>
        <tbody>${checkRows}</tbody></table></div>
        <p class="hint">* The teammate model is trained on all races of the season, so its repeatability is overstated.
        “Results”, “Qualifying” and “Pace” mostly measure the car: that is by design, it is what the driver delivered.
        The “By the data” preset gives a group weight in proportion to its correlation after a team change (negative —
        zero; “Career” cannot be checked this way). There are not many moves, so the figures are approximate: about
        ±0.2.</p>` : ""}
      ${predRows ? `<p><strong>Predictive check of the whole rating.</strong> For pairs who become teammates for the first
        time (${pr.pairs} pairs with both scored last season): does the gap in last season's scores predict who comes
        out ahead in the new one — more often ahead in qualifying, and ahead at the finish when both finished. Teammates
        share a car, so this checks whether the rating measures the driver. 50% is a coin flip; there are few pairs, so
        the error is about ±11%.</p>
        <div class="table-wrap"><table class="mini"><thead><tr><th>Last season's score</th>
        <th class="num">Qualifying</th><th class="num">Finish</th></tr></thead><tbody>${predRows}</tbody></table></div>` : ""}
      ${q && r ? `<p><strong>Predictive check of the teammate model.</strong> For pairs who had not raced together
        before, the model picked the faster qualifier over the season in ${Math.round(100 * q.season_sign_accuracy)}% of
        cases (${q.season_pairs} pairs), and the winner of the season's race duel in ${Math.round(100 * r.season_accuracy)}%
        (${r.season_pairs} pairs): race duels of new pairs are no better than a coin flip.</p>` : ""}
      <p><strong>Foundations.</strong>
        ${link("https://www.degruyterbrill.com/document/doi/10.1515/jqas-2015-0050/html", "Bell et al. (2016)")} —
        a multilevel driver / team / team-season model;
        ${link("https://arxiv.org/abs/2203.08489", "van Kesteren and Bergkamp (2023)")} — a Bayesian ranking model,
        car share ~88%; ${link("https://martiningram.github.io/f1-model", "M. Ingram")} — skill as a random walk over
        seasons and a separate retirement model; E. Phillips (F1metrics, 2014) — adjusted points and splitting
        retirements into driver and car fault; AWS Fastest Driver — teammate comparison in qualifying.</p>
      <p><strong>Data sources.</strong>
        ${link("https://api.jolpi.ca", "Jolpica F1 API")} — results and qualifying;
        ${link("https://github.com/f1db/f1db", "F1DB")} — retirement causes, penalties, standings (CC BY 4.0);
        ${link("https://github.com/TracingInsights/RaceData", "TracingInsights RaceData")} — position and time of every
        driver on every lap, pit stops; ${link("https://en.wikipedia.org", "Wikipedia")} — short driver biographies
        (article lead, CC BY-SA 4.0); ${link("https://commons.wikimedia.org", "Wikimedia Commons")} — driver photos (free
        licences only, author and licence under each photo); ${link("https://www.fia.com/documents", "FIA documents")} —
        stewards' decisions on collisions (since 2019); ${link("https://open-meteo.com", "Open-Meteo")} — precipitation
        at the circuits (a hint for marking wet races, CC BY 4.0).</p>
      <p><strong>Not yet included.</strong> Tyres: compounds and wear exist only in the heavy season archives of
        TracingInsights. The car level comes from its own drivers' pace, so a strong driver slightly “speeds up” the car
        in the model's eyes (half of the teammate-model skill is used as a correction).</p>`;
  }

  // ---------- общий рендер ----------
  function renderAll(withWeights = true) {
    cache.clear();
    if (withWeights) renderWeights();
    else syncWeightLabels();
    renderTable();
    renderDriver();
    renderMobileBar();
  }

  function render() {
    const ever = state.scope === EVER_KEY;
    if (ever) {
      // «Все времена»: та же таблица и карточка, но свои пилоты (F1DB) и свои группы
      if (!EVER.drivers.some((d) => d.id === everState.open)) {
        everState.open = EVER.drivers.reduce((a, b) => (b.rank < a.rank ? b : a)).id;
      }
    } else {
      if (!state.driver || !scopes[state.scope].some((e) => e.id === state.driver)) {
        const first = computeScope(state.scope).entries.filter((e) => e.eligible).sort((a, b) => b.score - a.score)[0];
        state.driver = first ? first.id : null;
        state.compare = null;
      }
      if (state.compare && (state.compare === state.driver || !scopes[state.scope].some((e) => e.id === state.compare))) {
        state.compare = null;
      }
    }
    syncScopeSeg();
    renderScopeNote();
    renderAll();
    writeHash();
    if (!ever) syncGraph(state.driver);
  }

  // Страна по-английски — из идентификатора F1DB: «united-kingdom» → «United Kingdom».
  const EVER_COUNTRY_EN = { "united-states-of-america": "USA", "united-kingdom": "UK" };
  const everCountry = (id) => (!id ? null : EVER_COUNTRY_EN[id]
    || id.split("-").map((w) => w[0].toUpperCase() + w.slice(1)).join(" "));

  // Четыре шага методики — коротко; полный текст открывается кнопкой рядом с заголовком.
  function renderMethodCards() {
    const [p0, p1] = meta.period;
    const min = meta.min_starts.period;
    const cards = [
      [L("Собираем", "Collect"),
        L(`Результаты, квалификации и время каждого круга за ${p0}–${p1} годы. Место получают пилоты от ${min} гонок; ` +
          "итог сверяется с опросами руководителей команд.",
        `Race results, qualifying and every lap for ${p0}–${p1}. Drivers with ${min}+ races get a place; the outcome ` +
          "is cross-checked against team principals' polls.")],
      [L("Считаем восемь групп", "Score eight groups"),
        L("Каждая группа переводится в шкалу 0–100, где 50 — средний пилот того же сезона или периода.",
          "Each group is scaled to 0–100, where 50 is an average driver of the same season or period.")],
      [L("Отделяем машину", "Adjust for the car"),
        L("Сравнение с напарниками через всю сеть и оценка уровня машины отделяют пилота от техники.",
          "Teammate comparisons through the whole network and a car-level estimate separate the driver from the machinery.")],
      [L("Взвешиваем и расставляем", "Weight and rank"),
        L("Итог — взвешенная сумма групп. Вилка показывает, как меняется балл, если случайно перевыбрать этапы сезона.",
          "The total is a weighted sum. The range shows how the score moves when the season's rounds are redrawn at random.")],
    ];
    const box = $("#method-cards");
    box.replaceChildren();
    cards.forEach(([title, text], i) => {
      const card = el("div", "mcard");
      card.append(el("span", "mnum", String(i + 1).padStart(2, "0")), el("span", "mtitle", title), el("span", "mtext", text));
      box.append(card);
    });
  }

  // Панель весов: на большом экране и в листе на телефоне раскрыта, в одной колонке — сворачивается.
  function syncLayout() {
    $("#weights-panel").open = DESKTOP.matches || MOBILE.matches;
    if (!MOBILE.matches) closeSheet();
  }

  readHash();
  renderHeader();
  renderMethod();
  renderMethodCards();
  syncLayout();
  render();
  initGraph();

  $("#sheet-backdrop").addEventListener("click", closeSheet);
  for (const button of document.querySelectorAll("[data-sheet-close]")) button.addEventListener("click", closeSheet);
  document.addEventListener("keydown", (event) => { if (event.key === "Escape") closeSheet(); });
  $("#method-toggle").addEventListener("click", () => {
    const body = $("#method-body");
    body.hidden = !body.hidden;
    const toggle = $("#method-toggle");
    toggle.setAttribute("aria-expanded", String(!body.hidden));
    toggle.textContent = body.hidden ? L("Полная методика и источники", "Full methodology and sources")
      : L("Свернуть методику", "Hide the methodology");
  });
  window.addEventListener("resize", () => {
    charts.forEach((c) => c.resize());
    if (graphChart) graphChart.resize();
  });
  for (const query of [DESKTOP, MOBILE]) {
    query.addEventListener("change", () => {
      syncLayout();
      renderDriver();
      if (graphState.ready) drawGraph();
    });
  }
})();
