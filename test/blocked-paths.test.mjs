import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { onRequest } from "../functions/_middleware.js";
import { resolvePath, isBlockedPath } from "../functions/_lib/paths.js";

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
