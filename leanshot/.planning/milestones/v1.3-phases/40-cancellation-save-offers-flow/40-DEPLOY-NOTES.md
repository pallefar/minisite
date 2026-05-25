# Phase 40 Deploy Notes (operator runbook)

> Generated: 2026-05-21 by Plan 40-06 Task 3
> Pattern: mirrors Phase 35 (35-DEPLOY-NOTES.md)

---

## 1. Schema Verification (already applied — Plan 40-05 + 40-06 db push)

All 8 Phase 40 migrations are applied to the linked project (ytnsipxxmzgaebkqmokp):

| Migration | Description | Status |
|-----------|-------------|--------|
| 20270709000001 | cancellation_offers_log table + RLS | APPLIED |
| 20270709000002 | save_offer_rules table + RLS | APPLIED |
| 20270709000003 | Stripe coupon seed migration | APPLIED |
| 20270709000004 | subscriptions pause_collection columns | APPLIED |
| 20270709000005 | pg_cron pause-reminder-fire job | APPLIED |
| 20270709000006 | pg_cron autoresume-reconcile job | APPLIED |
| 20270709000007 | SECDEF RPCs for save_offer_rules CRUD | APPLIED |
| 20270709000008 | v_cancellation_offers_roi VIEW | APPLIED |

Verify with:
```bash
npx supabase migration list --linked | tail -10
```

Expected: all 8 migrations have timestamps in BOTH local and remote columns (no empty remote).

---

## 2. Edge Functions Deployed (Plan 40-06 Task 3c)

All 6 Phase 40 Edge Functions were deployed on 2026-05-21:

```bash
# Deployed:
npx supabase functions deploy cancellation-seed-coupons --import-map supabase/functions/import_map.json
npx supabase functions deploy pause-reminder-fire --import-map supabase/functions/import_map.json
npx supabase functions deploy cancellation-decide-offer --import-map supabase/functions/import_map.json
npx supabase functions deploy cancellation-accept-offer --import-map supabase/functions/import_map.json
npx supabase functions deploy cancellation-feedback-to-ticket --import-map supabase/functions/import_map.json
npx supabase functions deploy download-cancellation-roi-csv --import-map supabase/functions/import_map.json

# Also redeployed (extended for Phase 40 pause-collection webhook mirror):
npx supabase functions deploy stripe-webhook --import-map supabase/functions/import_map.json
```

Note: `--import-map` flag is deprecated in CLI v2.100.0+ but still honored per
`reference_supabase_functions_deploy_import_map_flag`. Omit `--linked` per
`reference_supabase_functions_deploy_no_linked_flag`.

---

## 3. Stripe Coupon Seed (HUMAN gate — Signal A)

**Must be run ONCE** to create the 6 save-offer coupon catalog in Stripe.

```bash
# Requires SUPABASE_SERVICE_ROLE_KEY environment variable.
# Get the service-role key from Supabase Dashboard → Settings → API → Service role secret.
curl -X POST \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  "https://ytnsipxxmzgaebkqmokp.supabase.co/functions/v1/cancellation-seed-coupons"
```

**Expected first-run response:**
```json
{ "ok": true, "created": 6, "skipped": 0, "created_ids": ["SAVE-20-2MO", "SAVE-20-3MO", "SAVE-25-2MO", "SAVE-25-3MO", "SAVE-30-2MO", "SAVE-30-3MO"], "skipped_ids": [] }
```

**Expected idempotent re-run:**
```json
{ "ok": true, "created": 0, "skipped": 6, "created_ids": [], "skipped_ids": ["SAVE-20-2MO", "SAVE-20-3MO", "SAVE-25-2MO", "SAVE-25-3MO", "SAVE-30-2MO", "SAVE-30-3MO"] }
```

**Verify via Stripe CLI:**
```bash
curl -H "Authorization: Bearer $STRIPE_SECRET_KEY" \
  "https://api.stripe.com/v1/coupons?limit=10" | \
  jq -r '.data[] | select(.id | startswith("SAVE-")) | .id'
```

Expected output (6 lines):
```
SAVE-20-2MO
SAVE-20-3MO
SAVE-25-2MO
SAVE-25-3MO
SAVE-30-2MO
SAVE-30-3MO
```

**DO NOT invoke autonomously** — operator approval required for Stripe write operations
(per Phase 40-06 plan scope).

Resume signal: `coupons-ok` (Stripe API confirms 6 SAVE-* coupons) or
`coupons-defer-to-prod` (defer verification to production environment).

---

## 4. Cron Job Verification (auto-verified in Plan 40-06 Task 3b)

| Job | Schedule | Active | Status |
|-----|----------|--------|--------|
| p40-pause-t7-reminder | `0 * * * *` | true | VERIFIED 2026-05-21 |
| p40-pause-autoresume-reconcile | `15 */4 * * *` | true | VERIFIED 2026-05-21 |

Re-verify with:
```bash
npx supabase db query --linked "select jobname, schedule, active from cron.job where jobname like 'p40%';"
```

---

## 5. Admin Save-Offer Rules (HUMAN gate — Signal B)

After deploying and seeding coupons, the admin needs to create at least one save-offer rule
before any users see offers in the cancellation flow.

1. Sign in as admin → visit `/admin/cancellation` → Rules tab.
2. Click "Add rule".
3. Configure:
   - Rule title: e.g. "Global discount — Too expensive"
   - Cohort: "Any" (cohort_id = null = global)
   - Tenure: "30–180 d"
   - Reason triggered when: "Too expensive"
   - Offer type: Discount
   - Coupon: SAVE-25-3MO (25% off for 3 months)
   - Priority: 10
   - Active: ON
4. Click "Save rule".
5. Verify row appears in rule list.

Resume signal: `rule-ok` (first rule created and visible) or `rule-defer` (defer to staging).

---

## 6. End-to-End Cancel Flow Test (HUMAN gate — Signal C)

Requires a test user with an active Stripe subscription.

1. Log in as test user → Settings → Account → "Cancel subscription".
2. Walk Step 1: pick "Too expensive" from reason picklist → Continue.
3. Walk Step 2: verify offer card renders with BadgePercent icon + SAVE-25-3MO details.
4. **Decline path:** click "No thanks, continue cancellation" → Step 3 → "Cancel anyway"
   → wait 6s undo window → verify Stripe Dashboard shows `cancel_at_period_end=true`.
5. **Accept path (separate test user):** accept the discount offer → verify
   Stripe Dashboard shows the coupon applied in `discounts[]`.

Resume signal: `cancel-ok` (both paths verified) or `cancel-defer` (defer to staging).

---

## 7. Notification Copy Review (auto-assessable — Signal D)

Review pause notification templates for ethical-only language (no urgency, no FOMO, no shame).

Templates to review:
- `supabase/functions/_shared/email-templates/pause-reminder-t7.ts` (T-7d reminder)
- `supabase/functions/_shared/email-templates/pause-resumed-t0.ts` (T-0 day-of confirmation)

Check for absence of: "URGENT", "LAST CHANCE", "DON'T LOSE", shame-driven language,
countdown timers, urgency escalation.

Per Phase 35 D-09 ethical-only positioning: informational reminders only.

Resume signal: `copy-ok` (no urgency markers found) or `copy-needs-revision: <concern>`.

---

## 8. Bundle Audit Status (Plan 40-06 Task 3e)

**Build:** `npm run build` — SUCCESS (2026-05-21).

**Bundle budget script status:**

| Chunk | Ceiling (kB gz) | Actual (kB gz) | Status |
|-------|-----------------|----------------|--------|
| admin-shell | 130 | 132.69 | OVER (pre-existing) |
| cancellation | 13 | 0 | MISSING (pre-existing) |
| index | 50 | 24.79 | OK |
| helpdesk-widget | 25 | 3.88 | OK |
| gamification-burst | 8 | 1.76 | OK |
| i18n-runtime | 25 | 7.87 | OK |

**admin-shell:** 132.69 kB gz BEFORE Plan 40-06 changes (verified via git). The 2.69 kB
overage is pre-existing from Phase 40-05 or earlier — NOT caused by 40-06 ROI components.
Documented in deferred-items.md. Owner: Phase 24 admin-shell ceiling-track.

**cancellation:** 0 kB MISSING — pre-existing from Phase 40-04/05 (the three-step modal
lazy chunk is not generating a separate chunk; absorbs into the app bundle or another chunk).
Pre-existing from Phase 40-04 dispatch. Documented in deferred-items.md.

---

## 9. Post-Ship Audit Cadence

- **Weekly (first 4 weeks):** Check `cancellation_offers_log` row counts and acceptance rates
  via the ROI dashboard at `/admin/cancellation/roi`.
- **Monthly:** Check `cron.job_run_details` for `p40-pause-t7-reminder` and
  `p40-pause-autoresume-reconcile` failures.
- **At 30d post-launch:** Run `EXPLAIN ANALYZE SELECT * FROM v_cancellation_offers_roi`
  and check p95 latency. If p95 > 500ms, plan a matview migration per the view COMMENT.
- **At 10,000 cancellation events:** Revisit matview migration threshold (per RESEARCH §ROI).

---

## 10. Rollback Procedure

If a critical bug surfaces post-deploy:

**Schema rollback (NOT recommended — append-only log table):**
- Cancellation offers log rows are immutable; disable triggers to halt new insertions:
  ```sql
  -- Block new offer decisions:
  alter table public.cancellation_offers_log disable trigger all;
  ```

**Edge Function rollback:**
- Redeploy previous version from git history:
  ```bash
  git checkout <previous-commit> -- supabase/functions/cancellation-decide-offer/
  npx supabase functions deploy cancellation-decide-offer --import-map supabase/functions/import_map.json
  ```

**Cron job disable (emergency):**
  ```sql
  select cron.unschedule('p40-pause-t7-reminder');
  select cron.unschedule('p40-pause-autoresume-reconcile');
  ```

**Frontend rollback:**
- The CancellationModal is lazy-loaded; if it crashes, the Settings page remains accessible.
- Emergency: Remove the "Cancel subscription" button from SettingsPage until fix ships.

---

## 11. Phase 40 Verification Summary (Task 3 results — 2026-05-21)

| Check | Expected | Actual | Status |
|-------|----------|--------|--------|
| Migration 20270709000001..7 | Applied | Applied | PASS (pre-40-06) |
| Migration 20270709000008 | Applied | Applied | PASS |
| supabase db push (after 000008) | No-op | "Remote database is up to date" | PASS |
| cancellation_offers_log count | 0 (fresh) | 0 | PASS |
| save_offer_rules count | 0 (fresh) | 0 | PASS |
| status CHECK constraint | 6 values | 6 values | PASS |
| p40-pause-t7-reminder cron | active | active | PASS |
| p40-pause-autoresume-reconcile cron | active | active | PASS |
| cancellation-seed-coupons deploy | deployed | deployed | PASS |
| pause-reminder-fire deploy | deployed | deployed | PASS |
| cancellation-decide-offer deploy | deployed | deployed | PASS |
| cancellation-accept-offer deploy | deployed | deployed | PASS |
| cancellation-feedback-to-ticket deploy | deployed | deployed | PASS |
| download-cancellation-roi-csv deploy | deployed | deployed | PASS |
| stripe-webhook deploy (extended) | deployed | deployed | PASS |
| npm run build | SUCCESS | SUCCESS | PASS |
| Stripe coupon seed | operator action | PENDING | Signal A |
| First save-offer rule created | operator action | PENDING | Signal B |
| Cancel flow end-to-end | browser test | PENDING | Signal C |
| Notification copy review | operator review | PENDING | Signal D |
