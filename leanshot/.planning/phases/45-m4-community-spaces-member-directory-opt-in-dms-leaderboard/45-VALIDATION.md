---
phase: 45
slug: m4-community-spaces-member-directory-opt-in-dms-leaderboard
status: planned
nyquist_compliant: true
wave_0_complete: false
created: 2026-05-23
updated: 2026-05-23
---

# Phase 45 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 4.x (unit + integration); Playwright (e2e); Deno test (Edge Fn) |
| **Config file** | `vitest.config.ts`, `vitest-e2e.config.ts`, `playwright.config.ts`, per-fn `deno.json` |
| **Quick run command** | `cd leanshot && npm test -- --run src/components/community src/lib/community` |
| **Full suite command** | `cd leanshot && npm test -- --run && PLAYWRIGHT_RUN_COMMUNITY=1 npx playwright test --project=community --grep '@phase45' && $HOME/.deno/bin/deno test --no-check --allow-env supabase/functions/dm-create-thread/index.test.ts supabase/functions/community-admin-report-digest/index.test.ts supabase/functions/notify-community/index.test.ts` |
| **Estimated runtime** | ~240 seconds |

---

## Sampling Rate

- **After every task commit:** Run `cd leanshot && npm test -- --run {plan-scoped path}` (quick)
- **After every plan wave:** Run full suite
- **Before `/gsd:verify-work`:** Full suite must be green + bundle budget check passes
- **Max feedback latency:** ≤30 seconds for quick; ≤240 seconds for full

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 45-01-01 | 01 | 0 | COMMUNITY-07/08/09 | T-45-01 | Schema migration ships 13 net-new profiles cols (incl. handle + display_name net-new per Fix-D + live-DB pre-check) + 5 new tables + community_spaces.leaderboard_enabled + profiles_handle_unique partial index + handle CHECK | migration grep | `grep -c "ADD COLUMN" supabase/migrations/20270727000001_p45_schema.sql` ≥ 14 AND `grep -c "profiles_handle_unique" supabase/migrations/20270727000001_p45_schema.sql` == 1 AND `grep -c "profiles_handle_format" supabase/migrations/20270727000001_p45_schema.sql` == 1 | ❌ Wave 0 | ⬜ pending |
| 45-01-02 | 01 | 0 | COMMUNITY-07/08/09 | T-45-01, T-45-02, T-45-06 | RLS policies enforce two-mode + symmetric block; cross-tenant proof tests | migration grep + vitest | `grep -c "create policy" supabase/migrations/20270727000002_p45_rls.sql` ≥ 8 + `npm test -- --run tests/rls/community-*-rls.test.ts` | ❌ Wave 0 | ⬜ pending |
| 45-01-03 | 01 | 0 | COMMUNITY-07/08/09 | T-45-08 | 7 SECDEF RPCs ship without ON CONFLICT DO DELETE; is_staff() guards | migration grep | `grep -cE "create or replace function public\\.(toggle_community_block\\|community_report_create\\|admin_toggle_space_leaderboard\\|admin_set_clinician_verified\\|admin_toggle_report_digest_opt_in\\|update_community_last_active\\|get_community_space_leaderboard)" supabase/migrations/20270727000003_p45_secdef_rpcs.sql` == 7 | ❌ Wave 0 | ⬜ pending |
| 45-02-01 | 02 | 0 | COMMUNITY-08/09 | T-45-05 | Notification CHECK widening atomic | migration grep | `grep -c "'community-dm'" supabase/migrations/20270727000004_p45_notification_widening.sql` ≥ 5 AND `grep -c "begin;" ...` == 1 | ❌ Wave 0 | ⬜ pending |
| 45-02-02 | 02 | 0 | COMMUNITY-08/09 | T-45-05 | Email-router union extended; templates escapeHtml | file presence + grep | `test -f supabase/functions/_shared/email-templates/community-dm-new.ts && grep -c "community_dm_new" supabase/functions/_shared/email-router.ts` ≥ 3 | ❌ Wave 0 | ⬜ pending |
| 45-02-03 | 02 | 0 | COMMUNITY-08 | T-45-02 | notify-community handles dm_new; notification-send VALID_CATEGORIES extended | Deno test | `cd supabase/functions/notify-community && $HOME/.deno/bin/deno test --no-check --allow-env index.test.ts` exits 0 | ❌ Wave 0 | ⬜ pending |
| 45-03-01 | 03 | 0 | COMMUNITY-08 | T-45-03 | dm-attachments bucket + RLS uses dm_threads JOIN (NOT foldername=auth.uid) | migration grep | `grep -c "(storage.foldername(name))\\[1\\]::uuid" supabase/migrations/20270727000005_p45_dm_attachments_bucket.sql` ≥ 2 AND `grep -c "(storage.foldername(name))\\[1\\] = auth.uid()" ...` == 0 | ❌ Wave 0 | ⬜ pending |
| 45-03-02 | 03 | 0 | COMMUNITY-08 | T-45-03 | DM_ATTACHMENT_MAX_BYTES + getDmAttachmentSignedUrl exported | TS compile + grep | `cd leanshot && npx tsc -p tsconfig.app.json --noEmit && grep -c "getDmAttachmentSignedUrl" src/lib/community/community-storage.ts` ≥ 1 | ❌ Wave 0 | ⬜ pending |
| 45-04-01 | 04 | 1 | COMMUNITY-08 | T-45-02, T-45-04, T-45-05, T-45-06 | dm-create-thread Fn ships with rate-limit + block + clinician bypass + activity debounce | Deno self-check | `grep -c "rate_limited\\|clinician_bypass\\|blocked\\|dm_closed" supabase/functions/dm-create-thread/index.ts` ≥ 4 AND no `new DOMPurify` | ❌ Wave 0 | ⬜ pending |
| 45-04-02 | 04 | 1 | COMMUNITY-08 | T-45-02, T-45-04, T-45-06 | 7 Deno tests T1-T7 pass | Deno test | `$HOME/.deno/bin/deno test --no-check --allow-env supabase/functions/dm-create-thread/index.test.ts` | ❌ Wave 0 | ⬜ pending |
| 45-05-01 | 05 | 1 | COMMUNITY-09 | T-45-07 | Admin digest Fn service-role only; no auth.uid() | grep + Deno test | `grep -c "auth.uid()" supabase/functions/community-admin-report-digest/index.ts` == 0 AND `$HOME/.deno/bin/deno test ...` | ❌ Wave 0 | ⬜ pending |
| 45-05-02 | 05 | 1 | COMMUNITY-09 | — | Daily 9am UTC cron registered with vault pattern | migration grep | `grep -c "vault.decrypted_secrets" supabase/migrations/20270727000006_p45_admin_report_digest_cron.sql` ≥ 1 AND `grep -c "current_setting" ...` == 0 | ❌ Wave 0 | ⬜ pending |
| 45-06-01 | 06 | 1 | COMMUNITY-09 | T-45-15 | community_space_leaderboard_matview + UNIQUE index + consolidated cron (NO phase45-* cron) | migration grep | `grep -c "cron.schedule('phase35-leaderboard-refresh'" supabase/migrations/20270727000007_p45_leaderboard_matview.sql` == 1 AND `grep -cE "cron.schedule\\('phase45" ...` == 0 AND `grep -c "refresh materialized view concurrently" ...` ≥ 2 | ❌ Wave 0 | ⬜ pending |
| 45-07a-01 | 07a | 2 | COMMUNITY-07/08/09 | T-45-01 | Zustand sub-view dispatch (3-variant union 'directory' \| 'dm' \| null — NO 'space:<id>' or 'feed') + CommunityTabShell extension + use-dm-inbox-realtime hook | TS compile + grep | `cd leanshot && npx tsc -p tsconfig.app.json --noEmit && grep -c "activeCommunityView: 'directory' \| 'dm' \| null" src/lib/store.ts` ≥ 1 AND `grep -c "activeCommunityView" src/lib/store.ts` ≥ 4 AND `grep -c "'space:" src/lib/store.ts` == 0 | ❌ Wave 0 | ⬜ pending |
| 45-07a-02 | 07a | 2 | COMMUNITY-07/09 | T-45-05, T-45-15 | Directory + ProfileCard + LeaderboardChip + ReportButton ship; CommunityDirectoryView uses .from('profiles').select() NOT search_directory RPC; no new DOMPurify | TS compile + grep | `cd leanshot && npx tsc -p tsconfig.app.json --noEmit && grep -c "supabase.from('profiles').select(" src/components/community/CommunityDirectoryView.tsx` ≥ 1 AND `grep -c "search_directory" src/components/community/CommunityDirectoryView.tsx` == 0 AND `grep -rE "new DOMPurify\\(\|createDOMPurify\\(" src/components/community/CommunityDirectoryView.tsx src/components/community/ProfileCard.tsx src/components/community/LeaderboardChip.tsx src/components/community/ReportButton.tsx` returns 0 lines | ❌ Wave 0 | ⬜ pending |
| 45-07a-03 | 07a | 2 | COMMUNITY-07/08/09 | T-45-05 | CommunitySettingsTab ships 5 toggles (directory_opt_in, dm_open, show_tier_badge, show_streak_badge, leaderboard_opt_in); admin_digest_opt_in conditional on is_staff | TS compile + grep | `cd leanshot && npx tsc -p tsconfig.app.json --noEmit && grep -c "directory_opt_in\\|dm_open\\|show_tier_badge\\|show_streak_badge\\|leaderboard_opt_in" src/components/dashboard/settings/CommunitySettingsTab.tsx` ≥ 5 | ❌ Wave 0 | ⬜ pending |
| 45-07b-01 | 07b | 2 | COMMUNITY-08 | T-45-04, T-45-05 | DM inbox + thread (react-virtuoso virtualized) + composer + attachment uploader ship; bodies via Phase 44 dompurify (no new policy) | TS compile + grep | `cd leanshot && npx tsc -p tsconfig.app.json --noEmit && grep -c "react-virtuoso" src/components/community/dm/DMThreadView.tsx` ≥ 1 AND `grep -rE "new DOMPurify\\(\|createDOMPurify\\(" src/components/community/dm/` returns 0 lines | ❌ Wave 0 | ⬜ pending |
| 45-07b-02 | 07b | 2 | COMMUNITY-08 | T-45-04 | vite chunks community-directory + community-dm ordered BEFORE community-feed catch-all; bundle budget table extended | build + script | `cd leanshot && grep -n "community-directory\\|community-dm" vite.config.ts \| awk -F: '{print $1}' \| sort -n \| head -1 \| awk '($1 < 206)' && bash scripts/assert-bundle-budget.sh` chunk-ordering awk check passes | ❌ Wave 0 | ⬜ pending |
| 45-07b-03 | 07b | 2 | COMMUNITY-07/08 | T-45-04, T-45-05 | App.tsx wiring extends currentTab === 'community' branch with activeCommunityView dispatch; NO new TabId; NO `<Route>` syntax | TS compile + grep | `cd leanshot && npx tsc -p tsconfig.app.json --noEmit && grep -c "<Route path=\"/community" src/App.tsx` == 0 AND `grep -c "activeCommunityView" src/App.tsx` ≥ 1 | ❌ Wave 0 | ⬜ pending |
| 45-08-01 | 08 | 2 | COMMUNITY-07/09 | T-45-08, T-45-14 | Admin layout extended with pathname routing + URL-prefix catch-all in modules.ts | TS compile + grep | `cd leanshot && npx tsc -p tsconfig.app.json --noEmit && grep -c "startsWith.*'/admin/community'" src/admin/modules.ts` ≥ 1 | ❌ Wave 0 | ⬜ pending |
| 45-08-02 | 08 | 2 | COMMUNITY-07/09 | T-45-08, T-45-14 | 3 admin write surfaces use RPCs only (no direct table update) | TS compile + grep | `cd leanshot && npx tsc -p tsconfig.app.json --noEmit && grep -c "admin_set_clinician_verified\\|admin_toggle_report_digest_opt_in\\|admin_toggle_space_leaderboard" src/admin/modules/community/AdminCliniciansPage.tsx src/admin/modules/community/AdminReportsDigestPage.tsx src/admin/modules/community/SpaceEditor.tsx` ≥ 3 | ❌ Wave 0 | ⬜ pending |
| 45-09-01 | 09 | 3 | COMMUNITY-07/08/09 | T-45-CO1 | Pre-push validation passes (filenames + cross-Fn Deno sweep + bundle build + tsc noEmit) | composite | See `<automated>` in 45-09-PLAN.md Task 1 | ❌ Wave 0 | ⬜ pending |
| 45-09-02 | 09 | 3 | COMMUNITY-07/08/09 | T-45-CO1, T-45-CO2 | All 6 migrations pushed; 4 Fns deployed; live verification queries pass | HUMAN-action checkpoint | Operator confirms supabase db query --linked outputs | — | ⬜ pending |
| 45-09-03 | 09 | 3 | COMMUNITY-07/08/09 | — | 6 HUMAN-UAT signals A-F approved or explicitly deferred | HUMAN-verify checkpoint | Operator approval signal | — | ⬜ pending |
| 45-09-04 | 09 | 3 | — | — | 45-CARRY-OVER + 45-SUMMARY + ROADMAP flip | file checks + grep | `test -f .planning/phases/45-*/45-CARRY-OVER.md && test -f .planning/phases/45-*/45-SUMMARY.md && grep -q "^- \\[x\\] \\*\\*Phase 45:" .planning/ROADMAP.md` | — | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `supabase/migrations/20270727000001_p45_schema.sql` — 11 profiles cols (incl. leaderboard_handle + leaderboard_opt_in per RESEARCH correction) + 5 new tables + community_spaces.leaderboard_enabled
- [ ] `supabase/migrations/20270727000002_p45_rls.sql` — ≥8 RLS policies; two-mode directory; symmetric dm_threads block; is_staff() (not staff_users)
- [ ] `supabase/migrations/20270727000003_p45_secdef_rpcs.sql` — 7 SECDEF RPCs; no ON CONFLICT DO DELETE
- [ ] `supabase/migrations/20270727000004_p45_notification_widening.sql` — atomic 4 CHECK + 2 category_config UPSERT in one transaction
- [ ] `supabase/migrations/20270727000005_p45_dm_attachments_bucket.sql` — bucket + 3 RLS policies via dm_threads JOIN (NOT foldername=auth.uid)
- [ ] `supabase/migrations/20270727000006_p45_admin_report_digest_cron.sql` — daily 9am UTC vault pattern
- [ ] `supabase/migrations/20270727000007_p45_leaderboard_matview.sql` — matview + UNIQUE index + Phase 35 cron consolidation (UNSCHEDULE + RE-REGISTER, NO phase45-* cron)
- [ ] `tests/rls/community-directory-rls.test.ts` + `community-dm-rls.test.ts` + `community-reports-rls.test.ts` (file-scoped slug prefixes)
- [ ] `supabase/functions/_shared/email-templates/community-dm-new.ts` + `community-admin-report-digest.ts`

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| DM image attachment upload + signed-URL retrieval | COMMUNITY-08 | Storage RLS needs a real authed user; mock breaks cross-tenant proof | (1) Sign in as user A, (2) Open DM thread with user B, (3) Attach test.png ≤5 MB, (4) Send message, (5) User B sees image via fresh signed URL within 60-min TTL |
| @-mention email delivery (carry-over from Phase 44 re-test on DM path) | COMMUNITY-08 | Resend delivery async; verifying receipt needs real mailbox | (1) Send DM from user A → user B with body "important update", (2) Confirm B's inbox receives email within 30s, (3) Email body contains first 80 chars + post URL |
| Web push notification on new DM | COMMUNITY-08 | Push requires HTTPS + push-enabled browser + real notification permission | (1) User B installs PWA + enables push, (2) User A sends DM, (3) B sees push notification within 5s with sender handle + body excerpt |
| Cross-tab realtime DM broadcast | COMMUNITY-08 | Two-tab observation can't be automated reliably | (1) Open DM inbox in tab A + tab B as same user, (2) User C sends DM, (3) Both tabs receive within 2s with no refresh |
| Tier-locked leaderboard upgrade card | COMMUNITY-09 | Tier RLS + UI gating needs full auth flow | (1) Sign in as Free user, (2) Open Pro-only space → see locked leaderboard card with "Upgrade to Pro" CTA → click → routes to /pricing |
| Admin verified-clinician toggle | COMMUNITY-07 | Admin staff RLS needs real `is_staff()` provisioning | (1) Sign in as admin (is_staff=true), (2) Open `/admin/community/profiles`, (3) Toggle verified-clinician on a user, (4) Confirm profile shows verified badge in directory |

These map 1:1 to the 6-signal HUMAN-UAT checkpoint in 45-09 Task 3.

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies (per the Per-Task Verification Map above)
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references (leaderboard columns add, dompurify reuse fixture, dm-attachments bucket)
- [x] No watch-mode flags
- [x] Feedback latency < 30s quick / < 240s full
- [x] `nyquist_compliant: true` set in frontmatter (planner toggled after task map populated)

**Approval:** Approved by planner 2026-05-23.
