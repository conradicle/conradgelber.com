// POST /logout clears the session cookie. The hub's Log out button posts here.

import { clearSessionCookie, sameOrigin, redirect, revokeSession } from "./_lib/auth.js";

export async function onRequestPost({ request, env }) {
  if (!sameOrigin(request)) return new Response("Forbidden", { status: 403 });
  await revokeSession(request, env);
  return redirect("/login/", { "Set-Cookie": clearSessionCookie });
}
