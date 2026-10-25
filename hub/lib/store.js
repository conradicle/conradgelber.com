// Client for the hub's storage API. Any tool can import it:
//
//   import { toolStore } from "/hub/lib/store.js";
//   const store = toolStore("daily-tasks");      // the tool's folder name
//   const doc = await store.get("state");        // { value, version } or null
//   await store.set("state", value);             // last write wins
//   await store.update("state", (v) => { v.n++; return v; }, { n: 0 });
//
// Data lives in D1 on the server, so it is the same on every device.
// update() is the safe way to change data that another device may also be
// changing: it reads the latest version, applies fn, and writes only over
// that version, retrying if another write got in first. fn must be safe to
// run more than once.

function signedOut() {
  location.href = "/login/";
  return new Error("signed out");
}

async function call(url, init = {}) {
  const res = await fetch(url, { cache: "no-store", ...init });
  if (res.status === 401) throw signedOut();
  return res;
}

export function toolStore(tool) {
  const base = `/hub/api/store/${encodeURIComponent(tool)}/`;
  const url = (key) => base + encodeURIComponent(key);

  async function get(key) {
    const res = await call(url(key));
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`load failed (${res.status})`);
    return res.json();
  }

  // version: a number to write only over that version, "new" to write only
  // if the key does not exist, or undefined to overwrite.
  // Returns { value, version }, or null if the version check failed.
  async function set(key, value, version) {
    const headers = { "Content-Type": "application/json" };
    if (typeof version === "number") headers["If-Match"] = `"${version}"`;
    if (version === "new") headers["If-None-Match"] = "*";
    const res = await call(url(key), { method: "PUT", headers, body: JSON.stringify(value) });
    if (res.status === 412) return null;
    if (!res.ok) throw new Error(`save failed (${res.status})`);
    return res.json();
  }

  async function update(key, fn, initial) {
    for (let i = 0; i < 6; i++) {
      const cur = await get(key);
      const start = cur ? cur.value : structuredClone(initial);
      const saved = await set(key, fn(start), cur ? cur.version : "new");
      if (saved) return saved;
    }
    throw new Error("save kept colliding with another device");
  }

  async function remove(key) {
    const res = await call(url(key), { method: "DELETE" });
    if (!res.ok) throw new Error(`delete failed (${res.status})`);
  }

  async function list() {
    const res = await call(base);
    if (!res.ok) throw new Error(`list failed (${res.status})`);
    return (await res.json()).keys;
  }

  return { get, set, update, remove, list };
}
