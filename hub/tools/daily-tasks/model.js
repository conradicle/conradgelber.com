// Daily tasks: the saved data and every change to it, with no DOM, so
// test/daily-tasks.test.mjs can run it under Node.
//
// Saved under the storage key "state":
//   daily: [{ id, title }]                 the checklist, in display order
//   done:  { "2026-10-24": [id, ...] }     which daily items were done each day
//   todos: [{ id, title, due, doneOn }]    due and doneOn are "YYYY-MM-DD" or null
//
// A day is a calendar date in America/New_York, so the checklist resets at
// midnight there. Every change is a function that takes the state and
// returns it; the store may run it again on a newer copy if another device
// saved first, so each one sets values outright instead of flipping them.

export const ZONE = "America/New_York";
export const empty = () => ({ daily: [], done: {}, todos: [] });

const KEEP_DONE_DAYS = 400; // history kept for streaks and totals
const KEEP_FINISHED_TODOS = 14; // days a finished to-do is kept

const dayFormat = new Intl.DateTimeFormat("en-CA", { timeZone: ZONE, year: "numeric", month: "2-digit", day: "2-digit" });

export function today(now = new Date()) {
  return dayFormat.format(now);
}

export function addDays(day, n) {
  const d = new Date(day + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function newId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function prune(s, day) {
  const oldest = addDays(day, -KEEP_DONE_DAYS);
  for (const d of Object.keys(s.done)) if (d < oldest || !s.done[d].length) delete s.done[d];
  const finishedCutoff = addDays(day, -KEEP_FINISHED_TODOS);
  s.todos = s.todos.filter((t) => !t.doneOn || t.doneOn >= finishedCutoff);
  return s;
}

function normalize(s) {
  s = s && typeof s === "object" ? s : empty();
  s.daily = Array.isArray(s.daily) ? s.daily : [];
  s.done = s.done && typeof s.done === "object" ? s.done : {};
  s.todos = Array.isArray(s.todos) ? s.todos : [];
  return s;
}

// Wrap a change so it always works on clean data and tidies up after itself.
const change = (fn) => (s) => prune(fn(normalize(s)), today());

const clean = (title) => String(title).trim().slice(0, 200);

export const addDaily = (id, title) => change((s) => {
  if (!s.daily.some((d) => d.id === id)) s.daily.push({ id, title: clean(title) });
  return s;
});

export const renameDaily = (id, title) => change((s) => {
  const item = s.daily.find((d) => d.id === id);
  if (item && clean(title)) item.title = clean(title);
  return s;
});

// Move to an absolute position, so a retry lands in the same place.
export const moveDaily = (id, index) => change((s) => {
  const from = s.daily.findIndex((d) => d.id === id);
  if (from < 0) return s;
  const [item] = s.daily.splice(from, 1);
  s.daily.splice(Math.max(0, Math.min(index, s.daily.length)), 0, item);
  return s;
});

export const deleteDaily = (id) => change((s) => {
  s.daily = s.daily.filter((d) => d.id !== id);
  for (const d of Object.keys(s.done)) s.done[d] = s.done[d].filter((x) => x !== id);
  return s;
});

export const setDailyDone = (id, day, isDone) => change((s) => {
  const list = (s.done[day] || []).filter((x) => x !== id);
  if (isDone) list.push(id);
  s.done[day] = list;
  return s;
});

export const addTodo = (id, title, due) => change((s) => {
  if (!s.todos.some((t) => t.id === id)) s.todos.push({ id, title: clean(title), due: due || null, doneOn: null });
  return s;
});

export const editTodo = (id, fields) => change((s) => {
  const t = s.todos.find((x) => x.id === id);
  if (!t) return s;
  if ("title" in fields && clean(fields.title)) t.title = clean(fields.title);
  if ("due" in fields) t.due = fields.due || null;
  return s;
});

export const setTodoDone = (id, doneOn) => change((s) => {
  const t = s.todos.find((x) => x.id === id);
  if (t) t.doneOn = doneOn || null;
  return s;
});

export const deleteTodo = (id) => change((s) => {
  s.todos = s.todos.filter((t) => t.id !== id);
  return s;
});

export function isDone(s, id, day) {
  return (s.done[day] || []).includes(id);
}

// Consecutive days done, ending today, or yesterday if today is still open.
export function streak(s, id, day) {
  let d = isDone(s, id, day) ? day : addDays(day, -1);
  let n = 0;
  while (isDone(s, id, d)) {
    n++;
    d = addDays(d, -1);
  }
  return n;
}

export function total(s, id) {
  let n = 0;
  for (const list of Object.values(s.done)) if (list.includes(id)) n++;
  return n;
}

// To-dos sorted into the groups the page shows, in display order.
export function groupTodos(s, day) {
  const open = s.todos.filter((t) => !t.doneOn);
  const byDue = (a, b) => (a.due < b.due ? -1 : a.due > b.due ? 1 : 0);
  return {
    overdue: open.filter((t) => t.due && t.due < day).sort(byDue),
    today: open.filter((t) => t.due === day),
    upcoming: open.filter((t) => t.due && t.due > day).sort(byDue),
    someday: open.filter((t) => !t.due),
    finished: s.todos.filter((t) => t.doneOn === day),
  };
}
