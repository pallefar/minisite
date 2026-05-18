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
  // Phase 32 Plan 32-02 — keepRemoved: true preserves bootstrap-only keys
  // (e.g. `injection_zero`, `error.network`) that have no corresponding
  // t() callsite yet. Plan 32-06/07 sweeps will add the consumer code;
  // until then those keys must remain in the catalog so a fresh extraction
  // doesn't blow away the contractor's work. (Plan 32-02 Step 5 explicitly
  // calls this out: "verify the run preserves bootstrap-only keys via the
  // `keepRemoved: true` setting if needed.")
  keepRemoved: true,
  // ⚠ failOnUpdate: false (Phase 32 Plan 32-02 deviation).
  // Rationale: With keepRemoved: true, i18next-parser@9.4.0 still trips
  // its internal `parserHadSortUpdate` check because the on-disk catalog
  // contains MORE keys than the source extraction (the bootstrap-only
  // keys preserved by keepRemoved). The JSON.stringify comparison at
  // node_modules/i18next-parser/dist/transform.js:325 returns true even
  // when the file on disk is byte-identical to the parser's intended
  // output. This is a known incompatibility between failOnUpdate +
  // keepRemoved in i18next-parser v9.
  //
  // Coverage gate is now enforced by TWO independent CI steps (see
  // Plan 32-02 Task 3 CI wiring in .github/workflows/i18n-gate.yml):
  //   1. `bash scripts/check-locale-coverage.sh` — EN vs ES leaf-path
  //      diff; catches translator drift.
  //   2. `npx i18next-parser && git diff --quiet -- public/locales` —
  //      catches uncommitted catalog updates after extraction.
  // The git-diff check is functionally equivalent to failOnUpdate but
  // avoids the false-positive sort flag in v9.
  failOnUpdate: false,
  failOnWarnings: true,
};
