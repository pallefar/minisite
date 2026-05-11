# Coding Conventions

**Analysis Date:** 2026-05-10

## TypeScript Configuration

**Strict mode is fully enabled.** See `tsconfig.app.json`:

```json
"strict": true,
"noUnusedLocals": true,
"noUnusedParameters": true,
"noFallthroughCasesInSwitch": true,
"noUncheckedSideEffectImports": true
```

Additional notable flags:
- `target: "ES2022"`, `module: "ESNext"`, `moduleResolution: "bundler"` — modern browser-only output, no Node.js back-compat
- `jsx: "react-jsx"` — automatic JSX runtime, no `import React from 'react'` needed
- `allowImportingTsExtensions: true` paired with `noEmit: true` — TypeScript only typechecks; Vite handles the build
- `isolatedModules: true` and `moduleDetection: "force"` — every file must be a module
- `useDefineForClassFields: true` — modern class semantics

There is a separate `tsconfig.node.json` for Vite's own config file (`vite.config.ts`) using `lib: ["ES2023"]` and `types: ["node"]`. The root `tsconfig.json` is a project-references shell pointing at both — `tsc -b` builds them together.

**No `any` types are used in the source.** Spot-checks across `src/` find zero `: any` annotations. Untyped JSON inputs are coerced through explicit assertion + fallback, e.g. `(v3.user as User) ?? null` in `src/lib/storage.ts:83`.

**Type-only imports use the inline `type` modifier**, never a separate `import type` line when mixed with values:

```ts
// src/components/ui/Button.tsx:1
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
```

When a file imports only types, the file-level form is used:

```ts
// src/main.tsx:7
import type { Theme } from './types';
```

## Linting & Formatting

**No linter is configured.** No `.eslintrc*`, `eslint.config.*`, `biome.json`, or `.prettierrc*` files exist. There is no `lint`/`format` script in `package.json`. The codebase relies entirely on the TypeScript compiler (`npm run typecheck` → `tsc -b --noEmit`) to enforce quality.

Despite no linter, formatting is highly consistent across files: 2-space indent, single quotes for strings, trailing commas in multi-line literals, semicolons, arrow functions for one-liners.

## Import Patterns

**Path alias `@/*` → `./src/*`** is configured in three places that must agree:
- `tsconfig.app.json` — `"paths": { "@/*": ["./src/*"] }`
- `vite.config.ts:9-11` — `resolve.alias['@'] = fileURLToPath(...)`
- All cross-directory imports in `src/`

**Convention:** Use `@/...` for any cross-directory import. Use relative paths (`./Sibling`) only for siblings inside the same directory.

Examples:

```ts
// src/components/dashboard/cards/HeroCard.tsx:1-7
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { HeroOrbital } from '@/illustrations/HeroOrbital';
import { useStore } from '@/lib/store';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { useCountUp } from '@/hooks/useCountUp';
import { medLabelShort, TITRATION } from '@/lib/pharmacology';
```

```ts
// src/components/layout/AppShell.tsx:3-5  — siblings use relative paths
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';
import { MobileNav } from './MobileNav';
```

**No `../` or `../../` parent-walking imports exist anywhere in `src/`.** Always use the `@/` alias to reach files outside the current directory.

**Import group order** (observed throughout, not enforced):
1. React + framework hooks (`react`, `react-dom`)
2. Third-party libs (`framer-motion`, `lucide-react`, `zustand`)
3. `@/` aliased project imports
4. `./` sibling imports
5. Type-only imports last (when standalone)

## Component Patterns

**Function components only.** No class components anywhere. The default form is a named export:

```ts
// src/components/ui/Pill.tsx:10
export function Pill({ active, size = 'md', leadingIcon, className, children, ...rest }: PillProps) {
  ...
}
```

**`forwardRef` is used when the component must accept a ref** (form inputs, Buttons). The named-function form is preferred so React DevTools shows the right name:

```ts
// src/components/ui/Button.tsx:43-46
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', loading, leadingIcon, trailingIcon, block, className, children, disabled, ...rest },
  ref,
) { ... });
```

**Prop typing convention:**

1. **Always declare a `XxxProps` interface** above the component. Never inline.
2. **Extend native HTML attribute types** when wrapping a host element so callers get full DOM API access:
   ```ts
   // src/components/ui/Button.tsx:8
   export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> { ... }
   // src/components/ui/Card.tsx:6
   export interface CardProps extends HTMLAttributes<HTMLDivElement> { ... }
   ```
3. **Use `Omit<...>` to drop conflicting names** when the wrapper redefines a prop (e.g. `size`):
   ```ts
   // src/components/ui/Input.tsx:59
   export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> { ... }
   ```
4. **Use union string literals for variants/sizes**, exported alongside the component for callers:
   ```ts
   // src/components/ui/Button.tsx:5-6
   export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'destructive' | 'success' | 'inverse';
   export type ButtonSize = 'sm' | 'md' | 'lg';
   ```
5. **Default values land in the destructure**, never via `defaultProps`:
   ```ts
   ({ variant = 'primary', size = 'md', ... })
   ```
6. **`...rest` spreads to the host element** so callers can pass `aria-*`, `data-*`, `onClick`, etc.
7. **JSDoc comments live on individual props** when the meaning isn't obvious from the name:
   ```ts
   // src/components/ui/Card.tsx:10-12
   /** Span across the 12-col bento grid. */
   span?: 3 | 4 | 5 | 6 | 7 | 8 | 12;
   /** When true, applies the rise animation on mount. */
   enter?: boolean;
   ```
8. **Required `aria-label` on icon-only buttons**, enforced through the type itself:
   ```ts
   // src/components/ui/Button.tsx:80-81
   /** REQUIRED — every icon-only button must have an accessible name. */
   'aria-label': string;
   ```

**Variant-to-class mapping uses `Record<Variant, string>`** rather than `switch` statements:

```ts
// src/components/ui/Button.tsx:28
const variantClasses: Record<ButtonVariant, string> = {
  primary: 'bg-[var(--color-primary)] text-[var(--color-primary-foreground)] ...',
  ...
};
```

This pattern (base + size + variant + conditional + className) appears in every variant component (`Button`, `Card`, `Pill`, `Badge`, `Skeleton`, `IconButton`).

**Subcomponents and helpers live in the same file** when tightly coupled. Examples: `CardHeader` and `StatTile` live in `src/components/ui/Card.tsx`; `IconButton` lives in `src/components/ui/Button.tsx`; `PillGroup` lives in `src/components/ui/Pill.tsx`. Section dividers use a horizontal banner comment:

```ts
// src/components/ui/Button.tsx:72-74
/* ------------------------------------------------------------------ */
/* IconButton — square hit-area, primarily for toolbar/header actions */
/* ------------------------------------------------------------------ */
```

**Lazy-loaded code-split tabs/modals.** `src/App.tsx:9-25` lazy-imports every tab and every secondary panel. Pattern is uniform:

```ts
const HomeTab = lazy(() => import('@/components/dashboard/tabs/HomeTab').then((m) => ({ default: m.HomeTab })));
```

The `.then((m) => ({ default: m.HomeTab }))` shim is required because the codebase exports named functions, not defaults — this adapts named exports for `React.lazy`.

## Hooks

**Custom hooks live in `src/hooks/` as single-purpose files**, named `useX.ts`. Each hook explicitly types its return value:

```ts
// src/hooks/useTheme.ts:22
export function useTheme(): { theme: Theme; toggle: () => void; setTheme: (t: Theme) => void } { ... }

// src/hooks/useCountUp.ts:8
export function useCountUp(value: number, opts?: { duration?: number; from?: number; decimals?: number }): number { ... }

// src/hooks/useStreaks.ts:30
export function useStreaks(): Streaks { ... }
```

**Internal `void` annotations on `useEffect` handlers** are common — both for cleanup-style functions and event handlers — to satisfy `noUnusedLocals` / consistency:

```ts
// src/hooks/useReducedMotion.ts:17
const handler = (e: MediaQueryListEvent): void => setReduced(e.matches);
```

**`useStore` selectors use the slice form** (one selector per primitive value) so React only re-renders on the bits that change:

```ts
// src/components/dashboard/cards/HeroCard.tsx:18-22
const u = useStore((s) => s.user!);
const weights = useStore((s) => s.weights);
const injections = useStore((s) => s.injections);
const meals = useStore((s) => s.meals);
```

The non-null assertion `s.user!` is used inside dashboard components because `App.tsx` only renders the dashboard once the user is hydrated — this is documented at `src/App.tsx:35` and `src/App.tsx:42-45`.

## Tailwind Class Organization

Tailwind v4 (beta) is loaded via `@tailwindcss/vite`. There is **no `tailwind.config.js`** — design tokens live in CSS at `src/index.css` under `@theme { ... }` (lines 11+).

**Class strings are composed via `cn()` helper** at `src/lib/helpers.ts:46`:

```ts
export const cn = (...parts: Array<string | false | null | undefined>): string =>
  parts.filter(Boolean).join(' ');
```

This is a thin filter — there is **no `clsx` / `tailwind-merge`**. Classes that conflict are managed manually by ordering: caller's `className` always lands last so it wins.

**Class composition pattern** (consistent across all variant components):

```ts
// src/components/ui/Button.tsx:52-58
className={cn(
  baseClasses,        // shared base (long string at module scope)
  sizeClasses[size],  // size lookup
  variantClasses[variant], // variant lookup
  block && 'w-full',  // boolean conditional
  className,          // caller override always last
)}
```

**Long base class strings are extracted to module-level constants** with explicit string concatenation (`+`) so editor wrapping stays sane:

```ts
// src/components/ui/Button.tsx:17-20
const baseClasses =
  'inline-flex items-center justify-center gap-2 font-semibold rounded-pill transition-[transform,box-shadow,background-color,color,border-color] ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-bg)] ' +
  'disabled:pointer-events-none disabled:opacity-50 active:translate-y-[0.5px] whitespace-nowrap select-none';
```

**Color tokens are referenced as CSS custom properties via Tailwind's arbitrary-value syntax**, never as Tailwind theme keys:

```ts
'bg-[var(--color-primary)] text-[var(--color-primary-foreground)]'
'border-[var(--color-border)] hover:border-[var(--color-primary)]'
'shadow-[var(--shadow-xs)]'
```

This is intentional: tokens are defined once in `src/index.css` and toggle automatically under `[data-theme="dark"]` (`src/hooks/useTheme.ts:18-20`). Components never reference raw Tailwind colors like `bg-blue-500`.

**Responsive prefixes follow mobile-first**: bare classes are mobile, `md:` and `lg:` add upward (`AppShell.tsx:22` — `md:ml-[80px] pt-5 md:pt-7 pb-[140px] md:pb-12`). The 12-col bento grid pattern is captured in `Card.tsx:34-42`:

```ts
3: 'lg:col-span-3 md:col-span-6 col-span-12',
```

**Arbitrary values are used freely** for typography (`text-[14px]`, `text-[clamp(28px,3.4vw,42px)]`) and spacing — there is no rigid type-scale enforcement at the class level since the design system specifies exact pixel values.

**`focus-visible:` is the standard focus pattern** for every interactive element. Two custom rounding tokens are defined in CSS: `rounded-pill` and `rounded-card`. `motion-safe:` is used to gate decorative animations (`Landing.tsx:53`, `EmptyState.tsx:24`).

## Naming Conventions

**Files:**
- **Components (`.tsx`):** `PascalCase.tsx` matching the primary export — `Button.tsx`, `HeroCard.tsx`, `OnboardingFlow.tsx`. One primary component per file (with co-located subcomponents allowed).
- **Hooks (`.ts`):** `camelCase` starting with `use` — `useToast.ts`, `useStreaks.ts`, `useReducedMotion.ts`.
- **Lib/utility (`.ts`):** `kebab-case` or single-word lowercase — `helpers.ts`, `insights.ts`, `chart-theme.ts`, `share-card/template-bold.ts`.
- **Types:** `src/types/index.ts` is a single barrel exporting every domain type.

**Identifiers:**
- **Functions:** `camelCase` — `pickFocus`, `generateInsights`, `calcMedLevel`, `migrateFromV3`.
- **React components:** `PascalCase` — `HeroCard`, `FocusCard`, `TitrationTrack`.
- **Hooks:** `useX` (camelCase, `use` prefix) — required by React's rules-of-hooks.
- **Type aliases / interfaces:** `PascalCase` — `User`, `Injection`, `ButtonProps`. Both `interface` and `type` are used: **`interface`** for object shapes (props, domain entities), **`type`** for unions/aliases (`Units`, `TabId`, `BadgeTone`).
- **Constants (module-level):** `SCREAMING_SNAKE_CASE` for true constants — `STORAGE_KEY`, `STORAGE_VERSION`, `TOTAL_STEPS`, `KEYWORDS_FOR_DATA_REF`, `SUPPS_DEFAULT`, `SYMPTOMS_LIST`, `TITRATION`, `HALF_LIVES`, `DEFAULT_MODEL`, `ICON_MAP`.
- **Local variables:** `camelCase` — descriptive names, sometimes terse single-letters in tight scopes (`u` for user, `s` for state inside a `useStore` selector, `m` for meal in `.map()`).

**Prop callbacks** use the `onX` prefix — `onClose`, `onStart`, `onComplete`, `onLogDose`, `onOpenAI`, `onOpenReport`, `onOpenSettings` (`AppShell.tsx:11-14`).

**Discriminator unions** for variants/tones use lowercase string literals: `'primary' | 'secondary'`, `'success' | 'warning' | 'danger'`, `'sm' | 'md' | 'lg'`.

## Error Handling

**`try`/`catch` is reserved for genuinely fallible IO** — primarily `localStorage` access and JSON parsing. Logic-level errors are not caught; they're prevented through types.

**Three patterns observed:**

1. **Silent fallback** for non-essential `localStorage` reads/writes:
   ```ts
   // src/hooks/useTheme.ts:7-14
   try {
     const saved = localStorage.getItem(THEME_KEY) as Theme | null;
     if (saved === 'light' || saved === 'dark') return saved;
     ...
   } catch {
     /* noop */
   }
   ```
   The `/* noop */` comment is the standard sentinel for intentionally-empty catches.

2. **`console.error` with `[leanshot]` tag** for migration failures and other unexpected errors that shouldn't crash the app:
   ```ts
   // src/lib/storage.ts:106
   console.error('[leanshot] v3 migration failed', e);
   // src/lib/store.ts:279
   console.error('[leanshot] hydrate failed', e);
   ```
   The `[leanshot]` prefix is consistent across the app for grep-ability in browser consoles.

3. **Typed errors thrown from API code** for catchable conditions the UI must handle:
   ```ts
   // src/lib/ai.ts:13-18
   export class MissingAPIKeyError extends Error {
     constructor() {
       super('Anthropic API key not configured');
       this.name = 'MissingAPIKeyError';
     }
   }
   ```
   Callers narrow with `instanceof MissingAPIKeyError` to render an "add your key" prompt instead of a generic failure.

**HTTP errors are thrown as plain `Error` with status + body**:

```ts
// src/lib/ai.ts:62-65
if (!r.ok) {
  const text = await r.text().catch(() => '');
  throw new Error(`Anthropic ${r.status}: ${text || r.statusText}`);
}
```

**No error boundaries exist.** A thrown render error will crash the visible tab. The lazy-loaded `<Suspense>` boundaries (`src/App.tsx:71, 78, 96, 111`) catch loading state but not render errors. This is a gap — see `CONCERNS.md` if produced.

**Form-level "errors" surface as toast notifications**, not exceptions:

```ts
// src/components/onboarding/OnboardingFlow.tsx:76
if (step === 1 && !draft.name.trim()) return toast('Please enter your name', 'error');
```

The `useToast()` hook (`src/hooks/useToast.ts`) returns a function that pushes onto the Zustand `toast` slice with auto-dismiss after 2400ms.

## Logging

**No logging framework.** Only `console.error` is used, and only for genuinely unexpected conditions. There is no `console.log` for debug output left in the source. Every `console.*` call is prefixed `[leanshot]` for grep-ability.

There is no remote logging / Sentry / analytics — the app is local-only by design (`src/components/marketing/Landing.tsx:378`).

## Comments & Documentation

**Three documentation styles, all observed:**

1. **File header banner** for modules with non-obvious purpose:
   ```ts
   // src/lib/storage.ts:1-8
   /**
    * Persistence + migration.
    *
    * v1 used a single localStorage key `leanshot_v3` with a flat shape.
    * v2 uses `leanshot_v4` via Zustand persist with explicit `migrate()` so
    * existing users keep their data. The legacy v3 key is deleted only after
    * a successful merge.
    */
   ```

2. **JSDoc on exported helpers / props** (single-line OK):
   ```ts
   // src/lib/helpers.ts:55
   /** Greeting based on local time. */
   export const greeting = (): 'morning' | 'afternoon' | 'evening' => { ... };
   ```

3. **Inline `//` comments for non-obvious logic** — particularly migration paths, state transitions, and pharmacology math. Example: `src/main.tsx:9-10`, `src/lib/store.ts:121-122`, `src/App.tsx:8`, `src/App.tsx:34`, `src/App.tsx:41`, `src/App.tsx:62`.

**v1-port references** are common because the codebase is a TypeScript rewrite of an earlier `leanshot.html` file. Comments cite the original line range:

```ts
// src/lib/insights.ts:1-5
/**
 * Pure rule engine for "Smart insights" + "Today's focus" cards.
 * Ported from v1 generateInsightsArray (leanshot.html:3119) and refactored
 * to consume the typed store.
 */
```

**Avoid comments that just restate the code.** When code is self-documenting (as it usually is), no comment is added.

## Function Design

**Explicit return types on exported functions** in `src/lib/` and `src/hooks/`. Examples in `src/lib/helpers.ts`:

```ts
export const todayStr = (): string => new Date().toISOString().slice(0, 10);
export const daysBetween = (a: string | Date, b: string | Date): number => ...;
export const cn = (...parts: Array<string | false | null | undefined>): string => ...;
```

**Component return types are inferred** — no `: JSX.Element` or `: React.FC<Props>` annotations anywhere. The function form (`function Button(...)` returning JSX) is enough for TypeScript.

**Arrow functions for one-liners; named `function` for components and multi-line lib helpers.** Examples of arrow exports: `src/lib/helpers.ts:6, 8, 13, 19, 25, 35, 38, 41, 46, 49, 52`. Named function declarations: every component, every hook, `migrateFromV3`, `pickFocus`, `generateInsights`.

**Pure functions are preferred** for derived state. `pickFocus` and `generateInsights` (`src/lib/insights.ts`) take the entire `PersistedState` and return a value — they're invoked inside `useStore` selectors so they re-run when state changes:

```ts
// src/components/dashboard/cards/FocusCard.tsx:24
const focus = useStore((s) => pickFocus(s));
```

**Return-early style** is used heavily for guards:

```ts
// src/lib/insights.ts:20-22
export function generateInsights(s: PersistedState): Insight[] {
  const u = s.user;
  if (!u) return [];
  ...
}
```

## Module / Export Design

**Named exports only.** No default exports anywhere in the codebase except where forced (e.g. `vite.config.ts` and `App.tsx`'s `lazy()` shims).

The `App` component itself is exported as a named function (`src/App.tsx:29` — `export function App()`), and `main.tsx` imports it as `{ App }` (`src/main.tsx:3`).

**No barrel files** outside of `src/types/index.ts`. Every component, hook, and helper is imported from its own file path. The reason: keep code-splitting boundaries clean and avoid pulling unrelated symbols.

**Co-location:** when a small helper is only used by one component, it lives in that component's file (e.g. `Stat`, `Divider`, `TitrationTrack`, `Mesh` all inside `HeroCard.tsx`).

## State Management

**Zustand with `persist` middleware** is the single source of truth (`src/lib/store.ts`). Convention:

- **Persisted domain data** is partialized via `partialize` (`store.ts:231-250`) — only data, not UI flags.
- **Ephemeral UI state** (`currentTab`, `toast`) lives in the same store but isn't persisted.
- **Action methods are flat properties on the store** — no slices. Examples: `addInjection`, `removeInjection`, `upsertWeight`, `bulkSetSteps`. Naming follows verb-noun.
- **Synchronous hydration before first render** (`src/main.tsx:25-32`) avoids the marketing-page flash for already-onboarded users.
- **Components subscribe with one selector per primitive** to minimize re-renders (covered above under Hooks).

## Accessibility Conventions

- **`aria-label` is required on icon-only buttons** (typed in `IconButtonProps`, `Button.tsx:80-81`).
- **`role="dialog"` + `aria-modal="true"`** on every modal/sheet (`Modal.tsx:60-62`, `Sheet.tsx:45-47`).
- **`role="status"` + `aria-live="polite"`** on toasts (`Toast.tsx:22-23`).
- **`aria-pressed`** on toggle pills (`Pill.tsx:14`); **`aria-busy`** on loading buttons (`Button.tsx:51`); **`aria-invalid`** on errored inputs (`Input.tsx:87`).
- **`aria-hidden`** on decorative icons and visual ornaments (`Button.tsx:62`, `HeroCard.tsx:127, 192`, `Skeleton.tsx:10`).
- **`prefers-reduced-motion`** is respected via the `useReducedMotion()` hook (`src/hooks/useReducedMotion.ts`) — every animated component checks it before running RAF loops or large transitions. CSS-level reduced-motion is also enforced via `index.css`.

---

*Convention analysis: 2026-05-10*
