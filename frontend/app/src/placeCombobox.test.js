import { describe, expect, it } from 'vitest';
import { normalizeSuggestion } from '@shared/placeCombobox.js';

describe('normalizeSuggestion', () => {
  it('maps a full Geoapify autocomplete result', () => {
    const result = {
      place_id: 'place-1',
      address_line1: 'Prospect Park Boathouse',
      address_line2: 'Brooklyn, NY, United States of America',
      formatted: 'Prospect Park Boathouse, Brooklyn, NY, United States of America',
      lat: 40.660204,
      lon: -73.968956,
    };
    expect(normalizeSuggestion(result)).toEqual({
      id: 'place-1',
      mainText: 'Prospect Park Boathouse',
      secondaryText: 'Brooklyn, NY, United States of America',
      formatted: 'Prospect Park Boathouse, Brooklyn, NY, United States of America',
      lat: 40.660204,
      lng: -73.968956,
    });
  });

  it('falls back to the formatted address when address_line1 is missing', () => {
    const result = { place_id: 'place-2', formatted: 'Some Venue, Some City', lat: 1, lon: 2 };
    expect(normalizeSuggestion(result)).toEqual({
      id: 'place-2',
      mainText: 'Some Venue, Some City',
      secondaryText: '',
      formatted: 'Some Venue, Some City',
      lat: 1,
      lng: 2,
    });
  });

  it('falls back to "Unknown place" when nothing at all is present', () => {
    const result = { place_id: 'place-3' };
    expect(normalizeSuggestion(result)).toEqual({
      id: 'place-3',
      mainText: 'Unknown place',
      secondaryText: '',
      formatted: '',
      lat: undefined,
      lng: undefined,
    });
  });

  it('falls back to the formatted address as the id when place_id is missing', () => {
    const result = { formatted: 'Some Place', lat: 1, lon: 2 };
    expect(normalizeSuggestion(result)).toEqual({
      id: 'Some Place',
      mainText: 'Some Place',
      secondaryText: '',
      formatted: 'Some Place',
      lat: 1,
      lng: 2,
    });
  });

  it('falls back to "unknown" as the id when neither place_id nor formatted is present', () => {
    const result = {};
    expect(normalizeSuggestion(result)).toEqual({
      id: 'unknown',
      mainText: 'Unknown place',
      secondaryText: '',
      formatted: '',
      lat: undefined,
      lng: undefined,
    });
  });
});
