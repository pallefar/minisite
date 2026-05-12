/**
 * COMPL-03 runbook content-grep test (Phase 7 plan 07-05 Task 3).
 *
 * Purpose: lock in the structural shape of `.planning/runbooks/hbnr-incident-response.md`
 * so a silent edit, section rename, or accidental PII leak fails CI.
 *
 * Threat T-07-05-01 (tampering): renaming `## Breach decision tree` to
 *   `## Breach decision matrix` (or splitting it across two `##` headings)
 *   silently degrades the runbook's operational shape — this test catches it.
 * Threat T-07-05-03 (information disclosure): asserts the founder's known
 *   personal email is NOT present in the runbook. Belt-and-suspenders against
 *   accidentally pasting real PII into a public-by-design git repo.
 *
 * Pattern mirrors `src/lib/supabase.test.ts` (cross-cutting infra tests live
 * under `src/lib/`, not in a separate `src/test/` directory).
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// Vitest's cwd is the project root (leanshot/) by default.
// `npm run test:unit` => `vitest run` with no `--root` override.
const RUNBOOK_PATH = resolve(process.cwd(), '.planning/runbooks/hbnr-incident-response.md');

const REQUIRED_SECTIONS = [
  '## Definitions',
  '## 60-day notification clock',
  '## Breach decision tree',
  '## On-call escalation',
  '## Post-incident review',
] as const;

const SENTINEL = '## 60-day notification clock';
const FEDREG_URL = 'federalregister.gov/documents/2024/05/30/2024-10855';

// PII canary — the founder's email must NEVER appear in the public runbook.
// Source: MEMORY.md / user instructions. If this value ever needs to change,
// edit it here AND scrub the runbook simultaneously.
const FOUNDER_EMAIL_CANARY = 'karsten.haldan@gmail.com';

// Escape a literal string for inclusion in a RegExp.
function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

describe('COMPL-03 runbook (.planning/runbooks/hbnr-incident-response.md)', () => {
  it('exists on disk', () => {
    expect(existsSync(RUNBOOK_PATH), `Runbook missing at ${RUNBOOK_PATH}`).toBe(true);
  });

  it('is at least 120 lines (substantive content, not a stub)', () => {
    const lines = readFileSync(RUNBOOK_PATH, 'utf8').split('\n').length;
    expect(lines).toBeGreaterThanOrEqual(120);
  });

  it.each(REQUIRED_SECTIONS)('contains required section heading: %s', (heading) => {
    const body = readFileSync(RUNBOOK_PATH, 'utf8');
    const re = new RegExp(`^${escapeRe(heading)}$`, 'm');
    expect(re.test(body)).toBe(true);
  });

  it('contains the sentinel anchor exactly once (no duplicate headings)', () => {
    const body = readFileSync(RUNBOOK_PATH, 'utf8');
    const matches = body.match(new RegExp(`^${escapeRe(SENTINEL)}$`, 'gm'));
    expect(matches?.length ?? 0).toBe(1);
  });

  it('cites the Federal Register primary source URL', () => {
    const body = readFileSync(RUNBOOK_PATH, 'utf8');
    expect(body).toContain(FEDREG_URL);
  });

  it('contains no founder PII (email canary)', () => {
    const body = readFileSync(RUNBOOK_PATH, 'utf8');
    expect(body).not.toContain(FOUNDER_EMAIL_CANARY);
  });
});
