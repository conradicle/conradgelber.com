// Builds js/site-index.json, the command palette's search list, from the site's
// own pages. Run it locally and commit the result; Cloudflare has no build step:
//
//   node scripts/build-site-index.mjs
//
// test/site-index.test.mjs fails if the committed file is out of date.
//
// Sources: sitemap.xml for pages, /games/ and /built/ entries, /writing/ essays.
// Nothing private can get in: the sitemap leaves those pages out, and anything
// under a gated folder or /login/ is dropped here as well.

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolvePath, isGatedPath } from "../functions/_lib/paths.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "js", "site-index.json");
const ORIGIN = "https://conradgelber.com";
const SITE_SUFFIX = /\s*(&middot;|·)\s*Conrad Gelber\s*$/;

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", middot: "·", ouml: "ö", ndash: "–", mdash: "—", rsquo: "'", larr: "←" };

function text(html) {
  return html
    .replace(/<[^>]+>/g, "")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&([a-z]+);/gi, (m, name) => ENTITIES[name] ?? m)
    .replace(/\s+/g, " ")
    .trim();
}

function page(path) {
  const file = join(ROOT, path === "/" ? "index.html" : path.slice(1) + "index.html");
  return readFileSync(file, "utf8").replace(/<!--[\s\S]*?-->/g, "");
}

function isPrivate(url) {
  if (!url.startsWith("/")) return false;
  const resolved = resolvePath(url.split(/[?#]/)[0]);
  return isGatedPath(resolved) || /^\/login(\/|$)/i.test(resolved);
}

// Each .entry on /games/ and /built/ has one linked h2.
function entries(path, group) {
  return [...page(path).matchAll(/<div class="entry">[\s\S]*?<h2><a href="([^"]+)">([\s\S]*?)<\/a><\/h2>/g)].map((m) => ({
    group,
    title: text(m[2]),
    url: m[1].startsWith(ORIGIN) ? m[1].slice(ORIGIN.length) || "/" : m[1],
  }));
}

// Essays have no pages of their own, so a text fragment scrolls to the title
// without any change to the /writing/ markup. Browsers without text fragments
// land at the top of /writing/.
function essays() {
  return [...page("/writing/").matchAll(/<div class="paper">\s*<h2>([\s\S]*?)<\/h2>/g)].map((m) => {
    const title = text(m[1]);
    return { group: "Writing", title, url: "/writing/#:~:text=" + encodeURIComponent(title).replace(/-/g, "%2D") };
  });
}

function pages(taken) {
  const home = page("/");
  const tabs = new Map([...home.matchAll(/<nav class="tabs"[\s\S]*?<\/nav>/g)].flatMap((nav) =>
    [...nav[0].matchAll(/<a href="([^"]+)">([^<]+)<\/a>/g)].map((m) => [m[1], m[2]])));
  const sitemap = readFileSync(join(ROOT, "sitemap.xml"), "utf8");
  // Home, then the tabs in their order, then everything else.
  const order = ["/", ...tabs.keys()];
  const place = (path) => (order.includes(path) ? order.indexOf(path) : order.length);
  return [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)]
    .map((m) => m[1].slice(ORIGIN.length))
    .filter((path) => !taken.has(path))
    .sort((a, b) => place(a) - place(b))
    .map((path) => {
      const title = path === "/" ? "Home" : text(page(path).match(/<title>([\s\S]*?)<\/title>/)[1].replace(SITE_SUFFIX, ""));
      const item = { group: "Pages", title, url: path };
      if (tabs.has(path) && tabs.get(path) !== title) item.keywords = tabs.get(path);
      return item;
    });
}

function contactLinks() {
  const footer = page("/").match(/<div class="contact">[\s\S]*?<\/div>/)[0];
  const find = (pattern) => footer.match(pattern)?.[1];
  return {
    email: find(/href="mailto:([^"]+)"/),
    linkedin: find(/href="(https:\/\/www\.linkedin\.com[^"]+)"/),
    github: find(/href="(https:\/\/github\.com[^"]+)"/),
  };
}

export function buildIndex() {
  const games = entries("/games/", "Games");
  const built = entries("/built/", "Built");
  const taken = new Set([...games, ...built].map((item) => item.url));
  const items = [...pages(taken), ...games, ...essays(), ...built].filter((item) => !isPrivate(item.url));
  return { links: contactLinks(), items };
}

export function renderIndex() {
  return JSON.stringify(buildIndex(), null, 2) + "\n";
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  writeFileSync(OUT, renderIndex());
  console.log("wrote js/site-index.json");
}
