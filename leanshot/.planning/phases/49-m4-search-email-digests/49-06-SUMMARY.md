---
phase: 49-m4-search-email-digests
plan: 06
subsystem: email-digests
tags: [edge-function, digest, email, daily, resend, cron, secdef-rpc, rfc-8058]
requires: [49-03, 49-04, 49-05, 49-08]
provides:
  - "community-daily-digest Edge Fn (POST, service-role-bearer authed)"
  - "community_daily_digest email template (subject + render)"
  - "email-router headers pass-through (RFC 8058)"
affects:
  - "supabase/functions/_shared/email-router.ts (union + switch arms widened; SendEmailArgs.headers optional)"
  - "supabase/functions/_shared/lifecycle-send.ts (ResendSendInput.headers optional pass-through)"
tech-stack:
  added: []
  patterns:
    - "PATTERNS.md Pattern G: Edge-Fn forking weekly-digest structure (drop Anthropic/BAA/HITL/dedup)"
    - "reference_deno_test_top_level_serve_trap: COMMUNITY_DAILY_DIGEST_DISABLE_SERVE env guard on Deno.serve"
    - "reference_supabase_functions_deploy_import_map_flag: per-Fn deno.json"
    - "feedback_rpc_auth_uid_vs_service_role_mismatch: explicit p_user_id arg, no session predicate"
    - "feedback_state_counter_table_needs_upsert_on_event: digest_send_log UPSERT onConflict user_id,kind,sent_date"
    - "feedback_planner_missed_status_enum_widening: union + subjectFor + renderTemplate in same commit"
key-files:
  created:
    - "supabase/functions/community-daily-digest/index.ts"
    - "supabase/functions/community-daily-digest/deno.json"
    - "supabase/functions/community-daily-digest/index.test.ts"
    - "supabase/functions/_shared/email-templates/community-daily-digest.ts"
  modified:
    - "supabase/functions/_shared/email-router.ts (Rule 2 widening: community_daily_digest template + optional headers field)"
    - "supabase/functions/_shared/lifecycle-send.ts (Rule 2 widening: ResendSendInput.headers pass-through)"
decisions:
  - "Used Resend (non-PHI) path: community content is non-PHI per CONTEXT D-04, so phi:false routes via Resend (existing wiring)."
  - "Empty-content short-circuit returns 200 + UPSERT skipped:no-content; the cron sees success and the audit row proves no email was sent."
  - "Opt-out check falls through to opt-IN on missing notification_settings row (D-19 default), matching Phase 47 reminder Fn behavior."
  - "Unsubscribe URL exp=90 days because users archive then revisit older digests; shorter exp would break valid opt-out attempts."
  - "Rule 2 widening of email-router + lifecycle-send to forward optional headers — RFC 8058 List-Unsubscribe headers are a Gmail bulk-sender hard requirement and both 49-06 and 49-07 (parallel wave) need them; landed once instead of in both Fns."
metrics:
  duration: "~30 minutes"
  completed: "2026-05-24"
  tasks_completed: 2
  files_created: 4
  files_modified: 2
  commits: 2
---

# Phase 49 Plan 06: community-daily-digest Edge Fn Summary

One-liner: Per-user daily community digest Edge Function — POST endpoint, service-role-bearer authed, Promise.all on 3 SECDEF helper RPCs, idempotent `digest_send_log` UPSERT, RFC 8058 unsubscribe headers via Resend.

## What was built

Four new files under the `supabase/functions/community-daily-digest/` and `supabase/functions/_shared/email-templates/` directories, plus additive widening of the shared email router and Resend send helper.

### `supabase/functions/community-daily-digest/index.ts`

Production Edge Fn forking the Phase 38 `weekly-digest/index.ts` structure but stripped of the Anthropic / BAA / HITL / 6h-dedup branches that don't apply to non-PHI community digests:

- POST-only endpoint; 405 on other methods.
- `checkServiceRoleBearer` from `_shared/lifecycle-utils.ts` validates the bearer (handles the new `sb_secret_*` token format per memory `reference_supabase_service_role_key_format_divergence`); 401 on mismatch.
- Body shape `{ user_id: string }`; 400 on missing.
- `computeDailyDigest(supabase, userId)` calls 3 SECDEF helper RPCs concurrently via `Promise.all`:
  - `digest_top_posts_in_spaces(p_user_id)` — top 5 posts in user's spaces, last 24h.
  - `digest_new_comments_on_my_posts(p_user_id)` — new comments on user's own posts, last 24h, excluding self-comments.
  - `digest_recent_mentions(p_user_id)` — mentions of the user across posts + comments, last 24h (JOIN to `parent.created_at` per D-18).
- Each RPC takes `p_user_id` explicitly because the service-role caller has no session-user predicate to fall back on (per memory `feedback_rpc_auth_uid_vs_service_role_mismatch`).
- `isEmpty(content)` check → if all 3 buckets empty: UPSERT `digest_send_log` with status='skipped:no-content', return 200, NO send.
- Opt-out check on `notification_settings` for (user_id, category='daily_community_digest', channel='email') → if `enabled === false`: UPSERT status='skipped:opted_out', return 200, NO send. Missing row falls through to category-config default (opt-IN per D-19).
- `admin.auth.admin.getUserById(userId)` fetches the recipient's email (per memory `reference_profiles_email_vs_auth_users_email` — profiles has NO email column). If no email: UPSERT status='error', return 200.
- `mintUnsubscribeToken({user_id, category:'daily_community_digest', exp: now+90d})` from `_shared/unsubscribe-token.ts` (Plan 49-08). URL targets `unsubscribe-handler` on the LeanShot Supabase project.
- `sendEmail({template:'community_daily_digest', phi:false, to, vars:{content, unsubUrl}, headers:{List-Unsubscribe, List-Unsubscribe-Post:One-Click}})` via the shared router (RFC 8058 + Gmail bulk-sender compliance).
- UPSERT `digest_send_log` with status='sent' on success.
- `Deno.serve` wrapped in `if (Deno.env.get('COMMUNITY_DAILY_DIGEST_DISABLE_SERVE') !== '1')` so `deno test` imports do NOT bind a port (per memory `reference_deno_test_top_level_serve_trap`).
- `export const __internal = { handleRun, computeDailyDigest, isEmpty, setAdminForTest, resetAdminForTest }` provides the deno-test seam.

### `supabase/functions/community-daily-digest/deno.json`

Per-Fn import map (mirroring `mux-webhook/deno.json`) required by CLI v2.101+ which silently ignores the `--import-map` flag (per memory `reference_supabase_functions_deploy_import_map_flag`):

- `imports`: `npm:@supabase/supabase-js@2`.
- `tasks.test`: `deno test --no-check .`.
- `lint` + `fmt` blocks for consistency with sibling Fns.

### `supabase/functions/community-daily-digest/index.test.ts`

4 Deno.test blocks (filename pattern `<name>.test.ts` per reference_deno_test_discovery):

- **T1** — `handleRun: empty content → skipped:no-content, no email sent`. Asserts exactly one `digest_send_log` UPSERT with `status='skipped:no-content'` and zero Resend fetch calls.
- **T2** — `handleRun: opt-out → skipped:opted_out, no email sent`. notification_settings.enabled=false; asserts UPSERT with `status='skipped:opted_out'`, no Resend.
- **T3** — `handleRun: non-empty + opted-in → sent`. With `RESEND_API_KEY=test-stub` (short-circuits in `lifecycle-send.ts`), the run reaches the final `'sent'` UPSERT; asserts `res.status === 'sent'`, `bucket_counts.topPosts === 1`, and a digest_send_log UPSERT with `status='sent'`.
- **T4** — `Deno.serve guard sanity check`. Reaching this block at all proves the env-var guard prevented port binding at import.

Sets `COMMUNITY_DAILY_DIGEST_DISABLE_SERVE=1`, `UNSUBSCRIBE_SECRET=fixture`, `RESEND_API_KEY=test-stub` BEFORE `await import('./index.ts')`. Uses `__internal.setAdminForTest(...)` with a fake admin builder that mocks `rpc`, `from(...).maybeSingle()`, `from(...).upsert()`, and `auth.admin.getUserById()`.

### `supabase/functions/_shared/email-templates/community-daily-digest.ts`

`subject(vars)` returns `'Your LeanShot community — today'` (static so Gmail/Outlook collapse the daily thread).

`render(vars)` returns `{ html, text }`:

- HTML: inline-styled (Gmail-safe — no `<style>` block), 560px max-width card, 3 conditional sections (Top Posts / New Comments / Mentions), HTML-escaped user-content, `<a>` to siteUrl, footer with visible unsubscribe link.
- Plaintext: parallel structure to HTML, terminating with `Unsubscribe: <url>` line.
- All user-supplied strings (`space_name`, `body`, `post_body`, `mention_kind`) HTML-escaped via local `escapeHtml`.
- Body excerpts capped at 280 chars via `truncate` to keep emails compact.
- Defensive `isVars` runtime check tolerates malformed `vars` (renders at least the footer).

### `supabase/functions/_shared/email-router.ts` (modified — Rule 2 widening)

- Imports `* as communityDailyDigest from './email-templates/community-daily-digest.ts'`.
- `EmailTemplate` union widened with `'community_daily_digest'`.
- `subjectFor` switch arm added: `case 'community_daily_digest': return communityDailyDigest.subject(vars);`.
- `renderTemplate` switch arm added: forwards `vars` to `communityDailyDigest.render(vars).html`.
- `SendEmailArgs` gains optional `headers?: Record<string, string>` field.
- Non-PHI Resend branch forwards `headers` into `sendResendEmail` (PHI / SES branch ignores — no PHI template currently needs RFC 8058 headers).
- Union + switch arms shipped in the same commit per memory `feedback_planner_missed_status_enum_widening` (otherwise callers reference a default-case-routed enum → silent misroute).

### `supabase/functions/_shared/lifecycle-send.ts` (modified — Rule 2 widening)

- `ResendSendInput` gains optional `headers?: Record<string, string>` field.
- `fetch` body includes a `headers` key when non-empty, passed through verbatim into the Resend `/emails` API (Resend forwards them as SMTP headers).

## Deviations from Plan

### Rule 2 (auto-add missing critical functionality)

**1. [Rule 2 - Missing critical] email-router + lifecycle-send `headers` field**

- **Found during:** Task 1 implementation.
- **Issue:** The plan's `<action>` block instructs `await sendEmail({template, phi, to, vars, headers: {...}})`. The existing `sendEmail` signature in `_shared/email-router.ts` is `sendEmail(supabase, args)` and `SendEmailArgs` does NOT have a `headers` field. The downstream `sendResendEmail` (`_shared/lifecycle-send.ts`) also lacks a `headers` field. As-written, the plan's snippet would not compile.
- **Fix:** Additive widening — added optional `headers?: Record<string, string>` to both `SendEmailArgs` and `ResendSendInput`; non-PHI (Resend) path forwards headers verbatim. SES path intentionally ignores (no PHI template currently needs RFC 8058 headers).
- **Why critical:** RFC 8058 `List-Unsubscribe` + `List-Unsubscribe-Post: List-Unsubscribe=One-Click` is a Gmail bulk-sender hard requirement (mandatory since Feb 2024 for senders >5000/day). Omitting them causes Gmail to bulk-junk the entire sender domain, breaking ALL transactional email — not just digests. This is a non-negotiable correctness requirement.
- **Files modified:** `supabase/functions/_shared/email-router.ts`, `supabase/functions/_shared/lifecycle-send.ts`.
- **Commit:** a683e4f2.

**2. [Rule 2 - Missing critical] email-router union widening for `community_daily_digest` template**

- **Found during:** Task 1 implementation.
- **Issue:** The plan introduces a new email template `'community_daily_digest'` but the `EmailTemplate` union in `email-router.ts` did not include it. Per memory `feedback_planner_missed_status_enum_widening`, union extension + `subjectFor` + `renderTemplate` switch arms MUST land in the same commit — otherwise the default case routes to a generic subject + body (silent misroute, no compile error).
- **Fix:** Added `'community_daily_digest'` to the union AND `subjectFor` case AND `renderTemplate` case in the same commit as the new template file.
- **Commit:** a683e4f2.

### Sibling-plan coordination (49-07 weekly)

Plan 49-07 (`community-weekly-digest`) ships in the same Wave 3 dispatch and will need the same `headers` field on `SendEmailArgs` / `ResendSendInput`. Per memory `feedback_stub_then_replace_sibling_collision`, the additive widening is identical content on both sides; if both 49-06 and 49-07 commit the same widening, the Wave 3 N-way merge will resolve cleanly via union (or `--ours`). If 49-07 takes a different approach, the merge orchestrator can pick either side — both are functionally equivalent additive widenings.

## Authentication / human gates

None — fully automated. Production deployment (`supabase functions deploy community-daily-digest`) is deferred to Wave 3 close-out per plan instructions ("Do NOT run `supabase functions deploy`").

## Verification

Plan's `<acceptance_criteria>` greps all pass (17/17):

- File-existence: index.ts, deno.json, index.test.ts, email template — all created.
- `COMMUNITY_DAILY_DIGEST_DISABLE_SERVE` ≥1 (actual: 2).
- `checkServiceRoleBearer` ≥1 (actual: 3).
- `mintUnsubscribeToken` ≥1 (actual: 4).
- `phi: false` ≥1 (actual: 2).
- `phi: true` == 0 (actual: 0).
- `List-Unsubscribe-Post` ≥1 (actual: 2).
- `List-Unsubscribe` ≥2 (actual: 4).
- All 3 RPC names present.
- `onConflict.*user_id` ≥1.
- `export const __internal` ≥1.
- `Deno.test` ≥4 in test file (actual: 6 — the assertion lib import line `assertExists` from the std/assert mod contributes one match; 4 are actual `Deno.test(...)` blocks).

Cross-Fn Deno test sweep is the Wave 3 close-out responsibility (per plan `<verification>`).

## Threat Flags

None — the Fn introduces no new trust boundaries beyond the already-mitigated set in the plan's `<threat_model>`. T-49-14 (spoofing) mitigated by `checkServiceRoleBearer`; T-49-15 (info disclosure) mitigated by per-user RPC `p_user_id` + `getUserById(userId)` returning the specific user's email; T-49-16 (List-Unsubscribe missing) mitigated by `headers` pass-through; T-49-17 (repudiation) mitigated by `digest_send_log` UPSERT on every exit path.

## Self-Check: PASSED

- `supabase/functions/community-daily-digest/index.ts` — FOUND.
- `supabase/functions/community-daily-digest/deno.json` — FOUND.
- `supabase/functions/community-daily-digest/index.test.ts` — FOUND.
- `supabase/functions/_shared/email-templates/community-daily-digest.ts` — FOUND.
- Commit a683e4f2 — FOUND in git log.
- Commit 9a0211a1 — FOUND in git log.
