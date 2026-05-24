/**
 * Phase 51 Plan 51-10 Task 1 — Vercel Edge Middleware `lt_anon_id` cookie tests.
 *
 * Verifies the TRAFFIC-02 cookie-mint behavior contract added to
 * `leanshot/middleware.ts` in Plan 51-02 (block "(C) TRAFFIC-02 lt_anon_id
 * cookie mint"). The cookie augmentation runs BEFORE Phase 41-03's CSP early
 * return so cookies land on every response — including static-asset edge
 * cases where the response carries no `content-security-policy` header.
 *
 * Behavior under test (PLAN 51-10 Task 1 <action>):
 *   1. No inbound cookie + `/pricing` path:
 *      → Set-Cookie carries `lt_anon_id=<uuid>; Path=/; HttpOnly; Secure;
 *        SameSite=Lax; Max-Age=7776000` (90d).
 *
 *   2. `/share/clinic-acme-clinic` path additionally sets
 *      `lt_clinic_slug_seen=acme-clinic; Path=/; HttpOnly; Secure;
 *      SameSite=Lax; Max-Age=300` (5 min — D-12 org_id resolution feed).
 *
 *   3. Inbound `lt_anon_id` cookie is REUSED (sliding-window refresh) — the
 *      same UUID is re-set with a fresh Max-Age. No new UUID minted.
 *
 *   4. No `Domain=` attribute on any Set-Cookie (project memory
 *      `reference_supabase_auth_traps`).
 *
 *   5. `/share/<slug>` (non-`clinic-`-prefixed) gets `lt_anon_id` only; no
 *      `lt_clinic_slug_seen` (no org_id resolution feed for non-clinic
 *      share paths).
 *
 * Strategy: mock `@vercel/edge` `next()` to return a minimal Response with
 * no body — middleware augments `Set-Cookie` regardless of response shape.
 * Mirrors the Phase 41-03 `csp-middleware.test.ts` pattern (same project)
 * with env defaults that route the unrelated CSP code path through its
 * fail-safe branch.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const UUID_V4_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Hoist the next() mock so vi.mock can find it.
const nextMock = vi.fn();

vi.mock('@vercel/edge', () => ({
  next: () => nextMock(),
}));

/**
 * Minimal Response — no CSP, no body. The middleware's cookie-mint block
 * runs BEFORE the CSP early-return so it triggers regardless.
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

/**
 * Parse the Set-Cookie value for a given cookie name out of a
 * Response.headers list. Returns the FIRST matching Set-Cookie line, or
 * null when absent. Uses `getSetCookie()` when available (Web Fetch
 * standard, undici ≥6) and falls back to walking `headers.append`-style
 * duplicates via raw iteration.
 */
function getSetCookieLine(response: Response, cookieName: string): string | null {
  // `getSetCookie()` returns all Set-Cookie header values as an array.
  // Available on undici ≥6 / Node 22 (vitest environment).
  const hdrs = response.headers as unknown as {
    getSetCookie?: () => string[];
  };
  const lines = typeof hdrs.getSetCookie === 'function'
    ? hdrs.getSetCookie()
    : (response.headers.get('set-cookie') ?? '').split(/,(?=\s*[A-Za-z0-9_-]+=)/);
  for (const line of lines) {
    if (line.trim().startsWith(`${cookieName}=`)) return line;
  }
  return null;
}

function extractCookieValue(setCookieLine: string, cookieName: string): string {
  const m = setCookieLine.match(new RegExp(`^${cookieName}=([^;]+)`));
  if (!m) throw new Error(`could not extract ${cookieName} value from: ${setCookieLine}`);
  return decodeURIComponent(m[1]);
}

describe('Vercel Edge Middleware — lt_anon_id cookie mint (Phase 51 Plan 51-02 / verified Plan 51-10 Task 1)', () => {
  beforeEach(() => {
    nextMock.mockReset();
    nextMock.mockImplementation(() => makeBareResponse());
    // Default env: CSP-augmentation block is irrelevant to these tests —
    // we leave SUPABASE_* and SENTRY_CSP_REPORT_URI unset so the CSP
    // branch takes its no-op fail-safe path. Cookie-mint is independent.
    vi.stubEnv('SUPABASE_URL', '');
    vi.stubEnv('SUPABASE_ANON_KEY', '');
    vi.stubEnv('VITE_SENTRY_CSP_REPORT_URI', '');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('Test 1 — no inbound cookie, plain `/pricing` → mints lt_anon_id with HttpOnly+Secure+SameSite=Lax+Max-Age=7776000+Path=/', async () => {
    const mod = await importFreshMiddleware();
    const req = new Request('https://app.leanshot.app/pricing');
    const res: Response = await mod.default(req);

    const line = getSetCookieLine(res, 'lt_anon_id');
    expect(line).not.toBeNull();
    expect(line!).toContain('HttpOnly');
    expect(line!).toContain('Secure');
    expect(line!).toContain('SameSite=Lax');
    expect(line!).toMatch(/Max-Age=7776000\b/);
    expect(line!).toContain('Path=/');
    // No Domain= attribute (project memory `reference_supabase_auth_traps`).
    expect(line!).not.toMatch(/Domain=/i);

    // Value is a UUIDv4 (Edge runtime crypto.randomUUID()).
    const value = extractCookieValue(line!, 'lt_anon_id');
    expect(value).toMatch(UUID_V4_RE);
  });

  it('Test 2 — `/share/clinic-acme-clinic` ALSO sets lt_clinic_slug_seen=acme-clinic; Max-Age=300', async () => {
    const mod = await importFreshMiddleware();
    const req = new Request('https://app.leanshot.app/share/clinic-acme-clinic');
    const res: Response = await mod.default(req);

    const anonLine = getSetCookieLine(res, 'lt_anon_id');
    expect(anonLine).not.toBeNull();
    expect(anonLine!).toMatch(/Max-Age=7776000\b/);

    const slugLine = getSetCookieLine(res, 'lt_clinic_slug_seen');
    expect(slugLine).not.toBeNull();
    expect(slugLine!).toContain('lt_clinic_slug_seen=acme-clinic');
    expect(slugLine!).toContain('HttpOnly');
    expect(slugLine!).toContain('Secure');
    expect(slugLine!).toContain('SameSite=Lax');
    expect(slugLine!).toMatch(/Max-Age=300\b/);
    expect(slugLine!).toContain('Path=/');
    expect(slugLine!).not.toMatch(/Domain=/i);
  });

  it('Test 3 — inbound lt_anon_id is REUSED (sliding-window refresh; same UUID, fresh Max-Age)', async () => {
    const mod = await importFreshMiddleware();
    const existingUuid = '11111111-2222-4333-8444-555555555555';
    const req = new Request('https://app.leanshot.app/pricing', {
      headers: { cookie: `lt_anon_id=${existingUuid}` },
    });
    const res: Response = await mod.default(req);

    const line = getSetCookieLine(res, 'lt_anon_id');
    expect(line).not.toBeNull();
    const value = extractCookieValue(line!, 'lt_anon_id');
    // Reuse — NOT a new UUID.
    expect(value).toBe(existingUuid);
    // Still refreshes Max-Age (sliding window).
    expect(line!).toMatch(/Max-Age=7776000\b/);
  });

  it('Test 4 — `/share/non-clinic-slug` (no clinic- prefix) gets lt_anon_id but NOT lt_clinic_slug_seen', async () => {
    const mod = await importFreshMiddleware();
    const req = new Request('https://app.leanshot.app/share/garlic-tofu-melt');
    const res: Response = await mod.default(req);

    const anonLine = getSetCookieLine(res, 'lt_anon_id');
    expect(anonLine).not.toBeNull();

    const slugLine = getSetCookieLine(res, 'lt_clinic_slug_seen');
    // No org_id resolution feed for non-clinic share paths.
    expect(slugLine).toBeNull();
  });

  it('Test 5 — no Domain= attribute on any cookie (project memory reference_supabase_auth_traps)', async () => {
    const mod = await importFreshMiddleware();
    const req = new Request('https://app.leanshot.app/share/clinic-acme-clinic');
    const res: Response = await mod.default(req);

    const hdrs = res.headers as unknown as { getSetCookie?: () => string[] };
    const lines = typeof hdrs.getSetCookie === 'function'
      ? hdrs.getSetCookie()
      : (res.headers.get('set-cookie') ?? '').split(/,(?=\s*[A-Za-z0-9_-]+=)/);
    for (const line of lines) {
      expect(line).not.toMatch(/Domain=/i);
    }
  });
});
