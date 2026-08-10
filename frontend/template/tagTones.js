// The 9 pastel ink-rack tones (style.css --tag-*), shared wherever
// something needs to either display a specific tag's color (TagStamp) or
// deterministically pick ONE of the 9 from an arbitrary string.
export const TAG_TONES = [
  'community', 'education', 'environment', 'outdoors', 'technology',
  'youth', 'fitness', 'food-security', 'arts',
];

function hashString(seed) {
  const s = String(seed ?? '');
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) >>> 0;
  }
  return h;
}

export function hashTone(seed) {
  return TAG_TONES[hashString(seed) % TAG_TONES.length];
}

// OrgAvatar's duck-mascot fallback, pre-rendered once per body color —
// beak/feet/eyes/outline are pixel-identical across every file; only the
// head/torso/wings hue changes. 18 hues evenly spaced 20° apart around the
// full wheel (starting from the original mustard's own hue), each kept at
// that same hue's natural pastel saturation/lightness rather than a flat
// fill — a warm-only palette (see git history) only had room for about 4
// hues before two became too close to tell apart; going pastel-but-full-
// wheel is what actually makes "a lot of distinguishable colors" possible.
export const DUCK_AVATAR_VARIANTS = [
  '/brand/duck-avatar.png',
  '/brand/duck-avatar-2.png',
  '/brand/duck-avatar-3.png',
  '/brand/duck-avatar-4.png',
  '/brand/duck-avatar-5.png',
  '/brand/duck-avatar-6.png',
  '/brand/duck-avatar-7.png',
  '/brand/duck-avatar-8.png',
  '/brand/duck-avatar-9.png',
  '/brand/duck-avatar-10.png',
  '/brand/duck-avatar-11.png',
  '/brand/duck-avatar-12.png',
  '/brand/duck-avatar-13.png',
  '/brand/duck-avatar-14.png',
  '/brand/duck-avatar-15.png',
  '/brand/duck-avatar-16.png',
  '/brand/duck-avatar-17.png',
  '/brand/duck-avatar-18.png',
];

// Pure-hash fallback for a duck avatar with no assigned color (a member
// reviewer's avatar in QuestReviewsList, say — there's no "organization"
// to keep unique here, just a name/uid to pick something stable-looking
// from). Real organizations should prefer duckAvatarByIndex instead, since
// only a value assigned server-side (see main.py's _assign_duck_color_index)
// can guarantee two orgs never end up with the same color.
export function hashDuckAvatar(seed) {
  return DUCK_AVATAR_VARIANTS[hashString(seed) % DUCK_AVATAR_VARIANTS.length];
}

// organizations/{uid}.duckColorIndex, assigned once at approval time (see
// main.py's _assign_duck_color_index) so it's stable and unique across
// orgs for as long as DUCK_AVATAR_VARIANTS has an unused slot to give it.
export function duckAvatarByIndex(index) {
  return DUCK_AVATAR_VARIANTS[index % DUCK_AVATAR_VARIANTS.length];
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
