/**
 * Phase 41 Plan 41-06 Task 2 — POLISH-10 status-page smoke test.
 *
 * Three assertion groups (Plan 41-PATTERNS lines 17-18 + RESEARCH Validation
 * Architecture):
 *
 *   Group 1 — DNS smoke (D-05): `dig +short CNAME status.leanshot.app`
 *     non-empty; gracefully skips when CNAME pending HUMAN-UAT.
 *
 *   Group 2 — HTTP smoke: `curl -sIL` returns HTTP/2 200; skips when Group 1
 *     skipped.
 *
 *   Group 3 — B6 Better Stack API: when `BETTERSTACK_API_KEY` is set, asserts
 *     >=1 status page configured, 7-component hybrid shape (D-01),
 *     >=3 integrations (D-02). When unset, skips per
 *     feedback_milestone_uat_deferral_consolidation.
 *
 * Per `reference_vitest_skip_fixme`: uses `it.skip` (NOT `it.fixme`) for
 * conditional skip — `.fixme` throws TypeError on vitest 4.x.
 */
import { execSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

const HOST = 'status.leanshot.app';
const BS_API = 'https://uptime.betterstack.com/api/v3/status-pages';

// Group 1: DNS smoke — capture CNAME presence eagerly so Group 2 can branch.
function digCnameSync(host: string): string {
  try {
    const out = execSync(`dig +short CNAME ${host}`, { stdio: ['ignore', 'pipe', 'ignore'] });
    return out.toString().trim();
  } catch {
    return '';
  }
}

const cname = digCnameSync(HOST);
const cnameLive = cname.length > 0;
const apiKey = process.env.BETTERSTACK_API_KEY ?? '';

describe('POLISH-10 status page smoke', () => {
  // ── Group 1 — DNS smoke (D-05) ────────────────────────────────────────────
  if (!cnameLive) {
    it.skip('Group 1 (D-05): CNAME not yet configured — Better Stack DNS pending HUMAN-UAT', () => {
      // Intentionally skipped — Plan 41-06 Task 4 Signal 2 cname-live
    });
  } else {
    it('Group 1 (D-05): dig +short CNAME status.leanshot.app returns Better Stack endpoint', () => {
      expect(cname.length).toBeGreaterThan(0);
      // Better Stack endpoints land at *.betteruptime.com or *.betterstack.com.
      expect(cname).toMatch(/(?:betteruptime\.com|betterstack\.com)/i);
    });
  }

  // ── Group 2 — HTTP smoke ──────────────────────────────────────────────────
  if (!cnameLive) {
    it.skip('Group 2: HTTP smoke skipped — Group 1 (DNS) not live', () => {
      // Intentionally skipped — depends on Group 1
    });
  } else {
    it('Group 2: HTTPS GET status.leanshot.app returns 200', () => {
      const out = execSync(`curl -sIL https://${HOST} | head -1`, {
        stdio: ['ignore', 'pipe', 'ignore'],
      }).toString();
      expect(out).toMatch(/HTTP\/[12](?:\.\d)?\s+200/);
    });
  }

  // ── Group 3 — B6 Better Stack API (POLISH-10 success criterion 1) ────────
  if (!apiKey) {
    it.skip(
      'Group 3 (B6): BETTERSTACK_API_KEY unset — POLISH-10 success criterion 1 deferred to milestone close per feedback_milestone_uat_deferral_consolidation',
      () => {
        // Intentionally skipped — see v1.3-uat-deferred.md.
      },
    );
  } else {
    it('Group 3 (B6): Better Stack API surfaces status page + 7 components + 3 integrations', async () => {
      const headers = { Authorization: `Bearer ${apiKey}` };
      const pagesRes = await fetch(BS_API, { headers });
      expect(pagesRes.ok).toBe(true);
      const pagesJson = (await pagesRes.json()) as { data: Array<{ id: string }> };
      expect(Array.isArray(pagesJson.data)).toBe(true);
      expect(pagesJson.data.length).toBeGreaterThanOrEqual(1);

      const pageId = pagesJson.data[0].id;

      // (a)+(b): sections + 7-component hybrid shape (D-01).
      const sectionsRes = await fetch(`${BS_API}/${pageId}/sections`, { headers });
      expect(sectionsRes.ok).toBe(true);
      const sectionsJson = (await sectionsRes.json()) as {
        data: Array<{ id: string; attributes?: { name: string } }>;
      };
      expect(sectionsJson.data.length).toBeGreaterThanOrEqual(4);

      // Component count — fetch via resources endpoint, filter to components.
      const resourcesRes = await fetch(`${BS_API}/${pageId}/resources`, { headers });
      expect(resourcesRes.ok).toBe(true);
      const resourcesJson = (await resourcesRes.json()) as {
        data: Array<{ attributes?: { resource_type?: string } }>;
      };
      const components = resourcesJson.data.filter(
        (r) => r.attributes?.resource_type === 'component' || r.attributes?.resource_type === 'monitor',
      );
      expect(components.length).toBeGreaterThanOrEqual(7);

      // (c): integrations >= 3 (Sentry + Vercel + Supabase per D-02).
      const integrations = resourcesJson.data.filter(
        (r) =>
          r.attributes?.resource_type === 'integration' ||
          r.attributes?.resource_type === 'heartbeat',
      );
      expect(integrations.length).toBeGreaterThanOrEqual(3);
    });
  }
});
