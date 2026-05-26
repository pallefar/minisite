---
phase: 60-rag-knowledge-base-completion-waves-2-4
plan: "09"
subsystem: admin-rag
tags: [admin, rag, federated, ui, react, tdd]
dependency_graph:
  requires:
    - 60-01 (federated_sources table + SECDEF RPC infrastructure)
    - 60-07 (rag-federated-{pubmed,openfda,dailymed} Edge Fns)
  provides:
    - federated-toggle-ui
    - federated-api-wrapper
  affects:
    - admin-rag-federated
    - admin-rag-shell
tech_stack:
  added: []
  patterns:
    - admin-rag-page-mount-via-SUB_ROUTES
    - vitest-mock-supabase-rpc
    - optimistic-toggle-with-rollback
key_files:
  created:
    - leanshot/src/lib/admin/rag/federated-api.ts
    - leanshot/src/lib/admin/rag/__tests__/federated-api.test.ts
    - leanshot/src/components/admin/rag/FederatedSourceRow.tsx
    - leanshot/src/components/admin/rag/__tests__/FederatedSourceRow.test.tsx
    - leanshot/src/components/admin/rag/FederatedSourcesPage.tsx
    - leanshot/src/components/admin/rag/__tests__/FederatedSourcesPage.test.tsx
    - supabase/migrations/20281201000020_federated_source_rpcs.sql
  modified:
    - leanshot/src/components/admin/rag/RagLayout.tsx
decisions:
  - no-toggle-primitive-built-inline-switch
  - no-react-router-extends-SUB_ROUTES
  - optimistic-toggle-with-rollback
  - option-d-pull-history-deferred-to-60-15
  - source-meta-client-side-const-map
metrics:
  duration: ~45 minutes
  completed: 2026-05-26
  tasks_completed: 5
  files_created: 7
  files_modified: 1
  tests_added: 35
---

# Phase 60 Plan 09: Admin Federated Toggle UI Summary

**One-liner:** Federated Sources admin page at `/admin/rag/federated` with per-source enable/disable toggles, last-sync display, and error badges — Option D deferral ships disabled Pull-history button pending 60-15 admin-token auth.

## What Was Built

Admin page `FederatedSourcesPage` mounted in `RagLayout.SUB_ROUTES` at path `federated`. Displays 3 source rows (PubMed/NLM E-utilities, OpenFDA, DailyMed) with:
- `role="switch"` toggle calling `set_federated_source_enabled` SECDEF RPC
- Optimistic UI update with rollback on RPC failure
- `last_sync_at` displayed as relative time via `Intl.RelativeTimeFormat`
- `last_error` Badge (warning tone, truncated to 80 chars, React auto-escape)
- `role="status" aria-live="polite"` on last-sync region

Typed client wrapper `federated-api.ts` exports `listFederatedSources`, `setFederatedSourceEnabled`, `triggerHistoricalPull`, `FederatedSource`, `SOURCE_META`.

Migration `20281201000020_federated_source_rpcs.sql` ships 2 SECDEF RPCs:
- `public.list_federated_sources()` — staff-only, returns all 3 rows
- `public.set_federated_source_enabled(p_name, p_enabled)` — toggles + updated_at

**Migration NOT pushed — 60-15 pushes all Phase 60 migrations atomically.**

## Option D Resolution (Orchestrator Decision 2026-05-26)

4 blockers were resolved before execution:

| Blocker | Resolution |
|---------|-----------|
| Schema mismatch: `last_synced_at` vs `last_sync_at` | Used `last_sync_at` (actual column) |
| Missing `display_name` + `sync_cadence_label` columns | Client-side `SOURCE_META` const map; no DB changes |
| Missing `list_federated_sources` + `set_federated_source_enabled` RPCs | New migration 20281201000020 (not pushed yet) |
| Pull-history requires admin-token auth (60-07 architecture finding) | Button rendered DISABLED with tooltip; deferred to 60-15 |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] FederatedSource interface matched actual DB schema**
- **Found during:** Pre-execution investigation
- **Issue:** Plan interface used `last_synced_at` + `display_name` + `sync_cadence_label` but actual `federated_sources` table has `last_sync_at` only (no display/cadence columns)
- **Fix:** Interface uses `last_sync_at`; `SOURCE_META` const map derives `display_name` + `sync_cadence_label` client-side
- **Files modified:** `federated-api.ts`
- **Commit:** 8b7ca2f2

**2. [Rule 2 - Missing Critical] SECDEF RPCs not in any existing migration**
- **Found during:** Pre-execution investigation
- **Issue:** Plan assumed RPCs existed in 60-01 migration but they were absent from `20281201000002_phase60_secdef_rpcs.sql`
- **Fix:** New migration `20281201000020_federated_source_rpcs.sql` added (not pushed — 60-15 owns push)
- **Files modified:** `supabase/migrations/20281201000020_federated_source_rpcs.sql`
- **Commit:** 8b7ca2f2

### Option D — Pull-History Deferred

**Pull full history button rendered DISABLED (orchestrator decision):**
- **Issue found during:** Pre-execution investigation — 60-07 Fns designed for cron/service-role, not browser admin-token calls
- **Option D:** Render button disabled with tooltip "Coming soon — admin-token auth deferred to phase close-out (60-15)"
- **PullHistoryConfirmDialog:** NOT shipped (deferred to 60-15)
- **Comment block** in `FederatedSourceRow.tsx` explains the architectural finding and deferral path
- **Carry-over documented** in SUMMARY (see below)

**3. [Rule 1 - Bug] Test used `require()` in ESM context**
- **Found during:** Task 3 test execution
- **Issue:** One test used `require('../FederatedSourcesPage')` which doesn't work in Vitest ESM context
- **Fix:** Changed to `await import('../FederatedSourcesPage')` matching existing pattern
- **Commit:** 37a821ca

**4. [Rule 3 - Blocking] ESLint import-x/order on test file**
- **Found during:** Task 5 eslint gate
- **Issue:** `vi.hoisted()` between import groups triggered import-x/order error
- **Fix:** Moved imports before `vi.hoisted()` block (matches chunk-api.test.ts pattern)
- **Commit:** 36d6c728

## Carry-over to 60-15

**"Ship admin-action-token mechanism + wire Pull-history button"**

Steps for 60-15 executor:
1. Implement admin-action-token pattern (short-lived, scoped to historical-pull action)
2. In `FederatedSourceRow.tsx`: remove `disabled` + `title` attributes from Pull-history button
3. Wire `onClick` to call `onTriggerPull()`
4. Add `PullHistoryConfirmDialog` (cost-warning copy per UI-SPEC §2)
5. Push migration `20281201000020_federated_source_rpcs.sql` + all Phase 60 migrations

## Tests

| File | Tests | Status |
|------|-------|--------|
| `federated-api.test.ts` | 9 | All pass |
| `FederatedSourceRow.test.tsx` | 14 | All pass |
| `FederatedSourcesPage.test.tsx` | 12 | All pass |
| **Total** | **35** | **All pass** |

## Verification Gates Passed

- [x] All 35 vitest tests pass
- [x] `tsc -p tsconfig.app.json --noEmit` — clean
- [x] `eslint` — clean on all 7 new files
- [x] Typography gate — no `text-(base|md)` in component files
- [x] `FederatedSourcesPage` mounted in `RagLayout.SUB_ROUTES` at `federated` key
- [x] `role="switch"` + `aria-checked` + `aria-label` on all toggle buttons
- [x] `role="status"` + `aria-live="polite"` on last-sync regions
- [x] Zero new npm packages

## Known Stubs

- "Pull full history" button in `FederatedSourceRow.tsx` is disabled with tooltip `"Coming soon — admin-token auth deferred to phase close-out (60-15)"`. This is intentional per Option D. The deferral is documented in code + SUMMARY. 60-15 owns the resolution.

## Threat Surface Scan

No new threat surface introduced beyond what the plan's `<threat_model>` documented:
- `last_error` text rendered via React text node (T-60-09-04 — auto-escape confirmed)
- RPC calls gated by SECDEF `is_staff()` (T-60-09-02 — defense-in-depth)
- Pull-history button disabled (T-60-09-03 — cost-runaway mitigation, stronger than planned)
- Migration NOT pushed (no live attack surface until 60-15)

## Requirements Satisfied

- RAG-06 (admin UI control surface) — partial: toggle/status UI ships; historical pull deferred to 60-15

## Decisions Made

| Decision | Rationale |
|----------|-----------|
| `SOURCE_META` client-side const map | DB table lacks display columns; avoids new DB migration for display-only data |
| `no-toggle-primitive-built-inline-switch` | No Toggle primitive in `/src/components/ui/`; inline `<button role="switch">` matches UI-SPEC §2 |
| `optimistic-toggle-with-rollback` | Matches RagSourcesPage/RagTopicsPage pattern; better UX than await-then-render |
| `option-d-pull-history-deferred-to-60-15` | 60-07 Fns need admin-token auth; shipping disabled button now closes UI shape; 60-15 wires it |
| `no-router-extends-SUB_ROUTES` | Admin RAG shell uses SUB_ROUTES pattern (per [[reference_react_router_consumer_admin_split]]); no react-router |

## Self-Check: PASSED

All 7 created files exist on disk. All 5 task commits verified in git log:
- 8b7ca2f2: federated-api + migration
- fc15a9fc: FederatedSourceRow + tests
- 37a821ca: FederatedSourcesPage + tests
- 1e95dbf1: RagLayout SUB_ROUTES
- 36d6c728: eslint fix
