// Human labels for the dynamic "Back to X" link on Settings/Badges (see
// PreviousPathContext) — not exhaustive, just the destinations someone
// could plausibly land there from. Returns null for anything unrecognized
// so callers can fall back to their own default rather than showing "Back
// to /some/weird/path".
const ROUTE_LABELS = {
  '/': 'Home',
  '/quests': 'Quests',
  '/map': 'Map',
  '/journal': 'Journal',
  '/badges': 'Badges',
  '/profile': 'Profile',
  '/settings': 'Settings',
  '/check-in': 'Check In',
  '/org': 'Home',
  '/org/quests': 'Quests',
  '/org/photo-submissions': 'Photo Submissions',
  '/org/feedback-requests': 'Feedback Requests',
  '/admin': 'Data',
};

export function labelForPath(pathname) {
  if (!pathname) return null;
  if (ROUTE_LABELS[pathname]) return ROUTE_LABELS[pathname];
  // Prefix fallback for nested/dynamic routes (e.g. /quests/abc123,
  // /organizations/xyz) — longest matching prefix wins so /org/quests
  // doesn't get shadowed by a hypothetical shorter /org entry.
  const prefixMatch = Object.keys(ROUTE_LABELS)
    .filter((p) => p !== '/' && pathname.startsWith(`${p}/`))
    .sort((a, b) => b.length - a.length)[0];
  return prefixMatch ? ROUTE_LABELS[prefixMatch] : null;
}
