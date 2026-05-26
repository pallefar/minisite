---
phase: 64-legal-refresh
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - supabase/migrations/20290103000001_privacy_optout_requests.sql
  - supabase/migrations/20290103000002_policy_notice_log.sql
  - supabase/migrations/20290103000003_ad_targeting_exclusion.sql
  - supabase/migrations/20290103000004_email_lifecycle_exclusion.sql
  - supabase/migrations/20290103000005_data_rights_requests.sql
autonomous: true
requirements:
  - LEGAL-02
  - LEGAL-03
  - LEGAL-04
  - LEGAL-09
user_setup: []

must_haves:
  truths:
    - "Submitting Do-Not-Sell form persists a row in privacy_optout_requests"
    - "Grandfathered email send is idempotent — second invocation skips already-emailed users"
    - "Ad-network targeting consumer can read exclusion rows for opt-out users"
    - "Email-lifecycle senders skip users present in email_lifecycle_exclusion"
    - "DSAR portal can insert state-flavor request rows with CCPA/VA-CDPA/CO-CPA/CT-CTDPA/UT-UCPA request_type values"
  artifacts:
    - path: "supabase/migrations/20290103000001_privacy_optout_requests.sql"
      provides: "privacy_optout_requests table + RLS + indexes"
      contains: "create table public.privacy_optout_requests"
    - path: "supabase/migrations/20290103000002_policy_notice_log.sql"
      provides: "policy_notice_log table with UNIQUE(user_id) for idempotent sends"
      contains: "create table public.policy_notice_log"
    - path: "supabase/migrations/20290103000003_ad_targeting_exclusion.sql"
      provides: "ad_targeting_exclusion table + RLS"
      contains: "create table public.ad_targeting_exclusion"
    - path: "supabase/migrations/20290103000004_email_lifecycle_exclusion.sql"
      provides: "email_lifecycle_exclusion table + RLS"
      contains: "create table public.email_lifecycle_exclusion"
    - path: "supabase/migrations/20290103000005_data_rights_requests.sql"
      provides: "data_rights_requests table with state_residency + request_type enum"
      contains: "create table public.data_rights_requests"
  key_links:
    - from: "supabase/functions/privacy-optout-process (Plan 64-02)"
      to: "privacy_optout_requests + ad_targeting_exclusion + email_lifecycle_exclusion"
      via: "INSERT on form submit + fan-out INSERTs in same Fn"
      pattern: "supabase.*from\\('(privacy_optout_requests|ad_targeting_exclusion|email_lifecycle_exclusion)'\\)"
    - from: "supabase/functions/grandfathered-policy-notice (Plan 64-03)"
      to: "policy_notice_log"
      via: "INSERT … ON CONFLICT (user_id) DO NOTHING"
      pattern: "policy_notice_log.*on conflict"
    - from: "src/components/dsar/DsarPortalPage.tsx (Plan 64-06)"
      to: "data_rights_requests"
      via: ".from('data_rights_requests').insert({ state_residency, request_type })"
      pattern: "data_rights_requests"
---

<objective>
Create five new Postgres tables backing the Phase 64 legal-refresh data flows: opt-out request log (Do-Not-Sell), policy-notice idempotency log (grandfathered email), ad-network exclusion list, email-lifecycle exclusion list, and the state-flavor DSAR request log. All five are referenced by Plans 64-02 (privacy-optout-process Fn fan-out), 64-03 (grandfathered-policy-notice Fn), 64-04 (Plan 04 reads subprocessor list — separate table, not in this plan), and 64-06 (DSAR state-residency extension).

Purpose: All Phase 64 user-flows hit Postgres for persistence + propagation. Without this schema, Plans 64-02/03/06 cannot ship.

Output: Five `20290103*` migration files. Wave 2 close-out (Plan 64-08) runs `npx supabase db push --linked` against project `ytnsipxxmzgaebkqmokp` to apply.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/phases/64-legal-refresh/64-CONTEXT.md
@.planning/REQUIREMENTS.md

<!-- Migration analog patterns (Phase 22, 60, 62) -->
@supabase/migrations/20290102000003_research_consent_columns.sql
@supabase/migrations/20290102000001_insights_schema.sql

<!-- Latest migration head: 20290102000010_insights_matviews.sql (verified 2026-05-26). Phase 64 uses 20290103* per CONTEXT.md decision. -->

<interfaces>
<!-- Existing tables referenced -->
public.profiles (id uuid PK = auth.users.id, email_marketing_consent boolean, …)
auth.users (id uuid PK, email text, created_at timestamptz, …)
public.is_staff() returns boolean -- canonical staff RLS guard, supabase/migrations/20261101000006_is_staff_helper.sql

<!-- Constraints from MEMORY/learnings -->
- Bare `CREATE POLICY` (no `IF NOT EXISTS` — unsupported on remote PG per [[feedback_phase_close_out_supabase_gotchas]])
- `auth.users.email` is the email source — `public.profiles` has NO email column ([[reference_profiles_email_vs_auth_users_email]])
- Migration filename dependency order: producer must precede consumer ([[feedback_migration_filename_dependency_order]]) — verify 5 files do not cross-reference until applied
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Create privacy_optout_requests + policy_notice_log + ad_targeting_exclusion + email_lifecycle_exclusion tables</name>
  <files>
    supabase/migrations/20290103000001_privacy_optout_requests.sql,
    supabase/migrations/20290103000002_policy_notice_log.sql,
    supabase/migrations/20290103000003_ad_targeting_exclusion.sql,
    supabase/migrations/20290103000004_email_lifecycle_exclusion.sql
  </files>
  <action>
    Create four migrations, one table each, with the following shape (per D-Do-Not-Sell Opt-Out + D-Grandfathered-Notice-Email + Specifics from 64-CONTEXT.md):

    File 20290103000001_privacy_optout_requests.sql — table `public.privacy_optout_requests`:
    Columns: `id uuid PK default gen_random_uuid()`, `user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL` (nullable — Do-Not-Sell form is auth-optional per UI-SPEC §2), `email text not null`, `name text not null`, `state_residency text not null check (state_residency in ('CA','VA','CO','CT','UT','OTHER'))`, `opt_out_scope text[] not null check (cardinality(opt_out_scope) between 1 and 3 and opt_out_scope <@ array['advertising','sale','sharing'])`, `submitted_at timestamptz not null default now()`, `propagated_at timestamptz` (null until fan-out completes — set by Fn 64-02), `confirmation_email_sent_at timestamptz`, `request_ip text`, `request_user_agent text`. Index: `(email)`, `(user_id) where user_id is not null`, `(submitted_at desc)`. RLS: enable + policies: anonymous can INSERT (Do-Not-Sell form is unauthenticated per UI-SPEC §2 "auth-optional public page"); authenticated users can SELECT their own rows by `user_id = auth.uid() OR email = (select email from auth.users where id = auth.uid())`; `public.is_staff()` can SELECT all + UPDATE propagated_at. NO update by anonymous.

    File 20290103000002_policy_notice_log.sql — table `public.policy_notice_log`:
    Columns: `user_id uuid PK REFERENCES auth.users(id) ON DELETE CASCADE` (PK ensures idempotent ON CONFLICT DO NOTHING per D-Grandfathered-Notice-Email), `sent_at timestamptz not null default now()`, `opened_at timestamptz`, `unsubscribed_at timestamptz`, `resend_message_id text`. Index `(sent_at desc)`. RLS: only `public.is_staff()` can SELECT/INSERT/UPDATE — this is operator + Fn telemetry, no user-facing read.

    File 20290103000003_ad_targeting_exclusion.sql — table `public.ad_targeting_exclusion`:
    Columns: `user_id uuid PK REFERENCES auth.users(id) ON DELETE CASCADE`, `email text not null` (also-keyed for unauth opt-outs — additional UNIQUE index on email for unauth path), `excluded_at timestamptz not null default now()`, `source text not null check (source in ('do_not_sell','admin','manual'))`. Add a partial unique index `create unique index ad_targeting_exclusion_email_unauth_uq on public.ad_targeting_exclusion(email) where user_id is null` — supports anonymous opt-outs that have no user row yet. RLS: only `public.is_staff()` SELECT/INSERT. Edge Fn 64-02 uses service role bypassing RLS.

    File 20290103000004_email_lifecycle_exclusion.sql — table `public.email_lifecycle_exclusion`:
    Columns: `user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE`, `email text not null`, `excluded_at timestamptz not null default now()`, `source text not null check (source in ('do_not_sell','unsubscribe','admin'))`, `PRIMARY KEY (coalesce(user_id, uuid_nil()), email)` — Postgres does not support coalesce in PK directly, so instead: `id uuid PK default gen_random_uuid()` + `UNIQUE (user_id) where user_id is not null` + `UNIQUE (email) where user_id is null`. Two partial unique indexes preserve the dual-key idempotency. RLS: only `public.is_staff()` + service-role-bypassing Edge Fns can INSERT/SELECT.

    Every migration MUST start with `-- Phase 64-01 — Legal Refresh data layer` comment header. Use bare `CREATE POLICY` (no `IF NOT EXISTS`). Wrap each in `BEGIN; … COMMIT;` for atomic apply.
  </action>
  <verify>
    <automated>
      cd /Users/karstenhaldan/minisite &amp;&amp;
      for f in supabase/migrations/2029010300000{1,2,3,4}_*.sql; do
        test -f "$f" || { echo "MISSING: $f"; exit 1; };
        grep -q "Phase 64-01" "$f" || { echo "MISSING HEADER: $f"; exit 1; };
        grep -q "CREATE POLICY\|create policy" "$f" || { echo "MISSING RLS POLICY: $f"; exit 1; };
        grep -v '^--' "$f" | grep -qi "if not exists" &amp;&amp; { echo "FOUND if-not-exists (forbidden on policies): $f"; exit 1; } || true;
      done; echo "OK 4 files";
      grep -L "create table public\.privacy_optout_requests\|create table public\.policy_notice_log\|create table public\.ad_targeting_exclusion\|create table public\.email_lifecycle_exclusion" supabase/migrations/2029010300000{1,2,3,4}_*.sql; test $? -ne 0 &amp;&amp; echo "missing table — recheck" || true
    </automated>
  </verify>
  <done>
    Four migration files exist at the listed paths, each contains a `create table public.<name>` statement plus enabled RLS plus at least one policy.
    None use `CREATE POLICY IF NOT EXISTS`.
    File timestamps are `20290103000001` through `20290103000004` (Phase 64 successor to Phase 62 head `20290102000010`).
  </done>
</task>

<task type="auto">
  <name>Task 2: Create data_rights_requests table with state-flavor enum + RLS</name>
  <files>supabase/migrations/20290103000005_data_rights_requests.sql</files>
  <action>
    Create migration `20290103000005_data_rights_requests.sql` implementing Decision D-DSAR-Portal-Extensions from 64-CONTEXT.md. This is a NEW table (no existing `data_rights_requests` exists — the existing DSAR portal at `src/components/dsar/DsarPortalPage.tsx` writes to `pending_account_deletions` via initiate_account_deletion_rpc).

    Table `public.data_rights_requests`:
    - `id uuid PK default gen_random_uuid()`
    - `user_id uuid not null REFERENCES auth.users(id) ON DELETE CASCADE`
    - `state_residency text not null check (state_residency in ('CA','VA','CO','CT','UT','OTHER'))`
    - `request_type text not null check (request_type in ('deletion','access','portability','correction','opt_out','limit_sensitive_use','opt_in_sensitive'))` — covers union of CA/VA/CO/CT/UT request flavors per D-DSAR-Portal-Extensions
    - `details text` (free-form user note)
    - `status text not null default 'pending' check (status in ('pending','in_progress','completed','rejected'))`
    - `submitted_at timestamptz not null default now()`
    - `completed_at timestamptz`
    - `operator_note text`
    Indexes: `(user_id, submitted_at desc)`, `(status) where status = 'pending'`.
    RLS: enable. Policies:
    - SELECT: `user_id = auth.uid()` OR `public.is_staff()`
    - INSERT: `user_id = auth.uid()` (authenticated users only — DSAR portal is auth-required per UI-SPEC §3)
    - UPDATE: `public.is_staff()` only (status + completed_at + operator_note)
    Use bare `CREATE POLICY`. Wrap in BEGIN/COMMIT. Header comment `-- Phase 64-01 — Legal Refresh data_rights_requests (DSAR state-flavor log)`.
  </action>
  <verify>
    <automated>
      cd /Users/karstenhaldan/minisite &amp;&amp;
      test -f supabase/migrations/20290103000005_data_rights_requests.sql &amp;&amp;
      grep -q "Phase 64-01" supabase/migrations/20290103000005_data_rights_requests.sql &amp;&amp;
      grep -qE "request_type text not null check.*'deletion','access','portability','correction','opt_out','limit_sensitive_use','opt_in_sensitive'" supabase/migrations/20290103000005_data_rights_requests.sql &amp;&amp;
      grep -qE "state_residency text not null check.*'CA','VA','CO','CT','UT','OTHER'" supabase/migrations/20290103000005_data_rights_requests.sql &amp;&amp;
      grep -qi "create policy" supabase/migrations/20290103000005_data_rights_requests.sql &amp;&amp;
      ! grep -i "if not exists" supabase/migrations/20290103000005_data_rights_requests.sql | grep -iv 'create table' &amp;&amp;
      echo OK
    </automated>
  </verify>
  <done>
    `20290103000005_data_rights_requests.sql` exists, declares the table with state_residency + request_type CHECK constraints covering all five state flavors, enables RLS, and ships at least one policy per SELECT/INSERT/UPDATE.
  </done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| anonymous browser → Do-Not-Sell form → privacy_optout_requests INSERT | unauthenticated PII (name + email + state) crosses here |
| authenticated browser → DSAR portal → data_rights_requests INSERT | authenticated PII + state-residency disclosure |
| Edge Fn (service role) → ad_targeting_exclusion + email_lifecycle_exclusion fan-out | service-role bypass of RLS |
| Edge Fn cron / operator → policy_notice_log INSERT | service-role bearer; user-list query against auth.users |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-64-01-01 | Tampering | anonymous INSERT into privacy_optout_requests | mitigate | RLS policy restricts INSERT-only (no UPDATE/DELETE from anon); CHECK constraints validate state_residency + opt_out_scope; rate-limiting enforced at Edge Fn layer in Plan 64-02 |
| T-64-01-02 | Spoofing | anonymous can claim arbitrary email | mitigate | Plan 64-02 confirmation email Round-trips email ownership; only confirmed opt-outs propagate fan-out; raw row visible to staff for fraud review |
| T-64-01-03 | Repudiation | user denies submitting DSAR | mitigate | INSERT defaults submitted_at + records request_ip / user_agent via Plan 64-02 form handler; staff-only UPDATE |
| T-64-01-04 | Information Disclosure | other users read DSAR rows | mitigate | SELECT policy restricts to `auth.uid() = user_id` or `is_staff()` |
| T-64-01-05 | Denial of Service | flood of anonymous Do-Not-Sell submits | mitigate | Plan 64-02 Edge Fn rate-limits by IP (10/h) + CAPTCHA deferred to Phase 70 UAT if abuse observed |
| T-64-01-06 | Elevation of Privilege | regular user updates own DSAR status to 'completed' | mitigate | UPDATE policy is `is_staff()` only — explicit; not implicit via row-ownership |
| T-64-01-SC | Tampering | npm/pip/cargo installs | accept | No new packages installed in this plan; pure SQL migration |
</threat_model>

<verification>
- All 5 migration files exist with `20290103000001`–`20290103000005` filenames
- Each contains the canonical Phase 64 header comment
- Bare `CREATE POLICY` (no IF NOT EXISTS) per [[feedback_phase_close_out_supabase_gotchas]]
- `npx supabase migration list --linked` (in Plan 64-08 close-out) confirms all 5 land sequentially after `20290102000010`
- `data_rights_requests` request_type CHECK covers union of CA/VA/CO/CT/UT request flavors per D-DSAR-Portal-Extensions
</verification>

<success_criteria>
- 5 migration files committed, each one table, RLS-enabled, with stated CHECK constraints
- All four Phase 64 consumer Plans (64-02 Fn fan-out, 64-03 Fn idempotent log, 64-06 DSAR portal insert) can reference these tables by name with no further schema work
- Plan 64-08 close-out applies the 5 migrations via `npx supabase db push --linked` without back-dated-migration block
</success_criteria>

<output>
Create `.planning/phases/64-legal-refresh/64-01-SUMMARY.md` per `$HOME/.claude/get-shit-done/templates/summary.md` when done.
</output>
