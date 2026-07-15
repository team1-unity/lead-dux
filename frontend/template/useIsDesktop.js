import { useEffect, useState } from 'react';

// True once the viewport crosses the same --bp-wide breakpoint the rest of
// the app's chrome (BottomNav) switches on. Used wherever a component needs
// to pick between two genuinely different layouts/interactions (not just
// different CSS) — e.g. an accordion on mobile vs. a persistent split view
// on desktop — so only one copy of the "selected" content ever mounts at a
// time, rather than mounting both and hiding one with CSS (which would fire
// every lazy fetch inside it twice).
export function useIsDesktop() {
  const query = '(min-width: 860px)';
  const [isDesktop, setIsDesktop] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mql = window.matchMedia(query);
    const handler = (e) => setIsDesktop(e.matches);
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, []);
  return isDesktop;
}
