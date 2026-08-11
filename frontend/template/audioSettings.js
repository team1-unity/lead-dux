// The one place that reads/writes each audio channel's volume — same
// "single source of truth, plain localStorage, degrade quietly if it's
// unavailable" shape as theme.js. Three independent channels rather than
// one master volume: the duck's quack (mobile/Home.jsx), UI click sounds
// (App.jsx's global click listener), and looping background music
// (BackgroundMusic.jsx) are different enough in how often/loud they
// should be that someone muting one shouldn't have to also mute the
// others.
const STORAGE_PREFIX = 'lq-volume-';

export const VOLUME_CHANNELS = ['duck', 'clicks', 'music'];

const DEFAULT_VOLUME = {
  duck: 1,
  clicks: 1,
  // Background music defaults lower than the two one-off sound effects —
  // something continuous playing under the whole app should sit back, not
  // compete with everything else at full volume by default.
  music: 0.4,
};

export function getVolume(channel) {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + channel);
    if (raw === null) return DEFAULT_VOLUME[channel];
    const value = Number(raw);
    return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : DEFAULT_VOLUME[channel];
  } catch {
    return DEFAULT_VOLUME[channel];
  }
}

// A tiny pub/sub, same shape as saveStatusBus.js — lets BackgroundMusic.jsx
// (a single instance mounted once at the app root, so route changes never
// touch it — see App.jsx) react live to a volume change made on the
// Settings page, without either one needing to know the other exists.
let listeners = [];

export function setVolume(channel, value) {
  const clamped = Math.min(1, Math.max(0, value));
  try {
    localStorage.setItem(STORAGE_PREFIX + channel, String(clamped));
  } catch {
    // localStorage unavailable (private browsing, etc) — the volume just
    // won't persist across reloads, which is a harmless degradation, same
    // as theme.js's own fallback.
  }
  listeners.forEach((cb) => cb(channel, clamped));
}

export function subscribeVolume(cb) {
  listeners.push(cb);
  return () => {
    listeners = listeners.filter((l) => l !== cb);
  };
}
