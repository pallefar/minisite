---
phase: 60-rag-knowledge-base-completion-waves-2-4
plan: 01
plan_id: 60-01-data-layer-migrations
type: execute
wave: 0
depends_on: []
files_modified:
  - supabase/migrations/20261201000001_phase60_kb_tables.sql
  - supabase/migrations/20261201000002_phase60_secdef_rpcs.sql
  - supabase/migrations/20261201000003_phase60_push_categories.sql
autonomous: true
requirements: [RAG-03, RAG-06, RAG-07, RAG-08]
tags: [rag, phase-60, data-layer, secdef-rpcs, 2-person-rule, federated-sources, newsletter]
user_setup: []

must_haves:
  truths:
    - "RAG-03: 5 SECDEF RPCs own `rag_chunks` state transitions for Phase 60 admin queue (approve_rag_chunk, reject_rag_chunk, retract_rag_chunk, queue_rag_chunk, list_rag_review_queue); each guards on `public.is_staff()`; approve/edit-and-approve enforce 2-person rule `auth.uid() <> rag_chunks.created_by` at DB layer (per [[feedback_3_layer_must_never_invariant_pattern]]). Reject path inserts an audit row into `kb_chunk_rejections` with `(chunk_id, reason, actor_id, at)` per CONTEXT.md D-rejection-audit."
    - "RAG-06: 3-row `federated_sources` table seeded with pubmed/openfda/dailymed; per-source `enabled` toggle + `last_sync_at` + `last_error` + `sync_cron` columns; auto-tag policy `auto_tier_a=true` (federated chunks land `source_tier='A'` but STILL require admin review per PHARMA-02 carveout). 24h-cache companion table `federated_source_cache` keyed by `(source_name, cache_key)` with `expires_at` TTL + jsonb payload; UNIQUE constraint allows `INSERT...ON CONFLICT (source_name, cache_key) DO UPDATE` idempotent writes per [[reference_postgres_no_insert_on_conflict_do_delete]]."
    - "RAG-07: `push_subscription_categories` notification CHECK constraint widened to include `research_tips` category across all 4 notification_* tables (notification_settings, notification_category_config, user_notifications, notification_dismissal_state) per Phase 54 widening pattern; `notification_category_config` seeded with research-tips defaults (daily_cap=1, weekly_cap=7, urgent_escalation=false, push/email/in_app_enabled_default=true). Honors existing Phase 54 freq-cap + quiet-hours."
    - "RAG-08: `newsletter_subscribers` table holds Phase 60 weekly-research-newsletter opt-in roster with stored unsubscribe token + RLS-gated anon SELECT for RFC 8058 1-click unsubscribe per [[feedback_rls_stored_token_verification_pattern]]; default `opted_in=false` (CAN-SPAM affirmative). Distinct from Phase 50 `rag_newsletter_subscriptions` (per-user frequency prefs) — both coexist; Phase 60 newsletter sender reads `newsletter_subscribers WHERE opted_in=true`."
    - "Migration timestamps land AFTER the latest applied (`20280401000007_ad_placements_authenticated_select.sql`) using `20281201000001..03` series per [[reference_supabase_back_dated_migration_blocks_push]] — do NOT back-date; verify against `supabase/migrations/` head before commit."
    - "Zero `cron.schedule(...)` calls in this plan's 3 migrations — cron registration deferred to 60-15 per `[[feedback_fn_deploy_before_cron_db_push]]` strict ordering."
    - "All 5 RPCs grant EXECUTE to authenticated only (NOT anon); SECDEF + SET search_path = public, extensions, pg_catalog per is_staff helper precedent (`supabase/migrations/20261101000006_is_staff_helper.sql`)."
    - "`profiles` table has NO `email` column per [[reference_profiles_email_vs_auth_users_email]] — `list_rag_review_queue` RPC that surfaces reviewer email MUST JOIN `auth.users.email`, never `public.profiles.email`."
  artifacts:
    - path: "supabase/migrations/20281201000001_phase60_kb_tables.sql"
      provides: "4 new tables (federated_sources seeded with 3 rows, federated_source_cache, newsletter_subscribers, kb_chunk_rejections); RLS enabled on all 4; UNIQUE constraints for ON CONFLICT idempotency"
      contains: "create table if not exists public.federated_sources, create table if not exists public.federated_source_cache, create table if not exists public.newsletter_subscribers, create table if not exists public.kb_chunk_rejections, alter table ... enable row level security, create unique index, insert into public.federated_sources (name, enabled, sync_cron) values ('pubmed', false, '0 3 * * *'), ('openfda', false, '0 3 * * *'), ('dailymed', false, '0 3 * * *') on conflict (name) do nothing"
    - path: "supabase/migrations/20281201000002_phase60_secdef_rpcs.sql"
      provides: "5 SECDEF state-machine RPCs (approve_rag_chunk, reject_rag_chunk, retract_rag_chunk, queue_rag_chunk, list_rag_review_queue) with public.is_staff() guard + 2-person rule on approve path + audit-row writer on reject path"
      contains: "create or replace function public.approve_rag_chunk(p_chunk_id uuid), create or replace function public.reject_rag_chunk(p_chunk_id uuid, p_reason public.rag_reject_reason, p_notes text), create or replace function public.retract_rag_chunk(p_chunk_id uuid, p_reason text), create or replace function public.queue_rag_chunk(p_chunk_id uuid), create or replace function public.list_rag_review_queue(p_limit int, p_offset int, p_tier text, p_topic_tag text), security definer, set search_path = public, extensions, pg_catalog, if not public.is_staff() then raise exception 'not authorized', if auth.uid() = c.created_by then raise exception '2-person rule', grant execute ... to authenticated, revoke all ... from public"
    - path: "supabase/migrations/20281201000003_phase60_push_categories.sql"
      provides: "research_tips notification category widened into all 4 notification_* CHECK constraints + seeded into notification_category_config; follows Phase 54 widening pattern verbatim"
      contains: "alter table public.notification_settings drop constraint if exists notification_settings_category_chk, add constraint notification_settings_category_chk check (category in (..., 'research_tips')), alter table public.notification_category_config ..., alter table public.user_notifications ..., alter table public.notification_dismissal_state ..., insert into public.notification_category_config (category, daily_cap, weekly_cap, urgent_escalation, push_enabled_default, email_enabled_default, in_app_enabled_default) values ('research_tips', 1, 7, false, true, true, true) on conflict (category) do nothing"
  key_links:
    - from: "supabase/migrations/20281201000002_phase60_secdef_rpcs.sql (approve_rag_chunk)"
      to: "rag_chunks.created_by (Phase 50 existing column)"
      via: "2-person rule guard `if auth.uid() = (select created_by from public.rag_chunks where id = p_chunk_id)`"
      pattern: "auth\\.uid\\(\\)\\s*=\\s*\\(?\\s*select\\s+created_by\\s+from\\s+public\\.rag_chunks"
    - from: "supabase/migrations/20281201000002_phase60_secdef_rpcs.sql (reject_rag_chunk)"
      to: "kb_chunk_rejections (Phase 60 new audit table)"
      via: "INSERT into kb_chunk_rejections (chunk_id, reason, actor_id, at) values (p_chunk_id, p_reason, auth.uid(), now())"
      pattern: "insert\\s+into\\s+public\\.kb_chunk_rejections"
    - from: "supabase/migrations/20281201000001_phase60_kb_tables.sql (federated_source_cache)"
      to: "60-07 federated adapter Edge Fns (rag-federated-pubmed/fda/dailymed)"
      via: "ON CONFLICT (source_name, cache_key) DO UPDATE SET payload = excluded.payload, expires_at = excluded.expires_at"
      pattern: "on\\s+conflict\\s*\\(\\s*source_name\\s*,\\s*cache_key\\s*\\)"
    - from: "supabase/migrations/20281201000003_phase60_push_categories.sql"
      to: "Phase 54 notification_settings / notification_category_config / user_notifications / notification_dismissal_state tables"
      via: "CHECK constraint widening per Phase 54 precedent (20280201000002_p54_notification_helpdesk_widening.sql)"
      pattern: "'research_tips'"
    - from: "supabase/migrations/20281201000001_phase60_kb_tables.sql (newsletter_subscribers)"
      to: "60-12 rag-newsletter-unsubscribe-1click Edge Fn"
      via: "anon SELECT RLS gated by stored unsubscribe_token column (RLS-gated stored-token pattern)"
      pattern: "create\\s+policy[^;]*newsletter_subscribers[^;]*unsubscribe_token"
---

<objective>
Wave 0 data-layer foundation for Phase 60. Lands 3 idempotent migrations (4 new tables, 5 SECDEF state-machine RPCs, 1 push-category widening) that every Wave 1+ plan depends on. No Edge Fn deploys. No cron schedules (deferred to 60-15 per Fn-deploy-before-cron-push ordering).

Purpose: Establish the schema + DB-layer enforcement of the 2-person review rule (per [[feedback_3_layer_must_never_invariant_pattern]] — DB layer of the 3-layer invariant; UI layer in 60-08; CI eval layer in 60-03), enable federated source toggling for 60-07/60-09, and unblock the Phase 60 newsletter (60-12) + tip-of-day push (60-11) by widening Phase 54 push categories.

Output: 3 SQL migration files under `supabase/migrations/` ready for `supabase db push --linked` (executed in 60-15 BLOCKING task after Fn deploys).
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/STATE.md
@.planning/phases/60-rag-knowledge-base-completion-waves-2-4/60-AI-SPEC.md
@.planning/phases/60-rag-knowledge-base-completion-waves-2-4/60-CONTEXT.md
@.planning/phases/50-admin-curated-rag-knowledge-base-peptide-topic-research-scra/50-06-PLAN.md
@supabase/migrations/20260519000003_rag_chunks_table.sql
@supabase/migrations/20260519000008_rag_newsletter_subscriptions_table.sql
@supabase/migrations/20261101000006_is_staff_helper.sql
@supabase/migrations/20280201000002_p54_notification_helpdesk_widening.sql

<interfaces>
- Existing `public.rag_chunks` (Phase 50 20260519000003) — columns `id uuid pk`, `status public.rag_chunk_status enum (queued|approved|rejected|retracted|re-queued)`, `reject_reason public.rag_reject_reason enum (off-topic|factually-wrong|off-label|low-quality|duplicate|safety-concern)`, `published_at`, `retracted_at`, `retracted_reason`, `reviewed_by`, `reviewed_at`, `erratum_flag`, `source_tier` enum (A|B|C). Phase 60 uses ALL of these — does NOT add columns to rag_chunks in this plan.
- Existing helper `public.is_staff()` (20261101000006) — STABLE SECDEF returns bool; called via `if not public.is_staff() then raise exception 'not authorized using errcode = '42501'`.
- Existing helper `public.tg_set_updated_at()` (used by Phase 50 newsletter subscriptions) — reuse for `newsletter_subscribers.updated_at` trigger.
- Phase 54 notification CHECK widening pattern (20280201000002_p54_notification_helpdesk_widening.sql) — 5-step transaction: drop+add CHECK on 4 tables, then INSERT default config row ON CONFLICT DO NOTHING, with `comment on constraint` documentation so grep-counters score live references.
- Existing 15+helpdesk-reply notification category list (must be PRESERVED verbatim when widening to add `research_tips` — drift between any of the 4 CHECK constraints causes Pitfall-4 silent rejection at Edge Fn boundary per 54-RESEARCH.md).
- Phase 50 rag_chunks does NOT have a `created_by` column in the existing schema (20260519000003). Verify by grep; if absent, this plan ADDS the column via ALTER TABLE in 20281201000001 (NOT NULL DEFAULT auth.uid() is not viable for backfill — use nullable with backfill `update set created_by = reviewed_by where created_by is null` + comment that pre-Phase-60 rows are exempt from 2-person rule via `auth.uid() IS DISTINCT FROM coalesce(created_by, '00000000-0000-0000-0000-000000000000'::uuid)` form).
- `rag_reject_reason` enum already covers the 6-option taxonomy (off-topic, factually-wrong, off-label, low-quality, duplicate, safety-concern) per Phase 50 D-16 — REUSE; do NOT redefine.
</interfaces>
</context>

<threat_model>

## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| anon JWT → SECDEF RPC | unauthenticated callers can attempt to invoke RPCs via PostgREST; SECDEF + is_staff() guard must reject |
| authenticated non-staff → SECDEF RPC | logged-in non-admin users can attempt direct RPC call bypassing UI; is_staff() guard must reject |
| staff → 2-person rule bypass | staff member who CREATED a chunk attempts to also approve it; DB-layer rule must reject regardless of UI state |
| anon browser → newsletter_subscribers SELECT (RFC 8058 1-click) | unauthenticated browser must read its own row via stored unsubscribe_token; RLS must restrict to the token-bearer only |
| 60-13 public hub → /knowledge/* search params | SQL injection via search params crossing public boundary into PostgREST (caller-side; see 60-13 threat model — this plan establishes the data shape callers will query) |
| federated adapter (60-07) → federated_source_cache writes | adapter Edge Fns insert payloads via service_role; cache integrity depends on UNIQUE(source_name, cache_key) + ON CONFLICT DO UPDATE preventing stale payloads from co-existing |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-60-01-01 | Spoofing | `approve_rag_chunk`, `reject_rag_chunk`, `retract_rag_chunk`, `queue_rag_chunk`, `list_rag_review_queue` (all 5 RPCs) | mitigate | Every RPC starts with `if not public.is_staff() then raise exception 'not authorized' using errcode = '42501'; end if;` — rejects anon AND authenticated-non-staff. `revoke all on function ... from public` + `grant execute ... to authenticated` (NOT anon). |
| T-60-01-02 | Elevation of Privilege | `approve_rag_chunk` 2-person rule bypass | mitigate | DB-layer guard `if auth.uid() = (select created_by from public.rag_chunks where id = p_chunk_id) then raise exception '2-person rule: publisher cannot equal creator' using errcode = '42501'; end if;` — fires BEFORE the UPDATE; cannot be bypassed by direct SQL or UI tamper. 3-layer enforcement complete with 60-08 UI badge + 60-03 eval safety suite. |
| T-60-01-03 | Tampering | `kb_chunk_rejections` audit row deletion | accept | RLS denies UPDATE/DELETE to authenticated (insert-only); staff cannot edit audit history. Service_role can write, but service_role compromise is out-of-scope per project posture. |
| T-60-01-04 | Information Disclosure | `list_rag_review_queue` leaks `auth.users.email` of OTHER staff reviewers | mitigate | RPC returns ONLY the chunk's `reviewed_by` email (the row's own actor); JOIN `auth.users.email` via SECDEF privilege (caller cannot SELECT auth.users directly). Per [[reference_profiles_email_vs_auth_users_email]] — `profiles.email` does NOT exist; use `auth.users.email`. |
| T-60-01-05 | Tampering | `federated_source_cache` poisoned by collision | mitigate | UNIQUE constraint on `(source_name, cache_key)`; INSERT...ON CONFLICT (source_name, cache_key) DO UPDATE SET payload = excluded.payload, expires_at = excluded.expires_at, updated_at = now() — replaces stale payload atomically. Per [[reference_postgres_no_insert_on_conflict_do_delete]]: this is INSERT...DO UPDATE (legitimate), NOT INSERT...DO DELETE (which doesn't exist). |
| T-60-01-06 | Spoofing | `newsletter_subscribers` 1-click unsubscribe token forgery | mitigate | `unsubscribe_token text NOT NULL DEFAULT encode(gen_random_bytes(32), 'base64url')` — 256-bit unguessable; RLS policy `using (unsubscribe_token = current_setting('request.headers', true)::json->>'x-unsubscribe-token')` grants anon SELECT on row-with-matching-token only. Constant-time compare happens client-side in the 60-12 Edge Fn (browser-fetches-stored-token, anon-SELECT-gated). |
| T-60-01-07 | Denial of Service | `federated_source_cache` table growth without TTL eviction | mitigate | `expires_at timestamptz NOT NULL`; partial index `where expires_at < now()` to make cleanup cheap. 60-15 cron registers nightly purge of expired rows (deferred per Fn-deploy-before-cron rule). |
| T-60-01-08 | Tampering | Migration replay drops/recreates tables, losing federated_sources seed rows | mitigate | All `create table if not exists` + `insert ... on conflict (name) do nothing` for the 3 federated_sources seed rows (pubmed/openfda/dailymed) — idempotent. Re-running the migration is a no-op. |
| T-60-01-09 | Tampering | Push category CHECK drift between 4 notification_* tables | mitigate | Single transaction (BEGIN/COMMIT) drops+adds the CHECK on all 4 tables atomically per Phase 54 precedent (20280201000002). Comment-on-constraint adds a grep-discoverable live reference to `research_tips` per Phase 54 §6. |
| T-60-01-SC | Tampering | Migration files committed without RESEARCH.md package legitimacy audit | n/a | No npm/pip/cargo installs in this plan; pure SQL migrations. Package legitimacy gate not applicable. |

</threat_model>

<tasks>

<task type="auto">
  <name>Task 1: Verify migration head + rag_chunks created_by column status</name>
  <files>(read-only investigation; no files modified)</files>
  <read_first>supabase/migrations/20260519000003_rag_chunks_table.sql (full), `ls supabase/migrations | tail -20` to confirm head timestamp</read_first>
  <action>
    Run pinned investigation BEFORE writing any migrations to avoid back-dating ([[reference_supabase_back_dated_migration_blocks_push]]) and to discover whether `rag_chunks.created_by` already exists:

    1. From git root `/Users/karstenhaldan/minisite/` run `ls supabase/migrations | sort | tail -5` and record the highest timestamp prefix. Confirm it is `20280401000007_ad_placements_authenticated_select.sql` (or higher). The Phase 60 series MUST start strictly after this — use `20281201000001/02/03` (chosen to leave room for a follow-up 60-15 cron file at `20281201000099`).
    2. `grep -n "created_by" supabase/migrations/20260519000003_rag_chunks_table.sql` — if zero matches, the column is ABSENT and migration 20281201000001 MUST add it via `alter table public.rag_chunks add column if not exists created_by uuid references auth.users(id);` with documentation comment. If matches exist, record the column type and proceed without adding it.
    3. `grep -rn "rag_chunks" supabase/migrations | grep -i "alter table .* add column .* created_by"` — sanity-check no later migration already added the column. If found in a later migration, use THAT column shape verbatim.
    4. `grep -rn "research_tips\|research-tips" supabase/migrations` — confirm category does NOT already exist (drift safety). Expect zero matches.
    5. `grep -rn "federated_sources\|federated_source_cache\|kb_chunk_rejections\|newsletter_subscribers" supabase/migrations` — confirm zero matches (these tables are all NEW).
    6. `grep -rn "rag_newsletter_subscriptions" supabase/migrations` — expect 1 match in `20260519000008_rag_newsletter_subscriptions_table.sql` (Phase 50 per-user prefs table, kept separate from Phase 60 `newsletter_subscribers` opt-in roster). Document the coexistence in a comment header of 20281201000001.

    Record findings inline as comments at the top of migration 20281201000001 so subsequent revision/checker rounds can verify against the pinned facts (per [[feedback_revision_planner_pre_check_facts]]).
  </action>
  <verify>
    <automated>bash -c "cd /Users/karstenhaldan/minisite && ls supabase/migrations | sort | tail -5 && grep -c 'created_by' supabase/migrations/20260519000003_rag_chunks_table.sql; grep -rln 'research_tips' supabase/migrations | wc -l"</automated>
  </verify>
  <done>Investigation findings documented as comment header in the upcoming 20281201000001 migration file (added in Task 2); migration timestamp series confirmed post-head; created_by column existence/absence pinned as fact.</done>
</task>

<task type="auto">
  <name>Task 2: Write 4-new-tables migration 20281201000001_phase60_kb_tables.sql</name>
  <files>supabase/migrations/20281201000001_phase60_kb_tables.sql</files>
  <read_first>supabase/migrations/20260519000003_rag_chunks_table.sql (rag_chunks shape + existing enums), supabase/migrations/20260519000008_rag_newsletter_subscriptions_table.sql (Phase 50 newsletter pattern for trigger reuse), supabase/migrations/20261101000006_is_staff_helper.sql (RLS guard pattern), Task 1 findings</read_first>
  <action>
    Write `supabase/migrations/20281201000001_phase60_kb_tables.sql` as a single idempotent file. Top comment header documents: phase 60, file 1-of-3, lists the 4 new tables, references Phase 50 coexistence (rag_newsletter_subscriptions stays for per-user freq prefs; newsletter_subscribers is the Phase 60 opt-in roster), and pins Task 1 findings.

    Conditionally extend rag_chunks (only if Task 1 found created_by absent):
    - `alter table public.rag_chunks add column if not exists created_by uuid references auth.users(id);`
    - Add index `create index if not exists rag_chunks_created_by_idx on public.rag_chunks (created_by);`
    - Comment column `comment on column public.rag_chunks.created_by is 'Phase 60: scrape/federated-fetch actor; 2-person rule guard in approve_rag_chunk requires auth.uid() <> created_by. Pre-Phase-60 rows are NULL — those bypass the rule per migration header note.'`

    Define table `public.federated_sources` (3-row seed):
    - Columns: `name text primary key check (name in ('pubmed','openfda','dailymed'))`, `enabled boolean not null default false`, `auto_tier_a boolean not null default true`, `sync_cron text not null default '0 3 * * *'`, `last_sync_at timestamptz`, `last_error text`, `last_error_at timestamptz`, `created_at timestamptz not null default now()`, `updated_at timestamptz not null default now()`.
    - Trigger reuse: `create trigger trg_federated_sources_updated_at before update on public.federated_sources for each row execute function public.tg_set_updated_at();` guarded by `if not exists` block (Phase 50 pattern).
    - Seed: `insert into public.federated_sources (name, enabled, auto_tier_a, sync_cron) values ('pubmed', false, true, '0 3 * * *'), ('openfda', false, true, '0 3 * * *'), ('dailymed', false, true, '0 3 * * *') on conflict (name) do nothing;` (idempotent).
    - Enable RLS; policy `federated_sources_staff_all using (public.is_staff()) with check (public.is_staff())` — read + write for staff only; no anon access.

    Define table `public.federated_source_cache` (24h TTL cache):
    - Columns: `id uuid primary key default gen_random_uuid()`, `source_name text not null references public.federated_sources(name) on delete cascade`, `cache_key text not null`, `payload jsonb not null`, `fetched_at timestamptz not null default now()`, `expires_at timestamptz not null`, `updated_at timestamptz not null default now()`.
    - UNIQUE constraint: `constraint federated_source_cache_uq unique (source_name, cache_key)` — enables `INSERT...ON CONFLICT (source_name, cache_key) DO UPDATE SET payload = excluded.payload, expires_at = excluded.expires_at, updated_at = now()`.
    - Partial index `create index if not exists federated_source_cache_expired_idx on public.federated_source_cache (expires_at) where expires_at < now();` to make 60-15 nightly purge cheap.
    - Trigger `trg_federated_source_cache_updated_at` mirroring Phase 50 pattern.
    - Enable RLS; policy `federated_source_cache_staff_read using (public.is_staff())` (staff SELECT only — writes go through service_role from 60-07 Fns).

    Define table `public.newsletter_subscribers` (Phase 60 opt-in roster for RFC 8058 1-click unsubscribe):
    - Columns: `id uuid primary key default gen_random_uuid()`, `user_id uuid references auth.users(id) on delete cascade`, `email text not null`, `opted_in boolean not null default false`, `unsubscribe_token text not null default encode(extensions.gen_random_bytes(32), 'base64')`, `opted_in_at timestamptz`, `opted_out_at timestamptz`, `created_at timestamptz not null default now()`, `updated_at timestamptz not null default now()`.
    - Note: `unsubscribe_token` uses standard base64 (not base64url) deliberately — kept inside DB only; 60-12 Edge Fn does URL-safe encode at email-render time. Comment column to document this.
    - UNIQUE: `constraint newsletter_subscribers_email_uq unique (email)` (email is the natural opt-in key; user_id can be NULL for guests who subscribe via marketing form).
    - Trigger `trg_newsletter_subscribers_updated_at`.
    - Enable RLS; policies:
      - `newsletter_subscribers_owner_select using (auth.uid() = user_id)` — authenticated user reads own row.
      - `newsletter_subscribers_token_anon_select to anon using (true)` — anon CAN SELECT, but the only filter the Edge Fn applies is `unsubscribe_token = $1`; combined with 256-bit unguessable token, this enables the [[feedback_rls_stored_token_verification_pattern]] flow without exposing PII to mass-scrape (token-bearer pattern). Document the policy with comment-on-policy.
      - `newsletter_subscribers_staff_all using (public.is_staff()) with check (public.is_staff())` — admin oversight.
      - INSERT/UPDATE policy: writes only via service_role from 60-12 sender Fn (no client write policy).

    Define table `public.kb_chunk_rejections` (audit log per CONTEXT.md D-rejection-audit):
    - Columns: `id uuid primary key default gen_random_uuid()`, `chunk_id uuid not null references public.rag_chunks(id) on delete cascade`, `reason public.rag_reject_reason not null`, `notes text`, `actor_id uuid not null references auth.users(id)`, `at timestamptz not null default now()`.
    - Index `create index if not exists kb_chunk_rejections_chunk_id_idx on public.kb_chunk_rejections (chunk_id);` for `/admin/rag/sources` 30d rolling rejection count (D-16 trust-downgrade signal).
    - Index `create index if not exists kb_chunk_rejections_at_idx on public.kb_chunk_rejections (at desc);` for chronological listing.
    - Enable RLS; policies:
      - `kb_chunk_rejections_staff_select using (public.is_staff())` — staff read.
      - NO authenticated UPDATE/DELETE policy — insert-only audit; only service_role can purge (out-of-scope per T-60-01-03 disposition).
      - INSERT policy: `kb_chunk_rejections_staff_insert with check (public.is_staff() and auth.uid() = actor_id)` — actor_id MUST match caller (prevents staff from forging audit entries).

    Footer: `comment on table` for each of the 4 new tables documenting Phase 60 ownership + plan ID. End with `-- end migration 20281201000001` sentinel so grep counters can verify file completion.
  </action>
  <verify>
    <automated>bash -c "cd /Users/karstenhaldan/minisite && test -f supabase/migrations/20281201000001_phase60_kb_tables.sql && grep -c 'create table if not exists public\\.' supabase/migrations/20281201000001_phase60_kb_tables.sql | grep -qE '^[4-9]$|^1[0-9]' && grep -c 'on conflict (name) do nothing' supabase/migrations/20281201000001_phase60_kb_tables.sql && grep -c 'enable row level security' supabase/migrations/20281201000001_phase60_kb_tables.sql"</automated>
  </verify>
  <done>
    - File exists; ≥4 `create table if not exists` statements (federated_sources, federated_source_cache, newsletter_subscribers, kb_chunk_rejections); idempotent re-run is a no-op.
    - 3-row seed of federated_sources lands via `on conflict (name) do nothing`.
    - RLS enabled on all 4 new tables; staff-only + token-bearer policies as specified.
    - UNIQUE constraints `(source_name, cache_key)` and `(email)` present.
    - Migration timestamp `20281201000001` strictly after head `20280401000007`.
    - Comment header pins Task 1 findings re created_by + push category absence.
  </done>
</task>

<task type="auto">
  <name>Task 3: Write 5 SECDEF state-machine RPCs migration 20281201000002_phase60_secdef_rpcs.sql</name>
  <files>supabase/migrations/20281201000002_phase60_secdef_rpcs.sql</files>
  <read_first>supabase/migrations/20261101000006_is_staff_helper.sql (SECDEF + search_path pattern), .planning/phases/50-admin-curated-rag-knowledge-base-peptide-topic-research-scra/50-06-PLAN.md Task 1 (5 RPC convention from Phase 50), Task 2 output (kb_chunk_rejections shape)</read_first>
  <action>
    Write `supabase/migrations/20281201000002_phase60_secdef_rpcs.sql` defining 5 SECURITY DEFINER RPCs. Every RPC:
    - `language plpgsql security definer set search_path = public, extensions, pg_catalog`
    - Starts with: `if not public.is_staff() then raise exception 'not authorized' using errcode = '42501'; end if;`
    - `revoke all on function ... from public; grant execute on function ... to authenticated;` (NOT anon)
    - Comment on function documenting which Phase 60 plan(s) call it + which RAG-* requirement it satisfies.

    RPC 1 — `public.approve_rag_chunk(p_chunk_id uuid) returns void`:
    - Body declares a CTE or SELECT for the chunk's `created_by` and `status`.
    - 2-person rule guard: `select created_by, status into v_created_by, v_status from public.rag_chunks where id = p_chunk_id for update;` then `if v_created_by is not null and v_created_by = auth.uid() then raise exception '2-person rule: publisher (%) cannot equal creator (%)', auth.uid(), v_created_by using errcode = '42501'; end if;` — pre-Phase-60 rows where `created_by IS NULL` bypass this guard (documented in column comment from Task 2).
    - State precondition: `if v_status not in ('queued','re-queued') then raise exception 'cannot approve chunk in status %', v_status; end if;`
    - UPDATE: `update public.rag_chunks set status = 'approved', published_at = now(), reviewed_by = auth.uid(), reviewed_at = now() where id = p_chunk_id;`
    - Note: uses `for update` lock on the SELECT to prevent race conditions between two staff members simultaneously approving.

    RPC 2 — `public.reject_rag_chunk(p_chunk_id uuid, p_reason public.rag_reject_reason, p_notes text default null) returns void`:
    - p_reason is the existing `rag_reject_reason` enum (off-topic|factually-wrong|off-label|low-quality|duplicate|safety-concern) — Postgres validates the value at call site; no manual `if p_reason not in (...)` check needed.
    - SELECT/lock current status; require `v_status in ('queued','re-queued')`.
    - UPDATE rag_chunks: `set status = 'rejected', reject_reason = p_reason, reviewed_by = auth.uid(), reviewed_at = now()`.
    - AUDIT WRITE: `insert into public.kb_chunk_rejections (chunk_id, reason, notes, actor_id) values (p_chunk_id, p_reason, p_notes, auth.uid());` — required by D-rejection-audit. Wrap in a defensive `begin ... exception when others then raise warning 'audit insert failed: %', sqlerrm; end;` so a transient audit failure does NOT block the rejection itself.
    - Note: 2-person rule does NOT apply to reject (per CONTEXT.md — rejecting your own chunk is allowed; ONLY publishing requires a second pair of eyes).

    RPC 3 — `public.retract_rag_chunk(p_chunk_id uuid, p_reason text) returns void`:
    - State precondition: `v_status = 'approved'` (can only retract a published chunk).
    - UPDATE: `set status = 'retracted', retracted_at = now(), retracted_reason = p_reason, reviewed_by = auth.uid()`.
    - Note: retract is also subject to the 2-person rule per CONTEXT.md interpretation — the staffer who originally published the chunk cannot be the one retracting it without a second reviewer. Implement the same `auth.uid() <> reviewed_by` guard (where `reviewed_by` was the publisher). Document the rule application in the function comment.

    RPC 4 — `public.queue_rag_chunk(p_chunk_id uuid) returns void`:
    - Used by the scraper/federated adapter to re-queue an edited or previously-rejected chunk.
    - State precondition: `v_status in ('rejected','retracted','approved')`.
    - UPDATE: `set status = 're-queued', published_at = null, retracted_at = null, retracted_reason = null, reviewed_by = null, reviewed_at = null;` (clears review state so 2-person rule applies fresh on next approve).
    - Does NOT touch `reject_reason` (retains rejection history for analytics).

    RPC 5 — `public.list_rag_review_queue(p_limit int default 50, p_offset int default 0, p_tier text default null, p_topic_tag text default null) returns table (chunk_id uuid, topic_tag text, source_tier public.rag_source_tier, summary text, source_url text, created_by uuid, created_by_email text, scraped_at timestamptz, queue_age_hours numeric)`:
    - Reads `public.rag_chunks` filtered to `status in ('queued','re-queued')` + optional tier/tag filters.
    - JOIN `auth.users` (NOT `public.profiles` per [[reference_profiles_email_vs_auth_users_email]]) to surface the creator's email: `left join auth.users u on u.id = c.created_by`.
    - `queue_age_hours = extract(epoch from (now() - c.scraped_at)) / 3600`.
    - Filter clauses use parameterized comparisons (`(p_tier is null or c.source_tier::text = p_tier)`); no string interpolation.
    - Caller (60-08 UI) uses `created_by_email` to render the 2-person-rule badge (publish disabled when `currentUserId === created_by` — though UI compares UUID not email, the email helps audit context).
    - Order by `scraped_at asc` (FIFO queue).

    Footer comment block documents the 3-layer 2-person rule invariant: DB layer (this file), UI layer (60-08), CI eval layer (60-03) per [[feedback_3_layer_must_never_invariant_pattern]].
  </action>
  <verify>
    <automated>bash -c "cd /Users/karstenhaldan/minisite && test -f supabase/migrations/20281201000002_phase60_secdef_rpcs.sql && grep -c 'create or replace function public\\.' supabase/migrations/20281201000002_phase60_secdef_rpcs.sql | grep -E '^[5-9]$' && grep -c 'security definer' supabase/migrations/20281201000002_phase60_secdef_rpcs.sql | grep -E '^[5-9]$' && grep -c 'public.is_staff()' supabase/migrations/20281201000002_phase60_secdef_rpcs.sql | grep -qvE '^[01234]$' && grep -c '2-person rule' supabase/migrations/20281201000002_phase60_secdef_rpcs.sql && grep -c 'auth.users' supabase/migrations/20281201000002_phase60_secdef_rpcs.sql && ! grep -q 'profiles.email\\|profiles\\.email' supabase/migrations/20281201000002_phase60_secdef_rpcs.sql"</automated>
  </verify>
  <done>
    - File exists; ≥5 `create or replace function public.` definitions (approve/reject/retract/queue/list_review_queue).
    - Every function has `security definer`, `set search_path = public, extensions, pg_catalog`, `is_staff()` guard, `revoke all from public`, `grant execute to authenticated`.
    - `approve_rag_chunk` and `retract_rag_chunk` both contain the literal string `2-person rule` in the error message body (greppable).
    - `reject_rag_chunk` writes to `public.kb_chunk_rejections` (greppable: `insert into public.kb_chunk_rejections`).
    - `list_rag_review_queue` JOINs `auth.users` (NOT `public.profiles`); grep confirms zero `profiles.email` references.
    - Function comments cite the 3-layer invariant ([[feedback_3_layer_must_never_invariant_pattern]]).
  </done>
</task>

<task type="auto">
  <name>Task 4: Write push-category widening migration 20281201000003_phase60_push_categories.sql</name>
  <files>supabase/migrations/20281201000003_phase60_push_categories.sql</files>
  <read_first>supabase/migrations/20280201000002_p54_notification_helpdesk_widening.sql (Phase 54 widening pattern — pattern to follow verbatim), supabase/migrations/20271001000005_p49_notification_digest_widening.sql (P49 baseline 15-category list)</read_first>
  <action>
    Write `supabase/migrations/20281201000003_phase60_push_categories.sql` following the Phase 54 widening pattern verbatim (single BEGIN/COMMIT transaction, drop+add CHECK on all 4 tables, INSERT default config row ON CONFLICT DO NOTHING, comment-on-constraint for live references).

    Top comment header lists the FULL 16-category set as-of Phase 54 (15 P49 categories + helpdesk-reply) and notes Phase 60 appends `research_tips` → 17 total. Document that drift between any of the 4 CHECK constraints causes silent Edge Fn rejection (Pitfall 4 from 54-RESEARCH.md).

    Transaction body (literal pattern from 20280201000002):

    1. `alter table public.notification_settings drop constraint if exists notification_settings_category_chk, add constraint notification_settings_category_chk check (category in (...));` — full 16 from Phase 54 + `'research_tips'`.

    2. `alter table public.notification_category_config drop constraint if exists notification_category_config_category_chk, add constraint notification_category_config_category_chk check (category in (...));` — same list.

    3. `alter table public.user_notifications drop constraint if exists user_notifications_category_chk, add constraint user_notifications_category_chk check (category in (...));` — same list.

    4. `alter table public.notification_dismissal_state drop constraint if exists notification_dismissal_state_category_chk, add constraint notification_dismissal_state_category_chk check (category in (...));` — same list.

    5. Seed defaults for `research_tips` per CONTEXT.md Tip-of-Day decisions (single tip per day; honors Phase 54 freq-cap + quiet-hours):
       `insert into public.notification_category_config (category, daily_cap, weekly_cap, urgent_escalation, push_enabled_default, email_enabled_default, in_app_enabled_default) values ('research_tips', 1, 7, false, true, true, true) on conflict (category) do nothing;`

    6. Comment-on-constraint documentation (mirrors Phase 54 §6) so plan-checker greps count `research_tips` as a live reference in the migration body:
       `comment on constraint notification_settings_category_chk on public.notification_settings is 'Phase 60 widened: includes research_tips (RAG-07) appended to Phase 54 16-category set.';`
       Repeat for `notification_category_config_category_chk`.

    The full category list to embed in each of the 4 CHECK constraints (exact strings, order preserved from Phase 54 + appended `'research_tips'`):
    `'dose-reminders', 'ai-insights', 'clinic-alerts', 'billing', 'marketing', 'community-mentions', 'community-replies', 'community-dm', 'community-admin-report', 'event_reminders_1d', 'event_reminders_1h', 'event_promotion', 'banned_word_escalate', 'daily_community_digest', 'weekly_community_digest', 'helpdesk-reply', 'research_tips'`

    Footer: end transaction with `commit;`. Add sentinel `-- end migration 20281201000003`.
  </action>
  <verify>
    <automated>bash -c "cd /Users/karstenhaldan/minisite && test -f supabase/migrations/20281201000003_phase60_push_categories.sql && grep -c \"'research_tips'\" supabase/migrations/20281201000003_phase60_push_categories.sql | grep -qE '^[5-9]$|^[12][0-9]$' && grep -c 'drop constraint if exists' supabase/migrations/20281201000003_phase60_push_categories.sql | grep -E '^[4-9]$' && grep -q '^begin;' supabase/migrations/20281201000003_phase60_push_categories.sql && grep -q '^commit;' supabase/migrations/20281201000003_phase60_push_categories.sql && grep -c 'helpdesk-reply' supabase/migrations/20281201000003_phase60_push_categories.sql | grep -E '^[4-9]$'"</automated>
  </verify>
  <done>
    - File exists; transaction-bounded (single `begin;`/`commit;`).
    - All 4 notification_* CHECK constraints widened with literal `'research_tips'` (≥5 occurrences across CHECKs + seed + comment-on-constraint per Phase 54 grep convention).
    - Phase 54 baseline `'helpdesk-reply'` preserved in every CHECK (≥4 occurrences proves no list-drift).
    - Seed row INSERT into `notification_category_config` with `on conflict (category) do nothing` idempotent guard.
    - Comment-on-constraint documents Phase 60 ownership + RAG-07 requirement ID.
  </done>
</task>

<task type="auto">
  <name>Task 5: Local validity check — supabase db push --dry-run on all 3 files</name>
  <files>(no files modified; verification only)</files>
  <read_first>None — runs CLI against the 3 migrations written in Tasks 2-4.</read_first>
  <action>
    From git root `/Users/karstenhaldan/minisite/`, run `supabase db push --linked --dry-run` and confirm:
    1. The 3 Phase 60 migrations (20281201000001/02/03) are listed in the "Applying migration" plan output (NOT skipped — `Skipping migration ...` indicates a back-dating bug; if observed, halt and surface to operator per [[reference_supabase_back_dated_migration_blocks_push]]).
    2. No SQL parser errors in the dry-run output. Common failures to grep for: `syntax error at or near`, `cannot drop constraint`, `relation does not exist`, `type does not exist`, `function does not exist`.
    3. If `--dry-run` is not supported on the installed CLI version (some older versions), fall back to local SQL parser sanity-check: `for f in 20281201000001_phase60_kb_tables 20281201000002_phase60_secdef_rpcs 20281201000003_phase60_push_categories; do psql --version >/dev/null 2>&1 && psql -h /tmp -d postgres --set ON_ERROR_STOP=1 -f supabase/migrations/$f.sql --dry-run 2>&1 || true; done` — if psql is not available, skip this fallback and rely on Task 6 production push verification in 60-15.

    Do NOT execute `supabase db push --linked` (without `--dry-run`) in this plan; that is owned by 60-15 BLOCKING task per [[feedback_fn_deploy_before_cron_db_push]] strict ordering.

    Record dry-run output as a comment block at the bottom of the plan's eventual SUMMARY.md (executor handles SUMMARY).
  </action>
  <verify>
    <automated>bash -c "cd /Users/karstenhaldan/minisite && supabase db push --linked --dry-run 2>&1 | tee /tmp/phase60_p1_dryrun.log | grep -E '20281201000001|20281201000002|20281201000003' | grep -v Skipping | wc -l | grep -qE '^[3-9]$|^[1-9][0-9]+$'"</automated>
  </verify>
  <done>
    - `supabase db push --linked --dry-run` lists all 3 Phase 60 migration files as PENDING (not Skipping).
    - Zero SQL parser errors surfaced in dry-run output.
    - Output captured to `/tmp/phase60_p1_dryrun.log` for SUMMARY.md attachment by executor.
  </done>
</task>

<task type="auto">
  <name>Task 6: Static-grep guardrail sweep on all 3 migrations</name>
  <files>(no files modified; guardrail verification only)</files>
  <read_first>None — purely greps Tasks 2-4 outputs.</read_first>
  <action>
    Run the static-grep guardrail sweep that codifies the threat-model mitigations + reference-tag requirements. Each grep below is an independent invariant. Any failure halts the plan for fix-in-place (do NOT proceed to commit).

    Anti-pattern bans (all must score zero hits, with header-comment exclusion via `grep -v '^--'`):
    1. `grep -v '^--' supabase/migrations/20281201000002_phase60_secdef_rpcs.sql | grep -c 'profiles\\.email'` MUST equal 0 (T-60-01-04: use auth.users.email).
    2. `grep -v '^--' supabase/migrations/20281201000001_phase60_kb_tables.sql supabase/migrations/20281201000002_phase60_secdef_rpcs.sql supabase/migrations/20281201000003_phase60_push_categories.sql | grep -c 'cron.schedule'` MUST equal 0 (Fn-deploy-before-cron-push: cron registration is 60-15's job).
    3. `grep -v '^--' supabase/migrations/20281201000001_phase60_kb_tables.sql | grep -c 'staff_users'` MUST equal 0 (use public.is_staff() helper, NOT parallel staff_users table per [[reference_supabase_is_staff_helper]] + [[feedback_negation_grep_defeated_by_comment_string]] — strip comments first).
    4. `grep -v '^--' supabase/migrations/20281201000001_phase60_kb_tables.sql | grep -c 'do delete'` MUST equal 0 ([[reference_postgres_no_insert_on_conflict_do_delete]] — use SELECT FOR UPDATE then branch instead).

    Positive invariants (all must score ≥ expected hits):
    5. `grep -c 'public.is_staff()' supabase/migrations/20281201000002_phase60_secdef_rpcs.sql` MUST be ≥5 (one per RPC).
    6. `grep -cE 'security definer\\s*$|security definer' supabase/migrations/20281201000002_phase60_secdef_rpcs.sql` MUST be ≥5.
    7. `grep -cE 'set search_path\\s*=' supabase/migrations/20281201000002_phase60_secdef_rpcs.sql` MUST be ≥5.
    8. `grep -cE 'grant execute on function public\\.[a-z_]+ to authenticated' supabase/migrations/20281201000002_phase60_secdef_rpcs.sql` MUST be ≥5.
    9. `grep -cE 'revoke all on function public\\.[a-z_]+ from public' supabase/migrations/20281201000002_phase60_secdef_rpcs.sql` MUST be ≥5.
    10. `grep -c '2-person rule' supabase/migrations/20281201000002_phase60_secdef_rpcs.sql` MUST be ≥2 (approve + retract paths).
    11. `grep -c 'on conflict' supabase/migrations/20281201000001_phase60_kb_tables.sql` MUST be ≥2 (federated_sources seed + at least one DO UPDATE example or comment).
    12. `grep -c 'enable row level security' supabase/migrations/20281201000001_phase60_kb_tables.sql` MUST be ≥4 (all 4 new tables).
    13. `grep -cE \"'research_tips'\" supabase/migrations/20281201000003_phase60_push_categories.sql` MUST be ≥5 (4 CHECKs + 1 seed; +2 in comment-on-constraint = 7 ideal).
    14. `grep -c 'helpdesk-reply' supabase/migrations/20281201000003_phase60_push_categories.sql` MUST be ≥4 (preserves Phase 54 baseline across all 4 CHECKs).

    Composite expression: emit PASS line `PHASE60_P1_GUARDRAIL_PASS=true` only when ALL 14 invariants satisfied; otherwise emit `PHASE60_P1_GUARDRAIL_FAIL=<list-of-failed-invariant-numbers>` and halt.
  </action>
  <verify>
    <automated>bash -c "cd /Users/karstenhaldan/minisite && FAILS=''; for cmd in \"grep -v '^--' supabase/migrations/20281201000002_phase60_secdef_rpcs.sql | grep -c 'profiles\\.email'|0\" \"grep -c 'public.is_staff()' supabase/migrations/20281201000002_phase60_secdef_rpcs.sql|5\" \"grep -c 'enable row level security' supabase/migrations/20281201000001_phase60_kb_tables.sql|4\" \"grep -cE \\\"'research_tips'\\\" supabase/migrations/20281201000003_phase60_push_categories.sql|5\" \"grep -c 'helpdesk-reply' supabase/migrations/20281201000003_phase60_push_categories.sql|4\"; do COUNT=\\$(eval \\\"\\$(echo \\$cmd | cut -d'|' -f1)\\\"); EXPECTED=\\$(echo \\$cmd | cut -d'|' -f2); if [ \\\"\\$COUNT\\\" = \\\"0\\\" ] && [ \\\"\\$EXPECTED\\\" = \\\"0\\\" ]; then continue; fi; if [ \\\"\\$COUNT\\\" -lt \\\"\\$EXPECTED\\\" ] 2>/dev/null; then FAILS=\\\"\\$FAILS \\$cmd\\\"; fi; done; if [ -z \\\"\\$FAILS\\\" ]; then echo PHASE60_P1_GUARDRAIL_PASS=true; else echo PHASE60_P1_GUARDRAIL_FAIL=\\\"\\$FAILS\\\"; exit 1; fi"</automated>
  </verify>
  <done>
    - All 14 static-grep invariants satisfied.
    - Bash sweep emits `PHASE60_P1_GUARDRAIL_PASS=true`.
    - No anti-pattern hits (profiles.email, cron.schedule, staff_users, do delete).
    - All positive invariants meet or exceed expected count.
  </done>
</task>

<task type="auto">
  <name>Task 7: Vitest data-layer contract suite (RPC signatures + RLS shape)</name>
  <files>leanshot/src/lib/rag/__tests__/phase60-data-layer.test.ts</files>
  <read_first>leanshot/src/lib/admin/rag/rag-api.ts (existing Phase 50 RPC-wrapper convention, if present in repo — fall back to direct supabase.rpc() if not), leanshot/vite.config.ts (vitest config root per [[reference_vitest_4_projects_config_masks_default]])</read_first>
  <action>
    Write `leanshot/src/lib/rag/__tests__/phase60-data-layer.test.ts` as a STATIC-ANALYSIS vitest suite that asserts the migration files conform to the contract — no live Supabase call required (avoids the [[reference_sentry_capacitor_npm_install_blocker]] node_modules requirement for live RPC). The suite reads the 3 migration files via `fs.readFileSync` and asserts structural properties via regex/string match.

    Test cases (one `it()` block per invariant; vitest `describe('Phase 60 data layer migrations', () => {...})`):

    1. `it('20281201000001 defines federated_sources with 3-row seed')` — reads file, asserts `create table if not exists public.federated_sources` present, asserts 3-row seed regex `insert into public\\.federated_sources[\\s\\S]*?('pubmed'[\\s\\S]*?'openfda'[\\s\\S]*?'dailymed'|'pubmed'[\\s\\S]*?'dailymed'[\\s\\S]*?'openfda')` matches with `on conflict (name) do nothing`.
    2. `it('20281201000001 defines federated_source_cache with (source_name, cache_key) UNIQUE')` — asserts `unique (source_name, cache_key)` present.
    3. `it('20281201000001 defines newsletter_subscribers with unsubscribe_token default')` — asserts `unsubscribe_token text not null default` regex matches with `gen_random_bytes(32)`.
    4. `it('20281201000001 defines kb_chunk_rejections with chunk_id + reason + actor_id + at columns')` — asserts each column literal present.
    5. `it('20281201000001 enables RLS on all 4 new tables')` — counts occurrences of `enable row level security` and asserts ≥4.
    6. `it('20281201000002 defines exactly 5 SECDEF RPCs')` — counts `create or replace function public\\.(approve|reject|retract|queue|list)_rag_(chunk|review_queue)` matches; asserts ≥5.
    7. `it('20281201000002 every RPC has is_staff() guard')` — counts `public.is_staff()` matches; asserts ≥5.
    8. `it('20281201000002 approve_rag_chunk enforces 2-person rule')` — asserts regex `auth\\.uid\\(\\)\\s*=\\s*v_created_by` (or `created_by = auth.uid()`) inside the `approve_rag_chunk` function body, AND error message contains literal `2-person rule`.
    9. `it('20281201000002 reject_rag_chunk writes audit row to kb_chunk_rejections')` — asserts `insert into public.kb_chunk_rejections` inside the reject function body.
    10. `it('20281201000002 list_rag_review_queue uses auth.users not profiles.email')` — asserts `auth.users` present AND `profiles.email` absent (sliced comments via line-prefix `--` exclusion).
    11. `it('20281201000002 grants execute to authenticated, revokes from public')` — counts `grant execute on function public\\.[a-z_]+ to authenticated` and `revoke all on function public\\.[a-z_]+ from public`; both ≥5.
    12. `it('20281201000003 widens 4 notification_* CHECK constraints with research_tips')` — counts `drop constraint if exists` (≥4) AND `'research_tips'` (≥5 — 4 CHECKs + 1 seed; ideally 7 with 2 comment-on-constraint).
    13. `it('20281201000003 preserves Phase 54 helpdesk-reply baseline')` — counts `helpdesk-reply` ≥4 across the 4 CHECKs.
    14. `it('20281201000003 seeds notification_category_config with research_tips defaults')` — asserts `insert into public.notification_category_config[\\s\\S]*?'research_tips'[\\s\\S]*?on conflict (category) do nothing` matches AND `daily_cap` is `1`, `weekly_cap` is `7`.
    15. `it('no migration in this plan registers cron.schedule')` — reads all 3 files; counts `cron.schedule(` matches; asserts EQUAL 0 (per [[feedback_fn_deploy_before_cron_db_push]]).
    16. `it('no migration uses do delete (anti-pattern per Postgres)')` — counts case-insensitive `do delete` outside of `--` comments; asserts 0.
    17. `it('all migration timestamps are post-head 20280401000007')` — parses filenames; asserts each prefix `>= 20281201000001`.

    Use `fs.readFileSync('/Users/karstenhaldan/minisite/supabase/migrations/20281201000001_phase60_kb_tables.sql', 'utf8')` etc. — absolute paths so the test is cwd-agnostic (leanshot subdir vs git root). Strip line-prefix `^\\s*--.*$` before grep counts to avoid the [[feedback_negation_grep_defeated_by_comment_string]] trap.

    Run command MUST use `npx vitest run --config vite.config.ts src/lib/rag/__tests__/phase60-data-layer.test.ts` per [[reference_vitest_4_projects_config_masks_default]] (default `npm test` may collect 0 tests).
  </action>
  <verify>
    <automated>bash -c "cd /Users/karstenhaldan/minisite/leanshot && npx vitest run --config vite.config.ts src/lib/rag/__tests__/phase60-data-layer.test.ts 2>&1 | tail -30"</automated>
  </verify>
  <done>
    - Test file exists at `leanshot/src/lib/rag/__tests__/phase60-data-layer.test.ts`.
    - All 17 `it()` blocks pass green via `npx vitest run --config vite.config.ts`.
    - Suite executes in <10s (pure file-read + regex; no DB calls).
    - Suite contributes to the phase-wide vitest baseline tracking per [[reference_vitest_4_projects_config_masks_default]].
  </done>
</task>

</tasks>

<verification>

## Plan-Level Verification

- All 3 migration files exist at `supabase/migrations/20281201000001_phase60_kb_tables.sql`, `20281201000002_phase60_secdef_rpcs.sql`, `20281201000003_phase60_push_categories.sql`.
- `supabase db push --linked --dry-run` lists all 3 as PENDING with zero parser errors.
- Static-grep guardrail sweep (Task 6) emits `PHASE60_P1_GUARDRAIL_PASS=true`.
- Vitest contract suite (Task 7) passes all 17 invariants.
- Migration timestamps strictly post-head (`20281201000001` > `20280401000007`).
- Zero `cron.schedule(...)` calls across the 3 files.

## Downstream-Dependency Sanity

- Wave 1 plans 60-04 / 60-05 / 60-06 / 60-07 / 60-08 / 60-09 all reference these tables/RPCs; this plan ships the contract surface they import against. Plan-checker for Wave 1 plans MUST grep this file's frontmatter `files_modified` to confirm the contract is in place before approving Wave 1 dispatch.

## Live-DB Verification (DEFERRED to 60-15)

Per [[feedback_fn_deploy_before_cron_db_push]], live `supabase db push --linked` is owned by 60-15. After 60-15 push, operator can verify:
- `select count(*) from public.federated_sources;` returns 3.
- `select proname from pg_proc where proname like '%_rag_chunk%' or proname = 'list_rag_review_queue';` returns 5 rows.
- `select category from public.notification_category_config where category = 'research_tips';` returns 1 row.

</verification>

<success_criteria>

- 3 migration files written, idempotent, post-head timestamped.
- 4 new tables (federated_sources seeded with 3 rows, federated_source_cache, newsletter_subscribers, kb_chunk_rejections) with RLS + UNIQUE constraints + triggers.
- 5 SECDEF RPCs with is_staff() guard + 2-person rule on approve/retract + audit-row writer on reject + auth.users JOIN (not profiles).
- research_tips push category widened into 4 notification_* CHECK constraints + seeded with single-tip-per-day defaults.
- Vitest contract suite passes 17 invariants.
- Static-grep guardrail sweep passes 14 invariants.
- Zero cron.schedule calls (deferred to 60-15).
- Plan executor commits 3 SQL files + 1 vitest file in a single autonomous run; no human checkpoint.

</success_criteria>

<output>

Create `.planning/phases/60-rag-knowledge-base-completion-waves-2-4/60-01-data-layer-migrations-SUMMARY.md` when done. Include:

1. **Task 1 findings**: rag_chunks.created_by status (present/absent + decision); migration head timestamp confirmed.
2. **Files written**: paths + line counts of the 3 SQL migrations + the vitest contract suite.
3. **Guardrail sweep**: paste the `PHASE60_P1_GUARDRAIL_PASS=true` output line.
4. **Vitest contract suite**: paste the `Test Files X passed (X)` summary line.
5. **Dry-run log**: attach `/tmp/phase60_p1_dryrun.log` excerpt showing 3 PENDING migrations.
6. **Carry-overs for 60-15**: `db push --linked` of these 3 migrations is gated on Wave 1 Fn deploys completing; flag in CARRY-OVER.md.
7. **Downstream interface contract** (for Wave 1 planners): list the 4 table names + 5 RPC signatures + research_tips category so Wave 1 plan-checkers can verify against this fixed surface.

</output>
