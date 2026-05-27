/**
 * Phase 69 Plan 69-01 — tests for scripts/ci/check-accent-reserved.ts (DS-03).
 *
 * Runtime: Deno.
 *
 *   deno test --no-check --allow-read --allow-write --allow-env scripts/ci/check-accent-reserved.test.ts
 */

import { assertEquals, assert } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { join } from 'https://deno.land/std@0.224.0/path/mod.ts';
import {
  globToRegExp,
  scanSource,
  scanProject,
  loadAllowList,
} from './check-accent-reserved.ts';

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function buildFixture(files: Record<string, string>): Promise<string> {
  const root = await Deno.makeTempDir({ prefix: 'accent-' });
  for (const [rel, content] of Object.entries(files)) {
    const filePath = join(root, rel);
    const lastSlash = filePath.lastIndexOf('/');
    if (lastSlash > -1) await Deno.mkdir(filePath.slice(0, lastSlash), { recursive: true });
    await Deno.writeTextFile(filePath, content);
  }
  return root;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

Deno.test('globToRegExp: ** matches any number of segments', () => {
  const re = globToRegExp('**/components/ui/Button.tsx');
  assert(re.test('leanshot/src/components/ui/Button.tsx'));
  assert(re.test('src/components/ui/Button.tsx'));
  assert(!re.test('Button.tsx'));
  assert(!re.test('leanshot/src/components/ui/Other.tsx'));
});

Deno.test('globToRegExp: marketing/Landing.tsx matches at any depth', () => {
  const re = globToRegExp('**/marketing/Landing.tsx');
  assert(re.test('leanshot/src/components/marketing/Landing.tsx'));
  assert(!re.test('leanshot/src/components/marketing/Hero.tsx'));
});

Deno.test('scanSource: text-primary in className context flagged', () => {
  const src = `<div className="text-primary bg-accent">Hi</div>`;
  const hits = scanSource(src);
  // Should find text-primary AND bg-accent
  assertEquals(hits.length, 2, JSON.stringify(hits));
  const classes = hits.map((h) => h.className).sort();
  assertEquals(classes, ['bg-accent', 'text-primary']);
});

Deno.test("scanSource: TypeScript enum 'primary' literal NOT flagged (no className context)", () => {
  const src = `const tier: 'primary' | 'secondary' = 'primary';`;
  const hits = scanSource(src);
  assertEquals(hits.length, 0);
});

Deno.test('scanSource: text-text-primary NOT treated as accent (DS-01 owns it)', () => {
  const src = `<div className="text-text-primary">x</div>`;
  const hits = scanSource(src);
  // text-text-primary should NOT match because the regex requires the accent
  // token name directly after `text-`, not after `text-text-`.
  assertEquals(hits.length, 0, JSON.stringify(hits));
});

Deno.test('scanSource: opacity modifier bg-primary/50 captured', () => {
  const src = `<div className="bg-primary/50">x</div>`;
  const hits = scanSource(src);
  assertEquals(hits.length, 1);
  assert(hits[0].className.includes('bg-primary'));
});

Deno.test('scanSource: -soft sub-modifier captured (bg-success-soft)', () => {
  const src = `<div className="bg-success-soft text-danger-foreground">x</div>`;
  const hits = scanSource(src);
  assertEquals(hits.length, 2);
});

Deno.test('scanProject: accent class in marketing/Landing.tsx FAILS (forbidden)', async () => {
  const root = await buildFixture({
    'src/components/marketing/Landing.tsx': `<div className="text-primary">accent decoration</div>`,
  });
  try {
    const r = await scanProject(join(root, 'src'));
    assertEquals(r.forbiddenViolations.length, 1, JSON.stringify(r));
    assertEquals(r.forbiddenViolations[0].className, 'text-primary');
    assertEquals(r.forbiddenViolations[0].forbiddenMatch, '**/marketing/Landing.tsx');
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test('scanProject: accent in components/ui/Button.tsx PASSES (reserved)', async () => {
  const root = await buildFixture({
    'src/components/ui/Button.tsx': `<button className="bg-primary text-primary-foreground">x</button>`,
  });
  try {
    const r = await scanProject(join(root, 'src'));
    assertEquals(r.newViolations.length, 0, JSON.stringify(r));
    assertEquals(r.reservedAllowed.length, 2);
    assertEquals(r.reservedAllowed[0].reservedMatch, '**/components/ui/Button.tsx');
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test('scanProject: accent in non-reserved + non-baseline file FAILS', async () => {
  const root = await buildFixture({
    'src/components/random/Widget.tsx': `<div className="text-success">ok</div>`,
  });
  try {
    const r = await scanProject(join(root, 'src'));
    assertEquals(r.newViolations.length, 1, JSON.stringify(r));
    assertEquals(r.newViolations[0].className, 'text-success');
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test('scanProject: baseline-listed file with accent is allowed', async () => {
  const root = await buildFixture({
    'src/components/random/Widget.tsx': `<div className="text-success">ok</div>`,
  });
  // The scanProject relPath uses relative(cwd, entry.path). Tests run from
  // git root so we precompute the expected key — using path traversal that
  // matches `relative(cwd, fixture/src/components/random/Widget.tsx)`.
  // Easiest: compute relative manually and pass that.
  const { relative } = await import('https://deno.land/std@0.224.0/path/mod.ts');
  const expectedRelPath = relative(Deno.cwd(), join(root, 'src', 'components', 'random', 'Widget.tsx'));
  const allow = new Set<string>([expectedRelPath]);
  try {
    const r = await scanProject(join(root, 'src'), allow);
    assertEquals(r.newViolations.length, 0, JSON.stringify(r));
    assertEquals(r.baselineAllowed.length, 1);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test('scanProject: file with no accent classes is silent', async () => {
  const root = await buildFixture({
    'src/components/random/Widget.tsx': `<div className="text-text bg-surface">ok</div>`,
  });
  try {
    const r = await scanProject(join(root, 'src'));
    assertEquals(r.newViolations.length, 0);
    assertEquals(r.reservedAllowed.length, 0);
    assertEquals(r.baselineAllowed.length, 0);
    assertEquals(r.forbiddenViolations.length, 0);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test('loadAllowList: skips comments and blank lines', async () => {
  const root = await Deno.makeTempDir({ prefix: 'baseline-' });
  const f = join(root, 'baseline.txt');
  await Deno.writeTextFile(f, '# header comment\n\nleanshot/src/a.tsx\nleanshot/src/b.tsx\n# another\n');
  try {
    const set = loadAllowList(f);
    assertEquals(set.size, 2);
    assert(set.has('leanshot/src/a.tsx'));
    assert(set.has('leanshot/src/b.tsx'));
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});
