---
phase: 51-full-traffic-conversion-tracking-system-unified-dashboard-ut
plan: 06
subsystem: admin/growth/traffic
tags: [traffic, channels, retention, first-last-touch, D-02, D-15, D-16]
requirements: [TRAFFIC-09, TRAFFIC-12]
dependency-graph:
  requires:
    - 51-05-PLAN.md  # TrafficDashboardPage shell + slot contract
    - 51-03-PLAN.md  # get_traffic_channel_rollup SECDEF RPC w/ p_touch_mode
  provides:
    - "TrafficChannelsTab (full impl, replaces 51-05 stub)"
  affects:
    - "leanshot/src/components/admin/growth/TrafficChannelsTab.tsx"
tech-stack:
  added: []          # zero new deps — useState + useEffect canon
  patterns:
    - "supabase.rpc + useCallback + useEffect (CACDashboardPage analog)"
    - "PillGroup segmented dual-toggle (date-range + touch-mode)"
    - "Sheet drawer drill-in (CACDashboardPage analog)"
    - "vi.mock @/lib/supabase + vi.mock @/lib/store (PaywallExperimentTab analog)"
key-files:
  created:
    - "leanshot/src/components/admin/growth/TrafficChannelsTab.test.tsx"
  modified:
    - "leanshot/src/components/admin/growth/TrafficChannelsTab.tsx (replaces stub)"
    - "leanshot/.planning/ROADMAP.md (51-06 checkbox toggled)"
decisions:
  - "D-02 first/last toggle is live end-to-end — touchMode state passed as p_touch_mode to SECDEF RPC; SECDEF branches between traffic_channel_rollup (last) and traffic_channel_rollup_first (first); test #5 asserts BOTH a second RPC call AND a visible row-set change. No v1.4 deferral caption."
  - "D-12 org scoping: clinic_owner forwards their app_metadata.org_id; admin uses null (SECDEF returns all orgs). Same components, RLS-driven data scope."
  - "Aggregation pattern: SECDEF returns per-day rows; component sums them by channel_group across the window, computes aggregate CAC = sum(spend) / sum(activations) once per channel (NOT a row-level average — matches CAC dashboard precedent)."
  - "Paid-channel deep-link set = {'Paid Search', 'Paid Social'} (matches Phase 33 D-15 fixed network→channel_group mapping)."
metrics:
  duration_minutes: 24
  completed_date: 2026-05-24
---

# Phase 51 Plan 51-06: Channels tab Summary

Full implementation of the Channels tab — channel rollup table backed by `get_traffic_channel_rollup` SECDEF RPC with end-to-end first/last-touch toggle, D1-D60 retention sparkline drill-in, and paid-channel CAC deep-link.

## One-Liner

Channels tab — channel rollup table + Sparkline retention drill + D-02 first/last-touch toggle wired to SECDEF `p_touch_mode` (B4 revision iter-1: real data movement, not UI no-op).

## What Was Built

### Task 1 — `TrafficChannelsTab.tsx` (replaces 51-05 stub)

- Named export `TrafficChannelsTab: React.FC` (zero-prop) — slot contract from 51-05 shell preserved (lazy unwrap of `m.TrafficChannelsTab` still resolves).
- **Fetch:** `supabase.rpc('get_traffic_channel_rollup', { p_org_id, p_start_date, p_end_date, p_touch_mode })` inside `useCallback`, fired from `useEffect` on mount and on every toggle change.
- **Date-range toggle:** `PillGroup segmented` with Today / 7d / 30d pills; default `7d`. Re-fetches via dependency change on `dateBounds`.
- **Touch-mode toggle (D-02):** `PillGroup segmented` First-touch / Last-touch; default `Last-touch` per UI-SPEC + CONTEXT D-02. Re-fetches via dependency change on `touchMode`.
- **Table:** 8 columns — Channel / Visits / Signups / Activations / Paid / D7 Retained / D30 Retained / CAC. Sorted by aggregated `visits` desc. Each `<tr>` is a button (`role="button"`, `tabIndex={0}`, `Enter`/`Space` keyboard handler) that opens the drawer. `numerals-tabular` on every numeric cell.
- **Aggregation:** SECDEF returns per-day rows; component groups by `channel_group` and sums {visits, signups, activations, paids, ad_spend_usd, d1/d7/d14/d30/d60_retained_count} across the date window. Aggregate CAC = `sum(ad_spend_usd) / sum(activations)` per channel (skipped to `—` when activations = 0 OR ad_spend = 0).
- **Drill-in:** `Sheet` opens on row click; renders back-link, "Retention curve" eyebrow, `Sparkline` over [D1, D7, D14, D30, D60] counts, inline bucket digits, and (only for `Paid Search` / `Paid Social`) a deep-link CTA to `/admin/growth/cac?channel=…` with `encodeURIComponent` on the channel name.
- **Org scoping (D-12):** `useStore` reads `s.signedIn?.user?.app_metadata.role` + `.org_id`; clinic_owner forwards `org_id` to RPC, admin passes `null`.
- **Error handling:** `code === '42501'` OR message containing `permission` / `forbidden` → "Permission denied — admin role required" + Retry button. Other errors → "Failed to load channels — {msg}".
- **Typography ceiling honored:** Only `text-[11px]`, `text-[13px]`, `text-[18px]` used. Negative grep for 12/14/16/20/24/32 px clean.
- **No TanStack Query import** (codebase canon per UI-SPEC §Bundle Budget).

### Task 2 — `TrafficChannelsTab.test.tsx` (new)

5 RTL tests, mock pattern matches `PaywallExperimentTab.test.tsx` (vi.mock `@/lib/supabase`) + `TrafficDashboardPage.test.tsx` (vi.mock `@/lib/store`):

| # | Test | Asserts |
|---|------|---------|
| 1 | Happy path — 3 rows in visits-desc order | Paid Search (1000) → Organic Search (500) → Direct (200); aggregate CAC on Paid Search renders as `$20.00` (800 ad spend / 40 activations). |
| 2 | Permission denied (RPC error code `42501`) | "Permission denied — admin role required" banner + "Retry channel rollup" button rendered. |
| 3 | Drill-in opens Sheet | "Retention curve" section, Sparkline with aria-label `Retention curve for Paid Search`, CAC deep-link with `href="/admin/growth/cac?channel=Paid%20Search"`, D1/D7/D14/D30/D60 digits visible. |
| 4 | Non-paid drill-in (Organic Search) hides deep-link | `screen.queryByRole('link', { name: /View ad-spend detail/ })` returns null. |
| 5 | TouchMode toggle changes data (D-02) | Mount fires RPC with `p_touch_mode: 'last'` and renders Paid Search + Organic Search rows; clicking First-touch pill (a) fires a 2nd RPC with `p_touch_mode: 'first'` AND (b) re-renders to show Direct + Paid Social, with Paid Search + Organic Search GONE. Proves the toggle moves real data, not a UI caption. |

**Result:** 5/5 passed in 1.09s via `npx vitest run --config vite.config.ts src/components/admin/growth/TrafficChannelsTab.test.tsx` (vitest 4.1.5).

## RPC Call Shape

```ts
supabase.rpc('get_traffic_channel_rollup', {
  p_org_id: orgFilter,           // null for admin, app_metadata.org_id for clinic_owner
  p_start_date: dateBounds.start, // 'YYYY-MM-DD' derived from dateRange ('today'|'7d'|'30d')
  p_end_date: dateBounds.end,     // 'YYYY-MM-DD' = today
  p_touch_mode: touchMode,        // 'first' | 'last' (default 'last' per D-02)
});
```

Authorization is enforced server-side by the SECDEF accessor:
- `is_admin_at_least('admin')` → reads all orgs OR specific `p_org_id`
- `_is_org_clinician(p_org_id, auth.uid())` → reads `p_org_id` only
- Else → `raise 'forbidden' using errcode = '42501'`

Source: `supabase/migrations/20271102000012_traffic_matview_secdef_accessors.sql`.

## TouchMode Toggle Decision

Plan 51-03 ships the SECDEF RPC with `p_touch_mode text default 'last'` and branches the FROM clause between `public.traffic_channel_rollup` (last-touch matview) and `public.traffic_channel_rollup_first` (first-touch matview). Both matviews have identical column lists, so a single function declared `returns setof public.traffic_channel_rollup` accepts rows from either source.

This plan (51-06) wires `touchMode` PillGroup state through `useCallback` deps so the RPC re-fires on toggle. Test #5 prime distinct row sets for `p_touch_mode='first'` vs `'last'`; asserts BOTH the second RPC call AND a visible row-set change. **No v1.4 deferral caption** ("(showing last-touch — first-touch coming in v1.4)") is rendered — the toggle moves data end-to-end (B4 revision iter-1).

## UI-SPEC Deviations

None of consequence. Minor adjustments to honor the actual primitive APIs:

- `Sheet` primitive uses `onClose` (not `onOpenChange`) and accepts a top-level `title` prop. The drawer's "← Back to channels" button doubles as a back-link inside the Sheet body.
- `EmptyState` primitive uses `title`+`body` (UI-SPEC said `heading`+`body`; mapped to actual prop names).
- `PillGroup` uses the standard `aria-label` HTML attribute (UI-SPEC sketched `ariaLabel`).
- The deep-link encodes the channel name with `encodeURIComponent` — matches UI-SPEC mitigation for T-51-29 (URL deep-link tampering).
- The CAC column shows `$NN.NN` formatted via `toFixed(2)` (UI-SPEC didn't pin a format; matches Phase 33 CAC dashboard `formatUsd` precision).

## Threat-Model Coverage

| ID | Disposition | How addressed |
|----|-------------|---------------|
| T-51-28 (info disclosure: clinic_owner cross-org reads) | mitigate | RPC SECDEF gates on `_is_org_clinician`; component forwards clinic_owner's own `org_id` (from `app_metadata`) — never accepts user input for `p_org_id`. |
| T-51-29 (URL tampering deep-link to CAC) | mitigate | `encodeURIComponent(channel_group)` on the href; CAC page validates against its channel set. |
| T-51-30 (DoS via rapid toggle) | accept | React render coalesces state changes; SECDEF reads the matview (O(1)). |

## Verification Evidence

```bash
$ grep -c "get_traffic_channel_rollup" leanshot/src/components/admin/growth/TrafficChannelsTab.tsx
2
$ grep -c "p_touch_mode" leanshot/src/components/admin/growth/TrafficChannelsTab.tsx
3
$ grep -E "text-\[(12|14|16|20|24|32)px\]" leanshot/src/components/admin/growth/TrafficChannelsTab.tsx
(no output → typography ceiling honored)
$ grep -E "@tanstack/react-query" leanshot/src/components/admin/growth/TrafficChannelsTab.tsx
(no output)
$ npx tsc -p leanshot/tsconfig.app.json --noEmit
(no output → clean)
$ npx vitest run --config vite.config.ts src/components/admin/growth/TrafficChannelsTab.test.tsx
Test Files  1 passed (1)
Tests       5 passed (5)
Duration    1.09s
```

## Deviations from Plan

None auto-fixed at Rule 1/2/3 level. All adjustments are primitive-API alignments noted under **UI-SPEC Deviations** above.

## Forward Effects (for Plans 51-07..09 + Plan 51-10)

- **Test mock recipe:** Future Wave-4 sibling plans can mirror this file's `vi.mock('@/lib/supabase', { rpc: vi.fn() })` + `vi.mock('@/lib/store', { useStore: (sel) => sel(storeShape) })` pattern verbatim.
- **No new shared utility:** Aggregation across days happens inline (Map per channel_group). If 51-07/08 needs similar per-day aggregation, copy the inline pattern rather than extracting — keeps each tab self-contained.
- **Sheet `onClose` API confirmed:** Plan 51-07 funnel-drop drawer + Plan 51-09 taxonomy-edit modal both consume the same `<Sheet open onClose title>` shape used here.
- **Slot contract proven stable:** 51-05's lazy unwrap (`m.TrafficChannelsTab`) survives the stub-to-full replacement intact. 51-07/08/09 may replace their respective stubs the same way.

## Self-Check: PASSED

- TrafficChannelsTab.tsx: FOUND (full impl, 410 lines net delta)
- TrafficChannelsTab.test.tsx: FOUND (5 tests, 321 lines new)
- Commit d1d58387: FOUND (feat(51-06): TrafficChannelsTab full impl)
- Commit 9d6631a4: FOUND (test(51-06): TrafficChannelsTab — 5 RTL tests)
- ROADMAP 51-06 checkbox: toggled `[ ]` → `[x]`
