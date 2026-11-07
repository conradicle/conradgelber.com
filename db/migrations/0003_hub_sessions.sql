CREATE TABLE hub_sessions (nonce TEXT PRIMARY KEY, expires INTEGER NOT NULL);
CREATE INDEX hub_sessions_expires ON hub_sessions (expires);
