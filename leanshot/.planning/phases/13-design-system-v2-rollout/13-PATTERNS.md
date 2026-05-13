# Phase 13: Design System v2 Rollout — Pattern Map

**Mapped:** 2026-05-13
**Files analyzed:** ~28 (4 token/CSS, 4 UI primitives, 1 Sidebar, ~19 illustrations, 1 auth view, 1 marketing, 12 VR specs, 1 CI workflow, 1 Lighthouse FCP gate, 1 font link site)
**Analogs found:** 28 / 28 — all targets are in-place mutations of existing files, so every change has an exact analog (its own current state).

> **Header note on D-01 / D-02:**
> This phase is *refresh-in-place*. Every "new" file in the table below is actually a mutation of the existing file at the same path. The analog is the file's current state; the pattern to copy is the file's existing prop machinery + style conventions + import order, with values + variant unions widened.
> The only genuinely net-new files are: (a) the ~10 new illustration components (mirroring `AIAvatar.tsx` / `HeroOrbital.tsx` / `EmptyInjections.tsx`); (b) the 12 Playwright VR spec files (`tests/visual/*.spec.ts`, mirroring `e2e/clinic-ad-free.spec.ts`); (c) the FCP baseline JSON (`13-FCP-BASELINE.json`); (d) the FCP-delta CI job in `.github/workflows/ci.yml` (appended into the existing `lighthouse:` job pattern).

---

## File Classification

| Target file (mutate or create) | Role | Data flow | Closest analog | Match quality |
|---|---|---|---|---|
| `src/index.css` (`@theme` block lines ~11–158 + `[data-theme=dark]` lines ~158–203) | config / design-tokens | static-emit (CSS) | itself (current `@theme` block + `[data-theme=dark]` override) | exact (in-place value swap) |
| `index.html` (`<link>` font block lines 13–37) | config / asset preload | static-emit (HTML) | itself (existing Inter / Fraunces / JetBrains Mono preload+swap pattern, Phase 2.1) | exact (URL swap) |
| `src/components/ui/Card.tsx` | component / primitive | request-response (props in, JSX out) | itself (existing `CardVariant` + `forwardRef` + `variantClasses` table) | exact |
| `src/components/ui/Button.tsx` | component / primitive | request-response | itself (existing `ButtonVariant` union + `variantClasses` table + `Loader2` loading pattern + `IconButton` sibling) | exact |
| `src/components/ui/Pill.tsx` | component / primitive | request-response | itself (existing `active`/`size` props + `PillGroup` sibling) | exact |
| `src/components/layout/Sidebar.tsx` | component / layout | request-response (store reads, JSX out) | itself (existing 80 px `fixed` sidebar + `motion.span layoutId` active indicator + tab-list pattern) | exact |
| `src/components/auth/AuthView.tsx` + `SignInForm.tsx` + `SignUpForm.tsx` | component / page | request-response (hash routing, form submit) | itself (existing hash-routed sub-view pattern at `AuthView.tsx:24–57`) | exact (restyle, no routing change per D-08) |
| `src/components/marketing/Landing.tsx` | component / page | request-response | itself (existing `Nav` + `Hero` + `Features` + `Testimonials` + `Pricing` + `FAQ` + `Footer` layout) | exact (token + illustration swap only) |
| `src/illustrations/AIAvatar.tsx` (mutate) | component / illustration | request-response | itself + `HeroOrbital.tsx` for animation gating | exact |
| `src/illustrations/HeroOrbital.tsx` (mutate) | component / illustration | request-response | itself | exact |
| `src/illustrations/EmptyInjections.tsx`, `EmptyPhotos.tsx`, `EmptySymptoms.tsx`, `Vial.tsx`, `OnboardSteps.tsx`, `ConnectData.tsx` (mutate) | component / illustration | request-response | each file's current shape — `viewBox` + inline `<defs>` + `aria-hidden` | exact |
| `src/illustrations/StreakBadge.tsx` (mutate or split into `StreakBronze/Silver/Gold/Locked`) | component / illustration | request-response | itself (existing `variant: '7d' \| '30d' \| '90d'` + `locked` discriminated union) | exact |
| `src/illustrations/PenInjector.tsx` (NEW) | component / illustration | request-response | `EmptyInjections.tsx` (also pen-themed; `<defs>` + `<g transform>` pattern) | role + theme match |
| `src/illustrations/AchievementShield.tsx` (NEW) | component / illustration | request-response | `StreakBadge.tsx` (concentric ring + center text pattern) | role match |
| `src/illustrations/ActivityRings.tsx` (NEW, animated) | component / illustration | request-response (`useReducedMotion`) | `AIAvatar.tsx` (concentric circles + animated optional) | role + flow match |
| `src/illustrations/DoctorClipboard.tsx` (NEW) | component / illustration | request-response | `ConnectData.tsx` (rectangular shapes + gradients) | role match |
| `src/illustrations/HeartPulse.tsx` (NEW, animated) | component / illustration | request-response | `AIAvatar.tsx` (`thinking` pulse pattern) | role + flow match |
| `src/illustrations/CalendarDose.tsx` (NEW) | component / illustration | request-response | `EmptyInjections.tsx` (grid + accent dot) | role match |
| `src/illustrations/EmptyPlate.tsx`, `EmptyInsights.tsx` (NEW) | component / illustration | request-response | `EmptyInjections.tsx` / `EmptySymptoms.tsx` (existing empty-state convention) | exact (empty-state class) |
| `src/illustrations/LoginHero.tsx` (NEW, large hero-scale, animated) | component / illustration | request-response (`useReducedMotion`, `staticOnly` opt-out) | `HeroOrbital.tsx` (hero-scale orbital + `staticOnly` prop) | exact |
| `tests/visual/landing.spec.ts` + 11 more (NEW) | test / e2e | request-response (Playwright drives route, captures screenshot) | `e2e/clinic-ad-free.spec.ts` (existing `@playwright/test` spec convention + `testMatch: /.*\.spec\.ts$/` per `playwright.config.ts:9`) | role + tool match |
| `tests/csp/csp-snapshot.test.ts` (referenced for vitest convention only, NOT mutated) | — | — | reference for "snapshot diff against committed text file" pattern | reference |
| `13-FCP-BASELINE.json` (NEW, phase dir) | config / baseline data | static-emit | `lighthouserc.json` (existing LHCI config) | partial (LHCI assertions analog) |
| `.github/workflows/ci.yml` `lighthouse:` job (mutate — add FCP-delta step) | config / CI | event-driven (PR push triggers) | itself, lines 443–473 (existing LHCI invocation via `npx --yes @lhci/cli@0.15.1 autorun` + `wait-for-vercel-preview` action) | exact |
| `.github/workflows/ci.yml` `test-e2e:` job (mutate — add visual-regression step) | config / CI | event-driven | itself, lines 150–172 (existing pattern of additive `bash scripts/assert-*.sh` steps appended to the test-e2e job) | exact |

---

## Pattern Assignments

### 1. `src/index.css` — `@theme` token swap

**Analog:** `src/index.css` itself, lines 11–158 (light defaults) + 158–203 (`[data-theme=dark]` override). Tailwind v4 plumbing is unchanged; only **values** migrate.

**Token structure pattern** (`src/index.css:11–43`):
```css
@theme {
  /* ---- Color primitives (light) ---- */
  --color-cream-50: #f8f5ec;
  --color-cream-100: #efebe0; /* page bg */     /* ← becomes #F2EDE0 per D-02 + design-system/colors_and_type.css */
  --color-cream-card: #fdfbf6; /* white-on-cream surface */  /* ← becomes #FEFCF7 paper-white */
  --color-teal-700: #1b4842; /* hero, primary */
  --color-sage: #45b077;
  /* ...
  /* ---- Semantic tokens (light defaults — overridden in [data-theme=dark]) ---- */
  --color-bg: var(--color-cream-100);
  --color-surface: var(--color-cream-card);
  /* ... */
```

**Dark-mode override pattern** (`src/index.css:158–203`) — every semantic token re-declared inside `[data-theme=dark]`:
```css
[data-theme=dark] {
  --color-bg: #0b1413;
  --color-surface: #16201e;
  --color-surface-elevated: #1d2a28;
  --color-primary: #6fcbb8;
  --color-primary-hover: #8ad6c5;
  --color-primary-soft: #1a2c29;
  --color-text: #e8e4d8;
  /* shadows are also re-declared in dark, lines 196–202 */
  --shadow: 0 6px 16px rgba(0, 0, 0, 0.4);
}
```

**Pattern to copy:** Keep the section comments + key/value structure exactly. Touch values only. Add new tokens (paper-grain noise overlay URL, warm-tinted shadow `rgba(40,32,20,…)` per CONTEXT.md D-02) by appending inside the same `@theme {}` and the same `[data-theme=dark] {}` blocks — never split them.

**Font-family pattern** (`src/index.css:84–86`) — sole tokens to touch for DS-01:
```css
--font-display: 'Fraunces', 'Tiempos Headline', 'Domaine Display', Georgia, serif;
--font-sans: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;       /* ← 'Geist', … */
--font-mono: 'JetBrains Mono', ui-monospace, 'SF Mono', Menlo, monospace;                     /* ← 'Geist Mono', … */
```

---

### 2. `index.html` — font preload swap

**Analog:** `index.html:13–37` (Phase 2.1 perf-fix Filament-Group pattern, intact).

**Existing pattern** — three-step preload+swap with `<noscript>` fallback:
```html
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link
  rel="preload"
  as="style"
  href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Fraunces:ital,opsz,wght@0,9..144,300..700;1,9..144,300..700&family=JetBrains+Mono:wght@500;600&display=swap"
/>
<link
  rel="stylesheet"
  href="…same URL…"
  media="print"
  onload="this.media='all'"
/>
<noscript>
  <link rel="stylesheet" href="…same URL…" />
</noscript>
```

**Pattern to copy:** Same three-`<link>` + `<noscript>` structure. Replace `Inter:wght@…` with `Geist:wght@400;500;600;700;800` and `JetBrains+Mono:wght@…` with `Geist+Mono:wght@500;600`. Keep Fraunces. **All three URLs must be identical** (the preload URL, the stylesheet `href`, and the `<noscript>` `href`) — diverging URLs forfeit the swap optimization. Per D-10 + chat1.md: do NOT replace this block with `@import` chains.

---

### 3. `src/components/ui/Card.tsx` — additive variants

**Analog:** `Card.tsx:4–22` (existing discriminated union + `Record<Variant, string>` table).

**Existing variant-union pattern:**
```typescript
export type CardVariant = 'default' | 'elevated' | 'interactive' | 'hero' | 'flat';

const variantClasses: Record<CardVariant, string> = {
  default:
    'bg-[var(--color-surface)] border border-[var(--color-border)] shadow-[var(--shadow-xs)]',
  elevated: 'bg-[var(--color-surface)] border border-[var(--color-border)] shadow-[var(--shadow)]',
  interactive:
    'bg-[var(--color-surface)] … hover:-translate-y-[2px] hover:border-[var(--color-primary-soft)] transition-[transform,box-shadow,border-color] cursor-pointer',
  hero: '',
  flat: 'bg-[var(--color-surface-elevated)] border border-[var(--color-border)]',
};
```

**Pattern to copy (D-01 additive widening):** Extend `CardVariant` union with `'selected' | 'clickable' | 'tonal' | 'footer'`. Add four matching entries to `variantClasses`. Do NOT touch existing entries' class strings unless restyling defaults — keep `forwardRef`, `paddingClasses`, `spanClasses`, `cn(...)` composition order intact. Consumer count = 38 files (CONTEXT.md `code_context`), so any class-name change to `default` ripples everywhere — that ripple is what the VR suite catches.

**Header convention** (`Card.tsx:71–85`) — preserve as-is; the design bundle keeps `<CardHeader title icon action />`.

---

### 4. `src/components/ui/Button.tsx` — `tonal` variant + counter chip + loading-state polish

**Analog:** `Button.tsx:5–46` (existing union + `variantClasses` table + `Loader2`-on-`loading` pattern).

**Existing pattern** to extend:
```typescript
export type ButtonVariant =
  | 'primary' | 'secondary' | 'ghost' | 'destructive' | 'success' | 'inverse';
//                                                                       ↑ add 'tonal' here

const variantClasses: Record<ButtonVariant, string> = {
  primary:
    'bg-[var(--color-primary)] text-[var(--color-primary-foreground)] hover:bg-[var(--color-primary-hover)] hover:-translate-y-[1px] hover:shadow-md shadow-sm',
  secondary: 'bg-transparent text-[var(--color-text)] border border-[var(--color-border-strong)] hover:border-[var(--color-primary)] hover:text-[var(--color-primary)]',
  // …
};
```

**Loading + a11y pattern** (`Button.tsx:64–84`) — keep the `aria-busy={loading || undefined}` + `disabled || loading` pattern, plus the `<Loader2 className="size-4 animate-spin" aria-hidden />` swap. Counter-chip slot per CONTEXT.md D-01 is a NEW optional prop (e.g. `count?: number`) rendered as `<span>` after `children`; do NOT replace `leadingIcon`/`trailingIcon`.

**Focus-ring pattern** (`Button.tsx:24–25`) — keep verbatim; SC #3 forbids focus-ring regressions:
```typescript
'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-bg)]'
```

**IconButton (`Button.tsx:88–131`)** — sibling export; keep `aria-label` as a *required* prop (line 96 — the convention is documented in CLAUDE.md / `Conventions`).

---

### 5. `src/components/ui/Pill.tsx` — segmented control + count badge + icon-only

**Analog:** `Pill.tsx:4–44` (entire file).

**Existing pattern:**
```typescript
export interface PillProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  active?: boolean;
  size?: 'sm' | 'md';
  leadingIcon?: ReactNode;
}

export function Pill({ active, size = 'md', leadingIcon, className, children, ...rest }) {
  return (
    <button type="button" aria-pressed={active} className={cn(
      'inline-flex items-center gap-1.5 rounded-pill border font-medium transition-…',
      size === 'sm' ? 'h-8 px-3 text-[12px]' : 'h-10 px-4 text-[13px]',
      active
        ? 'bg-[var(--color-primary)] border-[var(--color-primary)] text-[var(--color-primary-foreground)] shadow-sm'
        : 'bg-[var(--color-surface-elevated)] border-[var(--color-border)] text-[var(--color-text)] hover:border-[var(--color-primary)]',
      className,
    )} {...rest}>
      {leadingIcon}
      {children}
    </button>
  );
}

export function PillGroup({ children, className, ...rest }) {
  return (
    <div role="group" className={cn('flex flex-wrap gap-1.5', className)} {...rest}>
      {children}
    </div>
  );
}
```

**Pattern to copy (D-01 widening per DS-07):**
- Add `count?: number | string` prop → render as right-aligned `<span>` chip (`ml-1.5 px-1.5 rounded-full text-[10px] bg-[var(--color-primary-soft)]` when inactive, inverted when active).
- Add `iconOnly?: boolean` → tighten to `aspect-square` + drop padding when true; keep `aria-label` requirement at the type level (TS conditional type) to enforce a11y, mirroring `IconButtonProps`.
- Add `disabled` styling — `Pill` doesn't have explicit disabled today; lean on Button's pattern (`disabled:pointer-events-none disabled:opacity-50`).
- **Segmented control** = `PillGroup` rendering wrapper with `role="tablist"` (already `role="group"`); add a `segmented?: boolean` opt-in that swaps to a joined-pill visual (`border-l-0` on non-first children, shared border-radius collapse). Single component file; no new exports beyond what fits naturally.

Consumer count = 3 files → safest place to widen aggressively.

---

### 6. `src/components/layout/Sidebar.tsx` — 72↔232 px instant snap + 200 ms inner fade

**Analog:** `Sidebar.tsx:39–100` (existing fixed 80 px sidebar with `motion.span layoutId="sb-active"` indicator).

**Existing fixed-positioning pattern** (line 48):
```typescript
<aside
  data-tour="nav"
  className="hidden md:flex fixed top-0 left-0 bottom-0 z-30 w-[80px] flex-col items-center py-5 bg-[var(--color-surface)] border-r border-[var(--color-border)] safe-top"
>
```

**Active-tab indicator pattern** (lines 89–94) — keep verbatim:
```typescript
{active && (
  <motion.span
    layoutId="sb-active"
    className="absolute inset-0 rounded-2xl bg-[var(--color-primary)] shadow-[0_4px_12px_rgba(27,72,66,0.25)]"
    transition={{ type: 'spring', damping: 22, stiffness: 320 }}
  />
)}
```

**Pattern to copy (DS-08 + D-12 + chat1.md landmine 1):**
- Add a `collapsed: boolean` store flag (or local `useState`).
- Render two **discrete** classes via attribute selectors: `data-sidebar="collapsed"` → `w-[72px]`, `data-sidebar="expanded"` → `w-[232px]`. **Do NOT** use `w-[var(--sidebar-w)] transition-[width]` — `var()` widths don't interpolate without `@property` registration (chat1.md hit this 4 rounds running). Comment in source: `// DO NOT use transition: width — see chat1.md landmine 1`.
- Inner content (labels, secondary icons) gets `transition-opacity duration-200 ease-out` + `opacity-0` when collapsed → 200 ms fade. The OUTER `<aside>` snaps width instantly (zero transition on width).
- Single consumer = `AppShell.tsx`; safe to add a toggle button prop or read from a new store flag.
- Preserve `data-tour="nav"` (used by `GuidedTour`).

---

### 7. `src/components/auth/AuthView.tsx` — restyle in place to split-screen (D-08)

**Analog:** `AuthView.tsx:50–85` (existing hash-routed sub-view shell).

**Existing pattern — keep routing + sub-form mounting verbatim:**
```typescript
export default function AuthView() {
  const [sub, setSub] = useState<AuthSub>(() => parseSub(window.location.hash));

  useEffect(() => {
    const onChange = (): void => setSub(parseSub(window.location.hash));
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);

  return (
    <div className="min-h-screen bg-[var(--color-bg)] text-[var(--color-text)]">
      {/* …Nav… */}
      <main className="max-w-[480px] mx-auto px-5 py-8 md:py-16">
        {sub === 'signup' && <SignUpForm />}
        {sub === 'signin' && <SignInForm />}
        {/* …other sub-views… */}
      </main>
    </div>
  );
}
```

**Pattern to copy (DS-04 + D-08 + chat1.md landmine 4):**
- Replace the `<main className="max-w-[480px]…">` wrapper with a split-screen layout:
  ```jsx
  <div className="auth h-screen overflow-hidden grid md:grid-cols-[1fr_minmax(0,520px)] grid-cols-1">
    <aside className="hidden md:flex items-center justify-center bg-[var(--color-hero-bg)] overflow-hidden">
      <LoginHero className="w-full max-w-[520px]" />
      {/* brand + headline (Fraunces accent) + testimonial card */}
    </aside>
    <main className="overflow-y-auto px-5 py-8 md:py-16">
      {/* segmented Sign in / Sign up tabs + existing sub-forms */}
    </main>
  </div>
  ```
- **Landmine 4:** Pin `h-screen` + `overflow-hidden` on the outer `.auth` div; only the form half gets `overflow-y-auto`. Without this, the hero half stretches.
- **D-17 / SC #5:** below `md:` breakpoint (`<768px`), the hero column hides (`hidden md:flex`) — form takes full width. ROADMAP says "form left, hero right" but CONTEXT.md flags the design bundle as form-right / hero-left — planner: follow the design bundle (`.planning/design-system/project/ui_kits/leanshot-marketing/login.html` etc.), the bundle is the visual source of truth per CONTEXT.md success_criteria_carry note.
- **Do NOT touch** `SignInForm.tsx`, `SignUpForm.tsx`, `parseSub`, `clearHashAndExit`, or the sub-route table. The restyle is purely layout/JSX around the same hash-driven sub-form mount. (Sign-in / sign-up segmented tabs become `<PillGroup segmented>` consuming the refreshed Pill.)
- Brand Zap-mark pattern at lines 67–71 — keep verbatim; same component is used in `Landing.tsx:55–58`.

---

### 8. `src/components/marketing/Landing.tsx` — token + illustration swap only

**Analog:** `Landing.tsx:1–80` (existing imports + section composition).

**Existing import + section-composition pattern (lines 1–41):**
```typescript
import { motion } from 'framer-motion';
import { ArrowRight, Sun, Moon, Check, Zap, Brain, ChartLine, Sparkles, ChevronDown, Shield, Lock } from 'lucide-react';
import { LegalFooter } from '@/components/layout/LegalFooter';
import { Button, IconButton } from '@/components/ui/Button';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { useTheme } from '@/hooks/useTheme';
import { AIAvatar } from '@/illustrations/AIAvatar';
import { ConnectData } from '@/illustrations/ConnectData';
import { HeroOrbital } from '@/illustrations/HeroOrbital';

export function Landing({ onStart }: LandingProps) {
  const { theme, toggle } = useTheme();
  return (
    <div className="min-h-screen bg-[var(--color-bg)] overflow-x-hidden">
      <Nav theme={theme} toggle={toggle} onStart={onStart} />
      <Hero onStart={onStart} />
      <Features />
      <Testimonials />
      <Pricing onStart={onStart} />
      <FAQ />
      <Footer />
    </div>
  );
}
```

**Pattern to copy (DS-03):** Keep section composition + import order (alphabetized within groups — enforced by `eslint-plugin-import-x`, see CLAUDE.md / Conventions). Swap illustration imports as their files are mutated (no import-line changes needed — same names). Token swap is automatic via CSS variables. No new sections, no structural redesign per CONTEXT.md `code_context`.

---

### 9. Illustrations — inline-JSX SVG (mutate 9, add ~10)

**Two primary analogs, depending on whether the illustration is animated:**

**Static empty-state analog** — `src/illustrations/EmptyInjections.tsx:1–64` (entire file; representative of `ConnectData`, `EmptyPhotos`, `EmptySymptoms`, `Vial`, `OnboardSteps`):
```typescript
/** Empty state — no injections logged yet. Hand + pen + radial sparkle. */
export function EmptyInjections({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 200 160"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      fill="none"
      aria-hidden
    >
      <defs>
        <linearGradient id="ej-pen" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="var(--color-primary)" stopOpacity="0.18" />
          <stop offset="100%" stopColor="var(--color-primary)" stopOpacity="0.04" />
        </linearGradient>
      </defs>
      {/* radial spark */}
      <g stroke="var(--color-text-tertiary)" strokeLinecap="round" opacity="0.5"> … </g>
      {/* pen body */}
      <g transform="rotate(-22 110 80)"> … </g>
    </svg>
  );
}
```

**Animated/sized analog** — `src/illustrations/AIAvatar.tsx:1–53` (entire file; representative of any illustration with motion or a `size` prop — `HeartPulse`, `ActivityRings`, `LoginHero`):
```typescript
import { useReducedMotion } from '@/hooks/useReducedMotion';

export interface AIAvatarProps {
  size?: number;
  className?: string;
  thinking?: boolean;
}

export function AIAvatar({ size = 56, className, thinking }: AIAvatarProps) {
  const reduced = useReducedMotion();
  const animate = thinking && !reduced;
  return (
    <svg width={size} height={size} viewBox="0 0 56 56" xmlns="http://www.w3.org/2000/svg"
         className={className} fill="none" aria-hidden>
      <defs>
        <radialGradient id="aiav-core" cx="0.5" cy="0.4" r="0.6">
          <stop offset="0%" stopColor="var(--color-text-on-hero)" stopOpacity="0.95" />
          <stop offset="100%" stopColor="var(--color-primary)" />
        </radialGradient>
      </defs>
      <circle cx="28" cy="28" r="26" stroke="url(#aiav-ring)" strokeWidth="0.8" opacity="0.6" />
      <circle cx="28" cy="28" r="16" fill="url(#aiav-core)"
              className={animate ? 'animate-pulse-soft' : undefined}
              style={animate ? { transformOrigin: '28px 28px' } : undefined} />
    </svg>
  );
}
```

**Hero-scale `staticOnly` opt-out analog** — `src/illustrations/HeroOrbital.tsx:10–18`:
```typescript
export interface HeroOrbitalProps {
  className?: string;
  /** Force-disable motion (e.g. for the public marketing hero where parallax owns the motion). */
  staticOnly?: boolean;
}
export function HeroOrbital({ className, staticOnly }: HeroOrbitalProps) {
  const reduced = useReducedMotion();
  const motion = !reduced && !staticOnly;
  // …
}
```

**Discriminated-tier analog (for `StreakBronze/Silver/Gold/Locked` per DS-10)** — `src/illustrations/StreakBadge.tsx:10–22`:
```typescript
interface BadgeProps {
  variant: '7d' | '30d' | '90d';
  className?: string;
  locked?: boolean;
}
export function StreakBadge({ variant, className, locked }: BadgeProps) {
  const fill   = locked ? 'var(--color-surface-elevated)' : 'var(--color-primary-soft)';
  const stroke = locked ? 'var(--color-border-strong)'    : 'var(--color-primary)';
  const text   = locked ? 'var(--color-text-tertiary)'    : 'var(--color-primary)';
  // …
}
```

**Pattern to copy for every new illustration:**
1. `import { useReducedMotion } from '@/hooks/useReducedMotion';` only if animated.
2. Named function export (NOT default) — matches every existing illustration.
3. Props interface: `size?: number` (when fixed-aspect; default in destructure) OR `className?: string` alone (when free-scaling via viewBox). Always optional.
4. `<svg viewBox="…" xmlns="http://www.w3.org/2000/svg" className={className} fill="none" aria-hidden>` — **`aria-hidden` is mandatory** (CLAUDE.md / Accessibility Conventions).
5. All colors via `var(--color-*)` — never hex (CLAUDE.md Anti-Pattern: "Hard-coding colors in components").
6. `<defs>` with gradient `id`s prefixed by a short component slug (`aiav-`, `ej-`, `hero-`, `cd-`) to avoid `id` collisions when multiple instances mount.
7. Animation: `useReducedMotion()` gate; apply `animate-*` class only when motion is allowed; set `transformOrigin` inline `style` (matching `AIAvatar.tsx:47`).
8. Decision per DS-10: either 4 files (`StreakBronze.tsx`, `StreakSilver.tsx`, `StreakGold.tsx`, `StreakLocked.tsx`) or one `StreakBadge.tsx` with a widened `tier: 'bronze' | 'silver' | 'gold' | 'locked'` discriminated union — CONTEXT.md D-03 says "planner's call." Locked-state styling pattern (token-swap based on a boolean prop) is already proven in `StreakBadge.tsx:19–21` — reuse the trinary `fill/stroke/text` token-map approach.

**File naming:** `PascalCase.tsx`, primary export matches filename, one component per file (CLAUDE.md Naming Conventions).

---

### 10. Playwright visual-regression specs — `tests/visual/*.spec.ts` (NEW, 12 files)

**Analog:** `e2e/clinic-ad-free.spec.ts:36–60` (existing `@playwright/test` spec convention) + `playwright.config.ts:9` `testMatch: /.*\.spec\.ts$/` glob.

**Existing spec header + import pattern** (`clinic-ad-free.spec.ts:36–48`):
```typescript
import { expect, test } from '@playwright/test';

const AD_PROVIDER_ORIGINS: readonly string[] = [
  'googletagservices.com',
  // …
];
```

**`testMatch` constraint** (`playwright.config.ts:9`):
```typescript
testMatch: /.*\.spec\.ts$/,
```
→ New files **must** end in `.spec.ts` (not `.test.ts` — Vitest naming would not be discovered by Playwright). VR specs likely live under `tests/visual/` per CONTEXT.md D-05; ensure that path either matches `testDir: './e2e'` of `playwright.config.ts:4` (i.e., move `testDir` to `'.'` or add a `testDir` override) OR places them under `e2e/visual/*.spec.ts`. **Planner decision needed:** widen `testDir` to `.` and rely on `testMatch`, OR put VR specs under `e2e/visual/`. The latter is the smaller diff.

**Pattern to copy for each of the 12 specs:**
```typescript
import { expect, test } from '@playwright/test';

test('Landing — light theme', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  // Wait for font + illustration paint to settle before snapshot
  await page.waitForFunction(() => document.fonts.ready);
  await expect(page).toHaveScreenshot('landing-light.png', { maxDiffPixelRatio: 0.01 });
});
```

- `maxDiffPixelRatio: 0.01` (1 % fuzziness) per CONTEXT.md D-04 for font subpixel tolerance.
- Snapshots stored at `tests/visual/__screenshots__/` (or `e2e/visual/__screenshots__/`) and committed.
- CI Linux is the baseline; the Playwright `chromium` project in `playwright.config.ts:16–21` is the only project — single-baseline.
- Dark-theme snapshots: `await page.emulateMedia({ colorScheme: 'dark' })` OR programmatically set `document.documentElement.setAttribute('data-theme', 'dark')` via `addInitScript` (matches `reference_playwright_state_seeding.md` — use `addInitScript`, never seed via `goto + evaluate + reload`).
- Reduced-motion thinking-state for AIChatPanel snapshot (`#12`): `await page.emulateMedia({ reducedMotion: 'reduce' })` so the pulse animation falls back to its static frame deterministically.

The 12 surfaces are enumerated verbatim in CONTEXT.md D-05 #1–12.

---

### 11. CI Lighthouse FCP gate — extend existing `lighthouse:` job in `.github/workflows/ci.yml`

**Analog:** `.github/workflows/ci.yml:443–473` (existing `lighthouse:` job using `wait-for-vercel-preview` + `@lhci/cli@0.15.1 autorun`).

**Existing pattern:**
```yaml
lighthouse:
  name: Lighthouse (Vercel preview)
  runs-on: ubuntu-latest
  needs: [lint, format-check, typecheck, test-unit, test-e2e, compliance-copy, deno-test]
  if: github.event_name == 'pull_request'
  steps:
    - uses: actions/checkout@v4
    - name: Wait for Vercel preview deployment
      id: wait
      uses: patrickedqvist/wait-for-vercel-preview@v1.3.2
      with:
        token: ${{ secrets.GITHUB_TOKEN }}
        max_timeout: 300
        check_name: 'leanshot-app – Vercel'
    - uses: actions/setup-node@v4
      with:
        node-version: '22'
        cache: 'npm'
        cache-dependency-path: leanshot/package-lock.json
    - run: npm ci
    - name: Run Lighthouse against Vercel preview
      run: npx --yes @lhci/cli@0.15.1 autorun --collect.url=${{ steps.wait.outputs.url }}
      env:
        LHCI_BUILD_CONTEXT__CURRENT_HASH: ${{ github.sha }}
```

**Existing LHCI assertion config** — `lighthouserc.json` (entire file):
```json
{
  "ci": {
    "collect": { "numberOfRuns": 3, "settings": { "preset": "desktop" } },
    "assert": {
      "assertions": {
        "categories:performance": ["error", { "minScore": 0.9 }],
        "categories:accessibility": ["error", { "minScore": 0.9 }],
        "categories:best-practices": ["error", { "minScore": 0.9 }]
      }
    },
    "upload": { "target": "temporary-public-storage" }
  }
}
```

**Pattern to copy (D-07 — Phase 13 FCP gate):**
- Option A — extend `lighthouserc.json` `assertions`: add `"first-contentful-paint": ["error", { "maxNumericValue": <baseline_ms * 1.05> }]` and `"largest-contentful-paint": ["error", { "maxNumericValue": <baseline_ms * 1.05> }]` (per D-07: LCP gate added defensively for paper-grain noise overlay risk). **Drawback:** baseline value is hardcoded → no per-PR delta calc; only an absolute ceiling.
- Option B — new step that runs LHCI twice (once on `main` HEAD's preview URL, once on PR head's preview URL) and asserts a `≤5%` delta in shell, similar to the pattern at lines 150–172 (`assert-bundle-budget.sh`). **More accurate to D-07's "≤5% of baseline" SC.** Plan should ship the baseline as `.planning/phases/13-design-system-v2-rollout/13-FCP-BASELINE.json` (sample: `{ "fcp_ms": 1450, "lcp_ms": 1800, "captured_sha": "<pre-PR-1-merge-sha>", "captured_at": "2026-…" }`), and a `scripts/assert-fcp-delta.sh` consumer that reads that file and compares to LHCI output.
- Either way: the new step is appended to the existing `lighthouse:` job — same `needs:`, same `wait-for-vercel-preview` step, same `actions/setup-node@v4` block. **Do not** create a new top-level job — match Phase 12 D-12's "append to existing job" pattern observed at lines 150–172.

---

### 12. CI VR step — extend `test-e2e:` job

**Analog:** `.github/workflows/ci.yml:79–172` (existing `test-e2e:` job with appended `assert-*.sh` steps + the precedent for tacking on additional named guards).

**Existing additive-step pattern** (lines 150–172) — three named guards appended in sequence:
```yaml
- name: Assert vendor-react chunk size (SC#2 — Phase 2.1 regression guard)
  run: bash scripts/assert-vendor-react-size.sh

- name: Assert bundle budget (jspdf chunk topology — Phase 7 COMPL-06 guard)
  run: bash scripts/assert-bundle-budget.sh

- name: Hash-hyphen regression test (Phase 12 D-13)
  run: bash scripts/test-hash-hyphen-regression.sh
```

**Pattern to copy (D-04 + D-05):** Append a new named step inside `test-e2e:` after the existing Playwright run:
```yaml
- name: Visual regression suite (Phase 13 D-04/D-05 — 12 snapshots)
  run: npx playwright test tests/visual  # or e2e/visual, per testDir decision
```
The existing `test-e2e:` job already does `npx playwright install chromium --with-deps` (line 92) — VR specs reuse that install. Snapshots committed under `tests/visual/__screenshots__/` are checked-in; CI diff-fails on drift. The opt-in `--update-snapshots` (D-04) happens locally on a labeled re-run, never automatically in CI.

---

## Shared Patterns

### A. CSS-variable color tokens (NEVER hex literals in components)

**Source:** `src/index.css:11–158` + `[data-theme=dark]` block lines 158–203 (cited above).
**Apply to:** Every component and illustration touched in Phase 13.

**Rule** (CLAUDE.md "Anti-Patterns / Hard-coding colors in components"): All fills/strokes/borders reference `var(--color-*)`. Card.tsx, Button.tsx, Pill.tsx, Sidebar.tsx already comply — preserve that compliance through the refresh. New illustrations follow `EmptyInjections.tsx` (uses `var(--color-primary)`, `var(--color-text-tertiary)`) and `AIAvatar.tsx` (uses `var(--color-text-on-hero)`, `var(--color-primary-soft)`). Hex literals appear ONLY inside the `@theme` and `[data-theme=dark]` blocks of `src/index.css`.

### B. `cn()` class composition

**Source:** `src/lib/helpers.ts` (helper) + every UI primitive's import line (e.g., `Card.tsx:2`, `Button.tsx:3`, `Pill.tsx:2`).
**Apply to:** Every UI primitive being refreshed.

**Pattern** — variant table + `cn(baseClasses, sizeClasses[size], variantClasses[variant], className)` composition order. Custom `className` from consumers always wins (`cn()` puts it last → Tailwind cascade wins on equal specificity). When widening unions, append to the variant table; do not interleave.

### C. `useReducedMotion()` gating for any animated illustration

**Source:** `src/hooks/useReducedMotion.ts:1–24` (verbatim above) + consumer pattern at `AIAvatar.tsx:15–17` / `HeroOrbital.tsx:17–18`.
**Apply to:** New `ActivityRings`, `HeartPulse`, `LoginHero` (any illustration that animates), plus the refreshed `AIAvatar`.

**Pattern:**
```typescript
const reduced = useReducedMotion();
const animate = motionCondition && !reduced;  // e.g., thinking && !reduced
// …apply animate-* className conditionally
```

The hook is reactive (subscribes to `matchMedia('change')` per `useReducedMotion.ts:15–19`), so consumers don't need their own effect.

### D. `aria-hidden` on every decorative SVG

**Source:** Every existing illustration's `<svg>` tag (e.g., `AIAvatar.tsx:25`, `HeroOrbital.tsx:27`, `StreakBadge.tsx:29`, `EmptyInjections.tsx:9`).
**Apply to:** All new illustrations.

CLAUDE.md Accessibility Conventions explicitly requires `aria-hidden` on decorative ornaments. Loud illustrations like `LoginHero` are still decorative — semantic meaning is carried by adjacent headline text, not the SVG.

### E. Focus-ring tokenization

**Source:** `Button.tsx:24–25`, `Pill.tsx:23`, `Sidebar.tsx:83` — identical pattern across primitives.
**Apply to:** Every refreshed interactive primitive (Card.tsx `clickable` variant must adopt this; net-new `iconOnly` Pill must preserve it).

**Pattern (verbatim):**
```
focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-bg)]
```

SC #3 forbids focus-ring regressions. Any change to this string is a regression by definition — only the *applied target* may change (e.g., adding it to Card's `clickable` variant). The token `--color-primary` automatically inherits the v2 teal shift through D-02.

### F. Import order (alphabetized by `eslint-plugin-import-x`)

**Source:** `Landing.tsx:1–22`, `AuthView.tsx:15–22`, `Sidebar.tsx:1–20`.
**Apply to:** Every new + mutated file.

Three-group ordering enforced by `eslint-plugin-import-x` (per CLAUDE.md Configuration): (1) third-party packages (alphabetized), (2) `@/...` aliased internal imports (alphabetized), (3) sibling relative imports (alphabetized). Run `npm run lint:fix` before commit — the rule auto-fixes.

### G. Single-export-per-file (PascalCase matching filename)

**Source:** CLAUDE.md Naming Conventions; observed in every illustration + UI primitive.
**Apply to:** All new illustrations.

`PenInjector.tsx` exports `PenInjector` as a named export. Co-located helpers OK (e.g., `Card.tsx` exports `Card` + `CardHeader` + `StatTile` — same domain), but the **primary** export matches the filename. No default exports (the project convention is named).

### H. Token-driven shadows (warm tint per v2)

**Source:** `src/index.css:196–202` (dark) — every shadow has a re-declared dark value; the light block has matching `--shadow-*` token names (need to scan lines ~145–158 for the light defaults).
**Apply to:** Every refreshed primitive that uses `shadow-[var(--shadow-*)]`.

D-02 widens light-mode shadow tint to `rgba(40,32,20,…)` (warm tinted). Cards/Buttons already reference `var(--shadow)`, `var(--shadow-md)`, etc., so the swap is automatic once `src/index.css` updates — **no class-string edits needed in Card.tsx / Button.tsx for the shadow change**. This is one of the strongest token-driven wins; do not duplicate shadow logic in `className` strings.

---

## No-Analog Files

None. Phase 13 is entirely a refresh of in-place files + net-new illustrations (which all mirror an existing illustration pattern) + new Playwright VR specs (which mirror `e2e/clinic-ad-free.spec.ts`). No file in this phase lacks a strong analog in the codebase.

---

## Metadata

**Analog search scope:**
- `src/index.css` (Tailwind v4 `@theme` block + dark override + base reset, lines 1–250)
- `src/components/ui/` (Card, Button, Pill, Sheet — first 3 read in full; Sheet not refreshed)
- `src/components/layout/Sidebar.tsx` (lines 1–100; rest is the same pattern continuing)
- `src/components/auth/AuthView.tsx` (full file) + `SignInForm.tsx` (lines 1–80 for restyle context)
- `src/components/marketing/Landing.tsx` (lines 1–80 for top-level composition)
- `src/illustrations/` — `AIAvatar.tsx`, `HeroOrbital.tsx`, `EmptyInjections.tsx`, `StreakBadge.tsx`, `ConnectData.tsx` (read in full or near-full)
- `src/hooks/useReducedMotion.ts` (full file)
- `playwright.config.ts` (full file)
- `e2e/clinic-ad-free.spec.ts` (lines 1–60 for header/import convention)
- `tests/csp/csp-snapshot.test.ts` (full file — reference for vitest spec naming only)
- `lighthouserc.json` (full file)
- `scripts/assert-bundle-budget.sh` (full file — pattern for additive CI guard scripts)
- `.github/workflows/ci.yml` (lines 1–100, 130–180, 440–474 — additive-step pattern + Lighthouse job)
- `index.html` (lines 1–47 — font preload block)
- `package.json` (lines 1–50 — confirmed `@lhci/cli@0.15.1` + `@playwright/test@1.59.1` already wired)

**Pattern extraction date:** 2026-05-13
**Total files scanned:** 16 primary + ~5 secondary (illustration siblings sampled)

---

## PATTERN MAPPING COMPLETE

**Phase:** 13 — Design System v2 Rollout
**Files classified:** 28 (counting each new/mutated illustration individually + each VR spec)
**Analogs found:** 28 / 28

### Coverage
- Files with exact analog (self-mutate or sibling illustration): 28
- Files with role-match analog (CI/test): 0 additional (already counted above)
- Files with no analog: 0

### Key patterns identified
- **Tailwind v4 `@theme` block in `src/index.css` is value-stable for plumbing — token swap is a `git diff` of the values inside the existing structure**, not a rewrite.
- **All UI primitives use a `Record<Variant, string>` table** (`Card.tsx`, `Button.tsx`, `Pill.tsx`); widening = appending entries, not refactoring.
- **All illustrations are inline JSX with `aria-hidden`, `var(--color-*)` fills, and optional `useReducedMotion()` gating** — net-new components literally copy the shape of `AIAvatar.tsx` / `EmptyInjections.tsx` / `HeroOrbital.tsx` / `StreakBadge.tsx`.
- **Two CI extension patterns already proven in the codebase**: (a) append a named `bash scripts/assert-*.sh` step to `test-e2e:` (lines 150–172); (b) extend `lhci/cli@0.15.1 autorun` assertions inside the existing `lighthouse:` job (lines 443–473). Phase 13 uses both.
- **Playwright spec convention is strict**: `testMatch: /.*\.spec\.ts$/` + `testDir: './e2e'` per `playwright.config.ts`. Visual specs must end `.spec.ts` AND live under a directory the Playwright config sees (planner: widen `testDir` or place under `e2e/visual/`).
- **`AuthView.tsx`'s hash-routing logic is untouched by D-08**; restyle is purely JSX layout swap inside the existing `<main>` shell + new split-screen wrapper.

### File created
`/Users/karstenhaldan/minisite/leanshot/.planning/phases/13-design-system-v2-rollout/13-PATTERNS.md`

### Ready for planning
Pattern mapping complete. Planner can reference per-file analog excerpts directly when writing the PR-1 (tokens + fonts + FCP gate) and PR-2 (components + illustrations + login + marketing + VR suite) plans.
