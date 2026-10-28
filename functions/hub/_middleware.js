// Runs before every request under /hub: pages, tool files, tools.json and the
// storage API. No session means a redirect to /login/ for a page, or a 401
// for anything else. functions/_middleware.js has already done the same
// check on the canonical path; this one stays as a second layer and marks
// the response private.

import { hasSession, signedOut, privatize } from "../_lib/auth.js";

export async function onRequest({ request, env, next }) {
  if (!(await hasSession(request, env))) return signedOut(new URL(request.url).pathname);
  return privatize(await next());
}
