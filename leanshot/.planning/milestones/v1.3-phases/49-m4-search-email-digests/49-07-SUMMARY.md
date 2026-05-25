---
phase: 49-m4-search-email-digests
plan: 07
subsystem: edge-functions
tags: [edge-function, email, digest, community, resend]
requires:
  - supabase/functions/_shared/lifecycle-utils.ts
  - supabase/functions/_shared/email-router.ts
  - supabase/functions/_shared/unsubscribe-token.ts
  - supabase/migrations/20271001000007_p49_digest_helper_rpcs.sql
  - supabase/migrations/20271001000004_p49_digest_send_log.sql
provides:
  - supabase/functions/community-weekly-digest/index.ts
  - supabase/functions/community-weekly-digest/deno.json
  - supabase/functions/community-weekly-digest/index.test.ts
  - supabase/functions/_shared/email-templates/community-weekly-digest.ts
affects:
  - supabase/functions/_shared/email-router.ts
tech-stack:
  added: []
  patterns:
    - "Lazy admin singleton via makeLazyAdmin() (setAdminForTest/resetAdminForTest test seam)"
    - "Promise.all over 3 SECDEF RPCs with explicit p_user_id (service-role caller, no auth.uid())"
    - "UPSERT onConflict 'user_id,kind,sent_date' for digest_send_log (kind='weekly')"
    - "RFC 8058 List-Unsubscribe + List-Unsubscribe-Post One-Click headers via SendEmailArgs.headers"
    - "Deno.serve guarded by COMMUNITY_WEEKLY_DIGEST_DISABLE_SERVE=1 to keep deno-test imports port-quiet"
    - "Email-router union extension + subjectFor switch arm + renderTemplate switch arm land in same commit (planner_missed_status_enum_widening)"
key-files:
  created:
    - supabase/functions/community-weekly-digest/index.ts
    - supabase/functions/community-weekly-digest/deno.json
    - supabase/functions/community-weekly-digest/index.test.ts
    - supabase/functions/_shared/email-templates/community-weekly-digest.ts
    - leanshot/.planning/phases/49-m4-search-email-digests/deferred-items.md
  modified:
    - supabase/functions/_shared/email-router.ts
decisions:
  - "Fork community-daily-digest verbatim; deltas only — 3 different RPCs, isEmpty over 3 weekly buckets, template name 'community_weekly_digest', opt-out category 'weekly_community_digest', disable-serve env var COMMUNITY_WEEKLY_DIGEST_DISABLE_SERVE, digest_send_log kind='weekly'."
  - "Same RFC 8058 List-Unsubscribe + List-Unsubscribe-Post One-Click headers as daily; same Resend headers path (router already widened by 49-06)."
  - "Weekly email template carries 3 sections in fork order: course progress (with inline progress bar), upcoming events (relative time + view link), community top 3 (space + score + truncated body). All user content HTML-escaped via local escapeHtml. Plaintext fallback provided in {html,text} return shape."
  - "Subject: 'Your LeanShot week ahead' — static phrasing so Gmail/Outlook thread the weekly series."
metrics:
  duration_minutes: ~25
  tasks_completed: 2
  files_created: 5
  files_modified: 1
  commits: 2
  completed: 2026-05-24
---

# Phase 49 Plan 49-07: community-weekly-digest Edge Fn Summary

Per-user weekly community digest Edge Function shipped — near-identical structure to Plan 49-06 daily; deltas = 3 weekly bucket RPCs, opt-out category `weekly_community_digest`, kind `weekly`, disable-serve env var, plus the email-router union extension that wires `community_weekly_digest` into `subjectFor` + `renderTemplate`.

## What landed

- **`supabase/functions/community-weekly-digest/index.ts`** — production Edge Fn with the 9-step lifecycle (auth → body → `Promise.all` 3 SECDEF RPCs → empty-skip → opt-out check → fetch email via `auth.admin.getUserById` → mint 90-day unsubscribe token → `sendEmail({template:'community_weekly_digest', phi:false, headers:{List-Unsubscribe, List-Unsubscribe-Post:One-Click}})` → `digest_send_log` UPSERT with `kind='weekly'`).
- **`supabase/functions/community-weekly-digest/deno.json`** — per-Fn import map (mirror of `community-daily-digest/deno.json`) so `supabase functions deploy` resolves `npm:@supabase/supabase-js@2` without depending on the now-ignored `--import-map` flag (per `reference_supabase_functions_deploy_import_map_flag`).
- **`supabase/functions/_shared/email-templates/community-weekly-digest.ts`** — `subject()` + `render(vars) → {html,text}`. 3 sections: course progress (inline-styled progress bar), upcoming events (relative time `in Xh` / `tomorrow` / `in Xd`), community top 3 (space + score + truncated body). All user content HTML-escaped; visible unsubscribe link in footer.
- **`supabase/functions/_shared/email-router.ts`** — additive EXTEND. Added: union member `'community_weekly_digest'`, `import * as communityWeeklyDigest`, `subjectFor` switch case, `renderTemplate` switch case (returns `rendered.html`). All other arms untouched. Same-commit shipping per `feedback_planner_missed_status_enum_widening`.
- **`supabase/functions/community-weekly-digest/index.test.ts`** — 4 Deno tests (empty-skip, opt-out, sent-via-stub, Deno.serve-guard). `COMMUNITY_WEEKLY_DIGEST_DISABLE_SERVE=1` set BEFORE import per `reference_deno_test_top_level_serve_trap`. **All 4/4 pass locally** via `deno test --no-check --allow-all supabase/functions/community-weekly-digest/`.

## Tasks completed

| Task | Name                                                              | Commit     | Files                                                                                                                                                                            |
| ---- | ----------------------------------------------------------------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | community-weekly-digest Edge Fn + deno.json + email template      | `c0c22edc` | `supabase/functions/community-weekly-digest/{index.ts,deno.json}`, `supabase/functions/_shared/email-templates/community-weekly-digest.ts`                                        |
| 2    | email-router.ts EXTEND + community-weekly-digest test scaffold    | `2fcad77d` | `supabase/functions/_shared/email-router.ts`, `supabase/functions/community-weekly-digest/index.test.ts`, `leanshot/.planning/phases/49-m4-search-email-digests/deferred-items.md` |

## Verification

- **5 files present** at git-root-relative paths matching `<files_modified>` (4 net-new + 1 EXTEND).
- **Acceptance grep gates** — all 13 PASS:
  - `COMMUNITY_WEEKLY_DIGEST_DISABLE_SERVE` in Fn: 2 (≥1).
  - `phi: false` in Fn: 2 (≥1). `phi: true` in Fn: 0 (==0).
  - `digest_course_progress_delta_7d` / `digest_upcoming_events_7d_rsvpd` / `digest_community_top3_7d` each in Fn: 2 (≥1).
  - `List-Unsubscribe-Post` in Fn: 2 (≥1).
  - `weekly_community_digest` in Fn: 4 (≥2 — category + token + body).
  - `community_weekly_digest` in router: 3 (≥1). `community_daily_digest` in router: 3 (≥1).
  - `Deno.test` in test file: 6 (≥4 — 4 test blocks + 2 narrative mentions).
- **Deno type-check** — `deno check supabase/functions/community-weekly-digest/index.ts` reports **0 errors** after the email-router union widening landed in Task 2.
- **Deno test sweep** — `deno test --no-check --allow-all supabase/functions/community-weekly-digest/` reports **4 passed | 0 failed**.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 — Bug] Inverted opt-out logic in copy-forward test fake**
- **Found during:** Task 2 (first deno test sweep on the new weekly scaffold).
- **Issue:** The test fake builder forked verbatim from `community-daily-digest/index.test.ts` returned `enabled: cfg.optOut === false ? false : true`, which is the inverse of intent. When `cfg.optOut=true` (user opted out), the fake returned `enabled: true` (opted-IN) → T2 failed expecting `skipped:opted_out` but got `sent`; T3 failed mirror-image.
- **Fix:** Changed the fake to `enabled: cfg.optOut !== true` in the weekly test file (only — the daily test file is pre-existing on `main` and out of scope; logged as D-49-DEFERRED-01 in `deferred-items.md`).
- **Files modified:** `supabase/functions/community-weekly-digest/index.test.ts`.
- **Commit:** `2fcad77d`.

### Deferred Issues

**D-49-DEFERRED-01** — pre-existing inverted-fake bug in `supabase/functions/community-daily-digest/index.test.ts` (T2 + T3 of the daily test scaffold currently fail with the same inversion). Out of scope for 49-07. Logged in `leanshot/.planning/phases/49-m4-search-email-digests/deferred-items.md` for Phase 49 close-out or a Plan 49-06 fast-follow. Production logic unaffected (only the fixture is wrong).

## Authentication Gates

None — autonomous execution.

## Threat Flags

None — surface 1:1 mirrors Plan 49-06 (cron→Edge Fn service-role, non-PHI Resend, HTML-escape on user content). All `<threat_model>` dispositions (`T-49-18` info-disclosure mitigated by SECDEF RPCs taking `p_user_id`; `T-49-19` XSS mitigated by `escapeHtml` over all user-content; `T-49-20` Phase 38 coexistence accepted) materialised as planned.

## Cross-cutting wiring (informational; owned by other plans)

- **Cron schedule (Plan 49-05)** — `community-weekly-digest` hourly job at `'15 * * * *'`, migration `20271001000008_...` — already shipped on `main`. The cron passes `service_role` bearer + `{ user_id }` body shape matching this Fn's contract.
- **Unsubscribe token (Plan 49-08)** — `UnsubscribeCategory` union already includes `'weekly_community_digest'` (`supabase/functions/_shared/unsubscribe-token.ts:38`); `mintUnsubscribeToken` works against it.
- **Helper RPCs (Plan 49-04)** — all 3 weekly SECDEF RPCs shipped in `supabase/migrations/20271001000007_p49_digest_helper_rpcs.sql` with `grant execute … to service_role` (returns checked against actual SQL signatures: `course_id, course_title, completed_this_week, total_lessons, percent_complete` / `event_id, title, start_at` / `post_id, space_id, space_name, body, score, author_id`).
- **Deploy (Wave 3 close-out)** — `supabase functions deploy community-weekly-digest` is NOT run by this plan; it's owned by the Wave 3 close-out plan per phase orchestration.
- **Function Secrets** — `UNSUBSCRIBE_SECRET` already provisioned for Plan 49-06 / 49-08; same secret unlocks weekly. Resend env vars (`RESEND_API_KEY`, `RESEND_FROM_EMAIL`) reuse the existing project secrets.

## Self-Check: PASSED

- `supabase/functions/community-weekly-digest/index.ts` — FOUND
- `supabase/functions/community-weekly-digest/deno.json` — FOUND
- `supabase/functions/community-weekly-digest/index.test.ts` — FOUND
- `supabase/functions/_shared/email-templates/community-weekly-digest.ts` — FOUND
- `supabase/functions/_shared/email-router.ts` — present (modified in `2fcad77d`)
- `leanshot/.planning/phases/49-m4-search-email-digests/deferred-items.md` — FOUND
- Commit `c0c22edc` — FOUND (Task 1)
- Commit `2fcad77d` — FOUND (Task 2)
- Deno tests `4 passed | 0 failed` on `supabase/functions/community-weekly-digest/`.
