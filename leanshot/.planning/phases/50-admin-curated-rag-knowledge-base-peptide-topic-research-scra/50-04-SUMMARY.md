---
phase: 50-admin-curated-rag-knowledge-base-peptide-topic-research-scra
plan: 04
subsystem: rag-scrape-pipeline
tags: [supabase-edge-fn, firecrawl, pg-cron, sentry, cost-gate, diff-detect, robots-txt]
dependency_graph:
  requires:
    - "Plan 50-01: rag_topics, rag_sources, rag_chunks, rag_scrape_runs, rag_cost_ledger, rag_budget_caps schema + rag_mtd_spend_by_vendor() RPC"
    - "Plan 50-02: admin topic CRUD UI (creates the rag_topics rows the runner consumes)"
    - "Plan 50-03: rag_* event taxonomy + captureRagEvent helper contract (this plan adds the Deno-runtime mirror)"
    - "Phase 28 supabase/functions/_shared/sentry.ts (extended here with sentryCapture wrapper)"
    - "Phase 24 supabase/functions/_shared/posthog-server.ts (extended here with captureRagEvent)"
  provides:
    - "rag-scrape-runner Edge Function — cron-driven scrape pipeline; consumed by Plan 50-05 (summarize-and-chunk fire-and-forget invoke)"
    - "diff-detector module — D-19 re-validation; consumed by Plan 50-06 review pipeline when admin re-queues a chunk"
    - "cost-ledger helpers — D-30 gating; consumed by Plans 50-05 / 50-08 / 50-09 (OpenAI embed cost, Anthropic summary cost, Resend cost)"
    - "captureRagEvent (Deno runtime) — replaces Plan 50-03 Vite-side helper for Edge Fn consumers (Plans 50-06 / 50-08 already use this signature)"
    - "sentryCapture(err, tags) wrapper — consumed by future rag_* Edge Fns (Plan 50-05 summarize, 50-08 newsletter sender)"
    - "rag-scrape-tick pg_cron entry (every 5 min)"
  affects:
    - "supabase/functions/rag-scrape-runner/ — new Edge Fn (4 files)"
    - "supabase/functions/_shared/ — sentry.ts + posthog-server.ts extended"
    - "supabase/migrations/ — 1 new migration (20260519000011)"
    - "leanshot/src/lib/rag/__tests__/ — 4 new vitest files (38 + 42 = 80 cases total for this plan)"
    - "leanshot/src/lib/rag/scrape/ — 3 new vite-side mirror modules"
tech_stack:
  added:
    - "@mendable/firecrawl-js@1 (via esm.sh, Edge Fn bundler-safe per [[reference_supabase_edge_function_deploy]])"
    - "duckduckgo.com/html as open-web seed URL (v1 simplification; v1.4 to add a Google CSE / Exa.ai alternative)"
  patterns:
    - "UPDATE-with-RETURNING + last_scraped_at cutoff for concurrent-cron-tick claim isolation"
    - "3-attempt exponential backoff (1m/5m/15m) with retriable-only retry + injectable sleep for test speed"
    - "Vendor-gated startup health-check (200 + ok:false on missing FIRECRAWL_API_KEY) per [[reference_vendor_gated_send_health_check]]"
    - "Vitest-side mirror modules under src/lib/rag/scrape/ for Deno files using npm: specifiers vitest can't resolve (Plan 50-03 precedent)"
    - "Test-mirror divergence is documented in each file header (TODO: pre-commit grep guard in Plan 50-09)"
    - "Pure Deno test filename <name>.test.ts per [[reference_deno_test_discovery]]"
    - "$cron$ named dollar-quote tag inside cron.schedule body per [[reference_postgres_dollar_quote_nesting_in_cron_body]]"
    - "Vault key 'service_role_key' (existing project convention; not the plan's 'SUPABASE_SERVICE_ROLE_KEY' literal) per [[reference_supabase_pg_cron_vault_service_role_pattern]]"
key_files:
  created:
    - "supabase/functions/rag-scrape-runner/firecrawl.ts (341 lines)"
    - "supabase/functions/rag-scrape-runner/diff-detector.ts (130 lines)"
    - "supabase/functions/rag-scrape-runner/cost-ledger.ts (174 lines)"
    - "supabase/functions/rag-scrape-runner/index.ts (469 lines)"
    - "supabase/functions/rag-scrape-runner/__tests__/integration.test.ts (139 lines, 5 Deno tests)"
    - "supabase/migrations/20260519000011_rag_scrape_cron.sql (56 lines)"
    - "leanshot/src/lib/rag/scrape/diff-detector.ts (86 lines, mirror)"
    - "leanshot/src/lib/rag/scrape/cost-ledger.ts (139 lines, mirror)"
    - "leanshot/src/lib/rag/scrape/runner-helpers.ts (138 lines, mirror)"
    - "leanshot/src/lib/rag/__tests__/diff-detector.test.ts (140 lines, 17 cases)"
    - "leanshot/src/lib/rag/__tests__/cost-ledger.test.ts (290 lines, 21 cases)"
    - "leanshot/src/lib/rag/__tests__/scrape-runner.test.ts (243 lines, 25 cases)"
    - "leanshot/src/lib/rag/__tests__/cron-orchestrator.test.ts (118 lines, 17 cases)"
  modified:
    - "supabase/functions/_shared/sentry.ts (+15 lines — sentryCapture wrapper)"
    - "supabase/functions/_shared/posthog-server.ts (+44 lines — Deno captureRagEvent)"
decisions:
  - "Test-mirror pattern from Plan 50-03 extended: src/lib/rag/scrape/*.ts vite-resolvable copies of every pure module in supabase/functions/rag-scrape-runner/. Tests use these mirrors. Risk: drift between Deno + vite copies. Mitigation: header comments cross-reference, planned pre-commit grep guard in Plan 50-09."
  - "Vault secret name `service_role_key` (existing convention) not `SUPABASE_SERVICE_ROLE_KEY` (plan literal). Avoids needing a new vault entry; matches audit-archive-nightly + photos-trash-purge + clinician-alert-deliver-cron precedent."
  - "Open-web (Firecrawl /v1/crawl) chunk INSERT deferred to v1.4: discovered pages are cost-logged but not stored as rag_chunks because there's no synthetic 'open-web' rag_sources row to satisfy the FK. v1.4 should add a built-in 'open-web' source row with tier='C'."
  - "captureRagEvent (Deno) defaults distinctId to 'rag-system' for cron-emitted events (D-34: server-only events have no user). Plan 50-06/50-08 will pass userId when surfacing user-attributed events."
  - "scrapeWithBackoff respects FirecrawlError.retriable; non-retriable errors (e.g., 404, robots-disallow upstream) skip backoff. Test seam SCRAPE_FAST_RETRY=1 collapses sleep to 1ms."
  - "Cost gate ordering: gateOrThrow → respectsRobots → scrapeWithBackoff. The gate fires BEFORE the paid call. CostCapExceededError catch auto-pauses the source so the next tick doesn't immediately retry."
  - "Excerpt cap at 4000 chars (D-03: no full-text hosting). Summary stays empty in scrape runner — Plan 50-05 rag-summarize-and-chunk Edge Fn populates it via Anthropic Sonnet 4."
  - "Chunk status defaults to 'queued'; D-19 shouldRequeue() against prior approved chunk for (topic_id, source_id) sets 're-queued' instead. Tier-A auto-publish path is owned by Plan 50-06 (review pipeline)."
  - "Test infrastructure boundary: deno + supabase CLI not on executor PATH locally → those verify steps (deno check, deno test, supabase db push, supabase functions deploy) are DEFERRED to orchestrator. Vitest path validated in-band."
metrics:
  duration: "~25 minutes"
  completed_date: "2026-05-19"
  tasks_completed: 5
  files_created: 13
  files_modified: 2
  commits: 5
  tests_added: 85 # 80 vitest + 5 Deno
---

# Phase 50 Plan 50-04: RAG Scrape Pipeline Summary

Cron-driven Firecrawl scrape pipeline at `supabase/functions/rag-scrape-runner/` with robots.txt enforcement, on-label gating (peptide-bro forum exclusion), 3-attempt exponential backoff, source auto-pause on 3 consecutive failures, cost-cap short-circuit before paid Firecrawl calls, diff-detect re-validation against prior approved chunks, and Sentry capture on every failure. pg_cron `rag-scrape-tick` fires every 5 minutes calling the Edge Fn via `net.http_post` with a vault-sourced service-role bearer. captureRagEvent emits one `rag_scrape_run` telemetry event per topic-run with `duration_ms` + `cost_usd` populated.

## Tasks Completed

| # | Task | Commit | Files |
|---|------|--------|-------|
| 1 | Firecrawl wrapper with robots.txt + on-label gating | `fe256b6` | supabase/functions/rag-scrape-runner/firecrawl.ts |
| 2 | diff-detector + cost-ledger modules + vitest mirrors + 38 unit tests | `a4c3dbe` | 6 files |
| 3 | rag-scrape-runner Edge Fn index + Deno captureRagEvent + sentryCapture | `0220e79` | index.ts + 2 shared helpers |
| 4 | rag-scrape-tick pg_cron migration | `8bce94a` | 20260519000011_rag_scrape_cron.sql |
| 5 | scrape-runner + cron-orchestrator vitest + Deno integration tests | `693ab92` | 4 files (80 vitest + 5 Deno cases) |

## Decisions Made

1. **Vite-side mirror pattern carried forward from Plan 50-03.** Every pure module in `supabase/functions/rag-scrape-runner/` has a vitest-resolvable twin under `leanshot/src/lib/rag/scrape/`. Diff-detector, cost-ledger, and runner-helpers (cadence + retry + EXCLUDED_DOMAINS + parseRobots) are mirrored. Tests use the mirrors. Drift risk acknowledged with header cross-references; Plan 50-09 to add pre-commit grep.

2. **Vault secret name `service_role_key`.** Plan spec called for `SUPABASE_SERVICE_ROLE_KEY` but the project's existing crons (audit-archive-nightly, photos-trash-purge, clinician-alert-deliver-cron) standardize on `service_role_key`. Matched the convention to avoid needing a new vault entry.

3. **Open-web chunk INSERT deferred to v1.4.** Firecrawl `/v1/crawl` discovers pages, but there's no synthetic `open-web` source row in `rag_sources` to satisfy the `rag_chunks.source_id` FK. The runner cost-logs the crawl + logs a `lastErr=open-web-pages-skipped:N` marker. v1.4 should seed a built-in tier='C' open-web source row.

4. **captureRagEvent distinctId default = `'rag-system'`.** D-34 declares scrape telemetry as server-emitted; the runner has no user context. Plans 50-06 (review) and 50-08 (newsletter) override this with the admin's userId when needed.

5. **Cost gate ordered BEFORE robots.txt + Firecrawl call.** `gateOrThrow` runs first so a capped vendor short-circuits to zero paid calls; `CostCapExceededError` catch auto-pauses the source. This ordering pinned in the `scrape-runner.test.ts` "gateOrThrow ordering" assertion via grep.

6. **3-attempt backoff respects FirecrawlError.retriable.** Non-retriable errors (HTTP 4xx except 408/429) skip backoff entirely. Test seam `SCRAPE_FAST_RETRY=1` collapses sleeps to 1ms for the integration test.

7. **rag-summarize-and-chunk chain is fire-and-forget.** The runner invokes `client.functions.invoke('rag-summarize-and-chunk', ...)` after each topic-run with chunks; failure is logged not thrown. Plan 50-05 owns the chain handler.

## Deviations from Plan

### [Rule 3 - Blocking] Deno + supabase CLIs not on executor PATH

- **Found during:** Task 1 verify step (`deno check`) and Task 3 verify (`supabase functions deploy`).
- **Issue:** Local executor environment lacks `deno` and `supabase` binaries. The Task 3 verify includes `supabase functions deploy --no-verify-jwt --linked` and the Task 4 verify includes `supabase db push --linked --dry-run`. Both fail with `command not found`.
- **Fix:** Authored all files per spec; explicitly deferred deno-check / deno-test / supabase-db-push / supabase-functions-deploy to the orchestrator (same pattern Plan 50-01 documented as "DEFERRED to orchestrator"). Vitest checks ran in-band and all 80 cases pass.
- **Files modified:** none — informational deviation.

### [Rule 2 - Critical functionality] Plan 50-03's Vite-only captureRagEvent unusable from Deno runtime

- **Found during:** Task 3 (rag-scrape-runner index needs captureRagEvent server-side).
- **Issue:** Plan 50-03 SUMMARY explicitly notes that captureRagEvent placement at `src/lib/posthog/posthog-server.ts` was a deliberate orchestrator override; the file is Vite/Node-side and the Deno runner cannot import it (no `npm:` resolution from a vite path; vite-emitted JS not available in Deno). Plan 50-03 SUMMARY says "Future plan 50-06/50-08 will inline the helper into a Deno runtime file under supabase/functions/_shared/posthog-server.ts" — 50-04 is the first plan that actually needs it.
- **Fix:** Added Deno-runtime `captureRagEvent({distinctId, name, properties})` to `supabase/functions/_shared/posthog-server.ts`. Same PHI scrub semantics (strips user_id / patient_id), defaults distinctId to 'rag-system', reuses the existing env-gated PostHog singleton (`getClient()`).
- **Files modified:** `supabase/functions/_shared/posthog-server.ts` (+44 lines).
- **Commit:** `0220e79`.

### [Rule 2 - Critical functionality] _shared/sentry.ts API surface mismatch

- **Found during:** Task 3.
- **Issue:** Plan asks for `sentryCapture(err, tags)` shape; existing `_shared/sentry.ts` exports `captureException(err, { level, tags })` with options-bag style. The runner could call `captureException` directly but the plan's call-site shape is cleaner; refactoring all consumers to the new shape would be an out-of-scope change.
- **Fix:** Added `sentryCapture(err, tags)` as a small wrapper around the existing `captureException`. No regression to existing callers.
- **Files modified:** `supabase/functions/_shared/sentry.ts` (+15 lines).
- **Commit:** `0220e79`.

### [Rule 2 - Critical functionality] Migration timestamp slot

- **Found during:** Task 4.
- **Issue:** Plan declares filename `20260519000011_rag_scrape_cron.sql`. Plan 50-01 SUMMARY listed migrations through 09; a quick `ls` showed slot 10 already taken by `20260519000010_rag_admin_rpcs.sql` (Plan 50-02). Slot 11 was free — used it as planned. Strict 14-digit regex verified per [[reference_supabase_migration_filename_regex]].
- **Files modified:** none — informational.

## Authentication Gates

None hit during task execution. The plan's `user_setup` declares a FIRECRAWL_API_KEY checkpoint, but it is deferred to the orchestrator's deploy/UAT step (vendor-gated startup pattern: code deploys & runs without the key; scrape no-ops with a logged warning). Documented in **Pending User Action** below.

## Pending User Action (for orchestrator)

The plan is `autonomous: false` because the following human-gated steps remain. None require code changes; all are vendor/operations gates that must run from a workstation with `supabase` + `deno` CLIs and the Supabase project linked.

| Step | What | How |
|------|------|-----|
| 1 | Apply migration `20260519000011_rag_scrape_cron.sql` | `supabase db push --linked` |
| 2 | Verify vault entry `service_role_key` exists (already present from Phase 24) | `supabase db query --linked "select count(*) from vault.decrypted_secrets where name='service_role_key';"` |
| 3 | Deploy Edge Fn | `supabase functions deploy rag-scrape-runner --no-verify-jwt` (NOT `--linked` per [[reference_supabase_functions_deploy_no_linked_flag]]) |
| 4 | Provision FIRECRAWL_API_KEY (Firecrawl Starter plan, $19/mo) | `supabase secrets set FIRECRAWL_API_KEY=fc-xxx` after signing up at https://firecrawl.dev/app/api-keys |
| 5 | Smoke probe | `curl https://ytnsipxxmzgaebkqmokp.supabase.co/functions/v1/rag-scrape-runner/healthz` — expect `{ ok: true, vendors: { firecrawl: { ok: true }, ... } }` once key set; before that expect `{ ok: false, vendors: { firecrawl: { ok: false, reason: 'FIRECRAWL_API_KEY missing' } } }` |
| 6 | Run live vitest with env wired | `SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… vitest run src/lib/rag/__tests__/` (re-enables the 3 currently-skipped Plan 50-01 schema tests + activates the Deno full-pipeline integration test) |
| 7 | Run Deno integration tests | `deno test supabase/functions/rag-scrape-runner/__tests__/integration.test.ts --allow-env --allow-net --allow-read` |
| 8 | Confirm cron registered | `supabase db query --linked "select jobname, schedule from cron.job where jobname='rag-scrape-tick';"` |

## Known Stubs

| Stub | File | Reason / resolution plan |
|------|------|---|
| `sendEightyPctEmail` is a placeholder | `supabase/functions/rag-scrape-runner/cost-ledger.ts` + mirror | Per plan spec — Plan 50-09 finalizes the email send + `rag_budget_alerts_sent` dedupe table. Current behavior: no-op + log warning. |
| Open-web crawl pages cost-logged but not stored in rag_chunks | `supabase/functions/rag-scrape-runner/index.ts` `scrapeTopic` open-web branch | No synthetic 'open-web' source row exists. v1.4 to seed one (tier='C') + wire INSERT. Tracked as `lastErr=open-web-pages-skipped:N`. |
| Summary stays empty on INSERT | `supabase/functions/rag-scrape-runner/index.ts` `insertChunkIfNew` | Plan 50-05 rag-summarize-and-chunk Edge Fn populates `summary` (Anthropic Sonnet 4 summarization). Chain invoked fire-and-forget after each topic-run. |

## Threat Flags

| Flag | File | Description |
|------|------|---|
| threat_flag: net-egress | `supabase/functions/rag-scrape-runner/firecrawl.ts` | New outbound HTTP surface to esm.sh/firecrawl/customer-controlled URLs via Firecrawl. Mitigated by EXCLUDED_DOMAINS (D-07) + robots.txt enforcement (D-03) + Firecrawl's own crawler that respects robots. |
| threat_flag: vendor-cost | `supabase/functions/rag-scrape-runner/cost-ledger.ts` | Paid-per-call vendor (Firecrawl). Hard 100%-cap kill-switch via `gateOrThrow` + auto-pause source on cap. 80% threshold email path stubbed (Plan 50-09 to finalize). |
| threat_flag: cron-bearer | `supabase/migrations/20260519000011_rag_scrape_cron.sql` | New service-role bearer use from pg_cron via vault.decrypted_secrets. Already a Phase 24 precedent (audit-archive-nightly), same vault key. |
| threat_flag: anon-read | (none) | Plan 50-04 does not introduce any anon-accessible surface. Edge Fn requires service-role bearer; the cron is the only caller. |

## Tooling notes

- **deno + supabase CLIs not installed locally.** All "Deno check" / "deno test" / "supabase db push" / "supabase functions deploy" steps are deferred to the orchestrator. Vitest path was validated end-to-end (80 cases green).
- **Test mirror divergence risk.** `scrape/diff-detector.ts`, `scrape/cost-ledger.ts`, and `scrape/runner-helpers.ts` each carry a header comment cross-referencing the Deno copy. A pre-commit grep guard is planned for Plan 50-09 to detect drift.
- **Pre-existing rag test failures (out of scope).** 3 vitest files from Plan 50-01 (`tier-check.test.ts`, `topic-crud.test.ts`, `topic-crud-rls.test.ts`) throw at module load when SUPABASE_SERVICE_ROLE_KEY is unset — they call `getAdmin()` outside `describeIfLive`. This was pre-existing; out of scope for Plan 50-04 per SCOPE BOUNDARY. Logged to phase deferred-items by reference.

## Verification

- `npx vitest run src/lib/rag/__tests__/diff-detector.test.ts src/lib/rag/__tests__/cost-ledger.test.ts src/lib/rag/__tests__/scrape-runner.test.ts src/lib/rag/__tests__/cron-orchestrator.test.ts` — **PASS** (80/80 cases green, 0 skipped).
- `npx tsc --noEmit -p tsconfig.app.json` — **PASS** (no errors in files touched by this plan).
- Filename regex on `20260519000011_rag_scrape_cron.sql` — **PASS** (matches `^[0-9]{14}_[a-z0-9_]+\.sql$`).
- Grep contract assertions (esm.sh import, no npm: scheme, `respectsRobots(url)`, `gateOrThrow → scrapeWithBackoff` order, `captureRagEvent('rag_scrape_run', ...)`, vault.decrypted_secrets, `$cron$` tag) — **PASS** (each pinned in `scrape-runner.test.ts` or `cron-orchestrator.test.ts`).
- `deno check supabase/functions/rag-scrape-runner/*.ts` — **DEFERRED** (CLI not on executor PATH).
- `deno test supabase/functions/rag-scrape-runner/__tests__/integration.test.ts` — **DEFERRED** (CLI not on executor PATH).
- `supabase db push --linked --dry-run` — **DEFERRED** to orchestrator.
- `supabase functions deploy rag-scrape-runner --no-verify-jwt` — **DEFERRED** to orchestrator.
- `supabase db query --linked` cron job presence check — **DEFERRED** to orchestrator.

## Self-Check: PASSED

- `supabase/functions/rag-scrape-runner/firecrawl.ts` — FOUND
- `supabase/functions/rag-scrape-runner/diff-detector.ts` — FOUND
- `supabase/functions/rag-scrape-runner/cost-ledger.ts` — FOUND
- `supabase/functions/rag-scrape-runner/index.ts` — FOUND
- `supabase/functions/rag-scrape-runner/__tests__/integration.test.ts` — FOUND
- `supabase/functions/_shared/sentry.ts` (modified, sentryCapture exported) — FOUND
- `supabase/functions/_shared/posthog-server.ts` (modified, captureRagEvent exported) — FOUND
- `supabase/migrations/20260519000011_rag_scrape_cron.sql` — FOUND
- `leanshot/src/lib/rag/scrape/diff-detector.ts` — FOUND
- `leanshot/src/lib/rag/scrape/cost-ledger.ts` — FOUND
- `leanshot/src/lib/rag/scrape/runner-helpers.ts` — FOUND
- `leanshot/src/lib/rag/__tests__/diff-detector.test.ts` — FOUND
- `leanshot/src/lib/rag/__tests__/cost-ledger.test.ts` — FOUND
- `leanshot/src/lib/rag/__tests__/scrape-runner.test.ts` — FOUND
- `leanshot/src/lib/rag/__tests__/cron-orchestrator.test.ts` — FOUND
- Commit `fe256b6` — FOUND
- Commit `a4c3dbe` — FOUND
- Commit `0220e79` — FOUND
- Commit `8bce94a` — FOUND
- Commit `693ab92` — FOUND
