/* Stetig: die einfache Oberfläche. Antippen, Serie, Raster. Keine Punkte, keine Noten.
   Ältere Angaben wie Fazit oder Notizen bleiben gespeichert, werden aber nicht mehr gezeigt. */
"use strict";
window.EXTRA_ACTIONS = window.EXTRA_ACTIONS || {};
window.EXTRA_SHEETS = window.EXTRA_SHEETS || {};

const GRID_WEEKS = 18;

/* ---------- Rechnen ---------- */
const targetReached = (h, k) => h.weekly > 0 && weekCount(h, k) >= weekTarget(h, k);

/* Fällig ist, was heute ansteht. Wochen-Habits zählen, bis ihr Ziel erreicht ist. "Frei" zählt nur, wenn erledigt. */
function dayProgress(k) {
  const list = plusShown(k).filter(h => isDone(k, h.id) || (!h.flex && !targetReached(h, k)));
  return { total: list.length, done: list.filter(h => isDone(k, h.id)).length };
}

/* Die Sonne zeigt, ob du auf Kurs bist. Sie vergleicht dein Tempo mit der Uhrzeit:
   Morgens ist noch nichts schlimm, abends sollte das Meiste geschafft sein. */
function sunMood(k) {
  const p = dayProgress(k);
  const isToday = k === todayKey();
  if (!p.total) return { face: null, text: isToday ? "Heute steht nichts an." : "Da stand nichts an." };
  const share = p.done / p.total;
  if (share >= 1) return { face: 10, text: "Alles geschafft." };
  const now = new Date(Date.now());
  const hour = now.getHours() < S.settings.dayStart ? now.getHours() + 24 : now.getHours();
  const expected = isToday ? clamp((hour - 7) / 15, 0, 1) : 1;
  if (!p.done && expected < 0.25) return { face: null, text: "Guten Morgen. Der Tag ist noch offen." };
  if (share >= expected) return { face: share >= 0.5 ? 9 : 6.5, text: "Du bist auf gutem Kurs." };
  if (share >= expected / 2) return { face: 5, text: isToday ? "Da geht noch was." : "Ordentlicher Tag." };
  return { face: 2, text: isToday ? "Ein kleiner Schritt reicht schon." : "Nicht jeder Tag klappt." };
}

function rhythmLabel(h) {
  if (h.type === "minus") return "Vermeiden";
  if (h.weekly) return `${h.weekly}× pro Woche`;
  if (h.flex) return "Wann es passt";
  if (h.days.length === 7) return "Jeden Tag";
  const s = [...h.days].sort((a, b) => MON_FIRST.indexOf(a) - MON_FIRST.indexOf(b));
  if (s.join() === "1,2,3,4,5") return "Mo bis Fr";
  return s.map(d => WD[d]).join(", ");
}

/* ---------- Bausteine ---------- */
const brand = () => `<div class="brand">${LOGO}Stetig</div>`;

function habitRow(h, k) {
  const done = isDone(k, h.id);
  const st = habitStreak(h);
  const unit = h.weekly ? (st === 1 ? "Woche" : "Wochen") : st === 1 ? "Tag" : "Tage";
  const sub = h.weekly ? `${weekCount(h, k)} von ${weekTarget(h, k)} diese Woche` : rhythmLabel(h);
  return `<button class="row ${done ? "is-done" : ""} ${V.popId === h.id ? "is-pop" : ""}" data-a="toggle" data-id="${h.id}" role="checkbox" aria-checked="${done}">
    ${ico(h)}
    <span class="row-main"><span class="row-name">${esc(h.name)}</span><span class="row-sub">${sub}</span></span>
    ${st ? `<span class="streak" aria-label="${st} ${unit} in Folge">${iconSvg("flame")}${st}</span>` : ""}
    <span class="check">${CHECK}</span>
  </button>`;
}

function avoidRow(h, k) {
  const hit = !!(S.days[k] && S.days[k].minus && S.days[k].minus[h.id]);
  const free = daysFree(h);
  return `<button class="row ${hit ? "is-minus" : ""}" data-a="minus" data-id="${h.id}" data-n="${hit ? -S.days[k].minus[h.id] : 1}" role="checkbox" aria-checked="${hit}">
    ${ico(h)}
    <span class="row-main"><span class="row-name">${esc(h.name)}</span><span class="row-sub">${hit ? "Passiert" : free >= 2 ? `${free} Tage frei` : "Nicht passiert"}</span></span>
  </button>`;
}

function weekRow(k) {
  const today = todayKey();
  const mon = mondayOf(k);
  const days = Array.from({ length: 7 }, (_, i) => addDays(mon, i));
  const canNext = addDays(mon, 7) <= today;
  return `<nav class="week" aria-label="Woche">
    <button class="week-nav" data-a="week" data-n="-7" aria-label="Woche davor">${chevron("left")}</button>
    ${days.map(d => {
      const p = dayProgress(d);
      const full = p.total > 0 && p.done >= p.total;
      const part = p.done > 0 && !full;
      return `<button class="day ${d === k ? "is-sel" : ""}" data-a="goDay" data-k="${d}" ${d > today ? "disabled" : ""} ${d === today ? 'aria-current="date"' : ""} aria-label="${shortDate(d)}, ${p.done} von ${p.total}">
        ${WD[dow(d)]}<b class="${full ? "t4" : part ? "t2" : ""}">${parseKey(d).getDate()}</b></button>`;
    }).join("")}
    <button class="week-nav" data-a="week" data-n="7" ${canNext ? "" : "disabled"} aria-label="Woche danach">${chevron("right")}</button>
  </nav>`;
}

/* ---------- Heute ---------- */
function viewToday() {
  const k = V.day;
  const today = todayKey();
  const isToday = k === today;
  const plus = plusShown(k);
  const avoid = minusShown(k);
  const p = dayProgress(k);
  const pct = p.total ? p.done / p.total * 100 : 0;
  const mood = sunMood(k);
  const open = plus.filter(h => !isDone(k, h.id) && !h.flex && !targetReached(h, k));
  const extra = plus.filter(h => !isDone(k, h.id) && (h.flex || targetReached(h, k)));
  const done = plus.filter(h => isDone(k, h.id));
  return `<div class="page">
    <header class="top">${brand()}${isToday ? "" : `<button class="chip is-today" data-a="goDay" data-k="${today}">Heute</button>`}</header>
    <div class="headline"><h1>${isToday ? "Heute" : WD_LONG[dow(k)]}</h1><p>${isToday ? WD_LONG[dow(k)] + ", " : ""}${longDate(k)}</p></div>
    ${weekRow(k)}
    <section class="sum ${V.popHero ? "is-pop" : ""}" id="hero" aria-label="Fortschritt">
      <div class="sum-text">
        <b>${p.done} von ${p.total}</b>
        <p>${mood.text}</p>
        <div class="bar on-card" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(pct)}" aria-label="Fortschritt"><i style="width:${pct}%"></i></div>
      </div>
      ${mascot(mood.face)}
    </section>
    <section class="list" aria-label="Habits">
      ${open.map(h => habitRow(h, k)).join("")}
      ${extra.map(h => habitRow(h, k)).join("")}
      ${done.map(h => habitRow(h, k)).join("")}
      ${plus.length ? "" : `<p class="hint">Für diesen Tag ist nichts geplant.</p>`}
    </section>
    <button class="add" data-a="newHabit" data-type="plus">+ Habit hinzufügen</button>
    ${avoid.length ? `<section class="section"><div class="section-head"><h2>Vermeiden</h2></div><div class="list">${avoid.map(h => avoidRow(h, k)).join("")}</div></section>` : ""}
  </div>`;
}

/* ---------- Verlauf ---------- */
function habitGrid(h) {
  const today = todayKey();
  const start = addDays(mondayOf(today), -7 * (GRID_WEEKS - 1));
  const cells = [];
  for (let i = 0; i < GRID_WEEKS * 7; i++) {
    const k = addDays(start, i);
    if (k > today) { cells.push(`<i class="is-future"></i>`); continue; }
    const hit = h.type === "plus" ? isDone(k, h.id) : !!(S.days[k] && S.days[k].minus && S.days[k].minus[h.id]);
    cells.push(`<i class="${hit ? "c-" + h.color : ""} ${k === today ? "is-now" : ""}"></i>`);
  }
  return `<div class="grid" aria-hidden="true">${cells.join("")}</div>`;
}

function historyCard(h) {
  const keys = rangeDays(30);
  const count = keys.filter(k => h.type === "plus" ? isDone(k, h.id) : !!(S.days[k] && S.days[k].minus && S.days[k].minus[h.id])).length;
  const st = h.type === "plus" ? habitStreak(h) : 0;
  const free = h.type === "minus" ? daysFree(h) : 0;
  return `<article class="panel habit-card">
    <div class="card-head">${ico(h, true)}<span class="stat-name">${esc(h.name)}</span>
      ${st ? `<span class="streak">${iconSvg("flame")}${st}</span>` : free ? `<span class="stat-sub">${free} Tage frei</span>` : ""}</div>
    ${habitGrid(h)}
    <p class="panel-note">${count}× in den letzten 30 Tagen</p>
  </article>`;
}

function viewHistory() {
  const list = S.habits.filter(h => !h.archived).sort((a, b) => (a.type === b.type ? 0 : a.type === "plus" ? -1 : 1));
  return `<div class="page">
    <header class="top">${brand()}</header>
    <div class="headline"><h1>Verlauf</h1></div>
    ${list.map(historyCard).join("") || `<p class="hint">Noch keine Habits angelegt.</p>`}
  </div>`;
}

/* ---------- Habits ---------- */
function manageRow(h, list, i) {
  return `<div class="row is-plain">
    <button class="row-open" data-a="edit" data-id="${h.id}" aria-label="${esc(h.name)} bearbeiten">
      ${ico(h)}
      <span class="row-main"><span class="row-name">${esc(h.name)}</span><span class="row-sub">${rhythmLabel(h)}</span></span>
    </button>
    <span class="row-tools">
      <button data-a="move" data-id="${h.id}" data-n="-1" ${i === 0 ? "disabled" : ""} aria-label="${esc(h.name)} nach oben">${chevron("up")}</button>
      <button data-a="move" data-id="${h.id}" data-n="1" ${i === list.length - 1 ? "disabled" : ""} aria-label="${esc(h.name)} nach unten">${chevron("down")}</button>
    </span>
  </div>`;
}

function viewManage() {
  const plus = S.habits.filter(h => h.type === "plus" && !h.archived);
  const avoid = S.habits.filter(h => h.type === "minus" && !h.archived);
  const where = cloud.on ? "Gespeichert in deinem Konto und auf diesem Gerät." : hasDisk ? "Gespeichert auf diesem Gerät. Mach ab und zu eine Sicherung." : "Dieser Browser erlaubt kein Speichern.";
  return `<div class="page">
    <header class="top">${brand()}</header>
    <div class="headline"><h1>Habits</h1></div>
    <div class="list">${plus.map((h, i) => manageRow(h, plus, i)).join("")}
      <button class="add" data-a="newHabit" data-type="plus">+ Habit hinzufügen</button></div>
    <section class="section"><div class="section-head"><h2>Vermeiden</h2></div>
      <div class="list">${avoid.map((h, i) => manageRow(h, avoid, i)).join("")}
      <button class="add" data-a="newHabit" data-type="minus">+ Hinzufügen</button></div></section>
    <h2 class="group-title">Einstellungen</h2>
    ${accountPanel()}
    <details class="fold"><summary>Daten und Sicherung</summary>
      <section class="panel"><p class="panel-note">${where}</p>
        <p class="panel-note">Letzte Sicherung: ${S.settings.lastBackup ? shortDate(S.settings.lastBackup) : "noch keine"}</p>
        <button class="btn is-ghost is-small" data-a="backup">Sicherung</button></section></details>
    <details class="fold"><summary>Neuer Tag und App-Sperre</summary>
      <section class="panel"><div class="setting"><span class="stat-name">Neuer Tag beginnt um ${S.settings.dayStart} Uhr</span>
        <span class="stepper"><button class="step" data-a="dayStart" data-n="-1" ${S.settings.dayStart <= 0 ? "disabled" : ""} aria-label="Früher">−</button><button class="step" data-a="dayStart" data-n="1" ${S.settings.dayStart >= 6 ? "disabled" : ""} aria-label="Später">+</button></span></div></section>
      ${pinPanel()}</details>
    <details class="fold"><summary>Erinnerung und Installation</summary>${installPanel()}${reminderPanel()}</details>
    <p class="hint" id="appVersion">Stetig Version ${APP_VERSION}</p>
  </div>`;
}

/* ---------- Habit-Fenster ---------- */
function habitSheet() {
  const d = sheet.draft;
  const isPlus = d.type === "plus";
  const title = sheet.editId ? "Bearbeiten" : isPlus ? "Neues Habit" : "Etwas vermeiden";
  const mode = d.weekly ? "week" : d.flex ? "free" : "days";
  return `<div class="sheet-head"><h2 id="sheetTitle">${title}</h2><button class="close" data-a="close" aria-label="Schließen">×</button></div>
    <div class="field"><label for="hName">Name</label>
      <input class="input" id="hName" maxlength="40" autocomplete="off" value="${esc(d.name)}" placeholder="${isPlus ? "Zum Beispiel: Gitarre üben" : "Zum Beispiel: Handy im Bett"}"></div>
    ${sheet.editId ? "" : `<button class="btn is-ghost is-small" data-a="library" data-type="${d.type}">Aus der Bibliothek wählen</button>`}
    ${isPlus ? `<div class="field"><span class="label">Wie oft</span>
      <div class="seg" role="group"><button data-a="draftWeekly" data-n="0" aria-pressed="${mode === "days"}">Feste Tage</button><button data-a="draftWeekly" data-n="${d.weekly || 3}" aria-pressed="${mode === "week"}">Pro Woche</button><button data-a="draftFlex" aria-pressed="${mode === "free"}">Wann es passt</button></div></div>
    ${mode === "week" ? `<div class="days weekly" role="group">${[1, 2, 3, 4, 5, 6].map(n => `<button data-a="draftWeekly" data-n="${n}" aria-pressed="${d.weekly === n}">${n}×</button>`).join("")}</div>` : ""}
    ${mode === "days" ? `<div class="days" role="group">${MON_FIRST.map(n => `<button data-a="draftDay" data-n="${n}" aria-pressed="${d.days.includes(n)}">${WD[n]}</button>`).join("")}</div>` : ""}` : ""}
    <div class="field"><span class="label">Symbol</span>
      <div class="icons" role="group">${ICON_ORDER.map(n => `<button data-a="draftIcon" data-n="${n}" aria-pressed="${d.icon === n}" aria-label="Symbol ${n}">${iconSvg(n)}</button>`).join("")}</div></div>
    <div class="field"><span class="label">Farbe</span>
      <div class="swatches" role="group">${COLORS.map(c => `<button class="c-${c}" data-a="draftColor" data-n="${c}" aria-pressed="${d.color === c}" aria-label="Farbe ${c}"></button>`).join("")}</div></div>
    <p class="hint is-error" ${sheet.err ? "" : "hidden"}>${esc(sheet.err || "")}</p>
    <button class="btn is-go" data-a="saveHabit">${sheet.editId ? "Speichern" : "Hinzufügen"}</button>
    ${sheet.editId ? (sheet.confirmDel
      ? `<p class="hint">Das Habit verschwindet aus deinen Listen. Bisherige Einträge bleiben gespeichert.</p><div class="btn-row"><button class="btn is-ghost is-small" data-a="cancelDel">Behalten</button><button class="btn is-danger is-small" data-a="doDel">Ja, entfernen</button></div>`
      : `<button class="btn is-danger is-small" data-a="askDel">Entfernen</button>`) : ""}`;
}

/* ---------- Bibliothek ---------- */
function libraryRows() {
  const q = (sheet.q || "").trim().toLowerCase();
  const names = new Set(S.habits.filter(h => !h.archived).map(h => h.name.toLowerCase()));
  const rows = HABIT_LIBRARY.filter(([n, a]) => (q ? n.toLowerCase().includes(q) : a === sheet.area));
  return rows.map(r => {
    const added = names.has(r[0].toLowerCase());
    const rhythm = libraryRhythm(r[0]);
    const sub = r[1] === "Weniger" ? "Vermeiden" : rhythm === "f" ? "Wann es passt" : rhythm ? `${rhythm}× pro Woche` : "Jeden Tag";
    return `<div class="lib-row"><span class="row-main"><span class="row-name">${esc(r[0])}</span><span class="row-sub">${sub}</span></span>
      <button class="step ${added ? "" : "is-add"}" data-a="libAdd" data-n="${esc(r[0])}" ${added ? "disabled" : ""} aria-label="${esc(r[0])} ${added ? "ist schon dabei" : "hinzufügen"}">${added ? "✓" : "+"}</button></div>`;
  }).join("") || `<p class="hint">Nichts gefunden. Leg das Habit einfach selbst an.</p>`;
}

function renderLibraryList() {
  const box = document.getElementById("libList");
  if (box) box.innerHTML = libraryRows();
}

window.EXTRA_SHEETS.library = () => `<div class="sheet-head"><h2 id="sheetTitle">Bibliothek</h2><button class="close" data-a="close" aria-label="Schließen">×</button></div>
  <input class="input" id="libSearch" autocomplete="off" placeholder="Suchen" value="${esc(sheet.q || "")}" aria-label="Bibliothek durchsuchen">
  <div class="chips" role="group">${LIBRARY_AREAS.map(a => `<button class="pill" data-a="libArea" data-n="${a}" aria-pressed="${sheet.area === a}">${a}</button>`).join("")}</div>
  <div class="lib-list" id="libList">${libraryRows()}</div>`;

Object.assign(window.EXTRA_ACTIONS, {
  library(d) { sheet = { mode: "library", area: d.type === "minus" ? "Weniger" : "Sport", q: "" }; renderSheet(); },
  libArea(d) { sheet.area = d.n; sheet.q = ""; renderSheet(); },
  libAdd(d) {
    const r = HABIT_LIBRARY.find(x => x[0] === d.n);
    if (!r) return;
    const isMinus = r[1] === "Weniger";
    const used = S.habits.filter(h => !h.archived).length;
    const rhythm = isMinus ? 0 : libraryRhythm(r[0]);
    S.habits.push({
      id: uid(), type: isMinus ? "minus" : "plus", name: r[0], icon: r[3],
      color: isMinus ? "pink" : COLORS[used % 6], days: ALL_DAYS.slice(), from: todayKey(), archived: null,
      weekly: typeof rhythm === "number" ? rhythm : 0, flex: rhythm === "f", group: "", time: "", minutes: 0
    });
    touchHabits();
    renderLibraryList();
  }
});
