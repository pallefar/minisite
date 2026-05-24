/**
 * Phase 41 Plan 41-03 — Vercel Edge Middleware CSP augmentation tests.
 *
 * Verifies the 7 behavior contracts from 41-03-PLAN.md Task 2 <behavior>:
 *   1. Allowlist hostnames are APPENDED to frame-src (existing entries preserved).
 *   2. Fetch failure → unaugmented response (fail-safe, NOT fail-closed).
 *   3. 60s in-memory cache (second call within 60s → no re-fetch).
 *   4. Only frame-src (+ report-uri/report-to) directives mutate; other
 *      directives are byte-identical.
 *   5. Empty allowlist → no orphan whitespace, no malformed directive.
 *   6. report-uri + Report-To header assembled from VITE_SENTRY_CSP_REPORT_URI
 *      env when set; both absent when env unset.
 *   7. Missing SUPABASE_URL / SUPABASE_ANON_KEY → console.warn + skip fetch;
 *      report-uri augmentation still runs (independent env-var gate).
 *
 * Strategy: mock `@vercel/edge` `next()` to return a response with the static
 * vercel.json CSP value; mock global fetch for the Supabase REST call; mock
 * Date.now() for cache TTL; manage process.env via vi.stubEnv per-test.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const STATIC_CSP =
  "default-src 'none'; " +
  "script-src 'self' https://js.stripe.com https://assets.calendly.com https://www.youtube-nocookie.com https://s.ytimg.com https://tally.so; " +
  "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://*.ingest.us.sentry.io https://*.ingest.sentry.io https://*.posthog.com https://api.anthropic.com https://api.stripe.com https://m.stripe.network https://api.calendly.com; " +
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
  "img-src 'self' data: blob: https://i.ytimg.com; " +
  "font-src 'self' data: https://fonts.gstatic.com; " +
  "frame-src 'self' https://js.stripe.com https://hooks.stripe.com https://calendly.com https://*.calendly.com https://www.youtube-nocookie.com https://youtube-nocookie.com https://tally.so https://*.tally.so; " +
  "object-src 'none'; base-uri 'self'; form-action 'self'; worker-src 'self' blob:";

// Hoist the next() mock so vi.mock can find it.
const nextMock = vi.fn();

vi.mock('@vercel/edge', () => ({
  next: () => nextMock(),
}));

function makeStaticResponse(): Response {
  return new Response('<!doctype html><html></html>', {
    status: 200,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'content-security-policy': STATIC_CSP,
    },
  });
}

async function importFreshMiddleware() {
  // Import fresh so module-level cache state is reset per test.
  vi.resetModules();
  // Set defaults; individual tests override via vi.stubEnv before import.
  return await import('../../middleware.ts');
}

describe('Vercel Edge Middleware — CSP augmentation (Phase 41 Plan 41-03)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-24T00:00:00Z'));
    nextMock.mockReset();
    nextMock.mockImplementation(() => makeStaticResponse());
    // Default env: both present so allowlist fetch runs.
    vi.stubEnv('SUPABASE_URL', 'https://test.supabase.co');
    vi.stubEnv('SUPABASE_ANON_KEY', 'anon-test-key');
    vi.stubEnv('VITE_SENTRY_CSP_REPORT_URI', '');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('Test 1 — appends allowlisted hostnames to frame-src; existing entries preserved', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify([{ hostname: 'meet.example.com' }, { hostname: 'forms.acme.org' }]),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );

    const mod = await importFreshMiddleware();
    const req = new Request('https://app.leanshot.app/about');
    const res: Response = await mod.default(req);

    const csp = res.headers.get('content-security-policy') ?? '';
    expect(csp).toContain('https://meet.example.com');
    expect(csp).toContain('https://forms.acme.org');
    // Existing entries preserved
    expect(csp).toContain("frame-src 'self' https://js.stripe.com");
    expect(csp).toContain('https://*.calendly.com');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('Test 2 — fetch failure returns UNAUGMENTED CSP (fail-safe)', async () => {
    vi.spyOn(global, 'fetch').mockRejectedValue(new Error('network down'));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const mod = await importFreshMiddleware();
    const req = new Request('https://app.leanshot.app/about');
    const res: Response = await mod.default(req);

    const csp = res.headers.get('content-security-policy') ?? '';
    // Unaugmented = static CSP unchanged (no extra hosts in frame-src)
    expect(csp).toBe(STATIC_CSP);
    expect(warnSpy).toHaveBeenCalled();
  });

  it('Test 3 — cache hit within 60s does not re-fetch; expiry triggers re-fetch', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify([{ hostname: 'cache-test.example.com' }]), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );

    const mod = await importFreshMiddleware();
    const req1 = new Request('https://app.leanshot.app/page1');
    nextMock.mockImplementation(() => makeStaticResponse());
    await mod.default(req1);
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    // Advance 30s — still within TTL
    vi.advanceTimersByTime(30_000);
    nextMock.mockImplementation(() => makeStaticResponse());
    await mod.default(new Request('https://app.leanshot.app/page2'));
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    // Advance another 31s (total 61s) — cache expired
    vi.advanceTimersByTime(31_000);
    nextMock.mockImplementation(() => makeStaticResponse());
    await mod.default(new Request('https://app.leanshot.app/page3'));
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('Test 4 — only frame-src (+ optional report-uri/report-to) directives change; other directives byte-identical', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify([{ hostname: 'precision.example.com' }]), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );

    const mod = await importFreshMiddleware();
    const res: Response = await mod.default(new Request('https://app.leanshot.app/'));
    const augmented = res.headers.get('content-security-policy') ?? '';

    const splitDirectives = (s: string) =>
      s
        .split(';')
        .map((d) => d.trim())
        .filter(Boolean)
        .reduce<Record<string, string>>((acc, d) => {
          const [name, ...rest] = d.split(/\s+/);
          acc[name!] = rest.join(' ');
          return acc;
        }, {});

    const staticParts = splitDirectives(STATIC_CSP);
    const augParts = splitDirectives(augmented);

    for (const name of Object.keys(staticParts)) {
      if (name === 'frame-src') continue;
      expect(augParts[name]).toBe(staticParts[name]);
    }
    // frame-src DID change
    expect(augParts['frame-src']).not.toBe(staticParts['frame-src']);
    expect(augParts['frame-src']).toContain('https://precision.example.com');
  });

  it('Test 5 — empty allowlist leaves frame-src directive clean (no orphan whitespace / semicolons)', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify([]), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );

    const mod = await importFreshMiddleware();
    const res: Response = await mod.default(new Request('https://app.leanshot.app/'));
    const csp = res.headers.get('content-security-policy') ?? '';

    // frame-src directive should be the original (or trivially equivalent — no double-space, no trailing whitespace before `;`)
    expect(csp).not.toMatch(/frame-src\s+;/);
    expect(csp).not.toMatch(/frame-src\s+\s+/); // no double spaces
    // No `; ;` orphan
    expect(csp).not.toMatch(/;\s*;/);
  });

  it('Test 6 — VITE_SENTRY_CSP_REPORT_URI env appends report-uri + Report-To header; absent env = both absent', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify([]), { status: 200, headers: { 'content-type': 'application/json' } }),
    );

    const SENTRY_URI = 'https://o123.ingest.sentry.io/api/456/security/?sentry_key=abc';
    vi.stubEnv('VITE_SENTRY_CSP_REPORT_URI', SENTRY_URI);

    const mod = await importFreshMiddleware();
    const res: Response = await mod.default(new Request('https://app.leanshot.app/'));
    const csp = res.headers.get('content-security-policy') ?? '';
    const reportTo = res.headers.get('Report-To') ?? '';

    expect(csp).toContain('report-uri ' + SENTRY_URI);
    expect(csp).toContain('report-to csp-endpoint');
    expect(reportTo).toBe(
      JSON.stringify({ group: 'csp-endpoint', max_age: 10886400, endpoints: [{ url: SENTRY_URI }] }),
    );

    // Now flip env unset and re-import (fresh module to reset cache)
    vi.stubEnv('VITE_SENTRY_CSP_REPORT_URI', '');
    const mod2 = await importFreshMiddleware();
    nextMock.mockImplementation(() => makeStaticResponse());
    const res2: Response = await mod2.default(new Request('https://app.leanshot.app/'));
    const csp2 = res2.headers.get('content-security-policy') ?? '';
    expect(csp2).not.toContain('report-uri');
    expect(csp2).not.toContain('report-to');
    expect(res2.headers.get('Report-To')).toBeNull();
  });

  it('Test 7 — missing SUPABASE_URL/ANON_KEY logs warning + skips allowlist fetch; report-uri augmentation still runs', async () => {
    vi.stubEnv('SUPABASE_URL', '');
    vi.stubEnv('SUPABASE_ANON_KEY', '');
    vi.stubEnv('VITE_SENTRY_CSP_REPORT_URI', 'https://sentry.example/csp');

    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(new Response('[]', { status: 200 }));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const mod = await importFreshMiddleware();
    const res: Response = await mod.default(new Request('https://app.leanshot.app/'));

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(
      'CSP middleware: env vars missing, returning unaugmented CSP',
    );
    const csp = res.headers.get('content-security-policy') ?? '';
    // Allowlist NOT augmented; but report-uri still applied
    expect(csp).toContain('report-uri https://sentry.example/csp');
    expect(csp).toContain('report-to csp-endpoint');
  });
});
