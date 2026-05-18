import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  todayStr,
  lastNDays,
  daysBetween,
  hoursSince,
  relTime,
  formatDuration,
  formatShort,
  formatLong,
  greeting,
  cn,
  clamp,
  pct,
  escapeHtml,
} from './helpers';

describe('helpers', () => {
  describe('todayStr', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-05-10T12:00:00Z'));
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it('returns YYYY-MM-DD for the current date', () => {
      expect(todayStr()).toBe('2026-05-10');
    });
  });

  describe('lastNDays', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-05-10T12:00:00Z'));
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it('returns 7 strings in YYYY-MM-DD format', () => {
      const days = lastNDays(7);
      expect(days).toHaveLength(7);
      for (const d of days) expect(d).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it('ends with today and is in chronological order', () => {
      const days = lastNDays(7);
      expect(days[days.length - 1]).toBe('2026-05-10');
      for (let i = 1; i < days.length; i++) expect(days[i]! > days[i - 1]!).toBe(true);
    });
  });

  describe('daysBetween', () => {
    it('returns 2 across US spring-forward DST (2024-03-10)', () => {
      expect(daysBetween('2024-03-09', '2024-03-11')).toBe(2);
    });

    it('returns 2 across US fall-back DST (2024-11-03)', () => {
      expect(daysBetween('2024-11-02', '2024-11-04')).toBe(2);
    });

    it('returns 0 for same-day input', () => {
      expect(daysBetween('2026-05-10', '2026-05-10')).toBe(0);
    });
  });

  describe('hoursSince', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-05-10T12:00:00Z'));
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it('returns 1 for an iso string 1 hour ago', () => {
      expect(hoursSince('2026-05-10T11:00:00Z')).toBeCloseTo(1, 1);
    });

    it('returns 0 for now', () => {
      expect(hoursSince('2026-05-10T12:00:00Z')).toBeCloseTo(0, 1);
    });
  });

  describe('relTime', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-05-10T12:00:00Z'));
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it('returns "today" for timestamps within the same day', () => {
      expect(relTime('2026-05-10T11:59:30Z')).toBe('today');
    });

    it('returns "yesterday" for one day ago', () => {
      expect(relTime('2026-05-09T12:00:00Z')).toBe('yesterday');
    });

    it('returns a non-empty string for various lookbacks', () => {
      expect(relTime('2026-05-03T12:00:00Z')).toMatch(/\w/);
      expect(relTime('2026-04-01T12:00:00Z')).toMatch(/\w/);
    });
  });

  // formatDuration takes HOURS (not minutes) per the implementation
  describe('formatDuration', () => {
    it('handles sub-hour value (returns minutes)', () => {
      // 0.5 hours = 30 minutes
      expect(formatDuration(0.5)).toBe('30m');
    });

    it('handles zero', () => {
      // 0 hours = 0 minutes
      expect(formatDuration(0)).toBe('0m');
    });

    it('handles exactly 1 hour', () => {
      expect(formatDuration(1)).toBe('1h');
    });

    it('handles multi-hour value', () => {
      // 2.5 hours -> rounds to 3h (Math.round(2.5) = 3)
      expect(formatDuration(2)).toBe('2h');
    });

    it('handles multi-day value', () => {
      // 25 hours = 1 day + 1 hour
      expect(formatDuration(25)).toBe('1d 1h');
    });
  });

  describe('greeting', () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it('returns "morning" for 8am local time', () => {
      // greeting() reads new Date().getHours() which uses LOCAL time
      // We set a UTC time that maps to local-morning hours
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-05-10T08:00:00'));
      expect(greeting()).toMatch(/morning/);
    });

    it('returns "afternoon" for 14:00 local time', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-05-10T14:00:00'));
      expect(greeting()).toMatch(/afternoon/);
    });

    it('returns "evening" for 20:00 local time', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-05-10T20:00:00'));
      expect(greeting()).toMatch(/evening/);
    });
  });

  describe('cn', () => {
    it('joins truthy strings with single spaces', () => {
      expect(cn('a', 'b', 'c')).toBe('a b c');
    });

    it('drops falsy values', () => {
      expect(cn('a', false, null, undefined, 'b')).toBe('a b');
    });

    it('returns empty string when all values are falsy', () => {
      expect(cn(false, null, undefined)).toBe('');
    });
  });

  describe('clamp', () => {
    it('returns the value when within range', () => {
      expect(clamp(5, 0, 10)).toBe(5);
    });

    it('clamps to lower bound', () => {
      expect(clamp(-1, 0, 10)).toBe(0);
    });

    it('clamps to upper bound', () => {
      expect(clamp(11, 0, 10)).toBe(10);
    });
  });

  describe('pct', () => {
    it('computes percentage', () => {
      expect(pct(25, 100)).toBe(25);
    });

    it('handles divide-by-zero without crash', () => {
      expect(pct(0, 0)).toBe(0);
    });

    it('clamps to 100 when value exceeds target', () => {
      expect(pct(200, 100)).toBe(100);
    });
  });

  describe('escapeHtml', () => {
    it('escapes angle brackets', () => {
      const out = escapeHtml('<script>');
      expect(out).toContain('&lt;');
      expect(out).toContain('&gt;');
    });

    it('escapes ampersands', () => {
      expect(escapeHtml('a & b')).toContain('&amp;');
    });

    it('escapes double quotes', () => {
      expect(escapeHtml('"quoted"')).toContain('&quot;');
    });

    it('handles null/undefined without crash', () => {
      expect(escapeHtml(null)).toBe('');
      expect(escapeHtml(undefined)).toBe('');
    });
  });

  // Phase 32 Plan 32-02 — locale-aware date formatters.
  describe('formatShort (locale)', () => {
    it('defaults to "en" when no locale supplied (backward compat)', () => {
      // Jan 15 → "Jan 15" in EN
      expect(formatShort('2026-01-15T12:00:00Z', 'en')).toMatch(/Jan/);
      expect(formatShort('2026-01-15T12:00:00Z')).toMatch(/Jan/);
    });

    it('renders Spanish month abbreviation when locale="es"', () => {
      // Jan 15 in Spanish → "15 ene" (no period in modern ICU; "ene"
      // is the unambiguous Spanish January abbreviation).
      expect(formatShort('2026-01-15T12:00:00Z', 'es')).toMatch(/ene/);
    });

    it('returns the raw input when the date is invalid', () => {
      expect(formatShort('not-a-date', 'es')).toBe('not-a-date');
    });
  });

  describe('formatLong (locale)', () => {
    it('includes a year and the EN month name by default', () => {
      const out = formatLong('2026-03-08T12:00:00Z');
      expect(out).toMatch(/2026/);
      expect(out).toMatch(/Mar/);
    });

    it('renders Spanish month abbreviation when locale="es"', () => {
      const out = formatLong('2026-03-08T12:00:00Z', 'es');
      expect(out).toMatch(/mar/);
      expect(out).toMatch(/2026/);
    });
  });

  describe('relTime (locale)', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-05-10T12:00:00Z'));
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it('returns the legacy "today" string when locale is undefined or "en"', () => {
      expect(relTime('2026-05-10T11:00:00Z')).toBe('today');
      expect(relTime('2026-05-10T11:00:00Z', 'en')).toBe('today');
    });

    it('renders Spanish relative day when locale="es"', () => {
      // 1 day ago in Spanish via Intl.RelativeTimeFormat → "ayer" (numeric: 'auto')
      const out = relTime('2026-05-09T12:00:00Z', 'es');
      expect(out).toMatch(/ayer/);
    });

    it('renders Spanish "today" via Intl when locale="es"', () => {
      const out = relTime('2026-05-10T11:00:00Z', 'es');
      // numeric:'auto' for `relative.format(0, 'day')` in es → "hoy"
      expect(out).toMatch(/hoy/);
    });
  });

  // greeting() (Phase 32 Plan 32-02 — keep slot-returning contract).
  describe('greeting (slot enum)', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it('returns "morning" at 9am local', () => {
      const d = new Date();
      d.setHours(9, 0, 0, 0);
      vi.setSystemTime(d);
      expect(greeting()).toBe('morning');
    });

    it('returns "afternoon" at 14:00 local', () => {
      const d = new Date();
      d.setHours(14, 0, 0, 0);
      vi.setSystemTime(d);
      expect(greeting()).toBe('afternoon');
    });

    it('returns "evening" at 22:00 local', () => {
      const d = new Date();
      d.setHours(22, 0, 0, 0);
      vi.setSystemTime(d);
      expect(greeting()).toBe('evening');
    });
  });
});
