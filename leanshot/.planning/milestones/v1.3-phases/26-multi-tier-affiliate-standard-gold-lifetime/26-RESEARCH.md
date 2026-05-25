# Phase 26: Multi-Tier Affiliate (Standard / Gold / Lifetime) — Research

**Researched:** 2026-05-17
**Domain:** Tier-stamped commission accounting + recurring Stripe Connect transfers + Z-score-ratio anomaly detection
**Confidence:** HIGH on existing v1.2 Phase 19 schema/code (read directly) · HIGH on cron landscape (queried live Supabase) · HIGH on Stripe webhook event surface (read existing dispatcher) · MEDIUM on 2026 SaaS affiliate-rate market band (single-source confidence) · LOW on Stripe `transfers.create` claw-back via *negative* transfer (no recent vendor verification this session)

## Summary

Phase 26 grafts three layers onto the already-shipped v1.2 Phase 19 affiliate program:

1. **Tier accounting** — a `tier` enum on `affiliates` + a BEFORE INSERT trigger on `affiliate_conversions` that *stamps* `tier_at_conversion_time` and `commission_cents` at insert time. The stamp is locked-once-written so retroactive tier upgrades NEVER mutate historical conversions (success criterion #1).

2. **Lifetime recurring payouts** — a monthly cron Edge Function (`affiliate-lifetime-recurring`) that walks Lifetime-tier affiliates × their *still-active* attributed Stripe subscriptions and writes an `affiliate_conversions` row tagged `recurring=true` for the new billing period. The existing v1.2 cron chain (confirm → materialize → monthly transfer via `stripe.transfers.create`) then pays it out on the next cycle. No new Stripe Connect platform; no new payouts pipeline.

3. **Click-rate Z-score** — extends the v1.2 raw-count Z-score (live in `affiliate-attribute` Edge Function + `affiliate_click_baseline` materialized view) with an **impressions/clicks ratio** detector. Pay normally on flag; surface in new `/admin/affiliates/anomaly-review` tab; superadmin confirm-fraud claws back via a negative `payouts.adjustments` row + freezes the tier.

**Primary recommendation:** Build on `payouts` (Phase 19's existing table name — NOT `affiliate_payouts`), reuse `stripe.transfers.create` with idempotency keys (Phase 19 pattern), and EXTEND `audit_logs.action` CHECK constraint following the exact drop-and-readd idiom from Phase 22 `20270601000019_admin_affiliate_review_rpcs.sql`. The single net-new Stripe webhook subscription is `charge.refunded` + `charge.dispute.created` (currently not handled).

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Tier enum + tier_promoted_at | Database (Postgres) | — | Volume-promotion is a query — `COUNT conversions WHERE status='paid'` — and ratchet ownership belongs to the row of truth (D-03 locked) |
| Tier stamping at conversion insert | Database (BEFORE INSERT trigger) | — | Only way to guarantee atomic stamp + zero retroactivity (success criterion #1) |
| Standard → Gold auto-promotion | Database (trigger AFTER UPDATE on conversions, or pg_cron daily eval) | — | Must run server-side; can't trust client. Trigger preferred for immediacy |
| Gold → Lifetime admin grant | API / Edge Function (RPC) | UI (Admin panel) | Single-approver superadmin action; needs audit log + reversibility window |
| Lifetime recurring payout calculation | Database (cron-invoked Edge Fn) | — | Monthly batch; pay-tracks-Stripe-active query is SQL-heavy |
| Stripe Connect transfer | API / Backend (Edge Function) | — | Existing v1.2 pattern in `affiliate-payout/index.ts` |
| Refund/chargeback claw-back | API / Backend (stripe-webhook handler) | — | Stripe-event-driven; reuse existing v1.2 webhook dispatcher (extend with 2 new event handlers) |
| Anomaly Z-score (ratio) | Database (matview) + API (Edge Fn flag write) | — | Mirrors v1.2 `affiliate_click_baseline` matview pattern; flag insertion is a service-role write |
| Tier-progress UI | Frontend (React component in /partner) | API (read-only RPC `get_tier_progress`) | Composition of existing v1.2 `PartnerDashboard` widgets |
| Gold landing template variant | Frontend (AffiliateLandingResolver template loader) | Database (template_choice override row in `landing_pages` seed) | Phase 19 resolver already lazy-loads template by `template_choice` — add `gold` to TEMPLATE_LOADERS |
| Per-tier screenshot regression | CI (Playwright `toHaveScreenshot`) | — | Net-new — no `toHaveScreenshot` baselines exist in repo yet |

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Commission rates + threshold**
- **D-01** — Commission rates: Standard 20% / Gold 30% / Lifetime 25% monthly recurring. Math on $12.99/mo Pro: Std = $2.60 one-time per conv; Gold = $3.90; Lifetime = $3.25/mo recurring. Math on $132.49/yr annual: Std = $26.50; Gold = $39.75; Lifetime = ~$2.76/mo recurring amortized.
- **D-02** — Standard → Gold auto-promotion threshold N = 10 paid conversions. NOT tunable in admin (defer to admin_settings only if first deal demands flexibility).

**Tier ratchet + removal**
- **D-03** — Promotion-only ratchet — never volume-downgrade. Locked-once-earned (REQ AFFTIER-01).
- **D-04** — Tier removal trigger = fraud-freeze ONLY (superadmin manual via /admin/affiliates). Anomaly review + freeze (commission stops on new conversions; existing approved paid normally; partner dashboard shows `Frozen` + appeal CTA). Audit-logged. REVERSIBLE. No auto-freeze. No Lifetime revocation in v1.3.

**Lifetime recurring cron — subscriber lifecycle**
- **D-05** — Pay-tracks-Stripe-active. `affiliate-lifetime-recurring` cron (monthly, day-1 03:00 UTC) queries `subscriptions` where `status='active'` AND linked-conversion's `tier_at_conversion_time='lifetime'`. Skip everything else. Resub-after-cancel = NEW conversion subject to fresh attribution.
- **D-06** — Commission tracks current $; refunds claw back; chargebacks claw back + freeze review.
- **D-07** — Idempotency key per `(affiliate_id, subscription_id, billing_period_yyyymm)`.
- **D-08** — Pay-out batched into existing v1.2 Stripe Connect payout schedule. Reuse `payouts` table + Stripe Connect Express transfers; add `recurring_payout_kind` enum column.

**Anomaly detection**
- **D-09** — Z-score >3σ on 7-day click-rate baseline (impressions/clicks ratio) → "pay + flag + admin review queue" policy. 7-day review SLA.
- **D-10** — Extends v1.2 AFF-08 (does not replace).
- **D-11** — Anomaly review queue surfaces in /admin/affiliates module (Phase 24 manifest entry). New "Anomaly Review" tab alongside existing "Application Review".

**Gold landing template**
- **D-12** — Shared "premium" theme variant for all Gold partners in v1.3. AffiliateLandingResolver branches on partner.tier → resolves to `/r/[code]/landing-gold` template variant.
- **D-13** — Playwright screenshot diff per tier-variant baked into CI.

**Gold → Lifetime admin grant**
- **D-14** — Superadmin single-approver grant; audit-logged; reversible until first recurring payout. /admin/affiliates UI "Grant Lifetime" button. REVERSIBLE within 7-day window OR until first `affiliate-lifetime-recurring` payout writes a row.

**Schema additions (planner discretion on exact DDL)**
- **D-15** — `affiliates` ALTER: add `tier`, `tier_promoted_at`, `tier_grantor_user_id`, `frozen_at`, `freeze_reason`.
- **D-16** — `affiliate_conversions` ALTER: add `tier_at_conversion_time`, `recurring_commission_pct_basis`, `anomaly_flagged`, `anomaly_z_score`, `anomaly_reviewed_at`, `anomaly_review_decision`.
- **D-17** — `affiliate_lifetime_recurring_payments` NEW table per D-07 idempotency.
- **D-18** — `affiliate_fraud_signals` NEW table.
- **D-19** — Tier-stamping enforced by Postgres trigger at `affiliate_conversions` BEFORE INSERT.

### Claude's Discretion
- Exact DDL syntax for tier enum + ALTER ordering.
- Whether `affiliate_lifetime_recurring_payments` is a separate table or extends `payouts` with `recurring_payout_kind`.
- Exact pg_cron schedule for `affiliate-lifetime-recurring` (CONTEXT recommends day-1 03:00 UTC).
- Anomaly Z-score sliding-window implementation (materialized view refresh hourly OR per-query at flag-time).
- Exact UI primitives for tier-progress bar (reuse existing v1.2 components where possible).
- Whether Stripe-event-driven claw back uses webhook handler or polls — RECOMMEND webhook.

### Deferred Ideas (OUT OF SCOPE)
- Lifetime revocation (not just freeze) — v1.4+
- Auto-suspend on 5 consecutive flagged conversions
- Tunable threshold N per cohort (admin_settings)
- Pay-on-LeanShot-usage (instead of Stripe-active)
- 30-day pause grace for Lifetime recurring
- Per-partner Gold branding (logo + accent color) — Lifetime tier or v1.5
- Lifetime full white-label landing — v1.5
- Two-superadmin approval for Lifetime grant — defer until staff > 5
- MLM / multi-level affiliate — anti-feature, never
- Bandit auto-shifting tier thresholds — anti-feature, never
- Recurring commission on yearly subscribers' renewal day vs amortized monthly — chose amortized monthly per D-06
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| AFFTIER-01 | Tiered commissions (Standard/Gold/Lifetime) with volume-threshold + admin-grant promotion; locked-once-earned | §Architecture Pattern 1 (tier enum + ratchet trigger); §Pattern 5 (admin grant RPC) |
| AFFTIER-02 | Every new conversion row stamps `tier_at_conversion_time` + `commission_cents` at insert; NEVER recomputed retroactively | §Architecture Pattern 2 (BEFORE INSERT trigger stamping); §Code Examples — Pattern 2 |
| AFFTIER-03 | Partner dashboard shows tier-progress bar + per-tier earnings breakdown + next-tier thresholds | §Reusable Assets (`fetchAffiliateStats` extension); §Code Examples — Pattern 4 |
| AFFTIER-04 | Lifetime affiliates receive monthly recurring commissions via `affiliate-lifetime-recurring` cron Edge Fn until subscriber cancels | §Architecture Pattern 3 (recurring cron); §Existing Stripe Webhook Surface |
| AFFTIER-05 | Click-rate anomaly detector (impressions/clicks ratio Z-score >3σ on 7-day baseline) flags to admin queue; extends v1.2 AFF-08 | §Architecture Pattern 6 (ratio matview); §Existing AFF-08 implementation |
| AFFTIER-06 | Co-branded `/r/{code}/landing` template selection by tier (Gold gets premium template); reuses Phase 19 AffiliateLandingResolver | §Reusable Assets (`AffiliateLandingResolver.tsx` TEMPLATE_LOADERS); §Pattern 7 (Playwright snapshot baseline) |
</phase_requirements>

## Standard Stack

### Core (already in repo — verified)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `stripe` (Deno via esm.sh) | `19.x` pinned `https://esm.sh/stripe@19?target=denonext` | Stripe Connect transfers + webhook signature verify | v1.2 Phase 14 + 19 lock — DO NOT bump major in Phase 26 [VERIFIED: `supabase/functions/affiliate-payout/index.ts:33`] |
| Stripe API version | `2026-04-22.dahlia` | Pinned on all Stripe SDK constructors | v1.2 lock; same on this phase's net-new event handlers [VERIFIED: `affiliate-payout/index.ts:61`] |
| `npm:@supabase/supabase-js` | `2.x` | Edge Function admin client (lazy singleton pattern) | v1.2 pattern; reuse `__setAdminForTest` seam [VERIFIED: `affiliate-payout/index.ts:34`] |
| `pg_cron` (Supabase extension) | platform-managed | Monthly + daily schedules | Already in production with 4 affiliate jobs registered [VERIFIED: live `cron.job` query] |
| `pgcrypto` | platform-managed | Used by audit_trigger() | Loaded in `20260601000001_audit_logs.sql:41` [VERIFIED] |
| `@tanstack/react-query` | `5.100.10` | New surfaces (anomaly-review table, tier-progress dashboard) | v1.3 STACK recommendation; admin-route gated via `sync-defer.ts` [CITED: `.planning/research/STACK.md:36`] |
| `@tanstack/react-table` | `8.x` | Anomaly-review table (paginated, sortable) | v1.3 STACK recommendation [CITED: STACK.md:37] |

### Supporting (no new deps needed)

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `chart.js` | `^4.4.6` (already in v1) | Tier-progress bar OR per-tier earnings bar chart | Reuse existing `BaseChart.tsx` wrapper [VERIFIED: `leanshot/CLAUDE.md`] |
| `react-hook-form` | `^7.75.0` (already in repo) | Anomaly-review decision form (clear/fraud_confirmed) | v1.2 carry-forward [CITED: STACK.md:38] |
| `nanoid` | `5.1.6` (in v1.3 STACK) | Anomaly-signal payload short IDs if needed | Optional — `gen_random_uuid()` is fine for new tables |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Postgres trigger for tier stamping | App-layer write in `invoice-paid.ts` | App-layer is racey + bypassable; trigger is atomic + RLS-invisible (D-19 locked) |
| Materialized view refresh for ratio Z-score | LATERAL subquery at flag time | Matview matches v1.2 Phase 19 pattern (`affiliate_click_baseline`); refresh-on-cron amortizes cost. RECOMMEND matview. |
| Separate `affiliate_lifetime_recurring_payments` table | Reuse `payouts` with `recurring_payout_kind` column | CONTEXT D-08 hints at the column-add path but D-17 specifies separate table. **Recommend: do BOTH — separate ledger table for the recurring-conversion accounting per-period; existing `payouts` rolls up the cents at materialize time. The recurring table is the idempotency anchor (D-07).** |
| Negative `transfers.create` for refund claw-back | Negative-row in a `payouts.adjustments` jsonb column (D-06) | Negative transfer = direct Stripe API call (debits affiliate's balance); jsonb adjustment = ledger-only (net out in next payout). **Recommend ledger-only — simpler, no extra Stripe surface, matches IRS 1099 reporting where gross-paid is the number that ships on the form.** [ASSUMED — verify with accounting if Lifetime claw-back volume becomes material] |

**Installation:** No new npm dependencies required. All new behavior ships via:
- New SQL migrations (5 files — schema ALTER + trigger + new tables + matview + cron)
- New Edge Functions (`affiliate-lifetime-recurring` + extension of `stripe-webhook` dispatcher)
- Extension of existing client modules (`AdminAffiliatesReviewQueue.tsx`, `AffiliateLandingResolver.tsx`, `partner-dashboard.tsx`)

**Version verification:** No new packages added; verification step is N/A. Existing pinned versions confirmed in `affiliate-payout/index.ts` and `package.json`.

## Architecture Patterns

### System Architecture Diagram

```
┌────────────────────────────────────────────────────────────────────────────────┐
│                            EXISTING v1.2 PHASE 19 FLOW                         │
│                            (DO NOT REWIRE — EXTEND ONLY)                       │
└────────────────────────────────────────────────────────────────────────────────┘

 Visitor /r/{code}                    Visitor /r/{code}/landing
       │                                       │
       ▼                                       ▼
 affiliate-attribute   ◄────  Z-score check  ──►  affiliate_click_baseline (matview)
       │  (Edge Fn)                  │              ▲
       │                             │              │ refresh 0 1 * * * UTC
       ├─► affiliate_clicks INSERT   │           (existing cron)
       │                             ▼
       └─► Set-Cookie _aff           [PHASE 26 ADDS RATIO Z-SCORE LAYER HERE]
                                             │
                                             ▼
                                     affiliate_impressions  ───►  affiliate_ratio_baseline (NEW matview)
                                                                       │
                                                                       │ refresh hourly
                                                                       ▼
                                                              [flag_anomaly write to
                                                              affiliate_conversions
                                                              + affiliate_fraud_signals]

 Stripe invoice.paid webhook
       │
       ▼
 stripe-webhook (Edge Fn) ──► events/invoice-paid.ts ──► subscriptions UPDATE
                                                            │
                                                            ▼
                                              affiliate_conversions INSERT
                                                            │
                          ┌─────────────────────────────────┤
                          ▼                                 │
              [PHASE 26 BEFORE INSERT TRIGGER]              │
              stamp_tier_at_conversion_time()               │
              · reads affiliates.tier                       │
              · computes commission_cents from D-01 table   │
              · sets tier_at_conversion_time + commission   │
                          │                                 │
                          ▼                                 │
              affiliate_conversions row INSERTED            │
              with tier_at_conversion_time STAMPED          │
                          │                                 │
                          │      ┌──────────────────────────┘
                          │      │
                          │      ▼
                          │  [PHASE 26 AFTER INSERT TRIGGER]
                          │  check_standard_to_gold_promotion()
                          │  · count paid conversions
                          │  · if >= N=10 AND tier='standard'
                          │    → UPDATE affiliates SET tier='gold',
                          │      tier_promoted_at=now()
                          │  · INSERT audit_logs row
                          │
                          │
 ┌────────────────────────┴─────────────────────────────────┐
 ▼                                                          ▼
00:15 UTC affiliate-conversions-confirm                  Stripe charge.refunded
        (existing cron — pending → confirmed)            Stripe charge.dispute.created
                          │                                        │
                          ▼                                        ▼
00:30 UTC affiliate-payouts-materialize          [PHASE 26 NEW HANDLERS]
        (existing cron — roll into payouts)              events/charge-refunded.ts
                          │                              events/charge-dispute-created.ts
                          ▼                                        │
00:00 day-1 affiliate-monthly-payout                              │
        (existing cron — stripe.transfers.create)                 ▼
                                                          UPDATE affiliate_conversions
                                                          SET status='clawback_pending'
                                                          INSERT payouts.adjustments
                                                            (negative row)
                                                          INSERT affiliate_fraud_signals
                                                            (for dispute only)
                                                          [if dispute → set affiliates.frozen_at?
                                                           NO — defer to superadmin review
                                                           per D-04]

┌────────────────────────────────────────────────────────────────────────────────┐
│                         PHASE 26 NET-NEW LIFETIME LANE                         │
└────────────────────────────────────────────────────────────────────────────────┘

03:00 UTC day-1 affiliate-lifetime-recurring (NEW cron Edge Fn)
        │
        │ 1. SELECT subscriptions s
        │    JOIN affiliate_conversions ac ON ac.subscription_id = s.id
        │    JOIN affiliates a ON a.id = ac.affiliate_id
        │    WHERE s.status = 'active'
        │      AND ac.tier_at_conversion_time = 'lifetime'
        │      AND a.frozen_at IS NULL
        │
        │ 2. For each row, compute commission_cents from current Stripe price × 25%
        │    (read price from s.plan_id / subscriptions.plan_id snapshot)
        │
        │ 3. INSERT affiliate_lifetime_recurring_payments
        │    ON CONFLICT (idempotency_key) DO NOTHING
        │      (key = affiliate_id || '|' || subscription_id || '|' || YYYYMM)
        │
        │ 4. INSERT affiliate_conversions row:
        │      status='pending', eligible_at=now()+60d (D-06 chargeback hold),
        │      tier_at_conversion_time='lifetime' (stamped by trigger),
        │      commission_cents=computed, subscription_id=s.id,
        │      invoice_id='lifetime_recurring_' || affiliate_id || '_' || sub || '_' || YYYYMM
        │      (synthetic; UNIQUE constraint enforces idempotency at this layer too)
        │
        ▼
 [Existing cron chain picks them up next month — confirm → materialize → transfer]


┌────────────────────────────────────────────────────────────────────────────────┐
│                         PHASE 26 ADMIN UI LAYER                                │
└────────────────────────────────────────────────────────────────────────────────┘

/admin/affiliates (existing P24 module manifest entry)
  ├── Application Review tab    (existing v1.2 AdminAffiliatesReviewQueue.tsx)
  ├── Anomaly Review tab        (NEW — reads affiliate_conversions WHERE anomaly_flagged=true)
  └── Tier Management surface   (NEW — Gold/Lifetime grant + freeze actions)
                                  │
                                  ▼
                          admin_grant_lifetime() RPC (SECURITY DEFINER)
                          admin_freeze_affiliate() RPC
                          admin_anomaly_review_decision() RPC
                                  │
                                  ▼
                          audit_logs INSERT
                          (action enum EXTENDED per Phase 22 idiom)

/partner/dashboard (existing v1.2 PartnerDashboard.tsx)
  └── Tier-progress block       (NEW — tier-progress bar + per-tier earnings breakdown)
        reads from affiliates.tier + getTierProgress(affiliate_id) RPC
```

### Recommended Project Structure

```
supabase/migrations/
├── 20270701000001_affiliate_tier_schema.sql           # D-15 + D-16 ALTERs
├── 20270701000002_affiliate_tier_stamp_trigger.sql    # D-19 BEFORE INSERT trigger
├── 20270701000003_affiliate_promotion_trigger.sql     # Standard → Gold AFTER INSERT
├── 20270701000004_affiliate_lifetime_recurring_table.sql  # D-17 new table
├── 20270701000005_affiliate_fraud_signals_table.sql   # D-18 new table
├── 20270701000006_affiliate_ratio_baseline_mv.sql     # AFFTIER-05 matview + refresh cron
├── 20270701000007_audit_logs_action_extend.sql        # Phase 22 idiom — add 6 new action values
├── 20270701000008_admin_tier_rpcs.sql                 # admin_grant_lifetime / freeze / anomaly_review
├── 20270701000009_payouts_adjustments_column.sql      # D-06 — add jsonb adjustments to payouts
├── 20270701000010_affiliate_lifetime_recurring_cron.sql # 03:00 UTC day-1 schedule
└── 20270701000011_landing_gold_template_seed.sql      # AFFTIER-06 4th template row

supabase/functions/
├── affiliate-lifetime-recurring/         # NEW Edge Fn (mirrors affiliate-payout/ shape)
│   ├── deno.json
│   ├── index.ts
│   └── index.test.ts
└── stripe-webhook/events/
    ├── charge-refunded.ts                # NEW handler — claw back via payouts.adjustments
    ├── charge-refunded.test.ts
    ├── charge-dispute-created.ts         # NEW handler — claw back + fraud_signals row
    └── charge-dispute-created.test.ts

src/
├── lib/affiliate/
│   ├── api.ts                             # EXTEND — add getTierProgress, getTierEarnings
│   ├── tier-config.ts                     # NEW — D-01 commission rates table (single source of truth)
│   └── __tests__/
├── lib/admin/
│   ├── affiliate-tier.ts                  # NEW — grantLifetime/freeze/anomalyReview client wrappers
│   └── affiliate-review.ts                # EXTEND with anomaly-review actions
├── components/admin/
│   ├── AdminAffiliatesAnomalyTab.tsx      # NEW
│   ├── AdminAffiliatesTierTab.tsx         # NEW — Grant Lifetime button + freeze action
│   └── AdminAffiliatesReviewQueue.tsx     # EXTEND for tab compatibility
├── components/partner/
│   ├── PartnerTierProgress.tsx            # NEW — tier-progress bar
│   ├── PartnerTierEarningsBreakdown.tsx   # NEW — per-tier earnings
│   └── PartnerDashboard.tsx               # EXTEND to mount the 2 above
├── components/landing/
│   ├── AffiliateLandingResolver.tsx       # EXTEND TEMPLATE_LOADERS with 'gold'
│   └── LandingTemplateGold.tsx            # NEW — premium variant (clones Coach + premium tokens)
└── routes/landing-routes.ts               # unchanged

e2e/
├── affiliate-tier-stamping.spec.ts        # AFFTIER-02 — vitest cross-tenant + DB invariant
├── affiliate-landing-gold.spec.ts         # AFFTIER-06 Playwright toHaveScreenshot baseline
├── affiliate-tier-promotion.spec.ts       # AFFTIER-01 — N=10 conversion → auto-Gold
└── rls-affiliate-fraud-signals.test.ts    # vitest RLS for new table
```

### Pattern 1: Tier Enum as TEXT + CHECK Constraint (NOT Postgres Enum)

**What:** Use `tier text not null default 'standard' check (tier in ('standard','gold','lifetime'))` — never a real Postgres `create type enum`.

**When to use:** Every status-like column in Phase 26. Mirrors the Phase 19 pattern (see `20270101000001_affiliates_schema.sql:36` — `status text not null ... check (status in ...)`).

**Why:** Postgres enums cannot be modified inside the same transaction they're added in (Pitfall 3 / `feedback_planner_iter1_anti_patterns`). CHECK constraints support drop+re-add inside one transaction, which is critical when extending the set later. v1.2 Phase 19 already shipped two precedents (affiliates.status, payouts.status); Phase 22 already extended `audit_logs.action` via drop+re-add idiom.

**Example:**

```sql
-- Source: supabase/migrations/20270101000001_affiliates_schema.sql:36 (analog)
alter table public.affiliates
  add column tier text not null default 'standard'
    check (tier in ('standard','gold','lifetime'));
alter table public.affiliates add column tier_promoted_at timestamptz;
alter table public.affiliates add column tier_grantor_user_id uuid
  references auth.users(id) on delete set null;
alter table public.affiliates add column frozen_at timestamptz;
alter table public.affiliates add column freeze_reason text;

-- Partial index on tier='lifetime' for the recurring cron's hot path.
-- Pitfall 1: equality-to-literal is IMMUTABLE.
create index idx_affiliates_lifetime on public.affiliates(id) where tier = 'lifetime' and frozen_at is null;
```

### Pattern 2: BEFORE INSERT Trigger for Atomic Tier + Commission Stamping (D-19, AFFTIER-02)

**What:** A `BEFORE INSERT ON affiliate_conversions FOR EACH ROW` trigger that reads the current `affiliates.tier`, computes `commission_cents` from the D-01 rate table × the invoice line amount, and assigns both onto `NEW` before the row lands.

**When to use:** All conversion inserts — both the existing `stripe-webhook/events/invoice-paid.ts` path AND the new `affiliate-lifetime-recurring` cron path. Trigger fires uniformly.

**Why:** Only way to guarantee success criterion #1 — "retroactive tier upgrade DOES NOT mutate any historical conversion row." If stamping were app-layer, a future bulk-recompute migration could be tempted to rewrite. Trigger + lack of UPDATE policy makes it physically hard.

**Example:**

```sql
-- Source: analog of supabase/migrations/20270101000005_insert_affiliate_impression_fn.sql
--   (SECURITY DEFINER + locked search_path pattern)
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
  -- Stamp tier at insert time.
  select tier into v_tier from public.affiliates where id = NEW.affiliate_id;
  if v_tier is null then
    raise exception 'affiliate % not found', NEW.affiliate_id;
  end if;
  NEW.tier_at_conversion_time := v_tier;

  -- Commission rate lookup (D-01 table).
  v_commission_pct := case v_tier
    when 'standard' then 0.20
    when 'gold'     then 0.30
    when 'lifetime' then 0.25  -- D-01: 25% monthly recurring basis
    else 0.20
  end;

  -- ONLY stamp commission_cents if caller didn't provide one. The existing
  -- invoice-paid handler computes commission_cents from invoice.amount_paid
  -- (Phase 19 path) — preserve that behavior. New callers (lifetime cron)
  -- pre-compute and pass it in; trigger respects.
  if NEW.commission_cents is null or NEW.commission_cents = 0 then
    -- This branch only fires for callers who don't pre-compute. Documented
    -- as a defensive fallback; primary path is caller-provided.
    -- Recurring callers pass commission_cents = current_price * v_commission_pct.
    raise exception 'commission_cents must be provided by caller';
  end if;

  -- Lifetime conversions ALSO stamp recurring_commission_pct_basis for D-06 scaling.
  if v_tier = 'lifetime' then
    NEW.recurring_commission_pct_basis := v_commission_pct * 100; -- e.g., 25.00
  end if;

  return NEW;
end
$$;

revoke all on function public.stamp_affiliate_conversion_tier() from public;

create trigger trg_affiliate_conversion_stamp
  before insert on public.affiliate_conversions
  for each row execute function public.stamp_affiliate_conversion_tier();
```

**Test contract (REQUIRED — success criterion #1):** A vitest/Deno DB test that:
1. INSERT affiliate with tier='standard'
2. INSERT 5 affiliate_conversions (all stamp 'standard')
3. UPDATE affiliate SET tier='gold'
4. INSERT 5 more conversions (stamp 'gold')
5. SELECT all 10 conversions — assert the first 5 still have tier_at_conversion_time='standard'

Pattern reference: `feedback_realtime_layer_e2e_pattern` (DB-level invariant > UI traversal).

### Pattern 3: Lifetime Recurring Cron — Edge Function over pg_cron-direct-SQL

**What:** A Deno Edge Function invoked by pg_cron at 03:00 UTC day-1 monthly. Edge Fn does the JOIN + per-row commission computation + INSERTs.

**When to use:** This phase. NOT inline SQL via cron because:
- Commission computation needs the current Stripe price (which lives in `subscriptions.plan_id` snapshot, but if a sub plan-changed mid-month the cron may need `stripe.subscriptions.retrieve` for the live price — punting to Edge Fn keeps Stripe SDK in the right tier).
- Better testability (mirrors `affiliate-payout/index.ts` test seam pattern).

**Cron registration follows `20270101000012_payouts_materialization_and_cron.sql` lines 92–108 exactly** — `net.http_post` with vault-stored service_role_key:

```sql
select cron.schedule(
  'affiliate-lifetime-recurring',
  '0 3 1 * *',  -- day-1 of month 03:00 UTC (after 00:30 materialize chain; before next-month 00:00 transfer)
  $$
    select net.http_post(
      url := 'https://ytnsipxxmzgaebkqmokp.supabase.co/functions/v1/affiliate-lifetime-recurring',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (
          select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key' limit 1
        )
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 120000
    );
  $$
);
```

**Schedule collision audit:** Existing cron jobs at midnight day-1: `affiliate-monthly-payout 0 0 1 * *`. Existing daily: `affiliate-conversions-confirm 15 0 * * *`, `affiliate-payouts-materialize 30 0 * * *`. **`0 3 1 * *` is clear of all collisions.** Recommend documenting why 03:00 and not 04:00: the lifetime-recurring cron INSERTs new `affiliate_conversions` rows with `eligible_at = now() + 60d`, which means they will NOT be picked up by *this* month's materialize chain (which already ran at 00:30) — they will be picked up next month after the chargeback window elapses. This is the correct ordering per D-06.

### Pattern 4: Ratio Z-Score Matview (Extends v1.2 `affiliate_click_baseline`)

**What:** A new matview `affiliate_ratio_baseline` that aggregates `clicks/impressions` per affiliate per day over a 7-day rolling window + computes mean/stddev of the ratio. Refreshed hourly via pg_cron CONCURRENTLY (UNIQUE index required per Pitfall 5).

**When to use:** This phase. **DO NOT replace** `affiliate_click_baseline` — v1.2 AFF-08 raw-count Z-score is still enforced (CONTEXT D-10). Both checks run; either flags = flagged.

**Why:** Mirrors v1.2 Phase 19 pattern exactly (`20270101000007_affiliate_click_baseline_mv.sql`). Hourly refresh is acceptable cost (~1k affiliates × 7d aggregation = subsecond). Refreshing at attribute-time (LATERAL subquery) was the alternative but adds 50-100ms per click attribution — unacceptable on the `/r/{code}` hot path.

**Example:**

```sql
create materialized view public.affiliate_ratio_baseline as
with daily_pairs as (
  select
    coalesce(c.affiliate_id, i.affiliate_id) as affiliate_id,
    date_trunc('day', coalesce(c.created_at, i.created_at))::date as d,
    count(distinct c.id) as click_count,
    count(distinct i.id) as impression_count
  from public.affiliate_clicks c
  full outer join public.affiliate_impressions i
    on c.affiliate_id = i.affiliate_id
    and date_trunc('day', c.created_at) = date_trunc('day', i.created_at)
  where coalesce(c.created_at, i.created_at) > now() - interval '7 days'
  group by coalesce(c.affiliate_id, i.affiliate_id), date_trunc('day', coalesce(c.created_at, i.created_at))
)
select
  affiliate_id,
  avg(click_count::numeric / nullif(impression_count, 0))::numeric(10,4) as mean_ratio,
  stddev_samp(click_count::numeric / nullif(impression_count, 0))::numeric(10,4) as stddev_ratio,
  count(*) filter (where impression_count > 0) as days_observed
from daily_pairs
group by affiliate_id;

create unique index idx_ratio_baseline_affiliate
  on public.affiliate_ratio_baseline(affiliate_id);

-- Refresh hourly (cron pattern from 20270101000009_click_baseline_refresh_cron.sql analog).
select cron.schedule(
  'affiliate-ratio-baseline-refresh',
  '5 * * * *',  -- 5 min past every hour (offset to avoid colliding with raw-count baseline at 0 1 * * *)
  $$ refresh materialized view concurrently public.affiliate_ratio_baseline; $$
);
```

**Where the flag is written:** The `stripe-webhook/events/invoice-paid.ts` handler (after the existing `affiliate_conversions` insert) does the Z-score check + UPDATEs `anomaly_flagged=true`, `anomaly_z_score=<value>` on the just-inserted row, AND inserts an `affiliate_fraud_signals` row (`signal_type='anomaly_z_score'`).

### Pattern 5: SECURITY DEFINER Admin RPC + `app.suppress_audit` GUC

**What:** Each new admin action (grant_lifetime, freeze, anomaly_review_decision) is a SECURITY DEFINER function that (a) re-checks `is_staff() AND is_superadmin()`, (b) sets `app.suppress_audit='true'` to suppress automatic trigger-based audit emission, (c) performs the mutation, (d) explicitly INSERTs into `audit_logs` with the action enum value.

**When to use:** Every admin RPC in this phase. Pattern is locked from Phase 22 (`20270601000019_admin_affiliate_review_rpcs.sql` is the canonical reference).

**Why:** Without `app.suppress_audit` GUC, the table trigger would emit a generic `update` audit row AND the function would emit a typed action row → double-audit. Pattern is established and plan-checker enforces it.

**Example reference:** `supabase/migrations/20270601000019_admin_affiliate_review_rpcs.sql:24-38` — copy verbatim, change the action name + table.

### Pattern 6: audit_logs.action CHECK Constraint Extension (Phase 22 idiom)

**What:** DROP the existing `audit_logs_action_check`, ADD a new one with the extended value list.

**When to use:** Every phase that adds new admin action types. Phase 26 adds: `affiliate_tier_granted`, `affiliate_tier_grant_reversed`, `affiliate_tier_frozen`, `affiliate_tier_unfrozen`, `affiliate_anomaly_cleared`, `affiliate_anomaly_fraud_confirmed`.

**Why:** Pattern locked since Phase 7. Direct precedent in Phase 22 (`20270601000019_admin_affiliate_review_rpcs.sql:77-95`) — read that file's section before writing this migration.

**Example:** mirror the Phase 22 migration's section 3 verbatim, append the 6 new action values to the IN-list.

**Critical:** The current production audit_logs.action enum (per `20260601000001_audit_logs.sql`) is `('insert','update','delete','account_deleted_initiated','account_deleted_finalized')`. Phase 22 extended with 3 more (`affiliate_conversion_approved`, `_held`, `_rejected`). Phase 24 will extend with admin action types. Phase 26 must KEEP THE EXISTING LIST + APPEND — never overwrite. **Read the live constraint definition pre-write** to handle drift from any phases that may land between Phase 22 and Phase 26 (Phases 24, 25).

### Pattern 7: Playwright Screenshot Diff for Tier Variants (AFFTIER-06, D-13)

**What:** Use Playwright's `await expect(page).toHaveScreenshot('landing-gold.png')` API on the `/r/{code}/landing` route, seeded with an affiliate fixture tagged `tier='gold'`.

**When to use:** This phase. NET-NEW infrastructure — repo has zero existing `toHaveScreenshot` baselines (`grep` of `e2e/*.spec.ts` returned no matches).

**Setup requirements:**
1. Add Playwright snapshot config to `playwright.config.ts` (`expect.toHaveScreenshot.threshold = 0.2`, `maxDiffPixels = 100`).
2. Seed fixture: create a test affiliate with `tier='gold'` and `tier='standard'`; both have status='approved' + valid `referral_code`.
3. Use `page.addInitScript` for Supabase session seeding (project rule `[[reference_playwright_state_seeding]]`).
4. Generate baselines via `npx playwright test affiliate-landing-gold.spec.ts --update-snapshots` — committed to repo under `e2e/affiliate-landing-gold.spec.ts-snapshots/`.
5. CI fails if pixel-diff exceeds threshold.

**Why Playwright (not Storybook/Chromatic):** v1.3 STACK already uses Playwright for e2e; Chromatic is extra vendor + cost. Plain Playwright `toHaveScreenshot` is sufficient for tier-variant regression.

**Example:**

```typescript
// e2e/affiliate-landing-gold.spec.ts
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

**Fixture seeding:** A Wave-0 SQL fixture migration (`supabase/migrations/test-fixtures/...`) is the cleanest way; OR a Playwright global-setup using service_role to INSERT the two affiliates pre-suite.

### Anti-Patterns to Avoid

- **Postgres `create type enum` for `tier`** — un-modifiable in same tx; use `text + check`. (Pitfall 3 in `feedback_planner_iter1_anti_patterns`)
- **App-layer tier stamping in `invoice-paid.ts`** — racey; bypassable; defeats AFFTIER-02 success criterion #1. Use BEFORE INSERT trigger ONLY.
- **Mutating historical `commission_cents` on tier upgrade** — same defeat. Stamping is write-once; never UPDATE.
- **Negative `stripe.transfers.create` for refund claw-back** — adds operational surface (Stripe debit, balance management). Use `payouts.adjustments` jsonb column instead.
- **Lifetime cron writing directly to `payouts`** — bypasses the confirm + materialize chain that AFF-08 anomaly check depends on. Write to `affiliate_conversions` (let trigger stamp tier='lifetime') + let existing pipeline roll up.
- **Storing PHI in Stripe metadata or affiliate_fraud_signals.payload** — Phase 25 D-09 PHI lint rule. Recurring payment metadata MUST be `{ payout_id, affiliate_id, leanshot_phase: '26' }` only (analog: `affiliate-payout/index.ts:247-251`).
- **Using `[[reference_supabase_migration_filename_regex]]` letter-suffix timestamps** — strict 14-digit only. Filenames `20270701000001`, `_02`, `_03` etc.
- **Lifetime cron filtering on `subscriptions.status='paid'`** — that's a UX-tier alias; actual Stripe status enum is `active|trialing|past_due|canceled|incomplete|incomplete_expired|paused`. Use `status='active'` against the live Stripe-status text column (NOT `ux_tier`).
- **`page.goto + page.evaluate(seed) + reload`** for Playwright fixture — races supabase-js INITIAL_SESSION. Use `page.addInitScript` (`[[reference_playwright_state_seeding]]`).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Tier promotion ratchet logic | Custom CRON SQL that does `UPDATE affiliates SET tier='gold' WHERE ...` | Trigger AFTER INSERT on affiliate_conversions; check count + flip | Trigger fires atomically per conversion; no race window between threshold-crossing conversion and next cron tick |
| Audit logging for tier changes | Bespoke logging table | Existing `audit_logs` + `log_admin_action()` (Phase 24 pattern) | Single audit surface; HIPAA archive cron already handles 7yr retention |
| Stripe Connect transfers | New batch logic | Existing `affiliate-payout` Edge Function (Phase 19) — write your lifetime conversion rows; let the existing cron pay them | Single Stripe Connect platform; avoids two competing transfer pipelines |
| Idempotency for recurring payments | UUID + retry table | UNIQUE constraint on `(affiliate_id, subscription_id, billing_period_yyyymm)` composite + ON CONFLICT DO NOTHING | Postgres-native; can't be bypassed; same pattern as Phase 14 `subscription_events.event_id` |
| Stripe refund detection | Polling `stripe.refunds.list` | Webhook handler for `charge.refunded` event | Push > pull; Stripe webhook signature verification already exists |
| Z-score sliding window | LATERAL subquery at each event | Matview + hourly refresh CONCURRENTLY | v1.2 AFF-08 pattern; subsecond cost; doesn't slow attribution hot path |
| Admin role re-check | "if user.is_superadmin" client gate | SECURITY DEFINER RPC with internal `is_staff()` + role check | Pattern S1 dual-layer security (Phase 24 D-03) |
| Cron auth | Custom JWT verifier | Constant-time bearer compare against vault-stored `service_role_key` | `affiliate-payout/index.ts:104-112` exact pattern |

**Key insight:** Phase 19 + 22 already built ~80% of this phase's plumbing. The novel work is (a) tier stamping trigger, (b) lifetime cron Edge Fn, (c) 2 new Stripe webhook handlers, (d) anomaly review tab UI. Everything else is *extension*.

## Common Pitfalls

### Pitfall 1: Stripe webhook event subscription is set in Stripe Dashboard, NOT in code

**What goes wrong:** Phase 26 adds `events/charge-refunded.ts` + `events/charge-dispute-created.ts` handlers, deploys the Edge Function — but no events arrive. Refunds happen, claw-back never triggers, partners overpaid silently.

**Why it happens:** Stripe webhook event types are configured in the Stripe Dashboard (Developers → Webhooks → endpoint → event types). Adding a `case 'charge.refunded':` in `stripe-webhook/index.ts` is necessary but NOT sufficient — Stripe must be told to deliver that event type. v1.2 currently subscribes to: `checkout.session.completed`, `customer.subscription.{created,updated,deleted}`, `invoice.{paid,payment_failed,upcoming}`, `account.updated` (verified at `stripe-webhook/index.ts:107-127`).

**How to avoid:** Phase 26 plan MUST include a HUMAN-UAT checkpoint to add `charge.refunded` + `charge.dispute.created` to the configured Stripe webhook endpoint via Dashboard (or `stripe webhook_endpoints update` CLI). Verify via `stripe events list --types charge.refunded` returning events post-config.

**Warning signs:** First refund post-deploy doesn't write `payouts.adjustments`. Sentry log shows no event of those types in `subscription_events` table.

### Pitfall 2: `subscriptions.status` is a Stripe-mirrored text column with 8 possible values; UX-tier is only 3

**What goes wrong:** Lifetime cron filters on `subscriptions.ux_tier='paid'` — misses subscribers in `trialing` (paid but on free trial — Lifetime affiliate should NOT earn on trial), AND counts `past_due` rows (Lifetime affiliate SHOULD NOT earn during dunning).

**Why it happens:** `subscriptions.status` (text, raw Stripe value) and `subscriptions.ux_tier` (text, 3-value UX collapse) are different columns. Per `subscription-updated.ts:17` comment: "Stripe's 8 subscription statuses collapse to 3 UX tiers." Cron must use `status` (the raw Stripe value) per D-05 ("pay-tracks-Stripe-active").

**How to avoid:** Cron query filters explicitly: `WHERE subscriptions.status = 'active'` (NOT `ux_tier='paid'`). Plan-checker mitigation: BLOCKER if `affiliate-lifetime-recurring/index.ts` references `ux_tier` instead of `status`.

**Warning signs:** Lifetime payouts in months where the affiliate's subscriber was in trial OR past_due. Or: missing payouts in months where Stripe shows `active` but local `ux_tier` is stale.

### Pitfall 3: Promotion-trigger race when two paid conversions fire concurrently at the N=10 boundary

**What goes wrong:** Affiliate has 9 paid conversions. Two webhooks arrive simultaneously — both AFTER INSERT triggers compute "count=10" and both attempt UPDATE affiliates SET tier='gold'. The second UPDATE may also fire an audit_log row and potentially a duplicate notification.

**Why it happens:** PostgreSQL trigger function defaults to READ COMMITTED isolation; both triggers see the same baseline count and race to UPDATE.

**How to avoid:** Wrap the promotion UPDATE in `WHERE tier = 'standard'` — the second UPDATE becomes a no-op (zero rows affected). Conditionally fire the audit_log INSERT only when the UPDATE returns `FOUND = true`:

```sql
update public.affiliates set tier='gold', tier_promoted_at=now()
  where id = NEW.affiliate_id and tier = 'standard'
  returning 1 into v_promoted;
if found then
  insert into public.audit_logs (...) values (...);
end if;
```

**Warning signs:** Duplicate `affiliate_tier_granted` audit rows for the same affiliate_id within a few seconds. Multiple promotion emails.

### Pitfall 4: Anomaly ratio detector divides by zero on cold-start affiliates with zero impressions

**What goes wrong:** Newly-approved affiliate has clicks but no impressions yet (someone clicked the link without ever visiting `/r/{code}/landing`). Ratio = clicks/0 = error or Infinity. Z-score computation crashes or returns garbage.

**Why it happens:** Direct-cookie attribution (someone shares a `?aff=code` URL skipping the landing page) is a v1.2 valid path; impressions are only written from the landing page.

**How to avoid:** `nullif(impression_count, 0)` in the matview SELECT (shown in Pattern 4 above); cold-start skip in the flag check: `WHERE days_observed >= 7 AND impression_count > 0`. Mirrors v1.2 `affiliate_click_baseline` cold-start logic (`days_observed >= ZSCORE_BASELINE_MIN_DAYS`).

**Warning signs:** Postgres `ERROR: division by zero` in cron logs. Matview refresh crash.

### Pitfall 5: Reversibility-window check uses wall-clock time, allowing reverse after a recurring payout shipped

**What goes wrong:** D-14 says Gold→Lifetime grant is reversible "within 7 days OR until first recurring payout." If the reverse RPC checks only `now() - granted_at < 7 days`, then an admin can reverse on day 5 — but the day-1 monthly cron already shipped a payout on day 3.

**Why it happens:** Two independent gates (time + payout-state); coding only the time check is the easy oversight.

**How to avoid:** `admin_reverse_lifetime_grant()` RPC enforces BOTH:

```sql
if exists (
  select 1 from public.affiliate_lifetime_recurring_payments
  where affiliate_program_id = p_affiliate_id
) or (now() - (select tier_promoted_at from public.affiliates where id = p_affiliate_id)) > interval '7 days'
then
  raise exception 'cannot_reverse_lifetime: payout already shipped or window expired';
end if;
```

**Warning signs:** Audit log shows `affiliate_tier_grant_reversed` action on an affiliate that also has rows in `affiliate_lifetime_recurring_payments`.

### Pitfall 6: AffiliateLandingResolver fallback drops Gold partners to Coach template silently

**What goes wrong:** Existing resolver code (`AffiliateLandingResolver.tsx:122`): `TEMPLATE_LOADERS[choice] ?? TEMPLATE_LOADERS.coach`. If Phase 26 adds `gold` to `template_choice` for an affiliate row but FORGETS to add `gold:` key to `TEMPLATE_LOADERS`, the fallback silently renders Coach template — passing CI smoke tests, failing actual partner UX.

**Why it happens:** Defensive fallback masks the missing key.

**How to avoid:** ESLint rule + matched-pair grep test: every value in `affiliates.tier` CHECK constraint must have a matching loader entry in `TEMPLATE_LOADERS`. OR: change the fallback to throw in dev (`if (!loader && import.meta.env.DEV) throw new Error(...)`) so CI catches it.

**Warning signs:** AFFTIER-06 Playwright screenshot diff shows Coach template rendering when the URL is for a Gold partner.

### Pitfall 7: `payouts.adjustments` jsonb column needs schema documentation OR future devs append duplicate keys

**What goes wrong:** D-06 introduces `payouts.adjustments jsonb` as a free-form ledger. Phase 27+ engineers append `{type: 'refund', amount: -500}` without a schema; over time, the column accumulates `{type:'refund'}`, `{kind:'refund'}`, `{adjustment_type:'refund'}` — querying becomes impossible.

**Why it happens:** jsonb columns invite schema drift.

**How to avoid:** Phase 26 plan MUST include a TypeScript type `AdjustmentEntry` in `src/lib/affiliate/types.ts` that is the source-of-truth shape. Use `validate-jsonb-shape.sql` CI check OR a Postgres CHECK constraint `(jsonb_typeof(adjustments) = 'array' AND jsonb_path_exists(adjustments, '$[*].type ? (@ == "refund" || @ == "chargeback" || @ == "manual")'))`.

**Warning signs:** Three Phase 26+ migrations later, an analyst can't get a clean refund total because of key drift.

### Pitfall 8: Stripe API version drift between affiliate-payout (`2026-04-22.dahlia`) and new event handlers

**What goes wrong:** New `events/charge-refunded.ts` constructs a Stripe client without explicit `apiVersion`, gets latest (e.g., `2026-10-15.elderflower`) — payload shape differs from what handler expects, deserialization silently drops fields.

**Why it happens:** Stripe API version is per-construct; defaults to latest.

**How to avoid:** Every new Stripe instantiation MUST pass `apiVersion: '2026-04-22.dahlia'`. CI grep enforces. Reuse the `getStripe()` factory pattern from `affiliate-payout/index.ts:58-66`.

**Warning signs:** TypeScript `as any` casts in new handler; missing/null fields in unit tests against fixture payloads.

## Runtime State Inventory

> Phase 26 ADDS schema; it does not rename or migrate existing data. Inventory below confirms what existing runtime state Phase 26 must coexist with — none requires migration, but each must be ANSWERED.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | (1) Existing `affiliates` rows have implicit tier='standard' (no column today). (2) Existing `affiliate_conversions` rows have no `tier_at_conversion_time` (column null after ALTER). (3) Existing `payouts` rows have no `adjustments` (column null after ALTER). | **Backfill migration:** UPDATE all existing `affiliate_conversions SET tier_at_conversion_time='standard'` immediately after ADD COLUMN, before making it NOT NULL. Existing affiliates default to 'standard' via column DEFAULT — no backfill needed. |
| Live service config | Stripe webhook endpoint at Supabase (`https://ytnsipxxmzgaebkqmokp.supabase.co/functions/v1/stripe-webhook`) currently subscribed to 8 event types. Subscription list NOT in git — lives in Stripe Dashboard. | **HUMAN-UAT checkpoint:** Add `charge.refunded` + `charge.dispute.created` via Stripe Dashboard OR `stripe webhook_endpoints update we_xxx --enabled-events charge.refunded,charge.dispute.created,<all-existing>`. Verify via `stripe webhook_endpoints retrieve we_xxx`. |
| OS-registered state | pg_cron jobs (12 active per live query). Phase 26 ADDS: `affiliate-lifetime-recurring 0 3 1 * *` + `affiliate-ratio-baseline-refresh 5 * * * *`. No collision with existing schedule. | Cron registration is part of the migration files; no manual action. |
| Secrets/env vars | Existing: `STRIPE_SECRET_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `STRIPE_WEBHOOK_SECRET`, vault-stored `service_role_key` for cron net.http_post. | No new secrets required. New cron Edge Fn reuses existing vault entry. |
| Build artifacts | None — Phase 26 is pure source additions. No package version bumps. | None. |

**Nothing found in category:** "Build artifacts" — verified by inspecting `package.json` (no new deps), `supabase/config.toml` (no new function configs needed beyond the standard verify_jwt=true), and the absence of any binary/native module additions.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Stripe API (live + test) | All Stripe webhook + transfer flows | ✓ | API `2026-04-22.dahlia` pinned, account approved for Connect | — |
| Stripe Connect Express | Affiliate transfer destination | ✓ | Approved + active in v1.2 P14 | — (no new vendor gate per `[[feedback_vendor_account_circular_dependency]]`) |
| Supabase Postgres | All migrations + crons | ✓ | Pro tier; pg_cron + pgcrypto + net extensions present | — |
| Supabase Edge Functions runtime | New `affiliate-lifetime-recurring` Edge Fn | ✓ | Deno + esm.sh/jsr workflow established | — |
| Supabase Vault | service_role_key for cron net.http_post auth | ✓ | Already populated in v1.2 P19 (BL-7) | — |
| `supabase` CLI (linked) | Live cron + schema queries during dev | ✓ | npx supabase 2.98.2 verified | — |
| Playwright | AFFTIER-06 screenshot diff baseline | ✓ | `@playwright/test` in repo; toHaveScreenshot API native | — |
| Stripe CLI | HUMAN-UAT for webhook event subscription | UNKNOWN | not verified this session | Dashboard UI fallback |

**Missing dependencies with no fallback:** None — all infra in place.

**Missing dependencies with fallback:** Stripe CLI availability (low priority — Dashboard fallback works for HUMAN-UAT subscription step).

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | vitest (unit + RLS) + @playwright/test (e2e + screenshot) + deno test (Edge Functions) |
| Config file | `vitest.config.ts` + `playwright.config.ts` + `supabase/functions/<name>/deno.json` |
| Quick run command | `npm run test:unit -- --run` |
| Full suite command | `npm run test` (vitest + playwright + supabase deno tests) |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|--------------|
| AFFTIER-01 | Standard→Gold auto-promotion at N=10 paid conversions | integration (vitest + live Supabase) | `vitest run e2e/affiliate-tier-promotion.spec.ts` | ❌ Wave 0 |
| AFFTIER-01 | Locked-once-earned: tier never downgrades | unit (vitest pg trigger fixture) | `vitest run src/lib/affiliate/__tests__/tier-ratchet.test.ts` | ❌ Wave 0 |
| AFFTIER-02 | Conversion stamps tier + commission at INSERT | DB-invariant (vitest cross-tenant) | `vitest run e2e/affiliate-tier-stamping.spec.ts` | ❌ Wave 0 |
| AFFTIER-02 | Historical conversions immune to tier upgrade | DB-invariant (the explicit success criterion #1 test) | `vitest run e2e/affiliate-tier-stamping.spec.ts -t "historical immutability"` | ❌ Wave 0 |
| AFFTIER-03 | Tier-progress bar renders correct percent | unit (vitest + RTL) | `vitest run src/components/partner/__tests__/PartnerTierProgress.test.tsx` | ❌ Wave 0 |
| AFFTIER-03 | Per-tier earnings breakdown sums correctly | unit (vitest pure-fn) | `vitest run src/lib/affiliate/__tests__/tier-earnings.test.ts` | ❌ Wave 0 |
| AFFTIER-04 | Lifetime cron writes conversion row per active subscriber | deno test (Edge Fn) | `cd supabase/functions/affiliate-lifetime-recurring && deno test --allow-all` | ❌ Wave 0 |
| AFFTIER-04 | Idempotency: re-run on same month is no-op | deno test (Edge Fn) | same file, `Deno.test "idempotent on retry"` | ❌ Wave 0 |
| AFFTIER-04 | Skips canceled/paused/past_due/trialing | deno test (Edge Fn) | same file, `Deno.test "status filter"` | ❌ Wave 0 |
| AFFTIER-05 | Ratio Z-score flag fires at >3σ | deno test (Edge Fn) + DB seed | `cd supabase/functions/stripe-webhook && deno test events/invoice-paid.test.ts` | EXISTING (extend) |
| AFFTIER-05 | Anomaly review queue surfaces flagged rows | integration | `vitest run src/lib/admin/__tests__/anomaly-review.test.ts` | ❌ Wave 0 |
| AFFTIER-06 | Gold partner /r/{code}/landing serves premium template | e2e (Playwright screenshot) | `npx playwright test e2e/affiliate-landing-gold.spec.ts` | ❌ Wave 0 |
| AFFTIER-06 | Standard partner unchanged from v1.2 baseline | e2e (Playwright screenshot) | same file, `test "Standard tier ..."` | ❌ Wave 0 |

### Sampling Rate

- **Per task commit:** `npm run test:unit -- --run` + `npm run typecheck` + `npm run lint`
- **Per wave merge:** `npm run test` (full vitest + playwright + deno test sweep)
- **Phase gate:** Full suite green + Playwright snapshot baselines committed + `vitest run e2e/affiliate-tier-stamping.spec.ts` passing on AFFTIER-02 historical-immutability test

### Wave 0 Gaps

- [ ] `e2e/affiliate-tier-stamping.spec.ts` — covers AFFTIER-02 (CRITICAL — success criterion #1 test)
- [ ] `e2e/affiliate-tier-promotion.spec.ts` — covers AFFTIER-01
- [ ] `e2e/affiliate-landing-gold.spec.ts` + paired `-snapshots/` baselines — covers AFFTIER-06
- [ ] `src/lib/affiliate/__tests__/tier-ratchet.test.ts` — covers ratchet invariant
- [ ] `src/lib/affiliate/__tests__/tier-earnings.test.ts` — covers AFFTIER-03 sum logic
- [ ] `src/components/partner/__tests__/PartnerTierProgress.test.tsx` — covers AFFTIER-03 UI
- [ ] `src/lib/admin/__tests__/anomaly-review.test.ts` — covers AFFTIER-05 admin queue
- [ ] `supabase/functions/affiliate-lifetime-recurring/index.test.ts` — covers AFFTIER-04
- [ ] `supabase/functions/stripe-webhook/events/charge-refunded.test.ts` — covers refund claw-back
- [ ] `supabase/functions/stripe-webhook/events/charge-dispute-created.test.ts` — covers chargeback fraud signal
- [ ] `playwright.config.ts` — ensure `expect.toHaveScreenshot.threshold` set (currently no snapshot config)

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | Existing Supabase Auth + new SECURITY DEFINER RPCs re-check is_staff() + is_superadmin() |
| V3 Session Management | yes | Existing supabase-js session; no new session surface |
| V4 Access Control | yes | Pattern S1 dual-layer (Phase 24 D-03) — every admin RPC re-checks role + RLS on all new tables (cross-tenant impersonation proof test required per project rule) |
| V5 Input Validation | yes | `tier` value validated by CHECK constraint; anomaly decision validated by RPC enum; landing template_choice validated against TEMPLATE_LOADERS keys |
| V6 Cryptography | no (passive) | No new crypto primitives. Idempotency keys composed via string concat. |
| V7 Error Handling | yes | Pattern S3 — never echo Stripe error to client; logged stable strings |
| V8 Data Protection | yes | PHI lint — Stripe metadata limited to `{payout_id, affiliate_id, leanshot_phase}` per Phase 25 D-09 |
| V9 Communication | yes | Stripe API over TLS; pg_cron uses internal net.http_post over HTTPS |

### Known Threat Patterns for {stack}

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Forged tier-grant request | Tampering + EoP | SECURITY DEFINER RPC + is_superadmin() check + audit_logs row |
| Cross-tenant affiliate read (admin sees competitor affiliate's conversion data) | Information Disclosure | RLS on `affiliate_fraud_signals` + `affiliate_lifetime_recurring_payments` — service_role-only write, is_staff-only read |
| Replay of Stripe webhook for double-claw-back | Tampering + Repudiation | Existing `subscription_events.event_id` UNIQUE constraint (Phase 14 pattern); 23505 swallow on dupe |
| Affiliate self-promotion via direct DB poke | Tampering + EoP | Trigger uses SECURITY DEFINER with locked search_path; revoke direct UPDATE on `affiliates.tier` from authenticated |
| Webhook signature bypass on new event types | Spoofing | Reuse existing `stripe.webhooks.constructEventAsync` — no per-event-type bypass; signature verified once at dispatch |
| RLS bypass via service_role in lifetime cron | Information Disclosure | Cron Edge Fn uses lazy admin singleton + auth.uid()=null is documented service-role bypass; service-role keys only in vault |
| Anomaly Z-score manipulation by self-spamming impressions | Tampering | `/24` IP truncation on impressions (Phase 19 D-38); 7-day baseline + cold-start cap absorbs single-day outliers |
| Lifetime grant abuse by rogue superadmin | Repudiation | Audit log row + reversibility window (D-14); two-superadmin approval deferred to staff >5 |

## Code Examples

Verified patterns from existing repo:

### Pattern A: SECURITY DEFINER RPC with audit-log emission + role gate

```sql
-- Source: supabase/migrations/20270601000019_admin_affiliate_review_rpcs.sql (Phase 22 — proven pattern)
create or replace function public.admin_grant_lifetime(
  p_affiliate_id uuid,
  p_reason text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_uid uuid := auth.uid();
  v_old_tier text;
begin
  -- Pattern S1: dual-layer security re-check.
  if v_uid is null or not public.is_superadmin(v_uid) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  -- Read current tier (must be 'gold' per D-14).
  select tier into v_old_tier from public.affiliates where id = p_affiliate_id for update;
  if v_old_tier is null then raise exception 'affiliate not found'; end if;
  if v_old_tier <> 'gold' then
    raise exception 'lifetime grant only from gold tier (current: %)', v_old_tier;
  end if;

  -- Suppress automatic trigger audit; we emit a typed action below.
  perform set_config('app.suppress_audit', 'true', true);

  update public.affiliates
    set tier = 'lifetime',
        tier_promoted_at = now(),
        tier_grantor_user_id = v_uid
    where id = p_affiliate_id;

  insert into public.audit_logs (user_id, user_id_hash, table_name, row_id, action, after_hash)
  values (
    v_uid,
    encode(digest(v_uid::text, 'sha256'), 'hex'),
    'affiliates',
    p_affiliate_id::text,
    'affiliate_tier_granted',
    encode(digest(json_build_object('tier','lifetime','reason',p_reason)::text, 'sha256'), 'hex')
  );
end
$$;

revoke all on function public.admin_grant_lifetime(uuid, text) from public;
grant execute on function public.admin_grant_lifetime(uuid, text) to authenticated;
```

### Pattern B: pg_cron net.http_post → Edge Function with vault-stored bearer

```sql
-- Source: supabase/migrations/20270101000012_payouts_materialization_and_cron.sql:92-108
select cron.schedule(
  'affiliate-lifetime-recurring',
  '0 3 1 * *',
  $$
    select net.http_post(
      url := 'https://ytnsipxxmzgaebkqmokp.supabase.co/functions/v1/affiliate-lifetime-recurring',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (
          select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key' limit 1
        )
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 120000
    );
  $$
);
```

### Pattern C: Stripe transfer with idempotency key (no claw-back direct — ledger only)

```typescript
// Source: supabase/functions/affiliate-payout/index.ts:240-271 (existing Phase 19 pattern; phase 26 REUSES)
const idempotencyKey = `affiliate_payout_${p.id}`;
const transfer = await getStripe().transfers.create(
  {
    amount: p.amount_cents,
    currency: 'usd',
    destination: aff.stripe_connect_account_id,
    metadata: { payout_id: p.id, affiliate_id: p.affiliate_id, leanshot_phase: '26' },
  },
  { idempotencyKey },
);
```

### Pattern D: Test seam — lazy admin singleton overridable in tests

```typescript
// Source: supabase/functions/affiliate-payout/index.ts:71-88 (mirror this in affiliate-lifetime-recurring)
let _adminInstance: SupabaseClient | null = null;
function getAdmin(): SupabaseClient {
  if (_adminInstance === null) {
    _adminInstance = createClient(getSupabaseUrl(), getSupabaseServiceRoleKey(), {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  }
  return _adminInstance;
}
export const __internal = {
  setAdminForTest(client: unknown): void { _adminInstance = client as SupabaseClient; },
  setStripeForTest(stub: unknown): void { _stripeInstance = stub; },
};
```

### Pattern E: Playwright session seeding via addInitScript

```typescript
// Source: [[reference_playwright_state_seeding]] — DO NOT use page.evaluate + reload
// (races supabase-js INITIAL_SESSION)
await page.addInitScript((session) => {
  localStorage.setItem('sb-ytnsipxxmzgaebkqmokp-auth-token', JSON.stringify(session));
}, testSession);
await page.goto('/r/gold-test-aff/landing');
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Postgres `enum` types for status columns | `text + check (col in (...))` | v1.2 Phase 19 (PR explicitly noted Pitfall 3 / `feedback_planner_iter1_anti_patterns`) | Phase 26 follows; no enum types created |
| Single Stripe webhook event handler file | Per-event-type files under `events/` | v1.2 Phase 14 (PR 14-03) | Phase 26 adds 2 new files under `events/`, registers in dispatcher switch |
| `stripe.payouts.create` for Connect | `stripe.transfers.create` to connected account | v1.2 P19 — verified via `[[reference_phase19_research_findings]]` | Phase 26 reuses transfers.create path; never confuses with payouts.create |
| 1099-NEC threshold $600 (pre-OBBB) | 1099-NEC threshold $2,000 (2026 OBBB) | 2026 Big Beautiful Bill — confirmed in `[[reference_phase19_research_findings]]` | Phase 26 doesn't materially change tax surface (Lifetime recurring grows annual totals); `affiliates.tax_threshold_cents=50000` default may need re-evaluation post-launch if Lifetime cohort crosses |
| Pre-2014 Stripe accounts: unprefixed keys still valid | Modern: `sk_live_` / `sk_test_` prefix | Industry shift 2014 | LeanShot uses legacy account (per `[[reference_stripe_legacy_key_and_supabase_token]]`); Edge Functions tolerant |

**Deprecated/outdated:**
- `stripe.usageRecords.create` API — REMOVED 2025-03-31 (per `[[project_phase14_context_complete]]`); use Billing Meters v1 + `createSubtleCryptoProvider`. Phase 26 does NOT touch usage-records — no impact.
- Pre-`2026-04-22.dahlia` Stripe API versions for new constructions. Phase 26 MUST pin `apiVersion: '2026-04-22.dahlia'` everywhere it instantiates Stripe.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | D-01 commission rates (20%/30%/25%) match 2026 SaaS industry band | CONTEXT D-01 carry-forward | Below-market → no Gold-tier signups; above-market → margin compression. CONTEXT marks rates as "industry-typical SaaS band" but session did not re-verify 2026 market data. **User confirmation OR competitive-research spike recommended before launch.** |
| A2 | `payouts.adjustments` jsonb (ledger-only) is preferred over negative `stripe.transfers.create` for claw-back | §Pattern 1 alternatives | If accountant prefers reversed Stripe transfers (matches Stripe Dashboard view 1:1), Phase 26 needs to add a `negativeTransferAdjustment()` helper. Recommendation: confirm with finance contact. |
| A3 | Lifetime recurring writes to `affiliate_conversions` (let trigger stamp) rather than directly to `payouts` | §Architecture Diagram | If direct-to-payouts is preferred (cleaner ledger), then trigger doesn't fire on recurring rows → tier_at_conversion_time stamp must be coded in Edge Fn. Cost: slightly less robust against future bypass. |
| A4 | pg_cron schedule `0 3 1 * *` (day-1 03:00 UTC) for `affiliate-lifetime-recurring` is acceptable | §Pattern 3 | If finance needs payouts ON day-1, the recurring row must materialize BEFORE day-1 (so the lifetime conversions become eligible for the same-month transfer). Current plan materializes them for NEXT month's transfer — verify with operator expectations. |
| A5 | Reusing existing v1.2 `subscriptions.status` column for "active" filter is correct | §Pattern 3 | If `subscriptions` table has stale status due to webhook lag, lifetime cron under-pays. v1.2 `subscription-updated.ts` handler keeps it fresh — but `subscriptions.status` updates only on webhook arrival. Acceptable: cron tolerates ~1d staleness. |
| A6 | Single shared "premium" Gold template variant is what Gold partners actually want | CONTEXT D-12 carry-forward | If partner research shows Gold partners value identity/branding > theme differentiation, per-partner Gold landing should be promoted into v1.3 scope. CONTEXT marks deferred to Lifetime/v1.5; assume CONTEXT is right. |
| A7 | Stripe `2026-04-22.dahlia` API version supports `charge.refunded` + `charge.dispute.created` event types unchanged | §Existing Stripe Webhook Surface | If Stripe deprecated charge.dispute.created in a recent API version, Phase 26 falls back to `radar.early_fraud_warning.created` OR `payment_intent.canceled`. Recommend Context7 verify at plan-phase time. |
| A8 | Anomaly Z-score (ratio) at >3σ flag rate produces tolerable false-positive volume (<10/wk for v1.3 cohort) | §Pattern 4 | If false-positive rate is unmanageable, the 7-day admin review SLA in D-09 becomes impractical → tune threshold to 4σ OR add cool-down per affiliate. |
| A9 | `affiliate_lifetime_recurring_payments` separate table (D-17) + tagged `affiliate_conversions` rows is acceptable double-ledger | §Architecture diagram | If accounting prefers one ledger, drop the separate table and use `affiliate_conversions.metadata->>'kind'='lifetime_recurring'`. CONTEXT D-17 specifies separate table; keep unless user pushes back. |

## Open Questions

1. **Reverse-grant invariant when both gates fire on same day**
   - What we know: D-14 reversibility window is 7 days OR first payout, whichever first.
   - What's unclear: If grant happens day-1 and the day-1 cron fires the lifetime payout the same day, is the window effectively 0?
   - Recommendation: Plan-phase clarify — recommend "grant locks IMMEDIATELY at next scheduled cron tick if grant is < 24h before tick" → set hard floor.

2. **Tier-promotion notification — in scope?**
   - What we know: AFFTIER-01 mentions promotion; CONTEXT doesn't specify whether partner gets an email when Standard→Gold fires.
   - What's unclear: Existing `lifecycle-behavior-triggered` cron (every 15min) could pick this up via a new behavior trigger. Or zero-touch.
   - Recommendation: Plan-phase decide — recommend a single congratulations email via existing Resend `lifecycle-transactional` path; cost ~5 LOC; high partner-engagement value.

3. **What happens to in-flight recurring conversions when subscriber refund/charge-back fires?**
   - What we know: D-06 says claw back the most recent period.
   - What's unclear: Does the claw-back AT the end of period N (refund issued day 25 of month) zero out the entire month, or pro-rate?
   - Recommendation: Plan-phase confirm — recommend full claw-back for that billing period (matches Stripe refund semantics — Stripe refunds the full charge, not pro-rated).

4. **What does the partner dashboard show when tier='frozen'?**
   - What we know: D-04 says "shown as Frozen on partner dashboard with appeal CTA."
   - What's unclear: Do tier-progress bar + earnings still render for past data?
   - Recommendation: Plan-phase decide — recommend: render past earnings normally (already-paid commissions are theirs), grey-out tier-progress bar with overlay "Account frozen — pending review."

5. **What is the `affiliate_fraud_signals.payload` schema?**
   - What we know: Free-form jsonb per D-18.
   - What's unclear: At minimum we need the Z-score value, the affected conversion_id, the detector type. Other detectors v1.4+ may add fields.
   - Recommendation: Plan-phase define TypeScript types `FraudSignalAnomalyPayload`, `FraudSignalChargebackPayload`, `FraudSignalManualPayload`; ESLint rule ensures all writes go through a type-safe helper.

## Sources

### Primary (HIGH confidence)
- Live Supabase database query: `cron.job` table — confirmed 12 active jobs, no collision at `0 3 1 * *` (queried 2026-05-17 via `npx supabase db query --linked`)
- `supabase/migrations/20270101000001_affiliates_schema.sql` — full Phase 19 affiliates table shape + RLS contract
- `supabase/migrations/20270101000002_affiliate_clicks_conversions_payouts.sql` — Phase 19 ledger schemas (table name is `payouts` not `affiliate_payouts`)
- `supabase/migrations/20270101000005_insert_affiliate_impression_fn.sql` — SECURITY DEFINER + locked search_path pattern
- `supabase/migrations/20270101000007_affiliate_click_baseline_mv.sql` — matview + UNIQUE index for CONCURRENTLY refresh
- `supabase/migrations/20270101000010_affiliate_landing_template_seeds.sql` — 3 existing template variants (coach/story/method); Phase 26 adds 4th
- `supabase/migrations/20270101000012_payouts_materialization_and_cron.sql` — exact cron net.http_post + vault pattern to copy
- `supabase/migrations/20270601000019_admin_affiliate_review_rpcs.sql` — canonical Phase 22 reference for audit_logs.action extension + admin RPC pattern
- `supabase/migrations/20260601000001_audit_logs.sql` — base audit_logs schema
- `supabase/migrations/20260601000019_stripe_subscriptions.sql` — subscriptions.status enum (8 Stripe values) vs ux_tier (3 UX values)
- `supabase/functions/affiliate-payout/index.ts` — Stripe transfers.create + idempotency + test seam reference implementation
- `supabase/functions/affiliate-attribute/index.ts` — existing Z-score (raw count) check pattern; Phase 26 ratio detector mirrors this
- `supabase/functions/stripe-webhook/index.ts` (lines 107-127) — confirmed current 8 subscribed event types (charge.refunded NOT among them)
- `supabase/functions/stripe-webhook/events/invoice-paid.ts` — Phase 19 conversion-insert path; Phase 26 anomaly-flag write attaches here
- `src/components/landing/AffiliateLandingResolver.tsx` — TEMPLATE_LOADERS map; Phase 26 adds 'gold'
- `src/lib/affiliate/api.ts` — existing data-layer for partner dashboard
- `.planning/phases/24-foundation-modular-admin-shell-event-taxonomy-server-side-po/24-CONTEXT.md` — admin role model (D-04 — staff/admin/superadmin) + audit_logs decisions (D-13..D-17)

### Secondary (MEDIUM confidence)
- `.planning/research/STACK.md` v1.3 — React Query 5.100.10 + react-table 8.x recommendations for admin surfaces
- `.planning/research/SUMMARY.md` v1.3 — Multi-tier affiliate as must-have; anti-features identified (MLM, bandit)
- `.planning/research/PITFALLS.md` v1.3 — multi-tenant RLS pitfalls (relevant to new tables); HIPAA BAA chain (relevant to PHI lint on metadata)
- LeanShot memory `[[reference_phase19_research_findings]]` — IRS 1099-NEC threshold + 60-day chargeback rule + transfers.create vs payouts.create
- LeanShot memory `[[reference_supabase_migration_gotchas]]` — IMMUTABLE partial indexes + SECURITY DEFINER + REFRESH MATERIALIZED VIEW CONCURRENTLY UNIQUE-index requirement
- LeanShot memory `[[reference_playwright_state_seeding]]` — addInitScript over evaluate+reload

### Tertiary (LOW confidence — flagged for plan-phase verification)
- 2026 SaaS affiliate-rate market band (CONTEXT D-01 — no fresh competitor scrape this session)
- Stripe API `2026-04-22.dahlia` event payload shapes for `charge.refunded` + `charge.dispute.created` (Context7 lookup recommended at plan-phase)
- False-positive rate estimate for >3σ Z-score on 7-day baseline at LeanShot's affiliate cohort size (no live data)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all libraries verified in existing repo; no new deps
- Architecture: HIGH — patterns directly carried from Phase 19 + 22 + 14; precedent in repo for every decision
- Pitfalls: HIGH on pitfalls #1-5 (verified against live code/cron landscape); MEDIUM on pitfall #7 (jsonb schema drift — speculative but plausible); MEDIUM on pitfall #8 (Stripe API version drift — observed in similar Edge Fn refactor patterns)
- Test architecture: HIGH — vitest + playwright + deno-test pattern proven in v1.2; net-new screenshot baseline infrastructure documented
- Security: HIGH — Pattern S1 dual-layer locked since Phase 24

**Research date:** 2026-05-17
**Valid until:** 2026-06-17 (30 days — stable domain except for: Stripe API version drift potential at plan-phase time + 2026 OBBB tax threshold settling per `[[reference_phase19_research_findings]]`)
