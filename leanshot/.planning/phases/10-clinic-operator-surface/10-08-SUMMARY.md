---
phase: 10-clinic-operator-surface
plan: "08"
subsystem: clinic-settings
tags: [audit, permissions, posthog, vitest, playwright, supabase-rls]
dependency_graph:
  requires: [09-03, 10-01, 10-06]
  provides: [audit-tab-ui, audit-filter-bar, audit-row-expand, use-audit-events]
  affects: [ClinicSettingsPage, clinic-settings chunk]
tech_stack:
  added: []
  patterns: [RLS-gated direct supabase-js query, session-scoped sessionStorage dismissal, debounced PostHog booleans-only event, dropdown-inline pattern reuse from WorkspaceSwitcher]
key_files:
  created:
    - src/components/clinic/settings/use-audit-events.ts
    - src/components/clinic/settings/AuditTab.tsx
    - src/components/clinic/settings/AuditFilterBar.tsx
    - src/components/clinic/settings/AuditRow.tsx
    - src/components/clinic/settings/AuditCustomRangeModal.tsx
    - src/components/clinic/settings/AuditTab.test.tsx
    - e2e/clinic-audit.spec.ts
  modified:
    - src/components/clinic/settings/ClinicSettingsPage.tsx
decisions:
  - "No new Edge Function — RLS on audit_logs guards by org_id IN user's orgs with audit_log.read; direct supabase-js query pattern per D-08"
  - "13-month retention notice dismissal uses sessionStorage (per-session, not persisted) per plan must_have"
  - "PostHog audit_filter_applied payload is booleans only (has_member_filter, has_action_filter, has_time_filter) — no member uuid, no action enum value, no date strings per 10-EVENTS.md §7"
  - "RosterPagination reused from Plan 10-06 for audit pagination (50/page per plan spec)"
metrics:
  duration: "9m"
  completed_date: "2026-05-13"
  tasks_completed: 1
  files_changed: 8
---

# Phase 10 Plan 08: Audit Tab — Summary

Org-owner Audit tab added to ClinicSettingsPage. Reads `audit_logs` directly via supabase-js with RLS doing all org-scoping. Three filters (member / action / time-range). Per-row expand/collapse. 13-month retention notice. Pagination at 50/page. PostHog events PHI-safe (booleans only).

## File Inventory

| File | Role | Lines |
|------|------|-------|
| `use-audit-events.ts` | Hook: filter state → supabase query → typed AuditEvent[] + totalCount | ~130 |
| `AuditTab.tsx` | Composition root: PostHog mount event, retention notice, filter bar, row list, empty states, pagination | ~145 |
| `AuditFilterBar.tsx` | 3 filter dropdowns + custom range modal trigger + debounced PostHog event | ~230 |
| `AuditRow.tsx` | Collapsed + expanded row; action-enum → human label table (16 values); relative-time formatter | ~120 |
| `AuditCustomRangeModal.tsx` | Date range validation (from<=to, to<=today, range<=13mo) | ~100 |
| `AuditTab.test.tsx` | 14 Vitest assertions (10 per plan + 4 edge-case sub-tests) | ~370 |
| `e2e/clinic-audit.spec.ts` | Playwright: seed 5 rows, filter by member A (3 rows), clear (5 rows) | ~160 |
| `ClinicSettingsPage.tsx` | NAV extended with `audit` entry gated by `audit_log.read` permission | +12 lines |

## Bundle-Size Delta

`clinic-settings` chunk growth: ~4 kB gz (within +4 kB budget per UI-SPEC). Index unchanged.

## Filter Latency Observation

Filters are debounced 200ms before firing. The direct `supabase.from('audit_logs')` query with RLS benefits from Postgres index on `(org_id, created_at DESC)`. For orgs with ≤1000 audit rows (typical Phase 10 v1 usage), expected p95 latency is ~100ms.

## NAV Gating

`visibleWhen: (perms) => perms['audit_log.read'] === true` in the NAV array. Tab is completely absent from the nav (no 403 page) for users without the permission. Tri-state permission hook (null = loading, true/false = resolved) means the tab only appears after the `has_permission` RPC resolves.

## Vitest Coverage (14 tests, all passing)

| Test | Behavior |
|------|----------|
| 1 | NAV gating: audit tab absent when audit_log.read=false |
| 2 | Mount: supabase.from('audit_logs') called |
| 3 | Member filter: PostHog event with has_member_filter=true, NO actor_id property (PHI gate) |
| 4 | Action filter: PostHog event with has_action_filter=true |
| 5 | Time-range 24h: PostHog event with has_time_filter=true |
| 6 | Custom range: from>to → error; range>13mo → error |
| 6b | Custom range: valid range calls onApply |
| 6c | Custom range: valid range calls onApply with correct dates |
| 7 | Row expand/collapse toggles aria-expanded and shows/hides Event details |
| 7b | Multiple rows can be expanded simultaneously |
| 8 | Retention notice: dismiss → sessionStorage set; remount → notice absent |
| 9 | Empty state no filters: "No events yet" |
| 9b | Empty state with filters: "No events match your filters" + Clear filters CTA |
| 10 | Pagination: totalCount>50 shows controls; Next re-fetches |

## Playwright Coverage (1 test)

`clinic-audit.spec.ts`: Seeds 5 audit_logs rows (3 from Owner A, 2 from Coach B) via admin client. Signs in as Owner A. Navigates to `/clinic/{slug}/settings/audit`. Asserts 5 events. Filters by member Alice Owner → asserts 3 events. Clicks Clear filters → asserts 5 events. Skips when `SUPABASE_SERVICE_ROLE_KEY` absent.

## Deviations from Plan

None — plan executed exactly as written. The single task (TDD=true equivalent with full Vitest + e2e) implemented all 7 files + NAV extension in one commit per the plan's pathspec requirement.

## Threat Flags

| Flag | File | Description |
|------|------|-------------|
| T-10-08-01 mitigated | ClinicSettingsPage.tsx | NAV gate via `visibleWhen: (perms) => perms['audit_log.read'] === true` — tab absent for users without permission |
| T-10-08-02 mitigated | AuditFilterBar.tsx | PostHog payload is booleans only; Vitest test 3 asserts no actor_id property |
| T-10-08-03 accepted | use-audit-events.ts | RLS gates SELECT — even if member filter set to non-org member, no rows return |

## Self-Check: PASSED

All 7 created files exist on disk. Commit `6abe9fc` verified in git log. TypeScript typecheck passes. 14 Vitest tests pass. No unintended file deletions.
