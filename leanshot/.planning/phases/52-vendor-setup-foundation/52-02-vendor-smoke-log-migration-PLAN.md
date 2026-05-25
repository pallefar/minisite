---
phase: 52-vendor-setup-foundation
plan: 02
type: execute
wave: 1
depends_on: []
files_modified:
  - supabase/migrations/20280101000001_vendor_smoke_log.sql
autonomous: true
requirements: [VENDOR-11]
user_setup: []

must_haves:
  truths:
    - "vendor_smoke_log table exists with vendor_name PK and a vendor_smoke_status enum column"
    - "Only staff can SELECT vendor_smoke_log (RLS via public.is_staff())"
    - "A daily pg_cron job 'vendor-smoke-check' posts to the vendor-smoke Fn with a vault service-role bearer"
    - "The migration is idempotent and forward-dated so supabase db push accepts it"
  artifacts:
    - path: "supabase/migrations/20280101000001_vendor_smoke_log.sql"
      provides: "vendor_smoke_log table + enum + staff-SELECT RLS + daily cron schedule"
      contains: "vendor_smoke_log"
  key_links:
    - from: "vendor_smoke_log RLS policy"
      to: "public.is_staff()"
      via: "USING (public.is_staff())"
      pattern: "public\\.is_staff\\(\\)"
    - from: "cron job vendor-smoke-check"
      to: "vault.decrypted_secrets service_role_key"
      via: "Bearer from vault.decrypted_secrets"
      pattern: "vault\\.decrypted_secrets"
---

<objective>
Create the `vendor_smoke_log` table (one row per vendor, staff-SELECT-only RLS) and a daily pg_cron job that invokes the `vendor-smoke` Edge Fn using the project's vault service-role-bearer pattern.

Purpose: Persists per-vendor smoke results for the admin dashboard and runs the smoke automatically once a day.
Output: `supabase/migrations/20280101000001_vendor_smoke_log.sql`.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/STATE.md
@.planning/phases/52-vendor-setup-foundation/52-CONTEXT.md
@.planning/phases/52-vendor-setup-foundation/52-RESEARCH.md

# VERBATIM cron template — copy the $cron$ named-tag + vault-bearer + net.http_post block from here
@supabase/migrations/20270702000008_baa_alert_cron.sql
# RLS guard helper — use public.is_staff() exactly as defined here
@supabase/migrations/20261101000006_is_staff_helper.sql
</context>

<tasks>

<task type="auto">
  <name>Task 1: vendor_smoke_log table + enum + staff RLS</name>
  <files>supabase/migrations/20280101000001_vendor_smoke_log.sql</files>
  <action>
Create the forward-dated migration `supabase/migrations/20280101000001_vendor_smoke_log.sql` (timestamp MUST be later than the remote's last applied migration so `supabase db push` does not refuse — RESEARCH Pitfall 7).

Define the enum idempotently: `DO $$ BEGIN CREATE TYPE public.vendor_smoke_status AS ENUM ('ok','fail','not_configured'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;`.

Create the table idempotently (`CREATE TABLE IF NOT EXISTS public.vendor_smoke_log`): columns `vendor_name text PRIMARY KEY`, `status public.vendor_smoke_status NOT NULL DEFAULT 'not_configured'`, `latency_ms integer` (nullable — null when not_configured), `message text` (nullable), `checked_at timestamptz NOT NULL DEFAULT now()`. Use `integer` for latency (not float) per project convention.

Enable RLS and add a staff-only SELECT policy: `ALTER TABLE public.vendor_smoke_log ENABLE ROW LEVEL SECURITY;` then `CREATE POLICY vendor_smoke_log_select_staff ON public.vendor_smoke_log FOR SELECT USING (public.is_staff());`. Do NOT add INSERT/UPDATE/DELETE policies — only the Edge Fn writes, via service_role which bypasses RLS. Add a comment noting this. (CONTEXT decision: staff-gated dashboard reads; Fn writes via service_role.)
  </action>
  <verify>
    <automated>cd /Users/karstenhaldan/minisite && F=supabase/migrations/20280101000001_vendor_smoke_log.sql; test -f "$F" && grep -q "CREATE TABLE IF NOT EXISTS public.vendor_smoke_log" "$F" && grep -q "vendor_smoke_status" "$F" && grep -q "USING (public.is_staff())" "$F" && grep -q "PRIMARY KEY" "$F" && echo TABLE_OK</automated>
  </verify>
  <done>Migration file exists, forward-dated; enum + table created idempotently; vendor_name PK; staff-SELECT RLS via public.is_staff(); no client write policies.</done>
</task>

<task type="auto">
  <name>Task 2: daily vendor-smoke-check pg_cron schedule</name>
  <files>supabase/migrations/20280101000001_vendor_smoke_log.sql</files>
  <action>
Append the cron schedule to the same migration file. Copy the exact structure from `20270702000008_baa_alert_cron.sql`: `CREATE EXTENSION IF NOT EXISTS pg_cron;` then `SELECT cron.schedule('vendor-smoke-check', '0 8 * * *', $cron$ ... $cron$);`.

Use cron expression `0 8 * * *` (08:00 UTC daily — confirmed free per pinned facts + RESEARCH A9). NOTE: CONTEXT.md locks "daily pg_cron"; ROADMAP/REQUIREMENTS VENDOR-11 prose says "6-hour cron" — CONTEXT (the authoritative source) wins, so this is DAILY. Record this reconciliation in the SUMMARY.

The cron body MUST use the named dollar-quote tag `$cron$...$cron$` (NOT `$$`) to avoid the nesting collision (RESEARCH Pitfall 1). Inside: `SELECT net.http_post( url := 'https://ytnsipxxmzgaebkqmokp.supabase.co/functions/v1/vendor-smoke', headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='service_role_key' LIMIT 1)), body := '{}'::jsonb, timeout_milliseconds := 60000 );`.

Do NOT use the `app.service_role_key` GUC — it does not exist on this project (RESEARCH anti-pattern). The hardcoded function URL above is the project ref `ytnsipxxmzgaebkqmokp`; confirm it matches the other cron migrations' URL before writing (grep `functions/v1` in an existing cron migration).
  </action>
  <verify>
    <automated>cd /Users/karstenhaldan/minisite && F=supabase/migrations/20280101000001_vendor_smoke_log.sql; grep -q "vendor-smoke-check" "$F" && grep -q "'0 8 \* \* \*'" "$F" && grep -q '\$cron\$' "$F" && grep -q "vault.decrypted_secrets where name = 'service_role_key'\|vault.decrypted_secrets WHERE name='service_role_key'\|vault.decrypted_secrets WHERE name = 'service_role_key'" "$F" && grep -q "functions/v1/vendor-smoke" "$F" && ! grep -q "app.service_role_key" "$F" && echo CRON_OK</automated>
  </verify>
  <done>cron job 'vendor-smoke-check' scheduled '0 8 * * *' with $cron$ named tag, vault service-role bearer, hardcoded vendor-smoke URL, 60s timeout; no app.service_role_key GUC.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| client → vendor_smoke_log | PostgREST SELECT crosses RLS; only staff permitted |
| cron → Fn | bearer minted from vault; secret must never be a literal |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-52-06 | Information Disclosure | vendor_smoke_log SELECT | mitigate | RLS `USING (public.is_staff())`; non-staff authenticated users get zero rows |
| T-52-07 | Information Disclosure | service-role key in cron | mitigate | Bearer pulled from `vault.decrypted_secrets` at runtime; no key literal in migration text |
| T-52-08 | Denial of Service | cron firing before Fn deployed | mitigate | Close-out ordering: deploy Fn (52-01) THEN db push this migration; documented in verification |
| T-52-SC | Tampering | migration apply | accept | No package installs; pure SQL using existing pg_cron/net/vault extensions |
</threat_model>

<verification>
- Migration file present, forward-dated, idempotent (re-runnable).
- Grep gates: table + enum + staff RLS + named-tag cron + vault bearer all present; no `app.service_role_key`.
- DEPLOY ORDERING (close-out): deploy `vendor-smoke` Fn (plan 52-01) FIRST, THEN `supabase db push` this migration — the cron fires within 15 min of push and would 404 a missing Fn (RESEARCH Pitfall 5 / pinned hard constraint). State this in the SUMMARY.
- Local apply check is optional (no local DB required); the grep gates prove structural correctness for autonomous verification.
</verification>

<success_criteria>
vendor_smoke_log table + staff-SELECT RLS + daily 08:00 UTC vendor-smoke-check cron exist in one idempotent, forward-dated migration using the verified vault-bearer pattern.
</success_criteria>

<output>
Create `.planning/phases/52-vendor-setup-foundation/52-02-SUMMARY.md` when done. Record: the daily-vs-6h cron reconciliation (CONTEXT wins), the confirmed function URL ref, and the Fn-deploy-before-db-push close-out ordering.
</output>
