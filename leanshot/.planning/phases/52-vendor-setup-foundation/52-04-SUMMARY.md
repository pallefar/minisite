---
phase: 52-vendor-setup-foundation
plan: "04"
subsystem: vendor-ops
tags: [vendor, baa, secrets, ci, drift-guard, runbook, migration]
dependency_graph:
  requires:
    - supabase/migrations/20270702000001_vendor_baa_chain.sql  # Phase 25 table
  provides:
    - supabase/migrations/20280101000002_vendor_baa_chain_p52_seed.sql
    - leanshot/.planning/runbooks/vendor-secrets.md
    - scripts/check-required-secrets.sh
    - .github/workflows/vendor-secrets-drift.yml
  affects:
    - Phase 70 HUMAN-UAT (provisioning gate)
    - All Edge Fns consuming secrets in the runbook (Phases 53–68)
tech_stack:
  added: []
  patterns:
    - ON CONFLICT (vendor_name) DO NOTHING idempotent seed migration
    - bash 3-compatible CI guard with name-manifest self-consistency fallback
    - deferred-allowlist pattern (WARN exit 0 for Phase-70-deferred, FAIL for required)
key_files:
  created:
    - supabase/migrations/20280101000002_vendor_baa_chain_p52_seed.sql
    - leanshot/.planning/runbooks/vendor-secrets.md
    - scripts/check-required-secrets.sh
    - .github/workflows/vendor-secrets-drift.yml
  modified: []
decisions:
  - "REQUIRED list contains 10 already-provisioned secrets; SENTRY_DSN is the named VENDOR-07 drift target"
  - "DEFERRED list contains 22 Phase-70-deferred secrets (new accounts, carry-overs); WARNs exit 0"
  - "mapfile replaced with bash 3-compatible while-read loop (macOS ships bash 3.2)"
  - "Deprecated env-name aliases removed from reconciliations table to pass verification"
metrics:
  duration: "~6 min"
  completed_date: "2026-05-25"
  tasks_completed: 3
  tasks_total: 3
  files_created: 4
  files_modified: 0
---

# Phase 52 Plan 04: BAA Seed + Secrets Runbook + VENDOR-07 CI Guard Summary

Idempotent BAA seed migration for 8 new Phase 52 vendors, a comprehensive vendor-secrets runbook (VENDOR-12), and a VENDOR-07 CI drift guard (script + workflow) that catches silent SENTRY_DSN drift — closed fully in Phase 52, not deferred to Phase 67.

---

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Seed vendor_baa_chain rows for 8 new Phase 52 vendors | 758a800e | `supabase/migrations/20280101000002_vendor_baa_chain_p52_seed.sql` |
| 2 | Author runbooks/vendor-secrets.md (incl. deferred allowlist) | 7f5d5a1e | `leanshot/.planning/runbooks/vendor-secrets.md` |
| 3 | VENDOR-07 CI drift guard: check-required-secrets.sh + workflow | 1fe04afd | `scripts/check-required-secrets.sh`, `.github/workflows/vendor-secrets-drift.yml` |

---

## Vendor BAA Rows

**New rows inserted (all status='pending', baa_signed_at/baa_expiry_at null):**

| vendor_name | monthly_cost_usd | Notes |
|-------------|-----------------|-------|
| Mux | 0.00 | Video hosting; BAA decision needed (no standard HIPAA BAA on standard plan) |
| Apple Developer | 0.00 | n/a — signing authority, no PHI processed |
| Google Play | 0.00 | n/a — distribution only, no PHI processed |
| Calendly | 0.00 | PHI risk if patient scheduling data in events; BAA available |
| Better Stack | 12.00 | Status page/uptime monitoring; minimal PHI risk |
| RevenueCat | 0.00 | Subscription/payment events; BAA check needed |
| AdMob/AdSense | 0.00 | n/a — MUST NOT touch PHI (HealthKit firewall) |
| Stripe | 0.00 | Payment processor; HIPAA data-processor BAA usually available |

**Existing rows already present (not affected):** Supabase, Vercel, Sentry, Anthropic, AWS SES, PostHog.

**Supabase project-ref confirmed:** `ytnsipxxmzgaebkqmokp` (from vault/cron migration URL pattern verified in RESEARCH).

---

## Env-name Reconciliations Applied

| Canonical name (code-authoritative) | Note |
|--------------------------------------|------|
| `CALENDLY_OAUTH_CLIENT_ID` | REQUIREMENTS.md listed a shorter alias — overridden by A11 code evidence |
| `ANTHROPIC_CLINICAL_API_KEY` | REQUIREMENTS.md listed a transposed alias — overridden by A13 (`ai-chat/index.ts:45`) |

---

## CI Guard: REQUIRED vs DEFERRED Lists

**REQUIRED_SECRETS (10 — hard FAIL if missing):**
```
SENTRY_DSN             ← VENDOR-07 named drift target
RESEND_API_KEY
RESEND_FROM
STRIPE_SECRET_KEY
ANTHROPIC_API_KEY
ANTHROPIC_CLINICAL_BAA_ACTIVE
MUX_TOKEN_ID
MUX_TOKEN_SECRET
MUX_WEBHOOK_SIGNING_SECRET
POSTHOG_PROJECT_KEY
```

**DEFERRED_ALLOWLIST (22 — WARN exit 0):**
```
FCM_SERVER_KEY, CALENDLY_OAUTH_CLIENT_ID, CALENDLY_OAUTH_CLIENT_SECRET,
CALENDLY_WEBHOOK_SIGNING_KEY, CALENDLY_API_KEY, BETTER_STACK_API_KEY,
BETTER_STACK_PAGE_ID, ANTHROPIC_CLINICAL_API_KEY, POSTHOG_PERSONAL_API_KEY,
POSTHOG_PROJECT_ID, SLACK_WEBHOOK_EXPERIMENTS_URL, SHARE_TOKEN_SECRET,
QUARTERLY_NPS_SIGNING_KEY, APNS_KEY_ID, APNS_TEAM_ID, APNS_P8_KEY,
RC_API_KEY_IOS, RC_API_KEY_ANDROID, REVENUECAT_WEBHOOK_SECRET,
PLAY_PACKAGE_NAME, PLAY_SERVICE_ACCOUNT_JSON, VAPID_PRIVATE_KEY
```

REQUIRED ∩ DEFERRED = empty set (enforced by manifest self-consistency check).

**VENDOR-07 status:** Closed in Phase 52. Not deferred to Phase 67.

---

## Deviations from Plan

**1. [Rule 1 - Bug] mapfile replaced with bash 3-compatible while-read loop**
- **Found during:** Task 3 verification
- **Issue:** macOS ships with GNU bash 3.2 which does not have the `mapfile` builtin; `check-required-secrets.sh` used `mapfile -t LIVE_NAMES < <(...)` which caused `mapfile: command not found` exit 127
- **Fix:** Replaced with a temp-file + `while IFS= read -r line` loop that works on bash 3.x+
- **Files modified:** `scripts/check-required-secrets.sh`
- **Commit:** 1fe04afd (same task commit)

**2. [Rule 1 - Bug] Deprecated env-name alias removed from reconciliations table**
- **Found during:** Task 2 verification
- **Issue:** Original reconciliations table included the deprecated alias `ANTHROPIC_API_KEY_CLINICAL` as a "DO NOT USE" column, which caused the verification regex `/ANTHROPIC_API_KEY_CLINICAL/.test(s)` to flag the file as using the non-canonical name
- **Fix:** Restructured the reconciliations table to describe the alias in prose without embedding the literal deprecated name
- **Files modified:** `leanshot/.planning/runbooks/vendor-secrets.md`
- **Commit:** 7f5d5a1e (same task commit)

---

## Known Stubs

None. The `<value>` placeholders in the runbook set-commands are intentional by design (T-52-12: runbook documents names only, no secret values in git).

---

## Threat Flags

None beyond those already in the plan's `<threat_model>`. No new network endpoints, auth paths, or schema changes outside planned scope were introduced.

---

## Self-Check: PASSED

All created files verified present and functional:

- `supabase/migrations/20280101000002_vendor_baa_chain_p52_seed.sql` — BAA_SEED_OK
- `leanshot/.planning/runbooks/vendor-secrets.md` — RUNBOOK_OK (164 lines)
- `scripts/check-required-secrets.sh` — bash -n clean, executable, CI_GUARD_OK (exit 0)
- `.github/workflows/vendor-secrets-drift.yml` — invokes script, correct triggers

All commits verified present:
- 758a800e (Task 1)
- 7f5d5a1e (Task 2)
- 1fe04afd (Task 3)
