// Failed-PIN rate limit in D1 (table login_failures, one row per failure).
// Two sliding windows, both checked before the PIN is:
//   - per client: 5 failures in 15 minutes, then 429 until the oldest ages out;
//   - everyone:   30 failures in 24 hours, then every login gets 429. There is
//     one user, so this caps a guesser spread across many addresses.
//
// An attempt is reserved (its failure row written) before the PIN is
// checked, in one statement that also checks both limits, so a burst of
// parallel requests still gets only five guesses. A right PIN deletes the
// client's rows.

const IP_MAX = 5;
const IP_WINDOW_MS = 15 * 60 * 1000;
const ALL_MAX = 30;
const ALL_WINDOW_MS = 24 * 60 * 60 * 1000;

// Lockouts this isolate has already seen, so a client hammering away while
// locked costs no D1 reads. Only ever shortcuts to "no"; D1 decides "yes".
// Held for at most a minute, so clearing the table by hand takes effect soon.
const CACHE_MS = 60 * 1000;
// Each entry is { until, seen }: the real unlock time, trusted until seen + CACHE_MS.
const lockedIps = new Map();
let lockedAll = { until: 0, seen: 0 };

function cachedUntil(entry, now) {
  return entry && entry.seen + CACHE_MS > now && entry.until > now ? entry.until : 0;
}

const enc = new TextEncoder();

// HMAC with the session secret, so the stored hashes can't be reversed by
// hashing every IPv4 address.
export async function hashClient(key, secret) {
  const k = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", k, enc.encode("login-ip-v1." + key)));
  return Array.from(sig, (b) => b.toString(16).padStart(2, "0")).join("");
}

// Returns { allowed: true } with the attempt reserved, or
// { allowed: false, retryMs } with nothing written.
export async function reserveAttempt(db, ipHash, now = Date.now()) {
  const cached = Math.max(cachedUntil(lockedAll, now), cachedUntil(lockedIps.get(ipHash), now));
  if (cached > now) return { allowed: false, retryMs: cached - now };

  const row = await db
    .prepare(
      `INSERT INTO login_failures (ip_hash, at)
       SELECT ?1, ?2
       WHERE (SELECT COUNT(*) FROM login_failures WHERE ip_hash = ?1 AND at > ?2 - ?3) < ?4
         AND (SELECT COUNT(*) FROM login_failures WHERE at > ?2 - ?5) < ?6
       RETURNING id`
    )
    .bind(ipHash, now, IP_WINDOW_MS, IP_MAX, ALL_WINDOW_MS, ALL_MAX)
    .first();
  if (row) return { allowed: true };

  // Over a limit: work out when the window clears enough for one more try.
  const w = await db
    .prepare(
      `SELECT
         (SELECT COUNT(*) FROM login_failures WHERE ip_hash = ?1 AND at > ?2 - ?3) AS ip_n,
         (SELECT MIN(at)  FROM login_failures WHERE ip_hash = ?1 AND at > ?2 - ?3) AS ip_oldest,
         (SELECT COUNT(*) FROM login_failures WHERE at > ?2 - ?4) AS all_n,
         (SELECT MIN(at)  FROM login_failures WHERE at > ?2 - ?4) AS all_oldest`
    )
    .bind(ipHash, now, IP_WINDOW_MS, ALL_WINDOW_MS)
    .first();
  let until = now + 1000;
  if (w.ip_n >= IP_MAX) {
    const ipUntil = w.ip_oldest + IP_WINDOW_MS;
    lockedIps.set(ipHash, { until: ipUntil, seen: now });
    until = Math.max(until, ipUntil);
  }
  if (w.all_n >= ALL_MAX) {
    const allUntil = w.all_oldest + ALL_WINDOW_MS;
    lockedAll = { until: allUntil, seen: now };
    until = Math.max(until, allUntil);
  }
  if (lockedIps.size > 1000) lockedIps.clear();
  return { allowed: false, retryMs: until - now };
}

// After a right PIN: the client's failures (and the reserved attempt) go.
export async function clearAttempts(db, ipHash) {
  lockedIps.delete(ipHash);
  await db.prepare("DELETE FROM login_failures WHERE ip_hash = ?1").bind(ipHash).run();
}

// Rows older than both windows count for nothing.
export async function pruneAttempts(db, now = Date.now()) {
  await db.prepare("DELETE FROM login_failures WHERE at <= ?1").bind(now - ALL_WINDOW_MS).run();
}
