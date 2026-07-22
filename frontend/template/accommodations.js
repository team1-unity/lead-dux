// Fixed vocabulary for accessibility accommodations — mirrors
// ACCOMMODATION_OPTIONS in functions/main.py, kept in sync by hand the same
// way interests.js already is. Used by onboarding (a user's own
// accommodationNeeds) and the org create-quest form (a quest's own
// accommodationTags) — the two are matched server-side, see
// _has_enough_accessible_org_quests. Unlike interests.js's flat string
// list, these need real display text distinct from their stored value, so
// each option is a {value, label} pair.
export const ACCOMMODATION_OPTIONS = [
  { value: 'wheelchair-accessible', label: 'Wheelchair accessible' },
  { value: 'asl-interpretation', label: 'ASL interpretation' },
  { value: 'accessible-parking', label: 'Accessible parking' },
  { value: 'sensory-friendly', label: 'Sensory-friendly' },
  { value: 'elevator-access', label: 'Elevator access' },
];

export function accommodationLabel(value) {
  return ACCOMMODATION_OPTIONS.find((opt) => opt.value === value)?.label || value;
}
