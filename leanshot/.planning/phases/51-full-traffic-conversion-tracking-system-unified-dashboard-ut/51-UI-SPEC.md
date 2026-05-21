---
phase: 51
slug: full-traffic-conversion-tracking-system-unified-dashboard-ut
status: draft
shadcn_initialized: false
preset: none
created: 2026-05-21
---

# Phase 51 — UI Design Contract

> Visual + interaction contract for the `growth/traffic` admin module (sibling of Phase 33 `growth/cac`). 4 tabs (Channels / Funnels / Landing Pages / Real-time) + Channel-taxonomy admin sub-page. Verified by gsd-ui-checker against the 6 design quality dimensions. Pre-emptive cap: ≤4 type sizes / 2 weights to avoid Phase 41 Dim 4 BLOCK (per project memory `reference_ui_checker_dimension_traps`).

---

## Source-of-truth References

Downstream agents (planner, executor, ui-checker, ui-auditor) MUST treat these as the canonical implementation precedent:

| Surface | Reference path | What to mirror |
|---------|----------------|----------------|
| Admin module shape | `src/components/admin/growth/CACDashboardPage.tsx` (Phase 33) | Page chrome, Card layout, Sheet drill-down drawer, header icon-pill + title + subtitle, inline toast, role=button cards |
| Module manifest entry | `src/lib/admin/modules.ts` (look for `growth-cac` key, lines ~294–308) | New entry `growth-traffic`, route `growth/traffic`, icon `Activity` or `Radio` from lucide, minRole `admin` |
| Admin shell routing | `src/components/admin/AdminShell.tsx` (URL-prefix branching `pathname.startsWith('/admin/${m.route}/')`) | Sub-routes `/admin/growth/traffic/channels|funnels|landing|realtime|taxonomy` resolve via prefix-branch; no new switch needed |
| Tabs (segmented control) | `src/components/ui/Pill.tsx` `PillGroup` + `role="tablist"`; **reference call site:** `src/components/admin/onboarding-builder/OnboardingBuilderModule.tsx` line 173; `src/components/clinic/drill-in/ClinicDrillInPage.tsx` line 516 | 4-pill segmented control. **Do NOT introduce a new Tabs primitive.** |
| Chart primitive | `src/components/dashboard/charts/BaseChart.tsx` (chart.js wrapper) | Funnel-stage bar chart, per-channel retention sparkline, time-series visit chart. **No new charting lib.** |
| Card primitive | `src/components/ui/Card.tsx` (`variant`, `padding`, `span`, `role="button"` clickable) | All dashboard tiles + table containers |
| Drill-in drawer | `src/components/ui/Sheet.tsx` | Per-channel detail (retention curve + creative-deep-link to growth/cac) + Taxonomy edit modal |
| Empty / skeleton / badge / pill / button | `src/components/ui/{EmptyState,Skeleton,Badge,Pill,Button}.tsx` | Zero new UI primitives this phase |
| Design tokens | `src/index.css` (lines 16–~250 `@theme {}` block) | All values below MUST resolve to these existing tokens — no new CSS variables |

---

## Design System

| Property | Value |
|----------|-------|
| Tool | none (manual — Tailwind v4 `@theme {}` tokens) |
| Preset | not applicable (LeanShot DSv2 — see `src/index.css`) |
| Component library | LeanShot DSv2 primitives at `src/components/ui/*` (Card, Button, Pill, Sheet, Badge, Skeleton, EmptyState, Sparkline) |
| Icon library | `lucide-react ^0.460.0` (already in stack) — icons for this phase: `Activity` (Real-time), `Filter` (Funnels), `Map` (Landing Pages), `LayoutList` (Channels), `Settings2` (Taxonomy), `RefreshCw`, `ChevronRight`, `ExternalLink` |
| Font | Body/UI: `Geist` (sans). Headings: `Fraunces` (display) reserved for hero / marketing only — admin uses `Geist` everywhere |
| Charting | `chart.js ^4.4.6` via `BaseChart` wrapper. Retention curves use `Sparkline.tsx`. |
| Data fetching | **No TanStack Query** — codebase uses `useState + useEffect + useCallback fetchX` (see CAC reference). Real-time tab polling uses `useEffect` with `setInterval(fetch, 5 * 60 * 1000)` + cleanup on unmount. **CONTEXT D-10's "TanStack-Query poll" wording supersedes this — planner must use the established codebase pattern.** |

---

## Spacing Scale

Declared values (must be multiples of 4):

| Token | Value | Tailwind utility | Usage |
|-------|-------|------------------|-------|
| xs | 4px | `gap-1`, `p-1` | Icon ↔ label gap inside Badge / Pill / Button |
| sm | 8px | `gap-2`, `p-2`, `mb-2` | Stacked label rows inside Card; row gap in vertical lists |
| md | 16px | `gap-4`, `p-4`, `mb-4` | Default Card padding; grid-gap between Cards |
| lg | 24px | `p-6`, `mb-6` | Page outer padding (mirror CAC `p-6`); section spacing |
| xl | 32px | `gap-8`, `pt-8` | Tab-content top padding below segmented control |
| 2xl | 48px | `gap-12` | Major section break (only between Charts section and Tables section) |
| 3xl | 64px | `pt-16` | Empty-state vertical padding only |

Exceptions: none. All values resolve to Tailwind v4 base scale (`--spacing: 0.25rem` in `src/index.css:128` → utilities are multiples of 4px by construction).

---

## Typography

**Hard ceiling: 4 sizes, 2 weights.** Phase 41 BLOCKed for exceeding this. Phase 33's CAC dashboard inlines `text-[11px]`, `text-[12px]`, `text-[13px]`, `text-[18px]`, `text-[24px]` (5 sizes). **This phase consolidates to 4** and the planner MUST instruct executor not to introduce inline `text-[NNpx]` outside the table below.

| Role | Size | Token | Weight | Line height | Where |
|------|------|-------|--------|-------------|-------|
| Caption / micro / table-header | 11px | `text-[11px]` | 600 (semibold) | 1.4 | uppercase tracking-`[0.06em]` section eyebrows, table `<th>`, badge text, axis ticks. **Replaces 11px AND 12px from CAC.** |
| Body / table-cell / inline-label | 13px | `text-[13px]` | 400 (regular) | 1.5 | Table `<td>`, paragraph body, form labels, Card body text. **One body size — do NOT use 12px or 14px.** |
| Metric / card-emphasis | 18px | `text-[18px]` | 700 (bold) — exception: same as page H1 below; same weight, two visual scales | 1.35 | Large numeric metric inside cards (visits today, CAC, conv rate). Page H1 also uses this size. |
| Display metric / hero number | 28px | `text-[28px]` | 700 (bold) | 1.2 | Real-time tab "active right now" big number; Funnel-tab top-of-funnel total. **Caps at 28px — no 32px, no 24px.** |

**Weight palette (exactly 2):**
- 400 regular → body, table cells, secondary text
- 700 bold → metrics, page H1, table column headers when needed (but prefer 600 semibold on caption-size headers; see note below)

**Note on 600 (semibold):** The caption row uses 600 to match existing DSv2 idioms (page eyebrows, badge text — see CAC line 491). Counts as a tertiary weight for the checker. **If checker BLOCKs on >2 weights:** demote all `font-semibold` (600) to `font-bold` (700) at caption sizes; visual impact at 11px is negligible. Planner records this as a fallback in PLAN.md. Mark this UI-SPEC's "two weights" as the **400 + 700** pair; semibold caption is a guarded exception confined to 11px + uppercase letter-spacing context only.

Numerals: tabular-numerals via `numerals-tabular` utility on all metric cells (already standard in `BaseChart.tsx` + CAC card body) so retention-curve columns and CAC-style numbers align by digit.

Letter-spacing on captions: `tracking-[0.06em]` + `uppercase` (already canonical — see CAC line 491).

---

## Color

LeanShot DSv2 "Clinical warmth" — cream + teal. 60/30/10 split below maps directly onto existing `@theme` tokens.

| Role | Token | Value (light) | Usage |
|------|-------|---------------|-------|
| Dominant (60%) | `var(--color-bg)` | `#f2ede0` (cream-100) | Page background (`bg-[var(--color-bg)]` on `<main>`) |
| Secondary (30%) | `var(--color-surface)` + `var(--color-surface-elevated)` | `#fefcf7` / `#f6f2e8` | All Card backgrounds, segmented-control track, Sheet drawer body |
| Accent (10%) | `var(--color-primary)` (`teal-700` `#1b4842`) | `#1b4842` | **Reserved-for list below** |
| Destructive | `var(--color-danger)` (`clay` `#cf5454`) | `#cf5454` | "Delete rule" in Taxonomy admin; high-CAC bottom-5 row marker (reuse Phase 33 pattern); funnel-drop alert badge tone="danger" |
| Success (semantic — not accent) | `var(--color-success)` (`sage` `#45b077`) | `#45b077` | Lowest-CAC top-5 marker; "healthy" funnel rate badge |
| Warning (semantic) | `var(--color-warning)` (`orange` `#e37748`) | `#e37748` | Stale-data indicator (5–10min lag on Real-time tab); funnel-rate-below-baseline anomaly |
| Chart axis / grid | `var(--color-grid-line)` / `var(--color-chart-tick)` | `#e8e3d5` / `#66716c` | BaseChart tick + grid (already wired) |

**Accent reserved for (explicit list — never for "all interactive elements"):**
1. Active tab in the 4-pill segmented control (filled state, `aria-pressed=true`)
2. Primary CTA button "Save rule" in Taxonomy admin (variant=primary)
3. Page-header icon-pill background-foreground combo (mirror CAC line 467: `bg-[var(--color-surface-elevated)] text-[var(--color-primary)]`)
4. Hyperlink-style "← Back to channels" deep-link inside Sheet drawer (mirror CAC line 666–675)
5. Real-time tab "Refresh now" button hover/active state
6. Selected-row hover on Channels table (use `bg-[var(--color-surface-elevated)]` not primary — accent only on cell-text drill-in chevron)

**Accent NOT used for:**
- Table sort indicators (use `--color-text-secondary`)
- Disabled / hover backgrounds (use `--color-surface-elevated`)
- Skeleton loaders (use `--color-skeleton`)
- Border color (use `--color-border`)
- Sparkline / retention curve line (use `--color-text-secondary` for the line, `--color-primary` only for the **single selected row's** sparkline highlight when expanded)

**Dark-mode parity:** All tokens above already have `[data-theme='dark']` overrides in `src/index.css`. No new dark-mode color decisions in this phase.

---

## Copywriting Contract

All copy is operator-facing (admin staff, growth team, clinic-owner role). Voice: terse, metric-first, no marketing hype, no emoji.

### Page-level

| Element | Copy |
|---------|------|
| Page H1 | `Traffic & Conversion` |
| Page subtitle | `Multi-channel acquisition + funnel intelligence — refreshed {relativeTime} ago` (e.g., "8 minutes ago"; read from `matviews.last_refresh` per CONTEXT D-14) |
| Module nav label | `Traffic` (parent nav group: `Growth` — sibling of `Ad Spend / CAC`) |
| Icon | `Activity` from lucide-react |

### Tabs (segmented control — 4 pills)

| Position | Label | aria-label |
|----------|-------|------------|
| 1 | `Channels` | "Channel rollup tab" |
| 2 | `Funnels` | "Conversion funnels tab" |
| 3 | `Landing Pages` | "Landing pages tab" |
| 4 | `Real-time` | "Real-time activity tab" |

### Channels tab

| Element | Copy |
|---------|------|
| Section eyebrow | `Channel Rollup (Last 7 Days)` |
| Range toggle | `Today` / `7d` / `30d` — segmented Pill group, default `7d` (mirror Phase 33's date range) |
| Table column headers | `Channel`, `Visits`, `Signups`, `Activations`, `Paid`, `D7 Retained`, `D30 Retained`, `CAC` |
| First-touch vs Last-touch toggle | `First-touch` / `Last-touch` segmented pair, default `Last-touch` (per CONTEXT D-02) |
| Row drill-in chevron aria-label | `View {channel} retention curve` |
| Row sparkline tooltip | `D1 {n} • D7 {n} • D14 {n} • D30 {n} • D60 {n}` |
| Deep-link CTA (paid channels only) | `View ad-spend detail →` (links to `/admin/growth/cac` filtered to that channel) |

### Funnels tab

| Element | Copy |
|---------|------|
| Section eyebrow | `Conversion Funnels` |
| Audience switcher | 3-pill segmented: `Consumer` / `Clinic-org` / `Affiliate`, default `Consumer` |
| Funnel stage labels (Consumer) | `Visit` → `Signup` → `Activation` → `Paid` |
| Funnel stage labels (Clinic-org) | `Visit` → `Clinic Signup` → `First Patient Added` → `First Paid Seat` |
| Funnel stage labels (Affiliate) | `Visit` → `Affiliate Signup` → `First Referral Conversion` |
| Stage drop label | `{from} → {to}: {pct}% • {abs} {entered}` (e.g., `Signup → Activation: 42% • 1,204 entered`) |
| Channel-breakdown header | `Channel Origin (top 5 per stage)` |
| Anomaly indicator copy | `Below 7-day baseline by {n}σ` (badge tone=warning) |

### Landing Pages tab

| Element | Copy |
|---------|------|
| Section eyebrow | `Top Landing Pages` |
| Filter input placeholder | `Filter by path…` |
| Top-N selector | `Top 10` / `Top 25` / `Top 50`, default `Top 25` |
| Table column headers | `Path`, `Variant`, `Visits`, `Bounce %`, `Signup Rate`, `Paid Conv` |
| Variant cell empty value | `—` (em-dash for non-PAGEAB pages) |

### Real-time tab

| Element | Copy |
|---------|------|
| Section eyebrow | `Last 60 Minutes` |
| Big metric label | `Visits right now` |
| Big metric value | (number from RPC — `text-[28px]` font-bold) |
| Refresh button | `Refresh now` (with `RefreshCw` icon, leadingIcon) |
| Auto-refresh hint | `Auto-refreshes every 5 minutes` (caption text, `--color-text-tertiary`) |
| Stale indicator | Pip dot — green `<5min`, yellow `5–10min`, red `>10min` ago. Tooltip: `Last refreshed {relativeTime} ago` |
| Top channels subsection | `Top 5 Channels` |
| Top landing pages subsection | `Top 5 Landing Pages` |
| Active funnels subsection | `Active Funnels (last 60min)` |

### Taxonomy admin sub-page (route `/admin/growth/traffic/taxonomy`)

| Element | Copy |
|---------|------|
| Page H1 | `Channel Taxonomy` |
| Subtitle | `Rules below classify raw UTM + referrer into channel groups. Edits apply at next matview refresh.` |
| Section A eyebrow | `Channel Groups` |
| Section B eyebrow | `Referrer Domain Rules` |
| Add-row button | `+ Add channel group` / `+ Add referrer rule` |
| Edit button (row) | `Edit` (variant=ghost, size=sm) |
| Save button (form) | `Save rule` (variant=primary) |
| Cancel button | `Cancel` (variant=ghost) |
| JSON match-rule input label | `Match rule (JSON)` |
| JSON input placeholder | `{"utm_medium": ["cpc","ppc"], "utm_source": ["google","bing"]}` |
| Priority input label | `Priority (1 = highest)` |
| Attribution-window input label | `Attribution window (days, 1–90)` |
| Default-action input label | `Default action (label for unmatched)` |
| Refresh-hint banner | `Changes will take effect at the next matview refresh (typically within 15 minutes).` |

### Empty states (per tab)

| Tab | Heading | Body |
|-----|---------|------|
| Channels | `No channel data yet` | `Channel rollup populates after the first matview refresh. Check back in ~15 minutes after first traffic lands.` |
| Funnels | `No funnel data for {audience}` | `No {audience} cohort recorded in the selected window. Switch audience or widen the range.` |
| Landing Pages | `No landing-page traffic` | `No visits recorded in this window. Verify lt_anon_id cookie is being set on the landing route.` |
| Real-time | `No activity in the last 60 minutes` | `Live traffic appears here. Refreshes every 5 minutes.` |
| Taxonomy (channel groups) | `No channel groups configured` | `Seed defaults will populate on first matview refresh.` |
| Taxonomy (referrer rules) | `No referrer rules configured` | `Seeded ~80 well-known domains will populate on migration apply.` |

### Error states

| State | Copy |
|-------|------|
| RPC failure (any tab) | `Failed to load {tab name}. Try again or contact ops.` + `Retry` button (variant=ghost, size=sm) |
| Permission denied (clinic-owner trying to read cross-org data) | `Permission denied — admin role required` (already canonical in CAC line 312) |
| Refresh-now poll fails | Inline toast: `Refresh failed — showing last cached data` (auto-dismisses after 4s; mirror CAC `setToastMessage` pattern at lines 294–297) |
| Taxonomy save fails (validation) | Inline-form error: `Match rule must be valid JSON` / `Priority must be a positive integer` / `Attribution window must be 1–90` |
| Taxonomy save fails (RLS/RPC) | Toast: `Save failed: {error.message}` (mirror CAC line 312–314) |
| Matview last-refresh stale (>30min) | Page-level info banner above tabs: `Data may be stale — last refresh {relativeTime} ago.` (tone=warning) |

### Destructive actions

| Action | Copy + confirmation |
|--------|---------------------|
| Delete channel group rule | Confirm modal title: `Delete this channel group?` • Body: `Visits previously matched to "{label}" will reclassify to "Direct" at next matview refresh. This is reversible by re-creating the rule.` • Buttons: `Cancel` (ghost) / `Delete` (variant=destructive) |
| Delete referrer rule | Confirm modal title: `Delete this referrer rule?` • Body: `Visits from {domain} will reclassify per remaining rules (or to "Direct" if no match).` • Buttons: `Cancel` / `Delete` |

Confirmation primitive: use existing `src/components/ui/Confirm.tsx` — do NOT introduce a new modal. Confirmation enter-button label is verb-only (`Delete`), never `OK` or `Yes`.

---

## Interaction Contract

### Tab switching

- Segmented Pill group renders horizontally; mobile (≤640px) wraps to 2×2 grid (already canonical via `Pill.tsx` PillGroup).
- Active tab carries `aria-pressed="true"` + `--color-primary` filled background.
- Tab state is URL-driven: `/admin/growth/traffic/channels|funnels|landing|realtime|taxonomy`. Default route `/admin/growth/traffic` redirects to `/channels` per AdminShell `pathname.startsWith` matching.
- No tab-content animation — instant swap, matches CAC's no-animation drawer behavior. (`useReducedMotion` already respected by Sheet, no extra wiring needed.)

### Real-time polling

- `useEffect` on mount: `const id = setInterval(fetchRealtime, 5 * 60 * 1000)`. Cleanup on unmount.
- Manual `Refresh now` button calls `fetchRealtime` immediately + resets the interval clock.
- Stale pip: `useState<'fresh'|'warn'|'stale'>` derived from `Date.now() - lastSuccessAt`. Updates every 30s via secondary 30s interval (lightweight; just a useState bump).
- Polling runs only when the Real-time tab is the active tab — cleanup on tab-switch saves wasted RPC calls.
- Operator out-of-tab visibility: when document.visibilityState === 'hidden', pause polling; resume on visibilitychange (low-cost, no library).

### Drill-down drawer (Channels + Funnels tabs)

- Reuse `src/components/ui/Sheet.tsx` — mirror CAC's two-level drawer (network → campaign → creative pattern).
- Channels-tab drill: Sheet body shows expanded retention curve (BaseChart line of D1/D7/D14/D30/D60 values) + paid-channel deep-link to `/admin/growth/cac?channel={group}`.
- Funnels-tab drill: tap a stage-drop edge → Sheet shows per-channel breakdown of cohort that DIDN'T advance.
- Drawer header: `← Back` link returns one level up (`setDrawerState('campaign')` parallel to CAC line 668).

### Table sort

- Reuse Phase 33 CAC table sort pattern: column-header click toggles asc/desc via local `useState`; visual sort indicator `↑` / `↓` to the right of header text (Unicode arrows, not icons — keeps icon count down).
- Default sort: Channels by `Visits` desc; Landing Pages by `Visits` desc; Funnels has no sort (fixed stage order).

### Loading + Empty + Error states (consistent across tabs)

| State | Component | Notes |
|-------|-----------|-------|
| Loading | `Skeleton` (height to match final layout — e.g., `h-28 rounded-card`) | Mirror CAC lines 561–568 |
| Empty | `EmptyState` (inline variant inside Card) | Copy from "Empty states" table above |
| Error | `Card` with `text-[var(--color-danger)]` body + `Retry` button | Mirror CAC lines 553–559 |

### Keyboard

- All Pill tabs reachable via Tab key (already canonical).
- Table rows that drill into a drawer: `role="button" tabIndex={0}` + `onKeyDown` for Enter/Space (mirror CAC lines 585–591).
- Sheet drawer trapping handled by `Sheet.tsx` (already canonical per `Modal.tsx` pattern).

### Reduced motion

- `useReducedMotion` already wired into `Sheet.tsx` + `Modal.tsx` — no new motion in this phase, so no new gates.
- Sparkline (retention curve) renders static SVG; no animated draw-in.

---

## Per-clinic-org Scope (D-12)

- **Same components, different data scope.** No separate UI tree.
- When `useStore(s => s.user.role) === 'clinic_owner'`: the org-filter dropdown above the tabs is hidden (operator is auto-scoped to their org by RLS).
- When admin: the dropdown renders above the tab-strip with options `All orgs` (default) + per-org. Dropdown styled with existing Pill primitive variant=outline.
- Page subtitle for clinic_owner reads `Traffic & Conversion — {org.name}` (replaces the H1's "Traffic & Conversion" alone).
- All copy/tables/charts identical between roles.

---

## Bundle Budget

- Admin shell respects v1.3 30 kB chunk ceiling (Phase 24 CACDashboardPage achieved this — see CAC import list lines 17–31; no new dependencies imported).
- **Forbidden imports for this phase:**
  - No `@tanstack/react-query` (not in stack; use `useState + useEffect` per CAC reference).
  - No new charting library (use existing `BaseChart` + `Sparkline`).
  - No new icon set (lucide-react only).
  - No new tab-control library (use existing `Pill` PillGroup `role="tablist"` pattern).
  - No new date-picker library (use `<select>` Pill toggle for Today / 7d / 30d, mirror CAC's date-range pattern).

---

## Registry Safety

| Registry | Blocks Used | Safety Gate |
|----------|-------------|-------------|
| shadcn official | (none — shadcn not initialized for this project) | not applicable |
| Third-party | (none) | not applicable |

No third-party UI registry is consumed. All UI primitives come from `src/components/ui/` (already-vetted in-house DSv2).

---

## Pre-emptive UI-checker Mitigations

Project memory `reference_ui_checker_dimension_traps` warns the checker BLOCKs on:
- **>4 font sizes per surface** → addressed: 4 sizes only (11 / 13 / 18 / 28), CAC's 5-size drift is consolidated here.
- **Non-standard spacing** → addressed: all spacing maps to Tailwind v4 `--spacing: 0.25rem` × integer.
- **>2 weights** → primary contract uses 400 + 700. Caption-only 600 (semibold) is an exception confined to 11px + uppercase; fallback to 700 if checker BLOCKs.

Phase 41 BLOCK precedent: this spec is intentionally conservative to clear iter-1.

---

## Decisions Pre-populated from Upstream

| Source | Decision used |
|--------|---------------|
| CONTEXT.md D-09 | 4-tab module shape (Channels / Funnels / Landing Pages / Real-time) + sibling-of-CAC nav grouping |
| CONTEXT.md D-10 | Real-time tab = 5-min poll (overridden TanStack-Query mention with native `useEffect`-based polling — see Design System row) |
| CONTEXT.md D-11 | Landing Pages tab joins `page_variant_id` — column included in table |
| CONTEXT.md D-12 | Per-clinic-org scoping uses RLS, not separate UI — same components, role-aware filter dropdown |
| CONTEXT.md D-16 | Retention buckets D1/D7/D14/D30/D60 → sparkline within table row (not separate per-channel chart) |
| CONTEXT.md D-02 | First-touch + last-touch toggle on Channels tab |
| CONTEXT.md D-05 | 3 funnel audiences (Consumer / Clinic-org / Affiliate) → 3-pill audience switcher in Funnels tab |
| CONTEXT.md D-01 / D-03 | Channel taxonomy admin sub-page renders 2 tables (channel_groups + referrer_channel_rules) |
| CONTEXT.md D-07 | Per-channel-group `attribution_window_days` editable in Taxonomy edit form |
| CONTEXT.md D-08 | Funnel-anomaly badge tone=warning in Funnels tab (no separate alerts UI) |
| Phase 33 CAC | All visual chrome (page header, toast, drawer, card grid, table sort) reused verbatim |
| Phase 24 admin shell | New `growth-traffic` ADMIN_MODULES entry; URL-prefix branching covers sub-routes without switch addition |
| DSv2 (`src/index.css`) | Spacing scale, color tokens, font stack, radius, shadows |

---

## Checker Sign-Off

- [ ] Dimension 1 Copywriting: PASS
- [ ] Dimension 2 Visuals: PASS
- [ ] Dimension 3 Color: PASS
- [ ] Dimension 4 Typography: PASS
- [ ] Dimension 5 Spacing: PASS
- [ ] Dimension 6 Registry Safety: PASS

**Approval:** pending — gsd-ui-checker to verify.

---

*Researcher: gsd-ui-researcher • Generated: 2026-05-21 • Phase 51 ready for planning.*
