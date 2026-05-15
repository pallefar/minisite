/**
 * @phase15 Plan 15-08 — page-render SEO + sitemap + robots.txt served-HTML
 * contract.
 *
 * This spec asserts the OBSERVABLE contracts of the published-page surface:
 *   (a) a published page's HTML contains the SEO cascade emitted by the
 *       `page-render` Edge Function (og:title, <link rel=canonical>,
 *       <script type=application/ld+json>).
 *   (b) /sitemap.xml returns valid XML wrapped in <urlset>.
 *   (c) /sitemap.xml does NOT list a known draft slug.
 *   (d) /robots.txt contains a Sitemap: directive.
 *
 * Strategy: these assertions need a LIVE deployed marketing host (the Edge
 * Functions only run against Supabase, and `/{slug}` only resolves via
 * vercel.json rewrites). We therefore env-gate the suite via the same
 * `describeIfLive` pattern used by `tests/rls/subscriptions-impersonation`
 * — skip cleanly when `PHASE15_PUBLISHED_PAGE_URL` is absent (local + PR
 * forks). Phase 15 close UAT wires the env var.
 *
 * `PHASE15_PUBLISHED_PAGE_URL` — full URL of a known-published landing page
 *   (e.g. https://leanshot.app/launch). The spec parses the origin from this
 *   URL and uses it for sitemap.xml / robots.txt lookups.
 *
 * `PHASE15_DRAFT_SLUG` — (optional) slug of a known-draft page to negatively
 *   assert against /sitemap.xml. When absent, the draft-exclusion assertion
 *   is skipped (the published-only invariant is also proven by the Deno
 *   tests in `supabase/functions/sitemap/index.test.ts`).
 */
import { expect, test } from '@playwright/test';

const PUBLISHED_PAGE_URL = process.env.PHASE15_PUBLISHED_PAGE_URL;
const DRAFT_SLUG = process.env.PHASE15_DRAFT_SLUG;
const HAS_LIVE_TARGET = Boolean(PUBLISHED_PAGE_URL);

test.describe('@phase15 page-render SEO + sitemap + robots.txt', () => {
  test.skip(!HAS_LIVE_TARGET, 'PHASE15_PUBLISHED_PAGE_URL not set — live deploy needed');

  test('published page HTML contains og:title, canonical, JSON-LD', async ({ request }) => {
    const res = await request.get(PUBLISHED_PAGE_URL!);
    expect(res.status()).toBe(200);
    const ct = res.headers()['content-type'] ?? '';
    expect(ct).toContain('text/html');
    const html = await res.text();
    // Cascade emits each of these (15-08 acceptance criteria, PAGE-05).
    expect(html).toContain('property="og:title"');
    expect(html).toContain('<link rel="canonical"');
    expect(html).toContain('<script type="application/ld+json">');
  });

  test('/sitemap.xml is well-formed XML with <urlset>', async ({ request }) => {
    const origin = new URL(PUBLISHED_PAGE_URL!).origin;
    const res = await request.get(`${origin}/sitemap.xml`);
    expect(res.status()).toBe(200);
    const ct = res.headers()['content-type'] ?? '';
    expect(ct).toContain('xml');
    const body = await res.text();
    expect(body).toMatch(/^<\?xml /);
    expect(body).toContain('<urlset');
    expect(body).toContain('</urlset>');
  });

  test('/sitemap.xml does not list a known draft slug (T-15-08-03)', async ({ request }) => {
    test.skip(!DRAFT_SLUG, 'PHASE15_DRAFT_SLUG not set — live draft seed needed');
    const origin = new URL(PUBLISHED_PAGE_URL!).origin;
    const res = await request.get(`${origin}/sitemap.xml`);
    expect(res.status()).toBe(200);
    const body = await res.text();
    expect(body.includes(`/${DRAFT_SLUG!}`)).toBe(false);
  });

  test('/robots.txt contains a Sitemap: directive', async ({ request }) => {
    const origin = new URL(PUBLISHED_PAGE_URL!).origin;
    const res = await request.get(`${origin}/robots.txt`);
    expect(res.status()).toBe(200);
    const body = await res.text();
    expect(body).toMatch(/^Sitemap:/m);
  });
});
