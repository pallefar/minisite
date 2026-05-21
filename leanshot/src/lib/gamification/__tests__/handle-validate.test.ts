/**
 * D-13: handle validation — client mirror of server CHECK constraint.
 * Server regex: ^[a-zA-Z0-9_-]{6,24}$
 */
import { describe, expect, it } from 'vitest';

import { validateHandle } from '../handle-validate';

describe('validateHandle (D-13)', () => {
  // --- Valid handles ---
  const validHandles = [
    'PeptidePioneer-7841',
    'curve_runner_22',
    'ABC123',
    'user-with-dashes',
    'abcdef',            // exactly 6 chars (min)
    'a'.repeat(24),     // exactly 24 chars (max)
    'A1-b2_c3',
    'Tracker-9999',
    '123456',           // all digits, exactly 6
    'UPPER-lower-123',
  ];

  it.each(validHandles)('accepts valid handle %s', (h) => {
    expect(validateHandle(h).ok).toBe(true);
  });

  // --- Invalid handles ---
  const invalidHandles: Array<[string, string]> = [
    ['', 'empty'],
    ['     ', 'empty'],        // whitespace-only
    ['short', 'too_short'],    // 5 chars
    ['x'.repeat(25), 'too_long'],
    ['John Smith', 'invalid_characters'],       // real name with space
    ['user@example', 'invalid_characters'],     // @ blocked
    ['café-runner', 'invalid_characters'],      // diacritic blocked
    ['user with spaces', 'invalid_characters'], // spaces blocked
    ['handle!bang', 'invalid_characters'],      // ! blocked
    ['handle#hash', 'invalid_characters'],      // # blocked
    ['naïve-user', 'invalid_characters'],       // diacritic (ï)
    ['user.name', 'invalid_characters'],        // period blocked
    ['user+plus', 'invalid_characters'],        // + blocked
  ];

  it.each(invalidHandles)('rejects %j with error %s', (h, expectedError) => {
    const result = validateHandle(h);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe(expectedError);
      expect(typeof result.message).toBe('string');
      expect(result.message.length).toBeGreaterThan(0);
    }
  });

  it('returns message string for too_short', () => {
    const result = validateHandle('abc');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain('6-24');
    }
  });

  it('returns message string for too_long', () => {
    const result = validateHandle('a'.repeat(25));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain('6-24');
    }
  });

  it('returns message string for invalid_characters', () => {
    const result = validateHandle('bad handle!');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain('no spaces or real names');
    }
  });
});
