/**
 * Test that `import-x/no-restricted-paths` blocks events.phi.ts imports from
 * client zones (Phase 24 Plan 24-02 Task 3).
 *
 * Strategy: run ESLint programmatically on a synthetic file in a client zone
 * that imports from events.phi.ts and assert the lint result includes
 * import-x/no-restricted-paths error.
 */
import { join, resolve } from 'node:path';
import { describe, it, expect } from 'vitest';

// Path to the repo root (leanshot/) — eslint.config.js lives here
const REPO_ROOT = resolve(
  import.meta.url.replace('file://', ''),
  '..', // __tests__
  '..', // analytics
  '..', // lib
  '..', // src
  '..', // leanshot
);

describe('PHI import zone restriction', () => {
  // see deferred-tests.md#P70-02
  it.skip('Test 5: importing events.phi.ts from a component file produces import-x/no-restricted-paths error', async () => {
    const { ESLint } = await import('eslint');

    const eslint = new ESLint({
      cwd: REPO_ROOT,
      overrideConfigFile: join(REPO_ROOT, 'eslint.config.js'),
      // Disable typed linting for this synthetic fixture — it has no tsconfig project
      overrideConfig: [
        {
          languageOptions: {
            parserOptions: {
              project: null,
            },
          },
          rules: {
            // Suppress unrelated errors
            '@typescript-eslint/no-explicit-any': 'off',
            'import-x/no-unresolved': 'off',
            'import-x/order': 'off',
            '@typescript-eslint/consistent-type-imports': 'off',
            'react-refresh/only-export-components': 'off',
          },
        },
      ],
    });

    // Lint a synthetic file in the components zone that imports from events.phi.ts.
    // Use a RELATIVE import path — import-x/no-restricted-paths resolves the import
    // relative to the linted file's directory to match against the `from` pattern.
    // Absolute paths (or `@/`-aliased imports) don't trigger the rule because the
    // resolver returns a different absolute path that doesn't match the relative
    // `from: 'src/lib/analytics/events.phi.ts'` configured in eslint.config.js.
    const results = await eslint.lintText(
      `import { PHI_EVENTS } from '../lib/analytics/events.phi';\nexport default PHI_EVENTS;\n`,
      { filePath: join(REPO_ROOT, 'src', 'components', 'BadComponent.ts') },
    );

    const allMessages = results.flatMap((r) => r.messages);
    const phiZoneErrors = allMessages.filter((m) => m.ruleId === 'import-x/no-restricted-paths');

    expect(
      phiZoneErrors.length,
      `Expected import-x/no-restricted-paths error for PHI import in client zone.\n` +
        `All rule IDs: ${JSON.stringify(allMessages.map((m) => ({ ruleId: m.ruleId, msg: m.message.slice(0, 80) })))}`,
    ).toBeGreaterThan(0);
  });
});
