/**
 * Phase 69 Plan 69-03 — DS-07 — Tests for scripts/ci/audit-mobile-responsive.ts.
 *
 *   deno test --no-check --allow-read --allow-write --allow-env scripts/ci/audit-mobile-responsive.test.ts
 */

import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { join } from 'https://deno.land/std@0.224.0/path/mod.ts';

import {
  buildReport,
  findTablesWithoutOverflowWrapper,
  probeFixedWidth,
  probeHorizontalScroll,
  probeTapTarget,
  runMain,
  scanFile,
  scanRoot,
} from './audit-mobile-responsive.ts';

async function buildFixture(files: Record<string, string>): Promise<string> {
  const root = await Deno.makeTempDir({ prefix: 'audit-mobile-responsive-' });
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(root, rel);
    await Deno.mkdir(join(abs, '..'), { recursive: true });
    await Deno.writeTextFile(abs, content);
  }
  return root;
}

// ─── probeFixedWidth ─────────────────────────────────────────────────────────

Deno.test('probeFixedWidth — flags w-[400px] above mobile breakpoint without responsive override', () => {
  const line = '<div className="w-[400px] bg-surface">x</div>';
  assert(probeFixedWidth(line) !== null);
});

Deno.test('probeFixedWidth — does NOT flag w-[400px] when md:w-* override present', () => {
  const line = '<div className="w-[400px] md:w-full">x</div>';
  assertEquals(probeFixedWidth(line), null);
});

Deno.test('probeFixedWidth — does NOT flag w-[320px] (under breakpoint)', () => {
  const line = '<div className="w-[320px]">x</div>';
  assertEquals(probeFixedWidth(line), null);
});

Deno.test('probeFixedWidth — does NOT flag plain w-full', () => {
  const line = '<div className="w-full">x</div>';
  assertEquals(probeFixedWidth(line), null);
});

// ─── probeTapTarget ──────────────────────────────────────────────────────────

Deno.test('probeTapTarget — flags <button h-[32px]> (below 44px)', () => {
  const line = '<button className="h-[32px] px-4">Save</button>';
  assert(probeTapTarget(line) !== null);
});

Deno.test('probeTapTarget — flags <a min-h-[40px]> (below 44px)', () => {
  const line = '<a className="min-h-[40px]" href="/">Link</a>';
  assert(probeTapTarget(line) !== null);
});

Deno.test('probeTapTarget — does NOT flag <button h-[44px]> (at minimum)', () => {
  const line = '<button className="h-[44px]">Save</button>';
  assertEquals(probeTapTarget(line), null);
});

Deno.test('probeTapTarget — does NOT flag <div h-[20px]> (not a button/anchor)', () => {
  const line = '<div className="h-[20px]">spacer</div>';
  assertEquals(probeTapTarget(line), null);
});

// ─── probeHorizontalScroll ───────────────────────────────────────────────────

Deno.test('probeHorizontalScroll — flags overflow-x-auto declarations', () => {
  const line = '<div className="overflow-x-auto">x</div>';
  assert(probeHorizontalScroll(line) !== null);
});

Deno.test('probeHorizontalScroll — does NOT flag plain overflow-hidden', () => {
  const line = '<div className="overflow-hidden">x</div>';
  assertEquals(probeHorizontalScroll(line), null);
});

// ─── findTablesWithoutOverflowWrapper ────────────────────────────────────────

Deno.test('findTablesWithoutOverflowWrapper — flags <table> with no wrapper', () => {
  const source = [
    '<div className="space-y-2">',
    '  <table>',
    '    <tr><td>x</td></tr>',
    '  </table>',
    '</div>',
  ].join('\n');
  const out = findTablesWithoutOverflowWrapper(source);
  assertEquals(out.length, 1);
  assertEquals(out[0].line, 2);
});

Deno.test('findTablesWithoutOverflowWrapper — does NOT flag when overflow-x-auto is on parent (3-line lookback)', () => {
  const source = [
    '<div className="overflow-x-auto">',
    '  <table>',
    '    <tr><td>x</td></tr>',
    '  </table>',
    '</div>',
  ].join('\n');
  assertEquals(findTablesWithoutOverflowWrapper(source).length, 0);
});

Deno.test('findTablesWithoutOverflowWrapper — does NOT flag when overflow-x-auto is inline on same line', () => {
  const source = '<div className="overflow-x-auto"><table><tr><td>x</td></tr></table></div>';
  assertEquals(findTablesWithoutOverflowWrapper(source).length, 0);
});

// ─── scanFile ────────────────────────────────────────────────────────────────

Deno.test('scanFile — skips test files', () => {
  const findings = scanFile(
    '/abs/leanshot/src/foo/Bar.test.tsx',
    '<div className="w-[500px]">x</div>',
    '/abs/leanshot',
  );
  assertEquals(findings.length, 0);
});

Deno.test('scanFile — reports relative path + 1-based line', () => {
  const source = ['// header', '<div className="w-[500px]">x</div>'].join('\n');
  const findings = scanFile('/abs/leanshot/src/foo/Bar.tsx', source, '/abs/leanshot');
  assert(findings.length >= 1);
  assertEquals(findings[0].file, 'src/foo/Bar.tsx');
  assertEquals(findings[0].line, 2);
});

// ─── buildReport ─────────────────────────────────────────────────────────────

Deno.test('buildReport — empty findings + section per check', () => {
  const out = buildReport([], '2026-05-27T00:00:00.000Z');
  assert(out.includes('# Mobile-Responsive Audit (DS-07)'));
  assert(out.includes('Total findings: **0**'));
  assert(out.includes('_None detected._'));
});

Deno.test('buildReport — buckets findings with line refs', () => {
  const out = buildReport(
    [
      {
        check: 'tap-target-too-small',
        file: 'src/foo.tsx',
        line: 9,
        excerpt: '<button h-[32px]/>',
        suggestion: 'too small',
      },
    ],
    '2026-05-27T00:00:00.000Z',
  );
  assert(out.includes('Total findings: **1**'));
  assert(out.includes('`src/foo.tsx:9`'));
});

// ─── End-to-end ──────────────────────────────────────────────────────────────

Deno.test('scanRoot + runMain — writes report and exits 0 with findings', async () => {
  // Two separate files so the overflow-x-auto wrapper finding doesn't
  // accidentally satisfy the table-no-overflow-wrapper 3-line lookback.
  const root = await buildFixture({
    'leanshot/src/BadA.tsx': [
      '<div className="w-[500px]">wide</div>',
      '<button className="h-[32px]">small</button>',
      '<div className="overflow-x-auto">scroll</div>',
      '',
    ].join('\n'),
    'leanshot/src/BadB.tsx': [
      'export const Tbl = () => (',
      '  <div>',
      '    <p>filler</p>',
      '    <p>filler</p>',
      '    <p>filler</p>',
      '    <p>filler</p>',
      '    <table><tr><td>nope</td></tr></table>',
      '  </div>',
      ');',
      '',
    ].join('\n'),
  });

  try {
    const code = await runMain([`--root=${root}`, '--quiet']);
    assertEquals(code, 0);
    const report = await Deno.readTextFile(
      join(root, 'leanshot/.planning/design-system/mobile-responsive-report.md'),
    );
    assert(report.includes('# Mobile-Responsive Audit (DS-07)'));
    assert(report.includes('Total findings: **4**'));
    // Spot-check each check fired at least once.
    assert(report.includes('| Hardcoded width'));
    assert(report.includes('| Tap target'));
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test('runMain — exits 0 on clean codebase', async () => {
  const root = await buildFixture({
    'leanshot/src/Clean.tsx': '<button className="h-11">Save</button>\n',
  });

  try {
    const code = await runMain([`--root=${root}`, '--quiet']);
    assertEquals(code, 0);
    const report = await Deno.readTextFile(
      join(root, 'leanshot/.planning/design-system/mobile-responsive-report.md'),
    );
    assert(report.includes('Total findings: **0**'));
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});
