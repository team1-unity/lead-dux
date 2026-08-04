// Shared logic for PlaceCombobox.jsx (used everywhere an address/place
// needs to be picked from real suggestions — CreateQuestForm.jsx, and via
// PlaceAutocompleteInput.jsx's re-export, Register.jsx/Settings.jsx/
// Onboarding.jsx too). Split out so the pure mapping half is unit-testable
// without a real Geoapify API response.

const GEOAPIFY_KEY = import.meta.env.VITE_GEOAPIFY_KEY;

// `result` is one entry from Geoapify's Autocomplete API `results` array
// (format=json — see fetchPlaceSuggestions below). address_line1/
// address_line2 are Geoapify's own mainText/secondaryText split (roughly:
// the specific place/street vs. the city/state/country context), already
// close enough to what a suggestion row wants to show that no further
// text-matching logic is needed the way Google's FormattableText objects
// required.
export function normalizeSuggestion(result) {
  return {
    id: result.place_id || result.formatted || 'unknown',
    mainText: result.address_line1 || result.formatted || 'Unknown place',
    secondaryText: result.address_line2 || '',
    formatted: result.formatted || result.address_line1 || '',
    lat: result.lat,
    lng: result.lon,
  };
}

// A plain REST GET — unlike Google's Places library, Geoapify needs no
// SDK/script-loading step first (see the removed googleMaps.js), and the
// suggestion payload already includes lat/lon directly, so there's no
// second "fetch full place details" round-trip on selection either (see
// PlaceCombobox.jsx's own selectSuggestion). The key travels as a query
// param and Geoapify's API allows direct browser CORS requests, the same
// way MapTiler's tile requests already do (see mapStyle.js) — no backend
// proxy needed.
export async function fetchPlaceSuggestions(text) {
  const url = `https://api.geoapify.com/v1/geocode/autocomplete?text=${encodeURIComponent(text)}&format=json&limit=8&apiKey=${GEOAPIFY_KEY}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Geoapify autocomplete request failed (${res.status})`);
  const data = await res.json();
  return (data.results || []).map(normalizeSuggestion);
}
