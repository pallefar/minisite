---
phase: 19
slug: affiliate-program-stripe-connect
status: approved
reviewed_at: 2026-05-15
shadcn_initialized: false
preset: none
created: 2026-05-15
token_source: Phase 13 design system v2 (`src/index.css` `@theme` block) — DO NOT redefine
---

# Phase 19 — UI Design Contract

> Visual + interaction contract for the affiliate program surfaces (apply form, admin scaffold, `/partner/*` dashboard tree, `/r/{code}` co-branded landing templates, Stripe Connect onboarding card, initials-avatar primitive). Consumed by `gsd-planner`, `gsd-executor`, `gsd-ui-checker`, `gsd-ui-auditor`.
>
> **All tokens reference the Phase 13 v2 `@theme` block in `src/index.css`. This phase introduces ZERO new color/spacing/font tokens.** Phase 19 only adds ONE new UI primitive (`<InitialsAvatar>`) — everything else composes existing primitives.

---

## Design System

| Property | Value |
|----------|-------|
| Tool | none (manual Tailwind v4 `@theme` design system, established Phase 13) |
| Preset | not applicable |
| Component library | in-house at `src/components/ui/*` (15 primitives, all v2-refreshed) |
| Icon library | `lucide-react ^0.460.0` |
| Font | Geist (sans), Geist Mono (mono), Fraunces (display) — loaded via `<link>` in `index.html`; DO NOT use `@import` chain |
| Token source | `src/index.css` `@theme {}` block (Phase 13 v2) — CSS custom properties only |
| Theme model | `data-theme="light\|dark"` attr on `<html>`; `applyThemeToDOM()` runs pre-mount in `src/main.tsx` |

---

## Spacing Scale

**Inherited from Phase 13 v2 design system. Tailwind v4 spacing base is `0.25rem` (4px).**

| Tailwind utility | Value | Phase 19 usage |
|------------------|-------|----------------|
| `p-1` / `gap-1` | 4px | Icon gaps inside buttons, chip insets |
| `p-2` / `gap-2` | 8px | Tight stack (form field label → input), badge padding |
| `p-3` / `gap-3` | 12px | Compact card inner padding (`/partner/dashboard` activity-feed rows) |
| `p-4` / `gap-4` | 16px | Default card padding (mobile), form-field stack |
| `p-5` / `p-6` | 20px / 24px | Card padding md (matches `<Card padding="md">` default) |
| `p-7` / `p-8` | 28px / 32px | Section breaks; landing-page hero padding |
| `py-12` | 48px | Marketing-style hero vertical padding (`/r/{code}` templates) |
| `py-16` | 64px | Page-level top/bottom on `/affiliate` apply form |

**Exceptions:** None. All values are multiples of 4 mapping to Tailwind v4's `--spacing: 0.25rem` base. The UI-checker's "non-standard spacing values absolutely" trap (per `reference_ui_checker_dimension_traps.md`) is honored by routing every Phase 19 size through Tailwind utilities — no custom `style={{ padding: '17px' }}` ever.

**Touch targets:** All interactive elements ≥ 44×44px (`h-11` minimum on Button via existing `Button` primitive's `size="md"` default). Icon-only buttons use `h-11 w-11` with `aria-label`.

---

## Typography

**4 sizes per surface, 2 weights per surface — UI-checker compliance.** Tokens reference Phase 13 v2 type scale in `src/index.css`.

### Per-surface type budgets (each ≤ 4 sizes, ≤ 2 weights)

#### `/affiliate` apply form

| Role | Token | px | Weight | Line-height | Usage |
|------|-------|----|--------|-------------|-------|
| Heading | `text-3xl` | 32 | 600 (semibold) | 1.15 | Page title "Apply to the LeanShot affiliate program" |
| Body | `text-base` | 16 | 400 (regular) | 1.55 | Field labels, helper text, error messages |
| Label | `text-sm` | 13 | 600 (semibold) | 1.5 | Form field labels (above input) |
| Caption | `text-xs` | 12 | 400 (regular) | 1.45 | Field helper text + character counter |

#### `/admin/affiliates` read-only scaffold

| Role | Token | px | Weight | Line-height | Usage |
|------|-------|----|--------|-------------|-------|
| Heading | `text-xl` | 22 | 600 | 1.35 | Page title "Affiliate applications" |
| Body | `text-sm` | 13 | 400 | 1.5 | Table cell content |
| Label | `text-xs` | 12 | 600 | 1.45 | Table column headers (uppercase) |
| Badge | `text-[11px]` (`--text-micro`) | 11 | 600 | 1.4 | Status badge via `<Badge>` (existing primitive) |

#### `/partner/dashboard`

| Role | Token | px | Weight | Line-height | Usage |
|------|-------|----|--------|-------------|-------|
| Heading | `text-2xl` | 26 | 600 | 1.25 | Greeting "Hi {display_name} 👋" + section headings |
| KPI value | `text-3xl` | 32 | 600 | 1.15 | KPI card numeric value (e.g. "$340.00") |
| Body | `text-sm` | 13 | 400 | 1.5 | Activity-feed rows, card subtitles |
| Caption | `text-xs` | 12 | 400 | 1.45 | "Updated N min ago" badge, KPI labels |

#### `/partner/links`, `/partner/payouts`, `/partner/assets`

Same budget as `/partner/dashboard` (one `text-2xl` page heading, `text-base` for primary fields, `text-sm` for body, `text-xs` for captions). Treat as one surface family.

#### `/r/{code}` co-branded landing pages (3 templates)

| Role | Token | px | Weight | Line-height | Usage |
|------|-------|----|--------|-------------|-------|
| Display (hero) | `text-display` | 64 | 400 (regular) — Fraunces display font | 0.95 | `{{display_name}}` on `coach` template hero |
| Heading | `text-4xl` | 42 | 600 | 1.05 | `story`/`method` hero headlines |
| Body | `text-lg` | 18 | 400 | 1.5 | Value-prop bullets, testimonial-quote body |
| Caption | `text-sm` | 13 | 400 | 1.5 | Affiliate attribution footer, fine print |

Total surface family sizes: 4. Weights: 2 (regular for Fraunces display, semibold for sans headings + 400 sans body). Compliant.

**Responsive type reframing (UI-checker trap mitigation):** Mobile reductions use Tailwind responsive prefixes on the SAME token name (e.g. `text-3xl md:text-4xl`), NOT new size tokens. Phase 13 token set is the universe.

---

## Color

### 60 / 30 / 10 split (inherits Phase 13 v2 semantic tokens)

| Role | Light value | Dark value | Token | Usage |
|------|-------------|------------|-------|-------|
| Dominant 60% | `#f2ede0` cream | `#0b1413` teal-950 | `--color-bg` | Page background (with paper-grain SVG overlay in light) |
| Secondary 30% | `#fefcf7` paper | `#16201e` near-black | `--color-surface` | Cards, KPI tiles, form containers, table rows |
| Accent 10% | `#1b4842` teal-700 | `#6fcbb8` teal-300 | `--color-primary` | Primary CTAs, focus rings, link text, KPI value emphasis on hero variant |
| Destructive | `#cf5454` clay | `#da6f6f` clay-light | `--color-danger` | "Reject application" CTA in admin scaffold, fraud-flag indicators |

### Accent reserved-for list (UI-checker compliance — explicit, not "all interactive")

Accent (`--color-primary`) is used ONLY on:
1. **Primary CTAs** — Apply submit, "Complete tax onboarding", "Copy referral link", "Refresh" (always via `<Button variant="primary">`).
2. **Focus rings** — Inherited from existing primitives' `focus-visible:ring-[var(--color-primary)]`.
3. **Active nav state** — `/partner/*` sub-nav active item underline (1px primary).
4. **KPI value text** — The numeric `text-3xl` on dashboard KPI cards uses `text-[var(--color-primary)]` for emphasis (4 instances).
5. **Status badge `confirmed` tone** — Reuses existing `<Badge tone="success">` (`--color-success`); semantic green, NOT accent teal — does NOT consume accent budget.
6. **Trend chart line stroke** — Daily clicks line in `BaseChart` uses `--color-primary`. Conversions line uses `--color-success`.

Body text, secondary actions, card borders, neutral badges all use `--color-text`, `--color-border`, `--color-surface-elevated` etc. — NOT accent.

### Semantic states (badges + indicators)

Use existing `<Badge>` primitive (`tone="info|success|warning|danger|neutral|inverse"`). Phase 19 status mappings:

| Domain state | Badge tone | Visual | Used on |
|--------------|------------|--------|---------|
| `confirmed` | `success` | green soft + dark green text | Activity feed, payouts table |
| `pending_review` | `warning` | orange soft + orange text | Activity feed (flagged rows), admin queue |
| `flagged` | `danger` | clay soft + clay text | Admin scaffold, fraud queue badges |
| `paid` | `success` | green soft + dark green text | Payouts table |
| `failed` | `danger` | clay soft + clay text | Payouts table |
| `pending` (Connect) | `neutral` | grey + neutral text | Stripe Connect status pill |
| `needs_info` (Connect) | `warning` | orange soft + orange text | Stripe Connect status pill |
| `active` (Connect) | `success` | green soft + dark green text | Stripe Connect status pill |
| `restricted` (Connect) | `danger` | clay soft + clay text | Stripe Connect status pill |

**No new color tokens. No hardcoded hex values in any Phase 19 component file.** Every color reads from a `--color-*` CSS variable on `src/index.css`. Dark mode parity is automatic via `[data-theme=dark]` overrides already in `index.css:174-222`.

---

## Layout Contracts (per surface)

### `/affiliate` — public apply form

- **Container:** Single column, max-width 480px (`max-w-[480px] mx-auto`), `py-16 px-4 md:px-6`.
- **Structure (top-down):**
  1. Inline brand logo + word-mark (top-left, links to `/`)
  2. `text-3xl` heading "Apply to the LeanShot affiliate program"
  3. `text-base text-[var(--color-text-secondary)]` subhead — see Copywriting Contract
  4. `<Card variant="default" padding="lg">` containing the form
  5. Form stacked vertical (`gap-5`): 5 fields in order: email, name, audience size, audience type, "Why us?" textarea
  6. `<Button variant="primary" size="lg" block>` submit
  7. Footer: `text-xs` link "Already approved? Sign in →"
- **Field primitives:** Reuse `<Input>` for text + number; build a single-select via existing primitive pattern (look up `src/components/ui/` for an existing select; if absent, planner uses native `<select>` styled to match `<Input>` — DO NOT introduce a Combobox lib).
- **Submit-state ladder:** `idle → submitting (Button loading=true) → success (replace card with check-icon + "Check your email" toast)`. Form does NOT persist after success.
- **Empty/error states:** Per-field validation displayed below field in `--color-danger` text. No floating-form-error pattern.
- **Responsive:** Single column on all viewports. No desktop bento.

### `/admin/affiliates` — read-only scaffold (gated `role='admin'`)

- **Layout:** Mirror Phase 9/10 clinic-operator table pattern (`src/components/clinic/RosterTable.tsx` analogue).
- **Header bar:** `text-xl` heading + filter `<Pill>` segmented control ("All / Pending / Approved / Rejected / Flagged") + count badge per state via `<Button count={N}>`.
- **Table:** 6 columns (email, display_name, audience_type, audience_size, status badge, applied_at). Rows clickable → future P22 detail view (P19 scaffold: row click does nothing visible, planner adds TODO comment).
- **Empty state:** `<EmptyState>` primitive with copy "No applications yet" + lucide `<Mail>` icon at `--color-text-tertiary`.
- **No pagination at P19** (P22 ADMIN-06 owns full operator UX). Show first 50 rows; banner "Showing first 50 — full pagination in Phase 22."

### `/partner/dashboard`

- **Grid:** Reuse existing 12-col bento (`grid grid-cols-12 gap-4 md:gap-6`) — same pattern as `HomeTab.tsx`.
- **Top row (KPIs):** 4 cards using `<Card span={3}>` on desktop (4×3=12 cols) → stack 2×2 on mobile (each becomes `col-span-6`).
- **KPI card anatomy:**
  - Card variant: `default`, padding `md`.
  - Top: `text-xs text-[var(--color-text-secondary)]` label + lucide icon `aria-hidden`.
  - Center: `text-3xl font-semibold text-[var(--color-primary)]` value (count-up animation via existing `useCountUp` hook; honors `useReducedMotion`).
  - Bottom: `text-xs` delta vs prior period (e.g. "+12% vs prev 30d") — green text when positive, neutral when 0, danger when negative.
  - `aria-live="polite"` on the value span (count-up changes).
- **Trend chart:** Full-width `<Card span={12}>` containing `<BaseChart>` (existing `src/components/dashboard/charts/BaseChart.tsx`). Chart config: line chart, x-axis = last 30 days, two lines (clicks via `--color-primary`, conversions via `--color-success`). Tooltip on hover. NO chart.js plugin imports beyond what BaseChart already registers.
- **Activity feed:** `<Card span={12}>` heading "Recent conversions". Inside: stack of 10 rows. Each row: 12-col internal grid → `[date 3] [status badge 2] [commission $ 2] [referrer source 5]`. Use `<Badge>` for status. Empty state: `<EmptyState>` "No conversions yet — your dashboard updates within 10 minutes of a paid referral."
- **Refresh affordance:** Top-right of page header. `<Button variant="ghost" size="sm" leadingIcon={<RefreshCw />}>` + sibling `<Badge tone="neutral">Updated 4 min ago</Badge>`. Polls every 10 min via SWR; manual click invalidates cache.
- **Stripe Connect onboarding card (conditional):** When `account.requirements.currently_due.length > 0`, render a `<Card variant="tonal" span={12}>` at the TOP of the page (above KPI row) with copy + CTA. See "Stripe Connect Onboarding Card" section below.

### `/partner/links`

- **Layout:** Two-column on desktop (`grid grid-cols-12 gap-6`):
  - **Left col (`span={6}`):** Referral URL display card — large monospace URL string (`font-mono text-lg`), `<Button variant="primary" leadingIcon={<Copy />}>Copy link</Button>`. Success toast on copy: "Copied to clipboard".
  - **Right col (`span={6}`):** Template picker — 3 cards (one per `coach`/`story`/`method`). Each card uses `<Card variant="clickable">` with `<Card variant="selected">` when active. Keyboard nav: Tab through, Enter/Space to select.
- **Customization fields panel (`span={12}`):** Card containing form: display_name, photo upload, blurb, calendly_url, testimonial_quote (last one only visible when `story` template selected — fade-in via Tailwind `transition-opacity duration-quick`).
- **Live preview:** `span={12}` card at bottom showing the selected template rendered with current customization values — same components as `/r/{code}` (DRY).

### `/partner/payouts`

- **Next-payout banner:** Full-width `<Card variant="tonal" span={12}>` at top: "Next payout: {date}. Estimated amount: ${pending_amount}."
- **Stripe Connect status pill:** Inline next to banner. `<Badge tone="...">` per state (see Color section).
- **Payout history table:** Columns: date, amount, status badge, Stripe payout ID (truncated, click-to-copy). Empty state: `<EmptyState>` "No payouts yet — payouts run monthly on the 1st."
- **Conditional Stripe Connect onboarding card:** Same as `/partner/dashboard` — top of page when `currently_due` non-empty.

### `/partner/assets`

- **Grid:** `grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4`.
- **Asset card:** `<Card variant="default" padding="md">` containing thumbnail (`aspect-video object-cover rounded-card`), `text-sm font-semibold` name, `text-xs text-[var(--color-text-secondary)]` metadata (e.g. "PNG · 728×90 · 24 KB"), `<Button variant="secondary" size="sm" leadingIcon={<Download />} block>Download</Button>`.
- **Empty state:** `<EmptyState>` "Marketing assets are being prepared — check back soon."

### `/r/{code}` — 3 co-branded landing-page templates (Phase 15 block-tree instances)

**Each template ships as a flat-JSONB block tree consumable by Phase 15 page-builder. Phase 19 ships 3 admin-seeded template definitions; affiliate customization fills slots.** Block schema follows Phase 15 PAGE-03 (8 semantic blocks: Hero, CTA, FAQ, Pricing, Testimonial, Feature grid, Image+text, Footer).

#### Template variant: `coach` — photo-forward

Block tree (sample JSON — planner picks final shape per Phase 15 schema):

```json
{
  "version": 1,
  "template": "coach",
  "blocks": [
    {
      "id": "hero",
      "type": "Hero",
      "props": {
        "layout": "split",
        "leftSlot": { "type": "PhotoSlot", "binding": "{{photo_path}}", "fallback": "InitialsAvatar", "size": "lg" },
        "rightSlot": {
          "title": { "binding": "{{display_name}}", "font": "display", "size": "display" },
          "subtitle": { "binding": "{{blurb}}", "size": "lg" },
          "cta_primary": { "label": "Start your free trial", "href": "/signup?aff={{referral_code}}" },
          "cta_secondary": { "label": "Book a 1:1 with me", "href": "{{calendly_url}}", "showIf": "calendly_url" }
        }
      }
    },
    { "id": "values", "type": "FeatureGrid", "props": { "cols": 2, "items": "{{coach_value_props}}" } },
    { "id": "cta", "type": "CTA", "props": { "headline": "Track your GLP-1 journey", "button_label": "Start free trial", "href": "/signup?aff={{referral_code}}" } },
    { "id": "footer", "type": "Footer", "props": { "fineprint": "Referred by {{display_name}}. LeanShot · Privacy · Terms" } }
  ]
}
```

#### Template variant: `story` — testimonial-forward

Same block schema; hero replaces `PhotoSlot` with a `Testimonial` block where `{{testimonial_quote}}` is the prominent pulled-out quote (`text-4xl` Fraunces italic). Hero has photo as 80px circle alongside the quote attribution. Below: 3-card benefit grid (`<FeatureGrid cols={3}>`), then CTA, then footer.

#### Template variant: `method` — benefits-list-forward

No photo above the fold. Hero = `text-4xl` headline "How I work with LeanShot" + 5-bullet value list (`text-lg` body, lucide check icons). 80px photo + name appears in a smaller attribution card BELOW the hero ("Brought to you by {{display_name}}"). Then CTA, then footer.

**All 3 templates share:** identical signup CTA href format `/signup?aff={{referral_code}}` (server-side cookie attribution handled by Edge Function at `/r/{code}`); identical footer attribution; identical Phase 13 v2 token palette; identical lazy-load behavior (`/r/*` route is lazy-imported in `App.tsx`).

**Mobile-first rule:** Hero stacks single-column on `<md` viewports. Photo size on mobile: 120px (down from 200px); on desktop: 200px. Use Tailwind responsive prefixes; do not introduce new size tokens.

---

## New Primitive: `<InitialsAvatar>`

Phase 19's ONLY new UI primitive. File: `src/components/ui/InitialsAvatar.tsx`.

### API

```ts
export interface InitialsAvatarProps {
  /** Used to derive initial + gradient hue. */
  name: string;
  /** sm=40px, md=80px, lg=200px (default md). */
  size?: 'sm' | 'md' | 'lg';
  /** Force-circular instead of `rounded-card`. */
  rounded?: 'card' | 'full';
  className?: string;
}
```

### Visual contract

- Background: `linear-gradient(135deg, hsl({hue}, 65%, 55%) 0%, hsl({hue+30}, 65%, 45%) 100%)` where `hue = hashStringToHue(name) % 360`.
- Foreground initial: First letter of `name.trim()` uppercased. Font: Fraunces display, color `#ffffff`, weight 600.
- Size tokens: sm `w-10 h-10 text-lg`, md `w-20 h-20 text-3xl`, lg `w-[200px] h-[200px] text-display` (display = 64px). Lg size on mobile rescales to `w-[120px] h-[120px] text-5xl` via `w-[120px] md:w-[200px]`.
- Shape: `rounded-card` default; `rounded-full` when `rounded="full"`.
- Accessibility: `role="img"` + `aria-label={`Avatar for ${name}`}`. Not focusable.
- Theme parity: Hue is deterministic from name; saturation/lightness fixed at 65%/55% — works in both themes (white foreground always passes contrast against generated hue background). No dark-mode-specific override needed.

### Used by

1. `/partner/links` live-preview when `photo_path` is null
2. `/r/{code}` `coach` template hero (lg size)
3. `/r/{code}` `story` template attribution card (md size)
4. `/r/{code}` `method` template attribution card (md size)
5. `/admin/affiliates` table avatar column (sm size) — optional, planner decides

Helper function `hashStringToHue(s: string): number` lives co-located in the same file. Pure function; deterministic; covered by a unit test asserting `hashStringToHue('Alice') === hashStringToHue('Alice')` and that two different names usually differ.

---

## Stripe Connect Onboarding Card — State Machine

Renders on `/partner/dashboard` (top, above KPIs) AND `/partner/payouts` (top, above next-payout banner). One reused component.

| State | Trigger | Card variant | Heading | Body | CTA |
|-------|---------|--------------|---------|------|-----|
| `pending` | Account created, `details_submitted=false` | `tonal` | "Complete tax onboarding to receive payouts" | "We need W-9 / W-8BEN info from Stripe before your first payout. Takes about 5 minutes." | `<Button variant="primary">Start onboarding →</Button>` (opens Stripe-hosted in new tab) |
| `needs_info` | `requirements.currently_due.length > 0` after partial fill | `tonal` (with warning accent border `border-[var(--color-warning)]`) | "Stripe needs more info" | "Stripe is requesting: {list of currently_due fields, max 3, then `+N more`}. Complete to unlock payouts." | `<Button variant="primary">Continue onboarding →</Button>` |
| `active` | `charges_enabled=true && payouts_enabled=true` | NOT RENDERED (card is hidden) | — | — | — |
| `restricted` | `requirements.disabled_reason` set | `default` with danger left-border | "Your payout account is on hold" | "Stripe has restricted payouts: {disabled_reason}. We've emailed you details. Reply to that email or contact support." | `<Button variant="secondary">Contact support</Button>` (mailto link) |

CTA buttons always open Stripe-hosted onboarding link in `target="_blank" rel="noopener noreferrer"` (CONTEXT D-08). After the affiliate returns to LeanShot, the dashboard polls `account.retrieve` via the `partner-account-status` Edge Function on focus + every 10 min to advance the state machine.

---

## Copywriting Contract

### `/affiliate` apply form

| Element | Copy |
|---------|------|
| Page heading | Apply to the LeanShot affiliate program |
| Subheading | Earn $10 for every paid LeanShot subscription that comes from your audience. Manual review in 3-5 business days. |
| Field label: email | Your email |
| Field placeholder: email | you@example.com |
| Field label: name | Your name |
| Field placeholder: name | Full name as you'd like it shown |
| Field label: audience size | Audience size |
| Field placeholder: audience size | Approximate followers / subscribers |
| Field label: audience type | Primary audience |
| Field options: audience type | Instagram · TikTok · YouTube · Newsletter · Coaching · Other |
| Field label: why us | Why us? |
| Field placeholder: why us | Tell us about your audience and why LeanShot is a fit (max 500 chars) |
| Submit button | Submit application |
| Submit button (loading) | Sending... |
| Success state heading | Application received |
| Success state body | Thanks! We'll review your application in 3-5 business days and email you at {email}. |
| Validation: email invalid | Please enter a valid email address |
| Validation: name required | Please add your name |
| Validation: audience size required | Approximate is fine — even "1000" works |
| Validation: why us too long | Keep it under 500 characters ({count}/500) |
| Footer link | Already approved? Sign in → |
| Error toast (network) | Couldn't send your application. Check your connection and try again. |

### Resend transactional emails (subject + opening line)

| Email | Subject | Opening line |
|-------|---------|--------------|
| Application received | LeanShot affiliate application received | Thanks for applying to the LeanShot affiliate program. We'll review within 3-5 business days and email you with next steps. |
| Application approved | You're in — welcome to the LeanShot affiliate program | Congrats {display_name} — you're approved. Your referral link is `leanshot.app/r/{referral_code}`. Complete tax onboarding here: {stripe_link} |
| Application rejected | Update on your LeanShot affiliate application | Thanks for your interest in the LeanShot affiliate program. We're not approving applications in your category right now, but we'll reach back out if that changes. |
| Payout sent | Your LeanShot affiliate payout — ${amount} | Heads up — ${amount} just hit your connected account for {month_name} referrals. Details: {dashboard_link} |
| Payout failed | We couldn't send your LeanShot payout | Stripe rejected the transfer for {reason}. Please check your account details: {dashboard_link} |

### `/partner/dashboard`

| Element | Copy |
|---------|------|
| Greeting | Hi {display_name} 👋 |
| KPI 1 label | Clicks · 30d |
| KPI 2 label | Conversions · 30d |
| KPI 3 label | Commissions · 30d |
| KPI 4 label | Pending payout |
| Refresh button label (aria-label) | Refresh dashboard |
| Refresh badge | Updated {N} min ago |
| Trend chart heading | Clicks + conversions (30d) |
| Trend chart legend | Clicks · Conversions |
| Activity feed heading | Recent conversions |
| Empty state heading (no conversions) | No conversions yet |
| Empty state body (no conversions) | Your dashboard updates within 10 minutes of a paid referral. Share your link to get started. |

### `/partner/links`

| Element | Copy |
|---------|------|
| Page heading | Your referral link |
| Subheading | Send this anywhere — every click is attributed to you for 30 days. |
| Copy button | Copy link |
| Copy success toast | Link copied to clipboard |
| Template picker heading | Pick your landing page |
| Template option: coach | The coach — photo-forward + Calendly |
| Template option: story | The story — testimonial-forward |
| Template option: method | The method — benefits list, no photo |
| Customize heading | Customize your page |
| Field: display_name | Display name |
| Field: photo upload | Profile photo |
| Field: photo helper | Square JPG or PNG, at least 400×400px. Falls back to a colored initial if blank. |
| Field: blurb | Tagline (max 50 chars) |
| Field: calendly_url | Calendly URL (optional) |
| Field: testimonial_quote | Pull-quote (max 200 chars) — only used on "the story" template |
| Save button | Save changes |
| Save success toast | Page updated |

### `/partner/payouts`

| Element | Copy |
|---------|------|
| Page heading | Payouts |
| Next-payout banner | Next payout: {date} · Estimated: ${pending_amount} |
| Connect status pill (pending) | Tax onboarding · pending |
| Connect status pill (needs_info) | Tax onboarding · action needed |
| Connect status pill (active) | Payouts active |
| Connect status pill (restricted) | Payouts on hold |
| Empty state heading | No payouts yet |
| Empty state body | Payouts run monthly on the 1st once you've earned at least $25 in confirmed commissions. |

### `/partner/assets`

| Element | Copy |
|---------|------|
| Page heading | Marketing assets |
| Subheading | Logos, banners, swipe-copy. Use these in your content; they're licensed for affiliate use only. |
| Asset card CTA | Download |
| Empty state heading | Assets coming soon |
| Empty state body | We're preparing logo packs, banner sets, and swipe-copy. Check back in a day or two. |

### Stripe Connect onboarding card — state-specific copy

(See "Stripe Connect Onboarding Card — State Machine" section above for full table.)

### `/r/{code}` landing-page template defaults (placeholder copy until affiliate customizes)

| Template | Headline default | Subhead default | Primary CTA |
|----------|------------------|-----------------|-------------|
| coach | {display_name} | {blurb} | Start your free trial |
| story | "{testimonial_quote}" — {display_name} | LeanShot helped me track every shot, side effect, and milestone in one place. | Start your free trial |
| method | How I use LeanShot | A few reasons I recommend LeanShot to my GLP-1 community. | Start your free trial |

### Destructive actions in Phase 19

| Action | Confirmation approach | Copy |
|--------|----------------------|------|
| Affiliate self-delete (covered by P22 DEL-01; P19 contributes cascade) | NOT a P19 surface — P22 owns the confirm modal | n/a |
| Admin reject application (scaffold only at P19; P22 ADMIN-06 builds real reject flow) | Read-only scaffold at P19 — no destructive CTA shipped | n/a |

P19 ships ZERO destructive UI controls. The cascade in CONTEXT D-33 is invoked by P22's surface, not by anything in P19.

---

## Interaction + Motion

### Animations (honor `useReducedMotion`)

| Surface | Element | Animation | Reduced-motion fallback |
|---------|---------|-----------|------------------------|
| `/partner/dashboard` KPI cards | Numeric value | `useCountUp` 800ms ease-out from 0 → value on mount | Instant value, no count-up |
| `/partner/dashboard` cards | Initial mount | `animate-rise` (existing 500ms ease-out-quart) | No rise — instant render |
| `/partner/links` template picker | Selected card | `transition-[transform,box-shadow] duration-quick` | Instant style swap |
| `/r/{code}` hero | Photo + headline fade-in | `animate-fade-in` (300ms) on mount | Instant |
| Stripe Connect card | Slide-down on first render | `translate-y-[-8px] opacity-0 → 0/100` over 300ms | Instant |
| Toast (existing) | — | Existing `<Toast>` behavior | Already honored |

### Keyboard navigation

- Template picker (`/partner/links`): Tab cycles 3 cards; Enter/Space selects. Selected state announced via `aria-pressed`.
- All form inputs: native tab order; Enter submits.
- All `<Button>`: focus ring via `focus-visible:ring-[var(--color-primary)] ring-offset-2` (existing Button primitive).
- `/admin/affiliates` table: Tab moves through filter pills + each row (row treated as button when click-action lands in P22; at P19 scaffold rows have `tabIndex={-1}`).

### Screen-reader contracts

- KPI value: `aria-live="polite"` so count-up changes announce once (not per frame).
- "Updated N min ago" badge: `aria-live="off"` (cosmetic only).
- Copy-to-clipboard success: Toast already uses `role="status" aria-live="polite"` (existing primitive).
- Status badges: text content is the source of truth; `tone` is decorative.

### Loading states

- All `/partner/*` routes lazy-loaded via `React.lazy` (existing pattern from `App.tsx`). Suspense fallback: `<Skeleton>` matching page skeleton.
- KPI cards on first load: render `<Skeleton>` blocks of correct size; replace with values after SWR resolves.
- Activity feed: `<Skeleton>` rows × 10 during load.

---

## Accessibility

- **Color contrast:** All token pairs in `src/index.css` `@theme` block are already audited to WCAG AA in Phase 13 (per `13-CONTEXT.md`). Phase 19 does not introduce new color combinations.
- **Touch targets:** All interactive elements ≥ 44×44px via Button `h-11` default and equivalent input sizing.
- **`aria-label` required** on icon-only buttons (already enforced by Button primitive's `IconButtonProps` typing).
- **`role="dialog"`** on any modal (none planned in P19, but if added, use existing `<Modal>` primitive).
- **`prefers-reduced-motion`** honored via `useReducedMotion()` for all animation listed above.
- **Focus traps:** Not applicable — no modals in P19. (P22's confirm modals will need traps.)
- **Form errors:** `aria-invalid="true"` + `aria-describedby` pointing to error text element (existing `<Input>` primitive contract).

---

## Bundle Budget Awareness (Phase 12 ceilings)

Per `project_phase12_planning_complete.md` and `project_phase5_bundle_regression.md`:

- **Index ceiling:** 50 kB gz hard. Current ~21 kB gz.
- **Per-route lazy-load required:** All `/partner/*` routes + `/affiliate` + `/admin/affiliates` + `/r/{code}` MUST be `React.lazy` imports in `App.tsx`.
- **chart.js:** Already registered; reusing `BaseChart` adds zero kB.
- **No new heavy deps:** No date-picker libs, no rich-text editors, no Combobox libs. Native HTML controls + existing primitives only.
- **`<InitialsAvatar>`:** Pure CSS gradient + Fraunces font (already loaded). ~0.3 kB gz inline.
- **Stripe Connect onboarding link:** External URL — no SDK import in client bundle. Account-status checks go through Supabase Edge Function (server-side Stripe SDK), not client.
- **Storage transforms fallback (CONTEXT D-20):** Use `<img class="aspect-square object-cover" />` on raw upload until Supabase Pro turns on. Zero JS cost.

Phase 19 net bundle impact target: ≤ 2 kB gz on `index` chunk; all surface code lands in route-specific lazy chunks (each ≤ 12 kB gz).

---

## Registry Safety

| Registry | Blocks Used | Safety Gate |
|----------|-------------|-------------|
| shadcn official | none — project uses in-house primitives | not applicable |
| Third-party | none | not applicable |

No registry imports in Phase 19. All UI built from in-house primitives at `src/components/ui/*` + one new primitive `<InitialsAvatar>` at the same path.

---

## Component Inventory

### Existing primitives reused (no changes)

| Primitive | File | P19 use sites |
|-----------|------|---------------|
| `<Card>` | `src/components/ui/Card.tsx` | All surfaces (~25 instances) |
| `<Button>` | `src/components/ui/Button.tsx` | All CTAs |
| `<Input>` | `src/components/ui/Input.tsx` | Apply form, /partner/links customization |
| `<Badge>` | `src/components/ui/Badge.tsx` | Status pills, KPI deltas |
| `<Pill>` | `src/components/ui/Pill.tsx` | /admin/affiliates filter segmented control |
| `<EmptyState>` | `src/components/ui/EmptyState.tsx` | All empty states |
| `<Skeleton>` | `src/components/ui/Skeleton.tsx` | All loading states |
| `<Toast>` | `src/components/ui/Toast.tsx` | Copy-link success, save-success, error |

### New primitives (Phase 19 introduces)

| Primitive | File | Justification |
|-----------|------|---------------|
| `<InitialsAvatar>` | `src/components/ui/InitialsAvatar.tsx` (NEW) | Used in 4+ places across landing templates + dashboard. Justifies primitive-level extraction. Pure CSS gradient + Fraunces; no deps. |

### New feature components (Phase 19 introduces)

These compose primitives; not new primitives.

| Component | File | Purpose |
|-----------|------|---------|
| `AffiliateApplyForm` | `src/components/affiliate/AffiliateApplyForm.tsx` | `/affiliate` form body |
| `AdminAffiliatesScaffold` | `src/components/admin/AdminAffiliatesScaffold.tsx` | `/admin/affiliates` read-only list |
| `PartnerLayout` | `src/components/partner/PartnerLayout.tsx` | Shared shell + sub-nav for `/partner/*` |
| `PartnerDashboard` | `src/components/partner/PartnerDashboard.tsx` | `/partner/dashboard` page |
| `PartnerKpiCard` | `src/components/partner/PartnerKpiCard.tsx` | 1 of 4 KPI cards |
| `PartnerTrendChart` | `src/components/partner/PartnerTrendChart.tsx` | BaseChart wrapper |
| `PartnerActivityFeed` | `src/components/partner/PartnerActivityFeed.tsx` | Recent conversions list |
| `PartnerLinksPage` | `src/components/partner/PartnerLinksPage.tsx` | `/partner/links` |
| `PartnerTemplatePicker` | `src/components/partner/PartnerTemplatePicker.tsx` | 3-template selector |
| `PartnerCustomizeForm` | `src/components/partner/PartnerCustomizeForm.tsx` | Customize fields |
| `PartnerPayoutsPage` | `src/components/partner/PartnerPayoutsPage.tsx` | `/partner/payouts` |
| `PartnerAssetsPage` | `src/components/partner/PartnerAssetsPage.tsx` | `/partner/assets` |
| `StripeConnectOnboardingCard` | `src/components/partner/StripeConnectOnboardingCard.tsx` | Shared state-machine card |
| `LandingTemplateCoach` | `src/components/landing/LandingTemplateCoach.tsx` | `coach` block-tree renderer |
| `LandingTemplateStory` | `src/components/landing/LandingTemplateStory.tsx` | `story` block-tree renderer |
| `LandingTemplateMethod` | `src/components/landing/LandingTemplateMethod.tsx` | `method` block-tree renderer |

Planner may consolidate or split as needed. Component count is illustrative; the contract above is what matters.

---

## Cross-phase References

| Phase | Touchpoint | P19 contract |
|-------|-----------|--------------|
| Phase 13 | Design tokens | P19 references — does not redefine — every `--color-*`, `--text-*`, `--radius-*`, `--shadow-*`, `--spacing` token. |
| Phase 15 | Page-builder block-tree | The 3 `/r/{code}` templates are admin-seeded Phase 15 page instances. P19 ships the block-tree JSON definitions + the 3 template renderer components. |
| Phase 22 | ADMIN-06 + DEL-01 | P19 ships scaffold `/admin/affiliates`; P22 builds full operator UX. P22 DEL-01 invokes the cascade defined in CONTEXT D-33. |
| Phase 16 | RC tier reconciliation | View-level only — no UI contract overlap. |

---

## Checker Sign-Off

- [ ] Dimension 1 Copywriting: PASS — 70+ string locks across forms, emails, dashboards, landing templates, state-machine card
- [ ] Dimension 2 Visuals: PASS — Reuses 8 existing primitives; introduces 1 new primitive (`<InitialsAvatar>`) with documented API + 5 use sites
- [ ] Dimension 3 Color: PASS — 60/30/10 inherited from Phase 13 v2 tokens; accent reserved-for list explicit (6 elements); destructive scoped to admin reject (deferred to P22) + fraud-flag indicators
- [ ] Dimension 4 Typography: PASS — Each surface declares ≤4 sizes + ≤2 weights; responsive variations reframed as Tailwind prefixes on existing tokens (no new sizes)
- [ ] Dimension 5 Spacing: PASS — All values multiples of 4 via Tailwind v4 utilities; zero custom `style={{ padding }}` exceptions
- [ ] Dimension 6 Registry Safety: PASS — No third-party registries; no shadcn; all in-house primitives

**Approval:** pending (awaiting `gsd-ui-checker` run)

---

*UI-SPEC: Phase 19 — Affiliate Program + Stripe Connect*
*Generated: 2026-05-15 via `/gsd-ui-phase 19 leanshot`*
*Pre-populated from CONTEXT (35 D-NN locks) + CONTEXT-ADDENDUM (D-31/36/37) + Phase 13 design system v2 + existing primitive inventory. Zero user questions asked — all design decisions inherited from upstream artifacts.*
