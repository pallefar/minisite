# Phase 19: Affiliate Program + Stripe Connect — Pattern Map

**Mapped:** 2026-05-15
**Files analyzed:** ~33 new/modified (DB + Edge Functions + Frontend + UI primitives + CI)
**Analogs found:** 32 / 33 (1 novel — Stripe `transfers.create` payout cron has no prior LeanShot analog; closest is `affiliate-payout` ≈ clinic-invite cron+Resend skeleton + cron-fire pattern from `20260512000002_anon_cleanup_pg_cron.sql`)

> **Important repo topology note:** Supabase code lives at `/Users/karstenhaldan/minisite/supabase/` (parent of cwd). Frontend lives at `/Users/karstenhaldan/minisite/leanshot/src/`. Both are tracked by the SAME git root at `/Users/karstenhaldan/minisite/`. The `leanshot/supabase/` stub directory is intentional (only `_uat-resend` lives there). **All Phase 19 migrations + Edge Functions land under `/Users/karstenhaldan/minisite/supabase/`. All Phase 19 frontend lands under `/Users/karstenhaldan/minisite/leanshot/src/`.**

> **Migration timestamp scheme:** Existing migrations climb monthly (`20260512` → `20261101`). Phase 19 should start at `20270101000001_…` (Jan 2027 block) to avoid colliding with any deferred Phase 16/17/18 migrations that might fold in at the v1.2 closeout.

---

## File Classification

### A. Database migrations (parent repo: `/Users/karstenhaldan/minisite/supabase/migrations/`)

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `20270101000001_affiliates_schema.sql` | migration | CRUD (DDL) | `20260601000019_stripe_subscriptions.sql` | exact (FK+RLS+partial-index+SECURITY DEFINER) |
| `20270101000002_affiliate_clicks_conversions.sql` | migration | append-only | `20260601000001_audit_logs.sql` + `20260801000005_permissions.sql` | role-match (append-only fact-table) |
| `20270101000003_affiliate_fraud_signals.sql` | migration | CRUD (DDL + matview) | `20260601000003_audit_retention_cron.sql` (matview+cron) | role-match (materialized view + refresh-cron) |
| `20270101000004_subscriptions_provider_column.sql` | migration | CRUD (ALTER) | `20260601000019_stripe_subscriptions.sql:51-73` | exact (column already exists per line 53 — phase-19 plan-checker note required) |
| `20270101000005_tier_effective_view.sql` | migration | view (security_invoker) | `20260801000009_has_permission_fn.sql` (function pattern) | role-match (no view analog yet — security_invoker=true is novel) |
| `20270101000006_payouts_table.sql` | migration | CRUD (DDL) | `20260601000010_pending_account_deletions.sql` | role-match (state-machine table) |
| `20270101000007_affiliate_rls.sql` | migration | RLS DDL | `20261101000007_page_builder_rls.sql` + `20260601000019_stripe_subscriptions.sql:95-148` | exact (idempotent `do $$ if not exists` named policies) |
| `20270101000008_affiliate_landing_template_seeds.sql` | migration | seed (INSERT) | `20260801000010_seed_system_roles_trigger.sql` | role-match (idempotent seed pattern) |
| `20270101000009_affiliate_payout_cron.sql` | migration | pg_cron | `20260512000002_anon_cleanup_pg_cron.sql` + `20260601000013_finalize_account_deletions_cron.sql` | exact (cron.schedule wrapper) |
| `20270101000010_account_delete_affiliate_cascade.sql` | migration | function (SECURITY DEFINER) | `20260601000012_finalize_account_deletion_fn.sql` + `20260601000017_audit_trigger_suppress_guc.sql` | exact (`app.suppress_audit` GUC + cascade) |

### B. Edge Functions (parent repo: `/Users/karstenhaldan/minisite/supabase/functions/`)

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `affiliate-attribute/index.ts` | edge-fn | cookie-set (request-response) | `share/index.ts` + `share/cookie.ts` | exact (public, Set-Cookie, jsr:@std/http/cookie) |
| `affiliate-attribute/index.test.ts` | test | — | `share/index.test.ts` | exact |
| `stripe-connect-onboard/index.ts` | edge-fn | request-response (JWT-gated) | `stripe-checkout/index.ts` | exact (JWT auth + Stripe SDK init + `account_link` shape parallel to `checkout.sessions.create`) |
| `stripe-connect-onboard/index.test.ts` | test | — | `stripe-checkout/index.test.ts` | exact |
| `stripe-webhook/events/invoice-paid.ts` (MODIFY) | event handler | event-driven | `stripe-webhook/events/invoice-paid.ts` (extending in place) | self (additive — affiliate-conversion code path on `invoice.paid`) |
| `stripe-webhook/events/affiliate-conversion.test.ts` (NEW) | test | event-driven | `stripe-webhook/events/invoice-paid.test.ts` | exact |
| `affiliate-payout/index.ts` | edge-fn | batch (cron-invoked) | `clinic-invite/index.ts` (HTTPS + Stripe + idempotent) + (no transfers.create analog) | partial — **NOVEL** for `transfers.create` |
| `affiliate-payout/index.test.ts` | test | — | `clinic-invite/index.test.ts` + `stripe-webhook/events/*.test.ts` | role-match |
| `account-delete/index.ts` (NEW Edge Fn) | edge-fn | request-response (cascade) | `20260601000012_finalize_account_deletion_fn.sql` (logic) + `clinic-invite/index.ts` (dispatcher shape) | role-match (existing cascade is a SQL function; P19 wraps + extends) |
| `account-delete/index.test.ts` | test | — | `clinic-invite/index.test.ts` | exact |
| `affiliate-attribute/cookie.ts` | helper | cookie-format | `share/cookie.ts` | exact |
| `affiliate-attribute/cors.ts` | helper | cors | `share/cors.ts` (echo Origin allowlist) | exact |

### C. Frontend routes + components (`/Users/karstenhaldan/minisite/leanshot/src/`)

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/pages/AffiliateApplyPage.tsx` (NEW — or under `components/affiliate/`) | route | request-response | `src/components/auth/SignUpForm.tsx` | exact (5-field public form + Resend confirm) |
| `src/components/affiliate/AffiliateApplyForm.tsx` | form | request-response | `src/components/auth/SignUpForm.tsx` | exact |
| `src/components/admin/AdminAffiliatesScaffold.tsx` | table | CRUD (read-only) | `src/components/admin/pages/PageListView.tsx` | exact (admin-only list + filter pills, is_staff RLS gate) |
| `src/components/partner/PartnerLayout.tsx` | layout shell | navigation | `src/components/clinic/settings/MembersTab.tsx` (sub-nav pattern) + `App.tsx` route guard | role-match |
| `src/components/partner/PartnerDashboard.tsx` | page | request-response (SWR poll) | `src/components/dashboard/tabs/HomeTab.tsx` + `src/components/clinic/roster/RosterTable.tsx` (refresh+KPI pattern) | exact (12-col bento + KPI grid) |
| `src/components/partner/PartnerKpiCard.tsx` | UI card | display | `src/components/dashboard/cards/StreaksCard.tsx` + `src/components/ui/Card.tsx` (variant=default, padding=md) | exact (Card + label + value + delta) |
| `src/components/partner/PartnerTrendChart.tsx` | chart wrapper | display | `src/components/dashboard/charts/BaseChart.tsx` (re-export + chart.js config) | exact |
| `src/components/partner/PartnerActivityFeed.tsx` | list | request-response | `src/components/clinic/settings/AuditTab.tsx` (paged activity rows) | role-match |
| `src/components/partner/PartnerLinksPage.tsx` | page | CRUD | `src/components/admin/pages/PageEditorView.tsx` (form + live preview) | role-match |
| `src/components/partner/PartnerTemplatePicker.tsx` | picker UI | display | `src/components/admin/pages/TemplatePicker.tsx` | exact (3-card select + Card variant=selected/clickable) |
| `src/components/partner/PartnerCustomizeForm.tsx` | form | CRUD | `src/components/clinic/settings/WorkspaceTab.tsx` | role-match (slot-binding inputs) |
| `src/components/partner/PartnerPayoutsPage.tsx` | page+table | request-response | `src/components/clinic/settings/AuditTab.tsx` (history table) + `src/components/billing/ManageSubscriptionLink.tsx` (CTA) | role-match |
| `src/components/partner/PartnerAssetsPage.tsx` | grid | request-response (Storage signed-URL) | `src/components/dashboard/share/ShareCardModal.tsx` (download CTA) | role-match |
| `src/components/partner/StripeConnectOnboardingCard.tsx` | card (state-machine) | display | `src/components/billing/PastDueBanner.tsx` (status-driven banner) | exact (4-state + CTA pattern) |
| `src/components/landing/LandingTemplateCoach.tsx` | block-tree renderer | display | `src/components/admin/pages/blocks/HeroBlock.tsx` + `src/lib/page-builder/templates.ts` | exact |
| `src/components/landing/LandingTemplateStory.tsx` | block-tree renderer | display | `src/components/admin/pages/blocks/TestimonialBlock.tsx` + `LandingTemplateCoach.tsx` | exact |
| `src/components/landing/LandingTemplateMethod.tsx` | block-tree renderer | display | `src/components/admin/pages/blocks/FeatureGridBlock.tsx` + `LandingTemplateCoach.tsx` | exact |
| `src/components/ui/InitialsAvatar.tsx` (NEW primitive) | UI primitive | display | `src/components/ui/Badge.tsx` (sized variants) + `src/illustrations/StreakBadge.tsx` (size tokens) | role-match (no avatar primitive exists yet) |

### D. Library + lib helpers

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/lib/affiliate/attribution.ts` (NEW) | client lib | cookie parse | `src/lib/page-builder/page-api.ts` | role-match |
| `src/lib/affiliate/fraud-signals.ts` (NEW) | client lib (read-side) | display helper | `src/lib/billing.ts` (registry pattern) | role-match |
| `src/lib/billing.ts` (MODIFY) | client lib | tier resolution | self (extend to consume `tier_effective` view) | self |
| `src/lib/supabase.ts` (UNTOUCHED) | client | — | self | self |

### E. CI / config

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `leanshot/vercel.json` (MODIFY) | rewrite config | — | self (already rewrites `/sitemap.xml` + page-render) | self |
| `supabase/config.toml` (MODIFY) | edge-fn config | — | self (page-render/lead-capture `verify_jwt=false` blocks) | self |
| `leanshot/scripts/assert-clinic-bundle-budget.sh` (UNTOUCHED but Phase 12 ceilings apply) | CI gate | — | self (already enforces +per-route budgets) | self |

---

## Pattern Assignments

### A. Database migrations

#### A.1 `20270101000001_affiliates_schema.sql` (migration, CRUD DDL)

**Analog:** `/Users/karstenhaldan/minisite/supabase/migrations/20260601000019_stripe_subscriptions.sql`

**Why:** Same shape — primary user-scoped table + FK to auth.users with cascade, partial indexes, RLS-enable + named policies, SECURITY DEFINER helper function with `set search_path = public, extensions`.

**Imports/headers pattern** (lines 1-26):
```sql
-- Phase 19 Plan XX — Affiliate program schema.
--
-- Landmine annotations (reference_supabase_migration_gotchas):
--   Pitfall 1: Partial-index predicates MUST be IMMUTABLE.
--     - `WHERE user_id IS NOT NULL` — column IS NULL is IMMUTABLE-safe.
--     - `WHERE status = 'pending'` — text equality is IMMUTABLE-safe.
--   Pitfall 2: SECURITY DEFINER functions MUST `SET search_path = public, extensions`
--     so pgcrypto/digest() resolve (slug-hashing for referral_code).
```

**Table DDL pattern** (lines 30-43, mirror):
```sql
create table public.affiliates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete set null,
  email text not null,
  display_name text not null,
  audience_type text not null check (audience_type in ('Instagram','TikTok','YouTube','Newsletter','Coaching','Other')),
  audience_size integer not null check (audience_size >= 0),
  why_us text check (length(why_us) <= 500),
  status text not null default 'pending' check (status in ('pending','approved','rejected','suspended')),
  referral_code text unique,
  commission_rate_cents integer not null default 1000,
  tax_threshold_cents integer not null default 50000,  -- D-31 amendment
  stripe_connect_account_id text unique,
  ip_signup inet,
  fingerprint_signup text,
  applied_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Partial indexes — IMMUTABLE-safe.
create index idx_affiliates_status on public.affiliates(status) where status in ('pending','flagged');
create index idx_affiliates_referral_code on public.affiliates(referral_code) where referral_code is not null;
```

**Adaptations:** Note `tax_threshold_cents` column comes from CONTEXT-ADDENDUM D-31 (not literal). `user_id` is `ON DELETE SET NULL` (CONTEXT D-33 step 3 — affiliates row retains for ledger integrity).

**Project rules that apply:**
- `reference_supabase_migration_gotchas.md` — IMMUTABLE partial-index predicates ✓
- `reference_supabase_migration_gotchas.md` — Pitfall 4: cascade-DELETE crossing audit_logs needs `app.suppress_audit` (see A.10)
- `feedback_planner_iter1_anti_patterns.md` — Postgres DDL transaction safety: no enum-add-in-same-tx (use text-with-check constraint as shown)

---

#### A.4 + A.5 `subscriptions_provider_column.sql` + `tier_effective_view.sql` (D-01..D-04)

**Analog:** `/Users/karstenhaldan/minisite/supabase/migrations/20260601000019_stripe_subscriptions.sql` lines 51-73 (subscriptions table) + lines 165-222 (SECURITY DEFINER function header).

**Critical pre-existing observation:** Line 53 of the existing `subscriptions` table already has:
```sql
provider text not null default 'stripe' check (provider in ('stripe','revenuecat')),
```
**So D-01's "ADD COLUMN IF NOT EXISTS provider" migration is a no-op when run on the current schema.** Phase 19 plan-checker MUST verify with `SHOW server_version;` + `\d+ public.subscriptions` that this column already exists, OR ship the migration as truly idempotent:

```sql
alter table public.subscriptions
  add column if not exists provider text not null default 'stripe'
  check (provider in ('stripe','revenuecat'));
```

**View DDL pattern** (mirror `count_active_patients` SECURITY DEFINER shape from line 166):
```sql
-- D-03: security_invoker=true so RLS is honored at query time.
create or replace view public.tier_effective
  with (security_invoker = true)
as
select
  user_id,
  max(case when current_period_end > now() then 'paid' else 'free' end) as tier,
  max(current_period_end) as effective_until,
  array_agg(distinct provider) as providers
from public.subscriptions
where user_id is not null
group by user_id;
```

**Adaptations:** No SECURITY DEFINER function (D-03 explicit). Test SC#4 (D-02): two `provider='stripe'` rows with overlapping windows return ONE row with MAX(current_period_end). Test forward-compat: add a `provider='revenuecat'` row, assert the view returns MAX of all 3.

**Cross-phase contract (D-04):** P16-06 migration becomes a no-op for column add; the view is unchanged. Plan must mention "P16-06 idempotency check" task.

---

#### A.7 `affiliate_rls.sql` (RLS DDL)

**Analog:** `/Users/karstenhaldan/minisite/supabase/migrations/20261101000007_page_builder_rls.sql` lines 22-58 (idempotent `do $$ if not exists`) + `/Users/karstenhaldan/minisite/supabase/migrations/20260601000019_stripe_subscriptions.sql` lines 105-148 (owner-scoped policies).

**Policy DDL pattern** (lines 32-46 of page_builder_rls):
```sql
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'affiliates'
      and policyname = 'pol_affiliates_self_select'
  ) then
    create policy pol_affiliates_self_select on public.affiliates
      for select to authenticated
      using (auth.uid() = user_id);
  end if;
end $$;

-- Admin (is_staff=true) full CRUD — mirrors page_builder pattern.
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'affiliates'
      and policyname = 'pol_affiliates_staff_all'
  ) then
    create policy pol_affiliates_staff_all on public.affiliates
      for all to authenticated
      using (public.is_staff())
      with check (public.is_staff());
  end if;
end $$;
```

**Live cross-tenant impersonation test (project rule from MEMORY):** Every RLS surface MUST get a live cross-tenant test, not just policy SQL. Test pattern from `reference_rls_fixture_gotrueclient_flake.md` — use **service-role-minted JWT via headers.Authorization** (NOT signInWithPassword). Test must be file-scoped slug-prefixed per `feedback_rls_per_file_slug_prefix.md`.

**Project rules that apply:**
- `reference_supabase_project.md` — every new RLS surface gets cross-tenant impersonation proof
- `reference_rls_fixture_gotrueclient_flake.md` — service-role-minted JWT pattern
- `feedback_rls_per_file_slug_prefix.md` — file-scoped slug prefix in cleanup

---

#### A.10 `account_delete_affiliate_cascade.sql` (D-33, D-34)

**Analog:** `/Users/karstenhaldan/minisite/supabase/migrations/20260601000012_finalize_account_deletion_fn.sql` (full file, esp. lines 39-109) + `20260601000017_audit_trigger_suppress_guc.sql` (audit-trigger GUC bypass).

**Cascade function pattern** (lines 39-110 of finalize_account_deletion):
```sql
create or replace function public.finalize_affiliate_cascade(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public, auth, extensions, pg_catalog
as $$
declare
  v_row public.affiliates;
  v_open_payouts integer;
begin
  -- D-33 step 1: PRE-FLIGHT — open payouts block cascade.
  select count(*) into v_open_payouts
    from public.payouts
   where user_id = p_user_id
     and status in ('pending','processing');
  if v_open_payouts > 0 then
    raise exception 'open_payouts' using errcode = 'P0010';  -- 409 from edge fn
  end if;

  -- Suppress audit-trigger fires for the cascade window (Pitfall 4).
  perform set_config('app.suppress_audit', 'true', true);

  -- D-33 step 2: anonymize affiliate row.
  update public.affiliates
     set email = encode(digest(email, 'sha256'), 'hex'),
         display_name = 'deleted_user_' || id::text,
         photo_path = null
   where user_id = p_user_id;

  -- D-33 step 3: affiliate_clicks + conversions = ON DELETE SET NULL via FK.
  -- D-33 step 4: payouts retained (no DELETE on payouts).
  -- (Stripe/Resend/Storage cleanup happens in the Edge Function wrapper, B-9.)

  -- Audit skeleton (cascade-survives via user_id_hash).
  insert into public.audit_logs
    (user_id, user_id_hash, table_name, row_id, action, before_hash, after_hash)
  values (
    p_user_id,
    encode(digest(p_user_id::text, 'sha256'), 'hex'),
    'public.affiliates',
    p_user_id::text,
    'affiliate_deleted_anonymized',
    null, null
  );
end;
$$;

revoke all on function public.finalize_affiliate_cascade(uuid) from public;
grant execute on function public.finalize_affiliate_cascade(uuid) to service_role;
```

**Adaptations:** P19 does NOT call `delete from auth.users` — that's P22 DEL-01's job. P19 owns the affiliate-specific anonymize + audit-skeleton. Steps 5-10 of D-33 (Stripe customer delete, Stripe Connect delete, PaymentIntent void, Resend remove, Storage delete) live in the **Edge Function** wrapper (B-9), NOT the SQL function — the Edge Function calls Stripe/Resend HTTPS APIs first, then calls this SQL function for the DB-level anonymize.

**Project rules that apply:**
- `reference_supabase_migration_gotchas.md` — `app.suppress_audit` GUC; `set_config('storage.allow_delete_query', 'true', true)` for Storage delete (in the SQL function if Storage delete moves there)
- `reference_supabase_migration_gotchas.md` — SECURITY DEFINER + `set search_path = public, extensions, pg_catalog` for digest() resolution
- CONTEXT D-34: every cascade step audit-logged via `audit_logs` skeleton row (mirror line 67-77)

---

### B. Edge Functions

#### B.1 `affiliate-attribute/index.ts` (cookie-set, public, verify_jwt=false)

**Analog:** `/Users/karstenhaldan/minisite/supabase/functions/share/index.ts` (full request flow) + `share/cookie.ts` (Set-Cookie pattern).

**Why:** Same trust posture — public no-JWT Edge Function that responds with `Set-Cookie`. Same gateway-CSP quirk (`reference_supabase_edge_function_deploy.md`).

**Module-level setup pattern** (share/index.ts lines 35-51):
```typescript
import { createClient } from 'npm:@supabase/supabase-js@2';
import { BASE_RESPONSE_HEADERS, buildCorsHeaders } from './cors.ts';
import { setAffiliateCookie } from './cookie.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});
```

**Cookie-set pattern** (share/cookie.ts lines 39-49):
```typescript
import { getCookies, setCookie } from 'jsr:@std/http/cookie';
const COOKIE_NAME = '_aff';  // D-21

export function setAffiliateCookie(headers: Headers, code: string): void {
  setCookie(headers, {
    name: COOKIE_NAME,
    value: code,
    httpOnly: true,
    secure: true,
    sameSite: 'Lax',       // D-21 (CHANGE FROM share's 'Strict' — Lax lets affiliate links from other origins set the cookie)
    domain: '.leanshot.app', // D-21 — distinguishing detail from share/cookie.ts
    path: '/',
    maxAge: 30 * 24 * 60 * 60,  // 30 days
  });
}
```

**Critical config:** Add `[functions.affiliate-attribute]` block to `supabase/config.toml` with `verify_jwt = false` (mirror existing `page-render` block at lines documented above in config.toml).

**Adaptations from share:**
- `Domain=.leanshot.app` instead of share's path-scoped (D-21 + D-37 #1 Vercel-rewrite verification)
- `SameSite=Lax` not Strict (allows referral-link clicks from social media)
- Dual-cookie write: HttpOnly `_aff` + JS-mirror `_aff_pub` for client-side attribution UI (CONTEXT references "dual cookie" — confirm with planner)
- No redeem/snapshot dispatcher — single endpoint that sets cookie + 302s to `/signup?aff=<code>`
- D-37 #1 Wave-0 smoke task: deploy stub → `curl https://leanshot.app/r/test` → assert `Set-Cookie: _aff=test; Domain=.leanshot.app`

**Project rules that apply:**
- `reference_supabase_edge_function_deploy.md` — esm.sh URLs; gateway overrides response Content-Type; UAT-probe pattern for secrets
- D-37 #1 Wave-0 verification (parent CONTEXT-ADDENDUM)
- CSP: response goes to *.supabase.co; cookie domain `.leanshot.app` requires Vercel rewrite (not subdomain CNAME, per D-37 #1 fallback decision)

---

#### B.2 `stripe-connect-onboard/index.ts` (JWT-gated, Stripe `account_link`)

**Analog:** `/Users/karstenhaldan/minisite/supabase/functions/stripe-checkout/index.ts` (full file — JWT auth + Stripe SDK init + ensure-customer pattern).

**Stripe SDK init pattern** (stripe-checkout lines 49, 86-94):
```typescript
import Stripe from 'https://esm.sh/stripe@19?target=denonext';

function getStripe(): any {
  if (_stripeInstance === null) {
    _stripeInstance = new Stripe(getStripeSecretKey(), {
      apiVersion: '2026-04-22.dahlia' as Parameters<typeof Stripe>[1]['apiVersion'],
      httpClient: Stripe.createFetchHttpClient(),
    });
  }
  return _stripeInstance;
}
```

**JWT-resolve + body pattern** (stripe-checkout lines 290-298):
```typescript
const jwt = jwtFromReq(req);
if (!jwt) return jsonError(401, 'unauthenticated');
const { data: userData, error: userErr } = await adminInstance.auth.getUser(jwt);
if (userErr || !userData?.user) return jsonError(401, 'unauthenticated');
const user = userData.user;
```

**Connect-onboard call (NEW — adapt from `ensureWebCustomer` shape at lines 182-226):**
```typescript
// 1. Ensure stripe_connect_accounts row for affiliate.
// 2. If account.id absent: stripe.accounts.create({ type:'express', country:'US',
//    capabilities:{ transfers:{requested:true} } })
// 3. stripe.accountLinks.create({
//      account: accountId,
//      refresh_url: `${origin}/partner/payouts?refresh=1`,
//      return_url: `${origin}/partner/payouts?from=connect`,
//      type: 'account_onboarding',
//    })
// 4. Return { url: accountLink.url }
```

**Adaptations:**
- D-37 #2 Wave-0 verification: confirm `transfers` capability was enabled in Phase 12 stripe-done; if not, one-line task to enable via `stripe.accounts.update({ requested_capabilities: ['transfers'] })`
- D-31 (amended): when `affiliates.tax_threshold_cents` reached, `stripe.accounts.update({ tos_acceptance: {...} })` triggers hosted W-9/W-8BEN — NOT a Stripe default
- Same 3 pitfalls inherit: `payment_method_collection:'always'` doesn't apply (no checkout); JWT auth same as checkout; no error echo (Pitfall 8)

**Project rules that apply:**
- `reference_supabase_edge_function_deploy.md` — esm.sh URLs, `httpClient: Stripe.createFetchHttpClient()` (Deno-required)
- `reference_phase7_research_findings.md` (transitively): no envelope encryption (pgsodium deprecated on free tier) — `stripe_connect_account_id` stored plaintext
- CONTEXT D-37 #2: stripe-done capability check is a 30-min Wave-0 spike

---

#### B.5 `stripe-webhook/events/invoice-paid.ts` MODIFY (extend on `invoice.paid` for affiliate-conversion)

**Analog:** Existing file at `/Users/karstenhaldan/minisite/supabase/functions/stripe-webhook/events/invoice-paid.ts` (40 lines total).

**Existing handler pattern** (lines 12-39):
```typescript
export async function handle(event: Stripe.Event, admin: SupabaseClient): Promise<void> {
  const invoice = event.data.object as Stripe.Invoice;
  const subId = invoice.subscription as string | null;
  if (!subId) return;

  const periodEnd = invoice.period_end
    ? new Date(invoice.period_end * 1000).toISOString()
    : null;

  const { error } = await admin
    .from('subscriptions')
    .update({ ux_tier: 'paid', status: 'active', current_period_end: periodEnd })
    .eq('id', subId);
  if (error) { /* error guard */ throw new Error('invoice-paid-update-failed'); }
}
```

**Extension pattern (NEW, append after line 38, per D-36):**
```typescript
  // D-36: ONLY initial conversion writes a commission row. Renewals skip.
  if (invoice.billing_reason !== 'subscription_create') {
    return;
  }

  // Look up affiliate attribution via subscription metadata or cookie-on-session.
  // Pattern: read `subscription_data.metadata.aff_code` set at /session create-time
  // (extension of stripe-checkout B-3 — adds aff param to session metadata).
  const stripeSub = await admin
    .from('subscriptions')
    .select('metadata')
    .eq('id', subId)
    .maybeSingle();
  const affCode = (stripeSub.data?.metadata as Record<string,unknown>)?.aff_code as string | undefined;
  if (!affCode) return;

  // Look up affiliate by referral_code.
  const { data: affiliate } = await admin
    .from('affiliates')
    .select('id, commission_rate_cents, status')
    .eq('referral_code', affCode)
    .eq('status', 'approved')
    .maybeSingle();
  if (!affiliate) return;

  // Idempotent upsert into affiliate_conversions on (invoice_id) PRIMARY KEY.
  const { error: convErr } = await admin
    .from('affiliate_conversions')
    .insert({
      invoice_id: invoice.id,  // PRIMARY KEY → ON CONFLICT DO NOTHING
      affiliate_id: affiliate.id,
      commission_cents: affiliate.commission_rate_cents,
      converted_user_id: invoice.customer as string,
      status: 'pending_review',  // D-24/D-25 fraud signals run async
      created_at: new Date().toISOString(),
    });
  if (convErr && convErr.code !== '23505') {
    console.error('[invoice-paid/affiliate] insert error', convErr.message);
    throw new Error('affiliate-conversion-insert-failed');
  }
```

**Adaptations:**
- **The aff-code propagation requires modifying `stripe-checkout/index.ts handleSession`** to read `?aff=<code>` query param OR request body field and write to `subscription_data.metadata.aff_code` (extends line 372-374 of stripe-checkout)
- D-36 filter is the load-bearing line (`billing_reason !== 'subscription_create'`)
- Idempotency: `affiliate_conversions.invoice_id PRIMARY KEY` → INSERT ON CONFLICT DO NOTHING — mirrors `subscription_events.event_id` Pattern B from `stripe-webhook/index.ts` lines 175-198
- Async fraud-signal pass (D-24..D-28) is a follow-up trigger or cron, NOT inline in this handler (keeps the webhook fast + idempotent)

**Project rules that apply:**
- CONTEXT D-36: filter `billing_reason='subscription_create'`
- `feedback_planner_iter1_anti_patterns.md`: idempotent upsert pattern (PRIMARY KEY conflict → DO NOTHING returns 200)
- `feedback_parallel_executor_git_isolation.md`: if Phase 19 splits affiliate-conversion + invoice-paid into two waves, both touch THIS file — must commit with pathspec to avoid sibling-plan sweep
- D-37 #2: verify `transfers` capability before any plan that calls `transfers.create` later

---

#### B.7 `affiliate-payout/index.ts` (NOVEL — cron-invoked batch payout)

**No direct analog.** Closest patterns:
- `clinic-invite/index.ts` for HTTPS dispatcher + Resend integration (lines 1-80)
- `stripe-checkout/index.ts` for Stripe SDK init + ensureCustomer (lines 49-145)
- `20260601000013_finalize_account_deletions_cron.sql` for pg_cron job declaration
- **NO LeanShot analog for `stripe.transfers.create`** — research finding (not `payouts.create`)

**Recommended pattern:**
1. pg_cron schedule (1st of month, 00:00 UTC per D-29): see analog in `20260512000002_anon_cleanup_pg_cron.sql`:
```sql
select cron.schedule(
  'affiliate-monthly-payout',
  '0 0 1 * *',
  $$
    select net.http_post(
      url := 'https://<ref>.functions.supabase.co/affiliate-payout/run',
      headers := jsonb_build_object('Authorization', 'Bearer ' || current_setting('supabase.service_role_key'))
    );
  $$
);
```

2. Edge Function (Deno) body:
```typescript
// For each affiliate where SUM(confirmed commissions) - SUM(paid payouts) >= $25:
//   1. stripe.transfers.create({ amount, currency:'usd',
//        destination: connect_account_id,
//        metadata: { affiliate_id, period: 'YYYY-MM' } })
//   2. INSERT INTO payouts { affiliate_id, amount_cents, stripe_transfer_id, status:'processing' }
//   3. On Stripe error → status='failed', schedule retry (D-32: 3× at 24h intervals)
```

3. Failure retry: D-32 mandates 3 attempts at 24h intervals. Pattern from `pending_account_deletions.finalize_attempts` column (mirror `20260601000010_pending_account_deletions.sql`).

4. Chargeback hold (D-30: 60 days): the SUM(confirmed commissions) MUST filter `affiliate_conversions.created_at < now() - interval '60 days'` — paid out in month M+2.

5. W-9 hold (D-31): if `affiliate.tax_threshold_cents` not yet collected AND `accrued >= tax_threshold_cents`, do NOT call `transfers.create` — instead trigger `stripe.accounts.update` to surface hosted W-9 form, set affiliate `requires_tax_info` flag.

**Project rules that apply:**
- D-29..D-32: monthly cron, 60-day chargeback hold, $500 W-9 threshold, 3× 24h retry
- `reference_supabase_edge_function_deploy.md`: esm.sh for Stripe; UAT-probe for `STRIPE_SECRET_KEY` Function Secret
- D-37 #2: `transfers` capability must be enabled BEFORE this function deploys
- Flag as **NOVEL** in planning — plan-checker should request explicit pseudocode review

---

#### B.9 `account-delete/index.ts` (Edge Function wrapping the cascade)

**Analog:** `/Users/karstenhaldan/minisite/supabase/functions/clinic-invite/index.ts` (dispatcher shape) + `20260601000012_finalize_account_deletion_fn.sql` (cascade ordering).

**Why:** The cascade ordering (D-33 ten steps) requires server-side Stripe/Resend HTTPS calls **before** the DB anonymize — those don't fit a pure SQL function. The Edge Function orchestrates: pre-flight (steps 1-2) → Stripe + Resend + Storage cleanup (steps 5-9 outside DB) → SQL function call (steps 2-4 via `finalize_affiliate_cascade` RPC) → `auth.admin.deleteUser` (step 10).

**Dispatcher pattern** (clinic-invite/index.ts lines 1-75): same JWT-resolve + service-role admin + per-action switch.

**Adaptations from clinic-invite:**
- Single endpoint `POST /functions/v1/account-delete` (not multi-action)
- JWT auth: validate the caller is either the user themselves OR a P22 admin (P22 DEL-01 surface — cross-phase)
- Step ordering (D-33) MUST be in this exact order — wrap each step in try/catch + audit log via `audit_logs` skeleton row
- On step 1 conflict (open payouts) → return `409 { error: 'open_payouts', eta: <next_payout_date> }` (D-33 step 1)

**Test pattern (D-35):** Playwright e2e — create affiliate + conversion + payout → call deletion → assert payouts retained, affiliate row anonymized, Stripe customer gone, Storage empty, auth.users row gone. Mirror Phase 7 e2e at `leanshot/e2e/` (search `account-delete`).

**Project rules that apply:**
- D-33: 10-step ordering is normative — plan-checker should match each step to a numbered task
- `reference_supabase_migration_gotchas.md`: `set_config('storage.allow_delete_query', 'true', true)` for Storage `photos/{user_id}/*` + `affiliate-photos/{user_id}/*` deletes
- `reference_supabase_edge_function_deploy.md`: Function Secrets for `STRIPE_SECRET_KEY`, `RESEND_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`

---

### C. Frontend routes + components

#### C.1 `AffiliateApplyPage.tsx` + `AffiliateApplyForm.tsx`

**Analog:** `/Users/karstenhaldan/minisite/leanshot/src/components/auth/SignUpForm.tsx` (lines 1-80).

**Imports + state pattern** (SignUpForm.tsx lines 15-31):
```tsx
import { useEffect, useState } from 'react';
import { Mail, KeyRound } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { useToast } from '@/hooks/useToast';

export function AffiliateApplyForm() {
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [audienceSize, setAudienceSize] = useState<number | ''>('');
  const [audienceType, setAudienceType] = useState<string>('Instagram');
  const [whyUs, setWhyUs] = useState('');
  const [errors, setErrors] = useState<Record<string,string|undefined>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const toast = useToast();
  // ...
```

**Validation + submit pattern** (SignUpForm.tsx lines 45-80):
- Per-field validation displayed below input in `text-[var(--color-danger)]`
- `Button` with `aria-busy={submitting}` + loading state copy (UI-SPEC "Sending...")
- On success: replace card with success-state copy "Application received" + toast

**Adaptations:**
- Public route (no JWT — but Supabase anon client OK for the INSERT call which RLS allows anon-INSERT into a dedicated `affiliate_applications` shadow table, OR call a dedicated `affiliate-apply` Edge Function — planner decides)
- 5 fields per UI-SPEC: email, name, audience size (number), audience type (native `<select>` per UI-SPEC line 163), why us (textarea max 500)
- Native `<select>` styled to match `<Input>` — UI-SPEC explicitly forbids Combobox lib
- Confirmation email via Resend transactional template (D-06) — same pattern as `clinic-invite/template-clinic-invite.ts`

**Project rules that apply:**
- UI-SPEC C.1 copywriting contract (10+ string locks)
- `reference_resend_phase9_wiring.md`: `RESEND_API_KEY` + `RESEND_FROM` Function Secrets; `noreply@app.leanshot.app` default
- CSS tokens: NO hardcoded hex; `var(--color-*)` only per Phase 13 v2

---

#### C.4 `PartnerDashboard.tsx` (KPI bento + chart + activity feed)

**Analog:** `/Users/karstenhaldan/minisite/leanshot/src/components/dashboard/tabs/HomeTab.tsx` (12-col bento) + `src/components/dashboard/cards/StreaksCard.tsx` (Card composition) + `src/components/clinic/roster/RosterTable.tsx` (refresh + SWR pattern).

**Card primitive usage** (StreaksCard.tsx lines 22-50):
```tsx
<Card span={3} padding="md">
  <CardHeader title="Clicks · 30d" icon={<MousePointer className="size-4" />} />
  <p className="text-3xl font-semibold text-[var(--color-primary)] numerals-tabular"
     aria-live="polite">
    {useCountUp(clicks30d)}
  </p>
  <p className="text-xs text-[var(--color-text-secondary)]">
    {delta > 0 ? `+${delta}% vs prev 30d` : `${delta}% vs prev 30d`}
  </p>
</Card>
```

**Refresh + SWR pattern** (RosterTable.tsx lines 26-50): poll every 10 min via setInterval inside useEffect; manual refresh resets timer + refetches; "Updated N min ago" badge bound to `lastFetchedAt` state.

**Adaptations:**
- 4 KPI cards in `span={3}` × 4 (UI-SPEC line 179-181)
- BaseChart already-registered — see `src/components/dashboard/charts/BaseChart.tsx`
- Stripe Connect onboarding card conditional render at top (UI-SPEC line 189) — see C.13

**Project rules that apply:**
- UI-SPEC C.3 copywriting contract
- Phase 12 bundle ceilings: `/partner/dashboard` is its own lazy chunk ≤12 kB gz; `App.tsx` lazy import per UI-SPEC line 490
- `useCountUp` honors `useReducedMotion` (existing hook contract per leanshot CLAUDE.md)

---

#### C.13 `StripeConnectOnboardingCard.tsx` (4-state machine)

**Analog:** `/Users/karstenhaldan/minisite/leanshot/src/components/billing/PastDueBanner.tsx` (status-driven banner).

**Pattern** (skeleton):
```tsx
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';

type ConnectState = 'pending' | 'needs_info' | 'active' | 'restricted';

export function StripeConnectOnboardingCard({ state, onStart }: Props) {
  if (state === 'active') return null;  // UI-SPEC: hidden when active

  const config = {
    pending:    { tone: 'tonal',    heading: 'Complete tax onboarding...', cta: 'Start onboarding →' },
    needs_info: { tone: 'tonal',    heading: 'Stripe needs more info',     cta: 'Continue onboarding →' },
    restricted: { tone: 'default',  heading: 'Your payout account is on hold', cta: 'Contact support' },
  }[state];

  return (
    <Card variant={config.tone} padding="lg" span={12}>
      {/* heading + body + CTA per UI-SPEC state-machine table */}
    </Card>
  );
}
```

**CTA opens onboarding link in `target="_blank" rel="noopener noreferrer"`** (UI-SPEC, CONTEXT D-08).

**Project rules that apply:**
- UI-SPEC "Stripe Connect Onboarding Card — State Machine" table
- Account-status polled via `partner-account-status` Edge Function (separate from B.2) — planner decides whether to fold into B.2 as a `?action=status` branch

---

#### C.18 `InitialsAvatar.tsx` (NEW primitive — only new UI primitive)

**Analog (closest):** `/Users/karstenhaldan/minisite/leanshot/src/components/ui/Badge.tsx` (sized variants pattern) + `/Users/karstenhaldan/minisite/leanshot/src/illustrations/StreakBadge.tsx` (size + tier mapping).

**Why:** No existing avatar primitive in `src/components/ui/`. `AvatarMenu.tsx` in layout uses raw lucide icon. Closest size-token convention is `Badge` (sm/md/lg) + `StreakBadge` (size-12 etc.).

**Pattern per UI-SPEC (full API at UI-SPEC lines 266-296):**
```tsx
// src/components/ui/InitialsAvatar.tsx
export interface InitialsAvatarProps {
  name: string;
  size?: 'sm' | 'md' | 'lg';      // 40px / 80px / 200px
  rounded?: 'card' | 'full';
  className?: string;
}

const SIZE_CLASSES = {
  sm: 'w-10 h-10 text-lg',
  md: 'w-20 h-20 text-3xl',
  lg: 'w-[120px] h-[120px] md:w-[200px] md:h-[200px] text-5xl md:text-display',
};

function hashStringToHue(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h % 360;
}

export function InitialsAvatar({ name, size = 'md', rounded = 'card', className }: InitialsAvatarProps) {
  const hue = hashStringToHue(name);
  const initial = name.trim().charAt(0).toUpperCase() || '?';
  return (
    <div role="img" aria-label={`Avatar for ${name}`}
      className={cn(SIZE_CLASSES[size],
        rounded === 'full' ? 'rounded-full' : 'rounded-card',
        'flex items-center justify-center text-white font-semibold',
        'font-[var(--font-display)]', className)}
      style={{
        background: `linear-gradient(135deg, hsl(${hue}, 65%, 55%) 0%, hsl(${(hue+30)%360}, 65%, 45%) 100%)`,
      }}>
      {initial}
    </div>
  );
}
```

**Unit test (UI-SPEC line 295):** assert `hashStringToHue('Alice') === hashStringToHue('Alice')` and that two different names usually differ.

**Project rules that apply:**
- UI-SPEC "New Primitive" section (full API contract)
- Phase 13 v2 tokens: NO new color/spacing/font tokens; `text-display` token already exists in `src/index.css`
- `reference_ui_checker_dimension_traps.md`: collapsing 4 sizes to 3 (sm/md/lg only) avoids the >4-sizes BLOCK

---

#### C.15..C.17 Landing template renderers (`LandingTemplateCoach/Story/Method.tsx`)

**Analog:** `/Users/karstenhaldan/minisite/leanshot/src/components/admin/pages/blocks/HeroBlock.tsx` (block renderer pattern) + `/Users/karstenhaldan/minisite/leanshot/src/lib/page-builder/templates.ts` (template catalog).

**Why:** Phase 15 already shipped a block-tree renderer for 5 templates. Phase 19 ADD 3 new template instances (`coach`, `story`, `method`) to the same catalog OR ships dedicated renderers that consume the same `BlockNode[]` shape — UI-SPEC D-17 says "admin pre-creates 3 templates in the builder; affiliate's customization just fills in template slots."

**Recommended path:** seed migration (A.8) inserts 3 rows into `landing_pages` (or a new `affiliate_landing_templates` table) with template-block-tree JSON; runtime renders via existing Phase 15 page-render Edge Function at `/r/{code}` route (Vercel rewrite per D-37 #1).

**Customization slot pattern:** UI-SPEC D-18 fields (`display_name`, `photo_path`, `blurb`, `calendly_url`, `testimonial_quote`) bind as `{{slot}}` placeholders in block content; Edge Function substitutes at render time.

**Project rules that apply:**
- `reference_phase15_research_findings.md`: flat-JSONB block-tree schema; dnd-kit version trap (not relevant here — affiliate doesn't edit)
- Phase 15 PAGE-03 8-semantic-block contract (Hero, CTA, FAQ, Pricing, Testimonial, FeatureGrid, ImageText, Footer)

---

### E. CI / config

#### E.1 `leanshot/vercel.json` MODIFY

**Analog:** Existing rewrites at lines 4-8 of `leanshot/vercel.json`.

**Pattern** (extend the rewrites array):
```json
{ "source": "/r/:code", "destination": "https://ytnsipxxmzgaebkqmokp.supabase.co/functions/v1/affiliate-attribute?code=:code" },
{ "source": "/affiliate", "destination": "/index.html" },
{ "source": "/partner/(.*)", "destination": "/index.html" },
{ "source": "/admin/affiliates", "destination": "/index.html" }
```

**Critical (D-37 #1):** The first rewrite enables the Vercel→Supabase proxy that preserves `Set-Cookie: Domain=.leanshot.app`. Wave-0 smoke task curls this and asserts the cookie domain.

**Also update the catch-all page-render rewrite (current line 7) to EXCLUDE `partner` + `affiliate` + `r`** — current pattern is `^/((?!clinic|clinic-invite|admin|share|api|auth|assets|index\.html|assets/|sitemap\.xml|robots\.txt).+)$`. Add `partner|affiliate|r` to the negative-lookahead:

```json
{ "source": "/((?!clinic|clinic-invite|admin|share|api|auth|assets|index\\.html|assets/|sitemap\\.xml|robots\\.txt|partner|affiliate|r).+)", "destination": "https://ytnsipxxmzgaebkqmokp.supabase.co/functions/v1/page-render?slug=$1" }
```

**Project rules that apply:**
- D-37 #1 Wave-0 verification
- CSP at `vercel.json` lines 12-14 already covers `https://*.supabase.co` — no CSP changes needed
- Phase 12 firewall (`reference_eslint_import_x_path_gotcha.md`): not impacted (no new native zones)

---

#### E.2 `supabase/config.toml` MODIFY

**Analog:** existing `[functions.page-render]`, `[functions.lead-capture]`, `[functions.sitemap]` blocks (each with `verify_jwt = false`).

**Pattern (append):**
```toml
[functions.affiliate-attribute]
verify_jwt = false  # Public cookie-set endpoint at /r/{code}

[functions.stripe-connect-onboard]
verify_jwt = true   # JWT-gated — affiliate-only

[functions.affiliate-payout]
verify_jwt = true   # Cron-invoked via service-role JWT

[functions.account-delete]
verify_jwt = true   # User-self or P22 admin
```

**Project rules that apply:**
- `reference_supabase_edge_function_deploy.md`: default `verify_jwt = true`; public Edge Functions need explicit `false`

---

## Shared Patterns

### Pattern S1: Service-role admin client (every Edge Function)

**Source:** `share/index.ts:35-51`, `stripe-checkout/index.ts:112-143`, `clinic-invite/index.ts:62-74`, `page-render/index.ts:31-49`, `stripe-webhook/index.ts:31-56`.

**Apply to:** ALL Phase 19 Edge Functions (B.1, B.2, B.5, B.7, B.9).

```typescript
import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});
```

**Variants:**
- `stripe-checkout` uses LAZY init + Proxy wrapper to allow test-time `__setAdminForTest` override (lines 119-143) — adopt this pattern when tests need fakes
- `share` uses eager init (no test injection needed)

### Pattern S2: jsonResponse + jsonError helpers

**Source:** `stripe-webhook/index.ts:58-63`, `stripe-checkout/index.ts:149-158`, `share/index.ts:79-94`.

**Apply to:** ALL Phase 19 Edge Functions.

```typescript
function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
function jsonError(status: number, code: string): Response {
  return jsonResponse(status, { error: code });
}
```

**Variant:** `share/index.ts` requires per-request CORS headers (echoes Origin); `affiliate-attribute` is similar (must echo for Vercel-rewrite path).

### Pattern S3: PII safety — never echo upstream errors

**Source:** `stripe-webhook/index.ts:204-209`, `stripe-checkout/index.ts:200-202, 393-396`, `clinic-invite/resend.ts:73-81`.

```typescript
} catch (err) {
  console.error('[function-name] context', err instanceof Error ? err.message : 'unknown');
  return jsonError(500, 'internal');
}
```

**Apply to:** Every Stripe/Resend/external-API call in Phase 19 Edge Functions.

### Pattern S4: RLS file-scoped slug-prefix cleanup (project rule)

**Source:** `feedback_rls_per_file_slug_prefix.md` (project memory).

**Apply to:** Every RLS test file in `leanshot/tests/rls/` for Phase 19 (affiliates, affiliate_clicks, affiliate_conversions, payouts).

```typescript
const AFF_PREFIX = `aff-test-${randomUUID().slice(0,6)}-`;  // file-scoped
// ... uses AFF_PREFIX for all test fixtures ...
afterAll(() => cleanupTestAffiliates(AFF_PREFIX));
```

### Pattern S5: Service-role-minted JWT for RLS cross-tenant tests (project rule)

**Source:** `reference_rls_fixture_gotrueclient_flake.md` (project memory).

**Apply to:** Every cross-tenant impersonation test in Phase 19 (project rule from MEMORY: every RLS surface gets a live cross-tenant test).

```typescript
// Don't: client.auth.signInWithPassword(...) — flakes under jsdom parallel
// Do: mint a JWT via service-role, attach via headers.Authorization on a raw supabase-js client
```

### Pattern S6: Parallel-executor commit pathspec (project rule)

**Source:** `feedback_parallel_executor_git_isolation.md` (project memory).

**Apply to:** Every Phase 19 plan that touches a shared file (`stripe-webhook/events/invoice-paid.ts`, `stripe-checkout/index.ts`, `leanshot/vercel.json`, `supabase/config.toml`).

```bash
# Always:
git commit -- supabase/functions/stripe-webhook/events/invoice-paid.ts \
              supabase/functions/stripe-webhook/events/invoice-paid.test.ts
# Never bare `git add . && git commit` in parallel executor agent
```

### Pattern S7: Phase 12 bundle ceiling discipline

**Source:** `project_phase12_planning_complete.md` + `project_phase12_execute_complete.md`.

**Apply to:** Every new frontend route in C.1, C.4, C.5, C.6, C.7, C.8, C.15-17.

- Index ceiling 50 kB gz (currently ~21 kB)
- `/partner/*`, `/affiliate`, `/admin/affiliates`, `/r/{code}` — each its own `React.lazy` chunk in `App.tsx`
- Per-chunk ceiling target: ≤12 kB gz each (UI-SPEC line 497)
- `InitialsAvatar.tsx` is pure CSS gradient, ~0.3 kB

### Pattern S8: Deno test naming (project rule)

**Source:** `reference_deno_test_discovery.md` (project memory).

**Apply to:** Every Phase 19 Edge Function test file.

- Use `<name>.test.ts` (e.g. `affiliate-attribute.test.ts`, `invoice-paid.test.ts`)
- NOT `<name>-test.ts` (Supabase docs convention but breaks Deno glob)

---

## No Analog Found

Files with no close existing match (planner should use RESEARCH.md patterns + the cited near-analogs):

| File | Role | Data Flow | Reason | Recommendation |
|------|------|-----------|--------|----------------|
| `supabase/functions/affiliate-payout/index.ts` | edge-fn batch | cron-invoked | No `stripe.transfers.create` usage anywhere in repo | Compose from `clinic-invite` dispatcher + `stripe-checkout` SDK-init + `20260601000013_finalize_account_deletions_cron.sql` cron job; flag for plan-checker explicit review |
| `supabase/migrations/2027…_tier_effective_view.sql` (the VIEW itself, not the migration shape) | view | SELECT | No SQL views with `security_invoker=true` exist yet | Use raw Postgres CREATE VIEW with `WITH (security_invoker = true)` — Supabase docs confirm support since Postgres 15; current DB is on major_version 17 per `supabase/config.toml:35` |
| `supabase/migrations/2027…_affiliate_fraud_signals.sql` matview + Z-score | materialized view | scheduled refresh | No matview analog in repo | Plain `CREATE MATERIALIZED VIEW`; refresh via pg_cron daily; Z-score computed in plain SQL (no extension needed) — flag for plan-checker review |

---

## Metadata

**Analog search scope:**
- `/Users/karstenhaldan/minisite/supabase/migrations/` (65 files scanned)
- `/Users/karstenhaldan/minisite/supabase/functions/` (16 functions scanned: ai-chat, bulk-csv-export, clinic-invite, clinic-photo, clinic-snapshot, lead-capture, page-publish, page-render, page-save, patient-activity, share, sitemap, stripe-checkout, stripe-webhook)
- `/Users/karstenhaldan/minisite/leanshot/src/components/` (admin, auth, billing, clinic, dashboard, ui, marketing, share — ~120 .tsx files scanned)
- `/Users/karstenhaldan/minisite/leanshot/src/lib/` (billing, page-builder, supabase, share-card — scanned for module-level patterns)

**Files scanned:** ~210 total.

**Pattern extraction date:** 2026-05-15.

**Phase memory cross-references applied:**
- `reference_supabase_migration_gotchas.md` — IMMUTABLE partial indexes, SECURITY DEFINER search_path, `set_config('storage.allow_delete_query',...)`, `app.suppress_audit` GUC
- `reference_supabase_edge_function_deploy.md` — esm.sh URLs, verify_jwt explicit, gateway CSP override, UAT-probe pattern
- `reference_supabase_project.md` — every RLS surface gets a cross-tenant test (project rule)
- `reference_rls_fixture_gotrueclient_flake.md` — service-role-minted JWT pattern (not signInWithPassword)
- `feedback_rls_per_file_slug_prefix.md` — file-scoped slug prefix on cleanup
- `feedback_parallel_executor_git_isolation.md` — pathspec commits when ≥2 parallel executors touch shared files
- `reference_deno_test_discovery.md` — `<name>.test.ts` naming
- `feedback_planner_iter1_anti_patterns.md` — no enum-add-in-same-tx; idempotent upserts
- `reference_phase15_research_findings.md` — flat-JSONB block-tree schema for `/r/{code}` templates
- `project_phase16_research_complete.md` — Storage transforms deferred (Pro tier); client-side `object-fit:cover` fallback (UI-SPEC D-20)
- `project_phase12_planning_complete.md` + `project_phase12_execute_complete.md` — bundle ceilings + firewall
- `reference_ui_checker_dimension_traps.md` — ≤4 sizes, ≤2 weights per surface; reframe responsive as Tailwind prefixes
- `feedback_aggressive_foundations.md` + `feedback_regulator_vs_user_audience_pattern.md` — already baked into UI-SPEC + CONTEXT D-16 (3 template variants over default-1)

---

## PATTERN MAPPING COMPLETE

**Phase:** 19 — Affiliate Program + Stripe Connect
**Files classified:** 33 (10 migrations + 12 Edge-Function files + 18 frontend files + 2 lib + 2 config)
**Analogs found:** 32 / 33

### Coverage
- Files with exact analog: 22
- Files with role-match analog: 10
- Files with no analog (NOVEL): 1 (`affiliate-payout/index.ts` — `stripe.transfers.create` first use; composed from 3 partial analogs)

### Key Patterns Identified
- All Edge Functions follow service-role admin + lazy-init + jsonResponse/jsonError + PII-safe error logging shape
- All RLS migrations use idempotent `do $$ if not exists` + named policies (page_builder + stripe_subscriptions twin pattern)
- The cascade-delete pattern (D-33 ten steps) splits naturally: SQL function for DB-side (`finalize_affiliate_cascade`) + Edge Function for external-API steps (Stripe / Resend / Storage / auth.admin)
- Frontend follows established 12-col `<Card span={N}>` bento + lazy-route + `var(--color-*)` token discipline; ONE new UI primitive (`InitialsAvatar`) sits cleanly in `src/components/ui/` next to Badge
- The 3 affiliate landing-page templates fold into Phase 15's existing page-builder block-tree (seeds, not new renderer infrastructure)

### File Created
`/Users/karstenhaldan/minisite/leanshot/.planning/phases/19-affiliate-program-stripe-connect/19-PATTERNS.md`

### Ready for Planning
Pattern mapping complete. Planner can now reference these analogs (with absolute paths + line numbers) in 19-NN-NAME-PLAN.md action sections. Flag `affiliate-payout/index.ts` for explicit plan-checker pseudocode review (first `stripe.transfers.create` usage in repo). All other plans should cite a single concrete analog file path per task.
