# Phase 26: Multi-Tier Affiliate (Standard / Gold / Lifetime) - Context

**Gathered:** 2026-05-17
**Status:** Ready for planning

<domain>
## Phase Boundary

Existing v1.2 Phase 19 affiliate program graduates to tiered commissions with stamped-at-conversion-time accounting and Lifetime recurring payouts.

In scope:
1. Tier enum (Standard/Gold/Lifetime) on `affiliate_program`; auto-promotion Standard→Gold at N=10 paid conversions; admin-grant Gold→Lifetime.
2. `tier_at_conversion_time` + `commission_cents` stamped at insert; commission NEVER recomputed retroactively on tier upgrade (AFFTIER-02).
3. `affiliate-lifetime-recurring` monthly cron Edge Fn paying Lifetime affiliates on still-active Stripe subscribers (AFFTIER-04).
4. Z-score >3σ on 7-day click-rate-baseline anomaly detector → flag conversions to admin review queue (AFFTIER-05); extends v1.2 AFF-08.
5. Partner-dashboard tier-progress bar + per-tier earnings breakdown + next-tier threshold (AFFTIER-03).
6. Gold landing template variant via existing AffiliateLandingResolver (AFFTIER-06).

Out of scope: per-partner branded landing (Gold gets shared premium theme only — deferred); Lifetime white-label landing (v1.5); multi-level affiliate / MLM (anti-feature per research SUMMARY); bandit auto-shifting tier thresholds (anti-feature).

</domain>

<decisions>
## Implementation Decisions

### Commission rates + threshold
- **D-01 — Commission rates: Standard 20% / Gold 30% / Lifetime 25% monthly recurring.** Industry-typical SaaS affiliate band (5-30% one-time). Math on $12.99/mo Pro: Standard = $2.60 one-time per conv; Gold = $3.90; Lifetime = $3.25/mo recurring (~30% of average subscriber LTV at 5-mo retention). Math on $132.49/yr annual: Standard = $26.50; Gold = $39.75; Lifetime = ~$2.76/mo recurring amortized.
- **D-02 — Standard → Gold auto-promotion threshold N = 10 paid conversions.** Real signal of capable partner without being out-of-reach. Realistic for v1.3-era partner pool size. NOT tunable in admin in v1.3 (defer to admin_settings only if first deal demands flexibility).

### Tier ratchet + removal
- **D-03 — Promotion-only ratchet — never volume-downgrade.** Once Gold, always Gold. Once Lifetime, always Lifetime (subject to D-04 fraud-freeze). Aligns with REQ AFFTIER-01 "locked-once-earned". Removes "why was I downgraded?" disputes.
- **D-04 — Tier removal trigger = fraud-freeze ONLY (superadmin manual via /admin/affiliates).** Anomaly review flags + superadmin can `freeze` tier (commission stops accruing on new conversions; existing approved conversions paid normally; tier shown as `Frozen` on partner dashboard with appeal CTA). Audit-logged (Phase 24 audit_logs). REVERSIBLE by superadmin. No auto-freeze. No Lifetime revocation in v1.3 (use freeze instead).

### Lifetime recurring cron — subscriber lifecycle
- **D-05 — Pay-tracks-Stripe-active.** `affiliate-lifetime-recurring` cron Edge Fn (monthly, day-1 03:00 UTC) queries `stripe_subscriptions` where `status='active'` AND linked-conversion's `tier_at_conversion_time='lifetime'`. Skip everything else (pause, past_due, canceled, trial). Resub-after-cancel = NEW conversion subject to fresh attribution (does NOT auto-restore Lifetime claim on same sub).
- **D-06 — Commission tracks current $ amount; refunds claw back; chargebacks claw back + freeze tier review.** Subscriber plan-changes (upgrade/downgrade) → next month's Lifetime commission scales to current Stripe price (25% of amortized monthly). Refund issued by Stripe → commission for that period clawed back from NEXT payout (negative row in `affiliate_payouts.adjustments`). Chargeback → claw back + write a row to `affiliate_fraud_signals` that flags tier for superadmin review (suggests bad-quality referral).
- **D-07 — Idempotency key per (affiliate_id, subscription_id, billing_period_yyyymm).** Cron retry-safe. Existing row = no-op.
- **D-08 — Pay-out batched into existing v1.2 Phase 19 Stripe Connect payout schedule.** No separate Stripe Connect platform; reuse the existing `affiliate_payouts` table + Stripe Connect Express transfers; add `recurring_payout_kind` enum column ('one_time' | 'lifetime_recurring').

### Anomaly detection
- **D-09 — Z-score >3σ on 7-day click-rate baseline (impressions/clicks ratio) → "pay + flag + admin review queue" policy.** Default-trust posture. Conversion pays on normal schedule; same row gets `anomaly_flagged=true` + appears in `/admin/affiliates/review` queue. Superadmin reviews within 7 days; if confirmed fraud, claw back from NEXT payout (`affiliate_payouts.adjustments`) + freeze tier (D-04). Lowest false-positive friction; LeanShot accepts 7-day exposure window.
- **D-10 — Anomaly detection extends v1.2 AFF-08 (does not replace).** v1.2 AFF-08 already ships a hybrid scope; Phase 26 adds the Z-score statistical layer + 7d rolling baseline on top.
- **D-11 — Anomaly review queue surfaces in /admin/affiliates module (Phase 24 admin shell manifest entry).** New tab "Anomaly Review" alongside existing "Application Review" tab (v1.2 AdminAffiliatesReviewQueue.tsx). Reuse table primitives.

### Gold landing template
- **D-12 — Shared "premium" theme variant for all Gold partners in v1.3.** AffiliateLandingResolver (Phase 19 existing) branches on partner.tier → resolves to `/r/[code]/landing-gold` template variant. Same theme + copy across all Gold partners; their referral code is the differentiator. Per-partner branding (logo + accent color) DEFERRED — revisit at Lifetime tier or v1.5 dedicated white-label phase.
- **D-13 — Playwright screenshot diff per tier-variant baked into CI.** AFFTIER-06 success criterion #5 explicit. Snapshot baselines per Standard / Gold templates.

### Gold → Lifetime admin grant
- **D-14 — Superadmin single-approver grant; audit-logged; reversible until first recurring payout.** /admin/affiliates UI "Grant Lifetime" button on Gold partner row. Audit-logged via Phase 24 `audit_logs`. REVERSIBLE within 7-day window OR until first `affiliate-lifetime-recurring` payout writes a row for this affiliate (whichever comes first). After first payout = locked (per D-03 ratchet). Two-superadmin approval deferred to future when staff > 5.

### Schema additions (planner discretion on exact DDL)
- **D-15 — `affiliate_program` ALTER:** add `tier enum('standard','gold','lifetime') NOT NULL DEFAULT 'standard'`, `tier_promoted_at timestamptz`, `tier_grantor_user_id uuid` (nullable, populated when superadmin grants Lifetime), `frozen_at timestamptz`, `freeze_reason text`.
- **D-16 — `affiliate_conversions` ALTER:** add `tier_at_conversion_time enum('standard','gold','lifetime') NOT NULL` (stamped at insert via trigger reading current `affiliate_program.tier`), `recurring_commission_pct_basis numeric(5,2) NULL` (only set for Lifetime conversions — basis used by D-06 scaling), `anomaly_flagged boolean NOT NULL DEFAULT false`, `anomaly_z_score numeric NULL`, `anomaly_reviewed_at timestamptz NULL`, `anomaly_review_decision enum('clear','fraud_confirmed') NULL`.
- **D-17 — `affiliate_lifetime_recurring_payments` NEW table:** `(id, affiliate_program_id, stripe_subscription_id, billing_period_yyyymm INTEGER, gross_subscription_cents INTEGER, commission_cents INTEGER, stripe_payout_id, paid_at, idempotency_key UNIQUE)`. Per D-07 idempotency.
- **D-18 — `affiliate_fraud_signals` NEW table:** `(id, affiliate_program_id, signal_type enum('chargeback','anomaly_z_score','manual'), payload jsonb, created_at, reviewed_at, decision)`. Feeds anomaly review queue (D-11).
- **D-19 — Tier-stamping enforced by Postgres trigger** at `affiliate_conversions` BEFORE INSERT. Reads `affiliate_program.tier`. Computes `commission_cents` from D-01 rates × current Stripe price. Test (AFFTIER-02 success criterion #1): retroactive tier upgrade DOES NOT mutate any historical conversion row.

### Claude's Discretion

Researcher and planner have latitude on:
- Exact DDL syntax for tier enum + ALTER ordering (follow `[[reference_supabase_migration_gotchas]]` + `[[reference_supabase_migration_filename_regex]]`).
- Whether `affiliate_lifetime_recurring_payments` is a separate table or extends `affiliate_payouts` with `recurring_payout_kind` (D-08 hints at the latter; planner picks).
- Exact pg_cron schedule for `affiliate-lifetime-recurring` (recommend day-1 03:00 UTC).
- Anomaly Z-score sliding-window implementation (materialized view refresh hourly OR computed per-query at flag-time).
- Exact UI primitives for tier-progress bar (reuse existing v1.2 components where possible).
- Whether Stripe-event-driven claw back uses webhook handler or polls — recommend webhook (refunds + chargebacks already trigger Stripe events the platform listens to).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### v1.3 Roadmap + Requirements
- `.planning/ROADMAP.md` §Phase 26 (lines 97–108) — Goal + 5 success criteria + 6 REQ list + UI hint.
- `.planning/REQUIREMENTS.md` — AFFTIER-01..06 (lines 40–45); REQ → phase mapping table (lines 408+).

### v1.3 Research
- `.planning/research/SUMMARY.md` — Multi-tier affiliate must-have; Lifetime recurring; click-rate Z-score; canonical-link discipline.
- `.planning/research/STACK.md` — Stripe Connect Express (v1.2 carry-forward); existing affiliate plumbing.
- `.planning/research/FEATURES.md` — "anti-feature: multi-level affiliate (MLM)"; "anti-feature: bandit auto-traffic-shifting A/B"; Lifetime recurring at must-have tier.
- `.planning/research/PITFALLS.md` — affiliate fraud detection patterns; commission claw-back semantics.

### Phase 24 + 25 carry-forward (prerequisite)
- `.planning/phases/24-foundation-modular-admin-shell-event-taxonomy-server-side-po/24-CONTEXT.md` — admin role model (D-04 superadmin tier authorizes grants + freezes); audit_logs schema (D-14..17 — audit-log entries for tier grants + freezes + claw backs); admin shell manifest (D-01..05 — /admin/affiliates module already declared at Phase 24).
- `.planning/phases/25-hipaa-audit-hardening-vendor-baa-chain/25-CONTEXT.md` — Stripe PHI lint (D-09 — affiliate code must not put patient names / medications in Stripe metadata; check `affiliate_lifetime_recurring_payments` references).

### v1.2 Phase 19 (foundation — read before designing)
- `.planning/milestones/v1.2-ROADMAP.md` §Phase 19 — affiliate schema (affiliate_program, affiliate_conversions, affiliate_payouts), AFF-08 anomaly hybrid scope.
- `src/lib/affiliate/api.ts` — existing API surface (extend for tier).
- `src/lib/admin/affiliate-review.ts` — existing admin review queue logic (extend for anomaly review).
- `src/components/admin/AdminAffiliatesReviewQueue.tsx` — existing UI (add anomaly tab).
- `src/components/admin/AdminAffiliatesScaffold.tsx` — Pattern S1 reference implementation (admin gate).
- `src/components/affiliate/AffiliateApplyForm.tsx`, `AffiliateApplyPage.tsx` — existing partner-facing UI.
- AffiliateLandingResolver (Phase 19 path TBD — researcher to grep) — extend for Gold variant.

### Memory references (decision rationale)
- `[[reference_phase19_research_findings]]` — `transfers.create` ≠ `payouts.create` for Express; 2026 IRS 1099-NEC $600→$2,000 (OBBB); 60-day chargeback OUR rule; Connect deletion needs zero LIVE balance.
- `[[reference_stripe_legacy_key_and_supabase_token]]` — Stripe legacy keys still valid; Management API.
- `[[feedback_realtime_layer_e2e_pattern]]` — DB-level invariant test (AFFTIER-02 historical immutability).
- `[[reference_supabase_migration_gotchas]]` — SECURITY DEFINER search_path; partial-index IMMUTABLE; audit cascade `app.suppress_audit`.
- `[[reference_supabase_migration_filename_regex]]` — 14-digit timestamp strict.
- `[[reference_rls_fixture_gotruechient_flake]]` — RLS test pattern for new tables.
- `[[feedback_vendor_account_circular_dependency]]` — vendor-account circular dependency rule (Stripe Connect already approved in v1.2 P14 — no new vendor gate).
- `[[reference_playwright_state_seeding]]` — Playwright state seeding via addInitScript (for AFFTIER-06 screenshot diff test).

### External docs (consult via Context7 at research time)
- Stripe Subscriptions API — subscription status enum (active / past_due / paused / canceled / trialing).
- Stripe Connect Express transfers + claw-back / negative-balance handling.
- Stripe Refund + Chargeback webhook payloads.
- Supabase pg_cron scheduling syntax.
- Postgres trigger BEFORE INSERT patterns for stamping.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`src/lib/affiliate/api.ts`** — existing partner API surface; extend with `getTierProgress(affiliateId)`, `getTierEarningsBreakdown(affiliateId)`, `requestGoldGrant(affiliateId)` (admin-only).
- **`src/lib/admin/affiliate-review.ts`** — existing review-queue logic; extend with anomaly-review actions (`confirm_fraud`, `mark_clear`).
- **`AdminAffiliatesReviewQueue.tsx`** — existing review-table UI; reuse + add Anomaly tab.
- **`AdminAffiliatesScaffold.tsx`** — Pattern S1 reference; mirror for the /admin/affiliates tier-management UI (Grant Lifetime button, freeze action).
- **AffiliateLandingResolver (Phase 19)** — already routes `/r/{code}/landing` to a template; extend to read partner.tier and return Gold variant template path.
- **Phase 24 audit_logs + `log_admin_action()` RPC** — all tier grants / freezes / claw backs call this; satisfies D-04 + D-14 audit requirement.

### Established Patterns
- **Pattern S1 dual-layer security** (Phase 24 D-03) — every admin RPC re-checks role + tier-grant authority.
- **Tier-stamping at conversion** (REQ AFFTIER-02) — Postgres BEFORE INSERT trigger; mirrors v1.2 stripe-event audit pattern.
- **Append-only audit_logs** (Phase 24 D-17) — anomaly-review decisions + tier grants + claw backs all written here.
- **Bundle ceiling** — `/admin/affiliates` already lives inside admin-shell 30 kB chunk (Phase 24 D-18). Phase 26 adds NO new client chunks.
- **Vendor-gated send via health check** (Phase 25 D-03 / `[[reference_vendor_gated_send_health_check]]`) — `affiliate-lifetime-recurring` cron health-checks Stripe Connect availability before each batch.
- **Idempotency keys on cron-written rows** (v1.2 carry-forward) — D-07 per (affiliate_id, subscription_id, billing_period_yyyymm).

### Integration Points
- **Postgres trigger on `affiliate_conversions` BEFORE INSERT** — stamps `tier_at_conversion_time` + `commission_cents` (D-19).
- **Stripe webhook handler** (v1.2 existing) — extend to handle `charge.refunded`, `charge.dispute.created` → claw back + freeze flag.
- **pg_cron** — `affiliate-lifetime-recurring` monthly day-1 03:00 UTC.
- **AffiliateLandingResolver branch on tier** — Gold variant template.
- **/admin/affiliates module** (Phase 24 manifest entry) — new tier-management UI + anomaly review tab.
- **Playwright screenshot test** — per-tier landing variant baseline (AFFTIER-06 success criterion #5).

</code_context>

<specifics>
## Specific Ideas

- Commission rates (D-01): 20% / 30% / 25%-monthly-recurring.
- Threshold (D-02): N = 10.
- Cron schedule (D-08): monthly day-1 03:00 UTC, batched with existing Stripe Connect payouts.
- Idempotency key (D-07): `(affiliate_id, subscription_id, billing_period_yyyymm)`.
- 7-day review SLA (D-09) for anomaly queue (operationalized via admin email when items age past 5 days).
- Reversible-grant window (D-14): 7 days OR first recurring payout, whichever first.
- Gold landing template (D-12): single shared "premium" theme; per-partner branding deferred.
- Lifetime tier never auto-downgrades (D-03); only fraud-freeze can interrupt (D-04).

</specifics>

<deferred>
## Deferred Ideas

- **Lifetime revocation (not just freeze)** — D-04 explicitly chose freeze-only; revisit if confirmed Lifetime-partner fraud event occurs.
- **Auto-suspend on 5 consecutive flagged conversions** — D-04 explicit reject (false-positive lockout risk); revisit if manual review backlog grows.
- **Tunable threshold N per cohort (admin_settings)** — D-02 explicit reject; revisit if first deal demands cohort-specific pricing.
- **Pay-on-LeanShot-usage (instead of Stripe-active)** — D-05 explicit reject; revisit only if business model shifts to usage-based.
- **30-day pause grace for Lifetime recurring** — D-05 chose strict Stripe-active gate; revisit if subscriber pauses generate partner support tickets.
- **Per-partner Gold branding (logo + accent color)** — D-12 explicit defer to Lifetime tier or v1.5.
- **Lifetime full white-label landing** — D-12 explicit defer to v1.5.
- **Two-superadmin approval for Lifetime grant** — D-14 explicit defer until staff > 5.
- **MLM / multi-level affiliate** — anti-feature per research SUMMARY; never.
- **Bandit auto-shifting tier thresholds** — anti-feature per research SUMMARY; never.
- **Recurring commission on yearly subscribers' renewal day vs amortized monthly** — picked amortized monthly per D-06; revisit if accounting prefers quarterly batching.

### Reviewed Todos (not folded)
None — STATE.md "Pending Todos" section shows none for Phase 26.

</deferred>

---

*Phase: 26 — Multi-Tier Affiliate (Standard / Gold / Lifetime)*
*Context gathered: 2026-05-17*
