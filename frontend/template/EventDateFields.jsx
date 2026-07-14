// Shared "when does this happen" inputs for quest creation — used by both
// the organization and admin "create quest" forms so they don't drift into
// two slightly different copies. eventDate is required; eventEndTime is
// optional (the Cloud Function falls back to a few hours past eventDate
// when it's left blank). Values are plain <input type="datetime-local">
// strings (e.g. "2026-07-20T14:00") with no UTC offset attached — the
// Cloud Function interprets that wall-clock string as being in `timezone`
// (via Python's zoneinfo, correctly accounting for that zone's DST rules)
// before converting to the UTC instant Firestore actually stores.
export function EventDateFields({
  eventDate,
  eventEndTime,
  timezone,
  onEventDateChange,
  onEventEndTimeChange,
  onTimezoneChange,
}) {
  return (
    <>
      <label>
        Event date &amp; time
        <input
          type="datetime-local"
          required
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
