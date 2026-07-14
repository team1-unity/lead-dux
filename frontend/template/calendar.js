// Builds "Add to Calendar" links/files for a quest occurrence, entirely
// client-side. Every field involved — title, description, location,
// eventDate/eventEndTime, timezone — is already a plain field on the quest
// doc the client can read directly, so there's no separate stored
// "calendar event" record and no Cloud Function involved (see
// create_quest/create_default_quest in functions/main.py, which is also
// where DEFAULT_EVENT_WINDOW_HOURS comes from — kept in sync by hand since
// there's no shared config between the Python backend and this file).
const DEFAULT_EVENT_WINDOW_HOURS = 6;

function toDate(value) {
  if (!value) return null;
  return value.toDate ? value.toDate() : new Date(value);
}

// Normalizes a Firestore quest doc into the plain {title, description,
// location, start, end, timezone} shape every builder below expects.
export function questToCalendarEvent(quest) {
  const start = toDate(quest.eventDate);
  const end = quest.eventEndTime
    ? toDate(quest.eventEndTime)
    : new Date(start.getTime() + DEFAULT_EVENT_WINDOW_HOURS * 60 * 60 * 1000);

  return {
    title: quest.title || 'Quest',
    description: quest.description || '',
    location: quest.location || '',
    start,
    end,
    timezone: quest.timezone || 'UTC',
  };
}

function pad(n) {
  return String(n).padStart(2, '0');
}

// "YYYYMMDDTHHMMSSZ" — an unambiguous UTC instant. Every calendar app
// (Google, Outlook, Apple) converts this correctly to the viewer's own
// local timezone for display, so there's no need to embed a full IANA
// VTIMEZONE block for this to render at the right time.
function formatUtc(date) {
  return (
    date.getUTCFullYear().toString() +
    pad(date.getUTCMonth() + 1) +
    pad(date.getUTCDate()) +
    'T' +
    pad(date.getUTCHours()) +
    pad(date.getUTCMinutes()) +
    pad(date.getUTCSeconds()) +
    'Z'
  );
}

export function buildGoogleCalendarUrl({ title, description, location, start, end, timezone }) {
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: title,
    dates: `${formatUtc(start)}/${formatUtc(end)}`,
    details: description,
    location,
    ctz: timezone,
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

export function buildOutlookCalendarUrl({ title, description, location, start, end }) {
  const params = new URLSearchParams({
    path: '/calendar/action/compose',
    rru: 'addevent',
    subject: title,
    body: description,
    location,
    startdt: start.toISOString(),
    enddt: end.toISOString(),
  });
  return `https://outlook.live.com/calendar/0/deeplink/compose?${params.toString()}`;
}

// RFC 5545 §3.3.11 text escaping. Backslash has to go first — escaping the
// other characters afterward would otherwise double-escape the backslashes
// this step just introduced.
export function escapeIcsText(text) {
  return String(text)
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n');
}

// `now`/`uid` are overridable so tests can assert exact output — DTSTAMP
// otherwise defaults to the real current time.
export function buildIcsContent({ title, description, location, start, end }, { uid, now } = {}) {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//lead-dux//quest//EN',
    'BEGIN:VEVENT',
    `UID:${uid || `${start.getTime()}@lead-dux`}`,
    `DTSTAMP:${formatUtc(now || new Date())}`,
    `DTSTART:${formatUtc(start)}`,
    `DTEND:${formatUtc(end)}`,
    `SUMMARY:${escapeIcsText(title)}`,
    `DESCRIPTION:${escapeIcsText(description)}`,
    `LOCATION:${escapeIcsText(location)}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return lines.join('\r\n');
}

// A data: URI is enough to trigger a same-tab download via <a download> —
// no Blob/ObjectURL lifecycle to manage.
export function icsDataUri(icsContent) {
  return `data:text/calendar;charset=utf8,${encodeURIComponent(icsContent)}`;
}
