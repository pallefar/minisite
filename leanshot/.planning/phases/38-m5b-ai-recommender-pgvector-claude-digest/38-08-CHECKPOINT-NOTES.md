# Phase 38 Plan 38-08 — HITL Admin Queue UX Verification

**Branch:** `worktree-agent-a6da34fdfa334114b`
**Status:** CHECKPOINT REACHED (Task 3 awaiting operator verification)

## What was built

HITL admin queue module plugged into Phase 24 admin shell at `/admin/hitl-queue`:

- **Single queue for all rec types** (recommender / digest / win_back) with filter pills (D-12).
- **Super-admin only** (D-14): RLS on `ai_suggestion_review` + manifest `minRole='superadmin'` (Pattern S1 dual-layer).
- **KB-sourced rows auto-approved** and shown as audit-only with no Approve/Reject/Edit (D-13).
- **Approve / Reject / Edit lifecycle:**
  - Approve digest → calls `supabase.rpc('hitl_decide', { decision: 'approved' })` then `supabase.functions.invoke('weekly-digest', { body: { hitl_release_row_id } })` to release the held email.
  - Reject → `decision='rejected'`; no release (held `weekly_digest_sends` row stays `pending_review`).
  - Edit → modal with editable narrative; `decision='edited' + edited_payload`; release path picks up the edited payload.
- **Bulk approve:** single RPC call with array of IDs.
- **Stale badge:** pending rows older than 7 days surface a warning.
- **PostHog event:** `digest.hitl_released` on successful release.

## Files shipped (Tasks 1 + 2)

- `leanshot/src/admin/modules/hitl-queue/HitlQueuePage.tsx`
- `leanshot/src/admin/modules/hitl-queue/HitlQueueRow.tsx`
- `leanshot/src/admin/modules/hitl-queue/HitlDecisionModal.tsx`
- `leanshot/src/admin/modules/hitl-queue/index.ts`
- `leanshot/src/admin/modules/hitl-queue/HitlQueuePage.test.tsx` — 8 RTL behaviors, all green.
- `leanshot/src/lib/admin/modules.ts` — manifest entry `key='hitl-queue'` (Rule 2 wiring).
- `leanshot/tests/e2e/hitl-queue.spec.ts` — 7 live-DB lifecycle behaviors (auto-skip without creds).
- `leanshot/vitest-e2e.config.ts` — include the new spec.
- `supabase/migrations/20270705000020_phase38_hitl_decision_rpc.sql` — `hitl_decide` RPC with super-admin gate.
- `supabase/functions/weekly-digest/index.ts` — new `handleHitlRelease` branch + serve handler dispatch.

## Deviations applied

| Rule | Type | What |
|------|------|------|
| Rule 1 | Bug — wrong helper symbol | The plan called `app.is_super_admin(auth.uid())` inside the RPC. That function does NOT exist on this project (confirmed against migrations + the Plan 38-01 RLS that uses an inline pattern). I substituted the canonical `EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_staff = true)` block — matches `ai_suggestion_review` RLS exactly. |
| Rule 2 | Required for reachability | Wired the module into `src/lib/admin/modules.ts` ADMIN_MODULES manifest. Without this, the route is unreachable and tested-but-dead (memory `admin-module-manifest-vs-router-branch-drift`). |
| Rule 2 | Required for reachability | Added `tests/e2e/hitl-queue.spec.ts` to `vitest-e2e.config.ts` include list. Without this, the spec never runs via `npm run test:e2e:rls`. |

No Rule 4 architectural questions. No auth gates encountered.

## Operator verification walkthrough

### 1. Local smoke (5 min)

```bash
cd /Users/karstenhaldan/minisite/leanshot
npm run dev
# Open http://localhost:5173/admin/hitl-queue
```

Sign in as a super-admin (`profiles.is_staff = true`). Expect:
- Filter pills: `All | recommender | digest | win_back` visible at the top.
- "0 pending" badge (or whatever the live count is) in the header.
- Empty-state copy when the queue is empty.

### 2. End-to-end against live Supabase (15 min)

Manual happy-path:

```bash
# Trigger a digest send to generate a pending row
supabase functions invoke weekly-digest --body '{"user_id":"<test-user-id>"}'
```

Then in the admin UI:

1. **Pending row appears within ~5s.** Click Approve.
2. Inspect `weekly_digest_sends`:
   ```sql
   select status, sent_at from weekly_digest_sends
   where user_id = '<test-user-id>'
   order by created_at desc limit 1;
   -- expect status='sent'
   ```
3. Repeat with **Reject** on a freshly-triggered pending row; verify `ai_suggestion_review.status='rejected'` AND `weekly_digest_sends.status='pending_review'` (no release).
4. Repeat with **Edit**: change narrative in modal, click Save & Approve. Verify `ai_suggestion_review.payload->>'narrative'` matches your edit and the held email is released.

### 3. Negative-path (RLS gate, 2 min)

Log out, log in as a non-super-admin (clinic admin / patient). Navigate to `/admin/hitl-queue`.

- Expect: empty list (RLS scopes out all rows) OR the admin shell's "not authorized" card (manifest `minRole='superadmin'`). Either is acceptable; both prove the gate.

### 4. KB audit-only (2 min)

Trigger a recommender call for a user whose recommendations are 100% KB-sourced (every `action.id = 'read_kb'`). Verify:

- A row lands in `ai_suggestion_review` with `status = 'auto_approved_kb'`.
- The HITL queue shows the row with a "KB audit — auto-approved" badge and NO Approve / Reject / Edit buttons (audit-only per D-13).

## Resume signal

Reply with `"approved"` to proceed to plan completion (SUMMARY.md + merge), or describe any issues found.
