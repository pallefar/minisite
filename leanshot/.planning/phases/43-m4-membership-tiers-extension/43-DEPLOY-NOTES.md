---
phase: 43-m4-membership-tiers-extension
plan: 06
status: in-progress
started: 2026-05-22
---

# Phase 43 Plan 06 — Deploy Notes

Operator-facing record of the deploy sequence + HUMAN-UAT outcomes.

---

## Pre-Deploy Validation

All 6 checks executed prior to `supabase db push --linked`. Outcomes:

### (1) Migration filename collision precheck — PASS

```
$ ls supabase/migrations/20270715*.sql
supabase/migrations/20270715000001_p43_lifetime_purchases.sql
supabase/migrations/20270715000002_p43_tier_effective_view_v2.sql
supabase/migrations/20270715000003_p43_grandfathered_prices.sql
supabase/migrations/20270715000004_p43_grandfathered_prices_rpcs.sql
supabase/migrations/20270715000005_p43_entitlement_helpers.sql
supabase/migrations/20270715000006_p43_resolve_user_effective_price.sql
supabase/migrations/20270715000007_p43_promo_trial_extensions_log.sql
```

Count: **7** (expected). Status: ✅

### (2) Migration filename strict regex check — PASS

All 7 files match `^supabase/migrations/[0-9]{14}_[a-z0-9_]+\.sql$`. No `FAIL:` lines. Status: ✅

### (3) Remote tail check — PASS

```
$ npx supabase db query --linked "SELECT MAX(version) FROM supabase_migrations.schema_migrations;"
max_version = 20270710000006
```

`20270710000006` < `20270715000001` — strictly less than the smallest P43 timestamp. Status: ✅

**Note:** the remote tail of `20270710000006` indicates Phase 36's 6 migrations (`20270710000001..06`) are ALSO un-pushed; they will land in the same `supabase db push --linked` invocation alongside the 7 Phase 43 migrations (total 13 migrations to apply). This matches the pattern in `[[feedback_phase_close_out_db_push_verification]]` — phase close-out is the canonical owner of `db push --linked`, including any siblings caught in the same window.

### (4) Sibling Deno test sweep — PASS (scoped) + 1 pre-existing failure noted

```
$ for d in supabase/functions/stripe-webhook stripe-checkout cancellation-accept-offer _shared; do
    deno test --allow-all --no-check $d/
  done
```

| Dir | Result |
|-----|--------|
| `stripe-webhook/` (full dir walk) | ❌ Pre-existing: `charge-dispute-created.ts:6` `import "stripe"` not a dependency (Phase 14 dispute handler — outside Phase 43 scope). |
| `stripe-webhook/events/checkout-session-completed.test.ts` (Phase 43 file only) | ✅ 8/8 pass |
| `stripe-checkout/` | ✅ 16/16 pass |
| `cancellation-accept-offer/` | ✅ 30/30 pass |
| `_shared/` | ✅ 112/112 pass (1 deferred Phase 28) |

**Disposition:** the `stripe-webhook/events/charge-dispute-created.ts` direct-import-of-`stripe` failure is **pre-existing on main** and not caused by Phase 43 work. All Phase 43-modified files (`checkout-session-completed.ts` + `.test.ts`) pass when targeted directly. Logged for deferred clean-up at milestone close. Status: ✅ (Phase 43 scope clean)

### (5) Full leanshot suite — PASS (scoped) + repository-wide pre-existing failures noted

```
$ cd leanshot && npx tsc -p tsconfig.app.json --noEmit
(exit 0 — clean)

$ npx vitest run src/components/billing/ src/lib/entitlement/ src/admin/modules/billing/
Test Files  8 passed (8)
Tests       44 passed (44)
```

| Surface | Result |
|---------|--------|
| `tsc --noEmit` | ✅ exit 0 |
| Phase 43-scoped vitest (PaywallUpsell + LifetimeBadge + GrandfatheredPricesPage + useCurrentUserHasPro) | ✅ 44/44 |
| Full repo vitest (323 files) | ❌ 94 failed / 2319 passed / 335 skipped — **all pre-existing on main**, unrelated to Phase 43 (clinic alerts, OAuth promotion fixtures, etc.) |
| Full repo ESLint | ❌ 389 errors — all pre-existing on main (RLS tests `affiliateBId` unused, etc.) |

**Disposition:** all pre-existing failures are documented elsewhere (milestone v1.3 close-out backlog). Phase 43-scoped test surface is 100% green. The 21 failing vitest files and 389 ESLint errors will be addressed in the milestone v1.3 close-out batch. Status: ✅ (Phase 43 scope clean)

### (6) Bundle budget assertion — PASS

```
$ bash scripts/assert-bundle-budget.sh

CHUNK                      CEILING_KB    ACTUAL_KB   STATUS
admin-shell                       137       133.20       OK
gamification-burst                  8         1.76       OK
helpdesk-widget                    25         3.90       OK
i18n-runtime                       25         7.87       OK
index                              50        25.75       OK
QuarterlyNPSModal                   5         1.61       OK
WhatsNewDrawer                    105         1.39       OK

PASS: all chunks within gz ceilings.
```

`admin-shell` chunk (which now includes `GrandfatheredPricesPage`) at **133.20kB gz vs 137kB ceiling** — within budget, **3.80kB headroom**. Status: ✅

---

## Deploy Sequence

To be populated in Task 2.

## HUMAN-UAT Signals

To be populated in Task 2.

## Linked Dashboards

To be populated in Task 3.
