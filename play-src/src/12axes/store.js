// The one localStorage key: the test in progress and the last finished
// result. Storage can be blocked (private mode, settings), so every access
// is wrapped and the test works without it.
const KEY = '12axes:v1';

export function load() {
  try {
    const v = JSON.parse(localStorage.getItem(KEY));
    return v && typeof v === 'object' ? v : {};
  } catch { return {}; }
}

export function save(data) {
  try { localStorage.setItem(KEY, JSON.stringify(data)); return true; } catch { return false; }
}

export function update(fn) {
  const data = load();
  fn(data);
  return save(data);
}
