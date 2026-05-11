---
slug: add-dist-marketing-to-eslint-ignores
date: 2026-05-11
quick_id: 260511-khr
status: planned
---

# Quick Task: Add `dist-marketing/**` to ESLint ignores

## Description

Follow-up surfaced by the Phase 3 code review: `npx eslint .` reports ~1378 errors from the built marketing bundle under `dist-marketing/` because the ESLint flat config only ignores `dist/**`. The marketing pipeline emits a separate `dist-marketing/` directory (see `vite.marketing.config.ts` + `.gitignore`), and minified build output should never be linted.

The current `npm run lint` script scopes to `src` so it stays clean, but editor integrations and `npx eslint .` invocations still see the noise.

## Change

`eslint.config.js:13` — extend the global `ignores` array:

```js
{ ignores: ['dist/**', 'dist-marketing/**', 'node_modules/**', 'coverage/**', 'playwright-report/**', 'test-results/**'] },
```

## Verification

- `npx eslint .` exits with the same 4 src warnings as `npm run lint` (no `dist-marketing/` entries)
- `npm run lint` output unchanged (still 0 errors, 4 warnings)

## Files

- `eslint.config.js` (1 line modified)
