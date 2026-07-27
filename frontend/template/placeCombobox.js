// Pure display-mapping logic for PlaceCombobox.jsx — separated out so it's
// unit-testable without a real Places API response. Google's
// `PlacePrediction.text`/`.mainText`/`.secondaryText` are each a
// FormattableText object ({ text, matches }) in the current Places API,
// but this defensively also accepts a plain string in case that ever
// changes shape, rather than crashing the dropdown over it.
function asText(value) {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  return value.text ?? '';
}

// `prediction` is a google.maps.places.PlacePrediction (or anything with
// the same duck-typed shape, for tests). Returns the display-only fields a
// suggestion row needs — the raw prediction itself (needed later for
// .toPlace()) is kept separately by the caller, not duplicated here.
export function normalizeSuggestion(prediction) {
  const mainText = asText(prediction.mainText);
  const secondaryText = asText(prediction.secondaryText);
  const fullText = asText(prediction.text);
  return {
    id: prediction.placeId || fullText,
    mainText: mainText || fullText || 'Unknown place',
    secondaryText,
  };
}
