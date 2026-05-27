/**
 * Phase 69 Plan 69-03 — DS-08 — Tests for scripts/ci/audit-spacing.ts.
 *
 *   deno test --no-check --allow-read --allow-write --allow-env scripts/ci/audit-spacing.test.ts
 */

import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { join } from 'https://deno.land/std@0.224.0/path/mod.ts';

import { buildReport, probeLine, runMain, scanFile, scanRoot } from './audit-spacing.ts';

async function buildFixture(files: Record<string, string>): Promise<string> {
  const root = await Deno.makeTempDir({ prefix: 'audit-spacing-' });
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(root, rel);
    await Deno.mkdir(join(abs, '..'), { recursive: true });
    await Deno.writeTextFile(abs, content);
  }
  return root;
}

// ─── probeLine — padding ─────────────────────────────────────────────────────

Deno.test('probeLine — flags p-[7px] (not multiple of 4)', () => {
  const hits = probeLine('<div className="p-[7px]">x</div>');
  assertEquals(hits.length, 1);
  assertEquals(hits[0].kind, 'padding');
  assertEquals(hits[0].px, 7);
});

Deno.test('probeLine — does NOT flag p-[8px] (on grid)', () => {
  assertEquals(probeLine('<div className="p-[8px]">x</div>').length, 0);
});

Deno.test('probeLine — does NOT flag p-2 (Tailwind default scale, 8px)', () => {
  assertEquals(probeLine('<div className="p-2">x</div>').length, 0);
});

Deno.test('probeLine — flags px-[10px] AND py-[14px] (both off-grid)', () => {
  const hits = probeLine('<div className="px-[10px] py-[14px]">x</div>');
  assertEquals(hits.length, 2);
});

// ─── probeLine — margin ──────────────────────────────────────────────────────

Deno.test('probeLine — flags m-[5px]', () => {
  const hits = probeLine('<div className="m-[5px]">x</div>');
  assertEquals(hits.length, 1);
  assertEquals(hits[0].kind, 'margin');
});

Deno.test('probeLine — does NOT flag m-[16px]', () => {
  assertEquals(probeLine('<div className="m-[16px]">x</div>').length, 0);
});

// ─── probeLine — gap ─────────────────────────────────────────────────────────

Deno.test('probeLine — flags gap-[6px]', () => {
  const hits = probeLine('<div className="grid gap-[6px]">x</div>');
  assertEquals(hits.length, 1);
  assertEquals(hits[0].kind, 'gap');
});

Deno.test('probeLine — flags gap-x-[10px] and gap-y-[18px]', () => {
  const hits = probeLine('<div className="gap-x-[10px] gap-y-[18px]">x</div>');
  assertEquals(hits.length, 2);
  assertEquals(hits.every((h) => h.kind === 'gap'), true);
});

// ─── probeLine — space-x / space-y ───────────────────────────────────────────

Deno.test('probeLine — flags space-x-[3px] and space-y-[7px]', () => {
  const hits = probeLine('<div className="space-x-[3px] space-y-[7px]">x</div>');
  assertEquals(hits.length, 2);
});

Deno.test('probeLine — does NOT flag space-y-[12px]', () => {
  assertEquals(probeLine('<div className="space-y-[12px]">x</div>').length, 0);
});

// ─── scanFile ────────────────────────────────────────────────────────────────

Deno.test('scanFile — skips test files', () => {
  const findings = scanFile(
    '/abs/leanshot/src/foo/Bar.test.tsx',
    '<div className="p-[7px]">x</div>',
    '/abs/leanshot',
  );
  assertEquals(findings.length, 0);
});

Deno.test('scanFile — reports relative path + 1-based line', () => {
  const src = ['// header', '<div className="p-[7px]">x</div>'].join('\n');
  const findings = scanFile('/abs/leanshot/src/foo/Bar.tsx', src, '/abs/leanshot');
  assertEquals(findings.length, 1);
  assertEquals(findings[0].file, 'src/foo/Bar.tsx');
  assertEquals(findings[0].line, 2);
});

// ─── buildReport ─────────────────────────────────────────────────────────────

Deno.test('buildReport — empty findings + section per kind', () => {
  const out = buildReport([], '2026-05-27T00:00:00.000Z');
  assert(out.includes('# Spacing Audit (DS-08)'));
  assert(out.includes('Total findings: **0**'));
  assert(out.includes('_None detected._'));
});

Deno.test('buildReport — buckets findings + summary table', () => {
  const out = buildReport(
    [
      {
        kind: 'padding',
        raw: 'p-[7px]',
        px: 7,
        file: 'src/a.tsx',
        line: 3,
        excerpt: '<div className="p-[7px]">x</div>',
        suggestion: 'X',
      },
    ],
    '2026-05-27T00:00:00.000Z',
  );
  assert(out.includes('Total findings: **1**'));
  assert(out.includes('`src/a.tsx:3`'));
  assert(out.includes('| padding | 1 |'));
});

// ─── End-to-end ──────────────────────────────────────────────────────────────

Deno.test('scanRoot + runMain — writes report and exits 0', async () => {
  const root = await buildFixture({
    'leanshot/src/Bad.tsx': [
      '<div className="p-[7px] m-[5px] gap-[6px] space-x-[3px] space-y-[11px]">x</div>',
      '<div className="p-4 m-2 gap-2">on grid</div>',
      '',
    ].join('\n'),
  });

  try {
    const code = await runMain([`--root=${root}`, '--quiet']);
    assertEquals(code, 0);
    const report = await Deno.readTextFile(
      join(root, 'leanshot/.planning/design-system/spacing-report.md'),
    );
    assert(report.includes('# Spacing Audit (DS-08)'));
    assert(report.includes('Total findings: **5**'));
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test('runMain — exits 0 on clean codebase', async () => {
  const root = await buildFixture({
    'leanshot/src/Clean.tsx': '<div className="p-4 m-2 gap-3">clean</div>\n',
  });

  try {
    const code = await runMain([`--root=${root}`, '--quiet']);
    assertEquals(code, 0);
    const report = await Deno.readTextFile(
      join(root, 'leanshot/.planning/design-system/spacing-report.md'),
    );
    assert(report.includes('Total findings: **0**'));
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});
