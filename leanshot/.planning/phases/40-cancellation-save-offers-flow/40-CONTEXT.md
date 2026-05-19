# Phase 40: Cancellation Save-Offers Flow - Context

**Gathered:** 2026-05-19
**Status:** Ready for planning

<domain>
## Phase Boundary

Three-step cancellation funnel with server-picked save-offers:

1. **Step 1 — Reason picklist** (6 reasons + Other): "Why are you cancelling?" data capture before offers are personalized.
2. **Step 2 — Save-offer modal**: server picks ONE recommended offer (highest-take-rate for this user's cohort × tenure × reason). Modal shows offer + 'Decline (continue cancellation)' button. 4 offer types: pause / discount / extended trial / downgrade.
3. **Step 3 — Loss-summary confirmation**: streak / projected curve / AI coach history / data-export reminder + final 'Cancel anyway / Keep my account' choice.

Server-side offer-take logging to `cancellation_offers_log` for ROI dashboard. POLISH-01..04 closed by this phase.

**Out of scope (explicitly):**
- POLISH-05..12 (smart notifications, PWA, dark mode, WCAG audit, what's-new, NPS) — those live in Phase 41/42.
- Clinic-org cancellation routes through a DIFFERENT path (per D-09) — admin-CSM contact + discount only, no pause/extended-trial cards.
- Reactivation flow polish — when a paused/cancelled user reactivates, standard re-signup; this phase doesn't redesign reactivation UX.

</domain>

<decisions>
## Implementation Decisions

### Eligibility Rules + Cohort/Tenure Thresholds (POLISH-01)

- **D-01: Tenure-based offer gating (default; admin-configurable).**
  - `<30d tenure`: pause + discount only (no extended-trial; brand-new users don't need a "trial" extension; no downgrade pre-30d either — too early).
  - `30-180d tenure`: all 4 offers eligible.
  - `>180d tenure`: pause + discount + downgrade (NO extended-trial — paying user doesn't get a free trial regression).
  - Tenure measured from `subscription.created_at` (Stripe).
- **D-02: Anti-gaming caps — 2 lifetime save-offer takes per user, 12mo cooldown between takes.** Pause does NOT count toward the lifetime cap (it's a delay, not an economic concession). Discount + extended-trial + downgrade each count. After 2 lifetime takes, user sees 'Continue cancellation' directly with no offer modal.
- **D-03: 12-month cooldown between save-offer takes.** Server enforces via `cancellation_offers_log.last_taken_at`. User can cancel-and-resubscribe freely; cooldown only blocks the SAVE-OFFER modal from showing.
- **D-04: Clinic-orgs see DIFFERENT offer set** — admin-CSM contact-card + discount only. NO pause (clinic per-patient billing has different mechanics per P29 D-04 invoice variance handling). NO extended-trial (clinic tier doesn't have a trial concept). NO downgrade (clinic tiers shape differently). Falls back to 'CSM will contact you within 24h' card + a Stripe discount option if eligible.
- **D-05: Cohort-aware offer assignment via admin rule-builder.** Admin defines per-cohort offer eligibility in `save_offer_rules` table (cohort_id + offer_type + percent_off + duration + active flag). Server resolves the recommended offer at decision time.

### Pause Subscription Mechanics (POLISH-03)

- **D-06: 1 / 2 / 3 month pause presets only.** ROADMAP literal. Stripe `subscriptions.update({ pause_collection: { behavior: 'void', resumes_at: <ts> } })` per [Stripe pause docs](https://stripe.com/docs/billing/subscriptions/pause-collection). `behavior: 'void'` means no invoices are issued during pause; on `resumes_at` billing auto-resumes. No custom-date picker in v1.3.
- **D-07: User gets READ-ONLY access during pause.** Existing data (charts, history, projections, AI coach history) remains visible. NEW logging (injection, weight, symptom, workout) DISABLED — clear UI banner: "Your account is paused — logging resumes [date]. Resume now?". Encourages return to active billing.
- **D-08: Auto-resume billing on `resumes_at`.** Card on file auto-charged; user receives confirmation email day-of. No explicit-resume requirement (avoids inertia-driven loss).
- **D-09: Resume notification cadence — 7-day-ahead reminder + day-of confirmation.** Two emails per pause:
  - T-7d: "Your subscription resumes [date]. Card on file: •••• 1234. Extend pause? / Resume now?"
  - T-0: "Welcome back — billing resumed today."
  - Both via `_shared/email-router.ts` (Resend for non-PHI consumer; SES for clinic-org PHI per P25 D-03).
- **D-10: Pause-while-paused — user CAN extend an active pause from the T-7d email, subject to anti-gaming D-02/D-03.** Extend = updating Stripe `pause_collection.resumes_at` to a later date. Counts as taking the pause offer AGAIN (so 3-month pause + 1-month extension = pause-take #2 in lifetime; subsequent extensions would hit the 2-take cap).
- **D-11: Stripe webhook `customer.subscription.paused` and `customer.subscription.resumed` handled in dispatcher.** Mirrors `subscription.paused_until` / `subscription.is_paused` to local state for UI gating. Extends the existing stripe-webhook dispatcher (P14 + P26 D-08 pattern; new case arms before default per the 26-07 lesson).

### Discount Orchestration + Coupon Stacking (POLISH-04)

- **D-12: Pre-created coupon pool model.** Admin creates a fixed catalog of 6 coupons in Stripe (or via Plan 40 seed migration): `SAVE-20-2MO`, `SAVE-20-3MO`, `SAVE-25-2MO`, `SAVE-25-3MO`, `SAVE-30-2MO`, `SAVE-30-3MO`. Save-flow looks up the coupon by `percent_off` + `duration_in_months` from the assigned offer; applies via `subscriptions.update({ promotion_code: ... })` or `coupon` field per the [Stripe Coupons API](https://stripe.com/docs/api/coupons). Predictable, auditable, low Stripe-object volume.
- **D-13: 6 fixed combinations (20/25/30 % × 2/3 months); admin assigns one combo per cohort/rule.** No on-the-fly arbitrary % — admin picks from the catalog. A/B variants come from assigning DIFFERENT combos to control vs variant cohorts.
- **D-14: Save-offer discount STACKS with active affiliate / referral coupons.** Mathematically: a user on 10% affiliate referral coupon AND accepting a 25% save-offer effectively pays 67.5% of list price (multiplicative stack: 0.9 × 0.75 = 0.675). Most user-friendly position.
- **D-15: Stacking abuse risk surfaced as Plan-time concern.** A user could self-refer via a friend's affiliate code (10%), then trigger save-offer (25%), getting 32.5% effective discount. Mitigation candidates for planner:
  - Anti-self-referral check (compare cancelling user's signup-IP / device-fingerprint to affiliate-owner's last-known IP/device).
  - Cap stacking to 35% combined discount (server clamps; user notified "Your existing 10% affiliate discount caps the save-offer at 25% effective.").
  - Just accept the abuse risk (low expected volume in v1.3; revisit if data surfaces fraud).
  - Plan-checker should pick one and document in PLAN.md.
- **D-16: Discount applies to NEXT invoice (not retroactive).** Per Stripe coupon semantics with `duration: 'repeating', duration_in_months: N`. User keeps the discount for N future invoices; expires automatically. No prorated refund of the current period.

### Cancellation Modal UX + Pre-Cancellation Friction (POLISH-01)

- **D-17: Three-step flow — reason picklist → server-picked single offer → loss-summary confirmation.**
- **D-18: Step 1 — Reason picklist BEFORE offers shown.** 6 reasons + Other (free-text):
  1. Too expensive
  2. Not using it enough
  3. Found an alternative
  4. Health goals changed
  5. Temporary break needed
  6. Service quality issue
  7. Other (free-text required)
  Reason value drives offer personalization (e.g., 'Too expensive' → discount; 'Not using it enough' → pause; 'Temporary break needed' → pause; 'Service quality issue' → escalate to helpdesk via P37 path AFTER cancellation).
- **D-19: Step 2 — Server-picks ONE recommended offer.** Edge Fn `cancellation-decide-offer` evaluates: cohort × tenure × reason × prior-takes → returns the offer with highest historical take-rate for matching prior-cancellations (cold-start: hardcoded mapping per reason). Modal shows the offer card with primary CTA + 'No thanks, continue cancellation' link.
- **D-20: Step 3 — Loss-summary confirmation card.** Final screen shows:
  - Current streak length (from P35)
  - Projected curve preview (med-level chart snippet — the headline product value)
  - AI coach conversation count (from `ai_messages` table)
  - "Your data stays exported via CSV until you reactivate" reminder (existing CSV export from v1.1)
  - Final CTAs: "Cancel anyway" / "Keep my account"
- **D-21: Service-quality-issue reason auto-creates helpdesk ticket AFTER cancellation.** If user picks 'Service quality issue' + completes cancellation, server fires a P37 ticket-create (subject: "Feedback from cancellation: <reason summary>"; tags: `cancellation-feedback` + sentiment-tagged per P37 D-10). Closes the feedback loop even on lost users.
- **D-22: A/B variants on offer copy + recommendation algorithm via PostHog Experiments + Ship-Winner.** Same Phase 34/35/36 pattern. Variants can test: offer-copy framings, recommendation-algorithm threshold tuning, even the order of reason picklist options (alphabetical vs cost-first).

### Claude's Discretion

- **ROI dashboard layout (POLISH-02).** Admin `/admin/cancellation/roi`. Metrics: offer-shown / offer-accepted / lifetime-revenue-recovered (= deferred-MRR × months-retained). Per-cohort breakdown. Reuses Phase 33 admin-CAC dashboard chart pattern (Chart.js).
- **Recommendation algorithm details.** Cold-start hardcoded mapping (reason → preferred offer); warm-start ML-free Bayesian update over cohort-take-rates. No actual ML in v1.3.
- **Downgrade offer mechanics.** Annual → Monthly is the primary downgrade path (preserves revenue at lower friction). Stripe API: cancel current annual, create new monthly at next renewal. Planner picks exact API sequence.
- **`cancellation_offers_log` schema.** Append-only; service-role insert; admin select; RLS deny patient direct. Planner picks columns beyond the required (user_id, offer_type, accepted, taken_at, cohort_snapshot, reason).

</decisions>

<canonical_refs>
## Canonical References

### ROADMAP + REQUIREMENTS
- `.planning/ROADMAP.md` §"Phase 40: Cancellation Save-Offers Flow" — 4 success criteria
- `.planning/REQUIREMENTS.md` §WS-Polish lines 232–235 — POLISH-01..04 verbatim

### Prior-phase load-bearing
- `.planning/phases/14-*/` — Stripe subscriptions live ($12.99/mo + $132.49/yr); Billing Meters v1; createSubtleCryptoProvider
- `.planning/phases/19-*/` — affiliate_conversions + coupon stacking surface (D-14/D-15 abuse vector)
- `.planning/phases/26-multi-tier-affiliate-standard-gold-lifetime/26-07-SUMMARY.md` — stripe-webhook dispatcher extension pattern (D-11 case arm pattern)
- `.planning/phases/27-modular-admin-shell-extensions/` — admin shell module + cohort builder
- `.planning/phases/29-*/` — clinic per-patient metered billing + invoice variance (D-04 clinic-distinct offer set)
- `.planning/phases/37-m6-helpdesk-core/37-CONTEXT.md` — D-15 ticket-create path (D-21 service-quality-issue routing)
- `.planning/phases/34-m2-onboarding-overhaul-activation-event/34-CONTEXT.md` — D-20 PostHog Experiments + Ship-Winner (D-22 mirrors)

### Codebase
- `supabase/functions/stripe-webhook/index.ts` — extend dispatcher with `customer.subscription.paused/resumed` case arms (D-11)
- `supabase/functions/stripe-webhook/events/` — NEW handlers `customer-subscription-paused.ts` + `customer-subscription-resumed.ts` (mirror invoice-paid.ts pattern)
- `supabase/functions/_shared/email-router.ts` — D-09 resume notifications
- `leanshot/src/lib/analytics/events.ts` — extend with `cancellation_started`, `cancellation_reason_picked`, `save_offer_shown`, `save_offer_accepted`, `save_offer_declined`, `cancellation_completed`, `subscription_paused`, `subscription_resumed` events
- `leanshot/src/lib/org.ts` — `surfaceCheck('admin.cancellation.*')` for admin save-offer-rule editor + ROI dashboard

### Codebase maps
- `.planning/codebase/ARCHITECTURE.md`
- `.planning/codebase/STACK.md`
- `.planning/codebase/INTEGRATIONS.md` — Stripe wiring + webhook conventions

### Memory pointers
- [[reference_supabase_migration_filename_regex]]
- [[reference_supabase_migration_gotchas]]
- [[reference_stripe_platform_capabilities_endpoint]] — for any Stripe capability checks
- [[reference_stripe_legacy_key_and_supabase_token]]
- [[feedback_planner_missed_status_enum_widening]] — `cancellation_offers_log.status` enum, `save_offer_rules.active`
- [[reference_supabase_functions_deploy_no_linked_flag]] — omit `--linked` from `functions deploy`
- [[feedback_planner_iter1_anti_patterns]]

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `_shared/email-router.ts` (P25 D-03) — resume notifications + cancellation-feedback ticket emails
- stripe-webhook dispatcher (P14 + P26 D-11 case arm pattern from `4c41005`) — extend for paused/resumed events
- P37 helpdesk ticket-create Edge Fn (D-15) — D-21 service-quality-issue ticket creation
- PostHog Experiments + Ship-Winner pattern (P34 D-20) — D-22 A/B variants
- P27 cohort builder + admin shell module pattern — D-05 admin save-offer-rule editor
- Phase 33 admin-CAC dashboard chart pattern — POLISH-02 ROI dashboard reuses

### Established Patterns
- Append-only log tables (cancellation_offers_log mirrors v1.2 audit_logs / Phase 35 xp_ledger pattern)
- Two-axis RLS (user_id + org_id where applicable for clinic orgs)
- Stripe webhook event-handler dispatcher with lazy imports + extension via new case arms (per P26 26-07 lesson: extend EXISTING arms in place where possible; add new arms before default)
- pg_cron + SECDEF for any periodic eligibility recomputation (per [[reference_supabase_pg_cron_vault_service_role_pattern]])
- Coupon-tier widening migration if new percent_off values get added beyond the 20/25/30 catalog

### Integration Points
- `App.tsx` settings → Account → Cancel subscription → opens the 3-step modal (lazy chunk)
- Admin shell — new `/admin/cancellation` module (save-offer-rules editor + ROI dashboard)
- Stripe webhook — extends dispatcher (D-11)
- Edge Fns: `cancellation-decide-offer` (Step 2 server-pick), `cancellation-feedback-to-ticket` (D-21)
- Email sends via P25 `_shared/email-router.ts`

</code_context>

<specifics>
## Specific Ideas

- The 3-step funnel (D-17..D-20) is the load-bearing UX shape. Plan-checker must enforce that the modal is a SINGLE chunked component (not 3 separate routes) — keeps the cancellation chunk in one place.
- Reason picklist BEFORE offer (D-18) is the highest-data-quality path. Even on offer-accept cases, we capture the reason. This compounds value over time (better Bayesian recommender priors).
- Server-picks-one (D-19) is a deliberate choice over paradox-of-choice menus. The "Decline" link is always visible — user agency preserved.
- Loss-summary (D-20) shows the headline product value (med-level curve + streak) — explicitly leverages [P35 D-09 ethical-only positioning] — no FOMO escalation, just an honest reminder of what's there.
- Stacking abuse vector (D-15) is the open Plan-time concern. Recommend planner picks the "cap combined discount at 35% effective" option as the cheapest mitigation that preserves user-friendly stacking for legitimate referral users.
- Pause-while-paused (D-10) interaction with the 2-take lifetime cap is intentional — extending a pause counts as a new pause-take, which is exempted from the cap. The exemption + extension semantics means a user could theoretically pause indefinitely with periodic extensions; D-06 1/2/3 month limit + Stripe's own 12-month max on pause_collection naturally bound this.

</specifics>

<deferred>
## Deferred Ideas

### Custom-date pause picker
v1.3 ships 1/2/3-month presets only. Custom-date picker deferred — usage data will tell if users want different durations.

### Per-cohort save-offer ML model
v1.3 cold-start hardcoded + warm-start Bayesian over historical take-rates. Full ML model (e.g., gradient-boost on cohort+tenure+reason features) deferred to v1.4 once `cancellation_offers_log` accumulates enough samples.

### Stripe webhook subscription pause/resume HUMAN-UAT
Stripe Dashboard needs to subscribe the existing webhook endpoint to `customer.subscription.paused` + `customer.subscription.resumed` events (per [[project_phase26_shipped]] HUMAN-UAT lesson). Planner adds this as a Task 5 HUMAN-UAT in the relevant plan.

### Downgrade offer for clinics
D-04 excludes downgrade from clinic-org offer set. If a future clinic tier shape supports downgrade (e.g., 'Pro Clinic' → 'Starter Clinic'), revisit at the time. Out of scope here.

### Reactivation flow polish
When a paused/cancelled user re-engages, current re-signup UX applies. Reactivation-specific UX (e.g., 'Welcome back — your data is exactly where you left it') deferred to a v1.4 polish phase.

### Stacking abuse explicit fraud detection
D-15 surfaces the stacking abuse vector. Production-grade fraud detection (device fingerprinting, IP overlap, behavioral anomaly) is out of scope for v1.3; planner picks the cheapest mitigation (recommended: 35% effective discount cap).

### Auto-discount when payment fails (dunning save-flow)
This phase covers user-initiated cancellation. Dunning (Stripe `invoice.payment_failed` → save-flow before subscription churns) is a related but distinct flow — could come in a v1.4 polish phase. Reuses the same coupon catalog.

</deferred>

---

*Phase: 40-cancellation-save-offers-flow*
*Context gathered: 2026-05-19*
