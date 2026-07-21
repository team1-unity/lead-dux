// The 9 pastel ink-rack tones (style.css --tag-*), shared wherever
// something needs to either display a specific tag's color (TagStamp) or
// deterministically pick ONE of the 9 from an arbitrary string (OrgAvatar).
export const TAG_TONES = [
  'community', 'education', 'environment', 'outdoors', 'technology',
  'youth', 'fitness', 'food-security', 'arts',
];

export function hashTone(seed) {
  const s = String(seed ?? '');
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) >>> 0;
  }
  return TAG_TONES[h % TAG_TONES.length];
}

// Mirrors style.css's --tag-*/--tag-*-ink pairs — needed anywhere a tone
// has to become a real color OUTSIDE the CSS cascade (an SVG data URI handed
// to a Google Maps marker icon, a <canvas> draw call), since those contexts
// can't resolve var(--tag-community) themselves. Keep in sync with style.css
// by hand; there's no build step that generates one from the other.
export const TONE_HEX = {
  community: { fill: '#fbeba9', ink: '#6b4e05' },
  education: { fill: '#d6ecf7', ink: '#1b4e66' },
  environment: { fill: '#cfead9', ink: '#1e5c3c' },
  outdoors: { fill: '#fbe1c4', ink: '#7a4413' },
  technology: { fill: '#cfe9e6', ink: '#15574f' },
  youth: { fill: '#d7e4f7', ink: '#1e3a73' },
  fitness: { fill: '#f6d6d0', ink: '#7a2c22' },
  'food-security': { fill: '#e7e4b0', ink: '#52480a' },
  arts: { fill: '#e3d6f0', ink: '#48276e' },
};
