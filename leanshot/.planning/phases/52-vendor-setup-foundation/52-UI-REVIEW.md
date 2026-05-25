---
phase: 52
slug: vendor-setup-foundation
audited_at: 2026-05-25
baseline: 52-UI-SPEC.md (approved)
screenshots: not captured (code-only audit; dev server detected but admin route requires auth)
---

# Phase 52 — UI Review

**Audited:** 2026-05-25
**Baseline:** 52-UI-SPEC.md
**Screenshots:** not captured (admin route requires staff auth; code-only audit)

---

## Pillar Scores

| Pillar | Score | Key Finding |
|--------|-------|-------------|
| 1. Copywriting | 3/4 | Page description says "08:00 UTC"; spec contract says "06:00 UTC" |
| 2. Visuals | 4/4 | Structure, hierarchy, and state coverage match spec exactly |
| 3. Color | 4/4 | All tokens via var(--color-*); no hardcoded hex; accent reserved to primary Button only |
| 4. Typography | 3/4 | `font-medium` on vendor name cell is undeclared (spec allows only 400/600) |
| 5. Spacing | 4/4 | All spacing from Tailwind scale; table cell px-4 py-3 matches spec exception |
| 6. Experience Design | 4/4 | All 8 states implemented; aria coverage correct; keyboard nav present |

**Overall: 22/24**

---

## Top 3 Priority Fixes

1. **WARNING — Cron time copy drift** — Page description reads "08:00 UTC" (line 172) but the spec copywriting contract specifies "06:00 UTC". If the cron job actually fires at 06:00 the UI misleads operators. Verify cron schedule and align the string. Fix: change `08:00` to `06:00` at `AdminVendorSmokeDashboard.tsx:172` (or vice versa if the schedule was deliberately moved to 08:00, then update the spec).

2. **WARNING — Undeclared font weight `font-medium`** — The spec declares only `font-normal` (400) and `font-semibold` (600) for this module. Line 266 applies `font-medium` (500) to the vendor name table cell. This is a minor visual deviation, not a blocker. Fix: change `font-medium` to `font-semibold` to match the "Vendor" column spec (bold enough to anchor the row scan), or document the addition as an approved DS extension.

3. **WARNING — `role="status"` not forwarded in loading state** — The spec accessibility contract requires `role="status"` on the button during the loading state. The implementation passes `role="status"` via spread (`{...(running ? { role: 'status' as const } : {})}`), but the `<Button>` primitive (`src/components/ui/Button.tsx`) does not forward arbitrary `role` props — it sets its own `aria-busy` from the `loading` prop but the component renders as a `<button>` element whose implicit role is already "button", not "status". The spec intent (live-region announcement of async state) is not met. Fix: either add a visually-hidden `<span role="status" aria-live="polite">` adjacent to the button when `running === true`, or confirm the Button primitive forwards the `role` attribute.

---

## Detailed Findings

### Pillar 1: Copywriting (3/4)

**PASS** — All CTA labels, badge labels, empty-state copy, error copy, and toast strings match the spec contract exactly. No generic labels found ("Submit", "OK", "Cancel" absent).

**WARNING** — `AdminVendorSmokeDashboard.tsx:172`: page description string is `"Per-vendor smoke test results. Run daily at 08:00 UTC or on demand."`. The spec copywriting contract at line 224 of `52-UI-SPEC.md` specifies `"06:00 UTC"`. Two-hour discrepancy. This is the only copy deviation.

Evidence:
- spec line 224: `Run daily at 06:00 UTC or on demand.`
- impl line 172: `Run daily at 08:00 UTC or on demand.`

### Pillar 2: Visuals (4/4)

No issues. Implementation precisely matches the spec's structural contract:

- `<main p-6 min-h-screen>` outer shell matches spec.
- `<header flex justify-between items-center mb-6>` with h1 + description and no top-level CTA matches spec (CTA lives in CardHeader action slot only).
- `<Card span={12} variant="default" padding="none">` wrapping `<CardHeader>` + states matches spec.
- Table uses `overflow-x-auto rounded-lg border border-[var(--color-border)]` wrapper, matching `BaaChainTable` precedent specified.
- Visual hierarchy clear: page title > section title > table header caps > body text.
- All 5 column widths (auto / 100px / 130px / 80px / auto) match spec. Column widths implemented via `style={{ width: '...' }}` which is acceptable for table column sizing where Tailwind `w-[Npx]` on `<th>` is less reliable.
- Empty state uses `ShieldCheck size-8` illustration matching spec exactly.

### Pillar 3: Color (4/4)

No issues. Every color reference uses `var(--color-*)` tokens. No hardcoded hex values (`grep` returned clean).

Token usage audit:
- `var(--color-bg)` — page background
- `var(--color-text)` — primary text (h1, vendor name cells)
- `var(--color-text-secondary)` — secondary text (description, column headers, latency, message, last-checked)
- `var(--color-border)` — table borders
- `var(--color-danger)` — error state paragraph text
- `var(--color-surface-elevated)` — row hover
- `var(--color-primary)` — focus-visible ring on keyboard-navigable rows; accent reserved to primary Button only

Badge tone mapping (`success`/`danger`/`neutral`) matches the spec table exactly. No accent overuse. `BADGE_TONE` constant at line 44 implements the spec mapping verbatim.

### Pillar 4: Typography (3/4)

**WARNING** — `font-medium` (500) used at line 266 on vendor name `<td>`. The spec typography section declares only `font-normal` (400) and `font-semibold` (600) as permitted weights for this module. `font-medium` is a third weight not in the declared set.

Declared sizes in use: `text-lg` (page h1), `text-sm` (body/cells), `text-xs` (column headers, description, message). Three sizes, within spec ceiling of 4.

Weights found:
- `font-semibold` (600) — column headers (lines 225, 231, 238, 245, 252) — spec compliant
- `font-medium` (500) — vendor name cell (line 266) — NOT declared in spec

Fix: Change `font-medium` at line 266 to `font-semibold` to match spec, or to no explicit weight class (defaulting to 400) if the intent is just body weight.

`font-mono` at line 280 on the message column is a font family, not a weight — spec calls this out explicitly (`text-xs font-mono`) and it is correct.

Column header class matches spec exactly: `text-xs font-semibold uppercase tracking-[0.06em] text-[var(--color-text-secondary)] px-4 py-3`.

### Pillar 5: Spacing (4/4)

No issues. All spacing tokens from Tailwind v4 scale only. No arbitrary `[Npx]` or `[rem]` values found.

Spacing audit:
- Outer page padding: `p-6` (24px) — spec says `lg: p-6` for page shell. Correct.
- Header bottom margin: `mb-6` (24px) — spec says `lg: mb-6`. Correct.
- Card inner div: `p-4` (16px) — spec says `md: p-4`. Correct.
- Loading/error/empty inner horizontal: `px-4 pb-4` / `px-4 pb-6` — consistent with `md` scale.
- Table cell padding: `px-4 py-3` — spec explicitly endorses this as the `AdminAffiliatesReviewQueue` exception. Correct.
- `mt-1` on description paragraph (line 171) — a single-step `xs/4px` gap, not out of scale.

### Pillar 6: Experience Design (4/4)

All 8 states from the spec are implemented:

| State | Spec requirement | Implemented |
|-------|-----------------|-------------|
| Loading | `<p>Loading…</p>` in card body | Yes, line 188–190 |
| Empty | `<EmptyState>` with CTA | Yes, lines 206–215 |
| Populated | Full `<table>` | Yes, lines 218–292 |
| Error | `role="alert"` error paragraph in `Card variant="flat"` | Yes, lines 194–203 |
| Smoke running | Button `loading` + Toast info | Yes, lines 139–146 |
| Smoke done | Toast auto-dismiss + table re-fetch | Yes, line 146 + `fetchRows()` call |
| Smoke error | Toast error | Yes, lines 143, 148–149 |
| Not authorized | `<NotAuthorizedCard />` | Yes, line 161 |

Accessibility:
- `role="alert"` on error paragraph — correct.
- `tabIndex={0}` on `<tr>` rows — correct.
- `focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] outline-none` on rows — correct.
- `scope="col"` on all `<th>` elements — correct.
- `aria-hidden` on decorative icons — correct (Play, ShieldCheck).
- `aria-busy` set by `Button` primitive via `loading` prop (`Button.tsx:81`) — correct.
- `role="status"` spread on `<Button>` when running — the Button primitive does not appear to forward arbitrary role attributes; `aria-busy` alone may be sufficient for most AT, but the spec explicitly required `role="status"`. See Priority Fix #3. This is a WARNING, not a BLOCKER; `aria-busy="true"` is the primary signal AT will use.

Cleanup on unmount (cancelled flag in staff-check useEffect) correctly prevents setState on unmounted component.

---

## Registry Safety

No third-party registry components. All UI composed from existing `src/components/ui/` primitives and lucide-react. Registry audit not applicable.

---

## Files Audited

- `/Users/karstenhaldan/minisite/leanshot/src/components/admin/AdminVendorSmokeDashboard.tsx`
- `/Users/karstenhaldan/minisite/leanshot/.planning/phases/52-vendor-setup-foundation/52-UI-SPEC.md`
- `/Users/karstenhaldan/minisite/leanshot/src/components/ui/Button.tsx` (aria-busy/role forwarding check)
- `/Users/karstenhaldan/minisite/leanshot/CLAUDE.md` (project conventions)
