---
phase: 19
plan: 9
type: execute
wave: 6
depends_on: [1, 2, 3, 4, 5, "6a", "6b", 7, 8]
files_modified:
  - /Users/karstenhaldan/minisite/supabase/functions/affiliate-payout/index.ts
  - /Users/karstenhaldan/minisite/supabase/functions/affiliate-payout/index.test.ts
  - /Users/karstenhaldan/minisite/supabase/functions/affiliate-payout/retry.ts
  - /Users/karstenhaldan/minisite/supabase/functions/affiliate-payout/deno.json
  - /Users/karstenhaldan/minisite/supabase/functions/account-delete/index.ts
  - /Users/karstenhaldan/minisite/supabase/functions/account-delete/index.test.ts
  - /Users/karstenhaldan/minisite/supabase/functions/account-delete/deno.json
  - /Users/karstenhaldan/minisite/supabase/migrations/20270101000011_payouts_materialization_and_cron.sql
  - /Users/karstenhaldan/minisite/supabase/migrations/20270101000012_account_delete_affiliate_cascade.sql
  - /Users/karstenhaldan/minisite/supabase/migrations/20270101000013_service_role_key_vault_load.sql
  - /Users/karstenhaldan/minisite/supabase/config.toml
  - /Users/karstenhaldan/minisite/leanshot/tests/e2e/affiliate-account-delete.spec.ts
  - /Users/karstenhaldan/minisite/leanshot/src/App.tsx
autonomous: false
requirements: [AFF-06, AFF-10, MONEY-10]
tags: [edge-fn, pg-cron, stripe-transfers, cascade-delete, blocking-schema-push, e2e, route-wiring, vault]
user_setup:
  - service: stripe-connect-express
    why: "AFF-06 — monthly transfers.create batch payout"
    env_vars:
      - name: SUPABASE_SERVICE_ROLE_KEY
        source: "Already in Function Secrets"
      - name: STRIPE_SECRET_KEY
        source: "Already in Function Secrets (Phase 12)"
  - service: supabase-vault
    why: "BL-7 — load service_role_key into vault.secrets via dashboard before the pg_cron migration runs (HUMAN-checkpoint Task 0)"
    dashboard_config:
      - task: "Add secret `service_role_key` to Supabase Vault via Dashboard → Project Settings → Vault → Add new secret"
        location: "Supabase Dashboard → Project Settings → Vault"

must_haves:
  truths:
    - "[BLOCKING] supabase db push --linked succeeds after Plan 19-01/19-04/19-07/19-08/19-09 migrations are written (13 total Phase 19 migrations)"
    - "[BLOCKING] npm run check-bundle-budget passes (I-1 — added to phase-close gate alongside supabase db push)"
    - "BL-7 Vault path: service_role_key is loaded into vault.secrets via the Wave-6 human-checkpoint task BEFORE migration 20270101000013 runs; pg_cron reads it via `select decrypted_secret from vault.decrypted_secrets where name='service_role_key' limit 1`"
    - "BL-11 conversion confirmation: pg_cron job at 00:15 UTC daily flips affiliate_conversions.status from 'pending' to 'confirmed' when (fraud_signals is null OR '[]') AND eligible_at <= now(); must run BEFORE the 00:30 materialization or AFF-06 ships dead"
    - "W-3 payouts materialization: pg_cron job creates payouts rows daily at 00:30 UTC from affiliate_conversions where status='confirmed' AND eligible_at <= now() GROUP BY affiliate_id; this populates the pending payouts that affiliate-payout cron transfers on the 1st"
    - "affiliate-payout Edge Function called from pg_cron at 00:00 UTC on the 1st of each month; processes pending payouts where eligible_at < now() AND amount ≥ tax_threshold_cents"
    - "transfers.create called with idempotency key (D-32 retry); on success → payouts.status='paid' + stripe_transfer_id; on failure → retry_count++ up to 3 attempts then status='failed' + Resend admin alert"
    - "account-delete Edge Function performs D-33 10-step cascade in exact order; payouts table rows RETAINED (IRS 7yr); affiliate_ledger anonymized via SHA256 email + display_name='deleted_user_{id}'"
    - "BL-6 SQL function signature lock: `public.finalize_affiliate_cascade(p_user_id uuid) returns text` — returns the ORIGINAL email BEFORE anonymizing so the Edge Function can call Resend contacts.remove with it"
    - "Pre-flight check (D-33 step 1): if open payouts (status IN pending/processing) → return 409 { error: 'open_payouts', eta: <next_payout_date> }"
    - "app.suppress_audit GUC set with is_local=true wraps the cascade window (D-34 + reference_supabase_migration_gotchas Pitfall 4)"
    - "Playwright e2e affiliate-account-delete.spec.ts proves full cascade end-to-end (D-35)"
    - "BL-4 / I-2: App.tsx wiring (single late-wave task) imports the 3 route registries from Plans 19-05, 19-06b, 19-08 and renders the matched component; verify routes /affiliate, /admin/affiliates, /partner/*, /r/:code/landing"
  artifacts:
    - path: "/Users/karstenhaldan/minisite/supabase/functions/affiliate-payout/index.ts"
      provides: "Monthly cron-invoked Edge Function calling stripe.transfers.create per affiliate"
      contains: "transfers.create"
    - path: "/Users/karstenhaldan/minisite/supabase/functions/account-delete/index.ts"
      provides: "10-step cascade Edge Function (called from P22 DEL-01)"
      contains: "finalize_affiliate_cascade"
    - path: "/Users/karstenhaldan/minisite/supabase/migrations/20270101000011_payouts_materialization_and_cron.sql"
      provides: "W-3 — daily payouts-from-conversions materialization cron + monthly affiliate-payout HTTP cron"
      contains: "0 0 1 * *"
    - path: "/Users/karstenhaldan/minisite/supabase/migrations/20270101000012_account_delete_affiliate_cascade.sql"
      provides: "BL-6 — finalize_affiliate_cascade(p_user_id uuid) RETURNS TEXT SQL function (returns original_email)"
      contains: "returns text"
    - path: "/Users/karstenhaldan/minisite/supabase/migrations/20270101000013_service_role_key_vault_load.sql"
      provides: "BL-7 — Vault-based service_role_key access for pg_cron callbacks"
      contains: "vault.decrypted_secrets"
    - path: "/Users/karstenhaldan/minisite/leanshot/tests/e2e/affiliate-account-delete.spec.ts"
      provides: "Full cascade e2e proof (D-35) — affiliate + conversion + payout → delete → assert retention + anonymization"
      contains: "expect"
    - path: "/Users/karstenhaldan/minisite/leanshot/src/App.tsx"
      provides: "BL-4 — single late-wave task wiring 3 route registries"
      contains: "AFFILIATE_APPLY_ROUTES"
  key_links:
    - from: "pg_cron"
      to: "affiliate-payout Edge Function"
      via: "pg_net.http_post with vault.decrypted_secrets service_role_key"
      pattern: "pg_net.http_post"
    - from: "affiliate-payout Edge Function"
      to: "Stripe transfers.create + payouts table UPDATE"
      via: "service-role Stripe SDK call"
      pattern: "transfers\\.create"
    - from: "P22 DEL-01 surface (future)"
      to: "account-delete Edge Function"
      via: "POST /functions/v1/account-delete"
      pattern: "account-delete"
    - from: "App.tsx pathname matcher"
      to: "AFFILIATE_APPLY_ROUTES + PARTNER_ROUTES + LANDING_ROUTES"
      via: "import from src/routes/*-routes.ts"
      pattern: "Routes"

handoff_notes:
  - "I-2: Phase 19 verification routes to /gsd-validate-phase (NOT /gsd-verify-work) because Plan 19-01 is pure infra (0 user-observable truths). Per project memory feedback_infra_phase_validate_not_verify."

---

<objective>
Close out Phase 19 with five deliverables:
1. **W-3 payouts materialization + monthly payout cron + Edge Function** (AFF-06) — Wave-6 SQL migrations create the daily payouts-row materialization (from confirmed conversions) AND the monthly transfers.create cron via pg_net.http_post; affiliate-payout Edge Function does the Stripe-side transfers with idempotency + 3-retry.
2. **BL-6 account-delete cascade Edge Function** (AFF-10 + MONEY-10) — orchestrates D-33's 10-step cascade; SQL function `finalize_affiliate_cascade(p_user_id uuid) RETURNS TEXT` returns the original email so the Edge Function can call Resend.
3. **BL-7 Vault-based service_role_key** — Wave-6 human checkpoint loads the secret into vault.secrets; migration 20270101000013 grants pg_cron access.
4. **[BLOCKING] supabase db push --linked + npm run check-bundle-budget** (I-1) — single push of ALL 13 Phase 19 migrations; bundle ceiling green.
5. **BL-4 single App.tsx wiring task** — imports the 3 route registries from Plans 19-05/06b/08 and renders the matched component; this is the ONLY plan modifying `src/App.tsx`.

Purpose: AFF-06 (monthly batch payout, 60-day hold, $500 W-9 threshold). AFF-10 (cascade-on-deletion preserves IRS retention). MONEY-10 (Stripe cascade — customer.delete + Connect.delete + PaymentIntent.cancel + Resend audience remove + Storage delete).

**Iter-1 revisions (2026-05-15):**
- **BL-6 — function signature locked:** `finalize_affiliate_cascade(p_user_id uuid) RETURNS TEXT` (NOT void; NOT table). Returns the original email BEFORE anonymizing. SQL body locked in Task 2 action.
- **BL-7 — Vault path chosen:** Wave-6 human-checkpoint Task 0 loads secret into vault.secrets via Dashboard → Project Settings → Vault. Migration 20270101000013 grants pg_cron read access via `select decrypted_secret from vault.decrypted_secrets where name='service_role_key' limit 1`. No `alter database … set app.service_role_key = ...` (which would commit the key to migration history).
- **W-3 — payouts materialization defined:** Option (a) selected — pg_cron daily job at 00:30 UTC materializes pending payouts rows from `affiliate_conversions` where `status='confirmed' AND eligible_at <= now()` GROUP BY affiliate_id. Sits in migration 20270101000011 alongside the monthly cron.
- **W-2 hedges — resolved:**
  - "If 24h spacing is required, add a `next_retry_at` check" → resolved: v1.2 monthly cron retries up to 3× in the same cron tick (the cron fires once a month so 24h spacing is structurally enforced by the cron cadence); v1.3 can add `next_retry_at` if rare-failure scenarios surface.
  - "If app.service_role_key GUC is absent, ADD a one-time `alter database ... set ...`" → resolved: Vault path (above) replaces the GUC approach.
  - "SIMPLER: this plan assumes Plan 19-04 + Plan 19-07's trigger already marks affiliate_conversions.status correctly" → resolved: W-3 materialization explicitly filters `status='confirmed'`, so only confirmed conversions roll up into payouts. Status transitions pending→confirmed happen via a separate trigger or via Plan 19-04's webhook flow (TODO: confirm Plan 19-04 transitions status when fraud_signals is empty + eligible_at reached; if not, add a small migration to this plan that runs a daily SQL `UPDATE affiliate_conversions SET status='confirmed' WHERE status='pending' AND fraud_signals='[]'::jsonb AND eligible_at <= now()` job).
- **I-1 — bundle budget added:** [BLOCKING] gate includes `npm run check-bundle-budget` alongside `supabase db push`.
- **I-2 — infra-phase note:** Phase 19 verification routes to `/gsd-validate-phase` per project memory.
- **BL-4 — App.tsx wiring lives here:** This is the ONLY plan in Phase 19 modifying `src/App.tsx`. Imports the 3 route registries (`affiliate-apply-routes.ts` from 19-05, `partner-routes.ts` from 19-06b, `landing-routes.ts` from 19-08) and wires them.

Output: 2 Edge Functions + retry helper + 3 migrations + e2e test + App.tsx wiring + the load-bearing `supabase db push` + `check-bundle-budget` task.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@/Users/karstenhaldan/minisite/leanshot/.planning/phases/19-affiliate-program-stripe-connect/19-CONTEXT.md
@/Users/karstenhaldan/minisite/leanshot/.planning/phases/19-affiliate-program-stripe-connect/19-CONTEXT-ADDENDUM-research.md
@/Users/karstenhaldan/minisite/leanshot/.planning/phases/19-affiliate-program-stripe-connect/19-RESEARCH.md
@/Users/karstenhaldan/minisite/leanshot/.planning/phases/19-affiliate-program-stripe-connect/19-PATTERNS.md
@/Users/karstenhaldan/minisite/supabase/functions/stripe-checkout/index.ts
@/Users/karstenhaldan/minisite/supabase/functions/clinic-invite/index.ts
@/Users/karstenhaldan/minisite/supabase/migrations/20260601000012_finalize_account_deletion_fn.sql
@/Users/karstenhaldan/minisite/supabase/migrations/20260601000013_finalize_account_deletions_cron.sql
@/Users/karstenhaldan/minisite/supabase/migrations/20260601000017_audit_trigger_suppress_guc.sql
@/Users/karstenhaldan/minisite/leanshot/src/routes/affiliate-apply-routes.ts
@/Users/karstenhaldan/minisite/leanshot/src/routes/partner-routes.ts
@/Users/karstenhaldan/minisite/leanshot/src/routes/landing-routes.ts

<interfaces>
RESEARCH §"Code Examples — affiliate-payout" lines 820-873: full skeleton with `stripe.transfers.create` + idempotencyKey + retry RPC.
RESEARCH §"Common Pitfalls — Pitfall 1" lines 606-611: account.del needs zero balance + no pending payouts. Pre-flight Stripe balance check.
RESEARCH §"Common Pitfalls — Pitfall 7" lines 642-647: check `affiliates.stripe_payouts_enabled = true` before transfers.create.
CONTEXT D-33: 10-step cascade in exact order.
CONTEXT D-34: app.suppress_audit GUC wraps cascade window.
PATTERNS.md §B.7: affiliate-payout NOVEL — composed from clinic-invite + stripe-checkout + cron migration analog.
PATTERNS.md §B.9 + §A.10: account-delete Edge Function wraps the SQL `finalize_affiliate_cascade` function (only DB-side steps live in SQL; Stripe/Resend/Storage steps in TypeScript).
[[reference-supabase-worktree-temp-state]]: `supabase db push --linked` in a worktree requires `supabase/.temp/` copied from main checkout.

**Route registries (BL-4):**
From Plan 19-05: `import { AFFILIATE_APPLY_ROUTES } from '@/routes/affiliate-apply-routes';` — 2 entries (/affiliate, /admin/affiliates).
From Plan 19-06b: `import { PARTNER_ROUTES } from '@/routes/partner-routes';` — 1 prefix entry (/partner → PartnerLayout).
From Plan 19-08: `import { LANDING_ROUTES } from '@/routes/landing-routes';` — 1 prefix entry (/r/ → AffiliateLandingResolver).

**Phase 19 migration inventory (13 files for the BLOCKING push):**
- 19-01: 20270101000001..05 (affiliates schema, clicks/conversions/impressions/payouts, provider guard, views, RLS)
- 19-04: 20270101000010 (feature_flags table for aff_manual_entry)
- 19-07: 20270101000006..08 (matview, trigger, refresh cron)
- 19-08: 20270101000009 (template seeds)
- 19-09: 20270101000011..13 (payouts cron, account-delete fn, vault load)
</interfaces>
</context>

<tasks>

<task type="checkpoint:human-verify" gate="blocking">
  <name>Task 0 (BL-7): Load service_role_key into Supabase Vault</name>
  <what-built>
    Supabase Vault secret `service_role_key` must be loaded via the Dashboard BEFORE migration `20270101000013_service_role_key_vault_load.sql` runs.
  </what-built>
  <how-to-verify>
1. Visit Supabase Dashboard → Project (ytnsipxxmzgaebkqmokp) → Project Settings → Vault.
2. Click "Add new secret". Name: `service_role_key`. Description: "Used by pg_cron to invoke affiliate-payout Edge Function. AFF-06."
3. Value: paste the project's service_role key (retrieve via `supabase projects api-keys --project-ref ytnsipxxmzgaebkqmokp` if needed).
4. Save. Verify presence: `select name from vault.secrets where name = 'service_role_key';` returns 1 row.
5. Type `vault-secret-loaded` to resume.

If Vault is not available on this project tier, surface as a deployment blocker and discuss with the user.
  </how-to-verify>
  <resume-signal>Type "vault-secret-loaded" or describe issues</resume-signal>
</task>

<task type="auto">
  <name>Task 1: Build affiliate-payout Edge Function + retry logic + payouts materialization + monthly cron + vault-load migration</name>
  <files>/Users/karstenhaldan/minisite/supabase/functions/affiliate-payout/index.ts, /Users/karstenhaldan/minisite/supabase/functions/affiliate-payout/index.test.ts, /Users/karstenhaldan/minisite/supabase/functions/affiliate-payout/retry.ts, /Users/karstenhaldan/minisite/supabase/functions/affiliate-payout/deno.json, /Users/karstenhaldan/minisite/supabase/migrations/20270101000011_payouts_materialization_and_cron.sql, /Users/karstenhaldan/minisite/supabase/migrations/20270101000013_service_role_key_vault_load.sql, /Users/karstenhaldan/minisite/supabase/config.toml</files>
  <read_first>
    /Users/karstenhaldan/minisite/leanshot/.planning/phases/19-affiliate-program-stripe-connect/19-RESEARCH.md (§"Code Examples — affiliate-payout" lines 820-873 — full handler shape with idempotency)
    /Users/karstenhaldan/minisite/leanshot/.planning/phases/19-affiliate-program-stripe-connect/19-PATTERNS.md (§B.7 NOVEL composition; §A.9 pg_cron analog)
    /Users/karstenhaldan/minisite/supabase/migrations/20260601000013_finalize_account_deletions_cron.sql (pg_cron analog WITHOUT pg_net — DO block calling local function; differs from W-3 path which DOES need pg_net.http_post)
    /Users/karstenhaldan/minisite/supabase/migrations/20260512000002_anon_cleanup_pg_cron.sql (alternate pg_cron analog)
    /Users/karstenhaldan/minisite/supabase/functions/stripe-checkout/index.ts (Stripe SDK init + admin client pattern)
  </read_first>
  <acceptance_criteria>
    - `affiliate-payout/index.ts` calls `stripe.transfers.create` (NOT `stripe.payouts.create`) with `idempotencyKey: \`affiliate_payout_${p.id}\``.
    - Constant-time bearer compare against `SUPABASE_SERVICE_ROLE_KEY` (V2).
    - Skip flag: `affiliate.stripe_payouts_enabled === false` → UPDATE payouts.status='blocked_onboarding' (Pitfall 7).
    - Threshold skip: cumulative paid + this amount < `tax_threshold_cents` → payout stays pending (D-31).
    - Migration `20270101000011` contains THREE `cron.schedule` calls: BL-11 conversion-confirm `'15 0 * * *'`, daily payouts-materialization `'30 0 * * *'`, AND monthly transfers cron `'0 0 1 * *'` (BL-11 + W-3 + AFF-06). Ordering rationale: confirm at 00:15 → materialize at 00:30 → monthly transfer on 1st.
    - Migration `20270101000013` contains a presence-check on `vault.decrypted_secrets` and zero secret material.
    - 8 Deno tests pass; all Stripe imports pin `https://esm.sh/stripe@19?target=denonext` (W-2 lock).
  </acceptance_criteria>
  <action>
**File 1 — `supabase/functions/affiliate-payout/index.ts`** (per RESEARCH lines 820-873 + Pitfall 7):
- Module-level: `import Stripe from 'https://esm.sh/stripe@19?target=denonext';` (W-2 lock — Phase 14 + 19-04 already pinned at v19). + `createClient` from supabase-js. Lazy init Stripe + admin client (clone stripe-checkout pattern).
- Authenticate: cron calls with `Authorization: Bearer <service_role_key>` (set by pg_cron via Vault — Task 0). Constant-time compare against `SUPABASE_SERVICE_ROLE_KEY` env. On mismatch → `jsonError(401, 'unauthorized')`.
- Handler:
  1. SELECT eligible payouts: `from('payouts').select('id, affiliate_id, amount_cents, affiliates!inner(stripe_connect_account_id, stripe_payouts_enabled, tax_threshold_cents)').eq('status', 'pending').lt('eligible_at', new Date().toISOString())`.
  2. For each eligible payout, compute cumulative paid via supabase-js (W-10): `const { data: paidRows } = await admin.from('payouts').select('amount_cents').eq('affiliate_id', p.affiliate_id).eq('status', 'paid'); const paid_so_far = (paidRows ?? []).reduce((s, r) => s + r.amount_cents, 0);` — JS reduce keeps the function pure-supabase-js (no `.rpc()` helper needed for v1.2 volume).
  3. Threshold check (D-31): if `(paid_so_far + p.amount_cents) < tax_threshold_cents` → keep `status='pending'`, continue.
  4. Skip if `!affiliate.stripe_payouts_enabled` → UPDATE payouts SET status='blocked_onboarding' WHERE id = p.id (Pitfall 7).
  5. Idempotency key: `const idempotencyKey = \`affiliate_payout_${p.id}\`;` (D-32).
  6. Try `stripe.transfers.create({ amount, currency: 'usd', destination: account_id, metadata: { payout_id, affiliate_id, leanshot_phase: '19' } }, { idempotencyKey })`. USE transfers.create NOT payouts.create.
  7. On success: UPDATE payouts SET status='paid', stripe_transfer_id, paid_at = now(). Send Resend "payout sent" email via direct-HTTPS (clone Plan 19-05's resend.ts dispatcher).
  8. On error: `await incrementPayoutRetry(admin, p.id, err.message)`.
- Return `jsonResponse(200, { processed, paid, failed, blocked })`.
- Logging: Pattern S3 (no PII).

**File 2 — `supabase/functions/affiliate-payout/retry.ts`**:
- Export `async function incrementPayoutRetry(admin, payoutId, errorMessage): Promise<void>`:
  - UPDATE payouts SET retry_count = retry_count + 1, failed_reason, updated_at.
  - SELECT retry_count; if >= 3 → status='failed' + Resend admin alert.
  - 24h spacing structurally enforced by monthly cron cadence at v1.2 (W-2 hedge resolution).

**File 3 — `supabase/migrations/20270101000011_payouts_materialization_and_cron.sql`** (W-3 + AFF-06 + BL-11):
```
-- AFF-06 monthly batch payout. 1st of month 00:00 UTC (D-29).
-- W-3 payouts materialization: daily at 00:30 UTC.
-- BL-7: service_role_key sourced from vault.decrypted_secrets.
-- BL-11: daily 'pending'->'confirmed' transition at 00:15 UTC (must run BEFORE materialization at 00:30).

-- BL-11: daily 00:15 UTC — flip pending conversions to confirmed once eligibility window passes and no fraud signals were attached.
-- Without this transition, the W-3 materialization (00:30) would never find rows; AFF-06 would ship dead.
select cron.schedule(
  'affiliate-conversions-confirm',
  '15 0 * * *',
  $$
    update public.affiliate_conversions
       set status = 'confirmed', confirmed_at = now()
     where status = 'pending'
       and (fraud_signals is null or fraud_signals = '[]'::jsonb)
       and eligible_at <= now();
  $$
);

-- W-3 daily materialization
select cron.schedule(
  'affiliate-payouts-materialize',
  '30 0 * * *',
  $$
    insert into public.payouts (affiliate_id, period_start, period_end, amount_cents, status)
    select
      ac.affiliate_id,
      date_trunc('month', now())::date - interval '1 month' as period_start,
      date_trunc('month', now())::date - interval '1 day' as period_end,
      sum(ac.commission_cents)::int,
      'pending'
    from public.affiliate_conversions ac
    where ac.status = 'confirmed'
      and ac.eligible_at <= now()
      and not exists (
        select 1 from public.payouts p
         where p.affiliate_id = ac.affiliate_id
           and p.status in ('paid', 'processing')
           and p.created_at > now() - interval '60 days'
      )
    group by ac.affiliate_id
    having sum(ac.commission_cents) > 0
    on conflict do nothing;
  $$
);

-- Monthly transfers cron
select cron.schedule(
  'affiliate-monthly-payout',
  '0 0 1 * *',
  $$
    select net.http_post(
      url := 'https://ytnsipxxmzgaebkqmokp.supabase.co/functions/v1/affiliate-payout',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key' limit 1)
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 60000
    );
  $$
);
```

**File 4 — `supabase/migrations/20270101000013_service_role_key_vault_load.sql`** (BL-7):
```
-- BL-7: service_role_key access for pg_cron via Supabase Vault.
-- The secret itself is loaded out-of-band via Dashboard → Project Settings → Vault (Task 0).
-- This migration contains NO secret material.

do $$
begin
  if not exists (
    select 1 from information_schema.tables
     where table_schema = 'vault' and table_name = 'decrypted_secrets'
  ) then
    raise exception 'vault.decrypted_secrets unavailable. Enable Supabase Vault before running this migration.';
  end if;
end$$;

comment on schema vault is
  'BL-7: service_role_key loaded into vault.secrets via Dashboard (Plan 19-09 Task 0). pg_cron in migration 20270101000011 reads it via vault.decrypted_secrets.';
```

**File 5 — `supabase/functions/affiliate-payout/index.test.ts`** (8 Deno tests):
- T1: bearer mismatch → 401.
- T2: no eligible payouts → 200 `{ processed: 0 }`.
- T3: stripe_payouts_enabled=false → status='blocked_onboarding'; transfers.create NOT called.
- T4: cumulative below tax_threshold → status remains 'pending'; transfers.create NOT called.
- T5: meets all conditions → transfers.create called with correct idempotencyKey; status='paid'.
- T6: transfers.create throws → incrementPayoutRetry called; retry_count++ ; status stays 'pending'.
- T7: retry_count == 3 → status='failed' + admin alert sent (mocked Resend).
- T8: idempotency — re-calling with same payout id reuses idempotencyKey (Stripe dedupes).

**File 6 — `supabase/config.toml`** APPEND (last config.toml writer per BL-4 chain):
```
[functions.affiliate-payout]
verify_jwt = true

[functions.account-delete]
verify_jwt = true
```

**File 7 — `affiliate-payout/deno.json`**: minimal `{ "imports": {} }`.

**Constraints:**
- `stripe.transfers.create` NOT `stripe.payouts.create`.
- IdempotencyKey REQUIRED.
- Stripe pin: `stripe@19`.
- W-3 materialization idempotent via `on conflict do nothing` + `not exists`.
- Commit with pathspec.
  </action>
  <verify>
    <automated>cd /Users/karstenhaldan/minisite && deno test supabase/functions/affiliate-payout/index.test.ts --allow-env --allow-net</automated>
  </verify>
  <done>affiliate-payout filters correctly (D-30 + D-31 + Pitfall 7); calls transfers.create with idempotencyKey; retry logic up to 3 then failed; 3 pg_cron schedules installed (BL-11 confirm + W-3 materialize + AFF-06 monthly); Vault-based service_role_key access locked (BL-7); 8 Deno tests green.</done>
</task>

<task type="auto">
  <name>Task 2 (BL-6): Build account-delete Edge Function + finalize_affiliate_cascade RETURNS TEXT SQL function + e2e cascade test</name>
  <files>/Users/karstenhaldan/minisite/supabase/functions/account-delete/index.ts, /Users/karstenhaldan/minisite/supabase/functions/account-delete/index.test.ts, /Users/karstenhaldan/minisite/supabase/functions/account-delete/deno.json, /Users/karstenhaldan/minisite/supabase/migrations/20270101000012_account_delete_affiliate_cascade.sql, /Users/karstenhaldan/minisite/leanshot/tests/e2e/affiliate-account-delete.spec.ts</files>
  <read_first>
    /Users/karstenhaldan/minisite/leanshot/.planning/phases/19-affiliate-program-stripe-connect/19-CONTEXT.md (D-33 ten-step cascade + D-34 audit GUC + D-35 e2e test)
    /Users/karstenhaldan/minisite/leanshot/.planning/phases/19-affiliate-program-stripe-connect/19-PATTERNS.md (§A.10 cascade SQL function + §B.9 Edge Function wrapper split)
    /Users/karstenhaldan/minisite/supabase/migrations/20260601000012_finalize_account_deletion_fn.sql (analog for SQL cascade function with app.suppress_audit GUC)
    /Users/karstenhaldan/minisite/supabase/migrations/20260601000017_audit_trigger_suppress_guc.sql (GUC suppression pattern)
    /Users/karstenhaldan/minisite/supabase/functions/clinic-invite/index.ts (dispatcher pattern + JWT auth + direct-HTTPS Resend)
    /Users/karstenhaldan/minisite/leanshot/.planning/phases/19-affiliate-program-stripe-connect/19-RESEARCH.md (§Pitfall 1 + §Pitfall 9)
  </read_first>
  <acceptance_criteria>
    - `20270101000012_account_delete_affiliate_cascade.sql` defines `public.finalize_affiliate_cascade(p_user_id uuid) RETURNS TEXT` — returns original email or NULL.
    - SQL function preserves `stripe_connect_account_id` (does NOT null it) so Edge Function step 6 can call `stripe.accounts.del`.
    - SQL function uses `perform set_config('app.suppress_audit', 'true', true)` with is_local=true (Pitfall 9).
    - account-delete Edge Function executes D-33 10 steps in EXACT order; uses returned `original_email` from RPC for Resend `contacts.remove` (BL-6).
    - 409 returned with `{ error: 'open_payouts', eta: <iso-date> }` when SQL raises errcode='P0010'.
    - 6 Deno tests pass; Playwright e2e cascade test passes 6 assertions (anonymize, stripe_connect_account_id preserved, retention, Stripe gone, Storage empty, auth.users gone).
  </acceptance_criteria>
  <action>
**File 1 — `supabase/migrations/20270101000012_account_delete_affiliate_cascade.sql`** (BL-6 signature lock):
```
-- AFF-10 + MONEY-10 — DB-side anonymize for affiliate cascade-deletion.
-- BL-6 (2026-05-15): signature is `RETURNS TEXT` returning ORIGINAL email BEFORE anonymizing.
-- Pitfall 4 + 9: app.suppress_audit GUC with is_local=true.

create or replace function public.finalize_affiliate_cascade(p_user_id uuid)
returns text
language plpgsql
security invoker
set search_path = public, auth, extensions, pg_catalog
as $$
declare
  v_open_payouts integer;
  v_aff_id uuid;
  v_email text;
begin
  -- D-33 step 1: PRE-FLIGHT
  select count(*) into v_open_payouts
    from public.payouts p
    join public.affiliates a on a.id = p.affiliate_id
   where a.user_id = p_user_id
     and p.status in ('pending','processing');
  if v_open_payouts > 0 then
    raise exception 'open_payouts' using errcode = 'P0010';
  end if;

  -- Read ORIGINAL email BEFORE anonymize (BL-6).
  select id, email into v_aff_id, v_email
    from public.affiliates where user_id = p_user_id;
  if v_aff_id is null then
    return null;
  end if;

  perform set_config('app.suppress_audit', 'true', true);

  -- D-33 step 2: anonymize affiliate row.
  -- IMPORTANT: PRESERVE stripe_connect_account_id (needed by Edge Function step 6 for stripe.accounts.del).
  update public.affiliates
     set email = encode(digest(email::bytea, 'sha256'), 'hex'),
         display_name = 'deleted_user_' || id::text,
         photo_path = null,
         blurb = null,
         calendly_url = null,
         testimonial_quote = null,
         fingerprint_signup = null,
         ip_signup = null,
         updated_at = now()
   where id = v_aff_id;

  -- D-33 step 3 + 4: FK on delete set null on user_id (Plan 19-01) handles clicks/conversions/impressions; payouts retained.

  insert into public.audit_logs
    (user_id, user_id_hash, table_name, row_id, action, before_hash, after_hash)
  values (
    p_user_id,
    encode(digest(p_user_id::text::bytea, 'sha256'), 'hex'),
    'public.affiliates',
    coalesce(v_aff_id::text, ''),
    'affiliate_deleted_anonymized',
    null, null
  );

  perform set_config('app.suppress_audit', 'false', true);

  return v_email;
end;
$$;

revoke all on function public.finalize_affiliate_cascade(uuid) from public;
grant execute on function public.finalize_affiliate_cascade(uuid) to service_role;
```

**File 2 — `supabase/functions/account-delete/index.ts`**:
- Module-level: Stripe@19 init + service-role admin client + Resend direct-HTTPS dispatcher (clone Plan 19-05 resend.ts pattern).
- JWT auth: caller must be authenticated; authorize self-delete (caller.user.id === p_user_id) OR is_staff(caller); on mismatch → 403.
- Body schema: `{ user_id: string }`; self-delete enforces match.
- Handler executes D-33 10 steps in EXACT order:
  1. **Steps 1-4 (in DB):** `const { data: originalEmail, error } = await admin.rpc('finalize_affiliate_cascade', { p_user_id });`. If error.code === 'P0010' → 409 `{ error: 'open_payouts', eta: <next-1st-of-month> }`. Other error → 500. On success, `originalEmail` is pre-anonymize email (or null).
  5. **Stripe customer delete:** SELECT stripe_customer_id; cancel active subscriptions; `stripe.customers.del`; errors → log + continue.
  6. **Stripe Connect account delete:** SELECT stripe_connect_account_id (PRESERVED by BL-6 step 2). Pre-flight balance check (Pitfall 1) — skip on non-zero. `stripe.accounts.del`.
  7. **PaymentIntent void:** list open PIs for the customer; cancel each.
  8. **Resend audience remove:** if `originalEmail`: clone resend.ts pattern to DELETE the contact from the audience.
  9. **Storage delete:** list+delete under `photos/{user_id}/` and `affiliate-photos/{user_id}/` prefixes. Wrap in `set_config('storage.allow_delete_query', 'true', true)` via a SECURITY DEFINER helper per Phase 7 cascade pattern.
  10. **auth.admin.deleteUser:** LAST. Cascades FK nulls on clicks/conversions/impressions/payouts.user_id.
- Return 200 `{ ok: true, deleted_at: now }`.
- Audit log every step's success/failure to `audit_logs` (D-34).

**File 3 — `supabase/functions/account-delete/index.test.ts`** (6 Deno tests):
- T1: caller != user_id + not staff → 403.
- T2: open payouts → 409 `{ error: 'open_payouts', eta }`.
- T3: happy path → all 10 steps execute in order; Resend called with original_email from RPC return (BL-6).
- T4: Stripe balance > 0 → step 6 skipped; steps 7-10 continue.
- T5: Stripe customer.del throws → log + continue.
- T6: idempotent: second call → 200; RPC returns null.

**File 4 — `account-delete/deno.json`**: minimal.

**File 5 — `leanshot/tests/e2e/affiliate-account-delete.spec.ts`** (Playwright e2e D-35):
- File-scoped prefix per [[feedback-rls-per-file-slug-prefix]]: `const AFF_DEL_PREFIX = 'e2e-affdel-' + randomUUID().slice(0,6) + '-';`
- Seed (server-side): test user + approved affiliate row + 2 clicks + 1 confirmed conversion + 1 PAID payout (NOT pending).
- Mint service-role JWT per [[reference-rls-fixture-gotrueclient-flake]]; POST to `/functions/v1/account-delete`.
- Assert response 200 + 6 retention/anonymization assertions:
  1. affiliates row exists with hashed email + display_name='deleted_user_...' + photo_path null + `stripe_connect_account_id` PRESERVED (BL-6).
  2. affiliate_clicks rows exist (user_id null).
  3. affiliate_conversions row exists (user_id null).
  4. payouts row exists (D-33 step 4 IRS retention).
  5. auth.users row gone.
  6. Storage `photos/{user_id}/` empty.
- Cleanup: DELETE the test affiliates row entirely.

**Constraints:**
- D-33 step ORDER normative.
- GUC `is_local=true` (Pitfall 9).
- BL-6: function returns TEXT, preserves stripe_connect_account_id.
- Commit with pathspec.
  </action>
  <verify>
    <automated>cd /Users/karstenhaldan/minisite && deno test supabase/functions/account-delete/index.test.ts --allow-env --allow-net</automated>
  </verify>
  <done>10-step cascade in D-33 order; SQL function RETURNS TEXT (BL-6); stripe_connect_account_id preserved; app.suppress_audit is_local=true; 6 Deno tests + e2e cascade test all pass.</done>
</task>

<task type="auto">
  <name>Task 3 (BL-4): Wire App.tsx with 3 route registries — SINGLE writer for App.tsx in Phase 19</name>
  <files>/Users/karstenhaldan/minisite/leanshot/src/App.tsx</files>
  <read_first>
    /Users/karstenhaldan/minisite/leanshot/src/App.tsx (existing structure — pathname-driven view selector, lazy-import section, Suspense boundaries)
    /Users/karstenhaldan/minisite/leanshot/src/routes/affiliate-apply-routes.ts (from Plan 19-05 — RouteDescriptor type + AFFILIATE_APPLY_ROUTES)
    /Users/karstenhaldan/minisite/leanshot/src/routes/partner-routes.ts (from Plan 19-06b)
    /Users/karstenhaldan/minisite/leanshot/src/routes/landing-routes.ts (from Plan 19-08)
  </read_first>
  <acceptance_criteria>
    - App.tsx imports `AFFILIATE_APPLY_ROUTES`, `PARTNER_ROUTES`, `LANDING_ROUTES`.
    - Pathname-derivation logic checks registries in order: LANDING (most-specific `/r/:code/landing`) → PARTNER (`/partner/*`) → AFFILIATE_APPLY (`/affiliate` exact, `/admin/affiliates` prefix).
    - LANDING match → `<AffiliateLandingResolver code={match[1]} />` in Suspense.
    - No other Phase 19 plan has modified App.tsx (verify via git log).
  </acceptance_criteria>
  <action>
Single point of App.tsx mutation in Phase 19.

1. Add 3 registry imports at the top of the lazy-imports section:
   ```
   import { AFFILIATE_APPLY_ROUTES } from '@/routes/affiliate-apply-routes';
   import { PARTNER_ROUTES } from '@/routes/partner-routes';
   import { LANDING_ROUTES } from '@/routes/landing-routes';
   ```

2. Add a helper near the top of App.tsx (or inline):
   ```
   function resolveRoute(pathname: string) {
     // LANDING first — most-specific
     const landingMatch = pathname.match(/^\/r\/([a-z0-9-]+)\/landing$/);
     if (landingMatch) return { Component: React.lazy(LANDING_ROUTES[0].componentLoader), code: landingMatch[1] };
     // PARTNER prefix
     if (pathname.startsWith('/partner/') || pathname === '/partner') {
       return { Component: React.lazy(PARTNER_ROUTES[0].componentLoader), code: undefined };
     }
     // AFFILIATE_APPLY exact + prefix
     for (const route of AFFILIATE_APPLY_ROUTES) {
       if (route.match === 'exact' && pathname === route.path) return { Component: React.lazy(route.componentLoader), code: undefined };
       if (route.match === 'prefix' && pathname.startsWith(route.path)) return { Component: React.lazy(route.componentLoader), code: undefined };
     }
     return null;
   }
   ```

3. Extend the existing view-selector to call `resolveRoute(pathname)` BEFORE the marketing/onboarding/dashboard branches:
   ```
   const pathname = window.location.pathname;
   const resolved = resolveRoute(pathname);
   if (resolved) {
     const { Component, code } = resolved;
     return <Suspense fallback={<Skeleton />}><Component code={code} /></Suspense>;
   }
   // ... existing view branches continue below ...
   ```

4. DO NOT modify any other parts of App.tsx. Insert only the registry imports + the resolver branch above the existing view-selector.

**Constraints:**
- No router lib added.
- Wrapped in `<Suspense>`.
- Verify SINGLE Phase-19 commit on App.tsx via `git log --oneline -- src/App.tsx | head -3`.
- Commit with pathspec: `git commit -- src/App.tsx`.
  </action>
  <verify>
    <automated>cd /Users/karstenhaldan/minisite/leanshot && npm run typecheck 2>&1 | tee /tmp/19-09-task3-tsc.log && (grep -E 'App.tsx' /tmp/19-09-task3-tsc.log | grep -E 'error TS' && exit 1 || true) && grep -c 'AFFILIATE_APPLY_ROUTES\|PARTNER_ROUTES\|LANDING_ROUTES' src/App.tsx | grep -E '^[3-9]$' && echo 'route registries wired OK'</automated>
  </verify>
  <done>App.tsx imports the 3 registries; resolveRoute dispatches by pathname; landing/partner/affiliate-apply routes reachable; tsc clean; no other Phase 19 plan touched App.tsx.</done>
</task>

<task type="checkpoint:human-verify" gate="blocking">
  <name>Task 4 (I-1 + BLOCKING): supabase db push --linked + npm run check-bundle-budget</name>
  <what-built>
    13 Phase 19 migrations written across Plans 19-01/04/07/08/09. NONE pushed individually. This task is the load-bearing schema push + the I-1 bundle-budget gate.
  </what-built>
  <how-to-verify>
1. **Worktree-safety** (per [[reference-supabase-worktree-temp-state]]):
   ```
   ls /Users/karstenhaldan/minisite/supabase/.temp/ 2>/dev/null || cp -R /path/to/main/checkout/supabase/.temp /Users/karstenhaldan/minisite/supabase/.temp
   ```

2. **Migration inventory** — confirm 13 files exist:
   ```
   ls -la /Users/karstenhaldan/minisite/supabase/migrations/2027010100000*.sql | wc -l   # expect 13
   ```
   Files: 01..05 (19-01), 06..08 (19-07), 09 (19-08), 10 (19-04), 11..13 (19-09).

3. **Dry-run + push:**
   ```
   export SUPABASE_ACCESS_TOKEN=<token>
   cd /Users/karstenhaldan/minisite && supabase migration list --linked   # 13 local, none remote
   supabase db push --linked
   ```

4. **I-1 bundle gate:**
   ```
   cd /Users/karstenhaldan/minisite/leanshot && npm run build && npm run check-bundle-budget
   ```

5. **Post-push verification:**
   ```
   supabase migration list --linked | grep -E '20270101' | wc -l   # 13
   psql "$DATABASE_URL" -c "select count(*) from public.tier_effective;"
   psql "$DATABASE_URL" -c "select count(*) from public.affiliates_public_view;"
   psql "$DATABASE_URL" -c "select count(*) from public.affiliate_click_baseline;"
   psql "$DATABASE_URL" -c "select count(*) from public.affiliate_impressions;"
   psql "$DATABASE_URL" -c "select pg_get_function_result(oid) from pg_proc where proname = 'finalize_affiliate_cascade';"  # 'text'
   psql "$DATABASE_URL" -c "select enabled from public.feature_flags where key = 'aff_manual_entry';"  # f
   psql "$DATABASE_URL" -c "select count(*) from vault.decrypted_secrets where name = 'service_role_key';"  # 1
   psql "$DATABASE_URL" -c "select jobname from cron.job where jobname in ('affiliate-monthly-payout','affiliate-click-baseline-refresh','affiliate-payouts-materialize');"  # 3 rows
   ```

6. If push fails: read error; pre-empted failures per [[feedback-planner-iter1-anti-patterns]] should not surface.

Expected: "Phase 19 schema push: 13/13 migrations applied; cron jobs registered; bundle ceilings green."
  </how-to-verify>
  <resume-signal>Type "schema-push-confirmed" or describe issues</resume-signal>
</task>

<task type="checkpoint:human-verify" gate="blocking">
  <name>Task 5: Deploy Phase 19 Edge Functions to live + verify endpoint health</name>
  <what-built>
    10 Edge Functions across Phase 19 need deployment: affiliate-attribute, stripe-connect-onboard, partner-account-status, affiliate-apply, partner-profile-update, affiliate-impression, affiliate-payout, account-delete, plus redeploy of stripe-webhook + stripe-checkout.
  </what-built>
  <how-to-verify>
1. Deploy all functions:
   ```
   cd /Users/karstenhaldan/minisite
   for fn in affiliate-attribute stripe-connect-onboard partner-account-status affiliate-apply partner-profile-update affiliate-impression affiliate-payout account-delete stripe-webhook stripe-checkout; do
     supabase functions deploy $fn --linked &
   done
   wait
   ```

2. Smoke public endpoints:
   ```
   curl -sSv https://leanshot.app/r/no-such-affiliate 2>&1 | grep -E 'HTTP/2 404'
   curl -sS -X POST https://ytnsipxxmzgaebkqmokp.supabase.co/functions/v1/affiliate-apply \
     -H 'Content-Type: application/json' \
     -d '{"email":"smoke@example.com","name":"smoke","audience_size":100,"audience_type":"Instagram","why_us":"smoke","honeypot":"bot"}' | jq -e '.ok == true'
   curl -sS -X POST https://ytnsipxxmzgaebkqmokp.supabase.co/functions/v1/affiliate-impression \
     -H 'Content-Type: application/json' \
     -d '{"affiliate_id":"00000000-0000-0000-0000-000000000000","ua_hash":"abc","referer":""}'
   ```

3. JWT-gated smoke:
   ```
   curl -sS https://ytnsipxxmzgaebkqmokp.supabase.co/functions/v1/partner-account-status -H "Authorization: Bearer $SERVICE_ROLE_JWT" | jq '.state'
   ```

4. Cron verify:
   ```
   psql "$DATABASE_URL" -c "select jobname, schedule from cron.job where jobname like 'affiliate%';"   # 3 rows
   ```

5. Document deployed URLs in `19-09-SUMMARY.md`.
  </how-to-verify>
  <resume-signal>Type "edge-fns-deployed" or describe issues</resume-signal>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| pg_cron → affiliate-payout | Service-role JWT from vault.decrypted_secrets (BL-7); constant-time compare in Edge Function |
| Edge Function → Stripe transfers.create | Trusted via STRIPE_SECRET_KEY; idempotency prevents double-send |
| Self-delete user → account-delete | JWT user_id must match body user_id (or is_staff for admin-initiated) |
| account-delete → Stripe + Resend + Storage + auth.admin | Cascade across 4+ external systems |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-19-09-S | Spoofing | Unauthorized affiliate-payout invocation | mitigate | Constant-time bearer compare; secret from Vault (BL-7) |
| T-19-09-S | Spoofing | account-delete for another user | mitigate | `caller.user.id === p_user_id` OR `is_staff(caller)` |
| T-19-09-T | Tampering | Double-payout via concurrent cron | mitigate | Stripe idempotencyKey + payouts.status state machine |
| T-19-09-T | Tampering | Cascade mid-flight failure | mitigate | audit_logs per step (D-34); idempotent replay |
| T-19-09-T | Tampering | W-3 materialization duplicate rows | mitigate | `on conflict do nothing` + `not exists` clause |
| T-19-09-R | Repudiation | Deletion authorization dispute | mitigate | JWT-gated; audit_logs via user_id_hash; IRS-retained payouts |
| T-19-09-I | Information Disclosure | Stripe error messages leaked | mitigate | Pattern S3 |
| T-19-09-I | Information Disclosure | Resend audience.remove leak | accept | Same trust boundary as original send; read BEFORE anonymize per BL-6 |
| T-19-09-I | Information Disclosure | Vault secret in migration history | mitigate | BL-7: secret loaded out-of-band; migration 13 contains no secret material |
| T-19-09-D | DoS | account-delete flood | mitigate | JWT-gated; gateway rate-limit |
| T-19-09-E | Elevation of Privilege | GUC scope leak (Pitfall 9) | mitigate | `is_local=true` ensures transaction scope |
| T-19-09-PSV | Privacy (IRS retention) | Payouts accidentally deleted | mitigate | NO `delete from payouts`; FK on delete set null on user_id; e2e cascade test asserts retention |
</threat_model>

<verification>
- Task 0 [BLOCKING]: Vault secret `service_role_key` present
- Task 1: 8 Deno tests pass; 2 pg_cron jobs registered; Vault-based access locked
- Task 2: 6 Deno tests + e2e cascade test (6 assertions) pass; SQL function RETURNS TEXT (BL-6); stripe_connect_account_id preserved
- Task 3: App.tsx wires 3 route registries; tsc clean; no other Phase 19 plan touched App.tsx
- Task 4 [BLOCKING]: 13 migrations applied; `npm run check-bundle-budget` passes (I-1)
- Task 5 [BLOCKING]: 10 Edge Functions deployed; 3 cron jobs visible
</verification>

<success_criteria>
- Daily 00:30 UTC pg_cron materializes pending payouts from confirmed conversions (W-3)
- Monthly 1st-of-month cron triggers affiliate-payout via pg_net.http_post with Vault-sourced service_role_key (BL-7)
- transfers.create idempotent; failed transfers retry up to 3× then status='failed' + admin alert
- account-delete returns 409 on open payouts; otherwise executes D-33 10 steps in order
- BL-6: SQL function returns original_email for Resend cleanup
- Playwright e2e cascade test: affiliates anonymized + stripe_connect_account_id preserved + payouts retained + Stripe gone + Storage empty + auth.users gone
- 13 Phase 19 migrations applied; 10 Edge Functions deployed; 3 cron jobs registered
- App.tsx wires 3 route registries (BL-4)
- I-1: bundle ceiling green
</success_criteria>

<output>
After completion, create `19-09-SUMMARY.md` AND `19-SUMMARY.md` (phase-level): payout cron contract (daily materialize + monthly transfer + Vault auth); account-delete cascade order verified with BL-6 RETURNS TEXT proof; schema-push results (13/13); Edge Function URLs (10); e2e cascade green; IRS retention proven; BL-4 single-writer App.tsx confirmation; I-1 bundle ceiling pass; I-2 infra-phase routing note; phase handoff to P22 (ADMIN-06 + DEL-01 consumers).
</output>
