// Path canonicalization for the private-area gate. Pages' static asset server
// normalizes a path before it looks up a file ("//hub/", "/hub%2f" and
// "/%68ub/" all serve hub/index.html), but the Functions router matches the
// raw path, so functions/hub/_middleware.js alone never sees those requests.
// functions/_middleware.js runs on every request and decides on the path
// these functions produce instead.

// Percent-decodes until nothing changes (so "%252f" can't hide a slash),
// treats "\" as "/", collapses repeated slashes and resolves "." and "..".
// Keeps case and a trailing slash. Never throws: malformed escapes stay as
// they are.
export function resolvePath(raw) {
  let p = raw;
  for (let i = 0; i < 5; i++) {
    const d = p.replace(/%([0-9a-f]{2})/gi, (_, h) => String.fromCharCode(parseInt(h, 16)));
    if (d === p) break;
    p = d;
  }
  p = p.replace(/\\/g, "/");
  const out = [];
  for (const seg of p.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") out.pop();
    else out.push(seg);
  }
  const trailing = out.length > 0 && /\/\.{0,2}$/.test(p);
  return "/" + out.join("/") + (trailing ? "/" : "");
}

// True for anything that could land in a private folder: a first segment of
// one of these names in any case, or the name followed by a character that is
// not part of a normal name ("hub;x", "hub.html", "hub "). "/hubble" is not
// hub.
const GATED = ["hub", "hurricanes", "observatory"];
const GATED_FIRST = new RegExp(`^(${GATED.join("|")})(?![a-z0-9_-])`, "i");

export function isGatedPath(resolved) {
  return GATED_FIRST.test(resolved.split("/")[1] || "");
}

// The one spelling a private folder's own routes answer to: the resolved path
// with a lowercase folder name, or null when the first segment isn't exactly
// one of the names (e.g. "/hub.html"), which has no route.
export function gatedCanonical(resolved) {
  const [, first = "", ...rest] = resolved.split("/");
  const folder = first.toLowerCase();
  if (!GATED.includes(folder)) return null;
  return "/" + [folder, ...rest].join("/");
}

// The deploy serves the repo root, so docs, config and source that no page
// needs have to be turned away here. Same spelling rules as isGatedPath: any
// case, and a name followed by a character that can't be part of it still
// counts ("DEPLOY.md;x"). Takes a path from resolvePath.
const BLOCKED_FIRST =
  /^(play-src|pool-worker|historybowl-worker|floorplan|graphify-out|node_modules|functions|scripts|test|docs|db|wrangler\.jsonc|_headers|_routes\.json)(?![a-z0-9_-])/i;
const BLOCKED_ANY_DEPTH = /\.md(?![a-z0-9_-])/i;
const DOTFILE = /^\.(?!well-known$)/i;

export function isBlockedPath(resolved) {
  const segments = resolved.split("/").filter(Boolean);
  if (segments.length === 0) return false;
  if (BLOCKED_FIRST.test(segments[0])) return true;
  if (segments[0].toLowerCase() === "connect" && segments[1]?.toLowerCase() === "profile.mjs") return true;
  return segments.some((s) => BLOCKED_ANY_DEPTH.test(s) || DOTFILE.test(s));
}

// A page gets sent to the login form; anything else (a script, JSON, an icon,
// the storage API) gets a bare 401, which hub.js and lib/store.js turn into
// a trip to /login/.
export function isPagePath(resolved) {
  if (resolved.toLowerCase().startsWith("/hub/api/")) return false;
  const last = resolved.split("/").pop();
  return last === "" || !last.includes(".") || /\.html?$/i.test(last);
}
