# Phase 25: HIPAA Audit Hardening + Vendor BAA Chain - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-17
**Phase:** 25 — HIPAA Audit Hardening + Vendor BAA Chain
**Areas discussed:** PostHog HIPAA tier + SOC 2 tooling, phi_access_log write semantics + perf, MFA cutover for clinicians + patients, Wave-0 vendor calls + BAA expiry + Stripe PHI lint + policy doc location

---

## PostHog HIPAA Tier + SOC 2 Tooling

### Q1 — PostHog HIPAA tier

| Option | Description | Selected |
|--------|-------------|----------|
| Scrub-only, no Boost add-on | $24K/yr saved; lose clinician-workflow replay debugging. | ✓ |
| Boost add-on now ($2K/mo) | Session-replay-with-BAA on clinic-staff routes; recoverable cost. | |
| Defer to first clinic-deal close | Ship scrub-only; flip switch when first signed BAA contract lands. | |

**User's choice:** Scrub-only, no Boost add-on
**Notes:** Conservative on vendor cost until clinician-debug becomes active blocker.

### Q2 — SOC 2 Type I tooling + scope

| Option | Description | Selected |
|--------|-------------|----------|
| Drata, Type I now, Type II at v1.5 | Single tool also covers training + access reviews. | ✓ |
| Vanta, Type I now, Type II at v1.5 | Bigger brand; slightly higher price. | |
| Secureframe or self-built, Type I deferred | Cheapest tool / hand-rolled; longer founder time. | |
| Skip SOC 2 entirely at v1.3 | BAA-only with 'SOC 2 in progress' messaging. | |

**User's choice:** Drata, Type I now, Type II at v1.5
**Notes:** Aggressive-foundations: pay the $10-15K to ship trust signal alongside BAA.

---

## phi_access_log Write Semantics + Perf

### Q3 — INSERT trigger scope

| Option | Description | Selected |
|--------|-------------|----------|
| Explicit RPC log calls at sensitive UI surfaces only | Per-event RPC; roster paginate = zero rows. HIPAA 'minimum necessary'. | ✓ |
| Per-row triggers on every PHI-table SELECT | Maximum capture; 5–10× clinician dashboard slowdown. | |
| Hybrid: explicit RPC + sampled trigger on anomalous bulk reads | Cheap normal-path; row-by-row log on roster-dump anomaly. | |

**User's choice:** Explicit RPC at sensitive UI surfaces only
**Notes:** Aggregate counts ≠ PHI access. Performance preserved; defensibility maintained.

### Q4 — Retention + viewer surface

| Option | Description | Selected |
|--------|-------------|----------|
| Same retention as audit_logs (90d hot + Parquet cold forever); patient viewer in Settings | Strongest patient-trust signal; satisfies right-of-accounting-of-disclosures. | ✓ |
| Same retention; admin-only viewer | Cheaper UX; patient must email for access. | |
| Hot 365d + 7yr delete; admin + helpdesk request | Single-tier; no Parquet pipeline. | |

**User's choice:** Same retention; patient-side viewer in Settings
**Notes:** Carry forward Phase 24 D-16 retention model; build patient transparency by default.

---

## MFA Cutover for Clinicians + Patients

### Q5 — Clinician MFA cutover

| Option | Description | Selected |
|--------|-------------|----------|
| Hard-cut at first /clinic/* request post-deploy | Matches Phase 24 D-06 admin posture. | ✓ |
| 30-day soft banner per HIPAA-15 wording | Banner + modal; day 31 hard-block. | |
| Hard-cut + org-admin 7-day extension once per clinician | Default hard-cut + ergonomic safety valve. | |

**User's choice:** Hard-cut at first /clinic/* request post-deploy
**Notes:** Consistent organization-wide MFA policy; communicated via onboarding email 7 days prior.

### Q6 — Patient-side MFA

| Option | Description | Selected |
|--------|-------------|----------|
| Optional, prompted in onboarding + Settings | No enforcement; sensitive actions get email-OTP step-up. | ✓ |
| Mandatory for clinic-org patients, optional for B2C | Two-tier policy by risk. | |
| Mandatory for everyone | Strongest posture; biggest signup-funnel tax. | |
| Optional + email-OTP step-up on sensitive actions | No TOTP; OTP on account-delete, change-org, full-export. | |

**User's choice:** Optional, prompted in onboarding + Settings
**Notes:** B2C consumer-health norm; sensitive-action step-up handled separately.

---

## Wave-0 Vendor Calls + BAA Expiry Alerts + Stripe PHI Lint + Policy Doc Location

### Q7 — Vendor BAA call coordination

| Option | Description | Selected |
|--------|-------------|----------|
| All-at-once parallel, founder owns all 6 | Maximum compression; founder bandwidth bottleneck. | ✓ |
| Sequential by lead time, founder owns | Pipeline by start date; lower mental load; longer wall time. | |
| Parallel, split founder + ops/hired-help | Two-person parallelism. | |

**User's choice:** All-at-once parallel, founder owns all 6
**Notes:** Aligns with v1.3 megamilestone aggressive posture.

### Q8 — BAA expiry + subprocessor-diff alerts

| Option | Description | Selected |
|--------|-------------|----------|
| Admin banner + email-to-founder + audit-log entry | Cron-driven; cheap; visible; no third-party dep. | ✓ |
| PagerDuty + admin banner + email | Treats expiry as on-call incident. Vendor dep + monthly cost. | |
| Calendar invite + email only | No admin banner; trust calendar. | |

**User's choice:** Admin banner + email-to-founder + audit-log entry
**Notes:** Defer PagerDuty until team has on-call rotation.

### Q9 — Stripe PHI keyword lint source

| Option | Description | Selected |
|--------|-------------|----------|
| Static curated list + inline allowlist comments | Hand-maintained JSON; predictable; needs vigilance. | ✓ |
| Dynamic from medications + conditions tables at lint-time | Auto-coverage; CI DB-read risk. | |
| Static list + regex patterns for dose/lab-value detection | Higher precision; more false positives. | |

**User's choice:** Static curated list + inline allowlist comments
**Notes:** Maintainable; new medication added to DB → also add to JSON via same PR.

### Q10 — Written policies (HIPAA-11) location

| Option | Description | Selected |
|--------|-------------|----------|
| /legal/hipaa/ in repo + Notion mirror | Repo as SoT; git diff = policy change history. | ✓ |
| Notion / internal wiki only | Loses git audit trail. | |
| Drata-hosted + read-only mirror in repo | Tight Drata coupling. | |

**User's choice:** /legal/hipaa/ in repo + Notion mirror
**Notes:** Drata policy library can SUPPLEMENT but not replace.

---

## Claude's Discretion

- Exact DDL for `vendor_baa_chain` and `phi_access_log` tables.
- Exact regex / glob shape for the Stripe PHI lint script.
- Drata SDK vs portal-only flow for evidence collection (depends on current Drata capabilities).
- Anthropic dual-credentials storage location (recommend Function secrets).
- Drata vs Vanta migration path if onboarding hits friction before Type I work begins.
- Pre-stubbing `vendor_baa_chain` rows with `status='pending'` during Wave 0.

## Deferred Ideas

- SOC 2 Type II (v1.5).
- PostHog Boost add-on (revisit if replay-debug becomes blocker).
- PagerDuty for BAA expiry (revisit at team>5 + on-call rotation).
- Org-admin per-clinician MFA grace extension (revisit on clinic pushback).
- Patient mandatory MFA (revisit on incident or clinic-deal requirement).
- Drata-hosted policy SoT.
- Dynamic PHI keyword lint from DB.
- Per-row trigger phi_access_log on all PHI tables.
- Per-org BAA scoping (P28/30).
- Anthropic third-credential tier (v1.5).
- In-product BAA viewer for clinics (P30/31).
