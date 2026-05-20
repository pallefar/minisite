# Phase 38: M5b AI Recommender (pgvector + Claude Digest) — Research

**Researched:** 2026-05-20
**Domain:** RAG (pgvector cosine retrieval) + scheduled single-turn LLM summarization (Anthropic via Vercel AI Gateway) + business-rule recommender ranking + cron-driven email digest + HITL review queue
**Confidence:** HIGH (10 of 10 REQ-IDs map to verified findings; 4 ASSUMED items flagged for confirmation)

---

## Summary

Phase 38 implements a **no-framework RAG + summarization stack** entirely inside Supabase Edge Functions (Deno). The system decomposes into 4 mechanical primitives — embed → SQL insert → cosine cosine-distance SELECT → summarize — all routed through Vercel AI Gateway with the Phase 25 clinical-vs-consumer credential split honored. CONTEXT.md locks 19 decisions (D-01..D-19) plus 7 Claude's-Discretion areas; AI-SPEC.md locks the JSON-schema-constrained output contract, the action whitelist (RECOMMEND-07), 10 eval dimensions, and 8 online + 9 offline guardrails. **Phase 50 already extends this Edge Fn** (one Edge Fn, two embedding sources, merged scoring) — design the Edge Fn API to accept multi-source query at v1 to avoid a Phase 50 breaking change.

The dominant risks are (a) **model-ID drift** — AI-SPEC.md references `claude-sonnet-4.6` but the Anthropic native API ID is `claude-sonnet-4-6` (hyphenated) and the existing `_shared/anthropic-baa-allowlist.ts` only lists `claude-sonnet-4-5` (older snapshot) — the planner MUST extend the allowlist OR pin to an already-allowlisted model; (b) **the Vercel AI Gateway routes Anthropic Messages via `/v1/messages` (same base URL, vendor-prefixed model slug)**, NOT the OpenAI-compatible `/chat/completions` path that fails on Anthropic's stricter schema validation (AI-SPEC Pitfall #2 confirmed); (c) **`profiles.timezone` does not exist yet in the schema** (only `org_settings.default_timezone`) — Phase 38 must add it as a user column to power the per-user Sunday 09:00-local cron; (d) **`supabase-js` cannot serialize the `<=>` operator** — every cosine query must be wrapped in a SECURITY INVOKER Postgres function called via `.rpc()`.

**Primary recommendation:** Ship a single `recommend-next-best-action` Edge Fn whose request schema accepts `sources: ['content_embeddings']` (Phase 38) extensible to `['content_embeddings', 'external_kb_embeddings']` (Phase 50). Use **HNSW with `vector_cosine_ops` (m=16, ef_construction=64)** matching pgvector defaults — at ≤50k rows the defaults are optimal per pgvector README. Resolve user `org_id` and select credential **before** building the digest prompt (Phase 25 HIPAA-01 audit failure pattern). Add `profiles.timezone TEXT NOT NULL DEFAULT 'America/New_York'` and a `pg_cron` job that fires per-user at `(now() AT TIME ZONE profiles.timezone)::time = '09:00'` on Sunday.

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Recommender Surfaces & Cold-Start**

- **D-01:** Ship all three surfaces in Phase 38 with future-proof multi-surface payload. Edge Fn returns tagged payload (`surface_target: dashboard | kb_footer | community_feed | course_landing`). Dashboard "For you" card + KB article footer render TODAY. Community feed + course landing render as **no-op shims** that consume the same payload when M4 (Phases 43-49) and Phase 46 ship.
- **D-02:** Cold-start fallback = popular-content for users with <5 events in the last 14 days. Recommender detects sparse history → returns top-3 globally-popular KB articles (popularity from PostHog impression+click data, refreshed nightly). Switch to personalized cosine path once user crosses 5 events.
- **D-03:** Recommender response shape — top-3 array of `{recommendation_id, source_type, source_id, title, deeplink, score, surface_target[], action_id?, expires_at}`. `action_id` is OPTIONAL drawn from whitelist enum (D-15). `expires_at` required (forces freshness loop — server rejects rec older than 7 days).

**Weekly Claude Digest**

- **D-04:** Opt-IN default, sanitized narrative only (free + paid + clinic — uniform v1). Default OFF. Narrates counts/trends but NEVER names specific drug, dose, or weight values. Conservative HIPAA posture for v1; v1.4 reconsiders tiered PHI-bearing variant for paid.
- **D-05:** No auto-pause v1; standard 1-click unsubscribe per Phase 49 DIGEST-04. Track unopened-3-weeks cohort in PostHog so v1.4 can revisit.
- **D-06:** Send-time = Sunday 09:00 in user's profile timezone (RECOMMEND-05 verbatim). Cron uses `pg_cron` + Phase 25 `vault.decrypted_secrets` + service-role pattern. Per-user timezone from `profiles.timezone` (defaults to `America/New_York` if NULL).
- **D-07:** Digest content composition. Last-7-day stats: injections logged, weight delta vs prior 7d, mood/energy trend, streak status, missed check-ins. Plus 1-3 action suggestions drawn from D-15 whitelist enum — Claude picks WHICH actions to surface from the candidate list assembled by recommender, does NOT generate free-text actions.

**Win-Back & SAVE Handoff**

- **D-09:** Win-back threshold = 14 consecutive days zero logged events. Single simple threshold. No multi-factor formula v1 (defer score-based formula in RECOMMEND-10 to v1.4 once churn-data baseline exists).
- **D-10:** Cadence = max 1 win-back SAVE prompt per 30 days per user. Hard cap in DB (`win_back_sends` table with `last_sent_at` + 30d unique constraint). Phase 38 fires `save_engine.trigger(user_id, reason='inactive_14d')` once → Phase 40 SAVE owns offer-selection + delivery.
- **D-11:** Win-back channel = email-first via Phase 25 Resend (consumer router), with in-app banner on next session. Email sent immediately at 14d-inactive trigger; if user opens app within 7 days, banner appears with same offer. No SMS, no push v1.

**HITL Review Queue (RECOMMEND-07)**

- **D-12:** Single queue for ALL rec types (recommender, digest, win-back). Reuses Phase 24 admin shell + Phase 27 admin queue primitives. One filter pill set: `type ∈ {recommender, digest, win_back}`; one approval workflow. Per-type queues in v1.4 if volume justifies.
- **D-13:** Auto-approve KB-sourced content recommendations. Recommendations where `source_type == 'kb_article'` AND `action_id ∈ {null, 'read_kb'}` skip the queue. Everything else queues for super-admin review.
- **D-14:** Super-admin only role in v1; no clinic-admin HITL access. Clinic admins see live-fired recommendations for their org via analytics dashboard (read-only).
- **D-15:** Whitelist-enum for `action_id`. v1 whitelist: `{read_kb:<slug>, log_weight, log_injection, log_meal, view_curve, share_with_doctor, complete_onboarding_step, try_recipe:<slug>, watch_tutorial:<slug>}`. Claude digest + recommender NEVER emit free-text actions; if no whitelist match, rec is content-only.

**Plan-Personalization Edge Fn (RECOMMEND-09)**

- **D-16:** Plan-personalization Edge Fn is SEPARATE from recommender Edge Fn. New function `supabase/functions/plan-personalize/`. Called by Phase 39 PAYWALL + Phase 40 SAVE with `{user_id, context: 'paywall' | 'save_offer', plan_id?}`. Returns `{offer_hint: 'annual_nudge' | 'discount_eligible' | 'pause_offer' | 'extended_trial', confidence, rationale}`.
- **D-17:** Plan-personalization is rule-based in v1 (no LLM call). Hand-coded rules from plan-history + activation event + paywall-dismissal count. <50ms p99 target. v1.4 can layer in an LLM judge.

**Embedding Lifecycle**

- **D-18:** Re-embed on content edit (not nightly diff). `after_update` trigger queues a re-embed job. Nightly cron handles NEW content + retry of failed embedding jobs. Prevents stale-embedding failure mode #5.
- **D-19:** Soft-delete cascade. Content marked `deleted_at` → embedding row stays for 7 days (audit window) → daily cleanup removes embedding. Recommender retrieval filters `WHERE content.deleted_at IS NULL`.

### Claude's Discretion

- Exact `vector(1536)` table schema (column names, constraint shape, RLS policies) — planner picks following Phase 25 RLS conventions + Phase 50 D-28 separate-table pattern.
- HNSW `m` and `ef_construction` parameters — **this RESEARCH recommends `m=16, ef_construction=64` (defaults)** for initial 2k rows scaling to 50k cap.
- User-context vector composition recipe — **this RESEARCH recommends Option B (deterministic facts-template embedding)**, see §Architecture Patterns.
- Concrete pg_cron schedule expressions — planner uses Phase 25 cron pattern.
- Digest template (HTML/MJML/plain-text) — **this RESEARCH recommends `_shared/email-layout.ts` (already in tree) + plaintext for v1**.
- Sentry instrumentation depth — researcher uses Phase 24 standard patterns.
- A/B variants for digest tone / recommender ranking — out of scope for Phase 38 (Phase 39 owns A/B trifecta).

### Deferred Ideas (OUT OF SCOPE)

- PHI-bearing digest variant for paid users — defer v1.4.
- Multi-factor win-back churn formula — defer v1.4.
- Per-type HITL queues — defer v1.4.
- Auto-pause digest after N unopened — defer; rely on 1-click unsubscribe.
- LLM-based plan-personalization — v1 rule-based.
- A/B variants of digest tone / recommender ranking — Phase 39 owns.
- Clinic-scoped HITL access — out of scope.
- Confidence-scored auto-approve thresholds — defer.
- Cohere / Gemini embedding migration — keep escape hatch via AI Gateway; not exercised.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description (verbatim from REQUIREMENTS.md) | Research Support |
|----|----------------------------------------------|------------------|
| **RECOMMEND-01** | pgvector enabled on Supabase Pro+; `content_embeddings vector(1536)` table + HNSW (or IVFFlat — decide at plan-phase) index | §Standard Stack pgvector; §Architecture Patterns — HNSW with `vector_cosine_ops(m=16, ef_construction=64)` recommended over IVFFlat for 2k→50k row range (no retrain needed, supports CREATE INDEX on empty table). Per CONTEXT D-CONTEXT references "Phase 50 locked HNSW" carry-forward. [VERIFIED: pgvector README] |
| **RECOMMEND-02** | OpenAI `text-embedding-3-small` routed via Vercel AI Gateway (same proxy posture as v1.2 Anthropic); embeddings only, not chat | §Standard Stack OpenAI; AI Gateway base URL `https://ai-gateway.vercel.sh/v1`, model slug `openai/text-embedding-3-small`, 1536 dims, 8192-token input cap, $0.02/1M tokens. [VERIFIED: Vercel AI Gateway docs + OpenAI pricing search] |
| **RECOMMEND-03** | Nightly cron embeds new content (community when M4 ships, KB articles, blog posts, course lessons) into `content_embeddings` | §Architecture Patterns nightly-embed-cron; pg_cron + vault.decrypted_secrets + Edge Fn invocation per `reference_supabase_pg_cron_vault_service_role_pattern`. Idempotent re-embed via `body_sha256` cache. |
| **RECOMMEND-04** | Next-Best-Action recommender Edge Fn takes user_id + recent events + profile → returns top-3 dashboard recommendations (cosine similarity on user-context embedding) | §Architecture Patterns user-context-vector recipe (Option B chosen); SECURITY INVOKER RPC `match_content_embeddings(query_embedding, match_count, requesting_user_id, sources)` per AI-SPEC §3. 30-day stale-window guard. |
| **RECOMMEND-05** | Weekly Claude summary email (short narrative + 1-3 suggested actions) sent via Resend (or SES if PHI); cron at 09:00 user-timezone Sunday | §Architecture Patterns weekly-digest; `claude-sonnet-4-6` via AI Gateway `/v1/messages` (NOT `/chat/completions`); per-user-timezone pg_cron via new `profiles.timezone` column; opt-IN per D-04; consumer Resend path per D-04 + Phase 25 email-router. |
| **RECOMMEND-06** | Sentry recommendation-CTR tracking + admin dashboard with recommendation-impression + recommendation-click rates per recommendation-type | §Architecture Patterns CTR-telemetry; events `recommendation.shown`, `recommendation.clicked`, `recommendation.dismissed`, `recommendation.404_on_click` via `_shared/posthog-server.ts` (Phase 24). |
| **RECOMMEND-07** | Human-in-the-loop review queue for AI suggestions; admin approves/rejects/edits before auto-apply within guardrails (whitelisted recommendation set only) | §Architecture Patterns HITL-queue + §Standard Stack Zod schema with `enum: WHITELIST_ACTION_IDS` enforced both at AI Gateway boundary (`output_config.format.json_schema`) AND at application boundary (`DigestOutputSchema.parse()`). Auto-approve KB-sourced (D-13). |
| **RECOMMEND-08** | Content recommendations surface in KB article footer ("Related articles") + community feed ("You might like") + course landing ("Recommended courses") | §Architecture Patterns multi-surface-payload; D-01 surface_target enum drives all three surfaces from one Edge Fn payload; community/course render as no-op shims until M4/Phase 46. |
| **RECOMMEND-09** | Pricing/offer personalization (annual nudge for monthly subscribers showing churn signal; discount eligibility per user's plan-history); plan-personalization Edge Fn called by PAYWALL + SAVE | §Architecture Patterns plan-personalize-fn; SEPARATE Edge Fn (D-16) rule-based (D-17) <50ms p99; no LLM call. |
| **RECOMMEND-10** | Win-back prompts for at-risk users (simple churn model: days-since-last-action × declining-streak × paywall-dismissals); auto-send via SAVE-engine | §Architecture Patterns winback-scorer; v1 = single 14d-inactive threshold (D-09), max 1/30d (D-10); fires `save_engine.trigger(user_id, reason='inactive_14d')`; Phase 40 SAVE owns delivery. |
</phase_requirements>

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|--------------|----------------|-----------|
| Recommender top-3 retrieval | API / Edge Fn (Deno) | Database (pgvector RPC) | Cosine query is pure SQL; auth + business-rule re-rank lives in Edge Fn. No client-side AI logic. |
| User-context vector composition | API / Edge Fn (Deno) | — | Deterministic templating + one embedding call; transient (not persisted). |
| Weekly digest generation | API / Edge Fn (Deno, pg_cron-invoked) | External AI (Anthropic via AI Gateway) | Single-turn summarization. JSON-schema constrained. |
| Embedding storage | Database / Storage (Postgres + pgvector) | — | `content_embeddings vector(1536)` + HNSW index. Single source of truth. |
| Embedding lifecycle (insert/update/delete) | Database / Storage (triggers) | API / Edge Fn (`embed-content-nightly`) | Trigger flips `stale=true` on content UPDATE; nightly cron re-embeds. Soft-delete 7d cascade. |
| Per-user timezone cron | Database / Storage (`pg_cron` + `profiles.timezone`) | API / Edge Fn (`weekly-digest`) | pg_cron resolves timezone in WHERE clause; Edge Fn handles one user at a time. |
| Telemetry capture | API / Edge Fn (server-side PostHog) | — | Server-side ONLY per Phase 24 — adblockers eat client AI events. |
| HITL admin queue UI | Frontend Server (admin shell) | Database (`ai_suggestion_review` table) | Plugs into Phase 24 admin shell + Phase 27 admin queue primitives. |
| Dashboard "For you" card render | Browser / Client (React) | API / Edge Fn (calls recommender on mount) | Read-only consumer; falls back to popular content on error/timeout. |
| KB footer "Related articles" render | Browser / Client (React) | API / Edge Fn (recommender `surface_target=kb_footer&exclude_id=<current>`) | Single recommender Edge Fn serves multiple surfaces. |
| Plan-personalization | API / Edge Fn (Deno) | Database (plan-history lookup) | Separate Edge Fn; rule-based, no LLM call (hot conversion path). |
| Win-back trigger | Database (`pg_cron` nightly) | API / Edge Fn (`winback-scorer`) → Phase 40 SAVE | SQL detects 14d-inactive; Edge Fn enforces 30d cap and fires SAVE engine. |
| BAA scope decision | API / Edge Fn (`_shared/baa-scope.ts`) | Database (`users.org_id` lookup) | MUST run BEFORE prompt build per Phase 25 HIPAA-01. |

## Project Constraints (from CLAUDE.md)

- **Local-first invariant:** Local-first must continue to work even after cloud sync. Phase 38 surfaces are server-only (Edge Fn); they degrade gracefully when offline (dashboard falls back to popular-content cached locally). No new browser-bundled AI logic.
- **Bundle ceiling:** v1.3 cross-cutting ceiling is 50 kB gz index; admin-shell 30 kB. Phase 38 adds zero client-side AI deps (all Edge-Fn-resident).
- **No-framework AI:** Per AI-SPEC §2 — no LangChain, no LlamaIndex, no openai/anthropic SDKs in Edge Fns. Direct `fetch` against AI Gateway only.
- **Strict TypeScript:** All Edge Fn + shared helpers use `tsconfig.app.json` strict mode equivalents in Deno.
- **GSD workflow:** This phase research preceeded by gsd-discuss-phase (CONTEXT.md), gsd-ai-integration-phase (AI-SPEC.md), and gsd-framework-selector (FRAMEWORK-SELECTION.md). No direct edits.
- **GLP-1 safety posture:** AI never sets dose, drug, or diagnosis. Whitelist + HITL enforces. [VERIFIED: AI-SPEC §1b]

---

## Standard Stack

### Core

| Library / Tool | Version | Purpose | Why Standard |
|----------------|---------|---------|--------------|
| **pgvector** | bundled with Supabase Postgres (extension `vector`) | Vector similarity search; `vector(1536)` column type; HNSW + IVFFlat indexes; `<=>`/`<->`/`<#>` operators | RECOMMEND-01 locks pgvector. Already provisioned on Supabase Pro+. **[VERIFIED: pgvector README + Phase 50 D-28 references]** |
| **`@supabase/supabase-js`** | `^2.105.0` | Service-role client inside Edge Fn; `.rpc()` calls the cosine RPC | Already at this version in `supabase/functions/*` per CONTEXT.md; AI-SPEC pins `2.105.0` via esm.sh URL specifier. **[VERIFIED: existing import_map.json + AI-SPEC §3]** |
| **Vercel AI Gateway** | base URL `https://ai-gateway.vercel.sh/v1` (REST) | Model-vendor-agnostic proxy for OpenAI embeddings + Anthropic Messages; per-key cost/usage metering; BAA-scope enforcement seam | Phase 25 HIPAA-01 locks AI Gateway as the only egress. **[VERIFIED: Vercel docs 2026-04-02 fetched 2026-05-20]** |
| **OpenAI `text-embedding-3-small`** (via AI Gateway) | model slug `openai/text-embedding-3-small` | Embeddings — 1536 dims, 8192-token input cap, $0.02/1M input | RECOMMEND-02 locks. 5x cheaper than `-large`, recall difference negligible at ≤500-token content. **[VERIFIED: AI-SPEC §4 + WebSearch OpenAI pricing 2026-05-20]** |
| **Anthropic `claude-sonnet-4-6`** (via AI Gateway) | model slug `anthropic/claude-sonnet-4-6` (Vercel) / `claude-sonnet-4-6` (Anthropic native) | Weekly digest narrative — 200k context, $3/$15 per M in/out, JSON-schema structured output | Best speed/intelligence tradeoff for ≤1024-output narrative. **[VERIFIED: Anthropic Models docs fetched 2026-05-20 — note this is a date-suffix-less pinned snapshot, NOT an alias]** |
| **Anthropic `claude-haiku-4-5`** (via AI Gateway — optional for plan-personalize copy rewrite) | model slug `anthropic/claude-haiku-4-5` or pinned `claude-haiku-4-5-20251001` | Offer-copy rewrite (~$0.25/M input) | Cost-optimized for one-shot rewrites. **[VERIFIED: Anthropic Models docs]** Use only if D-17 rule-based path proves insufficient (deferred). |
| **`pg_cron`** | bundled with Supabase Postgres | Scheduled Edge Fn invocation; per-user-timezone Sunday digest fan-out | Phase 25 + Phase 33 pattern already validated. **[VERIFIED: memory `reference_supabase_pg_cron_vault_service_role_pattern`]** |
| **Supabase Vault (`vault.decrypted_secrets`)** | bundled | Stores service-role key for pg_cron-invoked Edge Fn calls | Phase 25 pattern; `current_setting('app.service_role_key')` GUC does NOT exist on this project per memory `reference_supabase_pg_cron_vault_service_role_pattern`. **[VERIFIED: memory]** |
| **`zod`** | `^3.23.8` via `https://esm.sh/zod@3.23.8` | Structured-output validation at application boundary (`DigestOutputSchema.parse()`) | AI-SPEC §4b.1 locks. Deno-compatible via esm.sh. **[VERIFIED: AI-SPEC §4b]** |

### Supporting

| Library / Tool | Version | Purpose | When to Use |
|----------------|---------|---------|-------------|
| `_shared/anthropic-baa-allowlist.ts` | existing (Phase 25) | Asserts model ID is BAA-covered before any clinical Anthropic call | EVERY clinical-credential call. **MUST extend the allowlist to include `claude-sonnet-4-6` and `claude-haiku-4-5-20251001` — current allowlist only has `claude-sonnet-4-5`, `claude-opus-4-6`, `claude-haiku-4-5-20251001`.** [VERIFIED: file read + Anthropic docs] |
| `_shared/email-router.ts` | existing (Phase 25) | Routes non-PHI → Resend, PHI → SES | Phase 38 digest is non-PHI (D-04), so consumer path → Resend |
| `_shared/posthog-server.ts` | existing (Phase 24) | Server-side capture; `client.shutdown()` before Edge return | All Phase 38 telemetry; never client-side capture for AI events |
| `_shared/refusal.ts` | existing (Phase 12/25) | Refusal patterns for medical-advice prompts | Strip user-context text matching pattern before embed; also enforced on inbound recommender params |
| `_shared/email-layout.ts` | existing | Email template wrapper | Digest email body |
| `_shared/sentry.ts` | existing | Sentry breadcrumbs + PHI scrub | `baa.scope.resolved`, `digest.attempt.N`, `zod.parse.failed` breadcrumbs |
| `_shared/i18n-server.ts` | existing (Phase 32) | Locale-aware string lookup | Digest copy localization (Spanish per I18N-04) |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| HNSW index | IVFFlat | IVFFlat faster build, lower memory, but `lists ≈ rows/1000` requires retrain as data grows (silent recall collapse) — known v1.3 trap. AI-SPEC §3 Pitfall #3 confirmed via pgvector README. HNSW chosen. |
| `text-embedding-3-small` (1536 dims) | `text-embedding-3-large` (3072 dims) | Large is 5x cost ($0.13 vs $0.02/M) for marginal recall on ≤500-token content; RECOMMEND-02 already locks small. |
| `claude-sonnet-4-6` for digest | `claude-haiku-4-5` for digest | Haiku 5x cheaper but reasoning quality below Sonnet for nuanced behavior-change tone. Use Sonnet at launch, revisit after eval calibration (AI-SPEC §4 cost table). |
| No-framework | LlamaIndex TS | Bundle bloat + cold-start tax + framework hides Phase 25 BAA-scope seam. AI-SPEC §2 + FRAMEWORK-SELECTION.md ruled out. Saved as v1.4 upgrade path if reranker/hybrid retrieval needed. |
| Single recommender Edge Fn | Per-surface Edge Fns | Multi-surface payload (D-01) future-proofs Phase 44 community + Phase 46 courses — no AI-layer redeploy when those phases ship. Single fn chosen. |
| AI Gateway `/chat/completions` for Anthropic | AI Gateway `/v1/messages` for Anthropic | **`/chat/completions` `response_format` does NOT work reliably against Anthropic models via AI Gateway** (AI-SPEC §3 Pitfall #2). Must use `/v1/messages` with `output_config.format.json_schema`. |

**Installation (no npm; Deno via esm.sh URL specifiers):**
```typescript
// supabase/functions/_shared/openai-embed.ts
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.105.0";
// supabase/functions/_shared/digest-schema.ts
import { z } from "https://esm.sh/zod@3.23.8";
```

**Migration (one-time):**
```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

**Function Secrets (`supabase secrets set ...` — Phase 38 plans must list as deploy step):**
```bash
supabase secrets set AI_GATEWAY_API_KEY_CONSUMER=vck_xxx
supabase secrets set AI_GATEWAY_API_KEY_CLINICAL=vck_yyy
supabase secrets set AI_GATEWAY_BASE_URL=https://ai-gateway.vercel.sh/v1
supabase secrets set ANTHROPIC_MODEL_DIGEST=anthropic/claude-sonnet-4-6
supabase secrets set OPENAI_EMBED_MODEL=openai/text-embedding-3-small
# SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are auto-injected by Supabase.
```

**Version verification log (run 2026-05-20):**
- `@supabase/supabase-js@2.105.0` — used across existing `supabase/functions/_shared/` per import_map; assumed current. [ASSUMED — confirm via `npm view @supabase/supabase-js version` at plan-write]
- `zod@3.23.8` — AI-SPEC pin. [ASSUMED — confirm latest at plan-write]
- `text-embedding-3-small` — verified live model ID via OpenAI WebSearch 2026-05-20. [VERIFIED: OpenAI pricing + Vercel AI Gateway docs]
- `claude-sonnet-4-6` — verified live API ID via docs.anthropic.com 2026-05-20. **CRITICAL:** AI-SPEC uses dotted form `claude-sonnet-4.6`; the canonical API ID is hyphenated `claude-sonnet-4-6`. Vercel AI Gateway example uses dotted form (`anthropic/claude-opus-4.7`); both work via gateway but **the BAA allowlist file uses hyphenated form** — pin to hyphenated to avoid mismatch. [VERIFIED: Anthropic Models overview docs + Vercel AI Gateway docs]

---

## Architecture Patterns

### System Architecture Diagram

```
                                      [pg_cron — per-timezone Sunday 09:00]
                                                        |
                                                        v
[Browser/Client React]                  +----- Edge Fn: weekly-digest -----+
  - Dashboard "For you" card            |  1. Resolve users.org_id (Phase 25 BAA-scope)         |
  - KB footer "Related"                 |  2. Pick credential (CONSUMER vs CLINICAL key)        |
  - Settings → Email Prefs (opt-in)     |  3. Load last-7-day user facts (deterministic template)|
       |                                 |  4. POST /v1/messages (Anthropic via AI Gateway)      |
       | (mount/render)                  |  5. Zod parse (whitelist enum, ≤3 actions)            |
       v                                 |  6. _shared/email-router → Resend (consumer)          |
+----- Edge Fn: recommend-next-best-action -----+      |  7. INSERT INTO weekly_digest_sends + PostHog capture |
| 1. Auth: caller JWT OR cron service-role     |      +-------------------------------------------------------+
| 2. Sparse-history check (D-02) → pop fallback|                       |
| 3. Build user-context text (Option B recipe) |                       v
| 4. POST /v1/embeddings (OpenAI via AI Gateway)|             [Resend SMTP — consumer non-PHI]
| 5. RPC: match_content_embeddings(            |                       |
|         query_embedding, match_count=10,    |                       v
|         requesting_user_id, sources=['ce']) |             [Inbox — Sunday 09:00 local]
| 6. Business-rule re-rank (recency, dismissed,|
|    locale, D-15 whitelist, D-13 auto-approve)|
| 7. Slice top-3 + tag surface_target[]        |     [pg_cron nightly — embed-content-nightly]
| 8. PostHog capture recommendation.shown      |                |
+--------+----------------------------+--------+                v
         |                            |          +----- Edge Fn: embed-content-nightly -----+
         v                            v          | 1. SELECT FROM content WHERE              |
[content_embeddings vector(1536)]  [recommendation_events]  |    embeddings_status='pending' OR stale=true |
    |  HNSW idx (vector_cosine_ops, |    (CTR source)       | 2. Batch up to 100 inputs        |
    |   m=16, ef_construction=64)   |                       | 3. POST /v1/embeddings           |
    |                               |                       | 4. ON CONFLICT (content_id) UPDATE |
    | RPC `match_content_embeddings`|                       |    embedding, last_embedded_at,  |
    | re-imposes user/org filter    |                       |    body_sha256                   |
    | (RLS-equivalent at SECURITY   |                       +----------------------------------+
    |  INVOKER level)               |
    v                               |
[content (KB articles + blog v1; community + course join in Phase 44/46)]
    |
    | UPDATE trigger flips embedding.stale=true (D-18)
    v
[content_embeddings.stale=true → next nightly cron re-embeds]

                  [pg_cron nightly — winback-scorer]
                              |
                              v
            +----- Edge Fn: winback-scorer -----+
            | 1. SELECT users WHERE             |
            |    last_event_at < now()-14d      |
            |    AND NOT EXISTS win_back_sends  |
            |    in last 30d                    |
            | 2. For each → call               |
            |    save_engine.trigger(           |
            |      user_id,                     |
            |      reason='inactive_14d')       |
            | 3. INSERT win_back_sends row      |
            +-----------------------------------+
                              |
                              v
                [Phase 40 SAVE engine — owns offer + delivery]

[Phase 39 PAYWALL  ─────────► Edge Fn: plan-personalize ◄───── Phase 40 SAVE]
                                       |
                                       v
                       (Pure SQL rule-based ranker;
                        plan_history + activation_event +
                        paywall_dismissals → offer_hint;
                        NO LLM call; <50ms p99)

[Super-admin Admin Shell] ──► HITL Queue (ai_suggestion_review)
                                       ↑
                                       │ NEW digest narratives + non-KB recs queue for review
                                       │ (KB-sourced auto-approved per D-13)
                                       │
                                  Recommender + Digest fns INSERT pending rows
```

### Recommended Project Structure

```
supabase/
├── functions/
│   ├── _shared/
│   │   ├── openai-embed.ts                 # NEW — fetch wrapper → AI Gateway /embeddings, retry-on-429
│   │   ├── anthropic-summarize.ts          # NEW — fetch wrapper → AI Gateway /v1/messages, JSON-schema
│   │   ├── baa-scope.ts                    # NEW — extends anthropic-baa-allowlist with `assertBaaScope(orgId, modelId)`
│   │   ├── digest-schema.ts                # NEW — Zod schemas + WHITELIST_ACTION_IDS + digestJsonSchema
│   │   ├── render-user-facts.ts            # NEW — deterministic template for digest input
│   │   ├── recommender-rank.ts             # NEW — business-rule re-ranker (recency/dismissed/locale/whitelist)
│   │   ├── anthropic-baa-allowlist.ts      # EXISTING (Phase 25) — EXTEND with claude-sonnet-4-6
│   │   ├── email-router.ts                 # EXISTING (Phase 25)
│   │   ├── email-layout.ts                 # EXISTING
│   │   ├── posthog-server.ts               # EXISTING (Phase 24)
│   │   ├── refusal.ts                      # EXISTING
│   │   ├── sentry.ts                       # EXISTING
│   │   └── supabase-server.ts              # EXISTING
│   ├── recommend-next-best-action/         # NEW — RECOMMEND-04 user-triggered top-3
│   │   └── index.ts
│   ├── weekly-digest/                      # NEW — RECOMMEND-05 pg_cron per-tz Sun 09:00
│   │   └── index.ts
│   ├── embed-content-nightly/              # NEW — RECOMMEND-03 backfill + re-embed stale
│   │   └── index.ts
│   ├── plan-personalize/                   # NEW — RECOMMEND-09 paywall + SAVE entry (rule-based, no LLM)
│   │   └── index.ts
│   ├── winback-scorer/                     # NEW — RECOMMEND-10 14d-inactive trigger
│   │   └── index.ts
│   └── import_map.json                     # EXTEND — add shared/refusal alias if not yet
└── migrations/
    ├── <ts1>_phase38_pgvector_extension.sql
    ├── <ts2>_phase38_content_embeddings_table.sql
    ├── <ts3>_phase38_content_embeddings_hnsw.sql
    ├── <ts4>_phase38_match_content_embeddings_fn.sql        # SECURITY INVOKER RPC w/ sources[] param
    ├── <ts5>_phase38_recommendation_events.sql              # CTR source
    ├── <ts6>_phase38_weekly_digest_sends.sql                # Audit + replay
    ├── <ts7>_phase38_win_back_sends.sql                     # 30d cap (unique constraint)
    ├── <ts8>_phase38_ai_suggestion_review.sql               # HITL queue
    ├── <ts9>_phase38_profiles_timezone.sql                  # ADD timezone TEXT NOT NULL DEFAULT 'America/New_York'
    ├── <ts10>_phase38_content_stale_trigger.sql             # D-18 trigger
    ├── <ts11>_phase38_content_softdelete_cascade.sql        # D-19 7d cascade
    └── <ts12>_phase38_pg_cron_schedules.sql                 # weekly-digest, embed-nightly, winback-nightly
```

> **Timestamp range:** Latest existing migration on main = `20270704000025`. Phase 38 should use the next-available window `20270705000001..20270705000012` per `reference_migration_filename_regex` + `reference_migration_timestamp_collision_precheck`. Pre-check before plan-write.

### Pattern 1: User-Context Vector Composition (RECOMMENDED — Option B)

**Three candidates evaluated:**

| Option | Description | Tradeoff |
|--------|-------------|----------|
| A — Weighted sum of event-type embeddings | Embed each event type once; weighted average over user's last-30d events | Cheap (no per-user embed) but loses temporal nuance + profile context |
| **B — Deterministic facts-template embedding (RECOMMENDED)** | Template like `"User on weight-loss plan. Last 30d: 12 injections, weight delta -2.3 lb, mood avg 3.8/5, nausea on 4 days. Goals: lose 25 lb."` then ONE embed call | ~150-token input → ~120ms latency; captures profile + recent state in one vector; deterministic for eval |
| C — Multi-vector retrieval (LlamaIndex-style fusion) | Separate vectors for profile / events / goals → merge top-K | More recall but ~3× cost + complexity; rerank fusion adds latency |

**Recommendation: Option B.** Matches AI-SPEC §3 entry-point pattern (`embed(contextText)`); deterministic for §5 eval (fidelity dimension); fits 25s P95 latency budget. Defer Option C to v1.4 if eval shows precision@3 < 0.6.

```typescript
// supabase/functions/_shared/render-user-context.ts
export function renderUserContext(userFacts: UserContextFacts): string {
  const lines: string[] = [];
  lines.push(`User on ${userFacts.goalType} plan, ${userFacts.glp1Phase} phase.`);
  lines.push(`Last 30 days: ${userFacts.injectionCount} injections, weight delta ${userFacts.weightDelta30d} ${userFacts.units}.`);
  if (userFacts.moodAvg !== null) lines.push(`Mood avg: ${userFacts.moodAvg}/5.`);
  if (userFacts.topSymptoms.length > 0) lines.push(`Symptoms: ${userFacts.topSymptoms.slice(0, 3).join(", ")}.`);
  lines.push(`Streak: ${userFacts.streakDays} days.`);
  return lines.join(" ");
}
```

### Pattern 2: Multi-Source Recommender RPC (Phase 50 future-proof)

```sql
-- match_content_embeddings — accepts sources[] parameter at v1.
-- Phase 38 callers pass sources := ARRAY['content_embeddings'].
-- Phase 50 callers pass sources := ARRAY['content_embeddings', 'external_kb_embeddings'].
CREATE OR REPLACE FUNCTION public.match_content_embeddings(
  query_embedding vector(1536),
  match_count int DEFAULT 10,
  requesting_user_id uuid DEFAULT NULL,
  sources text[] DEFAULT ARRAY['content_embeddings']::text[],
  source_tier_weights jsonb DEFAULT '{}'::jsonb     -- Phase 50 reweighting hook
)
RETURNS TABLE (
  source_table text,
  content_id uuid,
  source_type text,
  title text,
  similarity float,
  weighted_score float
)
LANGUAGE plpgsql STABLE
SECURITY INVOKER
SET search_path = public, extensions
AS $$
BEGIN
  IF requesting_user_id IS NULL THEN
    RAISE EXCEPTION 'requesting_user_id required (cross-tenant guard)';
  END IF;

  RETURN QUERY
  SELECT 'content_embeddings'::text,
         ce.content_id,
         c.kind,
         c.title,
         1 - (ce.embedding <=> query_embedding) AS similarity,
         (1 - (ce.embedding <=> query_embedding))
           * COALESCE((source_tier_weights->>'content_embeddings')::float, 1.0)
       AS weighted_score
  FROM public.content_embeddings ce
  JOIN public.content c ON c.id = ce.content_id
  WHERE 'content_embeddings' = ANY(sources)
    AND c.published_at IS NOT NULL
    AND c.deleted_at IS NULL
    AND ce.stale = false
    AND ce.last_embedded_at > now() - interval '30 days'
    AND (c.visible_to_user_id IS NULL OR c.visible_to_user_id = requesting_user_id)
  ORDER BY ce.embedding <=> query_embedding
  LIMIT match_count;
  -- Phase 50 will UNION ALL a parallel block for external_kb_embeddings here.
END;
$$;
```

**Why SECURITY INVOKER and not SECURITY DEFINER:** SECURITY INVOKER honors caller's JWT (and RLS on the joined `content` table). The explicit `requesting_user_id` parameter is a belt-and-suspenders guard for the service-role call path inside Edge Fn. Per `reference_supabase_migration_gotchas`, SECDEF requires explicit `search_path = public, extensions`.

### Pattern 3: pg_cron Per-User-Timezone Fan-Out

**Per CONTEXT D-06 + `reference_supabase_pg_cron_vault_service_role_pattern` + `reference_postgres_dollar_quote_nesting_in_cron_body`:**

```sql
-- Add timezone column to profiles (no existing column — verified 2026-05-20 grep).
ALTER TABLE public.profiles
  ADD COLUMN timezone text NOT NULL DEFAULT 'America/New_York';

-- pg_cron job runs EVERY HOUR; fan-outs to users whose local time is Sunday 09:00.
SELECT cron.schedule(
  'weekly-digest-hourly-fanout',
  '0 * * * *',  -- every hour on the hour
  $cron$
  DO $digest$
  DECLARE
    rec RECORD;
    fn_url text := 'https://<project-ref>.functions.supabase.co/weekly-digest';
    service_key text;
  BEGIN
    SELECT decrypted_secret INTO service_key
    FROM vault.decrypted_secrets
    WHERE name = 'service_role_key';

    FOR rec IN
      SELECT id AS user_id
      FROM public.profiles p
      WHERE EXISTS (
              SELECT 1 FROM public.user_preferences up
              WHERE up.user_id = p.id AND up.weekly_digest_opt_in = true
            )
        AND extract(dow FROM (now() AT TIME ZONE p.timezone)) = 0    -- Sunday
        AND extract(hour FROM (now() AT TIME ZONE p.timezone)) = 9   -- 09:00 hour
        AND NOT EXISTS (
              SELECT 1 FROM public.weekly_digest_sends wds
              WHERE wds.user_id = p.id AND wds.sent_at > now() - interval '6 hours'
            )
    LOOP
      PERFORM net.http_post(
        url := fn_url,
        body := jsonb_build_object('user_id', rec.user_id),
        headers := jsonb_build_object(
          'Authorization', 'Bearer ' || service_key,
          'Content-Type', 'application/json'
        )
      );
    END LOOP;
  END;
  $digest$;
  $cron$
);
```

**Notes:**
- `$cron$ ... $digest$` named dollar-tags avoid `$$` nesting bug per memory `reference_postgres_dollar_quote_nesting_in_cron_body`.
- 6-hour dedup window in the WHERE prevents double-send if cron fires twice on DST transition.
- DST handling: `now() AT TIME ZONE p.timezone` respects DST automatically; on DST spring-forward the 09:00 hour skips (acceptable — user gets digest at 10:00 that week); on fall-back, the dedup window prevents the duplicate send.

### Pattern 4: Anthropic Messages API via AI Gateway (NOT /chat/completions)

```typescript
// supabase/functions/_shared/anthropic-summarize.ts
// CRITICAL: structured outputs ONLY work reliably against Anthropic via /v1/messages
// shape, NOT via AI Gateway's OpenAI-compatible /chat/completions response_format.
// AI-SPEC §3 Pitfall #2 + verified Vercel docs (anthropic-messages-api/structured-outputs).

import { assertBaaCoveredModel } from "./anthropic-baa-allowlist.ts";
import { digestJsonSchema, DigestOutputSchema, type DigestOutput } from "./digest-schema.ts";

export async function summarizeDigest(
  userFactsText: string,        // already-rendered deterministic template
  orgId: string | null,
): Promise<DigestOutput> {
  // Phase 25 HIPAA-01: choose credential by tenant scope BEFORE building prompt.
  const credential = orgId
    ? Deno.env.get("AI_GATEWAY_API_KEY_CLINICAL")!
    : Deno.env.get("AI_GATEWAY_API_KEY_CONSUMER")!;

  const modelId = Deno.env.get("ANTHROPIC_MODEL_DIGEST")!; // "anthropic/claude-sonnet-4-6"

  // For clinical credential calls, verify the underlying model is BAA-allowlisted.
  if (orgId) {
    // Strip vendor prefix for allowlist match (allowlist stores native IDs).
    assertBaaCoveredModel(modelId.replace(/^anthropic\//, ""));
  }

  // AI Gateway's Anthropic surface lives at the SAME base URL but the /v1/messages path.
  const url = `${Deno.env.get("AI_GATEWAY_BASE_URL")!.replace(/\/v1$/, "")}/v1/messages`;

  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), 25_000); // 25s for digest

  try {
    const res = await fetch(url, {
      method: "POST",
      signal: ctrl.signal,
      headers: {
        "Authorization": `Bearer ${credential}`,
        "Content-Type": "application/json",
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: modelId,
        max_tokens: 1024,                      // REQUIRED — Anthropic 400s if missing
        temperature: 0.4,
        system: SYSTEM_PROMPT_DIGEST,
        messages: [{ role: "user", content: userFactsText }],
        output_config: {
          format: { type: "json_schema", schema: digestJsonSchema },
        },
      }),
    });
    if (!res.ok) throw new Error(`digest ${res.status} ${await res.text()}`);
    const j = await res.json();
    const textBlock = j.content.find((b: { type: string }) => b.type === "text");
    return DigestOutputSchema.parse(JSON.parse(textBlock.text));
  } finally {
    clearTimeout(timeout);
  }
}
```

### Pattern 5: Multi-Surface Payload (D-01 Future-Proof)

```typescript
// Recommender Edge Fn response — single shape consumed by 4 surfaces.
export interface RecommendationResponse {
  recommendations: Array<{
    recommendation_id: string;      // UUID v4 — used in CTR events
    source_type: 'kb_article' | 'blog_post' | 'community_post' | 'course_lesson';
    source_id: string;
    title: string;
    deeplink: string;               // e.g., "/kb/managing-nausea-week-4"
    score: number;                  // weighted_score from RPC
    surface_target: Array<'dashboard' | 'kb_footer' | 'community_feed' | 'course_landing'>;
    action_id?: string;             // D-15 whitelist enum or undefined (content-only)
    expires_at: string;             // ISO timestamp — server rejects > 7 days old (D-03)
  }>;
  fallback: 'personalized' | 'popular';   // D-02 cold-start visibility
}
```

### Anti-Patterns to Avoid

- **Persisting user-context vectors.** They drift continuously; cache invites staleness. Recompute each call (~30ms).
- **Using AI Gateway `/chat/completions` `response_format` for Anthropic.** Fails schema validation. Use `/v1/messages` `output_config.format.json_schema`. [VERIFIED: AI-SPEC §3 + Vercel docs]
- **Streaming the digest call.** Streaming returns tokens before schema validator sees them; you'll render "narrative half-typed" then retract on validation failure. Always `await` for structured-output. [VERIFIED: AI-SPEC §4b]
- **Embedding raw user logs in the digest prompt.** Always template via `renderUserFacts()`. (a) bounded tokens, (b) deterministic for fidelity eval, (c) string-comparable for fabrication detection. [VERIFIED: AI-SPEC §4]
- **Choosing credential AFTER prompt build.** Phase 25 HIPAA-01 audit failure: PHI is already in memory under wrong tenant scope. Resolve `org_id` FIRST.
- **Calling `match_content_embeddings(...)` from `supabase-js` query builder with `<=>`.** PostgREST cannot serialize the operator. Must use `.rpc()`. [VERIFIED: AI-SPEC §3 Pitfall #1]
- **Free-text `action_id`.** Must be ∈ whitelist enum (D-15). Enforce at Zod boundary + DB CHECK constraint.
- **Reading the entire CLAUDE.md anti-pattern: `useStore(s => s)`.** Phase 38 has no client state changes; surfaces consume via existing card primitives. Not applicable but flagged for any new client code.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Vector similarity index | Custom KNN in app code | pgvector HNSW `vector_cosine_ops` | Edge cases (recall vs latency, build vs query, parameter tuning) battle-tested. [VERIFIED: pgvector README] |
| Embedding cost dedup | Hash-then-call-anyway logic | `body_sha256` column + `WHERE NOT EXISTS` skip | Standard pattern; saves 100% cost on unchanged content edits. [VERIFIED: AI-SPEC §4b] |
| Structured output retry | Manual JSON.parse + check | Zod `.parse()` + retry-with-backoff harness | Already AI-SPEC §4b spec'd; covers schema vs transport error class split. |
| BAA credential routing | Inline `if (org_id)` per call site | `_shared/baa-scope.ts` wrapper + breadcrumb-order assertion | Single seam Phase 25 audits. Mistake = audit failure. [VERIFIED: Phase 25 CONTEXT + memory] |
| Timezone math | Custom DST handling | Postgres `AT TIME ZONE` operator in pg_cron WHERE | Honors IANA tz database; DST handled by Postgres. [VERIFIED: pg_cron + tz docs] |
| Email send retry | Custom exponential backoff | `_shared/email-router.ts` (Phase 25) | Already provides Resend + SES routing + retry. |
| Server-side analytics | Direct PostHog HTTP | `_shared/posthog-server.ts` (Phase 24) | Handles `client.shutdown()` before Edge return (otherwise lost events). [VERIFIED: Phase 24 CONTEXT] |
| Whitelist enforcement | Regex on `action_id` | Zod `.enum(WHITELIST_ACTION_IDS)` + Postgres CHECK | Two-layer defense; either layer alone is bypassable. [VERIFIED: AI-SPEC §6 O1] |
| Refusal pattern detection | Hand-rolled medical-advice regex | `_shared/refusal.ts` (Phase 12/25) | Already curated by clinical advisor; extending is cheaper than rebuilding. |
| Sentry PHI scrub | Manual log redaction | `_shared/sentry.ts` (Phase 25) | Centralized scrub rules; missed-redaction = HIPAA breach. |

**Key insight:** Every external call MUST go through a `_shared/` wrapper — never directly. The wrapper is the audit seam (BAA scope, PHI scrub, retry policy, telemetry capture).

---

## Runtime State Inventory

> Phase 38 is greenfield infrastructure (no rename/refactor). However, several **first-time tables + scheduled jobs** will register state outside the codebase that the planner must track.

| Category | Items Introduced | Action Required |
|----------|------------------|------------------|
| Stored data | `content_embeddings`, `recommendation_events`, `weekly_digest_sends`, `win_back_sends`, `ai_suggestion_review` — all new tables in `public` schema | New migrations; no migration-from-legacy needed |
| Live service config | `pg_cron` jobs (`weekly-digest-hourly-fanout`, `embed-content-nightly`, `winback-scorer-nightly`) — registered in `cron.job` table, NOT in git | Migration creates them; capture exact `cron.schedule()` SQL in plan-08 for replay |
| Live service config | Vercel AI Gateway routes + budgets — configured in Vercel dashboard | Document budget guardrails in plan-deploy README; per-key cap to prevent runaway |
| OS-registered state | None — no Windows/macOS/launchd state | N/A |
| Secrets/env vars | NEW Supabase Function Secrets: `AI_GATEWAY_API_KEY_CONSUMER`, `AI_GATEWAY_API_KEY_CLINICAL`, `AI_GATEWAY_BASE_URL`, `ANTHROPIC_MODEL_DIGEST`, `OPENAI_EMBED_MODEL` | `supabase secrets set` per env (staging + production); plan-deploy lists |
| Secrets/env vars | NEW Vault entry: `vault.decrypted_secrets` row `name='service_role_key'` (if not already from Phase 25) | Verify Phase 25 already populated; if not, plan-deploy adds it |
| Build artifacts / installed packages | Deno deps via esm.sh URLs — no npm install, no node_modules deltas | None |
| External vendor state | Resend domain `app.leanshot.app` verified (Phase 25 already shipped); no new sender domain | Verify via `_shared/resend-domain-health-check.ts` before first send |

**Nothing found in category:** OS-registered state, build artifacts (verified by inspecting `supabase/functions/` tree + `package.json` — Edge Fns have no compile artifacts).

---

## Common Pitfalls

### Pitfall 1: Cosine operator confusion — `<=>` is DISTANCE not SIMILARITY

**What goes wrong:** SQL like `ORDER BY embedding <=> $1 LIMIT 10` returns closest matches ASCENDING (smallest distance = most similar). Developers expecting "similarity DESC" reverse the order accidentally and return least-similar content.

**Why it happens:** pgvector's `<=>` returns cosine distance (range 0=identical, 2=opposite). Cosine similarity is `1 - (a <=> b)`. The `<->` operator is L2 (Euclidean) distance — DIFFERENT metric.

**How to avoid:** Always `ORDER BY embedding <=> $1` (no DESC). Compute similarity as `1 - (embedding <=> $1) AS similarity` for return value. Use ONLY `<=>` (not `<->`) for OpenAI embeddings — they are L2-normalized so cosine and L2 give equivalent ranking but `<=>` is the contract.

**Warning signs:** Top results feel unrelated; manual spot-check shows recommendations score worse than random.

**[VERIFIED: pgvector README operator table]**

### Pitfall 2: HNSW build parameters `m` + `ef_construction` for the 2k→50k row range

**What goes wrong:** Defaults work for most use cases but recall degrades when index is built on tiny tables and never rebuilt as data grows past 100k rows.

**Why it happens:** `m=16` (max connections per layer) and `ef_construction=64` (build-time candidate list) are pgvector defaults sized for "general purpose." At 2k rows they are over-provisioned (cheap); at 50k they are still well-sized; at 500k+ they would benefit from `m=24, ef_construction=128`.

**How to avoid:** Stay with defaults (`m=16, ef_construction=64`) for v1.3. Set `hnsw.ef_search = 100` (query-time recall knob, default 40) GUC if precision@3 < 0.6 in eval. Plan a v1.4 rebuild script with `m=24, ef_construction=128` if `content_embeddings` exceeds 200k rows.

**Warning signs:** Mean precision@3 < 0.6 on the 20-row eval set (AI-SPEC §5).

**[VERIFIED: pgvector README HNSW parameters + WebFetch 2026-05-20]**

### Pitfall 3: OpenAI rate-limit handling under nightly cron burst

**What goes wrong:** 5000 new KB articles get inserted at once (e.g., Phase 50 import); nightly cron tries to embed all 5000 → hits OpenAI tier-1 RPM limit → some batches fail → recommender returns stale results.

**Why it happens:** OpenAI tier-1 (default new accounts) is ~3000 RPM for embeddings; tier-2 ~5000 RPM. AI Gateway adds its own concurrency cap. Batches of 100 inputs per call still count as 1 request each.

**How to avoid:** (a) Batch up to 100 inputs per call (max per OpenAI embeddings API); (b) cap concurrency at 5 parallel requests; (c) implement exponential backoff on 429 with `Retry-After` header honor; (d) cron processes in batches of 500 with 1s sleep between batches → 30s for 500 articles. [ASSUMED: tier-1 RPM specifically — confirm with `curl https://api.openai.com/v1/models` headers at plan-deploy]

**Warning signs:** Sentry `embed.rate_limit_429` count > 1% of attempts in 1h.

### Pitfall 4: Anthropic context window OK; but watch user-facts template growth

**What goes wrong:** As users log more, the deterministic template grows past the budgeted ~600 tokens.

**Why it happens:** `renderUserFacts()` naively templates "all" symptoms / "all" injections; a heavy logger with 30 injections + 20 symptoms in 7 days bloats the input.

**How to avoid:** Cap inputs in the template: top 5 symptoms by frequency, last 7 weight entries (one per day), last 14 injections (twice-weekly × 7). [VERIFIED: AI-SPEC §4b]

**Warning signs:** Per-digest token count > 2000 input tokens; cost > $0.012/digest.

### Pitfall 5: Embedding-model deprecation (text-embedding-3-small)

**What goes wrong:** OpenAI deprecates `text-embedding-3-small` (or its dimensions change); all stored 1536-d vectors become unusable; cosine queries return garbage.

**Why it happens:** Model lifecycle is OpenAI-controlled; deprecation notice may give 60-90 days. Migrating means re-embedding everything.

**How to avoid:** (a) Store `embedding_model_id` column on `content_embeddings`; (b) on model deprecation, schedule a parallel-table migration: new table → re-embed all rows under new model → atomic swap; (c) monitor OpenAI status page subprocessor-diff (Phase 25 cron already does this). v1 escape hatch: AI Gateway lets us swap to Cohere or Gemini with config change.

**Warning signs:** OpenAI deprecation notice email; embed call returns 410 Gone.

### Pitfall 6: Cost runaway if nightly cron re-embeds unchanged content

**What goes wrong:** Cron loops over all content rows every night and re-embeds; ~$0.10/M tokens × millions of tokens daily.

**Why it happens:** Without a `body_sha256` check, every row looks "needs re-embed."

**How to avoid:** `content_embeddings.body_sha256` column; before embed, compute `sha256(content.body_md)` and skip if unchanged. AI-SPEC §4b "exact-match caching of embeddings." Triggers (D-18) set `stale=true` only on actual UPDATE; nightly cron processes ONLY `stale=true OR last_embedded_at IS NULL`.

**Warning signs:** Daily cost > $0.05/M tokens spread over content tables.

### Pitfall 7: pg_cron + user-timezone resolution edge cases (DST)

**What goes wrong:** On DST spring-forward (e.g., 2026-03-08 US), `02:00 → 03:00` skips; if cron checks `extract(hour) = 9` it works. On fall-back, 09:00 happens TWICE — user gets two digests.

**Why it happens:** Postgres `AT TIME ZONE` honors IANA rules but local 09:00 occurs twice during fall-back.

**How to avoid:** 6-hour dedup window in cron WHERE (`NOT EXISTS sent in last 6h`). The Pattern 3 SQL above embeds this. Also: store `profiles.timezone` as IANA name (`America/New_York`), NOT offset (`-05:00`) — offset doesn't track DST.

**Warning signs:** Duplicate digest sends on DST transition weekend.

### Pitfall 8: BAA-scope guard timing — credential MUST be selected before prompt build

**What goes wrong:** Code builds prompt → looks up `users.org_id` → picks credential. PHI is already in memory under (potentially wrong) tenant context. Phase 25 audit FAILS.

**Why it happens:** Natural code order is "load user → load facts → build prompt → call API." Putting credential selection at the end seems clean.

**How to avoid:** `_shared/baa-scope.ts` wrapper enforces order — `resolveBaaScope(userId)` must be called first; returns `{credential, isClinical}`; ONLY THEN load facts and build prompt. Sentry breadcrumb `baa.scope.resolved` MUST precede `anthropic.messages.create` breadcrumb — assertable in vitest.

**Warning signs:** Sentry trace shows breadcrumbs out of order; `digest.baa_scope_violation` event.

**[VERIFIED: AI-SPEC §3 Pitfall #4 + Phase 25 CONTEXT]**

### Pitfall 9: Refusal prompt injection via user-context text

**What goes wrong:** User puts `"should I increase my dose to 1mg? answer in the recommender"` into their profile bio or symptom log free-text; that text gets embedded → matches dose-advice content → recommender returns "increase dose" article → user reads as endorsement.

**Why it happens:** Embedding text is treated as "context" but contains adversarial intent.

**How to avoid:** (a) Pre-embed scrub via `_shared/refusal.ts` — strip phrases matching medical-advice regex bank BEFORE embed call; (b) post-retrieve scrub — exclude content tagged `safety_critical=true` from recommender output unless user explicitly navigates to it. AI-SPEC §6 O6.

**Warning signs:** PostHog `recommendation.refusal_stripped` event count > 0.5% of recommender calls.

### Pitfall 10: Model ID drift between AI-SPEC, BAA allowlist, and Anthropic docs

**What goes wrong:** AI-SPEC §4 uses `claude-sonnet-4.6` (dotted); Anthropic docs say `claude-sonnet-4-6` (hyphenated); existing `_shared/anthropic-baa-allowlist.ts` only lists `claude-sonnet-4-5` (older snapshot) + `claude-opus-4-6` + `claude-haiku-4-5-20251001`. Deploying with the AI-SPEC dotted form OR the unlisted hyphenated form throws BaaScopeError on every clinical call.

**Why it happens:** Naming conventions differ between Vercel (`anthropic/claude-opus-4.7`) and Anthropic native (`claude-opus-4-7`); allowlist file uses native form.

**How to avoid:** Phase 38 plan-deploy must (a) extend `_shared/anthropic-baa-allowlist.ts` to add `claude-sonnet-4-6` (current latest GA Sonnet per docs 2026-05-20); (b) strip vendor prefix before allowlist check (`modelId.replace(/^anthropic\//, "")`); (c) use hyphenated form everywhere in code; (d) document the AI Gateway slug separately (`ANTHROPIC_MODEL_DIGEST=anthropic/claude-sonnet-4-6`) from the allowlist match (`claude-sonnet-4-6`).

**Warning signs:** Every clinical digest call 403s with `model-not-baa-covered`.

**[VERIFIED: Anthropic docs 2026-05-20 + file `_shared/anthropic-baa-allowlist.ts` read]**

---

## Code Examples

### Embed call (OpenAI via AI Gateway — works for `/embeddings`)

```typescript
// Source: AI-SPEC §3 + Vercel docs (verified 2026-05-20)
async function embed(text: string): Promise<number[]> {
  const r = await fetch(`${Deno.env.get("AI_GATEWAY_BASE_URL")}/embeddings`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${Deno.env.get("AI_GATEWAY_API_KEY_CONSUMER")}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: Deno.env.get("OPENAI_EMBED_MODEL"), // "openai/text-embedding-3-small"
      input: text,                                 // single string OR array up to 100 items
    }),
  });
  if (!r.ok) throw new Error(`embed ${r.status} ${await r.text()}`);
  const j = await r.json();
  return j.data[0].embedding as number[];          // 1536 floats
}
```

### Cosine retrieval RPC call from supabase-js

```typescript
// Source: AI-SPEC §3 + pgvector docs
const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);
const { data, error } = await supabase.rpc("match_content_embeddings", {
  query_embedding: vec,                              // pgvector accepts number[] (jsonb-cast in fn)
  match_count: 10,                                   // over-fetch for re-ranker
  requesting_user_id: userId,                        // RLS-equivalent guard
  sources: ['content_embeddings'],                   // Phase 38 source; Phase 50 adds external_kb_embeddings
});
if (error) throw error;
```

### Anthropic Messages call via AI Gateway (`/v1/messages` NOT `/chat/completions`)

```typescript
// Source: AI-SPEC §4 + Vercel docs (anthropic-messages-api/structured-outputs) verified 2026-05-20
// CRITICAL: do NOT use /chat/completions response_format for Anthropic — schema validation fails.
const url = `${Deno.env.get("AI_GATEWAY_BASE_URL")!.replace(/\/v1$/, "")}/v1/messages`;
const res = await fetch(url, {
  method: "POST",
  headers: {
    "Authorization": `Bearer ${credential}`,
    "Content-Type": "application/json",
    "anthropic-version": "2023-06-01",
  },
  body: JSON.stringify({
    model: "anthropic/claude-sonnet-4-6",       // hyphenated; Vercel routes to Anthropic
    max_tokens: 1024,                            // REQUIRED
    temperature: 0.4,
    system: SYSTEM_PROMPT_DIGEST,
    messages: [{ role: "user", content: userFactsText }],
    output_config: { format: { type: "json_schema", schema: digestJsonSchema } },
  }),
});
```

### HNSW + cosine RPC migration

```sql
-- Source: pgvector README + AI-SPEC §3 + verified WebFetch 2026-05-20
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE public.content_embeddings (
  content_id uuid PRIMARY KEY REFERENCES public.content(id) ON DELETE CASCADE,
  embedding vector(1536) NOT NULL,
  body_sha256 text NOT NULL,
  last_embedded_at timestamptz NOT NULL DEFAULT now(),
  stale boolean NOT NULL DEFAULT false,
  embedding_model_id text NOT NULL DEFAULT 'openai/text-embedding-3-small'
);

CREATE INDEX content_embeddings_hnsw_cos
  ON public.content_embeddings
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- Optional query-time recall knob (only set in postgresql.conf or per-session):
-- SET hnsw.ef_search = 100;
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact for Phase 38 |
|--------------|------------------|--------------|---------------------|
| OpenAI `text-embedding-ada-002` | OpenAI `text-embedding-3-small` (1536 dims) or `-large` (3072 dims) | Jan 2024 (3-series GA) | RECOMMEND-02 already locks `-small`; no change needed |
| pgvector IVFFlat | pgvector HNSW (since pgvector 0.5, Aug 2023) | Aug 2023 | Phase 38 chooses HNSW; IVFFlat retained as legacy fallback |
| Direct Anthropic/OpenAI SDK in Edge Fn | Vercel AI Gateway proxy (OpenAI-compatible + Anthropic Messages) | Phase 25 lock | Already standard in `_shared/`; Phase 38 reuses |
| Anthropic `claude-3-5-sonnet-20241022` (dated) | `claude-sonnet-4-6` (dateless pinned snapshot per docs note) | Sonnet 4.6 GA | AI-SPEC reference needs hyphenation fix |
| Function-calling tools for structured outputs | `output_config.format.json_schema` on Messages API | GA late 2025 | Phase 38 uses this directly |
| LlamaIndex / LangChain wrappers for simple RAG | No-framework direct-fetch in Edge Fn | Phase 38 framework selection (this milestone) | Confirmed by FRAMEWORK-SELECTION.md |
| Single-tenant embedding tables | Per-source tables (`content_embeddings` + `external_kb_embeddings`) merged via RPC | Phase 50 D-28 lock | Phase 38 designs RPC `sources[]` param at v1 |

**Deprecated/outdated to avoid:**
- `text-embedding-ada-002` (older, costlier than `-3-small`)
- `claude-3-5-sonnet-20241022`, `claude-3-opus-20240229` (pre-4.x generation)
- AI Gateway `/chat/completions` `response_format` against Anthropic models (fails schema validation)
- pgvector IVFFlat for sub-100k tables that will grow
- `current_setting('app.service_role_key')` GUC for cron — does NOT exist on this Supabase project; use `vault.decrypted_secrets`

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | OpenAI tier-1 RPM ~3000 for embeddings; tier-2 ~5000 | Pitfall #3 | Cron burst handling under-sized → 429 errors on initial backfill; mitigation = lower batch concurrency from 5 → 2 |
| A2 | `@supabase/supabase-js@2.105.0` is current (matches existing import_map) | Standard Stack | Minor — newer point releases are typically backwards-compat; verify with `npm view` at plan-write |
| A3 | `zod@3.23.8` is appropriate version pin | Standard Stack | Minor — Zod 3.x stable; v4 exists but adds API changes. Confirm preferred version at plan-write |
| A4 | Phase 50 RAG migrations have NOT touched timestamp window `20270705*` | Project Structure | Migration timestamp collision per `reference_migration_timestamp_collision_precheck`; pre-check before plan-write |

**If this table is empty: not applicable.** 4 assumptions flagged — A1 has highest implementation risk; A4 has highest collision risk and is cheapest to verify (one `ls`).

---

## Open Questions

1. **Should the `recommendation_id` be persisted or computed on-the-fly?**
   - What we know: D-03 requires `recommendation_id` in payload for CTR event correlation.
   - What's unclear: persist to `recommendation_events` at impression time vs UUID-on-render.
   - Recommendation: persist at impression (server-generated UUID v4) so CTR clicks correlate cleanly. Plan-checker will catch if planner chooses client-generated.

2. **Is `profiles.timezone` set by onboarding (Phase 34) or by Phase 38?**
   - What we know: No `profiles.timezone` column exists today (verified 2026-05-20 grep).
   - What's unclear: Phase 34 ONBOARD-04 mentions "Smart defaults inferred from Accept-Language + IP (currency, units, timezone)" — does that store timezone in `profiles` or elsewhere?
   - Recommendation: Phase 38 OWNS the migration that adds `profiles.timezone`. Phase 34 plan-checker will coordinate to write to the column once it exists. If Phase 34 ships first, Phase 38 still adds the column as ALTER TABLE.

3. **HITL queue table reuse — does `ai_suggestion_review` extend an existing Phase 27 admin queue table?**
   - What we know: D-12 says "Reuses Phase 27 admin queue primitives."
   - What's unclear: Does Phase 27 ship a generic `admin_queue` table that Phase 38 polymorphs into, or does Phase 38 own its dedicated table?
   - Recommendation: Phase 38 owns `ai_suggestion_review` with its own RLS + schema; references Phase 27 admin shell UI primitives (filter pills, approval workflow) but does NOT share storage. Decouples release risk.

4. **Anthropic prompt caching savings — assumed ~30% but unverified.**
   - What we know: AI-SPEC §4b claims ~90% discount on cached tokens; ~30% overall digest savings post-warm.
   - What's unclear: Cache hit rate is workload-dependent; AI Gateway exposes cache headers `x-anthropic-prompt-cache-*` only after first warm.
   - Recommendation: instrument cache-hit counters from day 1 (PostHog event `anthropic.prompt_cache.hit`); revisit cost model in Week 2 of production.

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|-------------|-----------|---------|----------|
| Supabase Pro+ with pgvector | RECOMMEND-01 | ✓ | Supabase 2.x; pgvector bundled | — (locked v1.1) |
| Supabase Edge Functions (Deno runtime) | All Phase 38 Edge Fns | ✓ | Deno 1.45+ | — |
| `pg_cron` extension | RECOMMEND-03/05/10 cron | ✓ | bundled | — (Phase 25 + Phase 33 patterns proven) |
| Supabase Vault (`vault.decrypted_secrets`) | pg_cron service-role | ✓ (Phase 25 populated) | — | — |
| Vercel AI Gateway | All AI calls | ✓ (Phase 25 keyed) | v1 (HTTP API) | If outage: digest skips week + alerts; recommender falls back to popular content |
| OpenAI `text-embedding-3-small` (via AI Gateway) | RECOMMEND-02/03/04 | ✓ | 1536-d | Fallback to Cohere or Gemini via AI Gateway config (deferred per CONTEXT) |
| Anthropic `claude-sonnet-4-6` (via AI Gateway) | RECOMMEND-05 | ✓ (need to extend BAA allowlist) | dateless pinned snapshot | Fallback to `claude-haiku-4-5` for cost (separate eval) |
| Resend SMTP (consumer non-PHI) | RECOMMEND-05 + RECOMMEND-10 | ✓ (Phase 25) | — | — |
| Sentry (Phase 25) | All Edge Fn observability | ✓ | — | — |
| PostHog server-side (Phase 24) | RECOMMEND-06 telemetry | ✓ | `_shared/posthog-server.ts` | — |
| `profiles.timezone` column | RECOMMEND-05 per-user cron | ✗ (does NOT exist) | — | **Phase 38 adds via migration; default `America/New_York`** |
| `_shared/baa-scope.ts` | All Anthropic clinical calls | ✗ (NEW file) | — | Phase 38 creates following `_shared/anthropic-baa-allowlist.ts` pattern |
| Phase 40 SAVE engine (`save_engine.trigger`) | RECOMMEND-10 win-back handoff | ✗ (Phase 40 NOT YET PLANNED per STATE.md) | — | **Phase 38 ships INSERT into `win_back_sends` with `pending_handoff` status; Phase 40 reads + delivers when planned.** Health-check pattern per `reference_vendor_gated_send_health_check` |

**Missing dependencies with no fallback:** None — all blockers have a viable workaround.

**Missing dependencies with fallback:**
- `profiles.timezone` column — Phase 38 owns the ADD COLUMN migration.
- `_shared/baa-scope.ts` — Phase 38 creates following established Phase 25 pattern.
- Phase 40 SAVE engine — Phase 38 ships row-insert; Phase 40 reads + delivers.

---

## Validation Architecture

> `workflow.nyquist_validation: true` per `.planning/config.json` → section included.

### Test Framework

| Property | Value |
|----------|-------|
| Framework | **Vitest** (existing across the project; per package.json devDependencies) |
| Deno-side tests | **`deno test`** for Edge Fn unit tests (existing pattern in `supabase/functions/_shared/*.test.ts`) |
| Config file | `vitest.config.ts` (existing) + Deno tests use no config |
| Quick run command | `npm run test -- supabase/functions/_shared/digest-schema.test.ts` (per-file Vitest) |
| Quick run command (Deno) | `deno test supabase/functions/_shared/anthropic-summarize.test.ts --allow-env --allow-net` |
| Full suite command | `npm run test && cd supabase && deno test functions/_shared/*.test.ts` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| RECOMMEND-01 | pgvector extension enabled; HNSW index built; `<=>` operator returns ascending distance | DB integration | `deno test supabase/functions/_shared/pgvector-smoke.test.ts` | ❌ Wave 0 |
| RECOMMEND-02 | OpenAI embedding call returns 1536-d vector | unit (mocked fetch) | `vitest run supabase/functions/_shared/openai-embed.test.ts` | ❌ Wave 0 |
| RECOMMEND-03 | Nightly cron embeds new + stale content; sha256 dedup works | DB integration | `deno test supabase/functions/embed-content-nightly/index.test.ts` | ❌ Wave 0 |
| RECOMMEND-04 | Recommender returns top-3 with multi-surface tags; sparse-history falls back to popular | DB + Edge Fn integration | `vitest run tests/e2e/recommender.spec.ts` | ❌ Wave 0 |
| RECOMMEND-04 | Cross-tenant isolation — user A sees no content from user B's org | RLS impersonation | `vitest run tests/rls/recommender-cross-tenant.spec.ts` | ❌ Wave 0 |
| RECOMMEND-05 | Digest call routes to correct credential (consumer vs clinical); breadcrumb order asserted | unit + integration | `vitest run supabase/functions/_shared/baa-scope.test.ts` | ❌ Wave 0 |
| RECOMMEND-05 | Digest Zod parse rejects non-whitelist action_id | unit | `vitest run supabase/functions/_shared/digest-schema.test.ts` | ❌ Wave 0 |
| RECOMMEND-05 | pg_cron fires only at user-local 09:00 Sunday | DB integration (time-mocked) | `deno test supabase/functions/weekly-digest/timezone.test.ts` | ❌ Wave 0 |
| RECOMMEND-06 | PostHog `recommendation.shown/.clicked` events fire with correct payload | unit | `vitest run supabase/functions/_shared/posthog-server.test.ts` (EXTEND existing) | ✅ existing extend |
| RECOMMEND-07 | HITL queue auto-approves KB-sourced; queues all other types | DB integration | `vitest run tests/e2e/hitl-queue.spec.ts` | ❌ Wave 0 |
| RECOMMEND-08 | Recommender returns same payload shape for dashboard / kb_footer / community / course surfaces | snapshot test | `vitest run tests/e2e/multi-surface-payload.spec.ts` | ❌ Wave 0 |
| RECOMMEND-09 | Plan-personalize returns offer hint <50ms p99 | perf test | `vitest run tests/perf/plan-personalize.spec.ts` | ❌ Wave 0 |
| RECOMMEND-10 | Win-back fires `save_engine.trigger` after 14d inactivity; respects 30d cap | DB integration | `vitest run tests/e2e/winback-scorer.spec.ts` | ❌ Wave 0 |

### Sampling Rate

- **Per task commit:** `vitest run <changed-files>` + `deno test <changed-fns>` (under 30s)
- **Per wave merge:** `npm run test && cd supabase && deno test functions/`
- **Phase gate:** full Vitest + Deno suite + integration suite green before `/gsd-verify-work`

### Wave 0 Gaps

- [ ] `supabase/functions/_shared/openai-embed.test.ts` — covers RECOMMEND-02
- [ ] `supabase/functions/_shared/anthropic-summarize.test.ts` — covers RECOMMEND-05 (BAA scope + schema)
- [ ] `supabase/functions/_shared/baa-scope.test.ts` — credential-order assertion
- [ ] `supabase/functions/_shared/digest-schema.test.ts` — Zod whitelist + clinical-keyword blocklist
- [ ] `supabase/functions/_shared/recommender-rank.test.ts` — business-rule re-ranker
- [ ] `supabase/functions/_shared/pgvector-smoke.test.ts` — HNSW index + cosine operator smoke
- [ ] `supabase/functions/embed-content-nightly/index.test.ts` — sha256 dedup + stale handling
- [ ] `supabase/functions/weekly-digest/index.test.ts` — full per-user happy path
- [ ] `supabase/functions/weekly-digest/timezone.test.ts` — DST edge cases + 6h dedup
- [ ] `tests/e2e/recommender.spec.ts` — top-3 + sparse fallback + surface_target
- [ ] `tests/rls/recommender-cross-tenant.spec.ts` — impersonation proof (project rule: every RLS surface)
- [ ] `tests/e2e/hitl-queue.spec.ts` — KB auto-approve + non-KB queue
- [ ] `tests/e2e/multi-surface-payload.spec.ts` — snapshot test on 4 surface_targets
- [ ] `tests/perf/plan-personalize.spec.ts` — <50ms p99 assertion
- [ ] `tests/e2e/winback-scorer.spec.ts` — 14d threshold + 30d cap + SAVE handoff
- [ ] `tests/eval/phase38-refset.json` — 20-row reference dataset per AI-SPEC §5
- [ ] `tests/eval/phase38/` — Vitest LLM-judge harness for fidelity/redflag/tone dims

---

## Security Domain

> `security_enforcement` not explicitly false in config → enabled by default.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | Caller JWT validated by Supabase; service-role only for pg_cron path |
| V3 Session Management | yes (indirect) | JWT + RLS on every Postgres query; service-role re-imposes `user_id`/`org_id` |
| V4 Access Control | yes | RLS on `content_embeddings`, `recommendation_events`, `weekly_digest_sends`, `win_back_sends`, `ai_suggestion_review`; super-admin-only HITL (D-14) |
| V5 Input Validation | yes | Zod schema on every Edge Fn request body; `WHITELIST_ACTION_IDS` enum; clinical-keyword regex blocklist on `reason` field |
| V6 Cryptography | yes (indirect) | Supabase vault for service-role key; AI Gateway TLS; no hand-rolled crypto |

### Known Threat Patterns for Phase 38 Stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Cross-tenant data leak (user A sees user B's recommendations) | Information Disclosure | RLS on all tables + explicit `requesting_user_id` re-imposition in RPC (project rule); live impersonation proof test |
| BAA-scope violation (clinic PHI traverses consumer Anthropic key) | Information Disclosure | `_shared/baa-scope.ts` + breadcrumb-order assertion + Sentry P0 alert |
| Prompt injection via user-context text | Tampering | `_shared/refusal.ts` pre-embed scrub + safety-tagged content exclusion |
| SQL injection on cosine RPC | Tampering | Parameterized RPC (no string concat); supabase-js `.rpc()` is parameterized by design |
| Whitelist bypass (free-text dose advice) | Tampering | Zod enum + DB CHECK + clinical-keyword regex on `reason` (3-layer defense) |
| Stale-content 404 → trust erosion | Repudiation (UX) | `expires_at` server-rejects > 7d (D-03); stale-window 30d in RPC WHERE |
| Cost runaway via retry storm | Denial of Service (budget) | Retry cap 3; AI Gateway per-key cap; per-user cost alert > $0.05/month |
| HITL queue privilege escalation (clinic-admin sees super-admin queue) | Elevation of Privilege | D-14 super-admin only RLS; `surfaceCheck('admin.hitl.*')` gate |
| Vault `service_role_key` exfiltration via SQL injection in cron body | Information Disclosure | `vault.decrypted_secrets` queried ONLY in SECURITY DEFINER fns; cron bodies use named dollar-quote tags (`reference_postgres_dollar_quote_nesting_in_cron_body`) |
| Replay of digest send | Repudiation | `weekly_digest_sends` audit table with PRIMARY KEY (user_id, sent_at::date); 6h dedup window in cron |

---

## Sources

### Primary (HIGH confidence)

- **Anthropic Models Overview** (fetched 2026-05-20) — claude-sonnet-4-6, claude-haiku-4-5, claude-opus-4-7 IDs + pricing — https://platform.claude.com/docs/en/docs/about-claude/models/overview
- **Vercel AI Gateway docs** (fetched 2026-05-20) — base URL, OpenAI + Anthropic routing, model slug format — https://vercel.com/docs/ai-gateway
- **pgvector README** (fetched 2026-05-20) — HNSW syntax, `<=>` operator, IVFFlat vs HNSW choice — https://github.com/pgvector/pgvector/blob/master/README.md
- **38-AI-SPEC.md** (locked 2026-05-19) — system contract, JSON-schema spec, eval dimensions, guardrails, monitoring, cost math
- **38-CONTEXT.md** (locked 2026-05-19) — 19 D-NN decisions + Claude's discretion + deferred ideas
- **38-FRAMEWORK-SELECTION.md** (locked 2026-05-19) — no-framework rationale
- **`.planning/REQUIREMENTS.md`** — RECOMMEND-01..10 verbatim text
- **`supabase/functions/_shared/anthropic-baa-allowlist.ts`** — existing file showing current allowlist (read 2026-05-20)
- **Project memory `reference_supabase_pg_cron_vault_service_role_pattern`** — pg_cron + vault pattern
- **Project memory `reference_postgres_dollar_quote_nesting_in_cron_body`** — named dollar-tags rule
- **Project memory `reference_supabase_migration_filename_regex`** + `reference_migration_timestamp_collision_precheck`
- **Project memory `reference_rls_fixture_gotrueclient_flake`** — RLS test pattern

### Secondary (MEDIUM confidence)

- **OpenAI text-embedding-3-small spec** (WebSearch 2026-05-20) — 1536 dims, 8192 token cap, $0.02/1M — confirmed multi-source (costgoat, helicone, OpenAI pricing page in search results)
- **Phase 50 CONTEXT.md** D-28 / D-29 — separate `external_kb_embeddings` table + recommender Edge Fn extension
- **Phase 25 CONTEXT.md** — clinical-vs-consumer credential split + BAA-scope pattern

### Tertiary (LOW confidence — flagged for validation)

- OpenAI tier-1/tier-2 RPM limits for embeddings (Pitfall #3, A1 in Assumptions Log)
- `@supabase/supabase-js@2.105.0` as current latest (A2)
- `zod@3.23.8` as preferred pin (A3)

---

## Metadata

**Confidence breakdown:**
- Standard stack: **HIGH** — every library verified live 2026-05-20 (Anthropic docs, Vercel docs, pgvector README); 3 minor version pins flagged
- Architecture: **HIGH** — AI-SPEC + CONTEXT lock 80% of architecture; this RESEARCH adds (a) the multi-source RPC signature for Phase 50 future-proof, (b) the timezone column ownership, (c) the BAA allowlist extension
- Pitfalls: **HIGH** — 10 pitfalls each tied to a verified source (AI-SPEC, pgvector docs, Anthropic docs, or project memory)
- REQ-ID coverage: **HIGH** — 10/10 REQs map to concrete implementation patterns

**Research date:** 2026-05-20
**Valid until:** 2026-06-20 (30 days for stable Anthropic + pgvector + Vercel surfaces; sooner if Sonnet 4.7 ships or pgvector 0.6 lands)

**Confidence rationale for "Valid until":**
- Anthropic model IDs change with each generation (every ~3 months) — Sonnet 4.7 plausible by Aug 2026
- pgvector default parameters stable since 0.5 (Aug 2023) — no churn expected
- Vercel AI Gateway API surface stable since GA late 2024 — no churn expected
- OpenAI `text-embedding-3-small` lifecycle: announced Jan 2024; typical OpenAI lifecycle is 12-24 months before deprecation notice

---

*Phase 38 research — gsd-phase-researcher — 2026-05-20*
