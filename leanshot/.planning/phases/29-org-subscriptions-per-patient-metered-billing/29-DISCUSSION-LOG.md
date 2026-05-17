# Phase 29: Org Subscriptions + Per-Patient Metered Billing - Discussion Log

> **Audit trail only.** Not consumed by downstream agents.

**Date:** 2026-05-17
**Phase:** 29 — Org Subscriptions + Per-Patient Metered Billing
**Areas discussed:** subscriptions table reconciliation (A1), customer key model (A2), active patient definition (D-01), invite mechanism (D-06/07/08), billing cron schedule (D-02), webhook extension boundary (D-04)

---

## Pre-discuss scout caught Q-A1-class LANDMINE

Applied `[[feedback_discuss_phase_must_scout_live_schema]]` lesson (saved earlier this session). Scout of `supabase/migrations/` BEFORE generating gray areas surfaced that Phase 14 already shipped:
- `public.clinic_stripe_customers` (clinic-keyed)
- `public.subscriptions` (unified XOR user/clinic)
- `public.subscription_events` (idempotency log)
- `stripe-webhook` Edge Fn (8 event handlers)

P28 just shipped duplicate `public.org_subscriptions` skeleton — substantially overlaps. Surfaced to operator as A1+A2 reconciliation BEFORE any further gray areas were generated.

---

## A1 — subscriptions vs org_subscriptions reconciliation

| Option | Description | Selected |
|--------|-------------|----------|
| Drop org_subscriptions, extend Phase 14 subscriptions (Recommended) | DROP P28 skeleton, extend Phase 14's existing clinic_id branch. Zero data migration. | ✓ |
| Keep org_subscriptions, deprecate subscriptions.clinic_id | Heavier; data migration needed if any clinic rows live. | |
| Both coexist with different grain | Most ambiguity; not recommended. | |

**User's choice:** Drop + extend. Locks Phase 14 as canonical Stripe schema for v1.3+.

---

## A2 — customer key model (ORG-08 wording)

| Option | Description | Selected |
|--------|-------------|----------|
| Phase 14 wins — clinic_id is right key; ROADMAP wording imprecise (Recommended) | Same-email-different-customer property already satisfied by two-tables split. CI test asserts. | ✓ |
| Add user-context-keyed mapping table | Heavier; only justified if multi-org-admin live in v1.3. | |
| Rename clinic_stripe_customers → org_stripe_customers | Cosmetic only. | |

**User's choice:** Phase 14 wins. ROADMAP wording defers to live schema reality.

---

## D-01 — count_active_patients definition

| Option | Description | Selected |
|--------|-------------|----------|
| ANY logged event in last 30 days (Recommended) | UNION across all patient-data tables. Matches healthcare SaaS norms. | ✓ |
| INJECTION event only (strictest) | Lower bill; might undercount engaged patients. | |
| Linked + non-unlinked (simplest, highest bill) | Risks discouraging clinic-prospect invites. | |

---

## D-06/07/08 — Patient invite mechanism

| Option | Description | Selected |
|--------|-------------|----------|
| New `org_patient_invites` table + new Edge Function (Recommended) | Parallel to P28 admin invites. Mirrors A2 sibling pattern. W-1 invariant preserved via Phase 9 makeInviteTokenHash import. | ✓ |
| Extend P28 org_invites with `kind` discriminator | Mixed-shape rows; anti-pattern P28 explicitly rejected. | |
| Re-use Supabase Auth signInWithOtp | Less code; consent UI requires extra round-trip. | |

---

## D-02 — Billing cron schedule

| Option | Description | Selected |
|--------|-------------|----------|
| Nightly 02:00 UTC + idempotent on (org_id, yyyymm) (Recommended) | One Meter Event per org per month. Clean cron slot. | ✓ |
| Hourly with monthly rollup | More API calls; potential dedup issues. | |
| On-demand at invoice gen (28th of month) | Simplest but loses prorate UX. | |

---

## D-04 — Webhook extension boundary

| Option | Description | Selected |
|--------|-------------|----------|
| Extend existing stripe-webhook with org-specific handlers (Recommended) | Zero new Edge Functions. Existing subscription.* events already handle clinic branch. | ✓ |
| New org-subscription-webhook Edge Function | Doubles surface; separate webhook secret + dashboard config. | |

---

## Claude's Discretion

See CONTEXT.md §Claude's Discretion. Highlights: consent UI primitives, magic-link reuse strategy, Sentry variance threshold, batch-vs-loop in metered cron, function-vs-matview for count_active_patients.

## Deferred

Admin Billing deep view UX, multi-org-admin Stripe customer split, hourly cron, prorate-on-invite, patient self-revoke UI, Stripe Tax, multiple billing tiers. See CONTEXT.md §Deferred Ideas.
