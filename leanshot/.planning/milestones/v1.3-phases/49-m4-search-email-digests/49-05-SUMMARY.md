---
phase: 49-m4-search-email-digests
plan: 05
subsystem: cron + test-scaffolds
tags: [pg_cron, digest, fts, rls, idempotency, wave-0]
requires:
  - 49-01-PLAN.md  # community_posts.search_en/search_es
  - 49-02-PLAN.md  # course_lessons FTS
  - 49-03-PLAN.md  # events FTS
  - 49-04-PLAN.md  # search_content RPC + digest_send_log + 6 digest_* helpers
provides:
  - "2 pg_cron jobs (daily / weekly community digest hourly fan-out)"
  - "3 Deno test scaffolds (fts-schema, search-content-rpc, digest-helpers)"
  - "2 SQL test scaffolds (search_content RLS proof, send_log idempotency proof)"
affects:
  - "Wave 1 plans 49-06/07/08 import scaffolds and fill in fixtures"
  - "Wave 3 close-out plan 49-10 owns 'supabase db push --linked' (deploys cron migration)"
tech-stack:
  added: [pg_cron, pg_net]
  patterns:
    - "Outer $cron$ + inner $daily$/$weekly$/$unschedule$ named dollar-quote tags"
    - "vault.decrypted_secrets read pattern for service_role_key"
    - "TODO-marked test scaffolds importable at Wave 0 with Wave 1 GREEN deferrals"
key-files:
  created:
    - supabase/migrations/20271001000008_p49_pg_cron_schedules.sql
    - supabase/functions/_shared/__tests__/fts-schema.test.ts
    - supabase/functions/_shared/__tests__/search-content-rpc.test.ts
    - supabase/functions/_shared/__tests__/digest-helpers.test.ts
    - supabase/tests/p49_search_content_rls.sql
    - supabase/tests/p49_digest_send_log_idempotency.sql
  modified: []
decisions:
  - "Tag uniqueness vs Phase 38/47/48: outer $cron$ + inner $daily$/$weekly$/$unschedule$ — confirmed zero rejected-tag strings in committed file."
  - "Minute offsets 5 / 15 (D-20) avoid HTTP burst collision with Phase 38 cron at minute 0."
  - "Cron targets Wave 1 Edge Fns (community-daily-digest + community-weekly-digest) — Wave 3 49-10 close-out MUST deploy both Fns BEFORE 'supabase db push --linked'."
metrics:
  duration: ~6 min
  completed: 2026-05-24
  tasks: 2
  files: 6
  commits:
    - cf3b5ab6  # feat(49-05): pg_cron daily+weekly community digest fan-out
    - ba0ddc72  # test(49-05): Wave 0 scaffolds for FTS / search_content / digest helpers / RLS / send_log
---

# Phase 49 Plan 05: pg_cron + Wave 0 Test Scaffolds Summary

**One-liner:** pg_cron migration registering 2 hourly fan-out jobs (community-daily-digest at :05, community-weekly-digest at :15) plus 5 importable-but-TODO Wave 0 test scaffolds covering FTS schema, search_content RPC contract, digest helper RPC shapes, cross-tenant RLS, and digest_send_log idempotency.

## What Was Built

### Task 1 — pg_cron migration (commit `cf3b5ab6`)

File: `supabase/migrations/20271001000008_p49_pg_cron_schedules.sql`

Registers two pg_cron jobs:
- `phase49-community-daily-digest-hourly-fanout` — `'5 * * * *'` — fires every hour at :05; selects profiles where `extract(hour from now() at profiles.timezone) = 9`; dedup window 20h via `digest_send_log`; POSTs `{user_id}` to Edge Fn `community-daily-digest`.
- `phase49-community-weekly-digest-hourly-fanout` — `'15 * * * *'` — fires every hour at :15; same predicate AND `extract(dow ...) = 0` (Sunday UTC); dedup window 6 days; POSTs to `community-weekly-digest`.

Both jobs:
- Read `service_role_key` from `vault.decrypted_secrets` per `reference_supabase_pg_cron_vault_service_role_pattern`. No `current_setting('app.service_role_key')` (that GUC does not exist on this project).
- Hardcoded function URLs `https://ytnsipxxmzgaebkqmokp.supabase.co/functions/v1/community-(daily|weekly)-digest`.
- Idempotent `do $unschedule$` preamble unregisters BOTH jobnames before scheduling (safe re-apply).
- Named dollar-quote tags: outer `$cron$` + inner `$daily$` / `$weekly$` / `$unschedule$` per `reference_postgres_dollar_quote_nesting_in_cron_body`. Tag set is unique vs Phase 38 (`$digest$`/`$cleanup$`), Phase 47 (`$reminders$`), Phase 48 (`$restore$`) — silent quote closure prevented.
- Rejected-alternative strings (`$digest$`, `$reminders$`, `$restore$`, `$cleanup$`, `current_setting('app.service_role_key')`) are documented in the commit message / SUMMARY only — never present in the committed SQL body per `feedback_negation_grep_defeated_by_comment_string`.

### Task 2 — 5 Wave 0 test scaffolds (commit `ba0ddc72`)

3 Deno test scaffolds under `supabase/functions/_shared/__tests__/`:
- **`fts-schema.test.ts`** (5 Deno.test blocks) — INSERT → `search_en`/`search_es` GENERATED column populates; weights A/B per D-17; GIN index plan check.
- **`search-content-rpc.test.ts`** (5 Deno.test blocks) — top-5-per-type; `<b>` headline wrap; spanish regconfig; UNION-ALL mixed types; D-21 ts_headline-over-LIMIT-5 enforcement.
- **`digest-helpers.test.ts`** (7 Deno.test blocks) — 6 SECDEF RPC shapes + per-user filter exclusion + D-18 mention JOIN-to-parent.created_at filter.

2 SQL test scaffolds under `supabase/tests/`:
- **`p49_search_content_rls.sql`** — cross-tenant impersonation proof (clinic A user MUST NOT see clinic B posts via `search_content`).
- **`p49_digest_send_log_idempotency.sql`** — UPSERT on `(user_id, kind, sent_date)` collapses to 1 row; raw INSERT raises `23505`.

All scaffold bodies are TODO-marked but importable — Deno.test blocks present, SQL `begin;`/`rollback;` wrappers present. Wave 1 plans 49-06/07/08 fill in fixtures + assertions inline.

## Edge Functions Targeted by Cron (called out per orchestrator request)

The pg_cron migration POSTs to:
1. **`community-daily-digest`** — shipped by Wave 1 plan **49-06** (per phase-49 dispatch graph).
2. **`community-weekly-digest`** — shipped by Wave 1 plan **49-07** (per phase-49 dispatch graph).

**Close-out warning surfaced for 49-10 (Wave 3):** Per memory `feedback_fn_deploy_before_cron_db_push`, the phase close-out MUST `supabase functions deploy community-daily-digest community-weekly-digest` BEFORE `supabase db push --linked` of this migration. Otherwise pg_cron can fire (within 15 minutes of push) at non-existent endpoints, generating raise-notice noise and a 15-min observability gap. The close-out plan already lists this constraint; no new action required from this plan.

## Deviations from Plan

None — plan executed exactly as written. Acceptance grep gates all passed first-try:

| Gate | Required | Actual |
|------|----------|--------|
| `$cron$` count | ≥4 | 5 (one extra in comment header explaining the rule) |
| `$daily$` count | ≥2 | 3 (one in declarative comment) |
| `$weekly$` count | ≥2 | 3 (one in declarative comment) |
| `$unschedule$` count | ≥2 | 3 (one in declarative comment) |
| `'5 * * * *'` count | ≥1 | 2 |
| `'15 * * * *'` count | ≥1 | 2 |
| `current_setting('app.service_role_key')` count | 0 | 0 |
| rejected-tag count (`$digest$\|$reminders$\|$restore$\|$cleanup$`) | 0 | 0 |
| `phase49-community-daily-digest-hourly-fanout` count | ≥2 | 4 |
| `phase49-community-weekly-digest-hourly-fanout` count | ≥2 | 4 |
| `vault.decrypted_secrets` count | ≥2 | 3 |
| 5 scaffold files exist | yes | yes |
| Deno.test counts | ≥1 each | 5 / 5 / 7 |
| SQL begin/rollback wrappers | yes | yes |

## Deferred Items

- Wave 1 plans 49-06/07/08 fill TODOs in all 5 scaffold files (per scaffold pattern; no action this plan).
- Wave 3 close-out 49-10 runs `supabase db push --linked` for migration `20271001000008` AFTER deploying the 2 Edge Fns.

## Self-Check: PASSED

- File `supabase/migrations/20271001000008_p49_pg_cron_schedules.sql` — FOUND.
- File `supabase/functions/_shared/__tests__/fts-schema.test.ts` — FOUND.
- File `supabase/functions/_shared/__tests__/search-content-rpc.test.ts` — FOUND.
- File `supabase/functions/_shared/__tests__/digest-helpers.test.ts` — FOUND.
- File `supabase/tests/p49_search_content_rls.sql` — FOUND.
- File `supabase/tests/p49_digest_send_log_idempotency.sql` — FOUND.
- Commit `cf3b5ab6` — FOUND in git log.
- Commit `ba0ddc72` — FOUND in git log.
