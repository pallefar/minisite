// Phase 12 D-10/D-11/D-12 — CSP snapshot test.
// Reads vercel.json, extracts the Content-Security-Policy header value,
// normalizes directive ordering, and diffs against tests/csp/csp-snapshot.txt.
//
// This prevents the Phase 8 reactive-break pattern: CSP was never updated when
// Phase 4 added Supabase origins — the app was silently broken on production
// for 4+ phases until the Phase 8 hot-fix (commit 8f57319).
//
// PLAN-CHECKER CONTRACT (D-12):
// When any Phase 14/16/19/20/22 plan adds an external origin, update
// vercel.json AND tests/csp/csp-snapshot.txt in the SAME commit;
// plan-checker enforces this. Absence of either file in the CSP-widening
// commit is a plan-checker BLOCKER.
//
// To update the snapshot after an intentional CSP change:
//   1. Edit vercel.json (add the new origin to the appropriate directive)
//   2. Re-run this test — it will FAIL with a directive-level diff
//   3. Update tests/csp/csp-snapshot.txt with the new sorted directive value
//   4. Re-run — should pass
//   5. Commit BOTH files in the same commit
//
// Note on import.meta.dirname: Node v22.18.0 supports import.meta.dirname natively.
// For older Node (<21) the fallback would be:
//   import { fileURLToPath } from 'node:url';
//   const ROOT = fileURLToPath(new URL('../..', import.meta.url));

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(import.meta.dirname, '../..');

function parseCSP(rawValue: string): string[] {
  return rawValue
    .split(';')
    .map((d) => d.trim())
    .filter(Boolean)
    .map((d) => d + ';')
    .sort();
}

describe('CSP snapshot (Phase 12 D-10/D-11/D-12)', () => {
  it('vercel.json Content-Security-Policy matches tests/csp/csp-snapshot.txt', () => {
    const vercelJson = JSON.parse(readFileSync(join(ROOT, 'vercel.json'), 'utf-8'));

    // CSP header may live in any headers[] entry (vercel.json supports multiple source rules);
    // find the entry that defines Content-Security-Policy regardless of position.
    const allHeaderEntries: Array<{ source: string; headers: Array<{ key: string; value: string }> }> =
      vercelJson.headers ?? [];
    const flatHeaders = allHeaderEntries.flatMap((e) => e.headers ?? []);
    const cspHeader = flatHeaders.find((h) => h.key === 'Content-Security-Policy');

    if (!cspHeader) {
      throw new Error(
        'Content-Security-Policy header not found in vercel.json — ' +
          'check that vercel.json still has a headers[] entry for source "/(.*)"',
      );
    }

    const liveSorted = parseCSP(cspHeader.value);
    const snapshotRaw = readFileSync(join(ROOT, 'tests/csp/csp-snapshot.txt'), 'utf-8');
    const snapshotSorted = snapshotRaw
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .sort();

    expect(liveSorted).toEqual(snapshotSorted);
  });
});
