// Shared by anywhere that renders a name as a circular avatar's initials
// (BottomNav's org/user avatar, Badges' mobile header, ...).
export function getInitials(name) {
  const words = (name || '').trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}
