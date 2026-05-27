/**
 * Phase 67 Plan 67-03 — tests for scripts/ci/check-sentry-imports.ts.
 *
 * Runtime: Deno (NOT Vitest). Run via:
 *
 *   deno test --no-check --allow-read --allow-write --allow-env scripts/ci/check-sentry-imports.test.ts
 *
 * Coverage:
 *   1. Real `@sentry/*` direct import in a Fn → counted as realImports.
 *   2. Re-export wrapper that calls `SentryNode.captureException(...)` → real.
 *   3. Re-export wrapper that's a no-op shim (empty export) → stubImports.
 *   4. Fn with `// SENTRY-DISABLED: <reason>` header → allowListed (NOT scanned).
 *   5. Fn with no Sentry import → not in any list (only counts toward fnsScanned).
 *   6. `classifyModuleSource` — direct unit assertions on real vs. stub source.
 */

import { assertEquals, assert } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { join } from 'https://deno.land/std@0.224.0/path/mod.ts';
import { scanFunctions, classifyModuleSource } from './check-sentry-imports.ts';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Build a throwaway `functions/` tree on disk, return its root path. */
async function buildFixture(
  fns: Record<string, Record<string, string>>,
): Promise<string> {
  const root = await Deno.makeTempDir({ prefix: 'sentry-check-' });
  for (const [fn, files] of Object.entries(fns)) {
    const fnDir = join(root, fn);
    await Deno.mkdir(fnDir, { recursive: true });
    for (const [file, content] of Object.entries(files)) {
      const filePath = join(fnDir, file);
      // Ensure intermediate dirs exist for nested file paths.
      const lastSlash = filePath.lastIndexOf('/');
      if (lastSlash > -1) {
        await Deno.mkdir(filePath.slice(0, lastSlash), { recursive: true });
      }
      await Deno.writeTextFile(filePath, content);
    }
  }
  return root;
}

const REAL_WRAPPER_SRC = `
import * as SentryNode from 'npm:@sentry/node@8';
let _initialized = false;
export function captureException(err: unknown) {
  if (!_initialized) {
    SentryNode.init({ dsn: Deno.env.get('SENTRY_DSN') });
    _initialized = true;
  }
  SentryNode.captureException(err);
}
`;

const STUB_WRAPPER_SRC = `
// No-op shim — used to be a placeholder in early dev.
export default {};
`;

// ─── Tests ───────────────────────────────────────────────────────────────────

Deno.test('real direct @sentry/* import counts as real', async () => {
  const root = await buildFixture({
    'fn-real-direct': {
      'index.ts': `import * as Sentry from 'npm:@sentry/node@8';\nSentry.init({});\n`,
    },
  });
  try {
    const r = await scanFunctions(root);
    assertEquals(r.fnsScanned, 1);
    assertEquals(r.realImports.length, 1);
    assertEquals(r.realImports[0].fn, 'fn-real-direct');
    assertEquals(r.stubImports.length, 0);
    assertEquals(r.allowListed.length, 0);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test('_shared/sentry wrapper with real SentryNode calls counts as real', async () => {
  const root = await buildFixture({
    _shared: { 'sentry.ts': REAL_WRAPPER_SRC },
    'fn-via-wrapper': {
      'index.ts': `import { captureException } from '../_shared/sentry.ts';\ncaptureException(new Error('x'));\n`,
    },
  });
  try {
    const r = await scanFunctions(root);
    // `_shared` is skipped from the Fn scan but still resolvable as wrapper target.
    assertEquals(r.fnsScanned, 1);
    assertEquals(r.realImports.length, 1, JSON.stringify(r));
    assertEquals(r.realImports[0].fn, 'fn-via-wrapper');
    assertEquals(r.stubImports.length, 0);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test('_shared/sentry no-op shim wrapper triggers stubImports', async () => {
  const root = await buildFixture({
    _shared: { 'sentry.ts': STUB_WRAPPER_SRC },
    'fn-via-stub': {
      'index.ts': `import sentry from '../_shared/sentry.ts';\nconsole.log(sentry);\n`,
    },
  });
  try {
    const r = await scanFunctions(root);
    assertEquals(r.fnsScanned, 1);
    assertEquals(r.stubImports.length, 1, JSON.stringify(r));
    assertEquals(r.stubImports[0].fn, 'fn-via-stub');
    assert(r.stubImports[0].reason.length > 0);
    assertEquals(r.realImports.length, 0);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test('SENTRY-DISABLED header excludes Fn from scan', async () => {
  const root = await buildFixture({
    _shared: { 'sentry.ts': STUB_WRAPPER_SRC },
    'fn-allow-listed': {
      'index.ts': `// SENTRY-DISABLED: cron-only no error-path needed\nimport sentry from '../_shared/sentry.ts';\n`,
    },
  });
  try {
    const r = await scanFunctions(root);
    assertEquals(r.allowListed.length, 1);
    assertEquals(r.allowListed[0].fn, 'fn-allow-listed');
    assertEquals(r.allowListed[0].reason, 'cron-only no error-path needed');
    assertEquals(r.stubImports.length, 0);
    assertEquals(r.realImports.length, 0);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test('Fn with no Sentry import is silent (counts only toward fnsScanned)', async () => {
  const root = await buildFixture({
    'fn-no-sentry': {
      'index.ts': `export function handler() { return new Response('ok'); }\n`,
    },
  });
  try {
    const r = await scanFunctions(root);
    assertEquals(r.fnsScanned, 1);
    assertEquals(r.realImports.length, 0);
    assertEquals(r.stubImports.length, 0);
    assertEquals(r.allowListed.length, 0);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test('classifyModuleSource: real wrapper with SentryNode call', () => {
  const { isStub } = classifyModuleSource(REAL_WRAPPER_SRC);
  assertEquals(isStub, false);
});

Deno.test('classifyModuleSource: empty default export is a stub', () => {
  const { isStub, reason } = classifyModuleSource(STUB_WRAPPER_SRC);
  assertEquals(isStub, true);
  assert(reason && reason.length > 0);
});

Deno.test('classifyModuleSource: module with no markers + no stub pattern is a stub (defensive)', () => {
  const src = `export const noop = 'string-only';\n`;
  const { isStub } = classifyModuleSource(src);
  assertEquals(isStub, true);
});
