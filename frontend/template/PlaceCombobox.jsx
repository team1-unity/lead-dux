import { useEffect, useRef, useState } from 'react';
import { loadPlacesLibrary } from './googleMaps.js';
import { normalizeSuggestion } from './placeCombobox.js';

const DEBOUNCE_MS = 250;
const MIN_CHARS = 2;

// A from-scratch replacement for PlaceAutocompleteInput.jsx, built for
// exactly one reason: google.maps.places.PlaceAutocompleteElement is a
// closed pre-built widget — Google renders its own input, search icon, and
// dropdown inside a shadow DOM, and only exposes a few color/font
// variables for theming, not full control. There's no supported way to
// remove its icon or match it exactly to a borderless surrounding form.
//
// This uses the *data-only* half of the same API instead —
// AutocompleteSuggestion.fetchAutocompleteSuggestions() returns just
// suggestion predictions, no UI attached — so every pixel here (the input,
// the dropdown, the icon-less look) is our own real markup, styled by the
// same CSS every other row in this form already uses.
//
// Not a drop-in replacement for PlaceAutocompleteInput.jsx elsewhere
// (Register.jsx/Onboarding.jsx) — those keep the simpler pre-built widget,
// which is a fine trade there. This is deliberately scoped to
// org/CreateQuestForm.jsx's Where row, the one place a fully custom look
// was actually asked for.
export function PlaceCombobox({ onSelect, placeholder, ariaLabel, id }) {
  const [placesLib, setPlacesLib] = useState(null);
  const [inputText, setInputText] = useState('');
  const [suggestions, setSuggestions] = useState([]);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  // One token per "search session" (Google's billing unit) — created on
  // the first keystroke of a fresh search, reused across every keystroke
  // and the eventual fetchFields() call, then cleared so the next search
  // (after a selection, or after clearing the field) starts a new one.
  const sessionTokenRef = useRef(null);
  const listboxId = `${id}-listbox`;

  useEffect(() => {
    let cancelled = false;
    loadPlacesLibrary().then((lib) => {
      if (!cancelled) setPlacesLib(lib);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!placesLib) return undefined;
    const text = inputText.trim();
    if (text.length < MIN_CHARS) {
      setOpen(false);
      setSuggestions([]);
      setLoading(false);
      setError(null);
      return undefined;
    }

    setOpen(true);
    setLoading(true);
    setError(null);
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        if (!sessionTokenRef.current) {
          sessionTokenRef.current = new placesLib.AutocompleteSessionToken();
        }
        const { suggestions: results } = await placesLib.AutocompleteSuggestion.fetchAutocompleteSuggestions({
          input: text,
          sessionToken: sessionTokenRef.current,
        });
        if (cancelled) return;
        const mapped = (results || [])
          .filter((s) => s.placePrediction)
          .map((s) => ({ ...normalizeSuggestion(s.placePrediction), prediction: s.placePrediction }));
        setSuggestions(mapped);
        setActiveIndex(-1);
      } catch {
        if (!cancelled) {
          setError('Could not load suggestions.');
          setSuggestions([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [inputText, placesLib]);

  async function selectSuggestion(suggestion) {
    const place = suggestion.prediction.toPlace();
    await place.fetchFields({ fields: ['formattedAddress', 'location'] });
    onSelect({
      location: place.formattedAddress || '',
      placeId: place.id,
      lat: place.location?.lat(),
      lng: place.location?.lng(),
    });
    setInputText(place.formattedAddress || '');
    setOpen(false);
    setSuggestions([]);
    // The session that started with the first keystroke ends here — the
    // next search (editing this field again) is billed as a new one.
    sessionTokenRef.current = null;
  }

  function onKeyDown(e) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!open) setOpen(true);
      if (suggestions.length) setActiveIndex((i) => (i + 1) % suggestions.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (suggestions.length) setActiveIndex((i) => (i - 1 + suggestions.length) % suggestions.length);
    } else if (e.key === 'Enter') {
      // Prevent this from also submitting the surrounding <form> — picking
      // a suggestion is the point of pressing Enter here, not publishing
      // the whole quest.
      if (open && activeIndex >= 0 && suggestions[activeIndex]) {
        e.preventDefault();
        selectSuggestion(suggestions[activeIndex]);
      }
    } else if (e.key === 'Escape' && open) {
      e.preventDefault();
      setOpen(false);
    }
  }

  return (
    <div style={{ position: 'relative' }}>
      <input
        id={id}
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-autocomplete="list"
        aria-activedescendant={activeIndex >= 0 ? `${listboxId}-option-${activeIndex}` : undefined}
        aria-label={ariaLabel}
        autoComplete="off"
        placeholder={placeholder}
        value={inputText}
        onChange={(e) => setInputText(e.target.value)}
        onKeyDown={onKeyDown}
        onFocus={() => {
          if (suggestions.length) setOpen(true);
        }}
        onBlur={() => setOpen(false)}
      />
      {open && (
        <ul id={listboxId} role="listbox" aria-label={ariaLabel} className="ink-card place-combobox-listbox">
          {loading && <li className="field-optional place-combobox-status">Searching...</li>}
          {!loading && error && <li className="quest-form-error place-combobox-status">{error}</li>}
          {!loading && !error && suggestions.length === 0 && (
            <li className="field-optional place-combobox-status">No matches.</li>
          )}
          {!loading && !error && suggestions.map((s, i) => (
            <li
              key={s.id}
              id={`${listboxId}-option-${i}`}
              role="option"
              aria-selected={i === activeIndex}
              data-active={i === activeIndex ? 'true' : undefined}
              className="place-combobox-option"
              // preventDefault on mousedown (not click) keeps the input from
              // blurring — and this dropdown from closing — before the click
              // handler below gets a chance to fire.
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => selectSuggestion(s)}
            >
              <span className="place-combobox-main">{s.mainText}</span>
              {s.secondaryText && <span className="place-combobox-secondary">{s.secondaryText}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
