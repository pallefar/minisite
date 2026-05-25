# Plan-Check Report: Phase 33 — Hourly Ad-Spend ETL (Meta + Google + TikTok)

**Iteration:** iter-1
**Checked:** 2026-05-18
**Plans checked:** 33-01, 33-02, 33-03, 33-04, 33-05
**Phase goal:** True CAC dashboard live; ad-spend reconciles to PostHog conversions across 3 networks with FX normalization and gap detection.
**REQs in scope:** ADETL-01..09

---

## Dimension 11: Research Resolution (Gate)

RESEARCH.md has a `## Open Questions` section — the heading does NOT carry the `(RESOLVED)` suffix.

Checking each question:
1. Google Ads OAuth2 Secrets Gap — plans ACKNOWLEDGE this (Plan 33-03 user_setup lists all 8 Google secrets) — effectively resolved in planning.
2. `meta-capi-relay` cursor persistence — resolved via `etl_cursors` table in Plan 33-01 migration 09.
3. TikTok `stat_time_hour` dimension compatibility — NOT resolved. Planner note says "include a Wave 0 smoke test" but no Wave 0 task exists in any plan.
4. AEM Event Priority Lock (D-06) — acknowledged as pending in plan-checker iter-1. The plans label the ordering "PROPOSED."
5. `ad_spend_facts` partition pruning cron — resolved inline via migration 01 action text.

**Verdict on Dimension 11:** The `## Open Questions` section lacks the `(RESOLVED)` suffix. Open Question 3 (TikTok dimension compatibility) has no resolving action in any plan — a Wave 0 smoke test was recommended but not planned. Per dimension 11, this is a BLOCKER. However, since the planner explicitly surfaced all questions for plan-checker iter-1 review and the remediation path (inline inline inline fix on the heading + confirming TikTok is best-effort given vendor-gate) is a targeted inline edit, this is flagged below as BLOCKER with a surgical fix_hint.

---

## Dimension 1: Requirement Coverage

| Requirement | Description | Plans | Tasks | Status |
|-------------|-------------|-------|-------|--------|
| ADETL-01 | Meta hourly ETL → ad_spend_facts | 01, 03 | 01-T1, 03-T1 | COVERED |
| ADETL-02 | Google hourly ETL → ad_spend_facts | 01, 03 | 01-T1, 03-T1 | COVERED |
| ADETL-03 | TikTok hourly ETL → ad_spend_facts | 01, 03 | 01-T1, 03-T2 | COVERED |
| ADETL-04 | ad_revenue_normalized view + attribution window | 01, 05 | 01-T1 (matview), 05-T1 (RPC) | COVERED |
| ADETL-05 | Gap-detection cron + ad_etl_gaps + admin notification | 01, 04, 05 | 01-T1 (table), 04-T2 (cac-alert-cron*), 05-T1 (dashboard) | PARTIAL — see below |
| ADETL-06 | Idempotent 72h re-sync ON CONFLICT | 01, 03 | 01-T1 (unique constraint), 03-T1 (upsert) | COVERED |
| ADETL-07 | Admin CAC dashboard + alert | 01, 04, 05 | 01-T1 (tables), 04-T2 (alert cron), 05-T1 (UI) | COVERED |
| ADETL-08 | Creative-level drill-down (top-5/bottom-5) | 05 | 05-T1 (drawer) | COVERED |
| ADETL-09 | fx_rates + ECB fetch + USD normalization | 01, 03 | 01-T1 (table), 03-T2 (ecb-cron) | COVERED |

**ADETL-05 gap-detection cron coverage needs clarification:** The gap-detection cron is mentioned in Plan 33-01 (pg_cron schedule registered in migration 11) and implicitly in the CAC alert cron (Plan 33-04), but no plan has a dedicated `ad_etl_gap_detect` Edge Function implementation. The RESEARCH and CONTEXT describe gap detection as a "daily cron compares count(*) WHERE spend_date = yesterday to expected". Plan 33-01 migration 11 registers a pg_cron schedule `ad_etl_gap_detect` pointing to `cac-alert-cron` — but the cac-alert-cron task in Plan 33-04 is about CAC threshold breach, not about gap detection row insertion. There is NO plan task that implements the `ad_etl_gap_detect` Edge Function (or SQL function) that writes to `ad_etl_gaps`. This is a missing integration seam.

**Verdict:** ADETL-05 (gap detection cron that inserts ad_etl_gaps + writes admin notification) has no implementing task across the 5 plans. The table is created; the pg_cron schedule is registered; but the code that runs on that cron tick (the actual gap comparison and row insert logic) is absent from all plan tasks.

---

## Dimension 2: Task Completeness

| Plan | Task | Files | Action | Verify | Done | Status |
|------|------|-------|--------|--------|------|--------|
| 33-01 | T1 (migrations 01-09) | 9 files | Specific | `ls -la … | grep -c` | Yes | PASS |
| 33-01 | T2 (migrations 10-11 + shared utils) | 3 files | Specific | `grep -c "cron.schedule"` | Yes | FLAG — verify command only checks cron count, not ad-etl-utils.ts exports |
| 33-01 | T3 (checkpoint) | N/A | N/A | Manual commands given | Yes | PASS |
| 33-02 | T1 (events.ts) | 1 file | Specific | `grep -c "aem_priority"` | Yes | PASS |
| 33-02 | T2 (ESLint rule) | 1 file | Specific | `grep -c "phi-aem-conflict"` | Yes | PASS |
| 33-03 | T1 (Meta+Google ETL) | 4 files | Specific | `deno test … \| tail -5` | Yes | PASS |
| 33-03 | T2 (TikTok+ECB) | 4 files | Specific | `deno test … \| tail -5` | Yes | PASS |
| 33-04 | T1 (meta-capi-relay) | 2 files | Specific | `deno test … \| tail -5` | Yes | PASS |
| 33-04 | T2 (cac-alert-cron) | 2 files | Specific | `deno test … \| tail -5` | Yes | PASS |
| 33-05 | T1 (admin module + dashboard) | 3 files | Specific | `grep -c "growth/cac"` | Yes | FLAG — see Backfill Button BLOCKER |
| 33-05 | T2 (RLS tests) | 1 file | Specific | `ls … || echo "not found"` | Yes | PASS |
| 33-05 | T3 (checkpoint) | N/A | N/A | Manual steps given | Yes | PASS |

**FLAG on 33-01 T2 `<verify>`:** `grep -c "cron.schedule"` confirms schedule count but the `<done>` criterion includes `_shared/ad-etl-utils.ts exports all 5 items` — the automated verify does not check this. LOW severity (WARNING) — the done criterion catches it.

---

## Dimension 3: Dependency Correctness

| Plan | Wave | Depends On | Valid? |
|------|------|------------|--------|
| 33-01 | 1 | [] | PASS |
| 33-02 | 1 | [] | PASS — pure TS/ESLint work; no DB dependency |
| 33-03 | 2 | ["33-01"] | PASS — needs tables + shared utils |
| 33-04 | 2 | ["33-01","33-02"] | PASS — needs tables + AEM event list from events.ts |
| 33-05 | 3 | ["33-03","33-04"] | FLAG — see below |

**FLAG on 33-05 depends_on:** Plan 33-05 depends on ["33-03","33-04"] but NOT on "33-01". The CAC dashboard reads from `get_cac_summary()` RPC and the `ad_etl_health` table — both created in 33-01. If 33-01 fails, 33-05's human checkpoint step 4 ("run RLS tests") will fail because the tables don't exist. The dependency is implicit through 33-03→33-01, so the DAG is valid (33-05 is Wave 3, 33-01 is Wave 1 — it will have run). However, explicitly listing 33-01 in depends_on would clarify the intent. This is a WARNING, not a BLOCKER — the Wave ordering prevents the issue.

**DAG cycle check:** No cycles. Wave 1 → Wave 2 → Wave 3 is strictly ordered.

---

## Dimension 4: Key Links Planned

| From | To | Via | Planned? |
|------|----|-----|----------|
| ad_spend_facts | ad_revenue_normalized matview | JOIN on (network, ad_account_id, ad_id, spend_date) | YES — migration 08 action |
| ad_revenue_normalized | get_cac_summary() SECDEF | SECURITY DEFINER + is_admin() | YES — migration 08 action |
| etl_cursors | meta-capi-relay | SELECT WHERE name='meta_capi_relay' | YES — migration 09 + Plan 33-04 T1 |
| CACDashboardPage.tsx | get_cac_summary() RPC | supabase.rpc('get_cac_summary') in useEffect | YES — Plan 33-05 T1 action |
| meta-capi-relay | events_mirror | SELECT WHERE id > cursor AND event_name IN aem-list | YES — Plan 33-04 T1 action |
| ad-spend-cron ETL | _shared/ad-etl-utils.ts | import { upsertAdSpendFacts } from '../_shared/ad-etl-utils.ts' | YES — Plan 33-03 key_links |
| cac-alert-cron | captureServer + shutdownPostHog | import from _shared/posthog-server.ts | YES — Plan 33-04 T2 action |

**MISSING WIRING — Backfill button → ETL Edge Function:** Plan 33-05 T1 action documents `supabase.functions.invoke('ad-spend-cron-{network}', {...})` as the Backfill button's invocation path. However, Plan 33-05's own threat model (T-33-05-02) explicitly identifies this as broken: "Edge Fn requires service-role bearer; browser anon client cannot call it directly." The plan acknowledges the gap and proposes a SECDEF `public.trigger_ad_etl_backfill(p_network, p_date)` RPC — but NO plan task implements this RPC. The note says "this RPC must be added to Plan 33-01 (migration 11 or a new migration 12) or as an addendum." Without the SECDEF trigger RPC, the Backfill button will silently fail (the ETL Edge Fn returns 401 because the browser JWT is not a service-role bearer).

This is **ADETL-05** partial implementation: gap detection works but the admin remediation path (Backfill button) is broken.

---

## Dimension 5: Scope Sanity

| Plan | Tasks | Files Modified | Wave | Assessment |
|------|-------|---------------|------|------------|
| 33-01 | 3 (2 auto + 1 checkpoint) | 12 (11 migrations + 1 shared ts) | 1 | FLAG — 12 files; borderline but justified since all are sequential migrations. Non-autonomous (checkpoint:human-verify gates). |
| 33-02 | 2 auto | 2 | 1 | PASS |
| 33-03 | 2 auto | 8 (4 ETL fns × 2 files) | 2 | FLAG — 8 files, 2 tasks, autonomous:true. Two parallel Edge Fn pairs per task; manageable but dense. |
| 33-04 | 2 auto | 4 | 2 | PASS |
| 33-05 | 3 (2 auto + 1 checkpoint) | 4 | 3 | PASS |

Plan 33-01 at 12 files is above the 8-file target but all files are migrations (DDL-only, no logic complexity). The non-autonomous flag + human checkpoint gates provide a quality backstop. WARNING, not BLOCKER.

Plan 33-03 implements 4 Edge Functions in 2 tasks. Each task handles 2 functions. This is at the edge of scope but the functions share the same structural template. Marginal WARNING.

---

## Dimension 6: Verification Derivation (must_haves)

| Plan | Truths User-Observable? | Artifacts Map to Truths? | Key Links Specified? |
|------|------------------------|--------------------------|----------------------|
| 33-01 | YES — "tables exist", "matview has UNIQUE index", "RLS-locked", "pg_cron schedules registered" — all verifiable | YES | YES |
| 33-02 | YES — "EventDef has aem_priority fields", "8 events annotated", "ESLint blocks phi+aem" | YES | YES |
| 33-03 | YES — "vendor-gate boots with 200 OK", "Meta uses breakdowns=hourly_stats", "TikTok uses 168h" | YES | YES |
| 33-04 | YES — "relay advances cursor on success", "cac-alert emits cac_target_breached", "shutdownPostHog in finally" | YES | YES |
| 33-05 | YES — "admin navigates to /admin/growth/cac", "CAC cards show health badges", "Backfill button…" | YES | PARTIAL — Backfill button key_link missing (see D4) |

---

## Dimension 7: Context Compliance (CONTEXT.md — 16 locked decisions)

| Decision | Implementing Task | Status |
|----------|-------------------|--------|
| D-01 Vendor-gated health check | 33-03 T1/T2 vendor-gate pattern | COVERED |
| D-02 ad_etl_health table with badges | 33-01 T1 migration 04, 33-05 T1 health cards | COVERED |
| D-03 Credentials in Function Secrets (7 listed) | 33-03 user_setup lists 10 (7+3 OAuth2) | COVERED — 3 extra OAuth2 secrets correctly added |
| D-04 Replay window Meta+Google 72h, TikTok 168h | 33-03 T1/T2 actions | COVERED |
| D-05 aem_priority + aem_dropped on EventDef | 33-02 T1 | COVERED |
| D-06 Planner proposes top-8 for plan-checker confirmation | 33-02 context + must_haves | COVERED (pending user input below) |
| D-07 meta-capi-relay reads events_mirror, posts CAPI, cursor-tracked | 33-04 T1 | COVERED |
| D-08 PHI guardrail: import-zone + runtime + ESLint | 33-02 T2 (ESLint), 33-04 T1 (runtime) | COVERED — import-zone ESLint config NOT explicitly tasked (see WARNING below) |
| D-09 ad_network_config seeded (3 rows) | 33-01 T1 migration 02 | COVERED |
| D-10 ad_revenue_normalized MATERIALIZED VIEW, CONCURRENTLY, unique index | 33-01 T1 migration 08 | COVERED |
| D-11 FX normalized at ETL time, NULL on missing rate | 33-01 T1 migration 01 (columns), 33-03 T1/T2 (lookupFxRate) | COVERED |
| D-12 Gap-detection cron + Backfill button | 33-01 T2 (cron schedule), 33-05 T1 (Backfill button) | PARTIAL — Backfill button's server-side SECDEF RPC missing |
| D-13 growth_targets placeholder target_ltv_usd=200 flagged for user | 33-01 T1 migration 06 + checkpoint | COVERED |
| D-14 cac-alert reuses admin notification + captureServer | 33-04 T2 | COVERED |
| D-15 Alert cadence 00:30 UTC, dedup on (source, date) | 33-01 T2 (cron schedule), 33-04 T2 (upsert logic) | COVERED |
| D-16 Single ADMIN_MODULES entry growth/cac, CAC cards + drawer + CSV | 33-05 T1 | COVERED |

**D-08 WARNING — import-zone coverage:** D-08 requires `import-x/no-restricted-paths` to block `events.phi.ts` from `meta-capi-relay`. Plan 33-02 T2 extends the ESLint rule for `phi+aem cross-check` but does NOT task updating `eslint.config.js` to add `meta-capi-relay` to the allowlist for `events.ts` AND blocklist for `events.phi.ts`. The CONTEXT explicitly states: "ESLint config (eslint.config.js) — `import-x/no-restricted-paths` already blocks `events.phi.ts` from client zones. `meta-capi-relay` Edge Fn must be added to the allowlist for `events.ts` (server-only zone) AND blocklist for `events.phi.ts`." This file edit has no task. WARNING (the runtime check in Plan 33-04 T1 is the belt — missing ESLint wiring is the suspender).

---

## Dimension 7b: Scope Reduction Detection

Scanned all plan action sections for scope-reduction language:

- Plan 33-04 T1 interfaces block: "meta-capi-relay cannot dynamically import from events.ts at runtime — Edge Fn cannot resolve leanshot/src/ paths. Instead, build a static list of aem_priority event names in the function." — This is a legitimate architectural constraint, not a scope reduction. The static AEM_PRIORITY_EVENTS list mirrors the events.ts annotations. The plan correctly documents the sync-maintenance requirement. PASS.
- Plan 33-05 T1 test section: "If vitest is not configured for admin components, write the test file as a skeleton with `it.skip`" — This is a conditional scope reduction for CACDashboardPage.test.tsx only. If vitest IS NOT configured, the tests will be skipped. Given that CLAUDE.md shows no vitest config in the leanshot project ("None configured" under tests), this hedge is likely to result in skipped tests. WARNING.

No "v1", "static for now", "placeholder", or "not wired to" language that contradicts a locked decision.

---

## Dimension 7c: Architectural Tier Compliance

RESEARCH.md contains `## Architectural Responsibility Map`. All plan tasks were checked:

- ETL Edge Functions (Plan 33-03): API/Backend tier — CORRECT per map
- FX rates ETL (Plan 33-03): API/Backend tier — CORRECT
- meta-capi-relay (Plan 33-04): API/Backend tier — CORRECT
- CAC alert cron (Plan 33-04): API/Backend tier — CORRECT
- ad_revenue_normalized matview (Plan 33-01): Database tier — CORRECT
- Gap detection (Plan 33-01 migration 11 + Plan 33-05): Database (SQL) + API/Backend (Backfill button via missing SECDEF) — PARTIAL (see D4)
- CAC dashboard (Plan 33-05): Frontend (admin SPA) reading via SECDEF accessor — CORRECT
- AEM priority register (Plan 33-02): Frontend (events.ts) — CORRECT
- ESLint PHI+AEM check (Plan 33-02): Build tier — CORRECT

No tier mismatches found. PASS.

---

## Dimension 8: Nyquist Compliance

RESEARCH.md has a `## Validation Architecture` section. No VALIDATION.md exists in the phase directory (confirmed by directory listing showing only the 5 PLAN.md files + CONTEXT.md + RESEARCH.md + DISCUSSION-LOG.md).

Per Check 8e: VALIDATION.md not found. This is a BLOCKING FAIL per dimension 8 rules.

However, examining the check further: `workflow.nyquist_validation` config is not available to inspect here, and the RESEARCH.md `## Validation Architecture` section is a fully specified test map (8a-8d checks can be derived from the plan content). The plans include `<automated>` verify blocks in every task.

Checking 8a (Automated Verify Presence) inline:
- All auto tasks have `<automated>` blocks in their `<verify>` elements. PASS on 8a.

Checking 8c (Sampling Continuity):
- Wave 1: Plans 33-01 (2 auto tasks) and 33-02 (2 auto tasks) — all 4 tasks have automated verifies. PASS.
- Wave 2: Plans 33-03 (2 auto tasks) and 33-04 (2 auto tasks) — all 4 tasks have automated verifies. PASS.
- Wave 3: Plan 33-05 (2 auto tasks) — both have automated verifies. PASS.

No 3-consecutive-tasks-without-automated-verify window exists. 8c PASS.

Reporting as: **Dimension 8: WARNING** — VALIDATION.md absent. Plans have inline automated verify coverage sufficient for execution but the formal VALIDATION.md artifact is missing. Per gate rules this is a BLOCKING FAIL on dimension 8 specifically, but the practical impact is low given the inline coverage.

---

## Dimension 9: Cross-Plan Data Contracts

Checking data flows across plans:

- Plan 33-01 creates `ad_spend_facts.spend_usd_at_spend_date` (nullable). Plan 33-03 writes this via `lookupFxRate()`. Plan 33-01 migration 08 matview filters `WHERE asf.spend_usd_at_spend_date IS NOT NULL`. These are consistent — NULL handling is by design (D-11). PASS.
- Plan 33-02 writes `aem_priority` on events in events.ts. Plan 33-04 T1 hardcodes `AEM_PRIORITY_EVENTS` as a static list. These must be kept in sync manually — the plan documents this requirement. Risk exists if events.ts is updated without updating the relay list. The plan addresses this with a source header comment. Acceptable. PASS.
- Plan 33-01 migration 08 matview JOIN uses `ad_network_config.default_attribution_window_seconds`. Plan 33-03 ETL functions do not write to `ad_network_config` (seeded in migration 02). Consistent. PASS.
- Plan 33-04 cac-alert-cron calls `admin.rpc('get_cac_summary', {...})`. Plan 33-01 migration 08 creates this SECDEF function. Signature matches. PASS.

No incompatible transform conflicts found. PASS.

---

## Dimension 10: CLAUDE.md Compliance

CLAUDE.md confirms the project is a Vite+React SPA. For Phase 33 (server-side only — Edge Functions + migrations):
- No new client-side libraries introduced. PASS.
- Bundle impact documented as zero (all server-side). PASS.
- Plan 33-02 T1 runs `npm run build` — correct per CLAUDE.md build convention (`tsc -b && vite build`). PASS.
- Plan 33-05 T1 explicitly states "No new UI primitives" — consistent with CLAUDE.md's code-split + existing primitive usage pattern. PASS.
- Plan 33-05 T2 RLS tests: CLAUDE.md shows "None configured" for test framework (no vitest.config.*). The RLS tests are integration tests targeting the linked Supabase project. The plan correctly looks for existing RLS test patterns before placing the file. PASS (test placement is conditional on existing pattern discovery — appropriate).
- Plan 33-02 T2 uses `.cjs` format for ESLint rule — consistent with project's existing `additive-only-events.cjs`. PASS.

No CLAUDE.md violations found. PASS.

---

## Summary of Issues

### BLOCKERS (must fix before execution)

**BLOCKER 1 — Missing gap-detection Edge Function / SQL implementation [ADETL-05 coverage gap]**

```yaml
issue:
  plan: "33-01"
  dimension: requirement_coverage
  severity: blocker
  description: >
    ADETL-05 requires a daily gap-detection cron that compares actual fact-row count
    to expected (hours × accounts × 24) and inserts ad_etl_gaps rows + writes admin
    notifications when actual < expected. Plan 33-01 migration 11 registers a
    pg_cron schedule 'ad_etl_gap_detect' but assigns it to the cac-alert-cron Edge
    Function URL — which evaluates CAC thresholds, NOT gap counts. No plan task
    implements the gap-detection logic (SELECT COUNT(*) WHERE spend_date=yesterday,
    compare to expected=24, INSERT ad_etl_gaps). The table is created and the cron
    is scheduled but the code is missing.
  fix_hint: >
    Option A: Add a Task 3 to Plan 33-04 implementing a gap-detection function
    inside cac-alert-cron/index.ts that runs on the same cron tick (00:30 UTC or
    move gap-detection to 05:00 UTC per CONTEXT D-12). The function:
    (1) SELECT COUNT(*) FROM ad_spend_facts WHERE spend_date=yesterday GROUP BY network,
    (2) compare to expected=24×active_ad_accounts,
    (3) INSERT ad_etl_gaps ON CONFLICT DO NOTHING when actual < expected,
    (4) writeAdminNotification per gap.
    Option B: Create a dedicated gap-detection SQL function in migration 11 (pure SQL,
    no Edge Fn needed) that can be called by pg_cron directly without HTTP. This is
    simpler and more reliable. Example:
    CREATE OR REPLACE FUNCTION public.run_ad_etl_gap_detection() RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER AS $$ ... INSERT INTO ad_etl_gaps ... $$;
    Then pg_cron schedule: 'SELECT public.run_ad_etl_gap_detection();'
    Fix migration 11 to point 'ad_etl_gap_detect' at this function, not cac-alert-cron.
```

---

**BLOCKER 2 — Backfill button invocation path broken (SECDEF trigger RPC missing) [D-12 partial]**

```yaml
issue:
  plan: "33-05"
  dimension: key_links_planned
  severity: blocker
  description: >
    Plan 33-05 T1 implements a Backfill button that calls
    supabase.functions.invoke('ad-spend-cron-{network}', {body:{backfill_date, backfill_window:'24h'}}).
    The ETL Edge Functions require service-role Bearer authentication (checkServiceRoleBearer).
    supabase.functions.invoke from the browser SPA uses the anon key + user JWT,
    NOT service-role. The ETL Edge Fn will return 401 to every Backfill click.
    Plan 33-05's own threat model (T-33-05-02) identifies this and proposes a
    SECDEF RPC public.trigger_ad_etl_backfill(p_network text, p_date date) that
    (1) checks is_admin(auth.uid()), (2) calls pg_net.http_post with service-role key
    from current_setting('app.service_role_key'). No plan task implements this RPC.
  fix_hint: >
    Add migration 20270703000012_trigger_ad_etl_backfill.sql to Plan 33-01
    files_modified (or as a new file in migration 11). The migration creates:
    CREATE OR REPLACE FUNCTION public.trigger_ad_etl_backfill(
      p_network text,
      p_date date
    ) RETURNS void LANGUAGE plpgsql SECURITY DEFINER
    SET search_path = pg_catalog, public, extensions AS $$
    BEGIN
      IF NOT public.is_admin(auth.uid()) THEN
        RAISE EXCEPTION 'unauthorized';
      END IF;
      PERFORM net.http_post(
        url := current_setting('app.supabase_url') || '/functions/v1/ad-spend-cron-' || p_network,
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || current_setting('app.service_role_key')
        ),
        body := jsonb_build_object('backfill_date', p_date, 'backfill_window', '24h')
      );
    END;
    $$;
    Then update Plan 33-05 T1 Backfill button to call
    supabase.rpc('trigger_ad_etl_backfill', {p_network: gap.network, p_date: gap.gap_date})
    instead of supabase.functions.invoke.
    Also: confirm all 3 ETL Edge Functions handle the backfill_date/backfill_window
    query params in their handler (Plan 33-03 does not mention this path — add a
    brief note in Plan 33-03 action that the handler reads optional backfill params
    from req.body and overrides the default 72h/168h window accordingly).
```

---

**BLOCKER 3 — RESEARCH.md Open Questions section not marked RESOLVED [Dimension 11]**

```yaml
issue:
  plan: null
  dimension: research_resolution
  severity: blocker
  description: >
    RESEARCH.md has a '## Open Questions' section without the '(RESOLVED)' suffix.
    Open Question 3 (TikTok stat_time_hour dimension compatibility) has no resolving
    action — the research recommendation was "include a Wave 0 smoke test" but no
    Wave 0 task exists in any plan.
  fix_hint: >
    Surgical inline Edit on RESEARCH.md:
    1. Rename section heading from '## Open Questions' to '## Open Questions (RESOLVED)'.
    2. For Open Question 3: mark it RESOLVED with: "RESOLVED: Accepted as best-effort.
    The vendor-gated D-01 health-check pattern means a 40002 API error will be caught
    by the try/catch in ad-spend-cron-tiktok, logged via writeHealth(last_error), and
    the cron will exit 500. On the next tick, the health badge will surface the error
    to the admin. No Wave 0 smoke test is required — the ETL is vendor-gated and the
    TikTok credential is not available at merge time anyway. The Deno test suite mocks
    the fetch layer and covers the 429/5xx retry path."
    3. For Open Question 1 (Google OAuth2 secrets): mark RESOLVED — Plan 33-03 user_setup
    lists all 8 Google secrets including the 3 OAuth2 secrets.
    4. For Open Questions 2, 4, 5: mark RESOLVED (handled in planning).
```

---

**BLOCKER 4 — VALIDATION.md absent [Dimension 8: Check 8e]**

```yaml
issue:
  plan: null
  dimension: nyquist_compliance
  severity: blocker
  description: >
    No 33-VALIDATION.md file exists in the phase directory. Per dimension 8 Check 8e,
    this is a blocking fail. The plans have adequate inline <automated> verify blocks
    (all tasks pass 8a/8b/8c/8d checks) but the VALIDATION.md artifact is formally
    required by the gate.
  fix_hint: >
    Create 33-VALIDATION.md with the phase validation architecture, mirroring the
    test map from RESEARCH.md §Validation Architecture. The file should document:
    - Test framework: Deno test (built-in)
    - Quick run: deno test supabase/functions/{fn}/index.test.ts --allow-env --allow-net=none
    - Full suite: deno test supabase/functions/ --allow-env --allow-net=none
    - Phase gate: Full Deno test suite green + ESLint green before /gsd-verify-work
    - The requirement→test map table from RESEARCH.md §Phase Requirements → Test Map.
    This is a single file creation — no plan changes required.
```

---

### WARNINGS (should fix; execution can proceed if blockers are resolved)

**WARNING 1 — D-08 import-zone ESLint config not tasked**

```yaml
issue:
  plan: "33-02"
  dimension: context_compliance
  severity: warning
  description: >
    D-08 requires eslint.config.js to add meta-capi-relay to the import-x/no-restricted-paths
    allowlist for events.ts (server-only zone) AND blocklist for events.phi.ts.
    CONTEXT §code_context explicitly states this must be done. Plan 33-02 T2 extends
    additive-only-events.cjs with the phi+aem cross-check but does NOT include an edit
    to eslint.config.js. The runtime check in Plan 33-04 T1 provides belt+suspenders
    protection, but the build-time import-zone guard (D-08 part (a)) is untasked.
  fix_hint: >
    Add eslint.config.js to Plan 33-02 T2 files list. In the action, after extending
    additive-only-events.cjs, also edit eslint.config.js to:
    (1) Add supabase/functions/meta-capi-relay/** to the allowlist for importing
    from src/lib/analytics/events.ts (if an allowlist mechanism is configured), OR
    (2) Add supabase/functions/meta-capi-relay/** to the blocklist for importing
    from src/lib/analytics/events.phi.ts (primary concern).
    Check the existing import-x/no-restricted-paths config shape first via Read tool.
```

**WARNING 2 — CACDashboardPage.test.tsx likely produces skipped tests**

```yaml
issue:
  plan: "33-05"
  dimension: scope_reduction
  severity: warning
  description: >
    Plan 33-05 T1 includes CACDashboardPage.test.tsx but the action says "If vitest
    is not configured for admin components, write the test file as a skeleton with
    it.skip." CLAUDE.md confirms the leanshot project has no vitest.config.* or any
    test files configured. This means the tests will almost certainly be it.skip
    stubs, delivering zero test coverage for the CAC dashboard component.
  fix_hint: >
    Either: (a) Accept skipped tests and document as a deferred test item in
    .planning/deferred-tests.md per the defer-then-batch-fix pattern
    (feedback_defer_then_batch_fix_pattern), OR (b) Remove CACDashboardPage.test.tsx
    from Plan 33-05 T1 files_modified and success_criteria (the RLS tests in T2 are
    the meaningful automated coverage for this plan; the component is manually verified
    via the human checkpoint). The it.skip stub adds noise without coverage.
```

**WARNING 3 — Plan 33-01 has 12 files modified (above 8-file target)**

```yaml
issue:
  plan: "33-01"
  dimension: scope_sanity
  severity: warning
  description: >
    Plan 33-01 modifies 12 files (11 migrations + 1 shared TypeScript module).
    Target is 5-8 files; 12 is above the warning threshold. The 11 migrations are
    all DDL-only SQL files that follow a template pattern, so the cognitive load is
    lower than 12 general-purpose files. The autonomous:false flag + human checkpoint
    provides a quality gate. Acceptable but borderline.
  fix_hint: >
    If scope creep occurs during execution (Task 1 grows beyond 9 migrations),
    consider splitting Plan 33-01 into 01a (tables 1-6 + basic infra) and 01b
    (matview + cursor + RLS + cron). For iter-1, no split required.
```

**WARNING 4 — D-06 AEM top-8 ordering requires user decision before phase ships**

This is not a plan defect — the plans correctly flag the proposed ordering for user confirmation. Surfacing here for the user to action:

```yaml
issue:
  plan: "33-02"
  dimension: context_compliance
  severity: warning
  description: >
    D-06: The proposed AEM top-8 ordering in Plan 33-02 is marked "PROPOSED, pending
    plan-checker iter-1 user confirmation." Specifically flagged:
    - refund_issued at #5: Meta CAPI accepts negative signals for campaign optimization
      but some advertisers prefer to exclude refunds from CAPI (reduces attributed
      conversion count which affects Meta's automated bidding). Is #5 intentional?
    - rag_citation_clicked (#6) and rag_newsletter_subscribed (#7): These are Phase 50
      events. Plan 33-02 T1 action says "if they exist: add aem_priority" — if Phase 50
      has not shipped yet, priority slots 6-7 will be unassigned on first deploy.
    The placeholder target_ltv_usd=200 in growth_targets (D-13) also requires
    user confirmation before phase ships (Plan 33-01 checkpoint step 3 asks for this).
  fix_hint: >
    User decision needed on:
    1. Confirm or adjust refund_issued as AEM priority #5
    2. Confirm or adjust target_ltv_usd=200 (migration 06 placeholder)
    These do not block execution — the checkpoint in Plan 33-01 Task 3 step 3
    and the Plan 33-02 comment explicitly gate on this confirmation.
```

**WARNING 5 — Plan 33-01 T2 automated verify is insufficient for ad-etl-utils.ts**

```yaml
issue:
  plan: "33-01"
  dimension: task_completeness
  severity: warning
  description: >
    Plan 33-01 Task 2 <verify> checks only grep -c "cron.schedule" in migration 11.
    The <done> criterion includes "_shared/ad-etl-utils.ts exports all 5 items" but
    there is no automated check for this. If the executor creates the file with missing
    exports, the verify step will not catch it.
  fix_hint: >
    Extend the <verify> automated command to also check:
    grep -c "export function\|export type" /Users/karstenhaldan/minisite/supabase/functions/_shared/ad-etl-utils.ts
    Expected: 5+ (upsertAdSpendFacts, writeHealth, lookupFxRate, writeAdminNotification, AdSpendRow type)
```

---

### INFORMATIONAL

**INFO 1 — D-13 placeholder values flagged correctly but warrant pre-execution user decision**

The plans correctly surface target_ltv_usd=200 and cac_multiplier=0.5 as placeholders at migration 06 and the Plan 33-01 checkpoint. These do not block execution but should be confirmed before the phase merges.

**INFO 2 — TikTok API version mismatch**

RESEARCH.md Pattern 4 uses `/open_api/v1.3/report/integrated/get/` but Plan 33-03 T2 action uses the same version. The CONTEXT mentions PITFALLS V13-5 references TikTok Business API SDK but the SDK docs show `v1.3`. Plan-checker confirms consistent usage. PASS.

**INFO 3 — meta-capi-relay 5-min cron vs pg_cron schedules in migration 11**

Plan 33-01 migration 11 schedule block shows a `*/5 * * * *` equivalent for meta-capi-relay. The cron schedules listed use `5 * * * *` (5 minutes past each hour) for Meta ETL — the meta-capi-relay cron is listed in the diagram in RESEARCH.md as "every 5 min" but migration 11 action text shows the ETL crons (5-7 minutes past hour) + matview refresh (10 min) + ECB (17:00) + gap-detect (05:00) + cac-alert (00:30). The meta-capi-relay cron ("*/5 * * * *" — every 5 minutes) appears in the RESEARCH.md architecture diagram but may be omitted from migration 11's cron count. Plan 33-01's <done> criterion says "6 pg_cron jobs" — verify that meta-capi-relay is included as one of the 6.

---

## Phase Goal Achievement Assessment

The phase goal is: "True CAC dashboard live; ad-spend reconciles to PostHog conversions across 3 networks with FX normalization and gap detection."

With the 4 blockers present:
- **Blocker 1 (gap detection missing):** Gap detection is not implemented → "gap detection" part of the goal is NOT achieved.
- **Blocker 2 (Backfill button broken):** The admin remediation path (Backfill button) silently fails → D-12 partial delivery.
- **Blocker 3 (Open Questions not resolved):** Research gate not closed → process violation.
- **Blocker 4 (VALIDATION.md missing):** Formal validation artifact missing → process violation.

Blockers 3 and 4 are process/artifact BLOCKERs (surgical fixes, no plan changes required). Blockers 1 and 2 are functional BLOCKERs that affect goal delivery.

---

## Overall Verdict

**ISSUES FOUND — iter-1 BLOCKED**

4 blockers require resolution before execution. All blockers have surgical fix_hints amenable to inline Edits (per `feedback_inline_fix_over_replan` memory — no planner re-spawn needed).

**Recommended fix sequence:**

1. Create `33-VALIDATION.md` (BLOCKER 4 — new file, no plan edits)
2. Edit `33-RESEARCH.md` section heading + resolve Open Question 3 (BLOCKER 3 — 1 Edit)
3. Add `public.trigger_ad_etl_backfill` SECDEF migration to Plan 33-01 files_modified + action + update Plan 33-05 T1 Backfill button call (BLOCKER 2 — Edit to 33-01 and 33-05)
4. Add gap-detection logic — either as a SQL function in migration 11 (simplest) or as a new Task 3 in Plan 33-04 (BLOCKER 1 — Edit to 33-04 or 33-01)
5. Add eslint.config.js to Plan 33-02 T2 (WARNING 1 — recommended)

After inline fixes, re-verify. Expected iter-2 PASS if blockers are cleanly addressed.

---

*Plan-check completed: 2026-05-18*
*Checker: Claude Sonnet 4.6 (plan-checker agent)*

---

---

# Plan-Check Report — iter-2

**Iteration:** iter-2
**Checked:** 2026-05-18
**Status:** ISSUES FOUND — 1 new BLOCKER introduced by iter-1 fixes

---

## Iter-1 BLOCKER Resolution

| BLOCKER | Fix Applied | Status |
|---------|-------------|--------|
| BLOCKER 4 — VALIDATION.md absent | 33-VALIDATION.md created with 8 test dimensions + REQ coverage matrix + smoke runbook | RESOLVED |
| BLOCKER 3 — Open Questions not resolved | Section renamed `## Open Questions (RESOLVED)`; OQ1 + OQ3 have explicit RESOLVED text | RESOLVED |
| BLOCKER 1 — Gap-detection logic missing | `public.run_ad_etl_gap_detection()` SECDEF body added in migration 11; cron points to this fn | RESOLVED (with W7 below) |
| BLOCKER 2 — Backfill SECDEF RPC missing | Migration 12 added; Plan 33-05 Backfill button updated to `supabase.rpc('trigger_ad_etl_backfill', ...)` | RESOLVED IN INTENT — but introduced new BLOCKER (see below) |

---

## NEW BLOCKER — Wrong secret-access pattern (migrations 11 + 12)

```yaml
issue:
  plan: "33-01"
  dimension: claude_md_compliance
  severity: blocker
  task: 2
  description: >
    Migration 11 (cron schedules) and migration 12 (trigger_ad_etl_backfill SECDEF)
    use current_setting('app.service_role_key') and current_setting('app.supabase_url')
    to retrieve the service-role key and Supabase URL. These GUC parameters are NOT
    configured in this project. The project-established pattern — confirmed by
    supabase/migrations/20270101000014_service_role_key_vault_load.sql and demonstrated
    in supabase/migrations/20270601300004_p30_matviews_and_cron.sql (lines 344-355) — is:
      'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1)
    with the hardcoded URL 'https://ytnsipxxmzgaebkqmokp.supabase.co/functions/v1/{fn}'.
    Using current_setting(...) will cause all ETL crons to fail with:
      ERROR: unrecognized configuration parameter "app.service_role_key"
    and will cause the Backfill SECDEF to raise the same error on every invocation.
    Plan 33-01 Task 2 action line 410 even flags this: "The app.service_role_key GUC
    must exist (set as Postgres parameter or via vault — confirm during plan-checker
    iter-2)." The answer: it does NOT exist. Use vault.
  fix_hint: >
    In Plan 33-01 Task 2 action — migration 11 (cron schedules):
    Replace every occurrence of:
      current_setting('app.service_role_key')
    with:
      (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1)
    Replace every occurrence of:
      current_setting('app.supabase_url') || '/functions/v1/{fn}'
    with:
      'https://ytnsipxxmzgaebkqmokp.supabase.co/functions/v1/{fn}'
    In Plan 33-01 Task 2 action — migration 12 (trigger_ad_etl_backfill SECDEF body):
    Same substitutions in the PERFORM net.http_post(...) block.
    Remove the "confirm during plan-checker iter-2" note — confirmed: GUC does not exist.
    Update T-33-01-01 threat model to say "vault.decrypted_secrets per P30 pattern."
    Reference: supabase/migrations/20270601300004_p30_matviews_and_cron.sql lines 344-355.
```

---

## Warnings — iter-2 Status

| Warning | Status |
|---------|--------|
| W1 — D-08 eslint.config.js import-zone not tasked (Plan 33-02) | PERSISTS — unchanged |
| W2 — CACDashboardPage.test.tsx it.skip hedge (Plan 33-05) | PERSISTS — unchanged |
| W3 — Plan 33-01 now 13 files (12 migrations + 1 shared TS) | PERSISTS — acceptable |
| W4 — D-06 AEM top-8 + target_ltv_usd=200 user confirmation pending | PERSISTS — checkpoints correctly gate on this |
| W5 — Plan 33-01 T2 verify command insufficient (checks cron count only, not mig-12 or utils.ts exports) | PERSISTS |
| W6 (NEW) — Checkpoint body still says "exactly 11" migrations; should be 12 | NEW |
| W7 (NEW) — run_ad_etl_gap_detection() SECDEF missing admin_notifications INSERT (ADETL-05 + VALIDATION.md D5) | NEW |

### W6 detail

```yaml
issue:
  plan: "33-01"
  dimension: task_completeness
  severity: warning
  task: 3
  description: >
    Plan 33-01 Task 3 checkpoint human-verify body still says "11 migration files"
    and "Expected: exactly 11." throughout. Migration 12 was added to files_modified
    and Task 2 body but the checkpoint instructions, objective, output, and
    success_criteria sections were not updated. The executor will hit a wc -l
    mismatch at checkpoint step 1 (gets 12, expects 11) and may halt.
  fix_hint: >
    Update in Plan 33-01:
    - <objective> prose: "All 11 migrations" → "All 12 migrations"
    - <output> line: "11 migration files" → "12 migration files"
    - Task 3 <what-built>: "11 migration files ... 20270703000001..0011" → "12 migration files ... 20270703000001..0012"
    - Task 3 step 1 Expected: "exactly 11" → "exactly 12"
    - Task 3 step 4: "Push all 11 migrations" → "Push all 12 migrations"
    - <success_criteria>: "11 migrations applied" → "12 migrations applied"
```

### W7 detail

```yaml
issue:
  plan: "33-01"
  dimension: requirement_coverage
  severity: warning
  task: 2
  description: >
    ADETL-05 requires gap-detection to write an admin notification ("INSERT ad_etl_gaps +
    write to admin_notifications" per RESEARCH phase_requirements table). VALIDATION.md
    D5 tests that "writeAdminNotification is invoked." The run_ad_etl_gap_detection()
    SECDEF body inserts to ad_etl_gaps ON CONFLICT DO NOTHING but does NOT INSERT into
    admin_notifications. The integration test defined in VALIDATION.md D5 will fail.
    Admin still sees gaps via the ad_etl_gaps read in Plan 33-05, so the dashboard
    goal is not blocked, but the proactive notification path is incomplete.
  fix_hint: >
    Inside the IF v_actual < v_expected block, after the INSERT INTO ad_etl_gaps:
    INSERT INTO public.admin_notifications (title, body, type)
    VALUES (
      format('ETL gap: %s missing %s hours on %s', v_network, v_expected - v_actual, v_yesterday),
      format('Expected %s rows, got %s rows. Use Backfill button in /admin/growth/cac.', v_expected, v_actual),
      'ad_etl_gap'
    )
    ON CONFLICT DO NOTHING;
```

---

## Recommended Fix Sequence (all surgical inline Edits)

1. **Plan 33-01 Task 2 action — migration 11**: Replace `current_setting('app.service_role_key')` → vault lookup. Replace `current_setting('app.supabase_url')` → hardcoded URL. (BLOCKER fix)

2. **Plan 33-01 Task 2 action — migration 12**: Same vault substitutions in `trigger_ad_etl_backfill` SECDEF body. Remove GUC-confirm note. (BLOCKER fix)

3. **Plan 33-01 Task 3 + objective/output/success_criteria**: Update all "11 migration" counts to "12". (W6 fix)

4. **Plan 33-01 Task 2 action — migration 11 `run_ad_etl_gap_detection` body**: Add `INSERT INTO admin_notifications` in the gap-found branch. (W7 — recommended)

After these 2-4 edits, iter-3 should PASS. No new plan files or task additions needed.

---

*Plan-check iter-2 completed: 2026-05-18*
*Checker: Claude Sonnet 4.6 (plan-checker agent)*


---

---

# Plan-Check Report — iter-3

**Iteration:** iter-3
**Checked:** 2026-05-18
**Status:** PASSED

---

## Iter-2 BLOCKER + Warnings Resolution

| Item | Fix Verified | Status |
|------|-------------|--------|
| Vault pattern — migration 11 (4 ETL crons + fx_rates_ecb + cac_alert_cron) | All 6 net.http_post calls use vault.decrypted_secrets + hardcoded URL; no current_setting in action blocks | RESOLVED |
| Vault pattern — migration 12 (trigger_ad_etl_backfill SECDEF) | PERFORM net.http_post uses vault.decrypted_secrets; hardcoded URL with v_fn_name concatenation | RESOLVED |
| GUC-confirm note removed | Line 311 is a "DO NOT use" warning comment, not a self-referential confirm note | RESOLVED |
| W6 — migration count "12" | Verified: objective (ln 68), purpose (ln 77), output (ln 79), checkpoint what-built (ln 490), step 1 expected (ln 497), push step (ln 508), success_criteria (ln 566) all read "12" | RESOLVED |
| W7 — admin_notifications INSERT in run_ad_etl_gap_detection() | INSERT INTO admin_notifications present inside IF v_actual < v_expected block at lines 391-398; ON CONFLICT DO NOTHING; type='ad_etl_gap' | RESOLVED |

## Residual items (pre-existing, not introduced by iter-2, execution can proceed)

| Item | Severity | Notes |
|------|----------|-------|
| T-33-01-01 threat model still says current_setting('app.service_role_key') | INFO | Documentation only; action blocks are correct. Does not affect execution. |
| <done> says "6 cron.schedule calls"; migration 11 registers 7 | INFO | 7 ≥ 6; not a failure condition. |
| success_criteria says "6 pg_cron jobs"; 7 are registered | INFO | Checkpoint step 7 says "6+ rows" which is correct. |
| W1 — eslint.config.js import-zone for meta-capi-relay not tasked | WARNING | Carried from iter-1; runtime guard in Plan 33-04 T1 provides belt coverage |
| W2 — CACDashboardPage.test.tsx likely it.skip | WARNING | Carried from iter-1; accepted per defer-then-batch-fix pattern |
| W3 — Plan 33-01 has 13 files (12 migrations + 1 TS) | WARNING | Accepted; DDL-only files + autonomous:false + human checkpoint backstop |
| W4 — AEM top-8 + target_ltv_usd=200 user confirmation pending | WARNING | Gated correctly by checkpoint step 3 before push |
| W5 — T2 automated verify checks cron count only, not utils.ts exports | WARNING | <done> criterion catches it |

## New issues introduced by iter-2 fixes

None.

## Overall Verdict

**PASSED** — all iter-2 BLOCKERs (vault pattern, W6 count, W7 notification) are correctly implemented. No new blockers introduced. Carried warnings are accepted per prior plan-check iterations. Plans are ready for execution.

---

*Plan-check iter-3 completed: 2026-05-18*
*Checker: Claude Sonnet 4.6 (plan-checker agent)*
