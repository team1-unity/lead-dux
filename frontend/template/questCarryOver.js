// Pure helpers behind the document-style create-quest form's carry-over
// behavior (org/CreateQuestForm.jsx) — no React, no Firebase reads here.
// "Last quest" is picked from the org's already-loaded `quests` list (see
// OrgQuests in org/Quests.jsx) rather than a dedicated network read, since
// that list already exists by the time the create form mounts.

function toMillis(value) {
  if (value == null) return 0;
  if (typeof value.toMillis === 'function') return value.toMillis();
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return value;
  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? 0 : parsed;
}

// Most recently created quest across every occurrence this org owns (a
// recurring series' occurrences all share the same createdAt batch, so any
// one of them carries the same location/access pattern to copy from) — null
// if the org has never created one.
export function pickLastQuest(quests) {
  if (!quests || quests.length === 0) return null;
  return [...quests].sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt))[0];
}

// The Where/Access/When starting values for a fresh create-quest form, given
// the org's last quest (or an empty-state default when there isn't one).
export function buildCarryOverDefaults(lastQuest) {
  if (!lastQuest) {
    return {
      location: '',
      placeId: null,
      lat: null,
      lng: null,
      accommodationTags: [],
      accommodationDetails: '',
      accessConfirmedNone: false,
      whenPattern: null,
      timezone: null,
      carriedLocation: false,
      carriedAccess: false,
    };
  }
  return {
    location: lastQuest.location || '',
    placeId: lastQuest.placeId || null,
    lat: lastQuest.lat ?? null,
    lng: lastQuest.lng ?? null,
    accommodationTags: lastQuest.accommodationTags ? [...lastQuest.accommodationTags] : [],
    accommodationDetails: lastQuest.accommodationDetails || '',
    accessConfirmedNone: false,
    whenPattern: { eventDate: lastQuest.eventDate, timezone: lastQuest.timezone },
    timezone: lastQuest.timezone || null,
    carriedLocation: Boolean(lastQuest.placeId),
    carriedAccess: Boolean(lastQuest.accommodationTags && lastQuest.accommodationTags.length),
  };
}

// Applied whenever the organizer picks a new place for Where — a different
// venue's accessibility is unknown, so any Access selection (carried-over or
// hand-picked) is cleared back to Empty and has to be re-confirmed.
// `newLocation` is the {location, placeId, lat, lng} shape
// PlaceAutocompleteInput's onSelect produces.
export function applyLocationChange(state, newLocation) {
  return {
    ...state,
    ...newLocation,
    carriedLocation: false,
    accommodationTags: [],
    accommodationDetails: '',
    accessConfirmedNone: false,
    carriedAccess: false,
  };
}
