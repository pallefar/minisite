# Phase 43: M4 Membership Tiers Extension — Pattern Map

**Mapped:** 2026-05-22
**Files analyzed:** 17 (net-new + extended + contract)
**Analogs found:** 14 / 17 (3 net-new with no analog — see "No Analog Found")

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `supabase/migrations/20270715000001_p43_lifetime_purchases.sql` | migration (table + RLS) | CRUD | `supabase/migrations/20270602000010_cohort_definitions.sql` | role-match (table+RLS+SECDEF-write pattern) |
| `supabase/migrations/20270715000002_p43_grandfathered_prices.sql` | migration (table + RLS) | CRUD | `supabase/migrations/20270602000010_cohort_definitions.sql` | exact (admin-read-only + SECDEF-writes pattern) |
| `supabase/migrations/20270715000003_p43_tier_effective_view_v2.sql` | migration (view replacement) | request-response | `supabase/migrations/20270101000004_tier_effective_view.sql` | exact (CREATE OR REPLACE on same view) |
| `supabase/migrations/20270715000004_p43_current_user_has_pro_fn.sql` | migration (SECDEF function) | request-response | `supabase/migrations/20270602000011_cohort_membership_matview.sql` (`cohort_is_member`) | exact (SECDEF + STABLE + search_path + grant pattern) |
| `supabase/migrations/20270715000005_p43_grandfathered_prices_rpcs.sql` | migration (SECDEF write RPCs) | CRUD | `supabase/migrations/20270602000012_cohort_rpcs.sql` (`cohort_define`) | exact (admin-gate + suppress_audit + log_admin_action pattern) |
| `supabase/migrations/20270715000006_p43_resolve_user_effective_price.sql` | migration (SECDEF helper) | request-response | `supabase/migrations/20270602000011_cohort_membership_matview.sql` (`cohort_is_member`) | role-match (SECDEF STABLE lookup) |
| `supabase/migrations/20270715000007_p43_promo_trial_extensions_log.sql` | migration (idempotency log) | event-driven | `supabase/migrations/20270602000010_cohort_definitions.sql` | role-match (table + RLS service-role-only) |
| `supabase/functions/stripe-webhook/events/checkout-session-completed.ts` (EXTEND) | edge-fn event handler | event-driven | itself (extend with new `tier_kind='lifetime'` arm) | exact (sibling branch in existing if/else chain) |
| `supabase/functions/stripe-checkout/index.ts` (EXTEND) | edge-fn handler | request-response | itself (extend with lifetime mode='payment' + 70% cap + grandfathered resolver) | exact (sibling plan-branch additions) |
| `supabase/functions/_shared/clamp-combined-discount.ts` | utility | transform | `supabase/functions/cancellation-accept-offer/apply-discount.ts` (math wrapper context) | role-match (pure transform reusing Stripe SDK pin pattern) |
| `supabase/functions/cancellation-accept-offer/index.ts` (EXTEND) | edge-fn handler | request-response | `supabase/functions/cancellation-accept-offer/apply-discount.ts` (call site) | exact (insert 70%-cap validator BEFORE applyDiscount) |
| `leanshot/src/components/billing/PaywallUpsell.tsx` (EXTEND) | component | request-response | `leanshot/src/components/billing/PaywallUpsell.tsx` (itself; add optional `gating_reason` prop) | exact (additive optional prop, no call-site breakage) |
| `leanshot/src/admin/modules/billing/GrandfatheredPricesPage.tsx` | component (admin page) | CRUD | `leanshot/src/admin/modules/hitl-queue/HitlQueuePage.tsx` | exact (admin shell module + supabase.rpc + supabase.from() load) |
| `leanshot/src/lib/admin/modules.ts` (EXTEND) | config (manifest) | request-response | itself (lines 211-221 `billing` entry) | exact (sibling manifest entry sub-route) |
| `leanshot/src/lib/entitlement/current-user-has-pro.ts` | utility (client cache wrapper) | request-response | (no exact analog — 60s LRU Map cache pattern is net-new client-side) | partial (Phase 36 cooldown cache referenced in research) |
| `leanshot/src/lib/checkout/clamp-discount.ts` | utility | transform | `supabase/functions/_shared/clamp-combined-discount.ts` (sibling — Edge Fn variant) | role-match (shared algorithm; planner picks single home or duplicate) |
| `.planning/phases/43-*/43-PRO-GATING-CONTRACT.md` | doc (cross-phase contract) | event-driven | (no analog — net-new contract document) | none |

## Pattern Assignments

### `supabase/migrations/20270715000003_p43_tier_effective_view_v2.sql` (view replacement)

**Analog:** `supabase/migrations/20270101000004_tier_effective_view.sql`

**Header pattern** (lines 1-16):
```sql
-- Phase 19 Plan 01 — tier_effective view + affiliates_public_view (D-01..D-04 + BL-3).
--
-- Spec references:
--   - 19-CONTEXT.md D-01..D-04 (cross-provider tier reconciliation; security_invoker=true)
--   - Supabase database-advisors lint 0010_security_definer_view: views MUST be created with
--     `security_invoker=true` to honor caller's RLS at query time.
```
P43 plan must replicate the spec-reference comment header naming P43 D-01/D-02 + Pitfall 1 (CASCADE dependency on `cohort_profile_view`).

**View create pattern** (lines 22-39 — the EXACT shape to extend):
```sql
create or replace view public.tier_effective
  with (security_invoker = true)
as
select
  user_id,
  max(current_period_end) as effective_period_end,
  bool_or(status in ('active','trialing')) as has_active,
  bool_or(status in ('past_due','unpaid')) as has_past_due,
  (array_agg(provider order by current_period_end desc nulls last))[1] as winning_provider
from public.subscriptions
where user_id is not null
group by user_id;

comment on view public.tier_effective is '...';
grant select on public.tier_effective to authenticated;
```

**Extension shape (P43):** Wrap in CTE that UNION-ALLs `public.subscriptions` rows with `public.lifetime_purchases` rows; preserve column ORDER + names + types (per OQ-1 RESOLVED — `tier_label text` APPENDED last). Keep `with (security_invoker = true)`. Re-grant to `authenticated`.

**Dependency check (Pitfall 1):** `cohort_profile_view` at `20270602000010_cohort_definitions.sql:117-119` LEFT JOINs `public.tier_effective t` on `t.user_id = p.id`. Since P43 preserves the column-superset (just appends `tier_label`), `create or replace view` should work WITHOUT cascade. Plan MUST grep for other dependents before applying.

---

### `supabase/migrations/20270715000004_p43_current_user_has_pro_fn.sql` (SECDEF)

**Analog:** `supabase/migrations/20270602000011_cohort_membership_matview.sql` lines 111-139 (`cohort_is_member`)

**SECDEF function pattern** (lines 114-139, verbatim shape to copy):
```sql
create or replace function public.cohort_is_member(
  p_user_id uuid,
  p_cohort_id uuid
)
returns boolean
language sql
security definer
stable
set search_path = public, pg_catalog
as $$
  select exists(
    select 1
      from public.cohort_membership
      where user_id = p_user_id
        and cohort_id = p_cohort_id
  );
$$;

comment on function public.cohort_is_member(uuid, uuid) is
  'Consumer helper for PAYWALL/RECOMMEND/SAVE/GAME plans. Returns boolean '
  'membership (does NOT leak rule contents or other-user membership). ...';

revoke all on function public.cohort_is_member(uuid, uuid) from public;
grant execute on function public.cohort_is_member(uuid, uuid) to authenticated;
```

**P43 application:** Ship TWO functions per [[feedback_rpc_auth_uid_vs_service_role_mismatch]]:
1. `current_user_has_pro()` — reads `auth.uid()`, for RLS-policy use (authenticated callers only).
2. `user_has_pro(p_user_id uuid)` — explicit-param variant, for service-role / admin callers.

Both `LANGUAGE sql` + `SECURITY DEFINER` + `STABLE` + `SET search_path = public, pg_catalog` + `revoke all from public` + `grant execute to authenticated`.

---

### `supabase/migrations/20270715000005_p43_grandfathered_prices_rpcs.sql` (SECDEF writes)

**Analog:** `supabase/migrations/20270602000012_cohort_rpcs.sql` (`cohort_define`)

**Admin-gated SECDEF write pattern** (lines 139-194):
```sql
create or replace function public.cohort_define(
  p_name         text,
  p_rule         jsonb,
  p_compiled_sql text
)
returns uuid
language plpgsql
security definer
set search_path = public, extensions, pg_catalog
as $$
declare
  v_caller    uuid := auth.uid();
  v_cohort_id uuid;
begin
  if v_caller is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if not public.is_admin_at_least('admin'::public.admin_role) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  -- ... input validation ...

  -- Suppress the audit-trigger duplicate; we'll call log_admin_action below.
  perform set_config('app.suppress_audit', 'on', true);

  insert into public.cohort_definitions (...) values (...) returning id into v_cohort_id;

  perform public.log_admin_action(
    p_action_name    => 'cohort_defined',
    p_target_user_id => null,
    p_table_name     => 'public.cohort_definitions',
    p_row_pk         => v_cohort_id::text,
    p_before         => null,
    p_after          => jsonb_build_object(...)
  );

  return v_cohort_id;
end;
$$;

revoke all on function public.cohort_define(text, jsonb, text) from public;
grant execute on function public.cohort_define(text, jsonb, text) to authenticated;
```

**P43 application:** Ship `grandfathered_price_create(cohort_id uuid, stripe_price_id text, effective_from timestamptz, effective_until timestamptz)`, `_update`, `_delete`. Each follows the EXACT shape: auth.uid() null check → `is_admin_at_least('admin')` check → input validation → `set_config('app.suppress_audit')` → INSERT/UPDATE/DELETE → `log_admin_action(...)`.

---

### `supabase/migrations/20270715000001_p43_lifetime_purchases.sql` (table)

**Analog:** `supabase/migrations/20270602000010_cohort_definitions.sql` (lines 33-75)

**Table + RLS pattern** (lines 33-75 — denial-by-default-with-self-read variant):
```sql
create table if not exists public.cohort_definitions (
  id           uuid primary key default gen_random_uuid(),
  ...
  created_by   uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

comment on table public.cohort_definitions is '...';

create index if not exists cohort_definitions_status_idx
  on public.cohort_definitions(status);

alter table public.cohort_definitions enable row level security;

create policy pol_cohort_definitions_admin_select
  on public.cohort_definitions
  for select
  to authenticated
  using (public.is_admin_at_least('admin'::public.admin_role));

-- NO insert/update/delete policies — Pattern S2: writes only via SECDEF RPCs.
-- The absence of policies = denial-by-default under RLS.
```

**P43 application (lifetime_purchases):**
- `pol_lifetime_purchases_self_read FOR SELECT TO authenticated USING (user_id = auth.uid())` — self-only read (not admin-only; this is per-user payment data).
- No INSERT/UPDATE/DELETE policies — webhook (service-role) is sole writer.
- Partial index `WHERE refunded_at IS NULL`.

**P43 application (grandfathered_prices):** ADMIN-only read pattern; same denial-by-default for writes (SECDEF RPCs).

---

### `supabase/functions/stripe-webhook/events/checkout-session-completed.ts` (EXTEND)

**Analog:** itself (lines 1-95) — extend with new `tier_kind='lifetime'` arm

**Imports + handler signature** (lines 1-8):
```typescript
/**
 * checkout-session-completed.ts — Handler for `checkout.session.completed` event.
 * Phase 14 Plan 03 Task 2 (full implementation).
 */
import type Stripe from 'stripe';
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

export async function handle(event: Stripe.Event, admin: SupabaseClient): Promise<void> {
  const session = event.data.object as Stripe.Checkout.Session;
  const subId = session.subscription as string;
  const customerId = session.customer as string;
```

**Metadata-reading pattern** (lines 14-16 — copy verbatim):
```typescript
const meta = (
  (session.subscription_data?.metadata ?? session.metadata) as Record<string, string>
) ?? {};
```

**Existing branch shape** (lines 18-49 — `web` branch); P43 adds 3rd branch `else if (meta.tier_kind === 'lifetime')` before the existing terminal `else` at line 88. Lifetime branch:
- Reads `session.payment_intent as string` (NOT `session.subscription`) — Pitfall 10.
- `admin.from('lifetime_purchases').upsert({...}, { onConflict: 'stripe_payment_intent_id', ignoreDuplicates: true })`.
- Throws `'lifetime-purchases-upsert-failed'` on error (matches existing throw pattern at line 48).
- Updates terminal `else` error message: `tier_kind not in {web,clinic,lifetime}` (line 92).
- Inline Slack alert via `EdgeRuntime.waitUntil(fetch(SLACK_WEBHOOK_EXPERIMENTS_URL, ...).catch(console.error))` per OQ-7 RESOLVED.

---

### `supabase/functions/stripe-checkout/index.ts` (EXTEND)

**Analog:** itself (lines 60-99 env-helpers + Stripe singleton; lines 380-450 plan-branch + checkout.sessions.create)

**Env-helper pattern** (lines 66-78):
```typescript
function env(name: string, fallback = ''): string {
  return Deno.env.get(name) ?? fallback;
}
const getPricePlusMonthly = () => env('STRIPE_PRICE_PLUS_MONTHLY');
const getPricePlusYearly = () => env('STRIPE_PRICE_PLUS_YEARLY');
const getPriceClinicBase = () => env('STRIPE_PRICE_CLINIC_BASE');
```

**P43 add:** `const getPriceLifetime = () => env('STRIPE_PRICE_LIFETIME');` — graceful 503 if missing (vendor-gated-send pattern per [[reference_vendor_gated_send_health_check]]).

**Stripe SDK pin** (lines 87-99 — DO NOT bump):
```typescript
_stripeInstance = new Stripe(getStripeSecretKey(), {
  apiVersion: '2026-04-22.dahlia' as Parameters<typeof Stripe>[1]['apiVersion'],
  httpClient: Stripe.createFetchHttpClient(),
});
```
Stays at `https://esm.sh/stripe@19?target=denonext` (matches `apply-discount.ts:24`).

**Plan-branch + line_items pattern** (lines 384-394):
```typescript
let lineItems: LineItem[];
if (plan === 'plus_monthly') {
  lineItems = [{ price: getPricePlusMonthly(), quantity: 1 }];
} else if (plan === 'plus_yearly') {
  lineItems = [{ price: getPricePlusYearly(), quantity: 1 }];
} else {
  // clinic
  lineItems = [
    { price: getPriceClinicBase(), quantity: 1 },
    { price: getPriceClinicOverage(), quantity: 1 },
  ];
}
```

**P43 add lifetime branch BEFORE existing branches:**
```typescript
if (plan === 'lifetime') {
  // REJECT promo_code per OQ-6 RESOLVED:
  if (body.promo_code) return jsonError(400, 'lifetime_no_promo_code');
  lineItems = [{ price: getPriceLifetime(), quantity: 1 }];
} else if (plan === 'plus_monthly') { ... }
```

**Grandfathering resolver call (D-03):** BEFORE line 384 plan-branch, call `admin.rpc('resolve_user_effective_price', { p_user_id: user.id, p_plan: plan })` and substitute the returned price_id into lineItems for `plus_monthly`/`plus_yearly`.

**checkout.sessions.create pattern** (lines 427-444 — existing `mode: 'subscription'`):
```typescript
const session = await stripeInstance.checkout.sessions.create({
  mode: 'subscription',
  customer: customerId,
  payment_method_collection: 'always',
  line_items: lineItems,
  subscription_data: {
    trial_period_days: 7,
    metadata: subMetadata,
  },
  metadata: { aff_code: affCode ?? '' },
  success_url: successUrl,
  cancel_url: cancelUrl,
  client_reference_id: clinicId ?? user.id,
});
```

**P43 lifetime variant** (per Pitfall 10):
```typescript
const session = await stripeInstance.checkout.sessions.create({
  mode: 'payment',                       // NOT 'subscription'
  customer: customerId,
  payment_method_collection: 'always',
  line_items: lineItems,
  payment_intent_data: {                 // NOT subscription_data
    metadata: { user_id: user.id, provider: 'stripe', tier_kind: 'lifetime' },
  },
  metadata: { user_id: user.id, tier_kind: 'lifetime' },
  success_url: successUrl,
  cancel_url: cancelUrl,
  client_reference_id: user.id,
});
```

**70% cap validator placement:** New `clampCombinedDiscount(promoPct, saveOfferPct)` call BEFORE `sessions.create` when `body.promo_code` is set — fail-fast with `jsonError(400, 'discount_combination_exceeds_max')`.

---

### `supabase/functions/cancellation-accept-offer/index.ts` (EXTEND with 70% cap)

**Analog:** `supabase/functions/cancellation-accept-offer/apply-discount.ts` (the call site context)

**discounts[] append pattern** (lines 35-64 — verbatim reference):
```typescript
import Stripe from 'https://esm.sh/stripe@19?target=denonext';

export async function applyDiscount(
  subscriptionId: string,
  couponId: string,
  stripe: Stripe,
): Promise<{ appliedCouponId: string }> {
  const sub = await stripe.subscriptions.retrieve(subscriptionId, {
    expand: ['discounts'],
  });

  const discounts = (sub.discounts ?? []) as Array<string | Stripe.Discount>;
  const existing = discounts.map((d) => {
    if (typeof d === 'string') return { coupon: d };
    const couponField = d.coupon;
    if (typeof couponField === 'string') return { coupon: couponField };
    return { coupon: (couponField as Stripe.Coupon).id };
  });

  await stripe.subscriptions.update(subscriptionId, {
    discounts: [...existing, { coupon: couponId }],
  });

  return { appliedCouponId: couponId };
}
```

**P43 application:** BEFORE the `stripe.subscriptions.update` call (line 62-64), inject the 70%-cap validator:
1. Map existing discounts → percent-off list via `stripe.coupons.retrieve` on each (or pass via decide-offer payload).
2. Compute naive combined % via `1 - product((1 - p_i))`.
3. If > 0.70, clip the LOWEST-priority (promo) coupon per D-07; SAVE-offer is preserved.
4. Persist applied-coupon record (idempotency log).

---

### `supabase/functions/cancellation-accept-offer/apply-extended-trial.ts` (REUSE verbatim)

**Analog:** itself (verbatim — no extension needed for P43)

**Trial-extension pattern** (lines 21-40):
```typescript
export async function applyExtendedTrial(
  subscriptionId: string,
  extensionDays: 7 | 14 | 30,
  stripe: Stripe,
): Promise<{ newTrialEnd: string; nextInvoiceDate: string }> {
  const sub = await stripe.subscriptions.retrieve(subscriptionId);

  const nowUnix = Math.floor(Date.now() / 1000);
  const baseTrialEnd = sub.trial_end && sub.trial_end > nowUnix ? sub.trial_end : nowUnix;
  const newTrialEndUnix = baseTrialEnd + extensionDays * 86400;

  await stripe.subscriptions.update(subscriptionId, {
    trial_end: newTrialEndUnix,
    proration_behavior: 'none',
  });

  const newTrialEndDate = new Date(newTrialEndUnix * 1000).toISOString();
  return { newTrialEnd: newTrialEndDate, nextInvoiceDate: newTrialEndDate };
}
```

**P43 application:** Call `applyExtendedTrial(subId, 7, stripe)` from stripe-checkout (when promo-code grants 7-day trial extension per MEMBER-03 / D-08). Per OQ-4, wrap call with idempotency check against `promo_trial_extensions_log(subscription_id, promo_code_id)` UNIQUE — INSERT first, on conflict skip the Stripe call.

---

### `leanshot/src/components/billing/PaywallUpsell.tsx` (EXTEND)

**Analog:** itself (lines 32-67 — props + component shape)

**Props pattern** (lines 32-45 — additive extension target):
```typescript
export interface PaywallUpsellProps {
  variant: 'overlay' | 'cta';
  feature: FeatureKey;
  /** Optional override of upsell headline; defaults derived from feature key. */
  headline?: string;
  /**
   * Which plan to send to the checkout endpoint. Defaults to 'plus_monthly'.
   */
  plan?: Plan;
}
```

**P43 extension (per Pitfall 8 — OPTIONAL with default = existing behavior):**
```typescript
export interface PaywallUpsellProps {
  variant: 'overlay' | 'cta';
  feature: FeatureKey;
  headline?: string;
  plan?: Plan;
  /** P43 MEMBER-04: which gating reason drives the copy. Defaults to existing activation-paywall behavior. */
  gating_reason?: 'activation_paywall' | 'pro_only_resource';
  /** P43: for 'pro_only_resource' variant — what content is gated. */
  resource_type?: 'community' | 'course' | 'event';
  resource_name?: string;
}
```
Default `gating_reason = 'activation_paywall'` preserves existing call sites (MedLevelChart, AIChatPanel) verbatim — TS does not break.

**Checkout invoke pattern** (lines 71-87 — copy verbatim for new gating-reason branch; just swap headline copy + upsell_url):
```typescript
const handleUpgrade = async (): Promise<void> => {
  try {
    const { data, error } = await supabase.functions.invoke(
      'stripe-checkout/session',
      { body: { plan } },
    );
    if (error || !data?.url) {
      console.error('[PaywallUpsell] checkout invoke failed', error?.message ?? 'no-url');
      return;
    }
    window.location.href = data.url;
  } catch (err) {
    console.error('[PaywallUpsell] upgrade redirect failed', err);
  }
};
```

---

### `leanshot/src/admin/modules/billing/GrandfatheredPricesPage.tsx` (NEW)

**Analog:** `leanshot/src/admin/modules/hitl-queue/HitlQueuePage.tsx`

**Header + imports + supabase load pattern** (lines 1-80):
```typescript
/**
 * Phase 38 Plan 38-08 — HitlQueuePage (RECOMMEND-07, D-12/13/14).
 *
 * Super-admin HITL admin queue. Plugs into Phase 24 admin shell via
 * `@/lib/admin/modules` (registered as `key: 'hitl-queue'`, `minRole: 'superadmin'`).
 *
 * Decision flow:
 *   1. supabase.rpc('hitl_decide', { row_ids, decision, ... }).
 *      Server-side: super-admin gate + status='pending' only.
 * ...
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';

export default function HitlQueuePage() {
  const [rows, setRows] = useState<HitlRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  ...
  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('ai_suggestion_review')
        .select('*')
        .in('status', ['pending', 'auto_approved_kb'])
        .order('created_at', { ascending: false })
        .limit(200);
      if (error) {
        setError(error.message);
      } else {
        setRows((data ?? []) as HitlRow[]);
        setError(null);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'unknown error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);
  ...
}
```

**P43 application:** Copy the structure 1:1:
- Header comment naming P43 Plan + MEMBER-02 + D-03..D-05.
- `useState` for rows / loading / error / editingRow.
- `reload` callback hitting `supabase.from('grandfathered_prices').select('*, cohort:cohort_definitions(name)').order('effective_from', { ascending: false })`.
- Write actions hit `supabase.rpc('grandfathered_price_create' | '_update' | '_delete', { ... })`.
- Lazy-default-exported component (admin shell uses `lazy: () => import(...).then(m => ({ default: m.HitlQueueLayout }))` — match this in `modules.ts`).

---

### `leanshot/src/lib/admin/modules.ts` (EXTEND manifest)

**Analog:** itself (lines 198-221, billing entry)

**Manifest entry pattern** (lines 198-221):
```typescript
{
  key: 'billing',
  label: 'Billing',
  route: 'billing',
  icon: CreditCardIcon,
  lazy: () =>
    import('@/components/admin/pages/AdminAffiliatesPage').then((m) => ({
      default: m.AdminAffiliatesPage,
    })),
  flagKey: 'admin.billing.enabled',
  minRole: 'admin' as AdminRole,
},
```

**P43 application:** Add sub-route to existing `billing` module OR add sibling entry `key: 'billing-grandfathered'` with `route: 'billing/grandfathered-prices'`. Per [[feedback_admin_module_manifest_vs_router_branch_drift]] the URL-prefix-keyed router auto-resolves `/admin/billing/grandfathered-prices` if the existing `billing` lazy-loaded layout exports a sub-router. Planner picks based on whether `AdminAffiliatesPage` is currently the wrapper or the only billing page.

---

## Shared Patterns

### Supabase Edge Fn — Stripe SDK + apiVersion pin
**Source:** `supabase/functions/cancellation-accept-offer/apply-discount.ts:24` + `stripe-checkout/index.ts:91-95`
**Apply to:** ALL P43 Edge Fn extensions (stripe-webhook, stripe-checkout, cancellation-accept-offer)
**Verbatim:**
```typescript
import Stripe from 'https://esm.sh/stripe@19?target=denonext';
// constructor pinned:
new Stripe(secret, {
  apiVersion: '2026-04-22.dahlia' as Parameters<typeof Stripe>[1]['apiVersion'],
  httpClient: Stripe.createFetchHttpClient(),
});
```
**DO NOT** bump to stripe@22 mid-milestone. Per RESEARCH lines 122-124.

### Supabase admin client (service-role) + lazy initialization
**Source:** `supabase/functions/stripe-checkout/index.ts:122-148`
**Apply to:** Any new Edge Fn that needs service-role DB writes
```typescript
import { createClient } from 'npm:@supabase/supabase-js@2';
let _adminInstance: any = null;
function getAdmin(): any {
  if (_adminInstance === null) {
    _adminInstance = createClient(getSupabaseUrl(), getSupabaseServiceRoleKey(), {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  }
  return _adminInstance;
}
export function __setAdminForTest(fakeAdmin: unknown): void {
  _adminInstance = fakeAdmin;
}
```

### SECDEF function shape (RLS predicates + admin RPCs)
**Source:** `supabase/migrations/20270602000011_cohort_membership_matview.sql:114-139`
**Apply to:** `current_user_has_pro()`, `user_has_pro(p_user_id)`, `resolve_user_effective_price(...)`
```sql
create or replace function public.<name>(<args>)
returns <type>
language sql           -- or plpgsql for branches
security definer
stable                 -- IMMUTABLE only if zero table reads
set search_path = public, pg_catalog
as $$
  ...
$$;
revoke all on function public.<name>(<args>) from public;
grant execute on function public.<name>(<args>) to authenticated;
```
**Critical:** [[feedback_rpc_auth_uid_vs_service_role_mismatch]] — any function referencing `auth.uid()` MUST have a sibling explicit-param variant for service-role callers.

### Admin-gated SECDEF write RPC with audit
**Source:** `supabase/migrations/20270602000012_cohort_rpcs.sql:139-194`
**Apply to:** `grandfathered_price_create`, `_update`, `_delete`
- `auth.uid()` null check → `not_authenticated` (errcode `28000`)
- `is_admin_at_least('admin')` check → `forbidden` (errcode `42501`)
- input validation → `invalid_*` (errcode `22023`)
- `perform set_config('app.suppress_audit', 'on', true)` (Pattern S3)
- INSERT/UPDATE/DELETE + RETURNING
- `perform public.log_admin_action(p_action_name, p_target_user_id, p_table_name, p_row_pk, p_before, p_after)`
- `revoke all ... from public; grant execute ... to authenticated;`

### Table + RLS (denial-by-default + self-or-admin read)
**Source:** `supabase/migrations/20270602000010_cohort_definitions.sql:33-75`
**Apply to:** `lifetime_purchases` (self-read), `grandfathered_prices` (admin-read), `promo_trial_extensions_log` (service-role-only)
- `alter table public.<t> enable row level security;`
- `create policy pol_<t>_<verb> on public.<t> for <op> to authenticated using (<predicate>);`
- NO INSERT/UPDATE/DELETE policies — SECDEF RPC / service-role writes only.
- Comment block documenting Pattern S2 denial-by-default.

### Edge Fn JSON response shape
**Source:** `supabase/functions/stripe-checkout/index.ts:154-159`
```typescript
function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
```
**Apply to:** P43 70%-cap-fail messages, lifetime_no_promo_code 400, pro_required 403.

### Vite client component — supabase RPC + supabase.from() load
**Source:** `leanshot/src/admin/modules/hitl-queue/HitlQueuePage.tsx:33-79`
**Apply to:** GrandfatheredPricesPage + any P43 admin sub-page
- `import { supabase } from '@/lib/supabase';`
- `useState` for rows / loading / error
- `useCallback`-wrapped reload using `supabase.from(...).select(...)` with `try/catch/finally`
- Write actions via `supabase.rpc(...)` with `if (error) setError(error.message)`

---

## No Analog Found

| File | Role | Data Flow | Reason / Substitute |
|------|------|-----------|---------------------|
| `leanshot/src/lib/entitlement/current-user-has-pro.ts` | client cache wrapper (60s LRU `Map<userId,{value,expiresAt}>`) | request-response | No equivalent 60s-TTL LRU pattern in current codebase. Use Phase 36 cooldown-cache pattern referenced in RESEARCH §A6 — planner researches that file at plan-write time. |
| `.planning/phases/43-*/43-PRO-GATING-CONTRACT.md` | cross-phase contract document | event-driven | Net-new artifact. Document SQL templates for Phases 44/46/47 to copy verbatim (ALTER TABLE pro_only + CREATE POLICY pol_*_pro_only_gate). [[feedback_planner_prompt_explicit_reuse_targets]] dictates concrete spell-out. |
| `supabase/functions/slack-alert-experiments` (REUSE if exists / inline-fetch fallback) | edge-fn webhook dispatcher | event-driven | Not yet shipped (Phase 39 outstanding). Per OQ-7 RESOLVED: P43 uses INLINE `fetch(Deno.env.get('SLACK_WEBHOOK_EXPERIMENTS_URL'), { method:'POST', body: JSON.stringify({text:...}) }).catch(console.error)` inside `EdgeRuntime.waitUntil(...)` from the webhook handler. Reuses the Function Secret pattern only. |

## Metadata

**Analog search scope:**
- `supabase/migrations/` — all .sql files (grep for `tier_effective`, `cohort_`, `is_admin_at_least`, `security_invoker`, `security definer`).
- `supabase/functions/stripe-*` — webhook + checkout + accept-offer.
- `supabase/functions/cancellation-accept-offer/` — apply-discount, apply-extended-trial.
- `leanshot/src/components/billing/` — PaywallUpsell.
- `leanshot/src/admin/modules/` — hitl-queue (admin page analog).
- `leanshot/src/lib/admin/modules.ts` — manifest.

**Files scanned:** 17 read in full or targeted ranges.

**Pattern extraction date:** 2026-05-22

**Cross-references:**
- [[reference_supabase_edge_function_deploy]] — Stripe SDK pin + apiVersion (verified at multiple analogs).
- [[feedback_rpc_auth_uid_vs_service_role_mismatch]] — drives the dual `current_user_has_pro()` / `user_has_pro(p_user_id)` pattern.
- [[feedback_admin_module_manifest_vs_router_branch_drift]] — manifest extension safety for `/admin/billing/grandfathered-prices`.
- [[reference_supabase_migration_filename_regex]] + [[reference_supabase_back_dated_migration_blocks_push]] — 14-digit strict + ahead-of-tail requirement (RESEARCH Pitfall 3 — slot `20270715*`).
- [[reference_vendor_gated_send_health_check]] — STRIPE_PRICE_LIFETIME graceful 503 if missing.
