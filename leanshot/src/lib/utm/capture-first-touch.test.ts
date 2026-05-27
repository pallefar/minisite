/**
 * Phase 39 Plan 39-04 — capture-first-touch tests (PAYWALL-07 / D-09).
 *
 * RESEARCH OQ-5 resolution: Phase 39 OWNS the lt_utm_source cookie key.
 * Phase 51 will adopt the same key when shipping its UTM map pipeline.
 *
 * Behaviour:
 *   - `?utm_source=lean` on first visit → `lt_utm_source=lean` cookie set.
 *   - Existing lt_utm_source cookie → no-op (first-touch immutability).
 *   - No utm_source query param → no cookie write.
 *   - URL-decoded value preserved.
 *   - SameSite=Lax, Secure, max-age=1 year, JS-readable (no HttpOnly via JS anyway).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { captureFirstTouchUtm } from './capture-first-touch';

const originalLocation = window.location;
let cookieJar: Record<string, string> = {};

function setLocationSearch(search: string): void {
  // jsdom allows reassigning window.location since v22.
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { ...originalLocation, search, protocol: 'https:', host: 'app.leanshot.app' },
  });
}

function setupDocumentCookieMock(): void {
  cookieJar = {};
  Object.defineProperty(document, 'cookie', {
    configurable: true,
    get(): string {
      return Object.entries(cookieJar)
        .map(([k, v]) => `${k}=${v}`)
        .join('; ');
    },
    set(raw: string): void {
      // crude single-pair parser sufficient for the assignment shape we emit.
      const [pair] = raw.split(';');
      if (!pair) return;
      const eq = pair.indexOf('=');
      if (eq < 0) return;
      const k = pair.slice(0, eq).trim();
      const v = pair.slice(eq + 1).trim();
      cookieJar[k] = v;
    },
  });
}

describe('captureFirstTouchUtm', () => {
  beforeEach(() => {
    setupDocumentCookieMock();
  });
  afterEach(() => {
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: originalLocation,
    });
    vi.restoreAllMocks();
  });

  it('writes lt_utm_source cookie when utm_source query param present and cookie absent', () => {
    setLocationSearch('?utm_source=lean');
    captureFirstTouchUtm();
    expect(cookieJar.lt_utm_source).toBe('lean');
  });

  it('does NOT overwrite an existing lt_utm_source cookie (first-touch immutability)', () => {
    cookieJar.lt_utm_source = 'original';
    setLocationSearch('?utm_source=transformation');
    captureFirstTouchUtm();
    expect(cookieJar.lt_utm_source).toBe('original');
  });

  it('does nothing when no utm_source query parameter is present', () => {
    setLocationSearch('?other=foo');
    captureFirstTouchUtm();
    expect(cookieJar.lt_utm_source).toBeUndefined();
  });

  it('URL-decodes utm_source value', () => {
    setLocationSearch('?utm_source=lean%20coach');
    captureFirstTouchUtm();
    expect(cookieJar.lt_utm_source).toBe('lean coach');
  });

  it('cookie write is idempotent — subsequent calls are no-ops once the cookie is set', () => {
    setLocationSearch('?utm_source=clinical');
    captureFirstTouchUtm();
    setLocationSearch('?utm_source=default'); // attempt to overwrite
    captureFirstTouchUtm();
    expect(cookieJar.lt_utm_source).toBe('clinical');
  });

  it('emits cookie with SameSite=Lax + Secure + 1y max-age attributes', () => {
    // Spy on document.cookie SET to inspect the raw value the helper writes.
    const raws: string[] = [];
    Object.defineProperty(document, 'cookie', {
      configurable: true,
      get: () => '',
      set: (raw: string) => {
        raws.push(raw);
      },
    });
    setLocationSearch('?utm_source=lean');
    captureFirstTouchUtm();
    expect(raws).toHaveLength(1);
    const raw = raws[0]!;
    expect(raw).toContain('lt_utm_source=lean');
    expect(raw).toContain('SameSite=Lax');
    expect(raw).toContain('Secure');
    expect(raw).toContain('max-age=31536000');
  });
});
