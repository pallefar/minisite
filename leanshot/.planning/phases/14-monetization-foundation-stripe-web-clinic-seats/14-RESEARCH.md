# Phase 14: Monetization Foundation - Research

**Researched:** 2026-05-13
**Domain:** Stripe Billing (Checkout + Customer Portal + Billing Meters + webhook idempotency) on Supabase Edge Functions (Deno)
**Confidence:** HIGH

## Summary

Phase 14 ships the Stripe monetization foundation. The non-obvious landmines worth flagging up front:

1. **Legacy `usage_records.create` is REMOVED in Stripe API `2025-03-31.basil`** [VERIFIED: docs.stripe.com/changelog/basil/2025-03-31/deprecate-legacy-usage-based-billing]. Phase 14 MUST use the new **Billing Meters API** (`stripe.billing.meters.create` + `stripe.v1.billing.meterEvents.create`) — NOT `subscriptionItems.createUsageRecord` as CONTEXT.md D-02 implies. This rewrites the clinic-overage Edge Function design.
2. **One Checkout session CAN attach both a flat licensed price + a metered (meter-backed) price** [CITED: docs.stripe.com/api/checkout/sessions/create — max 20 recurring line_items, metered prices ignore quantity at billing but accept `quantity: 1`]. Confirmed via context7/stripe-node v19.1.0 SessionCreateParams. No need to split Checkout + post-session subscription patch.
3. **Webhook signature verification on Deno requires `Stripe.createSubtleCryptoProvider()` as the 5th arg of `constructEventAsync`** [VERIFIED: github.com/supabase/supabase/blob/master/examples/edge-functions/supabase/functions/stripe-webhooks/index.ts]. Omitting the cryptoProvider works on stripe-node v11.16 native fetch path but Supabase canonical pattern still passes it explicitly — copy that pattern.
4. **`identifier` field on meter_events IS the idempotency key** (not Idempotency-Key header) [CITED: docs.stripe.com/api/billing/meter-event] — recommended UUID, enforced over rolling 24h. Use `{clinic_id}_{YYYY-MM}` SHA-256 hash to fit the 100-char limit and stay deterministic across true-up retries.

**Primary recommendation:** Adopt `stripe@19.x` via `https://esm.sh/stripe@19?target=denonext` (matches Supabase example), pinned API version `2026-04-22.dahlia`, single Checkout session with 2 line_items for the clinic tier, Billing Meters (NOT usage records) for the metered line item, and `tier='past_due'` collapsed from Stripe's `past_due` + `unpaid` per CONTEXT landmine #5.

**Web tier monthly price recommendation: $12.99/mo, $132.49/yr (saves $23.39 = 15% off)** — defended in the State of the Art section against 4 comparable consumer-health trackers.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Checkout session creation | API / Edge Function (`stripe-checkout`) | — | Server-side only; Stripe secret key never leaves Edge runtime |
| Webhook ingestion + dedup | API / Edge Function (`stripe-webhook`) | Database (`subscription_events` UNIQUE event.id) | Signature verification needs Stripe secret; DB owns idempotency invariant |
| Subscription state of truth | Database (`subscriptions` table) | — | Webhook writes; client reads via Supabase realtime / polling |
| `tier` derivation | Database row → Client (Zustand `tier` slice) | — | Single read from `subscriptions` row joined on `user_id` (web) or `clinic_id` (clinic) |
| Checkout redirect | Browser / Client | API (returns session URL) | Stripe.js redirectToCheckout OR plain `window.location.href = session.url` — locked decision is hosted, not Elements |
| Customer Portal redirect | Browser / Client | API (returns portal URL) | Server creates session, client opens in new tab per CONTEXT goal text |
| `<TierGate>` gating | Browser / Client | — | Pure UI primitive reading from store; no server roundtrip on render |
| `past_due` banner | Browser / Client (chrome) | Database (status flips via webhook) | UI state derived from store `tier === 'past_due'` |
| Active patient count (clinic) | Database (Postgres function `count_active_patients`) | API / Edge Function (cron-style true-up reporter) | Aggregation belongs in DB; reporting lives in scheduled Edge Function |
| Metered usage reporting | API / Edge Function | Stripe (`v1.billing.meterEvents.create`) | One-direction outbound; no DB write needed (Stripe owns meter state) |

## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01 (Clinic billing structure):** Hybrid base + per-active-patient overage. ONE Checkout session attaches 2 prices: $99/mo base (includes 10 patients) + $9/active-patient/mo overage from patient #11. One product `LeanShot Clinic` with 2 price IDs.
- **D-02 (Active-patient definition):** `clinic_memberships.status='active'` AND ≥1 write to {injections, weights, meals, workouts, symptoms} within rolling 30 days. Postgres function `count_active_patients(clinic_id uuid)` recomputed at billing-period close.
- **D-03 (Paywall split):** Past free / future paid. Free = historical 28-day pharmacology curve; Paid = 7-day forecast overlay.
- **D-04 (Paywall scope):** Only the forecast layer in `MedLevelChart.tsx`. 28-day past + half-life + site-rotation v2 + titration + dose history stay free.
- **D-05 (Default TierGate policy):** `blur-upsell` — 8-12 px gaussian blur + centered upsell card. Respect `prefers-reduced-motion` (skip blur transition).
- **D-06 (Ad-free exception):** `hard-block-no-ui` — no ad slot renders for paid users; no upsell-over-blank-space.
- **D-07 (Advanced AI coach exception):** `hard-block-cta` on model selector dropdown in `AIChatPanel.tsx`. Free coach shows "Free" pill + Upgrade CTA.
- **D-08 (past_due banner):** Always-on at top of dashboard when `tier='past_due'`. Warm-orange `var(--color-warning)`. "Update card" CTA → Customer Portal new tab.
- **D-09 (Web tier granularity):** Free + monthly + yearly (15% annual discount). 1 product `LeanShot Plus`, 2 prices. Monthly $ amount TBD by research.
- **D-10 (Clinic pricing):** $99/mo base (10 patients) + $9/active-patient/mo overage. 50 patients = $99 + 40×$9 = $459/mo.
- **D-11 (Product source):** `scripts/stripe-bootstrap.ts` creates 5 prices idempotently via Stripe API; outputs IDs into `.env.example`. Live IDs land in Vercel env vars + Supabase Function secrets via Stripe MCP.
- **D-12..D-17 (informational):** Hosted Checkout (not Elements); 7-day card-required trial; webhook is source of truth; RLS + cross-tenant impersonation test; CSP additions; Phase 14 = web + clinic only.

### Claude's Discretion
- Web tier monthly price point ($9.99 vs $12.99) → see State of the Art / pricing recommendation below.
- Stripe SDK version pin (recommendation: `stripe@19.x` via `esm.sh/stripe@19?target=denonext`).
- Stripe API version pin (recommendation: `2026-04-22.dahlia`).
- Migration filename and ordering (recommendation: `20260601000001_stripe_subscriptions.sql`).
- Banner copy, blur radius (CONTEXT says 8-12 px; pick 10 px = midpoint), upsell card copy.
- Postgres function language (recommendation: `plpgsql` SECURITY INVOKER except `count_active_patients` which needs cross-tenant aggregation = SECURITY DEFINER).

### Deferred Ideas (OUT OF SCOPE)
- Lifetime SKU (v1.3+).
- DB `products` table for pricing experiments (overkill for v1.2).
- Push notification on card failure (PUSH-05 → Phase 17).
- Annual-prepay "save 15%" UX (Stripe default Checkout shows this; no custom code).
- Stripe Tax `automatic_tax: { enabled: true }` (research note: flag-only enable likely safe but defer for v1.2.x).
- Promo codes / `allow_promotion_codes: true` (defer until first promo campaign).
- Subscriptions admin dashboard (Phase 22).
- iOS/Android IAP (Phase 16 RevenueCat — Apple §3.1.1 + Google §3.1.1 forbid Stripe in-app).
- Cross-platform tier reconciliation (Phase 19).
- Account-deletion Stripe cascade (Phase 19).
- Pricing page UI (Phase 15 page builder).

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| MONEY-01 | `subscriptions`/`subscription_events`/`stripe_customers` tables + `stripe-webhook` Edge Function with signature verification | "Edge Function — Webhook" + "Postgres schema landmines" + "Webhook event handling" sections |
| MONEY-02 | Web user subscribes via hosted Checkout with 7-day card-required trial; auto-converts | "Checkout — Web tier" + "Trial mechanics" sections |
| MONEY-03 | Web user manages payment/cancel/plan via Customer Portal | "Customer Portal" section |
| MONEY-04 | `<TierGate>` + `tier` Zustand slice gate premium features | "Architecture Patterns" + "`tier` Zustand slice" sections |
| MONEY-05 | Clinic owner billed per-active-patient (metered) with monthly true-up | "Billing Meters (new API)" + "Active-patient counter Postgres function" sections |
| MONEY-08 | Pricing page (built by Phase 15 PAGE-09) consumes Phase 14's price IDs + `<TierGate>` | "Bootstrap script" + price ID env-var contract |
| MONEY-09 | Card failure → Smart Retries + dunning email + `past_due` banner | "Dunning flow" + "Webhook event handling" sections |

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `stripe` (Node SDK on Deno) | `19.x` via `https://esm.sh/stripe@19?target=denonext` [VERIFIED: github.com/supabase/supabase example uses `@14`; npmjs.com/package/stripe latest = 19.x as of 2026] | Stripe API client in Edge Functions | Official SDK; `target=denonext` exposes `createSubtleCryptoProvider`; supports `constructEventAsync` |
| `@supabase/supabase-js` | `2.x` (already in project) | Service-role client for `subscription_events` upsert + `subscriptions` UPDATE | Already in `share`/`clinic-invite`/`bulk-csv-export` Edge Functions |
| Postgres (Supabase managed) | 15+ | `subscriptions` / `subscription_events` / `stripe_customers` schema | Project default |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `zod` | N/A (not yet in deps) | Validate webhook event payloads before `subscription_events` insert | Optional — Stripe SDK already types `Stripe.Event`. Skip unless plan-checker insists; saves ~6 kB on Edge Function bundle. |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `esm.sh/stripe@19` | `npm:stripe@19` (Deno native npm specifier) | Both work post-`stripe@11.16`. `esm.sh` matches Supabase's canonical examples + handles tree-shaking better. Stick with `esm.sh`. |
| Billing Meters (new API) | Legacy `subscriptionItems.createUsageRecord` | **NOT AN OPTION.** Legacy API removed in API version `2025-03-31.basil` [VERIFIED]. CONTEXT D-02 phrasing is stale on this point; planner must use Meters. |
| Hosted Checkout | Stripe Elements (custom card form) | CONTEXT D-12 locks Checkout. Elements would force Phase 12's reserved `stripe-elements` ≤30 kB chunk to actually ship; we save ~30 kB gz by staying on Checkout. |

**Installation:**

```bash
# Edge Function imports (no npm install — Deno resolves via esm.sh)
# In supabase/functions/stripe-webhook/index.ts:
import Stripe from 'https://esm.sh/stripe@19?target=denonext';

# Client-side (lazy-loaded on Upgrade CTA — kept out of index chunk):
npm install @stripe/stripe-js@^4
```

**Version verification:**

```bash
npm view stripe version       # confirm latest at plan-time
npm view @stripe/stripe-js version
```

Plan-time `npm view stripe version` will likely return 19.x or 20.x — the planner should pin the exact version when writing migration plans.

## Architecture Patterns

### System Architecture Diagram

```
                                    ┌──────────────────────────────────────┐
                                    │       Stripe (external SaaS)         │
                                    │  • Checkout (hosted)                 │
                                    │  • Customer Portal (hosted)          │
                                    │  • Billing Meters (v1.billing.*)     │
                                    │  • Subscriptions / Smart Retries     │
                                    └──┬─────────────────────────────────▲─┘
                                       │                                 │
            (Stripe-Signature header)  │                                 │ stripe.checkout.sessions.create(...)
                                       │                                 │ stripe.billing.meterEvents.create(...)
                                       ▼                                 │
                          ┌─────────────────────────┐    ┌────────────────────────────┐
                          │  stripe-webhook         │    │   stripe-checkout          │
                          │  (Edge Function)        │    │   (Edge Function)          │
                          │                         │    │                            │
                          │  1. constructEventAsync │    │  1. authn caller (JWT)     │
                          │  2. INSERT … ON CONFLICT│    │  2. ensure stripe_customer │
                          │     event_id DO NOTHING │    │  3. create session         │
                          │  3. apply state machine │    │     - mode=subscription    │
                          │     to subscriptions    │    │     - 2 line_items (clinic)│
                          └────┬────────────────────┘    │     - 1 line_item (web)    │
                               │ (admin client)          │     - trial_period_days=7  │
                               ▼                         │     - subscription_data.   │
                          ┌─────────────────────────┐    │       metadata             │
                          │  Postgres (Supabase)    │    └──────────┬─────────────────┘
                          │                         │               │
                          │  subscriptions          │◄──RLS─────────│
                          │  subscription_events    │               │ (returns session.url)
                          │  stripe_customers       │               │
                          │  count_active_patients()│               │
                          └───────────▲─────────────┘               │
                                      │                              │
                  ┌───────────────────┴──────────────────────────────┴────────────┐
                  │                      Browser / SPA                            │
                  │                                                               │
                  │  Settings → "Upgrade" CTA ──► POST /stripe-checkout ──► redir│
                  │  Settings → "Manage subs" ──► POST /stripe-portal   ──► open │
                  │  <TierGate tier="paid">…</TierGate>  (reads useStore(s.tier))│
                  │  <PastDueBanner />                   (reads useStore(s.tier))│
                  │  tier slice <- Zustand persist <- Supabase realtime sub      │
                  └───────────────────────────────────────────────────────────────┘

  Monthly true-up cron (Vercel Cron OR Stripe `invoice.upcoming` webhook):
    For each clinic with active subscription:
      count = count_active_patients(clinic_id)
      if count > 10:
        stripe.v1.billing.meterEvents.create({
          event_name: 'active_patient',
          payload: { stripe_customer_id, value: count - 10 },
          identifier: sha256(`${clinic_id}_${YYYY-MM}`).slice(0,100),
        })
```

### Recommended Project Structure
```
supabase/
├── functions/
│   ├── stripe-checkout/
│   │   ├── index.ts            # POST handler: creates Checkout session for web or clinic
│   │   ├── index.test.ts       # Deno tests (use `<name>.test.ts` per reference_deno_test_discovery)
│   │   ├── cors.ts             # Reuse pattern from share/cors.ts (origin allowlist)
│   │   └── deno.json
│   ├── stripe-webhook/
│   │   ├── index.ts            # POST handler: constructEventAsync + state-machine apply
│   │   ├── index.test.ts       # Replay each event type fixture against handler
│   │   ├── events/             # One file per event handler, dispatched by event.type
│   │   │   ├── checkout-session-completed.ts
│   │   │   ├── subscription-updated.ts
│   │   │   ├── invoice-paid.ts
│   │   │   ├── invoice-payment-failed.ts
│   │   │   └── ...
│   │   └── deno.json
│   └── stripe-meter-true-up/   # OPTIONAL — only if Vercel Cron isn't used
│       ├── index.ts            # Cron-triggered; iterates clinics + emits meter events
│       └── deno.json
└── migrations/
    └── 20260601000001_stripe_subscriptions.sql

leanshot/
├── scripts/
│   └── stripe-bootstrap.ts     # Idempotent product+price+meter creation
├── src/
│   ├── components/billing/
│   │   ├── TierGate.tsx
│   │   ├── PaywallUpsell.tsx
│   │   ├── PastDueBanner.tsx
│   │   └── ManageSubscriptionLink.tsx
│   ├── lib/
│   │   └── billing.ts          # TierGate policy registry + getActiveTier() helper
│   └── store.ts                # Adds `tier` slice (partialized)
└── e2e/
    ├── checkout-trial-flow.spec.ts
    ├── past-due-banner.spec.ts
    └── clinic-metered-billing.spec.ts
```

### Pattern 1: Webhook Handler with Idempotency
**What:** Stripe retries failed deliveries up to 24h on non-2xx. Replays can also be triggered manually from the Dashboard. The handler MUST be idempotent on `event.id`.

**When to use:** Every webhook handler in this project.

**Example:**
```typescript
// Source: https://docs.stripe.com/webhooks + Supabase canonical example
import Stripe from 'https://esm.sh/stripe@19?target=denonext';
import { createClient } from 'npm:@supabase/supabase-js@2';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, {
  apiVersion: '2026-04-22.dahlia',
});
const cryptoProvider = Stripe.createSubtleCryptoProvider();

const admin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

Deno.serve(async (request) => {
  const signature = request.headers.get('Stripe-Signature');
  if (!signature) return new Response('missing signature', { status: 400 });

  const body = await request.text(); // RAW body REQUIRED — never JSON.parse first
  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(
      body,
      signature,
      Deno.env.get('STRIPE_WEBHOOK_SECRET')!,
      undefined,        // tolerance (default 300s)
      cryptoProvider,   // REQUIRED on Deno — uses Web Crypto SubtleCrypto
    );
  } catch (err) {
    return new Response(`bad sig: ${err.message}`, { status: 400 });
  }

  // Idempotency: INSERT ON CONFLICT DO NOTHING returns 0 rows if duplicate
  const { data: inserted, error } = await admin
    .from('subscription_events')
    .insert({ event_id: event.id, event_type: event.type, payload: event })
    .select('event_id')
    .maybeSingle();

  if (error) {
    // Postgres unique-violation = 23505 — treat as already-processed (2xx)
    if (error.code === '23505') return new Response('duplicate', { status: 200 });
    return new Response('db error', { status: 500 }); // let Stripe retry
  }

  // Dispatch state-machine update — wrapped to never throw out of the request
  try {
    await applyEvent(event, admin);
  } catch (err) {
    console.error('apply failed', err);
    return new Response('apply failed', { status: 500 }); // Stripe will retry
  }

  return new Response(JSON.stringify({ ok: true }), { status: 200 });
});
```

### Pattern 2: Checkout Session with Combined Flat + Metered Prices (Clinic)
**What:** One Checkout session, two line_items — one licensed (flat $99/mo base) + one metered (meter-backed $9/active-patient/mo). Both with `quantity: 1`. Metered price ignores quantity at invoice time; usage is reported via Billing Meters.

**When to use:** Clinic tier signup. Web tier uses a single line_item.

**Example:**
```typescript
// Source: docs.stripe.com/api/checkout/sessions/create + Stripe Node SDK v19 SessionCreateParams
const session = await stripe.checkout.sessions.create({
  mode: 'subscription',
  payment_method_collection: 'always',   // CARD REQUIRED even with trial (D-13)
  client_reference_id: clinicId,         // pass-through for Edge Function to reconcile
  success_url: `${origin}/clinic/settings?from=checkout&session_id={CHECKOUT_SESSION_ID}`,
  cancel_url:  `${origin}/clinic/settings?from=checkout_cancelled`,
  customer_email: ownerEmail,            // pre-fill (max 800 chars)
  line_items: [
    { price: Deno.env.get('STRIPE_PRICE_CLINIC_BASE')!,    quantity: 1 },
    { price: Deno.env.get('STRIPE_PRICE_CLINIC_OVERAGE')!, quantity: 1 }, // metered; qty ignored at billing
  ],
  subscription_data: {
    trial_period_days: 7,
    metadata: {
      clinic_id: clinicId,               // CRITICAL — webhook reads this to know which clinic
      provider: 'stripe',
      tier_kind: 'clinic',
    },
  },
  // Recommended: allow_promotion_codes: false (deferred per CONTEXT)
  // Recommended: automatic_tax: { enabled: false } (deferred per CONTEXT — flag-only enable later)
});
return new Response(JSON.stringify({ url: session.url }), { status: 200 });
```

Web tier is simpler — one line_item, `subscription_data.metadata.user_id` instead of `clinic_id`.

### Pattern 3: `tier` Zustand slice with partialize
**What:** Add `tier` to the persisted slice in `store.ts`. Keep `paid_until` (ISO string), `plan_id` (Stripe price ID), `provider` (`'stripe'` for v1.2; `'revenuecat'` joins in Phase 16).

**When to use:** Any component that gates on subscription state.

**Example:**
```typescript
// Source: existing src/lib/store.ts partialize pattern
// In the store create() call, add:
tier: 'free' as 'free' | 'paid' | 'past_due',
paid_until: null as string | null,
plan_id: null as string | null,
provider: null as 'stripe' | 'revenuecat' | null,

setTier: (next: { tier: 'free'|'paid'|'past_due'; paid_until?: string|null; plan_id?: string|null; provider?: 'stripe'|'revenuecat'|null }) =>
  set((s) => ({ ...s, ...next })),

// In partialize:
partialize: (s) => ({
  ...existingPartialized,
  tier: s.tier,
  paid_until: s.paid_until,
  plan_id: s.plan_id,
  provider: s.provider,
}),
```

Reads always go through single-primitive selectors: `useStore((s) => s.tier)` per CLAUDE.md anti-render-loop convention. NEVER `useStore((s) => ({ tier: s.tier, paid_until: s.paid_until }))` — that's an unstable snapshot.

### Pattern 4: `<TierGate>` with blur-upsell default
**What:** Wrapper component that either renders children (paid) or renders the children + a blur overlay + upsell card (free). Supports D-06/D-07 exceptions via `mode` prop.

**When to use:** Every premium-feature gate in v1.2.

**Example:**
```tsx
// Source: CONTEXT D-05 + Phase 13 token system (--color-warning, --color-primary-soft)
// File: leanshot/src/components/billing/TierGate.tsx
import { useStore } from '@/lib/store';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { PaywallUpsell } from './PaywallUpsell';

type GateMode = 'blur-upsell' | 'hard-block-no-ui' | 'hard-block-cta';

interface TierGateProps {
  tier: 'paid';                    // future: 'paid-yearly' etc.
  mode?: GateMode;                  // default 'blur-upsell'
  feature?: string;                 // copy: "Subscribe to unlock {feature}"
  children: React.ReactNode;
}

export function TierGate({ tier: required, mode = 'blur-upsell', feature, children }: TierGateProps) {
  const userTier = useStore((s) => s.tier);
  const reduced = useReducedMotion();

  // PAID: render normally
  if (userTier === 'paid') return <>{children}</>;
  // PAST_DUE: render normally — banner handles dunning UX; don't double-gate
  if (userTier === 'past_due') return <>{children}</>;

  // FREE: apply mode policy
  if (mode === 'hard-block-no-ui') return null;
  if (mode === 'hard-block-cta')   return <PaywallUpsell variant="cta" feature={feature} />;

  // Default: blur-upsell
  const blurClass = reduced ? 'opacity-60' : 'blur-[10px] saturate-50';
  return (
    <div className="relative">
      <div aria-hidden="true" className={`${blurClass} pointer-events-none select-none`}>
        {children}
      </div>
      <div className="absolute inset-0 flex items-center justify-center">
        <PaywallUpsell variant="overlay" feature={feature} />
      </div>
    </div>
  );
}
```

### Anti-Patterns to Avoid
- **Trusting Checkout's success_url state.** The browser may never hit `success_url` (user closes tab). Webhook `checkout.session.completed` is the source of truth — `tier` flips there, not on success-page render.
- **JSON.parse before signature verify.** `constructEventAsync` requires raw text body. Parsing first changes whitespace and breaks the HMAC.
- **`useStore((s) => ({…}))` for tier reads.** Unstable snapshot — render loop. Use one selector per primitive.
- **Hard-coding `tier === 'free'` in feature components.** Always go through `<TierGate>` so the policy registry stays the single source of truth.
- **Forgetting `cryptoProvider` arg.** On stripe-node ≥11.16 the sync `constructEvent` throws `SubtleCryptoProvider cannot be used in a synchronous context`. Use `constructEventAsync` + `createSubtleCryptoProvider()`.
- **Treating `usage_records.create` as the API.** Removed in `2025-03-31.basil`. Use `stripe.v1.billing.meterEvents.create`.
- **Storing `tier='past_due'` while user is offline.** `partialize` already persists it — that's correct. The bug is if a webhook can't reach the client; rely on Supabase realtime + a periodic `/api/me/tier` refresh on app boot.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Webhook signature verification | Custom HMAC-SHA256 over Stripe-Signature header | `stripe.webhooks.constructEventAsync(...cryptoProvider)` | Tolerance window, timing-safe compare, signature-rotation handling are all wired |
| Idempotency dedup logic | App-level cache | Postgres `UNIQUE(event_id)` on `subscription_events` + `INSERT … ON CONFLICT DO NOTHING` | Survives Edge Function cold-start, multi-instance, Stripe retries 24h after the fact |
| Dunning retry schedule | Cron job re-charging failed invoices | Stripe Smart Retries (Dashboard → Billing → Subscriptions and emails settings) | Stripe re-tries 1/3/5/7 days configurable; emails users automatically |
| Trial expiry detection | Cron checking `paid_until` | `customer.subscription.trial_will_end` webhook (fires 3 days before) | Stripe handles timezone/clock-drift; sends 3-day notice automatically |
| Customer Portal | Custom cancel / change-plan UI | Stripe-hosted Customer Portal (`stripe.billingPortal.sessions.create`) | PCI scope avoidance; Stripe owns the UI; one-line server integration |
| Metered usage aggregation | App-side counter | `stripe.v1.billing.meterEvents.create` with `aggregate_usage='sum'` on the meter | Stripe owns the period bucket math; idempotency via `identifier` field |
| Price ID storage | Hard-coded constants | Env vars + `scripts/stripe-bootstrap.ts` (CONTEXT D-11) | Different IDs per Stripe account (test vs live vs preview branch) |
| Refund / proration math | Custom calculator | Stripe Customer Portal "Change plan" handles proration; webhook receives `customer.subscription.updated` with `proration_details` | Tax + multi-currency edge cases are nightmare-fuel |

**Key insight:** Stripe's product surface is *intentionally* opinionated — they want you to use Checkout + Portal + Smart Retries + Meters. Every "I'll just build this myself" save here is a PCI scope + churn lever later. Phase 14 should write ZERO custom payment UI.

## Runtime State Inventory

Phase 14 is greenfield monetization — no rename/refactor of existing runtime state. Confirmed by:
- **Stored data:** None — `subscriptions` / `subscription_events` / `stripe_customers` are net-new tables.
- **Live service config:** Stripe account exists from Phase 12 (Connect Express scaffold). Products + prices + meters created idempotently by `scripts/stripe-bootstrap.ts` (D-11). Webhook endpoint URL must be registered in Stripe Dashboard → Webhooks. Customer Portal config must be created/enabled in Dashboard → Settings → Billing → Customer Portal.
- **OS-registered state:** None.
- **Secrets/env vars:** NEW secrets needed in both Vercel (client-side public price IDs) AND Supabase Function secrets (server-side):
  - `STRIPE_SECRET_KEY` (Supabase only)
  - `STRIPE_WEBHOOK_SECRET` (Supabase only)
  - `STRIPE_PRICE_PLUS_MONTHLY` (both)
  - `STRIPE_PRICE_PLUS_YEARLY` (both)
  - `STRIPE_PRICE_CLINIC_BASE` (Supabase only — Edge Function builds session)
  - `STRIPE_PRICE_CLINIC_OVERAGE` (Supabase only)
  - `STRIPE_METER_ACTIVE_PATIENT` (Supabase only — meter ID for meterEvents.create)
  - `VITE_STRIPE_PUBLISHABLE_KEY` (Vercel only — never goes server-side)
- **Build artifacts:** None.

## Common Pitfalls

### Pitfall 1: Legacy `usage_records` API is gone
**What goes wrong:** Plan-time code references `stripe.subscriptionItems.createUsageRecord` which returns 404 on API version `2025-03-31.basil` and newer.
**Why it happens:** CONTEXT D-02 was drafted before Stripe deprecated the legacy API. Most older Stack Overflow + tutorial content shows the legacy path.
**How to avoid:** Use `stripe.v1.billing.meterEvents.create({event_name, payload: {stripe_customer_id, value}, identifier})` against a Billing Meter created by `stripe.billing.meters.create({event_name, customer_mapping: {type: 'by_id', event_payload_key: 'stripe_customer_id'}, default_aggregation: {formula: 'sum'}, value_settings: {event_payload_key: 'value'}})`.
**Warning signs:** Plan files referencing `subscriptionItems.createUsageRecord`, `usage_records`, or `aggregate_usage='last_during_period'`.

### Pitfall 2: Webhook signature verification on Deno without cryptoProvider
**What goes wrong:** `stripe.webhooks.constructEvent` (synchronous) throws `SubtleCryptoProvider cannot be used in a synchronous context` in Deno runtime.
**Why it happens:** Deno has no Node `crypto` module. Stripe SDK falls back to Web Crypto, which is async-only.
**How to avoid:** Always use `constructEventAsync` AND pass `Stripe.createSubtleCryptoProvider()` as 5th arg. Pattern in webhook example above.
**Warning signs:** Test fails locally with "synchronous context" error; production webhook returns 400 on every event.

### Pitfall 3: Reading `request.json()` before signature verification
**What goes wrong:** Signature verification fails on every event — appears to be a "bad webhook secret" issue but is actually body-mutation.
**Why it happens:** `request.json()` consumes the body stream and re-serializes whitespace differently. HMAC is over the EXACT bytes Stripe sent.
**How to avoid:** Always `await request.text()` once, pass that to `constructEventAsync`, THEN access `event.data.object` for parsed JSON.
**Warning signs:** Stripe CLI `stripe trigger ...` test events fail with 400 "No signatures found matching".

### Pitfall 4: `payment_method_collection: 'always'` vs `'if_required'`
**What goes wrong:** User signs up for "7-day free trial," never enters card, trial expires, no charge happens, churn looks fine in analytics but revenue is zero.
**Why it happens:** Default `payment_method_collection` on Checkout subscription mode is `if_required` (matches old "no card required" UX). With this setting + `trial_period_days=7`, Stripe skips card collection during trial.
**How to avoid:** Set `payment_method_collection: 'always'` explicitly. CONTEXT D-13 SC #1 enforces this.
**Warning signs:** E2E `checkout-trial-flow.spec.ts` passes Checkout without entering card; no `payment_method` on the resulting subscription.

### Pitfall 5: Customer Portal return URL allow-list
**What goes wrong:** Click "Manage subscription" → opens Portal → user clicks "Return to LeanShot" → blank page or 404.
**Why it happens:** Stripe Customer Portal requires return URLs be added to the Dashboard allow-list (Settings → Billing → Customer Portal → Default redirect URL OR Allowed domains). Vercel preview deploys with random subdomains will break.
**How to avoid:** (1) In `stripe.billingPortal.sessions.create({ return_url })` always pass the production `app.leanshot.app` URL or the current request origin verified against an allow-list in the Edge Function. (2) Add `app.leanshot.app` + `*.vercel.app` to the Dashboard Portal config.
**Warning signs:** Portal session returns "redirect URL is invalid" error in webhook logs.

### Pitfall 6: Confusing Stripe statuses with UX states
**What goes wrong:** Stripe has 8 subscription statuses (`incomplete`, `incomplete_expired`, `trialing`, `active`, `past_due`, `canceled`, `unpaid`, `paused`). App tries to model all of them and gets confused.
**Why it happens:** Stripe's state machine is real; ours doesn't have to mirror it 1:1.
**How to avoid:** Collapse to 3 UX states (CONTEXT landmine #5):
- `active` + `trialing` → `tier='paid'`
- `past_due` + `unpaid` → `tier='past_due'`
- `canceled` (after `current_period_end`) + `incomplete_expired` + missing row → `tier='free'`
- `incomplete` (initial 23h auth window) → `tier='free'` (don't grant access until first invoice paid)
- `paused` → `tier='free'` (we don't pause; if it shows up it's a Dashboard action)
**Warning signs:** `if (sub.status === 'trialing')` branches in app code — that's a leak of the Stripe state machine into UI.

### Pitfall 7: `prorations` proration on Customer Portal plan change
**What goes wrong:** User on monthly $12.99 switches to yearly $132.49 → expects a $132.49 charge → sees $119.50 (with $12.99 monthly remainder prorated). Customer-support tickets.
**Why it happens:** Default `proration_behavior: 'create_prorations'` on the Portal config.
**How to avoid:** Either (a) accept proration as Stripe's default-correct behavior (recommended for v1.2) or (b) set `proration_behavior: 'none'` on the Portal config feature. Option (a) is fine if banner copy reads "You'll be credited for unused time".
**Warning signs:** Support ticket pattern "I expected to be charged $X but only $Y".

### Pitfall 8: Trial without card = $0 invoice = no `invoice.paid` event
**What goes wrong:** Webhook logic gates "grant access" on `invoice.paid` → trial users never get access.
**Why it happens:** Trials issue a $0 invoice that finalizes but doesn't fire `paid` because there was nothing to pay.
**How to avoid:** Grant `tier='paid'` on `checkout.session.completed` AND `customer.subscription.created` with `status in ('trialing', 'active')`. Don't gate on invoice.paid.
**Warning signs:** New trial users see `tier='free'` in app despite Stripe Dashboard showing `trialing` subscription.

### Pitfall 9: Meter event timestamps must be within current billing period
**What goes wrong:** Monthly true-up runs on the 1st of the month, tries to report usage for the period that just closed → Stripe rejects with "timestamp out of range".
**Why it happens:** `meter_events.timestamp` must be within past 35 days AND ≤5 min in future. There's a grace window of "a few minutes into the new period" but it's not guaranteed.
**How to avoid:** Report usage BEFORE the period closes — listen for `invoice.upcoming` (fires 3+ days before period end by default; configurable) and emit meter events then.
**Warning signs:** Meter true-up Edge Function logs `400 timestamp out of range`.

### Pitfall 10: Lazy-loading Stripe.js bundles into the index chunk
**What goes wrong:** Phase 12 reserved a `stripe-elements` ≤30 kB chunk; importing `@stripe/stripe-js` statically blows the index ceiling.
**Why it happens:** `import Stripe from '@stripe/stripe-js'` is hoisted to the entry chunk by Vite unless dynamically imported.
**How to avoid:** Dynamic-import in the Upgrade CTA handler:
```typescript
const handleUpgrade = async () => {
  const { loadStripe } = await import('@stripe/stripe-js'); // chunk split here
  const stripe = await loadStripe(import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY);
  // ... or simpler: just window.location.href = sessionUrl
};
```
Even simpler: skip `@stripe/stripe-js` entirely and use plain `window.location.href = session.url`. Hosted Checkout doesn't need the JS SDK; redirect via plain URL keeps bundle truly tiny.
**Warning signs:** `assert-bundle-budget.sh` fails after MERGE with index ≥50 kB gz; chunk inspector shows `stripe-js` baked into entry.

## Code Examples

### Bootstrap script (idempotent product + price + meter creation)
```typescript
// Source: docs.stripe.com/api/billing/meter + docs.stripe.com/products-prices
// File: leanshot/scripts/stripe-bootstrap.ts
import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: '2026-04-22.dahlia' });

async function ensureProduct(name: string, description: string) {
  const existing = await stripe.products.list({ limit: 100 });
  const found = existing.data.find((p) => p.name === name);
  if (found) return found;
  return stripe.products.create({ name, description });
}

async function ensurePrice(productId: string, lookupKey: string, params: Stripe.PriceCreateParams) {
  const existing = await stripe.prices.list({ lookup_keys: [lookupKey], limit: 1, active: true });
  if (existing.data[0]) return existing.data[0];
  return stripe.prices.create({ ...params, product: productId, lookup_key: lookupKey });
}

async function ensureMeter(eventName: string, displayName: string) {
  const existing = await stripe.billing.meters.list({ limit: 100 });
  const found = existing.data.find((m) => m.event_name === eventName);
  if (found) return found;
  return stripe.billing.meters.create({
    display_name: displayName,
    event_name: eventName,
    customer_mapping: { type: 'by_id', event_payload_key: 'stripe_customer_id' },
    default_aggregation: { formula: 'sum' },
    value_settings: { event_payload_key: 'value' },
  });
}

(async () => {
  // Web product
  const plus = await ensureProduct('LeanShot Plus', 'Web subscription — premium features');
  const plusMonthly = await ensurePrice(plus.id, 'plus_monthly_v1', {
    currency: 'usd', unit_amount: 1299, recurring: { interval: 'month' },
  });
  const plusYearly = await ensurePrice(plus.id, 'plus_yearly_v1', {
    currency: 'usd', unit_amount: 13249, recurring: { interval: 'year' },
  });

  // Clinic product
  const clinic = await ensureProduct('LeanShot Clinic', 'Clinic operator subscription');
  const clinicBase = await ensurePrice(clinic.id, 'clinic_base_v1', {
    currency: 'usd', unit_amount: 9900, recurring: { interval: 'month' },
  });
  const meter = await ensureMeter('active_patient', 'Active patient');
  const clinicOverage = await ensurePrice(clinic.id, 'clinic_overage_v1', {
    currency: 'usd', unit_amount: 900,
    recurring: { interval: 'month', usage_type: 'metered', meter: meter.id },
  });

  console.log('Add these to .env.example + Vercel + Supabase Function secrets:');
  console.log(`STRIPE_PRICE_PLUS_MONTHLY=${plusMonthly.id}`);
  console.log(`STRIPE_PRICE_PLUS_YEARLY=${plusYearly.id}`);
  console.log(`STRIPE_PRICE_CLINIC_BASE=${clinicBase.id}`);
  console.log(`STRIPE_PRICE_CLINIC_OVERAGE=${clinicOverage.id}`);
  console.log(`STRIPE_METER_ACTIVE_PATIENT=${meter.id}`);
})();
```

### Meter event recording (monthly true-up)
```typescript
// Source: docs.stripe.com/api/billing/meter-event
// File: supabase/functions/stripe-meter-true-up/index.ts (or invoke from cron / invoice.upcoming handler)
async function reportActivePatientUsage(stripeCustomerId: string, clinicId: string, count: number) {
  const periodMarker = new Date().toISOString().slice(0, 7); // 'YYYY-MM'
  const identifierRaw = `${clinicId}_${periodMarker}`;
  const identifier = await sha256Hex(identifierRaw); // hash for stable 64-char hex (well under 100-char limit)

  await stripe.v1.billing.meterEvents.create({
    event_name: 'active_patient',
    payload: {
      stripe_customer_id: stripeCustomerId,
      value: String(Math.max(0, count - 10)), // overage only — base includes 10
    },
    identifier, // de-dup key; Stripe rejects duplicate identifier in rolling 24h
  });
}
```

### Postgres schema (subscriptions + events + customers + active-patient function)
```sql
-- Source: CONTEXT D-01..D-10 + reference_supabase_migration_gotchas
-- File: supabase/migrations/20260601000001_stripe_subscriptions.sql
-- API version is opaque to schema; webhook handler pins it.

CREATE TABLE stripe_customers (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  stripe_customer_id text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE clinic_stripe_customers (
  clinic_id uuid PRIMARY KEY REFERENCES clinics(id) ON DELETE CASCADE,
  stripe_customer_id text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE subscriptions (
  id text PRIMARY KEY,                                    -- stripe sub_xxx ID
  provider text NOT NULL CHECK (provider IN ('stripe','revenuecat')),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,    -- web
  clinic_id uuid REFERENCES clinics(id) ON DELETE CASCADE,     -- clinic
  status text NOT NULL,                                   -- stripe status verbatim
  ux_tier text NOT NULL CHECK (ux_tier IN ('free','paid','past_due')),
  plan_id text,                                           -- stripe price ID
  current_period_end timestamptz,
  trial_end timestamptz,
  cancel_at_period_end boolean NOT NULL DEFAULT false,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((user_id IS NULL) <> (clinic_id IS NULL))       -- exactly one
);
CREATE INDEX idx_subscriptions_user ON subscriptions(user_id) WHERE user_id IS NOT NULL;
CREATE INDEX idx_subscriptions_clinic ON subscriptions(clinic_id) WHERE clinic_id IS NOT NULL;
-- ☝ Partial index on a column reference is IMMUTABLE — safe per reference_supabase_migration_gotchas Pitfall 1.

CREATE TABLE subscription_events (
  event_id text PRIMARY KEY,                              -- stripe evt_xxx — UNIQUE = idempotency
  event_type text NOT NULL,
  payload jsonb NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  processing_error text
);
CREATE INDEX idx_subscription_events_type_received ON subscription_events(event_type, received_at DESC);

-- RLS
ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE stripe_customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE clinic_stripe_customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscription_events ENABLE ROW LEVEL SECURITY; -- service-role only; no policies

CREATE POLICY "users read own sub" ON subscriptions FOR SELECT
  USING (auth.uid() = user_id
      OR (clinic_id IS NOT NULL AND EXISTS (
         SELECT 1 FROM clinic_memberships m
         WHERE m.clinic_id = subscriptions.clinic_id
           AND m.user_id = auth.uid()
           AND m.role IN ('owner','admin'))));
CREATE POLICY "users read own customer" ON stripe_customers FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "clinic admins read clinic customer" ON clinic_stripe_customers FOR SELECT
  USING (EXISTS (SELECT 1 FROM clinic_memberships m
                 WHERE m.clinic_id = clinic_stripe_customers.clinic_id
                   AND m.user_id = auth.uid()
                   AND m.role IN ('owner','admin')));

-- Active-patient counter
-- SECURITY DEFINER required to count across patients — owner can't see all patient rows directly.
-- search_path includes extensions per reference_supabase_migration_gotchas Pitfall 2.
CREATE OR REPLACE FUNCTION count_active_patients(p_clinic_id uuid)
RETURNS integer
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, extensions
STABLE
AS $$
  SELECT COUNT(DISTINCT m.user_id)::integer
  FROM clinic_memberships m
  WHERE m.clinic_id = p_clinic_id
    AND m.status = 'active'
    AND m.role = 'patient'
    AND EXISTS (
      SELECT 1 FROM injections i WHERE i.user_id = m.user_id AND i.created_at > now() - interval '30 days'
      UNION ALL SELECT 1 FROM weights w WHERE w.user_id = m.user_id AND w.created_at > now() - interval '30 days'
      UNION ALL SELECT 1 FROM meals me WHERE me.user_id = m.user_id AND me.created_at > now() - interval '30 days'
      UNION ALL SELECT 1 FROM workouts wo WHERE wo.user_id = m.user_id AND wo.created_at > now() - interval '30 days'
      UNION ALL SELECT 1 FROM symptoms s WHERE s.user_id = m.user_id AND s.created_at > now() - interval '30 days'
      LIMIT 1
    );
$$;
REVOKE ALL ON FUNCTION count_active_patients(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION count_active_patients(uuid) TO service_role;
```

## State of the Art

### Pricing recommendation: $12.99/mo, $132.49/yr for LeanShot Plus

**Comparable consumer-health subscription apps (verified 2026 pricing):**

| App | Audience | Monthly | Annual (effective monthly) | Annual savings |
|-----|----------|---------|---------------------------|----------------|
| MyFitnessPal Premium | General nutrition | $19.99 | $79.99 ($6.67/mo) | 67% |
| MyFitnessPal Premium+ | Premium nutrition + meal planning | $24.99 | $99.99 ($8.34/mo) | 67% |
| Cronometer Gold | Premium nutrition + biometrics | $10.99 | $59.99 ($4.99/mo) | 55% |
| Carb Manager Premium | Keto + GLP-1-adjacent biometrics | $8.49 | $39.99 ($3.33/mo) | 61% |
| MeAgain (GLP-1 specific) | GLP-1 tracker | $10.00 | n/a | n/a |
| Shotsy (GLP-1 specific) | GLP-1 tracker | n/a | $39.99 ($3.33/mo) | n/a |
| Noom (paired program) | Behavioral coaching | $17.42 (with 12-mo plan) | varies | varies |
| WeightWatchers GLP-1 | Tracker + med program | $199+ | (med-bundled) | n/a |

[VERIFIED: 8 sources — see Sources section]

**Analysis:**
- LeanShot's headline value (drug-level projection + site rotation) is **niche-deeper than Cronometer Gold** ($10.99) — pharmacology is specialty content the general trackers don't offer.
- LeanShot is **broader than pure GLP-1 trackers** (Shotsy $3.33/mo, MeAgain $10/mo) — we offer body comp, meal logging, AI coach, clinic share — which justifies a premium over the single-feature trackers.
- MyFitnessPal Premium at $19.99/mo is the ceiling — they have brand recognition + 10-year-old food DB; LeanShot can't match that anchor.
- **$12.99/mo positions LeanShot:**
  - 18% above Cronometer Gold (justified by GLP-1 specialty)
  - 35% below MyFitnessPal Premium (positioning as "focused premium tracker, not all-encompassing")
  - 30% above MeAgain (justified by AI coach + body comp + clinic share)
- **$132.49/yr (15% off = $10.97/mo effective):** competitive with Cronometer Gold annual ($4.99/mo) for the premium-feature tier while preserving margin.

**Why NOT $9.99/mo:**
- $9.99 anchors LeanShot at "freemium toy" rather than "specialty tracker."
- Trial conversion math: at $12.99 you absorb ~30% trial-conversion-rate loss vs $9.99 but earn 30% more per converter — net flat. Higher anchor signals quality.
- LTV at $12.99 × 18mo retention = $234; at $9.99 = $180. The 30% LTV gap funds a real growth-marketing budget per WAU.

**Recommended Stripe price values:**
- `STRIPE_PRICE_PLUS_MONTHLY`: $12.99 → `unit_amount: 1299`
- `STRIPE_PRICE_PLUS_YEARLY`: $132.49 → `unit_amount: 13249` (15.0% off $155.88 sticker)

If pricing must hedge: ship $12.99 day-1, plan a $9.99 A/B variant for v1.3 once we have ~500 trial conversions baseline.

### Stripe API evolution context

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `stripe.subscriptionItems.createUsageRecord` | `stripe.v1.billing.meterEvents.create` | API version `2025-03-31.basil` | **Phase 14 MUST use new API**; CONTEXT D-02 wording is stale |
| `recurring.usage_type='metered'` + no meter | `recurring.usage_type='metered'` + `recurring.meter=meter_xxx` | Same | All new metered prices MUST be backed by a Meter |
| `constructEvent` (sync) on any runtime | `constructEventAsync` + `cryptoProvider` on Deno/edge | stripe-node `11.16.0` (2022) | Sync version unusable in Deno; always use async on Edge Functions |
| `cancel_at_period_end: true` set via app code | Customer Portal "Cancel" button toggles this; app reads webhook | n/a | App should NEVER directly mutate `cancel_at_period_end`; trust the Portal flow |
| Idempotency via `Idempotency-Key` header on meter events | Idempotency via `identifier` field on the meter event | Billing Meters launch | Header still works for most endpoints; for meter_events the `identifier` field is the canonical de-dup |

**Deprecated/outdated:**
- Stripe API `2025-02-24.acacia` and older — last version supporting legacy `usage_records`. Don't pin to it.
- Stripe SDK ≤ v10 — no `target=denonext` build; no `constructEventAsync`.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `stripe@19.x` is the latest stable on esm.sh at plan time | Standard Stack | Low — version verifier in plan-time will catch; pin exact version then |
| A2 | Stripe API version `2026-04-22.dahlia` is stable + current | Pattern 1 | Low — version is named in current Customer Portal docs; planner can re-verify with `stripe -v` |
| A3 | One Checkout session supports licensed + metered prices in `line_items` (each with `quantity: 1`) | Pattern 2 + Pitfall 1 | MEDIUM — official docs are oblique on this; Stripe-node TypeScript types allow it, openmeter.io blog confirms, but worth a SANDBOX TEST in Wave 0 before relying. If wrong, fallback is: Checkout creates subscription with base only → webhook `customer.subscription.created` handler immediately calls `stripe.subscriptionItems.create({subscription, price: overage_price_id})` to add the metered item. |
| A4 | `count_active_patients()` returns within Edge Function timeout (10-30s) for clinics with ≤500 patients | Postgres schema | Low — index on `(user_id, created_at)` on the 5 activity tables makes this O(N_active_patients × log(N_writes)); plan-checker should require a perf gate spec |
| A5 | Stripe Customer Portal's default proration behavior is acceptable v1.2 UX | Pitfall 7 | Low — well-documented Stripe default; can be tightened later via Dashboard config |
| A6 | The `tier` Zustand slice surviving offline + lapsing without sync is acceptable per CONTEXT landmine #6 | Pattern 3 | Low — explicitly documented in CONTEXT |
| A7 | Web tier monthly $12.99 is defensible against churn — assumes our value prop carries vs Cronometer/MFP | State of the Art | MEDIUM — this is a market-positioning call. Worth user confirmation before bootstrap script bakes the value in. Fast iteration possible (`scripts/stripe-bootstrap.ts` can create new prices and roll legacy ones to inactive in minutes). |
| A8 | Vercel Cron can replace dedicated `stripe-meter-true-up` Edge Function | Project Structure (optional) | Low — both options viable; planner picks based on cron availability in current Vercel plan |
| A9 | `payment_method_collection: 'always'` works with `trial_period_days: 7` to enforce card-required trial | Pitfall 4 | Low — explicitly verified in Stripe docs + SDK types |
| A10 | Stripe-node v19 `billing.meterEvents.create` lives at `stripe.v1.billing.meterEvents.create` (with `v1` namespace) | Pattern 1 + meter-event code | MEDIUM — context7 showed `stripe.v2.billing.meterEventSession.create` for high-throughput AND `stripe.v1.billing.meterEvents.create` for standard. Confirm at plan-time by checking generated TypeScript types after `import Stripe from '...stripe@19'`. If the path differs, just remove the `v1.` prefix. |

## Open Questions

1. **Vercel Cron vs `invoice.upcoming` webhook for monthly true-up trigger**
   - What we know: Both work; `invoice.upcoming` fires 3+ days before period end, Vercel Cron is deterministic on a schedule.
   - What's unclear: Whether the current Vercel plan supports Cron, or if it's a paid upgrade.
   - Recommendation: Default to `invoice.upcoming` webhook (no plan dependency); have planner audit Vercel cron availability before locking.

2. **Should `stripe_customers` and `clinic_stripe_customers` be one polymorphic table or two?**
   - What we know: CONTEXT says "stripe_customers" singular; clinic membership is different domain.
   - What's unclear: Whether keeping them split simplifies RLS or complicates queries.
   - Recommendation: Two tables (RLS is simpler; the alternative needs a CHECK on exactly-one-of two FKs and complicates lookup-by-id).

3. **Confirm price `lookup_keys` strategy in bootstrap script**
   - What we know: Stripe supports `lookup_keys` for idempotent price lookup.
   - What's unclear: Whether bootstrap should rotate `lookup_key` on price changes (e.g., `plus_monthly_v2` after a $12.99→$14.99 raise) or always create a new price+archive old.
   - Recommendation: Version the lookup_key (`plus_monthly_v1`) — natural pricing-history record + no surprise reactivations of old prices.

4. **Sandbox-confirm A3 (combined line_items at Checkout)**
   - What we know: Stripe docs are ambiguous; SDK TypeScript types allow it.
   - What's unclear: Whether the Checkout UI cleanly displays a metered line item ("billed monthly based on usage" label) or whether it gets weird.
   - Recommendation: Plan Wave 0 includes a 30-min sandbox check — call `checkout.sessions.create` with 2 line_items, copy the URL, see what renders. If UI is bad, fall back to A3's workaround (add metered item via subscriptions.create in webhook handler).

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Stripe SDK (Deno via esm.sh) | Edge Functions | ✓ | `stripe@19.x` | — |
| `@stripe/stripe-js` (browser SDK) | OPTIONAL (only if not using plain redirect) | ✗ (not installed) | — | Plain `window.location.href = session.url` — recommended |
| Supabase CLI | Migrations + Function deploy | ✓ (Phase 5+ pattern) | varies | — |
| Stripe CLI | Local webhook tunneling for tests | ⚠ (unconfirmed locally) | — | Use Stripe Dashboard "Send test webhook" UI |
| Stripe test mode account | E2E tests | ✓ (Phase 12 scaffold) | — | — |
| Stripe Connect Express vendor account | NOT REQUIRED for Phase 14 (Phase 19 owns) | ✓ (Phase 12 scaffold) | — | — |
| Stripe live mode (prod) | Production go-live | ⚠ (depends on Phase 12 vendor approval state) | — | If not approved → ship test-mode webhook + Checkout for staging; defer prod go-live decision to phase close |
| Supabase Function secrets API | Storing STRIPE_SECRET_KEY etc. | ✓ | — | — |
| Vercel env vars | VITE_STRIPE_PUBLISHABLE_KEY + price IDs | ✓ | — | — |
| Vercel Cron | OPTIONAL true-up scheduling | ⚠ (plan-dependent) | — | `invoice.upcoming` webhook |

**Missing dependencies with no fallback:**
- None.

**Missing dependencies with fallback:**
- Stripe CLI local tunneling → Dashboard "Send test webhook"
- Vercel Cron → `invoice.upcoming` webhook

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework (web) | Vitest 4.1.5 (existing) + Playwright (e2e specs) |
| Framework (Edge Functions) | Deno test (existing pattern per `reference_deno_test_discovery`) |
| Config file (web) | `leanshot/vite.config.ts` (test inside) |
| Config file (Edge) | `supabase/functions/<name>/deno.json` (existing pattern) |
| Quick run command | `npm run test -- billing` + `cd supabase/functions/stripe-webhook && deno test --allow-all` |
| Full suite command | `npm run test && npx playwright test && cd supabase/functions && deno test --allow-all -r` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| MONEY-01 | Webhook verifies signature, dedups by event.id | unit | `cd supabase/functions/stripe-webhook && deno test --filter signature` | ❌ Wave 0 |
| MONEY-01 | Webhook upserts subscription on `customer.subscription.updated` | unit | `cd supabase/functions/stripe-webhook && deno test --filter subscription_updated` | ❌ Wave 0 |
| MONEY-01 | Replayed webhook (same event.id) returns 200 + no state change | unit | `cd supabase/functions/stripe-webhook && deno test --filter idempotent` | ❌ Wave 0 |
| MONEY-01 | RLS: cross-tenant SELECT on `subscriptions` returns empty | integration | `npm run test -- subscriptions-rls-impersonation` (project rule per [reference_supabase_project]) | ❌ Wave 0 |
| MONEY-02 | Web user → Checkout → 7-day trial → returns with `tier='paid'` | e2e | `npx playwright test e2e/checkout-trial-flow.spec.ts` | ❌ Wave 0 |
| MONEY-02 | Trial converts at day 8 (Stripe test clock advance) | e2e | `npx playwright test e2e/checkout-trial-flow.spec.ts -g 'day 8'` | ❌ Wave 0 |
| MONEY-03 | "Manage subscription" → Portal opens → user changes plan → `tier` reflects in 10s | e2e | `npx playwright test e2e/portal-plan-change.spec.ts` | ❌ Wave 0 |
| MONEY-04 | `<TierGate tier="paid">` renders blur+upsell when `tier='free'` | unit | `npm run test -- TierGate.test.tsx` | ❌ Wave 0 |
| MONEY-04 | `<TierGate tier="paid" mode="hard-block-no-ui">` renders nothing when `tier='free'` | unit | `npm run test -- TierGate.test.tsx -g 'hard-block-no-ui'` | ❌ Wave 0 |
| MONEY-05 | Clinic adds 11th patient → next `invoice.upcoming` records overage=1 | e2e | `npx playwright test e2e/clinic-metered-billing.spec.ts` | ❌ Wave 0 |
| MONEY-05 | Meter event with same `identifier` rejected as duplicate | unit | `cd supabase/functions/stripe-meter-true-up && deno test --filter dedup` | ❌ Wave 0 |
| MONEY-05 | `count_active_patients()` excludes inactive memberships + ghost patients | unit | `npm run test -- count-active-patients.sql.test` (pgTAP or migration test) | ❌ Wave 0 |
| MONEY-08 | Live price IDs exposed via `VITE_STRIPE_PRICE_*` env vars | smoke | grep CI for env var presence in `.env.example` + Vercel + Supabase secrets | ❌ Wave 0 (shell test) |
| MONEY-09 | Card-fails → `invoice.payment_failed` → `tier='past_due'` → `<PastDueBanner>` renders | e2e | `npx playwright test e2e/past-due-banner.spec.ts` | ❌ Wave 0 |
| MONEY-09 | Card-recovery → `invoice.paid` → `tier='paid'` → banner clears | e2e | `npx playwright test e2e/past-due-banner.spec.ts -g 'recovery'` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `npm run lint && npm run test -- <changed area>` + relevant Deno test
- **Per wave merge:** `npm run test && cd supabase/functions && deno test --allow-all -r` (skip Playwright; ~30s)
- **Phase gate:** Full suite green incl. all Playwright specs (with Stripe test clock fixtures)

### Wave 0 Gaps
- [ ] `leanshot/src/components/billing/TierGate.test.tsx` — covers MONEY-04
- [ ] `supabase/functions/stripe-webhook/index.test.ts` + `supabase/functions/stripe-webhook/events/*.test.ts` — covers MONEY-01
- [ ] `supabase/functions/stripe-checkout/index.test.ts` — covers MONEY-02 server-side
- [ ] `leanshot/e2e/checkout-trial-flow.spec.ts` — covers MONEY-02 end-to-end
- [ ] `leanshot/e2e/portal-plan-change.spec.ts` — covers MONEY-03
- [ ] `leanshot/e2e/past-due-banner.spec.ts` — covers MONEY-09
- [ ] `leanshot/e2e/clinic-metered-billing.spec.ts` — covers MONEY-05 (needs Stripe test clock + fixture meter events)
- [ ] `leanshot/tests/sql/count-active-patients.test.sql` — covers `count_active_patients()` SQL function (consider pgTAP)
- [ ] `leanshot/tests/rls/subscriptions-impersonation.test.ts` — covers project RLS rule per `reference_supabase_project`
- [ ] Stripe test clock fixture seed scripts in `e2e/fixtures/stripe/` (test clock setup + advance helpers)
- [ ] Wave 0 must also confirm A3 sandbox test (combined line_items renders cleanly in Checkout)

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | Supabase Auth JWT verified in `stripe-checkout` Edge Function (caller authn) |
| V3 Session Management | yes | Stripe Customer Portal owns the auth session for billing surface; app uses `stripe.billingPortal.sessions.create` (5-min link) |
| V4 Access Control | yes | RLS on `subscriptions` (owner/admin for clinic; user for web). Cross-tenant impersonation proof test per project rule. |
| V5 Input Validation | yes | Webhook handler validates `event.type` against allow-list; `event.data.object` type-narrowed before applying state. CONTEXT clinic_id only trusted from `subscription_data.metadata` (set server-side, not user-supplied). |
| V6 Cryptography | yes | NEVER hand-roll HMAC; always `stripe.webhooks.constructEventAsync` + `createSubtleCryptoProvider()`. Webhook secret rotated via Stripe Dashboard. |
| V7 Error Handling | yes | Webhook returns generic 4xx/5xx; never echoes Stripe error strings (Phase 8 share function pattern). |
| V8 Data Protection | yes | Never log `event.data.object` (contains PII). Log `event.id` + `event.type` only. |
| V9 Communications | yes | All Stripe API calls over TLS (Stripe SDK default). |
| V10 Malicious Code | n/a | No file uploads in Phase 14. |
| V11 Business Logic | yes | Trial expiry enforced server-side (Stripe owns clock); app trusts `subscriptions.current_period_end` from webhook, not client-derived. |
| V12 Files/Resources | n/a | — |
| V13 API + Web Service | yes | Webhook endpoint is POST-only; rejects non-POST; rejects missing/invalid signature. |
| V14 Configuration | yes | `STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET` in Supabase Function secrets only (never in client bundle, never in code). `VITE_STRIPE_PUBLISHABLE_KEY` is the only Stripe key in browser. |

### Known Threat Patterns for Stripe + Supabase Edge Function

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Webhook signature forgery | Spoofing | `constructEventAsync` HMAC verify; reject on failure |
| Replay attack (re-deliver old event) | Tampering | UNIQUE `event_id` on `subscription_events`; ON CONFLICT DO NOTHING |
| Cross-tenant subscription read (user A reads user B's billing) | Information disclosure | RLS policy on `subscriptions`; live cross-tenant impersonation proof test |
| Metadata injection (client sets fake `clinic_id`) | Tampering | `subscription_data.metadata.clinic_id` is set in the Edge Function (server-side), never from client request body |
| Customer Portal session theft | Spoofing/Elevation | Portal session URL is short-lived (5 min default); served via `target="_blank"` window; `return_url` Allow-list in Dashboard |
| Meter event injection (clinic A reports clinic B's usage) | Tampering | Meter Edge Function looks up `stripe_customer_id` from DB by clinic owner JWT; never trusts caller-supplied customer ID |
| Trial-abuse account-cycling | Repudiation | Stripe `Radar` rules (default-on); webhook fires `radar.early_fraud_warning` for review |
| Information leak via webhook logs | Information disclosure | Log only `event.id` + `event.type`, never full payload |
| Secret leak via accidentally-committed `.env` | Configuration | `.gitignore` covers `.env*`; Vercel + Supabase Function secrets are the live store; `.env.example` only holds placeholders |
| Plan-change race (user changes plan, webhook arrives out of order) | Race | Stripe events have monotonic `created` field; reject if incoming event.created < subscriptions.updated_at |

## Project Constraints (from CLAUDE.md)

**From `leanshot/CLAUDE.md`** (root project conventions):

- **TypeScript strict mode** enabled; `noUnusedLocals` + `noUnusedParameters` + `noFallthroughCasesInSwitch` + `noUncheckedSideEffectImports` all on. All new files must compile clean.
- **Path alias `@/*` → `./src/*`** — always import via `@/lib/billing` not `../../lib/billing`.
- **No router** — settings page modal is opened via store-controlled view selector. New billing screens follow this pattern (or live as Settings sub-views).
- **Persisted state via `partialize`** — `tier`/`paid_until`/`plan_id`/`provider` MUST be added to the partialize allowlist in `store.ts`.
- **No hard-coded colors** in components — use Phase 13 design tokens (`var(--color-warning)` for past_due banner, `var(--color-primary)` for upsell CTA).
- **`prefers-reduced-motion` gating** — `<TierGate>` blur transition respects `useReducedMotion()` hook.
- **One-primitive-per-selector convention** — `useStore((s) => s.tier)` not `useStore((s) => ({ tier: s.tier, paid_until: s.paid_until }))`. ESLint rule `no-restricted-syntax` blocks the unstable-selector pattern.
- **No new dependencies that ship in the index chunk** — Phase 12 set bundle ceilings; new bundle additions go through `sync-defer.ts` deferred init.
- **Edge Function home is `/Users/karstenhaldan/minisite/supabase/functions/`** — NOT under `leanshot/`. Migrations at `/Users/karstenhaldan/minisite/supabase/migrations/`.
- **Test file naming for Deno** — `<name>.test.ts` (NOT `<name>-test.ts` per `reference_deno_test_discovery` memory).
- **`s.user!` non-null assertions are a known anti-pattern** (Phase 23 cleanup) — new code in Phase 14 MUST use defensive checks (`if (!s.user) return null;`).
- **Parallel executor commits use pathspec** — `git commit -- <file>` not `git add . && git commit` (per `feedback_parallel_executor_git_isolation`).

## Sources

### Primary (HIGH confidence)
- [Context7 `/stripe/stripe-node` v19.1.0](https://context7.com/stripe/stripe-node) — SessionCreateParams, billing.meterEvents, Stripe init pattern
- [Stripe Docs — Receive webhook events](https://docs.stripe.com/webhooks) — signature verification + replay handling
- [Stripe Docs — Create Checkout Session API](https://docs.stripe.com/api/checkout/sessions/create) — line_items limit (20 recurring), subscription_data shape
- [Stripe Docs — Configure free trials on Checkout](https://docs.stripe.com/payments/checkout/free-trials) — `trial_period_days` + `payment_method_collection`
- [Stripe Docs — Using webhooks with subscriptions](https://docs.stripe.com/billing/subscriptions/webhooks) — event types + recommended state transitions
- [Stripe Docs — Migrate to billing meters](https://docs.stripe.com/billing/subscriptions/usage-based-legacy/migration-guide) — confirms legacy `usage_records` removed
- [Stripe Docs — Record usage for billing (new Meters API)](https://docs.stripe.com/billing/subscriptions/usage-based/recording-usage) — meter event creation
- [Stripe Docs — Billing Meter API ref](https://docs.stripe.com/api/billing/meter) + [meter_events ref](https://docs.stripe.com/api/billing/meter-event/create) — `identifier` as idempotency key
- [Stripe Docs — Customer Portal integration](https://docs.stripe.com/customer-management/integrate-customer-portal) — return URL + allowed actions
- [Stripe Docs — Set up flat fee and overages](https://docs.stripe.com/billing/subscriptions/usage-based-v1/use-cases/flat-fee-and-overages) — confirms two-price subscription pattern
- [Stripe Docs — Integration security guide](https://docs.stripe.com/security/guide) — official CSP guidance
- [Stripe Docs — Changelog basil deprecation](https://docs.stripe.com/changelog/basil/2025-03-31/deprecate-legacy-usage-based-billing) — usage_records removal
- [Supabase canonical stripe-webhook Edge Function](https://github.com/supabase/supabase/blob/master/examples/edge-functions/supabase/functions/stripe-webhooks/index.ts) — Deno + cryptoProvider pattern
- [Stripe Node Deno example](https://github.com/stripe/stripe-node/blob/master/examples/webhook-signing/deno/main.ts) — `constructEventAsync` call shape

### Secondary (MEDIUM confidence)
- [Cronometer Gold 2026 pricing](https://nutriscan.app/blog/posts/cronometer-pricing-2026-basic-vs-gold-vs-pro-b28e621201) — $10.99/mo monthly / $4.99/mo annual
- [MyFitnessPal 2026 pricing](https://nutriscan.app/blog/posts/myfitnesspal-pricing-2026-guide-2ff09c399a) — Premium $19.99/$79.99, Premium+ $24.99/$99.99
- [Carb Manager Premium](https://www.carbmanager.com/premium/) — $8.49/mo / $39.99/yr
- [SimplePractice + Healthie 2026 pricing](https://costbench.com/software/telehealth/simplepractice/) — clinic comparable anchor ($69-99/provider/mo)
- [6 Best GLP-1 Tracking Apps 2026](https://learnmuscles.com/blog/2025/11/27/6-best-glp-1-tracking-apps-compared-which-app-actually-works-in-2026/) — MeAgain $10/mo, Shotsy $39.99/yr

### Tertiary (LOW confidence — verified via secondary check)
- [HamsterStack Stripe metered billing guide 2026](https://hamsterstack.com/how-to/stripe/implement-usage-based-billing/) — sanity-check on `identifier` field usage (confirmed against official docs)
- [OpenMeter blog on usage-based pricing with Stripe](https://openmeter.io/blog/implementing-usage-based-pricing-with-stripe) — confirmed combined line_items pattern (but planner should sandbox-confirm per A3)
- [DEV.to CSP cheat sheet for third-party scripts](https://dev.to/sitesecurityscore/csp-for-third-party-scripts-the-practical-cheat-sheet-for-ga-stripe-intercom-and-more-1gh8) — supplementary CSP domain list

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — Stripe SDK version + Supabase canonical pattern both verified
- Architecture: HIGH — every component maps to verified Stripe docs + project conventions
- Pitfalls: HIGH — 10 pitfalls each tied to a specific verified source
- Pricing recommendation: MEDIUM — based on 4 verified 2026 pricing comparables but ultimately a market-positioning call (user confirmation warranted before bootstrap)
- Validation: HIGH — Wave 0 list explicit; Stripe test clock + fixture meter events are proven patterns

**Research date:** 2026-05-13
**Valid until:** 2026-06-13 (Stripe API moves quickly — re-verify version pins if planning slips past this)
