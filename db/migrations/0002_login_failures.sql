-- Failed PIN attempts as one row each: a keyed hash of the client (IPv4
-- address or IPv6 /64, never stored in the clear) and when it happened.
-- Replaces login_attempts' per-client counter so a global cap across all
-- clients can be counted too. See functions/_lib/limiter.js.
CREATE TABLE login_failures (
  id      INTEGER PRIMARY KEY,
  ip_hash TEXT    NOT NULL,
  at      INTEGER NOT NULL
);
CREATE INDEX login_failures_ip_at ON login_failures (ip_hash, at);
CREATE INDEX login_failures_at ON login_failures (at);

DROP TABLE login_attempts;
