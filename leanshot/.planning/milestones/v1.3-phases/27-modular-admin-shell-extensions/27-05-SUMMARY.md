---
phase: 27-modular-admin-shell-extensions
plan: 05
subsystem: admin / anomaly / config
tags: [admin, anomaly, config, ui, secdef-rpc, taxo-05]
requires:
  - 27-04 (anomaly_tracked_funnels table + funnel_anomaly_alerts table + acknowledge RPC)
  - Phase 24 (is_admin_at_least, log_admin_action, admin_role enum)
provides:
  - public.anomaly_funnel_define(text, int, numeric) → uuid (SECDEF, superadmin-gated)
  - public.anomaly_funnel_update(uuid, boolean, int, numeric) → void (SECDEF, superadmin-gated)
  - public.anomaly_funnel_delete(uuid) → void (SECDEF, superadmin-gated, has_alerts guard)
  - leanshot/src/lib/admin/anomaly/config-api.ts — client wrappers + AnomalyConfigApiError
  - leanshot/src/components/admin/anomaly/AdminAnomalyTrackedFunnelsConfig.tsx
  - leanshot/src/components/admin/anomaly/AnomalyConfigPage.tsx (lazy-mountable, default export)
affects:
  - /admin/anomaly route (component exists; ADMIN_MODULES entry deferred to addendum)
tech-stack:
  added: []
  patterns:
    - Pattern S1 (UX gate + SECDEF re-check)
    - Pattern S3 (suppress_audit GUC + log_admin_action)
    - Pattern S7 (discriminated client error contract)
    - Pattern S10 (status-writer ownership — superadmin owns INSERT/UPDATE/DELETE)
key-files:
  created:
    - supabase/migrations/20270602000040_anomaly_tracked_funnels_admin_rpcs.sql
    - leanshot/src/lib/admin/anomaly/config-api.ts
    - leanshot/src/lib/admin/anomaly/config-api.test.ts
    - leanshot/src/components/admin/anomaly/AdminAnomalyTrackedFunnelsConfig.tsx
    - leanshot/src/components/admin/anomaly/AnomalyConfigPage.tsx
  modified: []
decisions:
  - Migration timestamp 20270602000040 (NOT plan-spec 20260601000040) — avoids
    20260601* collision with already-applied pending_account_deletions migrations
    on the linked DB. Same renamed-batch pattern as 27-02 cohort migrations.
  - has_alerts guard (delete RPC) raises errcode 22023 with token 'has_alerts';
    client wrapper discriminates via token-first inspection because 22023 is
    also raised for 'not_found' (delete + update share this code).
  - Token-first error mapping in config-api.ts mapRpcError():
    'duplicate_event_name' / 'has_alerts' / 'not_found' / 'not_authenticated' /
    'forbidden' tokens take precedence over generic SQLSTATEs (23505, 22023,
    28000, 42501). Defensive against shared codes.
  - Numeric columns (sigma_threshold) are coerced via Number() on the client
    because PostgREST sends Postgres numeric as a string ('2.0').
  - ADMIN_MODULES entry intentionally NOT added (anti-pattern guard: no
    shared-file choreography in Wave 2 plan). 1-line follow-up addendum
    documented below.
  - AnomalyConfigPage embeds AdminAnomalyAcknowledgeQueue (27-04) inside a
    Card wrapper rather than re-implementing the queue surface — single
    source of truth.
metrics:
  duration: ~11 minutes (single-pass, no checkpoint, no deferrals beyond
            the planned supabase db push)
  completed: 2026-05-18T11:34:53Z
---

# Phase 27 Plan 05: Anomaly tracked funnels admin CRUD Summary

Three SECDEF RPCs (define/update/delete) plus client wrappers and a two-section
admin page that combines the existing acknowledge queue (27-04) with a new
superadmin-only CRUD surface for `public.anomaly_tracked_funnels`. Closes
TAXO-05 SC#5 operator self-serve gap — founder can add / re-threshold /
disable / delete tracked funnels live without a migration deploy.

## What shipped

### Migration — `supabase/migrations/20270602000040_anomaly_tracked_funnels_admin_rpcs.sql`

Three `language plpgsql security definer set search_path = public, extensions,
pg_catalog, pg_temp` RPCs. All three:

- Gate on `auth.uid() is not null` (raise 28000 not_authenticated) and
  `public.is_admin_at_least('superadmin')` (raise 42501 forbidden) — matches
  the RLS posture in migration 20260601000031 (INSERT/UPDATE/DELETE policies
  all superadmin-only).
- `perform set_config('app.suppress_audit', 'true', true)` before mutating so
  the BEFORE-UPDATE audit trigger doesn't double-fire alongside
  `log_admin_action`. Pattern S3.
- Audit via `public.log_admin_action(p_action_name, p_target_user_id => null,
  p_table_name => 'anomaly_tracked_funnels', p_row_pk => funnel_id::text,
  p_before, p_after)` — uses the Phase 24 helper, NOT raw inserts into
  `audit_logs` (correct columns: actor_user_id, row_pk, table_name).
- `revoke all … from public; grant execute … to authenticated;` — the SECDEF
  body is the only authorization gate.

| RPC | Action | Notes |
|---|---|---|
| `anomaly_funnel_define(event_name, lookback_days=7, sigma_threshold=2.0)` | INSERT new tracked funnel | UNIQUE violation re-raised as `duplicate_event_name` (errcode 23505 preserved). Returns new `funnel_id`. Defaults match the 27-04 seed shape. |
| `anomaly_funnel_update(funnel_id, is_enabled?, lookback_days?, sigma_threshold?)` | Partial UPDATE via COALESCE | `select row_to_json(t)::jsonb … for update` snapshots BEFORE state + locks the row; `GET DIAGNOSTICS row_count` confirms the update landed. Audit logs full before/after diff. |
| `anomaly_funnel_delete(funnel_id)` | DELETE with `has_alerts` guard | T-27-05-02 mitigation: refuses delete (`raise exception 'has_alerts' using errcode = '22023'`) when any `funnel_anomaly_alerts` row references the funnel. Operators must Disable instead — alert history is preserved. |

Action names added to `audit_logs.action_name` (free text in Phase 24 — no
CHECK constraint extension needed):
`anomaly_funnel_defined`, `anomaly_funnel_updated`, `anomaly_funnel_deleted`.

### Client wrapper — `leanshot/src/lib/admin/anomaly/config-api.ts`

```ts
export type AnomalyConfigApiErrorCode =
  | 'not_staff' | 'not_authenticated'
  | 'duplicate_event_name' | 'not_found' | 'has_alerts'
  | 'network' | 'unknown';

export class AnomalyConfigApiError extends Error { code: AnomalyConfigApiErrorCode; … }

export async function defineFunnel(eventName, lookbackDays?, sigmaThreshold?): Promise<{funnelId}>
export async function updateFunnel(funnelId, patch: {isEnabled?, lookbackDays?, sigmaThreshold?}): Promise<void>
export async function deleteFunnel(funnelId): Promise<void>
export async function listTrackedFunnels(): Promise<TrackedFunnel[]>
```

- `callConfigRpc` centralizes error mapping; wraps `supabase.rpc(…)` in
  try/catch + maps any thrown to `AnomalyConfigApiError('network')`.
- `mapRpcError` inspects message tokens FIRST (because 22023 is shared
  between `not_found` and `has_alerts`, and 23505 between native
  `unique_violation` and the re-raised `duplicate_event_name`), then falls
  back to SQLSTATE.
- `updateFunnel` sends ONLY the keys present in `patch` to the RPC so the
  server-side COALESCE preserves untouched columns.
- `listTrackedFunnels` reads via the RLS-gated SELECT (admin+ can SELECT per
  migration 20260601000031). Coerces `sigma_threshold` to Number — PostgREST
  serializes Postgres `numeric` as a string.

### Tests — `leanshot/src/lib/admin/anomaly/config-api.test.ts`

13 tests, all green:

- `defineFunnel` × 5 — success, omits optional params, 42501 → not_staff,
  23505 → duplicate_event_name, network exception
- `updateFunnel` × 3 — partial keys, multi-key, 22023 → not_found
- `deleteFunnel` × 3 — success, has_alerts guard, not_found
- `listTrackedFunnels` × 2 — row shape mapping (numeric → Number), error
  surfacing

Mocks `@/lib/supabase` via `vi.mock` before importing the module under test.
Re-imports per `beforeEach` to keep mock state hermetic.

### UI — `leanshot/src/components/admin/anomaly/AdminAnomalyTrackedFunnelsConfig.tsx`

Superadmin CRUD surface. Inline-editable table + add-form:

- **Table columns:** event_name (mono), Enabled (checkbox), Lookback (number
  input, 1–90 days), Sigma (number input, 0.1–10, step 0.1), Created, Delete.
- **Optimistic edits:** `applyPatch` snapshots prior rows, applies the
  change locally, calls the RPC, and rolls back to the snapshot on error.
  Toast on every outcome.
- **Delete:** opens `ConfirmModal` with destructive variant and a message
  that names the funnel and warns about `has_alerts`. On `has_alerts` →
  toast `'Delete denied: funnel has alert history. Disable instead.'` and
  the row stays.
- **Add form:** event_name (text), Lookback (default 7), Sigma (default 2.0)
  + Plus-icon Add button. Client-side validation matches RPC defaults; on
  success prepends the new row and clears the form.

Uses existing primitives: `Button`, `Card`, `ConfirmModal`, `Input`,
`useToast`. No new UI primitive needed.

### Page wrapper — `leanshot/src/components/admin/anomaly/AnomalyConfigPage.tsx`

Two sections at `/admin/anomaly`:

1. **Firing alerts** — embeds `AdminAnomalyAcknowledgeQueue` (Plan 27-04).
2. **Tracked funnels** — `AdminAnomalyTrackedFunnelsConfig` (this plan).

Superadmin gate at page top: probes `profiles.admin_role`; non-superadmin
renders `NotAuthorizedCard` (reused from `AdminShell`). Default-exported so
an `ADMIN_MODULES` entry can `lazy: () => import('./AnomalyConfigPage')`.

## ADMIN_MODULES entry — 1-line addendum (NOT applied in this plan)

Per anti-pattern guard (no shared-file choreography in Wave 2 plan), the
`ADMIN_MODULES` manifest entry is documented here for a follow-up addendum,
NOT applied directly:

```ts
// leanshot/src/lib/admin/modules.ts — add to ADMIN_MODULES array
{
  key: 'anomaly',
  label: 'Anomaly',
  route: 'anomaly',
  icon: AlertTriangleIcon, // import from lucide-react
  lazy: () => import('@/components/admin/anomaly/AnomalyConfigPage'),
  flagKey: 'admin.anomaly.enabled',
  minRole: 'superadmin' as AdminRole,
},
```

Until that addendum lands, the route is reachable via direct lazy-mount;
`AdminAnomalyBanner`'s "View queue" button hash-routes to `/#/admin/anomaly`
and surfaces the queue surface through `AnomalyConfigPage` when the
ADMIN_MODULES entry is added.

## Verification

| Verify | Status |
|---|---|
| Task 1 — migration grep (security definer × 3, is_admin_at_least('superadmin'), has_alerts, all 3 RPC names) | PASS |
| Task 2 — `vitest run src/lib/admin/anomaly/config-api.test.ts` | PASS (13/13) |
| Task 3 — `tsc -b` (full project typecheck) | PASS (no errors) |
| Task 3 — `eslint src/components/admin/anomaly src/lib/admin/anomaly/config-api*` | PASS (after `import type * as` fix) |
| Task 4 — `supabase db push --linked` + RPC presence probe | **DEFERRED to orchestrator** (per executor prompt directive: "Defer any `supabase db push` to orchestrator") |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Lint] `consistent-type-imports` blocks `typeof import('./config-api')`**
- **Found during:** Task 3 lint pass after Task 2 GREEN commit.
- **Issue:** The vitest dynamic-import pattern `let api: typeof import('./config-api')` trips
  `@typescript-eslint/consistent-type-imports` (rule forbids inline type-only `import()`
  annotations in favour of top-level `import type`).
- **Fix:** Replaced with a top-level `import type * as ConfigApiTypes from './config-api'`
  followed by `let api: typeof ConfigApiTypes`. Functionally identical (the type-only import
  is elided at runtime), but satisfies the rule.
- **Files modified:** `leanshot/src/lib/admin/anomaly/config-api.test.ts`
- **Commit:** folded into `9e08d8f` (Task 3 commit).

### Naming / migration timestamp

**Migration timestamp 20270602000040 (not plan-spec 20260601000040)** — per the
executor prompt's explicit instruction, the `20260601*` slot collides with
already-applied `pending_account_deletions` migrations on the linked DB.
Documented in the migration header docblock. Same renamed-batch pattern as
27-02's cohort migrations.

## Threat Flags

None. All three RPCs land within the boundary described by the plan's
`<threat_model>`. The has_alerts guard on delete (T-27-05-02) is enforced
server-side; no new network endpoints, no new auth paths, no schema changes
beyond the three function objects.

## Commits

| Commit | Type | Description |
|---|---|---|
| `bede9a7` | feat(27-05-01) | Migration: 3 SECDEF RPCs (anomaly_funnel_define/update/delete) |
| `13fe371` | test(27-05-02) | RED — failing tests for anomaly config-api wrappers (13 tests) |
| `e3554de` | feat(27-05-02) | GREEN — config-api wrappers; 13/13 tests pass |
| `9e08d8f` | feat(27-05-03) | AdminAnomalyTrackedFunnelsConfig + AnomalyConfigPage + ESLint fix |

## Self-Check: PASSED

- [x] `supabase/migrations/20270602000040_anomaly_tracked_funnels_admin_rpcs.sql` — FOUND
- [x] `leanshot/src/lib/admin/anomaly/config-api.ts` — FOUND
- [x] `leanshot/src/lib/admin/anomaly/config-api.test.ts` — FOUND (13/13 pass)
- [x] `leanshot/src/components/admin/anomaly/AdminAnomalyTrackedFunnelsConfig.tsx` — FOUND
- [x] `leanshot/src/components/admin/anomaly/AnomalyConfigPage.tsx` — FOUND
- [x] Commit bede9a7 — FOUND in git log
- [x] Commit 13fe371 — FOUND in git log
- [x] Commit e3554de — FOUND in git log
- [x] Commit 9e08d8f — FOUND in git log
