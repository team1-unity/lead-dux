import { hashTone, TONE_HEX } from './tagTones.js';

// Extracted from EventsMap.jsx so anything else that embeds a Google Map
// (SinglePinMap.jsx, used by the map-quest-detail standalone/public pages)
// can reuse the exact same recolored style and pin icon instead of
// duplicating either.

// A custom JSON style (the classic per-feature stylers array) rather than a
// Cloud Console Map ID — this works on the plain raster map with zero
// extra setup, and gets the same "doesn't look like default Google Maps"
// result: recolored to the app's own paper/ink palette (see style.css's
// --paper/--line/--accent tokens) and stripped of the business/POI icon
// clutter that would otherwise compete with our own quest pins.
export const MAP_STYLE = [
  { elementType: 'geometry', stylers: [{ color: '#efe9df' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#4a4a42' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#ffffff' }] },
  { elementType: 'labels.icon', stylers: [{ visibility: 'off' }] },
  { featureType: 'poi', stylers: [{ visibility: 'off' }] },
  { featureType: 'transit', stylers: [{ visibility: 'off' }] },
  { featureType: 'landscape', elementType: 'geometry', stylers: [{ color: '#efe9df' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#cfe0da' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#ffffff' }] },
  { featureType: 'road', elementType: 'geometry.stroke', stylers: [{ color: '#e0d9c9' }] },
  { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#e0d9c9' }] },
  { featureType: 'road.arterial', elementType: 'labels.text.fill', stylers: [{ color: '#4a4a42' }] },
  { featureType: 'administrative', elementType: 'geometry.stroke', stylers: [{ color: '#c9c0a9' }] },
  { featureType: 'administrative.land_parcel', stylers: [{ visibility: 'off' }] },
];

// A bold colored pin per quest, echoing the same tone (via the same
// hashTone(orgId) seed) as that quest's OrgAvatar tile elsewhere on this
// page — the marker and the list row it corresponds to visibly match.
// Google's stock red teardrop reads as "generic map," not "a quest is
// here"; this is a chunkier, ink-bordered pin with a solid center dot
// matching the app's own neobrutalist ink-card look, built as an SVG data
// URI since Marker icons can't reference our CSS custom properties directly.
// `selected` renders it ~35% larger — EventsMap's own highlight for
// whichever pin's list row/overlay is currently open, rather than a second,
// visually distinct icon shape (a bigger version of the same pin reads as
// "this one" without looking like a different kind of marker).
export function questPinIcon(seed, selected = false) {
  const tone = TONE_HEX[hashTone(seed)];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 30">
    <path d="M12 1C5.925 1 1 5.925 1 12c0 8.5 11 16.5 11 16.5S23 20.5 23 12C23 5.925 18.075 1 12 1z"
      fill="${tone.fill}" stroke="${tone.ink}" stroke-width="2"/>
    <circle cx="12" cy="12" r="4.5" fill="${tone.ink}"/>
  </svg>`;
  const width = selected ? 40 : 30;
  const height = selected ? 50 : 37;
  return {
    url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`,
    scaledSize: new window.google.maps.Size(width, height),
    anchor: new window.google.maps.Point(width / 2, height),
  };
}
