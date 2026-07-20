// Loads the Places library exactly once, no matter how many
// PlaceAutocompleteInput instances mount across the app — every caller
// awaits the same cached promise instead of re-requesting the Maps JS API
// script. Uses google.maps.places.PlaceAutocompleteElement (the current
// Places Autocomplete widget), not the older google.maps.places.Autocomplete
// class — that one hasn't been available to API keys created after March
// 2025, so it was never actually an option here.
let placesLibraryPromise = null;

export function loadPlacesLibrary() {
  if (!placesLibraryPromise) {
    placesLibraryPromise = (async () => {
      if (!window.google?.maps?.importLibrary) {
        // Google's own recommended inline bootstrap loader (see "Load the
        // Maps JavaScript API" in their docs) — small enough to inline
        // rather than pull in a whole npm loader package for this one call.
        ((g) => {
          var h, a, k, p = 'The Google Maps JavaScript API', c = 'google', l = 'importLibrary',
            q = '__ib__', m = document, b = window;
          b = b[c] || (b[c] = {});
          var d = b.maps || (b.maps = {}), r = new Set(), e = new URLSearchParams(),
            u = () => h || (h = new Promise(async (f, n) => {
              await (a = m.createElement('script'));
              e.set('libraries', [...r] + '');
              for (k in g) e.set(k.replace(/[A-Z]/g, (t) => '_' + t[0].toLowerCase()), g[k]);
              e.set('callback', c + '.maps.' + q);
              a.src = `https://maps.${c}apis.com/maps/api/js?` + e;
              d[q] = f;
              a.onerror = () => (h = n(Error(p + ' could not load.')));
              a.nonce = m.querySelector('script[nonce]')?.nonce || '';
              m.head.append(a);
            }));
          d[l] ? console.warn(p + ' only loads once. Ignoring:', g)
            : (d[l] = (f, ...n) => r.add(f) && u().then(() => d[l](f, ...n)));
        })({ key: import.meta.env.VITE_GOOGLE_MAPS_API_KEY, v: 'weekly' });
      }
      return window.google.maps.importLibrary('places');
    })();
  }
  return placesLibraryPromise;
}
