/**
 * Phase 68 Plan 68-04 Task 2 — UTM-default-landing 307 resolver tests (LAND-08).
 *
 * Verifies the new `(E)` block in `leanshot/middleware.ts`:
 *   - `/?utm_source=clinic_outreach`        → 307 to `/for-clinics?utm_source=clinic_outreach`
 *   - `/?utm_source=coach_referral`         → 307 to `/for-coaches?utm_source=...`
 *   - `/?utm_source=doctor_referral`        → 307 to `/for-doctors?utm_source=...`
 *   - `/?utm_source=unknown`                → pass-through (no 307; falls into rate-limit / cookie / CSP)
 *   - `/for-clinics?utm_source=clinic_outreach` (non-root) → pass-through
 *   - `/?utm_source=clinic_outreach&utm_medium=email&foo=bar` → 307; ALL params preserved
 *   - `/` with no `utm_source` query param  → pass-through
 *
 * Architectural decision recorded in middleware.ts: the resolver lives in
 * Vercel Edge Middleware (not the `traffic-attribution-recorder` Edge Fn the
 * plan first proposed) because the recorder fires from the SPA AFTER React
 * mounts, which is too late to prevent the wrong audience landing from
 * painting. Middleware is the only true server-side request interceptor for
 * SPA root landings.
 *
 * Test seam: middleware.ts exports `setUtmLandingCacheForTest` so tests can
 * inject a synthetic mapping without hitting Supabase REST. Mirrors the
 * `setRecordTouchForTest` pattern in `traffic-attribution-recorder`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Hoist the next() mock so vi.mock can find it.
const nextMock = vi.fn();

vi.mock('@vercel/edge', () => ({
  next: () => nextMock(),
}));

/**
 * Minimal Response — no CSP, no body. The middleware's resolver block runs
 * BEFORE next(), so the mock implementation only matters for the
 * pass-through assertions (where we verify next() WAS called).
 */
function makeBareResponse(): Response {
  return new Response(null, {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8' },
  });
}

async function importFreshMiddleware() {
  vi.resetModules();
  return await import('../../middleware.ts');
}

describe('Vercel Edge Middleware — UTM-default-landing resolver (Phase 68 Plan 68-04 LAND-08)', () => {
  beforeEach(() => {
    nextMock.mockReset();
    nextMock.mockImplementation(() => makeBareResponse());
    // Resolver requires env to be set so it doesn't fail-safe to no-op.
    vi.stubEnv('SUPABASE_URL', 'https://test.supabase.co');
    vi.stubEnv('SUPABASE_ANON_KEY', 'test-anon-key');
    // CSP/cookie branches are irrelevant to these tests.
    vi.stubEnv('VITE_SENTRY_CSP_REPORT_URI', '');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('Test 1 — `/?utm_source=clinic_outreach` → 307 to `/for-clinics?utm_source=clinic_outreach`', async () => {
    const mod = await importFreshMiddleware();
    mod.setUtmLandingCacheForTest({
      clinic_outreach: '/for-clinics',
      coach_referral: '/for-coaches',
      doctor_referral: '/for-doctors',
    });

    const req = new Request('https://app.leanshot.app/?utm_source=clinic_outreach');
    const res: Response = await mod.default(req);

    expect(res.status).toBe(307);
    const location = res.headers.get('location');
    expect(location).not.toBeNull();
    const dest = new URL(location!);
    expect(dest.pathname).toBe('/for-clinics');
    expect(dest.searchParams.get('utm_source')).toBe('clinic_outreach');
    expect(res.headers.get('cache-control')).toBe('no-store');
    // next() must NOT have been called — resolver short-circuits.
    expect(nextMock).not.toHaveBeenCalled();
  });

  it('Test 2 — `/?utm_source=unknown` → pass-through (no 307)', async () => {
    const mod = await importFreshMiddleware();
    mod.setUtmLandingCacheForTest({
      clinic_outreach: '/for-clinics',
    });

    const req = new Request('https://app.leanshot.app/?utm_source=unknown_source');
    const res: Response = await mod.default(req);

    // Falls through to next() — body is the bare response from makeBareResponse.
    expect(res.status).toBe(200);
    expect(res.headers.get('location')).toBeNull();
    expect(nextMock).toHaveBeenCalledTimes(1);
  });

  it('Test 3 — `/some-other-path?utm_source=clinic_outreach` → pass-through (resolver only fires on root)', async () => {
    const mod = await importFreshMiddleware();
    mod.setUtmLandingCacheForTest({
      clinic_outreach: '/for-clinics',
    });

    const req = new Request(
      'https://app.leanshot.app/for-clinics?utm_source=clinic_outreach',
    );
    const res: Response = await mod.default(req);

    // Resolver did NOT short-circuit (pathname != '/'); middleware fell
    // through to next(). The redirect cycle is single-hop — the user lands
    // on /for-clinics ONCE and never bounces.
    expect(res.status).toBe(200);
    expect(res.headers.get('location')).toBeNull();
    expect(nextMock).toHaveBeenCalledTimes(1);
  });

  it('Test 4 — `/` with no utm_source → pass-through (no redirect)', async () => {
    const mod = await importFreshMiddleware();
    mod.setUtmLandingCacheForTest({
      clinic_outreach: '/for-clinics',
    });

    const req = new Request('https://app.leanshot.app/');
    const res: Response = await mod.default(req);

    expect(res.status).toBe(200);
    expect(res.headers.get('location')).toBeNull();
    expect(nextMock).toHaveBeenCalledTimes(1);
  });

  it('Test 5 — preserves ALL query params on the redirect URL (utm_source + utm_medium + utm_campaign + arbitrary)', async () => {
    const mod = await importFreshMiddleware();
    mod.setUtmLandingCacheForTest({
      clinic_outreach: '/for-clinics',
    });

    const req = new Request(
      'https://app.leanshot.app/?utm_source=clinic_outreach&utm_medium=email&utm_campaign=q2-outreach&foo=bar',
    );
    const res: Response = await mod.default(req);

    expect(res.status).toBe(307);
    const dest = new URL(res.headers.get('location')!);
    expect(dest.pathname).toBe('/for-clinics');
    expect(dest.searchParams.get('utm_source')).toBe('clinic_outreach');
    expect(dest.searchParams.get('utm_medium')).toBe('email');
    expect(dest.searchParams.get('utm_campaign')).toBe('q2-outreach');
    expect(dest.searchParams.get('foo')).toBe('bar');
  });

  it('Test 6 — coach_referral → /for-coaches', async () => {
    const mod = await importFreshMiddleware();
    mod.setUtmLandingCacheForTest({
      clinic_outreach: '/for-clinics',
      coach_referral: '/for-coaches',
      doctor_referral: '/for-doctors',
    });

    const req = new Request('https://app.leanshot.app/?utm_source=coach_referral');
    const res: Response = await mod.default(req);

    expect(res.status).toBe(307);
    const dest = new URL(res.headers.get('location')!);
    expect(dest.pathname).toBe('/for-coaches');
  });

  it('Test 7 — doctor_referral → /for-doctors', async () => {
    const mod = await importFreshMiddleware();
    mod.setUtmLandingCacheForTest({
      clinic_outreach: '/for-clinics',
      coach_referral: '/for-coaches',
      doctor_referral: '/for-doctors',
    });

    const req = new Request('https://app.leanshot.app/?utm_source=doctor_referral');
    const res: Response = await mod.default(req);

    expect(res.status).toBe(307);
    const dest = new URL(res.headers.get('location')!);
    expect(dest.pathname).toBe('/for-doctors');
  });

  it('Test 8 — env unset → resolver no-ops (fail-safe pass-through)', async () => {
    vi.stubEnv('SUPABASE_URL', '');
    vi.stubEnv('SUPABASE_ANON_KEY', '');
    const mod = await importFreshMiddleware();
    // Cache is irrelevant — resolver bails before consulting it.
    mod.setUtmLandingCacheForTest({
      clinic_outreach: '/for-clinics',
    });

    const req = new Request('https://app.leanshot.app/?utm_source=clinic_outreach');
    const res: Response = await mod.default(req);

    // No redirect — request falls through to next().
    expect(res.status).toBe(200);
    expect(res.headers.get('location')).toBeNull();
    expect(nextMock).toHaveBeenCalledTimes(1);
  });
});
