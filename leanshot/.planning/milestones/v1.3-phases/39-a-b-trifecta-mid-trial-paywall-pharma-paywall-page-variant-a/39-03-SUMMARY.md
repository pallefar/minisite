---
phase: 39-a-b-trifecta-mid-trial-paywall-pharma-paywall-page-variant-a
plan: 03
subsystem: backend-server-tier
tags: [a-b-testing, paywall, pharma, edge-fn, pg-cron, kill-switch, bayes]
requires:
  - 39-01 (user_experiments, variant_config, utm_variant_map, page_variants,
            resolve_cohort_for_user RPC, subscriptions.refunded_at)
  - 39-02 (BlockNode.variant_set_id, phaCheck helper — consumed by Wave 3, not 39-03)
provides:
  - "supabase.functions.invoke('variant-resolver', { body: { surface } }) — server-side variant assignment with cohort-wins-over-UTM (D-10), pharma WA/CT short-circuit (D-07), captureServer($feature_flag_called)"
  - "supabase.functions.invoke('slack-alert-experiments', { body: { kind, variant_id, message, context? } }) — single #growth-experiments channel fan-out (D-04)"
  - "_shared/bayes-posterior.ts posteriorProbVariantWins() — Beta-Binomial Monte Carlo for PAGEAB-07 Bayesian badge"
  - "public.p39_variant_42day_archive_scan() — D-11 daily 06:00 UTC lifecycle"
  - "public.p39_refund_rate_kill_scan() — D-02 daily 03:00 UTC refund-rate kill"
  - "public.p39_pharma_nps_kill_scan() — D-03 weekly Sun 04:00 UTC NPS+1★ kill"
affects:
  - "supabase/functions/_shared/posthog-server.ts (imported, not modified)"
  - "public.user_experiments (UPSERT on first qualifying touch)"
  - "public.variant_config (archived_at SET on kill triggers)"
  - "public.page_variants (warned_at, archived_at, traffic_to_control SET at 35/42 day boundaries)"
tech-stack:
  added:
    - "Marsaglia-Tsang Gamma sampling + Box-Muller normal (inline, ~30 LOC, no deps)"
  patterns:
    - "Pattern B: explicit-uid SECDEF RPC param (no JWT-derived caller identity)"
    - "Pattern C: lazy admin singleton + Proxy test override + setCaptureForTest test seam"
    - "Pattern D: try/finally with await shutdownPostHog()"
    - "Pattern I: pg_cron + vault.decrypted_secrets bearer for cross-Fn invocation"
    - "Vendor-gated send + soft-banner UX (503 vendor_unconfigured before outbound)"
key-files:
  created:
    - "supabase/functions/variant-resolver/index.ts"
    - "supabase/functions/variant-resolver/deno.json"
    - "supabase/functions/variant-resolver/index.test.ts"
    - "supabase/functions/slack-alert-experiments/index.ts"
    - "supabase/functions/slack-alert-experiments/deno.json"
    - "supabase/functions/slack-alert-experiments/index.test.ts"
    - "supabase/functions/_shared/bayes-posterior.ts"
    - "supabase/functions/_shared/bayes-posterior.test.ts"
    - "supabase/migrations/20270714000010_p39_42day_archive_cron.sql"
    - "supabase/migrations/20270714000011_p39_refund_rate_kill_cron.sql"
    - "supabase/migrations/20270714000012_p39_pharma_nps_kill_cron.sql"
    - "supabase/migrations/20270714000015_p39_kill_scan_functions.sql"
    - "supabase/tests/p39_42day_archive.sql"
    - "supabase/tests/p39_refund_rate_kill.sql"
    - "supabase/tests/p39_pharma_nps_kill.sql"
  modified: []
decisions:
  - "D-02 (PAYWALL refund 7d > 2x CONTROL 30d baseline -> archive variant)"
  - "D-03 (PHARMA either NPS drop >=5 OR 1-rating rate > 2x baseline -> archive)"
  - "D-04 (single #growth-experiments Slack channel for all events)"
  - "D-07 (pharma WA/CT short-circuit, 3-signal check: Vercel header + cookie + profile.state_of_residence)"
  - "D-10 (cohort wins over UTM at resolver conflict-resolution time)"
  - "D-11 (42-day lifecycle: warn day 35, hard-cut day 42 + traffic_to_control)"
  - "PAGEAB-07 (Bayesian posterior tri-state badge data source)"
metrics:
  duration: "~50 min"
  completed: "2026-05-24"
  commits: 2
  files_created: 15
  tests_added: 24 (21 Deno + 3 pgTAP files w/ 13 assertions total)
---

# Phase 39 Plan 39-03: Variant-Resolver Edge Fn + Kill-Cron Engine Summary

**Wave 2 server tier — the ENGINE of the trifecta**: ships the server-side variant assignment Fn that Wave 3 consumer surfaces invoke, the single-channel Slack fan-out endpoint, the Beta-Binomial posterior math helper (PAGEAB-07), and the 3 pg_cron jobs that enforce refund/NPS/lifecycle kill-switches entirely server-side without operator intervention.

## What Shipped

### Edge Functions (2 new + 1 shared math helper)

**`supabase/functions/variant-resolver/index.ts`** — server-side variant assignment for the 3 A/B surfaces (paywall | page | pharma). Implements the 8-step resolution per `<interfaces>`:

1. Existing `user_experiments` row for (uid, surface) wins (stickiness; V13-7 race immune).
2. surface=`pharma` AND (Vercel `x-vercel-ip-country-region` ∈ {WA,CT} OR cookie `lt_pharma_blocked` truthy OR `profile.state_of_residence` ∈ {WA,CT}) → `{variant_id:'control', config:{}}`. Profile lookup is wrapped in try/catch so missing-column on main does not break the flow.
3. `adminClient.rpc('resolve_cohort_for_user', { uid })` — explicit uid param per Pattern B / `[[feedback_rpc_auth_uid_vs_service_role_mismatch]]`.
4. If cohort_id: SELECT first non-archived `variant_config` matching (cohort_id, surface).
5. Else: read `cookies.lt_utm_source` (default `'default'`), join `utm_variant_map`; last-resort fall-through to source=`'default'`.
6. UPSERT `user_experiments` (user_id, surface, variant_id, cohort_id, utm_variant_id) onConflict `(user_id, surface)`.
7. `captureServer({ userId: uid, event: '$feature_flag_called', properties: { surface, variant_id, $feature_flag: \`phase39_${surface}\` } })`.
8. SELECT `variant_config.config` WHERE id=variant_id → return.

Wraps handler body in `try { … } finally { await shutdownPostHog(); }` (Pattern D). Test seam: `setCaptureForTest()` indirection records captured args in tests without poking the posthog-node client.

**Response contract** (pinned for downstream Wave 3 + Wave 4 consumers):

```
POST /functions/v1/variant-resolver
  Headers: Authorization: Bearer <user-jwt>, Content-Type: application/json
  Body:    { surface: 'paywall' | 'page' | 'pharma', page_id?: string, block_id?: string }
  200:     { variant_id: string, config: Record<string, unknown> }
  401:     { error: 'unauthenticated' }
  400:     { error: 'invalid_body' }
  503:     { error: 'vendor_unconfigured', service: 'posthog' }
```

**`supabase/functions/slack-alert-experiments/index.ts`** — single-channel webhook fan-out. Internal-only (service-role bearer gate via `constantTimeEqual(bearer, SUPABASE_SERVICE_ROLE_KEY)` with sb_secret_* token per `[[reference_supabase_service_role_key_format_divergence]]`). Vendor-gated on `SLACK_WEBHOOK_EXPERIMENTS_URL` (503 vendor_unconfigured BEFORE outbound). 6-literal kind union: `variant_kill | ship_winner | archive_42d | archive_warn_35d | nps_kill | refund_kill`. AbortController 5-sec outbound timeout. Slack non-2xx maps to 502 `slack_upstream` with `status`. Optional `context` payload renders as code-block attachment.

**`supabase/functions/_shared/bayes-posterior.ts`** — `posteriorProbVariantWins(controlS, controlF, variantS, variantF, samples=20_000)` Beta-Binomial Monte Carlo with Marsaglia-Tsang Gamma sampling and Box-Muller normal sampling. ~30 LOC pure math, no external deps. Importable from Edge Fn admin RPCs (Plan 39-07) AND Vite admin preview (no Deno-only APIs).

### Migrations (4 new)

| Timestamp | File | Purpose |
|-----------|------|---------|
| `20270714000010` | `p39_42day_archive_cron.sql` | Cron `p39-variant-42day-archive` daily 06:00 UTC |
| `20270714000011` | `p39_refund_rate_kill_cron.sql` | Cron `p39-refund-rate-kill` daily 03:00 UTC |
| `20270714000012` | `p39_pharma_nps_kill_cron.sql` | Cron `p39-pharma-nps-kill` weekly Sun 04:00 UTC |
| `20270714000015` | `p39_kill_scan_functions.sql` | 3 SECDEF SQL functions called by the crons |

Slots 13 + 14 were already claimed by Plan 39-01 (`p39_subscriptions_refunded_at`, `p39_resolve_cohort_for_user_rpc`). Plan 39-03 jumped to slot 15 for the scan-functions module per the plan's explicit instruction.

All 3 cron migrations use named dollar-quote tags (`$cron$` outer, `$unschedule$` for the idempotent prelude) per `[[reference_postgres_dollar_quote_nesting_in_cron_body]]`. None of the 3 reference `vault.decrypted_secrets` in the cron body — that lives in the SCAN FUNCTION instead, keeping the schedule wrappers minimal.

### Kill-scan SQL Functions (3, all SECURITY DEFINER, all idempotent)

- **`p39_variant_42day_archive_scan()`** — Warns `page_variants` between 35 and 42 days old; archives those past 42 days + flips `traffic_to_control = TRUE`. Fires `slack-alert-experiments` with `kind='archive_warn_35d'` or `'archive_42d'` for each row touched in the run (window = last 5 minutes' worth of warned/archived rows).
- **`p39_refund_rate_kill_scan()`** — Computes CONTROL 30d baseline (= refund rate among subscriptions whose users have no `user_experiments` row for paywall, i.e., no variant assignment). Per non-control variant, computes 7d refund rate and archives the `variant_config` row when rate > 2 × baseline AND baseline > 0. Service-role context: reads `subscriptions.refunded_at` + `user_experiments` directly with no JWT-derived caller identity.
- **`p39_pharma_nps_kill_scan()`** — NPS branch always active: lifetime variant NPS vs prior-30d global pharma baseline; kill if drop ≥5 points AND ≥5 responses. 1-rating branch is DEFENSIVELY GATED: pre-checks `to_regclass('public.review_submissions') is not null`; if absent (Plan 39-08 owns the table), the branch is skipped and the function continues without error. When present, computes per-variant 7d 1-rating rate vs trailing-30d baseline; kill at 2× baseline.

### pgTAP Proofs (3, all use begin/rollback wrapper + named dollar-tags)

- **`supabase/tests/p39_42day_archive.sql`** (6 assertions) — 36-day variant warned, 43-day variant archived + `traffic_to_control=true`, warned variant NOT archived, idempotency on second scan (warned_at + archived_at unchanged).
- **`supabase/tests/p39_refund_rate_kill.sql`** (3 assertions) — 100 CONTROL subs (6 refunded, 30d window) + 20 TEST subs (4 refunded, 7d) produces 0.20 vs 0.06 (>2×) → TEST `variant_config.archived_at` set; idempotency on second scan; no spurious sibling archives.
- **`supabase/tests/p39_pharma_nps_kill.sql`** (4 assertions) — Baseline NPS=+100 vs variant NPS=-100 (drop 200pts ≥5) → variant archived; idempotency; SECDEF flag asserted via `pg_proc.prosecdef`; function body negation-grep asserts no JWT-helper reference.

## Test Results

| Suite | File | Tests | Status |
|-------|------|-------|--------|
| variant-resolver | `supabase/functions/variant-resolver/index.test.ts` | 9 | GREEN |
| slack-alert-experiments | `supabase/functions/slack-alert-experiments/index.test.ts` | 9 | GREEN |
| bayes-posterior | `supabase/functions/_shared/bayes-posterior.test.ts` | 3 | GREEN |
| **Deno total** | | **21** | **GREEN** |

Verified via `$HOME/.deno/bin/deno test --allow-all --no-check supabase/functions/variant-resolver/index.test.ts supabase/functions/slack-alert-experiments/index.test.ts supabase/functions/_shared/bayes-posterior.test.ts` → `21 passed | 0 failed (97ms)`.

pgTAP proofs not executed in this worktree — they require a live Postgres instance via `supabase test db`. Will run when Phase 39 close-out plan executes `supabase db push --linked` + `supabase test db p39_*.sql` against the project ref.

## Decisions Applied

| ID | Decision | Implementation Site |
|----|----------|---------------------|
| D-02 | Refund 7d > 2× CONTROL 30d → kill | `p39_refund_rate_kill_scan()` lines 165-228 |
| D-03 | PHARMA NPS ≥5 drop OR 1-rating > 2× → kill | `p39_pharma_nps_kill_scan()` lines 263-440 |
| D-04 | Single Slack channel | `slack-alert-experiments` Edge Fn |
| D-07 | Pharma WA/CT short-circuit (3-signal) | `variant-resolver/index.ts` `isPharmaBlocked()` |
| D-10 | Cohort wins over UTM | `variant-resolver/index.ts` steps 3-5 |
| D-11 | 42-day warn-then-archive | `p39_variant_42day_archive_scan()` lines 50-138 |
| PAGEAB-07 | Bayesian posterior tri-state | `_shared/bayes-posterior.ts` |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 — Negation-grep defeated by comment string]** — three `auth.uid()` literal occurrences in `-- T-39-03-04` block + two `comment on function` strings tripped the plan's `! grep -E 'auth\.uid\(\)' ...` verify gate even though the function bodies never reference it. Fix: rewrote those 3 comment lines to use prose "JWT-derived caller identity helper" without the literal name, per `[[feedback_negation_grep_defeated_by_comment_string]]`. Verify now passes (`grep -cE 'auth\.uid\(\)' .../20270714000015_*.sql` = 0). Fix lives in the same Task 2 commit (96d47a9c).

**2. [Rule 2 — Forward-compatible 1-star branch]** — Plan instructed kill-scan to read `public.review_submissions` for the pharma 1★ branch. The table does NOT exist on main as of Phase 39 Wave 2 (Plan 39-08 plans it; per `<read_first>` of 39-08-PLAN.md the table ships in the admin metrics surface phase). Without a guard, the function would throw on first cron fire. Fix: pre-check `to_regclass('public.review_submissions') is not null` and conditionally skip the 1★ branch when absent. NPS branch is fully active. When Plan 39-08 lands, the 1★ branch activates automatically without redeploy. Documented in the function's COMMENT block.

**3. [Rule 2 — `import.meta.main` guard on Deno.serve]** — Per memory `[[reference_deno_test_top_level_serve_trap]]`, the project's existing pattern of unguarded `Deno.serve(handler)` causes `deno test path/` to start real HTTP servers on import. The plan's verify command targets individual `index.test.ts` files explicitly, so the bug doesn't bite — but adding `&& import.meta.main` to the new Fns' `Deno.serve` guard is forward-compatible and isolation-safe. Existing project Fns (ship-winner-flag etc.) are unchanged.

No architectural deviations (Rule 4). No authentication gates required (Rule 0).

## Threat Model Mitigations Applied

| Threat ID | Mitigation site |
|-----------|----------------|
| T-39-03-01 (adblocker tampers assignment) | `captureServer()` server-side fires in `variant-resolver` |
| T-39-03-02 (JWT forge) | `admin.auth.getUser(jwt)` GoTrue check; 401 on failure |
| T-39-03-03 (pharma served to WA/CT) | 3-signal `isPharmaBlocked()` check on `surface=pharma` BEFORE cohort/UTM resolution |
| T-39-03-04 (JWT helper in kill-scan) | Negation grep `! grep auth.uid()` against migration 15 passes; comment-strings rewritten |
| T-39-03-05 (Slack 5xx blocks pg_cron) | `net.http_post` is async; pg_cron does not await; accept residual (documented in comment block) |
| T-39-03-07 (Slack webhook leaks via VITE_) | Variable named `SLACK_WEBHOOK_EXPERIMENTS_URL` (no VITE_ prefix); Function Secret only |
| T-39-03-08 (service-role key rotation) | Vault `service_role_key` SELECT pattern (stable key name) |
| T-39-03-09 (cron logs PII) | Functions log aggregated counts + variant_id only |

T-39-03-06 (variant kill audit trail) is partially satisfied here (`archived_at` + Slack post) — full `admin_audit_log` row is owned by Plan 39-07's admin RPCs.

## Commits

| Hash | Task | Files |
|------|------|-------|
| `21e970f9` | Task 1: variant-resolver + slack-alert-experiments + bayes-posterior | 8 |
| `96d47a9c` | Task 2: 3 crons + kill-scan SQL + 3 pgTAP proofs | 7 |

## Self-Check: PASSED

- All 15 created files exist at declared paths
- Both commit hashes resolve (`git log --oneline --all`)
- `deno test` 21/21 GREEN
- Plan-spec verify command passes (4 migrations, $cron$ tags, decrypted_secrets, no auth.uid(), 3 pgTAP files)
- `import.meta.main` guard prevents test-import server-start trap

## Carry-Forward

- **HUMAN-UAT signal:** Wave 5 close-out plan must verify `SLACK_WEBHOOK_EXPERIMENTS_URL` Function Secret is set + `vault.decrypted_secrets WHERE name='service_role_key'` is populated BEFORE pushing crons to prod (per `[[feedback_fn_deploy_before_cron_db_push]]` adjusted for this phase: vault-secret-first then cron). The pre-flight in Plan 39-10 / close-out should run:
  ```bash
  supabase secrets list --project-ref ytnsipxxmzgaebkqmokp | grep SLACK_WEBHOOK_EXPERIMENTS_URL
  supabase db query --linked "select 1 from vault.decrypted_secrets where name='service_role_key'"
  ```
- **Plan 39-08 unlock:** when `public.review_submissions` lands, the 1-rating branch of `p39_pharma_nps_kill_scan()` activates automatically. Plan 39-08 should add a pgTAP test exercising that branch (refresh `p39_pharma_nps_kill.sql` or sibling).
- **Plan 39-09 page-render:** consumes the `variant-resolver` response contract pinned in this SUMMARY. Body `{ variant_id, config }` is the contract surface.
- **Edge Fn deploys deferred:** per execution prompt directive, this plan did NOT run `supabase functions deploy`. Orchestrator deploys the 2 new Fns + (no shared changes — `bayes-posterior.ts` is import-only) before `supabase db push` so the crons don't fire against missing endpoints.
