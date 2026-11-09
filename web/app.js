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
    career: ["Career", "All-season summary only: quality and longevity. Since the F1 debut — seasons in F1, seasons " +
      "ahead of the teammate in the championship, titles; over our seasons — margin above average."],
  };
  const FEATURE_EN = {
    ppr: "Points per race", win_rate: "Wins", podium_rate: "Podiums", champ: "Championship position (points for it)",
    points_above_car: "Points above the car level, per race", pos_above_car: "Places above the car level",
    standout_rate: "Standout races", pole_rate: "Poles", q3_rate: "Reached Q3 (before 2006 — top 10)",
    quali_gap: "Gap to the best in qualifying", quali_pos: "Average qualifying position",
    race_pace: "Pace: gap to the field median", consistency: "Lap time spread",
    lap1_vs_exp: "First lap: places beyond expectation", overtakes: "On-track overtakes per race",
    overtaken: "Times overtaken per race", gain_vs_exp: "Places per race beyond expectation",
    err_rate: "Own crashes and spins", collision_rate: "Collisions per stewards' decisions",
    penalty_rate: "Other time penalties", car_quali: "Quali vs teammates, s/lap", car_pace: "Pace vs teammates, s/lap",
    car_race: "Finish vs teammates", team_share: "Share of team points", seasons: "Seasons in F1 since debut",
    ahead: "Seasons ahead of teammate", titles: "Career titles", above_avg: "Margin above average over seasons",
  };
  if (EN) {
    for (const g of GROUPS) if (GROUP_EN[g.id]) [g.name, g.about] = GROUP_EN[g.id];
    for (const f of FEATURES) if (FEATURE_EN[f.id]) f.name = FEATURE_EN[f.id];
  }
  const MINUS = "−";
  const SINGLE_COLUMN = window.matchMedia("(max-width: 1179px)");
  const DARK = window.matchMedia("(prefers-color-scheme: dark)");
  const SEASON_KEYS = meta.scopes.filter((k) => k !== PERIOD);
  // «Все времена» (1950+, alltime.py) — первая вкладка «Охвата»: своя таблица вместо таблицы и карточки.
  const EVER = DATA.alltime || {};
  const EVER_KEY = "ever";
  const HAS_EVER = Boolean(EVER.drivers && EVER.drivers.length);
  const everState = { sort: "rating", expanded: false, open: null };
  const EVER_TOP = 25;

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
  const ZERO = { results: 0, above_car: 0, quali: 0, pace: 0, racecraft: 0, clean: 0, teammate: 0, career: 0 };
  const PRESETS = [
    { id: "default", name: L("Сбалансированный", "Balanced") },
    { id: "results", name: L("Важнее результаты", "Results first"),
      w: { results: 40, above_car: 15, quali: 10, pace: 10, racecraft: 5, clean: 0, teammate: 15, career: 5 } },
    { id: "skill", name: L("Чистое мастерство", "Pure skill"),
      w: { results: 5, above_car: 20, quali: 15, pace: 15, racecraft: 15, clean: 0, teammate: 30, career: 0 } },
    { id: "only", name: L("Только результаты", "Results only"), w: { ...ZERO, results: 100 } },
  ];
  // «По данным»: вес группы пропорционален тому, насколько её балл следует за пилотом при смене
  // команды (validate.py). Округляем до 5%, как шаг ползунков.
  const DATA_WEIGHTS = meta.validation && meta.validation.data_weights;
  if (DATA_WEIGHTS) {
    PRESETS.push({ id: "data", name: L("По данным", "By the data"),
      w: Object.fromEntries(Object.entries(DATA_WEIGHTS).map(([k, v]) => [k, 5 * Math.round(20 * v)])) });
  }

  const TOP_N = 15;  // столько строк показывать в свёрнутой таблице
  const state = {
    scope: PERIOD, showAll: false, driver: null, compare: null, sort: "score", preset: "default", custom: null,
    expanded: false,
  };

  function weightsFor(isPeriod) {
    if (state.custom) return state.custom;
    const preset = PRESETS.find((p) => p.id === state.preset);
    if (preset && preset.w) return preset.w;
    const base = isPeriod ? meta.weights.period : meta.weights.season;
    return Object.fromEntries(Object.entries(base).map(([k, v]) => [k, Math.round(100 * v)]));
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
  function computeScope(key) {
    const isPeriod = key === PERIOD;
    const w = weightsFor(isPeriod);
    const cacheKey = `${key}|${JSON.stringify(w)}`;
    if (cache.has(cacheKey)) return cache.get(cacheKey);
    const groups = GROUPS.filter((g) => (isPeriod || g.id !== "career") && (w[g.id] || 0) > 0);
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
    addBands(key, entries, pool, groups, w, total, mean, sd);
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

  // ---------- шапка, фильтры, веса ----------
  function scopeLabel(key) {
    if (key === EVER_KEY) return L(`Все времена ${EVER.period[0]}–${EVER.period[1]}`, `All time ${EVER.period[0]}–${EVER.period[1]}`);
    return key === PERIOD ? L(`Все сезоны ${meta.period[0]}–${meta.period[1]}`, `All seasons ${meta.period[0]}–${meta.period[1]}`)
      : L(`Сезон ${key}`, `Season ${key}`);
  }

  function renderHeader() {
    const through = meta.data_through;
    const lastRace = EN ? through.race_name : GP_RU[through.race_name] || through.race_name;
    $("#subtitle").textContent = L(
      `Общая сводка ${meta.period[0]}–${meta.period[1]} и отдельные сезоны · ` +
      `данные после этапа «${lastRace}» (${dateRu(through.date)})`,
      `All seasons ${meta.period[0]}–${meta.period[1]} and each season · data through the ${lastRace} ` +
      `(${dateRu(through.date)})`);
    const select = $("#scope");
    for (const key of [...(HAS_EVER ? [EVER_KEY] : []), ...meta.scopes]) {
      const option = el("option", null, scopeLabel(key));
      option.value = key;
      select.append(option);
    }
    select.addEventListener("change", () => {
      state.scope = select.value;
      if (state.scope !== EVER_KEY && !scopes[state.scope].some((e) => e.id === state.driver)) state.driver = null;
      render();
    });
    $("#show-all").addEventListener("change", (event) => {
      state.showAll = event.target.checked;
      renderTable();
      renderScopeNote();
    });
    $("#footer").textContent = L(
      "Неофициальный фан-проект, не связан с Formula 1 и FIA. " +
      `Данные: Jolpica F1 API и F1DB (CC BY 4.0), биографии — Википедия (CC BY-SA 4.0), ` +
      "фото — Викисклад (автор и лицензия — под фото). " +
      `Данные после этапа «${lastRace}» ${through.season} года. ` +
      `Сгенерировано ${new Date(meta.generated_at).toLocaleString(LOCALE)}.`,
      "Unofficial fan project, not affiliated with Formula 1 or the FIA. " +
      "Data: Jolpica F1 API and F1DB (CC BY 4.0), biographies — Wikipedia (CC BY-SA 4.0), " +
      "photos — Wikimedia Commons (author and licence under each photo). " +
      `Data through the ${lastRace} ${through.season}. ` +
      `Generated ${new Date(meta.generated_at).toLocaleString(LOCALE)}.`);
  }

  // Доля группы в итоге: итог делится на сумму весов, а она не обязана быть 100.
  function weightShares(weights, isPeriod) {
    const groups = GROUPS.filter((g) => isPeriod || g.id !== "career");
    const total = groups.reduce((s, g) => s + (weights[g.id] || 0), 0);
    const share = (gid) => `${total > 0 ? Math.round(100 * (weights[gid] || 0) / total) : 0}%`;
    return { share, summary: groups.map((g) => `${g.name} ${share(g.id)}`).join(" · ") };
  }

  function renderWeights() {
    const isPeriod = state.scope === PERIOD;
    const w = weightsFor(isPeriod);
    const presets = $("#presets");
    presets.replaceChildren();
    for (const preset of PRESETS) {
      const button = el("button", null, preset.name);
      button.type = "button";
      button.setAttribute("aria-pressed", String(!state.custom && state.preset === preset.id));
      button.addEventListener("click", () => {
        state.preset = preset.id;
        state.custom = null;
        renderAll();
      });
      presets.append(button);
    }
    const sliders = $("#sliders");
    sliders.replaceChildren();
    const outputs = new Map();  // подписи ползунков — доли в итоге, меняются все сразу
    for (const group of GROUPS) {
      const disabled = !isPeriod && group.id === "career";
      const box = el("div", `slider${disabled ? " disabled" : ""}`);
      const id = `w-${group.id}`;
      const label = el("label", null, group.name);
      label.htmlFor = id;
      label.title = group.about;
      const output = el("output", null, disabled ? L("только для сводки", "all seasons only")
        : weightShares(w, isPeriod).share(group.id));
      if (!disabled) outputs.set(group.id, output);
      const input = el("input");
      input.type = "range";
      input.min = "0";
      input.max = "100";
      input.step = "5";
      input.id = id;
      input.value = String(w[group.id] || 0);
      input.disabled = disabled;
      input.addEventListener("input", () => {
        state.custom = { ...weightsFor(true), ...(state.custom || {}), [group.id]: Number(input.value) };
        const { share } = weightShares(state.custom, isPeriod);
        for (const [gid, out] of outputs) out.textContent = share(gid);
        renderAll(false);
      });
      box.append(label, output, input);
      sliders.append(box);
    }
    $("#weights-summary").textContent = weightShares(w, isPeriod).summary;
  }

  function renderScopeNote() {
    const isPeriod = state.scope === PERIOD;
    $("#ranking-title").textContent = isPeriod
      ? L(`Общий рейтинг ${meta.period[0]}–${meta.period[1]}`, `Overall rating ${meta.period[0]}–${meta.period[1]}`)
      : L(`Сезон ${state.scope}`, `Season ${state.scope}`);
    const notes = [];
    if (!isPeriod) {
      const races = meta.season_races[state.scope];
      if (races && races.completed < races.scheduled) {
        notes.push(L(`Сезон ещё идёт: учтено ${races.completed} из ${races.scheduled} гонок.`,
          `Season in progress: ${races.completed} of ${races.scheduled} races counted.`));
      }
    }
    const min = isPeriod ? meta.min_starts.period : meta.min_starts.season;
    $("#min-starts").textContent = min;
    const hidden = scopes[state.scope].filter((e) => !e.eligible).length;
    if (!state.showAll && hidden) {
      notes.push(L(`Скрыто пилотов, у которых меньше ${min} гонок: ${hidden}.`,
        `Hidden drivers with fewer than ${min} races: ${hidden}.`));
    }
    $("#scope-note").textContent = notes.join(" ");
  }

  // ---------- таблица ----------
  const SHORT = EN ? {
    results: "Results", above_car: "Above car", quali: "Quali", pace: "Pace", racecraft: "Racecraft",
    clean: "Clean", teammate: "Teammate", career: "Career",
  } : {
    results: "Результ.", above_car: "Над маш.", quali: "Квала", pace: "Темп", racecraft: "Борьба",
    clean: "Аккур.", teammate: "Напарник", career: "Карьера",
  };

  function columns() {
    const isPeriod = state.scope === PERIOD;
    const groups = GROUPS.filter((g) => isPeriod || g.id !== "career");
    // [id, заголовок, значение, css-класс]: второстепенные колонки прячутся на узких экранах
    const first = isPeriod
      ? ["titles", L("Титулы", "Titles"), (e) => (e.titles || []).length, "col-stat"]
      : ["standing", L("ЧМ", "WDC"), (e) => e.standing, "col-stat"];
    const stats = [
      first,
      ["wins", L("Победы", "Wins"), (e) => e.stats.wins, "col-stat"],
      ["podiums", L("Подиумы", "Podiums"), (e) => e.stats.podiums, "col-stat col-extra"],
      ["poles", L("Поулы", "Poles"), (e) => e.stats.poles, "col-stat col-extra"],
      ["starts", L("Гонок", "Races"), (e) => e.starts, "col-stat col-extra"],
    ];
    return { groups, stats };
  }

  function sortValue(e, sort, stats) {
    if (sort === "score") return e.score;
    if (sort.startsWith("g:")) return e.s[sort.slice(2)] ?? -1;
    const stat = stats.find(([id]) => id === sort);
    const v = stat ? stat[2](e) : 0;
    return sort === "standing" ? -(v ?? 99) : v ?? -1;
  }

  function renderTable() {
    const { entries } = computeScope(state.scope);
    const { groups, stats } = columns();
    if (!["score", ...groups.map((g) => `g:${g.id}`), ...stats.map(([id]) => id)].includes(state.sort)) state.sort = "score";

    const head = $("#ranking-head");
    head.replaceChildren();
    const headCell = (label, sortKey, cls, title) => {
      const th = el("th", cls);
      th.scope = "col";
      if (title) th.title = title;
      if (sortKey) {
        const button = el("button", null, label);
        button.type = "button";
        if (state.sort === sortKey) button.setAttribute("aria-sort", "descending");
        button.addEventListener("click", () => { state.sort = sortKey; renderTable(); });
        th.append(button);
      } else {
        th.textContent = label;
      }
      return th;
    };
    // Пояснения — во всплывающих подсказках заголовков, а не текстом над таблицей.
    const level = Math.round(100 * meta.interval);
    const inDraws = L(`${level}% из ${meta.draws} пересчётов на случайно перевыбранных этапах`,
      `${level}% of ${meta.draws} resamples on randomly redrawn rounds`);
    const placeTip = DRAWS[state.scope]
      ? L(`Мелкие цифры — диапазон мест в ${inDraws}. «≈» — порядок с соседом строкой выше держится меньше чем в ` +
        `${Math.round(100 * TIE_P)}% пересчётов.`,
        `Small numbers — the range of places in ${inDraws}. “≈” — the order with the row above holds in fewer than ` +
        `${Math.round(100 * TIE_P)}% of resamples.`)
      : null;
    const ratingTip = L("0–100: 50 — средний пилот, +15 за каждое стандартное отклонение.",
      "0–100: 50 is an average driver, +15 for each standard deviation.") +
      (DRAWS[state.scope] ? L(` Тонкая линия на шкале — вилка балла: так выходит в ${inDraws}.`,
        ` The thin line on the bar is the score range: what ${inDraws} give.`) : "");
    head.append(headCell(L("Место", "Place"), null, "num", placeTip), headCell(L("Пилот", "Driver")),
      headCell(L("Рейтинг", "Rating"), "score", "rating-col", ratingTip));
    for (const g of groups) head.append(headCell(SHORT[g.id] || g.name, `g:${g.id}`, "num col-group", `${g.name}: ${g.about}`));
    for (const [id, label, , cls] of stats) {
      head.append(headCell(label, id, `num ${cls}`, id === "standing" ? L("Место в чемпионате", "Championship position") : null));
    }

    const rows = entries.filter((e) => state.showAll || e.eligible);
    rows.sort((a, b) => sortValue(b, state.sort, stats) - sortValue(a, state.sort, stats) || b.score - a.score);
    const tops = {};
    for (const g of groups) {
      const values = entries.filter((e) => e.eligible).map((e) => e.s[g.id] ?? -1).sort((a, b) => b - a);
      tops[g.id] = values[2] ?? Infinity;
    }

    // Свёрнутая таблица: первые TOP_N строк; выбранный пилот остаётся виден, даже если он ниже.
    let shown = rows;
    let pinned = null;
    if (!state.expanded && rows.length > TOP_N) {
      shown = rows.slice(0, TOP_N);
      pinned = rows.slice(TOP_N).find((e) => e.id === state.driver) || null;
    }

    const tbody = $("#ranking tbody");
    tbody.replaceChildren();
    const columnsCount = 3 + groups.length + stats.length;
    for (const e of pinned ? [...shown, null, pinned] : shown) {
      if (e === null) {
        const gap = el("tr", "gap");
        const cell = el("td", null, "…");
        cell.colSpan = columnsCount;
        gap.append(cell);
        tbody.append(gap);
        continue;
      }
      const tr = el("tr");
      tr.dataset.id = e.id;
      if (!e.eligible) tr.classList.add("ineligible");
      if (e.id === state.driver) tr.classList.add("selected");
      const who = el("td");
      const button = el("button", "name-btn", name(e.id));
      button.type = "button";
      button.append(el("span", "code", drivers[e.id] ? drivers[e.id].code || "" : ""));
      const teams = e.teams.join(" → ") + (e.eligible ? ""
        : ` · ${e.starts} ${plural(e.starts, "гонка", "гонки", "гонок", "race")}`);
      who.append(button, el("span", "sub", teams));

      const ratingCell = el("td", "rating-col");
      const wrap = el("div", "rating");
      const label = L(`Рейтинг ${Math.round(e.score)} из 100`, `Rating ${Math.round(e.score)} of 100`) +
        (e.band ? L(`, вилка ${int(e.band[0])}–${int(e.band[1])}`, `, range ${int(e.band[0])}–${int(e.band[1])}`) : "");
      wrap.append(meter(e.score, label, e.band), el("div", "value", int(e.score)));
      ratingCell.append(wrap);
      const rankCell = el("td", "num rank");
      if (state.sort === "score" && e.prev && e.prev.p < TIE_P) {
        const tie = el("span", "tie", "≈");
        tie.title = L(`Почти не отличается от пилота выше: ${name(e.prev.id)} впереди ${share(e.prev.p)}`,
          `Barely different from the driver above: ${name(e.prev.id)} ahead ${share(e.prev.p)}`);
        rankCell.append(tie);
      }
      rankCell.append(document.createTextNode(e.rankNow ?? "—"));
      if (e.rankBand && e.rankBand[0] !== e.rankBand[1]) {
        const sub = el("span", "sub", `${e.rankBand[0]}–${e.rankBand[1]}`);
        sub.title = L(`Место в ${Math.round(100 * meta.interval)}% пересчётов`,
          `Place in ${Math.round(100 * meta.interval)}% of resamples`);
        rankCell.append(sub);
      }
      tr.append(rankCell, who, ratingCell);
      for (const g of groups) {
        const v = e.s[g.id];
        tr.append(el("td", `num col-group group${e.eligible && v >= tops[g.id] ? " top" : ""}`, int(v)));
      }
      for (const [, , get, cls] of stats) tr.append(el("td", `num ${cls}`, int(get(e))));
      tr.addEventListener("click", () => selectDriver(e.id));
      tbody.append(tr);
    }

    const more = $("#table-more");
    more.replaceChildren();
    if (rows.length > TOP_N) {
      const button = el("button", null, state.expanded
        ? L(`Свернуть до топ-${TOP_N}`, `Collapse to top ${TOP_N}`)
        : L(`Показать всех: ${rows.length} ${plural(rows.length, "пилот", "пилота", "пилотов")}`,
          `Show all ${rows.length} drivers`));
      button.type = "button";
      button.setAttribute("aria-expanded", String(state.expanded));
      button.addEventListener("click", () => {
        state.expanded = !state.expanded;
        renderTable();
        if (!state.expanded) $("#ranking-title").scrollIntoView({ behavior: "smooth", block: "nearest" });
      });
      more.append(button);
    }
  }

  // options.scroll = false — не прокручивать к карточке (клик по графу не должен уводить страницу вверх).
  function selectDriver(id, options = {}) {
    if (id !== state.driver) state.compare = null;
    state.driver = id;
    renderTable();  // в свёрнутой таблице выбранный пилот может быть ниже топ-15 — дорисуем его строку
    renderDriver();
    writeHash();
    syncGraph(id);
    if (options.scroll !== false && SINGLE_COLUMN.matches) $("#driver").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  // ---------- карточка пилота ----------
  let charts = [];
  function disposeCharts() {
    charts.forEach((c) => c.dispose());
    charts = [];
  }
  const cssVar = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
  const palette = () => ({
    s1: cssVar("--series-1"), s2: cssVar("--series-2"),
    text1: cssVar("--text-1"), text2: cssVar("--text-2"), muted: cssVar("--muted"),
    grid: cssVar("--grid"), axis: cssVar("--axis"), surface: cssVar("--surface"), border: cssVar("--border"),
  });

  function stat(label, big, sub) {
    const box = el("div", "stat");
    box.append(el("div", "label", label), el("div", "big", big), el("span", "sub", sub));
    return box;
  }

  function renderDriver() {
    if (state.scope === EVER_KEY) return;  // у вкладки «Все времена» карточки нет
    const box = $("#driver");
    box.replaceChildren();
    disposeCharts();
    const id = state.driver;
    const driver = drivers[id];
    const current = computeScope(state.scope).byId.get(id);
    if (!driver) {
      box.append(el("p", "empty", L("Выберите пилота в таблице.", "Pick a driver in the table.")));
      return;
    }
    if (!current) {
      box.append(el("h2", null, driver.name),
        el("p", "empty", L(`В сезоне ${state.scope} пилот не выступал. Выберите «Все сезоны» в поле «Охват», ` +
          "чтобы открыть его полную карточку.", `The driver did not race in ${state.scope}. Choose “All seasons” ` +
          "in the Scope field to open the full card.")));
      return;
    }
    const isPeriod = state.scope === PERIOD;
    const period = computeScope(PERIOD).byId.get(id);
    const other = state.compare ? computeScope(state.scope).byId.get(state.compare) || null : null;

    const facts = [country(driver.nationality)];
    if (driver.dob) facts.push(L(`родился ${dateRu(driver.dob)}`, `born ${dateRu(driver.dob)}`));
    if (driver.debut) facts.push(L(`дебют в F1 — ${driver.debut}`, `F1 debut ${driver.debut}`));
    if (period) facts.push((period.teams || []).join(", "));
    const head = el("div", "driver-head");
    const title = el("div", "driver-title");
    title.append(el("h2", null, driver.name), el("p", "meta", facts.join(" · ")), shareButton());
    const photo = photoBlock(driver.photo, driver.name);
    if (photo) head.append(photo.img);
    head.append(title);
    box.append(head);
    const bio = EN ? driver.bio_en : driver.bio;
    if (bio) box.append(bioBlock(bio));
    if (photo) box.append(photo.credit);

    const stats = el("div", "stats");
    const where = isPeriod ? L("за все сезоны", "over all seasons") : L(`в сезоне ${state.scope}`, `in ${state.scope}`);
    stats.append(stat(L("Рейтинг", "Rating"), int(current.score), current.rankNow
      ? L(`${current.rankNow}-е место ${where}`, `${ord(current.rankNow)} ${where}`)
      : L("мало гонок для места", "too few races for a place")));
    if (isPeriod) {
      const titles = current.titles || [];
      stats.append(stat(L("Титулы", "Titles"), String(titles.length), titles.length ? titles.join(", ") : "—"));
    } else {
      stats.append(stat(L("Чемпионат", "Championship"), current.standing ? L(`${current.standing}-й`, ord(current.standing)) : "—",
        current.champion ? L("чемпион", "champion") : L(`${int(current.stats.points)} очк. за гонки`,
          `${int(current.stats.points)} pts from races`)));
    }
    stats.append(stat(L("Победы / подиумы", "Wins / podiums"), `${int(current.stats.wins)} / ${int(current.stats.podiums)}`,
      `${current.starts} ${plural(current.starts, "гонка", "гонки", "гонок", "race")}`));
    box.append(stats);
    const precision = precisionText(current);
    if (precision) box.append(el("p", "hint", precision));
    const gn = gNodes.get(id);
    if (gn) {
      box.append(el("p", "hint", L(
        `Надёжность сравнения с остальными пилотами: ${reliabilityText(gn)} · ` +
        `напарников ${gn.teammates}` + (gn.bridge_cut ? ` · «мост»: без него от сети отрываются пилотов — ${gn.bridge_cut}` : ""),
        `Reliability of comparison with other drivers: ${reliabilityText(gn)} · teammates ${gn.teammates}` +
        (gn.bridge_cut ? ` · “bridge”: without them ${gn.bridge_cut} drivers split off the network` : ""))));
    }

    box.append(compareBlock(id, current, other));
    if (!isPeriod) roundsBlock(box, state.scope, id, other);

    const groups = GROUPS.filter((g) => isPeriod || g.id !== "career");
    box.append(el("h3", null, L("Профиль по группам", "Profile by group")));
    const radarBox = el("div", "chart radar");
    radarBox.setAttribute("role", "img");
    const radarText = (e) => groups.map((g) => `${g.name} ${int(e.s[g.id])}`).join(", ");
    radarBox.setAttribute("aria-label", `${L("Баллы по группам", "Group scores")}: ${radarText(current)}` +
      (other ? `. ${name(other.id)}: ${radarText(other)}` : ""));
    box.append(radarBox);
    drawRadar(radarBox, groups, current, other);

    box.append(featureList(groups, current));

    const historyOf = (who) => SEASON_KEYS.slice().reverse()
      .map((key) => ({ season: Number(key), e: computeScope(key).byId.get(who) }))
      .filter((h) => h.e);
    const history = historyOf(id);
    if (history.length) {
      box.append(el("h3", null, L("По сезонам", "By season")));
      const trendBox = el("div", "chart");
      trendBox.setAttribute("role", "img");
      trendBox.setAttribute("aria-label", L("Рейтинг по сезонам; значения — в таблице ниже",
        "Rating by season; values in the table below"));
      box.append(trendBox);
      drawTrend(trendBox, history, other ? { id: other.id, history: historyOf(other.id) } : null);
      box.append(historyTable(history));
    }

    const conditions = conditionsBlock(id, current);
    if (conditions) box.append(conditions);

    const tmSeason = isPeriod ? history[history.length - 1] : history.find((h) => String(h.season) === state.scope);
    if (tmSeason && tmSeason.e.tm) box.append(teammateBlock(tmSeason));
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
    box.append(el("h3", null, L("Дождь и трассы", "Rain and tracks")));
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
    img.width = 72;
    img.height = 90;
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
    const box = el("div", "compare");
    box.append(el("h3", null, L("Сравнение", "Comparison")));
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
            graphState.from = a.id;
            graphState.to = b.id;
            updateGraph();
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
    const block = el("div");
    block.append(el("h3", null, L(`Против напарника, ${season}`, `Vs teammate, ${season}`)));
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
    const box = el("div", "rounds");
    parent.append(box);
    box.append(el("h3", null, L(`По ходу сезона ${key}`, `Through the ${key} season`)));
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
      textStyle: { fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif' },
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
      textStyle: { fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif' },
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
      textStyle: { fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif' },
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

  function mix(hexA, hexB, t) {
    const parse = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
    const [a, b] = [parse(hexA), parse(hexB)];
    const k = Math.max(0, Math.min(1, t));
    return `rgb(${a.map((v, i) => Math.round(v + (b[i] - v) * k)).join(",")})`;
  }

  function drawGraph() {
    const node = $("#graph");
    if (!node) return;
    if (!window.echarts) {
      node.replaceWith(el("p", "empty", L("Граф не загрузился (нет доступа к ECharts) — путь и напарники ниже.",
        "The graph did not load (no access to ECharts) — the path and teammates are below.")));
      return;
    }
    const c = palette();
    const low = cssVar("--ramp-low");
    const high = cssVar("--ramp-high");
    const accent = cssVar("--series-2");
    const sel = graphState.from;
    const focus = Boolean($("#graph-focus").checked && sel);
    const path = strongestPath(graphState.from, graphState.to) || [];
    const pathEdges = new Set(path.map((s) => edgeKey(s.edge)));
    const pathNodes = new Set([graphState.from, graphState.to, ...path.map((s) => s.to)]);
    const near = new Set([sel, ...(gAdj.get(sel) || []).map((x) => x.to), ...pathNodes]);
    const ratings = GRAPH.nodes.map((n) => n.rating ?? 50);
    const rMin = Math.min(...ratings);
    const rMax = Math.max(...ratings);
    const data = GRAPH.nodes.map((n) => {
      const inPath = pathNodes.has(n.id);
      const strong = inPath || n.id === sel;
      const shown = !focus || near.has(n.id);
      return {
        id: n.id,
        name: drivers[n.id] ? drivers[n.id].code || n.id : n.id,
        x: n.x * 1000,
        y: n.y * 700,
        symbolSize: n.size + (n.id === sel ? 6 : 0),
        itemStyle: {
          color: mix(low, high, ((n.rating ?? 50) - rMin) / (rMax - rMin || 1)),
          borderColor: inPath ? accent : n.bridge_cut ? c.text1 : c.surface,
          borderWidth: inPath ? 3 : n.bridge_cut ? 2 : 1,
          opacity: shown ? 1 : 0.25,
        },
        label: {
          show: true, position: "right", fontSize: 11, opacity: shown ? 1 : 0.35,
          color: strong ? c.text1 : c.text2, fontWeight: strong ? 600 : 400,
        },
      };
    });
    const links = GRAPH.edges.map((e) => {
      const onPath = pathEdges.has(edgeKey(e));
      const incident = e.a === sel || e.b === sel;
      const faded = focus && !incident && !onPath;
      return {
        source: e.a,
        target: e.b,
        edge: e,
        lineStyle: {
          color: onPath ? accent : focus && incident ? c.text2 : c.axis,
          width: onPath ? 4 : 0.6 + 1.1 * Math.log1p(e.races / 4),
          opacity: onPath ? 1 : faded ? 0.08 : e.weak ? 0.35 : 0.9,
        },
      };
    });
    const view = graphView();
    if (!graphChart) {
      graphChart = window.echarts.init(node, null, { renderer: "svg" });
      graphChart.on("click", (p) => { if (p.dataType === "node") selectDriver(p.data.id, { scroll: false }); });
    }
    graphChart.setOption({
      animation: false,
      textStyle: { fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif' },
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
        type: "graph", layout: "none", roam: true, data, links,
        zoom: view.zoom || 1,
        ...(view.center ? { center: view.center } : {}),
        emphasis: { focus: "adjacency", lineStyle: { width: 3 } },
        labelLayout: { hideOverlap: false },
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
    if (!graphChart) return;
    const xs = GRAPH.nodes.map((n) => n.x * 1000);
    const ys = GRAPH.nodes.map((n) => n.y * 700);
    const center = [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2];
    graphChart.setOption({ series: [{ zoom: 1, center }] });
  }

  function centerGraph() {
    const n = gNodes.get(graphState.from);
    if (!graphChart || !n) return;
    graphChart.setOption({ series: [{ center: [n.x * 1000, n.y * 700], zoom: Math.max(graphView().zoom || 1, 2.2) }] });
  }

  function renderGraphDriver() {
    const box = $("#graph-driver");
    box.replaceChildren();
    const id = graphState.from;
    const n = gNodes.get(id);
    if (!n) return;
    const period = computeScope(PERIOD).byId.get(id);
    box.append(el("h3", null, name(id)));
    if (period) {
      const band = period.band ? L(` (вилка ${int(period.band[0])}–${int(period.band[1])})`,
        ` (range ${int(period.band[0])}–${int(period.band[1])})`) : "";
      const placeBand = period.rankBand && period.rankBand[0] !== period.rankBand[1]
        ? ` (${period.rankBand[0]}–${period.rankBand[1]})` : "";
      const years = `${meta.period[0]}–${meta.period[1]}`;
      box.append(el("p", null, `${L("Рейтинг", "Rating")} ${int(period.score)}${band}` +
        (period.rankNow ? L(`, ${period.rankNow}-е место${placeBand} за ${years}`, `, ${ord(period.rankNow)}${placeBand} in ${years}`) : "") +
        L(` · титулов ${(period.titles || []).length}, побед ${int(period.stats.wins)}, гонок ${period.starts}`,
          ` · titles ${(period.titles || []).length}, wins ${int(period.stats.wins)}, races ${period.starts}`)));
    }
    box.append(el("p", null, L(`Напарников ${n.teammates}, гонок с ними ${n.races_with_mates} · надёжность сравнения: `,
      `Teammates ${n.teammates}, races with them ${n.races_with_mates} · comparison reliability: `) + reliabilityText(n)));
    if (n.bridge_cut) {
      box.append(el("p", null, L(`«Мост»: без него от сети отрываются пилотов — ${n.bridge_cut}.`,
        `“Bridge”: without them ${n.bridge_cut} drivers split off the network.`)));
    }
    const button = el("button", null, L("Открыть полную карточку ↑", "Open the full card ↑"));
    button.type = "button";
    button.addEventListener("click", () => $("#driver").scrollIntoView({ behavior: "smooth", block: "start" }));
    box.append(button);
  }

  function renderPath() {
    const list = $("#graph-path");
    list.replaceChildren();
    const summary = $("#graph-summary");
    const { from, to } = graphState;
    if (!from || !to || from === to) {
      summary.textContent = L("Выберите двух разных пилотов.", "Pick two different drivers.");
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
    $("#graph-mates-title").textContent = who ? L(`Напарники: ${name(who)}`, `Teammates: ${name(who)}`) : L("Напарники", "Teammates");
    const table = $("#graph-mates");
    table.replaceChildren();
    if (!who) return;
    const head = el("tr");
    for (const [title, cls] of [[L("Напарник", "Teammate"), ""], [L("Сезоны", "Seasons"), ""], [L("Гонок", "Races"), "num"],
      [L("Квала", "Quali"), "num"], [L("Гонки", "Races ahead"), "num"], [L("Темп", "Pace"), ""]]) {
      const th = el("th", cls, title);
      th.scope = "col";
      head.append(th);
    }
    const thead = el("thead");
    thead.append(head);
    const tbody = el("tbody");
    for (const { to, edge } of (gAdj.get(who) || []).slice().sort((x, y) => y.edge.races - x.edge.races)) {
      const o = oriented(edge, who);
      const tr = el("tr");
      const mate = el("td", null, name(to));
      if (edge.weak) mate.append(el("span", "badge", L("слабая связь", "weak link")));
      tr.append(mate, el("td", null, edge.seasons.join(", ")), el("td", "num", String(edge.races)),
        el("td", "num", o.quali ? `${o.quali[0]}:${o.quali[1]}` : "—"),
        el("td", "num", o.race ? `${o.race[0]}:${o.race[1]}` : "—"),
        el("td", null, o.pace == null ? "—" : Math.abs(o.pace) < 0.005 ? L("равный", "equal")
          : L(`${o.pace < 0 ? "быстрее" : "медленнее"} на ${num(Math.abs(o.pace), 2)}%`,
            `${o.pace < 0 ? "faster" : "slower"} by ${num(Math.abs(o.pace), 2)}%`)));
      tbody.append(tr);
    }
    table.append(thead, tbody);
  }

  function updateGraph() {
    $("#graph-from").value = graphState.from;
    $("#graph-to").value = graphState.to;
    drawGraph();
    renderGraphDriver();
    renderPath();
    renderMates();
  }

  function syncGraph(id) {
    if (!graphState.ready || !gNodes.has(id)) return;
    graphState.from = id;
    if (graphState.to === id) {
      const top = GRAPH.nodes.filter((n) => n.rank && n.id !== id).sort((a, b) => a.rank - b.rank)[0];
      graphState.to = top ? top.id : graphState.to;
    }
    updateGraph();
  }

  function initGraph() {
    if (!GRAPH) {
      $("#graph-card").hidden = true;
      return;
    }
    const s = GRAPH.stats;
    $("#graph-title").textContent = L(`Граф напарников ${meta.period[0]}–${meta.period[1]}`,
      `Teammate graph ${meta.period[0]}–${meta.period[1]}`);
    const isolated = s.isolated || [];
    const groupsText = isolated.map((g) => g.map(surname).join(L(" и ", " and "))).join("; ");
    const network = isolated.length
      ? L(`${s.drivers} пилотов, ${s.pairs} пар напарников; ` +
        `${isolated.length} ${plural(isolated.length, "отдельная группа", "отдельные группы", "отдельных групп")} без общих ` +
        `напарников с остальными — внизу графа (${groupsText}). `,
        `${s.drivers} drivers, ${s.pairs} teammate pairs; ${isolated.length} separate ` +
        `${plural(isolated.length, "", "", "", "group")} with no teammates shared with the rest — at the bottom (${groupsText}). `)
      : L(`${s.drivers} пилотов, ${s.pairs} пар напарников, одна сеть. `,
        `${s.drivers} drivers, ${s.pairs} teammate pairs, one network. `);
    $("#graph-hint").textContent = network + L("Выберите двух пилотов или нажмите на узел.", "Pick two drivers or click a node.");
    const legend = $("#graph-legend");
    const ramp = el("span", "legend-ramp");
    const ratings = GRAPH.nodes.map((n) => n.rating ?? 50);
    ramp.append(el("span", null, `${L("рейтинг", "rating")} ${Math.round(Math.min(...ratings))}`), el("span", "bar"),
      el("span", null, String(Math.round(Math.max(...ratings)))));
    legend.append(ramp);
    const legendTexts = EN
      ? ["node size — number of races", "line width — races together",
        `faint line — weak link (up to ${s.weak_races} races)`, "dark outline — “bridge”: without them the network splits",
        "orange — the strongest comparison path"]
      : ["размер узла — число гонок", "толщина линии — гонок вместе",
        `бледная линия — слабая связь (до ${s.weak_races} гонок)`, "тёмная обводка — «мост»: без него сеть распадается",
        "оранжевым — самый сильный путь сравнения"];
    for (const text of legendTexts) legend.append(el("span", null, text));

    const ids = GRAPH.nodes.map((n) => n.id).sort((a, b) => name(a).localeCompare(name(b), LOCALE));
    for (const select of [$("#graph-from"), $("#graph-to")]) {
      for (const id of ids) {
        const option = el("option", null, name(id));
        option.value = id;
        select.append(option);
      }
    }
    const byRank = GRAPH.nodes.filter((n) => n.rank).sort((a, b) => a.rank - b.rank);
    graphState.from = gNodes.has(state.driver) ? state.driver : byRank[0].id;
    graphState.to = byRank[0].id === graphState.from ? byRank[1].id : byRank[0].id;
    $("#graph-from").addEventListener("change", (event) => selectDriver(event.target.value, { scroll: false }));
    $("#graph-to").addEventListener("change", (event) => { graphState.to = event.target.value; updateGraph(); });
    $("#graph-focus").addEventListener("change", drawGraph);
    $("#graph-zoom-in").addEventListener("click", () => zoomGraph(1.4));
    $("#graph-zoom-out").addEventListener("click", () => zoomGraph(1 / 1.4));
    $("#graph-center").addEventListener("click", centerGraph);
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
    const wPeriod = weightShares(meta.weights.period, true).share;
    const wSeason = weightShares(meta.weights.season, false).share;
    const groupRows = GROUPS.map((g) => {
      const feats = FEATURES.filter((f) => f.group === g.id).map((f) => f.name.toLowerCase()).join(", ");
      const ws = g.id === "career" ? `${wPeriod("career")} ${L("(только сводка)", "(all seasons only)")}`
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
        <li><strong>Мало гонок — меньше доверия.</strong> Доли и средние сжимаются к среднему по пулу так,
          будто к реальным гонкам добавили ${meta.shrink_races} гонок среднего пилота.</li>
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
          из модели напарников, сглаженный по соседним этапам (машина не меняется скачками). Половину — потому что
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
        <li><strong>Карьера</strong> — только в общей сводке: качество и долговечность. Среднее за период само по себе
          наказывает длинную карьеру — годы в слабых машинах и возраст тянут его вниз, а молодой пилот в топ-машине
          их не знает. Поэтому сезоны в F1, титулы и сезоны впереди напарника в итоговой таблице чемпионата
          считаются с дебюта, по F1DB (вся история с 1950 года): у пилотов, начавших раньше ${meta.period[0]} года,
          учитываются и прежние сезоны. Неполный сезон идёт долей гонок; напарник — тот, у кого больше всего
          стартов за ту же команду, сезон в счёт, если оба провели за неё хотя бы треть гонок. Запас над средним —
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
        <li><strong>Few races, less trust.</strong> Shares and averages are shrunk towards the pool average as if
          ${meta.shrink_races} races of an average driver were added.</li>
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
          smoothed over neighbouring rounds. Half — because the model knows the gap between teammates well but the
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
        <li><strong>Career</strong> — all-season summary only: quality and longevity. A period average punishes a long
          career by itself: years in weak cars and age drag it down, which a young driver in a top car never sees. So
          seasons in F1, titles and seasons ahead of the teammate in the final standings count from the debut, using
          F1DB (the whole history since 1950): drivers who started before ${p0} get their earlier seasons too. A partial
          season counts as a share of races; the teammate is the one with the most starts for the same team, and a
          season counts if both did at least a third of its races. The margin above average is the sum over our seasons
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
    else $("#weights-summary").textContent = weightShares(weightsFor(state.scope === PERIOD), state.scope === PERIOD).summary;
    for (const button of document.querySelectorAll("#presets button")) button.setAttribute("aria-pressed", "false");
    if (!state.custom) {
      const index = PRESETS.findIndex((p) => p.id === state.preset);
      const button = document.querySelectorAll("#presets button")[index];
      if (button) button.setAttribute("aria-pressed", "true");
    }
    renderTable();
    renderDriver();
  }

  function render() {
    // «Все времена»: своя таблица вместо весов, основной таблицы и карточки (у модели свои веса).
    const ever = state.scope === EVER_KEY;
    $("#alltime").hidden = !ever;
    $("#main-layout").hidden = ever;
    $("#weights").hidden = ever;
    $("#show-all-field").hidden = ever;
    if (ever) {
      $("#scope").value = EVER_KEY;
      renderAlltime();
      writeHash();
      return;
    }
    if (!state.driver || !scopes[state.scope].some((e) => e.id === state.driver)) {
      const first = computeScope(state.scope).entries.filter((e) => e.eligible).sort((a, b) => b.score - a.score)[0];
      state.driver = first ? first.id : null;
      state.compare = null;
    }
    if (state.compare && (state.compare === state.driver || !scopes[state.scope].some((e) => e.id === state.compare))) {
      state.compare = null;
    }
    $("#scope").value = state.scope;
    renderScopeNote();
    renderAll();
    writeHash();
    syncGraph(state.driver);
  }

  // ---------- все времена (1950+): упрощённая модель на F1DB ----------
  // Страна по-английски — из идентификатора F1DB: «united-kingdom» → «United Kingdom».
  const EVER_COUNTRY_EN = { "united-states-of-america": "USA", "united-kingdom": "UK" };
  const everCountry = (id) => (!id ? null : EVER_COUNTRY_EN[id]
    || id.split("-").map((w) => w[0].toUpperCase() + w.slice(1)).join(" "));

  function renderAlltime() {
    const card = $("#alltime");
    if (!EVER.drivers || !EVER.drivers.length) { card.hidden = true; return; }
    $("#alltime-title").textContent = L(`Все времена ${EVER.period[0]}–${EVER.period[1]}`, `All time ${EVER.period[0]}–${EVER.period[1]}`);
    $("#alltime-hint").textContent = L(`Упрощённая модель: результаты, квалификация, сеть напарников и карьера — ` +
      `то, что есть для всех эпох. Пилоты от ${EVER.pool} гонок; подробности — в «Как это посчитано».`,
      "A simplified model: results, qualifying, the teammate network and career — what exists for every era. " +
      `Drivers with ${EVER.pool}+ races; details in “How it is calculated”.`);
    const groupName = (g) => (EN && GROUP_EN[g.id] ? GROUP_EN[g.id][0] : g.name);
    const cols = [
      ["rating", L("Рейтинг", "Rating"), (d) => d.rating, "rating-col"],
      ...EVER.groups.map((g) => [`g:${g.id}`, SHORT[g.id] || groupName(g), (d) => d.s[g.id], "num col-group", groupName(g)]),
      ["titles", L("Титулы", "Titles"), (d) => d.titles.length, "num col-stat"],
      ["wins", L("Победы", "Wins"), (d) => d.wins, "num col-stat"],
      ["starts", L("Гонок", "Races"), (d) => d.starts, "num col-stat col-extra"],
    ];
    const value = Object.fromEntries(cols.map(([id, , fn]) => [id, fn]));
    const tops = {};
    for (const g of EVER.groups) tops[g.id] = EVER.drivers.map((d) => d.s[g.id]).sort((a, b) => b - a)[2];

    const head = $("#alltime-head");
    head.replaceChildren(el("th", "num", L("Место", "Place")), el("th", null, L("Пилот", "Driver")));
    for (const [id, label, , cls, title] of cols) {
      const th = el("th", cls);
      if (title) th.title = title;
      const button = el("button", null, label);
      button.type = "button";
      if (everState.sort === id) button.setAttribute("aria-sort", "descending");
      button.addEventListener("click", () => { everState.sort = id; renderAlltime(); });
      th.append(button);
      head.append(th);
    }
    const rows = EVER.drivers.slice().sort((a, b) => value[everState.sort](b) - value[everState.sort](a) || a.rank - b.rank);
    const shown = everState.expanded ? rows : rows.slice(0, EVER_TOP);
    const tbody = $("#alltime-table tbody");
    tbody.replaceChildren();
    for (const d of shown) {
      const tr = el("tr");
      if (everState.open === d.id) tr.classList.add("selected");
      tr.append(el("td", "num rank", String(d.rank)));
      const who = el("td");
      const name = el("span", "name-btn", d.name);
      if (d.code) name.append(el("span", "code", d.code));
      const land = EN ? everCountry(d.country_id) : d.country;
      who.append(name, el("span", "sub", `${d.years[0]}–${d.years[1]}` + (land ? ` · ${land}` : "")));
      tr.append(who);
      const ratingCell = el("td", "rating-col");
      const wrap = el("div", "rating");
      wrap.append(meter(d.rating, L(`Рейтинг ${Math.round(d.rating)} из 100`, `Rating ${Math.round(d.rating)} of 100`)),
        el("div", "value", int(d.rating)));
      ratingCell.append(wrap);
      tr.append(ratingCell);
      for (const g of EVER.groups) {
        tr.append(el("td", `num col-group group${d.s[g.id] >= tops[g.id] ? " top" : ""}`, int(d.s[g.id])));
      }
      tr.append(el("td", "num col-stat", String(d.titles.length)), el("td", "num col-stat", String(d.wins)),
        el("td", "num col-stat col-extra", String(d.starts)));
      tr.addEventListener("click", () => {
        everState.open = everState.open === d.id ? null : d.id;
        renderAlltime();
        writeHash();
      });
      tbody.append(tr);
      if (everState.open === d.id) {
        const detail = el("tr", "alltime-detail");
        const cell = el("td");
        cell.colSpan = 2 + cols.length;
        const best = d.best.map(([year, rating, rank]) => `${year} — ${int(rating)} (${L(`${rank}-е место`, ord(rank))})`).join(", ");
        cell.append(
          el("p", null, L(`Лучшие сезоны: ${best || "—"}.`, `Best seasons: ${best || "—"}.`)),
          el("p", null, L(`С дебюта: ${num(d.seasons, 1)} сезона в F1, впереди напарника в чемпионате — в ${d.ahead} ` +
            `из ${d.compared}` + (d.titles.length ? `, титулы — ${d.titles.join(", ")}` : ", титулов нет") +
            `. Победы / подиумы / поулы: ${d.wins} / ${d.podiums} / ${d.poles}, гонок ${d.starts}.`,
            `Since the debut: ${num(d.seasons, 1)} seasons in F1, ahead of the teammate in the championship in ${d.ahead} ` +
            `of ${d.compared}` + (d.titles.length ? `, titles — ${d.titles.join(", ")}` : ", no titles") +
            `. Wins / podiums / poles: ${d.wins} / ${d.podiums} / ${d.poles}, races ${d.starts}.`)));
        if (d.card && drivers[d.card]) {
          const open = el("button", "link-btn", L(`Полная карточка за ${meta.period[0]}–${meta.period[1]} ↑`,
            `Full card for ${meta.period[0]}–${meta.period[1]} ↑`));
          open.type = "button";
          open.addEventListener("click", () => {
            state.scope = PERIOD;
            state.compare = null;
            state.driver = d.card;
            render();
            $("#driver").scrollIntoView({ behavior: "smooth", block: "start" });
          });
          cell.append(open);
        }
        detail.append(cell);
        tbody.append(detail);
      }
    }
    const more = $("#alltime-more");
    more.replaceChildren();
    if (rows.length > EVER_TOP) {
      const button = el("button", null, everState.expanded ? L("Свернуть", "Collapse")
        : L(`Показать всех (${rows.length})`, `Show all (${rows.length})`));
      button.type = "button";
      button.addEventListener("click", () => { everState.expanded = !everState.expanded; renderAlltime(); });
      more.append(button);
    }
  }

  readHash();
  renderHeader();
  renderMethod();
  render();
  initGraph();

  window.addEventListener("resize", () => {
    charts.forEach((c) => c.resize());
    if (graphChart) graphChart.resize();
  });
  DARK.addEventListener("change", () => {
    renderDriver();
    if (graphState.ready) drawGraph();
  });
})();
