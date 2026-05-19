# Phase 40 — Discussion Log

**Date:** 2026-05-19
**Phase:** 40 — Cancellation Save-Offers Flow
**Mode:** discuss (default; batched)

---

## Gray-area selection

ALL 4 — eligibility rules + tenure thresholds · pause mechanics · discount orchestration + stacking · cancellation modal UX

---

## Area 1: Eligibility rules + cohort/tenure thresholds

- Tenure rules → **<30d: pause+discount; 30-180d: all 4; >180d: no extended-trial** → D-01
- Anti-gaming → **2 lifetime takes (excluding pause); 12mo cooldown** → D-02 + D-03
- Clinic vs consumer → **Clinics see DIFFERENT offer set (CSM contact + discount only)** → D-04

D-05: admin rule-builder via save_offer_rules table + cohort_definitions binding.

---

## Area 2: Pause mechanics

- Duration → **1/2/3 month preset only (ROADMAP literal)** → D-06
- Access during pause → **Full read-only (view existing data, no new logs)** → D-07
- Resume notifications → **7d-ahead + day-of confirmation + auto-resume** → D-08 + D-09

D-10: pause-while-paused allowed via extension (subject to anti-gaming cap).
D-11: stripe-webhook dispatcher extended with customer.subscription.paused/resumed case arms.

---

## Area 3: Discount orchestration + Stripe Coupon stacking

- Coupon creation → **Pre-created pool (admin creates N coupons; flow picks)** → D-12
- Discount range → **20/25/30% × 2/3mo = 6 fixed combinations** → D-13
- Stacking → **Allow stacking (save-offer + affiliate both apply)** → D-14

D-15: stacking abuse vector flagged for Plan-time mitigation (recommended: cap combined discount at 35% effective).
D-16: discount applies to NEXT invoice (Stripe coupon duration='repeating').

---

## Area 4: Cancellation modal UX

- Offer presentation → **Server-picks ONE recommended offer** → D-19
- Reason capture → **Picklist BEFORE offers shown (6 reasons + Other)** → D-18
- Final confirmation → **Loss-summary screen (streak/curve/AI coach/data export)** → D-20

D-21: service-quality-issue reason auto-creates P37 ticket AFTER cancellation completes.
D-22: A/B variants on offer copy + recommendation algorithm via PostHog Experiments.

---

## Out-of-scope items raised

- Custom-date pause picker (v1.4+)
- Per-cohort save-offer ML (v1.4+ once log accumulates)
- Reactivation flow polish (v1.4+)
- Stacking abuse fraud detection (v1.4+)
- Auto-discount on dunning (related but distinct; v1.4+)
- Downgrade for clinics (revisit if clinic tier shape gains downgrade target)
