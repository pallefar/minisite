/**
 * Phase 69 Plan 69-01 — tests for scripts/ci/check-tailwind-tokens.ts (DS-01).
 *
 * Runtime: Deno (NOT Vitest).
 *
 *   deno test --no-check --allow-read --allow-write --allow-env scripts/ci/check-tailwind-tokens.test.ts
 */

import { assertEquals, assert } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { join } from 'https://deno.land/std@0.224.0/path/mod.ts';
import {
  extractThemeTokens,
  deriveValidSuffixes,
  scanSource,
  scanProject,
} from './check-tailwind-tokens.ts';

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function buildFixture(
  files: Record<string, string>,
): Promise<{ root: string; cssPath: string }> {
  const root = await Deno.makeTempDir({ prefix: 'tw-tokens-check-' });
  const srcRoot = join(root, 'src');
  await Deno.mkdir(srcRoot, { recursive: true });
  let cssPath = join(srcRoot, 'index.css');
  for (const [rel, content] of Object.entries(files)) {
    const filePath = join(srcRoot, rel);
    const lastSlash = filePath.lastIndexOf('/');
    if (lastSlash > -1) await Deno.mkdir(filePath.slice(0, lastSlash), { recursive: true });
    await Deno.writeTextFile(filePath, content);
    if (rel === 'index.css') cssPath = filePath;
  }
  return { root: srcRoot, cssPath };
}

const SAMPLE_CSS = `
@theme {
  --color-text: #16221f;
  --color-text-secondary: #4d5e58;
  --color-surface: #fefcf7;
  --color-primary: #1b4842;
  --text-base: 1rem;
  --text-heading: 1.75rem;
  --shadow-hero: 0 24px 60px;
  --radius-card: 1.5rem;
}
`;

// ─── Tests: pure extractors ──────────────────────────────────────────────────

Deno.test('extractThemeTokens parses single @theme block', () => {
  const toks = extractThemeTokens(SAMPLE_CSS);
  assert(toks.includes('--color-text'));
  assert(toks.includes('--color-text-secondary'));
  assert(toks.includes('--color-surface'));
  assert(toks.includes('--text-base'));
  assert(toks.includes('--text-heading'));
  assert(toks.includes('--shadow-hero'));
  assert(toks.includes('--radius-card'));
});

Deno.test('extractThemeTokens returns empty for CSS with no @theme', () => {
  const toks = extractThemeTokens(':root { --color-foo: red; }');
  assertEquals(toks, []);
});

Deno.test('deriveValidSuffixes maps --color-* and --text-* correctly', () => {
  const toks = extractThemeTokens(SAMPLE_CSS);
  const suffixes = deriveValidSuffixes(toks);
  // text-text, bg-text, border-text all derive from --color-text → suffix "text"
  assert(suffixes.has('text'));
  assert(suffixes.has('text-secondary'));
  assert(suffixes.has('surface'));
  assert(suffixes.has('primary'));
  // text-base font-size
  assert(suffixes.has('base'));
  assert(suffixes.has('heading'));
  assert(suffixes.has('hero')); // shadow-hero
  assert(suffixes.has('card')); // radius-card
  // Negative — undefined token
  assert(!suffixes.has('text-primary'));
  assert(!suffixes.has('surface-card'));
});

// ─── Tests: scanSource ───────────────────────────────────────────────────────

Deno.test('text-text passes when --color-text is defined', () => {
  const toks = extractThemeTokens(SAMPLE_CSS);
  const valid = deriveValidSuffixes(toks);
  const src = `<div className="text-text">hello</div>`;
  const violations = scanSource(src, valid);
  assertEquals(violations.length, 0);
});

Deno.test('text-text-primary FAILS when only --color-text exists', () => {
  const toks = extractThemeTokens(SAMPLE_CSS);
  const valid = deriveValidSuffixes(toks);
  const src = `<div className="text-text-primary">hello</div>`;
  const violations = scanSource(src, valid);
  assertEquals(violations.length, 1, JSON.stringify(violations));
  assertEquals(violations[0].className, 'text-text-primary');
  assertEquals(violations[0].suffix, 'text-primary');
});

Deno.test('bg-surface passes; bg-surface-card FAILS', () => {
  const toks = extractThemeTokens(SAMPLE_CSS);
  const valid = deriveValidSuffixes(toks);
  const src = `<div className="bg-surface bg-surface-card">x</div>`;
  const violations = scanSource(src, valid);
  assertEquals(violations.length, 1);
  assertEquals(violations[0].className, 'bg-surface-card');
});

Deno.test('text-center / text-balance / text-sm always pass (built-ins)', () => {
  const valid = new Set<string>(); // empty @theme
  const src = `<div className="text-center text-balance text-sm text-lg text-xl">x</div>`;
  const violations = scanSource(src, valid);
  assertEquals(violations.length, 0, JSON.stringify(violations));
});

Deno.test('built-in palette color (text-red-500, bg-blue) passes', () => {
  const valid = new Set<string>();
  const src = `<div className="text-red-500 bg-blue-50 ring-emerald-300">x</div>`;
  const violations = scanSource(src, valid);
  assertEquals(violations.length, 0);
});

Deno.test('arbitrary value text-[14px] passes (escape hatch)', () => {
  const valid = new Set<string>();
  const src = `<div className="text-[14px] bg-[#fff] from-[rgba(0,0,0,0.5)]">x</div>`;
  const violations = scanSource(src, valid);
  assertEquals(violations.length, 0);
});

Deno.test('opacity modifier bg-primary/50 strips before lookup', () => {
  const toks = extractThemeTokens(SAMPLE_CSS);
  const valid = deriveValidSuffixes(toks);
  const src = `<div className="bg-primary/50 text-text/80">x</div>`;
  const violations = scanSource(src, valid);
  assertEquals(violations.length, 0);
});

Deno.test('from-/to-/via- gradient stops checked against @theme', () => {
  const toks = extractThemeTokens(SAMPLE_CSS);
  const valid = deriveValidSuffixes(toks);
  // primary defined → from-primary passes; surface-foo undefined → fails
  const src = `<div className="from-primary to-surface-foo">x</div>`;
  const violations = scanSource(src, valid);
  assertEquals(violations.length, 1);
  assertEquals(violations[0].prefix, 'to');
  assertEquals(violations[0].suffix, 'surface-foo');
});

// ─── Tests: scanProject end-to-end ───────────────────────────────────────────

Deno.test('scanProject: file ending in .test.tsx is skipped', async () => {
  const { root, cssPath } = await buildFixture({
    'index.css': SAMPLE_CSS,
    'good.tsx': `<div className="text-text">x</div>`,
    'bad.test.tsx': `<div className="text-text-primary">x</div>`,
  });
  try {
    const r = await scanProject(root, cssPath);
    assertEquals(r.violations.length, 0, JSON.stringify(r));
    assertEquals(r.filesScanned, 1);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test('scanProject: empty @theme flags every custom token', async () => {
  const { root, cssPath } = await buildFixture({
    'index.css': `@theme {\n}\n`,
    'app.tsx': `<div className="text-text bg-surface text-primary">x</div>`,
  });
  try {
    const r = await scanProject(root, cssPath);
    // All 3 custom suffixes should flag
    assertEquals(r.violations.length, 3, JSON.stringify(r));
    const suffixes = r.violations.map((v) => v.suffix).sort();
    assertEquals(suffixes, ['primary', 'surface', 'text']);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test('scanProject: defined-token usages all pass', async () => {
  const { root, cssPath } = await buildFixture({
    'index.css': SAMPLE_CSS,
    'app.tsx': `
      <div className="text-text text-text-secondary bg-surface text-primary">
        <span className="shadow-hero rounded-card text-heading">y</span>
      </div>
    `,
  });
  try {
    const r = await scanProject(root, cssPath);
    assertEquals(r.violations.length, 0, JSON.stringify(r.violations));
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});
