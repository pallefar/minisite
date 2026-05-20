/**
 * Unit tests for `_ls_anon` cookie helpers.
 *
 * Pattern: `document.cookie` in jsdom is a writable string property that
 * appends-on-set and returns the current set on get — the same semantics
 * as a real browser. We reset cookies between tests by expiring everything
 * we touched.
 *
 * Behaviors covered (from 34-02-PLAN.md):
 *   - writeAnonCookie + readAnonCookie round-trip
 *   - clearAnonCookie nulls subsequent reads
 *   - readAnonCookie returns null when no cookie is set
 *   - Attributes: Path=/, Max-Age=2592000, SameSite=Lax (Secure depends on
 *     location.protocol; jsdom default is http: so Secure is absent here)
 */

import { afterEach, describe, expect, it } from 'vitest';

import {
  ANON_COOKIE_NAME,
  clearAnonCookie,
  readAnonCookie,
  writeAnonCookie,
} from './cookie';

function resetCookies(): void {
  // Expire ALL cookies currently set on document for a clean slate.
  for (const pair of document.cookie.split(';')) {
    const name = pair.split('=')[0]?.trim();
    if (!name) continue;
    document.cookie = `${name}=; Path=/; Max-Age=0`;
  }
}

describe('anonymous cookie helpers', () => {
  afterEach(() => {
    resetCookies();
  });

  it('exports ANON_COOKIE_NAME as `_ls_anon`', () => {
    expect(ANON_COOKIE_NAME).toBe('_ls_anon');
  });

  it('readAnonCookie returns null when no cookie is set', () => {
    resetCookies();
    expect(readAnonCookie()).toBeNull();
  });

  it('writeAnonCookie + readAnonCookie round-trip a UUID value', () => {
    const uuid = '11111111-1111-4111-8111-111111111111';
    writeAnonCookie(uuid);
    expect(readAnonCookie()).toBe(uuid);
  });

  it('writeAnonCookie sets Path=/, Max-Age=2592000, SameSite=Lax in the cookie string', () => {
    // jsdom retains the most recent `Set-Cookie`-style write in document.cookie's
    // raw setter buffer — capture by intercepting the descriptor.
    const writes: string[] = [];
    const originalDesc = Object.getOwnPropertyDescriptor(Document.prototype, 'cookie');
    Object.defineProperty(document, 'cookie', {
      configurable: true,
      get() {
        return originalDesc?.get?.call(document) ?? '';
      },
      set(v: string) {
        writes.push(v);
        originalDesc?.set?.call(document, v);
      },
    });
    try {
      writeAnonCookie('abc-123');
    } finally {
      // Restore the original descriptor.
      if (originalDesc) {
        Object.defineProperty(document, 'cookie', originalDesc);
      }
    }
    expect(writes.length).toBe(1);
    const written = writes[0]!;
    expect(written).toContain('_ls_anon=abc-123');
    expect(written).toContain('Path=/');
    expect(written).toContain('Max-Age=2592000');
    expect(written).toContain('SameSite=Lax');
    // jsdom location.protocol defaults to http: → no Secure flag.
    expect(written).not.toContain('Secure');
  });

  it('clearAnonCookie nulls subsequent reads', () => {
    writeAnonCookie('22222222-2222-4222-8222-222222222222');
    expect(readAnonCookie()).not.toBeNull();
    clearAnonCookie();
    expect(readAnonCookie()).toBeNull();
  });

  it('readAnonCookie URI-decodes the value', () => {
    // Manually write a percent-encoded cookie value to exercise the decode path.
    document.cookie = `${ANON_COOKIE_NAME}=foo%20bar; Path=/`;
    expect(readAnonCookie()).toBe('foo bar');
  });

  it('readAnonCookie returns null on malformed percent-encoding instead of throwing', () => {
    document.cookie = `${ANON_COOKIE_NAME}=%E0%A4%A; Path=/`;
    // %E0%A4%A is an incomplete percent-encoding triplet → decodeURIComponent throws.
    expect(() => readAnonCookie()).not.toThrow();
    expect(readAnonCookie()).toBeNull();
  });

  it('readAnonCookie ignores other cookies with similar prefixes', () => {
    document.cookie = `_ls_anon_other=zzz; Path=/`;
    document.cookie = `${ANON_COOKIE_NAME}=target; Path=/`;
    expect(readAnonCookie()).toBe('target');
  });
});
