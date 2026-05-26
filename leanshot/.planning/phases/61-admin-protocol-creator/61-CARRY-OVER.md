# Phase 61 — Carry-Over

**Status:** Complete (autonomous-verify-only per `feedback_milestone_uat_deferral_consolidation` forward variant)
**Date:** 2026-05-26
**Plans shipped:** 8 / 8

## Per-Plan Push Status Matrix

| Plan | Migrations Created | Migrations Pushed (db push) | Fn Created | Fn Deployed |
|------|--------------------|-----------------------------|------------|-------------|
| 61-01 | 20290101000001 + 20290101000003 | ✅ Plan 08 | — | — |
| 61-02 | 20290101000002 | ✅ Plan 08 | — | — |
| 61-03 | — | — | protocol-ai-assist | ✅ Plan 08 |
| 61-04..07 | — | — | — | — |

> Note: migrations originally drafted as 20260526000001/2/3 — renamed forward to 20290101* per `reference_supabase_back_dated_migration_blocks_push` (Phase 60 cluster ended at 20281201000099, so new files must post-date that). `CREATE POLICY IF NOT EXISTS` syntax also stripped (unsupported on remote PG).

## Deferred to Phase 70 (HUMAN-UAT)

- **2-person review walkthrough**: requires a second admin account; cannot self-verify in single-user dev session. Test: Admin A submits draft → Admin B reviews + publishes (or rejects with `SELF_REVIEW_REJECTED` if Admin A attempts publish).
- **Clinician adopt → patient prefill end-to-end**: requires a clinician account + roster patient; Phase 70 will exercise the adopt flow against a live patient and verify MedicationTab Expected/Logged row appears next week.
- **KB shortcode in live article**: requires Phase 37 KB editor to insert `[protocol:<uuid>]` into an article body and verify inline ProtocolSummaryCard renders.
- **Public `/protocols/<slug>` route**: requires auth'd browser session; Phase 70 confirms `noindex` header present + 404 EmptyState for unpublished slugs.
- **AI-assist Suggest live call**: requires `OPENROUTER_API_KEY` set (already done in Phase 60.5) + admin draft + step row; Phase 70 verifies refusal flag triggers for non-RAG-cited responses + 50/day rate limit hard-caps at the 51st call.

## Deferred to Phase 63 (Tech Debt)

- **Layer 1 UPDATE-immutability** for `review_state='published'` rows. Current state allows direct UPDATE (RLS staff-only); UI flow uses INSERT-new-version. Future: add Postgres trigger preventing UPDATE on published rows except via SECDEF RPCs.
- **Org-scoping check** inside `assign_protocol_to_patient` RPC (currently trusts Phase 30 roster RLS).
- **Migration timestamp convention drift**: Phase 61 was authored with `20260526*` and renamed to `20290101*` at close-out. Future phases should draft with forward dates from the start (i.e., look at the latest applied remote migration and choose next-business-day timestamps).

## Carry-Over to Phase 67 (Operational Runbooks)

- Vendor secret audit for `OPENROUTER_API_KEY` — confirm Phase 60.5 set value is non-placeholder + has sufficient credit balance for the 50/day/admin allowance.
- Add Phase 61 surfaces to admin-action-token plan (currently no admin-token requirement; deferred).

## Sweep Results

- **tsc gate**: clean (`npx tsc -p tsconfig.app.json --noEmit` exits 0)
- **Phase 61 Vitest suites**: 12 files / 64 tests passed (admin/protocols + clinic/protocols + protocols + knowledge + markdown + hooks)
- **Edge Fn handler tests**: 6/6 passed (protocol-ai-assist RED→GREEN flow)
- **DB push**: 3 migrations applied to remote `ytnsipxxmzgaebkqmokp`
- **Fn deploy**: `protocol-ai-assist` status ACTIVE (deployed 2026-05-26 17:40 UTC)
