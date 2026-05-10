import { describe, expect, it } from 'vitest';
import { calcStreak } from './useStreaks';

describe('calcStreak', () => {
  const today = new Date('2026-05-10T12:00:00Z');

  it('returns 365 when predicate is true every day', () => {
    expect(calcStreak(() => true, today)).toBe(365);
  });

  it('returns 0 when predicate is false every day', () => {
    expect(calcStreak(() => false, today)).toBe(0);
  });

  it('counts consecutive days back from today', () => {
    const recentDates = new Set(['2026-05-10', '2026-05-09', '2026-05-08', '2026-05-07']);
    expect(calcStreak((ds) => recentDates.has(ds), today)).toBe(4);
  });

  it('allows today to be missing without breaking the streak count', () => {
    // Predicate is false today but true for yesterday + day-before
    const past = new Set(['2026-05-09', '2026-05-08']);
    expect(calcStreak((ds) => past.has(ds), today)).toBe(2);
  });

  it('breaks the streak on the first prior-day miss', () => {
    // True today + day-1, false day-2, true day-3 — counts 2 (breaks at day 2)
    const dates = new Set(['2026-05-10', '2026-05-09', '2026-05-07']);
    expect(calcStreak((ds) => dates.has(ds), today)).toBe(2);
  });
});
