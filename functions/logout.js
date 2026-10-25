// POST /logout clears the session cookie. The hub's Log out button posts here.

import { clearSessionCookie, sameOrigin, redirect } from "./_lib/auth.js";

export async function onRequestPost({ request }) {
  if (!sameOrigin(request)) return new Response("Forbidden", { status: 403 });
  return redirect("/login/", { "Set-Cookie": clearSessionCookie });
}
