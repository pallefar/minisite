# Phase 1: Quality Gates & Observability Foundation - Pattern Map

**Mapped:** 2026-05-10
**Files analyzed:** 21 new/modified files
**Analogs found:** 18 / 21

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `eslint.config.js` | config | — | `vite.config.ts` | partial (same project config layer) |
| `.prettierrc` | config | — | `vite.config.ts` | partial |
| `vite.config.ts` (add test block) | config | — | `vite.config.ts` itself (extend) | self-extend |
| `playwright.config.ts` | config | — | `vite.config.ts` | partial |
| `.github/workflows/ci.yml` | config | — | no analog | none |
| `.env.example` | config | — | no analog | none |
| `src/test-setup.ts` | config | — | no analog | none |
| `src/lib/sentry.ts` | utility | transform | `src/lib/helpers.ts` | role-match |
| `src/lib/analytics.ts` | utility | event-driven | `src/lib/storage.ts` apiKeyStorage | role-match |
| `src/lib/helpers.test.ts` | test | — | `src/lib/helpers.ts` (subject) | source-module |
| `src/hooks/useStreaks.test.ts` | test | — | `src/hooks/useStreaks.ts` (subject) | source-module |
| `src/lib/storage.test.ts` | test | — | `src/lib/storage.ts` (subject) | source-module |
| `src/components/onboarding/OnboardingFlow.test.tsx` | test | — | `src/components/onboarding/OnboardingFlow.tsx` (subject) | source-module |
| `e2e/onboarding.spec.ts` | test | — | no existing e2e | none |
| `src/hooks/useConfirm.ts` | hook | request-response | `src/hooks/useReducedMotion.ts` | role-match |
| `src/main.tsx` (Sentry + PostHog wiring) | bootstrap | — | `src/main.tsx` itself (extend) | self-extend |
| `src/components/dashboard/settings/SettingsPage.tsx` (Dev Tools section) | component | — | same file existing sections | self-extend |
| `src/components/layout/Topbar.tsx` (as-never fix) | component | — | same file | self-extend |
| `src/components/dashboard/tabs/ActivityTab.tsx` (as-never fix) | component | — | same file | self-extend |
| `src/components/dashboard/tabs/BodyTab.tsx` (as-never fix) | component | — | same file | self-extend |
| `src/components/dashboard/tabs/HomeTab.tsx` + `src/lib/insights.ts` (as-never fix) | component + lib | — | same files | self-extend |
| `src/components/dashboard/charts/BaseChart.tsx` (as-never + eslint-disable fix) | component | — | same file | self-extend |
| `src/lib/ai.ts` (model ID fix) | utility | — | same file | self-extend |

---

## Pattern Assignments

### `src/lib/sentry.ts` (utility, transform)

**Analog:** `src/lib/helpers.ts` — pure module, single-purpose named exports, no React, no default export.

**Module shape pattern** (`src/lib/helpers.ts` lines 1–7):
```typescript
/**
 * Pure utility helpers — date, formatting, escape.
 * Ported from v1 (leanshot.html:3654-3672).
 */

export const todayStr = (): string => new Date().toISOString().slice(0, 10);
// ... more named exports
```

`sentry.ts` must follow the same structure: JSDoc header, named exports only, no default export, no React imports. The `beforeSend` function and the `REDACT_KEYS` constant are the two exports.

**Error/exception pattern** (`src/lib/storage.ts` lines 78–108):
```typescript
try {
  const raw = localStorage.getItem(LEGACY_KEY);
  if (!raw) return null;
  const v3 = JSON.parse(raw) as Record<string, unknown>;
  // ... work ...
} catch (e) {
  console.error('[leanshot] v3 migration failed', e);
  return null;
}
```

The `walkAndRedact` helper must guard against thrown exceptions when `JSON.parse` is called on breadcrumb data strings. Use the same try/catch-return-fallback pattern.

**Implementation (from RESEARCH.md Pattern 3):**
```typescript
// src/lib/sentry.ts
const REDACT_KEYS = new Set(['symptom', 'mood', 'note', 'aiHistory']);

function redactValue(key: string, value: unknown): unknown { ... }
function walkAndRedact(obj: Record<string, unknown>): Record<string, unknown> { ... }
export function beforeSend(event: import('@sentry/react').ErrorEvent): import('@sentry/react').ErrorEvent { ... }
```

---

### `src/lib/analytics.ts` (utility, event-driven)

**Analog:** `src/lib/storage.ts` — localStorage wrapper with try/catch, `SCREAMING_SNAKE_CASE` key constants, named exports only.

**localStorage try/catch pattern** (`src/lib/storage.ts` lines 111–133):
```typescript
export const apiKeyStorage = {
  get(): string | null {
    try {
      return localStorage.getItem(API_KEY_STORAGE);
    } catch {
      return null;
    }
  },
  set(key: string): void {
    try {
      localStorage.setItem(API_KEY_STORAGE, key);
    } catch (e) {
      console.error(e);
    }
  },
  clear(): void {
    try {
      localStorage.removeItem(API_KEY_STORAGE);
    } catch {
      /* noop */
    }
  },
};
```

The `getOrCreateDistinctId()` function must follow exactly this pattern — try/catch wrapping every localStorage call, catch returning a fallback value (`crypto.randomUUID()` for the ephemeral case).

**Constant naming** (`src/lib/storage.ts` lines 26–29):
```typescript
export const STORAGE_KEY = 'leanshot_v4';
export const LEGACY_KEY = 'leanshot_v3';
export const STORAGE_VERSION = 4;
export const API_KEY_STORAGE = 'leanshot_anthropic_key';
```

`analytics.ts` uses: `const DISTINCT_ID_KEY = 'leanshot_distinct_id';` — same SCREAMING_SNAKE_CASE, same `leanshot_` prefix convention.

**Implementation (from RESEARCH.md Pattern 4):**
```typescript
// src/lib/analytics.ts
export type EventName = 'onboarding_started' | 'onboarding_step_completed' | ...;
const DISTINCT_ID_KEY = 'leanshot_distinct_id';
function getOrCreateDistinctId(): string { try { ... } catch { return crypto.randomUUID(); } }
export function initAnalytics(): void { posthog.init(...); }
export function track(event: EventName, properties?: Record<string, string | number | boolean>): void { ... }
```

---

### `src/hooks/useConfirm.ts` (hook, request-response)

**Analog:** `src/hooks/useReducedMotion.ts` — hook file structure: JSDoc, named export with `use` prefix, `useState` + `useEffect`, returns a primitive/object.

**Hook structure pattern** (`src/hooks/useReducedMotion.ts` lines 1–23):
```typescript
import { useEffect, useState } from 'react';

/**
 * Reactive `prefers-reduced-motion` flag. ...
 */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState<boolean>(() => ...);

  useEffect(() => {
    // ...
    return () => { /* cleanup */ };
  }, []);

  return reduced;
}
```

`useConfirm.ts` must match: `useState`, `useCallback`, `useRef` from React, JSDoc header, named function export starting with `use`.

**Secondary analog — useToast.ts** (`src/hooks/useToast.ts` lines 1–9):
```typescript
import { useStore } from '@/lib/store';

/** Thin wrapper around the store's toast slice with auto-dismiss. */
export function useToast(): (message: string, kind?: 'success' | 'error' | 'info') => void {
  return (message, kind = 'success') => {
    useStore.getState().showToast(message, kind);
    setTimeout(() => useStore.getState().dismissToast(), 2400);
  };
}
```

`useConfirm` returns a similar "callable" function object. Confirm/cancel resolution uses `useRef` for the Promise resolve fn.

**Modal prop pattern** (`src/components/ui/Modal.tsx` lines 7–18):
```typescript
export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  hideClose?: boolean;
  children?: ReactNode;
}
```

The `ConfirmModal` wrapper that `useConfirm` renders must use these existing `Modal` props — `open`, `onClose`, `title`, `hideClose`, plus `Button` children for confirm/cancel. No new modal primitive.

---

### `src/main.tsx` — Sentry + PostHog wiring (bootstrap, extend)

**Current structure** (`src/main.tsx` lines 1–32):
```typescript
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './index.css';
import { hydrate } from './lib/store';
import { applyThemeToDOM } from './hooks/useTheme';
import type { Theme } from './types';

// 1) Apply saved/system theme — pre-paint, no flash
const initialTheme: Theme = ((): Theme => {
  try {
    const saved = localStorage.getItem('leanshot_theme_v4');
    if (saved === 'light' || saved === 'dark') return saved;
  } catch { /* noop */ }
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
})();
applyThemeToDOM(initialTheme);

// 2) Synchronously rehydrate Zustand BEFORE first render
void hydrate().then(() => {
  const root = createRoot(document.getElementById('root')!);
  root.render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
});
```

**Required insertion order (D-12, CONTEXT.md integration points):**
1. `Sentry.init(...)` — FIRST, before any other code block, capturing theme-read errors and hydration errors
2. Existing theme read + `applyThemeToDOM()`
3. Existing `await hydrate()`
4. `initAnalytics()` — AFTER hydrate so persisted `leanshot_distinct_id` is available
5. `createRoot().render(...)`

The `try { ... } catch { /* noop */ }` pattern wrapping localStorage reads is already established — Sentry init must fire BEFORE that block so any thrown error (however unlikely during `localStorage.getItem`) is captured.

---

### `src/components/dashboard/settings/SettingsPage.tsx` — Dev Tools section (component, extend)

**Existing section pattern** (`src/components/dashboard/settings/SettingsPage.tsx` lines 196–219):
```typescript
{section === 'data' && (
  <Section title="Data" body="Export, import, or wipe your record.">
    <Button variant="ghost" leadingIcon={<Download className="size-4" />} onClick={exportData}>
      Export JSON
    </Button>
    <Button variant="destructive" leadingIcon={<Trash2 className="size-4" />} onClick={reset}>
      Reset everything
    </Button>
  </Section>
)}
```

**`Section` component signature** (lines 226–235):
```typescript
function Section({ title, body, children }: { title: string; body: string; children: ReactNode }) {
  return (
    <div className="space-y-3">
      <div>
        <h2 className="text-[18px] font-bold tracking-tight">{title}</h2>
        <p className="text-[13px] text-[var(--color-text-secondary)]">{body}</p>
      </div>
      <div className="space-y-3">{children}</div>
    </div>
  );
}
```

The Dev Tools section must:
1. Use the same `<Section>` component with `title="Dev Tools"` and a dev-oriented body string
2. Gate with `{import.meta.env.DEV && (...)}` — placed after the `data` section block
3. Use `<Button variant="destructive">` for the "Throw test error" button (same variant as "Reset everything")
4. The `onClick` throws synchronously (not inside async/Promise) — `() => { throw new Error('phase-1-sentry-smoke'); }`

**`reset()` double-confirm pattern to replace** (lines 77–82):
```typescript
const reset = (): void => {
  if (!confirm('Erase ALL your LeanShot data?')) return;
  if (!confirm('Last chance — really erase everything?')) return;
  resetAll();
  onClose();
};
```

This becomes `async` and uses `useConfirm` — see Pattern 7 from RESEARCH.md. The `confirm` calls in AIChatPanel.tsx line 114 and InsightsTab.tsx line 159 also need analogous replacements.

---

### Type-cast fixes (mechanical, self-extend)

These are one-line or small-block edits in existing files. The pattern they must follow is **the surrounding strictly-typed code in the same file**.

**`src/components/layout/Topbar.tsx` line 36** — existing import to extend:
```typescript
import { TAB_TITLES } from '@/lib/constants';
// Add:
import type { TabId } from '@/types';
```
Fix: replace `setTab(tab as never)` with a runtime guard using `Object.keys(TAB_TITLES)` (which is `Record<TabId, ...>`) and cast to `TabId` after validation.

**`src/components/dashboard/tabs/ActivityTab.tsx` line 118** — existing type reference:
```typescript
// Fix: extract from existing Workout interface via Workout['type']
import type { Workout } from '@/types';
type WorkoutType = Workout['type'];
setWo({ ...wo, type: e.target.value as WorkoutType });
```

**`src/components/dashboard/tabs/HomeTab.tsx` line 43** — requires upstream type change in `src/lib/insights.ts`:
```typescript
// In src/lib/insights.ts line 17-18: change cta.tab from string to TabId
import type { TabId } from '@/types';
cta?: { label: string; tab: TabId };  // was: tab: string
// Then in HomeTab.tsx line 43: no cast needed
onClick={() => setTab(insight.cta!.tab)}
```

**`src/components/dashboard/charts/BaseChart.tsx` line 44** — proper Chart.js type:
```typescript
import type { ChartOptions, ChartType } from 'chart.js';
c.options = (config.options ?? {}) as ChartOptions<ChartType>;
```

**BaseChart.tsx line 36** — ESLint disable comment update:
```typescript
// eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: effect 1 owns chart
//   creation/destruction on theme change only; effect 2 handles data updates
}, [theme]);
```

**`src/lib/ai.ts` line 22** — one-line constant fix:
```typescript
export const DEFAULT_MODEL = 'claude-sonnet-4-5';  // was 'claude-sonnet-4-6'
```

---

### Config files (no existing analog — use RESEARCH.md patterns directly)

**`vite.config.ts` — add `test` block:**

Current file (`vite.config.ts` lines 1–14) already has:
```typescript
import { defineConfig } from 'vite';
import { fileURLToPath, URL } from 'node:url';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: { port: 5173, host: true },
});
```

Add `test` block as a new key inside the existing `defineConfig({...})`. `@/` alias is already defined in `resolve.alias` — Vitest inherits it automatically when co-located in `vite.config.ts`.

**`eslint.config.js` note on file format:**

`package.json` line 4 has `"type": "module"` — confirmed. This means `eslint.config.js` uses ESM `export default [...]` syntax (not CJS `module.exports`). The flat-config ESM pattern from RESEARCH.md Pattern 2 applies directly without modification.

**`.prettierrc` — inferred from existing code style:**

Reading the existing source files confirms: single quotes throughout, semicolons present, trailing commas in multi-line structures, ~100-char lines. The `.prettierrc` must encode:
```json
{
  "singleQuote": true,
  "semi": true,
  "trailingComma": "all",
  "printWidth": 100,
  "tabWidth": 2
}
```

---

### Test files (source-module analogs)

Test files have no analog in the codebase (zero existing tests). The patterns they follow are derived from:
1. The source module's own structure (imports, function signatures)
2. RESEARCH.md Code Examples section (storage.test.ts fixture matrix, Playwright locator strategy)

**`src/lib/helpers.test.ts`** — tests `src/lib/helpers.ts`. All functions are pure with no dependencies. Test structure:
```typescript
import { describe, it, expect } from 'vitest';
import { todayStr, lastNDays, daysBetween, hoursSince, relTime,
         formatDuration, greeting, cn, clamp, pct, escapeHtml } from './helpers';
```
No mocks needed. DST tests for `daysBetween` / `lastNDays` require fixed Date pinning via `vi.useFakeTimers()`.

**`src/hooks/useStreaks.test.ts`** — tests the `calc()` function extracted from `src/hooks/useStreaks.ts`. The existing `calc` function (lines 17–28) is not exported. Phase 1 must export it or re-implement it as a standalone exported function. The test imports the pure function, not the hook:
```typescript
// Current private impl at src/hooks/useStreaks.ts lines 17-28:
function calc(predicate: (ds: string) => boolean): number {
  let streak = 0;
  for (let i = 0; i < 365; i++) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const ds = d.toISOString().slice(0, 10);
    if (predicate(ds)) streak++;
    else if (i === 0) continue;
    else break;
  }
  return streak;
}
```
Export as `export function calcStreak(...)` and test the four predicates (weight, protein, supps, movement) with fixture data and pinned dates.

**`src/lib/storage.test.ts`** — tests `migrateFromV3` (`src/lib/storage.ts` lines 77–109). Uses `vi.spyOn(Storage.prototype, 'getItem')` pattern from RESEARCH.md Code Examples. Four test cases: v3-only, v4-only, both, corrupted v3.

**`src/components/onboarding/OnboardingFlow.test.tsx`** — RTL integration test. `OnboardingFlow.tsx` imports `useStore` — tests must mock the store or provide a real store instance. The component expects `onCancel` and `onComplete` callbacks. Use `@testing-library/react` `render` + `userEvent` to click through all 7 steps. Assert the `setUser` action was called with a valid `User` shape.

**`e2e/onboarding.spec.ts`** — Playwright smoke. Uses `getByRole`/`getByLabel` locator strategy (RESEARCH.md Pattern 6 and Code Examples). Tests the full marketing → onboarding → dashboard flow.

---

## Shared Patterns

### localStorage try/catch (apply to: `src/lib/analytics.ts`, `src/lib/sentry.ts`)

**Source:** `src/lib/storage.ts` lines 111–133 and `src/main.tsx` lines 11–20, `src/hooks/useTheme.ts` lines 6–14

Every localStorage read/write is wrapped in `try { ... } catch { /* noop */ }` or `try { ... } catch { return fallback; }`. Private-mode browsers throw on any localStorage access. This is enforced project-wide and must be applied to `getOrCreateDistinctId()` in `analytics.ts`.

### SCREAMING_SNAKE_CASE for key constants (apply to: `src/lib/analytics.ts`)

**Source:** `src/lib/storage.ts` lines 26–29

```typescript
export const STORAGE_KEY = 'leanshot_v4';
export const API_KEY_STORAGE = 'leanshot_anthropic_key';
```

New key: `const DISTINCT_ID_KEY = 'leanshot_distinct_id';` — module-private (no `export`), same `leanshot_` prefix.

### Named-export-only modules (apply to: `src/lib/sentry.ts`, `src/lib/analytics.ts`)

**Source:** `src/lib/helpers.ts`, `src/lib/storage.ts`, `src/lib/ai.ts`

All lib modules use named exports only. No default export. No barrel re-export in Phase 1.

### @/ path alias for all cross-directory imports (apply to: all new src/ files)

**Source:** every existing file, e.g. `src/hooks/useStreaks.ts` line 7–8:
```typescript
import { useStore } from '@/lib/store';
import { SUPPS_DEFAULT } from '@/lib/constants';
```

All imports from outside the same directory use `@/` alias, never relative `../../`.

### Tailwind CSS variable tokens for colors (apply to: `src/hooks/useConfirm.ts` ConfirmModal render, Dev Tools section in SettingsPage)

**Source:** `src/components/dashboard/settings/SettingsPage.tsx` lines 96–100:
```typescript
'bg-[var(--color-primary-soft)] text-[var(--color-primary)]'
// or
'text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-elevated)]'
```

Never hard-code `#hex` or Tailwind named colors in component JSX. Always use `var(--color-*)` CSS custom properties.

### `import type` for type-only imports (apply to: all new TypeScript files)

**Source:** `src/lib/storage.ts` lines 9–24:
```typescript
import type {
  AIMessage,
  Cost,
  Injection,
  // ...
} from '@/types';
```

All type-only imports use `import type`. This is enforced by ESLint rule `@typescript-eslint/consistent-type-imports` (D-02).

---

## No Analog Found

| File | Role | Data Flow | Reason |
|---|---|---|---|
| `.github/workflows/ci.yml` | config | — | No CI config exists in the repo at all |
| `.env.example` | config | — | No env files exist; first introduction of `VITE_*` vars |
| `src/test-setup.ts` | config | — | No test infrastructure exists; this is the bootstrap file |
| `e2e/onboarding.spec.ts` | test | — | No Playwright tests exist; no `e2e/` directory exists |

These files must be built from RESEARCH.md Patterns 5, 6, and the Code Examples section rather than from codebase analogs.

---

## Metadata

**Analog search scope:** `/Users/karstenhaldan/minisite/leanshot/src/` (all subdirectories), root config files
**Files read:** `src/lib/helpers.ts`, `src/lib/storage.ts`, `src/lib/ai.ts`, `src/main.tsx`, `src/hooks/useStreaks.ts`, `src/hooks/useReducedMotion.ts`, `src/hooks/useTheme.ts`, `src/hooks/useToast.ts`, `src/components/ui/Modal.tsx`, `src/components/dashboard/settings/SettingsPage.tsx`, `src/components/dashboard/charts/BaseChart.tsx`, `src/components/layout/Topbar.tsx`, `src/components/dashboard/tabs/HomeTab.tsx`, `src/components/dashboard/tabs/ActivityTab.tsx`, `src/components/dashboard/ai/AIChatPanel.tsx` (partial), `src/components/onboarding/OnboardingFlow.tsx` (partial), `vite.config.ts`, `package.json`, `CLAUDE.md`
**Pattern extraction date:** 2026-05-10
