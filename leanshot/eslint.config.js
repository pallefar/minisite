// eslint.config.js
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactPlugin from 'eslint-plugin-react';
import reactHooksPlugin from 'eslint-plugin-react-hooks';
import reactRefreshPlugin from 'eslint-plugin-react-refresh';
import jsxA11yPlugin from 'eslint-plugin-jsx-a11y';
import importXPlugin from 'eslint-plugin-import-x';
import i18nextPlugin from 'eslint-plugin-i18next';
import { defineConfig } from 'eslint/config';
// Phase 24 Plan 24-02 — additive-only event registry enforcement (D-10/TAXO-06)
// Phase 28 Plan 28-02 — no-raw-service-role-client (D-06 / ADDENDUM A6)
// Rules are .cjs (CommonJS) because the package is ESM but ESLint rules use CJS module.exports.
import { createRequire } from 'node:module';
const _require = createRequire(import.meta.url);
const additiveOnlyEventsRule = _require('./eslint-rules/additive-only-events.cjs');
const noRawServiceRoleClientRule = _require('./eslint-rules/no-raw-service-role-client.cjs');
// Phase 42 Plan 42-07 — no-conditional-native-review (D-20).
// Folds P36 (review-prompt) + P42 (quarterly NPS) instruments under one rule.
const noConditionalNativeReviewRule = _require('./eslint-rules/no-conditional-native-review.cjs');
// Phase 39 Plan 39-02 — no-paywall-on-safety-category (D-06 layer 1 of 3).
// D-05 enumerates 5 safety-info categories that must never sit behind a paywall.
const noPaywallOnSafetyCategoryRule = _require('./eslint-rules/no-paywall-on-safety-category.cjs');
// Phase 55 Plan 55-01 — no-health-in-ad-context (HEALTH-04/HEALTH-08 — Layer 1 of 3).
// Apple §5.1.3: ad/marketing/analytics/affiliate files must never import health.ts.
// Additive rule — Phase 12 import-x zones remain unchanged; this adds a NAMED, individually testable layer.
const noHealthInAdContextRule = _require('./eslint-rules/no-health-in-ad-context.cjs');

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
        // Phase 32 Plan 32-07 (I18N-10) — block physical CSS properties in raw CSS
        // strings (e.g. inline `style="margin-left: 1rem"`) and inline-style camelCase
        // (e.g. `style={{ marginLeft: 4 }}`). Tailwind class strings are not caught by
        // the AST rule — those are enforced by scripts/check-css-logical-properties.sh
        // wired into CI. Together they form the I18N-10 RTL-prep gate.
        {
          selector: "Literal[value=/(margin|padding|border)-(left|right)\\s*:/]",
          message:
            'Use logical CSS properties (margin-inline-start, padding-inline-end, etc.) per Phase 32 I18N-10 (RTL prep for v1.5). See scripts/check-css-logical-properties.sh for the full mapping table.',
        },
        {
          selector: "Property[key.name=/^(marginLeft|marginRight|paddingLeft|paddingRight|borderLeft|borderRight)$/]",
          message:
            'Use logical CSS inline-style props (marginInlineStart, paddingInlineEnd, borderInlineEnd, etc.) per Phase 32 I18N-10. Direct camelCase physical properties block RTL.',
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

  // Phase 42 Plan 42-07 — D-20: no-conditional-native-review enforcement.
  // Native review prompts (P36) and quarterly NPS modal (P42) must fire
  // UNCONDITIONALLY at the call site. The rule walks ancestors of each matched
  // CallExpression up to the enclosing function/program node; any IfStatement,
  // ConditionalExpression, LogicalExpression, or SwitchCase ancestor reports
  // 'conditionalSurface'.
  //
  // Scoped to leanshot/src/**/*.{ts,tsx} per the plan's D-20 surface boundary.
  // Test files exempt — fixtures and assertions legitimately need conditionals.
  {
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/**/*.test.{ts,tsx}', 'src/test/**/*.{ts,tsx}', 'src/test-setup.ts'],
    plugins: {
      'leanshot-nps': { rules: { 'no-conditional-native-review': noConditionalNativeReviewRule } },
    },
    rules: {
      'leanshot-nps/no-conditional-native-review': 'error',
    },
  },

  // Phase 39 Plan 39-02 — D-06 layer 1 of 3: no-paywall-on-safety-category enforcement.
  // Detects any Paywall* JSX component (Paywall, PaywallGate, PaywallModal) whose
  // subtree references `safety_category`. D-05 enumerates 5 categories that must
  // never sit behind a paywall (overdose-warning, contraindication-alert,
  // fda-black-box, serious-adverse-event-signal, pregnancy-lactation-contraindication).
  // Test files exempt — fixtures legitimately exercise both sides of the gate.
  {
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/**/*.test.{ts,tsx}', 'src/test/**/*.{ts,tsx}', 'src/test-setup.ts'],
    plugins: {
      'leanshot-pharma': { rules: { 'no-paywall-on-safety-category': noPaywallOnSafetyCategoryRule } },
    },
    rules: {
      'leanshot-pharma/no-paywall-on-safety-category': 'error',
    },
  },

  // Phase 55 Plan 55-01 — HEALTH-04/HEALTH-08 Layer 1 of 3: no-health-in-ad-context enforcement.
  // Detects any ImportDeclaration in an ad/marketing/analytics/affiliate file (or *.ad-eligible.ts)
  // whose source matches native/health. Reports crossImport so ESLint CI fails on the violation.
  // This is ADDITIVE to the existing Phase 12 import-x/no-restricted-paths zones (Blocks A–C above).
  // The Phase 12 zones block at directory level; this named custom rule adds an INDIVIDUALLY
  // IDENTIFIABLE, per-file enforcement layer required for HEALTH-08 provability.
  // Test files exempt — fixtures legitimately exercise both sides of the gate.
  {
    files: [
      'src/lib/ads/**/*.{ts,tsx}',
      'src/lib/analytics/**/*.{ts,tsx}',
      'src/lib/marketing/**/*.{ts,tsx}',
      'src/lib/affiliate/**/*.{ts,tsx}',
      'src/lib/native/ads*.ts',
      'src/lib/watch/**/*.{ts,tsx}',
      'src/**/*.ad-eligible.ts',
    ],
    ignores: ['src/**/*.test.{ts,tsx}', 'src/test/**/*.{ts,tsx}', 'src/test-setup.ts'],
    plugins: {
      'leanshot-health': { rules: { 'no-health-in-ad-context': noHealthInAdContextRule } },
    },
    rules: {
      'leanshot-health/no-health-in-ad-context': 'error',
    },
  },

  // Phase 36 Plan 36-01 — V13-3 BLOCKER bundle-isolation zones (Pitfall 6).
  // Per [[reference_eslint_import_x_path_gotcha]]: use GLOB targets, NOT bare
  // file paths — bare file paths silently no-op in import-x/no-restricted-paths.
  //
  // Zones:
  //   (1) src/components/nps/** must NOT import src/admin/** (consumer modal
  //       cannot pull admin bundle code — bundle ceiling).
  //   (2) src/components/nps/** must NOT import src/lib/admin/** (same — admin
  //       module manifest + cohort builder).
  //
  // V13-3 compliance: the native-review shim is the inverse of this fence —
  // the hook IS wired UNCONDITIONALLY at the trigger-event handler layer, NOT
  // from inside the consumer modal (CONTEXT D-20). So we do NOT also block
  // NPS components from importing `src/lib/native/review-shim.ts` here —
  // because in v1.3 the consumer modal never imports the shim (the hook
  // wiring lives elsewhere). If a future plan adds shim wiring on the modal
  // surface, the no-conditional-native-review AST rule above + the
  // D-04 grep gate (scripts/check-no-conditional-native-review.sh) catch the
  // regression.
  {
    files: ['src/**/*.{ts,tsx}'],
    plugins: { 'import-x': importXPlugin },
    rules: {
      'import-x/no-restricted-paths': ['error', {
        zones: [
          {
            target: './src/components/nps/**',
            from: './src/admin/**',
            message: 'V13-3 BLOCKER (Phase 36 Pitfall 6): NPS consumer modal must not import admin code (bundle budget + isolation). See 36-CONTEXT.md.',
          },
          {
            target: './src/components/nps/**',
            from: './src/lib/admin/**',
            message: 'V13-3 BLOCKER (Phase 36 Pitfall 6): NPS consumer modal must not import lib/admin code (bundle budget + isolation). See 36-CONTEXT.md.',
          },
        ],
      }],
    },
  },

  // Phase 28 Plan 28-02 — D-06 / ADDENDUM A6: no-raw-service-role-client enforcement.
  // Blocks createClient(..., SERVICE_ROLE_KEY) outside supabase/functions/_shared/supabase-server.ts.
  // Rule file is .cjs per ADDENDUM A6 (package.json "type":"module" → ESLint rules must use .cjs).
  // Applies to src/ non-test files and ../shared/ (browser bundle zones).
  // Test files legitimately use service-role clients in integration tests — excluded here.
  // The supabase/functions/ directory is NOT linted by eslint (Deno runtime); the rule allowlist handles
  // the one authorized exception in supabase-server.ts if the rule is ever run against that path.
  {
    files: ['src/**/*.{ts,tsx}', '../shared/**/*.ts'],
    ignores: ['src/**/*.test.{ts,tsx}', 'src/test/**/*.{ts,tsx}', 'src/test-setup.ts'],
    plugins: {
      leanshot: { rules: { 'no-raw-service-role-client': noRawServiceRoleClientRule } },
    },
    rules: {
      'leanshot/no-raw-service-role-client': 'error',
    },
  },

  // Phase 32 Plan 32-02 — D-06 i18n literal-string guard.
  //
  // Rationale: prevents future raw JSX text additions to surfaces that have
  // already been wrapped to useTranslation(). The rule uses
  // `mode: 'jsx-text-only'` (per 32-RESEARCH Pitfall 2 — avoids false
  // positives on `className`, `aria-*`, `data-*`, and other non-visible
  // string props).
  //
  // ⚠ Scope discipline (Plan 32-02 deferred-items.md):
  // Plan 32-02 ships an MVP wrap covering the `nav` + `common` namespaces
  // (layout components + i18n/* + GreetingStrip). The other 6 namespaces
  // (patient, onboarding, kb, admin, clinic, settings) and their owning
  // component trees are wrapped IN STAGES by Plan 32-06 (contractor
  // workflow) + Plan 32-07 (ship-gate sweep). Until those plans land we
  // scope the strict rule to the wrapped directories ONLY — applying the
  // rule globally today would emit hundreds of errors and exceed the
  // baseline lint count (84 per project_lint_debt_import_x_order.md).
  //
  // As new component trees are wrapped (Plan 32-06+07), add their
  // directory to `files` below. The final ship-state is
  // `files: ['src/components/**/*.{ts,tsx}']` with zero `ignores`.
  //
  // Ignore patterns:
  //   - src/lib/i18n/** — the runtime itself embeds key literals (allowed)
  //   - src/lib/analytics/events*.ts — event-name strings are not user copy
  //   - src/illustrations/** — inline SVG strings
  //   - test files — exempt globally
  {
    files: [
      'src/components/layout/**/*.{ts,tsx}',
      'src/components/i18n/**/*.{ts,tsx}',
    ],
    ignores: [
      'src/**/*.test.{ts,tsx}',
      'src/test/**/*.{ts,tsx}',
      'src/test-setup.ts',
      'src/lib/i18n/**',
      'src/lib/analytics/events*.ts',
      'src/illustrations/**',
    ],
    plugins: { i18next: i18nextPlugin },
    rules: {
      'i18next/no-literal-string': [
        'error',
        {
          mode: 'jsx-text-only',
          // Brand names per D-11 stay HARDCODED — exclude common brand words.
          // Per-line `eslint-disable-next-line i18next/no-literal-string` with
          // a "// brand name — see D-11" comment is also acceptable.
          words: { exclude: ['LeanShot', 'Ozempic', 'Wegovy', 'Mounjaro', 'Zepbound'] },
        },
      ],
    },
  },
]);
