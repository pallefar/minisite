/**
 * Phase 60 eval harness — CLI suite flag parser.
 *
 * Parses `--suite=<name>` and `--strict` from process.argv.
 * Vitest forwards CLI args after `--` to the test environment.
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

function parseArgv(): { suite: string; strict: boolean } {
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

const _parsed = parseArgv();

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

/**
 * Returns the suite name from `--suite=<name>` CLI flag, or `'all'` if not set.
 */
export function currentSuite(): string {
  return _parsed.suite;
}

/**
 * Returns true if `--strict` flag was passed on the CLI.
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
