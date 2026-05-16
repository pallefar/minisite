/**
 * Phase 22 plan 22-10 — GDPR-02 consent-records audit writer.
 *
 * Behaviors covered (7):
 *   1. INSERT payload includes cookie_categories jsonb (categories + services + revision).
 *   2. INSERT payload includes user_agent (capped 500 chars), country_code, consent_revision.
 *   3. Authenticated user → user_id = auth.uid(), anonymous_id = null.
 *   4. Anonymous user → user_id = null, anonymous_id = cookie.consentId.
 *   5. Each call writes a NEW row (append-only per GDPR Art. 7(1)) — table has no
 *      unique constraint; INSERT, not UPSERT.
 *   6. Supabase write failure → console.warn + DOES NOT throw.
 *   7. Network/throw failure → console.warn + DOES NOT propagate.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const insertSpy = vi.fn();
const getUserSpy = vi.fn();

vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: { getUser: () => getUserSpy() },
    from: (_table: string) => ({
      insert: (payload: unknown) => insertSpy(payload),
    }),
  },
}));

import { upsertConsentRecord, type CookieConsentSnapshot } from '@/lib/consent/consent-records';

const FAKE_AUTHENTICATED = { data: { user: { id: 'user-uuid-123' } } };
const FAKE_ANONYMOUS = { data: { user: null } };

function snapshot(overrides: Partial<CookieConsentSnapshot> = {}): CookieConsentSnapshot {
  return {
    consentId: 'anon-uuid-abc',
    categories: ['necessary', 'analytics'],
    services: { analytics: ['posthog'] },
    revision: 1,
    consentTimestamp: '2026-05-16T00:00:00Z',
    lastConsentTimestamp: '2026-05-16T00:00:00Z',
    languageCode: 'en',
    ...overrides,
  };
}

describe('consent-records (Phase 22 GDPR-02)', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    insertSpy.mockReset();
    insertSpy.mockResolvedValue({ error: null });
    getUserSpy.mockReset();
    getUserSpy.mockResolvedValue(FAKE_ANONYMOUS);
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    (window as Window & { __VERCEL_GEO__?: { country?: string } }).__VERCEL_GEO__ = {
      country: 'US',
    };
  });

  afterEach(() => {
    warnSpy.mockRestore();
    delete (window as Window & { __VERCEL_GEO__?: unknown }).__VERCEL_GEO__;
  });

  it('INSERT payload includes cookie_categories jsonb (categories + services + revision)', async () => {
    await upsertConsentRecord(snapshot());
    expect(insertSpy).toHaveBeenCalledTimes(1);
    const payload = insertSpy.mock.calls[0]?.[0] as Record<string, unknown>;
    const cc = payload.cookie_categories as Record<string, unknown>;
    expect(cc.categories).toEqual(['necessary', 'analytics']);
    expect(cc.services).toEqual({ analytics: ['posthog'] });
    expect(cc.revision).toBe(1);
  });

  it('INSERT payload includes user_agent (≤500 chars), country_code, consent_revision', async () => {
    await upsertConsentRecord(snapshot({ revision: 3 }));
    const payload = insertSpy.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(payload.consent_revision).toBe(3);
    expect(payload.country_code).toBe('US');
    expect(typeof payload.user_agent).toBe('string');
    expect((payload.user_agent as string).length).toBeLessThanOrEqual(500);
  });

  it('authenticated user → user_id = auth.uid(), anonymous_id = null', async () => {
    getUserSpy.mockResolvedValue(FAKE_AUTHENTICATED);
    await upsertConsentRecord(snapshot());
    const payload = insertSpy.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(payload.user_id).toBe('user-uuid-123');
    expect(payload.anonymous_id).toBeNull();
  });

  it('anonymous user → user_id = null, anonymous_id = cookie.consentId', async () => {
    getUserSpy.mockResolvedValue(FAKE_ANONYMOUS);
    await upsertConsentRecord(snapshot({ consentId: 'anon-789' }));
    const payload = insertSpy.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(payload.user_id).toBeNull();
    expect(payload.anonymous_id).toBe('anon-789');
  });

  it('each call writes a NEW row (append-only — INSERT not UPSERT)', async () => {
    await upsertConsentRecord(snapshot({ revision: 1 }));
    await upsertConsentRecord(snapshot({ revision: 2 }));
    await upsertConsentRecord(snapshot({ revision: 3 }));
    expect(insertSpy).toHaveBeenCalledTimes(3);
  });

  it('supabase write returns error → console.warn + does NOT throw', async () => {
    insertSpy.mockResolvedValue({ error: { message: 'RLS violation' } });
    await expect(upsertConsentRecord(snapshot())).resolves.toBeUndefined();
    expect(warnSpy).toHaveBeenCalled();
    const allMsgs = warnSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(allMsgs).toMatch(/consent_records insert failed/);
  });

  it('thrown exception in supabase chain → console.warn + does NOT propagate', async () => {
    getUserSpy.mockRejectedValue(new Error('network down'));
    await expect(upsertConsentRecord(snapshot())).resolves.toBeUndefined();
    expect(warnSpy).toHaveBeenCalled();
    const allMsgs = warnSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(allMsgs).toMatch(/consent_records insert threw/);
  });
});
