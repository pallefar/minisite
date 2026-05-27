/**
 * Phase 69 Plan 69-03 — DS-09 — Tests for scripts/ci/audit-copywriting.ts.
 *
 *   deno test --no-check --allow-read --allow-write --allow-env scripts/ci/audit-copywriting.test.ts
 */

import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { join } from 'https://deno.land/std@0.224.0/path/mod.ts';

import {
  buildReport,
  probeCtaVerb,
  probeErrorToast,
  runMain,
  scanFile,
  scanRoot,
} from './audit-copywriting.ts';

async function buildFixture(files: Record<string, string>): Promise<string> {
  const root = await Deno.makeTempDir({ prefix: 'audit-copywriting-' });
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(root, rel);
    await Deno.mkdir(join(abs, '..'), { recursive: true });
    await Deno.writeTextFile(abs, content);
  }
  return root;
}

// ─── probeCtaVerb ────────────────────────────────────────────────────────────

Deno.test('probeCtaVerb — flags <Button>OK</Button> (non-canonical, common offender)', () => {
  const hits = probeCtaVerb('<Button onClick={x}>OK</Button>');
  assertEquals(hits.length, 1);
  assert(hits[0].suggestion.includes('Confirm'));
});

Deno.test('probeCtaVerb — flags <button>Got it</button> with Done suggestion', () => {
  const hits = probeCtaVerb('<button>Got it</button>');
  assertEquals(hits.length, 1);
  assert(hits[0].suggestion.includes('Done'));
});

Deno.test('probeCtaVerb — does NOT flag <Button>Save</Button>', () => {
  assertEquals(probeCtaVerb('<Button variant="primary">Save</Button>').length, 0);
});

Deno.test('probeCtaVerb — does NOT flag <Button>Save changes</Button> (canonical first word)', () => {
  assertEquals(probeCtaVerb('<Button>Save changes</Button>').length, 0);
});

Deno.test('probeCtaVerb — does NOT flag <Button>Sign in</Button> (canonical multi-word)', () => {
  assertEquals(probeCtaVerb('<Button>Sign in</Button>').length, 0);
});

Deno.test('probeCtaVerb — skips very long content (descriptive, not CTA)', () => {
  assertEquals(
    probeCtaVerb('<Button>A very long descriptive label that is not a verb</Button>').length,
    0,
  );
});

Deno.test('probeCtaVerb — flags <Button>Yeah</Button>', () => {
  const hits = probeCtaVerb('<Button>Yeah</Button>');
  assertEquals(hits.length, 1);
  assert(hits[0].suggestion.includes('Yes'));
});

// ─── probeErrorToast ─────────────────────────────────────────────────────────

Deno.test('probeErrorToast — flags <Toast severity="error">Error</Toast>', () => {
  const hits = probeErrorToast('<Toast severity="error">Error</Toast>');
  assertEquals(hits.length, 1);
});

Deno.test('probeErrorToast — flags <Toast severity="error">Failed</Toast>', () => {
  const hits = probeErrorToast('<Toast severity="error">Failed</Toast>');
  assertEquals(hits.length, 1);
});

Deno.test('probeErrorToast — does NOT flag long-form toast with guidance (>=30 chars)', () => {
  const hits = probeErrorToast(
    '<Toast severity="error">Save failed. Check your connection and try again.</Toast>',
  );
  assertEquals(hits.length, 0);
});

Deno.test('probeErrorToast — does NOT flag non-error severity', () => {
  assertEquals(
    probeErrorToast('<Toast severity="info">Saved</Toast>').length,
    0,
  );
});

Deno.test('probeErrorToast — does NOT flag short multi-word toast ending in actionable punctuation', () => {
  const hits = probeErrorToast('<Toast severity="error">Try again later?</Toast>');
  assertEquals(hits.length, 0);
});

// ─── scanFile ────────────────────────────────────────────────────────────────

Deno.test('scanFile — skips test files', () => {
  const findings = scanFile(
    '/abs/leanshot/src/foo/Bar.test.tsx',
    '<Button>OK</Button>',
    '/abs/leanshot',
  );
  assertEquals(findings.length, 0);
});

Deno.test('scanFile — reports relative path + 1-based line', () => {
  const src = ['// header', '<Button>OK</Button>'].join('\n');
  const findings = scanFile('/abs/leanshot/src/foo/Bar.tsx', src, '/abs/leanshot');
  assertEquals(findings.length, 1);
  assertEquals(findings[0].file, 'src/foo/Bar.tsx');
  assertEquals(findings[0].line, 2);
});

// ─── buildReport ─────────────────────────────────────────────────────────────

Deno.test('buildReport — empty findings + section per check', () => {
  const out = buildReport([], '2026-05-27T00:00:00.000Z');
  assert(out.includes('# Copywriting Audit (DS-09)'));
  assert(out.includes('Total findings: **0**'));
  assert(out.includes('_None detected._'));
});

Deno.test('buildReport — buckets findings + line refs', () => {
  const out = buildReport(
    [
      {
        check: 'non-canonical-cta-verb',
        file: 'src/a.tsx',
        line: 9,
        excerpt: '<Button>OK</Button>',
        suggestion: 'X',
      },
    ],
    '2026-05-27T00:00:00.000Z',
  );
  assert(out.includes('Total findings: **1**'));
  assert(out.includes('`src/a.tsx:9`'));
});

// ─── End-to-end ──────────────────────────────────────────────────────────────

Deno.test('scanRoot + runMain — writes report and exits 0 with findings', async () => {
  const root = await buildFixture({
    'leanshot/src/Bad.tsx': [
      '<Button>OK</Button>',
      '<button>Got it</button>',
      '<Toast severity="error">Error</Toast>',
      '<Button>Save</Button>',
      '',
    ].join('\n'),
  });

  try {
    const code = await runMain([`--root=${root}`, '--quiet']);
    assertEquals(code, 0);
    const report = await Deno.readTextFile(
      join(root, 'leanshot/.planning/design-system/copywriting-report.md'),
    );
    assert(report.includes('# Copywriting Audit (DS-09)'));
    assert(report.includes('Total findings: **3**'));
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test('runMain — exits 0 on clean codebase', async () => {
  const root = await buildFixture({
    'leanshot/src/Clean.tsx': '<Button>Save</Button>\n',
  });

  try {
    const code = await runMain([`--root=${root}`, '--quiet']);
    assertEquals(code, 0);
    const report = await Deno.readTextFile(
      join(root, 'leanshot/.planning/design-system/copywriting-report.md'),
    );
    assert(report.includes('Total findings: **0**'));
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});
