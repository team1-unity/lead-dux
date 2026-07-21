import { useEffect, useRef } from 'react';
import { loadPlacesLibrary } from './googleMaps.js';

// Wraps google.maps.places.PlaceAutocompleteElement — the current Places
// Autocomplete widget, a custom element that manages its own text input
// internally (shadow DOM), so this is necessarily uncontrolled. onSelect
// only fires once per actual selected place, never for free-typed text —
// that's the point: there's no way to end up with a location that wasn't
// a real place someone picked from the suggestions. Callers track whether
// a place has been selected themselves (see Register.jsx/Onboarding.jsx/
// org Dashboard.jsx) and block submission until it has.
//
// Not used for side/default quest creation (admin Dashboard.jsx) — those
// keep a plain free-text location on purpose, since "Your neighborhood" or
// "Any local park" isn't a specific place Places Autocomplete could resolve.
export function PlaceAutocompleteInput({ onSelect, placeholder, ariaLabel }) {
  const containerRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    let element;

    loadPlacesLibrary().then(({ PlaceAutocompleteElement }) => {
      if (cancelled || !containerRef.current) return;
      element = new PlaceAutocompleteElement();
      if (placeholder) element.setAttribute('placeholder', placeholder);
      if (ariaLabel) element.setAttribute('aria-label', ariaLabel);
      containerRef.current.appendChild(element);
      element.addEventListener('gmp-select', async ({ placePrediction }) => {
        const place = placePrediction.toPlace();
        await place.fetchFields({ fields: ['formattedAddress', 'location'] });
        onSelect({
          location: place.formattedAddress || '',
          placeId: place.id,
          // place.location is a google.maps.LatLng, not a plain object —
          // callers (create-quest forms) need plain numbers to send to the
          // Cloud Function as-is.
          lat: place.location?.lat(),
          lng: place.location?.lng(),
        });
      });
    });

    return () => {
      cancelled = true;
      element?.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <div ref={containerRef} className="place-autocomplete-container" />;
}
