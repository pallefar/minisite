---
phase: 19
plan: 1
type: execute
wave: 1
depends_on: []
files_modified:
  - /Users/karstenhaldan/minisite/supabase/migrations/20270101000001_affiliates_schema.sql
  - /Users/karstenhaldan/minisite/supabase/migrations/20270101000002_affiliate_clicks_conversions_payouts.sql
  - /Users/karstenhaldan/minisite/supabase/migrations/20270101000003_subscriptions_provider_guard.sql
  - /Users/karstenhaldan/minisite/supabase/migrations/20270101000004_tier_effective_view.sql
  - /Users/karstenhaldan/minisite/supabase/migrations/20270101000004a_insert_affiliate_impression_fn.sql
  - /Users/karstenhaldan/minisite/supabase/migrations/20270101000005_affiliate_rls.sql
  - /Users/karstenhaldan/minisite/supabase/tests/affiliate_schema.test.sql
  - /Users/karstenhaldan/minisite/supabase/tests/tier_effective_view.test.sql
  - /Users/karstenhaldan/minisite/leanshot/tests/rls/affiliates-rls.test.ts
autonomous: true
requirements: [AFF-01, AFF-08, AFF-09, AFF-10, MONEY-07]
tags: [supabase, postgres, rls, migrations, tier-effective, affiliate-impressions, affiliates-public-view]

must_haves:
  truths:
    - "All 5 affiliate tables (affiliates, affiliate_clicks, affiliate_conversions, affiliate_impressions, payouts) exist with RLS enabled"
    - "Each affiliate can SELECT only their own rows; admins (is_staff=true) can SELECT all"
    - "tier_effective view returns MAX(current_period_end) per user_id and works for Stripe-only rows today"
    - "Inserting a provider='revenuecat' row makes the view return MAX of both providers (D-04 forward-compat)"
    - "affiliate_clicks.user_id and affiliate_conversions.user_id are ON DELETE SET NULL (NEVER cascade) — IRS 7yr retention"
    - "affiliate_impressions.affiliate_id is ON DELETE CASCADE (D-38 — impressions are not IRS records)"
    - "public.insert_affiliate_impression(uuid, text, text, text) SQL function exists (BL-10 helper); SECURITY DEFINER with locked search_path; service_role grant only; truncates IP /24 via set_masklen and writes to affiliate_impressions"
    - "payouts.user_id is ON DELETE SET NULL; payouts rows survive user deletion"
    - "payouts.status enum is the v1.2 reduced set per D-39 — ('pending','processing','paid','failed','blocked_onboarding') — NO 'reversed'"
    - "affiliates.template_choice column exists with check ('coach','story','method'); default 'coach' (BL-3 — moved here from 19-08)"
    - "affiliates_public_view exposes only non-PII columns and filters status='approved' with security_invoker=true (BL-3 — moved here from 19-08)"
    - "pol_affiliates_public_landing_read RLS policy permits anon SELECT through the public view (BL-3 — moved here from 19-08)"
  artifacts:
    - path: "/Users/karstenhaldan/minisite/supabase/migrations/20270101000001_affiliates_schema.sql"
      provides: "affiliates table + tax_threshold_cents (D-31) + template_choice (BL-3) + RLS skeleton"
      contains: "create table public.affiliates"
    - path: "/Users/karstenhaldan/minisite/supabase/migrations/20270101000002_affiliate_clicks_conversions_payouts.sql"
      provides: "affiliate_clicks, affiliate_conversions, affiliate_impressions (D-38), payouts tables — D-33 ledger retention + D-39 reduced enum"
      contains: "on delete set null"
    - path: "/Users/karstenhaldan/minisite/supabase/migrations/20270101000004_tier_effective_view.sql"
      provides: "tier_effective view + affiliates_public_view (BL-3); both security_invoker=true (D-03)"
      contains: "with (security_invoker = true)"
    - path: "/Users/karstenhaldan/minisite/supabase/migrations/20270101000005_affiliate_rls.sql"
      provides: "Idempotent RLS policies (self-select + staff-all + service-write + public-landing-read) on all 5 tables + public view"
      contains: "do $$"
    - path: "/Users/karstenhaldan/minisite/leanshot/tests/rls/affiliates-rls.test.ts"
      provides: "Live cross-tenant impersonation test via service-role-minted JWT"
      contains: "buildAnonClient"
  key_links:
    - from: "src/lib/billing-sync.ts (later plan)"
      to: "tier_effective view"
      via: "supabase.from('tier_effective').select(...)"
      pattern: "from\\(['\"]tier_effective['\"]\\)"
    - from: "stripe-webhook/events/invoice-paid.ts (Plan 19-04)"
      to: "affiliate_conversions table"
      via: "service-role INSERT"
      pattern: "from\\(['\"]affiliate_conversions['\"]\\)"
    - from: "App.tsx /r/:code/landing (Plan 19-08)"
      to: "affiliates_public_view"
      via: "anon SELECT with status='approved' filter"
      pattern: "from\\(['\"]affiliates_public_view['\"]\\)"
    - from: "Plan 19-08 impression-insert task"
      to: "affiliate_impressions table"
      via: "service-role INSERT on /r/{code}/landing render"
      pattern: "from\\(['\"]affiliate_impressions['\"]\\)"

handoff_notes:
  - "Per project-memory feedback_infra_phase_validate_not_verify: Plan 19-01 is pure infra (0 user-observable truths from a user-story perspective). Phase 19 verification will route to /gsd-validate-phase, not /gsd-verify-work."

---

<objective>
Ship the affiliate-ledger Postgres schema (5 tables + 2 views + RLS + 1 public read view) in a single migration batch, forward-compatible with Phase 16's deferred RevenueCat integration. AFF-01 + AFF-10 (FK retention semantics) + AFF-08 (D-38 impression tracking) + AFF-09 (D-16/D-19 landing data shape) + MONEY-07 (cross-provider tier reconciliation) all land here.

Purpose: All downstream Phase 19 plans assume this schema exists. Building it as Wave 1 with zero file overlap means plans 19-02 / 19-03 / 19-04 can all run parallel against the same DB once `supabase db push --linked` runs at Wave 3 close (no per-plan push — schema deltas accumulate, single push at phase end per `[BLOCKING]` task in 19-09).

**Iter-1 revision (2026-05-15) — moved from 19-08 to this plan (BL-3):** `affiliates.template_choice` column, `affiliates_public_view`, and `pol_affiliates_public_landing_read` policy now live here so 19-08 can depend on 19-01 without circular schema ownership.

**Iter-1 revision (BL-8 / D-38):** New `affiliate_impressions` table ships here; impression-insert task ships in 19-08; Plan 19-07 has NO ratio-detector task at v1.2.

**Iter-1 revision (W-4 / D-39):** `payouts.status` enum check drops `'reversed'`; chargeback handling deferred to v1.3.

Output: 5 migration files in `/Users/karstenhaldan/minisite/supabase/migrations/` + 2 SQL test files + 1 RLS impersonation test in `/Users/karstenhaldan/minisite/leanshot/tests/rls/`.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@/Users/karstenhaldan/minisite/leanshot/.planning/PROJECT.md
@/Users/karstenhaldan/minisite/leanshot/.planning/ROADMAP.md
@/Users/karstenhaldan/minisite/leanshot/.planning/STATE.md
@/Users/karstenhaldan/minisite/leanshot/.planning/phases/19-affiliate-program-stripe-connect/19-CONTEXT.md
@/Users/karstenhaldan/minisite/leanshot/.planning/phases/19-affiliate-program-stripe-connect/19-CONTEXT-ADDENDUM-research.md
@/Users/karstenhaldan/minisite/leanshot/.planning/phases/19-affiliate-program-stripe-connect/19-PATTERNS.md
@/Users/karstenhaldan/minisite/supabase/migrations/20260601000019_stripe_subscriptions.sql
@/Users/karstenhaldan/minisite/supabase/migrations/20261101000007_page_builder_rls.sql

<interfaces>
Existing `subscriptions.provider` column (already in `20260601000019_stripe_subscriptions.sql:53`):
`provider text not null default 'stripe' check (provider in ('stripe','revenuecat'))`
Plan 19-03 (this migration's 3rd file) MUST therefore use `add column if not exists` purely as a defensive guard. Verify with `\d+ public.subscriptions` after pull.

Existing `public.is_staff()` helper (from `20261101000006_is_staff_helper.sql`) — RLS policies for admin-all use `using (public.is_staff())`.

Existing `app.suppress_audit` GUC + `audit_logs` table — RLS migration files must NOT trigger audit logs during DDL (DDL is exempt).
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Ship 4 schema migrations — affiliates + clicks/conversions/impressions/payouts + provider-guard + views</name>
  <files>/Users/karstenhaldan/minisite/supabase/migrations/20270101000001_affiliates_schema.sql, /Users/karstenhaldan/minisite/supabase/migrations/20270101000002_affiliate_clicks_conversions_payouts.sql, /Users/karstenhaldan/minisite/supabase/migrations/20270101000003_subscriptions_provider_guard.sql, /Users/karstenhaldan/minisite/supabase/migrations/20270101000004_tier_effective_view.sql, /Users/karstenhaldan/minisite/supabase/migrations/20270101000004a_insert_affiliate_impression_fn.sql</files>
  <read_first>
    /Users/karstenhaldan/minisite/supabase/migrations/20260601000019_stripe_subscriptions.sql (full file — analog for table+FK+partial-index+RLS shape; verify line 53 `provider` column exists)
    /Users/karstenhaldan/minisite/leanshot/.planning/phases/19-affiliate-program-stripe-connect/19-PATTERNS.md (section A.1, A.4-A.5 — exact column list + view DDL pattern)
    /Users/karstenhaldan/minisite/leanshot/.planning/phases/19-affiliate-program-stripe-connect/19-CONTEXT.md (D-01..D-04, D-31, D-33)
    /Users/karstenhaldan/minisite/leanshot/.planning/phases/19-affiliate-program-stripe-connect/19-CONTEXT-ADDENDUM-research.md (D-31 tax_threshold_cents; D-38 affiliate_impressions; D-39 payouts enum reduced set)
  </read_first>
  <acceptance_criteria>
    - 4 migration files exist at the exact paths above with the exact filename timestamps.
    - `cd /Users/karstenhaldan/minisite && supabase db reset --local` applies all 4 without error.
    - `supabase db lint --schema=public --level=warning` outputs ZERO lines matching `0010_security_definer_view`.
    - `psql -c "\d+ public.affiliates"` shows column `tax_threshold_cents` with default 50000 and column `template_choice` with default 'coach' and check constraint listing exactly ('coach','story','method').
    - `psql -c "\d+ public.affiliate_impressions"` shows the 5-column shape from D-38 and `affiliate_id` FK with `on delete cascade`.
    - `psql -c "\d+ public.payouts"` shows the status check constraint listing exactly ('pending','processing','paid','failed','blocked_onboarding') — `'reversed'` MUST NOT appear.
    - `psql -c "select definition from pg_views where viewname='tier_effective';"` returns a definition containing `max(current_period_end)`.
    - `psql -c "select definition from pg_views where viewname='affiliates_public_view';"` returns a definition containing `status = 'approved'` and exposes exactly the 7 non-PII columns listed in the action body.
  </acceptance_criteria>
  <action>
Create FOUR migration files in `/Users/karstenhaldan/minisite/supabase/migrations/` using the timestamp block `20270101000001..04` (per PATTERNS.md migration timestamp scheme; clears the current `20261101…` head).

**File 1 — `20270101000001_affiliates_schema.sql`** (per D-05/D-06/D-08/D-31-amended + PATTERNS.md A.1 + BL-3 template_choice):
- `create table public.affiliates` with columns: `id uuid pk default gen_random_uuid()`, `user_id uuid unique references auth.users(id) on delete set null` (D-33 step 3 — ledger retention), `email text not null`, `display_name text not null`, `audience_type text not null check (audience_type in ('Instagram','TikTok','YouTube','Newsletter','Coaching','Other'))` (D-05), `audience_size integer not null check (audience_size >= 0)`, `why_us text check (length(why_us) <= 500)` (D-05 500-char cap), `status text not null default 'pending' check (status in ('pending','approved','rejected','suspended'))` (D-06; TEXT not enum per D-03 + anti-pattern), `referral_code text unique`, `commission_rate_cents integer not null default 1000` (D-08 $10 flat), `tax_threshold_cents integer not null default 50000` (D-31 ADDENDUM — configurable, not hardcoded $500), `template_choice text not null default 'coach' check (template_choice in ('coach','story','method'))` (BL-3 — moved here from 19-08; D-16 lock), `stripe_connect_account_id text unique`, `stripe_payouts_enabled boolean not null default false` (Pitfall 7 — set from `account.updated` webhook), `photo_path text`, `blurb text check (length(blurb) <= 50)`, `calendly_url text`, `testimonial_quote text check (length(testimonial_quote) <= 200)`, `allowed_referer_hosts text[] not null default '{}'` (D-28), `ip_signup inet`, `fingerprint_signup text`, `applied_at timestamptz not null default now()`, `reviewed_at timestamptz`, `reviewed_by uuid references auth.users(id) on delete set null`, `created_at timestamptz not null default now()`, `updated_at timestamptz not null default now()`.
- Partial indexes (IMMUTABLE-safe per [[reference-supabase-migration-gotchas]]): `idx_affiliates_status on public.affiliates(status) where status in ('pending','suspended')`; `idx_affiliates_referral_code on public.affiliates(referral_code) where referral_code is not null`; `idx_affiliates_user_id on public.affiliates(user_id) where user_id is not null`; `idx_affiliates_referral_code_approved on public.affiliates(referral_code) where status = 'approved'` (for the public landing-page lookup hot path).
- `alter table public.affiliates enable row level security;` (policies in migration 5).
- Trigger to bump `updated_at` on UPDATE (reuse pattern from `20260601000019_stripe_subscriptions.sql` `set_updated_at` trigger).
- Header comment cites D-31 ADDENDUM rationale + Pitfall 7 (`stripe_payouts_enabled` is webhook-set, not user-set) + BL-3 (template_choice moved here from 19-08).

**File 2 — `20270101000002_affiliate_clicks_conversions_payouts.sql`** (per D-21/D-24..D-28/D-33 + D-38 + D-39):
- `create table public.affiliate_clicks` with columns: `id uuid pk`, `affiliate_id uuid not null references public.affiliates(id) on delete cascade` (clicks cascade with affiliate — no IRS retention), `user_id uuid references auth.users(id) on delete set null` (D-33 step 3), `referral_code text not null`, `ip inet`, `user_agent text`, `referer text`, `fingerprint text`, `flagged boolean not null default false`, `flag_reason text`, `created_at timestamptz not null default now()`.
- `create table public.affiliate_conversions` with columns: `id uuid pk`, `affiliate_id uuid not null references public.affiliates(id) on delete restrict` (block affiliate delete if conversions exist — D-33 step 1 pre-flight), `user_id uuid references auth.users(id) on delete set null` (D-33 step 3 — IRS retention via anonymization), `subscription_id text` (Stripe sub id), `invoice_id text not null unique` (D-36 idempotency key — UNIQUE on Stripe invoice ID), `commission_cents integer not null check (commission_cents >= 0)`, `status text not null default 'pending' check (status in ('pending','confirmed','flagged','rejected','paid'))` (TEXT not enum — D-03), `fraud_signals jsonb not null default '[]'::jsonb`, `eligible_at timestamptz` (D-30 — `invoice.paid + 60 days`; populated by trigger or webhook), `invoice_paid_at timestamptz`, `created_at timestamptz not null default now()`.
- **NEW (BL-8 / D-38) — `create table public.affiliate_impressions`** with columns: `id uuid pk default gen_random_uuid()`, `affiliate_id uuid not null references public.affiliates(id) on delete cascade` (impressions are NOT IRS records — cascade is correct), `ip_24 inet` (already truncated to /24 client/server-side; nullable for DNT honor), `ua_hash text` (SHA-256 of user agent), `referer text`, `created_at timestamptz not null default now()`.
- `create table public.payouts` with columns: `id uuid pk`, `affiliate_id uuid not null references public.affiliates(id) on delete restrict` (D-33 step 4 — payouts retained 7yr), `user_id uuid references auth.users(id) on delete set null`, `period_start date not null`, `period_end date not null`, `amount_cents integer not null check (amount_cents >= 0)`, **`status text not null default 'pending' check (status in ('pending','processing','paid','failed','blocked_onboarding'))`** (W-4 / D-39 — `'reversed'` REMOVED at v1.2; chargeback handling deferred to v1.3), `stripe_transfer_id text unique`, `retry_count integer not null default 0`, `paid_at timestamptz`, `failed_reason text`, `created_at timestamptz not null default now()`, `updated_at timestamptz not null default now()`.
- Partial indexes: `idx_clicks_affiliate_day on public.affiliate_clicks(affiliate_id, date_trunc('day', created_at))` (Z-score baseline aggregation in 19-07); `idx_conversions_affiliate_status on public.affiliate_conversions(affiliate_id, status) where status in ('pending','flagged')`; `idx_aff_impressions_affiliate_day on public.affiliate_impressions(affiliate_id, date_trunc('day', created_at))` (D-38 baseline aggregation for v1.3); `idx_payouts_eligible on public.payouts(eligible_at) where status = 'pending'` (cron filter in 19-09); `idx_payouts_affiliate on public.payouts(affiliate_id)`.
- Enable RLS on all 4 (clicks, conversions, impressions, payouts).

**File 3 — `20270101000003_subscriptions_provider_guard.sql`** (per D-01 + RESEARCH §A.4 critical observation):
- HEADER COMMENT: "D-01 — provider column already exists at `20260601000019_stripe_subscriptions.sql:53`. This migration is an idempotent defensive guard so P19 can be re-run safely + acts as the contract anchor for P16-06 (which becomes a no-op for this column)."
- Body: `alter table public.subscriptions add column if not exists provider text not null default 'stripe' check (provider in ('stripe','revenuecat'));`
- `create index if not exists idx_subscriptions_user_provider on public.subscriptions(user_id, provider) where user_id is not null;` (D-03 — IMMUTABLE partial-index predicate).

**File 4 — `20270101000004_tier_effective_view.sql`** (per D-01..D-03 + PATTERNS.md A.4-A.5 + RESEARCH Pattern 2 + BL-3 affiliates_public_view):
- HEADER COMMENT cites Supabase database-advisors lint 0010 (`security_invoker=true` required; no SECURITY DEFINER per D-03), the cross-phase contract with P16-06 (D-04), and BL-3 (affiliates_public_view moved from 19-08 to here).

- **View 1 — tier_effective** (existing logic):
  `create or replace view public.tier_effective with (security_invoker = true) as select user_id, max(current_period_end) as effective_period_end, bool_or(status in ('active','trialing')) as has_active, bool_or(status in ('past_due','unpaid')) as has_past_due, (array_agg(provider order by current_period_end desc nulls last))[1] as winning_provider from public.subscriptions where user_id is not null group by user_id;`
  `comment on view public.tier_effective is 'MONEY-07: unifies Stripe + RevenueCat subscriptions via MAX(current_period_end). security_invoker=true honors per-row RLS.';`
  `grant select on public.tier_effective to authenticated;`

- **View 2 — affiliates_public_view** (BL-3 — NEW, moved from 19-08): exposes exactly these 7 non-PII columns: `id, display_name, photo_path, blurb, calendly_url, testimonial_quote, template_choice, referral_code`. The `email`, `audience_size`, `audience_type`, `ip_signup`, `fingerprint_signup`, `commission_rate_cents`, `tax_threshold_cents`, `stripe_connect_account_id`, `stripe_payouts_enabled`, `status`, etc. columns MUST NOT appear in the view.
  `create or replace view public.affiliates_public_view with (security_invoker = true) as select id, display_name, photo_path, blurb, calendly_url, testimonial_quote, template_choice, referral_code from public.affiliates where status = 'approved';`
  `comment on view public.affiliates_public_view is 'AFF-09: public-readable approved-affiliate slice for /r/{code}/landing page. security_invoker=true so the view inherits RLS from the underlying table; the WHERE status=''approved'' filter is enforced here for clarity even though RLS would also handle it.';`
  `grant select on public.affiliates_public_view to anon, authenticated;`

**File 5 — `20270101000004a_insert_affiliate_impression_fn.sql`** (BL-10 — server-side IP truncation helper called from Plan 19-08 affiliate-impression Edge Function):
- `create or replace function public.insert_affiliate_impression(p_affiliate_id uuid, p_ip text, p_ua_hash text, p_referer text) returns void language plpgsql security definer set search_path = public, pg_temp as $$ begin insert into public.affiliate_impressions (affiliate_id, ip_24, ua_hash, referer) values (p_affiliate_id, set_masklen(coalesce(nullif(p_ip,''),'0.0.0.0')::inet, 24), p_ua_hash, left(coalesce(p_referer,''), 500)); end $$;`
- `revoke all on function public.insert_affiliate_impression(uuid, text, text, text) from public;`
- `grant execute on function public.insert_affiliate_impression(uuid, text, text, text) to service_role;`
- `comment on function public.insert_affiliate_impression is 'BL-10 / D-38: server-side impression insert with /24 IP truncation via set_masklen. Called from affiliate-impression Edge Function. SECURITY DEFINER with locked search_path so it can write to affiliate_impressions despite RLS service-role-insert-only policy.';`
- Why SECURITY DEFINER (deviation from [[feedback-planner-iter1-anti-patterns]] "no SECURITY DEFINER"): the function takes ONLY service_role grant + has an explicit `set search_path` to prevent search-path injection; the function body has zero dynamic SQL; this is the [[reference-supabase-migration-gotchas]] exception (#2) where SECURITY DEFINER is justified.

**Constraints (load-bearing per [[feedback-planner-iter1-anti-patterns]]):**
- NO enum types — text columns with check constraints (D-03).
- NO SECURITY DEFINER on either view (D-03).
- The SECURITY DEFINER helper in File 5 (above) is the ONLY exception, fully scoped via `set search_path = public, pg_temp`.
- NO `CREATE POLICY` in this migration — that's File 6 (Task 2 — formerly File 5, renumbered after BL-10 insertion).
- Partial-index predicates ONLY use IMMUTABLE expressions (`col IS NULL`, `col IS NOT NULL`, text equality, `date_trunc('day', ...)` is IMMUTABLE when input is timestamptz).
- DO NOT push the migration in this task — `supabase db push --linked` runs in Plan 19-09 [BLOCKING] task after all migrations are written.
- Commit with pathspec: `git commit -- supabase/migrations/20270101000001_*.sql supabase/migrations/20270101000002_*.sql supabase/migrations/20270101000003_*.sql supabase/migrations/20270101000004_*.sql supabase/migrations/20270101000004a_*.sql` per [[feedback-parallel-executor-git-isolation]].
  </action>
  <verify>
    <automated>cd /Users/karstenhaldan/minisite && supabase db reset --local --linked=false && supabase db lint --schema=public --level=warning 2>&1 | tee /tmp/19-01-lint.txt && (grep -E 'SECURITY DEFINER view|0010_security_definer_view' /tmp/19-01-lint.txt && echo 'LINT FAIL — SECURITY DEFINER view' && exit 1) || echo "lint clean for security-definer-view" && psql "$LOCAL_DB_URL" -c "select pg_get_functiondef('public.insert_affiliate_impression'::regproc);" | grep -q 'set_masklen'</automated>
  </verify>
  <done>5 migration files exist with correct DDL (4 + BL-10 helper); `supabase db reset --local` succeeds; no SECURITY DEFINER view warning from `supabase db lint`; partial indexes IMMUTABLE-validated by reset success; `payouts.status` check does NOT include `'reversed'` (D-39); `affiliate_impressions` table exists (D-38); `affiliates_public_view` exists with the 8-column non-PII slice (BL-3); `affiliates.template_choice` column exists (BL-3); `public.insert_affiliate_impression(uuid, text, text, text)` function exists and is service_role-grant-only (BL-10).</done>
</task>

<task type="auto">
  <name>Task 2: Ship RLS policies (idempotent, named) + SQL + RLS impersonation tests</name>
  <files>/Users/karstenhaldan/minisite/supabase/migrations/20270101000005_affiliate_rls.sql, /Users/karstenhaldan/minisite/supabase/tests/affiliate_schema.test.sql, /Users/karstenhaldan/minisite/supabase/tests/tier_effective_view.test.sql, /Users/karstenhaldan/minisite/leanshot/tests/rls/affiliates-rls.test.ts</files>
  <read_first>
    /Users/karstenhaldan/minisite/supabase/migrations/20261101000007_page_builder_rls.sql (idempotent `do $$ if not exists` policy pattern, lines 22-58)
    /Users/karstenhaldan/minisite/supabase/migrations/20260601000019_stripe_subscriptions.sql (owner-scoped policies lines 95-148)
    /Users/karstenhaldan/minisite/leanshot/.planning/phases/19-affiliate-program-stripe-connect/19-PATTERNS.md (sections A.7 + Pattern S4 file-scoped slug prefix + Pattern S5 service-role JWT)
    /Users/karstenhaldan/minisite/leanshot/tests/rls/ (existing RLS test patterns; pick the most recent file for cross-tenant impersonation shape)
  </read_first>
  <acceptance_criteria>
    - Migration file `20270101000005_affiliate_rls.sql` exists and contains exactly the 14 named policies listed below (verify via `grep -c 'create policy' supabase/migrations/20270101000005_affiliate_rls.sql` returns ≥ 14).
    - `supabase db reset --local` succeeds with all 5 migrations applied in order.
    - `supabase/tests/affiliate_schema.test.sql` runs via `psql -f` without `exception` (DO blocks raise `notice` on success).
    - `supabase/tests/tier_effective_view.test.sql` runs without `exception`; D-04 forward-compat assertion green (3rd row with provider='revenuecat' flips winning_provider).
    - `leanshot/tests/rls/affiliates-rls.test.ts` passes via `npm run test -- tests/rls/affiliates-rls.test.ts --run`; user B observes ZERO rows of user A's data across all 4 affiliate-scoped tables.
  </acceptance_criteria>
  <action>
Ship the RLS policies migration + 3 test files. Migration must run AFTER Tasks 1's tables exist (filename timestamp orders correctly).

**File 1 — `/Users/karstenhaldan/minisite/supabase/migrations/20270101000005_affiliate_rls.sql`**:
For each of 5 affiliate tables (`affiliates`, `affiliate_clicks`, `affiliate_conversions`, `affiliate_impressions`, `payouts`), create the named policies below via `do $$ if not exists (select 1 from pg_policies where ... and policyname = '...') then create policy ... end if; end $$;` blocks (per [[feedback-planner-iter1-anti-patterns]] idempotent pattern; PATTERNS.md A.7).

Policy inventory (14 total):
- `pol_affiliates_self_select` on `public.affiliates` — `for select to authenticated using (auth.uid() = user_id)`
- `pol_affiliates_staff_all` on `public.affiliates` — `for all to authenticated using (public.is_staff()) with check (public.is_staff())`
- `pol_affiliates_public_landing_read` on `public.affiliates` (BL-3 — NEW; supports affiliates_public_view) — `for select to anon, authenticated using (status = 'approved')`
- `pol_affiliate_clicks_self_select` on `public.affiliate_clicks` — `for select to authenticated using (exists (select 1 from public.affiliates a where a.id = affiliate_id and a.user_id = auth.uid()))`
- `pol_affiliate_clicks_staff_all` on `public.affiliate_clicks` — staff full access (FOR ALL)
- `pol_affiliate_clicks_service_insert` on `public.affiliate_clicks` — `for insert to service_role with check (true)` (Edge Function writes via service-role from `affiliate-attribute`)
- `pol_affiliate_conversions_self_select` on `public.affiliate_conversions` — same affiliate-scope pattern
- `pol_affiliate_conversions_staff_all` on `public.affiliate_conversions` — staff full access
- `pol_affiliate_conversions_service_insert` on `public.affiliate_conversions` — service-role INSERT for webhook
- `pol_affiliate_impressions_self_select` on `public.affiliate_impressions` (BL-8 / D-38) — affiliate-scope pattern
- `pol_affiliate_impressions_staff_all` on `public.affiliate_impressions` — staff full access
- `pol_affiliate_impressions_service_insert` on `public.affiliate_impressions` — `for insert to service_role with check (true)` (Plan 19-08 server-side insert path)
- `pol_payouts_self_select` on `public.payouts` — affiliate-scope
- `pol_payouts_staff_all` on `public.payouts` — staff full access
- `pol_payouts_service_write` on `public.payouts` — service-role INSERT/UPDATE for cron

Header comment cites [[reference-supabase-project]] (every RLS surface gets a live cross-tenant test) + [[feedback-rls-per-file-slug-prefix]] (file-scoped slug prefix in test cleanup) + BL-3 (the `pol_affiliates_public_landing_read` policy is the load-bearing path for `affiliates_public_view` SELECT through anon).

**Anti-pattern note (W-2 cleanup):** Do NOT add a `pol_affiliates_self_update_profile` policy here. Per BL-2 Path A (chosen during iter-1 revision), affiliate self-updates flow through the `partner-profile-update` Edge Function in Plan 19-06 (service-role with JWT auth + column allowlist). RLS does not gate column-level writes; the Edge Function does.

**File 2 — `/Users/karstenhaldan/minisite/supabase/tests/affiliate_schema.test.sql`** (pgTAP-style if project uses it, else plain SQL assertions via DO blocks):
- Assert 5 tables exist in `public` schema (affiliates, affiliate_clicks, affiliate_conversions, affiliate_impressions, payouts).
- Assert RLS is enabled on all 5 (`pg_class.relrowsecurity = true`).
- Assert `affiliate_conversions.invoice_id` has UNIQUE constraint (D-36 idempotency).
- Assert `affiliates.tax_threshold_cents` default = 50000 (D-31 ADDENDUM).
- Assert `affiliates.template_choice` default = 'coach' and check constraint matches `('coach','story','method')` (BL-3).
- Assert FK `affiliate_clicks.user_id → auth.users(id) on delete set null` (NOT cascade).
- Assert FK `affiliate_impressions.affiliate_id → affiliates(id) on delete cascade` (D-38 — NOT set null).
- Assert FK `payouts.affiliate_id → affiliates(id) on delete restrict` (D-33 step 1 pre-flight semantics).
- Assert `payouts.status` check constraint listing does NOT contain `'reversed'` (W-4 / D-39). Query against `pg_constraint.consrc` (or `pg_get_constraintdef`) and assert the constraint def does NOT contain the substring `reversed`.
- Assert `affiliates_public_view` exposes exactly 8 columns and does NOT expose `email` or `audience_size` (query against `information_schema.columns where table_name='affiliates_public_view'`).
- Run via `supabase db reset --local && psql -f supabase/tests/affiliate_schema.test.sql`; assertions raise `notice` on success, `exception` on failure.

**File 3 — `/Users/karstenhaldan/minisite/supabase/tests/tier_effective_view.test.sql`** (per D-02 SC#4 reformulated):
- BEGIN; insert 2 user_id rows with `provider='stripe'` and overlapping `current_period_end` (e.g. user A row1 `current_period_end = now() + interval '7 days'` status='active', row2 `current_period_end = now() + interval '30 days'` status='active').
- SELECT from `public.tier_effective` where `user_id = user_A`; assert ONE row returned with `effective_period_end ≈ now() + 30 days` and `winning_provider = 'stripe'`.
- Insert a 3rd row with `provider='revenuecat'` and `current_period_end = now() + interval '60 days'`.
- SELECT again; assert `effective_period_end ≈ now() + 60 days` and `winning_provider = 'revenuecat'` (D-04 P16-06 forward-compat).
- ROLLBACK.

**File 4 — `/Users/karstenhaldan/minisite/leanshot/tests/rls/affiliates-rls.test.ts`** (vitest, jsdom — live cross-tenant test per [[reference-supabase-project]]):
- File-scoped prefix: `const AFF_PREFIX = \`p19-affrls-${randomUUID().slice(0,6)}\`;` per [[feedback-rls-per-file-slug-prefix]].
- Use service-role-minted JWT pattern from [[reference-rls-fixture-gotrueclient-flake]]: import a helper that mints a JWT via service-role + attaches via `createClient(..., { global: { headers: { Authorization: \`Bearer ${jwt}\` } } })`. DO NOT use `signInWithPassword`.
- Test 1: Create affiliate row for user A (service-role). Create affiliate row for user B. Build an anon client impersonating user A. Assert `from('affiliates').select('*')` returns ONLY user A's row.
- Test 2: Same for `affiliate_clicks`, `affiliate_conversions`, `affiliate_impressions`, `payouts` — each must return zero rows when querying as user B against user A's data.
- Test 3: Service-role can INSERT into `affiliate_clicks` AND `affiliate_impressions` (cookie-set + impression-render Edge Function paths).
- Test 4 (NEW — BL-3): As `anon` (no JWT), `from('affiliates_public_view').select('id,display_name')` returns the approved-affiliate row; `from('affiliates_public_view').select('email')` is REJECTED (column does not exist on the view). Also assert anon CANNOT directly select `from('affiliates').select('email')` — RLS denies (pol_affiliates_public_landing_read covers SELECT but the underlying table SELECT requires going through the view; verify by checking row count is zero against the table for the same affiliate).
- `afterAll(() => cleanupAffiliates(AFF_PREFIX))` — file-scoped cleanup; do NOT use a global cleanup helper that would clobber sibling-file fixtures.

**Constraints:**
- Tests in `supabase/tests/*.sql` run via `supabase db reset --local` + manual psql; no CI wiring in this plan (CI added in 19-09).
- Commit with pathspec: `git commit -- supabase/migrations/20270101000005_*.sql supabase/tests/affiliate_schema.test.sql supabase/tests/tier_effective_view.test.sql leanshot/tests/rls/affiliates-rls.test.ts` per [[feedback-parallel-executor-git-isolation]].
  </action>
  <verify>
    <automated>cd /Users/karstenhaldan/minisite && supabase db reset --local && psql "$LOCAL_DB_URL" -f supabase/tests/affiliate_schema.test.sql && psql "$LOCAL_DB_URL" -f supabase/tests/tier_effective_view.test.sql && cd /Users/karstenhaldan/minisite/leanshot && npm run test -- tests/rls/affiliates-rls.test.ts --run</automated>
  </verify>
  <done>Migration applies cleanly; both SQL test files run without `exception`; vitest RLS test passes with cross-tenant isolation proven (user B sees zero of user A's rows across all 5 tables); anon can SELECT through `affiliates_public_view` for approved rows; anon cannot SELECT non-PII columns directly from `public.affiliates`.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| service_role → DB | Edge Functions write affiliate data via service-role; RLS is bypassed; SQL-level checks (UNIQUE, FK, CHECK) are the last line of defense |
| authenticated user → DB | All `/partner/*` reads go through RLS; cross-tenant leakage is the primary risk |
| anon user → DB | Apply form INSERTs via service-role through `affiliate-apply` Edge Function (Plan 19-05); anon SELECT through `affiliates_public_view` for the `/r/{code}/landing` public page (BL-3) — view exposes only non-PII columns and filters status='approved' |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-19-01-S | Spoofing | RLS `pol_affiliates_self_select` | mitigate | `using (auth.uid() = user_id)` — only the authenticated owner of a row sees it; cross-tenant test in Task 2 proves zero leak |
| T-19-01-T | Tampering | `affiliate_conversions.invoice_id` UNIQUE | mitigate | UNIQUE constraint prevents double-attribution of the same Stripe invoice (idempotency on webhook replay) |
| T-19-01-R | Repudiation | User-delete cascade | mitigate | FK `on delete set null` on `affiliate_clicks/conversions/payouts.user_id` — rows retained for IRS 7yr; pairs with D-33 anonymization in Plan 19-09 |
| T-19-01-I | Information Disclosure | tier_effective view | mitigate | `with (security_invoker = true)` — view honors caller's RLS at query time; user A cannot see user B's subscription via the view (Supabase advisor 0010) |
| T-19-01-I | Information Disclosure | `affiliates_public_view` (BL-3) | mitigate | View exposes 8 non-PII columns only; `security_invoker=true` + WHERE status='approved' filter; anon cannot read email/audience_size/etc. by going through the table directly (no RLS policy permits anon SELECT on the table itself outside the view path) |
| T-19-01-I | Information Disclosure | `affiliate_impressions` PII (D-38) | mitigate | IP truncated to /24 at insert time; UA hashed with SHA-256 at insert time; raw IP/UA never stored. RLS self-select restricts to affiliate owner |
| T-19-01-D | Denial of Service | Partial-index bloat | accept | Partial indexes only on small predicate subsets (`status in ('pending','suspended')`); index size bounded by affiliate population |
| T-19-01-E | Elevation of Privilege | `pol_*_staff_all` policies | mitigate | `using (public.is_staff())` — relies on `is_staff()` helper from Phase 9; helper checks JWT claim, not user input |
| T-19-01-PSV | Privacy (PII retention) | Affiliate ledger × IRS | mitigate | Cross-cutting concern #1 (PROJECT.md) — anonymization in Plan 19-09 cascade; this plan ships the FK shape that makes anonymization possible (ON DELETE SET NULL) |
</threat_model>

<verification>
- `supabase db reset --local` applies all 5 migrations without error
- `supabase db lint --schema=public --level=warning` reports zero `0010_security_definer_view` warnings
- pgTAP/SQL tests pass: schema-existence + RLS-enabled + UNIQUE/FK constraints + payouts.status enum reduced set (no 'reversed') + affiliates_public_view shape all assert green
- vitest cross-tenant RLS test (`tests/rls/affiliates-rls.test.ts`) passes — user B sees zero rows from user A across all 5 tables
- anon SELECT works through `affiliates_public_view` for approved rows; anon cannot SELECT non-PII columns directly from `public.affiliates`
- `tier_effective` view returns MAX(current_period_end) for Stripe-only rows AND for mixed Stripe+RevenueCat rows (D-04 forward-compat)
</verification>

<success_criteria>
- 5 affiliate tables exist with RLS enabled and 14 policies named per the inventory above
- `tier_effective` view returns correct MAX across providers; D-04 forward-compat test green
- `affiliates_public_view` exposes 8 non-PII columns with security_invoker=true (BL-3)
- `subscriptions.provider` column guard is idempotent (re-running migration 3 is a no-op)
- All FKs to `auth.users(id)` use `on delete set null` (NOT cascade) — IRS 7yr retention preserved
- `affiliate_impressions.affiliate_id` uses `on delete cascade` (D-38 — impressions are not IRS records)
- `payouts.status` enum check does NOT include `'reversed'` (D-39 — deferred to v1.3)
- Cross-tenant impersonation test green via service-role-minted JWT (NOT `signInWithPassword`)
- 0 `SECURITY DEFINER view` lint warnings
</success_criteria>

<output>
After completion, create `/Users/karstenhaldan/minisite/leanshot/.planning/phases/19-affiliate-program-stripe-connect/19-01-SUMMARY.md` with: schema delta summary (5 tables + 2 views), RLS policy inventory (14 policies), tier_effective + affiliates_public_view test results, FK retention contract documented, D-39 deferred-tech-debt note for `payouts.status = 'reversed'` (v1.3), D-38 `affiliate_impressions` table ready-but-unwired note (impression-insert ships in 19-08), [BLOCKING] note that `supabase db push --linked` is deferred to Plan 19-09, and the infra-phase routing note (per project-memory: phase 19 verify routes to `/gsd-validate-phase`, not `/gsd-verify-work`).
</output>
