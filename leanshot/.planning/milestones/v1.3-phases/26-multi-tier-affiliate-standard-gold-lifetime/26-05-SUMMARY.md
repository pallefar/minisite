---
phase: 26
plan: 05
subsystem: admin-affiliate-tier-management
tags: [affiliate, admin, tier-management, anomaly-review, secdef-rpc]
requires:
  - 26-01-PLAN (tier columns, fraud_signals table, recurring_payments table)
  - phase-24 (admin_role enum, is_admin_at_least, log_admin_action, audit_logs)
provides:
  - 5 SECDEF tier RPCs (grant/reverse/freeze/unfreeze/anomaly-decision)
  - AdminAffiliatesTierTab + AdminAffiliatesAnomalyTab UI surfaces
  - AffiliateTierError + mapRpcError client error contract
affects:
  - /admin/affiliates page becomes 3-tab host (preserves ApplicationReview body)
  - audit_logs: new action_name values affiliate_tier_{granted,grant_reversed,frozen,unfrozen,anomaly_cleared,anomaly_fraud_confirmed}
  - affiliate_fraud_signals: signal_type='manual' rows inserted on fraud_confirmed
tech-stack:
  added: []
  patterns:
    - SECDEF + locked search_path + suppress_audit='on' GUC + direct audit_logs INSERT
    - client error wrapper with token-substring + errcode mapping
    - tab host pattern (segmented Pill switcher + conditional body)
key-files:
  created:
    - supabase/migrations/20270701000011_admin_tier_rpcs.sql
    - leanshot/src/lib/admin/affiliate-tier.ts
    - leanshot/src/lib/admin/__tests__/affiliate-tier.test.ts
    - leanshot/src/components/admin/AdminAffiliatesTierTab.tsx
    - leanshot/src/components/admin/AdminAffiliatesAnomalyTab.tsx
  modified:
    - leanshot/src/lib/admin/affiliate-review.ts (appended confirmFraud + markClear delegates)
    - leanshot/src/components/admin/AdminAffiliatesReviewQueue.tsx (refactored into tab host)
decisions:
  - "Used direct audit_logs INSERT (not log_admin_action) so each RPC controls row_pk + before/after_data shape explicitly per Pattern A skeleton — log_admin_action stays available for callers that don't need fine-grained payload control."
  - "Pitfall 5 dual-gate on reverse: BOTH no-recurring-payout AND <7d window must hold. Either violation raises cannot_reverse_lifetime (errcode 22023). Prevents state corruption where a reversal lands after a payout cycle already shipped."
  - "Client UX-only window check on Reverse button visibility (withinReverseWindow). Server is source of truth — UI just hides the button when obviously past window, but server re-checks atomically with FOR UPDATE row lock."
metrics:
  duration: ~24min
  completed: 2026-05-18
  tasks_completed: 3
  files_modified: 7
  files_created: 5
requirements:
  - AFFTIER-01
  - AFFTIER-05
---

# Phase 26 Plan 05: Admin tier RPCs + tier-management/anomaly-review tabs

5 SECDEF admin RPCs (`supabase/migrations/20270701000011`) + 1 client wrapper module + 2 new admin tabs joining the existing /admin/affiliates Application Review queue into a 3-tab host — delivering AFFTIER-01 admin grant flow and AFFTIER-05 anomaly review queue with strict superadmin gating, dual-gate reversibility, and explicit audit-log writes.

## What shipped

### Migration: `20270701000011_admin_tier_rpcs.sql` (commit `2664995`)

Five SECURITY DEFINER functions, all with `set search_path = public, pg_catalog` and gated by `is_admin_at_least('superadmin'::public.admin_role)`:

| RPC | Behavior |
|-----|----------|
| `admin_grant_lifetime(uuid)` | Gold → Lifetime; idempotent for lifetime; rejects non-Gold with `must_be_gold_first`; audit `affiliate_tier_granted` |
| `admin_reverse_lifetime_grant(uuid)` | DUAL gate (Pitfall 5): raises `cannot_reverse_lifetime` if ANY row in `affiliate_lifetime_recurring_payments` OR `(now() - tier_promoted_at) > 7d`; audit `affiliate_tier_grant_reversed` |
| `admin_freeze_affiliate(uuid, text)` | Sets `frozen_at = now()` + `freeze_reason`; rejects empty reason (`reason_required`); idempotent if already frozen; audit `affiliate_tier_frozen` |
| `admin_unfreeze_affiliate(uuid)` | Clears `frozen_at` + `freeze_reason`; idempotent if not frozen; audit `affiliate_tier_unfrozen` |
| `admin_anomaly_review_decision(uuid, text)` | Validates `p_decision in ('clear','fraud_confirmed')`; updates `anomaly_review_decision` + `anomaly_reviewed_at`; on `fraud_confirmed` ALSO inserts `affiliate_fraud_signals(signal_type='manual')` so Plan 26-07 claw-back path correlates; audits `affiliate_anomaly_cleared` / `affiliate_anomaly_fraud_confirmed` |

All five use `perform set_config('app.suppress_audit', 'on', true)` immediately before mutation, then INSERT directly into `public.audit_logs` with `source='rpc'`, matching Phase 24's free-text action_name + before_data/after_data column shape.

### Client wrappers: `leanshot/src/lib/admin/affiliate-tier.ts` (commit `9c94df5`)

- `AffiliateTierError` exception class with typed `AffiliateTierErrorCode` union (10 codes).
- `mapRpcError()` does token-substring mapping FIRST (server raises `raise exception '<token>'` → message includes the token) with errcode fallbacks for `28000` (not_authenticated), `42501` (forbidden).
- Five exported wrappers: `grantLifetime`, `reverseLifetimeGrant`, `freezeAffiliate`, `unfreezeAffiliate`, `anomalyReviewDecision`.
- `freezeAffiliate` includes a client-side empty-reason guard so the RPC roundtrip is skipped entirely on bad input.

### Affiliate-review extension: `affiliate-review.ts`

Appended thin delegates `confirmFraud(id)` and `markClear(id)` that route through `anomalyReviewDecision()`. Anomaly errors surface as `AffiliateTierError` (not `AffiliateReviewError`) — keeps the single source of mapping in `affiliate-tier.ts`.

### Vitest suite: 9 tests, all passing

Coverage: client-side guard, errcode 42501 → forbidden, token cannot_reverse_lifetime → cannot_reverse, must_be_gold_first → must_be_gold_first, non-Postgres → network, RPC parameter shape, two delegate-correctness checks, AffiliateTierError preservation through delegation.

### UI: tab host + 2 new tabs (commit `fda0814`)

- **`AdminAffiliatesReviewQueue.tsx`** — outer component refactored into a tab host. Renders a segmented Pill switcher with 3 tabs (Application Review / Tier Management / Anomaly Review). Existing v1.2 body lifted verbatim into internal `<ApplicationReviewBody />` (preserves Phase 19 BL-11 status-transition owner contract). The is_staff gate stays on the outer.
- **`AdminAffiliatesTierTab.tsx`** — lists approved affiliates joined with `affiliate_lifetime_recurring_payments(id)` to compute `has_recurring_payout` client-side. Conditional action buttons:
  - `Grant Lifetime` — visible when `tier='gold' && !frozen_at`
  - `Reverse` — visible when `withinReverseWindow(r)` (tier='lifetime' && no payout && <7d)
  - `Freeze` — prompts for reason; calls RPC with trimmed reason
  - `Unfreeze` — visible when `frozen_at` non-null
- **`AdminAffiliatesAnomalyTab.tsx`** — fetches `affiliate_conversions WHERE anomaly_flagged=true AND anomaly_review_decision IS NULL` limit 100. Per-row `Mark clear` / `Confirm fraud` buttons; reload after each decision so the row disappears.

All tab errors flow through `AffiliateTierError.code → mapErrorToMessage(code)` for friendly user-facing toast text. Buttons use `loading={busyId === r.id}` for spinner feedback; `busyId` gate prevents double-submits across the visible row set.

## Pitfall 5 hardening note

The dual-gate check happens server-side inside the RPC under a `FOR UPDATE` row lock on the affiliate row, then a separate `EXISTS` query against `affiliate_lifetime_recurring_payments`. This is sufficient because the recurring-payments table is append-only at the application layer (no rows ever get deleted to "unlock" a stale reverse). The client's `withinReverseWindow()` is purely a UX hint to hide the obviously-disabled button — never trusted.

## v1.4 hardening note (deferred)

The `recurring_payouts:affiliate_lifetime_recurring_payments(id)` join in `AdminAffiliatesTierTab` over-fetches IDs from the recurring table just to compute a boolean. v1.4 should replace with a SECDEF helper `public.affiliate_has_recurring_payout(uuid) returns boolean` — single-call existence check, RLS-safe, no row IDs leaked to client. Comment in source.

## Deviations from Plan

### Auto-fixed during execution

**1. [Rule 1 - Bug] `JSX.Element` return-type annotations rejected by React 19 / TS strict**
- **Found during:** Task 3 typecheck
- **Issue:** Plan suggested `(): JSX.Element` return-type annotations on tab components; React 19 strips the global JSX namespace.
- **Fix:** Removed explicit return-type annotations (TS infers correctly).
- **Files modified:** `AdminAffiliatesTierTab.tsx`, `AdminAffiliatesAnomalyTab.tsx`

**2. [Rule 1 - Bug] supabase-js join inference returns `GenericStringError[]`**
- **Found during:** Task 3 typecheck
- **Issue:** `.select('… recurring_payouts:affiliate_lifetime_recurring_payments(id)')` makes TS infer the data union as a string-error variant.
- **Fix:** Added `as unknown as RawTierRow[]` cast (matches the same pattern already in `AdminAffiliatesReviewQueue.ApplicationReviewBody`).
- **Files modified:** `AdminAffiliatesTierTab.tsx`

**3. [Rule 1 - Bug] useToast API mismatch in plan code samples**
- **Found during:** Writing Tab components
- **Issue:** Plan suggested `toast({ tone: 'error', message: msg })` but the actual `useToast` hook signature is `(message: string, kind?: 'success'|'error'|'info')`.
- **Fix:** Used `toast(msg, 'error')` form throughout.
- **Files modified:** `AdminAffiliatesTierTab.tsx`, `AdminAffiliatesAnomalyTab.tsx`

**4. [Rule 1 - Bug] Badge tone 'error' does not exist**
- **Found during:** Writing Tier tab
- **Issue:** Plan used `<Badge tone="error">` but BadgeTone is `'info'|'success'|'warning'|'danger'|'neutral'|'inverse'|'amber'`.
- **Fix:** Used `tone="danger"` for the Frozen badge.
- **Files modified:** `AdminAffiliatesTierTab.tsx`

**5. [Rule 3 - Blocking] Worktree had no node_modules**
- **Found during:** Task 2 vitest run
- **Issue:** Worktree-spawned executor has empty node_modules; vitest can't find its own dependency tree.
- **Fix:** Symlinked `node_modules` to main checkout's `leanshot/node_modules` (gitignored — won't be committed).
- **Files modified:** None tracked.

**6. [Rule 3 - Blocking] Migration file written to main repo by absolute-path convention**
- **Found during:** Task 1 verification
- **Issue:** Prompt specified migration absolute path under main repo `/Users/karstenhaldan/minisite/supabase/migrations/` (per documented worktree+Supabase CLI pattern), but the worktree branch also needs the file to land in its commit.
- **Fix:** Wrote to main repo path as instructed, then copied into worktree path so the commit includes it. Orchestrator handles main-repo cleanup before merge per the documented pattern.

None of the deviations changed the SQL contract, the wrappers' RPC dispatching, the dual-gate guard, or the audit-log row shape — all behavioral guarantees per the plan stand.

## Self-Check: PASSED

- `supabase/migrations/20270701000011_admin_tier_rpcs.sql` — FOUND (main + worktree)
- `leanshot/src/lib/admin/affiliate-tier.ts` — FOUND
- `leanshot/src/lib/admin/affiliate-review.ts` — MODIFIED (confirmFraud + markClear appended)
- `leanshot/src/lib/admin/__tests__/affiliate-tier.test.ts` — FOUND (9/9 passing)
- `leanshot/src/components/admin/AdminAffiliatesTierTab.tsx` — FOUND
- `leanshot/src/components/admin/AdminAffiliatesAnomalyTab.tsx` — FOUND
- `leanshot/src/components/admin/AdminAffiliatesReviewQueue.tsx` — MODIFIED (tab host)
- Commits `2664995`, `9c94df5`, `fda0814` — all present in `git log`
- Plan SC1-SC7 — all pass (5 funcs / 6 superadmin gates / suppress GUC / no action_check / vitest green / tsc clean / TIER_TABS import)

## Threat Flags

No new security surface beyond the plan's `<threat_model>`. The 5 SECDEF RPCs match the trust-boundary register; no new endpoints, no auth paths, no file access. The `affiliate_fraud_signals` writes use the same trust boundary documented in 26-01.
