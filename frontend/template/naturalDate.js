// Natural-language "when" parsing for the document-style create-quest form
// (org/CreateQuestForm.jsx). Pure functions only — no React, no Firebase —
// so they're unit-testable in isolation (see naturalDate.test.js).
//
// Scope: this is deliberately narrow, not a general NL date library. It
// understands the phrases the form's placeholder promises — "sat 6pm",
// "tomorrow 7", "next friday 8:30am" — plus two explicit-date shapes,
// "07/1 6pm" (M/D, US order) and "december 12 6pm" (month name + day) —
// plus an explicit start–end hour range ("aug 2 6-9pm") and a trailing
// common US timezone abbreviation ("aug 2 6-9pm est") — not arbitrary
// English. Unrecognized input just fails to resolve (parseNaturalWhen
// returns null); the caller keeps showing the last good resolved value
// rather than erroring.
//
// All "today"/"tomorrow"/weekday math is done against the *browser's* local
// calendar day, not any venue timezone — the form has no reliable way to
// geocode a venue's timezone from a Places Autocomplete selection, so "today"
// means the organizer's own today. The wall-clock hour/minute the organizer
// types (or that's carried over from a past quest) is what actually gets
// sent to the backend as a naive datetime-local string — see
// EventDateFields.jsx's module note. It's stored as-is, tagged with a
// `timezone` field, with no further conversion happening client-side.

const WEEKDAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const WEEKDAY_ABBREVS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const MONTH_NAMES = [
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december',
];
const MONTH_ABBREVS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

function monthIndexFromWord(word) {
  const byName = MONTH_NAMES.indexOf(word);
  if (byName !== -1) return byName;
  return MONTH_ABBREVS.indexOf(word);
}

const SLASH_DATE_RE = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/;
const MONTH_NAME_DATE_RE = /^([a-z]+)\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s*(\d{4}))?$/;

// Neither slash dates ("07/1") nor month-name dates ("december 12") specify
// a year by default — this just checks the day is in range for its month
// (JS Date silently rolls an out-of-range day into the next month, which
// would otherwise resolve to a *different*, wrong date instead of failing).
function isValidCalendarDay(year, month, day) {
  return day >= 1 && day <= new Date(year, month + 1, 0).getDate();
}

// Bare hours with no am/pm marker are assumed PM — quests overwhelmingly
// happen in the afternoon/evening, and this matches both examples in the
// spec ("sat 6pm" is explicit, but "tomorrow 7" resolves to 7 PM). Hour 12
// with no marker is treated as noon (12 PM), not midnight.
function resolveMeridiem(hour, meridiem) {
  if (meridiem === 'am') return hour === 12 ? 0 : hour;
  if (meridiem === 'pm') return hour === 12 ? 12 : hour + 12;
  return hour === 12 ? 12 : hour + 12;
}

const TIME_RE = /(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*$/i;

function parseTimeSuffix(text) {
  const match = text.match(TIME_RE);
  if (!match) return null;
  const rawHour = Number(match[1]);
  if (rawHour > 12) return null;
  const minute = match[2] ? Number(match[2]) : 0;
  if (minute > 59) return null;
  const meridiem = match[3] ? match[3].toLowerCase() : null;
  const hour = resolveMeridiem(rawHour, meridiem);
  return { hour, minute, matchedText: match[0] };
}

// "6-9pm", "6:30-9pm", "11am-1pm" — an explicit start–end hour range
// instead of the caller's default duration. Only one side needs an am/pm
// marker ("6-9pm" applies pm to both); an explicit marker on the start
// always wins over borrowing the end's ("11am-1pm" stays 11 AM, not 11 PM).
const TIME_TOKEN = '(\\d{1,2})(?::(\\d{2}))?\\s*(am|pm)?';
const TIME_RANGE_RE = new RegExp(`${TIME_TOKEN}\\s*[-–]\\s*${TIME_TOKEN}\\s*$`, 'i');

function parseTimeRangeSuffix(text) {
  const match = text.match(TIME_RANGE_RE);
  if (!match) return null;
  const [, h1, m1, mer1Raw, h2, m2, mer2Raw] = match;
  const rawStartHour = Number(h1);
  const rawEndHour = Number(h2);
  if (rawStartHour > 12 || rawEndHour > 12) return null;
  const startMinute = m1 ? Number(m1) : 0;
  const endMinute = m2 ? Number(m2) : 0;
  if (startMinute > 59 || endMinute > 59) return null;

  const mer2 = mer2Raw ? mer2Raw.toLowerCase() : null;
  const mer1 = mer1Raw ? mer1Raw.toLowerCase() : mer2;
  const startHour = resolveMeridiem(rawStartHour, mer1);
  const endHour = resolveMeridiem(rawEndHour, mer2 || mer1);
  return { startHour, startMinute, endHour, endMinute, matchedText: match[0] };
}

// Common US timezone abbreviations only, mapped to a representative IANA
// zone — real tz abbreviations are inherently ambiguous ("CST" alone could
// mean Chicago or China) and this isn't trying to be exhaustive/worldwide,
// just cover what an org is likely to actually type. MST/MDT is mapped to
// the Denver-area zone (which observes DST); Arizona's fixed MST has no
// distinct abbreviation to key off of.
const TZ_ABBREVIATIONS = {
  est: 'America/New_York', edt: 'America/New_York',
  cst: 'America/Chicago', cdt: 'America/Chicago',
  mst: 'America/Denver', mdt: 'America/Denver',
  pst: 'America/Los_Angeles', pdt: 'America/Los_Angeles',
  akst: 'America/Anchorage', akdt: 'America/Anchorage',
  hst: 'Pacific/Honolulu',
  utc: 'UTC', gmt: 'UTC',
};

const TRAILING_WORD_RE = /\s+([a-z]{2,5})\s*$/i;

// Strips a trailing recognized timezone abbreviation off the end of the
// text, if there is one — "aug 2 6-9pm est" -> { text: "aug 2 6-9pm",
// timezone: "America/New_York" }. Leaves the text untouched (timezone:
// null) when the trailing word isn't one of TZ_ABBREVIATIONS — including
// "am"/"pm" themselves, which never end up separated by whitespace from a
// bare hour in practice ("6pm" is one token, not "6 pm").
function stripTrailingTimezone(text) {
  const match = text.match(TRAILING_WORD_RE);
  if (!match) return { text, timezone: null };
  const zone = TZ_ABBREVIATIONS[match[1].toLowerCase()];
  if (!zone) return { text, timezone: null };
  return { text: text.slice(0, match.index).trim(), timezone: zone };
}

function parseDayPhrase(phrase) {
  const trimmed = phrase.trim();
  if (!trimmed) return { kind: 'today' };
  if (trimmed === 'today') return { kind: 'today' };
  if (trimmed === 'tomorrow') return { kind: 'tomorrow' };

  const forced = trimmed.startsWith('next ');
  const weekdayWord = forced ? trimmed.slice(5).trim() : trimmed;
  const index = WEEKDAY_NAMES.indexOf(weekdayWord) !== -1
    ? WEEKDAY_NAMES.indexOf(weekdayWord)
    : WEEKDAY_ABBREVS.indexOf(weekdayWord);
  if (index !== -1) return { kind: 'weekday', weekday: index, forced };

  const slashMatch = trimmed.match(SLASH_DATE_RE);
  if (slashMatch) {
    const month = Number(slashMatch[1]) - 1;
    const day = Number(slashMatch[2]);
    const year = slashMatch[3] ? Number(slashMatch[3]) : null;
    if (month < 0 || month > 11 || !isValidCalendarDay(year ?? 2000, month, day)) return null;
    return { kind: 'date', month, day, year };
  }

  const monthNameMatch = trimmed.match(MONTH_NAME_DATE_RE);
  if (monthNameMatch) {
    const month = monthIndexFromWord(monthNameMatch[1]);
    const day = Number(monthNameMatch[2]);
    const year = monthNameMatch[3] ? Number(monthNameMatch[3]) : null;
    if (month === -1 || !isValidCalendarDay(year ?? 2000, month, day)) return null;
    return { kind: 'date', month, day, year };
  }

  return null;
}

// Next calendar date (local) landing on `weekday` (0=Sun..6=Sat). Today
// counts as a match unless `forced` is set (an explicit "next <day>") or
// `timeAlreadyPassed` is set (the resolved time on today's date has already
// gone by) — in both cases the search starts from tomorrow instead.
function nextWeekdayDate(weekday, referenceDate, { forced = false, timeAlreadyPassed = false } = {}) {
  const start = new Date(referenceDate.getFullYear(), referenceDate.getMonth(), referenceDate.getDate());
  const skipToday = forced || timeAlreadyPassed;
  let offset = (weekday - start.getDay() + 7) % 7;
  if (offset === 0 && skipToday) offset = 7;
  start.setDate(start.getDate() + offset);
  return start;
}

// Parses a free-typed "when" phrase into wall-clock components. Returns
// null when the phrase isn't recognized at all. `endHour`/`endMinute` are
// non-null only when the text gave an explicit end time ("6-9pm") — the
// caller applies its own default duration otherwise (see resolveEndWhen).
// `timezone` is a resolved IANA zone, non-null only when the text ended in
// a recognized abbreviation ("est") — the caller falls back to its own
// timezone source otherwise.
export function parseNaturalWhen(text, referenceDate = new Date()) {
  if (!text || !text.trim()) return null;
  const { text: stripped, timezone } = stripTrailingTimezone(text.trim().toLowerCase());

  const range = parseTimeRangeSuffix(stripped);
  let startHour;
  let startMinute;
  let endHour = null;
  let endMinute = null;
  let matchedText;
  if (range) {
    ({ startHour, startMinute, endHour, endMinute, matchedText } = range);
  } else {
    const time = parseTimeSuffix(stripped);
    if (!time) return null;
    startHour = time.hour;
    startMinute = time.minute;
    matchedText = time.matchedText;
  }

  const dayPhrase = stripped.slice(0, stripped.length - matchedText.length).trim();
  const day = parseDayPhrase(dayPhrase);
  if (!day) return null;

  let date;
  if (day.kind === 'today') {
    const candidate = new Date(referenceDate);
    candidate.setHours(startHour, startMinute, 0, 0);
    const alreadyPassed = candidate.getTime() <= referenceDate.getTime();
    date = new Date(referenceDate.getFullYear(), referenceDate.getMonth(), referenceDate.getDate());
    if (alreadyPassed) date.setDate(date.getDate() + 1);
  } else if (day.kind === 'tomorrow') {
    date = new Date(referenceDate.getFullYear(), referenceDate.getMonth(), referenceDate.getDate() + 1);
  } else if (day.kind === 'date') {
    // No year given ("07/1", "december 12") — assume this year, unless that
    // date+time has already gone by, in which case roll to next year (the
    // same "closest upcoming occurrence" rule the weekday branch uses).
    const year = day.year ?? referenceDate.getFullYear();
    if (day.year == null) {
      const candidate = new Date(year, day.month, day.day);
      candidate.setHours(startHour, startMinute, 0, 0);
      date = candidate.getTime() <= referenceDate.getTime()
        ? new Date(year + 1, day.month, day.day)
        : new Date(year, day.month, day.day);
    } else {
      date = new Date(year, day.month, day.day);
    }
  } else {
    // For a same-day weekday match, "today" only counts if the time hasn't
    // passed yet — same rule as the plain "today" branch above.
    const isToday = day.weekday === referenceDate.getDay();
    const timeAlreadyPassed = isToday && (() => {
      const candidate = new Date(referenceDate);
      candidate.setHours(startHour, startMinute, 0, 0);
      return candidate.getTime() <= referenceDate.getTime();
    })();
    date = nextWeekdayDate(day.weekday, referenceDate, { forced: day.forced, timeAlreadyPassed });
  }

  return {
    year: date.getFullYear(),
    month: date.getMonth(),
    day: date.getDate(),
    hour: startHour,
    minute: startMinute,
    endHour,
    endMinute,
    timezone,
  };
}

// Adds `minutes` to a wall-clock components object, rolling over
// hour/day/month/year boundaries the same way real clock time would.
export function addMinutesToWhen(when, minutes) {
  const d = new Date(when.year, when.month, when.day, when.hour, when.minute);
  d.setMinutes(d.getMinutes() + minutes);
  return { year: d.getFullYear(), month: d.getMonth(), day: d.getDate(), hour: d.getHours(), minute: d.getMinutes() };
}

// The actual end of the event: the text's own explicit end time
// ("6-9pm" -> 9pm), rolled to the next day if it's at/before the start (an
// overnight range, "11pm-1am") — or, when no end time was given at all,
// `defaultDurationMinutes` after the start (the form's fixed 2h default).
export function resolveEndWhen(when, defaultDurationMinutes) {
  if (when.endHour == null) return addMinutesToWhen(when, defaultDurationMinutes);
  const startTotal = when.hour * 60 + when.minute;
  const endTotal = when.endHour * 60 + when.endMinute;
  const dayOffset = endTotal <= startTotal ? 1 : 0;
  const d = new Date(when.year, when.month, when.day + dayOffset, when.endHour, when.endMinute);
  return { year: d.getFullYear(), month: d.getMonth(), day: d.getDate(), hour: d.getHours(), minute: d.getMinutes() };
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

// The naive "YYYY-MM-DDTHH:mm" string the backend expects for
// eventDate/eventEndTime (see EventDateFields.jsx) — no offset, no "Z".
export function whenToDatetimeLocalString(when) {
  return `${when.year}-${pad2(when.month + 1)}-${pad2(when.day)}T${pad2(when.hour)}:${pad2(when.minute)}`;
}

const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAY_ABBR_DISPLAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function formatClock(hour, minute) {
  const period = hour < 12 ? 'AM' : 'PM';
  const displayHour = hour % 12 === 0 ? 12 : hour % 12;
  return minute === 0 ? `${displayHour} ${period}` : `${displayHour}:${pad2(minute)} ${period}`;
}

// "Sat Aug 1, 6–8 PM" — a single trailing meridiem when start/end share one,
// otherwise one after each side ("11 AM–1 PM"). `end` is the resolved end
// wall-clock components (see resolveEndWhen) — either the text's own
// explicit end time or the default-duration fallback.
export function formatWhenRange(when, end) {
  const date = new Date(when.year, when.month, when.day, when.hour, when.minute);
  const weekday = WEEKDAY_ABBR_DISPLAY[date.getDay()];
  const month = MONTH_ABBR[date.getMonth()];

  const startPeriod = when.hour < 12 ? 'AM' : 'PM';
  const endPeriod = end.hour < 12 ? 'AM' : 'PM';
  const startHour = when.hour % 12 === 0 ? 12 : when.hour % 12;
  const endHour = end.hour % 12 === 0 ? 12 : end.hour % 12;
  const startLabel = when.minute === 0 ? `${startHour}` : `${startHour}:${pad2(when.minute)}`;
  const endLabel = formatClock(end.hour, end.minute);

  const timeRange = startPeriod === endPeriod
    ? `${startLabel}–${endLabel}`
    : `${startLabel} ${startPeriod}–${endLabel}`;

  return `${weekday} ${month} ${date.getDate()}, ${timeRange}`;
}

// IANA zone -> short display abbreviation ("EDT", "PST", ...).
export function tzAbbreviation(timeZone, date = new Date()) {
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'short' }).formatToParts(date);
    return parts.find((p) => p.type === 'timeZoneName')?.value || timeZone;
  } catch {
    return timeZone;
  }
}

// Wall-clock weekday/hour/minute for `date` (a real Date/Timestamp instant)
// as seen in `timeZone` — used to read the weekday+time pattern off a past
// quest without being thrown off by the browser's own zone.
export function wallClockPartsInZone(date, timeZone) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone,
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(date)
      .map((p) => [p.type, p.value]),
  );
  return {
    weekday: WEEKDAY_ABBR_DISPLAY.findIndex((w) => w.toLowerCase() === parts.weekday.toLowerCase()),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
  };
}

// Next occurrence of a given weekday+hour+minute pattern (e.g. carried over
// from a past quest), starting from referenceDate's local calendar day.
// Today counts if that time hasn't passed yet.
export function nextOccurrenceOfPattern({ weekday, hour, minute }, referenceDate = new Date()) {
  const isToday = weekday === referenceDate.getDay();
  const timeAlreadyPassed = isToday && (() => {
    const candidate = new Date(referenceDate);
    candidate.setHours(hour, minute, 0, 0);
    return candidate.getTime() <= referenceDate.getTime();
  })();
  const date = nextWeekdayDate(weekday, referenceDate, { timeAlreadyPassed });
  return { year: date.getFullYear(), month: date.getMonth(), day: date.getDate(), hour, minute };
}

// Fallback default when the organization has no prior quest to carry a
// when-pattern over from: next Saturday, 6:00 PM.
export function defaultWhenNoHistory(referenceDate = new Date()) {
  return nextOccurrenceOfPattern({ weekday: 6, hour: 18, minute: 0 }, referenceDate);
}

// Same recognized day phrases as parseNaturalWhen (today/tomorrow/weekday/
// "next <day>"/M-D/month-name-day) but with no time-of-day to parse —
// used for the recurring-series "Until" field, which is a plain calendar
// date. "Today" always counts as valid here (there's no time-of-day for it
// to have "already passed"); a same-year explicit date only rolls to next
// year if the *date* itself (not a specific instant) is already in the past.
export function parseNaturalDateOnly(text, referenceDate = new Date()) {
  if (!text || !text.trim()) return null;
  const day = parseDayPhrase(text.trim().toLowerCase());
  if (!day) return null;

  const today = new Date(referenceDate.getFullYear(), referenceDate.getMonth(), referenceDate.getDate());
  let date;
  if (day.kind === 'today') {
    date = today;
  } else if (day.kind === 'tomorrow') {
    date = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
  } else if (day.kind === 'date') {
    const year = day.year ?? referenceDate.getFullYear();
    const candidate = new Date(year, day.month, day.day);
    date = day.year == null && candidate.getTime() < today.getTime()
      ? new Date(year + 1, day.month, day.day)
      : candidate;
  } else {
    date = nextWeekdayDate(day.weekday, referenceDate, { forced: day.forced, timeAlreadyPassed: false });
  }

  return { year: date.getFullYear(), month: date.getMonth(), day: date.getDate() };
}

// "Sat Aug 1, 2026" — the Until field's resolved-value hint.
export function formatDateOnly(when) {
  const date = new Date(when.year, when.month, when.day);
  const weekday = WEEKDAY_ABBR_DISPLAY[date.getDay()];
  const month = MONTH_ABBR[date.getMonth()];
  return `${weekday} ${month} ${date.getDate()}, ${when.year}`;
}

// The plain "YYYY-MM-DD" string the backend's `until` field expects (same
// shape the old <input type="date"> produced).
export function dateOnlyToString(when) {
  return `${when.year}-${pad2(when.month + 1)}-${pad2(when.day)}`;
}
