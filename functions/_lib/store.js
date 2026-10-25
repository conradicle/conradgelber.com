// The shared storage API's checks and rows. Each tool gets its own namespace
// (the tool's folder name); each key holds one JSON value with a version
// number that goes up by one on every write.

export const MAX_BYTES = 512 * 1024;

export const validTool = (s) => /^[a-z0-9][a-z0-9-]{0,63}$/.test(s);
export const validKey = (s) => /^[A-Za-z0-9._-]{1,128}$/.test(s);

export function etag(version) {
  return `"${version}"`;
}

// "If-Match: "7"" -> 7; anything else -> null
export function parseVersion(header) {
  const m = /^"(\d+)"$/.exec((header || "").trim());
  return m ? Number(m[1]) : null;
}
