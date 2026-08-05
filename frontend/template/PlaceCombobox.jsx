import { useEffect, useId, useRef, useState } from 'react';
import { fetchPlaceSuggestions } from './placeCombobox.js';

const DEBOUNCE_MS = 250;
const MIN_CHARS = 2;

// The one shared address/place picker used everywhere in the app — real
// markup we fully control (a plain <input> + our own dropdown), styled by
// whatever surrounding CSS each caller's other fields already use, no
// special framing needed of its own.
//
// This used to be two separate implementations: this component (built for
// CreateQuestForm.jsx's borderless look) plus PlaceAutocompleteInput.jsx (a
// wrapper around Google's google.maps.places.PlaceAutocompleteElement, a
// closed shadow-DOM widget Register.jsx/Settings.jsx/Onboarding.jsx used
// instead specifically because Google's widget couldn't be restyled to
// match those forms). Now that address search comes from Geoapify's plain
// REST API instead — no pre-built widget, nothing to work around — that
// split has no reason to exist; PlaceAutocompleteInput.jsx is now just a
// re-export of this component.
//
// `id` is optional — CreateQuestForm.jsx passes an explicit one (its
// label sits in a separate element, paired via htmlFor), but the other
// three callers just wrap this directly in a <label> and never needed
// one, so this falls back to a generated id rather than requiring every
// caller to invent one.
export function PlaceCombobox({ onSelect, placeholder, ariaLabel, id }) {
  const generatedId = useId();
  const inputId = id || generatedId;
  const [inputText, setInputText] = useState('');
  const [suggestions, setSuggestions] = useState([]);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const listboxId = `${inputId}-listbox`;

  useEffect(() => {
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
        const results = await fetchPlaceSuggestions(text);
        if (cancelled) return;
        setSuggestions(results);
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
  }, [inputText]);

  function selectSuggestion(suggestion) {
    onSelect({
      location: suggestion.formatted,
      placeId: suggestion.id,
      lat: suggestion.lat,
      lng: suggestion.lng,
    });
    setInputText(suggestion.formatted);
    setOpen(false);
    setSuggestions([]);
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
        id={inputId}
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
