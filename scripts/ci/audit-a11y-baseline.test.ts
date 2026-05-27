/**
 * Phase 69 Plan 69-03 — DS-05 — Tests for scripts/ci/audit-a11y-baseline.ts.
 *
 *   deno test --no-check --allow-read --allow-write --allow-env scripts/ci/audit-a11y-baseline.test.ts
 */

import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { join } from 'https://deno.land/std@0.224.0/path/mod.ts';

import {
  buildReport,
  findFramerWithoutReducedMotion,
  findUnlabeledInputs,
  probeDialogAriaModal,
  probeIconButton,
  probeSortableTh,
  runMain,
  scanFile,
  scanRoot,
} from './audit-a11y-baseline.ts';

async function buildFixture(files: Record<string, string>): Promise<string> {
  const root = await Deno.makeTempDir({ prefix: 'audit-a11y-baseline-' });
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(root, rel);
    await Deno.mkdir(join(abs, '..'), { recursive: true });
    await Deno.writeTextFile(abs, content);
  }
  return root;
}

// ─── 1. probeIconButton ──────────────────────────────────────────────────────

Deno.test('probeIconButton — flags icon-only <button> without aria-label', () => {
  const line = '  <button onClick={x}><Close /></button>';
  assert(probeIconButton(line) !== null);
});

Deno.test('probeIconButton — does NOT flag when aria-label is present', () => {
  const line = '  <button aria-label="Close" onClick={x}><Close /></button>';
  assertEquals(probeIconButton(line), null);
});

Deno.test('probeIconButton — does NOT flag <button> with text content', () => {
  const line = '  <button onClick={x}>Save</button>';
  assertEquals(probeIconButton(line), null);
});

// ─── 2. probeDialogAriaModal ─────────────────────────────────────────────────

Deno.test('probeDialogAriaModal — flags role="dialog" without aria-modal', () => {
  const line = '<div role="dialog" className="fixed inset-0">x</div>';
  assert(probeDialogAriaModal(line) !== null);
});

Deno.test('probeDialogAriaModal — does NOT flag with aria-modal="true"', () => {
  const line = '<div role="dialog" aria-modal="true" className="fixed inset-0">x</div>';
  assertEquals(probeDialogAriaModal(line), null);
});

Deno.test('probeDialogAriaModal — does NOT flag non-dialog role', () => {
  const line = '<div role="region" aria-label="x">x</div>';
  assertEquals(probeDialogAriaModal(line), null);
});

// ─── 3. findUnlabeledInputs ──────────────────────────────────────────────────

Deno.test('findUnlabeledInputs — flags <input id> with no matching <label htmlFor>', () => {
  const source = [
    '<form>',
    '  <input id="email" type="email" />',
    '</form>',
  ].join('\n');
  const unl = findUnlabeledInputs(source);
  assertEquals(unl.length, 1);
  assertEquals(unl[0].id, 'email');
  assertEquals(unl[0].line, 2);
});

Deno.test('findUnlabeledInputs — does NOT flag when a label htmlFor matches', () => {
  const source = [
    '<form>',
    '  <label htmlFor="email">Email</label>',
    '  <input id="email" type="email" />',
    '</form>',
  ].join('\n');
  assertEquals(findUnlabeledInputs(source).length, 0);
});

Deno.test('findUnlabeledInputs — skips inputs without an id (cannot tell)', () => {
  const source = '<input type="text" />';
  assertEquals(findUnlabeledInputs(source).length, 0);
});

Deno.test('findUnlabeledInputs — exempts type="hidden" and aria-label', () => {
  const source = [
    '<input id="csrf" type="hidden" />',
    '<input id="search" aria-label="Search" />',
  ].join('\n');
  assertEquals(findUnlabeledInputs(source).length, 0);
});

// ─── 4. findFramerWithoutReducedMotion ───────────────────────────────────────

Deno.test('findFramerWithoutReducedMotion — flags framer import without useReducedMotion', () => {
  const source = "import { motion } from 'framer-motion';\nexport const X = () => <motion.div/>;";
  const result = findFramerWithoutReducedMotion(source);
  assert(result !== null);
  assertEquals(result!.line, 1);
});

Deno.test('findFramerWithoutReducedMotion — does NOT flag when useReducedMotion present', () => {
  const source = [
    "import { motion } from 'framer-motion';",
    "import { useReducedMotion } from '@/hooks/useReducedMotion';",
  ].join('\n');
  assertEquals(findFramerWithoutReducedMotion(source), null);
});

Deno.test('findFramerWithoutReducedMotion — does NOT flag when framer is not imported', () => {
  const source = "import { useState } from 'react';";
  assertEquals(findFramerWithoutReducedMotion(source), null);
});

// ─── 5. probeSortableTh ──────────────────────────────────────────────────────

Deno.test('probeSortableTh — flags <th onClick> without aria-sort', () => {
  const line = '<th onClick={sort}>Name</th>';
  assert(probeSortableTh(line) !== null);
});

Deno.test('probeSortableTh — flags <th className="cursor-pointer"> without aria-sort', () => {
  const line = '<th className="cursor-pointer">Name</th>';
  assert(probeSortableTh(line) !== null);
});

Deno.test('probeSortableTh — does NOT flag when aria-sort is present', () => {
  const line = '<th onClick={sort} aria-sort="ascending">Name</th>';
  assertEquals(probeSortableTh(line), null);
});

Deno.test('probeSortableTh — does NOT flag a plain non-sortable <th>', () => {
  const line = '<th>Name</th>';
  assertEquals(probeSortableTh(line), null);
});

// ─── 6. scanFile — skip rules + path/line correctness ────────────────────────

Deno.test('scanFile — skips .test.tsx files', () => {
  const fakePath = '/abs/leanshot/src/foo/Bar.test.tsx';
  const source = '<button><Icon /></button>';
  assertEquals(scanFile(fakePath, source, '/abs/leanshot').length, 0);
});

Deno.test('scanFile — reports relative path + 1-based line', () => {
  const fakePath = '/abs/leanshot/src/foo/Bar.tsx';
  const source = ['// header', '// header', '<div role="dialog">x</div>'].join('\n');
  const findings = scanFile(fakePath, source, '/abs/leanshot');
  assert(findings.length >= 1);
  assertEquals(findings[0].file, 'src/foo/Bar.tsx');
  assertEquals(findings[0].line, 3);
});

// ─── 7. buildReport ──────────────────────────────────────────────────────────

Deno.test('buildReport — empty findings + section per check', () => {
  const out = buildReport([], '2026-05-27T00:00:00.000Z');
  assert(out.includes('# A11y Baseline Audit (DS-05)'));
  assert(out.includes('Total findings: **0**'));
  assert(out.includes('_None detected._'));
});

Deno.test('buildReport — buckets findings + line refs', () => {
  const out = buildReport(
    [
      {
        check: 'icon-button-aria-label',
        file: 'src/a.tsx',
        line: 12,
        excerpt: '<button><Icon/></button>',
        suggestion: 'icon-only `<button>` missing `aria-label`',
      },
    ],
    '2026-05-27T00:00:00.000Z',
  );
  assert(out.includes('Total findings: **1**'));
  assert(out.includes('`src/a.tsx:12`'));
});

// ─── 8. End-to-end ───────────────────────────────────────────────────────────

Deno.test('scanRoot + runMain — writes report and exits 0', async () => {
  const root = await buildFixture({
    'leanshot/src/Bad.tsx': [
      "import { motion } from 'framer-motion';",
      'export const Bad = () => (',
      '  <div>',
      '    <button onClick={x}><Close /></button>',
      '    <div role="dialog">x</div>',
      '    <input id="email" type="email" />',
      '    <th onClick={s}>Name</th>',
      '  </div>',
      ');',
      '',
    ].join('\n'),
  });

  try {
    const code = await runMain([`--root=${root}`, '--quiet']);
    assertEquals(code, 0);
    const reportPath = join(
      root,
      'leanshot/.planning/design-system/a11y-baseline-report.md',
    );
    const report = await Deno.readTextFile(reportPath);
    assert(report.includes('# A11y Baseline Audit (DS-05)'));
    // 5 findings: icon-button, dialog, input, framer-without-reduced-motion, th-sortable.
    assert(report.includes('Total findings: **5**'));
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test('runMain — exits 0 on clean codebase', async () => {
  const root = await buildFixture({
    'leanshot/src/Clean.tsx': [
      "import { useState } from 'react';",
      'export const Clean = () => <button>Save</button>;',
      '',
    ].join('\n'),
  });

  try {
    const code = await runMain([`--root=${root}`, '--quiet']);
    assertEquals(code, 0);
    const report = await Deno.readTextFile(
      join(root, 'leanshot/.planning/design-system/a11y-baseline-report.md'),
    );
    assert(report.includes('Total findings: **0**'));
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});
