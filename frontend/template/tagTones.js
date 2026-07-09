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
