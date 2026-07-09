// Fixed vocabulary rather than free-text, so it actually lines up with
// quest tags for the relevance sort (Quests.jsx) — and 1:1 with the ink
// rack in style.css (--tag-community, --tag-education, ...). Used by both
// Onboarding (set once) and Settings (change anytime).
export const INTEREST_OPTIONS = [
  'environment', 'community', 'outdoors', 'education',
  'technology', 'youth', 'arts', 'food security', 'fitness',
];
