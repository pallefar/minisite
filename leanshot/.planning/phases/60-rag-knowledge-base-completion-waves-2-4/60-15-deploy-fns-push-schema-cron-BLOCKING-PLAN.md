---
phase: 60-rag-knowledge-base-completion-waves-2-4
plan: 15
type: execute
wave: 3
depends_on: [60-04, 60-05, 60-06, 60-07, 60-08, 60-09, 60-11, 60-12, 60-13, 60-14]
files_modified:
  - supabase/migrations/20281201000099_phase60_cron_schedules.sql
  - .planning/phases/60-rag-knowledge-base-completion-waves-2-4/60-DEPLOY-EVIDENCE.md
  - .planning/ROADMAP.md
autonomous: false
requirements: [RAG-01, RAG-02, RAG-04, RAG-05, RAG-06, RAG-07, RAG-08]
tags: [supabase, edge-functions, pg-cron, deploy, blocking-close-out]

user_setup:
  - service: supabase
    why: "Deploy 10 Edge Functions atomically + push cron migration after Fns are live (per [[feedback_fn_deploy_before_cron_db_push]] — cron fires within 15min of db push to non-existent endpoints otherwise)."
    env_vars:
      - name: SUPABASE_ACCESS_TOKEN
        source: "supabase.com → Account → Access Tokens (operator's personal token; required for `supabase functions deploy` and `supabase db push --linked`)"
    dashboard_config:
      - task: "Verify vault entry `service_role_key` exists (used by all 7 cron jobs to authenticate Fn invocations)"
        location: "Supabase Dashboard → Database → Vault — confirm row `service_role_key` decrypts"
      - task: "Verify vault entry `slack_guardrail_webhook` exists (used by guardrail alert helper from 60-02)"
        location: "Supabase Dashboard → Database → Vault — confirm row `slack_guardrail_webhook` decrypts to a valid Slack incoming-webhook URL"

must_haves:
  truths:
    - "All 10 Phase 60 Edge Functions deployed to project `ytnsipxxmzgaebkqmokp` and visible in `supabase functions list`"
    - "7 pg_cron jobs registered with `jobname like 'phase60_%'` after Fns are live (federated-pubmed daily 03:00 UTC, federated-fda daily 03:00 UTC, federated-dailymed daily 03:00 UTC, embed-worker every 5 min, tip-of-day daily 00:00 UTC, newsletter weekly Sunday 13:00 UTC = 09:00 ET, eval nightly 02:00 UTC) — count == 7 cron rows (3 federated + embed + tip + newsletter + eval)"
    - "Cron jobs authenticate via `vault.decrypted_secrets` lookup of `service_role_key` (no GUC, no hardcoded bearer)"
    - "`supabase db push --linked` exits 0 with no back-dated-migration block"
    - "ROADMAP.md Phase 60 entry flipped from `- [ ]` → `- [x]` (Plans line updated from `TBD` to `15 plans (all complete)`)"
    - "60-DEPLOY-EVIDENCE.md records the deploy timestamp, function names, cron jobnames, and migration timestamp for audit trail"
  artifacts:
    - path: "supabase/migrations/20281201000099_phase60_cron_schedules.sql"
      provides: "7 pg_cron job registrations for Phase 60 Fns"
      contains: "cron.schedule('phase60_"
      min_lines: 80
    - path: ".planning/phases/60-rag-knowledge-base-completion-waves-2-4/60-DEPLOY-EVIDENCE.md"
      provides: "Deploy audit trail: functions list output, cron.job query output, db push log excerpt"
      min_lines: 30
  key_links:
    - from: "supabase/migrations/20281201000099_phase60_cron_schedules.sql"
      to: "supabase/functions/rag-federated-pubmed (and 8 siblings)"
      via: "net.http_post URL pointing at deployed Fn endpoint"
      pattern: "https://ytnsipxxmzgaebkqmokp\\.supabase\\.co/functions/v1/rag-"
    - from: "cron body"
      to: "vault.decrypted_secrets"
      via: "service_role_key bearer token lookup"
      pattern: "FROM vault\\.decrypted_secrets WHERE name = 'service_role_key'"
---

<objective>
**BLOCKING close-out plan for Phase 60.** Strict 3-step ordering per `[[feedback_fn_deploy_before_cron_db_push]]`:

1. Deploy all 10 Phase 60 Edge Functions atomically (`supabase functions deploy ... --project-ref ytnsipxxmzgaebkqmokp`).
2. Write cron migration `20281201000099_phase60_cron_schedules.sql` registering 7 pg_cron jobs targeting the now-live Fns.
3. `supabase db push --linked` from `leanshot/` so the cron jobs activate.

Phase 60 verification CANNOT pass without this plan. If steps 2 → 1 order is reversed, the FIRST cron tick (≤ 5 min for embed-worker, ≤ 15 min for daily) fires `net.http_post` against a 404 endpoint, silently dropping work and logging stale-Fn errors.

Purpose: Activate the production data path for federated source sync, embedding pipeline, tip-of-day generation, weekly newsletter, and nightly eval — none of which are running until cron is registered against live Fns.

Output: Deployed Fns + migration file + ROADMAP toggle + deploy evidence artifact.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/STATE.md
@.planning/phases/60-rag-knowledge-base-completion-waves-2-4/60-PLAN-OUTLINE.md
@.planning/phases/60-rag-knowledge-base-completion-waves-2-4/60-AI-SPEC.md
@.planning/phases/60-rag-knowledge-base-completion-waves-2-4/60-CONTEXT.md

<!-- Canonical cron-pattern reference (Phase 56) — copy structure, not contents -->
@supabase/migrations/20280401000005_ad_revenue_etl_cron_rpc.sql

<interfaces>
<!-- The 10 Phase 60 Edge Functions this plan deploys + crons against. Names + invocation URLs MUST match exactly. -->

Deployed by Plan 60-04:
  - supabase/functions/rag-summarize-and-chunk/    → POST https://ytnsipxxmzgaebkqmokp.supabase.co/functions/v1/rag-summarize-and-chunk
Deployed by Plan 60-05:
  - supabase/functions/rag-embed-approved/          → POST https://ytnsipxxmzgaebkqmokp.supabase.co/functions/v1/rag-embed-approved   (CRON: every 5 min)
Deployed by Plan 60-06:
  - supabase/functions/rag-retrieve/                → POST https://ytnsipxxmzgaebkqmokp.supabase.co/functions/v1/rag-retrieve
Deployed by Plan 60-07:
  - supabase/functions/rag-federated-pubmed/        → POST https://ytnsipxxmzgaebkqmokp.supabase.co/functions/v1/rag-federated-pubmed     (CRON: 03:00 UTC daily)
  - supabase/functions/rag-federated-fda/           → POST https://ytnsipxxmzgaebkqmokp.supabase.co/functions/v1/rag-federated-fda        (CRON: 03:00 UTC daily)
  - supabase/functions/rag-federated-dailymed/      → POST https://ytnsipxxmzgaebkqmokp.supabase.co/functions/v1/rag-federated-dailymed   (CRON: 03:00 UTC daily)
Deployed by Plan 60-11:
  - supabase/functions/rag-tip-of-day-generate/     → POST https://ytnsipxxmzgaebkqmokp.supabase.co/functions/v1/rag-tip-of-day-generate  (CRON: 00:00 UTC daily)
Deployed by Plan 60-12:
  - supabase/functions/rag-newsletter-sender/                → POST https://ytnsipxxmzgaebkqmokp.supabase.co/functions/v1/rag-newsletter-sender   (CRON: Sunday 13:00 UTC = 09:00 ET)
  - supabase/functions/rag-newsletter-unsubscribe-1click/    → POST https://ytnsipxxmzgaebkqmokp.supabase.co/functions/v1/rag-newsletter-unsubscribe-1click  (no cron — invoked by mail client)

Additional cron (no Fn — invokes nightly eval harness shipped by Plan 60-03):
  - phase60_eval_nightly                            → invokes rag-retrieve eval-sweep mode (CRON: 02:00 UTC nightly)
                                                       OR calls a script-runner Fn if 60-03 ships one; planner reads 60-03 SUMMARY at execute-time
                                                       to pick the live signature.

Project ref: `ytnsipxxmzgaebkqmokp` (from `.planning/PROJECT.md:22`).
Repo layout: `supabase/functions/` and `supabase/migrations/` live at **git root** `/Users/karstenhaldan/minisite/`, NOT under `leanshot/`. The `supabase` CLI must be invoked from `leanshot/` (where `supabase/config.toml`-linked project lives) — verify with `pwd` before every `supabase` invocation.

Latest applied migration timestamp on disk: `20280401000007_ad_config_anon_select.sql` (Phase 56 ad-network). The Phase 60 cron migration uses **`20281201000099_...`** which is BACK-DATED relative to Phase 56 — per `[[reference_supabase_back_dated_migration_blocks_push]]` this would normally block `supabase db push`. **Mitigation:** the planner outline already chose `20281201000099` (Dec 2026, AFTER Phase 50 originals which are 20261101*); operator must verify with `supabase migration list --linked` at Task 1 that the remote has NOT yet applied any 2027/2028 migration past `20281201000099`. If Phase 56 (2028-04) is already remote-applied, follow the rescue recipe: `mv` Phase 60 file to `/tmp`, push other pending, restore Phase 60 with bumped timestamp `20280501000099_phase60_cron_schedules.sql`.

Canonical cron pattern (copy STRUCTURE from):
  - supabase/migrations/20280401000005_ad_revenue_etl_cron_rpc.sql
    Uses: cron.unschedule(name) WHERE EXISTS pre-guard + cron.schedule(name, schedule, $$ body $$) with vault.decrypted_secrets lookup + hardcoded https://ytnsipxxmzgaebkqmokp.supabase.co URL.

Vault entries required (verify in Task 2):
  - `service_role_key` — bearer token for net.http_post Authorization header
  - `slack_guardrail_webhook` — used by 60-02 _shared/slack-guardrail-alert.ts; not invoked by cron directly but must be present for Fns to alert on G1/G2/G7 breaches
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Pre-flight — verify Fn dirs + deno.json + migration timestamp clear</name>
  <files>(read-only verification; no writes)</files>
  <action>
    From `leanshot/` working dir, run all of:

    (a) `pwd` — confirm output ends with `/leanshot` (not git root). If wrong dir, `cd /Users/karstenhaldan/minisite/leanshot`.

    (b) For each of the 9 expected Fn directories, verify the dir exists + contains both `index.ts` and `deno.json`:
       ```
       for fn in rag-summarize-and-chunk rag-embed-approved rag-retrieve \
                 rag-federated-pubmed rag-federated-fda rag-federated-dailymed \
                 rag-tip-of-day-generate rag-newsletter-sender rag-newsletter-unsubscribe-1click; do
         test -f "../supabase/functions/$fn/index.ts" && test -f "../supabase/functions/$fn/deno.json" \
           && echo "OK $fn" || echo "MISSING $fn"
       done
       ```
       Expected: 9 `OK` lines, zero `MISSING`. If any MISSING, STOP — the upstream plan (60-04/05/06/07/11/12) did not ship its Fn; do NOT proceed to deploy.

    (c) Lightweight Deno syntax check on each Fn's `index.ts` (per `[[reference_deno_binary_path]]` — binary lives at `$HOME/.deno/bin/deno`):
       ```
       for fn in rag-summarize-and-chunk rag-embed-approved rag-retrieve \
                 rag-federated-pubmed rag-federated-fda rag-federated-dailymed \
                 rag-tip-of-day-generate rag-newsletter-sender rag-newsletter-unsubscribe-1click; do
         $HOME/.deno/bin/deno check --no-check "../supabase/functions/$fn/index.ts" 2>&1 | tail -3
       done
       ```
       Expected: no `error:` lines. Type-warnings are tolerated under `--no-check`; only hard syntax errors block.

    (d) Verify each Fn's `Deno.serve()` is guarded by `import.meta.main` (per `[[reference_deno_test_top_level_serve_trap]]` — top-level serve aborts test orchestration; planner outline declared this convention in 60-02 helper):
       ```
       for fn in rag-summarize-and-chunk rag-embed-approved rag-retrieve \
                 rag-federated-pubmed rag-federated-fda rag-federated-dailymed \
                 rag-tip-of-day-generate rag-newsletter-sender rag-newsletter-unsubscribe-1click; do
         f="../supabase/functions/$fn/index.ts"
         if grep -v '^\s*//' "$f" | grep -q 'Deno.serve'; then
           grep -v '^\s*//' "$f" | grep -q 'import\.meta\.main' \
             && echo "OK guarded $fn" || echo "UNGUARDED $fn"
         else
           echo "NO-SERVE $fn"
         fi
       done
       ```
       Expected: each line is `OK guarded` or `NO-SERVE` (unsubscribe-1click may legitimately export only a handler). Zero `UNGUARDED` lines. If any UNGUARDED, halt and request 60-02/04/05/06/07/11/12 owner fix the guard before proceeding.

    (e) Verify the chosen cron migration timestamp is not already-applied on remote, by listing applied migrations:
       ```
       supabase migration list --linked 2>&1 | tee /tmp/phase60-migration-list.txt
       ```
       Required check: search the output for any row matching `20281201000099`. Expected: not present (remote has not yet applied this exact migration ID).

       Additionally check: search for any remote-applied row whose timestamp is **lexicographically GREATER than `20281201000099`** AND whose status is `applied`. If ANY such row exists, the back-dated-blocker rule per `[[reference_supabase_back_dated_migration_blocks_push]]` will fire on `db push`. Record the highest-applied remote timestamp to `/tmp/phase60-remote-max.txt` and proceed; Task 5 will choose between in-place write vs bumped-timestamp rescue based on this value.
  </action>
  <verify>
    <automated>cd /Users/karstenhaldan/minisite/leanshot &amp;&amp; pwd | grep -q '/leanshot$' &amp;&amp; for fn in rag-summarize-and-chunk rag-embed-approved rag-retrieve rag-federated-pubmed rag-federated-fda rag-federated-dailymed rag-tip-of-day-generate rag-newsletter-sender rag-newsletter-unsubscribe-1click rag-cost-query; do test -f "../supabase/functions/$fn/index.ts" || { echo "MISSING $fn"; exit 1; }; done &amp;&amp; echo "PREFLIGHT-OK"</automated>
  </verify>
  <done>10 Fn directories present with index.ts + deno.json; all Deno.serve calls guarded by import.meta.main (or absent); remote migration list captured to /tmp/phase60-migration-list.txt; remote-max timestamp captured to /tmp/phase60-remote-max.txt; PREFLIGHT-OK printed.</done>
</task>

<task type="checkpoint:human-verify" gate="blocking">
  <name>Task 2: Vault pre-flight — operator verifies service_role_key + slack_guardrail_webhook</name>
  <what-built>
    No code change — operator-side Supabase Vault verification gate. Per `[[reference_supabase_pg_cron_vault_service_role_pattern]]`, all 7 cron jobs in Task 5 read `vault.decrypted_secrets WHERE name = 'service_role_key'` to mint the bearer for `net.http_post`. If that row is absent, every cron tick will fail authentication silently and emit `null bearer` 401s — invisible until someone checks Fn logs days later.

    Operator must also confirm `slack_guardrail_webhook` exists, because 60-02 `_shared/slack-guardrail-alert.ts` reads it; absent webhook degrades G1 PHARMA-02 alerts from P1-page → silent-log-only.
  </what-built>
  <how-to-verify>
    Run the SQL probe via the Supabase Dashboard SQL editor (or `psql` if operator has direct DB access):

    ```sql
    SELECT name,
           CASE WHEN decrypted_secret IS NULL OR length(decrypted_secret) = 0 THEN 'EMPTY'
                ELSE 'OK (length ' || length(decrypted_secret) || ')'
           END AS status
    FROM vault.decrypted_secrets
    WHERE name IN ('service_role_key', 'slack_guardrail_webhook')
    ORDER BY name;
    ```

    Expected output: exactly 2 rows, both `OK (length N)` (typically: service_role_key ≥ 40 chars, slack_guardrail_webhook ≥ 70 chars and begins with `https://hooks.slack.com/`).

    If `service_role_key` is missing or empty: STOP. Operator must add it via the Vault UI (Database → Vault → Add new secret → name = `service_role_key`, value = the project's `service_role` key from API Settings) BEFORE resuming. Do NOT proceed to Task 5 without this row.

    If `slack_guardrail_webhook` is missing or empty: optional degraded path — operator may resume after typing `degraded-no-slack` (G1/G2/G7 alerts will log-only, no Slack page) OR may set the secret first and resume normally.
  </how-to-verify>
  <resume-signal>Type `vault-ok` if both rows present, OR `degraded-no-slack` if service_role_key present but slack webhook absent (Phase 60 ships in alert-degraded mode; Phase 67 OPS-08 backfills). Anything else aborts.</resume-signal>
</task>

<task type="auto">
  <name>Task 3: Atomic deploy of all 10 Phase 60 Edge Functions</name>
  <files>(no files modified locally; deploys to Supabase project ytnsipxxmzgaebkqmokp)</files>
  <action>
    Per `[[feedback_fn_deploy_before_cron_db_push]]` strict ordering: deploy ALL 10 Fns in a single atomic CLI invocation BEFORE writing or pushing the cron migration. If this command fails partway, halt — do NOT proceed to Task 5 with a partial deploy (some crons would land against live Fns, others against 404s).

    From `leanshot/`:
    ```
    supabase functions deploy \
      rag-summarize-and-chunk \
      rag-embed-approved \
      rag-retrieve \
      rag-federated-pubmed \
      rag-federated-fda \
      rag-federated-dailymed \
      rag-tip-of-day-generate \
      rag-newsletter-sender \
      rag-newsletter-unsubscribe-1click \
      rag-cost-query \
      --project-ref ytnsipxxmzgaebkqmokp \
      2>&1 | tee /tmp/phase60-deploy.log
    ```

    Notes:
    - CLI v2.101.0+ silently ignores `--import-map` per `[[reference_supabase_functions_deploy_import_map_flag]]`; per-Fn `deno.json` import maps (declared in 60-02 helper convention + shipped per-Fn by 60-04..07,11,12) handle resolution. Do NOT pass `--import-map`.
    - `SUPABASE_ACCESS_TOKEN` must be set in the operator's shell env. If the CLI prompts for auth, operator runs `supabase login` first.
    - Cost: deploy is free; bundles each Fn into Deno's edge runtime.
    - On partial failure (some Fns deployed, others errored): halt and retry only the failed names; do not advance to Task 5 until `supabase functions list --project-ref ytnsipxxmzgaebkqmokp` shows all 10.

    Capture the deploy log to `/tmp/phase60-deploy.log` for the audit-trail artifact in Task 7.
  </action>
  <verify>
    <automated>grep -cE 'Deployed Function (rag-summarize-and-chunk|rag-embed-approved|rag-retrieve|rag-federated-pubmed|rag-federated-fda|rag-federated-dailymed|rag-tip-of-day-generate|rag-newsletter-sender|rag-newsletter-unsubscribe-1click|rag-cost-query)' /tmp/phase60-deploy.log | grep -q '^10$' &amp;&amp; echo DEPLOY-10-OK</automated>
  </verify>
  <done>All 10 Phase 60 Fn names appear in /tmp/phase60-deploy.log as successfully deployed; CLI exit code 0; DEPLOY-10-OK printed.</done>
</task>

<task type="auto">
  <name>Task 4: Verify deploy via `supabase functions list`</name>
  <files>(read-only; output captured for evidence artifact)</files>
  <action>
    Confirm the deploy is observable on the live project list (not just the deploy log):
    ```
    supabase functions list --project-ref ytnsipxxmzgaebkqmokp 2>&1 | tee /tmp/phase60-functions-list.txt
    ```

    Verify all 10 Phase 60 Fn names appear AND each has a recent `UPDATED_AT` (within the last hour — confirms this run's deploy, not a stale prior version).

    If any Fn is missing from the output, return to Task 3 and re-deploy ONLY the missing names. Do NOT proceed to Task 5 until count is 10.
  </action>
  <verify>
    <automated>for fn in rag-summarize-and-chunk rag-embed-approved rag-retrieve rag-federated-pubmed rag-federated-fda rag-federated-dailymed rag-tip-of-day-generate rag-newsletter-sender rag-newsletter-unsubscribe-1click rag-cost-query; do grep -q "$fn" /tmp/phase60-functions-list.txt || { echo "MISSING-IN-LIST $fn"; exit 1; }; done &amp;&amp; echo LIST-10-OK</automated>
  </verify>
  <done>All 10 Phase 60 Fn names present in `supabase functions list` output; LIST-10-OK printed; /tmp/phase60-functions-list.txt captured for evidence artifact.</done>
</task>

<task type="auto">
  <name>Task 5: Write cron migration `20281201000099_phase60_cron_schedules.sql`</name>
  <files>supabase/migrations/20281201000099_phase60_cron_schedules.sql</files>
  <action>
    Author the cron migration registering 7 pg_cron jobs targeting the now-live Fns (Task 4 confirmed). All jobs share these conventions:

    - **Pre-unschedule guard** (idempotent re-run): `select cron.unschedule('phase60_<name>') where exists (select 1 from cron.job where jobname = 'phase60_<name>');` — mirrors the Phase 56 `ad_revenue_etl_cron` pattern in `supabase/migrations/20280401000005_ad_revenue_etl_cron_rpc.sql`.
    - **Service-role auth via vault** per `[[reference_supabase_pg_cron_vault_service_role_pattern]]`: cron body's `Authorization` header reads `(SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1)`. Do NOT use `current_setting('app.service_role_key')` (the GUC does not exist on this project) and do NOT hardcode the JWT.
    - **Hardcoded base URL** `https://ytnsipxxmzgaebkqmokp.supabase.co/functions/v1/<fn-name>` (project ref from `.planning/PROJECT.md:22`).
    - **Dollar-quote tags:** the migration may contain nested DO blocks for logging; use **named tags `$cron$...$cron$`** for the outer `cron.schedule` body string and `$partition$...$partition$` if any nested anonymous block is needed, per `[[reference_postgres_dollar_quote_nesting_in_cron_body]]`. NEVER use bare `$$` inside another `$$`.
    - **Job naming convention:** all jobnames prefixed with `phase60_` so the verification grep in Task 7 (and any future cleanup) can identify Phase 60-owned crons uniquely.
    - **Migration timestamp:** use `20281201000099` IF Task 1 step (e) confirmed no remote-applied migration is lexicographically greater. IF Task 1 captured a remote-max GREATER than `20281201000099` (e.g., Phase 56's `20280401000007`), rename the file to `20280501000099_phase60_cron_schedules.sql` (forward-dated past the latest remote) and update the migration's leading comment timestamp to match. Do NOT push a back-dated file; per `[[reference_supabase_back_dated_migration_blocks_push]]` it blocks the entire push.

    The 7 cron jobs to register:

    | jobname                          | schedule (cron syntax)      | URL path                                                | Body          |
    |----------------------------------|-----------------------------|---------------------------------------------------------|---------------|
    | `phase60_federated_pubmed_sync`  | `0 3 * * *` (03:00 UTC daily)   | `/functions/v1/rag-federated-pubmed`           | `'{}'::jsonb` |
    | `phase60_federated_fda_sync`     | `0 3 * * *` (03:00 UTC daily)   | `/functions/v1/rag-federated-fda`              | `'{}'::jsonb` |
    | `phase60_federated_dailymed_sync`| `0 3 * * *` (03:00 UTC daily)   | `/functions/v1/rag-federated-dailymed`         | `'{}'::jsonb` |
    | `phase60_embed_worker`           | `*/5 * * * *` (every 5 min)     | `/functions/v1/rag-embed-approved`             | `'{}'::jsonb` |
    | `phase60_tip_of_day_generate`    | `0 0 * * *` (00:00 UTC daily)   | `/functions/v1/rag-tip-of-day-generate`        | `'{}'::jsonb` |
    | `phase60_newsletter_weekly`      | `0 13 * * 0` (Sunday 13:00 UTC = 09:00 EDT / 08:00 EST)¹ | `/functions/v1/rag-newsletter-sender` | `'{}'::jsonb` |
    | `phase60_eval_nightly`           | `0 2 * * *` (02:00 UTC nightly) | `/functions/v1/rag-retrieve`                   | `'{"mode":"eval-sweep"}'::jsonb` ² |

    ¹ AI-SPEC §7 says "Sunday 09:00 ET". pg_cron runs in UTC only — pick `0 13 * * 0` to hit 09:00 EDT during DST (most of the year). The 1-hour drift to 08:00 EST during winter is accepted; users see a newsletter "around Sunday morning ET". If a stricter ET match is required, Phase 67 OPS phase will add a 2nd cron + DST-flip logic.
    ² Body specifies eval-sweep mode. The implementation in 60-03/60-06 must recognize `mode=eval-sweep` and route to gold-set sweep instead of normal retrieval. Execute-time check: read 60-06 SUMMARY (when available) to confirm signature; if 60-03 ships a separate eval-runner Fn instead, change the URL to that Fn's path. The default above is the planner's best inference from 60-03 outline ("CI workflow eval-phase60.yml… emits $ai_evaluation events"); the runtime contract is that `phase60_eval_nightly` invokes the project's nightly gold-set sweep ONCE.

    Migration file structure (mirror `20280401000005_ad_revenue_etl_cron_rpc.sql` structure verbatim — only the job count, URLs, schedules, and jobnames differ):

    ```sql
    -- Phase 60 Plan 15 — pg_cron schedules for the 7 Phase 60 jobs.
    -- STRICT ordering rule: this migration is pushed ONLY after `supabase functions deploy`
    -- of all 10 Phase 60 Fns succeeds (per [[feedback_fn_deploy_before_cron_db_push]]).
    --
    -- Cron pattern mirrors 20280401000005_ad_revenue_etl_cron_rpc.sql:
    --   vault.decrypted_secrets service_role bearer + hardcoded project URL.
    --   Each cron.schedule body uses $cron$...$cron$ named dollar-quote tag
    --   to avoid nesting collision with any inner DO/DECLARE blocks
    --   (per [[reference_postgres_dollar_quote_nesting_in_cron_body]]).
    --
    -- Project ref: ytnsipxxmzgaebkqmokp.

    begin;

    -- Idempotent pre-unschedule for safe re-run.
    select cron.unschedule('phase60_federated_pubmed_sync')
      where exists (select 1 from cron.job where jobname = 'phase60_federated_pubmed_sync');
    -- ... repeat for all 7 jobnames ...

    -- phase60_federated_pubmed_sync — daily 03:00 UTC
    select cron.schedule(
      'phase60_federated_pubmed_sync',
      '0 3 * * *',
      $cron$SELECT net.http_post(
        url := 'https://ytnsipxxmzgaebkqmokp.supabase.co/functions/v1/rag-federated-pubmed',
        headers := jsonb_build_object(
          'Content-Type',  'application/json',
          'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1)
        ),
        body := '{}'::jsonb
      );$cron$
    );

    -- ... 6 more cron.schedule blocks following the same template ...

    commit;
    ```

    Anti-patterns to avoid (silent failures):
    - Do NOT include a comment string containing the literal text `staff_users` or any other rejected-alternative name per `[[feedback_negation_grep_defeated_by_comment_string]]`. Comments documenting "this uses vault, not GUC" are FINE because no future grep will negation-match against `current_setting`; reject-alt naming only matters when downstream gates grep for absence of a rejected pattern.
    - Do NOT inline the service-role JWT as a string literal (would leak via `pg_stat_statements` and CLI push logs).
    - Do NOT call `cron.schedule` outside the `begin; ... commit;` block (partial failure leaves orphan jobs).

    After writing the file: `git add` it but do NOT commit yet — Task 6's push must succeed first.
  </action>
  <verify>
    <automated>cd /Users/karstenhaldan/minisite/leanshot &amp;&amp; CRON_FILE=$(ls ../supabase/migrations/*phase60_cron_schedules.sql 2&gt;/dev/null | tail -1) &amp;&amp; test -n "$CRON_FILE" &amp;&amp; grep -c "cron.schedule" "$CRON_FILE" | grep -q '^7$' &amp;&amp; grep -c "phase60_" "$CRON_FILE" | grep -q -E '^(14|15|21)$' &amp;&amp; grep -q "vault.decrypted_secrets" "$CRON_FILE" &amp;&amp; grep -q '\$cron\$' "$CRON_FILE" &amp;&amp; ! grep -E "current_setting\('app\.service" "$CRON_FILE" &amp;&amp; echo "CRON-MIGRATION-OK"</automated>
  </verify>
  <done>Migration file at supabase/migrations/{20281201000099|20280501000099}_phase60_cron_schedules.sql contains exactly 7 `cron.schedule` calls, each prefixed `phase60_`, each using vault.decrypted_secrets + $cron$ named dollar-quote tag; zero `current_setting('app.service` references; CRON-MIGRATION-OK printed.</done>
</task>

<task type="auto">
  <name>Task 6: `supabase db push --linked` + verify cron registration via cron.job query</name>
  <files>(no source files modified; pushes Task 5's migration to remote)</files>
  <action>
    From `leanshot/` (verified pwd), run:
    ```
    supabase db push --linked 2>&1 | tee /tmp/phase60-db-push.log
    ```

    Expected: CLI lists 1 pending migration (Task 5's cron file) and applies it cleanly. Exit 0.

    Failure modes + recovery:
    - **"migration X is back-dated"** → Task 1 step (e) was supposed to catch this. If it slipped through, follow `[[reference_supabase_back_dated_migration_blocks_push]]`: `mv ../supabase/migrations/<file> /tmp/`, `supabase db push --linked` (pushes any other pending), then rename + restore to `/Users/karstenhaldan/minisite/supabase/migrations/20280501000099_phase60_cron_schedules.sql` and re-push.
    - **"function net.http_post does not exist"** → `pg_net` extension is not enabled on this project. Add `create extension if not exists pg_net;` to the migration top + re-push. (Phase 56 cron migration already enabled it; should be present.)
    - **"function cron.schedule does not exist"** → `pg_cron` extension not enabled. Add `create extension if not exists pg_cron;` similarly. (Should already be present from Phase 50.)

    After push succeeds, verify the 7 cron jobs registered correctly:
    ```
    supabase db remote sql --linked "select jobname, schedule, command from cron.job where jobname like 'phase60_%' order by jobname;" 2>&1 | tee /tmp/phase60-cron-jobs.txt
    ```

    Expected: 7 rows, each with the correct schedule + a command body containing the matching Fn URL. If the count is not 7, halt and inspect — do NOT mark the phase complete.

    If `supabase db remote sql` is not available in the operator's CLI version, fall back to running the same query via the Supabase Dashboard SQL editor and pasting the output into `/tmp/phase60-cron-jobs.txt` manually.
  </action>
  <verify>
    <automated>grep -E '(Applying migration|Finished|migration applied)' /tmp/phase60-db-push.log &gt;/dev/null &amp;&amp; grep -c "phase60_" /tmp/phase60-cron-jobs.txt | awk '$1 &gt;= 7 { print "CRON-7-OK"; exit 0 } { exit 1 }'</automated>
  </verify>
  <done>`supabase db push --linked` exits 0, applies the Phase 60 cron migration; subsequent `cron.job WHERE jobname like 'phase60_%'` query returns 7 rows matching the table in Task 5; CRON-7-OK printed; both /tmp logs captured for Task 7 evidence artifact.</done>
</task>

<task type="auto">
  <name>Task 7: Write 60-DEPLOY-EVIDENCE.md + toggle ROADMAP Phase 60 to [x]</name>
  <files>
    .planning/phases/60-rag-knowledge-base-completion-waves-2-4/60-DEPLOY-EVIDENCE.md,
    .planning/ROADMAP.md
  </files>
  <action>
    Part A — write `60-DEPLOY-EVIDENCE.md` capturing the deploy audit trail. Content template (fill in real values from the /tmp logs):

    ```markdown
    # Phase 60 — Deploy Evidence (Plan 60-15)

    **Date:** {ISO timestamp from /tmp/phase60-deploy.log header}
    **Operator:** {operator handle / "karsten.haldan@gmail.com"}
    **Project ref:** ytnsipxxmzgaebkqmokp

    ## Step 1 — Vault verification (Task 2)
    - `service_role_key`: OK (length {N})
    - `slack_guardrail_webhook`: {OK (length N) | degraded-no-slack}

    ## Step 2 — Edge Functions deployed (Task 3)
    All 10 Phase 60 Fns deployed atomically via single `supabase functions deploy` invocation:
    {paste the 10 "Deployed Function ..." lines from /tmp/phase60-deploy.log}

    ## Step 3 — Functions visible on project (Task 4)
    {paste the 9 matching rows from /tmp/phase60-functions-list.txt}

    ## Step 4 — Cron migration applied (Task 6)
    Migration: `supabase/migrations/{20281201000099|20280501000099}_phase60_cron_schedules.sql`
    Push log excerpt: {paste "Applying migration..." + "Finished" lines from /tmp/phase60-db-push.log}

    ## Step 5 — Cron jobs registered (Task 6)
    {paste the 7 rows from /tmp/phase60-cron-jobs.txt}

    ## Verification matrix
    | Check                                          | Expected | Actual |
    |------------------------------------------------|----------|--------|
    | Functions deployed                             | 9        | {N}    |
    | Functions in `supabase functions list`         | 9        | {N}    |
    | Cron migration applied                         | 1        | {N}    |
    | Cron jobs registered (phase60_*)               | 7        | {N}    |
    | Vault `service_role_key` present               | yes      | {y/n}  |

    ## Carry-over to Phase 70 (milestone UAT)
    - First federated sync runs at 03:00 UTC the day AFTER deploy; verify rows land in `federated_source_cache`.
    - First tip-of-day run at 00:00 UTC the day AFTER deploy; verify a row lands in `kb_tip_of_day` for tomorrow's date.
    - First newsletter send Sunday 13:00 UTC (next Sunday after deploy); verify Resend API webhook fires.
    - Nightly eval first run at 02:00 UTC the day AFTER deploy; verify `$ai_evaluation` events land in PostHog.
    - PostHog dashboard "RAG Phase 60" populated within 24h.
    ```

    Part B — toggle ROADMAP.md per `[[feedback_roadmap_format_variance_close_out_check]]`. Phase 60 currently uses the `**Plans**: TBD` format (verified at planning time — Phase 60 has NO per-plan checkbox bullets, only the summary line at ROADMAP.md:20 and the detail block at ROADMAP.md:260+).

    Step 1 — verify format with grep BEFORE editing (do NOT use `sed -i ''` blindly):
    ```
    grep -n "Phase 60: RAG Knowledge Base Completion" .planning/ROADMAP.md
    ```
    Expected: at least one match line containing `- [ ] **Phase 60: RAG Knowledge Base Completion**` near line 20.

    Step 2 — flip the summary checkbox at line 20 (or wherever grep found it). Use the Edit tool with the exact existing string as `old_string` and the same string with `- [ ]` → `- [x]` as `new_string`.

    Step 3 — update the `**Plans**: TBD` line inside the Phase 60 detail block (around line 274). Replace:
    ```
    **Plans**: TBD
    ```
    with:
    ```
    **Plans**: 15 plans (all complete — see `.planning/phases/60-rag-knowledge-base-completion-waves-2-4/`)
    ```

    Step 4 — verify the toggle landed:
    ```
    grep -c "^- \[x\] \*\*Phase 60: RAG" .planning/ROADMAP.md
    ```
    Expected: exactly 1.

    Do NOT touch any other Phase entries; the close-out is scoped to Phase 60 only.

    Part C — single phase-close commit:
    ```
    cd /Users/karstenhaldan/minisite
    git add supabase/migrations/*phase60_cron_schedules.sql \
            leanshot/.planning/phases/60-rag-knowledge-base-completion-waves-2-4/60-DEPLOY-EVIDENCE.md \
            leanshot/.planning/ROADMAP.md
    git commit -m "docs(60): close-out — 10 Fns deployed, 7 phase60_* cron jobs registered, ROADMAP toggled

    Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
    ```

    Per `[[feedback_worktree_executor_pwd_drift_leaks_to_main]]`: this plan is `autonomous: false` and runs on `main` directly (per STATE.md "sequential-on-main per execution lesson"). No worktree dance needed; commit lands on main as intended.
  </action>
  <verify>
    <automated>cd /Users/karstenhaldan/minisite/leanshot &amp;&amp; test -f .planning/phases/60-rag-knowledge-base-completion-waves-2-4/60-DEPLOY-EVIDENCE.md &amp;&amp; grep -q "Functions deployed" .planning/phases/60-rag-knowledge-base-completion-waves-2-4/60-DEPLOY-EVIDENCE.md &amp;&amp; grep -c "^- \[x\] \*\*Phase 60: RAG" .planning/ROADMAP.md | grep -q '^1$' &amp;&amp; ! grep -q "\*\*Plans\*\*: TBD" .planning/ROADMAP.md | head -1 &amp;&amp; echo CLOSEOUT-OK</automated>
  </verify>
  <done>60-DEPLOY-EVIDENCE.md exists and references all 5 verification steps; ROADMAP.md Phase 60 summary line is `- [x]`; `**Plans**: TBD` replaced; single close-out commit lands on `main`; CLOSEOUT-OK printed.</done>
</task>

</tasks>

<threat_model>

## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| operator-CLI → Supabase project API | Operator's `SUPABASE_ACCESS_TOKEN` authenticates `supabase functions deploy` + `supabase db push --linked`; tampered token = unauthorized deploy. |
| pg_cron worker → Edge Fn | `net.http_post` from cron worker carries `service_role_key` bearer; intercepted bearer = full DB write impersonation. |
| vault.decrypted_secrets → cron body | Read of service_role_key; row-level access to vault is gated by Postgres role permissions. |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-60-15-01 | Tampering | cron migration body — dollar-quote nesting collision | mitigate | Use `$cron$...$cron$` named tag per `[[reference_postgres_dollar_quote_nesting_in_cron_body]]`; Task 5 verify gate greps for `\$cron\$` presence and rejects bare `$$` inside `cron.schedule`. |
| T-60-15-02 | Information Disclosure | service_role_key leak via push logs | mitigate | Bearer minted at-runtime via `vault.decrypted_secrets` subquery; literal JWT never appears in migration file. Task 5 verify gate negates pattern `current_setting('app.service` AND would reject any inline `eyJ...` JWT (operator-spot-check at PR review). |
| T-60-15-03 | Tampering / DoS | cron fires to non-existent Fn endpoint (deploy-skew) | mitigate | Strict ordering: Task 3 deploys ALL 10 Fns before Task 5 writes migration; Task 4 verifies via `functions list` BEFORE Task 6 pushes. Per `[[feedback_fn_deploy_before_cron_db_push]]`. |
| T-60-15-04 | Tampering | back-dated migration blocks Phase 60 + later push | mitigate | Task 1 step (e) captures remote-max migration timestamp; Task 5 selects in-place vs forward-dated rescue path BEFORE writing the file. Per `[[reference_supabase_back_dated_migration_blocks_push]]`. |
| T-60-15-05 | Repudiation | no audit trail of when/who deployed which Fn | mitigate | 60-DEPLOY-EVIDENCE.md captures operator handle, ISO timestamp, 10-Fn deploy log, 7-cron registration log, db push log. Single commit on main with co-author trailer. |
| T-60-15-06 | Spoofing | wrong project ref deploys Fns to attacker-controlled project | accept | Hardcoded `ytnsipxxmzgaebkqmokp` from `.planning/PROJECT.md:22` (project-wide canonical); typo would fail at first `supabase functions deploy` invocation (project doesn't exist or operator lacks access). Operator typos are non-silent. |
| T-60-15-07 | Elevation of Privilege | cron worker runs as superuser-equivalent, can hit any Fn | accept | pg_cron is project-wide DB-level; Phase 60 jobs use a phase60_ prefix so future tooling can audit & revoke specifically. Phase 67 OPS-08 may add per-job role isolation if cron-scope CVE drops. |
| T-60-15-SC | Tampering | npm/pip/cargo install in deploy step | n/a (no package installs) | Task 3 invokes `supabase functions deploy` only; no package manager runs. Supply-chain risk lives in upstream plans (60-04..14) that authored the Fn source code; their own threat models cover it. |

</threat_model>

<verification>

Phase-level checks this plan completes:

1. **All 10 Phase 60 Edge Functions deployed atomically and observable on project `ytnsipxxmzgaebkqmokp`** (Tasks 3-4).
2. **7 pg_cron jobs registered with `jobname like 'phase60_%'`** after Fns are live, in strict ordering per `[[feedback_fn_deploy_before_cron_db_push]]` (Tasks 5-6).
3. **Cron bodies use vault.decrypted_secrets + named dollar-quote tag** per `[[reference_supabase_pg_cron_vault_service_role_pattern]]` and `[[reference_postgres_dollar_quote_nesting_in_cron_body]]`.
4. **`supabase db push --linked` exits 0** with no back-dated-migration block (Task 1 pre-flight + Task 6).
5. **60-DEPLOY-EVIDENCE.md** records deploy timestamp, function names, cron jobnames, migration timestamp, push log excerpt (Task 7).
6. **ROADMAP.md Phase 60 toggled `[ ]` → `[x]`** and `**Plans**: TBD` updated to `15 plans (all complete)` (Task 7) — format-aware sed per `[[feedback_roadmap_format_variance_close_out_check]]`.

Carry-over to milestone UAT (Phase 70): first cron tick for each schedule is the day AFTER deploy; verify production data lands in `federated_source_cache`, `kb_tip_of_day`, Resend webhook, and PostHog `$ai_evaluation` events within 24h. This plan ships in "automated-verify-only" mode for the deploy itself; real-traffic verification is deferred to the Phase 70 milestone walkthrough per `[[feedback_hitl_walkthrough_deferred_when_fixtures_missing]]`.

</verification>

<success_criteria>

- `supabase functions list --project-ref ytnsipxxmzgaebkqmokp` includes all 9 names: `rag-summarize-and-chunk`, `rag-embed-approved`, `rag-retrieve`, `rag-federated-pubmed`, `rag-federated-fda`, `rag-federated-dailymed`, `rag-tip-of-day-generate`, `rag-newsletter-sender`, `rag-newsletter-unsubscribe-1click`.
- `select count(*) from cron.job where jobname like 'phase60_%'` returns exactly **7**.
- Each `phase60_*` cron job's `command` field references `https://ytnsipxxmzgaebkqmokp.supabase.co/functions/v1/` + the corresponding Fn name.
- Each `phase60_*` cron job's `command` field references `vault.decrypted_secrets` (NOT `current_setting('app.`).
- Migration file `supabase/migrations/{20281201000099|20280501000099}_phase60_cron_schedules.sql` exists, contains 7 `cron.schedule` calls, uses `$cron$...$cron$` named dollar-quote tags.
- `.planning/phases/60-rag-knowledge-base-completion-waves-2-4/60-DEPLOY-EVIDENCE.md` exists with all 5 verification sections filled.
- `.planning/ROADMAP.md` line ~20 reads `- [x] **Phase 60: RAG Knowledge Base Completion**` AND the Phase 60 detail block no longer contains `**Plans**: TBD`.
- A single close-out commit lands on `main` (NOT a worktree) authored by the operator with the Claude co-author trailer.

</success_criteria>

<output>
Create `.planning/phases/60-rag-knowledge-base-completion-waves-2-4/60-15-SUMMARY.md` when done. Summary must cite:
- The 10 Fn deploy log (Task 3) and `functions list` output (Task 4)
- The 7 registered cron jobnames + schedules (Task 6)
- The migration file's final path (in-place `20281201000099_` vs rescue-bumped `20280501000099_`)
- Carry-over notes for Phase 70 milestone UAT (first-tick verification)
</output>
