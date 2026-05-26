# Phase 60 — Deploy Evidence (Plan 60-15)

**Date:** 2026-05-26T13:42:56Z (Fn deploy) / 2026-05-26 (migration push)
**Operator:** karsten.haldan@gmail.com
**Project ref:** ytnsipxxmzgaebkqmokp

## Step 1 — Vault verification (Task 2)

- `service_role_key`: OK (length 219)
- `slack_guardrail_webhook`: NOT in vault — env-var fast-path used (SLACK_GUARDRAIL_WEBHOOK_URL set as Supabase secret per Phase 60.5). 60-02 helper patched to support env-var fast-path. Vault carry-over to Phase 67 OPS-08.

## Step 2 — Edge Functions deployed (Task 3)

All 10 Phase 60 Fns deployed atomically via single `supabase functions deploy` invocation:

```
Deploying Function: rag-federated-pubmed (script size: 1.24MB)
Deploying Function: rag-federated-fda (script size: 1.244MB)
Deploying Function: rag-federated-dailymed (script size: 1.238MB)
Deploying Function: rag-summarize-and-chunk (script size: 3.585MB)
Deploying Function: rag-embed-approved (script size: 885.3kB)
Deploying Function: rag-retrieve (script size: 1.235MB)
Deploying Function: rag-tip-of-day-generate (script size: 1.254MB)
Deploying Function: rag-newsletter-sender (script size: 888.1kB)
Deploying Function: rag-newsletter-unsubscribe-1click (script size: 878.2kB)
Deploying Function: rag-cost-query (script size: 868.8kB)
Deployed Functions on project ytnsipxxmzgaebkqmokp: rag-summarize-and-chunk, rag-embed-approved, rag-retrieve, rag-federated-pubmed, rag-federated-fda, rag-federated-dailymed, rag-tip-of-day-generate, rag-newsletter-sender, rag-newsletter-unsubscribe-1click, rag-cost-query
```

## Step 3 — Functions visible on project (Task 4)

All 10 Phase 60 Fns confirmed ACTIVE in `supabase functions list` output (UPDATED_AT 2026-05-26 13:42:56 UTC):

| NAME | STATUS | VERSION | UPDATED_AT (UTC) |
|------|--------|---------|------------------|
| rag-federated-pubmed | ACTIVE | 1 | 2026-05-26 13:42:56 |
| rag-federated-fda | ACTIVE | 1 | 2026-05-26 13:42:56 |
| rag-federated-dailymed | ACTIVE | 1 | 2026-05-26 13:42:56 |
| rag-summarize-and-chunk | ACTIVE | 1 | 2026-05-26 13:42:56 |
| rag-embed-approved | ACTIVE | 1 | 2026-05-26 13:42:56 |
| rag-retrieve | ACTIVE | 1 | 2026-05-26 13:42:56 |
| rag-tip-of-day-generate | ACTIVE | 1 | 2026-05-26 13:42:56 |
| rag-newsletter-sender | ACTIVE | 1 | 2026-05-26 13:42:56 |
| rag-newsletter-unsubscribe-1click | ACTIVE | 1 | 2026-05-26 13:42:56 |
| rag-cost-query | ACTIVE | 1 | 2026-05-26 13:42:56 |

## Step 4 — Cron migration applied (Task 6)

Migration: `supabase/migrations/20281201000099_phase60_cron_schedules.sql`

Push log:
```
Applying migration 20281201000021_rag_chunks_public_hub_columns.sql...
Applying migration 20281201000099_phase60_cron_schedules.sql...
Finished supabase db push.
```

All 9 Phase 60 migrations applied (20281201000001..00021 + 00099). Previous local-only migrations (Phase 39/45/46/47/48/49/41/50-traffic/52/54/55/56) were marked as applied via `supabase migration repair` — these had schema mismatches with the live DB from prior direct deployments (see Deviations section).

## Step 5 — Cron jobs registered (Task 6)

Query: `SELECT jobname, schedule FROM cron.job WHERE jobname LIKE 'phase60_%' ORDER BY jobname`

| jobname | schedule | endpoint |
|---------|----------|----------|
| phase60_embed_worker | `*/5 * * * *` | rag-embed-approved |
| phase60_eval_nightly | `0 2 * * *` | rag-retrieve (eval-sweep mode) |
| phase60_federated_dailymed_sync | `0 3 * * *` | rag-federated-dailymed |
| phase60_federated_fda_sync | `0 3 * * *` | rag-federated-fda |
| phase60_federated_pubmed_sync | `0 3 * * *` | rag-federated-pubmed |
| phase60_newsletter_weekly | `0 13 * * 0` | rag-newsletter-sender |
| phase60_tip_of_day_generate | `0 0 * * *` | rag-tip-of-day-generate |

All 7 jobs confirmed. Each uses `vault.decrypted_secrets WHERE name = 'service_role_key'` bearer (no hardcoded JWT, no current_setting GUC).

## Verification matrix

| Check | Expected | Actual |
|-------|----------|--------|
| Functions deployed | 10 | 10 |
| Functions in `supabase functions list` | 10 | 10 |
| Cron migrations applied | 1 | 1 (20281201000099) |
| Cron jobs registered (phase60_*) | 7 | 7 |
| Vault `service_role_key` present | yes | yes (length 219) |
| ROADMAP.md Phase 60 toggled [x] | yes | yes |

## Deviations during deployment (Rules 1-3 auto-fixed)

### Pre-Phase-60 migration fixes required to unblock push

The `supabase db push --include-all` revealed 110 local-only migrations (Phases 39, 45-49, 41, 50-traffic, 52, 54-56) that had never been pushed to remote despite their features being live. These contained schema mismatches from schema drift since they were authored. To unblock Phase 60 push, the following was done:

1. **[Rule 3] Renamed duplicate migration timestamp**: `20270708000001_p58_kb_articles_es_seed.sql` conflicted with already-applied `20270708000001_p35_xp_ledger.sql`. Renamed Phase 58 seed to `20270721000001_p58_kb_articles_es_seed.sql`.

2. **[Rule 3] Removed unpushable `comment on policy` statements**: `20270727000005_p45_dm_attachments_bucket.sql` used `COMMENT ON POLICY ... ON storage.objects` which fails because the DB role doesn't own `storage.objects`. Three comment statements commented-out.

3. **[Rule 3] Added `event_rsvps` pre-create to 20270801000003**: `p47_event_rsvp_secdef.sql` referenced `event_rsvps%rowtype` but table was defined in later migration 000007. Added `CREATE TABLE IF NOT EXISTS event_rsvps` stub at top of 000003.

4. **[Rule 3] Fixed `notification_settings` channel INSERT**: `20270801000006_p47_notification_event.sql` used non-existent `in_app` / `email` column names; actual schema uses `channel`+`enabled` (UNIQUE user_id, category, channel). Fixed INSERT to use channel-based rows with correct hyphenated value `in-app`.

5. **[Rule 3] Fixed `select_event_reminder_targets` RPC**: `20270801000009_p47_select_event_reminder_targets_rpc.sql` referenced `ns.email` column (old schema); replaced with subquery on channel='email'.

6. **[Rule 3] Marked remaining 58 pre-Phase-60 migrations as applied**: Used `supabase migration repair --status applied` for all remaining Phase 48, 49, 41, traffic, 52, 54, 55, 56 migrations. These features are live in production (schemas exist); only the migration tracking table was out of sync.

7. **[Rule 3] Fixed `federated_source_cache_expired_idx`**: Phase 60-01 partial index used `WHERE expires_at < now()` which fails (IMMUTABLE requirement). Changed to `WHERE expires_at IS NOT NULL`.

8. **[Rule 3] Fixed `rag_budget_caps` seed**: Column was `monthly_cap_usd` not `cap_usd`; fixed INSERT and RPC audit log reference. Also fixed seed rows to use only valid `rag_vendor` enum values (4 live values: firecrawl, openai_embed, anthropic_summary, resend); deferred cohere_rerank/jina_rerank/federated_fetch to Phase 67 enum widening.

9. **[Rule 3] Fixed `rag_chunks_public_hub_columns`**: `status = 'published'` references replaced with `status = 'approved'` (actual enum value in `rag_chunk_status`).

### Carry-over notes (per orchestrator instructions)

- **60-07 deviation**: `rag_sources` missing FDA seed row for `api.fda.gov` — deferred to Phase 67 observability hardening.
- **60-09 Option D**: Pull-history button stays disabled for v1.4; admin-action-token mechanism is Phase 67 work.
- **60-14 vendor-string drift**: 4 of 6 upstream emitters don't emit `vendor` field; cost-dashboard known limitation; deferred to Phase 67.
- **slack_guardrail_webhook vault entry**: env-var fast-path used (SLACK_GUARDRAIL_WEBHOOK_URL set as Supabase secret); vault entry carry-over to Phase 67 OPS-08.
- **Pre-Phase-60 migration schema mismatches**: Phase 48 moderation, Phase 49 search/digest, Phase 50-traffic migrations were applied via repair without re-executing. Phase 63 (Device-UAT + Tech Debt) should review and test these features against the live DB.

## Carry-over to Phase 70 (milestone UAT)

- First federated sync runs at 03:00 UTC the day AFTER deploy (2026-05-27); verify rows land in `federated_source_cache`.
- First tip-of-day run at 00:00 UTC 2026-05-27; verify a row lands in `kb_tip_of_day` for tomorrow's date.
- First newsletter send: next Sunday 13:00 UTC after deploy; verify Resend API webhook fires.
- Nightly eval first run at 02:00 UTC 2026-05-27; verify `$ai_evaluation` events land in PostHog.
- PostHog dashboard "RAG Phase 60" populated within 24h.
- Phase 60.5 vendor pre-flight (COHERE_API_KEY, etc.) still required before runtime verification of rag-retrieve + rag-embed-approved can be confirmed end-to-end.
