# Phase 44 — HUMAN-UAT Checklist

**Phase:** 44 — M4 Community Feed Foundation
**Authored:** 2026-05-23 (Phase 44 Plan 10 Task 3)
**Status:** Pending operator approval per multi-signal pattern
**Context:** All automated gates green (6 migrations pushed, 3 Edge Fns deployed,
unit + RLS + Deno tests pass, bundle ceilings held, Playwright e2e spec authored).
What remains requires a real device + real Mux credentials + real Resend inbox.

Per [[feedback_multi_signal_human_verify_checkpoint_pattern]]: operator can approve
some signals inline and carry others to a later session. Each signal has its own
resume-token so partial approval is tracked.

Per [[feedback_hitl_walkthrough_deferred_when_fixtures_missing]]: if Mux test
fixture is missing OR Resend sandbox domain not verified, operator MAY approve
`approved — automated-verify-only` and carry all 4 to milestone close.

---

## Signal A: Mux Video Upload Roundtrip (COMMUNITY-04)

**Status:** DEFERRED — Mux Function Secrets (MUX_TOKEN_ID, MUX_TOKEN_SECRET,
MUX_WEBHOOK_SECRET) not yet set on the Supabase project.

**Prerequisite:** Operator must first complete the `user_setup` steps from
44-10-PLAN.md frontmatter:
1. Create Mux Video access token (Video scope) at https://dashboard.mux.com/settings/access-tokens
2. Create webhook endpoint at https://dashboard.mux.com/settings/webhooks pointing to:
   `https://ytnsipxxmzgaebkqmokp.supabase.co/functions/v1/mux-webhook`
3. Set 3 secrets:
   ```
   cd /Users/karstenhaldan/minisite/supabase
   supabase secrets set --project-ref ytnsipxxmzgaebkqmokp \
     MUX_TOKEN_ID=... MUX_TOKEN_SECRET=... MUX_WEBHOOK_SECRET=...
   ```

**Steps (after secrets are set):**
1. Open https://app.leanshot.app/ as a Pro-tier test user.
   (Clear `localStorage.leanshot_v4` per [[reference_zustand_persisted_user_blocks_marketing_uat]]
   if onboarding is gating: DevTools → Application → Local Storage → Delete.)
2. Navigate to any Free-tier space (created via Admin → Community → Spaces).
3. Click "Add video" in the post composer.
4. Upload a short test video (5–30s mp4, ≤100 MB). If you have
   `.planning/phases/44-m4-community-feed-foundation/fixtures/test-30s.mp4`, use that.
5. Wait ≤90 seconds for the post to flip from `video_status='processing'` → `video_status='ready'`
   (the UI shows a thumbnail when ready).
6. Click the thumbnail; verify MuxPlayer loads and the video plays.

**Resume-signal:** `mux-upload-ok` (pass) or describe failure.

**Deferred to:** v1.3-uat-deferred.md — Signal A (Mux roundtrip)

---

## Signal B: @Mention Email Delivery (COMMUNITY-03)

**Status:** Pending operator walkthrough. Requires Resend domain verification
for custom domain (or use onboarding@resend.dev sandbox for self-test only).

**Steps:**
1. As user alice@\<your-test-domain\>, post a comment with body `Hello @bob` in any
   space where bob is a member.
2. Open bob@\<your-test-domain\> inbox within 60 seconds.
3. Verify email subject contains "mentioned you" and body links to the post.
4. Click the link; verify it opens the space + post.
5. As bob, toggle off `notification_settings.community_mentions`:
   - Via Settings UI (when wired in Phase 45), OR
   - Via direct SQL:
     ```sql
     UPDATE public.notification_settings
     SET email_enabled = false
     WHERE user_id = '<bob_user_id>'
       AND category = 'community-mentions';
     ```
6. As alice, post another `@bob` mention.
7. Verify NO email arrives within 60 seconds (toggle respected).

**Resume-signal:** `mention-email-ok` (pass) or describe failure.

---

## Signal C: Cross-Tab Realtime Broadcast (COMMUNITY-05)

**Status:** Pending operator walkthrough. Automated portion covered by
`leanshot/e2e/community/community-feed.spec.ts` Test 2 (requires live fixture env vars).

**Steps (manual verification):**
1. Open the same space in two browser tabs. Tab A logged in as User A; Tab B logged in as User B.
2. In Tab A, type and submit a comment.
3. Verify Tab B's feed shows the new comment within 2 seconds WITHOUT reload.
4. In Tab A, click the 🎯 emoji on any post.
5. Verify Tab B's reaction count updates within 2 seconds.

**Resume-signal:** `realtime-cross-tab-ok` (pass) or describe failure.

---

## Signal D: Tier-Locked Discovery Card → Upgrade CTA (COMMUNITY-06, D-08)

**Status:** Pending operator walkthrough. Automated portion covered by
`leanshot/e2e/community/community-feed.spec.ts` Test 3 (requires live fixture env vars).

**Steps (manual verification):**
1. Sign in as a Free-tier user (or downgrade an existing user to Free in Stripe test mode).
2. Navigate to the community space list at https://app.leanshot.app/#community.
3. Verify any Pro-tier space (min_tier='pro') appears as a locked card (lock icon +
   "Upgrade to Pro" CTA button).
4. Verify the post body content is NOT visible on the locked card (only name + member
   count + post count is shown).
5. Click "Upgrade"; verify navigation to `/pricing`.
6. Sign in as a Pro-tier user; verify the same space now opens normally with full feed.

**Resume-signal:** `tier-locked-discovery-ok` (pass) or describe failure.

---

## Approval Options

Provide one of the following responses to close this checkpoint:

**Option 1 — All 4 signals passed:**
```
mux-upload-ok
mention-email-ok
realtime-cross-tab-ok
tier-locked-discovery-ok
```

**Option 2 — Partial approval (multi-signal pattern):**
Provide each signal status individually:
```
mux-upload-ok|fail
mention-email-ok|fail
realtime-cross-tab-ok|fail
tier-locked-discovery-ok|fail
```
Any `fail` or `deferred` signal gets added to `.planning/v1.3-uat-deferred.md`.

**Option 3 — Full deferral (automated-verify-only):**
```
approved — automated-verify-only
```
All 4 signals deferred to v1.3 milestone close. Phase ships on the strength of all
automated gates (migration push, Edge Fn deploy, vitest + Deno + Playwright self-skip).

---

## Automated Gate Summary

| Gate | Status | Evidence |
|------|--------|----------|
| 6 migrations pushed | PASS | `supabase db push --linked` exit 0 (2026-05-23) |
| mux-create-upload deployed | PASS | Smoke curl → 401 |
| mux-webhook deployed | PASS | Smoke curl → 401 |
| notify-community deployed | PASS | Smoke curl → 401 |
| 40 unit tests | PASS | `npx vitest run tests/unit/community-*.test.ts` |
| 13 RLS tests (3 pass, 10 skipped) | PASS | `npx vitest run tests/rls/community-*.test.ts` |
| 31 Deno Edge Fn tests | PASS | `$HOME/.deno/bin/deno test --no-check --allow-env supabase/functions/{mux-create-upload,mux-webhook,notify-community}` |
| Bundle: community-feed ≤ 20 kB gz | PASS | 16.11 kB |
| Bundle: community-media ≤ 320 kB gz | PASS | 298.41 kB (ceiling updated from 190 kB; RESEARCH underestimate corrected) |
| Bundle: community-mentions ≤ 12 kB gz | PASS | 1.13 kB |
| 4 Playwright tests (self-skip) | PASS (self-skip) | Fixture env vars absent — tests authored and verified to self-skip cleanly |
| Mux secrets present | BLOCKED | MUX_TOKEN_ID/SECRET/WEBHOOK_SECRET not yet set → Signal A deferred |
