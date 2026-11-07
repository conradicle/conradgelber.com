import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildIndex, renderIndex } from "../scripts/build-site-index.mjs";

const read = (path) => readFileSync(new URL("../" + path, import.meta.url), "utf8");

const NORMAL_PAGES = ["index.html", "404.html", "work/index.html", "built/index.html", "writing/index.html", "next/index.html", "off-the-clock/index.html", "games/index.html", "accessibility/index.html", "changelog/index.html"];
const APP_PAGES = ["play/index.html", "flight-path/index.html", "borderline/index.html", "pool/index.html", "historybowl/index.html", "12axes/index.html", "aspen/index.html"];
const NO_SCRIPT_PAGES = ["connect/index.html", "login/index.html", "hub/index.html", "hub/tools/daily-tasks/index.html", "hurricanes/index.html", "observatory/index.html"];

test("the committed search index is up to date", () => {
  assert.equal(read("js/site-index.json"), renderIndex(), "run node scripts/build-site-index.mjs");
});

test("nothing private is in the search index", () => {
  const raw = read("js/site-index.json").toLowerCase();
  for (const word of ["/hub", "/login", "/hurricanes", "/observatory", "/logout"]) assert.ok(!raw.includes(word), word);
});

test("the index holds pages, games, essays and projects", () => {
  const { items, links } = buildIndex();
  const count = (group) => items.filter((item) => item.group === group).length;
  assert.ok(count("Pages") >= 8);
  assert.ok(count("Games") >= 8);
  assert.ok(count("Writing") >= 4);
  assert.ok(count("Built") >= 6);
  assert.ok(links.email && links.linkedin && links.github);
  assert.equal(new Set(items.map((item) => item.url)).size, items.length, "no page twice");
});

test("public pages load the site script, and game pages flag themselves", () => {
  for (const page of NORMAL_PAGES) assert.match(read(page), /<script src="\/js\/site\.js\?v=\d+"><\/script>/, page);
  for (const page of APP_PAGES) assert.match(read(page), /<script src="\/js\/site\.js\?v=\d+" data-app><\/script>/, page);
  for (const page of NO_SCRIPT_PAGES) assert.doesNotMatch(read(page), /js\/site\.js/, page);
});

test("the CSP has no inline allowance", () => {
  const csp = read("_headers").match(/Content-Security-Policy: (.*)/)[1];
  assert.match(csp, /script-src 'self';/);
  assert.doesNotMatch(csp, /unsafe|sha256/);
});

test("prerendering leaves out the login and every private folder", () => {
  const rules = JSON.parse(read("js/speculation-rules.json")).prerender[0];
  assert.equal(rules.eagerness, "moderate");
  const patterns = rules.where.and.filter((clause) => clause.not).map((clause) => new URLPattern(clause.not.href_matches, "https://conradgelber.com"));
  const blocked = (path) => patterns.some((pattern) => pattern.test("https://conradgelber.com" + path));
  for (const path of ["/login/", "/login", "/hub/", "/hub/tools/daily-tasks/", "/hurricanes/", "/observatory/"]) assert.ok(blocked(path), path);
  for (const path of ["/", "/work/", "/writing/", "/changelog/"]) assert.ok(!blocked(path), path);
});
