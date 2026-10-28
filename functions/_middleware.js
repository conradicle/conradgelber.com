// Runs before every request to the site, static files included (see
// _routes.json). It decides on the canonical path, not the raw one: anything
// that resolves into /hub needs a session, however it is spelled. See
// functions/_lib/paths.js for why the hub middleware alone isn't enough.

import { hasSession, redirect, signedOut } from "./_lib/auth.js";
import { resolvePath, isHubPath, hubCanonical } from "./_lib/paths.js";

export async function onRequest({ request, env, next }) {
  const url = new URL(request.url);
  const resolved = resolvePath(url.pathname);
  if (!isHubPath(resolved)) return next();

  if (!(await hasSession(request, env))) return signedOut(resolved);

  // Signed in but spelled oddly ("//hub/", "/HUB/"): send the browser to the
  // canonical URL rather than let the asset server guess.
  const canonical = hubCanonical(resolved);
  if (canonical === null) return redirect("/hub/");
  if (canonical !== url.pathname) return redirect(canonical + url.search);

  // Canonical: functions/hub/_middleware.js runs next.
  return next();
}
