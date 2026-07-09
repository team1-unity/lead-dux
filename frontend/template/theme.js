// The only place that reads/writes the user's theme choice. 'system' means
// "no override" — the existing prefers-color-scheme media query in
// style.css decides. 'light'/'dark' stamp the same data-theme attribute
// those CSS blocks already listen for. Applied once at app startup (see
// main.jsx) so the stored choice takes effect before first paint.
const STORAGE_KEY = 'lq-theme';

export function getStoredTheme() {
  try {
    return localStorage.getItem(STORAGE_KEY) || 'system';
  } catch {
    return 'system';
  }
}

export function applyTheme(value) {
  const root = document.documentElement;
  if (value === 'system') {
    root.removeAttribute('data-theme');
  } else {
    root.setAttribute('data-theme', value);
  }
  try {
    localStorage.setItem(STORAGE_KEY, value);
  } catch {
    // localStorage unavailable (private browsing, etc) — theme just won't
    // persist across reloads, which is a harmless degradation.
  }
}
