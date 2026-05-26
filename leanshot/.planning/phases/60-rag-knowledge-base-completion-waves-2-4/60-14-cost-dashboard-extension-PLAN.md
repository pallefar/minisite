---
phase: 60
plan: 14
type: execute
wave: 3
depends_on: [60-01]
files_modified:
  - supabase/functions/rag-cost-query/index.ts
  - supabase/functions/rag-cost-query/deno.json
  - supabase/functions/rag-cost-query/__tests__/posthog-query.test.ts
  - src/components/admin/rag/RagCostPage.tsx
  - src/components/admin/rag/RagLayout.tsx
  - src/lib/admin/rag/cost-api.ts
  - src/lib/admin/rag/__tests__/cost-api.test.ts
  - src/components/admin/rag/__tests__/RagCostPage.test.tsx
autonomous: true
requirements: [RAG-04, RAG-05, RAG-06]
tags: [rag, cost-dashboard, posthog, admin-ui]
user_setup:
  - service: posthog
    why: "Server-to-server query API for cost dashboard rollups"
    env_vars:
      - name: POSTHOG_PERSONAL_API_KEY
        source: "PostHog → Personal API keys → create with scope query:read; vault-stored as posthog_personal_api_key"
      - name: POSTHOG_PROJECT_ID
        source: "PostHog → Project settings → Project ID (numeric)"

must_haves:
  truths:
    - "Super-admin visits /admin/rag/cost and sees 6 vendor cards (Firecrawl, OpenAI embeddings, Anthropic summarizer, Cohere rerank, Jina rerank, federated-source-fetch overhead) + 3 cron rows (Coach synthesis / day, Tip-of-day cron / day, Newsletter cron / week)"
    - "Each vendor card displays MTD spend, budget cap caption, CostBar (existing primitive from 50-02), reset countdown, AND a 7-day Sparkline (existing primitive at src/components/ui/Sparkline.tsx) — per UI-SPEC §17 / Surface 3"
    - "Cost data is sourced from PostHog $ai_generation events aggregated server-side via a new Edge Fn rag-cost-query (admin-gated; uses POSTHOG_PERSONAL_API_KEY vault secret) — per AI-SPEC §7 line 945 (PostHog Insights embedded; NOT a parallel rag_cost_log table)"
    - "Auto-pause banner renders above the bento grid when any vendor's MTD spend ≥ 100% of cap; AlertOctagon lucide icon + copy from UI-SPEC §C Copywriting Contract verbatim; Acknowledge-and-resume CTA calls rag_acknowledge_budget_cap(p_vendor text) RPC (defined in 60-01 migration set)"
    - "Cost-event payload contains NO PII — only model, vendor, action category, usage_total_cost, latency_ms, trace_id (audited via T-60-14-PII-1 mitigation)"
    - "Page is super-admin only — Edge Fn enforces auth.uid() ∈ public.is_staff() AND a stricter super-admin RPC check (public.is_super_admin() if exists, else public.is_staff() + audit-log entry); UI hides /admin/rag/cost nav entry for non-super-admin per existing RagLayout convention"
    - "Phase 69 4-size typography ceiling honored (only 11/13/18/28 px); accent reserved-list (UI-SPEC §Color) honored — spend figures use font-mono 18px; eyebrow labels 11px uppercase"
    - "Dark mode parity: all surfaces render correctly under [data-theme='dark']; no hardcoded hex"
    - "a11y: AlertOctagon banner has role='alert' aria-live='assertive'; Acknowledge button has aria-busy during RPC; vendor cards form a labeled region (aria-labelledby) for screen readers"
  artifacts:
    - path: "supabase/functions/rag-cost-query/index.ts"
      provides: "Admin-gated Edge Fn proxying PostHog Query API for $ai_generation aggregations"
      min_lines: 80
    - path: "supabase/functions/rag-cost-query/deno.json"
      provides: "Per-Fn import map (CLI v2.101.0+ ignores --import-map per [[reference_supabase_functions_deploy_import_map_flag]])"
    - path: "src/components/admin/rag/RagCostPage.tsx"
      provides: "Full Cost dashboard component (6 vendor cards + 3 cron rows + auto-pause banner)"
      min_lines: 180
    - path: "src/lib/admin/rag/cost-api.ts"
      provides: "Typed client wrapper over rag-cost-query Edge Fn + rag_acknowledge_budget_cap RPC"
    - path: "src/components/admin/rag/RagLayout.tsx"
      provides: "Wires real RagCostPage (replaces CostPlaceholder at lines 152-159 of existing file)"
  key_links:
    - from: "src/components/admin/rag/RagCostPage.tsx"
      to: "src/lib/admin/rag/cost-api.ts"
      via: "fetchCostRollup({ rangeDays, vendors }) + acknowledgeBudgetCap(vendor)"
      pattern: "import .* from '@/lib/admin/rag/cost-api'"
    - from: "src/lib/admin/rag/cost-api.ts"
      to: "supabase/functions/rag-cost-query"
      via: "supabase.functions.invoke('rag-cost-query', { body: { rangeDays, vendors } })"
      pattern: "functions\\.invoke\\(['\"]rag-cost-query"
    - from: "supabase/functions/rag-cost-query/index.ts"
      to: "PostHog Query API (https://app.posthog.com/api/projects/<id>/query/)"
      via: "fetch with Bearer POSTHOG_PERSONAL_API_KEY (vault-stored)"
      pattern: "api/projects/.*query"
    - from: "src/components/admin/rag/RagCostPage.tsx"
      to: "supabase.rpc('rag_acknowledge_budget_cap', { p_vendor })"
      via: "Acknowledge-and-resume button onClick"
      pattern: "rpc\\(['\"]rag_acknowledge_budget_cap"
    - from: "src/components/admin/rag/RagLayout.tsx (line ~167)"
      to: "src/components/admin/rag/RagCostPage.tsx"
      via: "SUB_ROUTES entry for path='cost' uses lazy(() => import('./RagCostPage'))"
      pattern: "RagCostPage"
---

<objective>
Ship the Phase 60 cost-dashboard surface at `/admin/rag/cost`: build the full `RagCostPage.tsx` (50-09 base + 3 NEW Phase 60 vendor rows + 3 cron rows + auto-pause banner) and a new admin-gated Edge Fn `rag-cost-query` that aggregates PostHog `$ai_generation` events into per-vendor MTD spend + 7-day Sparkline series.

**Why now / honest scope note:** The outline row says "REUSE 50-09 Task 4 RagCostPage extension (NOT duplicate)" — but 50-09 was the STRETCH wave that did NOT ship (verified: `RagLayout.tsx` line 152 still renders `CostPlaceholder`; no `RagCostPage.tsx` file exists in `src/components/admin/rag/`). Per `<scope_reduction_prohibition>` we cannot silently omit the base 3 vendor cards (Firecrawl / OpenAI embed / Anthropic summarize) — this plan builds them AS PART OF the Phase 60 extension. The 3 NEW Phase 60 cost rows (Cohere rerank, Jina rerank, federated-source-fetch overhead) extend that same component contract. Both base and extension ship in one component — no "v1/v2" split.

Per AI-SPEC §7 line 945 the data source is **PostHog `$ai_generation` events** (NOT a parallel `rag_cost_log` table — none exists, and creating one would duplicate PostHog's role per [[feedback_3_layer_must_never_invariant_pattern]] anti-pattern reasoning).

Purpose: closes RAG-04 / RAG-05 / RAG-06 cost-visibility surface so operator can detect spend regressions (Cohere rerank cost spike, federated adapter pagination explosion, coach-synthesis prompt bloat) before $0.04/query envelope breaches; backs the cron auto-pause flow already designed in AI-SPEC §6 G7.

Output:
- 1 new Edge Fn (`rag-cost-query`) with per-Fn deno.json + Deno integration test
- 1 new browser cost-api client + Vitest
- 1 net-new `RagCostPage.tsx` (6 vendor cards + 3 cron rows + auto-pause banner + a11y baseline) + Vitest
- 1 surgical edit to `RagLayout.tsx` to swap placeholder for real component
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/STATE.md
@leanshot/CLAUDE.md
@leanshot/.planning/phases/60-rag-knowledge-base-completion-waves-2-4/60-CONTEXT.md
@leanshot/.planning/phases/60-rag-knowledge-base-completion-waves-2-4/60-AI-SPEC.md
@leanshot/.planning/phases/60-rag-knowledge-base-completion-waves-2-4/60-UI-SPEC.md
@leanshot/.planning/phases/60-rag-knowledge-base-completion-waves-2-4/60-PLAN-OUTLINE.md
@leanshot/.planning/phases/50-admin-curated-rag-knowledge-base-peptide-topic-research-scra/50-09-PLAN.md
@leanshot/src/components/admin/rag/RagLayout.tsx
@leanshot/src/components/admin/rag/CostBar.tsx
@leanshot/src/components/ui/Sparkline.tsx
@supabase/functions/_shared/posthog-server.ts

<interfaces>
<!-- Key types and contracts extracted from existing codebase. Executor uses these directly. -->

Existing primitive — `leanshot/src/components/admin/rag/CostBar.tsx`:
- `export interface CostBarProps { mtdUsd: number; capUsd: number }`
- `export function CostBar({ mtdUsd, capUsd }: CostBarProps)`
- Threshold rule baked in: <80 success, 80-100 warning, ≥100 danger
- Has built-in `role="progressbar"` + aria-label

Existing primitive — `leanshot/src/components/ui/Sparkline.tsx`:
- Inline SVG sparkline component; check signature before use — likely `<Sparkline data={number[]} />` or similar. Executor MUST `Read` this file once at task start to lock prop names before composing it into RagCostPage. (No re-reads — extract everything in the one pass.)

Existing mount point — `leanshot/src/components/admin/rag/RagLayout.tsx`:
- Line 152-159: `function CostPlaceholder() { ... }` renders "Plan 50-09 finalizes the cost dashboard" placeholder text.
- Line 161-167: `SUB_ROUTES` const array; cost entry currently: `{ key: 'cost', label: 'Cost', path: 'cost', Component: CostPlaceholder }`.
- Surgical edit: replace `CostPlaceholder` with `lazy(() => import('./RagCostPage'))` and delete `CostPlaceholder` function. Pattern mirrors lines 22-23 `RagTopicsPage` / `RagSourcesPage` lazy imports.

PostHog server helper — `supabase/functions/_shared/posthog-server.ts` (NOTE: lives at git-root `supabase/`, NOT under `leanshot/`, per [[reference_minisite_monorepo_layout]]):
- Capture-side exports: `captureServer`, `captureRagEvent`, `aliasServerSide`, `shutdownPostHog`.
- This helper is EMIT-ONLY (event capture). PostHog Query API (read-back) is NOT in the helper — Edge Fn must call PostHog Query API directly via `fetch`.

PostHog Query API contract (executor reference — do NOT re-search docs):
- Endpoint: `POST https://app.posthog.com/api/projects/<POSTHOG_PROJECT_ID>/query/`
- Auth: `Authorization: Bearer <POSTHOG_PERSONAL_API_KEY>` (Personal API key scope `query:read`)
- Body: `{ "query": { "kind": "HogQLQuery", "query": "SELECT toDate(timestamp) as day, sum(toFloat(properties.$ai_generation_usage_total_cost)) as cost FROM events WHERE event = '$ai_generation' AND properties.vendor = {vendor:String} AND timestamp >= now() - INTERVAL {days:Int64} DAY GROUP BY day ORDER BY day", "values": { "vendor": "cohere", "days": 30 } } }`
- Response: `{ "results": [[day, cost], ...], "columns": ["day", "cost"], ... }`
- If using `ctx7` for current PostHog API docs is preferred, executor MAY run `ctx7 library posthog "query api hogql"` ONCE at task start; otherwise use the contract above which matches PostHog API stable shape as of 2026-Q2.

Existing supabase client convenience — `leanshot/src/lib/supabase.ts`:
- `import { supabase } from '@/lib/supabase'` is the canonical import.
- `supabase.functions.invoke('rag-cost-query', { body: {...} })` is the existing call pattern (other admin libs in `src/lib/admin/` use this — grep `src/lib/admin/admin-api.ts` for an example shape if needed).

Phase 60-01 dependency (declared `depends_on: [60-01]`):
- 60-01 ships `rag_budget_caps` table (vendor TEXT PK, cap_usd NUMERIC, mtd_spend_usd NUMERIC cached, last_acknowledged_at TIMESTAMPTZ, source_pause_state BOOL) AND the `rag_acknowledge_budget_cap(p_vendor text) RETURNS void` SECDEF RPC (mirrors 50-09 Task 4 RPC design — confirm row exists in 60-01 PLAN before this plan executes; if absent, surface gap before dispatch).
- If 60-01 does NOT include `rag_budget_caps` + `rag_acknowledge_budget_cap` RPC, executor MUST surface as BLOCKER (not silently add table — that's 60-01's scope).

Phase 50-09 (NOT shipped) — what this plan is replacing/owning:
- 50-09 Task 4 designed: 3 vendor cards (Firecrawl/OpenAI/Anthropic span={4}) + per-topic breakdown table + auto-pause banner + `rag_acknowledge_budget_cap` RPC. None shipped.
- This plan OWNS building those 3 base vendor cards (rebranded as Phase 60 component since 50-09 deferred) AND the 3 NEW Phase 60 vendor cards (Cohere/Jina/federated) AND the 3 cron rows from AI-SPEC §7 (Coach / Tip / Newsletter). Total: 9 cards + banner.

Vendor identifier strings (HogQL filter values — pin these once; downstream cron emitters MUST match):
- `firecrawl` (50-09 scrape adapter, may not be emitting yet — card shows $0 / "no data" if so)
- `openai_embed` (60-05 rag-embed-approved emits)
- `anthropic_summarize` (60-04 rag-summarize-and-chunk emits)
- `cohere_rerank` (60-06 rag-retrieve emits when RAG_RERANKER_PROVIDER=cohere)
- `jina_rerank` (60-06 emits when RAG_RERANKER_PROVIDER=jina)
- `federated_fetch` (60-07 rag-federated-* emits; one vendor row aggregated across pubmed/fda/dailymed per outline; sub-breakdown deferred)

Cron-row identifier strings (separate from vendor — these are trace-tag aggregations):
- `coach_synthesis_per_day` (sum of all $ai_generation costs tagged with `trace_id LIKE 'coach_query_%'`, grouped by day)
- `tip_of_day_per_day` (trace_id LIKE 'tip_of_day_cron_%')
- `newsletter_per_week` (trace_id LIKE 'newsletter_cron_%', summed over 7-day windows)

</interfaces>

<copy_contract>
<!-- Verbatim copy from UI-SPEC §C Cost Dashboard Extension. DO NOT paraphrase. -->

| Element | Copy |
|---------|------|
| Section heading (new rows) | `Phase 60 Synthesis` |
| Row labels | `Coach synthesis / day` · `Tip-of-day cron / day` · `Newsletter cron / week` |
| Auto-pause banner | `Scrapers auto-paused — {vendor} budget exhausted. Acknowledge to resume.` |
| Acknowledge CTA | `Acknowledge and resume` |
| Budget caption | `of ${budget} budget · {N}% used` |
| Reset countdown | `Resets in {N} days` |
| Cost dashboard load failure | `Couldn't load cost data. Refresh to try again.` |

Section heading for 50-09 base block (Firecrawl/OpenAI/Anthropic): `Ingestion + Synthesis` (composed by planner; UI-SPEC does not explicitly label this section — executor uses this string).
Section heading for NEW Phase 60 vendor block (Cohere/Jina/federated): `Phase 60 Retrieval + Federation` (composed by planner).
Section heading for cron rollups: `Phase 60 Synthesis` (verbatim from UI-SPEC table above).
</copy_contract>
</context>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| Browser admin client → `rag-cost-query` Edge Fn | Admin JWT crosses here; Fn MUST validate auth.uid() ∈ super-admin set BEFORE touching PostHog API |
| `rag-cost-query` Edge Fn → PostHog Query API | Personal API key (vault-stored) crosses here; key has `query:read` scope only — never user-impersonation |
| Browser admin client → `rag_acknowledge_budget_cap` RPC | Admin JWT; RPC is SECDEF, MUST re-check super-admin role inside RPC body (defense in depth) |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-60-14-INFO-1 | Information Disclosure | `rag-cost-query` Edge Fn | mitigate | Endpoint requires admin JWT; reject non-staff with 403; PostHog HogQL query is parameterized (no SQL injection via user input); only returns aggregated cost numbers, NOT per-user payloads — no PII can leak through this surface |
| T-60-14-PII-1 | Information Disclosure | $ai_generation event payload schema (upstream emitters in 60-04..07, 60-11, 60-12) | mitigate | Audit responsibility note in plan: cost-event payload MUST contain ONLY (model, vendor, action_category, usage_total_cost, latency_ms, trace_id, error_code). NO user_id, NO drug names, NO query text. This is an UPSTREAM contract — 60-14 audits via a runtime assertion in `rag-cost-query` that aggregates use only `cost`/`day`/`vendor` columns (never groups by user_id). Test: cost-api.test.ts asserts response shape contains only `{ day: string, cost: number, vendor: string }` |
| T-60-14-TAMPER-1 | Tampering | `rag_acknowledge_budget_cap` RPC | mitigate | SECDEF RPC re-checks `public.is_staff()` (or `public.is_super_admin()` if exists in 60-01) inside RPC body; logs to audit_log on success; UI button is disabled when MTD < 100% cap (server is source of truth — also rejects when not actually capped) |
| T-60-14-SPOOF-1 | Spoofing | Vendor identifier strings passed to PostHog Query API | mitigate | Edge Fn allowlists vendor strings against a server-side const array `ALLOWED_VENDORS = ['firecrawl','openai_embed','anthropic_summarize','cohere_rerank','jina_rerank','federated_fetch']`; rejects any other value with 400 (prevents arbitrary HogQL injection via vendor param even though query is parameterized — defense in depth) |
| T-60-14-DOS-1 | Denial of Service | PostHog Query API rate limits | accept | Cost dashboard is admin-only and queried on-demand; expected QPS << 1; PostHog free tier rate limit (240 req/min) is ample. If exceeded, Edge Fn returns 429 to UI which shows the standard error-state copy. |
| T-60-14-XSS-1 | Tampering | RagCostPage rendering of vendor/error strings | mitigate | All strings rendered via React text interpolation (auto-escaped); error message from `last_error` field rendered as text only (no `dangerouslySetInnerHTML`); banner copy uses static template strings — no untrusted HTML path |
| T-60-14-SC | Tampering | npm packages added (none expected) | mitigate | This plan adds ZERO new npm packages — composes existing primitives (CostBar, Sparkline, lucide-react `AlertOctagon`) and uses native `fetch` in Edge Fn. Package legitimacy gate N/A. |
</threat_model>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Build rag-cost-query Edge Fn (admin-gated PostHog Query API proxy)</name>
  <files>supabase/functions/rag-cost-query/index.ts, supabase/functions/rag-cost-query/deno.json, supabase/functions/rag-cost-query/__tests__/posthog-query.test.ts</files>
  <read_first>
    @supabase/functions/_shared/posthog-server.ts (NOTE: git-root path, NOT under leanshot/);
    @supabase/functions/admin-impersonate/index.ts (canonical admin-JWT-gated Edge Fn pattern in this repo — copy auth-check shape verbatim);
    @leanshot/.planning/phases/60-rag-knowledge-base-completion-waves-2-4/60-AI-SPEC.md §7 (production monitoring contract — confirms PostHog $ai_generation is the source of truth, NOT a parallel rag_cost_log table)
  </read_first>
  <behavior>
    - Test 1 (admin auth): request without admin JWT → 401; non-staff JWT → 403
    - Test 2 (allowlist): request with `vendors: ['malicious_vendor']` → 400 with body `{ error: 'invalid_vendor' }`
    - Test 3 (happy path): mock PostHog Query API to return `{ results: [['2026-05-20', 1.23], ['2026-05-21', 2.45]], columns: ['day','cost'] }`; assert response shape `{ vendor: 'cohere_rerank', mtd_usd: 3.68, sparkline_7d: [..7 numbers..] }` — sparkline is right-padded with zeros if fewer days; aggregation is sum-by-vendor
    - Test 4 (cron-row aggregation): `rangeKind: 'trace'` + `trace_prefix: 'tip_of_day_cron_'` returns aggregated cost across all matching traces, grouped by day
    - Test 5 (PostHog error passthrough): when PostHog returns 429, Fn returns 429 with `{ error: 'upstream_rate_limited' }`
    - Test 6 (PII assertion): mock PostHog response containing `user_id` in extra columns → Fn STRIPS those before returning; downstream contract guarantees only `{ day, cost }` reach the browser
  </behavior>
  <action>
    Create `supabase/functions/rag-cost-query/deno.json` with per-Fn import map (no shared `--import-map` flag per [[reference_supabase_functions_deploy_import_map_flag]] — v2.101.0+ ignores it). Pin `std/` at the same version other v1.4 Fns use (grep an existing Fn's deno.json for the canonical version pin; e.g. `supabase/functions/rag-scrape-runner/deno.json` if present, else `supabase/functions/admin-impersonate/deno.json`).

    Create `supabase/functions/rag-cost-query/index.ts`:
    - `Deno.serve` wrapped under `if (import.meta.main)` per [[reference_deno_test_top_level_serve_trap]].
    - Request body schema (zod): `{ rangeDays: number (default 30, max 90), vendors?: string[] (allowlist filter), traceRollups?: ('coach_synthesis' | 'tip_of_day' | 'newsletter')[] }`.
    - Auth: extract Supabase JWT from `Authorization` header; verify via service-role SECDEF `public.is_staff()` call (or `public.is_super_admin()` if 60-01 ships it — check existence with `select to_regprocedure('public.is_super_admin()')` style fallback; if absent use `is_staff()`).
    - Vendor allowlist (server-side const): `['firecrawl', 'openai_embed', 'anthropic_summarize', 'cohere_rerank', 'jina_rerank', 'federated_fetch']`. Any out-of-list vendor in request → 400.
    - For each requested vendor: build parameterized HogQL query against PostHog Query API endpoint (URL + auth pattern in `<interfaces>` block above). Use `Deno.env.get('POSTHOG_PERSONAL_API_KEY')` (vault-stored) + `Deno.env.get('POSTHOG_PROJECT_ID')`.
    - Aggregate response into `{ vendor, mtd_usd: number, sparkline_7d: number[], last_day_with_data: string }`.
    - For trace rollups: query with `WHERE event = '$ai_generation' AND properties.trace_id LIKE {prefix:String} || '%'` — same shape, return labels `'coach_synthesis_per_day'` etc.
    - Strip ALL columns except `day` and `cost` from PostHog response before returning (T-60-14-PII-1 mitigation; assert in test).
    - Emit `captureRagEvent('admin', 'rag_cost_query_executed', { actor_id, range_days, vendor_count })` via shared helper.
    - Health check `GET /healthz` → 200.

    Create `__tests__/posthog-query.test.ts`:
    - Deno-style test file. Mock `fetch` to PostHog endpoint via stub. Cover 6 behaviors above.
    - Use the `_shared/posthog-server.ts` helper's existing `setMirrorAdminForTest` if applicable to silence capture-side side-effects; reset after.
  </action>
  <verify>
    <automated>cd /Users/karstenhaldan/minisite && $HOME/.deno/bin/deno test --no-check supabase/functions/rag-cost-query/__tests__/posthog-query.test.ts</automated>
  </verify>
  <done>
    - 3 files exist at git-root supabase/ path.
    - `deno check supabase/functions/rag-cost-query/index.ts` exits 0.
    - All 6 behaviors green.
    - Fn does NOT deploy in this task — deployment is centralized in 60-15 BLOCKING per [[feedback_fn_deploy_before_cron_db_push]].
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Build cost-api browser client wrapper</name>
  <files>leanshot/src/lib/admin/rag/cost-api.ts, leanshot/src/lib/admin/rag/__tests__/cost-api.test.ts</files>
  <read_first>
    @leanshot/src/lib/admin/admin-api.ts (canonical admin client pattern in this repo — copy invoke shape);
    @leanshot/src/lib/supabase.ts (confirm `supabase` import path)
  </read_first>
  <behavior>
    - Test 1: `fetchCostRollup({ rangeDays: 30, vendors: ['cohere_rerank'] })` invokes `supabase.functions.invoke('rag-cost-query', { body: {...} })` exactly once with correct body shape
    - Test 2: returns typed `CostRollupResponse[]` with `{ vendor, mtd_usd, sparkline_7d: number[], last_day_with_data }`
    - Test 3: `acknowledgeBudgetCap('cohere_rerank')` calls `supabase.rpc('rag_acknowledge_budget_cap', { p_vendor: 'cohere_rerank' })` and resolves; surfaces RPC error as thrown Error
    - Test 4: error from Edge Fn (e.g., 403 non-staff) is surfaced as `CostApiError` with `kind: 'forbidden' | 'invalid_vendor' | 'upstream_rate_limited' | 'unknown'` for caller to render contextual error UI
  </behavior>
  <action>
    Create `leanshot/src/lib/admin/rag/cost-api.ts`:
    - Exports:
      - `type Vendor = 'firecrawl' | 'openai_embed' | 'anthropic_summarize' | 'cohere_rerank' | 'jina_rerank' | 'federated_fetch'`
      - `type TraceRollup = 'coach_synthesis' | 'tip_of_day' | 'newsletter'`
      - `interface CostRollupResponse { vendor: Vendor | TraceRollup; mtd_usd: number; sparkline_7d: number[]; last_day_with_data: string | null }`
      - `class CostApiError extends Error { kind: 'forbidden' | 'invalid_vendor' | 'upstream_rate_limited' | 'unknown' }`
      - `async function fetchCostRollup(args: { rangeDays?: number; vendors?: Vendor[]; traceRollups?: TraceRollup[] }): Promise<CostRollupResponse[]>`
      - `async function acknowledgeBudgetCap(vendor: Vendor): Promise<void>`
      - `async function fetchBudgetCaps(): Promise<{ vendor: Vendor; cap_usd: number; mtd_spend_usd: number; last_acknowledged_at: string | null; source_pause_state: boolean }[]>` — reads `rag_budget_caps` table directly via PostgREST (RLS gated to staff per 60-01).
    - All three functions use `supabase` from `@/lib/supabase`.
    - JSDoc each export with the Edge Fn it talks to.

    Create `__tests__/cost-api.test.ts` (Vitest):
    - Mock `supabase.functions.invoke` and `supabase.rpc` / `supabase.from`.
    - Cover 4 behaviors above.
  </action>
  <verify>
    <automated>cd /Users/karstenhaldan/minisite/leanshot && npx vitest run --config vite.config.ts src/lib/admin/rag/__tests__/cost-api.test.ts</automated>
  </verify>
  <done>
    - 2 files exist; tsc clean.
    - All 4 behaviors green.
    - File uses `npx vitest run --config vite.config.ts` per [[reference_vitest_4_projects_config_masks_default]] (avoid plain `npm test`).
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 3: Build full RagCostPage.tsx (6 vendor cards + 3 cron rows + auto-pause banner)</name>
  <files>leanshot/src/components/admin/rag/RagCostPage.tsx, leanshot/src/components/admin/rag/__tests__/RagCostPage.test.tsx</files>
  <read_first>
    @leanshot/src/components/admin/rag/CostBar.tsx (existing primitive — props pinned in `<interfaces>` above);
    @leanshot/src/components/ui/Sparkline.tsx (read ONCE to lock prop names — no re-reads);
    @leanshot/src/components/ui/Card.tsx (Card span/variant/padding props);
    @leanshot/.planning/phases/60-rag-knowledge-base-completion-waves-2-4/60-UI-SPEC.md (Surface 3 + §C Copywriting Contract Cost Dashboard rows — verbatim copy already pinned in `<copy_contract>` above);
    @leanshot/.planning/phases/50-admin-curated-rag-knowledge-base-peptide-topic-research-scra/50-09-PLAN.md Task 4 (base 3-card layout reference)
  </read_first>
  <behavior>
    - Test 1 (render): page renders 3 section headings ("Ingestion + Synthesis", "Phase 60 Retrieval + Federation", "Phase 60 Synthesis") and a total of 9 cards (6 vendor + 3 cron). Use mock `fetchCostRollup` returning all 9 rollups.
    - Test 2 (empty data card): when a vendor's `mtd_usd === 0 && last_day_with_data === null`, card renders with `—` placeholder and `aria-label="no data yet"` — NOT a 0-value sparkline.
    - Test 3 (auto-pause banner): when mock `fetchBudgetCaps` returns one vendor with `mtd_spend_usd >= cap_usd`, the AlertOctagon banner renders with verbatim copy `Scrapers auto-paused — cohere_rerank budget exhausted. Acknowledge to resume.` and `role="alert"` + `aria-live="assertive"`.
    - Test 4 (acknowledge flow): clicking `Acknowledge and resume` calls `acknowledgeBudgetCap('cohere_rerank')`; button shows `aria-busy="true"` during call; on resolve, banner is removed and a toast `Resumed — cohere_rerank scrapers active` fires via existing `useToast()` hook.
    - Test 5 (error state): when `fetchCostRollup` rejects, page shows `Couldn't load cost data. Refresh to try again.` (verbatim from UI-SPEC §C) with `role="status"`.
    - Test 6 (typography compliance): no rendered text uses class `text-base`, `text-md`, `text-xl`, `text-2xl`, `text-3xl` — only `text-micro` / `text-sm` / `text-lg` / `text-heading` (or none, inheriting). Phase 69 will CI-gate; pre-comply.
    - Test 7 (a11y): cards form a region; banner has `role="alert"`; large spend `<span>` has `aria-label` like `"Cohere rerank: 3 dollars 68 cents month-to-date"`.
    - Test 8 (dark mode): renders correctly when `<html data-theme="dark">` is set in JSDOM env — no hardcoded hex, all styles via tokens (smoke via `expect(container.querySelector('[style*="#"]')).toBeNull()` — caller MUST use `--color-*` CSS vars).
  </behavior>
  <action>
    Create `leanshot/src/components/admin/rag/RagCostPage.tsx`:

    **Layout (matches UI-SPEC §17 Surface 3 + §C Copywriting Contract):**
    - Top-level `<section>` with header: H1 `Cost Dashboard` (font-sans 18px `text-lg` 600 — NOT 28px `text-heading`; that token is reserved for public /knowledge per UI-SPEC Critical Invariant #11).
    - Range selector pill row (`7d` / `30d` / `90d` default 30d) — uses existing `Pill` primitive with `aria-pressed`.
    - **Auto-pause banner block** (full-width, above bento grid): conditionally rendered when any vendor in `fetchBudgetCaps()` response has `mtd_spend_usd >= cap_usd`. Render shape:
      ```
      <div role="alert" aria-live="assertive" class="bg-[var(--color-danger-soft)] border-l-2 border-[var(--color-danger)] p-4 mb-6 flex items-center gap-3">
        <AlertOctagon size={18} aria-hidden />
        <p class="text-sm">{verbatim copy}</p>
        <Button variant="primary" aria-busy={...} onClick={handleAcknowledge}>Acknowledge and resume</Button>
      </div>
      ```
    - **Section 1 — "Ingestion + Synthesis"** (50-09 base, 3 cards span={4} each):
      - Firecrawl
      - OpenAI embeddings
      - Anthropic summarizer
    - **Section 2 — "Phase 60 Retrieval + Federation"** (3 NEW Phase 60 cards span={4} each):
      - Cohere rerank
      - Jina rerank
      - Federated source fetch
    - **Section 3 — "Phase 60 Synthesis"** (3 cron rollup cards span={4} each, copy from UI-SPEC §C verbatim):
      - `Coach synthesis / day`
      - `Tip-of-day cron / day`
      - `Newsletter cron / week`
    - Each card composition:
      - Eyebrow row: 11px uppercase `text-micro` `text-text-tertiary` with vendor/row label.
      - Large mono spend `$XX.XX` — `<span class="text-lg font-mono font-semibold tabular-nums" aria-label="...">`. (18px per UI-SPEC §C Cost Dashboard typography — NOT `text-2xl` which would violate 4-size ceiling.)
      - Budget caption row: 13px `text-sm` text-secondary, copy `of ${budget} budget · {N}% used` — interpolate from cap data.
      - CostBar (existing primitive — pass `mtdUsd` + `capUsd` props).
      - Sparkline (existing primitive — 7-day data; signature per Sparkline.tsx Read).
      - Reset countdown row: 11px `text-micro` `text-text-tertiary`, copy `Resets in {N} days` — compute days-to-end-of-month from `new Date()`.
      - When `mtd_usd === 0 && last_day_with_data === null`: render `—` placeholder instead of `$0.00` + Sparkline shows flat baseline with `aria-label="no data yet"`.
    - Footer note (11px `text-micro` `text-text-tertiary`): `Source: PostHog $ai_generation events · refreshes on page focus`.

    **Data flow:**
    - On mount: parallel-fire `fetchCostRollup({ rangeDays: 30, vendors: [...all 6...], traceRollups: ['coach_synthesis','tip_of_day','newsletter'] })` + `fetchBudgetCaps()`.
    - On range pill change: re-fire `fetchCostRollup` with new rangeDays; banner stays bound to `fetchBudgetCaps` (cap state is cap-level not range-level).
    - Loading state: skeleton cards with `<Skeleton>` primitive matching final card height.
    - Error state: render `<Card variant="flat">` with verbatim error copy + `role="status"`.

    **Composition rules (Phase 69 pre-compliance):**
    - Sizes: only `text-micro` / `text-sm` / `text-lg`. No `text-heading` on this page (reserved for /knowledge per UI-SPEC). No `text-base`, `text-xl`, `text-2xl` anywhere.
    - Weights: only 400 (default) or 600 (`font-semibold`). No 500/700/800.
    - Accent (`text-primary` / `bg-primary`): reserved for primary CTA only (Acknowledge-and-resume button). No accent on vendor labels or eyebrows.
    - Danger color (`text-danger` / `bg-danger-soft`): banner background + AlertOctagon icon + CostBar danger threshold (≥100% — already baked into CostBar primitive).
    - Tier badges N/A on this page.

    **Toast on acknowledge success:** import `useToast` from `@/hooks/useToast`; fire `toast({ kind: 'success', message: 'Resumed — {vendor} scrapers active' })` after RPC resolves.

    Create `__tests__/RagCostPage.test.tsx` (Vitest + RTL):
    - Mock `cost-api` module (`fetchCostRollup`, `acknowledgeBudgetCap`, `fetchBudgetCaps`).
    - Cover 8 behaviors above.
    - Use `@testing-library/react` `render` + `screen.getByRole` for a11y queries.
  </action>
  <verify>
    <automated>cd /Users/karstenhaldan/minisite/leanshot && npm run typecheck && npx vitest run --config vite.config.ts src/components/admin/rag/__tests__/RagCostPage.test.tsx</automated>
  </verify>
  <done>
    - 2 files exist; tsc + vitest green.
    - 9 cards render under mock data.
    - Auto-pause banner triggers on 100% cap.
    - Verbatim copy from UI-SPEC §C present in test assertions.
    - No `text-base|text-xl|text-2xl|text-3xl` classes anywhere in the file: `! grep -E "text-(base|md|xl|2xl|3xl)" src/components/admin/rag/RagCostPage.tsx | grep -v '^//' | grep -v '^\\*'` exits 1 (no hits in non-comment lines per [[feedback_negation_grep_defeated_by_comment_string]]).
  </done>
</task>

<task type="auto">
  <name>Task 4: Wire RagCostPage into RagLayout (surgical replacement of CostPlaceholder)</name>
  <files>leanshot/src/components/admin/rag/RagLayout.tsx</files>
  <read_first>
    @leanshot/src/components/admin/rag/RagLayout.tsx (current shape pinned in `<interfaces>` — lines 22-23 lazy-import pattern + 152-167 CostPlaceholder + SUB_ROUTES)
  </read_first>
  <action>
    Surgical edits to `leanshot/src/components/admin/rag/RagLayout.tsx`:

    1. After existing `RagSourcesPage` lazy import (line 23), add:
       ```ts
       const RagCostPage = lazy(() => import('./RagCostPage'));
       ```

    2. DELETE the entire `CostPlaceholder` function (lines 152-159 in current file).

    3. In `SUB_ROUTES` const (line 161-167), change the cost entry from:
       ```ts
       { key: 'cost', label: 'Cost', path: 'cost', Component: CostPlaceholder },
       ```
       to:
       ```ts
       { key: 'cost', label: 'Cost', path: 'cost', Component: RagCostPage },
       ```

    No other changes. Do NOT modify other sub-routes, telemetry page, queue placeholder, or navigation rendering — those are 60-08's and 60-09's surgical targets respectively; sequential-on-main execution per outline § Executor model means this plan runs after those have already landed OR they are queued separately. If grep shows the file has been modified between plan-check and execute (e.g., 60-08 already replaced `QueuePlaceholder`), executor MUST rebase the edit against the new line numbers using `RagSourcesPage = lazy(...)` as the structural anchor — NOT raw line numbers.
  </action>
  <verify>
    <automated>cd /Users/karstenhaldan/minisite/leanshot && npm run typecheck && grep -c "RagCostPage" src/components/admin/rag/RagLayout.tsx</automated>
  </verify>
  <done>
    - `RagLayout.tsx` references `RagCostPage` ≥ 2 times (import + SUB_ROUTES) — verified by `grep -c` returning ≥ 2.
    - `grep -c "CostPlaceholder" src/components/admin/rag/RagLayout.tsx` returns 0.
    - tsc clean.
    - Visiting `/admin/rag/cost` in dev renders the new component (smoke-only — full UAT in 60-15 close-out).
  </done>
</task>

</tasks>

<verification>
- All Vitest + Deno tests green.
- `cd leanshot && npm run typecheck` clean.
- `cd leanshot && npm run lint -- src/components/admin/rag/RagCostPage.tsx src/components/admin/rag/RagLayout.tsx src/lib/admin/rag/cost-api.ts` clean.
- `cd leanshot && npx vitest run --config vite.config.ts src/components/admin/rag/__tests__/RagCostPage.test.tsx src/lib/admin/rag/__tests__/cost-api.test.ts` green.
- `cd /Users/karstenhaldan/minisite && $HOME/.deno/bin/deno test --no-check supabase/functions/rag-cost-query/__tests__/posthog-query.test.ts` green.
- Bundle: `RagCostPage` is lazy-imported (own chunk, no impact on admin index ceiling).
- Edge Fn deployment is DEFERRED to 60-15 BLOCKING per [[feedback_fn_deploy_before_cron_db_push]]. This plan does NOT run `supabase functions deploy`.
- Manual UAT deferred to 60-15 close-out: super-admin visits /admin/rag/cost, observes 9 cards (some "—" for vendors not yet emitting), forces a 100%-cap test row via direct SQL UPDATE to `rag_budget_caps`, verifies banner + acknowledge flow.
</verification>

<success_criteria>
- 6 vendor cards (firecrawl/openai_embed/anthropic_summarize/cohere_rerank/jina_rerank/federated_fetch) + 3 cron rows (coach/tip/newsletter) render on /admin/rag/cost
- Cost data reads from PostHog $ai_generation via admin-gated Edge Fn `rag-cost-query` (NO new `rag_cost_log` table — aligns with AI-SPEC §7 line 945)
- Auto-pause banner triggers when any vendor MTD ≥ cap (data from `rag_budget_caps` table, owned by 60-01)
- Acknowledge-and-resume button calls `rag_acknowledge_budget_cap(p_vendor)` SECDEF RPC (owned by 60-01)
- All 8 UI-SPEC critical invariants (Surface 3 + typography 4-size ceiling + dark mode parity + a11y) honored
- T-60-14-PII-1 mitigation enforced (no per-user fields leak from PostHog response — assert in cost-api.test.ts)
- 4 tasks deliver: 1 Edge Fn (Deno test only — deploy in 60-15) + 1 browser client + 1 net-new page + 1 surgical RagLayout edit
- Net 9 files modified; ~440 lines; estimated ~30% context per executor pass
</success_criteria>

<output>
Create `.planning/phases/60-rag-knowledge-base-completion-waves-2-4/60-14-SUMMARY.md` when done. Capture:
- 6 vendor card identifier strings + 3 trace-rollup identifier strings (verbatim — downstream emitters in 60-04..07, 60-11, 60-12 MUST match these labels)
- HogQL query shape used (parameterized; vendor allowlist server-side)
- Decision: no `rag_cost_log` table introduced — PostHog Query API is the source of truth per AI-SPEC §7
- Decision: full base RagCostPage built here (50-09 deferred; planner verified `CostPlaceholder` still in `RagLayout.tsx` at plan time)
- Edge Fn deployment deferred to 60-15 (per fn-deploy-before-cron-push rule)
- Any executor discoveries (Sparkline prop shape, super-admin RPC name actually used) — pin for downstream phases
</output>
