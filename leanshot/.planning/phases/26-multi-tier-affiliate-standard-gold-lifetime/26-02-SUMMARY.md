---
phase: 26-multi-tier-affiliate-standard-gold-lifetime
plan: 02
subsystem: affiliate

tags: [postgres, pg_cron, supabase-edge, deno, materialized-view, z-score, anomaly-detection, resend, vitest]

# Dependency graph
requires:
  - phase: 19-affiliate-program
    provides: "affiliate_clicks + affiliate_impressions + affiliate_conversions tables, affiliate-attribute Edge Fn, stripe-webhook invoice-paid event handler, affiliate_click_baseline (v1.2 AFF-08 raw-count Z-score)"
  - phase: 26-multi-tier-affiliate-standard-gold-lifetime
    provides: "Plan 26-01 ships affiliate_fraud_signals table + affiliate_conversions.anomaly_* columns (parallel wave-1 sibling)"
provides:
  - "affiliate_ratio_baseline matview (7-day click/impression ratio per affiliate, refreshed CONCURRENTLY hourly)"
  - "SECDEF helper compute_affiliate_ratio_z_score(uuid, numeric) → numeric|null"
  - "leanshot/src/lib/affiliate/anomaly-detection.ts pure-fn module (computeZScore + isAnomalyFlagged + ANOMALY_Z_THRESHOLD)"
  - "affiliate-attribute Edge Fn ratio-detector extension (D-10 — extends v1.2 raw-count, both detectors live)"
  - "stripe-webhook invoice-paid anomaly correlation (default-trust per D-09 — metadata-only, never blocks payment)"
  - "affiliate-anomaly-sla-reminder Edge Fn + daily 09:00 UTC cron (7d SLA reminder at 5d)"
affects: [26-04-payouts, 26-05-admin-review-ui, 26-07-chargeback-clawback]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Inline-duplicated threshold seam — Deno Edge runtime cannot import from leanshot bundle tree; ratio threshold constant duplicated in both modules with explicit cross-reference comments"
    - "Default-trust metadata writes — try/catch wraps anomaly correlation; payment recording never throws on detector failure"
    - "Comment-aware grep gate compliance — PHI keyword list moved out of source comments to satisfy `grep -cE 'patient|...'` SC contract (per reference_grep_gate_comment_strip)"

key-files:
  created:
    - "supabase/migrations/20270701000008_affiliate_ratio_baseline_mv.sql"
    - "supabase/migrations/20270701000009_affiliate_anomaly_sla_cron.sql"
    - "supabase/functions/affiliate-anomaly-sla-reminder/index.ts"
    - "supabase/functions/affiliate-anomaly-sla-reminder/index.test.ts"
    - "supabase/functions/affiliate-anomaly-sla-reminder/deno.json"
    - "leanshot/src/lib/affiliate/anomaly-detection.ts"
    - "leanshot/src/lib/affiliate/__tests__/anomaly-detection.test.ts"
  modified:
    - "supabase/functions/affiliate-attribute/index.ts"
    - "supabase/functions/affiliate-attribute/index.test.ts"
    - "supabase/functions/stripe-webhook/events/invoice-paid.ts"
    - "supabase/functions/stripe-webhook/events/invoice-paid.test.ts"

key-decisions:
  - "Inline-duplicated RATIO_ANOMALY_Z_THRESHOLD in the Edge Fn — Deno cannot import from leanshot/src/. Documented duplication seam with comment cross-reference."
  - "Anomaly correlation in invoice-paid wrapped in try/catch — D-09 default-trust means payment recording must NEVER throw on detector failure or missing affiliate_fraud_signals table."
  - "23505 idempotent replay path returns BEFORE anomaly correlation — first writer owns anomaly_flagged on the pre-existing conversion row."
  - "PHI-clean email body: summary lines contain only {affiliate_id, z=N.NN, created_at}; conversion id omitted because it correlates to user via FK chain."
  - "Cron schedule '0 9 * * *' for SLA reminder (clear of 0 0/0 1/5 * /0 3 * * * existing entries)."

patterns-established:
  - "Pattern: Edge-Fn ↔ leanshot bundle duplication — when the same pure-fn predicate must run in Deno and in the browser, inline-duplicate with a 'MUST stay in sync with X' comment in both files."
  - "Pattern: try/catch around metadata-only writes — when a write is decoration on top of a critical operation (payment, attribution), wrap in try/catch so the critical operation never throws on the decoration."
  - "Pattern: grep-gate friendly comments — when SC mandates `grep -cE 'forbidden' returns 0`, never name the forbidden words verbatim in source. Reference the test file instead."

requirements-completed: [AFFTIER-05]

# Metrics
duration: ~20min
completed: 2026-05-18
---

# Phase 26 Plan 02: AFFTIER-05 Ratio Z-Score Anomaly + 7-Day SLA Summary

**Ratio (clicks/impressions) Z-score detector layered on top of v1.2 raw-count detector with default-trust correlation onto conversion rows + daily 09:00 UTC SLA-reminder cron firing at the 5-day mark**

## Performance

- **Duration:** ~20 min
- **Started:** 2026-05-18T15:07:00Z (approximate)
- **Completed:** 2026-05-18T15:12:00Z (approximate)
- **Tasks:** 3
- **Files modified:** 11 (7 created + 4 modified)

## Accomplishments

- **New matview `affiliate_ratio_baseline`** — 7-day rolling click/impression ratio per affiliate, refreshed hourly with `REFRESH MATERIALIZED VIEW CONCURRENTLY` (UNIQUE index `idx_ratio_baseline_affiliate` is the load-bearing line per Pitfall 5). `nullif(impression_count, 0)` is the cold-start divide-by-zero guard (Pitfall 4).
- **SECDEF helper `compute_affiliate_ratio_z_score(uuid, numeric)`** — Returns `null` on cold-start (`days_observed < 7`) or zero-stddev; otherwise returns the z-score. STABLE, `search_path` locked.
- **Pure-fn module `anomaly-detection.ts`** — `computeZScore` + `isAnomalyFlagged` + `ANOMALY_Z_THRESHOLD=3`. Zero-dep, ES2020. Ships into both browser bundle (for Plan 26-05 admin UI) and provides the threshold contract that the Edge Fn inline-duplicates.
- **affiliate-attribute Edge Fn extended** — After click INSERT, computes today's `clicks / max(impressions, 1)` observation, calls the SECDEF RPC, and on `|z|>3` writes one `affiliate_fraud_signals` row with `signal_type='anomaly_z_score'` + PII-safe payload (affiliate_id + z + observation only). D-09 default-trust: detector errors are logged + swallowed, never block attribution. D-10 contract: v1.2 raw-count detector remains live (R4 test asserts grep presence).
- **invoice-paid handler annotates conversions** — INSERT chained with `.select('id').single()` to capture the new conversion id, then SELECTs today's most-recent unreviewed `anomaly_z_score` signal for the affiliate, UPDATEs the new row with `anomaly_flagged=true + anomaly_z_score=<payload.z_score>`. Whole block try/catch'd — D-09 default-trust. 23505 idempotent replay returns BEFORE correlation.
- **New `affiliate-anomaly-sla-reminder` Edge Fn** — Constant-time bearer compare against vault `service_role_key` (T-26-10 mitigation). Query: `anomaly_flagged=true AND anomaly_review_decision IS NULL AND created_at < now() - 5d`, ASC, limit 200. PHI-safe batched Resend email to `ADMIN_REVIEW_EMAIL_TO`. Cron `0 9 * * *` UTC (clear of all existing schedules).

## Task Commits

Each task was committed atomically (RED→GREEN cadence per `tdd="true"`):

1. **Task 1: Ratio matview + hourly refresh cron** — `80c67b3` (feat — grep-only verification, no separate RED)
2. **Task 2a: Pure-fn anomaly-detection.ts**
   - `64f91fd` (test — RED, missing import)
   - `09a3ac3` (feat — GREEN, 9/9 vitest pass)
3. **Task 2b: affiliate-attribute ratio detector extension**
   - `6057316` (test — RED, 2 new failures: R2, R4)
   - `2d3b6f0` (feat — GREEN, 18/18 deno pass)
4. **Task 2c: invoice-paid anomaly correlation**
   - `144a598` (test — RED, Anom1 failure)
   - `594e02e` (feat — GREEN, 13/13 deno pass)
5. **Task 3a: SLA-reminder Edge Fn**
   - `a26bac8` (test — RED, import not found)
   - `a9f3098` (feat — GREEN, 7/7 deno pass)
6. **Task 3b: SLA cron migration + PHI grep-gate comment fix** — `c2ada0f` (feat + Rule-2 inline correctness fix)

**Plan metadata commit (this SUMMARY):** pending after self-check.

## Files Created/Modified

- `supabase/migrations/20270701000008_affiliate_ratio_baseline_mv.sql` (NEW) — Matview + UNIQUE idx + SECDEF compute fn + hourly CONCURRENTLY cron.
- `supabase/migrations/20270701000009_affiliate_anomaly_sla_cron.sql` (NEW) — Daily 09:00 UTC SLA-reminder cron entry; vault service_role_key bearer.
- `supabase/functions/affiliate-anomaly-sla-reminder/index.ts` (NEW) — Pattern 5 scaffold; bearer-gated; PHI-clean batched email.
- `supabase/functions/affiliate-anomaly-sla-reminder/index.test.ts` (NEW) — 7 cases covering bearer / no-pending / Resend POST / PHI-clean body / summary content / query-error.
- `supabase/functions/affiliate-anomaly-sla-reminder/deno.json` (NEW) — Standard task config matching affiliate-payout sibling.
- `leanshot/src/lib/affiliate/anomaly-detection.ts` (NEW) — Pure-fn `computeZScore` + `isAnomalyFlagged` + `ANOMALY_Z_THRESHOLD=3`.
- `leanshot/src/lib/affiliate/__tests__/anomaly-detection.test.ts` (NEW) — 9 cases covering normal inputs / cold-start / NaN / Infinity / boundary `|z|=3`.
- `supabase/functions/affiliate-attribute/index.ts` (MODIFIED) — Added 70-line ratio-detector block after click INSERT; introduces `RATIO_ANOMALY_Z_THRESHOLD=3` (documented duplication seam).
- `supabase/functions/affiliate-attribute/index.test.ts` (MODIFIED) — Extended fake admin with `affiliate_impressions` + `affiliate_fraud_signals` + RPC mocks; added R1–R4 ratio-detector cases.
- `supabase/functions/stripe-webhook/events/invoice-paid.ts` (MODIFIED) — INSERT now chains `.select('id').single()`; added 60-line anomaly correlation try/catch block.
- `supabase/functions/stripe-webhook/events/invoice-paid.test.ts` (MODIFIED) — Mock admin extended with conversion UPDATE + fraud_signals SELECT chains; added Anom1–Anom4 cases.

## Decisions Made

- **Inline-duplicated threshold in Edge Fn** — `RATIO_ANOMALY_Z_THRESHOLD = 3` lives in both `leanshot/src/lib/affiliate/anomaly-detection.ts` AND `supabase/functions/affiliate-attribute/index.ts`. Deno runtime cannot import from the leanshot bundle tree; both copies carry "MUST stay in sync" comments. This is the documented project pattern for shared client/Edge predicates.
- **Anomaly correlation order in invoice-paid** — 23505 idempotent replay returns BEFORE the correlation block. Rationale: the first writer owns the `anomaly_flagged` column on that pre-existing row; replaying must not overwrite a previously-applied (or admin-cleared) flag.
- **Conversion id omitted from SLA email body** — The plan said "affiliate_id + z_score + flagged-since timestamp", and conversion id is technically internal. Including it would let a leaked email body correlate to a user via the `affiliate_conversions.user_id` FK chain. Omitted by design; assertion in test #5 enforces.
- **PHI keyword list moved out of source comments** — SC#4 mandates `grep -cE 'patient|medication|diagnosis|dose' returns 0` on the SLA Edge Fn source. The natural way to document the forbidden list is to name the words. Rewrote the comment to reference the test file's PHI-clean assertion instead (per `reference_grep_gate_comment_strip`).
- **Migration filenames stick to strict 14-digit prefix** — `20270701000008_*.sql` + `20270701000009_*.sql` per `reference_supabase_migration_filename_regex` (no letter suffixes).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 – Missing Critical] PHI-keyword comment broke SC#4 grep gate**
- **Found during:** Task 3 final verification (post-GREEN)
- **Issue:** Edge Fn doc-comment listed forbidden PHI keywords (`patient`, `medication`) verbatim to document the intent. SC#4 contract is literal `grep -cE 'patient|medication|...' returns 0`. Comment violated the gate without weakening behavior.
- **Fix:** Rewrote the comment to reference the sibling test case's PHI-clean assertion instead of naming the words.
- **Files modified:** `supabase/functions/affiliate-anomaly-sla-reminder/index.ts`
- **Verification:** `grep -cE 'patient|medication|diagnosis|dose' ... → 0`; tests still 7/7 pass.
- **Committed in:** `c2ada0f` (bundled with Migration 09 commit)

**2. [Rule 3 – Blocking] node_modules absent in worktree**
- **Found during:** Task 2 first vitest run (Cannot find package 'vitest')
- **Issue:** Fresh worktree does not inherit `node_modules`; `npm install` in worktree risks leaking into main checkout (per memory `feedback_worktree_executor_npm_install_leak`).
- **Fix:** Symlinked `leanshot/node_modules` → `/Users/karstenhaldan/minisite/leanshot/node_modules` for the duration of the run, then removed the symlink at end-of-plan before SUMMARY commit. Symlink was NEVER committed.
- **Files modified:** None tracked.
- **Verification:** `git status --short` clean after symlink removal; no extraneous untracked artifacts.
- **Committed in:** N/A (pure dev-time setup; no source commit)

---

**Total deviations:** 2 auto-fixed (1 missing-correctness comment fix, 1 dev-environment blocker)
**Impact on plan:** No scope creep. Both fixes preserve plan intent.

## Issues Encountered

- **`npx vitest run --reporter=basic`** stalled with custom-reporter resolution error; default reporter worked fine. Used default reporter throughout.

## User Setup Required

None — no new external service configuration. Resend domain `app.leanshot.app` is already verified (per memory `reference_resend_phase9_wiring`); `ADMIN_REVIEW_EMAIL_TO` Supabase Function secret may need setting if not yet present (defaults to empty string → Resend will 400 with a clear error, surfaced in the JSON response envelope).

**Operational note for orchestrator:** Migrations 20270701000008 and 20270701000009 must be pushed via `supabase db push --linked` AFTER Plan 26-01's migrations 20270701000001–000007 land (RLS + `affiliate_fraud_signals` table + `anomaly_*` columns are 26-01-owned).

## Next Phase Readiness

- **Plan 26-04 (payouts):** ready — `affiliate_ratio_baseline` matview and `compute_affiliate_ratio_z_score` RPC available for any payout-time gating logic.
- **Plan 26-05 (admin review UI):** ready — `leanshot/src/lib/affiliate/anomaly-detection.ts` exports `ANOMALY_Z_THRESHOLD` for the UI cutoff display; `affiliate_conversions.anomaly_flagged + anomaly_z_score` columns will be populated by the time this plan ships (assuming 26-01 lands ahead).
- **Plan 26-07 (chargeback claw-back):** unaffected — that plan owns `signal_type='chargeback'` writes; this plan owns only `signal_type='anomaly_z_score'`.
- **Blockers:** None.

---
*Phase: 26-multi-tier-affiliate-standard-gold-lifetime*
*Completed: 2026-05-18*

## Self-Check: PASSED

All 8 newly-created files exist on disk; all 4 modified files contain expected Phase 26 markers; all 10 task commits (`80c67b3`, `64f91fd`, `09a3ac3`, `6057316`, `2d3b6f0`, `144a598`, `594e02e`, `a26bac8`, `a9f3098`, `c2ada0f`) present in `git log`. All 5 plan success criteria pass: SC#1 (matview grep count=7), SC#2 (Edge Fn ratio hook present), SC#3 (vitest 9/9 green), SC#4 (PHI grep returns 0), SC#5 (cron `0 9 * * *` present). All test suites pass: 9 vitest + 18 deno (attribute) + 13 deno (invoice-paid) + 7 deno (sla-reminder) = 47/47.
