// Pure, dependency-free helper for a quest's "Directions" action
// (MapQuestDetailBody.jsx) — deliberately just an external deep link to
// Google's own directions UI (opens in a new tab / the native Maps app)
// rather than drawing a route with the Maps JS API's Directions Service,
// which would mean real additional scope and its own separate Google Maps
// API billing for something a plain URL already does for free.
export function buildDirectionsUrl(lat, lng) {
  return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
}
