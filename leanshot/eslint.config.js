// eslint.config.js
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactPlugin from 'eslint-plugin-react';
import reactHooksPlugin from 'eslint-plugin-react-hooks';
import reactRefreshPlugin from 'eslint-plugin-react-refresh';
import jsxA11yPlugin from 'eslint-plugin-jsx-a11y';
import importXPlugin from 'eslint-plugin-import-x';
import { defineConfig } from 'eslint/config';
// Phase 24 Plan 24-02 — additive-only event registry enforcement (D-10/TAXO-06)
// Rule is .cjs (CommonJS) because the package is ESM but ESLint rules use CJS module.exports.
import { createRequire } from 'node:module';
const _require = createRequire(import.meta.url);
const additiveOnlyEventsRule = _require('./eslint-rules/additive-only-events.cjs');

export default defineConfig([
  // Global ignores
  { ignores: ['dist/**', 'dist-marketing/**', 'node_modules/**', 'coverage/**', 'playwright-report/**', 'test-results/**'] },

  // Base JS + TS recommended
  js.configs.recommended,
  ...tseslint.configs.recommended,

  // React + hooks + refresh + a11y + import ordering
  // Phase 4 D-04: extend to `../shared/**/*.ts` so the dual-runtime shared/
  // module (refusal.ts, disclaimers.ts) is linted alongside src/. Per RESEARCH
  // §"Pitfall 10" the repo-root shared/ directory lives one level UP from the
  // `leanshot/` cwd that eslint runs from; the relative glob resolves correctly.
  {
    files: ['src/**/*.{ts,tsx}', '../shared/**/*.ts'],
    plugins: {
      react: reactPlugin,
      'react-hooks': reactHooksPlugin,
      'react-refresh': reactRefreshPlugin,
      'jsx-a11y': jsxA11yPlugin,
      'import-x': importXPlugin,
    },
    settings: {
      react: { version: 'detect' },
      'import-x/resolver': {
        typescript: { project: './tsconfig.app.json' },
      },
    },
    rules: {
      // React rules
      ...reactPlugin.configs.flat.recommended.rules,
      'react/react-in-jsx-scope': 'off',  // React 19 automatic JSX runtime
      'react/prop-types': 'off',          // TypeScript handles this

      // React hooks — traditional rules only (D-02).
      // react-hooks@7.1.1 ships new React Compiler-era rules (purity,
      // set-state-in-effect, static-components, etc.) that are experimental
      // and flag common, valid patterns in the existing codebase.
      // We enable the proven rules explicitly and leave the new strict
      // rules off so `npm run lint` exits 0 from day one.
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      // NOTE: BaseChart.tsx has a legitimate 2-effect Chart.js pattern.
      // The eslint-disable-next-line comment there is a documented exception
      // (see RESEARCH.md Pattern 8 / CONTEXT.md D-01).

      // React Refresh (Vite HMR)
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],

      // Accessibility — non-negotiable per PROJECT.md (D-02)
      ...jsxA11yPlugin.configs.recommended.rules,

      // Import ordering
      'import-x/order': ['error', {
        groups: ['builtin', 'external', 'internal', 'parent', 'sibling', 'index'],
        'newlines-between': 'never',
        alphabetize: { order: 'asc', caseInsensitive: true },
      }],
      'import-x/no-unresolved': 'error',

      // TypeScript — avoid duplicating tsconfig enforcement
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],

      // useStore(<deriver>) and useStore((s) => <deriver>(s)) produce a fresh
      // object/array each call, so Zustand v5's useSyncExternalStore snapshot
      // is unstable and React aborts with "Maximum update depth exceeded."
      // The fix is per-slice selectors + useMemo over the deriver. Three
      // distinct sites have hit this (FocusCard, InsightsTab, HomeTab); this
      // rule keeps new ones from sneaking in.
      'no-restricted-syntax': [
        'error',
        {
          selector: "CallExpression[callee.name='useStore'] > Identifier[name=/^(pickFocus|generateInsights)$/]",
          message:
            'useStore(pickFocus|generateInsights) returns a fresh object/array each call — destabilizes the snapshot. Subscribe to slices and useMemo() the deriver instead.',
        },
        {
          selector: "CallExpression[callee.name='useStore'] CallExpression[callee.name=/^(pickFocus|generateInsights)$/]",
          message:
            'A useStore selector cannot invoke pickFocus|generateInsights — the returned value is a new reference each call. Subscribe to slices and useMemo() the deriver instead.',
        },
        // Phase 23 D-05 (DEBT-02 regression guard): ban *.user! non-null assertions.
        // The Phase 22/23 audit confirmed 0 occurrences in production code. This rule
        // prevents regression. Use early returns, typed guards (`if (!s.user) return null;`),
        // or Auth-required boundary components instead. See Phase 23 Plan 23-01 closeout.
        {
          selector: "TSNonNullExpression[expression.type='MemberExpression'][expression.property.name='user']",
          message:
            '`*.user!` non-null assertions are banned (project anti-pattern). Use early returns, typed guards (`if (!s.user) return null;`), or Auth-required boundary components instead. See `s.user!` audit closeout in Phase 23 (DEBT-02).',
        },
      ],
    },
    languageOptions: {
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
        ecmaFeatures: { jsx: true },
        project: './tsconfig.app.json',
      },
    },
  },

  // Phase 12 Two-tunnel firewall — health.ts is blocked from flowing into the ad-eligible bag (D-02).
  // The directory-zone rule covers buckets 1, 2a, 3, 4, 5, and Stripe metadata (6 zones);
  // the *.ad-eligible.ts glob and posthog*.ts wrappers glob are covered by separate
  // no-restricted-imports rules below. See .planning/phases/12-bootstrap-bundle-foundations/12-CONTEXT.md.

  // Block A: import-x/no-restricted-paths — six zone-based directory restrictions (D-02 buckets 1–6)
  {
    files: ['src/**/*.{ts,tsx}'],
    plugins: { 'import-x': importXPlugin },
    rules: {
      'import-x/no-restricted-paths': ['error', {
        zones: [
          // Zone 1 (ad transport): src/lib/native/ads*.ts must not import health.ts
          // NOTE: glob pattern is required here because the target is a file (ads.ts),
          // not a directory. When Phase 20 creates src/lib/native/ads/ as a directory,
          // change this target to './src/lib/native/ads' (directory match).
          {
            target: './src/lib/native/ads*.ts',
            from: './src/lib/native/health.ts',
            message: 'Two-tunnel firewall (Phase 12 D-02 Zone 1): health.ts must not flow into the ad transport. See 12-CONTEXT.md.',
          },
          // Zone 2a (analytics + posthog directory): src/lib/analytics/* must not import health.ts
          {
            target: './src/lib/analytics',
            from: './src/lib/native/health.ts',
            message: 'Two-tunnel firewall (Phase 12 D-02 Zone 2a): health.ts must not flow into analytics — PostHog distinctId leak path. See 12-CONTEXT.md.',
          },
          // Zone 3 (affiliate): src/lib/affiliate/* must not import health.ts
          {
            target: './src/lib/affiliate',
            from: './src/lib/native/health.ts',
            message: 'Two-tunnel firewall (Phase 12 D-02 Zone 3): health.ts must not reach affiliate-attribute Edge Function payloads. See 12-CONTEXT.md.',
          },
          // Zone 4 (ads bag): src/lib/ads/* must not import health.ts
          {
            target: './src/lib/ads',
            from: './src/lib/native/health.ts',
            message: 'Two-tunnel firewall (Phase 12 D-02 Zone 4): health.ts must not enter the ads module bag. See 12-CONTEXT.md.',
          },
          // Zone 5 (marketing): src/lib/marketing/* must not import health.ts
          {
            target: './src/lib/marketing',
            from: './src/lib/native/health.ts',
            message: 'Two-tunnel firewall (Phase 12 D-02 Zone 5): health.ts must not enter the marketing module bag. See 12-CONTEXT.md.',
          },
          // Zone 6 (Stripe metadata helpers — D-02 bucket 4 part 2):
          // Silently passing today (src/lib/stripe/ doesn't exist until Phase 14);
          // activates the moment Phase 14 creates the directory. Phase 14 plan-checker MUST verify.
          {
            target: './src/lib/stripe',
            from: './src/lib/native/health.ts',
            message: 'Two-tunnel firewall (Phase 12 D-02 Zone 6): health.ts must not reach Stripe metadata helpers (visible to Connect partners + ad-reconciliation tools). See 12-CONTEXT.md.',
          },
        ],
      }],
    },
  },

  // Block B: no-restricted-imports — *.ad-eligible.ts naming-convention glob (D-02 bucket 6)
  // import-x/no-restricted-paths cannot target globs; this separate rule covers the naming convention.
  {
    files: ['src/**/*.ad-eligible.ts'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [{
          group: ['*/native/health', '*/native/health.ts', '@/lib/native/health'],
          message: 'Two-tunnel firewall (Phase 12 D-02 supplement): *.ad-eligible.ts files must not import health.ts. See 12-CONTEXT.md.',
        }],
      }],
    },
  },

  // Block C: no-restricted-imports — posthog*.ts wrappers glob (D-02 Zone 2b)
  // Covers posthog wrapper files outside src/lib/analytics/ (e.g. src/lib/posthog-client.ts).
  // Activates when Phase 14/22 creates the wrapper file.
  {
    files: ['src/lib/posthog*.ts', 'src/**/posthog*.ts'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [{
          group: ['*/native/health', '*/native/health.ts', '@/lib/native/health'],
          message: 'Two-tunnel firewall (Phase 12 D-02 Zone 2b — PostHog wrappers): posthog*.ts files must not import health.ts. See 12-CONTEXT.md.',
        }],
      }],
    },
  },

  // Test files: relax some rules (will execute when Plan 04 wires Vitest)
  // Also disable typed linting (project-based TS rules) for test files since
  // tsconfig.app.json explicitly excludes *.test.{ts,tsx}.
  // Disable import-x/no-unresolved for test files because vitest/@testing-library
  // packages are not installed until Plan 04.
  {
    files: ['src/**/*.test.{ts,tsx}', 'src/test/**/*.{ts,tsx}', 'e2e/**/*.{ts,tsx}', 'src/test-setup.ts', '../shared/**/*.test.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      'react-refresh/only-export-components': 'off',
      'import-x/no-unresolved': 'off',
      // Test files may legitimately use `.user!` on Supabase admin responses and
      // test-assertion data where nullability is guaranteed by test setup.
      // The production-code ban (Phase 23 D-05 / DEBT-02) does not apply to tests.
      'no-restricted-syntax': 'off',
    },
    languageOptions: {
      parserOptions: {
        project: null,  // disable typed linting for test files
      },
    },
  },

  // Phase 24 Plan 24-02 — D-10/TAXO-06: additive-only event registry enforcement.
  // Custom rule reads `git show HEAD:src/lib/analytics/events.ts`, compares AST
  // payload shapes, and blocks payload field removal + type changes.
  {
    files: ['src/lib/analytics/events.ts'],
    plugins: {
      'leanshot-local': { rules: { 'additive-only-events': additiveOnlyEventsRule } },
    },
    rules: {
      'leanshot-local/additive-only-events': 'error',
    },
  },

  // Phase 24 Plan 24-02 — D-12: PHI event import zone restriction.
  // Blocks client zones from importing `events.phi.ts` (PHI events MUST originate
  // from Edge Functions via supabase/functions/_shared/posthog-server.ts).
  // Per [[reference_eslint_import_x_path_gotcha]]: use GLOB targets, not bare file paths.
  {
    files: ['src/**/*.{ts,tsx}'],
    plugins: { 'import-x': importXPlugin },
    rules: {
      'import-x/no-restricted-paths': ['error', {
        zones: [
          // Existing zones from Phase 12 Two-tunnel firewall are in a separate config block above.
          // This zone adds the PHI event fence on top.
          {
            target: [
              'src/components/**/*',
              'src/main.tsx',
              'src/App.tsx',
              'src/lib/!(analytics)/**/*',
              'src/illustrations/**/*',
              'src/hooks/**/*',
            ],
            from: 'src/lib/analytics/events.phi.ts',
            message: 'PHI events must originate from Edge Functions; route through supabase/functions/_shared/posthog-server.ts. See 24-CONTEXT.md D-12.',
          },
        ],
      }],
    },
  },
]);
