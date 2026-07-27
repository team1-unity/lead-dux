import { describe, expect, it } from 'vitest';
import {
  parseNaturalWhen,
  addMinutesToWhen,
  resolveEndWhen,
  whenToDatetimeLocalString,
  formatWhenRange,
  nextOccurrenceOfPattern,
  defaultWhenNoHistory,
  parseNaturalDateOnly,
  formatDateOnly,
  dateOnlyToString,
} from '@shared/naturalDate.js';

// A Wednesday, so weekday math below has a predictable starting point.
const REFERENCE = new Date(2026, 6, 22, 12, 0, 0); // Wed Jul 22 2026, noon

// Every parseNaturalWhen result now always carries endHour/endMinute/timezone
// (null unless the text gave an explicit range/tz) — this wraps the plain
// {year,month,day,hour,minute} shape used throughout most of these cases.
function whenOnly(core) {
  return { ...core, endHour: null, endMinute: null, timezone: null };
}

describe('parseNaturalWhen', () => {
  it('parses an explicit weekday + am/pm time', () => {
    // Sat Jul 25 is the next Saturday after Wed Jul 22.
    expect(parseNaturalWhen('sat 6pm', REFERENCE)).toEqual(
      whenOnly({ year: 2026, month: 6, day: 25, hour: 18, minute: 0 }),
    );
  });

  it('parses "tomorrow" with a bare hour, defaulting to PM', () => {
    expect(parseNaturalWhen('tomorrow 7', REFERENCE)).toEqual(
      whenOnly({ year: 2026, month: 6, day: 23, hour: 19, minute: 0 }),
    );
  });

  it('parses "today" when the time is still ahead', () => {
    expect(parseNaturalWhen('today 6pm', REFERENCE)).toEqual(
      whenOnly({ year: 2026, month: 6, day: 22, hour: 18, minute: 0 }),
    );
  });

  it('rolls "today" to tomorrow once the time has already passed', () => {
    expect(parseNaturalWhen('today 9am', REFERENCE)).toEqual(
      whenOnly({ year: 2026, month: 6, day: 23, hour: 9, minute: 0 }),
    );
  });

  it('parses minutes and an explicit am marker', () => {
    expect(parseNaturalWhen('fri 8:30am', REFERENCE)).toEqual(
      whenOnly({ year: 2026, month: 6, day: 24, hour: 8, minute: 30 }),
    );
  });

  it('treats today as a valid weekday match when its time has not passed', () => {
    // REFERENCE is a Wednesday at noon; "wed 6pm" should resolve to today.
    expect(parseNaturalWhen('wed 6pm', REFERENCE)).toEqual(
      whenOnly({ year: 2026, month: 6, day: 22, hour: 18, minute: 0 }),
    );
  });

  it('rolls a same-day weekday match to next week once its time has passed', () => {
    expect(parseNaturalWhen('wed 9am', REFERENCE)).toEqual(
      whenOnly({ year: 2026, month: 6, day: 29, hour: 9, minute: 0 }),
    );
  });

  it('"next <day>" always skips today even if today matches and time has not passed', () => {
    expect(parseNaturalWhen('next wed 6pm', REFERENCE)).toEqual(
      whenOnly({ year: 2026, month: 6, day: 29, hour: 18, minute: 0 }),
    );
  });

  it('accepts full weekday names', () => {
    expect(parseNaturalWhen('saturday 6pm', REFERENCE)).toEqual(
      whenOnly({ year: 2026, month: 6, day: 25, hour: 18, minute: 0 }),
    );
  });

  it('parses M/D slash dates, rolling to next year once passed with no year given', () => {
    // REFERENCE is Jul 22 2026 — 7/1 has already passed this year.
    expect(parseNaturalWhen('07/1 6pm', REFERENCE)).toEqual(
      whenOnly({ year: 2027, month: 6, day: 1, hour: 18, minute: 0 }),
    );
  });

  it('parses M/D slash dates still ahead this year', () => {
    expect(parseNaturalWhen('12/25 6pm', REFERENCE)).toEqual(
      whenOnly({ year: 2026, month: 11, day: 25, hour: 18, minute: 0 }),
    );
  });

  it('parses M/D slash dates with an explicit year', () => {
    expect(parseNaturalWhen('7/1/2025 6pm', REFERENCE)).toEqual(
      whenOnly({ year: 2025, month: 6, day: 1, hour: 18, minute: 0 }),
    );
  });

  it('parses a full month name + day', () => {
    expect(parseNaturalWhen('december 12 6pm', REFERENCE)).toEqual(
      whenOnly({ year: 2026, month: 11, day: 12, hour: 18, minute: 0 }),
    );
  });

  it('parses an abbreviated month name + day with an ordinal suffix', () => {
    expect(parseNaturalWhen('dec 12th 6pm', REFERENCE)).toEqual(
      whenOnly({ year: 2026, month: 11, day: 12, hour: 18, minute: 0 }),
    );
  });

  it('returns null for an invalid slash date (day out of range for the month)', () => {
    expect(parseNaturalWhen('2/30 6pm', REFERENCE)).toBeNull();
  });

  it('returns null for an unrecognized month name', () => {
    expect(parseNaturalWhen('smarch 12 6pm', REFERENCE)).toBeNull();
  });

  it('returns null for unrecognized phrases', () => {
    expect(parseNaturalWhen('whenever works', REFERENCE)).toBeNull();
    expect(parseNaturalWhen('', REFERENCE)).toBeNull();
    expect(parseNaturalWhen('   ', REFERENCE)).toBeNull();
  });

  it('returns null for an out-of-range hour', () => {
    expect(parseNaturalWhen('sat 13pm', REFERENCE)).toBeNull();
  });

  describe('explicit start–end hour ranges', () => {
    it('applies a trailing pm to both sides of a bare range', () => {
      expect(parseNaturalWhen('aug 2 6-9pm', REFERENCE)).toEqual({
        year: 2026, month: 7, day: 2, hour: 18, minute: 0,
        endHour: 21, endMinute: 0, timezone: null,
      });
    });

    it('keeps distinct explicit meridiems on each side', () => {
      expect(parseNaturalWhen('aug 2 11am-1pm', REFERENCE)).toEqual({
        year: 2026, month: 7, day: 2, hour: 11, minute: 0,
        endHour: 13, endMinute: 0, timezone: null,
      });
    });

    it('parses minutes on both sides of a range', () => {
      expect(parseNaturalWhen('aug 2 6:15-8:45pm', REFERENCE)).toEqual({
        year: 2026, month: 7, day: 2, hour: 18, minute: 15,
        endHour: 20, endMinute: 45, timezone: null,
      });
    });
  });

  describe('trailing timezone abbreviations', () => {
    it('resolves a recognized abbreviation to an IANA zone', () => {
      expect(parseNaturalWhen('aug 2 6-9pm est', REFERENCE)).toEqual({
        year: 2026, month: 7, day: 2, hour: 18, minute: 0,
        endHour: 21, endMinute: 0, timezone: 'America/New_York',
      });
    });

    it('works with a single time (no range) too', () => {
      expect(parseNaturalWhen('sat 6pm pst', REFERENCE)).toEqual({
        year: 2026, month: 6, day: 25, hour: 18, minute: 0,
        endHour: null, endMinute: null, timezone: 'America/Los_Angeles',
      });
    });

    it('leaves the text untouched when the trailing word is not a known abbreviation', () => {
      expect(parseNaturalWhen('sat 6pm', REFERENCE).timezone).toBeNull();
    });
  });
});

describe('addMinutesToWhen', () => {
  it('adds minutes within the same day', () => {
    expect(addMinutesToWhen({ year: 2026, month: 6, day: 25, hour: 18, minute: 0 }, 120)).toEqual({
      year: 2026, month: 6, day: 25, hour: 20, minute: 0,
    });
  });

  it('rolls over into the next day past midnight', () => {
    expect(addMinutesToWhen({ year: 2026, month: 6, day: 25, hour: 23, minute: 0 }, 120)).toEqual({
      year: 2026, month: 6, day: 26, hour: 1, minute: 0,
    });
  });
});

describe('resolveEndWhen', () => {
  it('falls back to the default duration when no explicit end time was given', () => {
    const when = { year: 2026, month: 6, day: 25, hour: 18, minute: 0, endHour: null, endMinute: null };
    expect(resolveEndWhen(when, 120)).toEqual({ year: 2026, month: 6, day: 25, hour: 20, minute: 0 });
  });

  it('uses the explicit end time on the same day when it is after the start', () => {
    const when = { year: 2026, month: 6, day: 25, hour: 18, minute: 0, endHour: 21, endMinute: 0 };
    expect(resolveEndWhen(when, 120)).toEqual({ year: 2026, month: 6, day: 25, hour: 21, minute: 0 });
  });

  it('rolls an overnight range (end <= start) to the next day', () => {
    const when = { year: 2026, month: 6, day: 25, hour: 23, minute: 0, endHour: 1, endMinute: 0 };
    expect(resolveEndWhen(when, 120)).toEqual({ year: 2026, month: 6, day: 26, hour: 1, minute: 0 });
  });
});

describe('whenToDatetimeLocalString', () => {
  it('formats as a zero-padded datetime-local string', () => {
    expect(whenToDatetimeLocalString({ year: 2026, month: 0, day: 5, hour: 9, minute: 5 }))
      .toBe('2026-01-05T09:05');
  });
});

describe('formatWhenRange', () => {
  it('compresses a shared meridiem to one trailing label', () => {
    const when = { year: 2026, month: 7, day: 1, hour: 18, minute: 0 };
    expect(formatWhenRange(when, addMinutesToWhen(when, 120))).toBe('Sat Aug 1, 6–8 PM');
  });

  it('shows both meridiems when start and end differ', () => {
    const when = { year: 2026, month: 7, day: 1, hour: 11, minute: 0 };
    expect(formatWhenRange(when, addMinutesToWhen(when, 120))).toBe('Sat Aug 1, 11 AM–1 PM');
  });

  it('includes minutes when non-zero', () => {
    const when = { year: 2026, month: 7, day: 1, hour: 18, minute: 30 };
    expect(formatWhenRange(when, addMinutesToWhen(when, 90))).toBe('Sat Aug 1, 6:30–8 PM');
  });

  it('formats an explicit end time the same way as a default-duration one', () => {
    const when = { year: 2026, month: 7, day: 2, hour: 18, minute: 0 };
    expect(formatWhenRange(when, { year: 2026, month: 7, day: 2, hour: 21, minute: 0 }))
      .toBe('Sun Aug 2, 6–9 PM');
  });
});

describe('nextOccurrenceOfPattern', () => {
  it('finds the next matching weekday, skipping today if the time has passed', () => {
    expect(nextOccurrenceOfPattern({ weekday: 3, hour: 9, minute: 0 }, REFERENCE)).toEqual({
      year: 2026, month: 6, day: 29, hour: 9, minute: 0,
    });
  });

  it('keeps today when its time has not passed yet', () => {
    expect(nextOccurrenceOfPattern({ weekday: 3, hour: 18, minute: 0 }, REFERENCE)).toEqual({
      year: 2026, month: 6, day: 22, hour: 18, minute: 0,
    });
  });
});

describe('defaultWhenNoHistory', () => {
  it('defaults to the next Saturday at 6 PM', () => {
    expect(defaultWhenNoHistory(REFERENCE)).toEqual({
      year: 2026, month: 6, day: 25, hour: 18, minute: 0,
    });
  });
});

describe('parseNaturalDateOnly', () => {
  it('treats "today" as always valid, with no time to have passed', () => {
    expect(parseNaturalDateOnly('today', REFERENCE)).toEqual({ year: 2026, month: 6, day: 22 });
  });

  it('parses "tomorrow"', () => {
    expect(parseNaturalDateOnly('tomorrow', REFERENCE)).toEqual({ year: 2026, month: 6, day: 23 });
  });

  it('treats the current weekday as valid today (no time-of-day gate)', () => {
    expect(parseNaturalDateOnly('wed', REFERENCE)).toEqual({ year: 2026, month: 6, day: 22 });
  });

  it('"next <day>" still skips to the following week', () => {
    expect(parseNaturalDateOnly('next wed', REFERENCE)).toEqual({ year: 2026, month: 6, day: 29 });
  });

  it('parses a slash date, rolling to next year once the date itself has passed', () => {
    expect(parseNaturalDateOnly('7/1', REFERENCE)).toEqual({ year: 2027, month: 6, day: 1 });
  });

  it('parses a month-name date still ahead this year', () => {
    expect(parseNaturalDateOnly('december 25', REFERENCE)).toEqual({ year: 2026, month: 11, day: 25 });
  });

  it('returns null for unrecognized text', () => {
    expect(parseNaturalDateOnly('whenever', REFERENCE)).toBeNull();
    expect(parseNaturalDateOnly('', REFERENCE)).toBeNull();
  });
});

describe('formatDateOnly', () => {
  it('formats a resolved date-only value', () => {
    expect(formatDateOnly({ year: 2026, month: 7, day: 1 })).toBe('Sat Aug 1, 2026');
  });
});

describe('dateOnlyToString', () => {
  it('formats as a zero-padded YYYY-MM-DD string', () => {
    expect(dateOnlyToString({ year: 2026, month: 0, day: 5 })).toBe('2026-01-05');
  });
});
