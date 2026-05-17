# Phase 25: HIPAA Audit Hardening + Vendor BAA Chain — Pattern Map

**Mapped:** 2026-05-17
**Files analyzed:** 23 new/modified files (5 migrations + 4 Edge Fns + 3 `_shared/` Edge helpers + 4 admin components + 2 patient/clinic components + 2 CI scripts + 2 JSON configs + 1 client hook + 7 policy markdowns counted as 1 group)
**Analogs found:** 21 / 23 (2 NO-ANALOG: `legal/hipaa/*.md` and `middleware.ts` root)

---

## Repository Layout Note (load-bearing)

This is a **dual-root monorepo**:

- **App source** lives at `/Users/karstenhaldan/minisite/leanshot/` (Vite SPA, React 19, scripts, CI working-dir).
- **Supabase backend** lives at `/Users/karstenhaldan/minisite/supabase/` — `migrations/` and `functions/` are NOT under `leanshot/`. The `leanshot/supabase/functions/_uat-resend` folder is a one-shot probe; canonical Edge Functions live at `/Users/karstenhaldan/minisite/supabase/functions/`.
- **CI workflows** at `/Users/karstenhaldan/minisite/.github/workflows/ci.yml` with `defaults.run.working-directory: leanshot`.
- **Shared helpers for Edge Fns** at `/Users/karstenhaldan/minisite/supabase/functions/_shared/` (currently 5 files: `cancel-token.ts`, `email-layout.ts`, `lifecycle-send.ts`, `lifecycle-utils.ts`, `resend-domain-health-check.ts`). Phase 24 plans to add `posthog-server.ts` here; Phase 25 adds `email-router.ts`, `anthropic-baa-allowlist.ts`.

Planner: all new Supabase paths in this phase MUST be under `/Users/karstenhaldan/minisite/supabase/...`, NOT `leanshot/supabase/...`. All client code (admin pages, patient settings tab, React hooks) MUST be under `/Users/karstenhaldan/minisite/leanshot/src/...`. Scripts under `/Users/karstenhaldan/minisite/leanshot/scripts/`. CI workflow edits go to `/Users/karstenhaldan/minisite/.github/workflows/ci.yml`.

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `supabase/migrations/<ts>_vendor_baa_chain.sql` | migration (DDL + RLS + seed rows) | append-only CRUD | `supabase/migrations/20270601000005_consent_records_table.sql` | exact (RLS-locked admin-read table with seed-eligible structure) |
| `supabase/migrations/<ts>_phi_access_log.sql` | migration (DDL + RLS deny + SECDEF RPC) | append-only audit insert | `supabase/migrations/20260601000001_audit_logs.sql` + `20270601000015_admin_stripe_action_audit_rpc.sql` | exact (append-only audit + SECDEF RPC writer) |
| `supabase/migrations/<ts>_subprocessor_snapshots.sql` | migration (DDL + RLS) | append-only snapshot CRUD | `supabase/migrations/20260601000001_audit_logs.sql` | role-match (append-only sibling table) |
| `supabase/migrations/<ts>_ses_suppression_list.sql` | migration (DDL + RLS) | event-driven write (webhook); CRUD read | `supabase/migrations/20270601000005_consent_records_table.sql` | role-match (RLS-locked support table) |
| `supabase/migrations/<ts>_baa_alert_cron.sql` | migration (pg_cron schedule) | event-driven (cron tick → HTTP POST) | `supabase/migrations/20270601000017_lifecycle_cron_schedules.sql` | exact (pg_cron + vault.decrypted_secrets bearer) |
| `supabase/migrations/<ts>_admin_compliance_module.sql` | migration (modules manifest seed) | CRUD | `supabase/migrations/20270601000005_consent_records_table.sql` | role-match (Phase 24 manifest dependency) |
| `supabase/functions/_shared/email-router.ts` | edge-helper (vendor split + health check) | request-response (to Resend/SES) | `supabase/functions/_shared/resend-domain-health-check.ts` | exact (lazy SDK init + gated-send health-check pattern) |
| `supabase/functions/_shared/anthropic-baa-allowlist.ts` | edge-helper (guard module) | sync request-response (assertion) | `supabase/functions/_shared/resend-domain-health-check.ts` | role-match (pure helper module in `_shared/`) |
| `supabase/functions/email-router/index.ts` | edge-fn HTTP wrapper | request-response | `supabase/functions/clinic-invite/index.ts` (esp. `resend.ts` sibling) | role-match (POST endpoint wrapping vendor SDK) |
| `supabase/functions/ses-bounce-webhook/index.ts` | edge-fn HTTP webhook | event-driven (SNS POST → DB insert) | `supabase/functions/stripe-webhook/index.ts` | exact (vendor signed HTTP webhook → idempotent write) |
| `supabase/functions/ai-chat-clinical/index.ts` (or `ai-chat` extension) | edge-fn proxy | streaming request-response | `supabase/functions/ai-chat/index.ts` | exact (LLM streaming proxy with JWT + persistence) |
| `supabase/functions/baa-expiry-check/index.ts` | edge-fn (cron-invoked) | event-driven (pg_cron → DB read → notification) | `supabase/functions/affiliate-payout/index.ts` | exact (cron-only fn + constant-time bearer + admin-client DB walk) |
| `supabase/functions/subprocessor-diff/index.ts` | edge-fn (cron-invoked) | batch (scrape → diff → DB write) | `supabase/functions/affiliate-payout/index.ts` | role-match (cron-only fn with admin-client DB writes) |
| `scripts/lint-stripe-phi.ts` | CI lint script | batch (file scan → fail/pass) | `leanshot/scripts/audit-privacy-manifest.mjs` | exact (zero-dep-or-fast-glob node CI gate with `::error::` annotations) |
| `scripts/stripe-phi-keywords.json` | config | static read | `leanshot/scripts/audit-privacy-manifest.mjs` (in-file `PLUGIN_TO_REQUIRED_CATEGORIES` table) | role-match (curated config consumed by CI script) |
| `scripts/audit-sentry-mask.ts` | CI lint script | batch (file scan → fail/pass) | `leanshot/scripts/audit-privacy-manifest.mjs` | exact (same node-script shape) |
| `scripts/sentry-mask-required-props.json` | config | static read | (twin of stripe-phi-keywords.json) | role-match |
| `src/components/admin/pages/AdminCompliancePage.tsx` | admin page (lazy-loaded) | CRUD read | `src/components/admin/pages/AdminAffiliatesPage.tsx` | exact (admin-page wrapper around feature scaffold) |
| `src/components/admin/compliance/{BaaChainTable,ExpiryBanner,SubprocessorDiffFeed,ComplianceModule}.tsx` | admin feature components | CRUD read | `src/components/admin/AdminAffiliatesReviewQueue.tsx` + `AdminLayout.tsx` | role-match (admin scaffold with `is_staff` probe + Pattern S1) |
| `src/components/dashboard/settings/PhiAccessLogTab.tsx` (or `account/PhiAccessLogTab.tsx`) | patient settings tab | CRUD read (RLS-scoped) | `src/components/dashboard/settings/PatientActivityModal.tsx` + `use-patient-activity.ts` | exact (patient-side transparency surface with paginated query) |
| `src/components/clinic/SetupTotp.tsx` | clinician onboarding modal | request-response (Supabase Auth) | `src/components/clinic/InvitePatientModal.tsx` (modal shape) + Phase-24 `/admin/setup-2fa` (mfa flow, not yet shipped) | role-match (modal + supabase.auth.mfa wiring) |
| `src/lib/hipaa/session-replay-guard.ts` | client lib hook | event-driven (route change → side-effect) | `src/lib/analytics.ts` (`initAnalytics()` dynamic-import pattern) | role-match (dynamic-import posthog-js + lifecycle hook) |
| `src/lib/hipaa/phi-access-rpc.ts` | client lib RPC wrapper | request-response | `src/lib/admin/admin-api.ts` (existing admin RPC wrapper) | role-match (typed wrapper around supabase.rpc) |
| `legal/hipaa/*.md` (7 policy files) | docs | n/a | — | NO ANALOG (greenfield policy text) |
| `middleware.ts` (root Vercel Routing Middleware) — IF v1.2 doesn't have one | edge middleware | request-response | `leanshot/vercel.json` `rewrites` + `headers` blocks (config-only today) | NO ANALOG (no `middleware.ts` exists; Phase 24 D-06 is the first to introduce one — confirm Phase 24 ships it before Phase 25 extends) |
| `.github/workflows/ci.yml` (additions only, not new file) | CI workflow step | event-driven (PR trigger) | existing `bundle budget` + `Security check` steps in `.github/workflows/ci.yml` lines 181-206 | exact (`run: bash scripts/...` + `::error::` patterns) |

---

## Pattern Assignments

### `supabase/migrations/<ts>_phi_access_log.sql` (migration, append-only audit insert)

**Analog:** `/Users/karstenhaldan/minisite/supabase/migrations/20260601000001_audit_logs.sql` + `/Users/karstenhaldan/minisite/supabase/migrations/20270601000015_admin_stripe_action_audit_rpc.sql`

**Header comment + STRIDE pattern** (audit_logs lines 1-39):
```sql
-- Phase 7 D-04 (audit log foundation — the headline threat-model surface for Phase 7).
-- Creates `public.audit_logs`: a single, append-only table that records every
-- cloud write across the 10 sync tables (...)
-- Companion migrations:
--   20260601000002_audit_triggers.sql       — SECURITY DEFINER trigger + 10 ATTACH statements
--   20260601000003_audit_retention_cron.sql — 13-month retention pg_cron job
-- STRIDE register (full text lives in 07-08-PLAN.md):
--   T-07-08-01 Tampering: authenticated role cannot directly INSERT/UPDATE/DELETE (...)
--   T-07-08-04 Information disclosure: RLS `audit_logs_select_own` (auth.uid()
--     = user_id) keeps user A's audit rows invisible to user B. Cross-tenant
--     impersonation proof in e2e/rls-audit-logs.test.ts.
```
→ Mirror this header structure for `phi_access_log.sql` (cite Phase 25 D-07/D-08, link companion migrations, list STRIDE threats T-25-02-* covered).

**Table DDL + indexes** (audit_logs lines 41-106):
```sql
create extension if not exists pgcrypto;
create table public.audit_logs (
  id bigserial primary key,
  timestamp timestamptz not null default now(),
  user_id uuid references auth.users(id) on delete set null,
  user_id_hash text not null,
  table_name text not null,
  row_id text,
  action text not null check (action in ('insert', 'update', 'delete', ...)),
  before_hash text,
  after_hash text,
  ip_hash text
);
create index audit_logs_user_timestamp_idx
  on public.audit_logs (user_id, timestamp desc);
alter table public.audit_logs enable row level security;
create policy "audit_logs_select_own"
  on public.audit_logs for select using (auth.uid() = user_id);
```
→ For `phi_access_log` use: `actor_user_id` + `accessed_user_id` columns (RESEARCH Pattern 1 lines 340-352), select policy scoped to `accessed_user_id = auth.uid()` (patient sees access to OWN data), and `accessed_org_id uuid` nullable for P28 forward-compat (Phase 24 D-04..05 pattern).

**Negative-space tamper-protection comment** (audit_logs lines 118-138):
```sql
-- TAMPERING MITIGATION (STRIDE-T, threat T-07-08-01):
-- NO INSERT, UPDATE, or DELETE policy exists for the authenticated role on
-- public.audit_logs. Postgres RLS default-deny semantics mean any direct
-- write attempt from a JWT-scoped client returns 42501 (...)
-- ONLY two write paths exist:
--   1. The SECURITY DEFINER `public.audit_trigger()` function (...)
--   2. The service_role JWT used by edge functions (...)
-- This is the negative-space mitigation — the absence of policies is the
-- enforcement. DO NOT add INSERT/UPDATE/DELETE policies (...)
```
→ Mirror this comment in `phi_access_log.sql`. ADDITIONALLY, per RESEARCH Pitfall 6, ship the explicit `revoke update, delete on public.phi_access_log from service_role;` because RLS deny policies do NOT auto-block `service_role`.

**SECDEF RPC writer** (admin_stripe_action_audit_rpc.sql lines 14-59):
```sql
create or replace function public.admin_log_refund(
  p_target_user_id uuid, p_charge_id text, p_amount_cents int, p_reason text
)
returns void
language plpgsql
security definer
set search_path = public, extensions, pg_catalog
as $$
declare
  v_caller uuid := auth.uid();
begin
  if v_caller is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if not public.is_admin_at_least('staff'::public.admin_role) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  -- (...validation...)
  perform set_config('app.suppress_audit', 'true', true);
  insert into public.audit_logs (...) values (...);
end;
$$;
revoke all on function public.admin_log_refund(uuid, text, int, text) from public;
grant execute on function public.admin_log_refund(uuid, text, int, text) to authenticated;
```
→ Copy this shape EXACTLY for `log_phi_access(p_accessed_user_id, p_accessed_fields, p_reason, p_accessed_org_id default null)`. Drop the `public.is_admin_at_least('staff'::public.admin_role)` gate (any authenticated clinician/admin can log access — gate is checked at UI/RPC integration layer). KEEP `set search_path = ...` (RESEARCH Pitfall 5). KEEP `revoke all from public; grant execute to authenticated;`.

---

### `supabase/migrations/<ts>_vendor_baa_chain.sql` (migration, CRUD with seed)

**Analog:** `/Users/karstenhaldan/minisite/supabase/migrations/20270601000005_consent_records_table.sql`

**Header + writer-ownership comment** (lines 1-12):
```sql
-- Phase 22 plan 01 — D-07: cookie consent + email-preferences records table.
-- Analog: supabase/migrations/20260601000010_pending_account_deletions.sql (RLS-locked-table)
-- Pitfalls applied: Pitfall 1 (no partial index with now()), per-file slug prefix in tests.
--
-- WRITER OWNERSHIP per feedback_status_machine_transition_owner.md (...):
--   1. Cookie banner onChange callback in plan 22-10 — UPSERT cookie_categories.
--   2. /settings/email-preferences Save action in plan 22-11 — UPSERT email_preferences.
--   3. "Withdraw consent" CTA → UPDATE setting revoked_at = now() (...)
```
→ For `vendor_baa_chain.sql`, declare writer-ownership for `status` column: who writes `pending`, who writes `signed`, who writes `expired` (planner per `[[feedback_status_machine_transition_owner_rule]]`). Likely: seed inserts `pending` rows in this migration; baa-expiry-check cron writes `expired`; founder manually writes `signed` via admin compliance UI (Plan 25-08).

**RLS policy shape** (consent_records lines 36-65):
```sql
alter table public.consent_records enable row level security;

create policy "consent_records_select_own"
  on public.consent_records
  for select to authenticated
  using (auth.uid() = user_id);

create policy "consent_records_insert_self_or_anon"
  on public.consent_records
  for insert to authenticated
  with check (auth.uid() = user_id or user_id is null);

create policy "consent_records_update_own"
  on public.consent_records
  for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- NO DELETE policy — consent history is append-only for GDPR Article 7(1) burden-of-proof.
```
→ For `vendor_baa_chain`: select policy gated on `public.is_admin_at_least('staff'::public.admin_role)` (admin-read only, not per-user); INSERT/UPDATE policies gated on superadmin role (D-04). NO DELETE. Seed 6 rows in the migration body: Supabase, Vercel, Sentry, Anthropic, AWS SES, PostHog (CONTEXT D-01, status `pending`, `baa_expiry_at = null`, columns per CONTEXT specifics line 152).

---

### `supabase/migrations/<ts>_baa_alert_cron.sql` (migration, pg_cron schedule)

**Analog:** `/Users/karstenhaldan/minisite/supabase/migrations/20270601000017_lifecycle_cron_schedules.sql`

**Vault-backed bearer pattern** (lines 1-22 + 28-48):
```sql
-- Phase 22 plan 22-02 — D-03: pg_cron schedules for lifecycle Edge Functions (ON-02).
-- BL-7 (Vault): every cron POST reads `service_role_key` out of
-- `vault.decrypted_secrets` (loaded out-of-band via Dashboard → Project Settings → Vault per
-- migration 20270101000014). The lifecycle Edge Functions perform a constant-time bearer compare
-- against SUPABASE_SERVICE_ROLE_KEY before doing any work.
--
-- D-03 gated-send: every lifecycle fn calls `resendDomainHealthCheck()` at startup. (...)
-- Idempotency: `cron.schedule` upserts by jobname; re-running this migration replaces the schedule
-- rather than duplicating it.

create extension if not exists pg_cron;

select cron.schedule(
  'lifecycle-welcome-series',
  '0 */4 * * *',
  $$
    select net.http_post(
      url := 'https://ytnsipxxmzgaebkqmokp.supabase.co/functions/v1/lifecycle-welcome-series',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (
          select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key' limit 1
        )
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 60000
    );
  $$
);
```
→ For Phase 25 add TWO cron jobs:
  - `baa-expiry-check` schedule `0 6 * * *` (nightly 06:00 UTC) → POSTs to `baa-expiry-check` Edge Fn.
  - `subprocessor-diff` schedule `0 7 * * 1` (Monday 07:00 UTC) → POSTs to `subprocessor-diff` Edge Fn.

KEEP the vault.decrypted_secrets bearer + idempotency comment. Project URL `https://ytnsipxxmzgaebkqmokp.supabase.co` is correct (verified from existing migration). Plan 25-08 entry condition MUST verify `service_role_key` exists in Vault — per `[[reference_supabase_migration_gotchas]]` + Phase 16 vault key carry-over note in MEMORY.md.

---

### `supabase/functions/_shared/email-router.ts` (edge-helper, vendor split + health check)

**Analog:** `/Users/karstenhaldan/minisite/supabase/functions/_shared/resend-domain-health-check.ts`

**File header + contract pattern** (lines 1-25):
```typescript
/**
 * Resend domain gated-send health check — Phase 22 plan 22-02 (D-03).
 *
 * Source: `.planning/phases/22-…/22-RESEARCH.md` §Pattern 2 lines 412-443,
 * `reference_vendor_gated_send_health_check.md` (project memory).
 *
 * Contract per D-03:
 *   - Read `Deno.env.get('RESEND_API_KEY')`.
 *   - If unset → return `{ok:false, status:'no_api_key'}` (no fetch, no counter).
 *   - If equals 'test-stub' → return `{ok:true, status:'verified'}` (Pitfall 6 —
 *     Resend free-tier 2/hour rate-limit kills lifecycle tests).
 *   - Otherwise fetch GET `https://api.resend.com/domains` with bearer.
 * (...)
 * PII safety (T-22-13): NEVER echo `res.text()` or exception messages. (...)
 * Cutover when DNS verifies: zero code changes (...)
 */
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
```
→ Mirror this exact header style for `email-router.ts`. Cite Phase 25 D-03 + `[[reference_vendor_gated_send_health_check]]` + `[[reference_resend_phase9_wiring]]`. Document the `AWS_SES_BAA_ACTIVE` health-check gate (RESEARCH Pitfall 7).

**Gated-send no-op pattern** (lines 40-66):
```typescript
export async function resendDomainHealthCheck(
  supabase: SupabaseClient,
): Promise<ResendDomainHealth> {
  const apiKey = Deno.env.get('RESEND_API_KEY');
  if (!apiKey) {
    return { ok: false, status: 'no_api_key' };
  }
  if (apiKey === 'test-stub') {
    return { ok: true, status: 'verified' };
  }
  let res: Response;
  try {
    res = await fetch('https://api.resend.com/domains', {
      headers: { 'Authorization': `Bearer ${apiKey}` },
    });
  } catch (e) {
    console.warn('[lifecycle/health] resend fetch threw',
      e instanceof Error ? e.name : 'unknown');
    await incrementSkipCounter(supabase);
    return { ok: false, status: 'fetch_error' };
  }
  (...)
}
```
→ For `email-router.ts` `sendEmail()`, follow RESEARCH Pattern 2 (lines 408-483 of 25-RESEARCH.md) — PHI branch checks `AWS_SES_BAA_ACTIVE` env flag and no-ops with `{provider:'ses', id:'noop-baa-pending'}` if unset. The non-PHI Resend branch is the existing path (reuse existing Resend wiring).

**Lazy SDK singleton pattern** (synthesized from RESEARCH Pattern 2 lines 424-443 + matches `affiliate-payout/index.ts` lines 56-79 lazy `_stripeInstance` / `_adminInstance` pattern):
```typescript
let _ses: SESv2Client | null = null;
let _resend: Resend | null = null;

function ses(): SESv2Client {
  if (_ses) return _ses;
  _ses = new SESv2Client({ region: ..., credentials: { ... } });
  return _ses;
}
```
→ Required (NOT module-level init) so Deno test files can `Deno.env.set()` before first send. See `affiliate-payout/index.ts:56-79` for the established lazy-singleton lint pattern (`deno-lint-ignore no-explicit-any` on `_stripeInstance` is acceptable for test-injection).

**PII safety pattern** (lines 58-65):
```typescript
} catch (e) {
  // T-22-13: NEVER echo the exception message (it may contain the
  // Authorization header value in network-layer errors).
  console.warn(
    '[lifecycle/health] resend fetch threw',
    e instanceof Error ? e.name : 'unknown',
  );
}
```
→ Mirror: every catch in `email-router.ts` logs `e.name` only, never `e.message`. Apply to AWS SES + Resend branches equally. Add `T-25-03-*` STRIDE labels in plan.

---

### `supabase/functions/_shared/anthropic-baa-allowlist.ts` (edge-helper, sync guard)

**Analog:** None in `_shared/` is a pure assertion module yet. Closest: `/Users/karstenhaldan/minisite/supabase/functions/_shared/resend-domain-health-check.ts` (helper-fn-only shape, no Deno.serve).

→ Use RESEARCH Pattern 3 (25-RESEARCH.md lines 496-547) verbatim. Add file header citing Phase 25 D-14, HIPAA-04 SC #1, RESEARCH Pitfall 2 (Anthropic does NOT publish per-model BAA tags — engineering-curated). Include `// Last reviewed: <date>` comment and link to `[[reference_hipaa_baa_vendor_matrix]]` for maintenance policy.

---

### `supabase/functions/ses-bounce-webhook/index.ts` (edge-fn, signed HTTP webhook → DB write)

**Analog:** `/Users/karstenhaldan/minisite/supabase/functions/stripe-webhook/index.ts`

**Module-level security invariants header** (lines 1-19):
```typescript
/**
 * stripe-webhook Edge Function — Phase 14 Plan 03
 *
 * Single source of truth for `subscriptions` table state (D-14).
 *
 * Security invariants:
 *  - RAW BODY read via `request.text()` BEFORE any signature work (Pitfall 3).
 *    Never call `request.json()` before `constructEventAsync`.
 *  - Signature verification via `stripe.webhooks.constructEventAsync` +
 *    `Stripe.createSubtleCryptoProvider()` (required on Deno — Pitfall 2).
 *  - Idempotency via `subscription_events.event_id PRIMARY KEY` +
 *    `INSERT … ON CONFLICT DO NOTHING` (Pattern B). Postgres error 23505 =
 *    already processed → return 200 `{ duplicate: true }`.
 *  - PII safety: every error response is `{ error: '<short-code>' }`.
 *    `console.error` logs `err.message` but NEVER `event.data.object`.
 *  - `Cache-Control: private, no-store` on every response (T-14-03-I2).
 *  - SUPABASE_SERVICE_ROLE_KEY read once at cold-start (...)
 */
```
→ Mirror for `ses-bounce-webhook`: SNS signature verification (X-Amz-Sns-Message-Type + signing-cert URL); idempotency on SNS `MessageId` (primary key in `ses_suppression_list` or sibling `ses_bounce_events` table); PII safety (NEVER echo recipient email into response body — log a hash only); raw-body-before-parse for SNS signature.

**Lazy env-read pattern** (lines 31-45):
```typescript
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';

function getStripeSecretKey(): string {
  return Deno.env.get('STRIPE_SECRET_KEY') ?? '';
}
function getWebhookSecret(): string {
  return Deno.env.get('STRIPE_WEBHOOK_SECRET') ?? '';
}
```
→ Same lazy-read pattern for SNS verification config + AWS region. SUPABASE_URL acceptable at module level (immutable); secrets/keys via getters so test files can `Deno.env.set()` after import.

**jsonResponse helper + admin singleton** (lines 50-65):
```typescript
const admin = createClient(
  SUPABASE_URL || 'https://placeholder.supabase.co',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || 'placeholder_key',
  { auth: { autoRefreshToken: false, persistSession: false } },
);
function jsonResponse(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), { status, headers: BASE_RESPONSE_HEADERS });
}
```
→ Copy literally for `ses-bounce-webhook` (with a per-fn `cors.ts` mirroring `clinic-invite/cors.ts`).

---

### `supabase/functions/ai-chat-clinical/index.ts` (edge-fn, streaming LLM proxy)

**Analog:** `/Users/karstenhaldan/minisite/supabase/functions/ai-chat/index.ts`

**JWT → user resolution + admin client** (lines 183-203):
```typescript
Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return jsonError(405, 'method-not-allowed');

  const authHeader = req.headers.get('Authorization') ?? '';
  const jwt = authHeader.replace(/^Bearer\s+/i, '');
  if (!jwt) return jsonError(401, 'missing-jwt');

  const { data: userData, error: userErr } = await admin.auth.getUser(jwt);
  if (userErr || !userData?.user) return jsonError(401, 'invalid-jwt');
  const user = userData.user;
```
→ Reuse verbatim. ADD before stream-open (after step 6 refusal pre-check, before step 9 upstream fetch):
```typescript
// Phase 25 D-13: branch on org_id (clinical vs consumer).
// Phase 25 D-14: BAA-scope guard MUST run BEFORE forward.
const orgId = await resolveOrgId(admin, user.id); // helper: SELECT from clinic_patients / org_members
const isClinical = orgId !== null;

if (isClinical) {
  try {
    assertBaaCoveredModel(modelId); // throws Response per Pattern 3
  } catch (rejection) {
    if (rejection instanceof Response) {
      // Audit-log the refusal per HIPAA-04 SC #1 via SECDEF RPC.
      // Phase 24 revoked INSERT on audit_logs from service_role — only SECDEF
      // functions and triggers may insert. See Plan 25-04 Task 0 migration.
      await admin.rpc('log_baa_guard_refusal', {
        p_user_id: user.id,
        p_payload: { modelId, reason: 'allowlist-or-denylist-violation' },
      });
      return rejection;
    }
    throw rejection;
  }
}
```

**Streaming + persist drainer pattern** (lines 350-364):
```typescript
const [toClient, toCapture] = upstreamResp.body.tee();
// @ts-expect-error — EdgeRuntime is injected by Supabase Edge Runtime; not in @types/deno.
EdgeRuntime.waitUntil(captureAndPersist(toCapture, user.id, mode));

return new Response(toClient, {
  status: 200,
  headers: {
    ...corsHeaders,
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
  },
});
```
→ Reuse for clinical branch — same SSE response shape. SWAP Moonshot URL/key for Anthropic clinical key + Anthropic Messages API streaming endpoint. Per RESEARCH Open Question + correction #2 (line 119), planner MUST resolve: replace Moonshot entirely OR keep Moonshot consumer + Anthropic clinical OR Anthropic-only. Document choice in Plan 25-04 header.

**T-04-04 invariant (user_id from JWT, never body)** (lines 167-170):
```typescript
// T-04-04 mitigation invariant: `user_id` is the verified JWT id passed
// from the request handler — NEVER from request body or upstream payload.
await admin.from('ai_messages').insert({
  user_id: userId, ...
});
```
→ Carry forward. ADDITIONALLY, the `org_id` resolution MUST go through admin-client DB lookup keyed on `user.id` — NEVER read from request body (parallel anti-pattern: silent fallback to consumer key when body says `org_id=null` could let a clinical user dodge BAA scope; RESEARCH Anti-Patterns line 637).

---

### `supabase/functions/baa-expiry-check/index.ts` (edge-fn, cron-invoked)

**Analog:** `/Users/karstenhaldan/minisite/supabase/functions/affiliate-payout/index.ts`

**Cron-only constant-time bearer compare** (lines 1-13 docstring + implementation pattern):
```typescript
/**
 * `affiliate-payout` Edge Function — Phase 19 Plan 19-09 (AFF-06).
 * Monthly cron-invoked Edge Function (1st of month, 00:00 UTC) that walks
 * eligible pending payouts (...)
 *   POST /functions/v1/affiliate-payout    (verify_jwt = true — service-role-only)
 *
 * Invariants (locked by plan-checker iter-2):
 *   1. Constant-time bearer compare against SUPABASE_SERVICE_ROLE_KEY (V2).
 *      The bearer is sourced by pg_cron from vault.decrypted_secrets (BL-7).
 */
```
→ Adopt: `baa-expiry-check` is service-role-only (cron invokes via vault bearer). On startup, constant-time compare `Authorization` header vs `SUPABASE_SERVICE_ROLE_KEY`. Body is empty `{}` from cron.

**Lazy admin singleton with test injection** (lines 71-79):
```typescript
let _adminInstance: SupabaseClient | null = null;
function getAdmin(): SupabaseClient {
  if (_adminInstance === null) {
    _adminInstance = createClient(getSupabaseUrl(), getSupabaseServiceRoleKey(), {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  }
  return _adminInstance;
}
```
→ Copy. Walk `vendor_baa_chain` rows where `baa_expiry_at <= now() + interval '60 days'`. For each: compute days-until-expiry, write an `audit_logs` row + a `notifications` row keyed `vendor_baa_expiry_warning_<vendor>_<bucket>` (idempotency via composite unique index) for the 60/30/14/7/1-day buckets.

**Test injection seam** (lines 30-31 docstring):
```typescript
 * Test seam:
 *   `__internal.setAdminForTest(fake)` overrides the admin client.
 *   `__internal.setStripeForTest(stub)` overrides the Stripe client.
 */
```
→ Mirror: export `__internal.setAdminForTest()` for the Deno test file. No external SDK to inject here (just supabase-js + Resend for email-to-founder).

---

### `supabase/functions/subprocessor-diff/index.ts` (edge-fn, cron-invoked batch)

**Analog:** `/Users/karstenhaldan/minisite/supabase/functions/affiliate-payout/index.ts` (cron + admin walk) + `/Users/karstenhaldan/minisite/supabase/functions/_shared/resend-domain-health-check.ts` (external HTTP fetch with PII-safe catches)

→ Reuse `affiliate-payout/index.ts` shell for the cron + bearer compare. Inside, loop over 6 vendor URLs; `fetch(vendorSubprocessorPageUrl)` with the same PII-safe catch pattern as `resend-domain-health-check.ts` lines 58-65 (`e.name` not `e.message`); diff against latest `subprocessor_snapshots` row per vendor; on change → INSERT new snapshot row + alert via baa-expiry-check's notification path.

---

### `scripts/lint-stripe-phi.ts` (CI lint script, batch)

**Analog:** `/Users/karstenhaldan/minisite/leanshot/scripts/audit-privacy-manifest.mjs`

**File header pattern** (lines 1-31):
```javascript
#!/usr/bin/env node
// audit-privacy-manifest.mjs
//
// Validates that apps/ios/App/App/PrivacyInfo.xcprivacy matches (...)
//
// Phase 16 Plan 16-07 — implements MOBILE-05 CI-gate half (D-18).
//
// Design constraints (Plan 16-07 §<action> Task 2):
//   - Zero npm dependencies. Node 22+ built-ins only. (...)
//   - Hand-rolled regex-based extractor of `<key>NAME</key>\s*<TYPE>VALUE</TYPE>`
//     patterns is auditable in <300 lines.
//
// CLI flags (parsed from process.argv):
//   --manifest=<path>      (default: apps/ios/App/App/PrivacyInfo.xcprivacy)
//   (...)
//
// Exit codes:
//   0 = PASS (or warnings-only without --strict, or SKIPPED when manifest absent pre-Wave-3)
//   1 = FAIL (...)
//
// GitHub Actions annotation format:
//   ::error::<message>       (always non-zero exit)
//   ::warning::<message>     (exit depends on --strict)
```
→ Mirror for `lint-stripe-phi.ts`. Cite Phase 25 D-09. Per RESEARCH Pitfall 11, ship word-boundary anchors `\b<kw>\b` per keyword. Match scope = object literal value of `stripe.<resource>.<verb>({...})` calls only — NOT the whole file (per RESEARCH Example 5 lines 794-836).

**Imports + file scan loop** (synthesized from `audit-privacy-manifest.mjs` lines 33-37 + RESEARCH Example 5):
```typescript
// audit-privacy-manifest.mjs uses node:fs built-ins only.
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
```
RESEARCH Example 5 uses `fast-glob`. Project memory note: `fast-glob` is already in dev (`audit-privacy-manifest.test.mjs` exists; check `package.json` first). If absent, mirror `audit-privacy-manifest.mjs` zero-dep posture (`fs.readdirSync` recursion under `src/` and `supabase/functions/`).

**GitHub Actions annotation + exit-code pattern** (mentioned in audit-privacy-manifest.mjs header, used through file):
```
::error::<message>       (always non-zero exit)
::warning::<message>     (exit depends on --strict)
```
→ Reuse. Plan 25-05 acceptance: CI step `npm run lint:stripe-phi` exits 0 on clean code, exits 1 with `::error file=src/X.ts,line=42::keyword "patient"...` on violation. CROSS-CHECK with existing bundle-budget bash scripts at `leanshot/scripts/assert-*.sh` for `::error::` precedent in this repo (lines 181-206 of `.github/workflows/ci.yml`).

---

### `scripts/audit-sentry-mask.ts` (CI lint script)

**Analog:** `/Users/karstenhaldan/minisite/leanshot/scripts/audit-privacy-manifest.mjs` (twin of lint-stripe-phi.ts)

→ Same shell as `lint-stripe-phi.ts` above. Scan `.tsx` files; for any element receiving a prop whose name is in `scripts/sentry-mask-required-props.json` (e.g. `patient.name`, `dose.value`, `photo.url`), assert the enclosing JSX element has `data-sentry-mask` attribute. Use a simple AST-free regex on JSX prop bindings (matches existing zero-dep posture); document that AST upgrade is acceptable only if false-positive rate exceeds 10% in the first month (per RESEARCH Pitfall 11 pattern).

---

### `src/components/admin/pages/AdminCompliancePage.tsx` (admin page wrapper)

**Analog:** `/Users/karstenhaldan/minisite/leanshot/src/components/admin/pages/AdminAffiliatesPage.tsx`

**Page wrapper pattern** (lines 1-27):
```typescript
/**
 * Phase 22 Plan 22-07 — /admin/affiliates page (ADMIN-06).
 *
 * Thin wrapper that mounts the AdminAffiliatesReviewQueue inside the shared
 * AdminLayout. The queue itself owns the is_staff probe + RPC writes; this
 * page exists so that App.tsx (plan 22-12) can React.lazy() a single
 * default-exported route component, mirroring how /admin/members and
 * /admin/metrics already wire up.
 */
import { AdminLayout } from '@/components/admin/AdminLayout';
import { AdminAffiliatesReviewQueue } from '@/components/admin/AdminAffiliatesReviewQueue';

export function AdminAffiliatesPage() {
  return (
    <AdminLayout active="affiliates" heading="Affiliate conversions">
      <AdminAffiliatesReviewQueue />
    </AdminLayout>
  );
}

export default AdminAffiliatesPage;
```
→ Copy verbatim. Substitute `compliance` for `affiliates`, `Compliance` for the heading. The default export is required for `React.lazy()` wiring (Phase 24 D-01 manifest entry `lazy: () => import('@/components/admin/pages/AdminCompliancePage')`).

NOTE: Phase 24 plans to refactor `AdminLayout` to accept a manifest-driven `active` key. Plan 25-08 entry condition MUST verify Phase 24's modular AdminLayout (D-01) has shipped before adding the `compliance` nav entry — OR fallback to the current 4-link `AdminNavKey` union and extend with `'compliance'`.

---

### `src/components/admin/compliance/{BaaChainTable,ExpiryBanner,SubprocessorDiffFeed,ComplianceModule}.tsx`

**Analog:** `/Users/karstenhaldan/minisite/leanshot/src/components/admin/AdminLayout.tsx` (Pattern S1 is_staff probe — current SOT)

**Pattern S1 is_staff probe** (lines 95-127):
```typescript
export function AdminLayout({ active, heading, headerAction, children }: AdminLayoutProps) {
  const [isStaff, setIsStaff] = useState<boolean | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: userData } = await supabase.auth.getUser();
      const uid = userData?.user?.id;
      if (!uid) { if (!cancelled) setIsStaff(false); return; }
      const { data: profile } = await supabase
        .from('profiles')
        .select('is_staff')
        .eq('id', uid)
        .maybeSingle();
      const staff = (profile as { is_staff?: boolean } | null)?.is_staff === true;
      if (!cancelled) setIsStaff(staff);
    })().catch(() => { if (!cancelled) setIsStaff(false); });
    return () => { cancelled = true; };
  }, []);

  if (isStaff === undefined) return null;
  if (!isStaff) return <NotAuthorizedCard />;
  return (...);
}
```
→ For the COMPLIANCE module, gate at SUPERADMIN level (Phase 24 D-04 — superadmin tier writes/manages BAA). Add a `admin_role` column read alongside `is_staff`, OR if Phase 24's enum migration hasn't landed yet, fall back to a feature-flag-checked `is_staff && profiles.admin_role = 'superadmin'` predicate. Plan 25-08 MUST coordinate with Phase 24 D-04 (`admin_role` enum addition).

**Pattern S1 reminder for ALL admin RPCs** (Phase 24 D-03 + this AdminLayout file's STRIDE register comment):
```typescript
/**
 * Phase 22 Plan 22-06 — AdminLayout shell with is_staff client gate + sub-nav.
 *
 * UX layer ONLY — the security boundary is each admin RPC's
 * is_admin_at_least() gate (Pattern S1 dual-layer, 22-PATTERNS Wave E). (...)
 */
```
→ Every new admin RPC in Phase 25 (vendor_baa update, subprocessor diff acknowledge) MUST also re-check `public.is_admin_at_least('staff'::public.admin_role)` AND `admin_role = 'superadmin'` at the DB function level (mirroring `admin_log_refund` lines 30-33 in `20270601000015_admin_stripe_action_audit_rpc.sql`).

---

### `src/components/dashboard/settings/PhiAccessLogTab.tsx` (patient settings tab — "Who has viewed my data")

**Analog:** `/Users/karstenhaldan/minisite/leanshot/src/components/dashboard/settings/PatientActivityModal.tsx` + `use-patient-activity.ts`

**Modal/tab structure** (PatientActivityModal lines 1-50):
```typescript
/**
 * Phase 10 Plan 10-09 — PatientActivityModal.
 * Fills the Phase 9 D-15 stub "View activity" on Active Organizations rows.
 * Renders a two-tab modal (Operator views / Ranking events) with 25-row
 * pagination. Focus is returned to the trigger button on close.
 *
 * SECURITY (D-19): This component deliberately does NOT call posthog.capture.
 * The patient-side mirror modal is a transparency surface under HBNR/WMHMDA.
 * Meta-auditing patient transparency views would be surveillance theater.
 */
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { type RefObject, useRef, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { Modal } from '@/components/ui/Modal';
import { Skeleton } from '@/components/ui/Skeleton';
import { PatientActivityRow } from './PatientActivityRow';
import { type ActivityTab, usePatientActivity } from './use-patient-activity';
```
→ Carry the "no posthog.capture on transparency surfaces" comment forward — explicit per CONTEXT D-08 (patient sees own PHI-access history). Use the same `usePatientActivity`-style hook (`usePhiAccessLog`), 25-row pagination, Skeleton loading, EmptyState empty.

**Loading + error + pagination shape** (lines 50-100):
```typescript
function TabPanel({ orgId, orgName, tab, offset, onPrev, onNext, onRetry }: TabPanelProps) {
  const { rows, loading, error, hasMore, total } = usePatientActivity(...);
  if (loading) return (<div className="space-y-2 py-2" role="status" aria-live="polite" aria-busy>
    <Skeleton className="h-10 w-full rounded-lg" />
    ...
  </div>);
  if (error) return (...);
  ...
}
```
→ Mirror the loading-state ARIA + Skeleton triple-row + error Retry button. The hook `usePhiAccessLog(offset, limit)` selects from `phi_access_log` filtered by `accessed_user_id = auth.uid()` (RLS-scoped, no explicit predicate needed — RLS handles it per the SELECT policy in the migration).

NOTE: This is a TAB inside `SettingsPage.tsx`, not a modal. Add a new `Section` union member `'phi-access-log'` per SettingsPage.tsx lines 46-65 pattern, with a corresponding NAV entry (icon: Shield or similar lucide icon).

---

### `src/components/clinic/SetupTotp.tsx` (clinician MFA enrollment modal)

**Analog:** `/Users/karstenhaldan/minisite/leanshot/src/components/clinic/InvitePatientModal.tsx` (modal shape only — MFA wiring is novel)

→ Phase 24 D-06..D-09 covers the admin TOTP enrollment flow at `/admin/setup-2fa`. Phase 25 D-10 EXTENDS this to clinicians at `/clinic/*` (hard-cut). Plan 25 should:
  1. Wait for Phase 24 D-06 to ship `/admin/setup-2fa` and the underlying `supabase.auth.mfa.enroll/challenge/verify` wrapper.
  2. Spawn `src/components/clinic/SetupTotp.tsx` as a parallel route `/clinic/setup-2fa` that REUSES the helper (e.g. `src/lib/auth-mfa.ts` if Phase 24 ships it; otherwise call `supabase.auth.mfa.enroll(...)` directly per Supabase docs).
  3. Vercel Routing Middleware (Phase 24's `/admin/*` aal2 step-up) MUST be extended to `/clinic/*` — this is the "hard-cut" surface. If Phase 24 doesn't ship a `middleware.ts`, Plan 25 must create one (see NO ANALOG section).

Modal shape from `InvitePatientModal.tsx`: same `<Modal>` + form + supabase-js calls (use `supabase.auth.mfa.enroll({ factorType: 'totp' })` from CONTEXT D-07).

---

### `src/lib/hipaa/session-replay-guard.ts` (client hook)

**Analog:** `/Users/karstenhaldan/minisite/leanshot/src/lib/analytics.ts`

**Dynamic-import posthog-js pattern** (lines 87-113):
```typescript
void import('posthog-js').then(({ default: posthog }) => {
  posthog.init(key, {
    api_host: host,
    persistence: 'localStorage',
    autocapture: false,
    capture_pageview: false,
    disable_surveys: true,
    loaded: (ph) => {
      if (!enabled) {
        ph.opt_out_capturing();
        pendingTrackQueue.length = 0;
        return;
      }
      (...)
    },
  });
});
```
→ Mirror dynamic-import (CRITICAL — direct static `import posthog from 'posthog-js'` would trip the bundle-regression CI guard per `[[project_phase5_bundle_regression]]`). Use RESEARCH Pattern 4 (25-RESEARCH.md lines 572-599) verbatim — `useEffect` + `void import('posthog-js').then(...)` + `posthog.stopSessionRecording()` on PHI route match.

**ADDITIONALLY harden analytics.ts itself**: per RESEARCH Pitfall 1 the existing `posthog.init()` call at `src/lib/analytics.ts:88-112` should ALSO set `disable_session_recording: true` as a global default (no `session_recording` key exists today in the call — verify before/after). Plan 25-06b owns this edit.

**Caller wiring in `src/main.tsx`** (RESEARCH lines 604-610):
```typescript
import { useSessionReplayPhiGuard } from '@/lib/hipaa/session-replay-guard';

function AppRoot() {
  useSessionReplayPhiGuard();   // <-- HIPAA-17 enforcement
  return <App />;
}
```
→ Note: existing `main.tsx` mounts `<App />` directly; introducing an `AppRoot` wrapper requires updating the `createRoot(...).render(...)` call. Plan 25-06b acceptance: verify hydration order — `useSessionReplayPhiGuard` must run AFTER `initAnalytics()` deferral but BEFORE any PHI route can mount.

---

### `src/lib/hipaa/phi-access-rpc.ts` (typed wrapper around `log_phi_access` RPC)

**Analog:** `/Users/karstenhaldan/minisite/leanshot/src/lib/admin/admin-api.ts` (admin RPC wrappers in the same shape)

→ Wrap `supabase.rpc('log_phi_access', { p_accessed_user_id, p_accessed_fields, p_reason, p_accessed_org_id })` with typed args + result. Fire-and-forget pattern (caller doesn't await the return) so PHI-access logging never blocks UI render. Document in JSDoc: per Phase 25 D-07, callers are sensitive-surface UI components (patient detail page, photo viewer, dose-history export, conversation thread).

Sites to instrument (per D-07): clinician patient-detail page open, photo viewer open, dose-history export run, conversation thread open. Each emits exactly one RPC call per access event — roster pagination does NOT call this (aggregate counts ≠ "access to PHI").

---

### `.github/workflows/ci.yml` (additions for Phase 25)

**Analog:** `/Users/karstenhaldan/minisite/.github/workflows/ci.yml` existing bundle-budget + dev-trigger-grep steps (lines 181-206)

**Existing step pattern** (lines 181-206):
```yaml
      - name: Assert bundle budget (jspdf chunk topology — Phase 7 COMPL-06 guard)
        run: bash scripts/assert-bundle-budget.sh

      - name: Hash-hyphen regression test (Phase 12 D-13)
        run: bash scripts/test-hash-hyphen-regression.sh

      - name: Security check — dev-only trigger absent from production build
        run: |
          if grep -r --include="*.js" "phase-1-sentry-smoke" dist/ ; then
            echo "FAIL: dev-only Sentry trigger 'phase-1-sentry-smoke' leaked into production bundle"
            exit 1
          fi
```
→ Phase 25 adds TWO steps to the same CI workflow (NOT new workflow files — keep them all in `ci.yml` so `concurrency:` cancellation works):
```yaml
      - name: Stripe PHI keyword lint (Phase 25 HIPAA-08)
        run: node scripts/lint-stripe-phi.ts

      - name: Sentry data-sentry-mask audit (Phase 25 HIPAA-16)
        run: node scripts/audit-sentry-mask.ts
```
The `defaults.run.working-directory: leanshot` at the top of the workflow handles cwd. Both scripts should be runnable from `leanshot/`.

---

## Shared Patterns

### Pattern S1: Dual-layer security (client gate + RPC re-check)

**Source:** `src/components/admin/AdminLayout.tsx` lines 95-127 (client gate); `supabase/migrations/20270601000015_admin_stripe_action_audit_rpc.sql` lines 27-33 (RPC re-check)
**Apply to:** ALL Phase 25 admin surfaces (compliance page, vendor_baa CRUD RPCs, baa-expiry-check Edge Fn audit-log writes) + clinician PHI-access surfaces (Plan 25-02 log_phi_access RPC ALSO checks `auth.uid()` server-side, never trusts the actor_user_id from request body).

Client side:
```typescript
// AdminLayout.tsx lines 96-127
const [isStaff, setIsStaff] = useState<boolean | undefined>(undefined);
useEffect(() => {
  (async () => {
    const { data: userData } = await supabase.auth.getUser();
    const uid = userData?.user?.id;
    if (!uid) { setIsStaff(false); return; }
    const { data: profile } = await supabase.from('profiles').select('is_staff').eq('id', uid).maybeSingle();
    setIsStaff((profile as { is_staff?: boolean } | null)?.is_staff === true);
  })().catch(() => setIsStaff(false));
}, []);
```

DB side (re-check via SECDEF + raise):
```sql
-- 20270601000015_admin_stripe_action_audit_rpc.sql lines 27-33
declare v_caller uuid := auth.uid();
begin
  if v_caller is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  if not public.is_admin_at_least('staff'::public.admin_role) then raise exception 'forbidden' using errcode = '42501'; end if;
```

### Pattern S2: Append-only RLS with explicit service_role REVOKE

**Source:** `supabase/migrations/20260601000001_audit_logs.sql` lines 118-138 + RESEARCH Pitfall 6
**Apply to:** `phi_access_log`, `subprocessor_snapshots`, `vendor_baa_chain` (status column transitions append a row to audit_logs rather than UPDATE).

```sql
-- audit_logs.sql lines 108-138 — RLS-by-absence
alter table public.<table> enable row level security;
create policy "<table>_select_own" on public.<table>
  for select using (auth.uid() = user_id);
-- NO INSERT/UPDATE/DELETE policy for authenticated role.
-- THEN per RESEARCH Pitfall 6:
revoke update, delete on public.<table> from service_role;
```

### Pattern S3: PII-safe error logging (`e.name` not `e.message`)

**Source:** `supabase/functions/_shared/resend-domain-health-check.ts` lines 58-65 + `supabase/functions/affiliate-payout/index.ts` docstring "PII safety (Pattern S3): never echo Stripe error messages"
**Apply to:** ALL Phase 25 Edge Functions (email-router, ses-bounce-webhook, ai-chat-clinical, baa-expiry-check, subprocessor-diff).

```typescript
} catch (e) {
  // T-25-NN: NEVER echo exception message (may contain credentials in network errors).
  console.warn('[<fn>] <action> threw', e instanceof Error ? e.name : 'unknown');
  // Optionally: log a hash of the message for cross-referencing without leaking.
}
```

### Pattern S4: Vendor-gated send via health check (no module-load throw)

**Source:** `[[reference_vendor_gated_send_health_check]]` + `supabase/functions/_shared/resend-domain-health-check.ts` (lines 1-26 contract + lines 40-66 no-op pattern)
**Apply to:** `_shared/email-router.ts` (`AWS_SES_BAA_ACTIVE` flag for PHI branch); `ai-chat-clinical` (`ANTHROPIC_CLINICAL_BAA_ACTIVE` flag for clinical branch — if missing, refuse with stable 503 + audit row, do NOT silent-fallback to consumer key — RESEARCH Anti-Patterns line 637); `baa-expiry-check` + `subprocessor-diff` (no-op + warn when SERVICE_ROLE_KEY missing from Vault rather than crash).

**MUST**: module-load succeeds even if env vars missing. Send-time no-op + logged warning (RESEARCH Pitfall 7).

### Pattern S5: Lazy SDK / admin client singleton (test injection seam)

**Source:** `supabase/functions/affiliate-payout/index.ts` lines 38-79 + `supabase/functions/stripe-webhook/index.ts` lines 31-45
**Apply to:** `email-router.ts` (SES + Resend), `ses-bounce-webhook/index.ts` (SNS validator + admin), `ai-chat-clinical/index.ts` (Anthropic SDK).

```typescript
// affiliate-payout/index.ts lines 41-43, 56-79
const getSupabaseUrl = () => Deno.env.get('SUPABASE_URL') ?? '';
const STRIPE_SECRET_KEY = () => Deno.env.get('STRIPE_SECRET_KEY') ?? '';

let _stripeInstance: any = null;
function getStripe(): any {
  if (_stripeInstance === null) {
    _stripeInstance = new Stripe(STRIPE_SECRET_KEY(), { apiVersion: '...' });
  }
  return _stripeInstance;
}
```

### Pattern S6: pg_cron + Vault bearer + idempotent schedule

**Source:** `supabase/migrations/20270601000017_lifecycle_cron_schedules.sql` lines 1-48 + `[[reference_supabase_migration_filename_regex]]`
**Apply to:** `baa_alert_cron.sql` (nightly + weekly schedules).

```sql
-- lifecycle_cron_schedules.sql lines 30-47
create extension if not exists pg_cron;
select cron.schedule(
  '<jobname>',
  '<cron-expr>',
  $$
    select net.http_post(
      url := 'https://ytnsipxxmzgaebkqmokp.supabase.co/functions/v1/<fn>',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (
          select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key' limit 1
        )
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 60000
    );
  $$
);
```

Per `[[reference_supabase_migration_filename_regex]]`: filename MUST match `^\d{14}_[a-z0-9_]+\.sql$`. Use `date +%Y%m%d%H%M%S` to generate prefix. After `supabase db push`, grep stderr for `^Skipping`.

### Pattern S7: SECURITY DEFINER with `set search_path`

**Source:** `supabase/migrations/20270601000015_admin_stripe_action_audit_rpc.sql` line 23 + `[[reference_supabase_migration_gotchas]]`
**Apply to:** `log_phi_access`, any vendor_baa management RPC, `app.suppress_audit` GUC inside any new SECDEF that writes audit_logs.

```sql
create or replace function public.<fn_name>(...)
returns <type>
language plpgsql
security definer
set search_path = public, extensions, pg_catalog   -- MANDATORY per RESEARCH Pitfall 5
as $$
...
$$;
revoke all on function public.<fn_name>(...) from public;
grant execute on function public.<fn_name>(...) to authenticated;
```

### Pattern S8: GitHub Actions annotation + exit-code CI script

**Source:** `leanshot/scripts/audit-privacy-manifest.mjs` lines 22-31 (header docstring) + existing `.github/workflows/ci.yml` steps lines 181-206
**Apply to:** `lint-stripe-phi.ts`, `audit-sentry-mask.ts`.

```javascript
// audit-privacy-manifest.mjs header pattern
// GitHub Actions annotation format:
//   ::error::<message>       (always non-zero exit)
//   ::warning::<message>     (exit depends on --strict)
//
// On violation:
console.error(`::error file=${file},line=${line}::<message>`);
process.exit(1);
```

---

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `legal/hipaa/access-control.md` (+ 6 sibling policy markdowns) | docs | n/a | No existing repo-side policy templates; greenfield. Source from Drata policy library at Plan 25-09 time, paraphrase into repo SoT per D-06. |
| `middleware.ts` (Vercel Routing Middleware, root of `leanshot/`) | edge middleware | request-response | No `middleware.ts` exists in the project as of `04e5398`. v1.2 SPA routing is handled by `leanshot/vercel.json` `rewrites` (lines 12-23) — config-only, not a JS middleware. Phase 24 D-06 introduces the FIRST middleware.ts (admin TOTP step-up). Plan 25-07 entry condition: confirm Phase 24's `middleware.ts` has shipped before extending `/clinic/*` aal2 step-up. If Phase 24 doesn't ship one, Plan 25-07 owns creation (use Vercel Edge Middleware docs via Context7; pattern reference will be Phase 24 PATTERNS.md once published). |

---

## Cross-Phase Coordination Risks (planner attention)

1. **Phase 24 dependencies (load-bearing on Phase 25):**
   - Phase 24 D-04 `admin_role` enum (`staff/admin/superadmin`) — Plan 25-08 compliance module gates on `superadmin`. Plan-checker MUST verify Phase 24 migration has shipped before Plan 25-08 Wave 1 entry.
   - Phase 24 D-14..D-17 `audit_logs` schema with `target_user_id`, `action` enum, `metadata jsonb` — Plan 25-04 BAA-guard-refusal audit-log row + Plan 25-08 baa-expiry-check both INSERT to this table. Re-check column names match Phase 24's actual migration shape, NOT what 25-RESEARCH speculates.
   - Phase 24 D-06 `middleware.ts` for admin TOTP — Plan 25-07 extends with `/clinic/*` aal2 check. Confirm middleware exists OR Plan 25-07 creates it from scratch.
   - Phase 24 D-01 modular admin manifest (`src/lib/admin/modules.ts`) — Plan 25-08 adds `compliance` entry. If Phase 24 doesn't refactor `AdminLayout` to manifest-driven, fall back to adding `'compliance'` to the existing `AdminNavKey` union in `AdminLayout.tsx:21`.
   - Phase 24 `_shared/posthog-server.ts` — Plan 25-04 may use to emit `anthropic_baa_guard_refused` event server-side. Verify file exists before importing.

2. **Vault key `service_role_key` (Phase 22 BL-7 carry-over):**
   - The `baa_alert_cron.sql` migration uses `vault.decrypted_secrets where name = 'service_role_key'` (Pattern S6). Per `[[project_phase16_unblock_plan]]` + `[[project_phase23_validated]]` MEMORY notes, the vault key is a Wave-0 manual ops step (Dashboard → Project Settings → Vault). Plan 25-08 acceptance: verify via `supabase db query --linked` that the key row exists BEFORE pushing the migration (else cron POSTs go out with `Bearer ` literal + null bearer → 401 from Edge Fn → silent failure).

3. **AWS SES sandbox lift (RESEARCH Pitfall 3):**
   - Plan 25-03 lands `_shared/email-router.ts` PHI branch behind `AWS_SES_BAA_ACTIVE` health-check flag. AWS SES default-sandbox 200/day cap means the first real PHI email send will fail until AWS Support lifts production access (24-72hr). Pattern S4 handles this — no code change needed at cutover.

4. **Existing `ai-chat` proxies Moonshot, NOT Anthropic (RESEARCH correction #2):**
   - Plan 25-04 author MUST resolve the 3-way decision (replace consumer Moonshot with Anthropic / keep both / Anthropic-only) BEFORE writing the plan. CONTEXT D-13 reads as if consumer is already Anthropic — it is NOT (verified at `supabase/functions/ai-chat/index.ts:34-38`).

5. **D-16 PostHog config name is invalid (RESEARCH Pitfall 1 / correction #1):**
   - CONTEXT D-16 specifies `disable_session_recording_on_url` which does NOT exist in posthog-js. Plan 25-06b MUST use the route-change `posthog.stopSessionRecording()` hook per RESEARCH Pattern 4 instead. Document the CONTEXT override in plan header.

---

## Metadata

**Analog search scope:**
- `/Users/karstenhaldan/minisite/supabase/migrations/` (62 migrations enumerated; 8 closely inspected)
- `/Users/karstenhaldan/minisite/supabase/functions/` (35+ Edge Fns; 5 inspected: `ai-chat`, `affiliate-payout`, `stripe-webhook`, `clinic-invite`, `_shared/resend-domain-health-check.ts`)
- `/Users/karstenhaldan/minisite/leanshot/src/components/admin/` (full directory listed; 3 files inspected)
- `/Users/karstenhaldan/minisite/leanshot/src/components/dashboard/settings/` (SettingsPage + PatientActivityModal inspected)
- `/Users/karstenhaldan/minisite/leanshot/src/lib/analytics.ts` (PostHog init pattern)
- `/Users/karstenhaldan/minisite/leanshot/scripts/` (full dir listed; `audit-privacy-manifest.mjs` + `assert-clinic-bundle-budget.sh` inspected)
- `/Users/karstenhaldan/minisite/.github/workflows/ci.yml` (CI step shapes)

**Files scanned:** ~50 across all directories
**Pattern extraction date:** 2026-05-17
