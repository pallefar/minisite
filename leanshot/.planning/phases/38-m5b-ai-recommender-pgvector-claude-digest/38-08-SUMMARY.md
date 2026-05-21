---
phase: 38-m5b-ai-recommender-pgvector-claude-digest
plan: 08
type: execute-summary
status: complete
completed: 2026-05-21
checkpoint_resolution: approved-automated-verify-only
---

# Plan 38-08 — Summary

HITL admin queue: single queue for digest/recommender/winback rec types with filter pills (D-12); super-admin-only RLS (D-14); KB-sourced auto-approved rows shown as audit-only (D-13); approve/reject/edit workflow drives weekly-digest release callback.

## Tasks complete

| Task | Commit | Description |
|---|---|---|
| 1 (RED) | `58f8f17` | RPC migration `20270705000020_phase38_hitl_decision_rpc.sql` + failing RTL tests |
| 1 (GREEN) | `77b7fcc` | HitlQueuePage / HitlQueueRow / HitlDecisionModal + admin manifest + weekly-digest HITL release branch |
| 2 | `d2ee07d` | e2e HITL lifecycle (7 behaviors): kb-audit / approve+release / reject / edit / RLS / bulk |
| 3 | `6200c45` | Operator checkpoint walkthrough notes |
| close | — | Resolution: approved-automated-verify-only (per 34-08 disposition pattern; see CHECKPOINT-NOTES) |

## Files modified

- `leanshot/src/admin/modules/hitl-queue/HitlQueuePage.tsx`
- `leanshot/src/admin/modules/hitl-queue/HitlQueueRow.tsx`
- `leanshot/src/admin/modules/hitl-queue/HitlDecisionModal.tsx`
- `leanshot/src/admin/modules/hitl-queue/index.ts`
- `leanshot/src/admin/modules/hitl-queue/HitlQueuePage.test.tsx` — 8 RTL behaviors
- `leanshot/src/lib/admin/modules.ts` — added `key: 'hitl-queue'` entry (per [[admin-module-manifest-vs-router-branch-drift]])
- `supabase/migrations/20270705000020_phase38_hitl_decision_rpc.sql` — `hitl_decide` SECDEF RPC with inline `EXISTS … is_staff=true` super-admin gate (per [[planner-iter1-anti-patterns]])
- `supabase/functions/weekly-digest/index.ts` — added HITL-approved release branch (validates payload, sends Resend email, transitions held `weekly_digest_sends` row → `sent`, emits `digest.hitl_released` PostHog event)
- `leanshot/tests/e2e/hitl-queue.spec.ts` — 7 live-DB behaviors
- `leanshot/vitest-e2e.config.ts` — added e2e spec to include list

## Notable deviations

- **RPC super-admin gate inline.** Plan called `app.is_super_admin(auth.uid())` but that function doesn't exist on this project. Substituted canonical `EXISTS (SELECT 1 FROM public.profiles WHERE id=auth.uid() AND is_staff=true)` block to match Plan 38-01 RLS exactly.
- **Admin manifest entry wired.** Added `'hitl-queue'` to `src/lib/admin/modules.ts` ADMIN_MODULES per [[admin-module-manifest-vs-router-branch-drift]] — without this the route is unreachable.
- **e2e spec config wired.** Added `tests/e2e/hitl-queue.spec.ts` to `vitest-e2e.config.ts` include list.

## Verification

- `tsc -p tsconfig.app.json --noEmit` — clean
- 8/8 RTL tests pass
- AdminShell regression: 5/5 pass after manifest insertion
- 7 e2e behaviors written (skip-clean locally without SUPABASE staging creds; CI exercises when creds present)

## Checkpoint resolution

Manual UX walkthrough deferred per operator decision (`2026-05-21`). Same disposition as Phase 34-08 — local dev lacks superadmin fixtures + OAuth call-site wiring. All automated gates passed. Re-tests at staging when fixture seeding lands. See `34-CARRY-OVER.md` for milestone-close audit list.

## Cross-plan integration

- `weekly-digest/index.ts` modification preserves 38-05's 11-step lifecycle; adds new branch for HITL-approved rows (no refactor of existing path).
- `ai_suggestion_review` table created by 38-01; HITL admin queue is the canonical reader/writer.
- `hitl_decide` RPC migration `20270705000020` runs after 38-05's weekly-digest deployment.

## Requirements coverage

RECOMMEND-07 (HITL admin queue) — covered.
