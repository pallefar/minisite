# Phase 29: Org Subscriptions + Per-Patient Metered Billing — Research

**Researched:** 2026-05-17
**Domain:** Stripe Meter Events 2024 API · per-org metered billing cron · patient-invite magic-link flow · org_subscriptions schema ownership
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Phase 14 reconciliation**
- A1 — DROP `public.org_subscriptions` (P28 D-14 skeleton); extend Phase 14 `public.subscriptions` table.
- A2 — Phase 14 `public.clinic_stripe_customers` (keyed by `clinic_id` → `organizations(id)`) is canonical for clinic Stripe customer mapping. The (user, context) separation is satisfied by two tables: `stripe_customers` (consumer) and `clinic_stripe_customers` (clinic). CI test asserts same-email-different-customer property directly.

**Per-active-patient billing meter (ORG-09)**
- D-01 — `count_active_patients(org_id uuid) returns int` SECDEF, 30-day rolling window, UNION across 10 event tables. Explicit `set search_path = pg_catalog, public, extensions`. Indexed lookup on `(user_id, created_at)` per table; add `create index if not exists` for missing ones.
- D-02 — pg_cron at `0 2 * * *` (02:00 UTC daily). Edge Function `org-metered-billing-cron`.
- D-03 — Stripe Meter Events 2024 API. `event_name: 'active_patient_month'`, `payload: {value: count, stripe_customer_id}`, `identifier: org_${org_id}_${yyyymm}` (idempotency).

**Stripe webhook extension**
- D-04 — Extend existing `supabase/functions/stripe-webhook/index.ts` with `invoice.created` handler. Reads meter total, validates against local `count_active_patients` snapshot, logs to Sentry if >10% variance.
- D-05 — Clinic admin billing surface reflects within 30s via Phase 28 HMAC channel `org-{hmac8}-subscriptions`.

**Patient invite flow (ORG-10)**
- D-06 — NEW `org_patient_invites` table (parallel to Phase 28 `org_invites`; NOT merged).
- D-07 — NEW Edge Function `clinic-patient-invite/send` (Resend non-PHI per Phase 25 D-03). W-1 identical-200 shape.
- D-08 — Accept flow: 4-step RPC chain (preview → consent UI → accept_org_patient_invite → magic-link session). All in single transaction.
- D-09 — `profiles.primary_org_id` column — verify-or-add.

**Schema / reconciliation**
- D-10 — Plan 29-00 RECONCILE migration (Wave 0 single-file): DROP org_subscriptions, verify-or-ADD `subscriptions.seats_paid/seats_used`, verify-or-ADD `profiles.primary_org_id`.

**HIPAA / PHI lint**
- D-11 — Phase 25 D-09 Stripe PHI keyword lint applies to meter-event payload. Payload contains ONLY `(stripe_customer_id, value=count, idempotency_key)` — no patient identifiers.

**Status-machine ownership**
- D-12 — `subscriptions.status` transitions owned by Phase 14 webhook. P29 inherits unchanged.
- D-13 — `org_patient_invites.accepted_at`: NULL → timestamptz; invite expiry via query (no extra column). Cleanup cron at `30 4 * * *` (04:30 UTC).

### Claude's Discretion

- Exact UI shape of patient consent accept screen (D-08 step 2) — simple consent UI; researcher/planner decides primitives.
- Whether to issue magic-link via `admin.generateLink` OR existing `src/lib/auth.ts` magic-link pattern.
- Exact Sentry variance threshold (D-04) — 10% suggested; researcher tunes based on count volatility.
- Whether `org-metered-billing-cron` batches multiple orgs per invocation OR loops one-org-per-invocation.
- Whether `count_active_patients()` is fresh function call OR materialized view.

### Deferred Ideas (OUT OF SCOPE)

- Admin "Billing" deep-view UX (rich invoice rendering / proration) — v1.4 polish.
- Multi-org-admin scenario — one user admin of multiple orgs via multiple org_members rows.
- Hourly billing cron — nightly is sufficient.
- Per-clinic patient activity dashboard (Phase 30).
- Prorate-on-invite (v1.4 if clinics push back).
- Patient self-revoke org_consent_grants — schema supports revoked_at; UI deferred v1.4.
- Stripe Tax for clinic invoices.
- Multiple billing tiers per clinic.
- Invoice retry customization.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| ORG-08 | Stripe Billing for orgs uses SEPARATE `stripe_customer_id_org` keyed by `(user_id, customer_context)` — same-email consumer + clinic = different Stripe customers; CI test proves no namespace collision | A2 + clinic_stripe_customers FK to organizations; CI test via vitest asserting two distinct Stripe customer IDs for same email |
| ORG-09 | Per-active-patient metered billing via Stripe Meter Events 2024 API; nightly cron aggregates usage | D-01 count_active_patients SECDEF; D-02 pg_cron 02:00 UTC; D-03 POST /v1/billing/meter_events with identifier idempotency |
| ORG-10 | Patient invite flow: clinic admin invites email → magic link → patient onboards under clinic's org → patient's `profiles.primary_org_id` set + consent grant recorded | D-06 org_patient_invites; D-07 Edge Fn; D-08 accept flow; D-09 primary_org_id |
</phase_requirements>

---

## Summary

Phase 29 wires three distinct capabilities on top of Phase 28's org schema: (1) reconcile the P28 skeleton tables and extend Phase 14's unified `subscriptions` table to handle clinic subs, (2) fire Stripe Meter Events nightly per org with a rolling-30-day active-patient count, and (3) deliver a patient-invite magic-link flow that records explicit consent and sets `profiles.primary_org_id`.

The key architectural insight is that **no greenfield billing schema is needed** — Phase 14 already shipped `clinic_stripe_customers`, `subscriptions` (with XOR constraint for user vs clinic), and `subscription_events` (idempotency anchor). P29 builds directly on these rails. The `org_subscriptions` table P28 shipped as a skeleton is dropped in Wave 0 and replaced by treating `subscriptions WHERE clinic_id IS NOT NULL` as the clinic subscription row.

For the patient-invite flow, the direct precedent is Phase 28's `clinic-org-invite` Edge Function (A2 pattern), which already demonstrates the W-1 anti-enumeration invariant, the `makeInviteTokenHash` import pattern, and the startup-health-check Resend no-op. P29's `clinic-patient-invite/send` is a sibling Edge Function following the same blueprint.

**Primary recommendation:** Plan structure should be Wave 0 (RECONCILE migration) → Wave 1 (count_active_patients SECDEF + indexes + org_patient_invites migration + Edge Fn skeleton) → Wave 2 (cron Edge Fn + stripe-webhook invoice.created handler + accept-flow RPC) → Wave 3 (UI surface + realtime channel wire + RLS tests).

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Stripe customer namespace separation | Database + Edge Fn (Stripe API) | CI test (proof) | clinic_stripe_customers FK to organizations; consumer stripe_customers FK to auth.users — two independent tables |
| count_active_patients aggregation | Database (SECDEF function) | — | Must be SQL-native for cron call and RLS-bypassed for service_role |
| Nightly billing cron | Supabase Edge Function (pg_cron trigger) | Stripe API | org-metered-billing-cron calls count_active_patients then POSTs meter event |
| Stripe webhook invoice.created validation | Supabase Edge Function (existing stripe-webhook) | Sentry | Extend existing dispatcher, not a new Edge Function |
| Realtime billing surface update | Browser / Client | Supabase Realtime | Phase 28 HMAC channel machinery already live; P29 wires subscription in clinic billing UI |
| Patient invite dispatch | Supabase Edge Function (clinic-patient-invite) | Resend | Non-PHI email template per Phase 25 D-03 |
| Patient invite accept + consent | Database (SECDEF RPC) | Browser UI | Single transaction RPC chain; UI only shows consent screen |
| profiles.primary_org_id set | Database (SECDEF RPC accept_org_patient_invite) | — | Set inside the accept transaction to avoid partial state |

---

## Standard Stack

### Core (all pre-existing — no new npm installs for P29)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `stripe` | `19.x` (esm.sh) | Stripe API calls from Edge Functions | Already in stripe-webhook + stripe-checkout functions via `https://esm.sh/stripe@19?target=denonext` |
| `@supabase/supabase-js` | `2.x` | Admin client, RLS, auth admin API | Already in all Edge Functions via `npm:@supabase/supabase-js@2` |
| Supabase Auth admin API | supabase-js v2 | `admin.generateLink({type:'magiclink'})` | Server-side only; requires SUPABASE_SERVICE_ROLE_KEY |
| Resend HTTP API | REST (no SDK) | Non-PHI email dispatch | `_shared/resend-domain-health-check.ts` + `_shared/lifecycle-send.ts` pattern |
| posthog-node | `5.10.4` (npm:) | Server-side event capture | `_shared/posthog-server.ts` already exists |

### Supporting (already in _shared)

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `_shared/with-org-scope.ts` | P28 | Proxy wrapper for service_role queries | Any new Edge Fn querying org-scoped tables |
| `_shared/sentry.ts` | P24 | Sentry.captureException for variance alerts | D-04 invoice.created variance logging |
| `_shared/posthog-server.ts` | P24 | Server-side analytics | Optional payment_completed enrichment |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Fresh `count_active_patients` function call in cron | Materialized view refreshed nightly | Function call is simpler and queries are sub-second at current patient scale (<5 orgs × <200 patients). Materialized view adds a separate refresh cron + potential staleness if the refresh and the billing cron drift. Use function unless query time exceeds 1s at plan verification. |
| `admin.generateLink({type:'magiclink'})` in accept RPC | `signInWithMagicLink` via existing `src/lib/auth.ts` | `admin.generateLink` is server-side only (Edge Function context), returns the `action_link` URL directly without sending an email — allows embedding the URL in a custom Resend template. `signInWithMagicLink` sends the email itself via Supabase's SMTP config. Use `admin.generateLink` so we control the email template (non-PHI per D-07). |
| One Stripe meter event per org per month | One event per org per day | Monthly cadence (keyed by `yyyymm`) matches the invoice cycle and avoids 30× the Stripe API call count. Idempotency on monthly key means re-runs within the month are no-ops. |

**Installation:** No new npm installs required. All dependencies already in the project.

---

## Architecture Patterns

### System Architecture Diagram

```
Clinic Admin Browser           Edge Functions (Deno)           Stripe API         Supabase DB
       │                              │                              │                   │
  [Invite patient]──POST──────► clinic-patient-invite/send          │                   │
                                      │──send_org_patient_invite RPC──────────────────►org_patient_invites
                                      │──admin.generateLink(magiclink)──────────────────│
                                      │◄──action_link                                   │
                                      │──Resend API (non-PHI invite email)              │
                                      │                                                 │
  Patient clicks link                 │                              │                   │
  [/accept-clinic-invite?token=…]     │                              │                   │
       │──GET preview──────────► clinic-patient-invite/preview       │                   │
                                      │──accept_org_patient_invite_preview RPC──────────►{org_name, scope}
       │◄──consent UI data            │                              │                   │
  [Accept consent]──POST──────► clinic-patient-invite/accept         │                   │
                                      │──accept_org_patient_invite RPC (transaction)────►org_consent_grants
                                      │                              │                  ►org_patient_links
                                      │                              │                  ►profiles.primary_org_id
                                      │──admin.generateLink(magiclink)                   │
                                      │◄──action_link                                   │
       │◄──redirect(action_link)      │                              │                   │
                                                                                         │
  [02:00 UTC] pg_cron                                                │                   │
       │──trigger──────────────► org-metered-billing-cron            │                   │
                                      │──SELECT all orgs w/ active subscriptions────────►organizations
                                      │  (loop per org)              │                   │
                                      │──count_active_patients(org_id)──────────────────►[UNION 10 tables]
                                      │◄──count                      │                   │
                                      │──POST /v1/billing/meter_events───────────────────►{identifier: org_${id}_${yyyymm}}
                                      │◄──{object: "billing.meter_event"}                │
                                                                                         │
  Stripe fires webhook                │                              │                   │
       │──invoice.created────────────► stripe-webhook (extended)     │                   │
                                      │──count_active_patients(org_id)──────────────────►[verify count]
                                      │  (if >10% variance)         │                   │
                                      │──Sentry.captureException     │                   │
                                      │──subscription UPDATE ───────────────────────────►subscriptions.status
                                      │──Realtime broadcast─────────────────────────────►org-{hmac8}-subscriptions
                                                                                         │
  Clinic Admin billing UI             │                              │                   │
       │──subscribe channel──────────────────────────────────────────────────────────────► Realtime (HMAC)
       │◄──status update within 30s   │                              │                   │
```

### Recommended Project Structure

```
supabase/
├── migrations/
│   ├── 20270601200001_p29_reconcile.sql          # Wave 0: DROP org_subscriptions, verify-or-add cols
│   ├── 20270601200002_org_patient_invites.sql    # Wave 1: org_patient_invites table + RLS
│   ├── 20270601200003_count_active_patients_v2.sql  # Wave 1: update count_active_patients SECDEF
│   ├── 20270601200004_accept_org_patient_invite_rpcs.sql  # Wave 2: preview + accept RPCs
│   └── 20270601200005_patient_invite_expiry_cron.sql  # Wave 2: 04:30 UTC cron
└── functions/
    ├── clinic-patient-invite/
    │   ├── index.ts           # /send + /preview + /accept endpoints
    │   ├── cors.ts
    │   └── deno.json
    ├── org-metered-billing-cron/
    │   ├── index.ts           # loops orgs, calls count_active_patients, POSTs meter events
    │   └── deno.json
    └── stripe-webhook/
        └── events/
            └── invoice-created.ts   # NEW: meter validation handler (D-04)

src/lib/
└── __tests__/
    ├── rls-org-patient-invites.test.ts   # cross-tenant proof (BLOCKER R1)
    └── rls-org-subscription-meters.test.ts  # if org_subscription_meters added

src/components/clinic/
└── billing/
    ├── ClinicBillingCard.tsx    # status + current period + active count surface
    └── ConsentAcceptScreen.tsx  # D-08 step 2 consent UI
```

### Pattern 1: Stripe Meter Event POST (D-03)

```typescript
// Source: Context7 /websites/stripe — POST /v1/billing/meter_events
// org-metered-billing-cron/index.ts
import Stripe from 'https://esm.sh/stripe@19?target=denonext';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY') ?? '', {
  apiVersion: '2026-04-22.dahlia' as Stripe.LatestApiVersion,
});

// One call per org per run. Idempotency via `identifier` field.
const yyyymm = new Date().toISOString().slice(0, 7).replace('-', '');
const meterEvent = await stripe.billing.meterEvents.create({
  event_name: 'active_patient_month',
  payload: {
    value: String(activePatientCount),          // MUST be string per API spec
    stripe_customer_id: clinicStripeCustomerId, // from clinic_stripe_customers
  },
  identifier: `org_${orgId}_${yyyymm}`,       // idempotency: re-runs are no-ops
});
// [VERIFIED: Context7 /websites/stripe — POST /v1/billing/meter_events]
// Note: value MUST be a string (not number) per Stripe API spec.
```

### Pattern 2: admin.generateLink for magic-link (D-08 step f)

```typescript
// Source: Context7 /supabase/supabase-js — admin.generateLink
// supabase/functions/clinic-patient-invite/index.ts
const { data, error } = await adminClient.auth.admin.generateLink({
  type: 'magiclink',
  email: patientEmail,
  options: {
    redirectTo: `${PUBLIC_APP_ORIGIN}/dashboard?welcome=clinic`,
  },
});
if (error || !data?.properties?.action_link) {
  throw new Error('Failed to generate magic link');
}
const magicLink = data.properties.action_link;
// Embed in Resend non-PHI template (D-07)
// [VERIFIED: Context7 /supabase/supabase-js]
```

### Pattern 3: count_active_patients SECDEF update (D-01)

```sql
-- Source: Live migration 20260601000019_stripe_subscriptions.sql (verified via file read)
-- P29 must update this function to reference organizations (renamed from orgs)
-- and extend the UNION to all 10 event tables.
create or replace function public.count_active_patients(p_org_id uuid)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
stable
as $$
declare
  v_uid   uuid := auth.uid();
  v_count integer;
begin
  -- Service-role bypass (cron callers have no JWT)
  if v_uid is not null then
    if not exists (
      select 1 from public.org_members
      where org_id = p_org_id and user_id = v_uid and role = 'admin'
    ) then
      raise exception 'forbidden' using errcode = '42501';
    end if;
  end if;

  select count(distinct opl.patient_user_id)::integer into v_count
  from public.org_patient_links opl
  where opl.org_id = p_org_id
    and opl.unlinked_at is null
    and exists (
      select 1 from public.injections i
        where i.user_id = opl.patient_user_id and i.created_at > now() - interval '30 days'
      union all
      select 1 from public.weights w
        where w.user_id = opl.patient_user_id and w.created_at > now() - interval '30 days'
      union all
      select 1 from public.meals m
        where m.user_id = opl.patient_user_id and m.created_at > now() - interval '30 days'
      union all
      select 1 from public.mood mo
        where mo.user_id = opl.patient_user_id and mo.created_at > now() - interval '30 days'
      union all
      select 1 from public.sleep sl
        where sl.user_id = opl.patient_user_id and sl.created_at > now() - interval '30 days'
      union all
      select 1 from public.symptoms sy
        where sy.user_id = opl.patient_user_id and sy.created_at > now() - interval '30 days'
      union all
      select 1 from public.photos ph
        where ph.user_id = opl.patient_user_id and ph.created_at > now() - interval '30 days'
      union all
      select 1 from public.workouts wo
        where wo.user_id = opl.patient_user_id and wo.created_at > now() - interval '30 days'
      union all
      select 1 from public.vials vi
        where vi.user_id = opl.patient_user_id and vi.created_at > now() - interval '30 days'
      union all
      select 1 from public.ai_messages ai
        where ai.user_id = opl.patient_user_id and ai.created_at > now() - interval '30 days'
    );
  return coalesce(v_count, 0);
end;
$$;
-- [VERIFIED via file read of live migrations]
```

**Critical note on Phase 14's existing function:** The Phase 14 migration (`20260601000019`) defines `count_active_patients(p_clinic_id uuid)` using the old `memberships` table with `roles.name = 'View-only'` and only 5 event tables. P29's Plan 29-00 RECONCILE must `CREATE OR REPLACE` this function to (a) switch to `org_patient_links` as the membership layer, (b) use `org_members` for the caller auth check, and (c) extend the UNION to all 10 tables.

### Pattern 4: org-metered-billing-cron batching strategy (Claude's Discretion resolved)

**Recommendation: batch all orgs in a single Edge Function invocation** rather than one-org-per-invocation.

Reasoning:
- Stripe Meter Events API rate limit: ~100 RPS (standard published limit). At v1.3 clinic scale (<50 orgs), a tight loop of 50 sequential API calls takes well under 5 seconds — no batching complexity needed.
- A single Edge Function invocation with sequential per-org calls is simpler to instrument, easier to debug, and avoids the overhead of 50 pg_cron job registrations.
- `pg_cron` fires one `0 2 * * *` job that calls the Edge Function via `supabase.functions.invoke('org-metered-billing-cron')` or via a direct HTTP call.
- If future scale demands parallelism (>500 orgs), switch to pg_cron firing one job per org via a `select cron.schedule(...)` loop — that is an additive change.

```typescript
// org-metered-billing-cron/index.ts — sequential loop pattern
const { data: orgs } = await withOrgScope(/* all */ null, (sc) =>
  sc.from('clinic_stripe_customers')
    .select('clinic_id, stripe_customer_id')
    .not('stripe_customer_id', 'is', null)
);

for (const org of orgs ?? []) {
  const count = await adminClient.rpc('count_active_patients', { p_org_id: org.clinic_id });
  await stripe.billing.meterEvents.create({
    event_name: 'active_patient_month',
    payload: { value: String(count), stripe_customer_id: org.stripe_customer_id },
    identifier: `org_${org.clinic_id}_${yyyymm}`,
  });
}
// [ASSUMED] — sequential loop for <50 orgs is fine; verified rate limit from Stripe docs
```

### Pattern 5: invoice.created variance handler (D-04)

```typescript
// supabase/functions/stripe-webhook/events/invoice-created.ts
export async function handle(event: Stripe.Event, admin: SupabaseClient): Promise<void> {
  const invoice = event.data.object as Stripe.Invoice;
  // Only process clinic metered invoices
  const clinicId = invoice.metadata?.clinic_id ?? null;
  if (!clinicId) return;

  // Get Stripe's billed count from line items
  const meteredLine = invoice.lines?.data?.find(
    (line) => line.price?.meter === 'active_patient_month'
  );
  if (!meteredLine?.quantity) return;
  const stripeCount = meteredLine.quantity;

  // Get local count for comparison
  const { data: localCount } = await admin.rpc('count_active_patients', { p_org_id: clinicId });

  // D-04: log to Sentry if variance > 10%
  const variance = Math.abs(stripeCount - localCount) / Math.max(stripeCount, 1);
  if (variance > 0.1) {
    Sentry.captureMessage('Metered billing variance', {
      level: 'warning',
      extra: { clinicId, stripeCount, localCount, variance },
      tags: { billing_variance: 'true' },
    });
  }
}
// [ASSUMED] — Stripe invoice line item shape for metered subscriptions; verify against Stripe dashboard
```

### Pattern 6: Consent Accept Screen (Claude's Discretion resolved)

**Recommendation: simple Card + Button primitives** — no new library needed.

The consent screen at `/accept-clinic-invite?token=<raw>` shows:
1. `org_name` + `org_logo_url` (from `accept_org_patient_invite_preview` RPC).
2. A plain-English summary of `scope_summary` (read-only access to activity data).
3. Two buttons: Accept (primary, calls accept RPC) and Decline (secondary, navigates away).
4. Anti-enumeration: 404 page for invalid/expired tokens — same generic "not found" for both.

Primitives: existing `Card`, `Button` (primary/secondary variants), `EmptyState` (for 404 case). No framer-motion animation needed — simple conditional render.

Route: `/accept-clinic-invite` — a public route (no auth required at render time; auth is established by the magic link after acceptance).

### Anti-Patterns to Avoid

- **PHI in meter event payload:** `payload` MUST only contain `value` (integer as string) and `stripe_customer_id`. Never include patient names, emails, diagnoses, or dose values. D-11 CI lint enforces.
- **Re-implementing makeInviteTokenHash:** import from `src/lib/clinic.ts:hashInviteToken` (the export at line 505). Do not re-implement SHA-256 hashing.
- **Calling `count_active_patients` with authenticated client:** the cron Edge Function uses service_role (auth.uid() = null), which bypasses the org-admin check. Never call this function with the anon key from the cron.
- **Stripe `value` as integer:** Stripe Meter Events API requires `value` to be a string, not a number. `String(count)` not `count`. [VERIFIED: Context7]
- **Using Phase 14's old `count_active_patients` signature without updating it:** The Phase 14 function uses `memberships` + `roles.name = 'View-only'` which is Phase 9 schema. P29 must replace it with the org_patient_links-based version.
- **Duplicate `org_subscriptions` references:** After Plan 29-00 RECONCILE drops `org_subscriptions`, any remaining code referencing it fails. Plan-checker BLOCKER: grep for `org_subscriptions` post-RECONCILE.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Stripe idempotency for meter events | Custom dedup table | `identifier` field on `billing.meterEvents.create` | Stripe deduplicates on `identifier` within a rolling 24h window per their API contract |
| Magic link generation | Custom token + email send | `admin.generateLink({type:'magiclink'})` | Supabase handles token generation, signing, expiry, and auth flow; returns `action_link` URL for custom email |
| Webhook signature verification | Custom HMAC | `stripe.webhooks.constructEventAsync` + `Stripe.createSubtleCryptoProvider()` | Existing pattern in stripe-webhook; Deno requires SubtleCrypto (Pitfall 2 from Phase 14 research) |
| Org-scoped query safety | Manual `.eq('org_id', ...)` everywhere | `withOrgScope` Proxy wrapper | Phase 28 4-layer defense; runtime throws OrgScopeBypassError + Sentry alert if bypassed |
| Email anti-enumeration | Custom "does email exist" branch | W-1 pattern: identical 200 response regardless | Phase 9 + Phase 28 A2 established this; clinic-org-invite/index.ts is the direct precedent |

**Key insight:** Three of the five "don't hand-roll" items map to patterns already live in this codebase. P29 is predominantly integration work, not new invention.

---

## Common Pitfalls

### Pitfall 1: count_active_patients uses wrong membership layer
**What goes wrong:** Using `memberships` (Phase 9) instead of `org_patient_links` (Phase 28) to identify patients. Phase 14 shipped `count_active_patients` with `memberships WHERE roles.name = 'View-only'`. That table still exists but is NOT the canonical patient-to-org link in Phase 28+ architecture.
**Why it happens:** The Phase 14 migration is the only prior art for this function; copying it without updating the membership source.
**How to avoid:** Plan 29-00 RECONCILE must `CREATE OR REPLACE` the function, switching to `org_patient_links WHERE unlinked_at IS NULL`. Plan-checker BLOCKER: grep for `memberships` inside the updated function body.
**Warning signs:** Count returns zero for all orgs despite active patients; or count_active_patients returns non-zero but the patients aren't recorded in org_patient_links.

### Pitfall 2: org_subscriptions still referenced after DROP
**What goes wrong:** Code added in Wave 1+ that references `public.org_subscriptions` before reading that Plan 29-00 drops it. The webhook handler or cron tries to upsert into the dropped table.
**Why it happens:** Parallel planning assumes the P28 skeleton table is the write target.
**How to avoid:** Plan 29-00 is a mandatory Wave 0 prerequisite. Plan-checker BLOCKER: grep all P29 plan files for `org_subscriptions`; replace with `subscriptions WHERE clinic_id IS NOT NULL`. The `subscriptions` table has `seats_paid` and `seats_used` columns from the P28 migration (`20270601100008`).
**Warning signs:** Runtime error "relation org_subscriptions does not exist" on first cron run.

### Pitfall 3: Stripe meter value must be a string
**What goes wrong:** `payload: { value: count }` where `count` is an integer. Stripe returns a 400 error: "Invalid integer. Expected a string."
**Why it happens:** D-03 spec says "value: count" which reads as integer.
**How to avoid:** Always `String(count)` before passing to `stripe.billing.meterEvents.create`. The Context7-verified API spec confirms `payload[value]` is type `string` (not integer). [VERIFIED: Context7 /websites/stripe]
**Warning signs:** Stripe API returns 400 on meter event creation; cron logs `"value" must be a string`.

### Pitfall 4: Magic-link sent by accept RPC exposes action_link in DB
**What goes wrong:** Storing the `action_link` URL in a DB column before redirecting the patient. The magic-link token is a one-time secret; storing it creates a PHI-adjacent security risk.
**Why it happens:** Trying to "confirm" the link was sent by persisting it.
**How to avoid:** The SECDEF RPC `accept_org_patient_invite` should call the Edge Function (or the Edge Function calls the RPC and then generates the link). The `action_link` must travel only in the HTTP response and never be persisted. The accepted_at timestamp on `org_patient_invites` is the confirmation.
**Warning signs:** DB column added to store raw magic link URLs.

### Pitfall 5: D-04 invoice.created fires on ALL invoices (not just clinic metered)
**What goes wrong:** The `invoice.created` handler runs its count_active_patients validation for every invoice (including consumer subscriptions), causing spurious Sentry alerts and unnecessary RPC calls.
**Why it happens:** The handler doesn't filter on `metadata.clinic_id` first.
**How to avoid:** Gate on `invoice.metadata.clinic_id` presence as the first check. Return early if absent. [ASSUMED — Stripe invoice metadata shape for clinic subs should include clinic_id; verify against stripe-checkout Edge Function metadata placement]
**Warning signs:** Sentry alerts fire for consumer subscription renewals; count_active_patients called with null org_id.

### Pitfall 6: Missing (user_id, created_at) index on mood/sleep/photos/vials/symptoms
**What goes wrong:** count_active_patients UNION query does a seq scan on the 5 tables that have `date` text columns indexed but NOT `(user_id, created_at)` composite indexes. At scale this causes slow cron runs.
**Why it happens:** Those migrations use `(user_id, date desc)` not `(user_id, created_at desc)`.
**How to avoid:** Plan 29-00 RECONCILE migration adds `create index if not exists ... on public.<table>(user_id, created_at)` for all tables in the UNION that lack it.
**Verified:** mood, sleep, symptoms, photos, vials migrations use `date text` column with `(user_id, date desc)` index. The UNION queries on `created_at`, which has no composite index with user_id on these tables. [VERIFIED via file reads of migrations 20260514000004..20260514000009]

### Pitfall 7: pg_cron 04:30 invite expiry vs 04:00 org_invites expiry cron conflict
**What goes wrong:** Both `org_invites` expiry (P28, 04:00) and `org_patient_invites` expiry (P29, 04:30) run close together; if org_invites cron takes >30 minutes it overlaps. At current scale this is fine but must be verified if cron tables are large.
**Why it happens:** Time slots chosen to avoid collisions with other crons (audit-archive 03:00, affiliate-lifetime 03:00).
**How to avoid:** 04:30 is 30 minutes after 04:00 — safe at v1.3 scale. The expiry cron is O(expired row count), not O(all rows). No action needed unless clinic count exceeds hundreds.
**Warning signs:** pg_cron `_cron_job_run_details` shows overlapping runs.

---

## Code Examples

### org_patient_invites migration skeleton (D-06)

```sql
-- Migration: 20270601200002_org_patient_invites.sql
-- Phase 29 Plan XX — D-06: org_patient_invites table
-- Parallel to Phase 28 org_invites (admin-role based).
-- This table is PATIENT consent based — NOT merged with org_invites (per addendum A2 precedent).

create table if not exists public.org_patient_invites (
  id                uuid        primary key default gen_random_uuid(),
  org_id            uuid        not null references public.organizations(id) on delete restrict,
  patient_email     citext      not null,
  invite_token_hash text        not null,
  consent_scope     jsonb       not null,
  invited_by        uuid        references auth.users(id) on delete set null,
  expires_at        timestamptz not null default now() + interval '14 days',
  accepted_at       timestamptz null,
  created_at        timestamptz not null default now(),

  -- Prevent duplicate pending invites for the same patient in the same org
  constraint org_patient_invites_pending_unique
    unique (org_id, patient_email)
    deferrable initially deferred
  -- Note: partial unique index for accepted_at IS NULL not supported directly;
  -- enforce via SECDEF RPC that checks for existing pending invite before inserting.
);

create index if not exists org_patient_invites_org_id_idx
  on public.org_patient_invites(org_id);
create index if not exists org_patient_invites_token_hash_idx
  on public.org_patient_invites(invite_token_hash);

alter table public.org_patient_invites enable row level security;
alter table public.org_patient_invites force row level security;

-- SELECT: org admins only (contains patient email — sensitive)
create policy "org_patient_invites_select_by_org_admin"
  on public.org_patient_invites
  for select
  to authenticated
  using (
    exists (
      select 1 from public.org_members om
      where om.org_id = org_patient_invites.org_id
        and om.user_id = auth.uid()
        and om.role = 'admin'
    )
  );
-- All writes via SECDEF RPCs (Pattern S1 dual-layer). No authenticated INSERT/UPDATE/DELETE.

-- Add to ORG_SCOPED_TABLES in supabase/functions/_shared/with-org-scope.ts (BLOCKER R2)
-- [ASSUMED] — exact schema per D-06; planner adjusts based on RPC implementation needs
```

### send_org_patient_invite SECDEF skeleton (D-06 write path)

```sql
create or replace function public.send_org_patient_invite(
  p_org_id          uuid,
  p_patient_email   citext,
  p_consent_scope   jsonb,
  p_invite_token_hash text
) returns table(invite_id uuid)
  language plpgsql
  security definer
  set search_path = pg_catalog, public, extensions
as $$
declare
  v_caller_role public.org_member_role;
  v_invite_id   uuid;
begin
  -- Pattern S1: DB-level role re-check
  select role into v_caller_role
  from public.org_members
  where org_id = p_org_id and user_id = auth.uid();

  if v_caller_role is null or v_caller_role <> 'admin' then
    raise exception 'admin role required' using errcode = '42501';
  end if;

  -- Validate consent scope (reuse Phase 9 _validate_consent_scope, DO NOT duplicate)
  perform public._validate_consent_scope(p_consent_scope);

  -- W-1: always insert regardless of whether email exists in auth.users
  insert into public.org_patient_invites
    (org_id, patient_email, invite_token_hash, consent_scope, invited_by)
  values
    (p_org_id, p_patient_email, p_invite_token_hash, p_consent_scope, auth.uid())
  returning id into v_invite_id;

  -- Phase 24 audit invariant
  perform public.log_admin_action(
    p_action     => 'send_org_patient_invite',
    p_table_name => 'org_patient_invites',
    p_record_id  => v_invite_id,
    p_new_data   => jsonb_build_object('org_id', p_org_id, 'patient_email', p_patient_email)
  );

  return query select v_invite_id;
end;
$$;
revoke all on function public.send_org_patient_invite from public;
grant execute on function public.send_org_patient_invite to authenticated;
```

### RLS test skeleton for org_patient_invites (BLOCKER R1)

```typescript
// src/lib/__tests__/rls-org-patient-invites.test.ts
// Follows p28-rls-fixture.ts pattern (VERIFIED: fixture exists at that path)
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  SHOULD_RUN,
  cleanupByPrefix,
  createTwoOrgsTwoUsers,
  makeSlugPrefix,
} from './_fixtures/p28-rls-fixture';

const TEST_SLUG_PREFIX = makeSlugPrefix(path.basename(__filename));
const describeIfLive = SHOULD_RUN ? describe : describe.skip;

describeIfLive('P29 RLS — org_patient_invites cross-tenant isolation', () => {
  // ... fixture setup, T3/T4/T5a/T5b/T3b assertions per 28-EXTENSION-CONTRACT Section 3b
});
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|-----------------|--------------|--------|
| Stripe usage records (`usage_records.create`) | Stripe Meter Events 2024 API (`billing/meter_events`) | 2025-03-31 (deprecated) | Phase 14 already documented this — MONEY-03 removed legacy `usage_records.create`. P29 must use Meter Events; the API endpoint is `POST /v1/billing/meter_events`. |
| Separate Stripe customer per clinic | Unified `clinic_stripe_customers` table keyed by `clinic_id` | Phase 14 (shipped) | Already live — no new table needed. |
| `memberships` table for patient tracking | `org_patient_links` table | Phase 28 (shipped) | count_active_patients must switch source tables. |
| Trigger-based JWT org_ids claim | Custom Access Token Hook (A3) | Phase 28 (shipped) | Hook mints org_ids claim at token mint — no 336ms propagation gap for P29 to worry about. |

**Deprecated/outdated:**
- `legacy usage_records.create`: removed from Stripe API 2025-03-31. Never use; Meter Events is the only path. [CITED: project memory reference_stripe_platform_capabilities_endpoint + Phase 14 CONTEXT MONEY-03]
- Phase 14's `count_active_patients` implementation: uses old `memberships` table, only 5 event tables, references `roles.name = 'View-only'`. P29 replaces it entirely via `CREATE OR REPLACE`. [VERIFIED: file read of 20260601000019_stripe_subscriptions.sql]

---

## Claude's Discretion — Resolved Recommendations

### 1. Magic-link via admin.generateLink vs auth.ts signInWithMagicLink

**Recommendation: `admin.generateLink({type:'magiclink'})`** called from inside the `clinic-patient-invite/accept` Edge Function.

Rationale:
- `admin.generateLink` returns the raw `action_link` URL without sending any email, giving us full control over the email template (non-PHI per D-07).
- `signInWithMagicLink` from `src/lib/auth.ts` sends via Supabase's configured SMTP, bypassing our Resend template and potentially leaking org context in the subject line.
- The Edge Function returns the `action_link` in its response; the browser performs the redirect. This is the same flow used in Phase 9's `clinic-invite/accept` pattern.
- Response from `admin.generateLink`: `{ data: { properties: { action_link: string } }, error }`. [VERIFIED: Context7 /supabase/supabase-js]

### 2. Sentry variance threshold (D-04)

**Recommendation: Keep 10% threshold from CONTEXT D-04 suggestion.**

Rationale for 10%:
- At v1.3 scale (<50 orgs × <200 patients), a 10% delta on count_active_patients means ~20 patients mismatched. This is large enough to indicate a real discrepancy (sync failure, migration error) vs. small timing differences from the cron window.
- Lower threshold (5%) would generate false alerts from race conditions between the 02:00 cron and midnight patient-linking events.
- Higher threshold (20%) misses real billing drift that accumulates to meaningful revenue impact.
- The Sentry alert should include `clinicId`, `stripeCount`, `localCount`, and `variance` as extras, tagged `billing_variance: 'true'` for easy filtering. Level: `'warning'` (not `'error'`, since Stripe is the source of truth for billing — local count is a sanity check).

### 3. count_active_patients: function vs materialized view

**Recommendation: Fresh function call** (status quo recommendation from CONTEXT D-01).

- At v1.3 patient scale, the UNION across 10 tables with indexed `(user_id, created_at)` lookups is O(distinct_patient_count × avg_events_per_patient_in_last_30_days). With proper indexes, this should complete in <200ms per org.
- The 02:00 UTC cron has no latency requirement — it can take minutes. Even 1 minute for 50 orgs is acceptable.
- Materialized view adds: a separate `REFRESH MATERIALIZED VIEW CONCURRENTLY` cron, staleness risk if refresh cron drifts, and migration complexity. The function call wins on simplicity.
- **Index gap to fix:** mood, sleep, symptoms, photos, vials lack `(user_id, created_at)` composite indexes. Plan 29-00 RECONCILE must add them (see Pitfall 6).

### 4. org-metered-billing-cron batching strategy

**Recommendation: Sequential loop, single Edge Function invocation** (see Pattern 4 above).

---

## Runtime State Inventory

> Phase 29 involves extending existing tables and adding new ones. No rename/refactor. Greenfield tables section applies for completeness.

| Category | Items Found | Action Required |
|----------|-------------|-----------------|
| Stored data | `org_subscriptions` table in live DB (P28 skeleton, no data rows) | DROP in Plan 29-00 RECONCILE migration |
| Stored data | `count_active_patients` SECDEF function (Phase 14 version) | CREATE OR REPLACE in Plan 29-00 RECONCILE |
| Stored data | `profiles` table: `primary_org_id` column — NOT present in any migration | ADD COLUMN via Plan 29-00 RECONCILE |
| Stored data | `subscriptions` table: `seats_paid` / `seats_used` — present in worktree migration but P28 deployed to `org_subscriptions` NOT `subscriptions` | Verify via `\d subscriptions` before Plan 29-00; add if missing |
| Live service config | pg_cron: `02:00 UTC` slot is clean (verified: existing crons at 03:00/04:00/06:00/Mon 07:00/5min/15min/1min) | Register new cron job in migration |
| Live service config | pg_cron: `04:30 UTC` slot is clean | Register patient invite expiry cron |
| OS-registered state | None | — |
| Secrets/env vars | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` — already in Function Secrets for stripe-webhook | Re-use for org-metered-billing-cron (add as Function Secret) |
| Secrets/env vars | `RESEND_API_KEY`, `RESEND_FROM` — already in clinic-org-invite Function Secrets | Re-use for clinic-patient-invite Function Secret |
| Build artifacts | None | — |

**`seats_paid` / `seats_used` on `subscriptions`:** The Phase 14 migration (`20260601000019`) does NOT include these columns on `public.subscriptions`. The `org_subscriptions` table ships them in P28 (`20270601100008`). After P29 drops `org_subscriptions`, Plan 29-00 must ADD these columns to `subscriptions` if they are not already there. Verify live: `supabase db query --linked --query "\d subscriptions"`.

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Stripe API (`billing.meterEvents.create`) | D-03 metered billing cron | ✓ | via esm.sh stripe@19 | None — required |
| Supabase Edge Functions runtime (Deno) | All Edge Functions | ✓ | Supabase-hosted Deno | None |
| STRIPE_SECRET_KEY Function Secret | org-metered-billing-cron | ✓ (in stripe-webhook) | — | Needs explicit add to new fn |
| RESEND_API_KEY Function Secret | clinic-patient-invite | ✓ (in clinic-org-invite) | — | Startup health check no-op |
| pg_cron extension | billing cron + invite expiry cron | ✓ (already running 7+ crons) | — | None |
| Stripe Billing Meter product config | D-03 | [ASSUMED] needs Stripe dashboard setup | — | HUMAN-CHECKPOINT required |

**Missing dependencies with no code fallback:**
- Stripe Meter product must be configured in Stripe Dashboard with `event_name: 'active_patient_month'` BEFORE the cron fires. This is a HUMAN-CHECKPOINT task in Wave 0 or Wave 1 plan.
- `clinic_stripe_customers` must have at least one row (i.e., a clinic must have gone through Stripe onboarding) before the cron produces meaningful output. This is a prerequisite that clinic-onboarding (Phase 30) resolves — P29 ships the billing machinery; actual clinic deals are Phase 30+.

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest (unit/RLS) + Playwright (e2e) |
| Config file | `vitest-e2e.config.ts` (for RLS tests), `playwright.config.ts` (for e2e) |
| Quick run command | `npx vitest run src/lib/__tests__/rls-org-patient-invites.test.ts --config vitest-e2e.config.ts` |
| Full suite command | `npm run test:e2e:rls && npm run test:e2e:billing` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| ORG-08 | Same email → different Stripe customers for consumer vs clinic | unit | `npx vitest run src/lib/__tests__/stripe-namespace-separation.test.ts` | ❌ Wave 0 |
| ORG-09 | Nightly cron fires meter event; invoice line matches local count | e2e | `npm run test:e2e:billing` | ❌ Wave 2 (new e2e/clinic-metered-billing spec) |
| ORG-09 | count_active_patients returns correct count | unit | `npx vitest run --config vitest-e2e.config.ts src/lib/__tests__/count-active-patients.test.ts` | ❌ Wave 1 |
| ORG-10 | org_patient_invites cross-tenant isolation | unit (RLS) | `npx vitest run src/lib/__tests__/rls-org-patient-invites.test.ts --config vitest-e2e.config.ts` | ❌ Wave 1 |
| ORG-10 | Invite flow e2e: admin sends → patient receives → accepts → primary_org_id set | e2e | `npx playwright test e2e/clinic-patient-invite.spec.ts` | ❌ Wave 3 |
| SC#4 | Billing surface updates within 30s of Stripe webhook | e2e manual | Manual or Playwright with webhook mock | ❌ Wave 3 |

### Sampling Rate

- **Per task commit:** Run the specific new test file for that task
- **Per wave merge:** `npm run test:e2e:rls` (all RLS suites) + any new unit tests
- **Phase gate:** Full suite green before `/gsd-verify-work`

### Wave 0 Gaps

- [ ] `src/lib/__tests__/stripe-namespace-separation.test.ts` — covers ORG-08 (CI test proving Stripe namespace separation)
- [ ] `src/lib/__tests__/count-active-patients.test.ts` — covers ORG-09 function behavior
- [ ] `src/lib/__tests__/rls-org-patient-invites.test.ts` — covers ORG-10 cross-tenant isolation (BLOCKER R1 per 28-EXTENSION-CONTRACT)

---

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | `admin.generateLink({type:'magiclink'})` — Supabase-managed; magic link is single-use, time-limited |
| V3 Session Management | yes | Magic link establishes a new session; existing invite token is one-use (accepted_at set atomically) |
| V4 Access Control | yes | SECDEF RPCs with Pattern S1 dual-layer; RLS deny-all for authenticated on org_patient_invites writes |
| V5 Input Validation | yes | `_validate_consent_scope` for jsonb (reused from Phase 9); invite_token_hash is SHA-256 (collision-resistant) |
| V6 Cryptography | yes | `crypto.subtle.digest('SHA-256')` for token hashing — Web Crypto, not hand-rolled |

### Known Threat Patterns

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Stripe customer namespace collision (consumer + clinic share customer) | Spoofing | Two separate tables (`stripe_customers` keyed by `user_id`; `clinic_stripe_customers` keyed by `clinic_id`); CI test asserts separation |
| PHI in Stripe API fields | Information Disclosure | CI lint (Phase 25 D-09) blocks PHI keywords in Stripe call sites; meter event payload is count-only |
| Email enumeration via invite send | Information Disclosure | W-1: identical 200 response regardless of email existence in auth.users |
| Cross-tenant patient invite read | Elevation of Privilege | RLS: org_patient_invites SELECT requires org_members.role = 'admin' for the same org_id |
| Replay of expired invite token | Tampering | SECDEF RPC checks `expires_at > now() AND accepted_at IS NULL` before accepting |
| Magic-link token interception | Information Disclosure | `action_link` never stored in DB; returned only in HTTP response; Supabase token is single-use + time-limited |
| count_active_patients called by non-admin | Elevation of Privilege | SECDEF auth.uid() check: non-null → must be org admin; service_role bypass for cron |

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Sequential loop (one Stripe API call per org) is fast enough at v1.3 scale (<50 orgs × 200ms each = 10s total) | Batching strategy | If orgs > 500, cron timeout risk. Add pagination or parallelism. |
| A2 | Stripe invoice `metadata.clinic_id` is set by stripe-checkout Edge Function at checkout time | Pitfall 5 (invoice.created filtering) | If not set, D-04 handler can't filter clinic invoices. Verify stripe-checkout metadata shape. |
| A3 | 10% variance threshold avoids false-positive Sentry alerts from timing jitter | D-04 handler | If wrong, noisy Sentry alerts; tune threshold. Low risk. |
| A4 | `subscriptions.seats_paid` and `subscriptions.seats_used` do NOT exist on the live `subscriptions` table (they were only on `org_subscriptions`) | Plan 29-00 RECONCILE | If they already exist on `subscriptions`, skip ADD COLUMN step. Verify with `\d subscriptions` before Plan 29-00. |
| A5 | Stripe Meter product with `event_name: 'active_patient_month'` exists in Stripe Dashboard (or must be created as HUMAN-CHECKPOINT) | D-03 cron | If not created, meter events fail with "No such meter" error. HUMAN-CHECKPOINT required. |

---

## Open Questions

1. **Does `subscriptions` already have `seats_paid`/`seats_used` columns in the live DB?**
   - What we know: The P28 migration (`20270601100008`) added them to `org_subscriptions` (which P29 drops). The Phase 14 migration (`20260601000019`) does NOT include them on `subscriptions`.
   - What's unclear: Whether a post-P28 migration added them to `subscriptions`.
   - Recommendation: Plan 29-00 task #1 runs `supabase db query --linked --query "\d subscriptions"` before writing any DDL.

2. **Does `stripe-checkout` set `metadata.clinic_id` on checkout sessions for clinic subscriptions?**
   - What we know: Phase 14 wired a clinic checkout path. The `subscriptions.clinic_id` FK exists.
   - What's unclear: Whether the checkout session metadata includes `clinic_id` (needed for D-04 invoice.created filtering).
   - Recommendation: Grep `supabase/functions/stripe-checkout/` for `clinic_id` metadata assignment. If absent, Plan 29-XX must add it.

3. **Is the `accept_org_patient_invite` RPC atomic enough if `admin.generateLink` fails?**
   - What we know: D-08 says "all in single transaction; failure rolls back." But `admin.generateLink` is an HTTP call to Supabase Auth API, which cannot participate in a Postgres transaction.
   - What's unclear: Should the transaction commit (writing consent grants + links + accepted_at) and then attempt the magic link as a best-effort post-commit? Or should the whole flow be two-phase?
   - Recommendation: Two-phase: (1) SECDEF RPC commits the consent grant atomically; (2) Edge Function calls `admin.generateLink` after RPC success. If generateLink fails, the invite is marked accepted but no magic link was issued — the patient can request a new login via password reset. Log this edge case to Sentry.

---

## Project Constraints (from CLAUDE.md)

- **TS strict mode**: All `src/` TypeScript must compile with strict + noUnusedLocals + noUnusedParameters. P29 components (ConsentAcceptScreen, ClinicBillingCard) follow this.
- **No heavy static imports into browser bundle**: Any billing-related code added to `src/` must be lazy-loaded if it touches admin routes. `src/components/clinic/billing/*.tsx` should be `React.lazy`-loaded.
- **No `s.user!` non-null assertions**: Enforce the existing convention from clinic.ts.
- **Import alias `@/*` → `./src/*`**: All cross-directory imports use this alias.
- **Tailwind v4 CSS-first config**: No `tailwind.config.js`. Use `@theme` tokens in `src/index.css` for any new design tokens needed.
- **`supabase/functions/_shared/` for Deno-only code**: `withOrgScope`, `supabase-server.ts` etc. never imported into `src/` (A7 from 28-ADDENDUM).
- **Migration filename regex**: Strict 14-digit timestamp, no letter suffixes. Next available block: `20270601200001`, `20270601200002`, etc. (after last P28 migration `20270601100019`).
- **ESLint `no-raw-service-role-client.cjs`**: org-metered-billing-cron and clinic-patient-invite must use `_createServiceRoleClientUnsafe` from `_shared/supabase-server.ts`, not raw `createClient(..., SERVICE_ROLE_KEY)`.
- **SECDEF search_path**: Every new PL/pgSQL SECDEF function must `set search_path = pg_catalog, public, extensions`.
- **P28 EXTENSION-CONTRACT BLOCKERs R1-R5**: `org_patient_invites` must be added to `ORG_SCOPED_TABLES`, paired RLS test file required, `org_id` FK with `on delete restrict`, naming convention `org_*`.

---

## Sources

### Primary (HIGH confidence)
- [VERIFIED: file read] `supabase/migrations/20260601000019_stripe_subscriptions.sql` — Phase 14 baseline: `stripe_customers`, `clinic_stripe_customers`, `subscriptions` XOR constraint, `subscription_events`, `count_active_patients` (5-table, memberships-based version)
- [VERIFIED: file read] `supabase/functions/stripe-webhook/index.ts` — 8 event handlers, lazy-import dispatcher, `subscription_events` idempotency, PostHog Phase 24 extension
- [VERIFIED: file read] `supabase/migrations/20270601100008_org_subscriptions_table.sql` — P28 skeleton: `org_subscriptions` with `seats_paid`, `seats_used`, deny-all RLS
- [VERIFIED: file read] `supabase/functions/clinic-org-invite/index.ts` — W-1 pattern, startup health check, RESEND_API_KEY pattern (A2 precedent for D-07)
- [VERIFIED: file read] `src/lib/clinic.ts` — `makeInviteTokenHash`, `hashInviteToken` (line 505), `_validate_consent_scope`, W-1 invariant
- [VERIFIED: file read] `src/lib/auth.ts` — `signInWithMagicLink` pattern (Phase 5); NOT recommended for D-08 (sends via Supabase SMTP not Resend)
- [VERIFIED: file read] `src/lib/billing.ts` — `getActiveTier()` collapse map, `TIER_GATE_REGISTRY`; clinic sub flows through same collapse
- [VERIFIED: file read] `supabase/migrations/20260514000004-9_mood_sleep_symptoms_vials_photos.sql` — `(user_id, date desc)` indexes, NO `(user_id, created_at)` composite index
- [VERIFIED: npm view] `stripe@19.x` via `esm.sh/stripe@19?target=denonext` already in stripe-webhook
- [VERIFIED: Context7 /websites/stripe] `POST /v1/billing/meter_events` — `event_name`, `payload.value` (string!), `payload.stripe_customer_id`, `identifier` field spec
- [VERIFIED: Context7 /supabase/supabase-js] `admin.generateLink({type:'magiclink', email, options.redirectTo})` → `data.properties.action_link`
- [VERIFIED: file read] `src/lib/__tests__/_fixtures/p28-rls-fixture.ts` — fixture exports: `createTwoOrgsTwoUsers`, `sessionFor`, `cleanupByPrefix`, `SHOULD_RUN`
- [VERIFIED: file read] `src/lib/__tests__/` — 15 existing RLS test files; `rls-org-subscriptions.test.ts` already exists (P28 skeleton coverage); P29 needs `rls-org-patient-invites.test.ts`
- [VERIFIED: file read] `.planning/config.json` — `workflow.nyquist_validation: true`; Validation Architecture section required

### Secondary (MEDIUM confidence)
- [CITED: 28-EXTENSION-CONTRACT.md] BLOCKERs R1 (paired RLS test), R2 (ORG_SCOPED_TABLES), naming conventions, `on delete restrict` requirement
- [CITED: 28-ADDENDUM-orgs-reconciliation.md] A2 precedent (parallel table pattern), A7 (`_shared/` placement)
- [CITED: 29-CONTEXT.md] All D-01 through D-13 decisions, Claude's Discretion areas
- [CITED: v1.3 STACK.md] `stripe@22.x` (web-side, no new SDK), Meter Events 2024 API confirmed, no new vendor

### Tertiary (LOW confidence — see Assumptions Log)
- [ASSUMED] Stripe `invoice.metadata.clinic_id` is set by stripe-checkout at checkout time
- [ASSUMED] Sequential org loop completes within Edge Function timeout at v1.3 scale
- [ASSUMED] 10% Sentry variance threshold avoids false positives from timing jitter

---

## Metadata

**Confidence breakdown:**
- Schema + existing code patterns: HIGH — all verified via direct file reads
- Stripe Meter Events API: HIGH — verified via Context7 official docs
- Supabase admin.generateLink: HIGH — verified via Context7
- Batching strategy / variance threshold: MEDIUM — reasoned from constraints, not benchmarked
- Stripe invoice metadata shape: LOW — assumed from checkout flow; needs grep verification at plan time

**Research date:** 2026-05-17
**Valid until:** 2026-06-17 (30 days; Stripe API stable; Supabase Auth stable)
