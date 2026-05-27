/**
 * Phase 69 Plan 69-01 — tests for scripts/ci/check-typography-ceiling.ts (DS-02).
 *
 * Runtime: Deno.
 *
 *   deno test --no-check --allow-read --allow-write --allow-env scripts/ci/check-typography-ceiling.test.ts
 */

import { assertEquals, assert } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { join } from 'https://deno.land/std@0.224.0/path/mod.ts';
import {
  parseSizeToPx,
  scanTsxSource,
  scanCssSource,
  scanProject,
} from './check-typography-ceiling.ts';

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function buildFixture(files: Record<string, string>): Promise<string> {
  const root = await Deno.makeTempDir({ prefix: 'typo-ceiling-' });
  for (const [rel, content] of Object.entries(files)) {
    const filePath = join(root, rel);
    const lastSlash = filePath.lastIndexOf('/');
    if (lastSlash > -1) await Deno.mkdir(filePath.slice(0, lastSlash), { recursive: true });
    await Deno.writeTextFile(filePath, content);
  }
  return root;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

Deno.test('parseSizeToPx: px and rem', () => {
  assertEquals(parseSizeToPx('14px'), 14);
  assertEquals(parseSizeToPx('11px'), 11);
  assertEquals(parseSizeToPx('1rem'), 16);
  assertEquals(parseSizeToPx('0.6875rem'), 11);
  assertEquals(parseSizeToPx('1.125rem'), 18);
  assertEquals(parseSizeToPx('1.75rem'), 28);
  // Unsupported units return null
  assertEquals(parseSizeToPx('1.5em'), null);
  assertEquals(parseSizeToPx('100%'), null);
  assertEquals(parseSizeToPx('garbage'), null);
});

Deno.test('File using only 11/13/18/28 px passes', () => {
  const src = `
<div className="text-micro text-sm text-lg text-heading">
  <span style={{ fontSize: '11px' }}>hi</span>
</div>
`;
  const v = scanTsxSource(src);
  assertEquals(v.length, 0, JSON.stringify(v));
});

Deno.test('text-[14px] arbitrary literal FAILS', () => {
  const src = `<div className="text-[14px]">x</div>`;
  const v = scanTsxSource(src);
  assertEquals(v.length, 1);
  assertEquals(v[0].kind, 'font-size-arbitrary');
  assertEquals(v[0].value, '14px');
});

Deno.test('text-[11px] arbitrary literal PASSES (in ceiling)', () => {
  const src = `<div className="text-[11px]">x</div>`;
  const v = scanTsxSource(src);
  assertEquals(v.length, 0);
});

Deno.test('text-xs (12px) fails; text-sm (13px) passes', () => {
  const src = `<div className="text-xs text-sm">x</div>`;
  const v = scanTsxSource(src);
  assertEquals(v.length, 1);
  assertEquals(v[0].match, 'text-xs');
  assertEquals(v[0].value, '12px');
});

Deno.test('text-base (16) and text-xl (22) flagged; text-lg (18) passes', () => {
  const src = `<div className="text-base text-lg text-xl">x</div>`;
  const v = scanTsxSource(src);
  assertEquals(v.length, 2, JSON.stringify(v));
  const matches = v.map((x) => x.match).sort();
  assertEquals(matches, ['text-base', 'text-xl']);
});

Deno.test('font-semibold (600) passes; font-medium (500) FAILS', () => {
  const src = `<div className="font-semibold font-medium">x</div>`;
  const v = scanTsxSource(src);
  assertEquals(v.length, 1);
  assertEquals(v[0].match, 'font-medium');
  assertEquals(v[0].value, '500');
});

Deno.test('font-normal (400) passes; font-bold (700) FAILS', () => {
  const src = `<div className="font-normal font-bold">x</div>`;
  const v = scanTsxSource(src);
  assertEquals(v.length, 1);
  assertEquals(v[0].match, 'font-bold');
});

Deno.test('font-[500] arbitrary weight FAILS', () => {
  const src = `<div className="font-[500]">x</div>`;
  const v = scanTsxSource(src);
  assertEquals(v.length, 1);
  assertEquals(v[0].kind, 'font-weight-arbitrary');
});

Deno.test('CSS file: font-size: 14px FAILS; 18px passes', () => {
  const src = `.a { font-size: 14px; } .b { font-size: 18px; font-weight: 500; }`;
  const v = scanCssSource(src);
  assertEquals(v.length, 2, JSON.stringify(v));
  const kinds = v.map((x) => x.kind).sort();
  assertEquals(kinds, ['font-size-css', 'font-weight-css']);
});

Deno.test('comments do not false-positive (text-base in JSDoc)', () => {
  const src = `
/**
 * The text-base utility is 16px which is outside the ceiling.
 * Use text-lg instead.
 */
<div className="text-lg">x</div>
`;
  const v = scanTsxSource(src);
  assertEquals(v.length, 0, JSON.stringify(v));
});

Deno.test('scanProject: index.css NOT flagged (source-of-truth)', async () => {
  const root = await buildFixture({
    'src/index.css': `:root { font-size: 14px; }`,
    'src/other.css': `.x { font-size: 14px; }`,
  });
  try {
    const r = await scanProject(join(root, 'src'));
    assertEquals(r.violations.length, 1, JSON.stringify(r));
    assertEquals(r.violations[0].file.endsWith('other.css'), true);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test('scanProject: .test.tsx files skipped', async () => {
  const root = await buildFixture({
    'src/a.tsx': `<div className="text-lg">x</div>`,
    'src/a.test.tsx': `<div className="text-[42px]">x</div>`,
  });
  try {
    const r = await scanProject(join(root, 'src'));
    assertEquals(r.violations.length, 0, JSON.stringify(r));
    assertEquals(r.filesScanned, 1);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test('inline fontSize: 14 (no unit) treated as px and FAILS', () => {
  const src = `<div style={{ fontSize: 14 }}>x</div>`;
  const v = scanTsxSource(src);
  assertEquals(v.length, 1);
  assertEquals(v[0].kind, 'font-size-inline');
  assertEquals(v[0].value, '14px');
});
