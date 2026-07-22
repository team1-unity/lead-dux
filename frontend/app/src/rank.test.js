import { describe, expect, it } from 'vitest';
import { pointsToNextRank, progressPercent, rankForPoints } from '@shared/rank.js';

describe('rankForPoints', () => {
  it('starts at Iron for zero or negative points', () => {
    expect(rankForPoints(0)).toBe('Iron');
    expect(rankForPoints(-10)).toBe('Iron');
  });

  it('advances a rank every 100 points', () => {
    expect(rankForPoints(99)).toBe('Iron');
    expect(rankForPoints(100)).toBe('Bronze');
    expect(rankForPoints(250)).toBe('Silver');
    expect(rankForPoints(399)).toBe('Gold');
  });

  it('caps at Diamond', () => {
    expect(rankForPoints(400)).toBe('Diamond');
    expect(rankForPoints(10_000)).toBe('Diamond');
  });
});

describe('pointsToNextRank', () => {
  it('counts down to the next 100-point threshold', () => {
    expect(pointsToNextRank(0)).toBe(100);
    expect(pointsToNextRank(80)).toBe(20);
    expect(pointsToNextRank(150)).toBe(50);
  });

  it('is null once at Diamond', () => {
    expect(pointsToNextRank(400)).toBeNull();
    expect(pointsToNextRank(1000)).toBeNull();
  });
});

describe('progressPercent', () => {
  it('reflects progress through the current rank only', () => {
    expect(progressPercent(0)).toBe(0);
    expect(progressPercent(50)).toBe(50);
    expect(progressPercent(150)).toBe(50);
  });

  it('is pinned at 100 once at Diamond', () => {
    expect(progressPercent(400)).toBe(100);
    expect(progressPercent(1000)).toBe(100);
  });
});
