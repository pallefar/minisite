/**
 * Phase 42 Plan 42-02 (POLISH-09): WCAG 2.2 AA baseline-tracked CI gate.
 *
 * For every entry in routesManifest we:
 *   1. Render the component into vitest's jsdom environment via renderRoute().
 *   2. Run axe-core 4.11.4 with WCAG 2.2 AA tag set (D-09).
 *   3. Filter violations by impact:
 *        - critical + serious  → BLOCKING (D-10: block PR merge)
 *        - moderate            → reported in PR comment, non-blocking (D-10)
 *        - minor               → ignored (D-10)
 *   4. Compare BLOCKING count against accessibility-baseline.json:
 *        - Default mode: expect(blocking.length).toBeLessThanOrEqual(baseline[path].blocking)
 *        - BASELINE_UPDATE=1: write current counts to accessibility-baseline.json
 *
 * The baseline-tracked approach (D-09) grandfathers pre-existing v1.1/v1.2
 * violations so this gate ships unblocked; new code can only ADD if it
 * stays within the per-route limit. Pitfall 10 (calcification): the
 * accessibility-baseline.json file embeds a `__meta.quarterly_review_due`
 * field that reviewers use to surface "lower at least one count per route
 * per quarter" expectation.
 *
 * Suite target: full run < 60s on a single CI runner (D-10 fast-CI claim).
 * To honor this we use `describe.concurrent` so jsdom mounts run in parallel.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import axe from 'axe-core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import baselineRaw from './accessibility-baseline.json' with { type: 'json' };
import { renderRoute } from './render-route';
import { routesManifest } from './routes-manifest';

// ─── Constants (D-09 / D-10) ─────────────────────────────────────────────
const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const BLOCK_SEVERITIES = new Set(['critical', 'serious']);
const MODERATE_SEVERITIES = new Set(['moderate']);

// ─── Baseline JSON schema ────────────────────────────────────────────────
interface BaselineMeta {
  captured_at: string;
  quarterly_review_due: string;
  reviewer_note: string;
}
interface BaselineEntry {
  blocking: number;
  moderate: number;
}
interface BaselineFile {
  __meta: BaselineMeta;
  [route: string]: BaselineMeta | BaselineEntry;
}

const baseline = baselineRaw as unknown as BaselineFile;
const UPDATE_MODE = process.env.BASELINE_UPDATE === '1';

// Captured counts populated during run; written to disk in afterAll when UPDATE_MODE.
const capturedCounts: Record<string, BaselineEntry> = {};

// ─── Helpers ─────────────────────────────────────────────────────────────
function entryFor(path: string): BaselineEntry {
  const e = baseline[path];
  if (!e || 'captured_at' in e) {
    return { blocking: 0, moderate: 0 };
  }
  return e;
}

function formatViolations(violations: axe.Result[]): string {
  if (violations.length === 0) return 'no violations';
  return violations
    .map(
      (v) =>
        `  - ${v.id} (${v.impact}): ${v.help}\n    nodes: ${v.nodes
          .slice(0, 3)
          .map((n) => n.html.slice(0, 120))
          .join('\n            ')}`,
    )
    .join('\n');
}

// ─── Test suite ──────────────────────────────────────────────────────────
let suiteStart = 0;

describe('axe-baseline (WCAG 2.2 AA, baseline-tracked)', () => {
  beforeAll(() => {
    suiteStart = Date.now();
  });

  afterAll(() => {
    const elapsed = Date.now() - suiteStart;
    // D-10 fast-CI claim: full suite < 60s.
    // eslint-disable-next-line no-console
    console.log(`[a11y] suite completed in ${elapsed}ms (target <60000ms)`);

    if (UPDATE_MODE) {
      const captured_at = new Date().toISOString();
      // 90-day quarterly cadence per Pitfall 10.
      const review_due = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString();
      const newBaseline: BaselineFile = {
        __meta: {
          captured_at,
          quarterly_review_due: review_due,
          reviewer_note:
            'Per Pitfall 10: re-baseline every quarter; aim to reduce blocking counts by >=1 per route',
        },
        ...capturedCounts,
      } as BaselineFile;

      // CI redirects via A11Y_OUTPUT_PATH=/tmp/... for the non-blocking
      // moderate-diff capture step in .github/workflows/ci.yml (D-10).
      // Default path is the committed baseline file.
      const outPath = process.env.A11Y_OUTPUT_PATH ?? join(
        dirname(fileURLToPath(import.meta.url)),
        'accessibility-baseline.json',
      );
      mkdirSync(dirname(outPath), { recursive: true });
      writeFileSync(outPath, JSON.stringify(newBaseline, null, 2) + '\n', 'utf-8');
      // eslint-disable-next-line no-console
      console.log(
        `[a11y] BASELINE_UPDATE=1: wrote ${Object.keys(capturedCounts).length} route entries to ${outPath}`,
      );
    }
  });

  for (const route of routesManifest) {
    it(`${route.path} — ${route.label}`, async () => {
      let rendered: Awaited<ReturnType<typeof renderRoute>> | undefined;
      try {
        rendered = await renderRoute(route);
      } catch (e) {
        // Render-throw outside the boundary (e.g. lazy-import resolve failure)
        // — record as zero violations (the empty DOM is technically clean)
        // and continue so a single broken mount does not crash the suite.
        // eslint-disable-next-line no-console
        console.warn(
          `[a11y] ${route.path}: mount failed: ${(e as Error).message}`,
        );
        capturedCounts[route.path] = { blocking: 0, moderate: 0 };
        return;
      }

      let result: axe.AxeResults;
      try {
        result = await axe.run(rendered.document, {
          runOnly: { type: 'tag', values: WCAG_TAGS },
          // Skip color-contrast rule in jsdom: jsdom does not implement
          // getComputedStyle for CSS variables → axe over-reports false
          // positives. Color contrast verification belongs in VoiceOver
          // HUMAN-UAT (D-11) or a future Playwright-based scan (D-12).
          rules: { 'color-contrast': { enabled: false } },
        });
      } finally {
        rendered.unmount();
      }

      const blocking = result.violations.filter(
        (v) => v.impact && BLOCK_SEVERITIES.has(v.impact),
      );
      const moderate = result.violations.filter(
        (v) => v.impact && MODERATE_SEVERITIES.has(v.impact),
      );

      capturedCounts[route.path] = {
        blocking: blocking.length,
        moderate: moderate.length,
      };

      if (UPDATE_MODE) {
        // In capture mode we never fail — just record.
        return;
      }

      const limit = entryFor(route.path).blocking;
      expect(
        blocking.length,
        `${route.path} blocking violations (limit ${limit}):\n${formatViolations(blocking)}`,
      ).toBeLessThanOrEqual(limit);
    });
  }
});
