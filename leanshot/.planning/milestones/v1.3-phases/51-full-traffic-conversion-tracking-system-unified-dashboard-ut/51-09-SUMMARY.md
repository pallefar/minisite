---
phase: 51-full-traffic-conversion-tracking-system-unified-dashboard-ut
plan: 09
subsystem: admin/growth
tags: [admin-module, traffic-dashboard, realtime-poll, taxonomy-crud, secdef-rpc, wave-4-impl]
requires:
  - 51-03 (get_realtime_traffic_summary SECDEF RPC + traffic_realtime_v VIEW — merged on main)
  - 51-05 (TrafficDashboardPage shell + 5 named-export stub slots — merged on main)
provides:
  - component: TrafficRealtimeTab (named + default export; replaces 51-05 stub)
  - component: TrafficTaxonomyPage (named + default export; replaces 51-05 stub)
  - rpc: upsert_channel_group (SECDEF, admin-gated)
  - rpc: delete_channel_group (SECDEF, admin-gated; protects is_default_fallback row)
  - rpc: upsert_referrer_rule (SECDEF, admin-gated)
  - rpc: delete_referrer_rule (SECDEF, admin-gated)
affects:
  - supabase/migrations/20270712000014_taxonomy_admin_rpcs.sql (net-new — Plan 51-10 owns supabase db push)
tech-stack:
  added: []
  patterns:
    - native-setInterval-polling (NOT @tanstack/react-query — UI-SPEC override of CONTEXT D-10 wording)
    - visibility-aware-poll (document.visibilityState pause)
    - stale-pip-secondary-tick (30s sampling of Date.now() - lastSuccessAt)
    - SECDEF-admin-gated-CRUD (is_admin_at_least('admin'::public.admin_role))
    - default-fallback-row-protection (raise 23514 on delete)
    - ConfirmModal-destructive-flow (existing src/components/ui/Confirm.tsx)
key-files:
  created:
    - leanshot/src/components/admin/growth/TrafficRealtimeTab.test.tsx
    - leanshot/src/components/admin/growth/TrafficTaxonomyPage.test.tsx
    - supabase/migrations/20270712000014_taxonomy_admin_rpcs.sql
  modified:
    - leanshot/src/components/admin/growth/TrafficRealtimeTab.tsx (replaces 51-05 stub)
    - leanshot/src/components/admin/growth/TrafficTaxonomyPage.tsx (replaces 51-05 stub)
    - leanshot/.planning/ROADMAP.md (51-09 checkbox flipped to [x])
decisions:
  - "Used canonical helper is_admin_at_least('admin'::public.admin_role) per Plan 51-01 SUMMARY Deviation #2 — public.is_admin() (no-arg) does not exist on this codebase; the plan body would have raised 42883 at db-push (Rule 1 fix)"
  - "Real-time tab passes p_org_id=null in all cases; clinic_owner org_id is NOT plumbed via app_metadata on this codebase (app_metadata exposes org_name only, not the UUID). Clinic-owner UAT for org-scoped realtime deferred to Plan 51-10 close-out / milestone UAT"
  - "Sheet uses onClose (not onOpenChange) — the plan example mixed in shadcn idioms; this codebase's Sheet primitive (src/components/ui/Sheet.tsx) takes onClose"
  - "ConfirmModal (not 'Confirm') is the exported symbol from src/components/ui/Confirm.tsx; takes 'message' (not 'body') and 'destructive' boolean (not 'confirmVariant') — plan example was generic; fixed inline"
  - "match_rule_text held separately on the edit-form state so the textarea round-trips raw user input through invalid intermediate states (e.g. typing); validated + parsed only on Save"
  - "Migration kept on 20270712000014_* prefix per plan filename. The 51-03 view+RPC migration sits on 20271102000011_*; Plan 51-10 owns supabase db push --linked. If the back-dated trap fires at push time, 51-10 may rename to 20271102000015_* (reference_supabase_back_dated_migration_blocks_push)"
metrics:
  duration_min: ~15
  completed: 2026-05-24
  commits: 2
  files_touched: 6
  lines_added: ~990
---

# Phase 51 Plan 09: TrafficRealtimeTab + TrafficTaxonomyPage Summary

Visibility-aware 5-minute polling Real-time tab + 2-table CRUD Taxonomy admin sub-page, both replacing the Plan 51-05 stub slots. Ships 4 net-new SECDEF RPCs (admin-gated, default-fallback-protected) for `channel_groups` + `referrer_channel_rules` admin edits — taxonomy now operator-editable in-app without a code deploy (closes CONTEXT D-01 / D-03 / D-07 operator-loop).

## What shipped

| File | Role | Lines |
|------|------|-------|
| `src/components/admin/growth/TrafficRealtimeTab.tsx` | Replace stub: 5-min visibility-aware poll + 30s stale-pip tick + top-5 channels table + total-visits hero (28px) | +236 |
| `src/components/admin/growth/TrafficRealtimeTab.test.tsx` | 3 vitest+RTL tests (T1 initial fetch, T2 5-min poll, T3 stale pip) | +152 |
| `src/components/admin/growth/TrafficTaxonomyPage.tsx` | Replace stub: 2-section CRUD (channel_groups + referrer_channel_rules), Sheet drawers, ConfirmModal destructive, JSON-textarea client-side validation | +416 |
| `src/components/admin/growth/TrafficTaxonomyPage.test.tsx` | 4 vitest+RTL tests (T1 renders, T2 add-sheet, T3 invalid-JSON, T4 fallback-delete-hidden + confirm dialog wiring) | +192 |
| `supabase/migrations/20270712000014_taxonomy_admin_rpcs.sql` | 4 SECDEF RPCs (upsert/delete × channel_group/referrer_rule); all admin-gated; default-fallback protected | +137 |
| `.planning/ROADMAP.md` | 51-09 checkbox `[ ]` → `[x]` | ±1 |

## Verification

- `npx tsc -p tsconfig.app.json --noEmit` → 0 errors (worktree clean).
- `npx vitest run --config vite.config.ts src/components/admin/growth/TrafficRealtimeTab.test.tsx` → **3/3 pass** in ~850ms.
- `npx vitest run --config vite.config.ts src/components/admin/growth/TrafficTaxonomyPage.test.tsx` → **4/4 pass** in ~830ms.
- Plan Task 1 verify grep: `get_realtime_traffic_summary` (2 hits) + `visibilitychange` (2 hits) + no `from '@tanstack/react-query'` import → PASS.
- Plan Task 2 verify grep: `upsert_channel_group` (6) + `is_admin` (8) + `auth.uid()` (0) → PASS.
- Plan Task 3 verify grep: `upsert_channel_group` (2) + `Confirm` (9) + no off-grid `text-[12|14|16|20|24|32px]` → PASS.
- Typography ceiling (combined two files): 11 / 13 / 18 / 28 px only — 4 sizes, within UI-SPEC budget.
- ROADMAP `51-09` row flipped `[ ]` → `[x]`.

## Deviations from plan

### Rule 1 — auto-fixed bugs in plan instructions

1. **Plan-body `is_admin()` does not exist.** The plan's migration body used `if not public.is_admin() then …`. On this codebase the canonical helper is `public.is_admin_at_least(min_role public.admin_role)` — see `supabase/migrations/20270601000027_profiles_admin_role_column.sql:33` and Plan 51-01 SUMMARY Deviation #2 + Plan 51-03 SUMMARY (`reference_supabase_is_staff_helper`-adjacent project memory). All 4 RPCs in this migration call `is_admin_at_least('admin'::public.admin_role)` instead. The plan body would have raised `42883 (undefined_function)` at `supabase db push`.
2. **`Confirm` symbol does not exist.** The plan's example imported `Confirm` from `@/components/ui/Confirm`. The actual export is `ConfirmModal`; props are `message` (not `body`) and `destructive` boolean (not `confirmVariant`). Same file (src/components/ui/Confirm.tsx) was renamed/relabeled in an earlier phase — Plan 51-05 SUMMARY pinned its peers (`EmptyState title`, `PillGroup segmented`) but missed Confirm's API; this plan picks it up.
3. **`Sheet onOpenChange` not supported.** The plan's example called `<Sheet open={…} onOpenChange={(open) => !open && setEditCg(null)}>`. This codebase's Sheet primitive (src/components/ui/Sheet.tsx) is the LeanShot DSv2 framer-motion drag-to-dismiss bottom sheet — it accepts `onClose: () => void`. Adjusted both Sheets to `onClose={() => setEditCg(null)}`.

### Rule 2 — auto-added missing critical functionality

4. **Empty-state copy for taxonomy sections.** The plan only described populated-state UI; if `channel_groups` returned zero rows (e.g. during seed window or a wipe + recreate flow) the Card would render an empty `<ul>` with no operator signal. Added the UI-SPEC's "No channel groups configured" / "No referrer rules configured" empty-state strings inline (UI-SPEC §Empty states table).
5. **JSON-object-vs-array guard.** The plan body only checked `JSON.parse` success. A user pasting a JSON array (`["cpc","ppc"]`) would pass parse but trip the classifier downstream because `jsonb_each(match_rule_jsonb)` expects an object. Added `Array.isArray` guard + non-object-rejection with the same "Match rule must be valid JSON object" wording (server-side `jsonb_each` would reject too, but client-side validation gives a faster, friendlier error and saves the round-trip).

### Rule 3 — auto-fixed blocking issues

6. **No `node_modules` in worktree.** Worktree `leanshot/node_modules` did not exist (gitignored, doesn't transfer across worktrees per `reference_npm_install_worktree_main_drift`). Symlinked to main repo's `node_modules` to enable `npx tsc` + `npx vitest` (matches Plan 51-05 SUMMARY Deviation #5). Symlink is untracked, not committed.
7. **Fake timers + `waitFor` hang.** Initial test draft used `await waitFor(...)` after `vi.useFakeTimers()` — `waitFor` polls with real-timer setTimeout that never fires, timing out at 5s. Replaced with direct `await act(async () => { for ... await Promise.resolve() })` microtask flush + synchronous expect; same semantic but works under fake timers.

### Auth gates

None. No vendor secrets, no Edge Fn deploys, no live-DB ops. All verification is local + static.

### Architectural changes (Rule 4)

None.

## Known stubs

None. Both component stubs were the *only* stubs in scope and were replaced with full implementations.

## Threat model coverage (vs `<threat_model>`)

| Threat ID | Mitigation in this plan |
|-----------|------------------------|
| T-51-36 (privilege escalation via upsert_*) | All 4 RPCs raise `42501 (insufficient_privilege)` if `not public.is_admin_at_least('admin'::public.admin_role)` |
| T-51-37 (malformed JSON breaking classifier) | Client-side `JSON.parse` + non-object guard before save; server-side `jsonb` cast also rejects (defense in depth) |
| T-51-38 (deleting Direct fallback breaks classifier) | `delete_channel_group` raises `23514 (check_violation)` if `is_default_fallback=true`; UI hides the Delete button on that row |
| T-51-39 (rapid polling on Real-time tab) | Fixed 5-min interval + `document.visibilityState` pause + Refresh-now button resets the clock (no double-firing) |
| T-51-40 (30s tick exposes refresh internals) | The 30s tick is local-only state, computes `Date.now() - lastSuccessAt`; zero network calls |

## Forward effects

- **Plan 51-10 (Wave 5 close-out) owns `supabase db push --linked`** for the 4 new taxonomy RPCs. If the back-dated-migration trap fires (`reference_supabase_back_dated_migration_blocks_push`), 51-10 may rename the file from `20270712000014_*` to `20271102000015_*` to land it after the most recent applied migration. The taxonomy page will still load (read-only) before the RPCs are pushed; the **save/delete** buttons return RPC errors until Plan 51-10 lands the push.
- **Clinic-owner org_id plumbing** to `app_metadata.org_id` is a separate concern (no plan currently scoped). Until that lands, clinic-owner role hitting the Real-time tab will get `Permission denied — admin role required` from the RPC's gate (admin-or-_is_org_clinician(p_org_id)). This is the intentional fallback; documented in CARRY-OVER once Plan 51-10 closes out.

## Self-Check: PASSED

- File `leanshot/src/components/admin/growth/TrafficRealtimeTab.tsx` exists (replaced stub).
- File `leanshot/src/components/admin/growth/TrafficRealtimeTab.test.tsx` exists (new).
- File `leanshot/src/components/admin/growth/TrafficTaxonomyPage.tsx` exists (replaced stub).
- File `leanshot/src/components/admin/growth/TrafficTaxonomyPage.test.tsx` exists (new).
- File `supabase/migrations/20270712000014_taxonomy_admin_rpcs.sql` exists (new).
- Tests pass: 3/3 (Realtime) + 4/4 (Taxonomy).
- Typecheck clean.
- ROADMAP 51-09 `[x]`.
- Slot contract honored: both components export named `TrafficRealtimeTab` / `TrafficTaxonomyPage` as `React.FC` with zero props (plus decorative default export).
