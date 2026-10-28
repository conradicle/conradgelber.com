// Shared server code for /login, /logout and everything under /hub.
// No secrets live in this file: the repo is public and Pages serves it.
// PIN_SALT_B64, PIN_HASH_B64 and SESSION_SECRET are Pages secrets, and the
// DB binding is the D1 database named in wrangler.jsonc. See ADDING_TOOLS.md.

import { isPagePath } from "./paths.js";

export const COOKIE = "__Host-hub";
const SESSION_DAYS = 30;
const PBKDF2_ITERATIONS = 100000; // the Workers WebCrypto maximum

const enc = new TextEncoder();

function b64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToB64url(bytes) {
  let bin = "";
  for (const b of new Uint8Array(bytes)) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlToBytes(s) {
  return b64ToBytes(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4));
}

// Equal-length byte arrays only; the length itself is not secret.
function timingSafeEqual(a, b) {
  if (a.byteLength !== b.byteLength) return false;
  if (crypto.subtle.timingSafeEqual) return crypto.subtle.timingSafeEqual(a, b);
  let diff = 0;
  for (let i = 0; i < a.byteLength; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

export function configured(env) {
  return Boolean(env.PIN_SALT_B64 && env.PIN_HASH_B64 && env.SESSION_SECRET && env.DB);
}

export async function pinMatches(pin, env) {
  const expected = b64ToBytes(env.PIN_HASH_B64);
  const key = await crypto.subtle.importKey("raw", enc.encode(pin), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: b64ToBytes(env.PIN_SALT_B64), iterations: PBKDF2_ITERATIONS },
    key,
    expected.byteLength * 8
  );
  return timingSafeEqual(new Uint8Array(bits), expected);
}

function hmacKey(env) {
  return crypto.subtle.importKey("raw", enc.encode(env.SESSION_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

// Cookie value: <expiry ms>.<random nonce>.<HMAC of both>
export async function newSessionCookie(env) {
  const exp = Date.now() + SESSION_DAYS * 86400000;
  const nonce = bytesToB64url(crypto.getRandomValues(new Uint8Array(16)));
  const payload = `${exp}.${nonce}`;
  const sig = await crypto.subtle.sign("HMAC", await hmacKey(env), enc.encode("hub-session-v1." + payload));
  return `${COOKIE}=${payload}.${bytesToB64url(sig)}; Path=/; Max-Age=${SESSION_DAYS * 86400}; HttpOnly; Secure; SameSite=Strict`;
}

export const clearSessionCookie = `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict`;

export async function hasSession(request, env) {
  if (!configured(env)) return false; // fail closed, e.g. on a preview deploy without secrets
  const raw = (request.headers.get("Cookie") || "")
    .split(/;\s*/)
    .find((c) => c.startsWith(COOKIE + "="));
  if (!raw) return false;
  const parts = raw.slice(COOKIE.length + 1).split(".");
  if (parts.length !== 3 || !/^\d{13}$/.test(parts[0])) return false;
  if (Number(parts[0]) < Date.now()) return false;
  let sig;
  try { sig = b64urlToBytes(parts[2]); } catch { return false; }
  // subtle.verify compares the MAC in constant time.
  return crypto.subtle.verify("HMAC", await hmacKey(env), sig, enc.encode(`hub-session-v1.${parts[0]}.${parts[1]}`));
}

// State-changing requests must come from a page on this origin.
export function sameOrigin(request) {
  return request.headers.get("Origin") === new URL(request.url).origin;
}

// IPv6 clients usually control a whole /64, so count those together.
export function clientKey(request) {
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  if (!ip.includes(":")) return ip;
  const groups = ip.split("::");
  const head = groups[0].split(":").filter(Boolean);
  const tail = groups.length > 1 ? groups[1].split(":").filter(Boolean) : [];
  const full = [...head, ...Array(8 - head.length - tail.length).fill("0"), ...tail];
  return full.slice(0, 4).join(":") + "::/64";
}

// Headers for responses a Function builds itself; _headers covers only
// static files. Everything behind the login is private and never cached.
const BASE_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Strict-Transport-Security": "max-age=63072000; includeSubDomains",
  "X-Robots-Tag": "noindex, nofollow",
  "Cache-Control": "private, no-store",
};

// The site CSP with form-action opened to 'self' so the login and logout
// forms can post, and framing allowed within the site so a tool can wrap a
// self-contained app in an iframe. Replaces the _headers policy rather than
// adding a second one.
export const PRIVATE_CSP =
  "default-src 'none'; script-src 'self'; connect-src 'self'; style-src 'self'; font-src 'self'; img-src 'self'; manifest-src 'self'; base-uri 'none'; form-action 'self'; frame-src 'self'; frame-ancestors 'self'";

export function privateHeaders(headers) {
  for (const [k, v] of Object.entries(BASE_HEADERS)) headers.set(k, v);
  headers.set("Content-Security-Policy", PRIVATE_CSP);
  headers.delete("Access-Control-Allow-Origin"); // Pages adds * to static files
  return headers;
}

export function redirect(location, extra = {}) {
  const headers = privateHeaders(new Headers({ Location: location }));
  for (const [k, v] of Object.entries(extra)) headers.append(k, v);
  return new Response(null, { status: 303, headers });
}

// What a signed-out request into /hub gets: the login form for a page, a
// 401 for a script, JSON, an icon or the storage API.
export function signedOut(path) {
  if (isPagePath(path)) return redirect("/login/");
  return json({ error: "signed out" }, 401);
}

export function json(data, status = 200, extra = {}) {
  const headers = privateHeaders(new Headers({ "Content-Type": "application/json; charset=utf-8", ...extra }));
  return new Response(JSON.stringify(data), { status, headers });
}

// Re-wrap a static response so its headers can be changed.
export function privatize(response) {
  const res = new Response(response.body, response);
  privateHeaders(res.headers);
  return res;
}
