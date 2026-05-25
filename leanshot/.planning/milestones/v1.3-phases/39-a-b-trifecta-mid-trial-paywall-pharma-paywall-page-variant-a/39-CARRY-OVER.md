---
phase: 39-a-b-trifecta-mid-trial-paywall-pharma-paywall-page-variant-a
type: carry-over
created: 2026-05-24
deferred_to: v1.3-milestone-close
status: shipped (automated-verify-only); operator HUMAN-UAT + live infra deferred
---

# Phase 39 — Carry-Over

Phase 39 shipped 9/10 plans (39-01..39-09) + 39-10 partial close-out.

## Migration push verification matrix

20 migrations at 20270714000001..000020. All filenames valid 14-digit regex. **Pending push.**

## Edge Fn deploy status

| Fn | Status | Notes |
|----|--------|-------|
| variant-resolver | **pending deploy** | NEW. User-invoked. Deploy BEFORE 3 cron migrations. |
| slack-alert-experiments | **pending deploy** | NEW. Cron-invoked. Needs SLACK_WEBHOOK_EXPERIMENTS_URL. |

**Critical ordering** (per memory `feedback_fn_deploy_before_cron_db_push`): deploy both Edge Fns FIRST. Migrations 20270714000010 (42day archive cron) + 000011 (refund-rate kill cron) + 000012 (pharma NPS kill cron) all target these Fns.

Operator commands:
```bash
cd /Users/karstenhaldan/minisite/supabase

# Set 1 NEW Function Secret + vault service_role_key check
supabase secrets set --project-ref ytnsipxxmzgaebkqmokp \
  SLACK_WEBHOOK_EXPERIMENTS_URL="<from Slack app config>"
# Verify: SELECT name FROM vault.decrypted_secrets WHERE name='service_role_key'; — must return sb_secret_*

# Deploy Fns FIRST
supabase functions deploy variant-resolver
supabase functions deploy slack-alert-experiments

# THEN push 20 migrations
supabase db push --linked
```

## Vendor secret pre-flight status

| Secret | Status | Action |
|--------|--------|--------|
| SLACK_WEBHOOK_EXPERIMENTS_URL | **NOT SET** | NEW for Phase 39. Required for kill-switch alerts. |
| POSTHOG_HOST | present | Inherited. |
| POSTHOG_PROJECT_KEY | present | Inherited. |
| SUPABASE_SERVICE_ROLE_KEY | present (sb_secret_*) | Inherited. |

## HUMAN-UAT signal status — ALL DEFERRED to v1.3 milestone UAT

| Signal | REQ-IDs | Status | Defer reason |
|--------|---------|--------|--------------|
| 1: Activation event → paywall variant assigned via variant-resolver | PAYWALL-01/02 | **deferred** | Needs Fn deploy + db push + activation-event-triggered live user |
| 2: Pharma surface F renders correct tier; safety-info NEVER paywalled | PHARMA-01/02 | **deferred** | Needs db push + live Pro/free user + pharma_content with safety_category |
| 3: WA/CT region detect disables pharma paywall | PHARMA-06 | **deferred** | Needs WA/CT-located test user + Edge Runtime CF-IPCountry header |
| 4: Page variant Vary cookie + canonical link + 42-day auto-archive | PAGEAB-01/02/03 | **deferred** | Needs Fn deploy + page_variants admin RLS RPCs (deferred from 39-09) + ≥42d wall-clock |
| 5: Ship-Winner flow + Bayesian posterior badge + admin_audit_log | PAGEAB-05/07 | **deferred** | Needs db push + admin_audit_log table verified live |
| 6: Refund-rate kill-switch fires Slack alert | PAYWALL-04 | **deferred** | Needs SLACK secret + cron live + refund-rate > 2× baseline |
| 7: Pharma 1-star NPS kill-branch (gated on review_submissions table) | PHARMA-03/04 | **deferred** | review_submissions deferred to future phase; branch silently inactive |
| 8: Admin Pharma sub-tab — disable variant flow | PHARMA-08 | **deferred** | Needs Fn deploy + db push + live admin |

## Pre-flight verification PASS

| Check | Result |
|-------|--------|
| Deno sweep (variant-resolver + slack-alert-experiments) | **18/18 pass** |
| tsc clean | **exit 0** |
| 20 migrations valid 14-digit regex | **PASS** |

## Known residuals / accepted

- **page_variants admin INSERT/UPDATE RLS gap** (deferred from 39-09): SECDEF create_page_variant + update_page_variant_blocks RPCs needed. Until shipped, admin Publish variant click fails gracefully with UI error.
- **Dispatcher (page-render index.ts) variant-resolver wiring** (~65 lines, deferred from 39-09): wire Vary header attach + canonical_page_id query + per-block resolver callback. All helpers shipped in 39-09 render.ts.
- **public.review_submissions** NOT shipped (deferred to future review-system phase). p39_pharma_nps_kill_scan() has `to_regclass()` pre-check; activates automatically when table lands.
- **public.admin_audit_log** auto-added inline by 39-07 (T-39-07-01 repudiation mitigation per `feedback_executor_auto_adds_missing_migration`).
- **Vitest config drift** — `leanshot/vitest.config.ts` `projects:[]` supersedes `test.include`; multiple executors used adjacent-config workaround.

## Re-attempt close-out (operator)

When ready:
1. Set SLACK_WEBHOOK_EXPERIMENTS_URL.
2. Deploy 2 Fns (variant-resolver + slack-alert-experiments) BEFORE db push.
3. `supabase db push --linked` (20 migrations).
4. Ship page_variants admin RLS RPCs + dispatcher wiring (39-09 deferred items).
5. Walk 8 HUMAN-UAT signals.
