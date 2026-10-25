// GET /hub/api/store/<tool>/ lists that tool's keys (no values).
// The session check is in functions/hub/_middleware.js.

import { json } from "../../../../_lib/auth.js";
import { validTool } from "../../../../_lib/store.js";

export async function onRequestGet({ params, env }) {
  if (!validTool(params.tool)) return json({ error: "bad tool name" }, 400);
  const { results } = await env.DB
    .prepare("SELECT key, version, updated_at AS updatedAt FROM store WHERE tool = ?1 ORDER BY key")
    .bind(params.tool)
    .all();
  return json({ keys: results });
}
