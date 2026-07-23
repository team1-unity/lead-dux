// Which nav-item hint bubbles a visitor has already dismissed — mirrors
// theme.js's localStorage get/set shape. One JSON array of ids, not one key
// per hint, so clearing/inspecting is a single lookup.
const STORAGE_KEY = 'lq-hints-seen';

function readSeen() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function hasSeenHint(id) {
  return readSeen().includes(id);
}

// Accepts one id or an array — FirstTimeHint marks its own id seen on
// first click, but "disappear when anything gets clicked" means every
// hint bubble currently on screen dismisses together, not just the one
// clicked, so callers can batch-mark whatever's currently visible.
export function markHintsSeen(ids) {
  const list = Array.isArray(ids) ? ids : [ids];
  const seen = new Set(readSeen());
  list.forEach((id) => seen.add(id));
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...seen]));
  } catch {
    // localStorage unavailable — hints just won't stay dismissed across
    // reloads, same harmless degradation as theme.js.
  }
}
