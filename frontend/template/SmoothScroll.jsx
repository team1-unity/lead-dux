import { useEffect } from 'react';
import Lenis from 'lenis';
import { useReducedMotion } from 'framer-motion';

// Mounted once at the app root (see App.jsx) — renders nothing, just swaps
// the document's native scroll-stop-dead feel for Lenis's weighted inertia
// (everything decelerates instead of snapping to a halt). Lenis drives the
// real `document.documentElement.scrollTop` via requestAnimationFrame
// rather than a virtual/transformed scroll container, so every existing
// `window.addEventListener('scroll', ...)` consumer (BottomNav's
// scroll-direction hide, EventsMap's own list scrolling, etc.) keeps
// working unmodified — nothing else in the app needs to know this exists.
// Skipped entirely under prefers-reduced-motion, same as every other motion
// primitive here.
export function SmoothScroll() {
  const reduce = useReducedMotion();

  useEffect(() => {
    if (reduce) return undefined;
    // allowNestedScroll: without it, Lenis's wheel/touch interception on the
    // document steals input from any internally-scrolling panel — the
    // desktop quest list, the map's list pane, modals like Attendees/photo
    // review, the place autocomplete dropdown — before it ever reaches
    // their own native overflow. This makes Lenis detect those nested
    // scrollable containers itself and let them scroll normally instead of
    // hand-maintaining a selector list of every current and future one.
    const lenis = new Lenis({ autoRaf: true, allowNestedScroll: true });
    return () => lenis.destroy();
  }, [reduce]);

  return null;
}
