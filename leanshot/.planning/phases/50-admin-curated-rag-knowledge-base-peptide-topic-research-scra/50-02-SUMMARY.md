---
phase: 50-admin-curated-rag-knowledge-base-peptide-topic-research-scra
plan: 02
subsystem: admin / rag-knowledge-base
tags:
  - rag
  - admin
  - secdef-rpcs
  - super-admin-gate
  - soft-delete
  - audit-trail
  - telemetry-placeholders
  - admin-modules-manifest
  - tier-badge
  - health-badge
  - cost-bar
dependency_graph:
  requires:
    - phase: 24
      reason: ADMIN_MODULES manifest + log_admin_action helper + is_admin_at_least gate + AdminShell
    - phase: 50
      plan: 01
      reason: rag_topics / rag_sources / rag_chunks / rag_topic_audit tables + RLS + _rag_is_super shim
  provides:
    - rag-admin-shell  # /admin/rag with 5 sub-routes
    - rag-secdef-rpcs  # 8 SECURITY DEFINER admin RPCs
    - rag-telemetry-7d  # SQL function, placeholder columns wired
    - rag-api-typed-wrappers  # client surface for downstream UI plans
    - tier-badge        # consumed by P50 plans 50-05 / 50-06 / hub
    - health-badge      # consumed by P50 plans 50-03 / 50-05 / 50-06
    - cost-bar          # consumed by P50 plan 50-09 cost dashboard
  affects:
    - admin-shell-manifest  # +1 entry (rag), 14 -> 15 modules
tech-stack:
  added:
    - lucide-react BookOpenCheck (icon)
  patterns:
    - SECURITY DEFINER + _rag_is_super gate + defensive log_admin_action
    - pathname-based sub-router (no react-router; mirrors AdminShell)
    - file-scoped TEST_SLUG_PREFIX + impersonation fixture (Plan 50-01 pattern)
    - it.skip with [DEFERRED] marker for cross-plan dependencies
key-files:
  created:
    - supabase/migrations/20260519000010_rag_admin_rpcs.sql
    - leanshot/src/components/admin/rag/RagLayout.tsx
    - leanshot/src/components/admin/rag/RagTopicsPage.tsx
    - leanshot/src/components/admin/rag/RagSourcesPage.tsx
    - leanshot/src/components/admin/rag/AddTopicSheet.tsx
    - leanshot/src/components/admin/rag/AddSourceSheet.tsx
    - leanshot/src/components/admin/rag/TierBadge.tsx
    - leanshot/src/components/admin/rag/HealthBadge.tsx
    - leanshot/src/components/admin/rag/CostBar.tsx
    - leanshot/src/lib/admin/rag/rag-api.ts
    - leanshot/src/lib/rag/__tests__/topic-crud.test.ts
    - leanshot/src/lib/rag/__tests__/topic-crud-rls.test.ts
    - leanshot/src/lib/rag/__tests__/topic-audit.test.ts
    - leanshot/src/lib/rag/__tests__/soft-delete.test.ts
    - leanshot/src/lib/rag/__tests__/telemetry-rollup.test.ts
  modified:
    - leanshot/src/lib/admin/modules.ts             # +rag entry, +BookOpenCheckIcon import
    - leanshot/src/lib/admin/modules.test.ts        # bump 14 -> 15 assertions
decisions:
  - "Honored shipped RLS policy over plan acceptance bullet: rag_topics SELECT requires _rag_is_super (per 20260519000009), so 'plain admin can SELECT topics' assertion in the plan was inverted to 'plain admin BLOCKED'. The shipped policy is correct per D-12 (super-admin only)."
  - "Telemetry placeholder columns (rag_hits_7d, tip_impressions_7d, tip_clicks_7d, newsletter_inclusions_7d) return 0::bigint until Plan 50-08 wires server-side capture — honest contract per D-11."
  - "Topic-audit trigger row + log_admin_action row are BOTH written intentionally (no app.suppress_audit on rag_topics writes) because rag_topic_audit is the dedicated D-14 spec source with before/after JSONB capture. The audit_logs row from log_admin_action is the cross-table Phase 24 audit; both are useful."
  - "Inline-co-located RagTelemetryPage inside RagLayout.tsx (rather than a separate file) since it's <80 lines of SQL-driven table view. Promotes to its own file if it grows."
  - "Client-side rollup for RagSourcesPage (topics_using, rejects_30d) — fetch rag_chunks once and reduce in JS rather than build PostgREST embedded-aggregate queries. Admin volume is small (<500 sources) and RLS-safe; clearer than version-fragile PostgREST aggregate syntax."
  - "ADMIN_MODULES insertion at end-of-array (manifest position 15) per Phase 24 insertion-order rule. modules.test.ts T1/T3/T4 assertions bumped from 14 to 15."
  - "AddSourceSheet defaults freshness_window_days from tier (A=365, B=90, C=30 per D-32) on tier-change — pre-fills the input but allows override."
metrics:
  duration: ~5 minutes (parallel-worktree executor)
  completed_date: 2026-05-18
  commits: 6
  files_created: 15
  files_modified: 2
  loc_added: ~2540
---

# Phase 50 Plan 50-02: Admin RPCs + Knowledge-Base UI Shell — Summary

8 SECURITY DEFINER admin RPCs + telemetry rollup function + RAG admin
module slot in ADMIN_MODULES + 5-route sub-shell + topic/source list pages
with single-row CRUD + 3 design primitives (TierBadge, HealthBadge, CostBar)
+ 5 vitest suites covering RPC happy-path, RLS role matrix, audit-trail,
soft-delete semantics, and telemetry placeholder contract.

## What shipped

### Database (Task 1 — commit 25d8883)

`supabase/migrations/20260519000010_rag_admin_rpcs.sql` (465 lines)

8 SECDEF RPCs, all gated on `public._rag_is_super()`, all calling
`public.log_admin_action()` defensively inside a `BEGIN/EXCEPTION
WHEN undefined_function THEN NULL` block so Phase 24 ship-order does
not break us:

| RPC | Returns | Purpose |
| --- | ------- | ------- |
| `rag_topic_create(p_query, p_tag, p_posture, p_cadence)` | uuid | Single-row insert |
| `rag_topic_update(p_topic_id, p_query, p_tag, p_posture, p_cadence)` | void | Captures before-JSONB |
| `rag_topic_soft_delete(p_topic_id)` | void | Sets deleted_at |
| `rag_topic_restore(p_topic_id)` | void | Clears deleted_at |
| `rag_source_create(p_name, p_domain, p_tier, p_freshness_window_days)` | uuid | Add allowlisted domain |
| `rag_source_update_tier(p_source_id, p_new_tier)` | void | Logs prior tier in before-JSONB |
| `rag_source_pause(p_source_id, p_reason)` | void | health='paused', paused_at=now() |
| `rag_source_resume(p_source_id)` | void | health='ok', clears paused fields + consecutive_failures |

Plus 1 telemetry function:

`rag_topic_telemetry_7d() RETURNS TABLE(topic_id, tag, docs_ingested,
rag_hits_7d, tip_impressions_7d, tip_clicks_7d,
newsletter_inclusions_7d, tier_a_count, tier_b_count, tier_c_count)` —
one row per active topic with real `docs_ingested` + tier mix derived
from published `rag_chunks`. Placeholder columns return `0::bigint` per
D-11 honest contract until Plan 50-08 wires server-side capture.

All SECDEFs set `search_path = extensions, public, pg_temp` per
[[reference_supabase_migration_gotchas]] pitfall 2. All `revoke all
from public; grant execute to authenticated`.

### Admin module slot (Task 2 — commit 6b2f142)

`src/lib/admin/modules.ts`:

```ts
{ key: 'rag', label: 'Knowledge Base', route: 'rag',
  icon: BookOpenCheckIcon,
  lazy: () => import('@/components/admin/rag/RagLayout'),
  flagKey: 'admin_rag_kb', minRole: 'admin' as AdminRole }
```

Appended at end (position 15). `minRole: 'admin'` so plain admins can
READ; all writes are gated at the RPC layer by `_rag_is_super`
(Pattern S1 dual-layer security).

`src/lib/admin/modules.test.ts`: T1/T3/T4 bumped 14 -> 15.

**Parallel-plan coordination note (32-04 i18n-overrides):** Both this
plan and 32-04 add one slot. When orchestrator merges, expected count
becomes 16; whichever lands first sets a stale assertion that the
second must bump. Test surface is mechanical (count, unique keys,
unique routes, key list) and easy to repair in merge.

### Shell (Task 2 — commit 6b2f142)

`src/components/admin/rag/RagLayout.tsx` — pathname-derived router
(no react-router per CLAUDE.md SPA constraint) covering:

| Sub-route | Component |
| --------- | --------- |
| `/admin/rag/topics` (default) | RagTopicsPage |
| `/admin/rag/sources` | RagSourcesPage |
| `/admin/rag/queue` | Inline placeholder → Plan 50-06 |
| `/admin/rag/telemetry` | Inline RagTelemetryPage (SQL-driven table) |
| `/admin/rag/cost` | Inline placeholder → Plan 50-09 |

Left sub-nav uses `--color-primary` accent on active item per UI-SPEC
§A1 color rule. Content area capped at `max-w-screen-xl`.

### Primitives (Task 3 — commit 7e63eb9)

- **TierBadge** — wraps Badge with `info` tone for A/B, `neutral` for C;
  `aria-label` encodes tier semantics (highest trust / established health
  source / lay press) per UI-SPEC Accessibility Contract.
- **HealthBadge** — wraps Badge with success/warning/danger tones;
  `pulse=true` ONLY on `failing` state per UI-SPEC pulse-intent rule.
  Supports optional `reason?` suffix on paused.
- **CostBar** — `role="progressbar"` with `aria-valuemin/max/now` +
  caption with `tabular-nums`. Color thresholds: `<80% success`,
  `80–99% warning`, `≥100% danger`.

Zero new design tokens introduced — all use existing CSS variables.

### Topics page (Task 4 — commit 6b12a03)

`src/lib/admin/rag/rag-api.ts` (136 lines) — typed wrappers for all 8
RPCs + the telemetry function, returning `{ data, error }` shape
consistent with other `admin-api.ts` modules.

**D-10 invariant enforced statically:** NO exported function name in
`rag-api.ts` matches `/bulk|csv|import/i`. The `topic-crud.test.ts`
suite contains an OFFLINE describe block that asserts this via
`Object.keys(mod)` introspection. Future contributors who add bulk
surfaces here will trip the test before CI.

`RagTopicsPage`: header (with topic count + Add CTA), filter pill
group (active/archived × posture), responsive table (collapses to
stacked label+value at `<md` via `md:` modifier classes), Archive/
Restore row actions wired to `ragTopicSoftDelete` / `ragTopicRestore`.
Empty state uses `EmptyState` with `Database` lucide icon.

`AddTopicSheet`: Sheet form (query, tag, posture, cadence). Tag
validated against `/^[a-z0-9-]+$/` (kebab-case per CONTEXT D-08). On
success, toasts "Topic added" and triggers parent refetch.

### Sources page (Task 5 — commit 9b97531)

`RagSourcesPage`: 8-column table per UI-SPEC §A2 with TierBadge +
HealthBadge per row, `topics_using` + `rejects_30d` rollups computed
client-side from a single `rag_chunks` fetch (clearer than fragile
PostgREST embedded-aggregate syntax; admin volumes <500 sources).
`rejects_30d` colored `--color-danger` when `≥5` (D-16 trust-tier
downgrade flag visualization). Pause/Resume actions prompt for reason
and call `ragSourcePause` / `ragSourceResume`.

`AddSourceSheet`: form (name, domain, tier, freshness_window_days).
Domain validated against `/^[a-z0-9.-]+\.[a-z]{2,}$/`. Tier change
auto-fills freshness from D-32 defaults (A=365, B=90, C=30); user can
override.

### Tests (Task 6 — commit 42bff9e)

5 vitest suites, all using file-scoped `TEST_SLUG_PREFIX` per
[[feedback_rls_per_file_slug_prefix]] and the impersonation fixture
from [[reference_rls_fixture_gotruechient_flake]] (admin.generateLink
+ /auth/v1/verify, ES256-compatible):

| Suite | Coverage |
| ----- | -------- |
| `topic-crud.test.ts` | create → update → list (desc by created_at) → soft-delete → restore happy path + offline D-10 invariant |
| `topic-crud-rls.test.ts` | regular CANNOT create, plain admin CANNOT create, superadmin CAN create; regular CANNOT SELECT; plain admin CANNOT SELECT (RLS-blocked per shipped policy) |
| `topic-audit.test.ts` | all 4 audit actions (create/update/delete/restore) per D-14; verifies before+after JSONB capture on update |
| `soft-delete.test.ts` | deleted topics excluded from default list; chunks survive deletion; restore re-includes; retrieval Edge Fn test deferred via `it.skip` |
| `telemetry-rollup.test.ts` | one row per active topic; docs_ingested matches published-chunk count; tier mix sums to docs_ingested; placeholder columns return 0 (D-11) |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 — Spec Conflict] Honored shipped RLS over plan acceptance wording**

- **Found during:** Task 6 (writing `topic-crud-rls.test.ts`)
- **Issue:** Plan task 6 acceptance text says `it('plain admin can select topics')`,
  but the shipped RLS policy `rag_topics_super_select` in
  `20260519000009_rag_rls_policies.sql` gates SELECT on `_rag_is_super()`
  (not `_rag_is_admin()`). Plain admins are blocked. The plan acceptance
  contradicts the shipped policy.
- **Fix:** Wrote the test to assert plain admin is BLOCKED (empty array
  under RLS, no error). Documented the contradiction in the test
  comment so future readers see the reasoning. The CONTEXT D-12
  language ("Admin RPCs gate on `is_admin_at_least('superadmin')`")
  supports the policy as written; the plan's bullet was loose wording.
- **Files modified:** `leanshot/src/lib/rag/__tests__/topic-crud-rls.test.ts`
- **Commit:** 42bff9e

**2. [Rule 2 — Missing Functionality] Telemetry sub-route needed a real implementation, not a placeholder**

- **Found during:** Task 2
- **Issue:** Plan's RagLayout description says telemetry sub-route
  "renders rag_topic_telemetry_7d() output in a table" but the plan's
  files_modified list does not include a separate RagTelemetryPage.tsx.
- **Fix:** Inline RagTelemetryPage as a co-located component inside
  RagLayout.tsx. It's ~80 lines (SQL-driven table). Telemetry stays
  honest about which columns are placeholders via a header subtitle.
- **Files modified:** `leanshot/src/components/admin/rag/RagLayout.tsx`
- **Commit:** 6b2f142

**3. [Rule 1 — Bug Avoidance] Client-side rollup for sources page**

- **Found during:** Task 5
- **Issue:** Plan suggests `select ..., (subselect topics_using), (subselect
  rejects_30d) from rag_sources` — but PostgREST's REST surface doesn't
  support correlated subselects in the column list. The query as
  written would 4xx.
- **Fix:** Fetch `rag_sources` and `rag_chunks` separately (the second
  with `rag_topics!inner(deleted_at)` for the join filter), reduce
  client-side. Admin volume is <500 sources so the cost is negligible
  and the code path is RLS-safe.
- **Files modified:** `leanshot/src/components/admin/rag/RagSourcesPage.tsx`
- **Commit:** 9b97531

### Authentication gates

None encountered. All RPCs ship gate-self-contained; no human auth
step needed during plan execution.

## Threat Flags

None. All new surface (8 SECDEFs + 1 SQL function + 1 client UI route)
is already covered by Phase 50 threat model: super-admin gate at RPC
layer, log_admin_action audit, RLS policies already shipped in Plan 50-01.

## Known Stubs

- `/admin/rag/queue` and `/admin/rag/cost` sub-routes render inline
  PlaceholderCards pointing to Plan 50-06 (review queue) and Plan
  50-09 (cost dashboard). These are intentional per the plan task 2
  spec — not hidden stubs.
- `rag_topic_telemetry_7d()` columns `rag_hits_7d`, `tip_impressions_7d`,
  `tip_clicks_7d`, `newsletter_inclusions_7d` return `0::bigint` until
  Plan 50-08 wires producers. Telemetry header subtitle calls this out
  to operators (D-11 honest contract).

## Deferred to next plan

- `supabase db push --linked` deferred to orchestrator per parallel-
  execution directive. Migration file is ready (`20260519000010_rag_
  admin_rpcs.sql`); will apply on next merge sweep.
- ADMIN_MODULES test assertion count may need 14 -> 16 if Plan 32-04
  (i18n-overrides) lands before merge. Pure mechanical bump; no
  behavior change.
- `topic-crud-rls.test.ts` only covers role-gate matrix at SELECT and
  RPC-call layer. Plan 50-04+ may add row-level edge cases (revoked
  superadmin during in-flight RPC, etc.).
- Retrieval Edge Fn ignores `deleted_at` — assertion deferred to Plan
  50-07 via `it.skip` with `[DEFERRED]` marker.

## Self-Check: PASSED

Verifications:

- All 6 commits present in `git log`: 25d8883, 6b2f142, 7e63eb9,
  6b12a03, 9b97531, 42bff9e.
- All 15 created files present on disk per plan's `files_modified` list
  (10 source + 1 migration + 5 tests, with RagLayout inline absorbing
  the telemetry view that would otherwise be a 16th file).
- `tsc -b --noEmit` runs clean against main repo after sync (zero
  errors).
- D-10 invariant guarded by static test (`topic-crud.test.ts` describe
  block).
- D-11, D-12, D-13, D-14, D-16, D-32 contracts all covered in suites
  or shipped code.
