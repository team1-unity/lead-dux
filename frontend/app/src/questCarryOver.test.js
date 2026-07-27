import { describe, expect, it } from 'vitest';
import { pickLastQuest, buildCarryOverDefaults, applyLocationChange } from '@shared/questCarryOver.js';

describe('pickLastQuest', () => {
  it('returns null when there are no quests', () => {
    expect(pickLastQuest([])).toBeNull();
    expect(pickLastQuest(null)).toBeNull();
  });

  it('picks the quest with the most recent createdAt (Firestore Timestamp shape)', () => {
    const older = { id: 'a', createdAt: { toMillis: () => 100 } };
    const newer = { id: 'b', createdAt: { toMillis: () => 200 } };
    expect(pickLastQuest([older, newer])).toBe(newer);
  });

  it('handles plain numeric/date createdAt values the same way', () => {
    const older = { id: 'a', createdAt: 100 };
    const newer = { id: 'b', createdAt: new Date(200) };
    expect(pickLastQuest([newer, older])).toBe(newer);
  });
});

describe('buildCarryOverDefaults', () => {
  it('returns an empty, non-carried starting state when there is no last quest', () => {
    expect(buildCarryOverDefaults(null)).toEqual({
      location: '',
      placeId: null,
      lat: null,
      lng: null,
      accommodationTags: [],
      accommodationDetails: '',
      accessConfirmedNone: false,
      whenPattern: null,
      timezone: null,
      carriedLocation: false,
      carriedAccess: false,
    });
  });

  it('copies location/access/when from the last quest and marks them carried', () => {
    const lastQuest = {
      location: 'Prospect Park Boathouse',
      placeId: 'place-1',
      lat: 40.6,
      lng: -73.9,
      accommodationTags: ['wheelchair-accessible', 'accessible-parking'],
      accommodationDetails: 'Ring the side bell.',
      eventDate: '2026-07-18T18:00:00.000Z',
      timezone: 'America/New_York',
    };
    const defaults = buildCarryOverDefaults(lastQuest);
    expect(defaults.location).toBe('Prospect Park Boathouse');
    expect(defaults.placeId).toBe('place-1');
    expect(defaults.accommodationTags).toEqual(['wheelchair-accessible', 'accessible-parking']);
    expect(defaults.accommodationDetails).toBe('Ring the side bell.');
    expect(defaults.timezone).toBe('America/New_York');
    expect(defaults.carriedLocation).toBe(true);
    expect(defaults.carriedAccess).toBe(true);
  });

  it('does not mark access as carried when the last quest had no accommodation tags', () => {
    const defaults = buildCarryOverDefaults({ location: 'Somewhere', placeId: 'p', accommodationTags: [] });
    expect(defaults.carriedAccess).toBe(false);
  });

  it('does not mutate the source quest\'s accommodationTags array', () => {
    const tags = ['wheelchair-accessible'];
    const lastQuest = { accommodationTags: tags };
    const defaults = buildCarryOverDefaults(lastQuest);
    defaults.accommodationTags.push('elevator-access');
    expect(tags).toEqual(['wheelchair-accessible']);
  });
});

describe('applyLocationChange', () => {
  it('clears carried-over access chips when the location changes', () => {
    const carried = buildCarryOverDefaults({
      location: 'Old Venue',
      placeId: 'old-place',
      accommodationTags: ['wheelchair-accessible'],
      accommodationDetails: 'Old note',
    });
    const next = applyLocationChange(carried, {
      location: 'New Venue', placeId: 'new-place', lat: 1, lng: 2,
    });
    expect(next.location).toBe('New Venue');
    expect(next.placeId).toBe('new-place');
    expect(next.accommodationTags).toEqual([]);
    expect(next.accommodationDetails).toBe('');
    expect(next.carriedAccess).toBe(false);
    expect(next.carriedLocation).toBe(false);
  });

  it('also clears access chips the organizer had already hand-picked (not just carried ones)', () => {
    const state = {
      location: 'Old Venue', placeId: 'old-place',
      accommodationTags: ['sensory-friendly'], accommodationDetails: 'hand-typed note',
      accessConfirmedNone: false, carriedAccess: false, carriedLocation: false,
    };
    const next = applyLocationChange(state, { location: 'New Venue', placeId: 'new-place', lat: 1, lng: 2 });
    expect(next.accommodationTags).toEqual([]);
    expect(next.accommodationDetails).toBe('');
  });
});
