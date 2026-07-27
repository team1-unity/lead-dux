import { describe, expect, it } from 'vitest';
import { normalizeSuggestion } from '@shared/placeCombobox.js';

describe('normalizeSuggestion', () => {
  it('reads FormattableText objects ({ text, matches }) for each field', () => {
    const prediction = {
      placeId: 'place-1',
      mainText: { text: 'Prospect Park Boathouse', matches: [] },
      secondaryText: { text: 'Brooklyn, NY', matches: [] },
      text: { text: 'Prospect Park Boathouse, Brooklyn, NY', matches: [] },
    };
    expect(normalizeSuggestion(prediction)).toEqual({
      id: 'place-1',
      mainText: 'Prospect Park Boathouse',
      secondaryText: 'Brooklyn, NY',
    });
  });

  it('also accepts plain strings for each field, defensively', () => {
    const prediction = {
      placeId: 'place-2',
      mainText: 'Central Park',
      secondaryText: 'New York, NY',
      text: 'Central Park, New York, NY',
    };
    expect(normalizeSuggestion(prediction)).toEqual({
      id: 'place-2',
      mainText: 'Central Park',
      secondaryText: 'New York, NY',
    });
  });

  it('falls back to the full text when mainText is missing', () => {
    const prediction = {
      placeId: 'place-3',
      mainText: null,
      secondaryText: null,
      text: { text: 'Some Venue, Some City' },
    };
    expect(normalizeSuggestion(prediction)).toEqual({
      id: 'place-3',
      mainText: 'Some Venue, Some City',
      secondaryText: '',
    });
  });

  it('falls back to "Unknown place" when nothing at all is present', () => {
    const prediction = { placeId: 'place-4' };
    expect(normalizeSuggestion(prediction)).toEqual({
      id: 'place-4',
      mainText: 'Unknown place',
      secondaryText: '',
    });
  });

  it('falls back to the full text as the id when placeId is missing', () => {
    const prediction = { text: { text: 'Some Place' } };
    expect(normalizeSuggestion(prediction)).toEqual({
      id: 'Some Place',
      mainText: 'Some Place',
      secondaryText: '',
    });
  });
});
