import { describe, expect, it } from 'vitest';
import { buildDirectionsUrl } from '@shared/mapLinks.js';

describe('buildDirectionsUrl', () => {
  it('builds a Google Maps directions deep link from lat/lng', () => {
    expect(buildDirectionsUrl(40.7128, -74.006)).toBe(
      'https://www.google.com/maps/dir/?api=1&destination=40.7128,-74.006',
    );
  });

  it('handles negative latitude too', () => {
    expect(buildDirectionsUrl(-33.8688, 151.2093)).toBe(
      'https://www.google.com/maps/dir/?api=1&destination=-33.8688,151.2093',
    );
  });
});
