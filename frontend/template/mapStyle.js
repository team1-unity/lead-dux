import { hashTone, TONE_HEX } from './tagTones.js';

// Extracted so anything that embeds a MapLibre map (EventsMap.jsx,
// SinglePinMap.jsx) can reuse the exact same style URL and pin-marker
// look instead of duplicating either.

// MapTiler-hosted vector style (a full "style.json" — the vector-tile
// equivalent of the old Google stylers array, but authored/hosted by
// MapTiler rather than hand-written here). Swap the style id here if you
// want a different look — browse options at https://cloud.maptiler.com/maps/
// (each has its own id shown in the "Use vector style" tab).
const MAPTILER_KEY = import.meta.env.VITE_MAPTILER_KEY;
export const MAP_STYLE_URL = `https://api.maptiler.com/maps/streets-v2/style.json?key=${MAPTILER_KEY}`;

function pinSvg(seed, selected) {
  const tone = TONE_HEX[hashTone(seed)];
  const width = selected ? 40 : 30;
  const height = selected ? 50 : 37;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 24 30">
    <path d="M12 1C5.925 1 1 5.925 1 12c0 8.5 11 16.5 11 16.5S23 20.5 23 12C23 5.925 18.075 1 12 1z"
      fill="${tone.fill}" stroke="${tone.ink}" stroke-width="2"/>
    <circle cx="12" cy="12" r="4.5" fill="${tone.ink}"/>
  </svg>`;
  return { svg, width, height };
}

// Paints (or repaints, for the selected-size toggle) a quest pin's look
// directly onto an existing marker DOM element, rather than replacing the
// element/marker outright — a MapLibre Marker keeps one DOM element for
// its whole lifetime (there's no `marker.setIcon()` the way Google's
// Marker had), so "this pin is now selected" is a style mutation on the
// same node, not a new marker.
export function paintQuestPin(el, seed, selected = false) {
  const { svg, width, height } = pinSvg(seed, selected);
  el.style.width = `${width}px`;
  el.style.height = `${height}px`;
  el.style.backgroundImage = `url("data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}")`;
  el.style.backgroundSize = 'contain';
  el.style.backgroundRepeat = 'no-repeat';
  el.style.cursor = 'pointer';
}

// A bold colored pin per quest, echoing the same tone (via the same
// hashTone(orgId) seed) as that quest's OrgAvatar tile elsewhere on this
// page — the marker and the list row it corresponds to visibly match.
// Built as a plain <div> painted with an SVG data-URI background rather
// than an <img> or a Google-style icon descriptor object — MapLibre's
// Marker takes any real DOM element directly (new maplibregl.Marker({
// element })), so there's no separate icon-shape API to satisfy the way
// Google's {url, scaledSize, anchor} was.
export function createQuestPinElement(seed) {
  const el = document.createElement('div');
  paintQuestPin(el, seed, false);
  return el;
}

// The user's-own-position marker — a plain filled circle (distinct from a
// quest pin at a glance), same visual as the old
// google.maps.SymbolPath.CIRCLE icon.
export function createUserPositionElement() {
  const el = document.createElement('div');
  el.style.width = '16px';
  el.style.height = '16px';
  el.style.borderRadius = '50%';
  el.style.background = '#4285f4';
  el.style.border = '3px solid #ffffff';
  el.style.boxShadow = '0 0 0 1px rgba(0, 0, 0, 0.15)';
  return el;
}
