// eslint.config.js
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactPlugin from 'eslint-plugin-react';
import reactHooksPlugin from 'eslint-plugin-react-hooks';
import reactRefreshPlugin from 'eslint-plugin-react-refresh';
import jsxA11yPlugin from 'eslint-plugin-jsx-a11y';
import importXPlugin from 'eslint-plugin-import-x';
import { defineConfig } from 'eslint/config';

export default defineConfig([
  // Global ignores
  { ignores: ['dist/**', 'node_modules/**', 'coverage/**', 'playwright-report/**', 'test-results/**'] },

  // Base JS + TS recommended
  js.configs.recommended,
  ...tseslint.configs.recommended,

  // React + hooks + refresh + a11y + import ordering
  {
    files: ['src/**/*.{ts,tsx}'],
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

  // Test files: relax some rules (will execute when Plan 04 wires Vitest)
  // Also disable typed linting (project-based TS rules) for test files since
  // tsconfig.app.json explicitly excludes *.test.{ts,tsx}.
  // Disable import-x/no-unresolved for test files because vitest/@testing-library
  // packages are not installed until Plan 04.
  {
    files: ['src/**/*.test.{ts,tsx}', 'e2e/**/*.{ts,tsx}', 'src/test-setup.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      'react-refresh/only-export-components': 'off',
      'import-x/no-unresolved': 'off',
    },
    languageOptions: {
      parserOptions: {
        project: null,  // disable typed linting for test files
      },
    },
  },
]);
