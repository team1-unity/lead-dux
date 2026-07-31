// Register.jsx/Settings.jsx/Onboarding.jsx used to get a separate wrapper
// here around Google's google.maps.places.PlaceAutocompleteElement — a
// closed shadow-DOM widget, kept apart from PlaceCombobox.jsx (Create-
// QuestForm.jsx's own fully custom dropdown) specifically because Google's
// widget couldn't be restyled to match those forms' plain input look.
//
// Address search now comes from Geoapify's plain REST API instead (see
// placeCombobox.js), with no pre-built widget of its own to work around —
// so that split has no reason to exist anymore. This file stays only so
// those three callers' imports don't need to change.
export { PlaceCombobox as PlaceAutocompleteInput } from './PlaceCombobox.jsx';
