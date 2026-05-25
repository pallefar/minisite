# Phase 52: Vendor Setup Foundation — Validation

**Generated:** 2026-05-25 (inline by autonomous orchestrator from each plan's `<verify><automated>` blocks)
**Scope:** All checks are automatable. Vendor account-creation / secret-value-setting / approvals are NOT validated here — they defer to the Phase 70 HUMAN-UAT gate per milestone contract D-08.

All commands run from git root `/Users/karstenhaldan/minisite` unless noted. `deno` = `$HOME/.deno/bin/deno`.

## 52-01 — vendor-smoke Edge Fn (VENDOR-01..09, 11)

| Truth | Automated check | Pass signal |
|-------|-----------------|-------------|
| Fn type-checks; reuses shared utils; upserts on vendor_name; deno.json file-targeted test | `deno check supabase/functions/vendor-smoke/index.ts` + grep gates | `GATES_OK` |
| Registry covers all vendors; canonical clinical key; no `e.message` leak | node registry assertion over `index.ts` | `REGISTRY_OK` |
| Unit tests pass without launching an HTTP server | `deno test --no-check supabase/functions/vendor-smoke/index.test.ts` | tests pass, no hang |

## 52-02 — vendor_smoke_log table + cron (VENDOR-11)

| Truth | Automated check | Pass signal |
|-------|-----------------|-------------|
| Table + status enum + is_staff RLS + PK present | grep gate on `20280101000001_vendor_smoke_log.sql` | `TABLE_OK` |
| Daily 08:00 cron, named dollar-tag, vault service-role bearer, hardcoded Fn URL, no GUC | grep gate on same migration | `CRON_OK` |

## 52-03 — Admin vendor-smoke dashboard (VENDOR-11)

| Truth | Automated check | Pass signal |
|-------|-----------------|-------------|
| Component compiles; reads vendor_smoke_log; run-now invokes Fn; Badge tones; NO ClinicianMfaGuard; no hex | `tsc -p tsconfig.app.json --noEmit` + grep gate | `DASH_OK` |
| Module registered (route, minRole superadmin, lazy); no duplicate import; no router edits | full-app `tsc` + node manifest assertion | `MANIFEST_OK` |

## 52-04 — BAA seed + secrets runbook + CI drift guard (VENDOR-01,02,04,05,06,07,09,10,12)

| Truth | Automated check | Pass signal |
|-------|-----------------|-------------|
| BAA seed inserts 8 vendor rows, ON CONFLICT DO NOTHING, no illegal UPDATE | grep + node assertion on `20280101000002_vendor_baa_chain_p52_seed.sql` | `BAA_SEED_OK` |
| Runbook lists all secrets with canonical names + set-commands + deferred allowlist | node token assertion on `runbooks/vendor-secrets.md` | `RUNBOOK_OK` |
| CI guard executable, watches SENTRY_DSN, deferred-allowlist WARNs, hard-fails only on missing non-deferred, green without Supabase access; workflow invokes it | `bash -n` + grep + run `scripts/check-required-secrets.sh` | `CI_GUARD_OK` |

## Requirement coverage

VENDOR-01..12 all mapped (01–06 vendor onboarding scaffolds, 07 CI drift guard, 08 canonical Anthropic key, 09 Calendly, 10 secrets storage split, 11 smoke Fn+dashboard+cron, 12 BAA rows). HealthKit/AdMob/APNs handlers record `not_configured` by design (no server smoke) — expected, not a gap.

## Deferred to Phase 70 (NOT validated here)
Real vendor account creation + payment + identity verification + approvals (Apple Dev, Google Play, HealthKit entitlement, AdMob publisher); live secret-value setting; per-vendor deep integration verification.
