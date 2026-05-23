---
phase: 45
slug: m4-community-spaces-member-directory-opt-in-dms-leaderboard
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-05-23
---

# Phase 45 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 4.x (unit + integration); Playwright (e2e); Deno test (Edge Fn) |
| **Config file** | `vitest.config.ts`, `vitest-e2e.config.ts`, `playwright.config.ts`, `supabase/functions/_test/` |
| **Quick run command** | `npm test -- src/components/community src/lib/community tests/rls/community-` |
| **Full suite command** | `npm test && npm run test:e2e:rls && PLAYWRIGHT_RUN_COMMUNITY=1 npx playwright test --project=community --grep '@phase45' && $HOME/.deno/bin/deno test --no-check supabase/functions/{dm-create-thread,community-admin-report-digest,notify-community}` |
| **Estimated runtime** | ~240 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npm test -- {plan-scoped path}` (quick)
- **After every plan wave:** Run full suite
- **Before `/gsd:verify-work`:** Full suite must be green + bundle budget check passes
- **Max feedback latency:** ≤30 seconds for quick; ≤240 seconds for full

---

## Per-Task Verification Map

> **Placeholder — planner (gsd-planner) populates this table from per-plan `<verify><automated>` blocks.** Every task ⇒ one row. Plan-checker Dim 8 rejects the phase if any task lacks an entry.

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 45-01-01 | 01 | 0 | — | — | Wave 0 — schema + RLS scaffolding | migration | `supabase db push --linked` (via Wave 3) | ⬜ Wave 0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `supabase/migrations/<ts>_p45_community_spaces_schema.sql` — `profiles` column additions (`directory_opt_in`, `dm_open`, `is_clinician_verified`, `show_tier_badge`, `show_streak_badge`, `bio`, `links jsonb`, `admin_digest_opt_in`, `community_last_active_at`, **`leaderboard_handle text` + `leaderboard_opt_in boolean` per RESEARCH critical correction #1 — Phase 35 did NOT create these as profile columns**); `dm_threads`, `direct_messages`, `dm_thread_audit`, `user_block_list`, `community_reports` tables; `community_spaces.leaderboard_enabled` column
- [ ] `supabase/migrations/<ts>_p45_community_rls.sql` — RLS on all new tables; cross-tenant clinic-org directory predicate (D-02 + Phase 28); symmetric block check on `dm_threads INSERT` via SECDEF helper; tier-gated leaderboard SELECT (Phase 44 D-08 mirror)
- [ ] `supabase/migrations/<ts>_p45_notification_community_dm.sql` — atomic widening of 4 CHECK constraints + `notification_category_config` UPSERT for `'community-dm'` + `'community-admin-report'` categories
- [ ] `supabase/migrations/<ts>_p45_dm_attachments_bucket.sql` — `dm-attachments` Storage bucket + RLS (SELECT signed-only + INSERT thread-participant via JOIN per RESEARCH #2 + DELETE author-or-admin)
- [ ] `supabase/migrations/<ts>_p45_leaderboard_matview.sql` — `community_space_leaderboard_matview` + cron consolidation into `phase35-leaderboard-refresh` (UNSCHEDULE + RE-REGISTER with both REFRESH calls per RESEARCH #3)
- [ ] `supabase/migrations/<ts>_p45_secdef_rpcs.sql` — `toggle_community_block`, `report_create_user` (auth.uid) + `report_create_admin` (param) per memory `feedback_rpc_auth_uid_vs_service_role_mismatch`, `admin_toggle_space_leaderboard`, `admin_set_clinician_verified`, `admin_toggle_report_digest_opt_in`, `update_community_last_active` (5-min debounce signal source)
- [ ] `tests/rls/community-directory-rls.test.ts` — cross-tenant clinic-org isolation proof
- [ ] `tests/rls/community-dm-rls.test.ts` — symmetric block + thread-participant access
- [ ] `tests/rls/community-reports-rls.test.ts` — write-only / staff read-via-digest
- [ ] `supabase/functions/_shared/email-templates/community-dm-new.ts` + `community-admin-report-digest.ts`

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| DM image attachment upload + signed-URL retrieval | COMMUNITY-08 | Storage RLS needs a real authed user; mock breaks cross-tenant proof | (1) Sign in as user A, (2) Open DM thread with user B, (3) Attach test.png ≤5 MB, (4) Send message, (5) User B sees image via fresh signed URL within 60-min TTL |
| @-mention email delivery (carry-over from Phase 44 — re-test with DM email path on same Resend channel) | COMMUNITY-08 | Resend delivery async; verifying receipt needs real mailbox | (1) Send DM from user A → user B with body "important update", (2) Confirm B's inbox receives email within 30s, (3) Email body contains first 80 chars + post URL |
| Web push notification on new DM | COMMUNITY-08 | Push requires HTTPS + push-enabled browser + real notification permission | (1) User B installs PWA + enables push, (2) User A sends DM, (3) B sees push notification within 5s with sender handle + body excerpt |
| Cross-tab realtime DM broadcast | COMMUNITY-08 | Two-tab observation can't be automated reliably | (1) Open DM inbox in tab A + tab B as same user, (2) User C sends DM, (3) Both tabs receive within 2s with no refresh |
| Tier-locked leaderboard upgrade card | COMMUNITY-09 | Tier RLS + UI gating needs full auth flow | (1) Sign in as Free user, (2) Open Pro-only space → see locked leaderboard card with "Upgrade to Pro" CTA → click → routes to /pricing |
| Admin verified-clinician toggle | COMMUNITY-07 | Admin staff RLS needs real `is_staff()` provisioning | (1) Sign in as admin (is_staff=true), (2) Open `/admin/community/profiles/{clinician_user_id}`, (3) Toggle verified-clinician, (4) Confirm clinician profile shows verified badge in directory |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references (leaderboard columns add, dompurify reuse fixture, dm-attachments bucket)
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s quick / < 240s full
- [ ] `nyquist_compliant: true` set in frontmatter (planner toggles after task map is complete)

**Approval:** pending
