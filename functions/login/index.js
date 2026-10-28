// /login: GET shows the static login/index.html with any error message
// filled in; POST checks the PIN server-side and sets the session cookie.

import {
  configured, pinMatches, hasSession, newSessionCookie, sameOrigin,
  clientKey, redirect, privatize,
} from "../_lib/auth.js";
import { hashClient, reserveAttempt, clearAttempts, pruneAttempts } from "../_lib/limiter.js";

const PIN_MIN = 8;
const PIN_MAX = 128;

function minutes(ms) {
  return Math.max(1, Math.ceil(ms / 60000));
}

function waitText(m) {
  if (m < 120) return `${m} minute${m === 1 ? "" : "s"}`;
  const h = Math.ceil(m / 60);
  return `${h} hours`;
}

const MESSAGES = {
  wrong: () => "That PIN is not right.",
  short: () => `The PIN is at least ${PIN_MIN} characters.`,
  locked: (m) => `Too many tries. Try again in ${waitText(m)}.`,
  off: () => "Sign-in is not set up yet.",
};

function showMessage(res, text) {
  if (!res.headers.get("Content-Type")?.includes("text/html")) return res;
  return new HTMLRewriter()
    .on("#login-msg", {
      element(el) {
        el.setInnerContent(text);
        el.removeAttribute("hidden");
      },
    })
    .transform(res);
}

export async function onRequestGet({ request, env, next }) {
  if (await hasSession(request, env)) return redirect("/hub/");
  const res = privatize(await next());
  const url = new URL(request.url);
  const make = MESSAGES[url.searchParams.get("e")];
  if (!make) return res;
  const m = Math.min(1440, Math.max(1, parseInt(url.searchParams.get("m"), 10) || 15));
  return showMessage(res, make(m));
}

// 429 with Retry-After, and the login page as the body so a browser that
// posted the form still sees a page with the reason on it.
async function tooMany(request, env, retryMs) {
  const page = await env.ASSETS.fetch(new URL("/login/", request.url));
  const res = privatize(new Response(page.body, { status: 429, headers: page.headers }));
  res.headers.set("Retry-After", String(Math.max(1, Math.ceil(retryMs / 1000))));
  return showMessage(res, MESSAGES.locked(minutes(retryMs)));
}

export async function onRequestPost({ request, env, waitUntil }) {
  if (!sameOrigin(request)) return new Response("Forbidden", { status: 403 });
  if (!configured(env)) return redirect("/login/?e=off");

  let pin = "";
  try {
    pin = String((await request.formData()).get("pin") || "");
  } catch {}
  // Can never match, so it is turned away without costing a try.
  if (pin.length < PIN_MIN || pin.length > PIN_MAX) return redirect("/login/?e=short");

  // Limits first: a locked-out client never reaches the PIN check.
  const ipHash = await hashClient(clientKey(request), env.SESSION_SECRET);
  const slot = await reserveAttempt(env.DB, ipHash);
  if (!slot.allowed) return tooMany(request, env, slot.retryMs);

  if (await pinMatches(pin, env)) {
    await clearAttempts(env.DB, ipHash);
    return redirect("/hub/", { "Set-Cookie": await newSessionCookie(env) });
  }

  // The reserved row stays as this failure.
  waitUntil(pruneAttempts(env.DB));
  return redirect("/login/?e=wrong");
}

// HEAD gets the same headers as GET.
export const onRequestHead = onRequestGet;
