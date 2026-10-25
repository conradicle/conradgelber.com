// Runs before every request under /hub: pages, tool files, tools.json and the
// storage API. No session means a redirect to /login/ (or a 401 for the API).

import { hasSession, json, redirect, privatize } from "../_lib/auth.js";

export async function onRequest({ request, env, next }) {
  if (!(await hasSession(request, env))) {
    const { pathname } = new URL(request.url);
    if (pathname.startsWith("/hub/api/")) return json({ error: "signed out" }, 401);
    return redirect("/login/");
  }
  return privatize(await next());
}
