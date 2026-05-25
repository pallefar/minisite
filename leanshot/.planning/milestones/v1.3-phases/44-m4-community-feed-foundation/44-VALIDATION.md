---
phase: 44
slug: m4-community-feed-foundation
status: planning-complete
nyquist_compliant: true
wave_0_complete: true
created: 2026-05-23
updated: 2026-05-23
---

# Phase 44 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 4.x (unit + integration); Playwright (e2e); Deno test (Edge Fn) |
| **Config file** | `vitest.config.ts`, `vitest-e2e.config.ts`, `playwright.config.ts`, `supabase/functions/_test/` |
| **Quick run command** | `npm test -- src/components/community src/lib/community` |
| **Full suite command** | `npm test && npm run test:e2e:rls && PLAYWRIGHT_RUN_COMMUNITY=1 npx playwright test --project=community && $HOME/.deno/bin/deno test --no-check supabase/functions/{notify-community,mux-webhook,mux-create-upload}` |
| **Estimated runtime** | ~240 seconds (quick ~25 s, full ~4 min) |

---

## Sampling Rate

- **After every task commit:** Run `npm test -- {plan-scoped path}` (quick)
- **After every plan wave:** Run full suite
- **Before `/gsd:verify-work`:** Full suite must be green + bundle budget check passes (`scripts/assert-bundle-budget.sh`)
- **Max feedback latency:** ≤30 seconds for quick; ≤240 seconds for full

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 44-01-01 | 01 | 0 | COMMUNITY-01/02/06 | T-44-01, T-44-04, T-44-07 | 7 community tables + RLS (tier/org gating) + bucket + SECDEF reaction RPC | migration | `cd /Users/karstenhaldan/minisite && grep -l 'create table if not exists public.community_spaces' supabase/migrations/20270720000001_p44_community_schema.sql` | ⬜ Wave 0 | ⬜ pending |
| 44-01-02 | 01 | 0 | COMMUNITY-01/02/06 | T-44-01, T-44-01b | RLS tests: cross-tenant, tier-gate, reaction idempotency + is_staff() admin-policy proof (44-09 appends) | tsc | `cd /Users/karstenhaldan/minisite/leanshot && npx tsc --noEmit -p tsconfig.json` | ⬜ Wave 0 | ⬜ pending |
| 44-02-01 | 02 | 0 | COMMUNITY-03 | T-44-05, T-44-06 | Atomic 4-CHECK widening + email-router union + notification-send VALID_CATEGORIES | migration + tsc | `cd /Users/karstenhaldan/minisite && grep -c "'community-mentions'" supabase/migrations/20270720000004_p44_notification_community.sql supabase/functions/_shared/email-router.ts supabase/functions/notification-send/index.ts` | ⬜ Wave 0 | ⬜ pending |
| 44-03-01 | 03 | 0 | COMMUNITY-01/03 | T-44-05, T-44-06 | sanitizeCommunityMarkdown XSS defense + parseMentions code-fence stripping + tombstone render | vitest unit | `cd /Users/karstenhaldan/minisite/leanshot && npx vitest run tests/unit/community-dompurify-config.test.ts tests/unit/community-mention-parse.test.ts tests/unit/community-post-tombstone.test.ts -x` | ⬜ Wave 0 | ⬜ pending |
| 44-03-02 | 03 | 0 | COMMUNITY-04 | T-44-04, T-44-05 | tier-gate (trial=Pro) + community-storage (10-image cap + MIME whitelist) | vitest unit | `cd /Users/karstenhaldan/minisite/leanshot && npx vitest run tests/unit/community-image-cap.test.ts -x` | ⬜ Wave 0 | ⬜ pending |
| 44-04-01 | 04 | 1 | COMMUNITY-04 | T-44-02 | mux-create-upload tier gate (Free=403, Pro/Lifetime/Trial=200) + passthrough payload shape | Deno test | `cd /Users/karstenhaldan/minisite && $HOME/.deno/bin/deno test --no-check supabase/functions/mux-create-upload/index.test.ts` | ⬜ Wave 1 | ⬜ pending |
| 44-04-02 | 04 | 1 | COMMUNITY-04 | T-44-03, T-44-02b | mux-webhook HMAC verify + asset.ready/asset.errored handlers UPDATE filtered by `eq('id', passthrough.post_id)` (NOT mux_upload_id) | Deno test + grep | `cd /Users/karstenhaldan/minisite && grep -q "passthrough.post_id" supabase/functions/mux-webhook/index.ts && grep -q "\.eq('id'" supabase/functions/mux-webhook/index.ts && grep -q "\.update({" supabase/functions/mux-webhook/index.ts && grep -q "video_status" supabase/functions/mux-webhook/index.ts && (! grep -q "mux_upload_id" supabase/functions/mux-webhook/index.ts) && $HOME/.deno/bin/deno test --no-check supabase/functions/mux-webhook/index.test.ts` | ⬜ Wave 1 | ⬜ pending |
| 44-05-01 | 05 | 1 | COMMUNITY-03 | T-44-06, T-44-08, T-44-03b, T-44-01b | notify-community dual-auth (service-role OR user JWT with sub self-check) + fan-out + self-skip | Deno test | `cd /Users/karstenhaldan/minisite && $HOME/.deno/bin/deno test --no-check supabase/functions/notify-community/index.test.ts` | ⬜ Wave 1 | ⬜ pending |
| 44-05-02 | 05 | 1 | COMMUNITY-03/04 | T-44-08, T-44-02 | Integration: mention toggle respect + impersonation 403 + Mux Free 403 + Trial 200 | vitest e2e | `cd /Users/karstenhaldan/minisite/leanshot && npx vitest run tests/integration/community-mention-notification.test.ts tests/integration/mux-tier-gate.test.ts -x` | ⬜ Wave 1 (post-44-10 deploy) | ⬜ pending |
| 44-06-01 | 06 | 1 | COMMUNITY-01/02 | T-44-05 | CommunityPost (sanitize render + tombstone + edited marker) + CommentThread + ReactionBar (toggle RPC) + CommunityPostMediaStrip STUB | tsc | `cd /Users/karstenhaldan/minisite/leanshot && npx tsc --noEmit -p tsconfig.json` | ⬜ Wave 1 | ⬜ pending |
| 44-06-02 | 06 | 1 | COMMUNITY-01 | T-44-01 | CommunityFeed (cursor pagination + signed URL) + use-feed hook | tsc | `cd /Users/karstenhaldan/minisite/leanshot && npx tsc --noEmit -p tsconfig.json` | ⬜ Wave 1 | ⬜ pending |
| 44-07-01 | 07 | 1 | COMMUNITY-03 | T-44-06 | MentionTypeahead path-isolated under mentions/ for community-mentions chunk | tsc | `cd /Users/karstenhaldan/minisite/leanshot && ls src/components/community/mentions/MentionTypeahead.tsx && grep -c 'community-mentions' src/components/community/mentions/MentionTypeahead.tsx \| grep -v '^0$'` | ⬜ Wave 1 | ⬜ pending |
| 44-07-02 | 07 | 1 | COMMUNITY-01/03 | T-44-05, T-44-06 | Composer draft autosave + parseMentions + community_post_mentions upsert + notify-community fire | tsc | `cd /Users/karstenhaldan/minisite/leanshot && npx tsc --noEmit -p tsconfig.json` | ⬜ Wave 1 | ⬜ pending |
| 44-08-01 | 08 | 1 | COMMUNITY-04 | T-44-04, T-44-05 | CommunityImageUploader 10-cap + MIME whitelist; CommunityPostMediaStrip REPLACES 44-06 STUB with lazy player | tsc + grep | `cd /Users/karstenhaldan/minisite/leanshot && grep -q '@mux/mux-uploader-react' package.json && grep -q 'lazy(.*media/CommunityVideoPlayer' src/components/community/CommunityPostMediaStrip.tsx && grep -q 'Replaces 44-06 STUB\|Owner: Plan 44-08' src/components/community/CommunityPostMediaStrip.tsx` | ⬜ Wave 1 | ⬜ pending |
| 44-08-02 | 08 | 1 | COMMUNITY-04 | T-44-02 | CommunityMediaUploader tier-gated; CommunityVideoPlayer uses /lazy entry | tsc + grep | `cd /Users/karstenhaldan/minisite/leanshot && grep -q "@mux/mux-player-react/lazy" src/components/community/media/CommunityVideoPlayer.tsx && (! grep -r "from '@mux/mux-player-react'\"\\s*\$" src/components/community/)` | ⬜ Wave 1 | ⬜ pending |
| 44-09-01 | 09 | 2 | COMMUNITY-05/06 | T-44-01, T-44-06 | use-space-realtime + tier-gated SpaceList + SpaceView (Zustand setActiveCommunitySpace back-button) | tsc | `cd /Users/karstenhaldan/minisite/leanshot && npx tsc --noEmit -p tsconfig.json` | ⬜ Wave 2 | ⬜ pending |
| 44-09-02 | 09 | 2 | COMMUNITY-04/05/06 | T-44-05 | vite.config.ts sub-chunk rules (media + mentions BEFORE community-feed catch-all) + assert-bundle-budget ceilings | bundle grep | `cd /Users/karstenhaldan/minisite/leanshot && grep -q 'community-media' vite.config.ts && grep -q 'community-mentions' vite.config.ts && grep -c 'community-media\|community-mentions' scripts/assert-bundle-budget.sh \| grep -E '^[2-9]'` | ⬜ Wave 2 | ⬜ pending |
| 44-09-03 | 09 | 2 | COMMUNITY-05/06 | T-44-01b, T-44-01c | Consumer surface uses Zustand TabId (NOT react-router) + admin surface uses react-router + admin RLS migration pinned to public.is_staff() | tsc + grep | `cd /Users/karstenhaldan/minisite/leanshot && grep -q "'community'" src/types/index.ts && grep -q "currentTab === 'community'" src/App.tsx && grep -q "CommunityTabShell" src/App.tsx && (! grep -q "<Route path=\"/community" src/App.tsx) && (! grep -q "useNavigate(" src/App.tsx) && grep -q "activeCommunitySpaceId" src/lib/store.ts && ls src/admin/modules/community/SpaceEditor.tsx src/admin/modules/community/CommunityAdminLayout.tsx && cd /Users/karstenhaldan/minisite && grep -q "public.is_staff()" supabase/migrations/20270720000006_p44_community_spaces_admin_policies.sql && (! grep -q "staff_users" supabase/migrations/20270720000006_p44_community_spaces_admin_policies.sql) && cd /Users/karstenhaldan/minisite/leanshot && grep -q "is_staff" tests/rls/community-spaces-rls.test.ts` | ⬜ Wave 2 | ⬜ pending |
| 44-10-01 | 10 | 3 | ALL (01–06) | T-44-CLOSEOUT-01, T-44-CLOSEOUT-02 | BLOCKING: supabase db push + Edge Fn deploys + automated test sweep against live project | live | `cd /Users/karstenhaldan/minisite/supabase && supabase db push --linked --dry-run && supabase secrets list --project-ref ytnsipxxmzgaebkqmokp \| grep -cE '^(MUX_TOKEN_ID\|MUX_TOKEN_SECRET\|MUX_WEBHOOK_SECRET)\\b' \| grep '3'` | ✅ Wave 3 | ✅ green |
| 44-10-02 | 10 | 3 | ALL | T-44-05 | Bundle ceiling held (community-feed ≤20kB) + Playwright e2e cross-tab + XSS attempt | Playwright | `cd /Users/karstenhaldan/minisite/leanshot && bash scripts/assert-bundle-budget.sh dist/assets \| grep -E '^community-feed\\s+20\\s+[0-9.]+\\s+OK' && PLAYWRIGHT_RUN_COMMUNITY=1 npx playwright test --project=community --grep community` | ✅ Wave 3 | ✅ green |
| 44-10-03 | 10 | 3 | ALL | T-44-CLOSEOUT-03 | Multi-signal HUMAN-UAT: Mux roundtrip, mention email, cross-tab realtime, locked-card | HUMAN | `test -f .planning/phases/44-m4-community-feed-foundation/44-UAT.md` | ✅ Wave 3 | ✅ green |
| 44-10-04 | 10 | 3 | ALL | — | ROADMAP toggle + STATE.md closeout + VALIDATION nyquist toggle | doc | `cd /Users/karstenhaldan/minisite/leanshot && grep -q 'nyquist_compliant: true' .planning/phases/44-m4-community-feed-foundation/44-VALIDATION.md && grep -q '## Phase 44 closeout' .planning/STATE.md` | ✅ Wave 3 | ✅ green |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `supabase/migrations/20270720000001_p44_community_schema.sql` — 7 community tables + indexes + CHECK constraints (D-03 emoji, D-11 body cap)
- [ ] `supabase/migrations/20270720000002_p44_community_rls.sql` — RLS policies (cspace_select_*, cpost_select_tier, soft-delete filter)
- [ ] `supabase/migrations/20270720000003_p44_community_media_bucket.sql` — `community-media` Storage bucket + RLS (SELECT signed-only, INSERT path-prefix=auth.uid(), DELETE author-or-admin)
- [ ] `supabase/migrations/20270720000004_p44_notification_community.sql` — **BLOCKER** per research §3.1: widen the 4 CHECK constraints + seed 2 rows in `notification_category_config`
- [ ] `supabase/migrations/20270720000005_p44_community_secdef_rpcs.sql` — `toggle_community_reaction` SECDEF RPC (D-02 idempotent toggle)
- [ ] `supabase/migrations/20270720000006_p44_community_spaces_admin_policies.sql` — admin INSERT/UPDATE policies on community_spaces gated by `public.is_staff()` (44-09 follow-up; Fix-B iter-2 pin)
- [ ] `leanshot/src/lib/community/dompurify-config.ts` — community-scoped policy (forks helpdesk, adds FORBID_TAGS: ['img'])
- [ ] `leanshot/src/lib/community/community-types.ts` — shared TypeScript types (CommunityPost, CommunityComment, etc.)
- [ ] `leanshot/src/lib/community/community-storage.ts` — Storage upload + signed URL + 10-cap helper
- [ ] `leanshot/src/lib/community/tier-gate.ts` — readTierLabel + isVideoAllowed (trial = Pro) + canAccessSpace
- [ ] `leanshot/src/lib/community/mention-parse.ts` — /@([a-z0-9_]{3,30})\b/i + code-fence stripping
- [ ] `leanshot/tests/rls/community-spaces-rls.test.ts` — cross-tenant + global-space SELECT proofs + is_staff() admin write proof (44-09 appends 2 it() blocks)
- [ ] `leanshot/tests/rls/community-tier-gating-rls.test.ts` — Free/Pro/Trial vs min_tier='pro' space proofs
- [ ] `leanshot/tests/rls/community-reactions-rls.test.ts` — toggle_community_reaction idempotency proof
- [ ] `leanshot/tests/unit/community-{dompurify-config,mention-parse,post-tombstone,image-cap}.test.ts` — 4 unit suites

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Mux video upload + adaptive HLS playback on a real device | COMMUNITY-04 | Mux upload requires a real test asset and a browser; CI doesn't carry the upload-key | See 44-UAT.md Signal A (post 44-10 Task 3) |
| @mention email arrives in inbox | COMMUNITY-03 | Resend delivery is async; receipt needs a real mailbox | See 44-UAT.md Signal B |
| Realtime broadcast across tabs | COMMUNITY-05 | Two-tab observation in CI is brittle (Playwright multi-context covers most of it but real device is more credible) | See 44-UAT.md Signal C (Playwright covers automated portion in 44-10) |
| Tier-locked card → upgrade CTA roundtrip | COMMUNITY-06 / D-08 | Tier-effective transitions require manual tier toggle | See 44-UAT.md Signal D |

---

## Validation Sign-Off

- [ ] All tasks have `<verify><automated>` blocks (validated by gsd-sdk verify.plan-structure on 2026-05-23 → 10/10 plans valid)
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify (per-plan verify present in every task)
- [ ] Wave 0 covers all MISSING references (notification CHECK widening in 44-02; dompurify fork in 44-03; fixtures in 44-01 RLS tests)
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s quick / < 240s full
- [ ] iter-2 BLOCKERS resolved: Fix-A (44-04 key_links aligned) · Fix-B (44-09 admin RLS pinned to public.is_staff()) · Fix-C (44-09 consumer surface Zustand-only) · Fix-D (44-09 Task 2 split into vite + App) · Fix-E (44-06/44-08 stub-replacement coordination)
- [ ] `nyquist_compliant: true` set in frontmatter (planner toggles after task map is complete) — toggled by 44-10 Task 4

**Approval:** pending — flip on phase close-out
</content>
</invoke>
