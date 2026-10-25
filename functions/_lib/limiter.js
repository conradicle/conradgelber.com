// Failed-PIN rate limit, one row per client in D1 (table login_attempts).
// Five failures lock the client out for 15 minutes; each later lockout
// doubles, up to a day. A day with no attempts forgets past lockouts.
//
// An attempt is reserved before the PIN is checked, in one atomic statement,
// so a burst of parallel requests still gets only five guesses per window.

const MAX_FAILS = 5;
const BASE_LOCK_MS = 15 * 60 * 1000;
const MAX_LOCK_MS = 24 * 60 * 60 * 1000;
const FORGET_MS = 24 * 60 * 60 * 1000;

// Returns { allowed: true, fails } or { allowed: false, retryMs }.
export async function reserveAttempt(db, key, now = Date.now()) {
  const row = await db
    .prepare(
      `INSERT INTO login_attempts (ip, fails, lockouts, locked_until, updated_at)
       VALUES (?1, 1, 0, 0, ?2)
       ON CONFLICT(ip) DO UPDATE SET
         lockouts = CASE WHEN locked_until <= ?2 AND updated_at < ?2 - ?3 THEN 0 ELSE lockouts END,
         fails = CASE WHEN locked_until > ?2 THEN fails
                      WHEN updated_at < ?2 - ?3 THEN 1
                      ELSE fails + 1 END,
         updated_at = CASE WHEN locked_until > ?2 THEN updated_at ELSE ?2 END
       RETURNING fails, locked_until`
    )
    .bind(key, now, FORGET_MS)
    .first();
  if (row.locked_until > now) return { allowed: false, retryMs: row.locked_until - now };
  // Over the limit but not yet locked: a parallel request is about to lock it.
  if (row.fails > MAX_FAILS) return { allowed: false, retryMs: BASE_LOCK_MS };
  return { allowed: true, fails: row.fails };
}

// Called after a wrong PIN. Returns the lockout length if this one locked.
export async function recordFailure(db, key, fails, now = Date.now()) {
  if (fails < MAX_FAILS) return 0;
  const row = await db
    .prepare(
      `UPDATE login_attempts SET lockouts = lockouts + 1, fails = 0,
         locked_until = ?2 + MIN(?3 * (1 << lockouts), ?4), updated_at = ?2
       WHERE ip = ?1 RETURNING locked_until`
    )
    .bind(key, now, BASE_LOCK_MS, MAX_LOCK_MS)
    .first();
  return row ? row.locked_until - now : BASE_LOCK_MS;
}

export async function clearAttempts(db, key) {
  await db.prepare("DELETE FROM login_attempts WHERE ip = ?1").bind(key).run();
}
