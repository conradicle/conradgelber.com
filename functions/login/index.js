// /login: GET shows the static login/index.html with any error message
// filled in; POST checks the PIN server-side and sets the session cookie.

import {
  configured, pinMatches, hasSession, newSessionCookie, sameOrigin,
  clientKey, redirect, privatize,
} from "../_lib/auth.js";
import { reserveAttempt, recordFailure, clearAttempts } from "../_lib/limiter.js";

function minutes(ms) {
  return Math.max(1, Math.ceil(ms / 60000));
}

const MESSAGES = {
  wrong: () => "That PIN is not right.",
  locked: (m) => `Too many tries. Try again in ${m} minute${m === "1" ? "" : "s"}.`,
  off: () => "Sign-in is not set up yet.",
};

export async function onRequestGet({ request, env, next }) {
  if (await hasSession(request, env)) return redirect("/hub/");
  const res = privatize(await next());
  const url = new URL(request.url);
  const make = MESSAGES[url.searchParams.get("e")];
  if (!make || !res.headers.get("Content-Type")?.includes("text/html")) return res;
  const m = String(Math.min(1440, Math.max(1, parseInt(url.searchParams.get("m"), 10) || 15)));
  return new HTMLRewriter()
    .on("#login-msg", {
      element(el) {
        el.setInnerContent(make(m));
        el.removeAttribute("hidden");
      },
    })
    .transform(res);
}

export async function onRequestPost({ request, env }) {
  if (!sameOrigin(request)) return new Response("Forbidden", { status: 403 });
  if (!configured(env)) return redirect("/login/?e=off");

  const key = clientKey(request);
  const slot = await reserveAttempt(env.DB, key);
  if (!slot.allowed) return redirect(`/login/?e=locked&m=${minutes(slot.retryMs)}`);

  let pin = "";
  try {
    pin = String((await request.formData()).get("pin") || "");
  } catch {}

  if (/^\d{1,32}$/.test(pin) && (await pinMatches(pin, env))) {
    await clearAttempts(env.DB, key);
    return redirect("/hub/", { "Set-Cookie": await newSessionCookie(env) });
  }

  const locked = await recordFailure(env.DB, key, slot.fails);
  if (locked) return redirect(`/login/?e=locked&m=${minutes(locked)}`);
  return redirect("/login/?e=wrong");
}

// HEAD gets the same headers as GET.
export const onRequestHead = onRequestGet;
