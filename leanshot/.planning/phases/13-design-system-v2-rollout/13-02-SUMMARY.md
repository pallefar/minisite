---
phase: 13-design-system-v2-rollout
plan: 02
subsystem: ui-primitives
tags: [design-system, card, button, pill, sidebar, appshell, ds-05, ds-06, ds-07, ds-08, d-01, d-12, d-15]
requires:
  - 13-01 (tokens + font + warm shadows + primary-soft / primary-foreground / sheen tokens live)
provides:
  - Card.variant: 'selected' | 'clickable' | 'tonal' | 'footer'  # additive on top of default/elevated/interactive/hero/flat
  - Button.variant: 'tonal'
  - Button.count: number | string  # decorative right-aligned chip
  - Pill.count: number | string
  - Pill.iconOnly: boolean
  - Pill (consumer): disabled visual styling via disabled:opacity-50
  - PillGroup.segmented: boolean  # joined-pill + role="tablist"
  - Sidebar.collapsed: boolean  # 72px collapsed / 232px expanded
  - Sidebar.onToggleCollapsed: () => void
  - Sidebar emits data-sidebar="collapsed|expanded" on <aside>
  - Sidebar emits ChevronsLeft / ChevronsRight toggle buttons
  - AppShell main left-margin tracks sidebar collapsed state
affects:
  - All 38 Card consumers (silently — defaults unchanged)
  - All 57 Button consumers (silently — focus ring + aria-busy + disabled||loading preserved verbatim)
  - All 3 Pill consumers (silently — active/size/leadingIcon preserved)
  - GuidedTour (data-tour="nav" preserved)
tech_stack:
  added: []  # no new deps; lucide-react already in stack — using ChevronsLeft/ChevronsRight imports
  patterns:
    - Tailwind v4 `cn()` ternary for collapsed/expanded width (no `data-[*]:w-*` arbitrary variants in v4-beta)
    - useReducedMotion()-gated transition-opacity duration-200 ease-out for inner-content fades
    - Pathspec commits (`git commit -- <file>`) for parallel-executor index isolation
key_files:
  created: []
  modified:
    - leanshot/src/components/ui/Card.tsx
    - leanshot/src/components/ui/Button.tsx
    - leanshot/src/components/ui/Pill.tsx
    - leanshot/src/components/layout/Sidebar.tsx
    - leanshot/src/components/layout/AppShell.tsx
decisions:
  - "Sidebar width snap uses Tailwind discrete `w-[72px]` / `w-[232px]` toggled by cn() ternary on `collapsed` — NO `transition: width`, NO `transition-[width` per chat1.md landmine 1."
  - "AppShell outer <div> stays a plain block (no `display:flex` added) per chat1.md landmine 3."
  - "Button chip swap on dark variants (primary/destructive/success) → bg-white/20 + primary-foreground text; soft variants (tonal/secondary/ghost/inverse) → primary-soft + primary text."
  - "Pill iconOnly enforcement is JSDoc + jsx-a11y lint-time (NOT a conditional type) to keep refresh-in-place pragmatic — matches plan Task 3 pragmatic choice."
  - "PillGroup `segmented` swaps role to 'tablist' and collapses to `inline-flex` with sibling-selector border collapse; non-segmented branch keeps `flex flex-wrap` + role='group' verbatim."
metrics:
  tasks_total: 4
  tasks_completed: 4
  files_modified: 5
  files_created: 0
  test_files_added: 0
  vitest_pass: 750
  vitest_skip: 6
  vitest_fail: 0
  index_chunk_gz_kb: 13.17
  index_chunk_ceiling_gz_kb: 50.0
  bundle_guard: pass
  completed_date: 2026-05-13
---

# Phase 13 Plan 13-02: UI primitive refresh — Card / Button / Pill / Sidebar / AppShell

**One-liner:** Additive widening of Card / Button / Pill plus a 72↔232 px Sidebar instant-snap with 200 ms inner fade — chat1.md landmines 1 + 3 explicitly avoided, all 750 vitest tests pass, index chunk gz 13.17 kB (50 kB ceiling).

## Files Modified

| File | Before → After | Why |
|------|---------------|-----|
| `src/components/ui/Card.tsx` | `CardVariant` 5 → 9 members; `variantClasses` table extended with selected / clickable / tonal / footer | DS-05 + D-01 (refresh-in-place additive) |
| `src/components/ui/Button.tsx` | `ButtonVariant` 6 → 7 members (`tonal` appended); `ButtonProps.count?: number \| string` chip slot wired between `<span>{children}</span>` and trailingIcon branch | DS-06 + D-01 |
| `src/components/ui/Pill.tsx` | `PillProps` gains `count`, `iconOnly`; container gains `disabled:opacity-50` + iconOnly aspect-square branch; `PillGroup` widens to `PillGroupProps` with optional `segmented` boolean + `role="tablist"` switch | DS-07 + D-01 |
| `src/components/layout/Sidebar.tsx` | `SidebarProps` gains `collapsed?: boolean` + `onToggleCollapsed?: () => void`; `<aside>` width switches between `w-[72px]` (collapsed centered) and `w-[232px] px-3` (expanded items-stretch); inner labels/wordmark/account-name carry `transition-opacity duration-200 ease-out` gated by `useReducedMotion()`; ChevronsLeft top-right when expanded, ChevronsRight bottom when collapsed; data-tour="nav" preserved; motion.span layoutId="sb-active" preserved | DS-08 + D-12 + chat1.md landmine 1 |
| `src/components/layout/AppShell.tsx` | Adds internal `const [sidebarCollapsed, setSidebarCollapsed] = useState(false)` next to `sheetOpen`; passes `collapsed`/`onToggleCollapsed` to `<Sidebar>`; `<main>`'s `md:ml-[80px]` swapped for `cn()` ternary `md:ml-[72px]` / `md:ml-[232px]`; outer `<div>` stays a plain block — NO `display:flex` added | D-12 + D-15 (no layout shift) + chat1.md landmine 3 |

## Variant Unions — Before / After

### Card.tsx
```ts
// Before
export type CardVariant = 'default' | 'elevated' | 'interactive' | 'hero' | 'flat';
// After
export type CardVariant =
  | 'default' | 'elevated' | 'interactive' | 'hero' | 'flat'
  | 'selected' | 'clickable' | 'tonal' | 'footer';
```
Existing 5 entries in `variantClasses` are byte-stable. 4 new entries appended below `flat:`.

### Button.tsx
```ts
// Before
export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'destructive' | 'success' | 'inverse';
// After
export type ButtonVariant =
  | 'primary' | 'secondary' | 'ghost' | 'destructive' | 'success' | 'inverse'
  | 'tonal';
```
New `count?: number | string` chip wired between children and trailingIcon. Chip auto-inverts on primary/destructive/success.

### Pill.tsx
```ts
// Before
export interface PillProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  active?: boolean; size?: 'sm' | 'md'; leadingIcon?: ReactNode;
}
// After (additive)
export interface PillProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  active?: boolean; size?: 'sm' | 'md'; leadingIcon?: ReactNode;
  count?: number | string;   // DS-07
  iconOnly?: boolean;        // DS-07
}
// PillGroup widened to PillGroupProps with `segmented?: boolean`
```

### Sidebar.tsx
```ts
// Before
interface SidebarProps { onOpenAI: () => void; onOpenSettings: () => void; }
// After
interface SidebarProps {
  onOpenAI: () => void; onOpenSettings: () => void;
  collapsed?: boolean;          // DS-08
  onToggleCollapsed?: () => void;
}
```

## Preserved Invariants

- `data-tour="nav"` is still on the `<aside>` (GuidedTour reads it). Confirmed via `grep -E 'data-tour="nav"' src/components/layout/Sidebar.tsx` → matches.
- `motion.span layoutId="sb-active"` retained on the active tab (framer animates between the size-12 collapsed shape and the h-12-w-full expanded shape — that's `layoutId`'s job).
- `aria-busy={loading || undefined}` and `disabled={disabled || loading}` are preserved verbatim on Button.tsx.
- `aria-pressed={active}` is preserved on Pill `<button>`.
- `<Loader2 className="size-4 animate-spin" aria-hidden />` preserved verbatim.
- Button `baseClasses` focus-ring substring (`focus-visible:ring-2 ring-[var(--color-primary)] ring-offset-2 ring-offset-[var(--color-bg)]`) is unchanged.
- `CardHeader`, `StatTile`, `IconButton` exports — untouched.

## chat1.md Landmine Audit

**Landmine 1 (CSS-variable interpolation):** `grep -E "transition:\s*width|transition-\[width" src/components/layout/Sidebar.tsx` → **zero matches** (verified post-commit). The Sidebar `<aside>` width is a discrete-class snap; the only transitions in the file are `transition-opacity duration-200 ease-out` (gated by `useReducedMotion()`) and `transition-colors` / `transition-transform` on individual buttons.

**Landmine 3 (flex + fixed sidebar):** AppShell outer `<div>` className is `"min-h-screen bg-[var(--color-bg)] text-[var(--color-text)]"` — no `display:flex` added. Sidebar stays `position: fixed`. `<main>` left-margin is a class-name swap, NOT `style={{ marginLeft: ... }}` with a `var()`.

The node-script flex check from the plan's `<verify>` block:
```
node -e '... if(/\bflex\b/.test(cls)&&!/flex-col/.test(cls)){FAIL} ...'
# → OK: outer AppShell wrapper div has no flex class
```

## No-Layout-Shift Audit (D-15 / SC #3)

- Card: existing 5 variants' class strings unchanged (byte-stable). 4 new variants only fire when a consumer opts in via `variant="selected"|"clickable"|"tonal"|"footer"`.
- Button: `h-8/h-11/h-13` and `px-3/px-5/px-7` size scale unchanged. `tonal` uses the same size scale. Chip adds intrinsic width only when `count !== undefined`.
- Pill: `h-8/h-10` height scale unchanged. iconOnly only applies when consumer opts in. Disabled styling adds visual-only state; no size shift.
- Sidebar: collapsed-width is 72 px (8 px narrower than the previous 80 px). AppShell `<main>` left margin updated to match (`md:ml-[80px]` → `md:ml-[72px]` on collapsed). Expanded-width 232 px pushes content right; acceptable per plan no-layout-shift audit (user-opt-in).

## Bundle / Type / Lint / Test Results

| Check | Result |
|-------|--------|
| `npx tsc -b` (full project) | exits 0 |
| `npx eslint src/components/ui/Card.tsx` | exits 0 |
| `npx eslint src/components/ui/Button.tsx` | exits 0 |
| `npx eslint src/components/ui/Pill.tsx` | exits 0 |
| `npx eslint src/components/layout/Sidebar.tsx src/components/layout/AppShell.tsx` | exits 0 |
| `npm run build` | exits 0 (3.75s) |
| `bash scripts/assert-bundle-budget.sh` | pass (`jspdf bundle topology OK: 2 chunk(s), total gz 137300 bytes; index chunk free of jsPDF identifier`) |
| `npx vitest run` | **750 passed / 6 skipped / 0 failed** |
| Index chunk gz | **13.17 kB** (ceiling 50 kB — plenty of headroom for 13-03/13-04/13-05/13-06) |
| Vendor-motion gz | 37.87 kB (unchanged — no new framer-motion APIs introduced) |
| Vendor-icons gz | 7.84 kB (+ChevronsLeft/ChevronsRight icons; minimal delta) |

## Bundle Delta vs Pre-13-02 Baseline

Index chunk size: 13.17 kB gz at HEAD. The plan budget of 50 kB has substantial headroom; the new ChevronsLeft + ChevronsRight icons add a few hundred bytes to `vendor-icons` (7.84 kB gz). No consumer routes saw chunk regressions.

## Deviations from Plan

### Rule 1 — Doc-string vs grep gate reconciliation

The plan's Task 4 step 2 instructed me to bake a verbatim comment block above the width class containing the substring `\`transition: width\``. The plan's `<verify>` block then requires `! grep -E "transition:\s*width|transition-\[width" src/components/layout/Sidebar.tsx` — which would match the literal comment.

**Resolution:** I rewrote the comment to say "DO NOT animate the width property here" (semantically equivalent) so the verify grep passes while preserving the landmine-1 warning verbatim in spirit. The `chat1.md landmine 1` reference is fully preserved in both the file header comment block and the inline comment.

This is a **Rule 1 bug fix**: the plan's two requirements were mutually incompatible if read verbatim; the grep gate is the load-bearing acceptance criterion (mechanically verifiable), and the comment intent is preserved exactly. Documented here so 13-04/13-06 maintainers understand the precedent.

### Rule 2 — Cleanup pass on existing patterns

While refactoring Sidebar, I made two non-required-but-correctness improvements:

1. **Brand SVG `aria-hidden`** — the existing SVG was unmarked, and the parent button already has `aria-label="LeanShot home"`, so the SVG decorative status is correct (chat1 wave-1 inheritance + accessibility correctness). Same pattern applies to the new wordmark `<span>` and the user-initial avatar's inner glyph: both `aria-hidden` because the parent buttons carry the accessible name.

2. **Footer cluster label expansion** — the plan said "labels appear next to AI / theme / settings buttons when expanded; account-initial avatar grows from `size-10` to a row with `size-10` avatar + name `<span>`". I implemented the label text as: AI → "Ask LeanShot AI"; theme → "Dark mode" / "Light mode" (matches the existing aria-label string); settings → "Settings"; account → `user.name ?? 'Profile'` (per plan fallback note). All `aria-label` strings on the buttons are unchanged (still serve as the screen-reader name; the inline span is duplicate-text-but-aria-hidden-on-the-icon-only-side, so SRs read the aria-label).

Neither is a behavioral change to existing consumers — both improve the expanded-state UX without regressing collapsed-state behavior.

### Note: Required commit-message pathspec syntax

The plan's per-task `git add X && git commit -- X -m "msg"` syntax is rejected by git: `--` ends option parsing, so pathspecs must come after `-m "msg"`. Adjusted to `git commit -m "msg" -- <pathspec>` per the Git docs. Pathspec discipline (parallel-executor index isolation rule) is preserved.

## Hand-off Notes

### For 13-03 (illustrations + consumer wiring) — running in parallel right now
- This plan touched only the 5 files in `key_files.modified`. No `src/illustrations/*`, no `AIChatPanel.tsx`, no `Topbar.tsx`, no `OnboardingFlow.tsx`, no `StreaksCard.tsx`, no `ShareCardModal.tsx`, no `SiteRotationCard.tsx`. Zero overlap with 13-03's pathspec. Index contamination cannot occur on merge.

### For 13-04 (login restyle)
- Use `<PillGroup segmented>` for the Sign in / Sign up tab strip. Pills inside it will receive joined-pill borders + `role="tablist"` automatically.
- For "remember me" / option toggles, use `<Pill iconOnly aria-label="...">` — JSDoc enforces aria-label at consumer-level via jsx-a11y.

### For 13-06 (visual regression suite)
- Sidebar exposes a stable Playwright selector: `[data-sidebar="collapsed"]` vs `[data-sidebar="expanded"]`. Drive both states deterministically.
- ChevronsLeft (collapse, top-right of expanded sidebar) and ChevronsRight (expand, bottom of collapsed sidebar) carry `aria-label="Collapse navigation"` / `"Expand navigation"` — Playwright can `page.getByRole('button', { name: 'Collapse navigation' })`.
- 200 ms opacity fade timing: gate VR captures behind `reduced-motion: reduce` to stabilize screenshots, OR sleep ≥250 ms after toggling state.

### For 13-05 (anything that needs the new variants)
- New Card variants: `selected` (multi-select rows), `clickable` (focusable div-as-button cards), `tonal` (AI insight surfaces), `footer` (action rows inside compound cards).
- New Button variant: `tonal` (grouped/secondary CTA — primary-soft bg + primary text).
- New Button prop: `count` (decorative chip — count semantic must live in the surrounding label/aria-label).

## Commits (this plan's branch)

| Task | Commit | Message |
|------|--------|---------|
| 1 | `896bd60` | feat(13-02): widen CardVariant with selected/clickable/tonal/footer (DS-05, D-01) |
| 2 | `48192a6` | feat(13-02): Button tonal variant + count chip slot (DS-06, D-01) |
| 3 | `7876c8b` | feat(13-02): Pill count + iconOnly + disabled + PillGroup segmented (DS-07, D-01) |
| 4 | `72af1d8` | feat(13-02): Sidebar instant 72-232px snap + 200ms inner fade (DS-08, D-12, chat1 landmines 1+3) |

## Success Criteria

- [x] DS-05 satisfied: Card has 4 additive variants on top of the existing 5 (total 9).
- [x] DS-06 satisfied: Button has `tonal` variant + `count` chip slot; aria-busy / loading / disabled wiring preserved verbatim; focus ring tokenization unchanged.
- [x] DS-07 satisfied: Pill has count chip + iconOnly + disabled styling; PillGroup has segmented opt-in with role="tablist".
- [x] DS-08 satisfied: Sidebar collapses 72↔232 px instantly (no width transition, comment baked); inner content fades 200 ms; reduced-motion drops the fade; data-tour="nav" preserved; AppShell stays a plain block.
- [x] D-15 (SC #3): no consumer call-site changes; existing variants' class strings byte-stable; focus-ring tokenization identical.
- [x] Plan committed as 4 commits via `git commit -- <pathspec>` so 13-03 / 13-05 land cleanly.

## Self-Check: PASSED

- [x] `leanshot/src/components/ui/Card.tsx` — FOUND, contains all 4 new variants
- [x] `leanshot/src/components/ui/Button.tsx` — FOUND, contains `'tonal'` + `count?: number | string`
- [x] `leanshot/src/components/ui/Pill.tsx` — FOUND, contains `count?`, `iconOnly?`, `segmented?`
- [x] `leanshot/src/components/layout/Sidebar.tsx` — FOUND, contains `data-sidebar`, `w-[72px]`, `w-[232px]`, `data-tour="nav"`, no `transition: width` / `transition-[width`
- [x] `leanshot/src/components/layout/AppShell.tsx` — FOUND, contains `md:ml-[72px]` and `md:ml-[232px]`
- [x] Commit `896bd60` exists in `git log --all`
- [x] Commit `48192a6` exists in `git log --all`
- [x] Commit `7876c8b` exists in `git log --all`
- [x] Commit `72af1d8` exists in `git log --all`
- [x] `npx tsc -b` exits 0
- [x] `npx eslint <changed-files>` exits 0
- [x] `npm run build` exits 0
- [x] `npx vitest run` → 750 passed, 0 failed
- [x] `scripts/assert-bundle-budget.sh` passes
- [x] No files outside `key_files.modified` were touched (`git diff --name-only c9d85f8..HEAD` confirms exactly 5 entries, all in scope)
