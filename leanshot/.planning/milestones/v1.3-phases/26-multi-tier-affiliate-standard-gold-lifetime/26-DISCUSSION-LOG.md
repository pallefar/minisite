# Phase 26: Multi-Tier Affiliate (Standard / Gold / Lifetime) - Discussion Log

> **Audit trail only.** Not consumed by downstream agents — they read CONTEXT.md.

**Date:** 2026-05-17
**Phase:** 26 — Multi-Tier Affiliate (Standard / Gold / Lifetime)
**Areas discussed:** Commission rates + threshold, tier ratchet + removal, lifetime recurring lifecycle, anomaly action + Gold landing, Lifetime admin grant

---

## Commission Rates + Threshold

### Q1 — Commission rates

| Option | Description | Selected |
|--------|-------------|----------|
| Standard 20% / Gold 30% / Lifetime 25% monthly | Industry-typical SaaS band. (Recommended) | ✓ |
| Standard 15% / Gold 25% / Lifetime 20% monthly | Conservative; better unit economics. | |
| Standard 25% / Gold 40% / Lifetime 30% monthly | Aggressive; partner-magnet. | |
| Defer to researcher (model 3 against CAC/LTV) | RESEARCH.md decides. | |

**User's choice:** 20 / 30 / 25%-recurring
**Notes:** Aligns with $12.99 Pro math: $2.60 / $3.90 / $3.25 recurring.

### Q2 — Standard → Gold threshold N

| Option | Description | Selected |
|--------|-------------|----------|
| N = 10 | Real signal; 1–3 month reach. (Recommended) | ✓ |
| N = 25 | Higher bar; filters lucky one-offs. | |
| N = 5 | Low bar; Gold becomes baseline. | |
| Tunable in admin | admin_settings; per-cohort. | |

**User's choice:** N = 10
**Notes:** Static (not tunable) in v1.3.

---

## Tier Ratchet + Removal

### Q3 — Downgrade policy

| Option | Description | Selected |
|--------|-------------|----------|
| Promotion-only ratchet — never downgrade | Locked-once-earned (REQ AFFTIER-01). (Recommended) | ✓ |
| Gold downgrades after 90d zero conversions | Tier hygiene; partner-grumble risk. | |
| Gold downgrades after 6mo; Lifetime never | Hybrid. | |

**User's choice:** Promotion-only ratchet
**Notes:** Removes downgrade-dispute class entirely.

### Q4 — Tier removal triggers (non-volume)

| Option | Description | Selected |
|--------|-------------|----------|
| Fraud-freeze only (superadmin manual) | Reversible; audit-logged. | ✓ |
| Fraud-freeze + Lifetime revocation on policy violation | Stronger deterrent for highest tier. | |
| Auto-suspend on 5 consecutive flags | Fast response; false-positive lockout risk. | |

**User's choice:** Fraud-freeze only
**Notes:** No Lifetime revocation in v1.3.

---

## Lifetime Recurring Cron + Lifecycle

### Q5 — Subscriber lifecycle handling

| Option | Description | Selected |
|--------|-------------|----------|
| Pay-tracks-Stripe-active (skip on pause/past_due/canceled) | Cleanest accounting. | ✓ |
| Pay-tracks-Stripe-active + 30d pause grace | Soften pause impact. | |
| Pay-on-LeanShot-active (independent of Stripe) | Decouples commission from billing. | |

**User's choice:** Pay-tracks-Stripe-active
**Notes:** Resub-after-cancel = NEW conversion; no auto-restore of Lifetime claim.

### Q6 — Plan-change + refund + chargeback semantics

| Option | Description | Selected |
|--------|-------------|----------|
| Commission scales to current $; refunds + chargebacks claw back; chargebacks freeze review | Cleanest unit economics. | ✓ |
| Stamped at conversion; no scaling; chargebacks only claw back | Simpler accounting; weaker fraud deterrence. | |
| Hybrid (initial baseline; scales on change; both claw) | Mid-ground. | |

**User's choice:** Scales to current $; both claw back; chargeback triggers freeze review
**Notes:** Webhook-driven claw back (Stripe events the platform already listens to).

---

## Anomaly Action + Gold Landing

### Q7 — Z-score >3σ action policy

| Option | Description | Selected |
|--------|-------------|----------|
| Pay + flag + admin review (claw back if fraud) | Default-trust; 7d LeanShot exposure. | ✓ |
| Hold payout + flag + admin review | Zero exposure; partner delayed-payout friction. | |
| Auto-block + flag + admin review | Strongest deterrence; biggest partner-trust hit. | |

**User's choice:** Pay + flag + admin review
**Notes:** 7-day SLA; admin email when items age past 5 days.

### Q8 — Gold landing template

| Option | Description | Selected |
|--------|-------------|----------|
| Shared 'premium' theme for all Gold | Cheapest UI work. (Recommended) | ✓ |
| Shared Gold theme + per-partner logo + accent color | Higher partner-affinity; moderate UI work. | |
| Per-tier templates (Lifetime = white-label) | Three-tier visual hierarchy. | |

**User's choice:** Shared premium theme for all Gold
**Notes:** Per-partner branding deferred to Lifetime or v1.5.

---

## Lifetime Admin Grant

### Q9 — Gold → Lifetime grant flow

| Option | Description | Selected |
|--------|-------------|----------|
| Superadmin single-approver; audit-logged; reversible until first recurring payout | Recommended given current 2-staff team. | ✓ |
| Superadmin single-approver; audit-logged; irreversible | Stronger commitment. | |
| Two-superadmin approval required | Defends compromise; impractical at staff=2. | |

**User's choice:** Single-approver; reversible until first recurring payout
**Notes:** Two-superadmin deferred until staff > 5.

---

## Claude's Discretion

- Exact DDL ordering + enum syntax.
- `affiliate_lifetime_recurring_payments` vs extending `affiliate_payouts.recurring_payout_kind`.
- pg_cron schedule (recommend day-1 03:00 UTC).
- Z-score sliding window: matview hourly vs per-query computation.
- UI primitives for tier-progress bar (reuse v1.2 components).
- Webhook vs polling for refund/chargeback claw back (recommend webhook — Stripe events already plumbed).

## Deferred Ideas

- Lifetime revocation (vs freeze), auto-suspend after consecutive flags, tunable N, pay-on-usage, 30d pause grace, per-partner Gold branding, full white-label Lifetime landing, two-superadmin grant, MLM, bandit auto-thresholds, yearly renewal-day commission timing.
