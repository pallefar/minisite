/**
 * Phase 60 eval harness — CLI suite flag parser.
 *
 * Resolves `--suite=<name>` from TWO sources (checked in order):
 *   1. `EVAL_SUITE` environment variable (takes precedence — works in Vitest workers)
 *   2. `--suite=<name>` in process.argv (fallback — works in direct node invocations)
 *
 * `--strict` is resolved from:
 *   1. `EVAL_STRICT=true` environment variable
 *   2. `--strict` flag in process.argv
 *
 * **Why env var takes precedence over process.argv:**
 * Vitest 4.x forks test workers and the worker's `process.argv` may not include
 * custom flags passed after `--`. Using `EVAL_SUITE=refusal npm run test:eval:phase60`
 * is the reliable cross-platform invocation pattern.
 *
 * Usage in test files:
 *   const SUITE = 'citation' as const;
 *   describe.skipIf(!shouldRunSuite(SUITE))('Dim #1 — ...', () => { ... });
 */

// ---------------------------------------------------------------------------
// Suite registry — canonical list per AI-SPEC §5 line 855 + plan outline
// ---------------------------------------------------------------------------

export const SUITE_NAMES = [
  'refusal',
  'citation',
  'safety',
  'kanon',
  'rerank-delta',
  'recall-mrr',
  'cost',
  'stale-drift',
  'tip-personalization',
  'contraindication',
  'tier-transparency',
  'fda-equivalence',
  'ai04-fence',
  'retrieval', // alias for recall-mrr per AI-SPEC §5 line 851
  'all',
] as const;

export type SuiteName = (typeof SUITE_NAMES)[number];

// ---------------------------------------------------------------------------
// Argument parsing (module-level, evaluated once per Vitest worker)
// ---------------------------------------------------------------------------

function parseFlags(): { suite: string; strict: boolean } {
  // 1. Check environment variables first (reliable in Vitest workers)
  const envSuite = process.env['EVAL_SUITE'];
  const envStrict = process.env['EVAL_STRICT'] === 'true';

  if (envSuite) {
    return { suite: envSuite, strict: envStrict };
  }

  // 2. Fall back to process.argv (works in direct node invocations)
  let suite = 'all';
  let strict = false;

  for (const arg of process.argv) {
    const suiteMatch = arg.match(/^--suite=(.+)$/);
    if (suiteMatch) {
      suite = suiteMatch[1];
    }
    if (arg === '--strict') {
      strict = true;
    }
  }

  return { suite, strict };
}

const _parsed = parseFlags();

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

/**
 * Returns the suite name from EVAL_SUITE env var or `--suite=<name>` CLI flag,
 * or `'all'` if not set.
 */
export function currentSuite(): string {
  return _parsed.suite;
}

/**
 * Returns true if EVAL_STRICT=true env var or `--strict` flag was provided.
 * In strict mode, any miss in the safety/refusal suite is a hard test failure.
 */
export function isStrict(): boolean {
  return _parsed.strict;
}

/**
 * Returns true if the given suite should run.
 *
 * Logic:
 * - `all` → always run
 * - `retrieval` → aliases to `recall-mrr`
 * - otherwise → exact match against currentSuite()
 *
 * Use as: `describe.skipIf(!shouldRunSuite(SUITE))('...', () => { ... })`
 */
export function shouldRunSuite(suiteName: string): boolean {
  const current = currentSuite();
  if (current === 'all') return true;

  // Handle retrieval ↔ recall-mrr alias
  const normalizedCurrent = current === 'retrieval' ? 'recall-mrr' : current;
  const normalizedTarget = suiteName === 'retrieval' ? 'recall-mrr' : suiteName;

  return normalizedCurrent === normalizedTarget;
}
