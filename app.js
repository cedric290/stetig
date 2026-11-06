/* Stetig: Habit-Tracker. Keine Bibliotheken.
   Daten liegen im Browser. Läuft die Seite als Claude-Artifact, gehen sie zusätzlich
   in die private Datenbank des Kontos, damit Handy und PC denselben Stand haben. */
"use strict";

/* ---------- Grundlagen ---------- */
const KEY = "stetig.v1";
const APP_VERSION = 11;
const WD = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];
const WD_LONG = ["Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"];
const MONTHS = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];
const MON_FIRST = [1, 2, 3, 4, 5, 6, 0];
const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];
const COLORS = ["sun", "orange", "green", "blue", "pink", "violet", "indigo"];
const DEFAULT_SETTINGS = { dayStart: 3, weeks: {} };
const PAUSE_REASONS = { krank: "Krank", urlaub: "Urlaub", frei: "Freier Tag" };

const SUGGEST = {
  plus: ["Kochen lernen", "Gitarre üben", "Programmieren", "Meditieren", "Tagebuch schreiben", "Zeichnen", "20 Liegestütze", "2 Liter trinken", "Dehnen", "Früh aufstehen", "Vokabeln", "Aufräumen"],
  minus: ["Handy im Bett", "Doomscrolling", "Fast Food", "Zu spät ins Bett", "Sport ausgelassen", "Rauchen", "Serie statt Lernen", "Süßkram"]
};

const pad = n => String(n).padStart(2, "0");
const keyOf = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseKey = k => { const [y, m, d] = k.split("-").map(Number); return new Date(y, m - 1, d); };
const addDays = (k, n) => { const d = parseKey(k); d.setDate(d.getDate() + n); return keyOf(d); };
/* Der Tag beginnt erst um die eingestellte Uhrzeit. So zählt ein langer Abend noch zum alten Tag. */
const todayKey = () => keyOf(new Date(Date.now() - ((S && S.settings.dayStart) || 0) * 3600000));
const dow = k => parseKey(k).getDay();
const fmt = n => n.toFixed(1).replace(".", ",");
const uid = () => "h" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const clamp = (n, a, b) => Math.min(b, Math.max(a, n));
const mondayOf = k => addDays(k, -((dow(k) + 6) % 7));
const longDate = k => { const d = parseKey(k); return `${d.getDate()}. ${MONTHS[d.getMonth()]}`; };
const shortDate = k => { const d = parseKey(k); return `${WD[d.getDay()]}, ${d.getDate()}. ${MONTHS[d.getMonth()].slice(0, 3)}`; };

/* ---------- Standarddaten ---------- */
function freshState() {
  const old = "2000-01-01";
  const h = (id, type, name, points, icon, color, days = ALL_DAYS) =>
    ({ id, type, name, points, icon, color, days: days.slice(), from: old, archived: null });
  const extras = { bett: ["morgens", 0], lesen: ["abends", 10], gehen: ["tags", 10], franz: ["abends", 15], arbeit: ["tags", 0] };
  const withExtras = list => list.map(x => Object.assign(x, { time: (extras[x.id] || [""])[0], minutes: (extras[x.id] || [0, 0])[1], weekly: 0 }));
  return {
    version: 1,
    habits: withExtras([
      h("bett", "plus", "Bett machen", 1, "bed", "sun"),
      h("lesen", "plus", "10 Minuten lesen", 2, "book", "blue"),
      h("gehen", "plus", "10 Minuten spazieren", 2, "walk", "green"),
      h("franz", "plus", "Französisch lernen", 2, "speech", "violet"),
      h("arbeit", "plus", "Zur Arbeit gegangen", 3, "work", "orange", [1, 2, 3, 4, 5]),
      h("schlaf", "minus", "Mittagsschlaf", 1, "moon", "indigo")
    ]),
    settings: Object.assign({}, DEFAULT_SETTINGS, { weeks: {} }),
    days: {},
    habitsT: 0,
    resetT: 0
  };
}

function isValidState(s) {
  return s && Array.isArray(s.habits) && s.days && typeof s.days === "object" &&
    s.habits.every(h => h && typeof h.id === "string" && typeof h.name === "string" && (h.type === "plus" || h.type === "minus"));
}

/* Eingelesene oder abgeglichene Tage enthalten nur Zahlen, wo die App Zahlen anzeigt. */
function cleanDay(d) {
  const numbers = (o, max) => {
    const out = {};
    if (o && typeof o === "object") Object.keys(o).forEach(id => { const n = Number(o[id]); if (n > 0) out[id] = Math.min(n, max); });
    return out;
  };
  d.done = numbers(d.done, 1);
  d.minus = numbers(d.minus, 99);
  if (d.mins) d.mins = numbers(d.mins, 600);
  if (d.skip) d.skip = numbers(d.skip, 1);
  if (d.rating !== undefined) {
    const r = Math.round(Number(d.rating));
    if (r >= 1 && r <= 10) d.rating = r; else delete d.rating;
  }
  if (d.note !== undefined) d.note = String(d.note).slice(0, 500);
  if (d.pause !== undefined && !PAUSE_REASONS[d.pause]) delete d.pause;
  if (d.ctx !== undefined) d.ctx = String(d.ctx).slice(0, 200);
  if (d.ai !== undefined) {
    const score = Number(d.ai && d.ai.score);
    if (score >= 1 && score <= 10) d.ai = { score: Math.round(score * 2) / 2, text: String(d.ai.text || "").slice(0, 400), sig: String(d.ai.sig || "") };
    else delete d.ai;
  }
  if (d.snap) {
    const o = {};
    Object.keys(d.snap.o || {}).forEach(id => { o[id] = String(d.snap.o[id]).slice(0, 40); });
    d.snap = { p: numbers(d.snap.p, 5), m: numbers(d.snap.m, 5), b: numbers(d.snap.b, 5), o };
  }
}

function normalize(s) {
  s.settings = Object.assign({}, DEFAULT_SETTINGS, { weeks: {} }, s.settings);
  s.habitsT = s.habitsT || 0;
  s.resetT = s.resetT || 0;
  s.settings.weeks = s.settings.weeks || {};
  s.settings.dayStart = clamp(Number(s.settings.dayStart) || 0, 0, 6);
  Object.keys(s.days).forEach(k => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(k) || !s.days[k] || typeof s.days[k] !== "object") { delete s.days[k]; return; }
    cleanDay(s.days[k]);
  });
  s.habits.forEach(h => {
    h.weekly = clamp(Number(h.weekly) || 0, 0, 6);
    h.flex = !!h.flex && !h.weekly;
    h.group = typeof h.group === "string" ? h.group.slice(0, 40) : "";
    h.minutes = clamp(Number(h.minutes) || 0, 0, 240);
    h.time = ["morgens", "tags", "abends"].includes(h.time) ? h.time : "";
    h.days = Array.isArray(h.days) && h.days.length ? h.days : ALL_DAYS.slice();
    h.from = h.from || "2000-01-01";
    h.archived = h.archived || null;
    h.icon = ICONS[h.icon] ? h.icon : "star";
    h.color = COLORS.includes(h.color) ? h.color : "blue";
  });
  return s;
}

/* ---------- Speichern ---------- */
let S;
let hasDisk = true;

function loadState() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (isValidState(parsed)) return normalize(parsed);
    }
  } catch (e) { hasDisk = false; }
  return normalize(freshState());
}

function persist() {
  try { localStorage.setItem(KEY, JSON.stringify(S)); hasDisk = true; }
  catch (e) { hasDisk = false; }
  cloudPush();
}

function touchHabits() {
  S.habitsT = Date.now();
  const today = todayKey();
  if (S.days[today]) writeSnap(today);
  persist();
}

function dayOf(k) { return S.days[k] || (S.days[k] = { done: {}, minus: {} }); }
function touchDay(k) { const d = dayOf(k); writeSnap(k); d.t = Date.now(); persist(); }

/* ---------- Synchronisierung im Claude-Artifact ---------- */
const cloud = { on: false, col: null, ready: false, seen: {}, timer: 0, busy: false, failed: false, lost: false };

function renderIdle() {
  const active = document.activeElement;
  if (!sheet && !(active && active.matches("input, textarea"))) render();
}

/* Gleicher Inhalt ergibt immer denselben Text, egal in welcher Reihenfolge der Speicher die Felder liefert. */
function stable(v) {
  if (Array.isArray(v)) return "[" + v.map(stable).join(",") + "]";
  if (v && typeof v === "object") return "{" + Object.keys(v).sort().map(k => JSON.stringify(k) + ":" + stable(v[k])).join(",") + "}";
  return JSON.stringify(v === undefined ? null : v);
}

function cloudBodies() {
  const out = { habits: { habits: S.habits, settings: S.settings, t: S.habitsT, resetT: S.resetT } };
  Object.keys(S.days).forEach(k => {
    const id = "days-" + k.slice(0, 4);
    (out[id] || (out[id] = { days: {} })).days[k] = S.days[k];
  });
  return out;
}

function applyRemote(docs) {
  let changed = false;
  /* Erst die Habits: Eine eingelesene Sicherung auf einem anderen Gerät macht ältere Tage ungültig. */
  const ordered = docs.slice().sort((a, b) => (b.id === "habits") - (a.id === "habits"));
  ordered.forEach(doc => {
    const data = doc.data && doc.data();
    if (!data) return;
    if (doc.id === "habits") {
      if ((data.resetT || 0) > S.resetT) {
        S.resetT = data.resetT;
        Object.keys(S.days).forEach(k => { if ((S.days[k].t || 0) < S.resetT) delete S.days[k]; });
        changed = true;
      }
      if ((data.t || 0) > S.habitsT && Array.isArray(data.habits)) {
        S.habits = JSON.parse(JSON.stringify(data.habits));
        S.settings = Object.assign({}, DEFAULT_SETTINGS, { weeks: {} }, data.settings);
        S.habitsT = data.t;
        normalize(S);
        changed = true;
      }
    } else if (doc.id.startsWith("days-") && data.days) {
      Object.keys(data.days).forEach(k => {
        const remote = data.days[k], local = S.days[k];
        if ((remote.t || 0) < S.resetT) return;
        if (!local || (remote.t || 0) > (local.t || 0)) {
          S.days[k] = JSON.parse(JSON.stringify(remote));
          cleanDay(S.days[k]);
          changed = true;
        }
      });
    }
    cloud.seen[doc.id] = stable(data);
  });
  return changed;
}

function cloudDirty() {
  const bodies = cloudBodies();
  return Object.keys(bodies).some(id => !(id === "habits" && !S.habitsT) && cloud.seen[id] !== stable(bodies[id]));
}

function cloudPush() {
  if (!cloud.on || !cloud.ready) return;
  clearTimeout(cloud.timer);
  cloud.timer = setTimeout(cloudFlush, 700);
}

async function cloudFlush() {
  if (!cloud.on || !cloud.col) return;
  if (cloud.busy) { cloudPush(); return; }
  cloud.busy = true;
  const wasFailed = cloud.failed;
  try {
    /* Erst den Stand der anderen Geräte holen, dann schreiben. */
    if (cloud.col.poll) await cloud.col.poll();
    if (!cloud.col) throw { auth: true };
    const bodies = cloudBodies();
    for (const id of Object.keys(bodies)) {
      if (id === "habits" && !S.habitsT) continue;
      const text = stable(bodies[id]);
      if (cloud.seen[id] === text) continue;
      await cloud.col.doc(id).set(JSON.parse(JSON.stringify(bodies[id])));
      cloud.seen[id] = text;
    }
    cloud.failed = false;
  } catch (e) {
    if (e && e.auth) { if (cloud.col || session) supaAuthLost(); }
    else if (navigator.onLine === false) cloud.failed = false;
    else { cloud.failed = true; cloud.msg = (e && e.msg) || ""; }
  }
  cloud.busy = false;
  if (cloud.failed !== wasFailed) renderIdle();
}
addEventListener("online", () => cloudPush());

function cloudListen() {
  cloud.lost = false;
  cloud.on = true;
  cloud.col.onSnapshot(snap => {
    const changed = applyRemote(snap.docs);
    if (changed) {
      ensureSnaps();
      try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { hasDisk = false; }
      renderIdle();
    }
    if (!snap.metadata.fromCache) {
      cloud.ready = true;
      if (cloudDirty()) cloudPush();
    }
  }, () => { cloud.on = false; cloud.lost = true; renderIdle(); });
}

async function cloudStart() {
  if (!window.claude || typeof window.claude.use !== "function") {
    if (supaReady()) { cloud.col = supaCollection(); cloudListen(); renderIdle(); }
    return;
  }
  try {
    const [db, user] = await Promise.all([window.claude.use("db"), window.claude.use("user")]);
    if (!db || !user) return;
    const id = await user.id();
    if (!id) return;
    cloud.col = db.collection("data/users/" + id);
    cloudListen();
    renderIdle();
  } catch (e) { cloud.on = false; }
}

/* ---------- Rechnen ---------- */
const scheduled = (h, k) => h.days.includes(dow(k));
const notArchived = (h, k) => !h.archived || h.archived > k;
const isPaused = k => !!(S.days[k] && S.days[k].pause);
const isSkipped = (k, id) => !!(S.days[k] && S.days[k].skip && S.days[k].skip[id]);

/* Vergangene Tage behalten ihren Plan und ihre Punkte. Spätere Änderungen an Habits schreiben sie nicht um. */
const snapOf = k => (k !== todayKey() && S.days[k] && S.days[k].snap) || null;
/* Ohne feste Tage: Wochenziele und Habits, die man macht, wenn es passt. */
const isBonus = h => h.weekly > 0 || h.flex;
const isDone = (k, id) => !!(S.days[k] && S.days[k].done && S.days[k].done[id]);

function plusShown(k) {
  const s = snapOf(k);
  if (s) return S.habits.filter(h => h.type === "plus" && (h.id in s.p || (s.b && h.id in s.b) || (isBonus(h) && h.from <= k && notArchived(h, k))));
  return S.habits.filter(h => h.type === "plus" && notArchived(h, k) && (isBonus(h) || scheduled(h, k)));
}
/* plusCounted sind die Habits mit festen Tagen. */
function countsOn(h, k) {
  if (isSkipped(k, h.id) || isBonus(h)) return false;
  return !!snapOf(k) || h.from <= k;
}
const plusCounted = k => plusShown(k).filter(h => countsOn(h, k));
/* Entweder-oder: Habits einer Gruppe teilen sich einen Platz im Tagesplan. Eines davon reicht. */
const groupOf = () => ""; /* Entweder-oder ist in der einfachen App aus. Alte Gruppen bleiben gespeichert. */
const groupPeers = (h, k) => {
  const g = groupOf(h, k);
  return g ? S.habits.filter(x => x.id !== h.id && groupOf(x, k) === g) : [];
};
const slotDone = (h, k) => isDone(k, h.id) || groupPeers(h, k).some(x => isDone(k, x.id));
const minusShown = k => S.habits.filter(h => h.type === "minus" && notArchived(h, k));

function plannedOn(h, k) {
  if (isBonus(h)) return false;
  const s = snapOf(k);
  if (s) return h.id in s.p;
  return h.from <= k && scheduled(h, k) && notArchived(h, k);
}

function weekCount(h, k) {
  const mon = mondayOf(k);
  let n = 0;
  for (let i = 0; i < 7; i++) if (isDone(addDays(mon, i), h.id)) n++;
  return n;
}

/* Pausentage senken das Wochenziel anteilig. */
function weekTarget(h, k) {
  const mon = mondayOf(k);
  let paused = 0;
  for (let i = 0; i < 7; i++) if (isPaused(addDays(mon, i))) paused++;
  return Math.max(0, h.weekly - Math.floor(paused * h.weekly / 7));
}

function writeSnap(k) {
  const d = S.days[k];
  if (!d) return;
  if (!hasEntry(k)) { delete d.snap; return; }
  const isToday = k === todayKey();
  const old = (!isToday && d.snap) || { p: {}, m: {} };
  const p = Object.assign({}, old.p), m = {}, b = {};
  plusShown(k).filter(h => h.from <= k && !isBonus(h)).forEach(h => { p[h.id] = 1; });
  S.habits.filter(h => isBonus(h)).forEach(h => {
    delete p[h.id];
    if (isDone(k, h.id)) b[h.id] = 1;
  });
  const o = Object.assign({}, old.o);
  S.habits.forEach(h => { if (h.group && !(h.id in o)) o[h.id] = h.group; });
  S.habits.filter(h => h.type === "minus" && d.minus && d.minus[h.id] > 0)
    .forEach(h => { m[h.id] = 1; });
  d.snap = { p, m, b, o };
}

function ensureSnaps() {
  const today = todayKey();
  const moveOld = !S.settings.bonusSnapFixed;
  S.settings.bonusSnapFixed = true;
  Object.keys(S.days).forEach(k => {
    const d = S.days[k];
    if (moveOld && k < today && d.snap) {
      /* Alte Tage: Wochen-Habits aus dem Pflichtplan in den Bonus verschieben. */
      S.habits.filter(h => isBonus(h) && h.id in d.snap.p).forEach(h => {
        d.snap.b = d.snap.b || {};
        if (isDone(k, h.id)) d.snap.b[h.id] = d.snap.p[h.id];
        delete d.snap.p[h.id];
      });
    }
    if (k < today && !d.snap && hasEntry(k)) writeSnap(k);
  });
  migrateRhythm();
}

/* Einmalig: Sport und Ähnliches aus der Bibliothek war als tägliche Pflicht angelegt. */
function migrateRhythm() {
  if (S.settings.rhythmFixed) return;
  S.settings.rhythmFixed = true;
  S.habits.forEach(h => {
    const r = h.type === "plus" && !isBonus(h) && h.from !== "2000-01-01" ? libraryRhythm(h.name) : 0;
    if (r === "f") h.flex = true;
    else if (r) h.weekly = r;
    if (r) { h.days = ALL_DAYS.slice(); S.habitsT = Date.now(); }
  });
}

function hasEntry(k) {
  const d = S.days[k];
  if (!d) return false;
  return !!d.ai || Object.values(d.done || {}).some(Boolean) || Object.values(d.minus || {}).some(v => v > 0);
}

function firstDay() {
  let first = null;
  Object.keys(S.days).forEach(k => { if (hasEntry(k) && (!first || k < first)) first = k; });
  return first;
}

function habitStreak(h) {
  const start = firstDay();
  if (!start || h.flex) return 0;
  const today = todayKey();
  let n = 0, missed = false;
  if (h.weekly) {
    const current = mondayOf(today);
    for (let mon = current; mon >= mondayOf(start); mon = addDays(mon, -7)) {
      const target = weekTarget(h, mon);
      if (!target) continue;
      if (weekCount(h, mon) >= target) { n++; missed = false; }
      else if (mon !== current) {
        if (missed) break;
        missed = true;
      }
    }
    return n;
  }
  let k = today;
  for (let i = 0; i < 1500 && k >= start; i++, k = addDays(k, -1)) {
    if (isPaused(k) || isSkipped(k, h.id) || !plannedOn(h, k)) continue;
    if (slotDone(h, k)) { n++; missed = false; }
    else if (k !== today) {
      if (missed) break;
      missed = true;
    }
  }
  return n;
}

function daysFree(h) {
  const start = firstDay();
  if (!start) return 0;
  let k = todayKey(), n = 0;
  while (k >= start) {
    if (S.days[k] && S.days[k].minus && S.days[k].minus[h.id] > 0) return n;
    n++;
    k = addDays(k, -1);
  }
  return n;
}

function rangeDays(n) {
  const today = todayKey();
  return Array.from({ length: n }, (_, i) => addDays(today, i - n + 1));
}

function constancy(h, keys) {
  const start = firstDay();
  const today = todayKey();
  let planned = 0, done = 0;
  if (!start || h.flex) return { planned, done };
  if (h.weekly) {
    const current = mondayOf(today);
    [...new Set(keys.map(mondayOf))].filter(m => m >= mondayOf(start) && m >= mondayOf(h.from)).forEach(m => {
      const target = weekTarget(h, m), count = weekCount(h, m);
      const reached = Math.min(count, target);
      planned += m === current ? reached : target;
      done += reached;
    });
    return { planned, done };
  }
  keys.forEach(k => {
    if (k < start || isPaused(k) || isSkipped(k, h.id) || !plannedOn(h, k)) return;
    const did = slotDone(h, k);
    if (k === today && !did) return;
    planned++;
    if (did) done++;
  });
  return { planned, done };
}

/* ---------- Bilder ---------- */
const ICONS = {
  bed: '<path d="M3 6.5a1.5 1.5 0 0 1 3 0V12h15a1 1 0 0 1 1 1v5.5a1.5 1.5 0 0 1-3 0V17H6v1.5a1.5 1.5 0 0 1-3 0z"/><rect x="7" y="7.5" width="6" height="3.5" rx="1.75"/><path d="M14.5 7.5H18a3 3 0 0 1 3 3v.5h-6.5z"/>',
  book: '<path d="M11 6.2C9.3 4.9 6.9 4.2 3.9 4.2a1 1 0 0 0-1 1v12.6a1 1 0 0 0 1 1c2.9 0 5.3.6 7.1 1.9zM13 6.2c1.7-1.3 4.1-2 7.1-2a1 1 0 0 1 1 1v12.6a1 1 0 0 1-1 1c-2.9 0-5.3.6-7.1 1.9z"/>',
  walk: '<circle cx="13.5" cy="4.5" r="2.5"/><path d="M11.2 8.1a2 2 0 0 1 2.6.3l1.9 2.3 2.6.9a1.3 1.3 0 1 1-.9 2.5l-3-1-.2-.1-.7 3 2.3 2.2c.2.2.3.4.4.7l.8 3.2a1.3 1.3 0 0 1-2.5.6l-.7-2.9-3.3-3-1.1 3.2-.3.5-2.6 2.6a1.3 1.3 0 1 1-1.8-1.8l2.4-2.4 2.2-7.2-1.5.9-1 2.4a1.3 1.3 0 1 1-2.4-1l1.2-2.8.5-.6z"/>',
  speech: '<path d="M5 3.5h14a3 3 0 0 1 3 3v8a3 3 0 0 1-3 3h-6.6l-4.6 3.3a1 1 0 0 1-1.6-.8v-2.5H5a3 3 0 0 1-3-3v-8a3 3 0 0 1 3-3z"/>',
  work: '<path d="M9 3h6a2 2 0 0 1 2 2v1.5h3a2 2 0 0 1 2 2v3.2l-8.500 2v-1a1 1 0 0 0-1-1h-1a1 1 0 0 0-1 1v1L2 11.700V8.500a2 2 0 0 1 2-2h3V5a2 2 0 0 1 2-2zm.2 2.200v1.300h5.600V5.200z"/><path d="M2 13.700l8.500 2v.8a1 1 0 0 0 1 1h1a1 1 0 0 0 1-1v-.8l8.500-2V19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2z"/>',
  dumbbell: '<rect x="1.5" y="9" width="3" height="6" rx="1.2"/><rect x="5" y="6" width="4" height="12" rx="1.4"/><rect x="9" y="10.5" width="6" height="3"/><rect x="15" y="6" width="4" height="12" rx="1.4"/><rect x="19.5" y="9" width="3" height="6" rx="1.2"/>',
  drop: '<path d="M12 2.300c.3 0 .6.1.8.4 3.500 4.300 6.700 8 6.700 11.800a7.500 7.500 0 0 1-15 0c0-3.800 3.200-7.500 6.700-11.800.2-.3.5-.4.8-.4z"/>',
  moon: '<path d="M20.600 14.600a1 1 0 0 1 .3 1.100A9.600 9.600 0 1 1 9.100 3.100a1 1 0 0 1 1.200 1.300 7.600 7.600 0 0 0 9.300 9.300 1 1 0 0 1 1 .9z"/>',
  sun: '<circle cx="12" cy="12" r="5.200"/><g stroke="currentColor" stroke-width="2.400" stroke-linecap="round"><path d="M12 2.400v2M12 19.600v2M2.400 12h2M19.600 12h2M5.200 5.200l1.400 1.400M17.400 17.400l1.400 1.400M5.200 18.800l1.400-1.400M17.400 6.600l1.400-1.400"/></g>',
  star: '<path d="M12 2.600c.4 0 .8.2 1 .6l2.600 5.400 5.900.8c.9.1 1.300 1.300.6 1.900l-4.300 4.100 1 5.900c.2.9-.8 1.600-1.600 1.200L12 20l-5.200 2.800c-.8.4-1.800-.3-1.600-1.200l1-5.900-4.300-4.100c-.7-.6-.3-1.800.6-1.900l5.900-.8L11 3.200c.2-.4.6-.6 1-.6z"/>',
  heart: '<path d="M12 21.200a1.300 1.300 0 0 1-.8-.3C5.700 16.500 2 13 2 8.700a5.400 5.400 0 0 1 5.400-5.400c1.800 0 3.500.9 4.600 2.300a5.700 5.700 0 0 1 4.600-2.300A5.400 5.400 0 0 1 22 8.700c0 4.300-3.700 7.800-9.200 12.200a1.300 1.300 0 0 1-.8.3z"/>',
  pen: '<path d="M16.200 3.200a2.700 2.700 0 0 1 3.800 0l.8.8a2.700 2.700 0 0 1 0 3.800L18.700 9.900l-4.600-4.600zM12.700 6.700l4.600 4.600L7.200 21.400a2 2 0 0 1-.9.5l-3.900 1a1 1 0 0 1-1.200-1.200l1-3.900a2 2 0 0 1 .5-.9z"/>',
  music: '<path d="M9 5.300a1.300 1.300 0 0 1 1-1.300l9.500-2A1.300 1.300 0 0 1 21 3.300V16a3.500 3.500 0 1 1-2.500-3.300V7.200l-7 1.500v9.800A3.500 3.500 0 1 1 9 15.200z"/>',
  code: '<path fill-rule="evenodd" d="M4 3h16a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zm6.300 6.700a1.100 1.100 0 0 0-1.600-1.500l-3 3a1.100 1.100 0 0 0 0 1.600l3 3a1.100 1.100 0 0 0 1.600-1.600L8 12zm3.400-1.500a1.100 1.100 0 0 0 0 1.500L16 12l-2.300 2.200a1.100 1.100 0 0 0 1.600 1.600l3-3a1.100 1.100 0 0 0 0-1.600l-3-3a1.100 1.100 0 0 0-1.600 0z"/>',
  cook: '<path d="M3 11h18v6.500a3.500 3.500 0 0 1-3.500 3.500h-11A3.500 3.500 0 0 1 3 17.500z"/><rect x="1" y="8" width="22" height="2.400" rx="1.200"/><path d="M12 3a1.200 1.200 0 0 1 1.200 1.200v1.400h1.300a1.200 1.200 0 0 1 0 2.400h-5a1.200 1.200 0 0 1 0-2.400h1.300V4.200A1.200 1.200 0 0 1 12 3z"/>',
  idea: '<path d="M12 2a7.500 7.500 0 0 1 4.700 13.300c-.8.700-1.200 1.400-1.200 2.200h-7c0-.8-.4-1.500-1.200-2.200A7.500 7.500 0 0 1 12 2z"/><rect x="8.700" y="18.800" width="6.600" height="3.200" rx="1.600"/>',
  phone: '<path fill-rule="evenodd" d="M8 1.500h8a3 3 0 0 1 3 3v15a3 3 0 0 1-3 3H8a3 3 0 0 1-3-3v-15a3 3 0 0 1 3-3zm4 16.800a1.400 1.400 0 1 0 0 2.800 1.400 1.400 0 0 0 0-2.800z"/>',
  burger: '<path d="M3 10.500C3 6.300 7 3.500 12 3.500s9 2.800 9 7a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z"/><rect x="2" y="13" width="20" height="3" rx="1.500"/><path d="M3.500 17.500h17v.5a3 3 0 0 1-3 3h-11a3 3 0 0 1-3-3z"/>',
  stop: '<path fill-rule="evenodd" d="M12 2a10 10 0 1 1 0 20 10 10 0 0 1 0-20zM6.100 8.400a7 7 0 0 0 9.500 9.500zM8.400 6.100l9.500 9.500a7 7 0 0 0-9.500-9.500z"/>',
  flame: '<path d="M12.800 1.800c.1 3-1.400 4.700-3 6.400-.5-.7-.8-1.500-.9-2.400-2.900 2-4.900 5-4.900 8.400A8 8 0 0 0 12 22a8 8 0 0 0 8-7.800c0-5-3.300-9.300-7.200-12.400z"/>'
};
const ICON_ORDER = ["star", "bed", "book", "walk", "speech", "work", "dumbbell", "drop", "sun", "moon", "heart", "pen", "music", "code", "cook", "idea", "phone", "burger", "stop", "flame"];
const iconSvg = n => `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">${ICONS[n] || ICONS.star}</svg>`;
const ico = (h, small) => `<span class="ico ${small ? "small " : ""}c-${h.color}">${iconSvg(h.icon)}</span>`;

const chevron = dir => `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${{ left: "M10 2.500 4.500 8l5.500 5.500", right: "M6 2.500 11.500 8 6 13.500", up: "M2.500 10.500 8 5l5.500 5.500", down: "M2.500 5.500 8 11l5.500-5.500" }[dir]}"/></svg>`;
const CHECK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.500 10 17.500 19.500 7"/></svg>';
const LOGO = '<svg class="brand-mark" viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="10" fill="#58cc02"/><circle cx="16" cy="16" r="10" fill="#ffce00"/><path d="M11 16.500l3.600 3.600 6.600-7.400" fill="none" stroke="#2d2c2b" stroke-width="3.400" stroke-linecap="round" stroke-linejoin="round"/></svg>';

/* Eigene Figur: eine kleine Sonne, die mit dem Tag mitgeht. */
function mascot(score) {
  let eyes, mouth;
  const eye = (x, y) => `<circle cx="${x}" cy="${y}" r="5" fill="#2d2c2b"/><circle cx="${x + 1.6}" cy="${y - 1.8}" r="1.7" fill="#fff"/>`;
  if (score === null) {
    eyes = `<path d="M36 52q6 5 12 0M64 52q6 5 12 0" fill="none" stroke="#2d2c2b" stroke-width="4" stroke-linecap="round"/>`;
    mouth = `<ellipse cx="56" cy="69" rx="4" ry="3" fill="#2d2c2b"/>`;
  } else if (score >= 8) {
    eyes = `<path d="M35 54q7-9 14 0M63 54q7-9 14 0" fill="none" stroke="#2d2c2b" stroke-width="4.500" stroke-linecap="round"/>`;
    mouth = `<path d="M40 63h32a16 16 0 0 1-32 0z" fill="#2d2c2b"/>`;
  } else if (score >= 6) {
    eyes = eye(42, 52) + eye(70, 52);
    mouth = `<path d="M44 66q12 11 24 0" fill="none" stroke="#2d2c2b" stroke-width="4.500" stroke-linecap="round"/>`;
  } else if (score >= 4) {
    eyes = eye(42, 52) + eye(70, 52);
    mouth = `<path d="M46 70h20" fill="none" stroke="#2d2c2b" stroke-width="4.500" stroke-linecap="round"/>`;
  } else {
    eyes = eye(42, 54) + eye(70, 54);
    mouth = `<path d="M45 74q11-10 22 0" fill="none" stroke="#2d2c2b" stroke-width="4.500" stroke-linecap="round"/>`;
  }
  const rays = Array.from({ length: 10 }, (_, i) => {
    const a = i * Math.PI / 5;
    return `<circle cx="${(56 + Math.cos(a) * 45).toFixed(1)}" cy="${(56 + Math.sin(a) * 45).toFixed(1)}" r="8" fill="#f47d31"/>`;
  }).join("");
  return `<svg class="mascot" viewBox="0 0 112 112" aria-hidden="true">${rays}<circle cx="56" cy="56" r="42" fill="#f47d31"/><circle cx="56" cy="56" r="33" fill="#ffb066" opacity=".55"/>${eyes}${mouth}<ellipse cx="31" cy="65" rx="6" ry="4" fill="#ff8fb9" opacity=".8"/><ellipse cx="81" cy="65" rx="6" ry="4" fill="#ff8fb9" opacity=".8"/></svg>`;
}

/* ---------- Ansichtszustand ---------- */
const V = { tab: "heute", day: todayKey(), range: 7, pick: null, month: todayKey().slice(0, 7), popId: null, popHero: false, skipMode: false };
let sheet = null;
const app = document.getElementById("app");

function installPanel() {
  const installed = matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
  if (window.claude || installed) return "";
  const iphone = /iPhone|iPad|iPod/.test(navigator.userAgent);
  return `<section class="panel">
    <h3>Als App installieren</h3>
    <p class="panel-note">${iphone ? "Öffne diese Seite in Safari. Tippe unten auf Teilen, dann auf „Zum Home-Bildschirm“." : "Öffne das Browser-Menü und wähle „App installieren“ oder „Zum Startbildschirm hinzufügen“."}</p>
  </section>`;
}

function markBackup() { S.settings.lastBackup = todayKey(); touchHabits(); }

/* ---------- Bottom Sheets ---------- */
function backupSheet() {
  return `<div class="sheet-head"><h2 id="sheetTitle">Sicherung</h2><button class="close" data-a="close" aria-label="Schließen">×</button></div>
    <p class="hint">Mit einer Sicherung nimmst du alle Habits und Tage auf ein anderes Gerät mit.</p>
    <div class="btn-row">
      <button class="btn is-small" data-a="saveFile">Als Datei sichern</button>
      <button class="btn is-ghost is-small" data-a="copyBackup">Text kopieren</button>
    </div>
    <div class="field"><label for="bkText">Sicherung einlesen</label>
      <textarea class="input" id="bkText" placeholder="Sicherungstext hier einfügen">${esc(sheet.text || "")}</textarea></div>
    <div class="btn-row">
      <label class="btn is-ghost is-small" for="bkFile">Datei wählen</label>
      <button class="btn is-go is-small" data-a="askImport">Einlesen</button>
    </div>
    <input id="bkFile" type="file" accept=".json,application/json,text/plain" hidden>
    ${sheet.confirmImport ? `<p class="hint">Das ersetzt alle Einträge auf diesem Gerät.</p><div class="btn-row"><button class="btn is-ghost is-small" data-a="cancelImport">Abbrechen</button><button class="btn is-danger is-small" data-a="doImport">Ja, ersetzen</button></div>` : ""}
    <p class="hint ${sheet.err ? "is-error" : ""}" ${sheet.msg || sheet.err ? "" : "hidden"}>${esc(sheet.err || sheet.msg || "")}</p>`;
}

function renderSheet() {
  let host = document.getElementById("sheetHost");
  if (!sheet) { if (host) host.remove(); return; }
  if (!host) {
    host = document.createElement("div");
    host.id = "sheetHost";
    document.body.appendChild(host);
    host.innerHTML = `<div class="scrim" data-a="close"></div><div class="sheet" role="dialog" aria-modal="true" aria-labelledby="sheetTitle"><div class="sheet-in"></div></div>`;
  }
  const box = host.querySelector(".sheet");
  const top = box.scrollTop;
  host.querySelector(".sheet-in").innerHTML = `<div class="grabber" aria-hidden="true"></div>` + (sheet.mode === "habit" ? habitSheet() : sheet.mode === "backup" ? backupSheet() : window.EXTRA_SHEETS[sheet.mode]());
  box.scrollTop = top;
}

/* ---------- Zeichnen ---------- */
function tabs() {
  const items = [
    ["heute", "Heute", '<path fill-rule="evenodd" d="M7 2a1.300 1.300 0 0 1 1.300 1.300V4h7.400v-.7a1.300 1.300 0 0 1 2.600 0V4H19a3 3 0 0 1 3 3v12a3 3 0 0 1-3 3H5a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3h.7v-.7A1.300 1.300 0 0 1 7 2zm9.700 9.300a1.200 1.200 0 0 0-1.700-1.700L10.700 14 9 12.300a1.200 1.200 0 0 0-1.700 1.700l2.600 2.500c.5.500 1.200.5 1.700 0z"/>'],
    ["verlauf", "Verlauf", '<rect x="3" y="12" width="5" height="9" rx="1.800"/><rect x="9.500" y="3" width="5" height="18" rx="1.800"/><rect x="16" y="8" width="5" height="13" rx="1.800"/>'],
    ["habits", "Habits", '<rect x="9" y="4" width="13" height="4" rx="2"/><rect x="9" y="10" width="13" height="4" rx="2"/><rect x="9" y="16" width="13" height="4" rx="2"/><circle cx="4.500" cy="6" r="2.500"/><circle cx="4.500" cy="12" r="2.500"/><circle cx="4.500" cy="18" r="2.500"/>']
  ];
  return `<nav class="tabs" aria-label="Hauptmenü"><div class="tabs-in">${items.map(([id, label, path]) =>
    `<button class="tab" data-a="tab" data-tab="${id}" ${V.tab === id ? 'aria-current="page"' : ""}><svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">${path}</svg>${label}</button>`).join("")}</div></nav>`;
}

function statusBanner() {
  if (!hasDisk) return `<div class="warn" role="status">Speichern klappt hier gerade nicht. Mach jetzt eine Sicherung.</div>`;
  if (cloud.relogin) return `<div class="warn" role="status"><span>Bitte melde dich wieder an. Deine Einträge liegen sicher auf diesem Gerät.</span><button class="link" data-a="loginSheet">Anmelden</button></div>`;
  if (cloud.lost || cloud.failed) return `<div class="warn" role="status"><span>${esc(cloud.msg || "Abgleich gestört. Deine Einträge liegen auf diesem Gerät.")}</span><button class="link" data-a="retrySync">Nochmal</button></div>`;
  if (!cloud.on && hasEntry(todayKey()) && backupDue()) return `<div class="warn is-soft" role="status"><span>Deine letzte Sicherung ist über eine Woche her.</span><button class="link" data-a="backup">Sichern</button></div>`;
  return "";
}

function render() {
  const view = V.tab === "heute" ? viewToday() : V.tab === "verlauf" ? viewHistory() : viewManage();
  const open = [...app.querySelectorAll("details.fold[open] > summary")].map(s => s.textContent);
  app.innerHTML = view.replace("</header>", "</header>" + statusBanner()) + tabs();
  app.querySelectorAll("details.fold > summary").forEach(s => { if (open.includes(s.textContent)) s.parentElement.open = true; });
  V.popId = null;
  V.popHero = false;
}

function confetti() {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const hero = document.getElementById("hero");
  if (!hero) return;
  const box = document.createElement("div");
  box.className = "confetti";
  const cols = ["#ffce00", "#1cb0f6", "#ffa1cc", "#f47d31", "#ffffff", "#5f2b89"];
  for (let i = 0; i < 18; i++) {
    const s = document.createElement("span");
    const a = Math.random() * Math.PI * 2, r = 80 + Math.random() * 90;
    s.style.background = cols[i % cols.length];
    s.style.setProperty("--x", Math.cos(a) * r + "px");
    s.style.setProperty("--y", Math.sin(a) * r + "px");
    box.appendChild(s);
  }
  hero.appendChild(box);
  setTimeout(() => box.remove(), 1000);
}

/* ---------- Aktionen ---------- */
function isAllDone(k) {
  const p = dayProgress(k);
  return p.total > 0 && p.done >= p.total;
}

function emptyDraft(type) {
  const used = S.habits.filter(h => !h.archived).length;
  return { type, name: "", days: ALL_DAYS.slice(), icon: type === "plus" ? "star" : "stop", color: type === "plus" ? COLORS[used % 6] : "pink", weekly: 0, flex: false, time: "", minutes: 0, alts: [] };
}

const actions = {
  tab(d) { V.tab = d.tab; V.pick = null; V.skipMode = false; render(); scrollTo(0, 0); },
  dayStart(d) {
    const wasToday = V.day === todayKey();
    S.settings.dayStart = clamp(S.settings.dayStart + Number(d.n), 0, 6);
    touchHabits();
    lastToday = todayKey();
    if (wasToday) V.day = lastToday;
    render();
  },
  retrySync() { if (cloud.lost) cloudListen(); else cloudFlush(); renderIdle(); },
  goDay(d) { V.day = d.k; render(); },
  openDay(d) { V.day = d.k; V.tab = "heute"; V.pick = null; render(); scrollTo(0, 0); },
  week(d) {
    const t = todayKey();
    const k = addDays(V.day, Number(d.n));
    V.day = k > t ? t : k;
    render();
  },
  toggle(d) {
    const k = V.day, day = dayOf(k);
    const h = S.habits.find(x => x.id === d.id);
    const before = isAllDone(k);
    if (day.done[d.id]) {
      delete day.done[d.id];
      if (day.mins) delete day.mins[d.id];
    } else {
      day.done[d.id] = 1;
      if (day.skip) delete day.skip[d.id];
      if (h && h.minutes) { day.mins = day.mins || {}; day.mins[d.id] = h.minutes; }
      /* Entweder-oder: Es zählt immer nur eine Wahl. */
      if (h) groupPeers(h, k).forEach(x => {
        delete day.done[x.id];
        if (day.mins) delete day.mins[x.id];
      });
      if (h && k < h.from) { h.from = k; S.habitsT = Date.now(); }
      if (navigator.vibrate) navigator.vibrate(12);
    }
    touchDay(k);
    V.popId = d.id; V.popHero = true;
    render();
    if (!before && isAllDone(k)) confetti();
  },
  minus(d) {
    const k = V.day, day = dayOf(k);
    const n = clamp((day.minus[d.id] || 0) + Number(d.n), 0, 99);
    if (n) day.minus[d.id] = n; else delete day.minus[d.id];
    touchDay(k);
    V.popId = d.id; V.popHero = true;
    render();
  },
  newHabit(d) { sheet = { mode: "habit", draft: emptyDraft(d.type) }; renderSheet(); },
  edit(d) {
    const h = S.habits.find(x => x.id === d.id);
    if (!h) return;
    sheet = { mode: "habit", editId: h.id, draft: { type: h.type, name: h.name, days: h.days.slice(), icon: h.icon, color: h.color, weekly: h.weekly, flex: h.flex, time: h.time, minutes: h.minutes, alts: S.habits.filter(x => h.group && x.group === h.group && x.id !== h.id && !x.archived).map(x => x.id) } };
    renderSheet();
  },
  close() { closeSheet(); },
  draftIcon(d) { syncDraft(); sheet.draft.icon = d.n; renderSheet(); },
  draftColor(d) { syncDraft(); sheet.draft.color = d.n; renderSheet(); },
  draftWeekly(d) { syncDraft(); sheet.draft.weekly = Number(d.n); sheet.draft.flex = false; renderSheet(); },
  draftFlex() { syncDraft(); sheet.draft.weekly = 0; sheet.draft.flex = true; renderSheet(); },
  draftDay(d) {
    syncDraft();
    const n = Number(d.n), list = sheet.draft.days;
    sheet.draft.days = list.includes(n) ? list.filter(x => x !== n) : list.concat(n);
    renderSheet();
  },
  saveHabit() {
    syncDraft();
    const dr = sheet.draft;
    dr.name = dr.name.trim();
    if (!dr.name) { sheet.err = "Gib deinem Habit einen Namen."; renderSheet(); return; }
    if (dr.type === "plus" && !isBonus(dr) && !dr.days.length) { sheet.err = "Wähle mindestens einen Tag."; renderSheet(); return; }
    if (isBonus(dr)) dr.days = ALL_DAYS.slice();
    const alts = dr.alts || [];
    let saved;
    if (sheet.editId) {
      saved = S.habits.find(x => x.id === sheet.editId);
      Object.assign(saved, { name: dr.name, days: dr.days, icon: dr.icon, color: dr.color, weekly: dr.weekly, flex: dr.flex, time: dr.time, minutes: dr.minutes });
    } else {
      const { alts: _unused, ...fields } = dr;
      saved = Object.assign({ id: uid(), from: todayKey(), archived: null, group: "" }, fields);
      S.habits.push(saved);
    }
    touchHabits();
    closeSheet();
  },
  askDel() { syncDraft(); sheet.confirmDel = true; renderSheet(); },
  cancelDel() { syncDraft(); sheet.confirmDel = false; renderSheet(); },
  doDel() {
    const h = S.habits.find(x => x.id === sheet.editId);
    if (h) {
      /* Schon heute Erledigtes bleibt für heute gültig. Erst morgen fällt das Habit weg. */
      const today = todayKey();
      const doneToday = S.days[today] && S.days[today].done && S.days[today].done[h.id];
      h.archived = doneToday ? addDays(today, 1) : today;
      touchHabits();
    }
    closeSheet();
  },
  move(d) {
    const h = S.habits.find(x => x.id === d.id);
    const peers = S.habits.filter(x => x.type === h.type && !x.archived && isBonus(x) === isBonus(h));
    const other = peers[peers.indexOf(h) + Number(d.n)];
    if (!other) return;
    const a = S.habits.indexOf(h), b = S.habits.indexOf(other);
    S.habits[a] = other; S.habits[b] = h;
    touchHabits();
    render();
  },
  backup() { sheet = { mode: "backup" }; renderSheet(); },
  async saveFile() {
    const name = `stetig-sicherung-${todayKey()}.json`;
    const text = JSON.stringify(S);
    try {
      const file = new File([text], name, { type: "application/json" });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: "Stetig Sicherung" });
        markBackup();
        setBackupMsg("Sicherung gespeichert.");
        return;
      }
      const a = document.createElement("a");
      a.href = URL.createObjectURL(file);
      a.download = name;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      markBackup();
      setBackupMsg("Datei erstellt: " + name);
    } catch (e) {
      if (e && e.name === "AbortError") return;
      setBackupMsg("", "Die Datei ging hier nicht. Nutze „Text kopieren“.");
    }
  },
  async copyBackup() {
    const text = JSON.stringify(S);
    try { await navigator.clipboard.writeText(text); markBackup(); setBackupMsg("Sicherung kopiert. Füge sie zum Beispiel in eine Notiz ein."); }
    catch (e) {
      sheet.text = text; sheet.msg = "Kopieren ging nicht. Der Text steht oben im Feld."; sheet.err = "";
      renderSheet();
      const box = document.getElementById("bkText");
      if (box) box.select();
    }
  },
  askImport() {
    const box = document.getElementById("bkText");
    sheet.text = box ? box.value : "";
    if (!sheet.text.trim()) { setBackupMsg("", "Füge erst eine Sicherung ein oder wähle eine Datei."); return; }
    try {
      if (!isValidState(JSON.parse(sheet.text))) throw 0;
      sheet.confirmImport = true; sheet.err = ""; sheet.msg = "";
    } catch (e) { sheet.err = "Das ist keine gültige Stetig-Sicherung."; sheet.confirmImport = false; }
    renderSheet();
  },
  cancelImport() { sheet.confirmImport = false; renderSheet(); },
  doImport() {
    const now = Date.now();
    const incoming = normalize(JSON.parse(sheet.text));
    Object.values(incoming.days).forEach(d => { d.t = now; });
    incoming.habitsT = now;
    incoming.resetT = now;
    S = incoming;
    ensureSnaps();
    persist();
    V.day = todayKey();
    closeSheet();
  }
};

Object.assign(actions, window.EXTRA_ACTIONS || {});

function setBackupMsg(msg, err = "") {
  const box = document.getElementById("bkText");
  if (box) sheet.text = box.value;
  sheet.msg = msg; sheet.err = err;
  renderSheet();
}

function syncDraft() {
  const input = document.getElementById("hName");
  if (input && sheet && sheet.draft) sheet.draft.name = input.value;
}

function closeSheet() {
  sheet = null;
  renderSheet();
  render();
}

/* Fenster am Griff nach unten ziehen schließt es. */
let drag = null;
document.addEventListener("pointerdown", e => {
  if (!e.target.closest(".grabber")) return;
  drag = { box: e.target.closest(".sheet"), y: e.clientY, d: 0 };
  drag.box.style.transition = "none";
  e.target.setPointerCapture(e.pointerId);
});
document.addEventListener("pointermove", e => {
  if (!drag) return;
  drag.d = Math.max(0, e.clientY - drag.y);
  drag.box.style.transform = `translateY(${drag.d}px)`;
});
function endDrag() {
  if (!drag) return;
  const close = drag.d > 90;
  drag.box.style.transform = "";
  drag.box.style.transition = "";
  drag = null;
  if (close) closeSheet();
}
document.addEventListener("pointerup", endDrag);
document.addEventListener("pointercancel", endDrag);

document.addEventListener("click", e => {
  const el = e.target.closest("[data-a]");
  if (!el || el.disabled) return;
  const fn = actions[el.dataset.a];
  if (fn) fn(el.dataset, el);
});

document.addEventListener("input", e => {
  if (e.target.id === "libSearch" && sheet) { sheet.q = e.target.value; renderLibraryList(); return; }
  if (e.target.id !== "note") return;
  dayOf(V.day).note = e.target.value;
  touchDay(V.day);
});

document.addEventListener("change", e => {
  if (e.target.id !== "bkFile" || !e.target.files[0]) return;
  const reader = new FileReader();
  reader.onload = () => { sheet.text = String(reader.result || ""); sheet.msg = "Datei geladen. Tippe auf Einlesen."; sheet.err = ""; renderSheet(); };
  reader.onerror = () => setBackupMsg("", "Die Datei ließ sich nicht lesen.");
  reader.readAsText(e.target.files[0]);
});

document.addEventListener("keydown", e => { if (e.key === "Escape" && sheet) closeSheet(); });

/* Springt nach Mitternacht beim Zurückkehren auf den neuen Tag. */
let lastToday = todayKey();
function checkNewDay() {
  const t = todayKey();
  if (t === lastToday) return;
  if (V.day === lastToday) V.day = t;
  lastToday = t;
  if (!sheet) render();
}
document.addEventListener("visibilitychange", () => {
  pinOnVisibility();
  if (!document.hidden) checkNewDay();
});
addEventListener("focus", checkNewDay);

/* ---------- Start ---------- */
S = loadState();
V.day = lastToday = todayKey();
V.month = V.day.slice(0, 7);
ensureSnaps();
render();
pinOnStart();
cloudStart();
