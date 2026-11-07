/* Рейтинг пилотов F1 — витрина.
 * Данные: window.F1_DATA из data/data.js (генерирует python -m rating_f1.pipeline).
 * В адресе хранится охват и пилот: #all/max_verstappen, #2026/antonelli
 */
(function () {
  "use strict";

  const DATA = window.F1_DATA;
  const $ = (selector) => document.querySelector(selector);

  if (!DATA || !DATA.scopes) {
    $("#subtitle").textContent = "Нет данных: запустите python -m rating_f1.pipeline";
    return;
  }

  const { meta, drivers, scopes } = DATA;
  const PERIOD = "all";
  const GROUPS = meta.groups;
  const FEATURES = meta.features;
  const MINUS = "−";
  const SINGLE_COLUMN = window.matchMedia("(max-width: 1179px)");
  const DARK = window.matchMedia("(prefers-color-scheme: dark)");
  const SEASON_KEYS = meta.scopes.filter((k) => k !== PERIOD);

  // ---------- форматирование ----------
  const num = (x, digits) => x.toFixed(digits).replace(".", ",");
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
    new Date(`${iso}T12:00:00`).toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" });
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
  const country = (nationality) => COUNTRIES[nationality] || nationality;

  function fmtFeature(unit, v) {
    if (v == null) return "—";
    switch (unit) {
      case "pct": return pct(v);
      case "gap": return `${num(v, 2)}%`;
      case "signedgap": return `${signed(v, 2)}%`;
      case "pos": case "num1": return num(v, 1);
      case "signed1": return signed(v, 1);
      case "sec": return `${signed(v, 2)} с`;
      default: return int(v);
    }
  }

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function plural(n, one, few, many) {
    const m10 = n % 10;
    const m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return one;
    if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
    return many;
  }

  function meter(score, label) {
    const box = el("div", "meter");
    box.setAttribute("role", "img");
    box.setAttribute("aria-label", label);
    const fill = el("div", "fill");
    fill.style.width = `${Math.max(0, Math.min(100, score))}%`;
    box.append(fill, el("div", "mid"));
    return box;
  }

  // ---------- веса и пересчёт ----------
  const ZERO = { results: 0, above_car: 0, quali: 0, pace: 0, racecraft: 0, clean: 0, teammate: 0, career: 0 };
  const PRESETS = [
    { id: "default", name: "Сбалансированный" },
    { id: "results", name: "Важнее результаты",
      w: { results: 40, above_car: 15, quali: 10, pace: 10, racecraft: 5, clean: 5, teammate: 10, career: 5 } },
    { id: "skill", name: "Чистое мастерство",
      w: { results: 5, above_car: 20, quali: 15, pace: 15, racecraft: 10, clean: 5, teammate: 30, career: 0 } },
    { id: "only", name: "Только результаты", w: { ...ZERO, results: 100 } },
  ];

  const TOP_N = 15;  // столько строк показывать в свёрнутой таблице
  const state = {
    scope: PERIOD, showAll: false, driver: null, sort: "score", preset: "default", custom: null, expanded: false,
  };

  function weightsFor(isPeriod) {
    if (state.custom) return state.custom;
    const preset = PRESETS.find((p) => p.id === state.preset);
    if (preset && preset.w) return preset.w;
    const base = isPeriod ? meta.weights.period : meta.weights.season;
    return Object.fromEntries(Object.entries(base).map(([k, v]) => [k, Math.round(100 * v)]));
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
    const result = { entries, byId: new Map(entries.map((e) => [e.id, e])) };
    cache.set(cacheKey, result);
    return result;
  }

  // ---------- состояние в адресе ----------
  function readHash() {
    const [scope, driver] = decodeURIComponent(location.hash.replace(/^#/, "")).split("/");
    if (scopes[scope]) state.scope = scope;
    if (driver && drivers[driver]) state.driver = driver;
  }

  function writeHash() {
    const hash = `#${state.scope}${state.driver ? `/${state.driver}` : ""}`;
    if (location.hash !== hash) history.replaceState(null, "", hash);
  }

  // ---------- шапка, фильтры, веса ----------
  function scopeLabel(key) {
    return key === PERIOD ? `Все сезоны ${meta.period[0]}–${meta.period[1]}` : `Сезон ${key}`;
  }

  function renderHeader() {
    const through = meta.data_through;
    $("#subtitle").textContent =
      `Общая сводка ${meta.period[0]}–${meta.period[1]} и отдельные сезоны · ` +
      `данные по ${through.race_name} ${through.season} (${dateRu(through.date)})`;
    const select = $("#scope");
    for (const key of meta.scopes) {
      const option = el("option", null, scopeLabel(key));
      option.value = key;
      select.append(option);
    }
    select.addEventListener("change", () => {
      state.scope = select.value;
      if (!scopes[state.scope].some((e) => e.id === state.driver)) state.driver = null;
      render();
    });
    $("#show-all").addEventListener("change", (event) => {
      state.showAll = event.target.checked;
      renderTable();
      renderScopeNote();
    });
    $("#footer").textContent =
      `Данные: Jolpica F1 API и F1DB (CC BY 4.0). По состоянию на ${through.race_name} ${through.season}. ` +
      `Сгенерировано ${new Date(meta.generated_at).toLocaleString("ru-RU")}.`;
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
    for (const group of GROUPS) {
      const disabled = !isPeriod && group.id === "career";
      const box = el("div", `slider${disabled ? " disabled" : ""}`);
      const id = `w-${group.id}`;
      const label = el("label", null, group.name);
      label.htmlFor = id;
      label.title = group.about;
      const output = el("output", null, disabled ? "только для сводки" : `${w[group.id] || 0}%`);
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
        output.textContent = `${input.value}%`;
        renderAll(false);
      });
      box.append(label, output, input);
      sliders.append(box);
    }
    const parts = GROUPS.filter((g) => isPeriod || g.id !== "career").map((g) => `${g.name} ${w[g.id] || 0}`);
    $("#weights-summary").textContent = parts.join(" · ");
  }

  function renderScopeNote() {
    const isPeriod = state.scope === PERIOD;
    $("#ranking-title").textContent = isPeriod ? `Общий рейтинг ${meta.period[0]}–${meta.period[1]}` : `Сезон ${state.scope}`;
    $("#ranking-hint").textContent =
      "Рейтинг 0–100: 50 — средний пилот, +15 за каждое стандартное отклонение. " +
      "Колонки групп — баллы по той же шкале. Нажмите на заголовок, чтобы отсортировать, или на пилота — чтобы открыть карточку.";
    const notes = [];
    if (!isPeriod) {
      const races = meta.season_races[state.scope];
      if (races && races.completed < races.scheduled) {
        notes.push(`Сезон ещё идёт: учтено ${races.completed} из ${races.scheduled} гонок.`);
      }
    }
    const min = isPeriod ? meta.min_starts.period : meta.min_starts.season;
    $("#min-starts").textContent = min;
    const hidden = scopes[state.scope].filter((e) => !e.eligible).length;
    if (!state.showAll && hidden) notes.push(`Скрыто пилотов, у которых меньше ${min} гонок: ${hidden}.`);
    $("#scope-note").textContent = notes.join(" ");
  }

  // ---------- таблица ----------
  const SHORT = {
    results: "Результ.", above_car: "Над маш.", quali: "Квала", pace: "Темп", racecraft: "Борьба",
    clean: "Надёжн.", teammate: "Напарник", career: "Карьера",
  };

  function columns() {
    const isPeriod = state.scope === PERIOD;
    const groups = GROUPS.filter((g) => isPeriod || g.id !== "career");
    // [id, заголовок, значение, css-класс]: второстепенные колонки прячутся на узких экранах
    const first = isPeriod
      ? ["titles", "Титулы", (e) => (e.titles || []).length, "col-stat"]
      : ["standing", "ЧМ", (e) => e.standing, "col-stat"];
    const stats = [
      first,
      ["wins", "Победы", (e) => e.stats.wins, "col-stat"],
      ["podiums", "Подиумы", (e) => e.stats.podiums, "col-stat col-extra"],
      ["poles", "Поулы", (e) => e.stats.poles, "col-stat col-extra"],
      ["starts", "Гонок", (e) => e.starts, "col-stat col-extra"],
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
    head.append(headCell("Место", null, "num"), headCell("Пилот"), headCell("Рейтинг", "score", "rating-col"));
    for (const g of groups) head.append(headCell(SHORT[g.id] || g.name, `g:${g.id}`, "num col-group", `${g.name}: ${g.about}`));
    for (const [id, label, , cls] of stats) {
      head.append(headCell(label, id, `num ${cls}`, id === "standing" ? "Место в чемпионате" : null));
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
      const teams = e.teams.join(" → ") + (e.eligible ? "" : ` · ${e.starts} ${plural(e.starts, "гонка", "гонки", "гонок")}`);
      who.append(button, el("span", "sub", teams));

      const ratingCell = el("td", "rating-col");
      const wrap = el("div", "rating");
      wrap.append(meter(e.score, `Рейтинг ${Math.round(e.score)} из 100`), el("div", "value", int(e.score)));
      ratingCell.append(wrap);
      tr.append(el("td", "num", e.rankNow ?? "—"), who, ratingCell);
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
        ? `Свернуть до топ-${TOP_N}`
        : `Показать всех: ${rows.length} ${plural(rows.length, "пилот", "пилота", "пилотов")}`);
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
    s1: cssVar("--series-1"), text1: cssVar("--text-1"), text2: cssVar("--text-2"), muted: cssVar("--muted"),
    grid: cssVar("--grid"), axis: cssVar("--axis"), surface: cssVar("--surface"), border: cssVar("--border"),
  });

  function stat(label, big, sub) {
    const box = el("div", "stat");
    box.append(el("div", "label", label), el("div", "big", big), el("span", "sub", sub));
    return box;
  }

  function renderDriver() {
    const box = $("#driver");
    box.replaceChildren();
    disposeCharts();
    const id = state.driver;
    const driver = drivers[id];
    const current = computeScope(state.scope).byId.get(id);
    if (!driver) {
      box.append(el("p", "empty", "Выберите пилота в таблице."));
      return;
    }
    if (!current) {
      box.append(el("h2", null, driver.name),
        el("p", "empty", `В сезоне ${state.scope} пилот не выступал. Выберите «Все сезоны» в поле «Охват», ` +
          "чтобы открыть его полную карточку."));
      return;
    }
    const isPeriod = state.scope === PERIOD;
    const period = computeScope(PERIOD).byId.get(id);

    box.append(el("h2", null, driver.name));
    const facts = [country(driver.nationality)];
    if (driver.dob) facts.push(`родился ${dateRu(driver.dob)}`);
    if (driver.debut) facts.push(`дебют в F1 — ${driver.debut}`);
    if (period) facts.push((period.teams || []).join(", "));
    box.append(el("p", "meta", facts.join(" · ")));

    const stats = el("div", "stats");
    const where = isPeriod ? "за все сезоны" : `в сезоне ${state.scope}`;
    stats.append(stat("Рейтинг", int(current.score), current.rankNow ? `${current.rankNow}-е место ${where}` : "мало гонок для места"));
    if (isPeriod) {
      const titles = current.titles || [];
      stats.append(stat("Титулы", String(titles.length), titles.length ? titles.join(", ") : "—"));
    } else {
      stats.append(stat("Чемпионат", current.standing ? `${current.standing}-й` : "—", current.champion ? "чемпион" : `${int(current.stats.points)} очк. за гонки`));
    }
    stats.append(stat("Победы / подиумы", `${int(current.stats.wins)} / ${int(current.stats.podiums)}`,
      `${current.starts} ${plural(current.starts, "гонка", "гонки", "гонок")}`));
    box.append(stats);
    const gn = gNodes.get(id);
    if (gn) {
      box.append(el("p", "hint",
        `Надёжность сравнения с остальными пилотами: ${reliabilityLabel(gn.reliability)} (${int(gn.reliability)} из 100) · ` +
        `напарников ${gn.teammates}` + (gn.bridge_cut ? ` · «мост»: без него от сети отрываются пилотов — ${gn.bridge_cut}` : "")));
    }

    const groups = GROUPS.filter((g) => isPeriod || g.id !== "career");
    box.append(el("h3", null, "Профиль по группам"));
    const radarBox = el("div", "chart radar");
    radarBox.setAttribute("role", "img");
    radarBox.setAttribute("aria-label", `Баллы по группам: ${groups.map((g) => `${g.name} ${int(current.s[g.id])}`).join(", ")}`);
    box.append(radarBox);
    drawRadar(radarBox, groups, current);

    box.append(featureList(groups, current));

    const history = SEASON_KEYS.slice().reverse()
      .map((key) => ({ season: Number(key), e: computeScope(key).byId.get(id) }))
      .filter((h) => h.e);
    if (history.length) {
      box.append(el("h3", null, "По сезонам"));
      const trendBox = el("div", "chart");
      trendBox.setAttribute("role", "img");
      trendBox.setAttribute("aria-label", "Рейтинг по сезонам; значения — в таблице ниже");
      box.append(trendBox);
      drawTrend(trendBox, history);
      box.append(historyTable(history));
    }

    const tmSeason = isPeriod ? history[history.length - 1] : history.find((h) => String(h.season) === state.scope);
    if (tmSeason && tmSeason.e.tm) box.append(teammateBlock(tmSeason));
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
        const [value, z] = pair;
        const row = el("div", "feature");
        const score = 50 + 15 * (z ?? 0);
        row.append(el("span", "fname", f.name), el("span", "fvalue", fmtFeature(f.unit, value)),
          meter(score, `${f.name}: ${score > 50 ? "лучше" : "хуже"} среднего`));
        block.append(row);
      }
      wrap.append(block);
    }
    return wrap;
  }

  function historyTable(history) {
    const wrap = el("div", "table-wrap");
    const table = el("table", "mini");
    const head = el("tr");
    for (const [title, cls] of [["Сезон", ""], ["Место", "num"], ["Рейтинг", "num"], ["ЧМ", "num"], ["Победы", "num"], ["Подиумы", "num"]]) {
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
      tr.append(first, el("td", "num", e.rankNow ?? "—"), el("td", "num", int(e.score)),
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
    block.append(el("h3", null, `Против напарника, ${season}`));
    const mates = (e.teammates || []).map(name).join(", ") || "—";
    const lines = [
      `Напарники: ${mates}.`,
      `Шанс обыграть среднего пилота в такой же машине (квала, темп и финиш вместе): ${pct(tm.strength[0])} ` +
        `(интервал ${Math.round(100 * tm.strength[1])}–${Math.round(100 * tm.strength[2])}%).`,
      `Квала относительно среднего пилота в такой же машине: ${signed(tm.quali_s[0], 2)} с на 90-секундном круге.`,
    ];
    if (tm.pace_s) lines.push(`Темп в гонке относительно среднего пилота в такой же машине: ${signed(tm.pace_s[0], 2)} с на круге.`);
    if (tm.h2h_quali) lines.push(`Квалификации с напарником: ${tm.h2h_quali[0]}:${tm.h2h_quali[1] - tm.h2h_quali[0]}.`);
    if (tm.h2h_race) lines.push(`Гонки с напарником (кто выше на финише): ${tm.h2h_race[0]}:${tm.h2h_race[1] - tm.h2h_race[0]}.`);
    for (const line of lines) block.append(el("p", "hint", line));
    return block;
  }

  function drawRadar(node, groups, e) {
    if (!window.echarts) {
      node.replaceWith(el("p", "empty", "График не загрузился (нет доступа к ECharts) — баллы в списке ниже."));
      return;
    }
    const c = palette();
    const chart = window.echarts.init(node, null, { renderer: "svg" });
    charts.push(chart);
    chart.setOption({
      animation: false,
      textStyle: { fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif' },
      legend: { top: 0, left: 0, data: ["Пилот", "Средний пилот"], textStyle: { color: c.text2 }, itemWidth: 16, itemHeight: 8 },
      tooltip: {
        trigger: "item", backgroundColor: c.surface, borderColor: c.border, textStyle: { color: c.text1, fontSize: 13 },
        formatter: (p) => groups.map((g, i) => `${esc(g.name)}: <b>${Math.round(p.value[i])}</b>`).join("<br>"),
      },
      radar: {
        center: ["50%", "56%"], radius: "62%", splitNumber: 4,
        indicator: groups.map((g) => ({ name: SHORT[g.id] || g.name, min: 0, max: 100 })),
        axisName: { color: c.text2, fontSize: 12 },
        splitLine: { lineStyle: { color: c.grid } },
        splitArea: { show: false },
        axisLine: { lineStyle: { color: c.grid } },
      },
      series: [{
        type: "radar",
        data: [
          { name: "Средний пилот", value: groups.map(() => 50), symbol: "none",
            lineStyle: { color: c.axis, width: 1 }, itemStyle: { color: c.axis } },
          { name: "Пилот", value: groups.map((g) => Math.round(e.s[g.id] ?? 0)), symbol: "circle", symbolSize: 6,
            lineStyle: { color: c.s1, width: 2 }, itemStyle: { color: c.s1, borderColor: c.surface, borderWidth: 2 },
            areaStyle: { color: c.s1, opacity: 0.12 } },
        ],
      }],
    });
  }

  function drawTrend(node, history) {
    if (!window.echarts) {
      node.replaceWith(el("p", "empty", "График не загрузился — значения в таблице ниже."));
      return;
    }
    const c = palette();
    const years = [];
    for (let y = history[0].season; y <= history[history.length - 1].season; y += 1) years.push(y);
    const bySeason = new Map(history.map((h) => [h.season, h.e]));
    const chart = window.echarts.init(node, null, { renderer: "svg" });
    charts.push(chart);
    chart.setOption({
      animation: false,
      textStyle: { fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif' },
      grid: { left: 4, right: 12, top: 12, bottom: 4, containLabel: true },
      tooltip: {
        trigger: "axis", backgroundColor: c.surface, borderColor: c.border, textStyle: { color: c.text1, fontSize: 13 },
        axisPointer: { type: "line", lineStyle: { color: c.axis, width: 1 } },
        formatter: (params) => {
          const year = years[params[0].dataIndex];
          const e = bySeason.get(year);
          if (!e) return `${year}: не выступал`;
          return `<div style="margin-bottom:4px">${year} · ${esc(e.teams.join(" → "))}</div>` +
            `<div><b>${Math.round(e.score)}</b> <span style="color:${c.muted}">рейтинг сезона${e.rankNow ? `, ${e.rankNow}-е место` : ""}</span></div>` +
            `<div style="color:${c.muted};margin-top:4px">чемпионат ${e.standing ?? "—"} · побед ${e.stats.wins} · подиумов ${e.stats.podiums}</div>`;
        },
      },
      xAxis: { type: "category", data: years, boundaryGap: false, axisLine: { lineStyle: { color: c.axis } },
        axisTick: { show: false }, axisLabel: { color: c.muted } },
      yAxis: { type: "value", min: 0, max: 100, interval: 25, axisLabel: { color: c.muted },
        splitLine: { lineStyle: { color: c.grid, width: 1 } } },
      series: [{
        name: "Рейтинг сезона", type: "line", color: c.s1, lineStyle: { width: 2 }, symbol: "circle", symbolSize: 8,
        itemStyle: { borderColor: c.surface, borderWidth: 2 },
        data: years.map((y) => (bySeason.has(y) ? Math.round(bySeason.get(y).score) : null)),
      }],
    });
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
  const surname = (id) => (drivers[id] ? drivers[id].name.split(" ").slice(-1)[0] : id);
  const reliabilityLabel = (score) => (score >= 80 ? "высокая" : score >= 50 ? "средняя" : "низкая");

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
    const parts = [`${edge.races} ${plural(edge.races, "гонка", "гонки", "гонок")} вместе (${edge.seasons.join(", ")}, ${edge.teams.join(" → ")})`];
    if (o.quali) parts.push(`квала ${o.quali[0]}:${o.quali[1]}`);
    if (o.race) parts.push(`гонки ${o.race[0]}:${o.race[1]}`);
    if (o.pace != null) {
      parts.push(Math.abs(o.pace) < 0.005 ? "темп равный"
        : `темп: ${surname(o.pace < 0 ? who : other)} быстрее на ${num(Math.abs(o.pace), 2)}%`);
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
      node.replaceWith(el("p", "empty", "Граф не загрузился (нет доступа к ECharts) — путь и напарники ниже."));
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
              (e.strength < e.races ? "<br>подменное выступление: вес связи вполовину" : "");
          }
          const n = gNodes.get(p.data.id);
          return `<b>${esc(name(n.id))}</b> · рейтинг ${int(n.rating)}${n.rank ? `, ${n.rank}-е место` : ""}` +
            `<br>напарников ${n.teammates}, гонок с ними ${n.races_with_mates}` +
            `<br>надёжность сравнения: ${reliabilityLabel(n.reliability)} (${int(n.reliability)} из 100)` +
            (n.bridge_cut ? `<br>мост: без него от сети отрываются пилотов — ${n.bridge_cut}` : "");
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
      box.append(el("p", null, `Рейтинг ${int(period.score)}` +
        (period.rankNow ? `, ${period.rankNow}-е место за ${meta.period[0]}–${meta.period[1]}` : "") +
        ` · титулов ${(period.titles || []).length}, побед ${int(period.stats.wins)}, гонок ${period.starts}`));
    }
    box.append(el("p", null, `Напарников ${n.teammates}, гонок с ними ${n.races_with_mates} · надёжность сравнения: ` +
      `${reliabilityLabel(n.reliability)} (${int(n.reliability)} из 100)`));
    if (n.bridge_cut) box.append(el("p", null, `«Мост»: без него от сети отрываются пилотов — ${n.bridge_cut}.`));
    const button = el("button", null, "Открыть полную карточку ↑");
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
      summary.textContent = "Выберите двух разных пилотов.";
      return;
    }
    const path = strongestPath(from, to);
    if (!path) {
      summary.textContent = "Эти пилоты не связаны через напарников.";
      return;
    }
    const eq = eqRaces(from, to);
    const eqText = eq == null ? "" : ` Через все пути сети сразу это сравнение стоит примерно ${Math.round(eq)} ` +
      `${plural(Math.round(eq), "гонку", "гонки", "гонок")} прямой дуэли.`;
    summary.textContent = `${name(from)} и ${name(to)}: самый сильный путь — ${path.length} ` +
      `${plural(path.length, "звено", "звена", "звеньев")}.${eqText}`;
    for (const step of path) {
      const li = el("li");
      li.append(el("strong", null, `${surname(step.from)} → ${surname(step.to)}`),
        document.createTextNode(` · ${linkText(step.edge, step.from, step.to)}`));
      if (step.edge.weak) li.append(el("span", "badge", "слабое звено"));
      if (step.edge.strength < step.edge.races) li.append(el("span", "badge", "подмена, вес ½"));
      list.append(li);
    }
  }

  function renderMates() {
    const who = graphState.from;
    $("#graph-mates-title").textContent = who ? `Напарники: ${name(who)}` : "Напарники";
    const table = $("#graph-mates");
    table.replaceChildren();
    if (!who) return;
    const head = el("tr");
    for (const [title, cls] of [["Напарник", ""], ["Сезоны", ""], ["Гонок", "num"], ["Квала", "num"], ["Гонки", "num"], ["Темп", ""]]) {
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
      if (edge.weak) mate.append(el("span", "badge", "слабая связь"));
      tr.append(mate, el("td", null, edge.seasons.join(", ")), el("td", "num", String(edge.races)),
        el("td", "num", o.quali ? `${o.quali[0]}:${o.quali[1]}` : "—"),
        el("td", "num", o.race ? `${o.race[0]}:${o.race[1]}` : "—"),
        el("td", null, o.pace == null ? "—" : Math.abs(o.pace) < 0.005 ? "равный"
          : `${o.pace < 0 ? "быстрее" : "медленнее"} на ${num(Math.abs(o.pace), 2)}%`));
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
    $("#graph-title").textContent = `Граф напарников ${meta.period[0]}–${meta.period[1]}`;
    $("#graph-hint").textContent =
      `${s.drivers} пилотов и ${s.pairs} пар напарников связаны в одну сеть, в среднем ${num(s.mean_hops, 1)} шага между пилотами. ` +
      "Модель сравнивает пилотов через все цепочки сразу: связи с большим числом совместных гонок весят больше, " +
      `подменные выступления (до ${s.weak_races} гонок за команду в сезоне) — вполовину. ` +
      "Выберите двух пилотов или нажмите на узел.";
    const legend = $("#graph-legend");
    const ramp = el("span", "legend-ramp");
    const ratings = GRAPH.nodes.map((n) => n.rating ?? 50);
    ramp.append(el("span", null, `рейтинг ${Math.round(Math.min(...ratings))}`), el("span", "bar"),
      el("span", null, String(Math.round(Math.max(...ratings)))));
    legend.append(ramp);
    for (const text of ["размер узла — число гонок", "толщина линии — гонок вместе",
      `бледная линия — слабая связь (до ${s.weak_races} гонок)`, "тёмная обводка — «мост»: без него сеть распадается",
      "оранжевым — самый сильный путь сравнения"]) legend.append(el("span", null, text));

    const ids = GRAPH.nodes.map((n) => n.id).sort((a, b) => name(a).localeCompare(name(b), "ru"));
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
    $("#graph").setAttribute("aria-label", "Граф напарников: узлы — пилоты, линии — пары напарников. " +
      "Путь сравнения и список напарников — в тексте рядом.");
    graphState.ready = true;
    updateGraph();
  }

  // ---------- методика ----------
  function renderMethod() {
    const body = $("#method-body");
    const fmtW = (w) => `${Math.round(100 * w)}%`;
    const groupRows = GROUPS.map((g) => {
      const feats = FEATURES.filter((f) => f.group === g.id).map((f) => f.name.toLowerCase()).join(", ");
      const ws = g.id === "career" ? `${fmtW(meta.weights.period.career)} (только сводка)` :
        `${fmtW(meta.weights.period[g.id])} / ${fmtW(meta.weights.season[g.id])}`;
      return `<tr><td><strong>${esc(g.name)}</strong></td><td>${esc(feats)}</td><td class="num">${ws}</td></tr>`;
    }).join("");
    const exp = meta.expert && meta.expert.seasons ? Object.entries(meta.expert.seasons) : [];
    const expRows = exp.map(([season, r]) =>
      `<tr><td>${season}</td><td class="num">${r.overlap} из 10 (было ${r.overlap_old})</td>` +
      `<td class="num">${num(r.spearman, 2)} (было ${num(r.spearman_old, 2)})</td></tr>`).join("");
    const bt = meta.backtest;
    const q = bt && bt.quali.new_pairs;
    const r = bt && bt.race.new_pairs;
    const unclear = meta.counts.race_excluded["неясный сход"] || 0;
    const carExp = (meta.car_expectations && meta.car_expectations.points) || {};
    const expText = [1, 3, 5, 8].filter((k) => carExp[k] != null)
      .map((k) => `${k}-я машина — ${num(carExp[k], 1)}`).join(", ") + " очка за гонку";
    body.innerHTML = `
      <p><strong>Идея.</strong> Рейтинг собирает в один балл всё, что видно по протоколам: результаты,
        квалификацию, гонку, надёжность и то, насколько пилот выжимает из своей машины. Машина объясняет
        бо́льшую часть результата (по исследованиям — около 86–88%), поэтому одних результатов мало,
        но и одного сравнения с напарником тоже мало: чемпион в лучшей машине должен быть наверху.</p>
      <table class="mini"><thead><tr><th>Группа</th><th>Признаки</th><th class="num">Вес: сводка / сезон</th></tr></thead>
        <tbody>${groupRows}</tbody></table>
      <ul>
        <li><strong>Шкала.</strong> Каждый признак переводится в z-оценку среди пилотов охвата
          (в сводке — от ${meta.min_starts.period} гонок, в сезоне — от ${meta.min_starts.season}).
          Балл группы и итог — 50 + 15·z: 50 — средний пилот, 80 — на два стандартных отклонения лучше.</li>
        <li><strong>Мало гонок — меньше доверия.</strong> Доли и средние сжимаются к среднему по пулу так,
          будто к реальным гонкам добавили ${meta.shrink_races} гонок среднего пилота.</li>
        <li><strong>Очки</strong> считаются по единой шкале 25-18-15-…-1 только за гонки, без спринтов и бонуса
          за лучший круг, чтобы сезоны 2018–2026 были сравнимы.</li>
        <li><strong>Сверх уровня машины.</strong> Уровень машины на каждом этапе — средний темп двух её пилотов
          на чистых кругах; машины ранжируются от самой быстрой. По всем гонкам считается, сколько очков обычно
          привозит машина каждого ранга (${expText}), и пилот получает разницу между фактом и этим ожиданием.
          «Яркая гонка» — хотя бы на 8 очков больше ожидаемого: например, подиум на 4–5-й по скорости машине.
          Спринты учитываются с весом 0,5.</li>
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
        <li><strong>Сходы</strong> классифицируются по причинам из F1DB: авария или разворот — ошибка пилота,
          поломка — не его вина. Столкновения без разбора виновника не засчитываются никому
          (${unclear} ${plural(unclear, "гоночная дуэль", "гоночные дуэли", "гоночных дуэлей")}).</li>
        <li><strong>Веса</strong> — это мнение, а не измерение: ползунки над таблицей пересчитывают всё на лету.</li>
      </ul>
      ${expRows ? `<p><strong>Сверка с экспертами.</strong> Для сезонов 2021–2025 сравнили наш топ-10 с опросом
        руководителей команд F1 (каждый называет свой топ-10, голоса суммируются). В скобках — прошлая версия,
        где рейтинг строился только на сравнении с напарником.</p>
        <table class="mini"><thead><tr><th>Сезон</th><th class="num">Совпало в топ-10</th>
        <th class="num">Корреляция мест</th></tr></thead><tbody>${expRows}</tbody></table>` : ""}
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
        позиция и время каждого пилота на каждом круге, пит-стопы.</p>
      <p><strong>Чего пока нет.</strong> Шин (составы и износ — есть только в тяжёлых сезонных архивах
        TracingInsights), погоды и дождевых гонок отдельно, виновников столкновений. Уровень машины берётся
        из темпа её же пилотов, поэтому сильный пилот слегка «ускоряет» свою машину в глазах модели.</p>`;
  }

  // ---------- общий рендер ----------
  function renderAll(withWeights = true) {
    cache.clear();
    if (withWeights) renderWeights();
    else $("#weights-summary").textContent = GROUPS
      .filter((g) => state.scope === PERIOD || g.id !== "career")
      .map((g) => `${g.name} ${weightsFor(state.scope === PERIOD)[g.id] || 0}`).join(" · ");
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
    if (!state.driver || !scopes[state.scope].some((e) => e.id === state.driver)) {
      const first = computeScope(state.scope).entries.filter((e) => e.eligible).sort((a, b) => b.score - a.score)[0];
      state.driver = first ? first.id : null;
    }
    $("#scope").value = state.scope;
    renderScopeNote();
    renderAll();
    writeHash();
    syncGraph(state.driver);
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
