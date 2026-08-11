// Tiny pub/sub so a background save (see EditProfileModal.jsx's optimistic
// handleSave) can report a failure after the modal that triggered it has
// already closed — there's no shared component tree between "the modal
// that fired the save" and "whatever's on screen by the time it resolves"
// to pass a callback through, so a plain module-level subscriber list is
// simpler than wiring this through context for a single one-way event.
let listeners = [];

export function notifyError(message) {
  listeners.forEach((cb) => cb(message));
}

export function subscribe(cb) {
  listeners.push(cb);
  return () => {
    listeners = listeners.filter((l) => l !== cb);
  };
}
