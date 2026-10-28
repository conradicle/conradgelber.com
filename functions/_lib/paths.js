// Path canonicalization for the hub gate. Pages' static asset server
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

// True for anything that could land in /hub: a first segment of "hub" in any
// case, or "hub" followed by a character that is not part of a normal name
// ("hub;x", "hub.html", "hub "). "/hubble" is not hub.
export function isHubPath(resolved) {
  const first = resolved.split("/")[1] || "";
  return /^hub(?![a-z0-9_-])/i.test(first);
}

// The one spelling the hub's own routes answer to: the resolved path with a
// lowercase "/hub" prefix, or null when the first segment isn't exactly
// "hub" (e.g. "/hub.html"), which has no hub route.
export function hubCanonical(resolved) {
  const [, first = "", ...rest] = resolved.split("/");
  if (first.toLowerCase() !== "hub") return null;
  return "/" + ["hub", ...rest].join("/");
}

// A page gets sent to the login form; anything else (a script, JSON, an icon,
// the storage API) gets a bare 401, which hub.js and lib/store.js turn into
// a trip to /login/.
export function isPagePath(resolved) {
  if (resolved.toLowerCase().startsWith("/hub/api/")) return false;
  const last = resolved.split("/").pop();
  return last === "" || !last.includes(".") || /\.html?$/i.test(last);
}
