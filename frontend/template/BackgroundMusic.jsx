import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { getVolume, subscribeVolume } from './audioSettings.js';

// A module-level singleton, created once when this module first loads —
// deliberately NOT owned by this component's own lifecycle, so playback
// can never be "bound to routing." Even though <BackgroundMusic/> is
// already mounted once at the app root outside the route-switching
// subtree (see App.jsx) and so shouldn't remount on navigation anyway,
// keeping the actual <audio> here as a plain singleton is the belt to
// that belt-and-suspenders: there's no component instance whose
// unmount/remount could ever stop or restart this track. `typeof Audio`
// guards the (SSR/test) case where there's no DOM to construct one in.
const music = typeof Audio !== 'undefined' ? new Audio('/audio/chill.mp3') : null;
if (music) music.loop = true;

// Browsers block audio.play() with sound before any user gesture on the
// page — the very first mount (page load, before any click) predictably
// gets rejected. Rather than giving up, this retries once on the next
// real click anywhere, which is the same gesture App.jsx's own click-sound
// listener is already reacting to.
let unlockAttempted = false;

function tryPlay() {
  if (!music || !music.paused) return;
  music.play().catch(() => {
    if (unlockAttempted) return;
    unlockAttempted = true;
    const retry = () => {
      unlockAttempted = false;
      music.play().catch(() => {});
    };
    document.addEventListener('click', retry, { once: true });
  });
}

// Looping background music for the member-facing app — paused on the org
// side (an org's own workspace, not the game-like member experience this
// track belongs to; same boundary App.jsx's global click sound uses) and
// otherwise just keeps playing through every navigation, the way a real
// music player would. Volume stays in sync with Settings' Audio section
// live, via subscribeVolume, without either file needing to know the
// other exists.
export function BackgroundMusic() {
  const location = useLocation();
  const isOrgRoute = location.pathname.startsWith('/org');

  useEffect(() => {
    if (!music) return undefined;
    music.volume = getVolume('music');
    return subscribeVolume((channel, value) => {
      if (channel === 'music') music.volume = value;
    });
  }, []);

  useEffect(() => {
    if (!music) return;
    if (isOrgRoute) {
      music.pause();
    } else {
      tryPlay();
    }
  }, [isOrgRoute]);

  return null;
}
