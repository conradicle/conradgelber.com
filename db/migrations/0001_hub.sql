-- The hub's D1 database (binding DB in wrangler.jsonc).

-- Shared tool storage: one JSON value per (tool, key).
CREATE TABLE store (
  tool       TEXT    NOT NULL,
  key        TEXT    NOT NULL,
  value      TEXT    NOT NULL,
  version    INTEGER NOT NULL DEFAULT 1,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (tool, key)
);

-- Failed PIN attempts per client (IPv4 address or IPv6 /64).
CREATE TABLE login_attempts (
  ip           TEXT    PRIMARY KEY,
  fails        INTEGER NOT NULL DEFAULT 0,
  lockouts     INTEGER NOT NULL DEFAULT 0,
  locked_until INTEGER NOT NULL DEFAULT 0,
  updated_at   INTEGER NOT NULL
);
