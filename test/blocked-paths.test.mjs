import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { onRequest } from "../functions/_middleware.js";
import { onRequest as hurricaneGate } from "../functions/hurricanes/_middleware.js";
import { onRequest as observatoryGate } from "../functions/observatory/_middleware.js";
import { newSessionCookie } from "../functions/_lib/auth.js";
import { resolvePath, isBlockedPath, isGatedPath, gatedCanonical } from "../functions/_lib/paths.js";

const blocked = (raw) => isBlockedPath(resolvePath(raw));

test("repo docs and config are blocked, however they are spelled", () => {
  for (const p of [
    "/DEPLOY.md", "/ADDING_TOOLS.md", "/CLAUDE.md", "/CLAUDE.local.md", "/wrangler.jsonc",
    "/aspen/README.md", "/hurricanes/README.md", "/connect/profile.mjs",
    "/.gitignore", "/.gitattributes", "/.dev.vars", "/.env", "/_headers", "/_routes.json",
    "/scripts/build-connect.mjs", "/test/hub-flow.sh", "/db/migrations/0001_hub.sql",
    "/functions/_middleware.js", "/play-src/package.json", "/floorplan/index.html",
    "/pool-worker/wrangler.jsonc", "/historybowl-worker/package.json",
    "/deploy.md", "//DEPLOY.md", "/%44EPLOY.md", "/%2FDEPLOY.md", "/x/../DEPLOY.md",
    "/DEPLOY.md/", "/DEPLOY.md;x", "/WRANGLER.JSONC", "/scripts", "/scripts/",
  ]) {
    assert.equal(blocked(p), true, p);
  }
});

test("public paths stay public", () => {
  for (const p of [
    "/", "/index.html", "/changelog/", "/changelog.json", "/changelog/changelog.js",
    "/style.css", "/robots.txt", "/sitemap.xml", "/.well-known/security.txt",
    "/12axes/LICENSE-12axes.txt", "/connect/", "/connect/connect.css", "/login/",
    "/play/land.json", "/pool/ws", "/cambio/", "/poker/", "/testimony", "/dbz",
  ]) {
    assert.equal(blocked(p), false, p);
  }
});

test("every tracked page, script, stylesheet and asset a visitor needs stays public", () => {
  const files = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8", maxBuffer: 1 << 26 })
    .split("\0")
    .filter(Boolean)
    .filter((f) => /\.(html|css|js|json|geojson|csv|woff2|jpg|jpeg|png|svg|ico|webmanifest|xml|txt)$/.test(f))
    .filter((f) => !/^(play-src|pool-worker|historybowl-worker|functions|scripts|test|db)\//.test(f) && f !== "_routes.json");
  assert.ok(files.length > 100);
  for (const f of files) assert.equal(blocked(`/${f}`), false, f);
});

test("a blocked path gets the site's 404 and never reaches the asset behind it", async () => {
  const asked = [];
  const response = await onRequest({
    request: new Request("https://conradgelber.com/DEPLOY.md"),
    env: { ASSETS: { fetch: async (url) => { asked.push(url.pathname); return new Response("missing", { status: 404 }); } } },
    next: async () => assert.fail("next() must not run for a blocked path"),
  });
  assert.equal(response.status, 404);
  assert.deepEqual(asked, ["/__not_found__"]);
});

test("a public path passes straight through", async () => {
  const response = await onRequest({
    request: new Request("https://conradgelber.com/changelog/"),
    env: {},
    next: async () => new Response("page"),
  });
  assert.equal(await response.text(), "page");
});

const SPELLINGS = (name, file) => [
  `/${name}`, `/${name}/`, `//${name}/`, `/${name}%2f`, `/${name}%2F`, `/${name}//`, `/${name}/./`,
  `/${name}/x/../`, `///${name}/${file}`, `/${name.toUpperCase()}/`, `/%${name.charCodeAt(0).toString(16)}${name.slice(1)}/`,
  `/${name}%252f`, `/${name}%2f${file}`, `/${name}/${file}`, `/${name}/index.html`, `/${name}\\`,
  `/a/../${name}/`, `/fonts/..%2f${name}/`, `/${name}.html`, `/${name};x`,
];
const FILES = { hurricanes: "data/index.json", observatory: "observatory.css" };

test("every spelling of a private folder is gated, and lookalikes are not", () => {
  for (const [name, file] of Object.entries(FILES)) {
    for (const p of SPELLINGS(name, file)) assert.equal(isGatedPath(resolvePath(p)), true, p);
  }
  for (const p of ["/hubble", "/hurricanes-old/", "/observatory2/", "/aspen/", "/built/"]) {
    assert.equal(isGatedPath(resolvePath(p)), false, p);
  }
  assert.equal(gatedCanonical(resolvePath("//HURRICANES/data/index.json")), "/hurricanes/data/index.json");
  assert.equal(gatedCanonical(resolvePath("/observatory.html")), null);
});

const sessionRows = new Map();
const sessionDB = {
  prepare(sql) {
    return { bind(...values) { return {
      async run() {
        if (sql.startsWith('INSERT INTO hub_sessions')) sessionRows.set(values[0], values[1]);
        else if (sql.startsWith('DELETE FROM hub_sessions WHERE expires')) {
          for (const [nonce, expires] of sessionRows) if (expires < values[0]) sessionRows.delete(nonce);
        } else if (sql.startsWith('DELETE FROM hub_sessions WHERE nonce')) sessionRows.delete(values[0]);
      },
      async first() { return sessionRows.get(values[0]) > values[1] ? {nonce: values[0]} : null; },
    }; } };
  },
};
const SESSION_ENV = {
  PIN_SALT_B64: "AA==", PIN_HASH_B64: "AA==", SESSION_SECRET: "test-only", DB: sessionDB,
  ASSETS: { fetch: async () => new Response("missing", { status: 404 }) },
};
const refuseNext = async () => assert.fail("next() must not run without a session");

test("no session never reaches a private folder's files", async () => {
  for (const [name, file] of Object.entries(FILES)) {
    for (const p of SPELLINGS(name, file)) {
      // new Request() would tidy the path, so hand over a URL-like raw pathname.
      const request = { url: `https://conradgelber.com${p.replace(/\\/g, "%5C")}`, headers: new Headers() };
      const res = await onRequest({ request, env: SESSION_ENV, next: refuseNext });
      assert.ok(res.status === 303 || res.status === 401, `${p} -> ${res.status}`);
      assert.match(res.headers.get("X-Robots-Tag"), /noindex/);
      assert.match(res.headers.get("Cache-Control"), /no-store/);
    }
  }
  for (const gate of [hurricaneGate, observatoryGate]) {
    const res = await gate({ request: new Request("https://conradgelber.com/x/a.json"), env: SESSION_ENV, next: refuseNext });
    assert.equal(res.status, 401);
  }
});

test("a session reaches the canonical path, and odd spellings redirect to it", async () => {
  const cookie = (await newSessionCookie(SESSION_ENV)).split(";")[0];
  const asked = (path) => ({ request: new Request(`https://conradgelber.com${path}`, { headers: { Cookie: cookie } }), env: SESSION_ENV, next: async () => new Response("file") });
  assert.equal((await onRequest(asked("/hurricanes/"))).status, 200);
  assert.equal((await onRequest(asked("/observatory/"))).status, 200);
  const odd = await onRequest(asked("/HURRICANES/data/index.json?v=1"));
  assert.equal(odd.status, 303);
  assert.equal(odd.headers.get("Location"), "/hurricanes/data/index.json?v=1");
  assert.equal((await onRequest(asked("/hurricanes/README.md"))).status, 404);
});

test("private folders stay noindexed, uncached and keep the policy each page needs", async () => {
  const cookie = (await newSessionCookie(SESSION_ENV)).split(";")[0];
  const ctx = (path) => ({ request: new Request(`https://conradgelber.com${path}`, { headers: { Cookie: cookie } }), env: SESSION_ENV, next: async () => new Response("file", { headers: { "Access-Control-Allow-Origin": "*" } }) });
  const hurricane = await hurricaneGate(ctx("/hurricanes/"));
  const observatory = await observatoryGate(ctx("/observatory/"));
  for (const res of [hurricane, observatory]) {
    assert.match(res.headers.get("X-Robots-Tag"), /noindex/);
    assert.match(res.headers.get("Cache-Control"), /no-store/);
    assert.equal(res.headers.get("Access-Control-Allow-Origin"), null);
  }
  const csp = hurricane.headers.get("Content-Security-Policy");
  assert.match(csp, /script-src 'self' 'wasm-unsafe-eval' https:\/\/cesium\.com/);
  assert.match(csp, /connect-src 'self' https:\/\/services\.arcgisonline\.com/);
  assert.match(csp, /worker-src 'self' blob:/);
});

test("both private pages carry a robots meta tag and the hub lists them", () => {
  for (const page of ["hurricanes/index.html", "observatory/index.html", "hub/index.html"]) {
    assert.match(readFileSync(page, "utf8"), /<meta name="robots" content="noindex, nofollow">/, page);
  }
  const routes = JSON.parse(readFileSync("hub/tools.json", "utf8")).tools.map((t) => t.route);
  assert.ok(routes.includes("/hurricanes/") && routes.includes("/observatory/"));
});

test("no public page, sitemap or robots file points at a private folder", () => {
  const files = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8", maxBuffer: 1 << 26 }).split("\0")
    .filter((f) => /\.(html|js|json|xml|txt|webmanifest)$/.test(f))
    .filter((f) => !/^(hurricanes|observatory|hub|floorplan|play-src|pool-worker|historybowl-worker|functions|scripts|test|db)\//.test(f));
  assert.ok(files.length > 20);
  for (const f of files) {
    assert.doesNotMatch(readFileSync(f, "utf8"), /["'/]hurricanes\/|\/observatory\//, f);
  }
});
