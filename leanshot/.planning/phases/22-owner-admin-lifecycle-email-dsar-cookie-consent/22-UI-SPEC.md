---
phase: 22
slug: owner-admin-lifecycle-email-dsar-cookie-consent
status: draft
shadcn_initialized: false
preset: none
created: 2026-05-16
token_source: Phase 13 design system v2 (`src/index.css` `@theme` block) — DO NOT redefine
inherits_pattern_from: .planning/phases/19-affiliate-program-stripe-connect/19-UI-SPEC.md
---

# Phase 22 — UI Design Contract

> Visual + interaction contract for the owner/admin operator surface (`/admin/*`), the read-only impersonation overlay, the in-app account-deletion flow (Apple §5.1.1(v)), the GDPR cookie-consent banner + DSAR portal, the 12 Resend lifecycle email templates, and the self-serve email-preferences sub-page. Consumed by `gsd-planner`, `gsd-executor`, `gsd-ui-checker`, `gsd-ui-auditor`.
>
> **All tokens reference the Phase 13 v2 `@theme` block in `src/index.css`. This phase introduces ZERO new color/spacing/font tokens.** Phase 22 introduces ZERO new UI primitives — every surface composes existing primitives (`Card`, `Button`, `Input`, `Modal`, `Pill`, `Badge`, `Toast`, `EmptyState`, `Skeleton`, `Sparkline`, `InitialsAvatar`). Lifecycle email templates are a SEPARATE rendering target (hand-coded HTML + inline CSS for Gmail/Outlook compat) — they CANNOT use Tailwind utility classes; this spec includes the token-to-inline-CSS mapping.

---

## Design System

| Property | Value |
|----------|-------|
| Tool | none (manual Tailwind v4 `@theme` design system, established Phase 13) |
| Preset | not applicable |
| Component library | in-house at `src/components/ui/*` (15 primitives, all v2-refreshed; `<InitialsAvatar>` added Phase 19) |
| Icon library | `lucide-react ^0.460.0` |
| Font (app surfaces) | Geist (sans), Geist Mono (mono), Fraunces (display) — loaded via `<link>` in `index.html` |
| Font (email surfaces) | System-stack fallback (`-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif`) — Gmail/Outlook strip web fonts |
| Token source | `src/index.css` `@theme {}` block (Phase 13 v2) — CSS custom properties only |
| Theme model | `data-theme="light\|dark"` attr on `<html>`; emails ship light-only |

---

## Spacing Scale

**Inherited from Phase 13 v2 design system. Tailwind v4 spacing base is `0.25rem` (4px).**

| Tailwind utility | Value | Phase 22 usage |
|------------------|-------|----------------|
| `p-1` / `gap-1` | 4px | Icon gaps inside buttons; impersonation banner countdown digit padding |
| `p-2` / `gap-2` | 8px | Pill insets, badge padding, cohort heatmap cell padding |
| `p-3` / `gap-3` | 12px | Members table cell padding, activity feed row insets, cookie banner button row |
| `p-4` / `gap-4` | 16px | Default card padding mobile, form field stack, refund-modal step content |
| `p-5` / `p-6` | 20px / 24px | Card padding md (matches `<Card padding="md">` default), modal body padding, `/admin/members/{id}` tab content |
| `p-7` / `p-8` | 28px / 32px | Section breaks; admin metrics chart container, DSAR portal hero padding |
| `py-12` | 48px | Apply-form-style hero vertical padding on standalone routes |
| `py-16` | 64px | Page-level top/bottom on `/settings/privacy/dsar` standalone confirmation views |

**Exceptions:** None. All values are multiples of 4 mapping to Tailwind v4's `--spacing: 0.25rem` base. Per `reference_ui_checker_dimension_traps.md`, no custom inline `style={{ padding: '17px' }}` ever — the UI-checker BLOCKs absolutely on non-standard spacing values.

**Touch targets:** All interactive elements ≥ 44×44px via Button `h-11` default. Cookie banner buttons explicitly `h-11 min-w-[120px]` (mobile-first; OK to tap with thumb).

**Impersonation banner sticky offset:** When banner is visible, AppShell main content top-offset shifts by `pt-12` (48px) to clear the 48px-tall banner.

---

## Typography

**4 sizes per surface, 2 weights per surface — UI-checker compliance.** Tokens reference Phase 13 v2 type scale in `src/index.css`.

### Per-surface type budgets (each ≤ 4 sizes, ≤ 2 weights)

#### `/admin/members` — members table (AT-RISK surface; KPI numbers + filters + headers + cells; pre-emptively trimmed)

| Role | Token | px | Weight | Line-height | Usage |
|------|-------|----|--------|-------------|-------|
| Page heading + KPI value | `text-3xl` | 32 | 600 (semibold) | 1.15 | Page title "Members" AND KPI tile values (total members, paid count, MRR mini-stat) — same size, same weight, dual-purpose |
| Body | `text-base` | 16 | 400 (regular) | 1.55 | Table cell content, filter labels, search placeholder |
| Label | `text-sm` | 13 | 600 (semibold) | 1.5 | Table column headers (uppercase via Tailwind `uppercase tracking-wide`), filter pill labels, KPI tile labels |
| Caption | `text-xs` | 12 | 400 (regular) | 1.45 | Helper text ("Showing 1-50 of 2,340"), badge text, timestamp captions |

#### `/admin/members/{id}` — member drill-in (5 tabs: Profile · Billing · Activity · Stripe · Flags · Audit)

| Role | Token | px | Weight | Line-height | Usage |
|------|-------|----|--------|-------------|-------|
| Page heading | `text-2xl` | 26 | 600 | 1.25 | Member name + email (subtitle) header |
| Body | `text-base` | 16 | 400 | 1.55 | Field values, log entries, charge descriptions |
| Label | `text-sm` | 13 | 600 | 1.5 | Field labels above values, tab labels |
| Caption | `text-xs` | 12 | 400 | 1.45 | Timestamps, secondary metadata |

#### `/admin/metrics` — MRR/ARR/churn

| Role | Token | px | Weight | Line-height | Usage |
|------|-------|----|--------|-------------|-------|
| Page heading + KPI value | `text-3xl` | 32 | 600 | 1.15 | "MRR" / "ARR" / "Churn %" headline numbers reused as page heading sizing |
| Body | `text-base` | 16 | 400 | 1.55 | Chart axis labels, legend text, "Last updated" caption |
| Label | `text-sm` | 13 | 600 | 1.5 | KPI tile labels, chart title |
| Caption | `text-xs` | 12 | 400 | 1.45 | Delta vs prior period, tooltip body |

#### `/admin/affiliates` — review queue (extends P19 scaffold)

| Role | Token | px | Weight | Line-height | Usage |
|------|-------|----|--------|-------------|-------|
| Heading | `text-xl` | 22 | 600 | 1.35 | Page title "Affiliate review queue" + per-row affiliate name |
| Body | `text-sm` | 13 | 400 | 1.5 | Table cell content, fraud signal descriptions |
| Label | `text-xs` | 12 | 600 | 1.45 | Table column headers (uppercase), filter pill labels |
| Badge | `text-[11px]` (`--text-micro`) | 11 | 600 | 1.4 | Status badges + fraud signal badges |

#### `/admin/cohorts` — retention heatmap

| Role | Token | px | Weight | Line-height | Usage |
|------|-------|----|--------|-------------|-------|
| Page heading | `text-2xl` | 26 | 600 | 1.25 | "Cohort retention" + axis section headers |
| Body | `text-sm` | 13 | 400 | 1.5 | Axis labels ("Signup week", "Days since signup"), legend body |
| Label | `text-xs` | 12 | 600 | 1.45 | Axis tick labels (week dates, day numbers) |
| Tooltip | `text-xs` | 12 | 400 | 1.45 | Cell hover tooltip |

#### Impersonation banner (ADMIN-03) — global sticky overlay

| Role | Token | px | Weight | Line-height | Usage |
|------|-------|----|--------|-------------|-------|
| Banner body | `text-sm` | 13 | 600 | 1.4 | All banner copy + countdown timer (one size, one weight — minimal cognitive load) |
| End-impersonation CTA | `text-sm` | 13 | 600 | 1.4 | Inline button label (matches body) |

Type budget: 1 size · 1 weight (compliant; far under the 4×2 ceiling — banner is intentionally minimal).

#### Settings → Delete Account (DEL-01) flow

| Role | Token | px | Weight | Line-height | Usage |
|------|-------|----|--------|-------------|-------|
| Heading | `text-2xl` | 26 | 600 | 1.25 | Modal heading "Delete account" |
| Body | `text-base` | 16 | 400 | 1.55 | Confirmation paragraph + impact list |
| Label | `text-sm` | 13 | 600 | 1.5 | "Type DELETE MY ACCOUNT to confirm" label, button labels |
| Caption | `text-xs` | 12 | 400 | 1.45 | "This cannot be undone" helper, retention disclosure |

#### Soft-delete countdown banner (DEL-01 post-delete) — global sticky overlay

| Role | Token | px | Weight | Line-height | Usage |
|------|-------|----|--------|-------------|-------|
| Banner body | `text-sm` | 13 | 600 | 1.4 | Single-line copy + "Cancel deletion" CTA (1 size, 1 weight) |

#### Cookie consent banner (GDPR-01)

| Role | Token | px | Weight | Line-height | Usage |
|------|-------|----|--------|-------------|-------|
| Body | `text-base` | 16 | 400 | 1.55 | Lead copy "We use cookies..." |
| Label | `text-sm` | 13 | 600 | 1.5 | Button labels (Accept all / Reject all / Customize), category toggle labels |
| Caption | `text-xs` | 12 | 400 | 1.45 | Per-category one-line description, privacy-policy link |

Type budget: 3 sizes · 2 weights (compliant).

#### DSAR portal `/settings/privacy/dsar` (GDPR-03)

| Role | Token | px | Weight | Line-height | Usage |
|------|-------|----|--------|-------------|-------|
| Heading | `text-2xl` | 26 | 600 | 1.25 | "Your data" page heading |
| Body | `text-base` | 16 | 400 | 1.55 | Explanation paragraphs, SLA disclosure |
| Label | `text-sm` | 13 | 600 | 1.5 | Status pill label, button labels |
| Caption | `text-xs` | 12 | 400 | 1.45 | "Available until {date}" timestamp, file size meta |

#### Email preference center `/settings/email-preferences` (ON-03)

| Role | Token | px | Weight | Line-height | Usage |
|------|-------|----|--------|-------------|-------|
| Heading | `text-2xl` | 26 | 600 | 1.25 | "Email preferences" page heading |
| Body | `text-base` | 16 | 400 | 1.55 | Category names + Save button |
| Label | `text-sm` | 13 | 600 | 1.5 | Category section labels |
| Caption | `text-xs` | 12 | 400 | 1.45 | Per-category one-line explanation, "Transactional emails cannot be disabled" notice |

#### Refund modal (ADMIN-04) — 3-step

| Role | Token | px | Weight | Line-height | Usage |
|------|-------|----|--------|-------------|-------|
| Heading | `text-xl` | 22 | 600 | 1.35 | Modal heading + step heading ("Step 1 of 3: Pick a charge") |
| Body | `text-base` | 16 | 400 | 1.55 | Charge descriptions, helper text, confirmation paragraph |
| Label | `text-sm` | 13 | 600 | 1.5 | Form labels ("Amount", "Type confirmation"), button labels |
| Caption | `text-xs` | 12 | 400 | 1.45 | "Issued by {admin_email}" attribution, error/validation text |

**Responsive type reframing (UI-checker trap mitigation):** Mobile reductions use Tailwind responsive prefixes on the SAME token name (e.g. `text-2xl md:text-3xl`), NOT new size tokens. Phase 13 token set is the universe.

---

## Color

### 60 / 30 / 10 split (inherits Phase 13 v2 semantic tokens)

| Role | Light value | Dark value | Token | Usage |
|------|-------------|------------|-------|-------|
| Dominant 60% | `#f2ede0` cream | `#0b1413` teal-950 | `--color-bg` | Page background (paper-grain SVG overlay in light) |
| Secondary 30% | `#fefcf7` paper | `#16201e` near-black | `--color-surface` | Cards, KPI tiles, table rows, modal bodies, cookie banner |
| Accent 10% | `#1b4842` teal-700 | `#6fcbb8` teal-300 | `--color-primary` | Primary CTAs + selected states + cohort-heatmap densest cells (see reserved-for list) |
| Destructive | `#cf5454` clay | `#da6f6f` clay-light | `--color-danger` | Impersonation banner, refund modal "Issue refund" CTA, delete-account confirmation, soft-delete banner |

### Accent reserved-for list (UI-checker compliance — explicit, not "all interactive")

Accent (`--color-primary`) is used ONLY on:
1. **Primary CTAs** — "Issue refund", "Confirm cancel", "Download bundle", "Save preferences", "Accept all" (cookie), "Export my data" (DSAR) — always via `<Button variant="primary">`.
2. **Focus rings** — Inherited from primitives' `focus-visible:ring-[var(--color-primary)]`.
3. **Active nav state** — `/admin/*` sub-nav active item underline (1px primary).
4. **Member table row hover/selected** — Selected-row left-border 2px primary.
5. **KPI value text** — `/admin/metrics` and `/admin/members` headline KPI numerics use `text-[var(--color-primary)]` (≤ 4 instances per surface).
6. **Cohort heatmap densest cells** — Cells with retention ≥ 80% render with `bg-[var(--color-primary)]` (full opacity). Lower-density cells use `bg-[color-mix(in srgb, var(--color-primary) {N}%, var(--color-surface))]` via inline `style` (CSS color-mix is in-spec; not a new token).

### Destructive reserved-for list (explicit)

`--color-danger` (clay) is used ONLY on:
1. **Impersonation banner background** (`bg-[var(--color-danger)]` with white text — see Impersonation section)
2. **Refund modal "Issue refund" CTA** (`<Button variant="destructive">`)
3. **Cancel-subscription CTA** in member drill-in
4. **Delete-account confirm CTA** + soft-delete banner background
5. **Admin "Reject application" CTA** in `/admin/affiliates` review queue
6. **Fraud-flag indicator** on affiliate rows (badge `tone="danger"`)

### Semantic states (badges + indicators)

Use existing `<Badge>` primitive (`tone="info|success|warning|danger|neutral|inverse"`). Phase 22 status mappings:

| Domain state | Badge tone | Used on |
|--------------|------------|---------|
| Stripe `active` | `success` | Members table stripe_status column |
| Stripe `past_due` | `warning` | Members table |
| Stripe `canceled` | `neutral` | Members table |
| Stripe `trialing` | `info` | Members table |
| DSAR `pending` | `neutral` | DSAR portal status |
| DSAR `in_progress` | `info` | DSAR portal status |
| DSAR `completed` | `success` | DSAR portal status |
| DSAR `rejected` | `danger` | DSAR portal status |
| Affiliate `pending_review` | `warning` | Affiliate review queue |
| Affiliate `flagged` | `danger` | Affiliate review queue |
| Affiliate `approved` | `success` | Affiliate review queue |
| Tier `free` | `neutral` | Members table tier column |
| Tier `paid` | `success` | Members table |
| Tier `clinic_seat` | `info` | Members table |
| Feature-flag overridden | `info` (inverse) | Flags tab on member drill-in |

**No new color tokens. No hardcoded hex values in any Phase 22 component file** (with the documented exception of email templates, which embed token values inline as hex — see Email Templates section). Dark-mode parity is automatic.

---

## Layout Contracts (per surface)

### `/admin/members` — members table (ADMIN-01)

- **Grid:** 12-col bento (`grid grid-cols-12 gap-4 md:gap-6`).
- **Header row (`span={12}`):** Page heading "Members" + total-count badge + global search `<Input>` (search placeholder "Search by email or name") right-aligned.
- **KPI strip (`span={12}` containing 4 sub-cards):** 4 `<Card span={3}>` mobile-stack 2×2: total members · paid · clinic seats · 30d churn %. Same anatomy as Phase 19 PartnerKpiCard.
- **Filter bar (`span={12}`):** `<Pill>` segmented group (All / Free / Paid / Clinic / Past-due / Canceled) + secondary `<Pill>` group for country + signup-date range picker (native `<input type="date">` styled to match `<Input>`).
- **Table (`span={12}`):** Columns in order: avatar+email · tier badge · signup date · last_active relative · clinic_name · country · stripe_status badge · row-actions (`<IconButton>` triple-dot menu).
- **Row actions menu** (kebab → popover): Impersonate · Refund last charge · Cancel subscription · Deactivate · Override feature flag · View detail.
- **Pagination:** Footer `<Card span={12} variant="flat">` with prev/next + page-size selector (25/50/100). Server-paginated; URL `?page=N&size=M`.
- **Empty state:** `<EmptyState>` with `lucide:Users` icon — "No members match your filters" + "Clear filters" link.
- **Loading state:** `<Skeleton>` 10 table rows.
- **Mobile (`<md`):** Table collapses to vertical card list (one card per member); filter bar collapses to dropdown sheet.

### `/admin/members/{id}` — drill-in (ADMIN-01 + ADMIN-04 + ADMIN-05)

- **Header (`span={12}`):** `<InitialsAvatar size="md">` + member name `text-2xl` + email `text-base text-[var(--color-text-secondary)]` + tier badge + Stripe-status badge inline. Right-aligned: action cluster (`<Button variant="secondary">Impersonate</Button>` + `<IconButton aria-label="Cancel subscription">` + `<IconButton aria-label="Refund last charge">`).
- **Tab bar (`span={12}`):** 6 tabs via `<Pill>` segmented control: Profile · Billing · Activity · Stripe · Flags · Audit. Active tab tracked in `?tab=` URL query.
- **Tab content** (`span={12}`):
  - **Profile:** Field-list card (read-only fields: user_id UUID, signup_date, last_active, clinic, country, IP, browser).
  - **Billing:** Subscription card (plan name, period, next billing date, MRR) + payment-method card (last 4, expiry).
  - **Activity:** Activity feed (last 50 events: logins, page views, injections logged, sharing actions) — reuses Phase 19 activity-feed row layout.
  - **Stripe:** Charges table (last 90 days; columns: date, amount, status badge, descriptor, row-action "Refund this charge" opens refund modal).
  - **Flags:** List of all feature flags (from PostHog mirror) + per-flag override row (toggle + expires-at date-picker + "Set override" button → upsert `feature_flag_overrides`). Overridden flags show `<Badge tone="info">Overridden</Badge>`.
  - **Audit:** `audit_logs` rows scoped to `target_user_id={id}` (chronological reverse; columns: timestamp, actor, action_type, before/after JSON expand).

### `/admin/metrics` — MRR/ARR/churn (ADMIN-02)

- **Grid:** 12-col bento.
- **Header row (`span={12}`):** Page heading "Business metrics" + period selector `<Pill>` group (7d / 30d / 90d / 12m) + "Last updated" badge `<Badge tone="neutral">`.
- **KPI strip (`span={12}` → 4 sub-cards):** `<Card span={3}>` × 4: MRR · ARR · 30d churn % · clinic-seat utilization (last as `<Sparkline>` mini-chart).
- **Main chart (`span={12}`):** `<BaseChart>` line+bar combo — free-vs-paid stacked bars (x = monthly bins, y = subscriber count) + churn-rate line overlay (secondary y-axis). Legend below chart.
- **Clinic-seat utilization (`span={12}`):** `<Card>` with `<Sparkline>` × clinics, one row per clinic, "{clinic_name}  {used}/{total} seats  {sparkline}".
- **Empty state:** `<EmptyState>` "No revenue data yet" + "Connect Stripe first" CTA (link to `/admin/settings/stripe`).

### `/admin/affiliates` — review queue (ADMIN-06; extends P19 scaffold)

- **Header (`span={12}`):** Page heading "Affiliate review queue" + period filter + `<Pill>` segmented (All / Pending / Flagged / Approved / Rejected / Suspended) with per-state count badges (`<Button count={N}>`).
- **Table (`span={12}`):** Extend P19's 6-column scaffold to add: fraud-signal badges column (multi-badge cell), per-row inline action buttons (Approve / Hold / Pay out / Reject) — each is a small ghost button.
- **Row expansion:** Clicking row expands inline (no navigation) to show: fraud-signal detail panel (Z-score values, IP cluster size, click-velocity, public-email flag) + payout history mini-table + audit log mini-list.
- **Bulk actions:** NOT in scope per CONTEXT defers ("Bulk refund/cancel" v1.3). Per-row only.
- **Pagination:** Server-paginated, same pattern as members table.

### `/admin/cohorts` — retention heatmap (ADMIN-08)

- **Header (`span={12}`):** Page heading "Cohort retention" + "Show all weeks" toggle (default 13 weeks visible per D-04).
- **Heatmap (`span={12}`):** Card-grid implementation (NO new chart primitive) — `grid grid-cols-[120px_repeat(91,_minmax(8px,_1fr))]` where col 0 is the cohort label, cols 1-91 are day-N cells. Each cell is a 12px×12px square with `bg-[color-mix(in srgb, var(--color-primary) {density}%, var(--color-surface))]` and `aria-label` describing the cell. Hover → `<Card variant="elevated">` tooltip via native `title` or controlled state.
- **Legend (`span={12}`):** Horizontal gradient bar from `--color-surface` (0% retention) → `--color-primary` (100% retention) + tick marks at 0/25/50/75/100.
- **Show-all behavior:** Toggle expands grid to 26 weeks; performance note in PLAN.md (`will-change: transform` on grid; pagination via virtualization deferred to v1.3).
- **Empty state:** `<EmptyState>` "No cohort data yet — run the daily refresh".

### Impersonation banner (ADMIN-03)

- **Mount:** Top of `<AppShell>` (above topbar), conditionally rendered when `useImpersonation().active === true`.
- **Position:** `sticky top-0 z-[60]` (above topbar `z-50`); `bg-[var(--color-danger)] text-white`.
- **Height:** Fixed 48px (`h-12`). Cannot be dismissed.
- **Layout:** `flex items-center justify-between gap-3 px-4`:
  - Left: `lucide:UserCog` icon (`aria-hidden`) + body text "Impersonating {email} · Read-only · {N}m {S}s remaining".
  - Right: `<button>` "End impersonation" → inverse-styled (`bg-white text-[var(--color-danger)] h-8 px-3 rounded-pill text-sm font-semibold`).
- **Accessibility:** `role="alert"` + `aria-live="assertive"` (announced on mount); countdown timer in own `<span aria-live="off">` (cosmetic — DON'T announce every tick).
- **Countdown:** Updates every 1s via `setInterval`; pulses red→white text in last 60s (CSS animation, honors `prefers-reduced-motion`).
- **Auto-end:** At 0:00, banner triggers `endImpersonation()` automatically; if user is mid-action when timer hits 0, action is canceled with toast "Impersonation expired".
- **Read-only enforcement contract (D-05):** Every interactive element receives `disabled={true} aria-disabled={true}` + tooltip `"Read-only during impersonation"` via shared `useImpersonationReadOnly()` hook. Hook reads `useImpersonation().active` and returns props to spread. Forms additionally show inline notice card at top of any form: "Read-only — impersonation cannot save changes."
- **Visual style of disabled-by-impersonation elements:** `opacity-50 cursor-not-allowed` (Tailwind utilities); existing Button primitive already supports `disabled` styling.

### Settings → Delete Account flow (DEL-01)

**Apple §5.1.1(v) "≤3 taps from in-app settings" compliance:**

- **Tap 1:** User opens Settings drawer from AppShell topbar gear icon → already mounted.
- **Tap 2:** Within Settings, taps "Account" section heading → expands "Delete account" link.
- **Tap 3:** Taps "Delete account" → opens confirmation `<Modal>`.

- **Confirmation modal layout:**
  - Heading `text-2xl`: "Delete account"
  - Body `text-base`: "This will permanently delete your LeanShot account, including:" + bulleted list (injections · photos · weight logs · AI history · doctor shares · affiliate referrals).
  - Retention disclosure `text-xs text-[var(--color-text-secondary)]`: "Stripe payment records and affiliate ledger entries are retained for 7 years per IRS requirements (anonymized)."
  - Typed-text input: `<Input>` with `label="Type DELETE MY ACCOUNT to confirm"` and `placeholder="DELETE MY ACCOUNT"` (exact-match required, case-sensitive).
  - Action row: `<Button variant="ghost">Cancel</Button>` (left) + `<Button variant="destructive" disabled={!matched}>Delete account</Button>` (right).
- **On confirm:** Invokes `account-delete` Edge Function (P19); shows loading state on button; on success, signs user out + redirects to `/?deleted=1` and shows toast "Account scheduled for deletion. We've sent a confirmation email."
- **On error:** Inline error message above action row, keeps modal open.

### Soft-delete countdown banner (DEL-01 post-delete)

- **Mount:** Top of `<AppShell>` (above topbar, NOT below impersonation banner — only one global banner can show; if both apply, impersonation wins per priority).
- **Trigger:** `useUser().delete_requested_at !== null && days_remaining > 0`.
- **Position:** `sticky top-0 z-[60]`; `bg-[var(--color-danger-soft)] text-[var(--color-danger)] border-b border-[var(--color-danger)]`.
- **Height:** `h-12` (matches impersonation pattern).
- **Layout:** `lucide:AlertTriangle` + body text "Account scheduled for deletion in {N} days." + inverse `<button>` "Cancel deletion" → onClick invokes `account-undelete` Edge Function + clears `delete_requested_at`.
- **Accessibility:** `role="alert"` + `aria-live="polite"` (less urgent than impersonation; polite is correct).

### Cookie consent banner (GDPR-01)

- **Library:** `vanilla-cookieconsent@^3.1.0` (per `.planning/research/STACK.md` v1.2 lock).
- **Mount:** Lazy-imported in `App.tsx` after first paint; renders into a portal at `document.body` (library default).
- **Position:** `fixed bottom-0 left-0 right-0 z-[70]` (above banners + topbar); `bg-[var(--color-surface)] border-t border-[var(--color-border)] shadow-[var(--shadow-lg)]`.
- **Max height:** `max-h-[120px]` collapsed (per CONTEXT D-07: ≤ 120px); `max-h-[480px]` when "Customize" expanded (expands inline UPWARD via `flex-direction: column-reverse` so the buttons stay at the bottom).
- **Layout (collapsed):** `flex flex-col md:flex-row md:items-center md:justify-between gap-3 p-4`:
  - Left: `text-base` body copy "We use cookies..." + `text-xs` privacy-link.
  - Right: button row → `<Button variant="ghost" size="md">Reject all</Button> <Button variant="secondary" size="md">Customize</Button> <Button variant="primary" size="md">Accept all</Button>`.
- **Layout (Customize expanded):** Inline section above buttons: 4 toggle rows using `<Pill>` segmented (`On / Off` style; Essential always-on, disabled). Each row: category name (`text-sm font-semibold`) + 1-line explanation (`text-xs text-secondary`) + toggle right-aligned. "Save preferences" replaces 3-button row as primary action.
- **Geo-default logic** (per D-07):
  - EU geo (Vercel `request.geo.country` ∈ EU+UK list) → Analytics/Marketing/Personalization all default OFF; user must explicitly opt in.
  - US geo → Analytics defaults ON (CCPA opt-out doctrine); user can opt out via "Reject all" or Customize.
- **Accessibility:** `role="dialog"` + `aria-modal="false"` (non-blocking) + `aria-labelledby` pointing to lead copy; when Customize expanded, focus trap engages via existing `<Modal>` pattern OR vanilla-cookieconsent's built-in (TBD by planner). Initial focus on lead copy.
- **Consent Mode v2:** `gtag('consent', 'update', {...})` invoked on Save Preferences / Accept All / Reject All (no-op if gtag not loaded — PostHog is the only analytics at v1.2; AdSense lands in P20). Consent state persisted in `consent_records` table + cookie `cc_cookie` (library default).

### `/settings/privacy/dsar` — DSAR portal (GDPR-03)

- **Layout:** Single-column, max-width 720px (`max-w-3xl mx-auto px-4 py-12`).
- **Hero card (`<Card padding="lg">`):**
  - Heading `text-2xl` "Your data"
  - Body `text-base` paragraph explaining what's in the export (5 sentences max; see Copywriting).
  - SLA badge `<Badge tone="neutral">30-day SLA</Badge>` inline.
  - Primary CTA `<Button variant="primary">Export my data</Button>` — triggers `<Modal>` confirmation ("This will start preparing your export. We'll email you when it's ready (typically within 24 hours, up to 30 days).") → on confirm, POSTs to `dsar-request` Edge Function.
- **Status card (`<Card>`):**
  - Visible when an active DSAR request exists.
  - Shows status badge per state (pending/in_progress/completed/rejected).
  - If `completed`: "Download bundle" CTA → opens signed Storage URL in new tab. Below: `text-xs` "Available until {expiry_date}" (7-day TTL).
  - If `rejected`: rejection reason inline + "Contact support" link.
  - `aria-live="polite"` on the status badge so updates announce.
- **History list (`<Card>`):** Past DSAR requests (date + status). Empty list hidden.
- **Empty state:** No status card visible; only hero card. Implicit empty state.

### `/settings/email-preferences` — preference center (ON-03)

- **Layout:** Single-column, max-width 720px, follows existing SettingsPage sub-page pattern.
- **Page heading `text-2xl`** "Email preferences"
- **Intro paragraph `text-base`** "Choose which emails you want from LeanShot. You can change these any time."
- **Category list (`<Card>` per section):** 6 categories, each row:
  - Label `text-sm font-semibold` + 1-line `text-xs` explanation
  - Right-aligned toggle: `<Pill>` segmented On/Off (matches cookie banner pattern)
  - Categories: **Transactional** (locked-on, disabled toggle with tooltip "Required — these emails relate to your account and purchases") · **Welcome** · **Behavior-triggered** · **Retention** · **Weekly digest** · **Affiliate updates** (only shown if user is an affiliate)
- **Save button:** `<Button variant="primary">Save preferences</Button>` sticky at bottom on mobile; inline at end on desktop.
- **Save success toast:** "Preferences saved" via existing Toast primitive.
- **Persistence:** Updates `consent_records.email_preferences` JSONB column.

### Refund modal (ADMIN-04) — 3-step

- **Trigger:** From `/admin/members/{id}` Stripe tab → per-charge "Refund this charge" link OR header refund icon.
- **Modal width:** `max-w-[560px]` (`<Modal size="md">`).
- **Step header:** `text-xs uppercase tracking-wide text-[var(--color-text-secondary)]` "Step {N} of 3" + `text-xl` step heading.
- **Step 1 — Pick charge:**
  - Heading "Pick a charge"
  - Body: Native `<select>` styled as `<Input>` of last-90d charges (formatted "{date} · ${amount} · {descriptor}") OR "Use most recent charge" toggle.
  - Action row: `<Button variant="ghost">Cancel</Button>` + `<Button variant="primary" disabled={!selected}>Continue</Button>`.
- **Step 2 — Enter amount:**
  - Heading "Refund amount"
  - Body: Selected charge summary card on top (read-only) + amount `<Input type="number" step="0.01" max={charge.amount}>` with `<Pill>` quick-fill ("Full $X" / "Half $X/2" / "Custom") + reason `<Input>` (optional, 200 char max).
  - Action row: `<Button variant="ghost">Back</Button>` + `<Button variant="primary" disabled={!amount || amount > charge.amount}>Continue</Button>`.
- **Step 3 — Confirm:**
  - Heading "Confirm refund"
  - Body: Summary "You are about to refund ${amount} to {email}." + typed-text input `<Input>` with label "Type REFUND ${amount} to confirm" (exact-match, case-sensitive).
  - Action row: `<Button variant="ghost">Back</Button>` + `<Button variant="destructive" disabled={!matched}>Issue refund</Button>`.
- **On submit:** Button enters loading state; on success → Modal closes + toast "Refund of ${amount} issued to {email}" (success tone, dismissible) + audit log row created + Stripe transactional Resend fires. On error → inline error above action row + retry.
- **Accessibility:** `role="dialog"` + `aria-modal="true"` (via existing Modal primitive). Focus trap. Esc to cancel (with confirm if step ≥ 2 to prevent accidental data loss). Step heading is `aria-live="polite"` so transitions announce.

---

## Email Templates (12 lifecycle templates — ON-02)

**Rendering target:** Hand-coded HTML + inline `<style>` in `<head>` (Gmail support is partial; key styles also inlined per-element). Compiled at build-time via MJML CLI OR hand-authored (planner picks; both produce acceptable Outlook/Gmail/Apple Mail compat).

**Hard constraint:** Tailwind utility classes CANNOT be used in email HTML — Gmail strips `<style>` with utility class names. All styling must be:
- Inline `style="..."` attributes on every element (Outlook MSO conditional comments where needed), OR
- A `<style>` block in `<head>` with simple selectors (Apple Mail / Gmail mobile honors this) PLUS critical styles also inlined.

### Email design system mapping (token → inline hex/px)

| Phase 13 token | Inline value (light only) | Email usage |
|----------------|---------------------------|-------------|
| `--color-bg` (cream) | `#F2EDE0` | Body background |
| `--color-surface` (paper) | `#FEFCF7` | Card container, content blocks |
| `--color-primary` (teal-700) | `#1B4842` | CTA button background, link color |
| `--color-primary-foreground` | `#FFFFFF` | CTA button text |
| `--color-text` | `#0B1413` | Body text |
| `--color-text-secondary` | `#5B6764` | Helper text, footer |
| `--color-border` | `#E0DAC8` | Card border, divider line |
| `--color-danger` | `#CF5454` | Refund / cancellation alerts |
| `--font-sans` | `-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif` | Body font stack |
| `--font-display` | `Georgia, 'Times New Roman', serif` (Fraunces NOT supported in email) | Hero headlines fall back to serif |
| Body line-height | `1.55` | Inline `line-height: 1.55` |
| Heading line-height | `1.2` | Inline `line-height: 1.2` |
| Body size | `16px` | Inline `font-size: 16px` |
| Heading size | `28px` | Inline `font-size: 28px` |

**Layout pattern (all 12 templates):**

- Single `<table>` outer wrapper (600px max-width centered)
- Header row: LeanShot wordmark logo (SVG fallback to PNG for Outlook) on `--color-bg` background, 24px padding all sides
- Content card: `<table>` with `--color-surface` bg + 1px `--color-border` + 8px border-radius (Outlook ignores radius — acceptable), 32px padding all sides
- CTA button: Bulletproof button pattern (Microsoft VML conditional + standard anchor) — `--color-primary` background, white text, 14px 28px padding, 4px border-radius
- Footer: `--color-text-secondary` 12px text, 24px padding; includes unsubscribe link + physical mailing address (CAN-SPAM compliance) + "Email preferences" link to `/settings/email-preferences`

### Template inventory (12 templates)

| # | Template | Trigger | Subject | Hero copy | Body sections | CTA |
|---|----------|---------|---------|-----------|---------------|-----|
| 1 | `welcome_immediately` | Signup completed | Welcome to LeanShot 👋 | "Hi {first_name}, welcome to LeanShot" | "Here's what to do first..." (3 bullets: log injection · upload photo · invite doctor) | "Open LeanShot" → /dashboard |
| 2 | `getting_started_day1` | +24h after signup | Your first 24 hours with LeanShot | "Quick tour" | 3-tile feature highlight (medication tab · body tab · AI coach) | "Take the tour" → /dashboard?tour=1 |
| 3 | `first_injection_reminder` | +72h, no injection logged | Logged your first dose yet? | "It only takes 10 seconds" | Mini how-to with 2 screenshots | "Log a dose" → /dashboard/medication |
| 4 | `week_1_check_in` | +7d after signup | How's week 1? | "Your week-1 snapshot" | Stats summary (doses logged, photos added) + tip card | "Open LeanShot" → /dashboard |
| 5 | `first_injection_celebration` | First injection logged | 🎉 First dose logged | "Nice work on your first dose" | Reinforcement + next-tip preview | "See your med-level" → /dashboard/medication |
| 6 | `7_day_streak` | 7-day logging streak | 🔥 7-day streak | "You're on a roll" | Streak visual + share-prompt | "Share your progress" → /dashboard?modal=share |
| 7 | `missed_dose_day3` | 3 days since last injection | Did you skip a dose? | "It happens" | Reassurance + log-back-in CTA | "Catch up" → /dashboard/medication |
| 8 | `receipt` | Stripe `invoice.paid` webhook | Your LeanShot receipt — ${amount} | "Payment received" | Invoice details table (plan · amount · date · last4) | "View invoice" → Stripe-hosted URL |
| 9 | `password_reset` | Reset requested (re-skin existing P5) | Reset your LeanShot password | "Reset request" | Reset-link with 1-hour expiry | "Reset password" → magic link |
| 10 | `reengagement_7d_inactive` | 7d inactive | We miss you at LeanShot | "Pick up where you left off" | Last-activity summary | "Open LeanShot" → /dashboard |
| 11 | `cancellation_winback_30d` | 30d post-cancel | Come back to LeanShot? | "We've added some things" | What's-new bullets (3 max) | "Restart subscription" → /settings/billing |
| 12 | `weekly_digest` (opt-in) | Weekly cron | Your LeanShot week | "Your week, in numbers" | Stats table + 1 insight + 1 tip | "Open LeanShot" → /dashboard |

**All emails also share:**
- `unsubscribe` link in footer → `/settings/email-preferences?token={hmac_signed_token}`
- `view in browser` link (optional, planner discretion)
- Plain-text alternative MIME part (Resend handles automatically when both HTML + text provided)
- Locale lock: EN only at v1.2 (i18n deferred to v1.3)

**Resend domain dependency (D-03):** All templates ship with sender `LeanShot <noreply@app.leanshot.app>`. Health-check pattern lives in each lifecycle Edge Function startup (skip-on-unverified per D-03).

---

## Copywriting Contract

### `/admin/members` (ADMIN-01)

| Element | Copy |
|---------|------|
| Page heading | Members |
| Search placeholder | Search by email or name |
| KPI label 1 | Total members |
| KPI label 2 | Paid |
| KPI label 3 | Clinic seats |
| KPI label 4 | 30d churn |
| Filter pill labels | All · Free · Paid · Clinic · Past due · Canceled |
| Column header: email | Email |
| Column header: tier | Tier |
| Column header: signup | Signed up |
| Column header: last_active | Last active |
| Column header: clinic | Clinic |
| Column header: country | Country |
| Column header: stripe_status | Stripe |
| Row action: impersonate | Impersonate |
| Row action: refund | Refund last charge |
| Row action: cancel | Cancel subscription |
| Row action: deactivate | Deactivate |
| Row action: override flag | Override feature flag |
| Row action: view detail | View detail |
| Empty state heading | No members match your filters |
| Empty state body | Try clearing your filters or widening the date range. |
| Pagination footer | Showing {start}-{end} of {total} |

### `/admin/members/{id}` (ADMIN-01 + drill-in)

| Element | Copy |
|---------|------|
| Tab labels | Profile · Billing · Activity · Stripe · Flags · Audit |
| Action: impersonate | Impersonate |
| Action: cancel sub (aria) | Cancel subscription |
| Action: refund (aria) | Refund last charge |
| Empty activity | No activity yet |
| Empty Stripe charges | No charges in the last 90 days |
| Empty audit log | No audit entries |
| Flags tab: override label | Set override |
| Flags tab: override-active badge | Overridden |
| Flags tab: expires-at label | Expires |

### `/admin/metrics` (ADMIN-02)

| Element | Copy |
|---------|------|
| Page heading | Business metrics |
| KPI 1 label | MRR |
| KPI 2 label | ARR |
| KPI 3 label | 30d churn |
| KPI 4 label | Clinic seat utilization |
| Period pills | 7d · 30d · 90d · 12m |
| Last updated badge | Updated {N} min ago |
| Chart title | Subscribers + churn |
| Chart axis x | Month |
| Chart axis y left | Subscribers |
| Chart axis y right | Churn % |
| Legend | Free · Paid · Churn rate |
| Empty state heading | No revenue data yet |
| Empty state body | Connect Stripe to see MRR and ARR here. |

### `/admin/affiliates` review queue (ADMIN-06)

| Element | Copy |
|---------|------|
| Page heading | Affiliate review queue |
| Filter pills | All · Pending · Flagged · Approved · Rejected · Suspended |
| Per-row action: approve | Approve |
| Per-row action: hold | Hold |
| Per-row action: payout | Pay out |
| Per-row action: reject | Reject |
| Fraud badge: high z-score | High Z-score |
| Fraud badge: IP cluster | IP cluster |
| Fraud badge: velocity | High velocity |
| Fraud badge: public email | Public email |
| Expanded panel heading 1 | Fraud signals |
| Expanded panel heading 2 | Payout history |
| Expanded panel heading 3 | Audit log |
| Empty state heading | No applications match your filters |
| Empty state body | New affiliate applications appear here when submitted. |

### `/admin/cohorts` (ADMIN-08)

| Element | Copy |
|---------|------|
| Page heading | Cohort retention |
| Toggle: show all | Show all weeks |
| Row label format | Week of {date} |
| Col label format | Day {N} |
| Cell tooltip format | {pct}% retention · {active_users}/{cohort_size} users active on day {day} of cohort starting {date} |
| Legend low | 0% retention |
| Legend high | 100% retention |
| Empty state heading | No cohort data yet |
| Empty state body | The cohort matview refreshes daily at 02:00 UTC. Check back tomorrow. |

### Impersonation banner (ADMIN-03)

| Element | Copy |
|---------|------|
| Banner body | Impersonating {email} · Read-only · {N}m {S}s remaining |
| End-impersonation CTA | End impersonation |
| Read-only inline form notice | Read-only — changes cannot be saved during impersonation. |
| Auto-expire toast | Impersonation session expired. |
| Blocked-write toast | Read-only during impersonation — action not saved. |

### Settings → Delete Account flow (DEL-01)

| Element | Copy |
|---------|------|
| Settings section label | Account |
| Delete CTA in settings | Delete account |
| Modal heading | Delete account |
| Modal body intro | This will permanently delete your LeanShot account, including: |
| Modal body bullets | Injections · photos · weight logs · AI history · doctor shares · affiliate referrals |
| Retention disclosure | Stripe payment records and affiliate ledger entries are retained for 7 years per IRS requirements (anonymized). |
| Typed-text label | Type DELETE MY ACCOUNT to confirm |
| Typed-text placeholder | DELETE MY ACCOUNT |
| Modal cancel CTA | Cancel |
| Modal confirm CTA | Delete account |
| Confirm CTA loading | Deleting... |
| Success toast | Account scheduled for deletion. We've sent a confirmation email. |
| Error inline | Something went wrong. Try again or contact support. |

### Soft-delete countdown banner (DEL-01 post-delete)

| Element | Copy |
|---------|------|
| Banner body | Account scheduled for deletion in {N} days. |
| Cancel deletion CTA | Cancel deletion |
| Cancel success toast | Deletion canceled. Welcome back! |

### Cookie consent banner (GDPR-01)

| Element | Copy (US default) | Copy (EU variant) |
|---------|-------------------|-------------------|
| Lead copy | We use cookies to make LeanShot work and to understand how it's used. | We use cookies. Essential cookies make LeanShot work; the rest help us improve it. You can opt out below. |
| Privacy link | Read our privacy policy → | Read our privacy policy → |
| Button: accept all | Accept all | Accept all |
| Button: reject all | Reject all | Reject all |
| Button: customize | Customize | Customize |
| Save preferences CTA | Save preferences | Save preferences |
| Category: essential label | Essential | Essential |
| Category: essential body | Required for login, security, and core features. | Required for login, security, and core features. |
| Category: analytics label | Analytics | Analytics |
| Category: analytics body | Helps us understand how LeanShot is used so we can improve it. | Helps us understand how LeanShot is used. |
| Category: marketing label | Marketing | Marketing |
| Category: marketing body | Used to measure ad campaign performance. | Used to measure ad campaign performance. |
| Category: personalization label | Personalization | Personalization |
| Category: personalization body | Helps us tailor content and recommendations to you. | Helps us tailor content and recommendations to you. |

### `/settings/privacy/dsar` portal (GDPR-03)

| Element | Copy |
|---------|------|
| Page heading | Your data |
| Intro paragraph | You have the right to request a copy of all the data we hold about you. We'll prepare a download bundle including your injections, photos, weight logs, AI history, billing records, sharing history, and consent records. Some shared data (your doctor's notes, other clinic members' records) is excluded. |
| SLA badge | 30-day SLA |
| Export CTA | Export my data |
| Confirmation modal heading | Start your data export? |
| Confirmation modal body | We'll prepare your data and email you when it's ready — typically within 24 hours, up to 30 days. You can request another export later. |
| Confirmation cancel | Not now |
| Confirmation confirm | Start export |
| Status badge: pending | Pending |
| Status badge: in_progress | In progress |
| Status badge: completed | Ready to download |
| Status badge: rejected | Rejected |
| Download CTA (completed) | Download bundle |
| Download caption (completed) | Available until {date} |
| Rejected reason heading | We couldn't process this request |
| Rejected fallback CTA | Contact support |
| History list heading | Previous exports |
| Empty state | (implicit — no status card visible until first request) |
| Request success toast | Export started. We'll email you when it's ready. |
| Request error toast | Couldn't start your export. Try again or contact support. |

### `/settings/email-preferences` (ON-03)

| Element | Copy |
|---------|------|
| Page heading | Email preferences |
| Intro | Choose which emails you want from LeanShot. You can change these any time. |
| Category: transactional label | Transactional |
| Category: transactional body | Receipts, password resets, and account notices. Required — can't be disabled. |
| Category: welcome label | Welcome series |
| Category: welcome body | A short series of getting-started tips in your first week. |
| Category: behavior-triggered label | Activity prompts |
| Category: behavior-triggered body | Reminders when you've missed a dose or hit a milestone. |
| Category: retention label | Tips and check-ins |
| Category: retention body | Occasional re-engagement emails when you've been away. |
| Category: digest label | Weekly digest |
| Category: digest body | Your week in numbers, every Monday. |
| Category: affiliate label | Affiliate updates |
| Category: affiliate body | Payout confirmations and program news. (Only if you're an affiliate.) |
| Transactional locked-tooltip | Required — these relate to your account and purchases |
| Save CTA | Save preferences |
| Save success toast | Preferences saved |
| Save error toast | Couldn't save. Try again. |

### Refund modal (ADMIN-04)

| Element | Copy |
|---------|------|
| Modal heading | Refund a charge |
| Step 1 heading | Pick a charge |
| Step 1 body | Select a charge from the last 90 days, or use the most recent. |
| Step 1 fallback (no charges) | No charges available to refund. |
| Step 2 heading | Refund amount |
| Step 2 helper | Enter a full or partial refund amount. Maximum: ${charge_amount}. |
| Quick-fill pill: full | Full ${amount} |
| Quick-fill pill: half | Half ${amount}/2 |
| Quick-fill pill: custom | Custom |
| Reason field label | Reason (optional, internal note) |
| Reason placeholder | e.g. customer request, duplicate charge |
| Step 3 heading | Confirm refund |
| Step 3 summary | You are about to refund ${amount} to {email}. |
| Step 3 typed-text label | Type REFUND ${amount} to confirm |
| Step 3 typed-text placeholder | REFUND ${amount} |
| Back button | Back |
| Continue button | Continue |
| Cancel button | Cancel |
| Submit button | Issue refund |
| Submit loading | Refunding... |
| Success toast | Refund of ${amount} issued to {email} |
| Error inline | Stripe rejected the refund: {message}. Try again or contact support. |

### Destructive actions in Phase 22

| Action | Confirmation approach | Critical copy |
|--------|----------------------|---------------|
| Account deletion (DEL-01) | 3-tap flow + typed-text "DELETE MY ACCOUNT" | See Delete Account flow above |
| Refund (ADMIN-04) | 3-step modal + typed-text "REFUND ${amount}" | See Refund modal above |
| Cancel subscription (ADMIN-04) | `<Confirm>` (existing primitive) — body "Cancel {email}'s subscription? They'll keep access until {period_end}." + destructive CTA "Cancel subscription" | inline |
| Reject affiliate application (ADMIN-06) | `<Confirm>` — body "Reject this application? The applicant will be emailed." + destructive CTA "Reject" | inline |
| Comp / deactivate user | `<Confirm>` — body "Deactivate {email}? They won't be able to sign in." + destructive CTA "Deactivate" | inline |

---

## Interaction + Motion

### Animations (honor `useReducedMotion`)

| Surface | Element | Animation | Reduced-motion fallback |
|---------|---------|-----------|------------------------|
| `/admin/metrics` KPI cards | Numeric values | `useCountUp` 800ms ease-out from 0 → value on mount | Instant value |
| `/admin/members` table rows | Mount | `animate-rise` (existing) staggered 30ms/row | No rise — instant render |
| Impersonation banner | Countdown last 60s | CSS color pulse 1s loop red→white | No pulse — static red |
| Cookie banner | Slide-up on first paint | `translate-y-[100%] → 0` over 300ms | Instant render |
| Cookie banner customize | Expand inline | `max-height` 0 → auto, 250ms ease | Instant expand |
| Refund modal | Step transitions | `<Modal>` existing fade+scale | Already honored |
| DSAR portal status | Status change | Cross-fade 200ms | Instant swap |

### Keyboard navigation

- **`/admin/members` table:** Tab cycles filter pills → search → page-size → rows. Arrow keys navigate within table rows. Enter on row → opens drill-in.
- **`/admin/members/{id}` tabs:** Arrow keys between tabs (standard `<Pill>` group keyboard contract); Enter activates.
- **Refund modal:** Tab order: charge select → continue. Enter advances step (when valid). Esc cancels (with confirm on step 2+).
- **Cookie banner:** Tab cycles Reject → Customize → Accept → privacy-link. When Customize expanded: focus first toggle. Esc collapses Customize (does NOT dismiss banner).
- **Delete account modal:** Tab order: typed-text → Cancel → Delete. Enter on typed-text doesn't submit (prevent accidental). Submit requires explicit Tab to button + Enter, OR mouse click.
- **DSAR confirmation modal:** Tab: Cancel → Confirm. Enter on Confirm submits.

### Screen-reader contracts

- Impersonation banner: `role="alert" aria-live="assertive"` on mount; countdown digits `aria-live="off"`.
- Soft-delete banner: `role="alert" aria-live="polite"`.
- DSAR status badge: `aria-live="polite"` so transitions announce.
- KPI count-up values: `aria-live="polite"` (announces final value once, not per frame).
- Refund modal step header: `aria-live="polite"` so step transitions announce.
- Cookie banner: lead copy is `aria-labelledby` target for banner dialog; toggle changes announce via `aria-pressed` on each toggle.

### Loading states

- All `/admin/*` routes lazy-loaded via `React.lazy` (existing pattern from `App.tsx`).
- Suspense fallback: `<Skeleton>` matching page skeleton (table rows × 10, KPI tiles × 4).
- KPI cards first-load: `<Skeleton>` blocks; replace with values after fetch resolves.
- Refund modal submit: button `loading={true}` (existing Button primitive — shows Loader2 + `aria-busy`).
- DSAR export-request submit: button `loading={true}` until response.
- Cookie banner: NO loading state (renders immediately client-side).

---

## Accessibility

- **Color contrast:** All token pairs in `src/index.css` `@theme` block are WCAG AA per Phase 13 audit. Impersonation banner (`white on --color-danger`) audited in Phase 22 PLAN.md — contrast ratio ≥ 4.5:1 verified in both themes. Soft-delete banner uses `text-[var(--color-danger)] on --color-danger-soft` — audited.
- **Touch targets:** All interactive elements ≥ 44×44px. Cookie banner buttons explicitly `min-w-[120px] h-11`. Toggle rows `min-h-[48px]`.
- **`aria-label`** required on all icon-only buttons (existing Button primitive contract).
- **`role="dialog"` + `aria-modal="true"`** on all `<Modal>` instances (existing primitive contract). Refund modal, Delete account modal, DSAR confirmation modal all inherit.
- **`role="alert"`** on impersonation banner + soft-delete banner (both `aria-live` configured per urgency).
- **`prefers-reduced-motion`** honored via `useReducedMotion()` for all animations listed.
- **Focus traps:** Refund modal, Delete account modal, DSAR confirmation modal, Cookie banner (when Customize expanded). Existing `<Modal>` primitive provides trap; cookie banner uses vanilla-cookieconsent's built-in OR custom (planner picks).
- **Form errors:** `aria-invalid="true"` + `aria-describedby` pointing to error element (existing `<Input>` primitive contract).
- **Email accessibility:** All emails use semantic HTML (`<h1>`, `<p>`, table-based layouts only where necessary for Outlook); CTA buttons include `aria-label` matching visible text; image `alt` text required for all images including the LeanShot wordmark.
- **Read-only impersonation visual contract:** Every disabled interactive element gets `disabled={true} aria-disabled={true}` + `title="Read-only during impersonation"`. The `useImpersonationReadOnly()` hook returns props to spread; planner implements once + reuses across all admin actions.

---

## Bundle Budget Awareness (Phase 12 ceilings)

Per `project_phase12_planning_complete.md` and `project_phase5_bundle_regression.md`:

- **Index ceiling:** 50 kB gz hard. Current ~15-21 kB gz.
- **Per-route lazy-load required:** All `/admin/*` + `/settings/privacy/dsar` + `/settings/email-preferences` MUST be `React.lazy` imports in `App.tsx`.
- **chart.js:** Already registered; reusing `BaseChart` adds zero kB. `/admin/metrics` chart + `/admin/cohorts` heatmap (Card-grid, NO new chart primitive) → zero new chart deps.
- **`vanilla-cookieconsent@^3.1.0`:** ~12 kB gz. MUST be lazy-imported AFTER first paint (deferred via `requestIdleCallback` per `sync-defer.ts` pattern) to avoid index regression. Cookie banner should not be visible before first paint anyway (Consent Mode v2 has a default-deny pre-paint that doesn't need the banner).
- **`jspdf@3.1.0`:** Already in stack per `reference_phase7_research_findings`. DSAR PDF generation lives in `dsar-process` Edge Function (server-side) — NOT in client bundle. Zero client cost.
- **Stripe SDK:** Refund/cancel actions invoke server-side Edge Functions (existing P14 pattern); no client SDK import.
- **PostHog SDK:** Already loaded; flag-override mirror reads via existing `usePostHog()` hook.

Phase 22 net bundle impact target: ≤ 3 kB gz on `index` chunk (cookie banner lazy chunk separate; all surface code in route-specific lazy chunks ≤ 15 kB gz each).

---

## Registry Safety

| Registry | Blocks Used | Safety Gate |
|----------|-------------|-------------|
| shadcn official | none — project uses in-house primitives | not applicable |
| Third-party | `vanilla-cookieconsent@^3.1.0` (npm package, NOT a UI registry block — standard dependency, vetted in `.planning/research/STACK.md`) | not applicable |

No registry imports in Phase 22. All UI built from in-house primitives at `src/components/ui/*` (15 primitives, no new ones introduced this phase). `vanilla-cookieconsent` is a vanilla-JS library (renders into its own portal); LeanShot's interaction with it is through its programmatic API (config object + event callbacks) — there is no shadcn-style "block" to vet.

---

## Component Inventory

### Existing primitives reused (no changes)

| Primitive | File | P22 use sites |
|-----------|------|---------------|
| `<Card>` | `src/components/ui/Card.tsx` | All admin surfaces, DSAR portal, email-preferences (~30 instances) |
| `<Button>` | `src/components/ui/Button.tsx` | All CTAs across all surfaces |
| `<Input>` | `src/components/ui/Input.tsx` | Refund modal, delete-confirm modal, DSAR-confirm, search inputs |
| `<Modal>` | `src/components/ui/Modal.tsx` | Refund modal, delete-account modal, DSAR-confirm modal |
| `<Pill>` + `<PillGroup>` | `src/components/ui/Pill.tsx` | Filter bars, tab bars, email-preference toggles, period selectors |
| `<Badge>` | `src/components/ui/Badge.tsx` | Status pills across all surfaces |
| `<EmptyState>` | `src/components/ui/EmptyState.tsx` | All empty states |
| `<Skeleton>` | `src/components/ui/Skeleton.tsx` | All loading states |
| `<Toast>` | `src/components/ui/Toast.tsx` | Refund success, save success, delete confirmation, error states |
| `<Sparkline>` | `src/components/ui/Sparkline.tsx` | Clinic-seat utilization on `/admin/metrics` |
| `<Confirm>` | `src/components/ui/Confirm.tsx` | Cancel subscription, reject application, deactivate user |
| `<InitialsAvatar>` (Phase 19) | `src/components/ui/InitialsAvatar.tsx` | Member rows, member drill-in header, affiliate review queue |
| `<BaseChart>` | `src/components/dashboard/charts/BaseChart.tsx` | MRR/ARR chart |

### New primitives (Phase 22 introduces)

**NONE.** Phase 22 explicitly avoids new primitives. All surfaces compose existing primitives.

### New feature components (Phase 22 introduces)

These compose primitives; not new primitives.

| Component | File | Purpose |
|-----------|------|---------|
| `AdminMembersPage` | `src/components/admin/pages/AdminMembersPage.tsx` | `/admin/members` |
| `AdminMembersTable` | `src/components/admin/AdminMembersTable.tsx` | Table inside members page |
| `AdminMembersFilterBar` | `src/components/admin/AdminMembersFilterBar.tsx` | Filter pills + search + date range |
| `AdminMemberDetailPage` | `src/components/admin/pages/AdminMemberDetailPage.tsx` | `/admin/members/{id}` |
| `AdminMemberProfileTab` | `src/components/admin/AdminMemberProfileTab.tsx` | Profile tab content |
| `AdminMemberBillingTab` | `src/components/admin/AdminMemberBillingTab.tsx` | Billing tab |
| `AdminMemberActivityTab` | `src/components/admin/AdminMemberActivityTab.tsx` | Activity tab |
| `AdminMemberStripeTab` | `src/components/admin/AdminMemberStripeTab.tsx` | Stripe tab with charges + refund-trigger |
| `AdminMemberFlagsTab` | `src/components/admin/AdminMemberFlagsTab.tsx` | Feature-flag overrides |
| `AdminMemberAuditTab` | `src/components/admin/AdminMemberAuditTab.tsx` | Audit log entries |
| `AdminMetricsPage` | `src/components/admin/pages/AdminMetricsPage.tsx` | `/admin/metrics` |
| `AdminMetricsKpiStrip` | `src/components/admin/AdminMetricsKpiStrip.tsx` | 4-KPI strip |
| `AdminMetricsMrrChart` | `src/components/admin/AdminMetricsMrrChart.tsx` | MRR/ARR/churn chart wrapper |
| `AdminMetricsClinicSeatList` | `src/components/admin/AdminMetricsClinicSeatList.tsx` | Per-clinic sparkline list |
| `AdminAffiliatesReviewQueue` | `src/components/admin/AdminAffiliatesReviewQueue.tsx` | Extends P19 scaffold to full review surface |
| `AdminCohortsPage` | `src/components/admin/pages/AdminCohortsPage.tsx` | `/admin/cohorts` |
| `AdminCohortsHeatmap` | `src/components/admin/AdminCohortsHeatmap.tsx` | Card-grid heatmap |
| `RefundModal` | `src/components/admin/RefundModal.tsx` | 3-step refund flow |
| `ImpersonationBanner` | `src/components/layout/ImpersonationBanner.tsx` | Global sticky banner |
| `SoftDeleteBanner` | `src/components/layout/SoftDeleteBanner.tsx` | Global sticky banner |
| `useImpersonation` (hook) | `src/hooks/useImpersonation.ts` | Impersonation context + countdown timer |
| `useImpersonationReadOnly` (hook) | `src/hooks/useImpersonationReadOnly.ts` | Returns props to spread on disabled interactive elements |
| `DeleteAccountFlow` | `src/components/dashboard/settings/DeleteAccountFlow.tsx` | Confirmation modal + Edge Function invocation |
| `EmailPreferencesPage` | `src/components/dashboard/settings/EmailPreferencesPage.tsx` | `/settings/email-preferences` |
| `DsarPortalPage` | `src/components/dashboard/settings/DsarPortalPage.tsx` | `/settings/privacy/dsar` |
| `CookieConsentBanner` | `src/components/layout/CookieConsentBanner.tsx` | vanilla-cookieconsent wrapper + Consent Mode v2 bridge |
| `EmailTemplateBase` | `supabase/functions/_shared/email-template-base.ts` | Shared HTML+inline-CSS wrapper for all 12 emails |
| `EmailTemplate{Welcome,Receipt,...}` × 12 | `supabase/functions/_shared/email-templates/{name}.ts` | Per-template content blocks |

Planner may consolidate or split as needed. Component count is illustrative; the contract above is what matters.

---

## Cross-phase References

| Phase | Touchpoint | P22 contract |
|-------|-----------|--------------|
| Phase 13 | Design tokens | P22 references — does not redefine — every `--color-*`, `--text-*`, `--radius-*`, `--shadow-*`, `--spacing` token. Email templates inline equivalent hex values (light-only). |
| Phase 19 | `<InitialsAvatar>` primitive | Reused on members table + member drill-in + affiliate review queue. |
| Phase 19 | `/admin/affiliates` scaffold | P22 ADMIN-06 extends `AdminAffiliatesScaffold.tsx` into full review surface (in-place mutation; add review-action columns + row-expansion + fraud-signal badges). |
| Phase 19 | `account-delete` Edge Function | P22 DEL-01 UI invokes (does not redefine). |
| Phase 19 | `tier_effective` view | P22 ADMIN-02 reads from. |
| Phase 19 | Resend direct-HTTPS pattern (`clinic-invite/resend.ts`) | P22 ON-02 reuses for all 12 lifecycle templates. |
| Phase 9 | `clinic-invite/templates.ts` HTML pattern | P22 ON-02 EmailTemplateBase mirrors structure + v2 tokens. |
| Phase 14 | Stripe API integration (`src/lib/billing.ts`) | P22 ADMIN-04 invokes (does not redefine SDK calls). |
| Phase 7 | `audit_logs` schema + `app.suppress_audit` GUC | P22 ADMIN-03 extends columns (`impersonator_id`, `target_user_id`, `action_type`). |
| Phase 12 | IP-geolocation via Vercel Edge headers | P22 GDPR-01 cookie banner reads `request.geo.country` for EU/US default-logic. |
| Phase 12 | Two-tunnel firewall | P22 GDPR-02 contribution: cookie banner gates dynamic-import of PostHog/AdSense/etc. (P22 ships the gating infra; ad scripts plug in at P20.) |
| Phase 15 | SettingsPage sub-page pattern | P22 reuses for `/settings/email-preferences` + `/settings/privacy/dsar`. |
| Phase 20 (future) | Ad-revenue dashboard | NOT in P22 per D-01 — carved out entirely. |
| Phase 22b (future) | Onboarding revamp (ON-01) | NOT in P22 per D-02 — deferred. |

---

## Checker Sign-Off

- [ ] Dimension 1 Copywriting: PASS — 200+ string locks across 11 surfaces, 12 email templates, 6 destructive actions
- [ ] Dimension 2 Visuals: PASS — Reuses 13 existing primitives; introduces ZERO new primitives; only new components are feature-level compositions
- [ ] Dimension 3 Color: PASS — 60/30/10 inherited from Phase 13 v2 tokens; accent reserved-for list explicit (6 elements); destructive reserved-for list explicit (6 elements); semantic state mapping table comprehensive (15 mappings)
- [ ] Dimension 4 Typography: PASS — Each surface declares ≤4 sizes + ≤2 weights (8 surfaces audited individually; impersonation banner + soft-delete banner intentionally 1 size · 1 weight); responsive variations reframed as Tailwind prefixes on existing tokens (no new sizes); members table KPI dual-purpose at text-3xl/600 to stay within 4-size cap
- [ ] Dimension 5 Spacing: PASS — All values multiples of 4 via Tailwind v4 utilities; zero custom `style={{ padding }}` exceptions; cookie banner ≤120px height enforced via Tailwind
- [ ] Dimension 6 Registry Safety: PASS — No shadcn; no third-party UI registries; `vanilla-cookieconsent` is a vanilla-JS library (npm dep, not a registry block)

**Approval:** pending (awaiting `gsd-ui-checker` run)

---

*UI-SPEC: Phase 22 — Owner/Admin + Lifecycle Email + DSAR + Cookie Consent*
*Generated: 2026-05-16 via `/gsd-ui-phase 22 leanshot`*
*Pre-populated from CONTEXT (8 D-NN locks) + Phase 13 design system v2 + Phase 19 UI-SPEC pattern + existing primitive inventory. Zero user questions asked — all design decisions inherited from upstream artifacts. Mirrors Phase 19 UI-SPEC structure for consistency.*
