# Phase 26: Multi-Tier Affiliate (Standard / Gold / Lifetime) — Pattern Map

**Mapped:** 2026-05-17
**Files analyzed:** 24 new/modified files
**Analogs found:** 22 / 24 (2 NET-NEW infra with no in-repo analog)

> Critical layout note (per pattern_mapping_context): **Supabase code lives at `/Users/karstenhaldan/minisite/supabase/`** (migrations + edge functions). **Client code lives at `/Users/karstenhaldan/minisite/leanshot/src/`** (React + TS). All file paths below are written **relative to those two roots** — planner MUST prefix accordingly.

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `supabase/migrations/<ts>_affiliate_tier_schema.sql` | migration (ALTER + index) | DDL | `supabase/migrations/20270101000001_affiliates_schema.sql` | exact (CHECK-constraint enum + partial index pattern) |
| `supabase/migrations/<ts>_affiliate_conversions_tier_stamp_alter.sql` | migration (ALTER + backfill) | DDL | `supabase/migrations/20270601000019_admin_affiliate_review_rpcs.sql` §1 | exact (ADD COLUMN IF NOT EXISTS idiom) |
| `supabase/migrations/<ts>_affiliate_tier_stamp_trigger.sql` | migration (BEFORE INSERT trigger) | trigger | `supabase/migrations/20270101000005_insert_affiliate_impression_fn.sql` | role-match (SECURITY DEFINER + locked search_path) |
| `supabase/migrations/<ts>_affiliate_promotion_trigger.sql` | migration (AFTER INSERT trigger) | trigger | `supabase/migrations/20270601000019_admin_affiliate_review_rpcs.sql` §4 | role-match (status mutation + audit_logs INSERT) |
| `supabase/migrations/<ts>_affiliate_lifetime_recurring_table.sql` | migration (NEW table + RLS) | schema | `supabase/migrations/20270101000002_affiliate_clicks_conversions_payouts.sql` | exact (idempotency-key UNIQUE constraint pattern) |
| `supabase/migrations/<ts>_affiliate_fraud_signals_table.sql` | migration (NEW table + RLS) | schema | `supabase/migrations/20270101000002_affiliate_clicks_conversions_payouts.sql` | role-match |
| `supabase/migrations/<ts>_affiliate_ratio_baseline_mv.sql` | migration (matview + cron) | matview | `supabase/migrations/20270101000007_affiliate_click_baseline_mv.sql` | **exact** (lift-and-modify) |
| `supabase/migrations/<ts>_audit_logs_action_extend_p26.sql` | migration (CHECK drop+readd) | DDL | `supabase/migrations/20270601000019_admin_affiliate_review_rpcs.sql` §3 | **exact** (Phase 22 idiom) |
| `supabase/migrations/<ts>_admin_tier_rpcs.sql` | migration (SECDEF RPCs) | RPC | `supabase/migrations/20270601000019_admin_affiliate_review_rpcs.sql` §4–6 | **exact** (lift-and-modify per RPC) |
| `supabase/migrations/<ts>_payouts_adjustments_alter.sql` | migration (ADD COLUMN jsonb) | DDL | `supabase/migrations/20270601000019_admin_affiliate_review_rpcs.sql` §1 | role-match |
| `supabase/migrations/<ts>_affiliate_lifetime_recurring_cron.sql` | migration (pg_cron schedule) | cron | `supabase/migrations/20270101000012_payouts_materialization_and_cron.sql` §AFF-06 | **exact** (net.http_post + vault) |
| `supabase/migrations/<ts>_landing_template_gold_seed.sql` | migration (seed UPDATE) | DML | `supabase/migrations/20270101000010_affiliate_landing_template_seeds.sql` | exact |
| `supabase/functions/affiliate-lifetime-recurring/index.ts` | edge function (cron-invoked) | batch | `supabase/functions/affiliate-payout/index.ts` | **exact** (cron-invoked Stripe + admin singleton + bearer compare) |
| `supabase/functions/affiliate-lifetime-recurring/deno.json` | edge function config | config | `supabase/functions/affiliate-payout/deno.json` | exact |
| `supabase/functions/affiliate-lifetime-recurring/index.test.ts` | edge function test | test | `supabase/functions/affiliate-payout/index.test.ts` | exact |
| `supabase/functions/stripe-webhook/events/charge-refunded.ts` | webhook handler | event-driven | `supabase/functions/stripe-webhook/events/invoice-paid.ts` | **exact** (event-handler shape) |
| `supabase/functions/stripe-webhook/events/charge-refunded.test.ts` | webhook test | test | `supabase/functions/stripe-webhook/events/invoice-paid.test.ts` | exact |
| `supabase/functions/stripe-webhook/events/charge-dispute-created.ts` | webhook handler | event-driven | `supabase/functions/stripe-webhook/events/invoice-paid.ts` | exact |
| `supabase/functions/stripe-webhook/index.ts` (MODIFY) | webhook dispatcher | event-driven | `supabase/functions/stripe-webhook/index.ts:107-134` (self) | exact (add 2 `case` arms) |
| `src/lib/affiliate/api.ts` (MODIFY — extend) | data-access | request-response | `src/lib/affiliate/api.ts` (self, `fetchAffiliateStats`) | exact (additive extension) |
| `src/lib/affiliate/tier-config.ts` (NEW) | utility constants | pure | _no analog_ — NET-NEW commission-rate table | n/a (D-01 source-of-truth shape) |
| `src/lib/admin/affiliate-tier.ts` (NEW) | client RPC wrapper | request-response | `src/lib/admin/affiliate-review.ts` | **exact** (mirror per RPC) |
| `src/lib/admin/affiliate-review.ts` (MODIFY) | client RPC wrapper | request-response | `src/lib/admin/affiliate-review.ts` (self) | exact (add `confirm_fraud`/`mark_clear` methods) |
| `src/components/admin/AdminAffiliatesAnomalyTab.tsx` (NEW) | admin component | CRUD list | `src/components/admin/AdminAffiliatesReviewQueue.tsx` | **exact** (lift segmented-filter + per-row actions) |
| `src/components/admin/AdminAffiliatesTierTab.tsx` (NEW) | admin component | CRUD list | `src/components/admin/AdminAffiliatesReviewQueue.tsx` | role-match |
| `src/components/admin/AdminAffiliatesReviewQueue.tsx` (MODIFY) | admin component | CRUD list | self | exact (add tab-host wrapper) |
| `src/components/landing/AffiliateLandingResolver.tsx` (MODIFY) | resolver | request-response | self (lines 37-41 TEMPLATE_LOADERS) | exact (add `gold:` key) |
| `src/components/landing/LandingTemplateGold.tsx` (NEW) | landing template | render | `src/components/landing/LandingTemplateCoach.tsx` | exact (mirror Coach prop interface + structure) |
| `src/components/partner/PartnerTierProgress.tsx` (NEW) | partner UI | request-response | `src/components/partner/PartnerKpiCard.tsx` + `PartnerTrendChart.tsx` | role-match |
| `src/components/partner/PartnerTierEarningsBreakdown.tsx` (NEW) | partner UI | request-response | `src/components/partner/PartnerKpiCard.tsx` | role-match |
| `src/components/partner/PartnerDashboard.tsx` (MODIFY) | composition | request-response | self (lines 60-80) | exact (mount 2 new components) |
| `e2e/affiliate-tier-stamping.spec.ts` (NEW) | vitest DB test | DB invariant | `e2e/rls-*.test.ts` family (vitest cross-tenant pattern) | role-match (per `feedback_realtime_layer_e2e_pattern`) |
| `e2e/affiliate-landing-gold.spec.ts` (NEW) | Playwright spec | snapshot | _no analog_ — NET-NEW `toHaveScreenshot` infra | n/a (per RESEARCH §Pattern 7; zero existing baselines) |
| `e2e/affiliate-tier-promotion.spec.ts` (NEW) | Playwright spec | e2e | `e2e/checkout-trial-flow.spec.ts` (closest stripe-driven e2e) | partial |

---

## Pattern Assignments

### `supabase/migrations/<ts>_affiliate_tier_schema.sql` (D-15)

**Analog:** `supabase/migrations/20270101000001_affiliates_schema.sql:36`

**Per-RESEARCH lines 348–362 the exact DDL to write — VERBATIM from researcher's draft:**

```sql
-- Source pattern: affiliates_schema.sql:36 — `status text not null ... check (status in ...)`
-- D-15 columns:
alter table public.affiliates
  add column tier text not null default 'standard'
    check (tier in ('standard','gold','lifetime'));
alter table public.affiliates add column tier_promoted_at timestamptz;
alter table public.affiliates add column tier_grantor_user_id uuid
  references auth.users(id) on delete set null;
alter table public.affiliates add column frozen_at timestamptz;
alter table public.affiliates add column freeze_reason text;

-- Partial index on tier='lifetime' for the recurring cron's hot path.
-- Pitfall 1 (reference_supabase_migration_gotchas): equality-to-literal is IMMUTABLE.
create index idx_affiliates_lifetime on public.affiliates(id)
  where tier = 'lifetime' and frozen_at is null;
```

**Key constraint:** NEVER use `create type ... as enum` — RESEARCH Pitfall 3 + Phase 19 precedent. Always `text not null check (...)` so future ALTER drop+readd works inside a single tx.

**Filename rule:** `<14-digit-ts>_affiliate_tier_schema.sql` — no letter-suffixes (`[[reference_supabase_migration_filename_regex]]`).

---

### `supabase/migrations/<ts>_affiliate_tier_stamp_trigger.sql` (D-19)

**Analog:** `supabase/migrations/20270101000005_insert_affiliate_impression_fn.sql` (SECURITY DEFINER + locked search_path)

**Pattern from RESEARCH §Pattern 2 (lines 374–427) — copy verbatim:**

```sql
create or replace function public.stamp_affiliate_conversion_tier()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_tier text;
  v_commission_pct numeric;
begin
  select tier into v_tier from public.affiliates where id = NEW.affiliate_id;
  if v_tier is null then
    raise exception 'affiliate % not found', NEW.affiliate_id;
  end if;
  NEW.tier_at_conversion_time := v_tier;

  v_commission_pct := case v_tier
    when 'standard' then 0.20
    when 'gold'     then 0.30
    when 'lifetime' then 0.25
    else 0.20
  end;

  if v_tier = 'lifetime' then
    NEW.recurring_commission_pct_basis := v_commission_pct * 100;
  end if;
  return NEW;
end
$$;

revoke all on function public.stamp_affiliate_conversion_tier() from public;

create trigger trg_affiliate_conversion_stamp
  before insert on public.affiliate_conversions
  for each row execute function public.stamp_affiliate_conversion_tier();
```

**Audit-cascade hygiene:** Migration MUST NOT set `app.suppress_audit` — trigger is data path, not admin action.

---

### `supabase/migrations/<ts>_affiliate_promotion_trigger.sql` (D-02, Pitfall 3)

**Analog:** `supabase/migrations/20270601000019_admin_affiliate_review_rpcs.sql:178-202` (audit_logs INSERT shape)

**Race-safe pattern from RESEARCH §Pitfall 3 (lines 631–640) — copy verbatim:**

```sql
create or replace function public.promote_standard_to_gold_on_paid()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, pg_catalog
as $$
declare
  v_count int;
  v_promoted int;
begin
  -- Only act when a row transitions INTO 'paid' (or 'confirmed' per chosen ratchet column).
  if NEW.status not in ('paid', 'confirmed') then
    return NEW;
  end if;
  select count(*) into v_count
    from public.affiliate_conversions
    where affiliate_id = NEW.affiliate_id and status in ('paid', 'confirmed');
  if v_count < 10 then return NEW; end if;

  -- Race-safe ratchet: WHERE tier='standard' makes second concurrent UPDATE a no-op.
  update public.affiliates
     set tier = 'gold', tier_promoted_at = now()
   where id = NEW.affiliate_id and tier = 'standard'
  returning 1 into v_promoted;

  if found then
    -- Audit-log shape lifted from 20270601000019:178-201
    insert into public.audit_logs (
      user_id, user_id_hash, table_name, row_id, action, target_user_id, metadata
    ) values (
      null,                              -- system promotion (no actor)
      encode(digest('system'::text, 'sha256'), 'hex'),
      'public.affiliates',
      NEW.affiliate_id::text,
      'affiliate_tier_auto_promoted',
      null,
      jsonb_build_object('to_tier', 'gold', 'paid_conversion_count', v_count)
    );
  end if;
  return NEW;
end
$$;

create trigger trg_affiliate_promote_gold
  after insert or update of status on public.affiliate_conversions
  for each row execute function public.promote_standard_to_gold_on_paid();
```

**Critical:** `WHERE tier = 'standard'` clause makes concurrent inserts at the N=10 boundary safe (Pitfall 3). Audit row only on `FOUND = true`.

---

### `supabase/migrations/<ts>_affiliate_ratio_baseline_mv.sql` (AFFTIER-05 / Pitfall 4)

**Analog:** `supabase/migrations/20270101000007_affiliate_click_baseline_mv.sql` — **lift-and-modify the entire file**

**Source pattern (lines 27–52 of the analog):**

```sql
create materialized view public.affiliate_click_baseline as
select
  affiliate_id,
  avg(daily_count)::numeric(10,2) as mean_clicks,
  stddev_samp(daily_count)::numeric(10,2) as stddev_clicks,
  ...
  count(*) as days_observed
from ( ... ) daily
group by affiliate_id;

-- Pitfall 5 load-bearing UNIQUE index for `REFRESH MATERIALIZED VIEW CONCURRENTLY`.
create unique index idx_click_baseline_affiliate
  on public.affiliate_click_baseline(affiliate_id);
```

**Modifications for Phase 26 (per RESEARCH §Pattern 4 lines 481–512):**
- Aggregate `clicks/impressions` ratio (not raw counts) via `full outer join` on `affiliate_impressions`.
- `nullif(impression_count, 0)` to avoid Pitfall 4 division-by-zero on cold-start.
- Hourly refresh cron at `'5 * * * *'` (offset from raw-count baseline at `0 1 * * *`).
- Coexists with `affiliate_click_baseline` — both flag-paths active (D-10).

---

### `supabase/migrations/<ts>_audit_logs_action_extend_p26.sql` (D-04, D-14)

**Analog:** `supabase/migrations/20270601000019_admin_affiliate_review_rpcs.sql:77-135` — **VERBATIM idiom**

**Source pattern (drop + re-add with FULL preserved list — lift-and-modify):**

```sql
alter table public.audit_logs
  drop constraint if exists audit_logs_action_check;

alter table public.audit_logs
  add constraint audit_logs_action_check check (
    action in (
      -- [PRESERVE every existing action from migrations 20260601000001, 20260801000000,
      --  20260901000001, 20270601000002, 20270601000019, AND any Phase 24/25 additions
      --  that land before Phase 26 — RESEARCH lines 533-536 warning]
      ...
      -- Phase 26 NEW (D-04 + D-14):
      'affiliate_tier_granted',
      'affiliate_tier_grant_reversed',
      'affiliate_tier_frozen',
      'affiliate_tier_unfrozen',
      'affiliate_anomaly_cleared',
      'affiliate_anomaly_fraud_confirmed',
      'affiliate_tier_auto_promoted'  -- from promotion trigger above
    )
  );
```

**Critical drift-check:** Per RESEARCH line 536: **read the live constraint via `supabase db query --linked` BEFORE writing this migration** to capture any actions added by Phase 22/24/25 that landed between the analog and Phase 26. Never overwrite.

---

### `supabase/migrations/<ts>_admin_tier_rpcs.sql` (D-04, D-14)

**Analog:** `supabase/migrations/20270601000019_admin_affiliate_review_rpcs.sql:145-203` — **VERBATIM SECDEF+suppress_audit shape per RPC**

**Source pattern (admin_approve_affiliate_conversion lines 145–203 — copy-modify 3×):**

```sql
create or replace function public.admin_grant_lifetime(p_affiliate_id uuid)
returns void
language plpgsql
security definer
set search_path = public, extensions, pg_catalog
as $$
declare
  v_caller uuid := auth.uid();
  v_prev_tier text;
begin
  if v_caller is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  if not public.is_staff() then raise exception 'forbidden' using errcode = '42501'; end if;
  -- TODO Phase 24 dependency: extend with `is_superadmin()` per D-04/CONTEXT P24 D-04
  --   (3-role model: staff/admin/superadmin). If Phase 24 not yet shipped at planning
  --   time, gate via env-var allowlist + leave TODO comment.

  select tier into v_prev_tier from public.affiliates where id = p_affiliate_id for update;
  if v_prev_tier is null then raise exception 'affiliate_not_found' using errcode = '22023'; end if;
  if v_prev_tier = 'lifetime' then return; end if;  -- idempotent
  if v_prev_tier = 'standard' then
    raise exception 'must_be_gold_first' using errcode = '22023';
  end if;

  perform set_config('app.suppress_audit', 'true', true);
  update public.affiliates
     set tier = 'lifetime',
         tier_promoted_at = now(),
         tier_grantor_user_id = v_caller
   where id = p_affiliate_id;

  insert into public.audit_logs (
    user_id, user_id_hash, table_name, row_id, action, target_user_id, metadata
  ) values (
    v_caller, encode(digest(v_caller::text, 'sha256'), 'hex'),
    'public.affiliates', p_affiliate_id::text,
    'affiliate_tier_granted', null,
    jsonb_build_object('from_tier', v_prev_tier, 'to_tier', 'lifetime')
  );
end;
$$;

revoke all on function public.admin_grant_lifetime(uuid) from public;
grant execute on function public.admin_grant_lifetime(uuid) to authenticated;
```

**Repeat shape for:** `admin_freeze_affiliate(p_affiliate_id, p_reason)`, `admin_unfreeze_affiliate(p_affiliate_id)`, `admin_reverse_lifetime_grant(p_affiliate_id)` (with Pitfall 5 dual-gate check — both 7d window AND no `affiliate_lifetime_recurring_payments` row), `admin_anomaly_review_decision(p_conversion_id, p_decision)`.

**Reverse-grant Pitfall 5 gate (RESEARCH lines 662–670 — VERBATIM):**

```sql
if exists (
  select 1 from public.affiliate_lifetime_recurring_payments
   where affiliate_id = p_affiliate_id
) or (now() - (select tier_promoted_at from public.affiliates where id = p_affiliate_id)) > interval '7 days'
then
  raise exception 'cannot_reverse_lifetime: payout already shipped or window expired';
end if;
```

---

### `supabase/migrations/<ts>_affiliate_lifetime_recurring_cron.sql` (D-08)

**Analog:** `supabase/migrations/20270101000012_payouts_materialization_and_cron.sql:92-108` — **VERBATIM lift**

**Source pattern (lines 92–108 of the analog):**

```sql
select cron.schedule(
  'affiliate-monthly-payout',
  '0 0 1 * *',
  $$
    select net.http_post(
      url := 'https://ytnsipxxmzgaebkqmokp.supabase.co/functions/v1/affiliate-payout',
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

**Modifications:** name = `'affiliate-lifetime-recurring'`, schedule = `'0 3 1 * *'` (RESEARCH §Pattern 3 — clear of all existing day-1 + 00:xx collisions), url = `…/functions/v1/affiliate-lifetime-recurring`, timeout = `120000`.

**Vault key already populated** in v1.2 P19 BL-7 — no new secret needed.

---

### `supabase/functions/affiliate-lifetime-recurring/index.ts` (AFFTIER-04)

**Analog:** `supabase/functions/affiliate-payout/index.ts` — **VERBATIM scaffolding (lines 33–118), domain-specific handler (lines 144–280)**

**Imports + pin (lines 33–37 of analog — copy verbatim):**

```typescript
import Stripe from 'https://esm.sh/stripe@19?target=denonext';
import { createClient } from 'npm:@supabase/supabase-js@2';
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

const getSupabaseUrl = () => Deno.env.get('SUPABASE_URL') ?? '';
const getSupabaseServiceRoleKey = () => Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const STRIPE_SECRET_KEY = () => Deno.env.get('STRIPE_SECRET_KEY') ?? '';
```

**Stripe + admin lazy singleton (lines 56–88 — copy verbatim):**

```typescript
let _stripeInstance: any = null;
function getStripe(): any {
  if (_stripeInstance === null) {
    _stripeInstance = new Stripe(STRIPE_SECRET_KEY(), {
      apiVersion: '2026-04-22.dahlia' as Parameters<typeof Stripe>[1]['apiVersion'],
      httpClient: Stripe.createFetchHttpClient(),
    });
  }
  return _stripeInstance;
}
// + admin Proxy at lines 81-88
```

**Pitfall 8 enforcement:** Pin `apiVersion: '2026-04-22.dahlia'` on EVERY new Stripe constructor in this phase (CI grep gate per RESEARCH).

**Constant-time bearer compare (lines 104–112 of analog — copy verbatim):**

```typescript
function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}
```

**Domain handler (Phase 26 NET-NEW logic — RESEARCH lines 233–257):**

```typescript
async function handleRun(_req: Request): Promise<Response> {
  // 1. SELECT subscriptions joined to lifetime affiliate_conversions
  // Pitfall 2: use subscriptions.status='active' (raw Stripe value), NOT ux_tier
  const { data: subs } = await admin
    .from('subscriptions')
    .select('id, plan_id, current_period_end, affiliate_conversions!inner(affiliate_id, tier_at_conversion_time, recurring_commission_pct_basis), affiliates!inner(id, frozen_at)')
    .eq('status', 'active')
    .eq('affiliate_conversions.tier_at_conversion_time', 'lifetime')
    .is('affiliates.frozen_at', null);

  const yyyymm = parseInt(new Date().toISOString().slice(0,7).replace('-',''), 10);

  for (const s of subs ?? []) {
    // 2. Compute commission_cents from current Stripe price × 25%
    const grossCents = /* from s.plan_id current price */;
    const commissionCents = Math.round(grossCents * 0.25);

    // 3. INSERT ON CONFLICT DO NOTHING (idempotency anchor — D-07)
    await admin.from('affiliate_lifetime_recurring_payments').insert({
      affiliate_id: aff.id,
      stripe_subscription_id: s.id,
      billing_period_yyyymm: yyyymm,
      gross_subscription_cents: grossCents,
      commission_cents: commissionCents,
      idempotency_key: `${aff.id}|${s.id}|${yyyymm}`,
    }, { count: 'exact' });
    // Postgres 23505 on duplicate = no-op (cron retry-safe)

    // 4. INSERT affiliate_conversions row (BEFORE INSERT trigger stamps tier+pct)
    // Synthetic invoice_id enforces idempotency at conversion layer too
    await admin.from('affiliate_conversions').insert({
      affiliate_id: aff.id,
      subscription_id: s.id,
      invoice_id: `lifetime_recurring_${aff.id}_${s.id}_${yyyymm}`,
      commission_cents: commissionCents,  // trigger respects caller-provided
      status: 'pending',
      eligible_at: new Date(Date.now() + 60 * 86400000).toISOString(),  // 60d chargeback hold
    });
  }
}
```

**PII safety (analog lines 247–251 — Phase 25 D-09 PHI lint):** Metadata SHALL ONLY be `{ payout_id, affiliate_id, leanshot_phase: '26' }` — no patient names, medications, emails.

---

### `supabase/functions/stripe-webhook/events/charge-refunded.ts` (D-06)

**Analog:** `supabase/functions/stripe-webhook/events/invoice-paid.ts` (event-handler shape)

**Imports + handler signature (lines 25–26, 70 of analog — copy verbatim):**

```typescript
import type Stripe from 'stripe';
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

export async function handle(event: Stripe.Event, admin: SupabaseClient): Promise<void> {
  const charge = event.data.object as Stripe.Charge;
  // Resolve back to affiliate_conversion via charge.invoice → subscription_id → conversion
  // ... claw-back logic per D-06:
  //   1. UPDATE affiliate_conversions SET status='clawback_pending' WHERE invoice_id=...
  //   2. INSERT/UPDATE payouts.adjustments jsonb (append negative entry)
}
```

**Adjustments jsonb shape (Pitfall 7 — pre-define `AdjustmentEntry` TS type):**

```typescript
// In src/lib/affiliate/types.ts — source-of-truth
export interface AdjustmentEntry {
  type: 'refund' | 'chargeback' | 'manual';  // CHECK-constrained set
  amount_cents: number;  // negative for claw-back
  reason: string;
  related_event_id: string;  // Stripe event.id
  created_at: string;  // ISO
}
```

**Dispatcher modification (`supabase/functions/stripe-webhook/index.ts:107-134`):** Append 2 new case arms inside existing switch:

```typescript
// After line 130 (default arm), insert:
case 'charge.refunded':
  await (await import('./events/charge-refunded.ts')).handle(event, admin);
  break;
case 'charge.dispute.created':
  await (await import('./events/charge-dispute-created.ts')).handle(event, admin);
  break;
```

**Pitfall 1 — HUMAN-UAT REQUIRED:** Stripe Dashboard must subscribe endpoint to these 2 event types (code change alone is necessary but insufficient). Verify via `stripe webhook_endpoints retrieve we_xxx` or CLI `stripe events list --types charge.refunded`.

---

### `src/lib/admin/affiliate-tier.ts` (NEW client wrapper)

**Analog:** `src/lib/admin/affiliate-review.ts` (lines 1–80) — **VERBATIM error-mapping + RPC dispatcher shape**

**Imports + error class (analog lines 1–34 — copy-modify):**

```typescript
import { supabase } from '@/lib/supabase';

export type AffiliateTierErrorCode =
  | 'not_staff' | 'not_authenticated' | 'not_found'
  | 'invalid_state' | 'must_be_gold_first' | 'cannot_reverse'
  | 'network' | 'unknown';

export class AffiliateTierError extends Error {
  code: AffiliateTierErrorCode;
  constructor(code: AffiliateTierErrorCode, options?: { cause?: unknown }) {
    super(`affiliate-tier:${code}`, options);
    this.name = 'AffiliateTierError';
    this.code = code;
  }
}
```

**RPC dispatcher (analog lines 66–80 — copy verbatim, swap RPC name set):**

```typescript
async function callTierRpc(
  rpcName:
    | 'admin_grant_lifetime'
    | 'admin_freeze_affiliate'
    | 'admin_unfreeze_affiliate'
    | 'admin_reverse_lifetime_grant'
    | 'admin_anomaly_review_decision',
  params: Record<string, unknown>,
): Promise<void> {
  try {
    const { error } = await supabase.rpc(rpcName, params);
    if (error) {
      throw new AffiliateTierError(mapRpcError(error as SupabaseRpcError), { cause: error });
    }
  } catch (e) {
    if (e instanceof AffiliateTierError) throw e;
    throw new AffiliateTierError('network', { cause: e });
  }
}
```

---

### `src/components/admin/AdminAffiliatesAnomalyTab.tsx` (D-11)

**Analog:** `src/components/admin/AdminAffiliatesReviewQueue.tsx` — **lift-and-modify entire file**

**Imports + RLS-contract comment (analog lines 21–42 — copy verbatim, adjust RPC import to `affiliate-tier.ts`):**

```typescript
import { Mail } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Pill, PillGroup } from '@/components/ui/Pill';
import { useToast } from '@/hooks/useToast';
import { AffiliateTierError, anomalyReviewDecision } from '@/lib/admin/affiliate-tier';
import { supabase } from '@/lib/supabase';
```

**Segmented filter pattern (analog lines 83–90 — copy-modify for anomaly states):**

```typescript
const ANOMALY_FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'flagged_pending', label: 'Pending review' },
  { key: 'cleared', label: 'Cleared' },
  { key: 'fraud_confirmed', label: 'Fraud confirmed' },
];
```

**Per-row actions (analog lines 92–102 STATUS_BADGE map — copy shape):**
- Show `anomaly_z_score` numerical badge + tier badge.
- Per-row actions: "Mark clear" (calls `admin_anomaly_review_decision('clear')`), "Confirm fraud" (calls `…'fraud_confirmed'` → triggers freeze + claw-back ledger).

**Lazy-loaded admin component shape:** Already routed by Phase 22 admin shell. New tab plugs in via `AdminAffiliatesReviewQueue` host (tabbed surface; per CONTEXT D-11 "Anomaly Review tab alongside existing Application Review tab").

---

### `src/components/landing/AffiliateLandingResolver.tsx` (MODIFY — AFFTIER-06 / Pitfall 6)

**Self (lines 37-41):** Append `gold` key + per Pitfall 6 add dev-mode assertion.

**Source pattern (analog lines 37–41 — copy with one-line addition):**

```typescript
const TEMPLATE_LOADERS = {
  coach:  () => import('./LandingTemplateCoach'),
  story:  () => import('./LandingTemplateStory'),
  method: () => import('./LandingTemplateMethod'),
  gold:   () => import('./LandingTemplateGold'),  // Phase 26 AFFTIER-06
} as const;
```

**Pitfall 6 — replace silent fallback (analog line 122):**

```typescript
// BEFORE (current):
const loader = TEMPLATE_LOADERS[choice] ?? TEMPLATE_LOADERS.coach;

// AFTER (Phase 26 — fail loud in dev):
const loader = TEMPLATE_LOADERS[choice];
if (!loader) {
  if (import.meta.env.DEV) {
    throw new Error(`AffiliateLandingResolver: no loader for template_choice='${choice}'`);
  }
  return lazy(TEMPLATE_LOADERS.coach);  // prod: graceful fallback
}
```

**Tier-based resolution:** SELECT clause at analog line 93 MUST be extended to include `tier`. Then post-fetch:

```typescript
const choice = affiliate.tier === 'gold' ? 'gold' : affiliate.template_choice;
```

---

### `src/components/landing/LandingTemplateGold.tsx` (NEW)

**Analog:** `src/components/landing/LandingTemplateCoach.tsx` (sibling template — same `AffiliatePublicRow` prop interface)

**Approach:** Clone Coach scaffolding (imports, prop interface re-export `AffiliatePublicRow`); apply premium-theme tokens per UI bundle (`var(--color-primary)` → premium gold accent). Single shared theme across all Gold partners (D-12).

---

### `e2e/affiliate-landing-gold.spec.ts` (NEW — AFFTIER-06 / D-13)

**No in-repo analog** — verified via grep (no existing `toHaveScreenshot` baselines in `e2e/*.spec.ts`).

**Pattern from RESEARCH §Pattern 7 lines 555–572 (Playwright `toHaveScreenshot`):**

```typescript
import { test, expect } from '@playwright/test';

test.describe('Affiliate landing tier variants', () => {
  test('Standard tier renders Coach template baseline', async ({ page }) => {
    await page.goto('/r/std-test-aff/landing');
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveScreenshot('landing-standard-coach.png', { fullPage: true });
  });

  test('Gold tier renders premium template baseline', async ({ page }) => {
    await page.goto('/r/gold-test-aff/landing');
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveScreenshot('landing-gold-premium.png', { fullPage: true });
  });
});
```

**Playwright config additions (`playwright.config.ts`):** Add `expect.toHaveScreenshot: { threshold: 0.2, maxDiffPixels: 100 }`.

**Fixture seeding:** Use `page.addInitScript` per `[[reference_playwright_state_seeding]]` — NEVER `page.goto + page.evaluate(seed) + reload` (races supabase-js INITIAL_SESSION per Pitfall list in RESEARCH line 587).

---

### `e2e/affiliate-tier-stamping.spec.ts` (NEW — AFFTIER-02 success criterion #1)

**Analog:** `e2e/rls-*.test.ts` family (vitest cross-tenant DB pattern per `[[feedback_realtime_layer_e2e_pattern]]`)

**Pattern (RESEARCH lines 429–435 — DB-invariant assertion, NOT UI traversal):**

1. INSERT affiliate with `tier='standard'`
2. INSERT 5 `affiliate_conversions` (trigger stamps `tier_at_conversion_time='standard'`)
3. `UPDATE affiliates SET tier='gold' WHERE id=X`
4. INSERT 5 more conversions (stamp `'gold'`)
5. `SELECT *` from conversions — assert first 5 still have `tier_at_conversion_time='standard'`, second 5 have `'gold'`

**Per-file slug-prefix rule:** Use `const TEST_SLUG_PREFIX = '26-tier-stamp-' + Date.now()` file-scoped (NEVER shared) per `[[feedback_rls_per_file_slug_prefix]]`.

---

### `src/lib/affiliate/api.ts` (MODIFY — AFFTIER-03)

**Self analog:** lines 79+ `fetchAffiliateStats` — extend pattern.

**New exports to add (mirror existing fetcher shape):**

```typescript
export interface TierProgress {
  currentTier: 'standard' | 'gold' | 'lifetime';
  paidConversionCount: number;
  nextTierThreshold: number | null;   // 10 for standard→gold; null for gold/lifetime
  frozenAt: string | null;
  freezeReason: string | null;
}

export interface TierEarningsBreakdown {
  asStandardCents: number;
  asGoldCents: number;
  asLifetimeCents: number;
  totalCents: number;
}

export async function getTierProgress(
  affiliateId: string,
  client: SupabaseClient,
): Promise<TierProgress> { /* SELECT from affiliates + count(*) from affiliate_conversions */ }

export async function getTierEarningsBreakdown(
  affiliateId: string,
  client: SupabaseClient,
): Promise<TierEarningsBreakdown> { /* GROUP BY tier_at_conversion_time */ }
```

---

## Shared Patterns

### Pattern A: SECDEF Admin RPC Skeleton (Pattern S1 dual-layer)

**Source:** `supabase/migrations/20270601000019_admin_affiliate_review_rpcs.sql:145-203`
**Apply to:** All 5 new admin RPCs in `<ts>_admin_tier_rpcs.sql`

```sql
create or replace function public.admin_<verb>_<noun>(...)
returns void
language plpgsql
security definer
set search_path = public, extensions, pg_catalog
as $$
declare v_caller uuid := auth.uid();
begin
  if v_caller is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  if not public.is_staff() then raise exception 'forbidden' using errcode = '42501'; end if;
  -- TODO: extend to is_superadmin() once Phase 24 D-04 enum lands

  perform set_config('app.suppress_audit', 'true', true);  -- prevent double-audit
  -- ... mutation ...
  insert into public.audit_logs (...) values (..., '<action_enum>', ...);
end;
$$;

revoke all on function public.admin_<verb>_<noun>(...) from public;
grant execute on function public.admin_<verb>_<noun>(...) to authenticated;
```

### Pattern B: Stripe Webhook Handler Skeleton

**Source:** `supabase/functions/stripe-webhook/events/invoice-paid.ts:25-26, 70`
**Apply to:** `charge-refunded.ts`, `charge-dispute-created.ts`

```typescript
import type Stripe from 'stripe';
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

export async function handle(event: Stripe.Event, admin: SupabaseClient): Promise<void> {
  const obj = event.data.object as Stripe.Charge;
  // ... mutation; idempotency via subscription_events.event_id UNIQUE (already enforced
  //     in dispatcher at supabase/functions/stripe-webhook/index.ts:188-204)
  // ... PII-safe logging: log only { event_id, charge_id, affiliate_id } — never full payload
}
```

### Pattern C: Cron Edge Function Auth (constant-time bearer)

**Source:** `supabase/functions/affiliate-payout/index.ts:104-118`
**Apply to:** `affiliate-lifetime-recurring/index.ts`

Constant-time compare against `Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')`; bearer arrives via pg_cron `net.http_post` reading from `vault.decrypted_secrets`.

### Pattern D: Lazy-Singleton Test-Injectable Stripe + Admin Client

**Source:** `supabase/functions/affiliate-payout/index.ts:56-88`
**Apply to:** `affiliate-lifetime-recurring/index.ts`

Module-level lazy singletons (NEVER module-load reads of `Deno.env`); test seam via `__internal.setStripeForTest` / `setAdminForTest`. Reuse the `Proxy` wrapper at lines 81–88 verbatim so `__setAdminForTest` works after import.

### Pattern E: CHECK Constraint Drop-and-Readd Idiom

**Source:** `supabase/migrations/20270601000019_admin_affiliate_review_rpcs.sql:61-67, 77-135`
**Apply to:** `<ts>_audit_logs_action_extend_p26.sql` AND `<ts>_affiliate_conversions_tier_stamp_alter.sql` (if extending any existing CHECK).

Always: `drop constraint if exists ...` → `add constraint ... check (... in (FULL_PRESERVED_LIST + NEW_VALUES))`. Drift-check live constraint via `supabase db query --linked` first.

### Pattern F: Per-Tab Composition in Existing Admin Page

**Source:** `src/components/admin/AdminAffiliatesReviewQueue.tsx` (existing single-tab queue)
**Apply to:** Modified `AdminAffiliatesReviewQueue.tsx` (now host) + new tabs `AdminAffiliatesAnomalyTab.tsx` + `AdminAffiliatesTierTab.tsx`

Lift `<Pill>` segmented filter pattern (analog lines 83–90) per tab. Wrap existing queue body in a tab-host that toggles between Application Review / Anomaly Review / Tier Management.

### Pattern G: PII-Safe Stripe Metadata

**Source:** `supabase/functions/affiliate-payout/index.ts:247-251`
**Apply to:** Every Stripe `transfers.create` and `metadata` write in this phase.

```typescript
metadata: { payout_id: p.id, affiliate_id: p.affiliate_id, leanshot_phase: '26' }
// NEVER include: patient names, medications, emails, doses, weights, MRNs.
```

### Pattern H: PostHog `await client.shutdown()` (if any new server-side event)

**Source:** RESEARCH PITFALLS (carry-forward from Phase 24).
**Apply to:** Any Edge Function emitting a PostHog event. Not currently planned for Phase 26 but BLOCKER-grade if added.

---

## No Analog Found

| File | Role | Data Flow | Reason / Mitigation |
|------|------|-----------|---------------------|
| `e2e/affiliate-landing-gold.spec.ts` | Playwright snapshot spec | screenshot diff | Repo has zero existing `toHaveScreenshot` baselines (verified via grep). NET-NEW CI infrastructure. Follow RESEARCH §Pattern 7 verbatim — add `expect.toHaveScreenshot` config to `playwright.config.ts`, commit baselines under `e2e/affiliate-landing-gold.spec.ts-snapshots/`. |
| `src/lib/affiliate/tier-config.ts` | constants table | pure | D-01 commission-rate table is canonical NEW data. Suggested shape: `export const TIER_COMMISSION_PCT = { standard: 0.20, gold: 0.30, lifetime: 0.25 } as const;` — single source of truth referenced by BOTH the Postgres trigger (hard-coded — see Pattern 2 above) AND the client UI (`PartnerTierEarningsBreakdown.tsx`). Plan-checker should BLOCKER any divergence between SQL `case v_tier when ...` and this TS constant. |

---

## Metadata

**Analog search scope:**
- `/Users/karstenhaldan/minisite/supabase/migrations/` (all 100+ migrations; focused on `*affiliate*`, `*audit*`, `*payouts*`)
- `/Users/karstenhaldan/minisite/supabase/functions/` (affiliate-payout, stripe-webhook + events/, affiliate-attribute, affiliate-impression)
- `/Users/karstenhaldan/minisite/leanshot/src/components/admin/` (AdminAffiliatesReviewQueue, AdminAffiliatesScaffold, AdminAffiliatesPage)
- `/Users/karstenhaldan/minisite/leanshot/src/components/partner/` (PartnerDashboard, PartnerKpiCard, PartnerTrendChart, PartnerLayout)
- `/Users/karstenhaldan/minisite/leanshot/src/components/landing/` (AffiliateLandingResolver + 3 template variants)
- `/Users/karstenhaldan/minisite/leanshot/src/lib/admin/` (affiliate-review.ts — primary RPC-wrapper analog)
- `/Users/karstenhaldan/minisite/leanshot/src/lib/affiliate/` (api.ts — data layer extension target)
- `/Users/karstenhaldan/minisite/leanshot/e2e/` (Playwright config + spec inventory)

**Files scanned:** ~30 (focused per role match)
**Pattern extraction date:** 2026-05-17

---

## Key Patterns Identified (planner audit checklist)

1. **CHECK-constraint enums everywhere** — Phase 19 + 22 + 26 all use `text not null check (...)`. No Postgres `create type enum`. Drift-check live constraint before extending.
2. **SECDEF + `app.suppress_audit` GUC + explicit audit_logs INSERT** — locked from Phase 22 idiom; copy-modify per RPC. Plan-checker BLOCKERs missing GUC.
3. **`stripe.transfers.create` with explicit `apiVersion: '2026-04-22.dahlia'`** — Pitfall 8; CI grep enforces. NEVER let Stripe constructor default the version.
4. **Lazy-singleton + Proxy admin client** — Phase 19 affiliate-payout pattern; test seam via `__setAdminForTest`. Mandatory for every cron Edge Fn.
5. **`page.addInitScript` for Playwright Supabase seeding** — NEVER `page.goto + evaluate + reload` (races INITIAL_SESSION).
6. **Race-safe ratchet via `WHERE tier='standard'`** — Pitfall 3; second concurrent UPDATE becomes no-op + audit only on `FOUND`.
7. **Idempotency-key UNIQUE constraint + ON CONFLICT DO NOTHING** — cron retry-safe pattern from `subscription_events.event_id` (Phase 14). Phase 26 anchor: `(affiliate_id, subscription_id, billing_period_yyyymm)`.
8. **`subscriptions.status='active'` NOT `ux_tier='paid'`** — Pitfall 2; raw Stripe enum has 8 values, UX tier collapses to 3. Lifetime cron filters on `status`.
9. **PII-safe Stripe metadata** — fixed schema `{ payout_id, affiliate_id, leanshot_phase: '26' }`. Phase 25 D-09 PHI lint.
10. **`nullif(impression_count, 0)`** in ratio matview — Pitfall 4 division-by-zero on cold-start affiliates.
