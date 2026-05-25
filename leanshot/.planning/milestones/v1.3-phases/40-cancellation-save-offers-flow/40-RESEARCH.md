# Phase 40: Cancellation Save-Offers Flow - Research

**Researched:** 2026-05-21
**Domain:** Stripe subscription lifecycle (pause/resume/coupon stacking), cohort-aware offer recommendation, save-offer ROI analytics, modular admin UI
**Confidence:** HIGH (Stripe APIs verified via Context7 + docs.stripe.com; codebase patterns verified by inspection)

---

## Summary

Phase 40 implements the canonical "cancellation save-flow" pattern: reason-first picklist, server-picked single offer, then a loss-summary confirmation. Almost every load-bearing decision (offer types, eligibility gating, anti-gaming caps, clinic-org fork, coupon catalog, 3-step funnel UX, A/B variant pattern, ROI dashboard reuse) is locked in CONTEXT D-01..D-22 — research's job is to **validate the Stripe-API assumptions baked into those decisions** and to **resolve the open D-15 stacking-abuse choice**.

Three findings dominate everything else and MUST shape the plan:

1. **Webhook event mismatch (HIGH severity correction to CONTEXT D-11).** CONTEXT says "handle `customer.subscription.paused` / `customer.subscription.resumed`". Stripe's docs (verified two ways) explicitly state these events fire **only for the new `/v1/subscriptions/:id/pause` and `/resume` endpoints, NOT for `pause_collection`**. Since D-06 locks `pause_collection({behavior:'void', resumes_at})`, the correct webhooks to handle are `customer.subscription.updated` (already wired) — the handler must be extended to detect `pause_collection` state transitions on this existing event. Planner must NOT add new case-arms for the `.paused`/`.resumed` event types as written in CONTEXT; instead, extend `events/subscription-updated.ts` to mirror `pause_collection` into local `subscriptions.paused_until` / `is_paused`.
2. **Stripe natively supports multiplicative coupon stacking** via `subscriptions.discounts[]` (verified). 10% affiliate + 25% save-offer = 0.9 × 0.75 = 67.5% of list price (matches CONTEXT D-14 verbatim). NO custom math needed — append the new save-offer coupon to the existing `discounts` array. Hard limit: max 20 discounts; each must be unique; cannot stack a coupon with a promo-code derived from the same coupon.
3. **D-15 stacking-abuse mitigation recommendation: option (b) — server-side cap at 35% combined effective discount.** Rationale below in the dedicated section. Cheapest mitigation; preserves legitimate referral-stack UX; explicit user notice via UI-SPEC stacking-notice strip.

**Primary recommendation:** Build the dispatcher extension on the EXISTING `subscription-updated` handler (no new case-arms for `.paused`/`.resumed`), apply save-offer coupons via `discounts[]` append (NOT replace), implement D-15 as a 35% combined-effective server clamp in `cancellation-decide-offer`, and ship the 6 plans in the wave structure pre-computed in STATE.md.

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Eligibility (POLISH-01):**
- **D-01** Tenure gating: `<30d` = pause+discount only; `30–180d` = all 4 offers; `>180d` = pause+discount+downgrade (NO extended-trial). Tenure measured from `subscriptions.created_at` (Stripe).
- **D-02** Anti-gaming caps: 2 lifetime takes per user. Pause is EXEMPT from the cap. Discount + extended-trial + downgrade each count.
- **D-03** 12-month cooldown between save-offer takes; enforced via `cancellation_offers_log.last_taken_at`.
- **D-04** Clinic-orgs see DIFFERENT offer set: CSM-contact card + discount only. NO pause, NO extended-trial, NO downgrade.
- **D-05** Cohort-aware offer assignment via admin `save_offer_rules` table (cohort_id × offer_type × percent_off × duration × active).

**Pause mechanics (POLISH-03):**
- **D-06** 1/2/3-month pause presets only. Use Stripe `subscriptions.update({ pause_collection: { behavior:'void', resumes_at } })`.
- **D-07** READ-ONLY access during pause (existing data visible; new logging disabled).
- **D-08** Auto-resume billing on `resumes_at`.
- **D-09** T-7d reminder email + T-0 day-of confirmation via `_shared/email-router.ts` (Resend non-PHI consumer; SES for clinic-org PHI).
- **D-10** Pause-while-paused via T-7d email is permitted; counts as a new pause-take (so 3mo + 1mo-extend → pause-take #2 of 2-lifetime).
- **D-11** Handle Stripe webhooks for paused/resumed via dispatcher (P14 + P26 D-08 pattern: new case arms BEFORE default). **NOTE — research overrides D-11 wording:** see Standard Stack §"Stripe webhook event-name correction".

**Discount stacking (POLISH-04):**
- **D-12** Pre-created Stripe coupon pool: `SAVE-{20,25,30}-{2,3}MO`.
- **D-13** 6 fixed combos; admin assigns one per cohort/rule.
- **D-14** Save-offer discount STACKS multiplicatively with affiliate coupons.
- **D-15** OPEN — planner picks one of 3 stacking-abuse mitigations. **Research recommends option (b) — 35% combined-effective cap.**
- **D-16** Discount applies to NEXT invoice (Stripe `duration:'repeating', duration_in_months:N`); no prorated refund.

**Modal UX (POLISH-01):**
- **D-17** Three-step flow — reason → server-picked single offer → loss-summary.
- **D-18** Step 1 = 6-reason picklist + Other (free-text), captured BEFORE offers shown.
- **D-19** Step 2 = server-picks ONE offer via `cancellation-decide-offer` Edge Fn (cold-start hardcoded; warm-start Bayesian over historical take-rates).
- **D-20** Step 3 = loss-summary card (streak + curve thumbnail + AI coach count + CSV-export reminder).
- **D-21** Service-quality-issue reason auto-creates a P37 helpdesk ticket AFTER cancellation completes.
- **D-22** A/B variants via PostHog Experiments + Ship-Winner (P34 D-20 pattern).

### Claude's Discretion (research recommendations follow)
- ROI dashboard layout (POLISH-02): admin `/admin/cancellation/roi`; metrics offer-shown / offer-accepted / lifetime-revenue-recovered. Reuses P33 admin-CAC Chart.js pattern.
- Recommendation algorithm details: cold-start hardcoded reason→offer; warm-start Bayesian over cohort-take-rates. No ML in v1.3.
- Downgrade offer mechanics: Annual → Monthly primary path.
- `cancellation_offers_log` schema beyond required columns.

### Deferred Ideas (OUT OF SCOPE)
- Custom-date pause picker (1/2/3-mo presets only in v1.3).
- Per-cohort save-offer ML model (defer to v1.4 once data accumulates).
- Stripe webhook subscription pause/resume HUMAN-UAT (planner adds Task in 40-02).
- Downgrade offer for clinics (D-04 excludes).
- Reactivation flow polish (current re-signup UX applies).
- Production-grade fraud detection (D-15 ships the cheapest mitigation only).
- Dunning save-flow on `invoice.payment_failed` (separate v1.4 flow; reuses coupon catalog).
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| POLISH-01 | Cancellation flow with save-offers (pause / downgrade / discount / extended-trial); user clicks Cancel → modal offers one of 4 (per eligibility rules) | "Architecture Patterns" 3-step modal pattern; "cancellation-decide-offer" Edge Fn schema (§Code Examples); cohort-tenure-reason resolution table; D-19 single-offer-server-pick lookup logic |
| POLISH-02 | `cancellation_offers_log` records offer-take rate per offer-type per cohort; admin sees offer-take ROI analysis | Append-only log-table pattern (§Standard Stack `cancellation_offers_log` schema); P33 admin-CAC dashboard tile reuse; SQL view vs matview decision (§ROI Analytics Architecture) |
| POLISH-03 | Pause subscription (1/2/3 months) returns user to active billing on resume date | Stripe `pause_collection` mechanics (§Architecture Patterns); webhook event-name correction (§Standard Stack); T-7d cron + T-0 confirmation pattern (§Code Examples); read-only-during-pause UI gating |
| POLISH-04 | Discount save-offer (20%-30% off for 2-3 months) applies as Stripe coupon | Pre-created 6-coupon catalog seed (§Code Examples); `subscriptions.discounts[]` array append (NOT replace) for multiplicative stacking (D-14); D-15 cap mitigation (§D-15 Recommendation) |
</phase_requirements>

---

## Project Constraints (from CLAUDE.md + memory)

| Constraint | Source | Impact on Phase 40 |
|------------|--------|---------------------|
| Local-first SPA: must work without account/offline | `leanshot/CLAUDE.md` | Cancellation modal must gracefully no-op for non-cloud-synced users (they have no Stripe subscription); the Settings → Cancel button only shows for users with a `subscriptions` row. |
| React 19 + Vite 6 + TS strict + Tailwind v4 + Zustand only | CLAUDE.md | No new client packages introduced (UI-SPEC verified — uses existing primitives). |
| Code-split aggressively via `React.lazy()` | CLAUDE.md + `reference_phase5_bundle_regression` | `CancellationModal.tsx` MUST be lazy-loaded (per UI-SPEC); per-chunk ceiling enforced via `scripts/assert-bundle-budgets.sh`. |
| Strict 14-digit migration filename regex | `reference_supabase_migration_filename_regex` | All Phase 40 migrations use 14-digit timestamps; pre-merge collision-check per `reference_migration_timestamp_collision_precheck`. |
| pg_cron uses vault.decrypted_secrets, not GUC | `reference_supabase_pg_cron_vault_service_role_pattern` | T-7d resume-reminder cron + ROI-matview refresh cron use vault pattern. |
| stripe-webhook dispatcher extension: new arms BEFORE default | P26 D-08 + 26-07 lesson | Even though research overrides D-11 (no new arms needed), the pattern still applies to `subscription-updated` handler EXTENSION. |
| ALTER TYPE ADD VALUE in separate tx from first USE | Phase 37 lesson (`feedback_planner_missed_status_enum_widening`) | `offer_type` and `cancellation_offers_log.status` enums must add values in standalone migration BEFORE the migration that INSERTs them. |
| Worktree executor commit-leak prevention | `feedback_worktree_executor_pwd_drift_leaks_to_main` | Per-commit `git rev-parse --show-toplevel` guard required in all 40-* plans. |
| RPC auth.uid() vs service-role mismatch | `feedback_rpc_auth_uid_vs_service_role_mismatch` | `cancellation-decide-offer` Edge Fn (service-role) cannot call any SECDEF RPC that references `auth.uid()`; either mirror the write inline OR forward user JWT. |
| RLS proof on every new RLS surface | LeanShot Supabase project rule | `cancellation_offers_log` + `save_offer_rules` each need a live cross-tenant impersonation proof test. |

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Reason-picklist + offer-card rendering | Browser (SPA) | — | Pure UI; cancellation modal is a lazy React chunk |
| Server-picked offer recommendation | Edge Function (Deno) | Postgres (rules table read) | Anti-gaming gates + cohort/tenure/reason resolution; service-role read of `save_offer_rules` |
| Anti-gaming cap + cooldown enforcement | Edge Function | Postgres | Must be server-side; client cannot be trusted with D-02/D-03 |
| Stripe pause/coupon application | Edge Function | Stripe API | Authoritative writes hit Stripe; local `subscriptions` table is a mirror |
| Save-offer log writes | Edge Function (service-role) | Postgres (append-only) | Append-only; service-role insert; RLS denies patient direct write |
| Save-offer rule CRUD | Postgres RPC (SECDEF) | Browser admin UI | Admin module — surface gated by `surfaceCheck('admin.cancellation.rules.edit')` |
| ROI aggregation | Postgres (view/matview) | Browser admin UI | Aggregate query on `cancellation_offers_log`; renders via Chart.js |
| Pause state mirror | Edge Function (stripe-webhook dispatcher) | Postgres (`subscriptions.paused_until`) | Single source of truth: Stripe webhook → local mirror |
| Pause T-7d / T-0 emails | pg_cron + Edge Function | Email router (Resend / SES) | Time-based; T-7d cron checks `paused_until - 7d`, fires email-router |
| Service-quality-issue → helpdesk ticket | Edge Function | P37 ticket-create | Fire-and-forget after cancellation completes |
| A/B variant assignment | PostHog server-side capture | Browser (variant copy resolution) | P34 D-20 Ship-Winner pattern (existing) |

---

## Standard Stack

### Core (verified versions)

| Library / Service | Version | Purpose | Verification |
|-------------------|---------|---------|--------------|
| `stripe` (Deno npm:) | `19.x` (matches `https://esm.sh/stripe@19?target=denonext` in current dispatcher) | Pause/resume + coupon discount stacking | `[VERIFIED: supabase/functions/stripe-webhook/index.ts:28]` |
| Stripe API version | `2026-04-22.dahlia` | Pinned in webhook dispatcher | `[VERIFIED: supabase/functions/stripe-webhook/index.ts:64]` |
| `@supabase/supabase-js` | `npm:2.x` | DB writes from Edge Fn | `[VERIFIED: existing usage in dispatcher]` |
| `_shared/email-router.ts` | existing (P25 D-03) | T-7d + T-0 emails (Resend non-PHI; SES PHI) | `[VERIFIED: ls supabase/functions/_shared/]` |
| `posthog-node` | existing (P24) | Server-side analytics events for `save_offer_*` | `[VERIFIED: posthog-server.ts referenced in dispatcher]` |
| `chart.js` | `^4.4.6` | ROI dashboard stacked-bar chart | `[VERIFIED: leanshot/package.json + ARCHITECTURE.md]` |
| `lucide-react` | `^0.460.0` | Icons per UI-SPEC offer-type mapping | `[VERIFIED: UI-SPEC §Surface 1]` |

### Stripe webhook event-name correction (CRITICAL)

**CONTEXT D-11 says:** "Stripe webhook `customer.subscription.paused` and `customer.subscription.resumed` handled in dispatcher."

**Stripe docs say (VERIFIED):**

> `customer.subscription.paused` — Occurs whenever a customer's subscription is paused. **Only applies when subscriptions enter `status=paused`, NOT when payment collection is paused.**
> `customer.subscription.resumed` — Occurs whenever a customer's subscription is no longer paused. **Only applies when a `status=paused` subscription is resumed, NOT when payment collection is resumed.**

`[CITED: https://docs.stripe.com/api/events/types — verified via Context7 /websites/stripe and WebFetch 2026-05-21]`

**Implication:** Because D-06 locks `pause_collection` (legacy field-based pause, not the new `/v1/subscriptions/:id/pause` endpoint), the correct events are:

| Trigger | Webhook Fired |
|---------|----------------|
| Setting `pause_collection={behavior:'void', resumes_at}` | `customer.subscription.updated` |
| Reaching `resumes_at` (auto-resume) | `customer.subscription.updated` (with `pause_collection: null`) |
| Extending pause (updating `resumes_at`) | `customer.subscription.updated` |
| Manually clearing `pause_collection` | `customer.subscription.updated` |

**Planner action required:** The plan outline in STATE.md mentions "new case arms for `customer.subscription.paused` + `customer.subscription.resumed`". **Drop those arms.** Instead, **extend `events/subscription-updated.ts`** to detect `pause_collection` state changes and mirror them into `subscriptions.paused_until` + `is_paused`. The existing dispatcher already routes `customer.subscription.updated` to this handler (`index.ts:159–162`).

**Why D-06 chose pause_collection over the new /pause endpoint:** The new `/v1/subscriptions/:id/pause` endpoint has strict restrictions — it CANNOT pause subscriptions that are "in a trial period or have an active trial offer". LeanShot's $12.99/mo and $132.49/yr subscriptions may be in trial post-onboarding; pause_collection works in all states. Keep D-06.

### Coupon stacking semantics (verified)

`[CITED: https://docs.stripe.com/billing/subscriptions/discounts]` — Stackable coupons and promotion codes section:

- **Multiple coupons can be applied via `subscriptions.discounts[]` array.** Max 20 entries; each must be unique; cannot stack a coupon with a promo-code derived from the same coupon.
- **Order matters when combining `amount_off` + `percent_off`.** For pure `percent_off + percent_off` (LeanShot's case — affiliate coupons are `percent_off`, save coupons are `percent_off`), the order does NOT affect the result mathematically: 0.9 × 0.75 = 0.75 × 0.9 = 0.675.
- **Update pattern:** "When updating `discounts`, you need to pass in any previously set `coupon`, `promotion_code` or `discount` you want to keep on the subscription." Omitting a coupon REMOVES it.

**Implication for D-14 implementation:**

```typescript
// Read current discounts from the subscription
const sub = await stripe.subscriptions.retrieve(subscriptionId, { expand: ['discounts'] });
const existing = sub.discounts.map(d => ({ coupon: d.coupon.id }));

// Append new save-offer coupon (preserves the affiliate stack)
await stripe.subscriptions.update(subscriptionId, {
  discounts: [...existing, { coupon: 'SAVE-25-3MO' }],
});
```

`[ASSUMED]` — The exact `discounts` array shape on the read path (`d.coupon.id` vs `d.promotion_code.id` distinction). Planner should verify against `stripe@19` TypeScript types at code-write time.

### Supporting

| Library | Purpose | When to Use |
|---------|---------|-------------|
| `pg_cron` (already enabled per P25 + P35) | T-7d resume reminder + T-0 confirmation + ROI matview refresh | Schedule via vault-secret pattern; see `reference_supabase_pg_cron_vault_service_role_pattern` |
| `cmdk` (P27) | Admin command palette entries for new `/admin/cancellation/*` routes | Register in P27 `ADMIN_MODULES` manifest extension |
| Existing `_shared/sentry.ts` | Edge Fn error reporting | Wrap `cancellation-decide-offer` calls; never throw raw Stripe errors |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `pause_collection` field | `/v1/subscriptions/:id/pause` endpoint | Cleaner webhooks (`.paused`/`.resumed` fire) BUT: new endpoint can't pause trials, requires `billingMode=flexible`, requires Stripe-Version `preview` header. Not worth the breakage risk in v1.3. Stay with `pause_collection`. |
| Stripe `discounts[]` array append | Pre-compute combined `percent_off` and create dynamic coupon | Avoids Stripe's max-20-discounts limit AND gives client full control of order. BUT: needs new Stripe coupon per user — explodes coupon-object count; not auditable. Use native `discounts[]`. |
| Postgres matview for ROI dashboard | Plain SQL view with composite indexes | Matview = staleness (refresh cadence trade-off); plain view = recompute-per-query. For v1.3 low volume, plain view + correct indexes is sufficient; matview defer to v1.4 if dashboard latency >500ms. |
| Cohort-rule resolution in SQL | Resolution in Edge Fn TS | SQL keeps the resolution close to the data BUT couples rule schema to plpgsql. Edge Fn TS keeps rule shape in ONE type (matches `feedback_planner_iter1_anti_patterns` defensive-jsonb advice). **Recommendation: Edge Fn.** |
| Bayesian update per-recommendation | Hardcoded reason→offer mapping forever | Bayesian needs ≥50 samples/cohort×reason to outperform hardcoded; v1.3 cold-start = hardcoded; revisit when `cancellation_offers_log` accumulates ≥500 rows per major cohort. |

**Installation / setup:**

No new npm or Deno dependencies required. All Phase 40 building blocks reuse existing stacks. The 6 Stripe coupons (`SAVE-{20,25,30}-{2,3}MO`) are created via a one-shot migration seed (idempotent — uses Stripe coupon idempotency-key per coupon ID).

**Version verification:**

```bash
# Verified 2026-05-21:
npm view stripe version   # → 19.x (latest stable; matches Deno dispatcher pin)
npm view chart.js version # → 4.4.6 (locked in package.json)
```
`[VERIFIED: package.json + Stripe dispatcher imports]`

---

## Architecture Patterns

### System Architecture Diagram

```
USER CLICKS "Cancel subscription" in SettingsPage
                  │
                  ▼
         CancellationModal (lazy chunk)
                  │
   ┌──────────────┼──────────────┐
   ▼              ▼              ▼
 Step 1         Step 2         Step 3
 Reason         Server-picked  Loss-summary
 picklist       offer card     confirmation
   │              │              │
   ▼              ▼              ▼
   │       POST /functions/v1/cancellation-decide-offer
   │              │
   │              ▼
   │       ┌─────────────────────────────────┐
   │       │ cancellation-decide-offer       │
   │       │  1. Read user tenure + cohort   │
   │       │  2. Read prior takes / cooldown │
   │       │  3. Apply D-04 clinic fork      │
   │       │  4. Resolve rule by priority    │
   │       │  5. D-15 stacking clamp (35%)   │
   │       │  6. INSERT cancellation_offers  │
   │       │     _log (status='offered')     │
   │       │  7. Return offer or             │
   │       │     OFFER_INELIGIBLE_* code     │
   │       └─────────────────────────────────┘
   │              │
   │              ▼
   │       ACCEPT ──────────► POST /functions/v1/cancellation-accept-offer
   │                                   │
   │                                   ▼
   │                          ┌──────────────────────────┐
   │                          │ Stripe API:              │
   │                          │  - pause: subscriptions  │
   │                          │    .update({pause_       │
   │                          │     collection:{void,    │
   │                          │     resumes_at}})        │
   │                          │  - discount: append to   │
   │                          │    discounts[]           │
   │                          │  - extended_trial:       │
   │                          │    update trial_end      │
   │                          │  - downgrade: swap items │
   │                          │    [{price}] (annual→mo) │
   │                          │  - contact_csm: fire     │
   │                          │    helpdesk-ticket-create│
   │                          └──────────────────────────┘
   │                                   │
   │                                   ▼
   │                          UPDATE cancellation_offers_log
   │                          SET status='accepted', taken_at=now()
   │                                   │
   │                                   ▼
   │                          STRIPE WEBHOOK FIRES
   │                          customer.subscription.updated
   │                                   │
   │                                   ▼
   │                          events/subscription-updated.ts
   │                          (EXTENDED to detect pause_collection
   │                          transitions; mirrors to local
   │                          subscriptions.paused_until + is_paused)
   │
   ▼
 DECLINE  ──► UPDATE log SET status='declined'
              Step 3 → "Cancel anyway" → Stripe cancel_at_period_end
                              + (if reason='service_quality_issue')
                              → fire P37 helpdesk-ticket-create

PG_CRON (every 1h) ──► check subscriptions where paused_until - now() < 7d AND NOT reminded_t7
                       → fire _shared/email-router.ts T-7d email
                       → SET reminded_t7=true

STRIPE auto-resume on resumes_at ──► customer.subscription.updated
                                      (pause_collection: null)
                                      → mirror is_paused=false
                                      → fire T-0 confirmation email

ADMIN /admin/cancellation/rules  ──► save_offer_rules CRUD (SECDEF RPCs)
ADMIN /admin/cancellation/roi    ──► SELECT FROM v_cancellation_offers_roi
                                       (view OR matview — planner picks)
                                     → Chart.js stacked-bar (P33 pattern)
```

### Recommended Project Structure

```
supabase/
├── migrations/
│   ├── 202707{NN}1{MM}_p40_cancellation_offers_log.sql       # 40-01
│   ├── 202707{NN}1{MM+1}_p40_save_offer_rules.sql            # 40-01
│   ├── 202707{NN}1{MM+2}_p40_offer_type_enum.sql             # 40-01 (sep tx from USE)
│   ├── 202707{NN}1{MM+3}_p40_cancel_log_status_enum.sql      # 40-01 (sep tx)
│   ├── 202707{NN}1{MM+4}_p40_subscriptions_pause_cols.sql    # 40-02 (paused_until, is_paused)
│   ├── 202707{NN}1{MM+5}_p40_stripe_coupon_seed.sql          # 40-01 (idempotent Stripe API seed)
│   ├── 202707{NN}1{MM+6}_p40_pause_reminder_cron.sql         # 40-02 (T-7d cron)
│   ├── 202707{NN}1{MM+7}_p40_save_offer_rpcs.sql             # 40-05 (SECDEF CRUD)
│   └── 202707{NN}1{MM+8}_p40_roi_view.sql                    # 40-06 (view + indexes)
└── functions/
    ├── cancellation-decide-offer/        # 40-03
    │   ├── index.ts                       # entry + auth
    │   ├── resolve-rule.ts                # cohort × tenure × reason lookup
    │   ├── anti-gaming.ts                 # D-02 + D-03 + D-15 cap
    │   └── *.test.ts
    ├── cancellation-accept-offer/        # 40-03 (or fold into decide-offer)
    │   ├── index.ts                       # Stripe pause/discount/extend/downgrade
    │   └── *.test.ts
    ├── cancellation-feedback-to-ticket/  # 40-04 (D-21)
    │   └── index.ts
    ├── download-cancellation-roi-csv/    # 40-06
    │   └── index.ts
    └── stripe-webhook/events/
        └── subscription-updated.ts        # 40-02 EXTEND (don't add new files)

leanshot/src/
├── components/
│   ├── dashboard/settings/cancellation/  # 40-04
│   │   ├── CancellationModal.tsx          # SINGLE chunked component
│   │   ├── steps/
│   │   │   ├── ReasonPicklistStep.tsx
│   │   │   ├── OfferStep.tsx
│   │   │   └── LossSummaryStep.tsx
│   │   ├── OfferCard.tsx
│   │   └── PauseControls.tsx
│   └── admin/cancellation/                # 40-05 + 40-06
│       ├── CancellationModule.tsx         # AdminShell module entry
│       ├── CancellationRulesTab.tsx
│       ├── CancellationRoiTab.tsx
│       ├── RuleEditor.tsx
│       └── RuleListPanel.tsx
├── lib/
│   ├── admin/modules.ts                   # 40-05 EXTEND ADMIN_MODULES
│   └── cancellation/
│       ├── decide-offer-client.ts         # 40-04 (lazy, ≤1-2 kB)
│       └── analytics-events.ts            # 40-04 event names
```

### Pattern 1: Stripe pause_collection state mirroring

**What:** The local `subscriptions` table mirrors Stripe state. CONTEXT D-11 says to handle pause/resume webhooks — but per research correction, only `customer.subscription.updated` fires. The existing `events/subscription-updated.ts` handler must be extended to detect `pause_collection` deltas.

**When to use:** Every pause/resume operation, including auto-resume at `resumes_at` and pause-extensions.

**Example (planner-spec):**

```typescript
// supabase/functions/stripe-webhook/events/subscription-updated.ts
// EXTENSION (40-02): detect pause_collection state transitions.
import type Stripe from 'https://esm.sh/stripe@19?target=denonext';

export async function handle(event: Stripe.Event, admin: SupabaseClient) {
  const sub = event.data.object as Stripe.Subscription;

  // ─── EXISTING logic: status/tier/clinic broadcast ───
  // ... (preserve P14 + P29 D-05 logic) ...

  // ─── 40-02: pause_collection mirror ───
  const pauseCollection = sub.pause_collection as { resumes_at: number | null } | null;
  const newPausedUntil = pauseCollection?.resumes_at
    ? new Date(pauseCollection.resumes_at * 1000).toISOString()
    : null;
  const newIsPaused = pauseCollection !== null;

  await admin
    .from('subscriptions')
    .update({
      paused_until: newPausedUntil,
      is_paused: newIsPaused,
    })
    .eq('id', sub.id);

  // ─── 40-02: detect resume transition for T-0 email ───
  // (compare against previous row; or just fire when newIsPaused=false and prev was true)
  // implementation detail — planner decides whether to read-back prev state or use
  // a transition trigger on the subscriptions table.
}
```
`[VERIFIED pattern: supabase/functions/stripe-webhook/events/subscription-updated.ts already imports Stripe types and uses the SupabaseClient admin]`

### Pattern 2: Coupon stacking via discounts[] append

**What:** Append the save-offer coupon to the existing `discounts[]` array on the subscription. Stripe applies them multiplicatively for `percent_off + percent_off` (D-14).

**When to use:** When the user accepts a discount or extended-trial offer.

**Example:**

```typescript
// supabase/functions/cancellation-accept-offer/apply-discount.ts
async function applyDiscount(subscriptionId: string, couponId: string, stripe: Stripe) {
  const sub = await stripe.subscriptions.retrieve(subscriptionId, {
    expand: ['discounts'],
  });
  // Preserve existing discounts (affiliate / referral coupons stay)
  const existing = sub.discounts.map((d) => ({ coupon: (d.coupon as Stripe.Coupon).id }));

  await stripe.subscriptions.update(subscriptionId, {
    discounts: [...existing, { coupon: couponId }],
  });
}
```
`[CITED: https://docs.stripe.com/billing/subscriptions/discounts]`

### Pattern 3: Append-only log table with 2-axis RLS

**What:** `cancellation_offers_log` follows the P35 xp_ledger + P25 audit_logs pattern — INSERT-only, service-role write, admin read, RLS denies patient direct.

**When to use:** Every offer-shown / offer-accepted / offer-declined event.

**Schema (planner-spec):**

```sql
-- 202707NN1MM_p40_cancellation_offers_log.sql
create table public.cancellation_offers_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(user_id) on delete cascade,
  org_id uuid references public.orgs(id) on delete set null,  -- 2-axis (clinic-org)
  subscription_id text references public.subscriptions(id) on delete set null,
  -- D-18 reason captured BEFORE offer
  reason text not null check (reason in (
    'too_expensive','not_using','found_alternative','health_goals_changed',
    'temporary_break','service_quality_issue','other'
  )),
  reason_other_text text,  -- nullable; only set when reason='other'
  -- D-19 offer details
  offer_type text not null,  -- enum: 'pause'|'discount'|'extended_trial'|'downgrade'|'contact_csm'|'none'
  offer_config jsonb not null default '{}'::jsonb,  -- {percent_off, duration_months, pause_months, coupon_id, ...}
  cohort_snapshot jsonb not null default '{}'::jsonb,  -- captured for ROI dashboard
  tenure_bucket text not null,  -- '<30d'|'30-180d'|'>180d'
  rule_id uuid references public.save_offer_rules(id) on delete set null,
  -- D-15 stacking-cap clamp evidence
  stacking_pre_clamp_pct numeric(5,2),  -- raw combined % before clamp
  stacking_post_clamp_pct numeric(5,2), -- effective % after 35% cap
  stacking_clamped boolean not null default false,
  -- D-02/D-03 anti-gaming snapshot
  prior_takes_count integer not null default 0,
  -- Status machine (enum widened in separate migration per status-enum lesson)
  status text not null default 'offered' check (status in (
    'offered','accepted','declined','expired','ineligible_lifetime_cap','ineligible_cooldown'
  )),
  offered_at timestamptz not null default now(),
  taken_at timestamptz,  -- D-03 cooldown anchor
  declined_at timestamptz,
  -- A/B variant assignment for D-22
  posthog_variant_id text,
  created_at timestamptz not null default now()
);

create index idx_offers_log_user on public.cancellation_offers_log(user_id, offered_at desc);
create index idx_offers_log_status_taken on public.cancellation_offers_log(status, taken_at desc)
  where status in ('accepted','declined');
create index idx_offers_log_cohort_offer on public.cancellation_offers_log
  using gin(cohort_snapshot)
  where status='accepted';

-- RLS: append-only; service-role insert; admin select; patient denied direct
alter table public.cancellation_offers_log enable row level security;

create policy "cancellation_offers_log_admin_select"
  on public.cancellation_offers_log for select
  to authenticated
  using (
    exists (
      select 1 from public.admin_roles_view
      where user_id = auth.uid() and role >= 'support_admin'
    )
  );

revoke insert, update, delete on public.cancellation_offers_log from authenticated;
-- No SECDEF RPC for INSERT — only service-role from cancellation-decide-offer Edge Fn.
```

### Pattern 4: save_offer_rules table (admin rule-builder)

```sql
create table public.save_offer_rules (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  cohort_id uuid references public.cohort_definitions(id) on delete cascade,
  tenure_buckets text[] not null default '{}',  -- subset of {'<30d','30-180d','>180d'}
  reasons text[] not null default '{}',         -- subset of 7 reason codes; empty = "any reason"
  org_type text check (org_type in ('any','consumer','clinic')) default 'any',  -- D-04
  offer_type text not null,  -- 'pause'|'discount'|'extended_trial'|'downgrade'|'contact_csm'
  -- Offer config
  pause_months integer check (pause_months in (1,2,3)),
  coupon_id text,           -- references Stripe coupon, e.g. 'SAVE-25-3MO'
  extension_days integer check (extension_days in (7,14,30)),
  downgrade_target text,    -- e.g. 'price_monthly'
  -- Priority + active
  priority integer not null default 100,
  active boolean not null default false,  -- D-09 lifecycle pattern
  -- Audit
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.profiles(user_id) on delete set null
);

create index idx_rules_active_priority on public.save_offer_rules(priority)
  where active = true;
create index idx_rules_cohort on public.save_offer_rules(cohort_id) where active = true;

alter table public.save_offer_rules enable row level security;

-- support_admin reads; support_lead writes
create policy "rules_select" on public.save_offer_rules for select to authenticated
  using (exists (
    select 1 from public.admin_roles_view
    where user_id = auth.uid() and role >= 'support_admin'
  ));

-- Writes via SECDEF RPCs only (mutations audit-logged)
revoke insert, update, delete on public.save_offer_rules from authenticated;
```

### Anti-Patterns to Avoid

- **Adding case-arms for `customer.subscription.paused` / `.resumed`** when using `pause_collection`. Per Stripe docs (verified), those events DO NOT fire for pause_collection. Extend the existing `subscription-updated` handler instead.
- **Calling `subscriptions.update({ discount: ... })`** (legacy field) instead of `subscriptions.update({ discounts: [...] })`. The legacy field overwrites; the array appends.
- **Stripe-call inside the decide-offer Edge Fn synchronously** (latency spike). Decide-offer should be lookup-only; acceptance should be a separate Edge Fn call so the modal doesn't block on Stripe round-trip.
- **Storing reason free-text in the same column as the enum.** Use a separate `reason_other_text` column; keeps cohort-aggregation queries clean.
- **Reading `save_offer_rules` per-request from the Edge Fn without a priority-indexed query.** Index on `(priority) where active=true` keeps lookups O(log n) for v1.3 rule-count <100.
- **Shared file choreography across plans** (`feedback_planner_iter1_anti_patterns`). Each plan should own discrete files; cross-plan coordination via TypeScript types in `src/types/cancellation.ts` (one writer) consumed by others.
- **Hedge instructions in PLAN tasks** (`feedback_planner_iter1_anti_patterns`). Each task spec must be definitive — no "may want to" or "consider".
- **Defensive jsonb schemas** in plpgsql (`feedback_planner_iter1_anti_patterns`). `offer_config jsonb` shape lives in ONE TS type (`OfferConfig` in `src/types/cancellation.ts`); plpgsql treats it as opaque.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Multiplicative coupon stacking math | Custom percent calculation on application | Stripe's native `discounts[]` array | Stripe handles ordering, currency, proration edge-cases, and invoice-line discount allocation. Verified multiplicative behavior. |
| Pause-state mirroring with custom polling | Cron polling Stripe subscriptions | Stripe webhook `customer.subscription.updated` → existing dispatcher | Existing P14 dispatcher; idempotent (`subscription_events.event_id` PK). |
| Auto-resume billing at end of pause | Custom cron triggering Stripe API | Stripe handles automatically when `resumes_at` is reached | Stripe fires `customer.subscription.updated` with `pause_collection: null` automatically. |
| Coupon catalog management UI | Custom admin CRUD | Pre-create 6 Stripe coupons via seed migration (D-12) | 6 combos = small catalog; auditable in Stripe Dashboard; no admin UI complexity. |
| Cohort membership lookup | New table for save-offer cohort joins | P27 `cohort_membership` matview | P27 already builds this; 15-min staleness is fine for save-offer eligibility. |
| Admin shell registration | Custom routing | P27 `ADMIN_MODULES` manifest entry | Standard pattern; gates via `surfaceCheck` + PostHog flag. |
| Save-offer ROI chart rendering | Custom Chart.js setup | P33 admin-CAC `BaseChart` wrapper + tile primitives | Existing theme integration; legend issues already solved. |
| A/B variant assignment for offer copy | Custom split-test logic | P34 D-20 PostHog Experiments + Ship-Winner | Existing server-side capture; variant-id stamped to log row for ROI attribution. |
| Service-quality-issue → helpdesk ticket | Direct DB insert into tickets | P37 `helpdesk-ticket-create` Edge Fn (D-21) | Sentiment-tagging + tag-routing already handled. |
| Email send routing (PHI/non-PHI split) | Direct Resend/SES calls | `_shared/email-router.ts` (P25 D-03) | BAA-aware; auto-routes consumer (Resend) vs clinic-org (SES). |
| Stripe webhook signature verification | Custom HMAC | Existing `Stripe.createSubtleCryptoProvider()` dispatcher | Already production-hardened (P14 + Phase 25 PHI safety). |

**Key insight:** Phase 40's "novel work" is narrow — the cancellation modal + decide-offer Edge Fn + log/rules schema + admin module entry. Everything else (Stripe APIs, webhook dispatch, email routing, coupon math, cohort lookup, admin shell, charts, A/B variants, ticket creation) is **pre-built infrastructure**. Plans that touch this infrastructure must EXTEND, not REIMPLEMENT.

---

## D-15 Stacking-Abuse Mitigation Recommendation

CONTEXT D-15 surfaces 3 candidates. **Research recommends option (b): cap combined effective discount at 35%, server clamps.**

### Comparison

| Option | Cost (eng) | Cost (CX) | False-positive risk | Coverage |
|--------|-----------|-----------|---------------------|----------|
| (a) Anti-self-referral via IP/device-fingerprint | HIGH | MEDIUM (legitimate users sharing IP get blocked) | HIGH (NAT'd households, mobile-carrier IPs) | Catches a narrow attack pattern only |
| **(b) Server clamp to 35% combined effective** | **LOW** (single math gate in `cancellation-decide-offer`) | **LOW** (UI-SPEC stacking-notice strip already specs the copy) | **NONE** (deterministic) | Caps economic damage regardless of attack vector |
| (c) Accept the risk | ZERO | ZERO | n/a | Zero — bet that v1.3 volume is too low for fraud farms to target us |

### Why (b)

1. **Existing infrastructure already supports it.** `affiliate_conversions` already has IP/fingerprint columns (verified in `20270101000008_fraud_trigger_conversion.sql`) — option (a) would be feasible. But it's the wrong question. The abuse vector isn't "is this the same person?"; it's "what's the maximum revenue we're willing to give up per save-flow?". Option (b) answers that directly.
2. **UI-SPEC already specs the notice.** The stacking-notice strip is in UI-SPEC Surface 1 Step 2: "Your existing {X}% referral discount caps this save-offer at {Y}% effective." Informational, never blocking. Implementing (b) just wires the math.
3. **Deterministic — no false positives.** Option (a) blocks legitimate users (NAT households, family-shared IPs, mobile carriers). Option (b) treats every user identically.
4. **Lowest mitigation cost.** Single math gate: `if (1 - (1 - existing_pct) * (1 - save_pct)) > 0.35 → clamp save_pct so effective = 0.35`. ~15 lines of TypeScript. Option (a) requires fingerprint capture, table joins, and admin-review queue extension — multi-day eng work.
5. **Revisitable.** If `cancellation_offers_log` ROI data shows `stacking_clamped=true` is firing on legitimate users at >5% rate, plan a v1.4 retune. Option (b) is reversible; option (a) creates blocked-user complaints that are hard to triage.

### Implementation specifics (planner)

```typescript
// supabase/functions/cancellation-decide-offer/anti-gaming.ts
const STACKING_CAP_EFFECTIVE = 0.35;

function clampSavePct(existingPct: number, savePct: number): {
  finalSavePct: number;
  clamped: boolean;
  preClampEffective: number;
  postClampEffective: number;
} {
  const preEffective = 1 - (1 - existingPct) * (1 - savePct);
  if (preEffective <= STACKING_CAP_EFFECTIVE) {
    return { finalSavePct: savePct, clamped: false,
             preClampEffective: preEffective, postClampEffective: preEffective };
  }
  // Solve: 1 - (1 - existingPct) * (1 - finalSavePct) = 0.35
  // → finalSavePct = 1 - (1 - 0.35) / (1 - existingPct)
  const finalSavePct = Math.max(0, 1 - (1 - STACKING_CAP_EFFECTIVE) / (1 - existingPct));
  return { finalSavePct, clamped: true,
           preClampEffective: preEffective, postClampEffective: STACKING_CAP_EFFECTIVE };
}
```

Log the pre/post clamp percentages to `cancellation_offers_log.stacking_pre_clamp_pct` / `stacking_post_clamp_pct` / `stacking_clamped` (schema above) so we can monitor false-positive rate.

**Edge case:** If `existingPct >= 0.35` already, save-offer cannot beat the cap; `finalSavePct = 0` → don't show a discount offer; route to pause or contact_csm instead.

---

## Runtime State Inventory

**Trigger applicability:** Phase 40 is greenfield additive (new tables, new modal, new Edge Fns); it does NOT rename or refactor existing schema. **Skipping per Step 2.5.**

However, two carry-over inventory items are worth flagging:

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stripe coupon objects | 6 NEW coupons to seed: `SAVE-20-2MO`, `SAVE-20-3MO`, `SAVE-25-2MO`, `SAVE-25-3MO`, `SAVE-30-2MO`, `SAVE-30-3MO` | Idempotent seed migration calling Stripe API; use coupon ID as Stripe idempotency-key |
| Stripe webhook subscription | Stripe Dashboard must subscribe webhook endpoint to `customer.subscription.updated` (ALREADY SUBSCRIBED per P14) | None — verified in dispatcher. **NO new event subscriptions needed** (research correction to D-11 deferred-item) |
| Live service config | n8n workflows: NONE (no n8n workflows reference cancellation paths) | None — verified |
| OS-registered state | NONE | None |
| Secrets/env vars | NONE new — uses existing `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `SUPABASE_SERVICE_ROLE_KEY`, `RESEND_API_KEY`, `RESEND_FROM` | None |
| Build artifacts | NONE | None |

**Important correction to STATE.md "Stripe webhook HUMAN-UAT" deferred item:** The deferred-ideas note in 40-CONTEXT.md says Stripe Dashboard needs to subscribe the webhook endpoint to `customer.subscription.paused` + `customer.subscription.resumed`. **This is NOT needed** if D-06's `pause_collection` approach is used — the dispatcher already receives `customer.subscription.updated` for these transitions. Planner should DROP this HUMAN-UAT from the relevant plan OR keep it as belt-and-suspenders (subscribe to those events at zero cost — they'd just no-op since they never fire for pause_collection).

---

## Common Pitfalls

### Pitfall 1: Adding case arms for events that never fire (CONTEXT D-11 misalignment)

**What goes wrong:** Planner adds new case arms `case 'customer.subscription.paused'` and `case 'customer.subscription.resumed'` to `stripe-webhook/index.ts`. They never fire because pause_collection is used.

**Why it happens:** CONTEXT D-11 explicitly says to add these handlers. Researcher correction is overriding D-11.

**How to avoid:** Plan 40-02 must EXTEND `events/subscription-updated.ts` to detect pause_collection deltas; do NOT add new case arms in `index.ts`.

**Warning signs:** Plan-checker grep for `case 'customer.subscription.paused'` in 40-02 PLAN.md should return zero matches.

### Pitfall 2: Coupon overwrite via legacy `discount` field

**What goes wrong:** Calling `subscriptions.update({ discount: 'SAVE-25-3MO' })` (singular) overwrites the existing affiliate coupon. User loses their referral discount.

**Why it happens:** Stripe still accepts the legacy singular `discount` field for back-compat.

**How to avoid:** Always use `discounts: [...existing, { coupon }]` array. Lint rule (or test): `grep -rn 'discount:' supabase/functions/cancellation-*` should return zero matches; only `discounts:` (plural) allowed.

**Warning signs:** Test that creates a sub with affiliate coupon, applies save-offer, verifies BOTH coupons still present.

### Pitfall 3: Status-enum widening without separate transaction

**What goes wrong:** Migration adds `'ineligible_lifetime_cap'` to a CHECK-constrained `status` column AND immediately INSERTs a row with that value. Postgres rejects in some scenarios with `23514` (check_violation).

**Why it happens:** `[[feedback_planner_missed_status_enum_widening]]` + Phase 37 lesson. CHECK widening + first USE must be separate transactions OR the CHECK must be `NOT VALID` until backfill complete.

**How to avoid:** Each enum widening lives in its own migration file BEFORE the migration that first INSERTs the new value. Plan-checker enforces in 40-01.

**Warning signs:** Two migrations from same plan touching CHECK on same column.

### Pitfall 4: SECDEF RPC calling auth.uid() from service-role Edge Fn

**What goes wrong:** `cancellation-decide-offer` is service-role. If it calls a SECDEF RPC that internally uses `auth.uid()`, the RPC gets NULL — fails silently or writes wrong row.

**Why it happens:** `[[feedback_rpc_auth_uid_vs_service_role_mismatch]]` Phase 37-04 lesson.

**How to avoid:** Either (a) write directly with the service-role admin client (no RPC), OR (b) ensure the Edge Fn forwards a user JWT in the request. For Phase 40: `cancellation-decide-offer` reads + writes directly; no SECDEF call needed for the offer-decision path. `save_offer_rules` CRUD RPCs (40-05) DO use SECDEF but are called from authenticated admin sessions, not service-role.

**Warning signs:** Plan-checker grep RPC bodies for `auth.uid()` in 40-* SECDEF RPCs; verify caller context.

### Pitfall 5: D-02 + D-10 cap-counter interaction

**What goes wrong:** D-02 says "pause does NOT count toward lifetime 2-take cap"; D-10 says "extending a pause counts as a new pause-take". These rules interact: a user can pause indefinitely with extensions, but each extension consumes a take of the 2-lifetime budget if the extension comes via the T-7d email.

**Why it happens:** Subtle anti-gaming math. Easy to miscount.

**How to avoid:** `anti-gaming.ts` should have explicit unit tests:
- Initial pause: do NOT increment counter (D-02 exempt). Counter stays 0.
- T-7d email extend: DO increment counter (D-10 says it's a new take). Counter becomes 1.
- Second extend after subsequent T-7d email: counter becomes 2.
- Third extend: BLOCKED by D-02 lifetime cap.

Counter increments live in `cancellation_offers_log` (one row per take, including extensions). Cooldown reads `last_taken_at` over all `accepted` rows.

**Warning signs:** Tests asserting counter behavior on initial pause vs extension.

### Pitfall 6: Migration timestamp collision with concurrent phases

**What goes wrong:** Phase 40 ships migrations dated 202707NN; Phases 38/41 also using 202707NN; collision → `Skipping` silent skip.

**Why it happens:** `[[reference_supabase_migration_filename_regex]]` + `[[reference_migration_timestamp_collision_precheck]]`.

**How to avoid:** Pre-merge glob check; orchestrator passes corrected timestamps to Wave N+1 dispatches. Plan-checker enforces.

### Pitfall 7: Bundle ceiling regression

**What goes wrong:** Cancellation chunk lazy-loads correctly but admin module accidentally imports it eagerly via cross-import, pulling 10kB into the dashboard chunk.

**Why it happens:** `[[project_phase5_bundle_regression]]`.

**How to avoid:** Per-chunk ceiling in `scripts/assert-bundle-budgets.sh`: `cancellation` ≤ 13kB gz, admin-chunk delta ≤ 10kB gz. Plan-checker verifies the script changes in 40-04 + 40-05.

### Pitfall 8: Modal route-splitting

**What goes wrong:** Plan splits the 3-step modal into 3 routes/components, breaking the "single chunked component" rule from CONTEXT specifics.

**Why it happens:** Natural tendency to over-modularize.

**How to avoid:** UI-SPEC Surface 1 line: "single chunked component — per CONTEXT specifics, NOT three separate routes." Plan-checker grep 40-04 for `react-router` imports or new route entries — should be zero.

### Pitfall 9: Worktree executor commit leak

**What goes wrong:** Executor in worktree does `cd` to primary checkout (e.g. for `supabase db push`) and commits directly to main.

**Why it happens:** `[[feedback_worktree_executor_pwd_drift_leaks_to_main]]`.

**How to avoid:** Per-commit `git rev-parse --show-toplevel` guard in all 40-* plans. Validated W2 of Phase 25.

---

## Code Examples

### Stripe pause_collection apply (with future resumes_at)

```typescript
// supabase/functions/cancellation-accept-offer/apply-pause.ts
import Stripe from 'https://esm.sh/stripe@19?target=denonext';

async function applyPause(
  subscriptionId: string,
  pauseMonths: 1 | 2 | 3,
  stripe: Stripe,
): Promise<{ resumesAt: number }> {
  const now = Math.floor(Date.now() / 1000);
  const resumesAt = now + pauseMonths * 30 * 24 * 60 * 60; // approximate; Stripe accepts unix ts

  await stripe.subscriptions.update(subscriptionId, {
    pause_collection: {
      behavior: 'void',
      resumes_at: resumesAt,
    },
  });

  return { resumesAt };
}
```
`[CITED: https://docs.stripe.com/billing/subscriptions/pause-payment]`

### Pause extension (D-10) — pause-while-paused

```typescript
// supabase/functions/cancellation-accept-offer/extend-pause.ts
async function extendPause(
  subscriptionId: string,
  extraMonths: 1 | 2 | 3,
  stripe: Stripe,
): Promise<{ resumesAt: number }> {
  const sub = await stripe.subscriptions.retrieve(subscriptionId);
  const currentResumesAt = sub.pause_collection?.resumes_at;
  if (!currentResumesAt) {
    throw new Error('SUB_NOT_PAUSED');  // caller fires Sentry + surfaces error code
  }
  const newResumesAt = currentResumesAt + extraMonths * 30 * 24 * 60 * 60;

  await stripe.subscriptions.update(subscriptionId, {
    pause_collection: {
      behavior: 'void',
      resumes_at: newResumesAt,
    },
  });

  return { resumesAt: newResumesAt };
}
```

### Stripe coupon catalog seed (idempotent)

```typescript
// supabase/functions/cancellation-seed-coupons/index.ts
// Run once via a one-shot migration helper OR Edge Fn invocation post-migration.
const COUPONS = [
  { id: 'SAVE-20-2MO', percent_off: 20, duration_in_months: 2 },
  { id: 'SAVE-20-3MO', percent_off: 20, duration_in_months: 3 },
  { id: 'SAVE-25-2MO', percent_off: 25, duration_in_months: 2 },
  { id: 'SAVE-25-3MO', percent_off: 25, duration_in_months: 3 },
  { id: 'SAVE-30-2MO', percent_off: 30, duration_in_months: 2 },
  { id: 'SAVE-30-3MO', percent_off: 30, duration_in_months: 3 },
];

for (const c of COUPONS) {
  try {
    await stripe.coupons.create({
      id: c.id,                        // Stripe coupon IDs are unique; second call 409s
      percent_off: c.percent_off,
      duration: 'repeating',
      duration_in_months: c.duration_in_months,
      name: `${c.percent_off}% off for ${c.duration_in_months} months (save-offer)`,
      metadata: { source: 'phase_40_save_flow', cohort: 'all' },
    }, {
      idempotencyKey: `seed-${c.id}-v1`,
    });
  } catch (err) {
    if (err.code === 'resource_already_exists') continue;
    throw err;
  }
}
```
`[CITED: https://docs.stripe.com/api/coupons/create]`

### T-7d pause-reminder cron (pg_cron + vault pattern)

```sql
-- 202707NN1MM_p40_pause_reminder_cron.sql
-- Per [[reference_supabase_pg_cron_vault_service_role_pattern]]
select cron.schedule(
  'p40-pause-t7-reminder',
  '0 * * * *',  -- hourly check
  $cron$
  do $reminder$
  declare
    v_service_role_key text;
    v_supabase_url text := 'https://ytnsipxxmzgaebkqmokp.supabase.co';
  begin
    select decrypted_secret into v_service_role_key
    from vault.decrypted_secrets where name = 'service_role_key';

    perform net.http_post(
      url := v_supabase_url || '/functions/v1/pause-reminder-fire',
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || v_service_role_key,
        'Content-Type', 'application/json'
      ),
      body := '{}'::jsonb
    );
  end $reminder$;
  $cron$
);
```

### Decide-offer Edge Fn skeleton

```typescript
// supabase/functions/cancellation-decide-offer/index.ts
import { createClient } from 'npm:@supabase/supabase-js@2';
import { clampSavePct } from './anti-gaming.ts';
import { resolveRule } from './resolve-rule.ts';

Deno.serve(async (req) => {
  const { user_id, reason, reason_other_text } = await req.json();
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  // 1. Read user context
  const { data: profile } = await admin.from('profiles').select('user_id, org_id').eq('user_id', user_id).single();
  const { data: sub } = await admin.from('subscriptions').select('id, created_at').eq('user_id', user_id).single();
  if (!sub) return json(404, { code: 'NO_SUBSCRIPTION' });

  // 2. Tenure bucket
  const tenureDays = Math.floor((Date.now() - new Date(sub.created_at).getTime()) / 86400000);
  const tenureBucket = tenureDays < 30 ? '<30d' : tenureDays <= 180 ? '30-180d' : '>180d';

  // 3. D-02 + D-03 anti-gaming check
  const { data: priorTakes } = await admin.from('cancellation_offers_log')
    .select('id, taken_at, offer_type')
    .eq('user_id', user_id)
    .eq('status', 'accepted');
  const nonExemptTakes = priorTakes.filter(t => t.offer_type !== 'pause').length;
  if (nonExemptTakes >= 2) return await logIneligible(admin, user_id, reason, 'OFFER_INELIGIBLE_LIFETIME_CAP');
  const lastTakenAt = Math.max(...priorTakes.map(t => new Date(t.taken_at).getTime()), 0);
  if (lastTakenAt > 0 && (Date.now() - lastTakenAt) < 365 * 86400000) {
    return await logIneligible(admin, user_id, reason, 'OFFER_INELIGIBLE_COOLDOWN');
  }

  // 4. D-04 clinic-org fork
  const isClinicOrg = profile.org_id !== null && (await isClinicOrg(admin, profile.org_id));

  // 5. Resolve rule by cohort × tenure × reason × priority
  const rule = await resolveRule(admin, { user_id, tenureBucket, reason, isClinicOrg });
  if (!rule) return await logNoRule(admin, user_id, reason, tenureBucket);

  // 6. D-15 stacking clamp (if discount offer)
  let stackingMeta = { clamped: false, pre: 0, post: 0 };
  let effectiveOfferConfig = rule.offer_config;
  if (rule.offer_type === 'discount') {
    const existingPct = await getExistingDiscountPct(admin, sub.id);
    const proposedPct = rule.offer_config.percent_off / 100;
    const clamp = clampSavePct(existingPct, proposedPct);
    stackingMeta = { clamped: clamp.clamped, pre: clamp.preClampEffective * 100, post: clamp.postClampEffective * 100 };
    if (clamp.finalSavePct === 0) {
      // Fall back: existing discount already at/above 35% — offer pause or contact_csm instead
      return await fallbackToPause(admin, user_id, reason, tenureBucket, rule);
    }
    effectiveOfferConfig = { ...rule.offer_config, percent_off: clamp.finalSavePct * 100 };
  }

  // 7. INSERT cancellation_offers_log (status='offered')
  const { data: logRow } = await admin.from('cancellation_offers_log').insert({
    user_id, org_id: profile.org_id, subscription_id: sub.id,
    reason, reason_other_text,
    offer_type: rule.offer_type, offer_config: effectiveOfferConfig,
    cohort_snapshot: { cohort_id: rule.cohort_id, tenure_bucket: tenureBucket },
    tenure_bucket: tenureBucket, rule_id: rule.id,
    stacking_pre_clamp_pct: stackingMeta.pre, stacking_post_clamp_pct: stackingMeta.post,
    stacking_clamped: stackingMeta.clamped,
    prior_takes_count: nonExemptTakes,
    status: 'offered',
  }).select().single();

  return json(200, {
    offer_id: logRow.id,
    offer_type: rule.offer_type,
    offer_config: effectiveOfferConfig,
    stacking: stackingMeta.clamped ? { existing_pct: stackingMeta.pre - effectiveOfferConfig.percent_off, capped_pct: effectiveOfferConfig.percent_off } : null,
  });
});
```

### ROI dashboard query (planner can start with view, upgrade to matview if perf)

```sql
-- 202707NN1MM_p40_roi_view.sql
create or replace view public.v_cancellation_offers_roi as
select
  date_trunc('day', offered_at) as offered_day,
  offer_type,
  cohort_snapshot->>'cohort_id' as cohort_id,
  tenure_bucket,
  count(*) filter (where status = 'offered') as shown_count,
  count(*) filter (where status = 'accepted') as accepted_count,
  count(*) filter (where status = 'declined') as declined_count,
  -- D-08 deferred-MRR × months-retained proxy
  sum(
    case when status = 'accepted' and offer_type in ('discount','pause','extended_trial')
    then coalesce((offer_config->>'percent_off')::numeric, 0) * 12.99 -- LeanShot monthly base
    else 0 end
  ) as deferred_mrr_cents_est
from public.cancellation_offers_log
group by 1, 2, 3, 4;

-- RLS-equivalent: view inherits from base table's RLS.
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Stripe `subscription.update({ discount: 'X' })` (singular legacy field) | `subscription.update({ discounts: [{coupon:'X'}, ...] })` (plural array, max 20) | Stripe API 2024+ | Multiplicative stacking native; preserves existing coupons on append |
| Manual webhook handler for each subscription state | `customer.subscription.updated` covers all field mutations | Stripe webhook design | One handler observes status, tier, pause_collection, discount changes |
| Pause via cancel_at_period_end + manual reactivation | `pause_collection` field with auto-resume at `resumes_at` | Stripe Billing 2020+ | Zero customer action needed for resume |
| New `/v1/subscriptions/:id/pause` + `/resume` endpoints | Coexists with `pause_collection` field | Stripe Billing 2024 (preview) | `pause_collection` still supported; new endpoint has restrictions (no trials, no cadence/schedule attached). Stay on `pause_collection`. |
| Custom stacking math in app code | Stripe-native multiplicative ordering | Stripe Billing 2024 | Removes a category of math bugs; lets Stripe handle proration |

**Deprecated/outdated:**

- **Stripe `subscription.coupon` singular field** — still works but mutually exclusive with `discounts[]`. Don't mix.
- **Stripe `coupon.duration_in_months` for `once`/`forever`** — only applicable to `repeating`. Pre-flight check.
- **API version pre-`2024-04-10`** for `discounts[]` — older versions return `discount` singular only. Dispatcher pinned to `2026-04-22.dahlia` so we're fine.

---

## Validation Architecture

Per `.planning/config.json` `workflow.nyquist_validation: true`.

### Test Framework

| Property | Value |
|----------|-------|
| Framework (Deno Edge Fns) | Built-in Deno `Deno.test` + `assert*` per `supabase/functions/_shared` convention; per `[[reference_deno_test_discovery]]` use `<name>.test.ts` not `<name>-test.ts` |
| Framework (TS app) | None currently configured in `leanshot/` (per CLAUDE.md "No `vitest.config.*`, `jest.config.*`, `playwright.config.*` files exist"). **WAVE 0 GAP** for client tests — see below |
| Config file (Deno) | `supabase/functions/_shared/deno.json` (existing); use `$HOME/.deno/bin/deno test --no-check` per `[[reference_deno_binary_path]]` |
| Quick run command (Edge Fn) | `$HOME/.deno/bin/deno test --no-check supabase/functions/cancellation-decide-offer/` |
| Full suite command | `$HOME/.deno/bin/deno test --no-check supabase/functions/` + Postgres RLS proofs via `npm test` (TBD if client-test infra ships in Phase 40) |
| Quick run (migrations) | `supabase db push --linked --dry-run` followed by `supabase db query --linked < tests/rls_proof.sql` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|--------------|
| POLISH-01 (eligibility) | `<30d` user sees only pause+discount; `30-180d` sees all 4; `>180d` excludes extended-trial | Edge Fn unit | `deno test cancellation-decide-offer/resolve-rule.test.ts` | ❌ Wave 0 |
| POLISH-01 (D-02 lifetime cap) | 3rd non-pause take returns `OFFER_INELIGIBLE_LIFETIME_CAP` | Edge Fn unit | `deno test cancellation-decide-offer/anti-gaming.test.ts` | ❌ Wave 0 |
| POLISH-01 (D-03 cooldown) | Take within 365d returns `OFFER_INELIGIBLE_COOLDOWN` | Edge Fn unit | `deno test cancellation-decide-offer/anti-gaming.test.ts` | ❌ Wave 0 |
| POLISH-01 (D-04 clinic-org) | Clinic-org user sees only `contact_csm` + `discount` | Edge Fn unit | `deno test cancellation-decide-offer/clinic-fork.test.ts` | ❌ Wave 0 |
| POLISH-01 (D-18 reason capture) | Reason captured even when offer declined OR no offer available | DB integration | `deno test cancellation-decide-offer/log-insert.test.ts` | ❌ Wave 0 |
| POLISH-01 (D-21 ticket creation) | Service-quality-issue + cancel-complete → P37 ticket created | E2E mock | `deno test cancellation-feedback-to-ticket/index.test.ts` | ❌ Wave 0 |
| POLISH-02 (`cancellation_offers_log`) | Append-only RLS; cross-tenant impersonation denied | RLS proof | `supabase db query --linked < tests/p40_offers_log_rls_proof.sql` | ❌ Wave 0 |
| POLISH-02 (ROI view) | View returns correct counts for shown/accepted/declined per offer-type | SQL test | `supabase db query --linked < tests/p40_roi_view_test.sql` | ❌ Wave 0 |
| POLISH-03 (pause apply) | `pause_collection.resumes_at` set correctly for 1/2/3-mo presets | Edge Fn unit | `deno test cancellation-accept-offer/apply-pause.test.ts` | ❌ Wave 0 |
| POLISH-03 (pause webhook mirror) | `customer.subscription.updated` with `pause_collection` → mirrors `subscriptions.paused_until` + `is_paused` | Edge Fn unit | `deno test stripe-webhook/events/subscription-updated.test.ts` (EXTEND existing) | ✅ existing |
| POLISH-03 (auto-resume mirror) | `customer.subscription.updated` with `pause_collection: null` → mirrors `is_paused=false` | Edge Fn unit | `deno test stripe-webhook/events/subscription-updated.test.ts` | ✅ existing |
| POLISH-03 (T-7d email) | pg_cron fires `pause-reminder-fire` Fn; email sent via `_shared/email-router.ts` | Cron + Fn integration | `deno test pause-reminder-fire/index.test.ts` + manual cron-check via `supabase db query` | ❌ Wave 0 |
| POLISH-03 (T-0 email) | Subscription auto-resume → confirmation email sent | Integration | `deno test stripe-webhook/events/subscription-updated.test.ts` (assert email-router called) | ✅ existing extension |
| POLISH-03 (D-10 pause-extend counter) | Extending pause increments take counter; initial pause does not | Edge Fn unit | `deno test cancellation-accept-offer/extend-pause-counter.test.ts` | ❌ Wave 0 |
| POLISH-04 (coupon stacking) | Existing affiliate coupon preserved; new save coupon appended | Stripe integration (mocked) | `deno test cancellation-accept-offer/apply-discount.test.ts` | ❌ Wave 0 |
| POLISH-04 (D-15 stacking clamp) | 10% affiliate + 30% save → clamped so combined = 35% | Edge Fn unit | `deno test cancellation-decide-offer/anti-gaming.test.ts (clampSavePct)` | ❌ Wave 0 |
| POLISH-04 (D-16 next-invoice) | Coupon applies to next invoice, not retroactive | Stripe integration | manual via Stripe test-mode + invoice-paid event | ❌ Wave 0 (manual) |

### Sampling Rate

- **Per task commit:** `$HOME/.deno/bin/deno test --no-check supabase/functions/<owning-fn>/` (quick run — 5-15s per Fn)
- **Per wave merge:** Full Deno sweep `$HOME/.deno/bin/deno test --no-check supabase/functions/` + RLS proofs + bundle-budget guard per `[[feedback_post_merge_deno_sweep_pattern]]`
- **Phase gate:** All ✅ in test map above; Stripe webhook end-to-end smoke via Stripe CLI `stripe trigger customer.subscription.updated` against deployed dispatcher

### Wave 0 Gaps

- [ ] `supabase/functions/cancellation-decide-offer/index.test.ts` — Fn skeleton + auth + happy path
- [ ] `supabase/functions/cancellation-decide-offer/anti-gaming.test.ts` — D-02 + D-03 + D-15 clamp
- [ ] `supabase/functions/cancellation-decide-offer/resolve-rule.test.ts` — cohort × tenure × reason × priority
- [ ] `supabase/functions/cancellation-decide-offer/clinic-fork.test.ts` — D-04
- [ ] `supabase/functions/cancellation-accept-offer/index.test.ts` — Fn skeleton + dispatch by offer_type
- [ ] `supabase/functions/cancellation-accept-offer/apply-pause.test.ts` — D-06 pause_collection
- [ ] `supabase/functions/cancellation-accept-offer/apply-discount.test.ts` — discounts[] append (preserves affiliate)
- [ ] `supabase/functions/cancellation-accept-offer/extend-pause-counter.test.ts` — D-10 counter math
- [ ] `supabase/functions/cancellation-feedback-to-ticket/index.test.ts` — D-21
- [ ] `supabase/functions/pause-reminder-fire/index.test.ts` — T-7d email trigger
- [ ] `supabase/functions/stripe-webhook/events/subscription-updated.test.ts` EXTEND — pause_collection mirror, auto-resume detection
- [ ] `tests/p40_offers_log_rls_proof.sql` — cross-tenant impersonation deny
- [ ] `tests/p40_save_offer_rules_rls_proof.sql` — admin-only write
- [ ] `tests/p40_roi_view_test.sql` — view aggregation correctness

**Framework install:** No new framework needed; Deno test already used across `supabase/functions/`. Client (React) testing remains unspecified by project (Vitest + Testing Library would be added by a future polish phase — DO NOT add in Phase 40 per CONTEXT scope).

**No client tests for `CancellationModal.tsx`** — accepted per project posture (no test framework configured in `leanshot/`). Manual smoke test via Playwright MCP at phase verify-work time per `[[reference_playwright_mcp_env_gotchas]]`.

---

## Security Domain

`security_enforcement` absent in config — defaulting to **enabled**.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|------------------|
| V2 Authentication | yes | Existing supabase-js JWT; aal2 for admin destructive actions (P27 D-12) |
| V3 Session Management | yes | Edge Fn validates Bearer JWT or service-role; `cancellation-decide-offer` is user-callable (JWT) |
| V4 Access Control | yes | RLS on `cancellation_offers_log` (admin select; service-role insert); RLS on `save_offer_rules` (support_admin select / support_lead write via SECDEF) |
| V5 Input Validation | yes | Zod schema for Edge Fn request bodies; CHECK constraints on reason enum + offer_type enum + status enum |
| V6 Cryptography | n/a | No new crypto; reuses existing Stripe signing + Supabase JWT |
| V7 Error Handling | yes | Edge Fn returns short error codes (e.g. `OFFER_INELIGIBLE_*`); never leaks Stripe object content or PII |
| V8 Data Protection | yes | PII handling: `reason_other_text` is user-typed and could contain sensitive content; treat as user-data (not PHI but minimize logging) |
| V9 Communication | yes | TLS via Supabase + Stripe; no new endpoints exposed |
| V10 Malicious Code | n/a | No file uploads; no eval; standard React |
| V11 Business Logic | yes | Anti-gaming (D-02 + D-03 + D-15) is server-side; client cannot bypass |
| V12 Files & Resources | n/a | No file ops |
| V13 API & Web Service | yes | Edge Fn HTTPS only; request rate per Supabase default; auth required for user-context calls |
| V14 Configuration | yes | Stripe coupon IDs are well-known (`SAVE-{20,25,30}-{2,3}MO`) — non-secret; coupon assignment via SECDEF RPC only |

### Known Threat Patterns

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| User self-applies arbitrary coupon by guessing ID | Tampering | Coupon applied server-side from `save_offer_rules` lookup; user cannot pass coupon ID directly |
| Replay save-offer to bypass cooldown | Tampering | Server reads `cancellation_offers_log.last_taken_at` for D-03 enforcement; cannot be client-forged |
| Affiliate stacking abuse to chain discounts | Tampering / Business Logic | D-15 server clamp to 35% combined effective (see recommendation §) |
| Forged cancellation event spoofs ticket creation | Spoofing | D-21 ticket-create requires authenticated user; server reads `auth.uid()` |
| PII leak via `reason_other_text` in admin UI / logs | Information Disclosure | `reason_other_text` rendered only in admin support_admin+ contexts; logs scrub via P25 Sentry mask |
| Rule-table write by lower-role admin | Elevation of Privilege | SECDEF RPCs check `role >= 'support_lead'`; revokes direct table mutations |
| Cross-tenant read of another patient's offer log | Information Disclosure | RLS proof test mandatory (LeanShot Supabase rule) |
| Stripe webhook spoof | Spoofing | `Stripe.createSubtleCryptoProvider()` HMAC verification (existing) |
| Anti-gaming bypass via race condition (two concurrent cancellations) | Business Logic | Edge Fn re-reads counter atomically before inserting; if INSERT triggers a constraint OR cooldown check fails, abort — Postgres unique-index OR advisory-lock per user_id |

---

## ROI Analytics Architecture (POLISH-02 Discretion)

**Recommendation: plain SQL view + composite indexes for v1.3; defer matview to v1.4 if dashboard p95 exceeds 500ms.**

### Rationale

- v1.3 expected volume: ≤500 cancellation attempts/month (per CONTEXT specifics "low expected volume in v1.3").
- 500 rows × 12-month lookback = 6000 rows max — well within plain-view recompute range.
- `idx_offers_log_status_taken` + `idx_offers_log_cohort_offer (gin)` keep filter-by-cohort + offer_type fast.
- CSV export Fn (`download_cancellation_roi_csv`) can use the same view.

### Threshold for migration to matview

- Run `EXPLAIN ANALYZE` against the view in production after 30 days of data; if p95 > 500ms OR `count(*)` > 10000 rows → migrate to matview with hourly refresh per `[[reference_supabase_pg_cron_vault_service_role_pattern]]`.

### Chart composition

- Reuses P33 admin-CAC `BaseChart` wrapper (existing).
- Stacked bar per UI-SPEC Surface 3: `accepted` + `declined` + `shown_no_response` per offer_type.
- Cohort breakdown table queries the same view filtered by cohort_snapshot->>'cohort_id'.

---

## Plan Wave Structure (validates STATE.md outline)

The STATE.md outline (pre-computed during the halted background run) is **architecturally correct** with TWO corrections:

| Plan | Objective | Wave | Depends on | REQs | Research correction |
|------|-----------|------|------------|------|---------------------|
| 40-01 | Schema: `cancellation_offers_log` + `save_offer_rules` + enum widening (separate tx) + Stripe coupon-pool seed | 1 | none | POLISH-01, POLISH-04 | Add per-enum-value migration files (`offer_type_enum`, `cancel_log_status_enum`) as standalone tx |
| 40-02 | Stripe webhook dispatcher EXTENSION — extend `events/subscription-updated.ts` for pause_collection mirror (NOT new case arms); T-7d cron + T-0 email; `subscriptions.paused_until` + `is_paused` columns | 1 | none | POLISH-03 | **Drop "new case arms" from outline** — extend existing handler only |
| 40-03 | Edge Fn `cancellation-decide-offer` + `cancellation-accept-offer` (split for latency) | 2 | 40-01 | POLISH-01, POLISH-04 | Split accept-offer from decide-offer; decide is lookup-only (≤100ms), accept does Stripe calls (≤2s) |
| 40-04 | Frontend `CancellationModal.tsx` single chunk + analytics events + service-quality ticket-create | 2 | 40-01, 40-03 | POLISH-01 | — |
| 40-05 | Admin Save-Offer Rule Editor module + SECDEF RPCs | 3 | 40-01 | POLISH-01, POLISH-04 | — |
| 40-06 | Admin ROI Dashboard + CSV export Fn + PostHog Ship-Winner | 3 | 40-01, 40-02, 40-05 | POLISH-02 | Start with plain SQL view; document matview migration threshold (see §ROI) |

**Cross-cutting plan-checker concerns (research-validated):**

- ✅ Enum-widening separate tx (CHECK-constraint) — required for `cancellation_offers_log.status` and `save_offer_rules.offer_type`
- ✅ D-15 cap mitigation explicit in PLAN.md (recommendation: option (b) 35% server clamp; rationale documented)
- ✅ D-04 clinic-org fork — admin rule editor conditionally hides pause/extended/downgrade fields when org_type='clinic'
- ⚠️ **Stripe webhook HUMAN-UAT (STATE.md outline item)**: NOT REQUIRED for pause_collection per research correction; planner can drop OR keep as belt-and-suspenders no-op subscription
- ✅ Migration filename regex 14-digit strict; pre-merge collision check
- ✅ Single-chunk modal constraint; plan-checker grep for new route entries
- ✅ Bundle ceiling raises: `cancellation` chunk ≤13kB gz, admin chunk delta ≤10kB gz
- ✅ D-02 pause-exemption math: counter does NOT increment on initial pause; DOES increment on extension via T-7d email

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|-------------|-----------|---------|----------|
| Stripe API key (test + prod) | All Phase 40 Edge Fns | ✓ | configured (P14) | none — blocker if missing |
| Supabase CLI | Migration push + Edge Fn deploy | ✓ | per existing project | none |
| Deno | Edge Fn testing | ✓ | `$HOME/.deno/bin/deno` per `[[reference_deno_binary_path]]` | none |
| pg_cron extension | T-7d reminder + ROI matview (if needed) | ✓ | per P25 + P35 | none |
| Vault extension | Service-role key in cron | ✓ | per `[[reference_supabase_pg_cron_vault_service_role_pattern]]` | none |
| Resend (non-PHI emails) | T-7d + T-0 consumer pause emails | ✓ | configured (P9 + P25 D-03) | log warning + skip |
| AWS SES (PHI emails) | Clinic-org cancellations + PHI paths | ✓ | configured (P25) | log warning + skip |
| PostHog | A/B variants + server-side capture | ✓ | configured (P24) | log warning + skip |
| Stripe Dashboard webhook subscription to `customer.subscription.updated` | Pause/discount/downgrade state mirror | ✓ | configured (P14) | none |

**Missing dependencies with no fallback:** None.
**Missing dependencies with fallback:** None blocking.

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Stripe `discounts[]` shape on read returns `d.coupon.id` (vs `d.promotion_code.id` discriminator) for coupon-typed discounts | Coupon stacking semantics | Apply-discount Fn reads wrong field; existing coupons get dropped on update. **Mitigation:** planner verifies against `stripe@19` TS types at code-write; test asserts both coupon-id and promo-code-id paths |
| A2 | Bayesian warm-start over `cancellation_offers_log` take-rates is feasible within Edge Fn latency budget once ≥500 samples per cohort×reason accumulate | Recommendation algorithm | Cold-start hardcoded mapping stays in production longer than expected. **Mitigation:** This is acceptable — v1.4 ML model is the canonical upgrade path |
| A3 | `customer.subscription.updated` fires deterministically when `pause_collection.resumes_at` is reached (auto-resume) | Pause mechanics | Auto-resume happens silently; local mirror stays stale; T-0 email never sent. **Mitigation:** Plan 40-02 should include a fail-safe pg_cron sweep that detects subscriptions where `paused_until < now()` but `is_paused=true` and reconciles via Stripe API retrieve |
| A4 | Stripe `pause_collection.resumes_at` accepts any future timestamp (no documented max) | Pause mechanics | Pause-while-paused extension at 3+3=6 months may hit an undocumented max. **Mitigation:** D-06 caps at 3 months per take; D-02 + D-10 cap total extensions at 2 lifetime takes → max ~6 months total → likely well within Stripe's silent limits. Document and monitor in Sentry |
| A5 | LeanShot's $12.99/mo + $132.49/yr subscriptions can be paused via pause_collection (not blocked by trial status) | Pause mechanics | Cold-start subscriptions in trial period may reject pause. **Mitigation:** Plan 40-03 wraps `applyPause()` in try/catch; on Stripe error, fall back to discount offer + log to Sentry. CONTEXT D-01 already excludes trial-bucket users from pause-eligible window indirectly (`<30d` allows pause+discount, but typically trial ends in 7d for paid plans) |
| A6 | P27 `cohort_membership` matview keys on (`user_id`, `cohort_id`) and is queryable by Edge Fn for save-offer rule resolution | Rule resolution | Matview shape mismatch → rule resolution returns no rules → user sees no offer. **Mitigation:** Plan 40-03 contract-tests the matview query before implementation |
| A7 | The 6 Stripe coupons can be created idempotently via the API (using coupon `id` field as the idempotency anchor) | Coupon seed | Re-running seed migration creates duplicate-error 409s. **Mitigation:** Wrap in try/catch on `resource_already_exists`; idempotency-key uses `seed-<id>-v1` |
| A8 | Existing `subscriptions` table can accept new columns `paused_until` + `is_paused` without ALTER conflicts with concurrent phase work | Schema | Phase 38/41 also editing this table → collision. **Mitigation:** Plan 40-02 grep `supabase/migrations/` for concurrent `subscriptions` ALTERs at execute-time |
| A9 | `_shared/email-router.ts` already exports a function that accepts `{ template_name, recipient, props, phi_flag }` shape | T-7d + T-0 emails | Wrong shape → email send fails. **Mitigation:** Plan 40-02 reads the email-router signature before writing the pause-reminder Fn |

**If this table has items → user confirmation recommended for A3 (auto-resume webhook) and A5 (trial-pause behavior) at /gsd-discuss-phase rerun OR document as accepted risk in PLAN.md.**

---

## Open Questions

1. **Should `cancellation-decide-offer` and `cancellation-accept-offer` be the same Edge Fn or split?**
   - What we know: Decide is lookup-only (~50-100ms); Accept calls Stripe (~500-2000ms).
   - What's unclear: Whether the modal needs to optimistically show the offer card while the accept call is in-flight.
   - Recommendation: **SPLIT** — decide returns the offer fast, accept handles the Stripe write. UI-SPEC Surface 1 already shows a skeleton loading state on accept-button click; this matches the split.

2. **Does the T-7d pause-reminder cron need user-level dedup, or is the email-router idempotent?**
   - What we know: pg_cron runs hourly; if a user is in the 7-day window for multiple hours, the cron would re-fire.
   - What's unclear: Whether `_shared/email-router.ts` has built-in dedup (likely not).
   - Recommendation: Add `reminded_t7 boolean` column to `subscriptions`; cron updates after send. Plan 40-02 owns.

3. **For the ROI dashboard "deferred MRR" math, what's the canonical revenue baseline?**
   - What we know: $12.99/mo + $132.49/yr are the two plans (per CONTEXT codebase line + P14).
   - What's unclear: How to weight clinic-org per-patient billing into "MRR" (variable seat count).
   - Recommendation: For v1.3, exclude clinic-org cancellations from MRR math (count separately as "clinic-CSM-contact"). Document in 40-06 view definition.

4. **Are there any non-Stripe payment paths to handle?**
   - What we know: P14 Stripe is the only payment provider. No Apple/Google IAP in v1.3.
   - What's unclear: Whether mobile-app Phase 1.4 will need a different cancellation path.
   - Recommendation: Out of scope. Document v1.4 mobile cancellation as a downstream concern in deferred-ideas.

5. **D-15 implementation: should the cap apply to extended-trial offers too, or only discount?**
   - What we know: Extended-trial is "free time" not "% off"; it doesn't combine with the affiliate %.
   - What's unclear: Whether a user with a 30% affiliate discount + 30-day extended trial counts toward the 35% cap.
   - Recommendation: **NO** — cap applies only to multiplicative-discount stacking (`offer_type='discount'`). Extended-trial is a free-period grant, not a price reduction; doesn't compose with `percent_off`. Document explicitly.

---

## Sources

### Primary (HIGH confidence)

- **Stripe Webhook Events Types** — https://docs.stripe.com/api/events/types — `[VERIFIED via Context7 /websites/stripe 2026-05-21]` — Confirmed `customer.subscription.paused` and `.resumed` only fire for `status=paused` (new pause endpoint), not for pause_collection
- **Stripe Pause Collection** — https://docs.stripe.com/billing/subscriptions/pause-payment — `[VERIFIED via Context7 + WebFetch]` — `pause_collection={behavior:'void', resumes_at}` semantics
- **Stripe Subscription Discounts** — https://docs.stripe.com/billing/subscriptions/discounts — `[VERIFIED via Context7 + WebFetch]` — Confirmed multiplicative stacking; max 20; preserve existing discounts on update
- **Stripe Coupons API** — https://docs.stripe.com/api/coupons — `[VERIFIED]` — `percent_off + duration='repeating' + duration_in_months` semantics
- **Existing stripe-webhook dispatcher** — `/Users/karstenhaldan/minisite/supabase/functions/stripe-webhook/index.ts` — `[VERIFIED inline]` — Dispatcher structure, idempotency pattern, PII safety, `mapStripeStatusToUxTier` location
- **40-CONTEXT.md** — `[VERIFIED inline]` — All 22 decisions D-01..D-22
- **40-UI-SPEC.md** — `[VERIFIED inline]` — Three surfaces, all copy contracts, bundle ceiling note
- **STATE.md planner outline** — `[VERIFIED inline]` — Pre-computed 6-plan structure (research validates with 2 corrections)

### Secondary (MEDIUM confidence)

- **affiliate_conversions fraud trigger** — `/Users/karstenhaldan/minisite/supabase/migrations/20270101000008_fraud_trigger_conversion.sql` — Existing IP/fingerprint/email-domain self-referral detection (verified inline; informs D-15 option (a) feasibility analysis)
- **Phase 26 D-08 dispatcher case-arm pattern** — verified inline from 26-CONTEXT.md; new arms BEFORE default
- **P27 cohort_membership matview** — verified inline from 27-CONTEXT.md (D-07); 15-min staleness acceptable
- **P35 xp_ledger append-only pattern** — referenced by CONTEXT (canonical_refs) as the schema model

### Tertiary (LOW confidence — flagged in Assumptions)

- A1 (Stripe discounts[] read shape) — needs code-write-time verification against `stripe@19` types
- A3 (auto-resume webhook deterministic firing) — Stripe docs don't explicitly confirm; mitigation in 40-02 via cron sweep
- A5 (LeanShot trial-pause edge case) — needs Stripe sandbox test before production deploy

---

## Metadata

**Confidence breakdown:**

- Standard stack: **HIGH** — All major dependencies are pre-existing (Stripe, Supabase, Email-Router, Chart.js); no new packages
- Architecture: **HIGH** — Pattern reuse (P14 dispatcher, P25 email-router, P27 cohort matview, P33 admin chart, P35 append-only log, P37 ticket-create) is verified inline
- Stripe API specifics: **HIGH** — Verified via Context7 + WebFetch + docs.stripe.com cross-reference for both pause_collection and discount stacking
- Pitfalls: **HIGH** — Drawn from project memory (P25, P26, P27, P35, P37 lessons) + Stripe-docs verification
- D-15 recommendation: **HIGH** — Option (b) is cheapest, deterministic, no false-positives, and UI-SPEC already specs the user-facing surface

**Research date:** 2026-05-21
**Valid until:** 2026-06-20 (30 days for stable Stripe APIs; sooner if Stripe deprecates `pause_collection` field which is non-public-roadmap as of this research)

---

## RESEARCH COMPLETE

**Phase:** 40 — Cancellation Save-Offers Flow
**Confidence:** HIGH

### Key Findings

1. **CRITICAL CONTEXT correction:** Stripe `customer.subscription.paused` and `.resumed` webhooks do NOT fire for `pause_collection`-based pauses (verified two ways via docs.stripe.com). CONTEXT D-11 wording is misleading. **Plan 40-02 must EXTEND existing `events/subscription-updated.ts` to detect pause_collection deltas; must NOT add new case arms.**
2. **Stripe natively supports multiplicative coupon stacking** via `subscriptions.discounts[]` array (max 20). 10% affiliate × 25% save = 0.9 × 0.75 = 67.5% (matches D-14 verbatim). Use `[...existing, { coupon }]` append, never overwrite.
3. **D-15 RECOMMENDATION: option (b) — 35% combined-effective server clamp.** Cheapest, deterministic, zero false-positives, UI-SPEC already specs the user-facing notice. Implementation = ~15 lines of TypeScript in `cancellation-decide-offer/anti-gaming.ts`.
4. **STATE.md plan outline (pre-computed during halted background run) is architecturally correct** with two corrections: (a) drop "new case arms" from 40-02 outline; (b) split decide-offer + accept-offer into two Edge Fns for latency reasons.
5. **No new dependencies; no new infrastructure.** Everything Phase 40 needs (Stripe APIs, webhook dispatcher, email-router, cohort matview, admin shell, chart wrapper, ticket-create, PostHog Ship-Winner) is pre-existing. Plans EXTEND, not REIMPLEMENT.

### Confidence Assessment

| Area | Level | Reason |
|------|-------|--------|
| Standard Stack | HIGH | All dependencies pre-existing and version-verified |
| Architecture | HIGH | All patterns inherited from prior phases (P14/P25/P27/P33/P35/P37) and validated inline |
| Stripe APIs | HIGH | Verified via Context7 + WebFetch + cross-references |
| D-15 mitigation | HIGH | Deterministic math; UI-SPEC pre-specs the notice |
| Pitfalls | HIGH | Drawn from documented project memory + Stripe-docs |
| Bayesian warm-start (A2) | LOW | Cold-start hardcoded is fine for v1.3; warm-start is future work |
| Auto-resume webhook (A3) | MEDIUM | Stripe docs don't explicitly confirm timing — mitigated via cron sweep |
| Trial-pause edge case (A5) | MEDIUM | Needs sandbox test pre-prod |

### Open Questions

See §Open Questions above. None block planning; all are scoped to specific plans (40-02, 40-03, 40-06).

### Ready for Planning

Research complete. Planner can now create six PLAN.md files following the wave structure in STATE.md (with the two corrections above). Each plan should reference the relevant pitfalls + code examples + assumption-log items at its task level.
