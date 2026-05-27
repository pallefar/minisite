/**
 * Phase 69 Plan 69-02 — DS-04 — Tests for scripts/ci/audit-ds-primitives.ts.
 *
 * Runtime: Deno (matches sibling scripts/ci/check-sentry-imports.test.ts). Run:
 *
 *   deno test --no-check --allow-read --allow-write --allow-env scripts/ci/audit-ds-primitives.test.ts
 *
 * Coverage:
 *   1. buttonScan — positive + negative (Button primitive usage; unstyled button)
 *   2. cardScan — positive + negative (Card primitive usage; missing-shadow under-threshold)
 *   3. modalScan — positive + negative (plain non-dialog div)
 *   4. inputScan — positive + negative (Input primitive usage; unstyled input)
 *   5. scanFile — skipFile elides the primitive's own definition file
 *   6. scanFile — annotates findings inside files that import the primitive
 *   7. scanFile — reports 1-based line + relative path
 *   8. buildReport — empty findings + multi-primitive bucketing
 *   9. End-to-end — scanRoot walks `<root>/leanshot/src` and runMain writes a
 *      report with non-zero findings + exit 0
 *  10. End-to-end — clean codebase yields `Total findings: **0**` + exit 0
 */

import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { join } from 'https://deno.land/std@0.224.0/path/mod.ts';

import {
  ALL_SCANS,
  buildReport,
  buttonScan,
  cardScan,
  inputScan,
  modalScan,
  runMain,
  scanFile,
  scanRoot,
} from './audit-ds-primitives.ts';

// ─── Fixture helper ──────────────────────────────────────────────────────────

async function buildFixture(
  files: Record<string, string>,
): Promise<string> {
  const root = await Deno.makeTempDir({ prefix: 'audit-ds-primitives-' });
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(root, rel);
    await Deno.mkdir(join(abs, '..'), { recursive: true });
    await Deno.writeTextFile(abs, content);
  }
  return root;
}

// ─── 1. buttonScan ───────────────────────────────────────────────────────────

Deno.test('buttonScan — flags styled <button> with bg-primary + rounded + px', () => {
  const line = '  <button className="bg-primary text-white rounded-lg px-4 py-2">Save</button>';
  assert(buttonScan.probe(line) !== null);
});

Deno.test('buttonScan — does NOT flag <Button> primitive usage', () => {
  const line = '  <Button variant="primary">Save</Button>';
  assertEquals(buttonScan.probe(line), null);
});

Deno.test('buttonScan — does NOT flag an unstyled <button>', () => {
  const line = '  <button onClick={onClose}>Cancel</button>';
  assertEquals(buttonScan.probe(line), null);
});

// ─── 2. cardScan ─────────────────────────────────────────────────────────────

Deno.test('cardScan — flags styled <div> with surface bg + border + rounded + padding + shadow', () => {
  const line =
    '<div className="bg-surface border border-border rounded-xl p-4 shadow-sm">content</div>';
  assert(cardScan.probe(line) !== null);
});

Deno.test('cardScan — flags the var(--color-surface) variant', () => {
  const line =
    '<div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-md p-3 shadow-xs">x</div>';
  assert(cardScan.probe(line) !== null);
});

Deno.test('cardScan — does NOT flag <Card> primitive usage', () => {
  const line = '<Card variant="default" span={6}>x</Card>';
  assertEquals(cardScan.probe(line), null);
});

Deno.test('cardScan — does NOT flag a div missing shadow (under-threshold)', () => {
  const line = '<div className="bg-surface border border-border rounded-xl p-4">x</div>';
  assertEquals(cardScan.probe(line), null);
});

// ─── 3. modalScan ────────────────────────────────────────────────────────────

Deno.test('modalScan — flags ad-hoc <div role="dialog">', () => {
  const line = '<div role="dialog" aria-modal="true" className="fixed inset-0">x</div>';
  assert(modalScan.probe(line) !== null);
});

Deno.test('modalScan — does NOT flag plain non-dialog div', () => {
  const line = '<div role="region" aria-label="x">x</div>';
  assertEquals(modalScan.probe(line), null);
});

// ─── 4. inputScan ────────────────────────────────────────────────────────────

Deno.test('inputScan — flags styled <input> with border + rounded + padding + height', () => {
  const line = '<input className="border border-border rounded-md px-3 py-2" />';
  assert(inputScan.probe(line) !== null);
});

Deno.test('inputScan — does NOT flag <Input> primitive usage', () => {
  const line = '<Input value={v} onChange={set} />';
  assertEquals(inputScan.probe(line), null);
});

Deno.test('inputScan — does NOT flag an unstyled <input>', () => {
  const line = '<input type="checkbox" checked={c} />';
  assertEquals(inputScan.probe(line), null);
});

// ─── 5. scanFile — skipFile & import-relaxation ──────────────────────────────

Deno.test('scanFile — skips the primitive definition file itself (Button.tsx)', () => {
  const fakePath = '/abs/leanshot/src/components/ui/Button.tsx';
  const source = '<button className="bg-primary rounded-lg px-4 py-2">x</button>';
  const findings = scanFile(fakePath, source, '/abs/leanshot');
  assertEquals(
    findings.find((f) => f.primitive === 'Button'),
    undefined,
  );
});

Deno.test('scanFile — still flags styled <button> inside file that imports Button (annotated)', () => {
  const fakePath = '/abs/leanshot/src/components/foo/Page.tsx';
  const source = [
    "import { Button } from '@/components/ui/Button';",
    'export const Page = () => (',
    '  <div>',
    '    <Button>Real CTA</Button>',
    '    <button className="bg-primary rounded-lg px-4 py-2">Bypass CTA</button>',
    '  </div>',
    ');',
  ].join('\n');
  const findings = scanFile(fakePath, source, '/abs/leanshot');
  const buttonFindings = findings.filter((f) => f.primitive === 'Button');
  assertEquals(buttonFindings.length, 1);
  assert(buttonFindings[0].suggestion.includes('already imports the primitive'));
});

Deno.test('scanFile — reports correct relative file path and 1-based line number', () => {
  const fakePath = '/abs/leanshot/src/foo/Bar.tsx';
  const source = [
    '// header',
    '// header',
    '<button className="bg-primary rounded-lg px-4 py-2">Save</button>',
  ].join('\n');
  const findings = scanFile(fakePath, source, '/abs/leanshot');
  assertEquals(findings[0].file, 'src/foo/Bar.tsx');
  assertEquals(findings[0].line, 3);
});

// ─── 6. buildReport ──────────────────────────────────────────────────────────

Deno.test('buildReport — renders empty-state buckets with zero findings', () => {
  const out = buildReport([], '2026-05-27T00:00:00.000Z');
  assert(out.includes('Total findings: **0**'));
  for (const scan of ALL_SCANS) {
    assert(out.includes(`## ${scan.name} — 0 findings`));
  }
  assert(out.includes('_None detected._'));
});

Deno.test('buildReport — groups findings by primitive with summary table', () => {
  const out = buildReport(
    [
      {
        primitive: 'Button',
        file: 'src/a.tsx',
        line: 1,
        excerpt: '<button .../>',
        suggestion: 'X',
      },
      {
        primitive: 'Button',
        file: 'src/b.tsx',
        line: 2,
        excerpt: '<button .../>',
        suggestion: 'X',
      },
      {
        primitive: 'Card',
        file: 'src/c.tsx',
        line: 3,
        excerpt: '<div .../>',
        suggestion: 'X',
      },
    ],
    '2026-05-27T00:00:00.000Z',
  );
  assert(out.includes('Total findings: **3**'));
  assert(out.includes('| Button | 2 |'));
  assert(out.includes('| Card | 1 |'));
  assert(out.includes('`src/a.tsx:1`'));
  assert(out.includes('`src/b.tsx:2`'));
  assert(out.includes('`src/c.tsx:3`'));
});

// ─── 7. End-to-end scanRoot + runMain ────────────────────────────────────────

Deno.test('scanRoot — finds duplicates under leanshot/src and ignores Good.tsx', async () => {
  const root = await buildFixture({
    'leanshot/src/Bad.tsx': [
      'export const Bad = () => (',
      '  <div>',
      '    <button className="bg-primary text-white rounded-lg px-4 py-2">Bad</button>',
      '    <div className="bg-surface border border-border rounded-xl p-4 shadow-sm">card</div>',
      '    <div role="dialog" aria-modal="true">m</div>',
      '  </div>',
      ');',
      '',
    ].join('\n'),
    'leanshot/src/Good.tsx': [
      "import { Button } from '@/components/ui/Button';",
      'export const Good = () => <Button>Good</Button>;',
      '',
    ].join('\n'),
  });

  try {
    const findings = await scanRoot(root);
    assertEquals(findings.length, 3);
    assert(findings.some((f) => f.primitive === 'Button' && f.file.endsWith('Bad.tsx')));
    assert(findings.some((f) => f.primitive === 'Card' && f.file.endsWith('Bad.tsx')));
    assert(findings.some((f) => f.primitive === 'Modal' && f.file.endsWith('Bad.tsx')));
    assert(findings.every((f) => !f.file.endsWith('Good.tsx')));
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test('runMain — writes report file and exits 0 with findings', async () => {
  const root = await buildFixture({
    'leanshot/src/Bad.tsx': [
      '<button className="bg-primary rounded-lg px-4 py-2">x</button>',
      '',
    ].join('\n'),
  });

  try {
    const code = await runMain([`--root=${root}`, '--quiet']);
    assertEquals(code, 0);
    const reportPath = join(
      root,
      'leanshot/.planning/design-system/primitive-adoption-report.md',
    );
    const report = await Deno.readTextFile(reportPath);
    assert(report.includes('# DS Primitive Adoption Audit (DS-04)'));
    assert(report.includes('Total findings: **1**'));
    assert(report.includes('| Button | 1 |'));
    assert(report.includes('src/Bad.tsx:1'));
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test('runMain — exits 0 on a clean codebase', async () => {
  const root = await buildFixture({
    'leanshot/src/Clean.tsx': [
      "import { Button } from '@/components/ui/Button';",
      "import { Card } from '@/components/ui/Card';",
      'export const Clean = () => (',
      '  <Card><Button>Hi</Button></Card>',
      ');',
      '',
    ].join('\n'),
  });

  try {
    const code = await runMain([`--root=${root}`, '--quiet']);
    assertEquals(code, 0);
    const report = await Deno.readTextFile(
      join(root, 'leanshot/.planning/design-system/primitive-adoption-report.md'),
    );
    assert(report.includes('Total findings: **0**'));
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});
