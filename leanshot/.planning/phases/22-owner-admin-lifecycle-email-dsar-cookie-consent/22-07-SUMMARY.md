---
phase: 22-owner-admin-lifecycle-email-dsar-cookie-consent
plan: 07
subsystem: admin-ui + migrations
tags: [admin, react, supabase-js, stripe, affiliate, status-machine, security-definer, tdd]

# Dependency graph
requires:
  - phase: 22-owner-admin-lifecycle-email-dsar-cookie-consent
    plan: 01
    provides: "audit_logs.action CHECK enum extension pattern (drop+re-add idiom); is_staff()+app.suppress_audit GUC hook plumbing"
  - phase: 22-owner-admin-lifecycle-email-dsar-cookie-consent
    plan: 03
    provides: "admin-stripe-action Edge Fn (refund/cancel/comp dispatch with PII-safe error wrap + admin_log_* audit RPCs)"
  - phase: 22-owner-admin-lifecycle-email-dsar-cookie-consent
    plan: 06
    provides: "MemberRowActions + MemberStripeTab + MemberBillingTab placeholder stubs + AdminMemberDetailPage tab shell + AdminLayout is_staff gate"
  - phase: 19-affiliate-program-stripe-connect
    plan: 05
    provides: "AdminAffiliatesScaffold (5-state filter + 6-col table) pattern that the review queue extends in-place"
  - phase: 19-affiliate-program-stripe-connect
    plan: 09
    provides: "affiliate-conversions-confirm cron (only confirms empty-fraud rows) + materialize cron filtering status='confirmed' + monthly payout transfer cron"

provides:
  - "RefundModal (3-step gated: charge → amount + Pill quick-fill → typed-confirm REFUND $X.XX)"
  - "CancelSubModal + CompSubModal (Pill quick-fill 1mo/3mo/6mo/Custom)"
  - "admin-stripe-actions.ts client wrapper with AdminStripeError discriminated union (stripe/forbidden/unauthorized/invalid/network/unknown)"
  - "Migration 20270601000019 — affiliate_conversions: ADD confirmed_at + reviewed_at + reviewed_by columns; extend status CHECK with 'on_hold'; extend audit_logs.action CHECK with 3 ADMIN-06 events"
  - "Three SECURITY DEFINER status-writer RPCs: admin_approve/hold/reject_affiliate_conversion — close Phase 19 BL-11 status-graph gap"
  - "AdminAffiliatesReviewQueue: 6-state filter Pill + 4 per-row actions + fraud-signal badges + row-expansion (3 sections: signals/payouts/audit)"
  - "AdminAffiliatesPage wrapper for plan 22-12 routing"
  - "affiliate-review.ts client wrapper with AffiliateReviewError discriminated union"
  - "ADMIN-04 + ADMIN-06 functional from /admin/members/{id} + /admin/affiliates"

affects:
  - 22-09 (impersonation banner — RefundModal/CancelSubModal will be inaccessible to impersonated sessions via the 51 deny-write RLS policies from plan 22-01)
  - 22-12 (App.tsx routing — must register /admin/affiliates → AdminAffiliatesPage; plan 22-12 also decides whether the new review queue replaces or supplements the Phase 19 read-only AdminAffiliatesScaffold at the same path)
  - 19-09 (monthly payout cron — newly-approvable conversions now flow through to transfers.create; BL-11 closed)

tech-stack:
  added: []
  patterns:
    - "Lazy-loaded admin Stripe-action modals via React.lazy + Suspense fallback null — keeps admin-bundle critical path tight (admin-bundle gz held at 14.53 kB; index gz 15.02 kB)"
    - "3-step gated destructive flow (Pick context → Configure → Typed-confirm) — RefundModal pattern is reusable for any future high-stakes admin action that needs charge+amount confirmation"
    - "typedConfirmMatchesRefund(typed, cents) — exact-match case-sensitive gate keyed off an amount string (REFUND $X.XX), generalizable for any amount-based destructive confirm"
    - "Status-writer RPCs with idempotency guard: SELECT … FOR UPDATE prev_status; return early on already-confirmed; raise on terminal-state (paid/rejected) — closes the status-machine ownership question per feedback_status_machine_transition_owner.md"
    - "Drop+re-add CHECK constraint idiom for both affiliate_conversions.status (added 'on_hold') and audit_logs.action (added 3 ADMIN-06 events) — preserves prior values verbatim per Phase 22-01 plan 22-01 File 02 precedent"
    - "Row-expansion lazy-load pattern: audit + payouts side-tables fetched only on first expand, memoized by row.id / affiliate_id to avoid re-fetch on collapse-then-expand"
    - "Discriminated client-error union (AdminStripeError + AffiliateReviewError) parsing Edge Fn JSON body via supabase-js `error.context.body` — surfaces the structured `{error:'<code>'}` shape that admin-stripe-action returns for non-2xx responses (Phase 22 plan 22-03 contract)"

key-files:
  created:
    - leanshot/src/components/admin/members/RefundModal.tsx
    - leanshot/src/components/admin/members/CancelSubModal.tsx
    - leanshot/src/components/admin/members/CompSubModal.tsx
    - leanshot/src/lib/admin/admin-stripe-actions.ts
    - leanshot/src/components/admin/AdminAffiliatesReviewQueue.tsx
    - leanshot/src/components/admin/pages/AdminAffiliatesPage.tsx
    - leanshot/src/lib/admin/affiliate-review.ts
    - leanshot/src/components/admin/__tests__/AdminAffiliatesReviewQueue.test.tsx
    - supabase/migrations/20270601000019_admin_affiliate_review_rpcs.sql
  modified:
    - leanshot/src/components/admin/members/__tests__/RefundModal.test.tsx (Wave 0 skip stubs → 9 GREEN tests + 2 modal smoke tests)
    - leanshot/src/components/admin/members/__tests__/MembersTable.test.tsx (assertion update for new MemberRowActions labels)
    - leanshot/src/components/admin/members/MemberStripeTab.tsx (accepts `charges` + `onOpenRefund` callback; placeholder text updated)
    - leanshot/src/components/admin/members/MemberBillingTab.tsx (selects `id`; adds Cancel/Comp action buttons calling `onOpenCancel` / `onOpenComp` props)
    - leanshot/src/components/admin/members/MemberRowActions.tsx (Refund/Cancel placeholders replaced with deep-links to ?tab=stripe / ?tab=billing)
    - leanshot/src/components/admin/pages/AdminMemberDetailPage.tsx (mounts 3 lazy modals behind Suspense; passes open-callbacks to tabs; header buttons route to relevant tab)

key-decisions:
  - "Lazy-load all 3 admin Stripe-action modals via React.lazy. Suspense fallback={null} so the modal pop has no flicker. Pattern mirrors Phase 19 admin-bundle manualChunks split + Phase 15 PageEditorView modal lazy-loading. Net effect: admin-bundle stays at 14.53 kB gz despite shipping ~28 kB of new modal+wrapper code."
  - "RefundModal mounted in AdminMemberDetailPage, NOT in MemberRowActions popover. Reason: a real refund needs a chosen charge from the user's last-90d charges list — that requires the stripe_charges materialization (deferred). For now MemberRowActions deep-links to ?tab=stripe where the per-charge Refund button opens the modal seeded with that charge. When the stripe_charges fetch ships, MemberStripeTab pulls the array and passes it through without UI rework."
  - "MemberRowActions stubs replaced with deep-links rather than direct modal invocations. The row-action popover lives in the table; modals need full member context (email, subscription_id, period_end, charge). Routing to the detail page is one less prop-drilling layer + matches how MemberStripeTab's per-charge Refund button works."
  - "Migration adds 'on_hold' to status CHECK (drop+re-add idiom), NOT a new column. 'on_hold' is operationally distinct from 'flagged' (admin-driven vs system-driven) but lives in the same enum-via-CHECK. Reduces schema surface and matches the existing pattern."
  - "All three new RPCs use SELECT … FOR UPDATE on the row before mutating. Idempotency: approving an already-confirmed row returns early as a no-op. Terminal-state guard: cannot approve a 'paid' row, cannot hold/reject a 'paid' row, cannot reject a 'paid' row (returns 22023 invalid_state). Hold cannot transition from 'rejected' either."
  - "Migration ALSO fixes 3 Phase 19 schema bugs surfaced by the implementation: confirmed_at, reviewed_at, reviewed_by were REFERENCED by migration 20270101000012 (the materialize cron) and by these new RPCs but never ADDed as columns. Without this fix the materialize cron would fail at every nightly tick with `column does not exist`. The ADDs use IF NOT EXISTS so they're idempotent against any future Phase 19 hot-fix."
  - "Migration applied LIVE to ytnsipxxmzgaebkqmokp via `supabase db push --linked --include-all` during plan execution. Verified post-apply via 3 `supabase db query --linked` checks: RPCs present (3/3), columns present (3/3), CHECK constraint contains 'on_hold' (verified the full ARRAY)."
  - "Pay out per-row button is intentionally a disabled tooltip-only stub (UI-SPEC line 273: cron-driven path). Approval is the only operator action required to trigger payout on the next monthly run. Surfacing a 'Pay out now' button would require an out-of-band Edge Fn invoke that competes with the cron, breaking idempotency."

patterns-established:
  - "Inner-rather-than-outer modal mount: lazy modals live in the page shell, NOT in the popover/row component that triggers them. Trigger calls `onOpenX(ctx)` to set parent state; modal reads context from props. Reusable pattern for any cross-tab admin action."
  - "Schema bug surfacing through implementation: when a downstream plan discovers that an upstream migration references a non-existent column, fix it in the new migration via IF NOT EXISTS ADD rather than back-editing the upstream migration. Preserves migration-as-immutable-history invariant."
  - "Lazy-loaded row-expansion side data: useState<Record<string, T[] | null>>; first expand sets entry to null (loading) then to data; subsequent expands of the same row read from the map without re-fetching. Generalizable to any drill-in surface."

requirements-completed: [ADMIN-04, ADMIN-06]

# Metrics
duration: ~75 min
completed: 2026-05-16
---

# Phase 22 Plan 07: Admin Stripe action modals + Affiliate review queue Summary

**3 lazy-loaded admin Stripe modals (ADMIN-04 Refund/Cancel/Comp) + the AdminAffiliatesReviewQueue with 3 SECURITY DEFINER status-writer RPCs (ADMIN-06) that close Phase 19 BL-11 status-graph gap. Also fixes 3 Phase 19 schema bugs (missing confirmed_at / reviewed_at / reviewed_by columns referenced by the materialize cron). All 18 new tests green; 112/112 admin tests pass; migration applied live to ytnsipxxmzgaebkqmokp.**

## Performance

- **Duration:** ~75 min
- **Started:** 2026-05-16T08:38Z (worktree HEAD reset)
- **Completed:** 2026-05-16T09:55Z (target)
- **Tasks:** 2/2 (both type=auto tdd=true)
- **Files created:** 9
- **Files modified:** 6
- **Tests added:** 18 (11 RefundModal/Cancel/Comp + 7 AdminAffiliatesReviewQueue)
- **Bundle index gz:** 15.02 kB (50 kB ceiling — held)
- **Admin chunk gz:** 14.53 kB (no regression — modals lazy-loaded)
- **Live infrastructure:** 1 migration applied (20270601000019) — 3 RPCs + 3 columns + 'on_hold' status verified

## Accomplishments

### Task 1 — ADMIN-04 admin Stripe action modals (commit `8ede706`)

- **RefundModal** ships the 3-step gated flow per UI-SPEC §Refund modal lines 370-388:
  1. Pick charge from `<Select>` populated by caller-passed last-90d charges; Continue disabled until selection.
  2. Amount input (max=charge.amount) + Pill quick-fill (Full / Half / Custom) + optional reason input (200-char cap); Continue disabled when amount exceeds charge.amount or is empty.
  3. Typed-confirm Input "Type REFUND $X.XX" — Submit enabled ONLY on exact-match case-sensitive (verified via the standalone `typedConfirmMatchesRefund(typed, cents)` helper test).
- On success: invokes `admin-stripe-action` Edge Fn (plan 22-03 contract) → toast "Refund of $X issued to {email}" → onSuccess(refundId) callback → modal resets + closes.
- On Stripe rejection: inline error per UI-SPEC line 680 ("Stripe rejected the refund: {code}. Try again or contact support."); modal stays open.
- Back button on step 2 preserves charge selection (verified by T6 test).
- Escape on step ≥ 2 prompts confirmation before close (UI-SPEC line 388).
- **CancelSubModal** wraps the Modal primitive directly (not ConfirmModal) so it can render inline Stripe error states. Body copy: "Cancel {email}'s subscription? They'll keep access until {period_end}." per UI-SPEC line 688.
- **CompSubModal** Pill quick-fill (1 month=30d / 3 months=90d / 6 months=180d / Custom→days input). Calls admin-stripe-action with operation:'comp' + comp_days.
- **admin-stripe-actions.ts** client wrapper exports 3 typed functions (refundCharge / cancelSubscription / compSubscription) wrapping `supabase.functions.invoke('admin-stripe-action', {body})` + AdminStripeError discriminated union (6 codes). Parses the Edge Fn structured `{error:'<code>'}` body via `error.context.body` (supabase-js attaches the raw body on non-2xx).
- **Wired into AdminMemberDetailPage**: modals lazy-loaded via React.lazy + Suspense(fallback=null). State captured per modal:
  - `refundCtx: RefundCharge | null` — opened from MemberStripeTab per-row Refund button.
  - `cancelCtx: {subscriptionId, periodEnd} | null` — opened from MemberBillingTab "Cancel subscription" button (reads sub.id + sub.current_period_end).
  - `compCtx: {subscriptionId} | null` — opened from MemberBillingTab "Grant comp" button.
- Header Refund/Cancel buttons route to the relevant tab (?tab=stripe / ?tab=billing) instead of opening modals directly (need full charge/subscription context).
- **MemberRowActions** stub items "Refund last charge" / "Cancel subscription" replaced with deep-links: `Refund a charge… → /admin/members/{id}?tab=stripe` and `Cancel subscription… → /admin/members/{id}?tab=billing`.

### Task 2 — ADMIN-06 affiliate review queue + status writers (commit `ba7611b`)

- **Migration 20270601000019** (applied live to ytnsipxxmzgaebkqmokp):
  - ADD `confirmed_at timestamptz`, `reviewed_at timestamptz`, `reviewed_by uuid references auth.users(id) on delete set null` columns to `public.affiliate_conversions` (IF NOT EXISTS — idempotent). **These columns were referenced by Phase 19 cron 20270101000012 but never added; the cron would fail at every tick once it ran in prod.** Schema bug fixed as deviation (Rule 3 blocking).
  - DROP + re-ADD `affiliate_conversions_status_check` to include `'on_hold'` (preserving prior 5 values verbatim).
  - DROP + re-ADD `audit_logs_action_check` to add 3 new ADMIN-06 events: `affiliate_conversion_approved`, `affiliate_conversion_held`, `affiliate_conversion_rejected`.
  - Three SECURITY DEFINER RPCs (admin_approve / admin_hold / admin_reject), each gated by `is_staff()` + `auth.uid()` null-check + SELECT … FOR UPDATE on the target row + `set_config('app.suppress_audit','true',true)` + explicit `audit_logs` INSERT.
- **AdminAffiliatesReviewQueue** ships:
  - 6-state segmented filter Pill (All / Pending / Flagged / Approved / Rejected / On hold) with per-state count Badge. Default filter is `flagged` (the most actionable state).
  - 4 per-row action buttons: Approve / Hold / Pay out (disabled, tooltip "Cron picks up confirmed rows on next monthly run" — UI-SPEC line 273) / Reject (window.prompt for reason).
  - Fraud-signal badges column (one warning-tone Badge per `fraud_signals` array entry).
  - Row-expansion inline panel with 3 sections: Fraud signals (full list), Payout history (last 5 payouts joined by affiliate_id), Audit log (last 10 audit_logs rows filtered to this conversion).
  - Lazy-loaded side data: audit + payouts fetched only on first expand, memoized by row.id / affiliate_id.
  - Row click toggles expansion; per-row action buttons stopPropagation so they don't expand the row.
  - is_staff client gate mirrors Phase 19 AdminAffiliatesScaffold pattern.
- **AdminAffiliatesPage** wraps the queue in AdminLayout(active='affiliates'); React.lazy-compatible default export ready for plan 22-12 routing.
- **affiliate-review.ts** client wrapper exports 3 typed functions wrapping `supabase.rpc(name, params)` + AffiliateReviewError discriminated union (6 codes including `invalid_state` for terminal-state guards).

### BL-11 status-graph closure verification (status writer ownership)

Per the feedback memory `feedback_status_machine_transition_owner.md` rule, every transition that a downstream plan filters on MUST have an owning plan+task. Plan 19-09's monthly payout cron filters `status = 'confirmed'`. The Phase 19 confirm cron only auto-confirms `fraud_signals IS NULL OR fraud_signals = '[]'`. Flagged rows had NO writer for `flagged → confirmed` before this plan.

**Closure: this plan owns the writer chain end-to-end.**

End-to-end flow (verified by inspection of cron 20270101000012 + RPC body):
1. fraud trigger (migration 20270101000008) sets `flagged_row.status = 'flagged'` + populates `fraud_signals`
2. operator opens `/admin/affiliates`, filters Flagged, clicks Approve
3. `admin_approve_affiliate_conversion` RPC writes `status='confirmed' + confirmed_at=now() + reviewed_by=v_caller + reviewed_at=now()`
4. next 00:30 UTC tick, the W-3 materialize cron picks up the confirmed row, inserts `payouts(... status='pending')`
5. next 1st-of-month 00:00 UTC tick, the AFF-06 monthly cron calls affiliate-payout Edge Fn → `stripe.transfers.create` → `payouts.status='paid'`

T8 in the test suite explicitly verifies step 3 (RPC name + params).

## Task Commits

1. **Task 1: admin Stripe action modals (ADMIN-04)** — `8ede706` (feat)
   - 4 new files + 6 modified; 11 tests added; 94/94 admin tests green
2. **Task 2: affiliate review queue + status writers (ADMIN-06)** — `ba7611b` (feat)
   - 5 new files; 1 migration applied live; 7 tests added; 112/112 admin tests green

## Verification

### Unit + RTL test results

```
Test Files  17 passed (17)         (admin scope)
     Tests  112 passed (112)
```

Specifically:
- `RefundModal.test.tsx` — 9 tests (3-step flow + Stripe error inline + Back preserves + helper)
- `RefundModal.test.tsx` CancelSubModal block — 1 smoke (confirm copy + RPC body)
- `RefundModal.test.tsx` CompSubModal block — 1 smoke (Pill quick-fill + comp_days=90)
- `AdminAffiliatesReviewQueue.test.tsx` — 7 tests (non-admin gate + 4 actions + Approve writes confirmed + row expand + filter swap + Pay out disabled + client-error map)

### Typecheck

```bash
cd leanshot && tsc -b --noEmit  # exit 0, no errors
```

### Bundle gate

```
dist/assets/index-DAQ5iaMw.js                 51.17 kB │ gzip:  15.02 kB
dist/assets/admin-bundle-DG40p-sv.js          51.27 kB │ gzip:  14.53 kB
```

Index gz 15.02 kB (50 kB ceiling). Admin-bundle 14.53 kB (no regression vs plan 22-06's 14.53 kB). New modal+wrapper code (~28 kB src) lazy-loaded.

### Live infrastructure (ytnsipxxmzgaebkqmokp)

Migration applied via `supabase db push --linked --include-all`. Verified via `supabase db query --linked`:

1. RPCs present (3/3):
   ```
   admin_approve_affiliate_conversion
   admin_hold_affiliate_conversion
   admin_reject_affiliate_conversion
   ```
2. Columns added (3/3): `confirmed_at`, `reviewed_at`, `reviewed_by`.
3. CHECK constraint contains `'on_hold'`:
   ```
   (status = ANY (ARRAY['pending'::text, 'confirmed'::text, 'flagged'::text, 'rejected'::text, 'paid'::text, 'on_hold'::text]))
   ```

## Decisions Made

(All extracted to frontmatter `key-decisions` for STATE.md harvest.)

The most load-bearing:
1. **Lazy-load all 3 admin Stripe modals.** Keeps admin-bundle gz at 14.53 kB despite shipping ~28 kB of new modal source. React.lazy + Suspense(fallback=null).
2. **RefundModal mounts in detail page, not row-actions popover.** Refund needs a chosen charge from the user's last-90d list. Per-row "Refund last charge" stub replaced with deep-link to ?tab=stripe.
3. **Migration ALSO fixes 3 Phase 19 schema bugs.** The materialize cron (20270101000012) references `confirmed_at` which never existed; the new RPCs would have hit the same column-not-exist trap. ADDed via IF NOT EXISTS so this migration is safe to re-run if the columns are added later by a hot-fix.
4. **All RPCs use SELECT … FOR UPDATE + idempotency guard.** Approving an already-confirmed row is a no-op return. Terminal-state guards (cannot approve paid / cannot hold paid|rejected / cannot reject paid) raise `22023 invalid_state`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Migration plan asked for `ALTER TYPE audit_action_type ADD VALUE` but audit_logs.action is a TEXT+CHECK column, not an enum**
- **Found during:** Task 2 migration authoring
- **Issue:** Plan body said: "Add via this migration's preamble: `ALTER TYPE public.audit_action_type ADD VALUE IF NOT EXISTS …`." But Phase 22-01 plan 22-01 file 02 already established (and the prior 20270601000002 migration confirms) that `audit_logs.action` is a TEXT column with a CHECK constraint, NOT an enum type. The ALTER TYPE approach would error with "type does not exist".
- **Fix:** Switched to the drop+re-add CHECK idiom that the entire Phase 8/9/10/22 audit-log enum extension lineage uses. Preserved all prior values verbatim (sourced from migration 20270601000002) + appended the 3 new ADMIN-06 events. Pitfall 3 (enum-add-in-same-tx) does not apply since CHECK extension is a single DDL statement.
- **Files modified:** supabase/migrations/20270601000019_admin_affiliate_review_rpcs.sql
- **Verification:** Migration applied live without error; CHECK constraint queried post-apply contains the 3 new events.
- **Committed in:** `ba7611b` (Task 2 commit)

**2. [Rule 1 - Bug, Phase 19 carry-over] affiliate_conversions.confirmed_at / reviewed_at / reviewed_by columns are referenced by Phase 19 migration 20270101000012 + my new RPCs but were never added by Phase 19**
- **Found during:** Task 2 migration authoring (cross-reference of cron body + RPC bodies)
- **Issue:** Phase 19 cron `affiliate-conversions-confirm` writes `UPDATE affiliate_conversions SET status='confirmed', confirmed_at=now() WHERE …`. The `confirmed_at` column was never added. When the cron actually fires in production it would fail with `column "confirmed_at" does not exist`. (The cron silently hadn't fired yet because — per Phase 19 SHIPPED memo — Vault `service_role_key` setup is deferred to v1.2 closeout; cron presence was verified but live-run wasn't.) Similar gap for `reviewed_at` + `reviewed_by` which would be needed by ADMIN-06 RPCs even if Phase 19 didn't notice.
- **Fix:** Added all 3 columns via `add column if not exists` in migration 20270601000019. Idempotent — safe if Phase 19 ships a hot-fix migration that also adds them.
- **Files modified:** supabase/migrations/20270601000019_admin_affiliate_review_rpcs.sql
- **Verification:** All 3 columns present in `information_schema.columns` post-migration (verified via supabase db query).
- **Committed in:** `ba7611b`

**3. [Rule 1 - Bug] MembersTable test asserts the old MemberRowActions labels**
- **Found during:** Task 1 admin test re-run (after MemberRowActions label change)
- **Issue:** Plan 22-06's MembersTable.test.tsx asserted the exact labels `'Refund last charge'` and `'Cancel subscription'`. After this plan replaced those with `'Refund a charge…'` and `'Cancel subscription…'` (deep-links), the test failed.
- **Fix:** Updated the expected-labels array in MembersTable.test.tsx to match the new labels. The test still validates the same 6-item order + presence.
- **Files modified:** leanshot/src/components/admin/members/__tests__/MembersTable.test.tsx
- **Committed in:** `8ede706`

---

**Total deviations:** 3 (all auto-fixed bugs — 1 migration approach correction + 2 carry-over schema/test fixes). No scope creep; all deviations were either inevitable schema corrections or test-assertion alignment.

## Known Stubs

| Stub | File | Reason | Owner |
|------|------|--------|-------|
| MemberStripeTab charges array defaults to `[]` | MemberStripeTab.tsx | stripe_charges materialization table not shipped in this plan (no migration); RefundModal opens only when a charge is passed. | v1.2 follow-up (separate plan) |
| MemberBillingTab payment-method card text-only | MemberBillingTab.tsx | per-user PM readout requires a separate Stripe API call (not shipped) | v1.3 follow-up |
| Phase 19 AdminAffiliatesScaffold (/admin/affiliates read-only applications list) still at the same route | AdminAffiliatesScaffold.tsx | Plan 22-12 owns App.tsx routing decisions — must choose whether ReviewQueue replaces or supplements Scaffold | plan 22-12 |
| Pay out per-row button disabled with tooltip | AdminAffiliatesReviewQueue.tsx | UI-SPEC line 273: payout owned by cron 19-09 (monthly transfer cron) | by design (UI-SPEC) |
| RefundModal Esc-on-step ≥ 2 uses `window.confirm` | RefundModal.tsx | The UI-SPEC line 388 says "prompt before close" — Modal primitive's dismissible path triggers; window.confirm() is the cheapest implementation. A styled confirmation dialog could be added later. | v1.3 polish |
| Reject reason captured via `window.prompt` | AdminAffiliatesReviewQueue.tsx | A styled reason-input modal would be nicer but adds another Modal mount; v1.2 captures via prompt and writes the trimmed string to audit_logs.metadata. | v1.3 polish |

All stubs are tracked here so the verifier sees the intentional partial completion; none prevent the plan's own goal of shipping the operator-facing modals + review queue.

## Issues Encountered

- **Vitest not on the worktree's PATH (worktree has no node_modules).** Per the established 22-06 pattern, tests run from `/Users/karstenhaldan/minisite/leanshot` after copying changed files there. Recovery is a `cp` cycle; main repo cleaned with `git checkout --` + `rm -f` before commit so only the worktree branch sees the new files.
- **`@/lib/supabase` mocking in tests requires the full chain.** AdminAffiliatesReviewQueue's data load uses three separate Supabase table queries (`profiles`, `affiliate_conversions`, plus on-expand `audit_logs` + `payouts`). The test mock had to expose all 4 table entry points. No production impact.
- **Phase 19 silent-cron-failure** (issue #2 in Deviations). Plan 22-07 is the first downstream consumer to actually exercise the `affiliate_conversions.confirmed_at` write path beyond simple inspection — the gap surfaced when I wrote the RPC body. Reusable lesson: when a future plan wires a referenced-but-not-defined column, ADD it idempotently rather than back-editing the upstream migration.

## Threat Flags

(No NEW threats beyond what plan 22-07's `<threat_model>` already covers — T-22-42 through T-22-46 all mitigated in code:)

| Threat ID | Mitigation In Code |
|-----------|--------------------|
| T-22-42 | RefundModal `amount > charge.amount` disables Continue; admin-stripe-action Edge Fn also enforces; Stripe API rejects natively (T2 test verifies first layer) |
| T-22-43 | Idempotency owned by Edge Fn `idempotencyKey: 'refund-<charge>-<amount_cents>'` — same args dedupe. Client wrapper does no caching of its own. |
| T-22-44 | All 3 status-writer RPCs `is_staff()`-gated server-side (Pattern S1 dual-layer); client gate UX-only. T1 test verifies non-staff cannot even READ the conversions table. |
| T-22-45 | BL-11 closed: cron 19-09 already filters `status='confirmed'` and the new admin_approve_affiliate_conversion RPC is its owning writer. End-to-end flow documented above + T3/T8 verifies. |
| T-22-46 | Pitfall 3 sqlstate trap does not apply since both CHECK extensions are single DDL statements (no ENUM type involved). |

**Carry-forward note:** the live `service_role_key` Vault secret (BL-7 from Phase 19) is still NOT loaded — the monthly payout cron will fail at its first 1st-of-month tick until that secret is set out-of-band via Dashboard. This is unchanged by plan 22-07; just calling it out so the next verifier knows the closeout chain has one more vendor pass remaining (per Phase 19 SHIPPED memo).

## User Setup Required

**None.** No new vendor pass required — Stripe SDK + admin-stripe-action Edge Fn ship in plan 22-03; affiliate ledger ships in Phase 19. Vault `service_role_key` for monthly payout cron is a Phase 19 carryover (already documented in the Phase 19 SHIPPED memo).

## Next Phase Readiness

- **Plan 22-09 (impersonation banner):** the 51 deny-write RLS policies from plan 22-01 already cover the affiliate_conversions update path (audit_logs.impersonator_id check). Refund + cancel + comp invocations from an impersonated session will be 403'd by the Edge Fn's is_staff re-check anyway (impersonated user sees their own is_staff, not the admin's). No additional changes needed.
- **Plan 22-12 (App.tsx routing):** must register `/admin/affiliates → AdminAffiliatesPage` (and decide whether to keep the Phase 19 `/admin/affiliates → AdminAffiliatesScaffold` alongside as `/admin/affiliates/applications` or replace outright). The default export of AdminAffiliatesPage is React.lazy-compatible.
- **Future v1.2 stripe_charges materialization:** when shipped, MemberStripeTab can drop the empty-state and pass `charges={charges}` + `onOpenRefund={(c) => setRefundCtx(c)}`. Zero changes needed in RefundModal or AdminMemberDetailPage.

## Self-Check: PASSED

**Created files exist (worktree):**
- FOUND: leanshot/src/components/admin/members/RefundModal.tsx
- FOUND: leanshot/src/components/admin/members/CancelSubModal.tsx
- FOUND: leanshot/src/components/admin/members/CompSubModal.tsx
- FOUND: leanshot/src/lib/admin/admin-stripe-actions.ts
- FOUND: leanshot/src/components/admin/AdminAffiliatesReviewQueue.tsx
- FOUND: leanshot/src/components/admin/pages/AdminAffiliatesPage.tsx
- FOUND: leanshot/src/lib/admin/affiliate-review.ts
- FOUND: leanshot/src/components/admin/__tests__/AdminAffiliatesReviewQueue.test.tsx
- FOUND: supabase/migrations/20270601000019_admin_affiliate_review_rpcs.sql

**Commits exist:**
- FOUND: 8ede706 (Task 1 — admin Stripe modals)
- FOUND: ba7611b (Task 2 — affiliate review queue + migration)

**Live verification:**
- FOUND on remote: admin_{approve,hold,reject}_affiliate_conversion RPCs
- FOUND on remote: affiliate_conversions.confirmed_at, reviewed_at, reviewed_by columns
- FOUND on remote: 'on_hold' added to affiliate_conversions_status_check CHECK constraint

---
*Phase: 22-owner-admin-lifecycle-email-dsar-cookie-consent*
*Plan: 07 — Admin Stripe action modals + Affiliate review queue (ADMIN-04 + ADMIN-06)*
*Completed: 2026-05-16*
