import { describe, expect, it } from 'vitest';
import {
  buildGoogleCalendarUrl,
  buildIcsContent,
  buildOutlookCalendarUrl,
  escapeIcsText,
  questToCalendarEvent,
} from '@shared/calendar.js';

const SAMPLE_QUEST = {
  id: 'quest-1',
  title: 'River Trail Cleanup',
  description: 'Help clear litter along the trail.',
  location: 'Riverside Park',
  timezone: 'America/New_York',
  eventDate: '2026-07-20T18:00:00.000Z',
  eventEndTime: '2026-07-20T20:00:00.000Z',
};

describe('questToCalendarEvent', () => {
  it('normalizes ISO string fields into Date objects', () => {
    const event = questToCalendarEvent(SAMPLE_QUEST);

    expect(event.title).toBe('River Trail Cleanup');
    expect(event.location).toBe('Riverside Park');
    expect(event.start).toEqual(new Date('2026-07-20T18:00:00.000Z'));
    expect(event.end).toEqual(new Date('2026-07-20T20:00:00.000Z'));
  });

  it('falls back to the default 6-hour window when eventEndTime is missing', () => {
    const event = questToCalendarEvent({ ...SAMPLE_QUEST, eventEndTime: null });

    expect(event.end).toEqual(new Date('2026-07-21T00:00:00.000Z'));
  });

  it('reads a Firestore Timestamp-like object via .toDate()', () => {
    const asTimestamp = {
      ...SAMPLE_QUEST,
      eventDate: { toDate: () => new Date('2026-07-20T18:00:00.000Z') },
      eventEndTime: { toDate: () => new Date('2026-07-20T20:00:00.000Z') },
    };

    const event = questToCalendarEvent(asTimestamp);

    expect(event.start).toEqual(new Date('2026-07-20T18:00:00.000Z'));
  });
});

describe('buildIcsContent', () => {
  it('contains the correct title, location, description, and UTC date/time', () => {
    const event = questToCalendarEvent(SAMPLE_QUEST);
    const ics = buildIcsContent(event, { uid: 'quest-1', now: new Date('2026-07-01T00:00:00.000Z') });

    expect(ics).toContain('SUMMARY:River Trail Cleanup');
    expect(ics).toContain('LOCATION:Riverside Park');
    expect(ics).toContain('DESCRIPTION:Help clear litter along the trail.');
    expect(ics).toContain('DTSTART:20260720T180000Z');
    expect(ics).toContain('DTEND:20260720T200000Z');
    expect(ics).toContain('DTSTAMP:20260701T000000Z');
    expect(ics).toContain('UID:quest-1');
    expect(ics.startsWith('BEGIN:VCALENDAR')).toBe(true);
    expect(ics.trim().endsWith('END:VCALENDAR')).toBe(true);
  });

  it('escapes commas, semicolons, backslashes, and newlines in free text', () => {
    const event = questToCalendarEvent({
      ...SAMPLE_QUEST,
      title: 'Cleanup; Bring gloves, boots\nand a hat',
      description: 'Path: C:\\trail',
    });
    const ics = buildIcsContent(event);

    expect(ics).toContain('SUMMARY:Cleanup\\; Bring gloves\\, boots\\nand a hat');
    expect(ics).toContain('DESCRIPTION:Path: C:\\\\trail');
  });
});

describe('escapeIcsText', () => {
  it('escapes the backslash first so it does not double-escape other characters', () => {
    expect(escapeIcsText('a\\,b')).toBe('a\\\\\\,b');
  });
});

describe('buildGoogleCalendarUrl', () => {
  it('includes the correct UTC dates range, location, and timezone', () => {
    const event = questToCalendarEvent(SAMPLE_QUEST);
    const url = new URL(buildGoogleCalendarUrl(event));

    expect(url.origin + url.pathname).toBe('https://calendar.google.com/calendar/render');
    expect(url.searchParams.get('text')).toBe('River Trail Cleanup');
    expect(url.searchParams.get('dates')).toBe('20260720T180000Z/20260720T200000Z');
    expect(url.searchParams.get('location')).toBe('Riverside Park');
    expect(url.searchParams.get('ctz')).toBe('America/New_York');
  });
});

describe('buildOutlookCalendarUrl', () => {
  it('includes the correct subject, location, and ISO start/end', () => {
    const event = questToCalendarEvent(SAMPLE_QUEST);
    const url = new URL(buildOutlookCalendarUrl(event));

    expect(url.searchParams.get('subject')).toBe('River Trail Cleanup');
    expect(url.searchParams.get('location')).toBe('Riverside Park');
    expect(url.searchParams.get('startdt')).toBe('2026-07-20T18:00:00.000Z');
    expect(url.searchParams.get('enddt')).toBe('2026-07-20T20:00:00.000Z');
  });
});
