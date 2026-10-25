// Daily tasks page. The data and its changes are in model.js; this file
// draws them and saves through the hub's storage API.
//
// Done and overdue never rely on colour: a done item gets a check mark,
// strikethrough and drops below the open ones; an overdue to-do sits at the
// top under an "Overdue" heading with a "!" mark and its due date.

import { toolStore } from "/hub/lib/store.js";
import * as M from "./model.js?v=1";

const store = toolStore("daily-tasks");
const KEY = "state";

let state = M.empty();
let day = M.today();
let editing = false;
let pending = 0;
let queue = Promise.resolve();

const $ = (id) => document.getElementById(id);
const SVG = "http://www.w3.org/2000/svg";

function el(tag, props = {}, ...kids) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === "class") node.className = v;
    else if (k === "dataset") Object.assign(node.dataset, v);
    else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
    else if (k in node && typeof v !== "string") node[k] = v;
    else node.setAttribute(k, v);
  }
  node.append(...kids.filter((k) => k !== null && k !== undefined && k !== false));
  return node;
}

// A square box, with a check mark when done. Drawn, not coloured.
function checkIcon(done) {
  const svg = document.createElementNS(SVG, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("class", "check-icon");
  const box = document.createElementNS(SVG, "rect");
  for (const [k, v] of Object.entries({ x: 2.5, y: 2.5, width: 19, height: 19, rx: 2 })) box.setAttribute(k, v);
  svg.append(box);
  if (done) {
    const tick = document.createElementNS(SVG, "path");
    tick.setAttribute("d", "M6.5 12.5l3.6 3.6 7.4-8.2");
    svg.append(tick);
  }
  return svg;
}

function prettyDay(d) {
  return new Date(d + "T12:00:00Z").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
}

function setStatus(text) {
  $("status").textContent = text;
}

// Apply a change now, then save it. Saves run one at a time, in order.
function act(fn) {
  state = fn(structuredClone(state));
  render();
  pending++;
  setStatus("Saving…");
  queue = queue
    .then(() => store.update(KEY, fn, M.empty()))
    .then((saved) => {
      pending--;
      if (pending === 0) {
        if (JSON.stringify(saved.value) !== JSON.stringify(state)) {
          state = saved.value;
          render();
        }
        setStatus("Saved");
      }
    })
    .catch(() => {
      pending--;
      setStatus("Not saved. Check the connection and reload.");
    });
}

async function refresh() {
  if (pending) return;
  try {
    const doc = await store.get(KEY);
    if (pending) return;
    const next = doc ? doc.value : M.empty();
    if (JSON.stringify(next) !== JSON.stringify(state)) {
      state = next;
      render();
    }
    setStatus(doc ? "Up to date" : "");
  } catch {
    setStatus("Could not load. Check the connection and reload.");
  }
}

// ---- drawing ----

function dailyRow(item, index, count) {
  const done = M.isDone(state, item.id, day);
  if (editing) {
    return el("li", { class: "task task-edit" },
      el("input", {
        class: "hub-input", value: item.title, maxlength: "200", "aria-label": "Daily item name",
        dataset: { key: "dn-" + item.id },
        onchange: (e) => act(M.renameDaily(item.id, e.target.value)),
      }),
      el("button", { type: "button", class: "hub-quiet icon-btn", "aria-label": `Move ${item.title} up`, disabled: index === 0,
        dataset: { key: "du-" + item.id }, onclick: () => act(M.moveDaily(item.id, index - 1)) }, "↑"),
      el("button", { type: "button", class: "hub-quiet icon-btn", "aria-label": `Move ${item.title} down`, disabled: index === count - 1,
        dataset: { key: "dd-" + item.id }, onclick: () => act(M.moveDaily(item.id, index + 1)) }, "↓"),
      el("button", { type: "button", class: "hub-quiet icon-btn", "aria-label": `Delete ${item.title}`, dataset: { key: "dx-" + item.id },
        onclick: () => { if (confirm(`Delete "${item.title}" and its history?`)) act(M.deleteDaily(item.id)); } }, "\u2715"),
    );
  }
  const s = M.streak(state, item.id, day);
  const n = M.total(state, item.id);
  const meta = s > 1 ? `${s}-day streak · ${n} done` : n ? `${n} done` : "";
  return el("li", { class: "task" + (done ? " is-done" : "") },
    el("button", {
      type: "button", class: "check", "aria-pressed": String(done), dataset: { key: "dc-" + item.id },
      onclick: () => act(M.setDailyDone(item.id, day, !done)),
    }, checkIcon(done), el("span", { class: "task-title" }, item.title)),
    meta && el("span", { class: "task-meta" }, meta),
  );
}

function todoRow(t, flag) {
  const done = Boolean(t.doneOn);
  if (editing) {
    return el("li", { class: "task task-edit task-edit-todo" },
      el("input", { class: "hub-input", value: t.title, maxlength: "200", "aria-label": "To-do", dataset: { key: "tn-" + t.id },
        onchange: (e) => act(M.editTodo(t.id, { title: e.target.value })) }),
      el("input", { class: "hub-input", type: "date", value: t.due || "", "aria-label": `Due date for ${t.title}`, dataset: { key: "tt-" + t.id },
        onchange: (e) => act(M.editTodo(t.id, { due: e.target.value })) }),
      el("button", { type: "button", class: "hub-quiet icon-btn", "aria-label": `Delete ${t.title}`, dataset: { key: "tx-" + t.id },
        onclick: () => act(M.deleteTodo(t.id)) }, "\u2715"),
    );
  }
  const when = flag === "overdue" ? `Overdue · was due ${prettyDay(t.due)}`
    : flag === "upcoming" ? prettyDay(t.due) : "";
  return el("li", { class: "task" + (done ? " is-done" : "") + (flag === "overdue" ? " is-overdue" : "") },
    el("button", {
      type: "button", class: "check", "aria-pressed": String(done), dataset: { key: "tc-" + t.id },
      onclick: () => act(M.setTodoDone(t.id, done ? null : day)),
    }, checkIcon(done), el("span", { class: "task-title" }, t.title)),
    when && el("span", { class: "task-meta" }, when),
  );
}

function group(title, items, flag, extraClass = "") {
  if (!items.length) return null;
  return el("div", { class: "todo-group " + extraClass },
    el("h3", { class: "todo-group-h" }, flag === "overdue" ? el("span", { class: "flag", "aria-hidden": "true" }, "!") : null, title),
    el("ul", { class: "task-list" }, ...items.map((t) => todoRow(t, flag))),
  );
}

function render() {
  const focused = document.activeElement?.dataset?.key;

  $("today-label").textContent = new Date(day + "T12:00:00Z").toLocaleDateString("en-US",
    { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" });
  $("edit-toggle").setAttribute("aria-pressed", String(editing));
  $("edit-toggle").textContent = editing ? "Done editing" : "Edit";
  document.body.classList.toggle("is-editing", editing);

  // Open items first, done ones after, each in the saved order. Editing
  // shows the plain saved order so moving makes sense.
  const daily = state.daily;
  const order = editing ? daily
    : [...daily.filter((d) => !M.isDone(state, d.id, day)), ...daily.filter((d) => M.isDone(state, d.id, day))];
  $("daily").replaceChildren(...order.map((d, i) => dailyRow(d, i, order.length)));
  $("daily-empty").hidden = daily.length > 0;
  const doneCount = daily.filter((d) => M.isDone(state, d.id, day)).length;
  $("daily-count").textContent = daily.length ? `${doneCount} of ${daily.length} done` : "";

  const g = M.groupTodos(state, day);
  $("todos").replaceChildren(...[
    group("Overdue", g.overdue, "overdue", "is-overdue"),
    group("Today", g.today, "today"),
    group("Coming up", g.upcoming, "upcoming"),
    group("No date", g.someday, "someday"),
    group("Done today", g.finished, "finished", "is-finished"),
  ].filter(Boolean));
  $("todo-empty").hidden = Object.values(g).some((list) => list.length);

  if (focused) document.querySelector(`[data-key="${CSS.escape(focused)}"]`)?.focus();
}

// ---- wiring ----

$("edit-toggle").addEventListener("click", () => {
  editing = !editing;
  render();
});

$("add-daily").addEventListener("submit", (e) => {
  e.preventDefault();
  const input = $("add-daily-title");
  if (!input.value.trim()) return;
  act(M.addDaily(M.newId(), input.value));
  input.value = "";
  input.focus();
});

$("add-todo").addEventListener("submit", (e) => {
  e.preventDefault();
  const input = $("add-todo-title");
  if (!input.value.trim()) return;
  act(M.addTodo(M.newId(), input.value, $("add-todo-due").value));
  input.value = "";
  $("add-todo-due").value = "";
  input.focus();
});

// Pick up changes made on another device, and roll over at midnight.
function tick() {
  const now = M.today();
  if (now !== day) {
    day = now;
    render();
  }
}
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    tick();
    refresh();
  }
});
setInterval(tick, 30000);

render();
refresh();
