---
phase: 60-rag-knowledge-base-completion-waves-2-4
plan: 11
type: execute
wave: 2
depends_on: [60-01-data-layer-migrations, 60-02-shared-edge-helpers, 60-06-retrieval-and-rerank-fn, 60-08-admin-queue-ui]
files_modified:
  - leanshot/src/components/dashboard/cards/TipOfTheDayCard.tsx
  - leanshot/src/components/dashboard/cards/__tests__/TipOfTheDayCard.test.tsx
  - leanshot/src/components/dashboard/tabs/HomeTab.tsx
  - supabase/functions/rag-tip-of-day-generate/index.ts
  - supabase/functions/rag-tip-of-day-generate/prompt.ts
  - supabase/functions/rag-tip-of-day-generate/push-payload.ts
  - supabase/functions/rag-tip-of-day-generate/deno.json
  - supabase/functions/rag-tip-of-day-generate/__tests__/prompt.test.ts
  - supabase/functions/rag-tip-of-day-generate/__tests__/push-payload.test.ts
  - supabase/functions/rag-tip-of-day-generate/__tests__/index.test.ts
  - supabase/migrations/20261201000004_kb_tip_of_day_table.sql
  - leanshot/tests/e2e/tip-of-day.spec.ts
autonomous: true
requirements: [RAG-07]
user_setup: []
tags: [rag, tip-of-day, push-notifications, haiku, bento-card]

must_haves:
  truths:
    - "User on HomeTab sees a Tip-of-the-Day Bento card in the top-right slot (Card variant=elevated span=4) whenever there is an eligible chunk for today; if none, the slot returns null (no placeholder) per UI-SPEC §6 D-24 empty-state rule"
    - "The card renders verbatim per UI-SPEC §6: eyebrow (TIP OF THE DAY uppercase 11px + topic-tag Pill), 18px/600 headline (line-clamp-2), 13px/400 body (line-clamp-3), 11px footer attribution `{source_name} · As of {YYYY-MM-DD} · TierBadge`, 13px ghost `Open source ↗` link to `/knowledge/<topic>/<slug>`, 11px disclaimer `Not medical advice — consult your clinician.`, and a top-right RotateCcw IconButton with aria-label `Show another tip`"
    - "Tapping the card body or 'Open source ↗' deep-links to `/knowledge/<topic>/<slug>` (consumer route shipped in 60-13; before that route lands the link uses `/knowledge/<topic>/<slug>` and resolves once 60-13 ships — no broken click path because both are Wave 2/3 in the same phase)"
    - "Single tip per day deterministic per user — once `rag-tip-of-day-generate` writes a row to `kb_tip_of_day` for (date_utc, user_id) the card renders the same chunk on subsequent visits until UTC midnight rolls over, per CONTEXT.md decision"
    - "`rag-tip-of-day-generate` Edge Fn uses Anthropic Haiku `claude-haiku-4-5-20251001` (hyphenated per [[reference_anthropic_model_id_hyphenated_format]]) to synthesize a 1-sentence summary from a single reranked chunk, per AI-SPEC §4 cost lineup (~$0.005/run target via $0.80-in/$4-out pricing); does NOT use Sonnet"
    - "Per-user chunk selection calls the shared `_shared/rag-retrieve.ts` helper (Wave 0 60-02) which wraps `rag-retrieve` Edge Fn (60-06) — applies tier-A boost + freshness reweight + Cohere/Jina rerank + k≥5 floor — so tip-of-day eligibility honors the same retrieval pipeline as the coach"
    - "G8 k-anonymity floor enforced: chunks with `source_type IN ('leanshot_research','community') AND cohort_n < 5` are dropped BEFORE rerank (inherited from 60-06); the tip-of-day Fn additionally asserts `selected_chunk.cohort_n >= 5` when source_type is leanshot_research/community and refuses to write the row otherwise (logs `rag_kanon_floor_dropped` + `tip_of_day_skipped` to PostHog)"
    - "G1 PHARMA-02 3-layer invariant honored: the tip-of-day Fn calls the existing runtime helper from `src/lib/safety/pharma-02.ts` (Phase 39 39-02 D-06) to reject any chunk tagged with a PHARMA-02 carveout category BEFORE Haiku synthesis; CI grep gate already covers the response text via existing layer 3"
    - "Push payload built per UI-SPEC §7: title `Today's tip: {chunk_title_truncated_50}` (≤65 chars hard cap), body `{chunk_first_sentence_180} — LeanShot Research` (≤240 chars hard cap); push body MUST NOT contain dosing numbers, prescriptive verbs (`take|increase|decrease|stop|start`), or compounded-equivalence claims (`equivalent to (Ozempic|Wegovy|Mounjaro|Zepbound)` / `same as (FDA-approved|brand-name)`) — verified by `push-payload.ts` grep gate"
    - "Push dispatch via existing Phase 54 `push-dispatch` Edge Fn using new category `research_tips` (added to `VALID_CATEGORIES` const + seeded in `notification_category_config` via 60-01 migration); honors Phase 54 quiet-hours (22:00-08:00 user-local) + freq-cap (urgent_escalation=false, daily_cap, weekly_cap) per push-dispatch contract — tip is never PHI-category so payload includes title/body, no redaction"
    - "AI-SPEC §5 Dim #13 (personalization-appropriateness) enforced: regex grep on Haiku output rejects prescriptive verbs (`/^(take|increase|decrease|stop|start) /m`) and triggers a refusal-to-emit (log `rag_tip_synthesis_rejected` + skip write); the row is never written for that day rather than fall back to a prescriptive tip"
    - "AI-04 user-context fence honored: when the Fn synthesizes the per-user 1-sentence summary, the user's drug + active themes (from `profiles` join) are wrapped in `<user_data>...</user_data>` before injection into the Haiku prompt — never concatenated into instruction text"
    - "Cost guardrail: every Haiku call emits `$ai_generation` to PostHog via `_shared/posthog-rag-events.ts` (Wave 0 60-02); per-cron-run cost target ≤$0.50 enforced via `gateOrThrow(client, 'anthropic_tip_of_day')` against `rag_cost_ledger` (existing Phase 50-09 cost-ledger pattern); breach triggers Slack alert via `_shared/slack-guardrail-alert.ts`"
    - "Telemetry server-side via existing 50-08 Task 2 `server-rag-event-relay`: `rag_tip_impression` on card mount + `rag_tip_clicked` on `Open source ↗` tap — ad-block immune per [[reference_state_counter_table_needs_upsert_on_event]]-adjacent server-relay pattern"
  artifacts:
    - path: leanshot/src/components/dashboard/cards/TipOfTheDayCard.tsx
      provides: "Bento card top-right HomeTab slot rendering kb_tip_of_day row for current user/date"
      min_lines: 80
    - path: leanshot/src/components/dashboard/tabs/HomeTab.tsx
      provides: "Surgical edit to mount TipOfTheDayCard in top-right span={4} slot (existing file)"
      contains: "TipOfTheDayCard"
    - path: supabase/functions/rag-tip-of-day-generate/index.ts
      provides: "Edge Fn entry: per-user chunk selection (via rag-retrieve) → PHARMA-02 gate → Haiku synthesis → kb_tip_of_day INSERT → push-dispatch invocation"
      contains: "Deno.serve"
    - path: supabase/functions/rag-tip-of-day-generate/prompt.ts
      provides: "Haiku system+user prompt builders with AI-04 user_data fence and explicit 1-sentence + non-prescriptive contract"
      exports: ["buildTipSystemPrompt", "buildTipUserPrompt"]
    - path: supabase/functions/rag-tip-of-day-generate/push-payload.ts
      provides: "Push title/body builders with iOS/Android char-limit truncation + PHARMA-02/prescriptive-verb grep gate"
      exports: ["buildPushPayload", "PUSH_TITLE_MAX", "PUSH_BODY_MAX"]
    - path: supabase/functions/rag-tip-of-day-generate/deno.json
      provides: "Per-fn import map (CLI v2.101.0+ ignores --import-map flag)"
      contains: "@ai-sdk/anthropic"
    - path: supabase/migrations/20261201000004_kb_tip_of_day_table.sql
      provides: "kb_tip_of_day(id, user_id, date_utc, chunk_id, generated_at, push_dispatched_at) with UNIQUE(user_id,date_utc) + RLS SELECT for own row + SECDEF INSERT used by Fn"
      contains: "create table public.kb_tip_of_day"
    - path: leanshot/src/components/dashboard/cards/__tests__/TipOfTheDayCard.test.tsx
      provides: "vitest: render verbatim per UI-SPEC §6, null on no eligible chunk, impression event, reduced-motion skeleton"
    - path: supabase/functions/rag-tip-of-day-generate/__tests__/prompt.test.ts
      provides: "deno test: AI-04 fence shape + system-prompt non-prescriptive clause"
    - path: supabase/functions/rag-tip-of-day-generate/__tests__/push-payload.test.ts
      provides: "deno test: title/body truncation, prescriptive-verb rejection, PHARMA-02 grep gate, char limits"
    - path: supabase/functions/rag-tip-of-day-generate/__tests__/index.test.ts
      provides: "deno test: integration smoke (mocked Anthropic + mocked rag-retrieve + mocked push-dispatch) covering happy path + k-anon drop + PHARMA-02 drop + prescriptive-verb refusal-to-emit"
    - path: leanshot/tests/e2e/tip-of-day.spec.ts
      provides: "Playwright E2E: HomeTab mount → card visible with seeded chunk → tap Open-source navigates to /knowledge/<topic>/<slug>"
  key_links:
    - from: "leanshot/src/components/dashboard/tabs/HomeTab.tsx"
      to: "leanshot/src/components/dashboard/cards/TipOfTheDayCard.tsx"
      via: "JSX mount in top-right span={4} slot"
      pattern: "<TipOfTheDayCard"
    - from: "leanshot/src/components/dashboard/cards/TipOfTheDayCard.tsx"
      to: "public.kb_tip_of_day table"
      via: "supabase.from('kb_tip_of_day').select(...).eq('user_id', uid).eq('date_utc', today)"
      pattern: "kb_tip_of_day"
    - from: "supabase/functions/rag-tip-of-day-generate/index.ts"
      to: "supabase/functions/_shared/rag-retrieve.ts (60-02)"
      via: "shared HTTP client wrapper invocation"
      pattern: "import .* from .*_shared/rag-retrieve"
    - from: "supabase/functions/rag-tip-of-day-generate/index.ts"
      to: "supabase/functions/push-dispatch/index.ts (Phase 54)"
      via: "supabase.functions.invoke('push-dispatch', { body: { user_id, category: 'research_tips', payload } })"
      pattern: "push-dispatch"
    - from: "supabase/functions/rag-tip-of-day-generate/index.ts"
      to: "src/lib/safety/pharma-02.ts (Phase 39)"
      via: "runtime helper isPharma02Gated(chunk) BEFORE Haiku synthesis"
      pattern: "pharma-02|isPharma02Gated"
    - from: "supabase/functions/rag-tip-of-day-generate/index.ts"
      to: "supabase/functions/_shared/posthog-rag-events.ts (60-02)"
      via: "emitAiGeneration + emitTipImpressionServer events"
      pattern: "posthog-rag-events"
---

<objective>
Ship the Tip-of-the-Day Bento card on the consumer HomeTab AND the per-user `rag-tip-of-day-generate` Edge Fn that selects + synthesizes + persists today's tip and dispatches a push notification under the existing Phase 54 pipeline.

This plan delivers RAG-07 end-to-end except for the pg_cron schedule registration, which the BLOCKING 60-15 plan owns (per `[[feedback_fn_deploy_before_cron_db_push]]`: Fns deploy first, cron migration second, db push third). After 60-15 ships, the daily 00:00 UTC schedule will populate `kb_tip_of_day` rows for every active subscriber overnight.

Purpose: this is the END-USER PAYOFF of the RAG knowledge base on the home surface. A patient on tirzepatide opens the app, sees a one-sentence research insight cited verbatim from a Tier-A FDA label or peer-reviewed chunk, and taps through to the full `/knowledge/<topic>/<slug>` page (60-13). The push variant arrives during waking hours (Phase 54 quiet-hours honored) and respects the daily/weekly freq-cap so the user never gets spammed.

Output: 1 React card + 1 surgical HomeTab edit + 1 Edge Fn (4 files) + 1 migration + 4 test files + 1 Playwright E2E.

Out of scope (owned elsewhere): cron registration (60-15), public `/knowledge/<topic>/<slug>` route (60-13), reranker Fn (60-06), retrieval shared helper (60-02), 5 SECDEF state-machine RPCs (60-08).
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@leanshot/.planning/PROJECT.md
@leanshot/.planning/ROADMAP.md
@leanshot/.planning/STATE.md
@leanshot/.planning/phases/60-rag-knowledge-base-completion-waves-2-4/60-CONTEXT.md
@leanshot/.planning/phases/60-rag-knowledge-base-completion-waves-2-4/60-AI-SPEC.md
@leanshot/.planning/phases/60-rag-knowledge-base-completion-waves-2-4/60-UI-SPEC.md
@leanshot/.planning/phases/60-rag-knowledge-base-completion-waves-2-4/60-PLAN-OUTLINE.md

# REUSE TARGETS — read verbatim before writing card + Fn
@leanshot/.planning/phases/50-admin-curated-rag-knowledge-base-peptide-topic-research-scra/50-08-PLAN.md
@leanshot/src/lib/rag/tip-rotation.ts
@leanshot/src/lib/rag/retrieve-client.ts

# Existing files to surgically extend / mirror
@leanshot/src/components/dashboard/tabs/HomeTab.tsx
@leanshot/src/components/dashboard/cards/HeroCard.tsx
@leanshot/src/components/ui/Card.tsx
@leanshot/src/components/admin/rag/TierBadge.tsx
@supabase/functions/push-dispatch/index.ts
@supabase/functions/rag-scrape-runner/index.ts

<interfaces>
<!-- All extracted from existing codebase + Wave 0 60-02 contracts. Executor MUST use these directly. -->

From `supabase/functions/_shared/rag-retrieve.ts` (60-02 ships this; consume as-is):
```typescript
// Shared HTTP client for AI-coach + tip-of-day + newsletter
export interface RagRetrieveOptions {
  query: string;
  k?: number;          // default 8 (post-rerank)
  filters?: { topic_tag?: string; source_tier?: ('A'|'B'|'C')[]; user_drug?: string | null };
  user_id?: string;    // forwarded for per-user RLS context
}
export interface RagChunkResult {
  chunk_id: string;
  source_text_excerpt: string;
  summary: string;
  quote_blocks: Array<{ quote: string; kind: string; gloss?: string }>;
  canonical_url: string;
  scraped_at: string;       // ISO; freshness reweight already applied server-side
  evidence_date: string;    // YYYY-MM-DD
  source_tier: 'A'|'B'|'C';
  source_type: 'fda_label' | 'peer_reviewed' | 'clinical_guideline' | 'leanshot_curated' | 'leanshot_research' | 'community';
  topic_tag: string;
  topic_slug: string;       // for /knowledge/<topic>/<slug> deep-link
  source_name: string;
  source_domain: string;
  cohort_n: number | null;  // present only when source_type IN ('leanshot_research','community')
  final_score: number;      // post-rerank
  stale: boolean;           // computed: evidence_date older than per-source freshness window
}
export async function ragRetrieve(opts: RagRetrieveOptions): Promise<{ results: RagChunkResult[]; rerank_degraded: boolean }>;
```

From `supabase/functions/_shared/posthog-rag-events.ts` (60-02 ships this):
```typescript
export async function emitAiGeneration(args: { model: string; prompt_tokens: number; completion_tokens: number; usage_total_cost: number; trace_id: string; surface: 'tip_of_day' }): Promise<void>;
export async function emitTipImpressionServer(args: { user_id: string; chunk_id: string; topic_tag: string; source_tier: 'A'|'B'|'C' }): Promise<void>;
export async function emitRefusalEmitted(args: { reason: 'pharma_02_carveout' | 'kanon_floor' | 'prescriptive_verb' | 'no_chunk_eligible'; user_id: string; surface: 'tip_of_day' }): Promise<void>;
```

From `supabase/functions/_shared/slack-guardrail-alert.ts` (60-02 ships this):
```typescript
export async function alertSlack(channel: '#alerts-pharma02'|'#alerts-cost'|'#alerts-regulatory'|'#alerts-rag', message: string, properties?: Record<string, unknown>): Promise<void>;
```

From `src/lib/safety/pharma-02.ts` (Phase 39 39-02 D-06 — existing, do NOT modify):
```typescript
// Layer 2 of 3-layer invariant. Edge Fn version mirrored under supabase/functions/_shared/pharma-02.ts.
export function isPharma02Gated(chunk: { topic_tag: string; source_text_excerpt: string; quote_blocks: Array<{kind: string}> }): boolean;
```

From `supabase/functions/push-dispatch/index.ts` (Phase 54 — existing; consume contract):
```typescript
// POST { user_id: string, category: Category, payload: { title: string; body: string; deep_link?: string }, now?: string }
// Returns: { sent: number, failed: number, pruned: number, skipped_quiet_hours: boolean }
// Category enum: 'dose-reminders'|'ai-insights'|'clinic-alerts'|'billing'|'marketing'|'community-mentions'|
//   'community-replies'|'community-dm'|'community-admin-report'|'event_reminders_1d'|'event_reminders_1h'|
//   'event_promotion'|'banned_word_escalate'|'daily_community_digest'|'weekly_community_digest'|'helpdesk-reply'
// 60-01 EXTENDS this Set to include 'research_tips'; 60-11 Fn USES that category.
// Quiet hours 22:00–08:00 user-local automatically honored unless urgent_escalation=true (research_tips: false).
// daily_cap + weekly_cap from notification_category_config row enforced upstream.
```

From `src/components/ui/Card.tsx` (existing primitive):
```typescript
export interface CardProps {
  span?: 4 | 6 | 7 | 8 | 12;
  variant?: 'default' | 'elevated' | 'interactive' | 'hero' | 'flat';
  className?: string;
  children: React.ReactNode;
}
```

From `src/components/admin/rag/TierBadge.tsx` (Phase 50-02 — existing, reuse as-is):
```typescript
export function TierBadge({ tier }: { tier: 'A'|'B'|'C' }): JSX.Element;
```

From `src/lib/rag/tip-rotation.ts` (Phase 50-08 — existing helpers, reuse for client deterministic ordering when fallback needed):
```typescript
export function dayOfYear(date?: Date): number;
export function pickDailyTip<T>(chunks: T[], today?: Date): T | null;
export function buildTipQuery(userDrug: string | null, activeThemes: string[]): string;
export function filtersForUser(userDrug: string | null, activeThemes: string[]): { topic_tag?: string };
```

From `src/lib/rag/retrieve-client.ts` (Phase 50-08 — existing browser wrapper; the CARD reads `kb_tip_of_day` directly so retrieve-client is NOT called from the card path — Fn handles retrieval server-side):
```typescript
// Card-side: NOT used. Card reads kb_tip_of_day → joins chunk metadata via single RPC.
// Fn-side: not used (Fn calls _shared/rag-retrieve.ts instead).
```
</interfaces>

<copywriting>
Source: 60-UI-SPEC.md §Tip-of-Day Bento Card + §Tip-of-Day Push Notification — verbatim, do NOT paraphrase.

Card:
- Eyebrow: `TIP OF THE DAY` (uppercase, 11px, text-text-tertiary)
- Topic-tag Pill inline with eyebrow
- Headline: 18px/600 line-clamp-2 — first sentence of Haiku-generated summary
- Body: 13px/400 text-text-secondary line-clamp-3 — Haiku-generated summary remainder + first quote_block.quote if present
- Footer left: `{source_name} · As of {YYYY-MM-DD} · TierBadge` (11px/400)
- Footer right: `Open source ↗` ghost Button (13px/400 accent text)
- Bottom disclaimer: `Not medical advice — consult your clinician.` (11px/400 text-text-tertiary)
- Top-right `RotateCcw` lucide IconButton with `aria-label="Show another tip"` — when chunks_remaining_today > 0 calls Fn with `{ reroll: true }`; otherwise disabled
- Skeleton during fetch (existing `Skeleton` primitive, gated by useReducedMotion)
- Empty state: `return null` — card slot collapses; no placeholder text per UI-SPEC §6 D-24 rule

Push:
- Title template: `Today's tip: {chunk_title_truncated_50}` — hard cap 65 chars (iOS/Android)
- Body template: `{chunk_first_sentence_180} — LeanShot Research` — hard cap 240 chars
- Deep-link: `/knowledge/<topic>/<slug>`
- MUST NOT contain dosing numbers, prescriptive verbs (`/^(take|increase|decrease|stop|start) /i`), or equivalence claims (`/equivalent to (Ozempic|Wegovy|Mounjaro|Zepbound)/i`, `/same as (FDA-approved|brand-name)/i`). Grep gate rejects the entire payload (no fallback — skip push for today).
</copywriting>

</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: kb_tip_of_day migration + push category seed</name>
  <files>supabase/migrations/20261201000004_kb_tip_of_day_table.sql</files>
  <read_first>
    supabase/migrations/20260519000003_rag_chunks_table.sql (for kb_chunks FK target verification)
    supabase/migrations/20270704000002_notification_category_config.sql (for category-seed pattern)
    supabase/migrations/20270704000007_notification_category_config_seed.sql (for INSERT pattern of new category row)
  </read_first>
  <behavior>
    - Test 1 (deno test against in-memory pg fixture if available, else manual db diff check): `kb_tip_of_day` table exists with columns (id uuid pk, user_id uuid not null references auth.users(id), date_utc date not null, chunk_id uuid not null, generated_at timestamptz not null default now(), push_dispatched_at timestamptz null, source_tier text not null, topic_tag text not null, topic_slug text not null, headline text not null, body text not null, source_name text not null, evidence_date date not null, canonical_url text not null)
    - Test 2: UNIQUE(user_id, date_utc) constraint exists — second INSERT for same (user,date) raises 23505
    - Test 3: RLS enabled with policy `kb_tip_of_day_select_own` allowing `auth.uid() = user_id` on SELECT
    - Test 4: SECDEF function `public.write_kb_tip_of_day(p_user_id, p_date_utc, p_chunk_id, ...)` exists for Edge Fn use (Fn uses service_role anyway, but SECDEF wrapper enforces shape)
    - Test 5: Push category `research_tips` row seeded in `notification_category_config` with urgent_escalation=false, daily_cap=1, weekly_cap=7 (one tip/day max; 7/week)
    - Test 6 (Edge Fn change): the `VALID_CATEGORIES` Set in `supabase/functions/push-dispatch/index.ts` is NOT modified here — 60-01 owns that edit per outline; THIS plan only seeds the config row. If 60-01 has not yet shipped (chunked dispatch — sibling plan not yet executed), the migration file MUST include a `do $$ ... $$` block that INSERT-ON-CONFLICT-DO-NOTHINGs the row so re-running is idempotent.
  </behavior>
  <action>
    Write `supabase/migrations/20261201000004_kb_tip_of_day_table.sql`:

    1. `create extension if not exists pgcrypto;` (for gen_random_uuid).
    2. `create table if not exists public.kb_tip_of_day` with the column list from Test 1. `chunk_id` FK references `public.kb_chunks(id)` if that table exists (it does, per Phase 50-05 migration 20260519000003); use `on delete cascade`.
    3. `alter table public.kb_tip_of_day enable row level security;`
    4. `create policy kb_tip_of_day_select_own on public.kb_tip_of_day for select using (auth.uid() = user_id);` — NO insert/update/delete policies; only service_role + SECDEF wrapper write.
    5. `create unique index kb_tip_of_day_user_date_uniq on public.kb_tip_of_day(user_id, date_utc);`
    6. `create index kb_tip_of_day_chunk_id_idx on public.kb_tip_of_day(chunk_id);` (for chunk-retraction cascade lookups in 60-08).
    7. `create or replace function public.write_kb_tip_of_day(...)` SECDEF function in `public` schema that takes the 13 parameters + does INSERT…ON CONFLICT(user_id,date_utc) DO NOTHING and RETURNS uuid (the id, or null on conflict). `grant execute on function public.write_kb_tip_of_day(...) to service_role;` only — no anon/authenticated grants.
    8. Seed row for `notification_category_config`: `insert into public.notification_category_config (category, display_name, urgent_escalation, daily_cap, weekly_cap, phi_redaction, default_enabled) values ('research_tips', 'Research tips', false, 1, 7, false, true) on conflict (category) do nothing;` (column names match Phase 54 schema — verify in read_first).

    Migration filename `20261201000004_kb_tip_of_day_table.sql` follows the Phase 60 timestamp prefix declared in the outline (60-01 uses 20261201000001..3). NO cron schedules in this migration — that's 60-15's exclusive responsibility per [[feedback_fn_deploy_before_cron_db_push]].
  </action>
  <verify>
    <automated>cd /Users/karstenhaldan/minisite && grep -E "create table if not exists public\.kb_tip_of_day|unique index kb_tip_of_day_user_date_uniq|create policy kb_tip_of_day_select_own|create or replace function public\.write_kb_tip_of_day|'research_tips'" supabase/migrations/20261201000004_kb_tip_of_day_table.sql | grep -v '^--' | wc -l | grep -q '^[[:space:]]*5$' && echo "migration shape OK"</automated>
  </verify>
  <done>
    Migration file exists at the declared path with all 5 grep tokens present (table, unique index, RLS policy, SECDEF function, category seed). No `cron.schedule(` text in the file (verified `! grep -q "cron.schedule" supabase/migrations/20261201000004_kb_tip_of_day_table.sql`). File is NOT pushed in this plan — 60-15 BLOCKING task pushes all Phase 60 migrations after Fns deploy.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Push payload builder + grep gate (TDD RED→GREEN)</name>
  <files>supabase/functions/rag-tip-of-day-generate/push-payload.ts, supabase/functions/rag-tip-of-day-generate/__tests__/push-payload.test.ts, supabase/functions/rag-tip-of-day-generate/deno.json</files>
  <read_first>
    leanshot/.planning/phases/60-rag-knowledge-base-completion-waves-2-4/60-UI-SPEC.md (§Tip-of-Day Push Notification — char limits 65/240, prescriptive-verb gate)
    leanshot/.planning/phases/60-rag-knowledge-base-completion-waves-2-4/60-AI-SPEC.md (§5 Dim #13 + §6 G9 FDA-equivalence regex list)
    supabase/functions/push-dispatch/deno.json (for deno.json shape — mirror import-style)
  </read_first>
  <behavior>
    - Test 1: `buildPushPayload({ headline: 'Short title', body_first_sentence: 'A short informational sentence.', topic: 'glp1', slug: 'titration' })` returns `{ title: 'Today's tip: Short title', body: 'A short informational sentence. — LeanShot Research', deep_link: '/knowledge/glp1/titration' }`
    - Test 2: Title is truncated to 65 chars total (including `Today's tip: ` prefix which is 13 chars → chunk_title slice is 50 chars + ellipsis logic per UI-SPEC §7)
    - Test 3: Body is truncated to 240 chars total (180-char first-sentence slice + ` — LeanShot Research` 21-char suffix)
    - Test 4: When body contains a prescriptive verb at sentence start (`/^(take|increase|decrease|stop|start) /im`), `buildPushPayload` THROWS `Error("prescriptive_verb_rejected")` — caller catches and skips push for today
    - Test 5: When body contains an equivalence claim matching `/equivalent to (Ozempic|Wegovy|Mounjaro|Zepbound)/i` OR `/same as (FDA-approved|brand-name)/i`, THROWS `Error("equivalence_claim_rejected")`
    - Test 6: When body contains a numeric dose pattern matching `/\b\d+(\.\d+)?\s?(mg|mcg|units|iu)\b/i`, THROWS `Error("dose_number_in_push")`
    - Test 7: Exported constants `PUSH_TITLE_MAX = 65` and `PUSH_BODY_MAX = 240` match UI-SPEC §7 hard caps exactly
  </behavior>
  <action>
    First write `supabase/functions/rag-tip-of-day-generate/deno.json`:
    ```json
    {
      "tasks": { "test": "deno test --no-check --allow-env --allow-net ." },
      "imports": {
        "@ai-sdk/anthropic": "npm:@ai-sdk/anthropic@^1",
        "ai": "npm:ai@^4",
        "zod": "npm:zod@^3",
        "@supabase/supabase-js": "npm:@supabase/supabase-js@2"
      },
      "lint": { "rules": { "tags": ["recommended"] } }
    }
    ```
    Per-fn import map because supabase CLI v2.101.0+ silently ignores `--import-map` per [[reference_supabase_functions_deploy_import_map_flag]].

    Write `push-payload.test.ts` FIRST (RED): 7 test cases above using `Deno.test(...)` + `assertEquals` + `assertThrows` from `jsr:@std/assert`.

    Then write `push-payload.ts` (GREEN):
    - `export const PUSH_TITLE_MAX = 65;`
    - `export const PUSH_BODY_MAX = 240;`
    - `export const TITLE_PREFIX = "Today's tip: ";`
    - `export const BODY_SUFFIX = ' — LeanShot Research';`
    - Regex consts:
      - `PRESCRIPTIVE_VERB_RE = /^(take|increase|decrease|stop|start) /im`
      - `EQUIVALENCE_RE = /(equivalent to (Ozempic|Wegovy|Mounjaro|Zepbound)|same as (FDA-approved|brand-name))/i`
      - `DOSE_NUMBER_RE = /\b\d+(\.\d+)?\s?(mg|mcg|units|iu)\b/i`
    - `export function buildPushPayload(args: { headline: string; body_first_sentence: string; topic: string; slug: string }): { title: string; body: string; deep_link: string }` — performs all three grep checks against `body_first_sentence`, then truncates the headline to fit `PUSH_TITLE_MAX - TITLE_PREFIX.length = 52` chars (52 chars + 13 prefix = 65), truncates body_first_sentence to fit `PUSH_BODY_MAX - BODY_SUFFIX.length = 219` chars, ellipsizes with single `…` char (1 byte budget).
    - Throws are typed via `class TipPayloadRejected extends Error { constructor(public reason: 'prescriptive_verb_rejected'|'equivalence_claim_rejected'|'dose_number_in_push') { super(reason); } }` — caller branches on `.reason`.

    Confirm RED→GREEN by running `deno test` from the fn directory.
  </action>
  <verify>
    <automated>cd /Users/karstenhaldan/minisite/supabase/functions/rag-tip-of-day-generate && $HOME/.deno/bin/deno test --no-check --allow-env push-payload.test.ts 2>&1 | tail -5 | grep -q "ok"</automated>
  </verify>
  <done>
    deno test green; all 7 push-payload behaviors verified; `PUSH_TITLE_MAX=65` and `PUSH_BODY_MAX=240` match UI-SPEC §7 exactly; three grep-gate regexes match AI-SPEC §6 G1 + G9 + Dim #13 patterns exactly. `deno.json` per-fn import map written (NOT a repo-root import_map.json).
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 3: Haiku prompt builders with AI-04 fence (TDD RED→GREEN)</name>
  <files>supabase/functions/rag-tip-of-day-generate/prompt.ts, supabase/functions/rag-tip-of-day-generate/__tests__/prompt.test.ts</files>
  <read_first>
    leanshot/.planning/phases/60-rag-knowledge-base-completion-waves-2-4/60-AI-SPEC.md (§4 Implementation Guidance — buildSynthesisSystemPrompt pattern + AI-04 fence + token budgets)
    supabase/functions/ai-chat/index.ts (existing AI-04 fence pattern — Phase 4 D-02; mirror, do NOT diverge)
    leanshot/.planning/phases/60-rag-knowledge-base-completion-waves-2-4/60-UI-SPEC.md (§Tip-of-Day Bento Card — informational not prescriptive)
  </read_first>
  <behavior>
    - Test 1: `buildTipSystemPrompt(chunk)` includes the literal substring `<chunk id="${chunk.chunk_id}"` exactly once
    - Test 2: System prompt contains the literal clause `informational, NOT prescriptive` AND the clause `1 sentence, max 30 words` (verbatim per AI-SPEC §5 Dim #13)
    - Test 3: System prompt contains the literal clause `must be a verbatim substring of the chunk text` (citation-faithfulness echo from AI-SPEC §4)
    - Test 4: `buildTipUserPrompt({ user_drug: 'tirzepatide', active_themes: ['muscle-loss'], query: 'summarize one insight' })` wraps user_drug + active_themes in `<user_data>...</user_data>` fences — assert regex `/<user_data>\n[\s\S]*tirzepatide[\s\S]*muscle-loss[\s\S]*<\/user_data>/`
    - Test 5: User prompt with `user_drug: null, active_themes: []` produces a prompt WITHOUT `<user_data>` fences (no PII to fence; bare query only)
    - Test 6: System prompt token budget — `buildTipSystemPrompt(typicalChunk)` returns string with `.length / 4 < 1200` (rough token estimate; bounded per AI-SPEC §4 ~1,200 token budget for system prompt)
  </behavior>
  <action>
    Write `prompt.test.ts` FIRST (RED).

    Then write `prompt.ts`:
    - `import type { RagChunkResult } from '../_shared/rag-retrieve.ts';`
    - `export function buildTipSystemPrompt(chunk: RagChunkResult): string` — multi-line template literal:
      ```
      You are LeanShot's evidence-grounded tip-of-the-day writer.

      Write ONE sentence (max 30 words) that summarizes the most useful insight from the chunk below for a GLP-1 patient.

      RULES:
      - informational, NOT prescriptive (NEVER use verbs: take, increase, decrease, stop, start in imperative mood)
      - NEVER mention specific dose numbers (mg, mcg, units, IU)
      - NEVER claim a compounded drug is equivalent to Ozempic/Wegovy/Mounjaro/Zepbound or "the same as" any FDA-approved drug
      - The sentence must be a verbatim substring of the chunk text OR a faithful paraphrase that contains NO claim absent from the chunk
      - End with a period
      - Do NOT include a citation marker; the chunk_id is implicit

      <chunk id="${chunk.chunk_id}" tier="${chunk.source_tier}" date="${chunk.evidence_date}">
      ${chunk.source_text_excerpt}
      </chunk>
      ```
    - `export function buildTipUserPrompt(args: { user_drug: string | null; active_themes: string[]; query?: string }): string` — when `user_drug` or `active_themes.length > 0`, wraps `drug: ${user_drug}\nthemes: ${active_themes.join(', ')}` in `<user_data>...</user_data>` fences (Phase 4 D-02 AI-04 invariant, mirrored from ai-chat). Concatenates with the optional query (default `'Write today's tip.'`).
    - Per [[reference_anthropic_model_id_hyphenated_format]] the model ID `claude-haiku-4-5-20251001` is consumed by `index.ts` Task 4, NOT this file — keep prompt builder model-agnostic.
  </action>
  <verify>
    <automated>cd /Users/karstenhaldan/minisite/supabase/functions/rag-tip-of-day-generate && $HOME/.deno/bin/deno test --no-check --allow-env __tests__/prompt.test.ts 2>&1 | tail -5 | grep -q "ok"</automated>
  </verify>
  <done>
    All 6 prompt behaviors verified via deno test. System prompt contains all three load-bearing clauses (informational/not prescriptive, 1-sentence/30-word cap, verbatim-substring contract). User prompt AI-04 fence shape matches the existing ai-chat pattern exactly (assert by side-by-side comparison during executor write).
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 4: Edge Fn index.ts — orchestrate retrieve → gate → synth → write → push</name>
  <files>supabase/functions/rag-tip-of-day-generate/index.ts, supabase/functions/rag-tip-of-day-generate/__tests__/index.test.ts</files>
  <read_first>
    supabase/functions/rag-tip-of-day-generate/prompt.ts (this plan, Task 3)
    supabase/functions/rag-tip-of-day-generate/push-payload.ts (this plan, Task 2)
    supabase/functions/ai-chat/index.ts (Anthropic SDK pattern, JWT auth pattern, EdgeRuntime.waitUntil)
    supabase/functions/push-dispatch/index.ts (POST body shape + category enum)
    leanshot/.planning/phases/60-rag-knowledge-base-completion-waves-2-4/60-AI-SPEC.md (§3 entry point pattern + §4 cost guardrail + §6 G1/G3/G4/G6/G8)
  </read_first>
  <behavior>
    - Test 1 (mocked happy path): given a stubbed `ragRetrieve` returning 5 Tier-A chunks with no PHARMA-02 flags, a stubbed Anthropic returning `"GLP-1 receptor agonists slow gastric emptying, which can affect oral medication absorption."`, and a stubbed `push-dispatch` returning `{sent: 1, failed: 0, pruned: 0, skipped_quiet_hours: false}`: Fn returns 200 with `{ wrote: true, chunk_id: <uuid>, push_dispatched: true, refusal_reason: null }`. INSERT to `kb_tip_of_day` called via SECDEF function with the resolved row.
    - Test 2 (k-anon drop): stubbed ragRetrieve returns one `leanshot_research` chunk with `cohort_n: 3`. Fn does NOT call Anthropic, does NOT INSERT, returns 200 with `{ wrote: false, refusal_reason: 'kanon_floor' }`. `emitRefusalEmitted` called with `reason: 'kanon_floor'`.
    - Test 3 (PHARMA-02 drop): stubbed ragRetrieve returns chunk with topic_tag `compounded_glp1_dosing` (matches `isPharma02Gated`). Fn does NOT call Anthropic, returns 200 with `{ wrote: false, refusal_reason: 'pharma_02_carveout' }`. `alertSlack('#alerts-pharma02', ...)` called.
    - Test 4 (prescriptive-verb refusal-to-emit): stubbed Anthropic returns `"Take 0.5mg weekly to start."`. `buildPushPayload` throws `prescriptive_verb_rejected` AND/OR `dose_number_in_push`. Fn does NOT INSERT (the kb_tip row tracks the chunk_id but the body content fails validation → skip entire day to avoid persisting prescriptive copy). Returns 200 with `{ wrote: false, refusal_reason: 'prescriptive_verb' }`. `emitRefusalEmitted` + `alertSlack('#alerts-rag', ...)` called.
    - Test 5 (out-of-corpus drop): stubbed ragRetrieve returns `{ results: [] }`. Fn returns 200 with `{ wrote: false, refusal_reason: 'no_chunk_eligible' }`. No Anthropic call.
    - Test 6 (cost gate breach): stubbed `gateOrThrow` throws 429. Fn returns 429 with `{ error: 'cost_envelope_breached' }`. `alertSlack('#alerts-cost', ...)` called.
    - Test 7 (idempotency): second invocation for the same `(user_id, date_utc)` hits the SECDEF write_kb_tip_of_day ON CONFLICT DO NOTHING → returns 200 with `{ wrote: false, refusal_reason: 'already_written' }`. No Anthropic call (Fn checks for existing row FIRST via `select id from kb_tip_of_day where user_id=$1 and date_utc=$2` → short-circuit).
    - Test 8 (auth): Fn requires service-role bearer (cron path) OR a JWT with `service_role` claim. Anon/authenticated JWTs return 401.
    - Test 9 (Deno.serve guarded): file ends with `if (import.meta.main) Deno.serve(handler);` per [[reference_deno_test_top_level_serve_trap]] — verified by importing the module from the test file without triggering serve.
  </behavior>
  <action>
    Write `__tests__/index.test.ts` FIRST (RED) — uses dependency-injection pattern: export a `handle(req, deps)` function where `deps = { ragRetrieve, anthropicGenerate, supabase, pushDispatch, gateOrThrow, emitAiGeneration, emitRefusalEmitted, alertSlack, now }` so tests can stub all 9 deps. The real `Deno.serve` entry calls `handle(req, getProductionDeps())`.

    Then write `index.ts`:
    1. Imports: `import { generateText } from 'ai'; import { createAnthropic } from '@ai-sdk/anthropic'; import { createClient } from '@supabase/supabase-js'; import { z } from 'zod';` plus `import { ragRetrieve } from '../_shared/rag-retrieve.ts'; import { emitAiGeneration, emitRefusalEmitted, emitTipImpressionServer } from '../_shared/posthog-rag-events.ts'; import { alertSlack } from '../_shared/slack-guardrail-alert.ts'; import { isPharma02Gated } from '../_shared/pharma-02.ts'; import { gateOrThrow, logVendorCost } from '../_shared/cost-ledger.ts';` plus local `import { buildTipSystemPrompt, buildTipUserPrompt } from './prompt.ts'; import { buildPushPayload, TipPayloadRejected } from './push-payload.ts';`
    2. Constants: `const SYNTH_MODEL = 'claude-haiku-4-5-20251001';` (hyphenated per [[reference_anthropic_model_id_hyphenated_format]]); `const COST_VENDOR = 'anthropic_tip_of_day';`
    3. Request body zod schema: `const BodySchema = z.object({ user_id: z.string().uuid(), date_utc: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), reroll: z.boolean().optional() });`
    4. Auth: extract `Authorization: Bearer <token>` from req; verify the token is `SUPABASE_SERVICE_ROLE_KEY` via `constantTimeEqual` (Phase 38 D-? helper) — this Fn is service-role-only because it iterates active subscribers from cron context. Return 401 if not.
    5. `export async function handle(req, deps)` flow:
       a. Parse + validate body.
       b. Short-circuit: `select id from kb_tip_of_day where user_id=$1 and date_utc=$2 limit 1` — if exists AND `!reroll`, return `{ wrote: false, refusal_reason: 'already_written' }`.
       c. Cost gate: `await deps.gateOrThrow(client, COST_VENDOR)` → catch 429 → `alertSlack('#alerts-cost', ...)` → return 429.
       d. Load user profile (`drug, active_themes`) from `profiles` table.
       e. `const { results, rerank_degraded } = await deps.ragRetrieve({ query: buildTipQueryFromProfile(profile), k: 5, filters: { topic_tag: profile.active_themes[0], source_tier: ['A','B'], user_drug: profile.drug }, user_id });`
       f. If `results.length === 0` → emit refusal, return.
       g. Pick first result (rerank already ordered). If `chunk.source_type IN ('leanshot_research','community') && chunk.cohort_n < 5` → kanon drop refusal.
       h. If `deps.isPharma02Gated(chunk)` → pharma_02 refusal + Slack alert.
       i. Build prompts; call `generateText({ model: anthropic(SYNTH_MODEL), system: buildTipSystemPrompt(chunk), prompt: buildTipUserPrompt({ user_drug: profile.drug, active_themes: profile.active_themes }), maxTokens: 200, temperature: 0.1, abortSignal: AbortSignal.timeout(15_000) })` — Haiku budget per AI-SPEC §4.
       j. `await deps.emitAiGeneration({ model: SYNTH_MODEL, prompt_tokens: usage.promptTokens, completion_tokens: usage.completionTokens, usage_total_cost: estimateCost(...), trace_id, surface: 'tip_of_day' });` + `await deps.logVendorCost(client, { vendor: COST_VENDOR, amountUsd: ..., action: 'tip_of_day_generate' });`
       k. Extract headline + body_first_sentence from Haiku output (split on first period; headline = first sentence; body = full text).
       l. Try `const payload = deps.buildPushPayload({ headline, body_first_sentence, topic: chunk.topic_tag, slug: chunk.topic_slug });` — catch `TipPayloadRejected` → emit refusal + skip both INSERT and push, return.
       m. INSERT row via SECDEF: `await client.rpc('write_kb_tip_of_day', { p_user_id, p_date_utc, p_chunk_id, p_source_tier, p_topic_tag, p_topic_slug, p_headline, p_body, p_source_name, p_evidence_date, p_canonical_url });`
       n. Invoke push: `await deps.pushDispatch.invoke('push-dispatch', { body: { user_id, category: 'research_tips', payload: { title: payload.title, body: payload.body, deep_link: payload.deep_link } } });` — Phase 54 honors quiet-hours + daily_cap=1 automatically.
       o. Update row: `update kb_tip_of_day set push_dispatched_at = now() where id = $1` (best-effort; failure does not roll back the tip).
       p. Return `{ wrote: true, chunk_id: chunk.chunk_id, push_dispatched: true, refusal_reason: null }`.
    6. Bottom: `if (import.meta.main) Deno.serve((req) => handle(req, getProductionDeps()));` per [[reference_deno_test_top_level_serve_trap]] — guards top-level serve so deno tests can import module without binding a port.

    Per [[reference_deno_test_top_level_serve_trap]] the project's existing Deno fns DO NOT all honor this guard; the precedent is broken, but new Phase 60 Fns MUST adopt the guard per outline §"Deno test top-level serve trap" cross-cutting constraint.
  </action>
  <verify>
    <automated>cd /Users/karstenhaldan/minisite/supabase/functions/rag-tip-of-day-generate && $HOME/.deno/bin/deno test --no-check --allow-env --allow-net __tests__/index.test.ts 2>&1 | tail -10 | grep -q "ok"</automated>
  </verify>
  <done>
    All 9 index.test.ts behaviors green. Module file ends with `if (import.meta.main) Deno.serve(...)`. No top-level `Deno.serve` (verified `grep -c "^Deno.serve" index.ts` equals 0; only the guarded form matches `if (import.meta.main) Deno.serve`). Model ID is hyphenated `claude-haiku-4-5-20251001`. Cost-ledger gate present BEFORE Anthropic call (gateOrThrow on line < generateText line in source).
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 5: TipOfTheDayCard component + HomeTab mount</name>
  <files>leanshot/src/components/dashboard/cards/TipOfTheDayCard.tsx, leanshot/src/components/dashboard/cards/__tests__/TipOfTheDayCard.test.tsx, leanshot/src/components/dashboard/tabs/HomeTab.tsx</files>
  <read_first>
    leanshot/.planning/phases/60-rag-knowledge-base-completion-waves-2-4/60-UI-SPEC.md (§Tip-of-Day Bento Card — copywriting + typography 4-size ceiling + reduced-motion)
    leanshot/src/components/dashboard/tabs/HomeTab.tsx (existing bento layout — surgical edit only)
    leanshot/src/components/dashboard/cards/HeroCard.tsx (reference for Card variant=elevated usage + skeleton pattern)
    leanshot/src/components/ui/Card.tsx (primitive)
    leanshot/src/components/admin/rag/TierBadge.tsx (reuse as-is)
    leanshot/src/hooks/useReducedMotion.ts (existing — gate skeleton shimmer)
  </read_first>
  <behavior>
    - Test 1: with a seeded `kb_tip_of_day` row for `(currentUserId, today)`, renders `[data-testid="tip-of-day-card"]` containing the eyebrow text `TIP OF THE DAY`, topic-tag Pill, headline `text-lg font-semibold line-clamp-2`, body `text-sm text-text-secondary line-clamp-3`, footer attribution `{source_name} · As of {evidence_date} · TierBadge`, `Open source ↗` link with `href` equal to `/knowledge/{topic_tag}/{topic_slug}`, and the literal disclaimer `Not medical advice — consult your clinician.` in `text-micro text-text-tertiary`.
    - Test 2: when no `kb_tip_of_day` row exists for today, component returns `null` — DOM does not contain `[data-testid="tip-of-day-card"]` (UI-SPEC §6 D-24).
    - Test 3: while fetching, renders `[data-testid="tip-of-day-skeleton"]` with shimmer animation; under `useReducedMotion()` mock returning true, skeleton renders WITHOUT animation class (matches existing `Skeleton` primitive prop contract).
    - Test 4: on mount, fires `rag_tip_impression` via `supabase.functions.invoke('server-rag-event-relay', { body: { event: 'rag_tip_impression', properties: { chunk_id, topic_tag, source_tier, surface: 'home_bento' }, distinct_id: user_id } })` — assert mock called exactly once.
    - Test 5: clicking `Open source ↗` fires `rag_tip_clicked` via the same server-rag-event-relay path and navigates to `/knowledge/{topic_tag}/{topic_slug}` (use `<a href>` not router; consumer router consumes `/knowledge/*` per [[reference_react_router_consumer_admin_split]] in 60-13).
    - Test 6: HomeTab.tsx surgical edit — the existing top-right bento slot is replaced with `<TipOfTheDayCard />` while preserving the rest of the grid (regression-safe: count of `<Card>` siblings unchanged or +1; existing tab tests still pass).
    - Test 7: Typography ceiling — no `text-base` or `text-md` Tailwind classes in TipOfTheDayCard.tsx (UI-SPEC §11 critical invariant). Grep gate: `grep -E "text-(base|md)\\b" TipOfTheDayCard.tsx | wc -l` returns 0.
  </behavior>
  <action>
    Write `__tests__/TipOfTheDayCard.test.tsx` FIRST (RED) using `@testing-library/react` + `vitest` + `@supabase/supabase-js` mock per Phase 50-08 50-08-PLAN.md Task 6 pattern.

    Then write `TipOfTheDayCard.tsx`:
    - `'use client';`-style top (project uses no SSR but mirror file headers from Phase 50-08 50-08 Task 5).
    - State: `const [row, setRow] = useState<KbTipOfDayRow | null>(null); const [loading, setLoading] = useState(true);`
    - useEffect on mount: `supabase.from('kb_tip_of_day').select('chunk_id, headline, body, source_name, source_tier, evidence_date, canonical_url, topic_tag, topic_slug').eq('user_id', userId).eq('date_utc', formatDateUtc(new Date())).maybeSingle()` → setRow; on row found, fire `rag_tip_impression` server event.
    - If `loading` → render `<Card variant="elevated" span={4} data-testid="tip-of-day-skeleton"><Skeleton lines={3} animated={!reducedMotion} /></Card>`.
    - If `!row` → `return null;` (UI-SPEC §6 D-24 empty-state rule).
    - Else render `<Card variant="elevated" span={4} data-testid="tip-of-day-card">` with:
      - Top eyebrow row: `<div class="flex items-center gap-2"><span class="text-micro uppercase tracking-wider text-text-tertiary">TIP OF THE DAY</span><Pill tone="neutral" className="text-micro">{row.topic_tag}</Pill><RotateCcw className="ml-auto opacity-60 cursor-not-allowed" aria-label="Show another tip" aria-disabled="true" /></div>` — reroll button disabled at MVP (cron writes one row per day; manual reroll requires re-invoking Fn with `reroll: true` — deferred to v1.5 per CONTEXT.md `Single tip per day` decision).
      - Headline `<h3 class="text-lg font-semibold line-clamp-2">{row.headline}</h3>`.
      - Body `<p class="text-sm text-text-secondary line-clamp-3">{row.body}</p>`.
      - Footer `<div class="mt-md flex items-center justify-between gap-2"><span class="text-micro text-text-tertiary">{row.source_name} · As of {row.evidence_date} · <TierBadge tier={row.source_tier} /></span><a href={\`/knowledge/${row.topic_tag}/${row.topic_slug}\`} class="text-sm text-primary inline-flex items-center gap-1" onClick={() => emitClicked(row)}>Open source <ExternalLink class="w-3 h-3" /></a></div>`.
      - Bottom `<p class="text-micro text-text-tertiary mt-sm">Not medical advice — consult your clinician.</p>`.
    - NO Fraunces / display-font usage (UI-SPEC §Typography — Fraunces is index/root-page-only).
    - NO `text-base` / `text-md` classes — only 11/13/18px tokens (UI-SPEC §11 ceiling).

    Surgical edit of `HomeTab.tsx`:
    - Locate the bento grid JSX; insert `<TipOfTheDayCard />` in the top-right span={4} slot per outline row "(`<Card variant="elevated" span={4}>` top-right of HomeTab)".
    - Add lazy import to preserve code-split discipline per CLAUDE.md "Lazy-loaded route-equivalents" — `const TipOfTheDayCard = lazy(() => import('@/components/dashboard/cards/TipOfTheDayCard'));` and wrap in existing `<Suspense fallback={...}>` boundary.

    Server event relay calls go through existing 50-08 Task 2 `supabase/functions/server-rag-event-relay/index.ts` — no new Fn here.
  </action>
  <verify>
    <automated>cd /Users/karstenhaldan/minisite/leanshot && npx vitest run --config vite.config.ts src/components/dashboard/cards/__tests__/TipOfTheDayCard.test.tsx 2>&1 | tail -5 | grep -qE "(passed|PASS)" && grep -vE "^\s*//" src/components/dashboard/cards/TipOfTheDayCard.tsx | grep -cE "text-(base|md)\\b" | grep -q '^0$' && npm run typecheck 2>&1 | tail -3 | grep -qE "(Compilation complete|0 errors|^$)"</automated>
  </verify>
  <done>
    All 7 vitest behaviors green. Typography ceiling verified (no `text-base`/`text-md` in committed file, excluding comments per [[feedback_negation_grep_defeated_by_comment_string]]). Disclaimer string `Not medical advice — consult your clinician.` present verbatim. HomeTab.tsx contains `<TipOfTheDayCard />` import + JSX mount. Existing HomeTab tests still pass (regression check). Uses Vitest 4.x project-config bypass per [[reference_vitest_4_projects_config_masks_default]] (`--config vite.config.ts`).
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 6: Playwright E2E — HomeTab mount → tap → /knowledge/ link</name>
  <files>leanshot/tests/e2e/tip-of-day.spec.ts</files>
  <read_first>
    leanshot/tests/e2e/ (existing E2E setup — auth seed pattern from Phase 50-08 e2e/tip-of-day.spec.ts is a reference but NOT this file)
    leanshot/.planning/phases/50-admin-curated-rag-knowledge-base-peptide-topic-research-scra/50-08-PLAN.md Task 6 (existing 50-08 e2e/tip-of-day.spec.ts pattern to mirror)
  </read_first>
  <behavior>
    - Spec gated via env var `PLAYWRIGHT_RUN_P60_TIP_OF_DAY=1` (mirrors Phase 50-08 convention).
    - Seed step (server-side via Supabase service client): create test user with `drug='tirzepatide', active_themes=['muscle-loss']`; INSERT a row in `kb_chunks` (Tier A, source_name='FDA label', topic_tag='muscle-loss', topic_slug='muscle-loss-glp1', evidence_date today-30d, canonical_url='https://example.test/x'); INSERT a row in `kb_tip_of_day` keyed to (test_user_id, today) referencing that chunk with headline/body strings.
    - Test 1: Navigate to `/home`; expect `[data-testid="tip-of-day-card"]` visible; expect text `TIP OF THE DAY`, the seeded headline, the seeded source_name, and the disclaimer verbatim.
    - Test 2: Click `Open source ↗` link; expect URL change to `/knowledge/muscle-loss/muscle-loss-glp1` (the route returns 404 until 60-13 ships; spec asserts URL change only, not 200 status, per the deferred-to-60-13 constraint). Document this in spec comment.
    - Test 3: When `kb_tip_of_day` row is DELETED for today and page reloaded, `[data-testid="tip-of-day-card"]` is NOT in DOM (D-24 empty state).
    - Test 4: a11y — `RotateCcw` button has `aria-label="Show another tip"` AND `aria-disabled="true"` (MVP no-reroll); `Open source ↗` link has visible focus ring on keyboard tab traversal.
  </behavior>
  <action>
    Write `tip-of-day.spec.ts` mirroring Phase 50-08 50-08 Task 6 e2e/tip-of-day.spec.ts pattern:
    - `import { test, expect } from '@playwright/test';`
    - `test.skip(!process.env.PLAYWRIGHT_RUN_P60_TIP_OF_DAY, 'gated by PLAYWRIGHT_RUN_P60_TIP_OF_DAY=1');`
    - `test.beforeAll` seeds DB via `createClient(serviceRoleKey)` + INSERTs.
    - `test.afterAll` cleans up (DELETE seeded rows).
    - 4 `test(...)` cases above using `page.goto`, `page.getByTestId`, `page.getByText`, `page.getByRole`.
    - Spec comment block declares "Route /knowledge/<topic>/<slug> resolves to 200 only after 60-13 ships; this spec asserts URL navigation only, per cross-plan dependency."
  </action>
  <verify>
    <automated>cd /Users/karstenhaldan/minisite/leanshot && PLAYWRIGHT_RUN_P60_TIP_OF_DAY=1 npx playwright test tests/e2e/tip-of-day.spec.ts --reporter=list 2>&1 | tail -10 | grep -qE "(passed|all tests pass)"</automated>
  </verify>
  <done>
    Playwright spec compiles and runs green under the gate env var. URL-navigation assertion passes without requiring 60-13 route to exist. Skeleton/empty-state behavior visually verified via the spec's third case.
  </done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| consumer-browser → Edge Fn `rag-tip-of-day-generate` | NOT crossed in this plan — Fn is service-role-only (cron callable). Browser reads `kb_tip_of_day` via Supabase RLS. |
| service-role cron → Edge Fn `rag-tip-of-day-generate` | Crossed every 24h by 60-15 cron. Bearer = `SUPABASE_SERVICE_ROLE_KEY` (Phase 38 sb_secret_* format per [[reference_supabase_service_role_key_format_divergence]]). |
| Edge Fn → Anthropic (Vercel AI Gateway) | Crossed on every Haiku synthesis. user_drug + active_themes wrapped in `<user_data>` AI-04 fence. |
| Edge Fn → push-dispatch (sibling Edge Fn) | Crossed when push payload validates. Phase 54 enforces quiet-hours + freq-cap. |
| browser → server-rag-event-relay | Crossed on card mount + Open-source click. Auth = anon JWT; relay forwards to PostHog server-side. |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-60-11-01 | Information Disclosure | `rag-tip-of-day-generate` Haiku synthesis | mitigate | AI-04 fence in `buildTipUserPrompt`: user_drug + active_themes wrapped in `<user_data>...</user_data>` so they cannot be interpreted as instructions. Mirrors existing ai-chat Phase 4 D-02 invariant. |
| T-60-11-02 | Tampering | Haiku output → push body | mitigate | `buildPushPayload` runs three regex gates: prescriptive-verb, equivalence-claim, dose-number. Throws typed error → Fn skips INSERT + push for the day (fail-closed). Extends Phase 39 39-02 D-06 layer 3. |
| T-60-11-03 | Information Disclosure (k-anon breach) | `kb_tip_of_day` content from `leanshot_research`/`community` chunks | mitigate | Fn asserts `chunk.cohort_n >= 5` for those source_types BEFORE Haiku synthesis (G8). Inherits rag-retrieve k-anon floor from 60-06; Fn adds defense-in-depth assert. Logs `rag_kanon_floor_dropped`. |
| T-60-11-04 | Elevation of Privilege | `kb_tip_of_day` write path | mitigate | INSERT is service-role-only via SECDEF `public.write_kb_tip_of_day(...)`. RLS denies all anon/authenticated writes. Read policy `kb_tip_of_day_select_own` enforces `auth.uid() = user_id`. |
| T-60-11-05 | Spoofing | Fn invocation auth | mitigate | Fn requires `Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>` via constant-time compare per [[reference_supabase_service_role_key_format_divergence]]. Non-service-role JWTs return 401. |
| T-60-11-06 | Denial of Service / Cost runaway | Anthropic Haiku spend | mitigate | `gateOrThrow(client, 'anthropic_tip_of_day')` BEFORE every Haiku call against `rag_cost_ledger` rolling 24h sum. Per-cron-run cap $0.50 enforced (AI-SPEC §4 cost lineup). Breach → Slack `#alerts-cost` + cron auto-pause via existing 50-09 flow. |
| T-60-11-07 | Information Disclosure (PHARMA-02 breach) | Push notification content | mitigate | 3-layer invariant: (1) ESLint AST rule in src/lib/safety/pharma-02.ts blocks new files from reading carveout fields outside sibling helpers (project-wide, already in place); (2) `isPharma02Gated(chunk)` runtime check BEFORE Haiku call; (3) CI grep gate scans response corpus for carveout-leaking strings. Push-payload.ts adds Layer-3 mirror with dose-number / equivalence-claim regex. Phase 39 39-02 D-06 precedent. |
| T-60-11-08 | Tampering | `notification_category_config` row for `research_tips` | accept | Row is service-role-write-only (existing RLS on the table). `daily_cap=1` + `weekly_cap=7` enforced upstream by push-dispatch. Admin UI in 60-09/68 may edit later; out of scope here. |
| T-60-11-SC | Tampering | npm install (`@ai-sdk/anthropic`, `ai`, `cohere-ai`, `zod`) | mitigate | Packages already audited in Phase 50-07 Package Legitimacy Audit (RESEARCH.md). Edge Fn imports via `npm:` specifier in per-fn `deno.json` — Deno's `npm:` lockfile attests integrity. No new packages added in this plan beyond what 50-07/60-05 already ship. |
| T-60-11-XSS | Tampering | Card body rendering | mitigate | `row.headline` and `row.body` are rendered as text content (React auto-escapes); never `dangerouslySetInnerHTML`. The Haiku-generated body is plain text by prompt contract; if it ever contained markup, React's default escaping defeats injection. |
</threat_model>

<verification>
## Phase-level verification (this plan only — full phase verification in 60-15)

1. Migration shape: `grep -E "create table if not exists public\.kb_tip_of_day|unique index kb_tip_of_day_user_date_uniq|create policy kb_tip_of_day_select_own|create or replace function public\.write_kb_tip_of_day|'research_tips'" supabase/migrations/20261201000004_kb_tip_of_day_table.sql | wc -l` returns 5.
2. No cron in migration: `! grep -q "cron.schedule" supabase/migrations/20261201000004_kb_tip_of_day_table.sql`.
3. Deno tests: `cd supabase/functions/rag-tip-of-day-generate && $HOME/.deno/bin/deno test --no-check --allow-env --allow-net .` → all 3 test files green.
4. Deno.serve guarded: `grep -c "^Deno.serve" supabase/functions/rag-tip-of-day-generate/index.ts` returns 0; `grep -c "if (import.meta.main) Deno.serve" supabase/functions/rag-tip-of-day-generate/index.ts` returns 1.
5. Model ID hyphenated: `grep -c "claude-haiku-4-5-20251001" supabase/functions/rag-tip-of-day-generate/index.ts` returns ≥1; `! grep -E "claude-haiku-4\\.5|claude\\.haiku" supabase/functions/rag-tip-of-day-generate/index.ts`.
6. Vitest: `cd leanshot && npx vitest run --config vite.config.ts src/components/dashboard/cards/__tests__/TipOfTheDayCard.test.tsx` → green.
7. Typecheck: `cd leanshot && npm run typecheck` exits 0.
8. ESLint: `cd leanshot && npm run lint -- src/components/dashboard/cards/TipOfTheDayCard.tsx src/components/dashboard/tabs/HomeTab.tsx` exits 0.
9. Typography ceiling: `! grep -v '^\s*//' leanshot/src/components/dashboard/cards/TipOfTheDayCard.tsx | grep -E "text-(base|md)\b"` (comment-aware grep per [[feedback_negation_grep_defeated_by_comment_string]]).
10. Playwright (gated): `PLAYWRIGHT_RUN_P60_TIP_OF_DAY=1 npx playwright test tests/e2e/tip-of-day.spec.ts` → green.
11. Push-payload regex coverage: `grep -E "PRESCRIPTIVE_VERB_RE|EQUIVALENCE_RE|DOSE_NUMBER_RE" supabase/functions/rag-tip-of-day-generate/push-payload.ts | wc -l` returns ≥3.
12. AI-04 fence present: `grep -c "<user_data>" supabase/functions/rag-tip-of-day-generate/prompt.ts` returns ≥1.
13. Disclaimer string verbatim: `grep -c "Not medical advice — consult your clinician\\." leanshot/src/components/dashboard/cards/TipOfTheDayCard.tsx` returns 1.

## Deferred to 60-15 BLOCKING (NOT this plan)

- `supabase functions deploy rag-tip-of-day-generate --project-ref <ref>` — deploy gates cron registration per [[feedback_fn_deploy_before_cron_db_push]].
- `supabase db push --linked` for `20261201000004_kb_tip_of_day_table.sql` — pushed alongside all Phase 60 migrations after Fns deploy.
- pg_cron schedule `phase60_tip_of_day_daily` registered in `20261201000099_phase60_cron_schedules.sql` per outline 60-15.
- Live verification of (chunk eligibility → Haiku synth → kb_tip_of_day INSERT → push delivery) end-to-end on a staging user.

## Deferred to 60-13 (consumer route)

- `/knowledge/<topic>/<slug>` route resolves to 200; this plan's `Open source ↗` link asserts URL change only.
</verification>

<success_criteria>
1. Migration `20261201000004_kb_tip_of_day_table.sql` exists with 5 required tokens (Task 1).
2. `supabase/functions/rag-tip-of-day-generate/` directory has 4 source files (index.ts, prompt.ts, push-payload.ts, deno.json) + 3 test files; all `deno test` green (Tasks 2-4).
3. `leanshot/src/components/dashboard/cards/TipOfTheDayCard.tsx` exists and renders verbatim per UI-SPEC §6 with `null` empty state; HomeTab.tsx mounts it; vitest green (Task 5).
4. Playwright spec `tip-of-day.spec.ts` passes under `PLAYWRIGHT_RUN_P60_TIP_OF_DAY=1` (Task 6).
5. All 13 phase-level verification grep gates pass.
6. RAG-07 requirement traced: tip card + Fn + table + push category all present.
7. No `text-base`/`text-md` Tailwind classes leaked into TipOfTheDayCard.tsx (UI-SPEC §11 typography ceiling).
8. No top-level `Deno.serve(` in index.ts (only `if (import.meta.main) Deno.serve(...)` per [[reference_deno_test_top_level_serve_trap]]).
9. Model ID is hyphenated `claude-haiku-4-5-20251001` (no dotted variant) per [[reference_anthropic_model_id_hyphenated_format]].
10. Per-fn `deno.json` import map exists (CLI v2.101.0+ ignores `--import-map` per [[reference_supabase_functions_deploy_import_map_flag]]).
</success_criteria>

<output>
Create `.planning/phases/60-rag-knowledge-base-completion-waves-2-4/60-11-tip-of-day-card-and-fn-SUMMARY.md` when done.

Summary MUST include:
- Files created (12 expected: 1 migration + 4 Fn source + 3 Fn test + 1 card + 1 card test + 1 HomeTab edit + 1 E2E spec).
- Confirmation that all 13 phase-level verification gates pass.
- Cross-plan dependency reminders for the orchestrator: (a) 60-01 owns `push_subscription_categories` `research_tips` row (this plan ALSO seeds it idempotently as belt-and-suspenders); (b) 60-13 owns `/knowledge/<topic>/<slug>` route (this plan's link asserts URL change only); (c) 60-15 BLOCKING owns Fn deploy + cron registration + `supabase db push --linked` for `20261201000004_kb_tip_of_day_table.sql`.
- AI-SPEC dimension coverage: Dim #1 (citation faithfulness via verbatim-substring prompt clause), Dim #8 (source-tier rendering via TierBadge), Dim #9 (k-anon floor in Fn), Dim #12 (cost envelope via gateOrThrow), Dim #13 (personalization appropriateness via prescriptive-verb regex gate).
- Guardrail coverage: G1 (PHARMA-02 layer 2 + layer 3 mirror in push-payload.ts), G2 (AI-04 fence in prompt.ts), G3 (out-of-corpus via empty results refusal), G6 (cost envelope), G8 (k-anon), G9 (FDA-equivalence regex in push-payload.ts).
</output>

## Source Audit (multi-source coverage check)

**GOAL (ROADMAP phase goal):** "tip-of-day Bento card + push, weekly Resend newsletter" — this plan covers the tip-of-day half. Newsletter is 60-12.

**REQ (REQUIREMENTS.md):** `RAG-07` (tip-of-day cron + Bento card + push category). Coverage:
- ✅ Bento card → Task 5 ships TipOfTheDayCard + HomeTab mount.
- ✅ Push category → Task 1 seeds `research_tips` row in `notification_category_config`.
- ✅ Cron-callable Fn → Task 4 ships `rag-tip-of-day-generate`. Cron SCHEDULE deferred to 60-15 (BLOCKING per Fn-deploy-before-cron rule). RAG-07 is fully addressable across (60-01, 60-11, 60-15) per outline coverage map.

**RESEARCH (RESEARCH.md / AI-SPEC.md):**
- ✅ §4 cost lineup ($0.005/run via Haiku) → Task 4 uses `claude-haiku-4-5-20251001` with maxTokens=200 + `gateOrThrow` envelope.
- ✅ §5 Dim #13 (personalization appropriateness) → Task 2 prescriptive-verb regex + Task 3 prompt clause.
- ✅ §6 G1 PHARMA-02 → Task 4 `isPharma02Gated` check before synthesis; Task 2 push-payload mirror gate.
- ✅ §6 G2 AI-04 fence → Task 3 `<user_data>` fence in buildTipUserPrompt.
- ✅ §6 G8 k-anon floor → Task 4 cohort_n ≥ 5 assert for leanshot_research/community.
- ✅ §6 G9 FDA-equivalence → Task 2 EQUIVALENCE_RE regex.

**CONTEXT (CONTEXT.md decisions):**
- ✅ "Single tip per day" → Task 1 `UNIQUE(user_id, date_utc)` + Task 4 short-circuit on existing row.
- ✅ "Haiku not Sonnet" → Task 4 hyphenated `claude-haiku-4-5-20251001`.
- ✅ "Phase 54 push piggyback" → Task 4 invokes existing `push-dispatch` Fn with new `research_tips` category.
- ✅ "/knowledge/<topic>/<slug>" deep-link → Tasks 4 + 5 use `/knowledge/${topic_tag}/${topic_slug}` format consistently.

**Cross-cutting:**
- ✅ [[reference_anthropic_model_id_hyphenated_format]] — hyphenated in Task 4.
- ✅ [[reference_supabase_pg_cron_vault_service_role_pattern]] — N/A here (cron is 60-15).
- ✅ [[feedback_planner_prompt_explicit_reuse_targets]] — Task 5 names 50-08 Task 5 + 50-08 Task 6 e2e by file path.
- ✅ [[reference_deno_test_top_level_serve_trap]] — Task 4 guards `Deno.serve` under `import.meta.main`.
- ✅ [[reference_supabase_functions_deploy_import_map_flag]] — Task 2 ships per-fn deno.json.
- ✅ [[feedback_3_layer_must_never_invariant_pattern]] — PHARMA-02 mirrored at layer 2 (runtime helper) + layer 3 (regex grep in push-payload).
- ✅ [[reference_vitest_4_projects_config_masks_default]] — Task 5 verify uses `--config vite.config.ts`.
- ✅ [[feedback_negation_grep_defeated_by_comment_string]] — Verification gate 9 uses comment-aware grep.

**No source items missing. No scope reduction. No `v1`/`static for now`/`placeholder` language anywhere in the plan.**
