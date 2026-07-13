// Shared "when does this happen" inputs for quest creation — used by both
// the organization and admin "create quest" forms so they don't drift into
// two slightly different copies. eventDate is required; eventEndTime is
// optional (the Cloud Function falls back to a few hours past eventDate
// when it's left blank). Values are plain <input type="datetime-local">
// strings (e.g. "2026-07-20T14:00") passed straight through to the Cloud
// Function — there's no timezone conversion here, so "2:00 PM" is stored
// and compared as 2:00 PM UTC regardless of the browser's local timezone.
// Fine for same-timezone testing; a real deployment would need to convert
// using the browser's offset before sending.
export function EventDateFields({ eventDate, eventEndTime, onEventDateChange, onEventEndTimeChange }) {
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
    </>
  );
}
