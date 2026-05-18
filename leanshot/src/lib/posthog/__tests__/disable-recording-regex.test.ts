/**
 * Tests for the PostHog session-recording deny-list (Phase 50 D-34 / HIPAA-17).
 *
 * Covers:
 * - Snapshot pin on the regex source string (catches accidental edits).
 * - Phase 50 D-34 matches: /admin/rag/* and /research/* subpaths.
 * - Phase 25 HIPAA-17 regression: all prior path segments still match.
 * - Boundary safety: /research-tool MUST NOT match (only /research and /research/...).
 * - Re-export from src/lib/analytics.ts is the same constant.
 */
import { describe, it, expect } from 'vitest';
import { DISABLE_RECORDING_URL_REGEX as REGEX_FROM_ANALYTICS } from '../../analytics';
import { DISABLE_RECORDING_URL_REGEX } from '../disable-recording-regex';

describe('DISABLE_RECORDING_URL_REGEX — session-recording deny-list', () => {
  it('snapshot — exact regex source is pinned', () => {
    expect(DISABLE_RECORDING_URL_REGEX.source).toMatchInlineSnapshot(
      `"\\/(clinic|patient|admin\\/users|admin\\/rag|dose-log|share|auth|research)(\\/|$)"`,
    );
    expect(DISABLE_RECORDING_URL_REGEX.flags).toBe('i');
  });

  it('re-export from src/lib/analytics.ts is the SAME constant (single source of truth)', () => {
    expect(REGEX_FROM_ANALYTICS).toBe(DISABLE_RECORDING_URL_REGEX);
  });

  describe('Phase 50 D-34 — admin/rag + research paths match', () => {
    it.each([
      '/admin/rag/topics',
      '/admin/rag/sources',
      '/admin/rag/queue',
      '/admin/rag/telemetry',
      '/admin/rag/cost',
      '/admin/rag', // exact root (boundary `(/|$)`)
      '/research',
      '/research/peptide-fact',
      '/research/topic/glp-1',
    ])('matches %s', (path) => {
      expect(path).toMatch(DISABLE_RECORDING_URL_REGEX);
    });
  });

  describe('Phase 25 HIPAA-17 — regression: prior paths still match', () => {
    it.each([
      '/clinic',
      '/clinic/operators',
      '/patient',
      '/patient/12345',
      '/admin/users',
      '/admin/users/abc',
      '/dose-log',
      '/dose-log/2025-05-01',
      '/share',
      '/share/abc123',
      '/auth',
      '/auth/callback',
    ])('matches %s', (path) => {
      expect(path).toMatch(DISABLE_RECORDING_URL_REGEX);
    });
  });

  describe('boundary safety — non-matching paths', () => {
    it.each([
      '/dashboard',
      '/research-tool', // CRITICAL: must NOT match (would be a false-positive for `/research`)
      '/researchers', // CRITICAL: must NOT match
      '/clinical-trial', // not under /clinic/
      '/patients', // not under /patient/
      '/admin/rag-broken', // must NOT match `/admin/rag` due to `-` after
      '/admin', // bare /admin not in deny-list
      '/',
      '/home',
      '/marketing',
    ])('does NOT match %s', (path) => {
      expect(path).not.toMatch(DISABLE_RECORDING_URL_REGEX);
    });
  });

  it('case-insensitive — uppercase URL segments still match (i flag)', () => {
    expect('/RESEARCH/foo').toMatch(DISABLE_RECORDING_URL_REGEX);
    expect('/Admin/Rag/Queue').toMatch(DISABLE_RECORDING_URL_REGEX);
  });
});
