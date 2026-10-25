// node --test test/
import test from "node:test";
import assert from "node:assert/strict";
import * as M from "../hub/tools/daily-tasks/model.js";

const day = M.today();
const run = (s, ...fns) => fns.reduce((acc, fn) => fn(acc), s);

test("today() is the New York date", () => {
  // 03:30 UTC on Oct 25 is 23:30 on Oct 24 in New York (EDT)
  assert.equal(M.today(new Date("2026-10-25T03:30:00Z")), "2026-10-24");
  assert.equal(M.today(new Date("2026-10-25T04:30:00Z")), "2026-10-25");
  // and in winter (EST, UTC-5)
  assert.equal(M.today(new Date("2026-12-02T04:59:00Z")), "2026-12-01");
});

test("addDays crosses months and DST without drifting", () => {
  assert.equal(M.addDays("2026-10-31", 1), "2026-11-01");
  assert.equal(M.addDays("2026-11-01", 1), "2026-11-02");
  assert.equal(M.addDays("2026-03-01", -1), "2026-02-28");
});

test("streak counts back from today, or from yesterday while today is open", () => {
  let s = run(M.empty(), M.addDaily("a", "Read"));
  for (const n of [1, 2, 3]) s = M.setDailyDone("a", M.addDays(day, -n), true)(s);
  assert.equal(M.streak(s, "a", day), 3);
  s = M.setDailyDone("a", day, true)(s);
  assert.equal(M.streak(s, "a", day), 4);
  assert.equal(M.total(s, "a"), 4);
  s = M.setDailyDone("a", M.addDays(day, -2), false)(s);
  assert.equal(M.streak(s, "a", day), 2);
});

test("changes set values outright, so running one twice is harmless", () => {
  const done = M.setDailyDone("a", day, true);
  let s = run(M.empty(), M.addDaily("a", "Read"), done, done);
  assert.deepEqual(s.done[day], ["a"]);
  const add = M.addTodo("t", "Call", null);
  s = run(s, add, add);
  assert.equal(s.todos.length, 1);
  const move = M.moveDaily("a", 0);
  s = run(s, M.addDaily("b", "Run"), M.moveDaily("b", 0), M.moveDaily("b", 0));
  assert.deepEqual(s.daily.map((d) => d.id), ["b", "a"]);
  s = run(s, move, move);
  assert.deepEqual(s.daily.map((d) => d.id), ["a", "b"]);
});

test("to-dos land in the right group", () => {
  const s = run(M.empty(),
    M.addTodo("late", "Late", M.addDays(day, -2)),
    M.addTodo("now", "Now", day),
    M.addTodo("soon", "Soon", M.addDays(day, 3)),
    M.addTodo("any", "Whenever", ""),
    M.addTodo("fin", "Finished", day),
    M.setTodoDone("fin", day));
  const g = M.groupTodos(s, day);
  assert.deepEqual(Object.fromEntries(Object.entries(g).map(([k, v]) => [k, v.map((t) => t.id)])),
    { overdue: ["late"], today: ["now"], upcoming: ["soon"], someday: ["any"], finished: ["fin"] });
});

test("old history and long-finished to-dos are pruned", () => {
  let s = run(M.empty(), M.addDaily("a", "Read"), M.addTodo("t", "Old", null));
  s.done[M.addDays(day, -500)] = ["a"];
  s.todos[0].doneOn = M.addDays(day, -30);
  s = M.renameDaily("a", "Read more")(s);
  assert.equal(Object.keys(s.done).length, 0);
  assert.equal(s.todos.length, 0);
  assert.equal(s.daily[0].title, "Read more");
});

test("deleting a daily item removes its history", () => {
  const s = run(M.empty(), M.addDaily("a", "Read"), M.setDailyDone("a", day, true), M.deleteDaily("a"));
  assert.equal(s.daily.length, 0);
  assert.equal(M.total(s, "a"), 0);
});
