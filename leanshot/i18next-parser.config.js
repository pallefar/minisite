/**
 * Phase 32 Plan 32-01 — i18next-parser config (D-06 coverage gate).
 *
 * Walks src/**\/*.{ts,tsx} and emits canonical EN keys into
 * public/locales/en/{namespace}.json. The companion ES catalog is
 * translator-fed; scripts/check-locale-coverage.sh diffs EN vs ES per
 * namespace and exits non-zero on mismatch (D-05 100% coverage gate).
 *
 * Path alias `@/*` is IRRELEVANT here — i18next-parser reads source files
 * directly via its own AST lexers; it does NOT resolve modules through
 * TypeScript or Vite. (32-RESEARCH Finding #4 lines 632-664.)
 *
 * failOnUpdate: true makes the parser exit non-zero in CI if any new key
 * would be added to the catalog (source has `t('new.key')` but catalog
 * doesn't list it). That IS the coverage gate — Plan 32-07 wires it into
 * GitHub Actions; this plan ships the config so 32-02's extraction sweep
 * can use it locally.
 */
export default {
  locales: ['en', 'es'],
  defaultNamespace: 'common',
  namespaceSeparator: ':',
  keySeparator: '.',
  pluralSeparator: '_',
  contextSeparator: '_',
  output: 'public/locales/$LOCALE/$NAMESPACE.json',
  input: ['src/**/*.{ts,tsx}', '!src/**/*.test.{ts,tsx}', '!src/**/__tests__/**'],
  lexers: {
    ts: ['JavascriptLexer'],
    tsx: [
      {
        lexer: 'JsxLexer',
        functions: ['t'],
        namespaceFunctions: ['useTranslation', 'withTranslation'],
        componentFunctions: ['Trans'],
        transKeepBasicHtmlNodesFor: ['br', 'strong', 'i', 'p'],
      },
    ],
  },
  sort: true,
  createOldCatalogs: false,
  // D-05 100% coverage gate. failOnUpdate exits non-zero if extraction
  // would add a new key (i.e. source has t('foo.bar') and the catalog
  // doesn't). Plan 32-07 wires this into GitHub Actions.
  failOnUpdate: true,
  failOnWarnings: true,
};
