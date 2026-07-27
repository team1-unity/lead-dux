// Shared "when does this happen" inputs for quest creation — currently
// only the admin "add default neighborhood quest" form (org's own form
// uses CreateQuestForm.jsx's natural-language date input instead).
// eventDate is required by default; eventEndTime is always optional (the
// Cloud Function falls back to a few hours past eventDate when it's left
// blank). Values are plain <input type="datetime-local"> strings (e.g.
// "2026-07-20T14:00") with no UTC offset attached — the Cloud Function
// interprets that wall-clock string as being in `timezone` (via Python's
// zoneinfo, correctly accounting for that zone's DST rules) before
// converting to the UTC instant Firestore actually stores.
//
// `required` defaults to true but the admin form passes `false` for a
// one-off side quest — create_default_quest itself made eventDate optional
// there (a side quest is a self-directed challenge, not a scheduled
// event); a *recurring* one still needs a start date to generate its
// occurrences from, so the admin form keeps this true whenever its
// "Recurring event" checkbox is on.
export function EventDateFields({
  eventDate,
  eventEndTime,
  timezone,
  onEventDateChange,
  onEventEndTimeChange,
  onTimezoneChange,
  required = true,
}) {
  return (
    <>
      <label>
        Event date &amp; time{!required && <span className="field-optional"> (optional)</span>}
        <input
          type="datetime-local"
          required={required}
          value={eventDate}
          onChange={(e) => onEventDateChange(e.target.value)}
        />
      </label>
      <label>
        Event end time (optional)
        <input
          type="datetime-local"
          value={eventEndTime}
          onChange={(e) => onEventEndTimeChange(e.target.value)}
        />
      </label>
      <label>
        Timezone
        <input
          type="text"
          required
          value={timezone}
          onChange={(e) => onTimezoneChange(e.target.value)}
          placeholder="America/New_York"
        />
      </label>
    </>
  );
}

// Best-effort guess at the organizer's own timezone, to pre-fill the field
// above rather than leaving it blank — still freely editable, e.g. for an
// org scheduling an event in a different city.
export function detectTimezone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}
