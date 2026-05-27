/**
 * Phase 67 Plan 67-03 — OPS-04 SENTRY_DSN Edge Fn CI guard.
 *
 * Walks `supabase/functions/<fn>/` directories for `index.ts` + `handler.ts`
 * files. For every file that imports a `@sentry/*` symbol (directly or via the
 * `_shared/sentry.ts` re-export wrapper) we verify the resolved module is a
 * REAL SDK — not a no-op shim (e.g. `export default {}`, empty body, etc.).
 *
 * If any Fn imports `@sentry/*` whose resolved module is a stub, fail with the
 * Fn name. If no Edge Fn uses `@sentry/*` at all, exit 0 with an informational
 * message — the project hasn't wired Sentry into Edge Fns yet.
 *
 * ### Allow-list
 *
 * A Fn can opt out by adding a header comment of the form
 *
 *   // SENTRY-DISABLED: <reason>
 *
 * to its `index.ts`. The reason is informational and surfaces in the CI log.
 *
 * ### Runtime
 *
 * Deno only — uses `Deno.readTextFile`, `Deno.readDir`, `Deno.cwd`. Run via
 *
 *   deno run -A scripts/ci/check-sentry-imports.ts
 *
 * Exit codes:
 *   0  — all good (real imports OR no-Sentry-using Fns)
 *   1  — at least one Fn imports a stubbed `@sentry/*` module
 *   2  — script-internal error (e.g. functions dir missing)
 */

import { walk } from 'https://deno.land/std@0.224.0/fs/walk.ts';
import { join, relative, dirname, fromFileUrl } from 'https://deno.land/std@0.224.0/path/mod.ts';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface CheckResult {
  realImports: Array<{ fn: string; file: string; module: string }>;
  stubImports: Array<{ fn: string; file: string; module: string; reason: string }>;
  allowListed: Array<{ fn: string; reason: string }>;
  fnsScanned: number;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const SENTRY_IMPORT_RE = /from\s+['"]([^'"]*@sentry\/[^'"]+)['"]/g;
const SHARED_SENTRY_IMPORT_RE = /from\s+['"]([^'"]*\/_shared\/sentry(?:\.ts)?)['"]/g;
const ALLOW_LIST_HEADER_RE = /\/\/\s*SENTRY-DISABLED:\s*(.+)/;

// A module body is a stub if it contains NO real Sentry function calls
// (`init`, `captureException`, `captureMessage`, `addBreadcrumb`) and its
// exports are empty objects / no-op arrow funcs / etc. Heuristic — favours
// false-pass over false-fail because a real CI gate must not fire on the
// already-shipped `_shared/sentry.ts` (which is genuine).
const STUB_BODY_PATTERNS = [
  /export\s+default\s*\{\s*\}/,
  /module\.exports\s*=\s*\{\s*\}/,
  // export function captureException() {} — empty body
  /export\s+function\s+\w+\s*\([^)]*\)\s*:?\s*\w*\s*\{\s*\}/,
  // export const captureException = () => {}
  /export\s+const\s+\w+\s*=\s*\([^)]*\)\s*=>\s*\{?\s*\}?/,
];

// A module is REAL if it contains at least one of these — these are the
// imports/calls a real Sentry wrapper makes against the upstream SDK.
const REAL_BODY_MARKERS = [
  /from\s+['"]npm:@sentry\//,
  /from\s+['"]@sentry\//,
  /SentryNode\.(init|captureException|captureMessage|addBreadcrumb)/,
  /Sentry\.(init|captureException|captureMessage|addBreadcrumb)/,
];

// ─── Module resolution ───────────────────────────────────────────────────────

/**
 * Resolve a relative `_shared/sentry` import to an absolute path on disk.
 * Returns null if the file cannot be located.
 */
async function resolveSharedSentry(
  importingFile: string,
  importPath: string,
): Promise<string | null> {
  const importerDir = dirname(importingFile);
  const candidates = [
    join(importerDir, importPath),
    join(importerDir, importPath + '.ts'),
    join(importerDir, importPath + '.js'),
  ];
  for (const c of candidates) {
    try {
      const stat = await Deno.stat(c);
      if (stat.isFile) return c;
    } catch {
      // Try next candidate
    }
  }
  return null;
}

/**
 * Inspect a resolved module's source text to decide if it's a stub.
 * Returns `{ isStub: boolean, reason?: string }`.
 */
export function classifyModuleSource(source: string): { isStub: boolean; reason?: string } {
  // Strip line comments to avoid matching example code in JSDoc.
  const stripped = source
    .split('\n')
    .filter((l) => !l.trim().startsWith('*') && !l.trim().startsWith('//'))
    .join('\n');

  // If any real marker is present, it's a real module.
  for (const re of REAL_BODY_MARKERS) {
    if (re.test(stripped)) return { isStub: false };
  }

  // Otherwise look for explicit stub patterns.
  for (const re of STUB_BODY_PATTERNS) {
    if (re.test(stripped)) {
      return { isStub: true, reason: `matched stub pattern ${re.source}` };
    }
  }

  // No real markers + no obvious stub = ambiguous → call it a stub
  // (defensive — a real Sentry wrapper MUST call one of init/captureException/etc).
  return {
    isStub: true,
    reason: 'no @sentry SDK import or Sentry.* call found in module body',
  };
}

// ─── Main scan ───────────────────────────────────────────────────────────────

/**
 * Scan every `supabase/functions/<fn>/{index,handler}.ts` for Sentry usage.
 * Returns a structured result; caller decides exit code.
 *
 * @param functionsRoot Absolute path to `supabase/functions/`.
 */
export async function scanFunctions(functionsRoot: string): Promise<CheckResult> {
  const result: CheckResult = {
    realImports: [],
    stubImports: [],
    allowListed: [],
    fnsScanned: 0,
  };

  // Enumerate immediate sub-directories (one per Fn). Skip `_shared`, `tests`,
  // `__tests__`, `import_map.json` etc.
  const fns: string[] = [];
  for await (const entry of Deno.readDir(functionsRoot)) {
    if (!entry.isDirectory) continue;
    if (entry.name.startsWith('_') || entry.name.startsWith('__') || entry.name === 'tests') continue;
    fns.push(entry.name);
  }
  fns.sort();

  for (const fn of fns) {
    result.fnsScanned++;
    const fnDir = join(functionsRoot, fn);

    // Check allow-list header on index.ts.
    const indexPath = join(fnDir, 'index.ts');
    let indexSource: string | null = null;
    try {
      indexSource = await Deno.readTextFile(indexPath);
    } catch {
      // Fn dir has no index.ts — skip.
      continue;
    }

    const allowMatch = indexSource.match(ALLOW_LIST_HEADER_RE);
    if (allowMatch) {
      result.allowListed.push({ fn, reason: allowMatch[1].trim() });
      continue;
    }

    // Walk every .ts file in this Fn dir (handler.ts + sub-modules) and look
    // for Sentry imports. Limit depth to keep CI fast.
    for await (
      const entry of walk(fnDir, {
        exts: ['.ts'],
        skip: [/__tests__/, /\.test\.ts$/],
        maxDepth: 5,
      })
    ) {
      if (!entry.isFile) continue;
      const filePath = entry.path;
      let source: string;
      try {
        source = await Deno.readTextFile(filePath);
      } catch {
        continue;
      }

      // 1. Direct `@sentry/*` imports
      const direct = [...source.matchAll(SENTRY_IMPORT_RE)];
      for (const m of direct) {
        const modSpec = m[1];
        // Direct npm:@sentry/* or @sentry/* — these resolve to real upstream
        // SDKs (npm registry). We trust those by name; the stub risk is the
        // re-export wrapper, not the upstream package.
        result.realImports.push({
          fn,
          file: relative(functionsRoot, filePath),
          module: modSpec,
        });
      }

      // 2. Re-export via `_shared/sentry`
      const sharedMatches = [...source.matchAll(SHARED_SENTRY_IMPORT_RE)];
      for (const m of sharedMatches) {
        const resolved = await resolveSharedSentry(filePath, m[1]);
        if (!resolved) {
          // Importer claims to use the wrapper but it can't be found → stub.
          result.stubImports.push({
            fn,
            file: relative(functionsRoot, filePath),
            module: m[1],
            reason: 'imported module not found on disk',
          });
          continue;
        }
        const wrapperSource = await Deno.readTextFile(resolved);
        const { isStub, reason } = classifyModuleSource(wrapperSource);
        const relFile = relative(functionsRoot, filePath);
        if (isStub) {
          result.stubImports.push({
            fn,
            file: relFile,
            module: m[1],
            reason: reason ?? 'classified as stub',
          });
        } else {
          result.realImports.push({
            fn,
            file: relFile,
            module: m[1],
          });
        }
      }
    }
  }

  return result;
}

// ─── CLI ─────────────────────────────────────────────────────────────────────

function formatResult(r: CheckResult): string {
  const lines: string[] = [];
  lines.push(`Edge Fns scanned: ${r.fnsScanned}`);
  lines.push('');

  if (r.realImports.length > 0) {
    lines.push(`Verified-real Sentry imports (${r.realImports.length}):`);
    const uniqueByFn = new Map<string, Set<string>>();
    for (const it of r.realImports) {
      if (!uniqueByFn.has(it.fn)) uniqueByFn.set(it.fn, new Set());
      uniqueByFn.get(it.fn)!.add(it.module);
    }
    for (const [fn, mods] of [...uniqueByFn.entries()].sort()) {
      lines.push(`  ✓ ${fn} — ${[...mods].sort().join(', ')}`);
    }
    lines.push('');
  }

  if (r.allowListed.length > 0) {
    lines.push(`Allow-listed (SENTRY-DISABLED header) — ${r.allowListed.length}:`);
    for (const it of r.allowListed) {
      lines.push(`  • ${it.fn} — ${it.reason}`);
    }
    lines.push('');
  }

  if (r.stubImports.length > 0) {
    lines.push(`STUB IMPORTS — ${r.stubImports.length}:`);
    for (const it of r.stubImports) {
      lines.push(`  ✗ ${it.fn} (${it.file}) → ${it.module}`);
      lines.push(`      ${it.reason}`);
    }
    lines.push('');
  }

  if (r.realImports.length === 0 && r.stubImports.length === 0) {
    lines.push('No Sentry-using Edge Fns found — informational, no gate triggered.');
  }

  return lines.join('\n');
}

// Skip CLI invocation when imported as a module (Deno test).
if (import.meta.main) {
  const cwd = Deno.cwd();
  // Prefer `supabase/functions/` relative to cwd. If running from git root,
  // that's the right path; otherwise scripts can override via $FUNCTIONS_DIR.
  const overrideDir = Deno.env.get('FUNCTIONS_DIR');
  const functionsRoot = overrideDir ?? join(cwd, 'supabase', 'functions');

  try {
    const stat = await Deno.stat(functionsRoot);
    if (!stat.isDirectory) {
      console.error(`FATAL: ${functionsRoot} is not a directory`);
      Deno.exit(2);
    }
  } catch {
    console.error(`FATAL: ${functionsRoot} not found (cwd=${cwd}).`);
    console.error('       Run from git root, or set FUNCTIONS_DIR.');
    Deno.exit(2);
  }

  const result = await scanFunctions(functionsRoot);
  console.log(formatResult(result));

  if (result.stubImports.length > 0) {
    console.error('');
    console.error(`FAIL: ${result.stubImports.length} Edge Fn(s) import a stubbed @sentry/* module.`);
    console.error('       SENTRY_DSN protections do not apply when Sentry is a no-op shim.');
    Deno.exit(1);
  }

  console.log('');
  console.log('PASS: every Sentry import resolves to a real SDK.');
  Deno.exit(0);
}

// Silence unused import in module-mode.
export { fromFileUrl };
