---
phase: 44
slug: m4-community-feed-foundation
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-05-23
---

# Phase 44 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 4.x (unit + integration); Playwright (e2e); Deno test (Edge Fn) |
| **Config file** | `vitest.config.ts`, `playwright.config.ts`, `supabase/functions/_test/` |
| **Quick run command** | `npm test -- src/components/community src/lib/community` |
| **Full suite command** | `npm test && npm run test:e2e -- --grep community && $HOME/.deno/bin/deno test --no-check supabase/functions/notify-community supabase/functions/mux-webhook` |
| **Estimated runtime** | ~180 seconds (quick ~25 s, full ~3 min) |

---

## Sampling Rate

- **After every task commit:** Run `npm test -- {plan-scoped path}` (quick)
- **After every plan wave:** Run full suite
- **Before `/gsd:verify-work`:** Full suite must be green + bundle budget check passes (`scripts/assert-bundle-budget.sh`)
- **Max feedback latency:** ≤30 seconds for quick; ≤180 seconds for full

---

## Per-Task Verification Map

> **Placeholder — planner (gsd-planner) populates this table from per-plan `<verify><automated>` blocks.** Each task in every PLAN.md MUST land here with its REQ-mapping (COMMUNITY-01..06), threat ref (T-44-XX), and automated command. Plan-checker Dimension 8 will reject the phase if any task lacks an entry or relies on a "Wave 0" stub that is not actually installed.

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 44-01-01 | 01 | 0 | — | — | Wave 0 — schema + RLS scaffolding | migration | `supabase db push --linked` | ⬜ planner-fills | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `supabase/migrations/<ts>_community_schema.sql` — `community_spaces`, `community_posts`, `community_comments`, `community_reactions`, `community_post_media`, `community_post_mentions`, `community_comment_mentions` tables + RLS policies
- [ ] `supabase/migrations/<ts>_notification_category_widen.sql` — **BLOCKER** per research §3.1: widen the 4 CHECK constraints in `notification_settings`, `notification_category_config`, `user_notifications`, `notification_dismissal_state` to include `community-mentions` + `community-replies`; seed 2 rows in `notification_category_config`
- [ ] `supabase/migrations/<ts>_community_storage_bucket.sql` — `community-media` Storage bucket + RLS (SELECT signed-only, INSERT mime+size, DELETE author-or-admin)
- [ ] `src/lib/community/dompurify-config.ts` — community-scoped policy forking helpdesk's, adding `FORBID_TAGS: ['img']`
- [ ] `src/test/community/fixtures.ts` — shared RLS-fixture helpers (cross-tenant impersonation per Phase 25 rule)
- [ ] `tests/e2e/community/` — Playwright project + addInitScript-style session seeding

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Mux video upload + adaptive HLS playback on a real device | COMMUNITY-04 | Mux upload requires a real test asset and a browser; automated CI doesn't carry the upload-key | (1) Sign in as Pro user, (2) Open a Free space, (3) Click "Post" → "Video", (4) Upload `.planning/phases/44-m4-community-feed-foundation/fixtures/test-30s.mp4`, (5) Wait ≤90s for `video_status='ready'`, (6) Verify player loads + scrubs |
| @mention email arrives in inbox | COMMUNITY-03 | Resend delivery is async; verifying receipt needs a real mailbox | (1) Post `@<test-handle>` from user A, (2) Confirm test-handle's inbox receives email within 30s, (3) Email body links to the post |
| Realtime broadcast across tabs | COMMUNITY-05 | Two-tab observation can't be automated reliably in CI | (1) Open space in Tab A + Tab B as different users, (2) Post in Tab A, (3) Tab B sees the post within 2s without refresh |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references (notification CHECK widening, dompurify fork, fixtures)
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s quick / < 180s full
- [ ] `nyquist_compliant: true` set in frontmatter (planner toggles after task map is complete)

**Approval:** pending
