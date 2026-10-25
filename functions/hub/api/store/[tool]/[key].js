// /hub/api/store/<tool>/<key>
//   GET     -> { value, version, updatedAt } or 404
//   PUT     -> body is any JSON value; returns { value, version, updatedAt }
//              If-Match: "<version>" writes only over that version (else 412)
//              If-None-Match: *      writes only if the key is new (else 412)
//   DELETE  -> 204
// The session check is in functions/hub/_middleware.js.

import { json, sameOrigin } from "../../../../_lib/auth.js";
import { MAX_BYTES, validTool, validKey, etag, parseVersion } from "../../../../_lib/store.js";

function badName(params) {
  if (!validTool(params.tool)) return json({ error: "bad tool name" }, 400);
  if (!validKey(params.key)) return json({ error: "bad key" }, 400);
  return null;
}

export async function onRequestGet({ params, env }) {
  const bad = badName(params);
  if (bad) return bad;
  const row = await env.DB
    .prepare("SELECT value, version, updated_at FROM store WHERE tool = ?1 AND key = ?2")
    .bind(params.tool, params.key)
    .first();
  if (!row) return json({ error: "not found" }, 404);
  return json({ value: JSON.parse(row.value), version: row.version, updatedAt: row.updated_at }, 200, { ETag: etag(row.version) });
}

export async function onRequestPut({ request, params, env }) {
  const bad = badName(params);
  if (bad) return bad;
  if (!sameOrigin(request)) return json({ error: "cross-origin" }, 403);

  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_BYTES) return json({ error: "too large" }, 413);
  let value;
  try { value = JSON.parse(text); } catch { return json({ error: "body must be JSON" }, 400); }
  const stored = JSON.stringify(value);
  const now = Date.now();

  const ifMatch = parseVersion(request.headers.get("If-Match"));
  const createOnly = (request.headers.get("If-None-Match") || "").trim() === "*";
  let stmt;
  if (ifMatch !== null) {
    stmt = env.DB.prepare(
      `UPDATE store SET value = ?3, version = version + 1, updated_at = ?4
       WHERE tool = ?1 AND key = ?2 AND version = ?5 RETURNING version, updated_at`
    ).bind(params.tool, params.key, stored, now, ifMatch);
  } else if (createOnly) {
    stmt = env.DB.prepare(
      `INSERT INTO store (tool, key, value, version, updated_at) VALUES (?1, ?2, ?3, 1, ?4)
       ON CONFLICT(tool, key) DO NOTHING RETURNING version, updated_at`
    ).bind(params.tool, params.key, stored, now);
  } else {
    stmt = env.DB.prepare(
      `INSERT INTO store (tool, key, value, version, updated_at) VALUES (?1, ?2, ?3, 1, ?4)
       ON CONFLICT(tool, key) DO UPDATE SET value = ?3, version = version + 1, updated_at = ?4
       RETURNING version, updated_at`
    ).bind(params.tool, params.key, stored, now);
  }
  const row = await stmt.first();
  if (!row) return json({ error: "changed elsewhere; reload and retry" }, 412);
  return json({ value, version: row.version, updatedAt: row.updated_at }, 200, { ETag: etag(row.version) });
}

export async function onRequestDelete({ request, params, env }) {
  const bad = badName(params);
  if (bad) return bad;
  if (!sameOrigin(request)) return json({ error: "cross-origin" }, 403);
  await env.DB.prepare("DELETE FROM store WHERE tool = ?1 AND key = ?2").bind(params.tool, params.key).run();
  return new Response(null, { status: 204, headers: { "Cache-Control": "private, no-store" } });
}
