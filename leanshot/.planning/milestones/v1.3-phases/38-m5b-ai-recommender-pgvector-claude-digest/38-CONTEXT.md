# Phase 38: M5b AI Recommender (pgvector + Claude Digest) - Context

**Gathered:** 2026-05-19
**Status:** Ready for planning

<domain>
## Phase Boundary

Phase 38 ships the **AI recommendation + summarization layer** for LeanShot v1.3 over Supabase pgvector + Vercel AI Gateway:

1. **Next-Best-Action recommender** (RECOMMEND-04) — Edge Function returns top-3 content recommendations from `content_embeddings vector(1536)` via cosine similarity on a user-context vector built from recent events + profile.
2. **Nightly embedding cron** (RECOMMEND-03) — embeds new internal content (KB articles, blog posts; community posts and course lessons when those phases ship) using OpenAI `text-embedding-3-small` proxied through Vercel AI Gateway.
3. **Weekly Claude digest** (RECOMMEND-05) — Sunday 09:00 user-timezone email narrating last 7 days + 1-3 suggested actions drawn from a whitelist; routed via Resend (consumer, non-PHI) per Phase 25 router.
4. **Win-back prompts** (RECOMMEND-10) — at-risk users routed via Phase 40 SAVE engine.
5. **HITL review queue** (RECOMMEND-07) — admin surfaces for approving/editing/rejecting AI suggestions before send.
6. **Pricing/offer personalization Edge Fn** (RECOMMEND-09) — called by Phase 39 PAYWALL + Phase 40 SAVE; returns user-specific offer hints.
7. **CTR telemetry** (RECOMMEND-06) — server-side PostHog (Phase 24) tracks impression/click per recommendation-type.

**System type is RAG** (similarity retrieval + single-turn summarization). System-design depth is locked in `38-AI-SPEC.md` (no-framework + GLP-1 domain context + 10 eval dimensions + 8 online + 9 offline guardrails).

**Carrying forward from earlier phases:**
- **Phase 50** already locked: **HNSW index** (not IVFFlat); separate `external_kb_embeddings` table for scraped external content; Phase 38 recommender Edge Fn extends in Phase 50 (one Edge Fn, two embedding sources, merged scoring) — design Phase 38 Edge Fn to accept multiple-source query at the API level.
- **Phase 25** clinical-vs-consumer Anthropic credential split — Phase 38 weekly digest uses **consumer** credential (non-PHI sanitized narrative); BAA-scope-guard helper from `supabase/functions/_shared/baa-scope.ts` required.
- **Phase 25** Resend (non-PHI) vs SES (PHI) email router — Phase 38 digest routes via Resend consumer path because sanitized narrative is non-PHI.
- **Phase 24** server-side PostHog + AEM event registry — all Phase 38 telemetry uses TAXO-registered events; never client-side AEM-priority.
- **Phase 24** modular admin shell — HITL queue plugs in as a new admin module.
- **Phase 40** SAVE engine (CONTEXT.md + UI-SPEC.md locked) — Phase 38 win-back fires `save_engine.trigger(user_id, reason='inactive_14d')`; SAVE flow owns the offer selection.
- **Phase 49** Resend digest pattern + 1-click unsubscribe (DIGEST-04) — Phase 38 RECOMMEND-05 reuses the unsubscribe plumbing.

</domain>

<decisions>
## Implementation Decisions

### Recommender Surfaces & Cold-Start

- **D-01: Ship all three surfaces in Phase 38 with future-proof multi-surface payload.** The recommender Edge Function returns a tagged payload (`surface_target: dashboard | kb_footer | community_feed | course_landing`). Dashboard "For you" card + KB article footer render TODAY (those features exist). Community feed + course landing render as **no-op shims** that consume the same payload when M4 (Phases 43-49) and Phase 46 (courses) ship — wiring the UI later requires no AI-layer redeploy.
- **D-02: Cold-start fallback = popular-content for users with <5 events in the last 14 days.** Recommender Edge Fn detects sparse user history → returns top-3 globally-popular KB articles (popularity computed from PostHog impression+click data, refreshed nightly). Avoids zero-shot embedding-on-empty-profile failure. Once user crosses 5 events, switch to personalized cosine-similarity path.
- **D-03: Recommender Edge Fn response shape** — top-3 array of `{recommendation_id, source_type, source_id, title, deeplink, score, surface_target[], action_id?, expires_at}`. `action_id` is OPTIONAL and drawn from a whitelist enum (see D-08); absence means the rec is content-only (read this KB article). `expires_at` is required (forces freshness loop — server rejects rec older than 7 days).

### Weekly Claude Digest

- **D-04: Opt-IN default, sanitized narrative only (free + paid + clinic — uniform v1).** Users opt in via Settings → Email Preferences. Default OFF. Once enabled, digest narrates counts and trends but NEVER names specific drug, dose, or weight values. Example: *"You logged 4 injections this week, kept your streak going for 28 days, and reported 'energy: 4/5' — a steady week. Two ideas: log your weekly weight check-in (you missed last week), and try the hydration-101 article."* Conservative HIPAA posture for v1; v1.4 reconsiders tiered PHI-bearing variant for paid.
- **D-05: No auto-pause v1; standard 1-click unsubscribe per Phase 49 DIGEST-04.** Skip "auto-pause after N unopened" engineering for v1. If user stops opening, they unsubscribe. Reduces v1 complexity; track unopened-3-weeks cohort in PostHog so v1.4 can revisit.
- **D-06: Send-time = Sunday 09:00 in user's profile timezone (RECOMMEND-05 verbatim).** Cron uses `pg_cron` per the Phase 25 `vault.decrypted_secrets` + service-role pattern (see `reference_supabase_pg_cron_vault_service_role_pattern`). Per-user timezone resolved from `profiles.timezone` (defaults to `America/New_York` if NULL).
- **D-07: Digest content composition.** Last-7-day stats: injections logged, weight delta vs prior 7d, mood/energy trend, streak status, missed check-ins. Plus 1-3 action suggestions drawn from the RECOMMEND-07 whitelist enum (see D-08) — Claude picks WHICH actions to surface from the candidate list assembled by the recommender, but does NOT generate free-text actions.

### Win-Back & SAVE Handoff

- **D-09: Win-back threshold = 14 consecutive days with zero logged events.** Single simple threshold. No multi-factor formula in v1 (defer the score-based formula in RECOMMEND-10 to v1.4 once we have churn-data baseline).
- **D-10: Cadence = max 1 win-back SAVE prompt per 30 days, per user.** Hard cap enforced in DB (`win_back_sends` table with `last_sent_at` + 30d unique constraint). Phase 38 fires `save_engine.trigger(user_id, reason='inactive_14d')` once → Phase 40 SAVE owns the offer-selection + delivery.
- **D-11: Win-back channel = email-first via Phase 25 Resend (consumer router), with in-app banner on next session.** Email sent immediately at 14d-inactive trigger; if user opens the app within 7 days, banner appears with the same offer. No SMS, no push v1.

### HITL Review Queue (RECOMMEND-07)

- **D-12: Single queue for ALL rec types (recommender, digest, win-back).** Reuses Phase 24 admin shell + Phase 27 admin queue primitives. One filter pill set: `type ∈ {recommender, digest, win_back}`; one approval workflow. Per-type queues in v1.4 if volume justifies.
- **D-13: Auto-approve KB-sourced content recommendations.** Recommendations whose `source_type == 'kb_article'` AND `action_id ∈ {null, 'read_kb'}` skip the queue (KB articles already passed Phase 50 admin curation). Everything else (digest narrative samples, win-back copy variants, novel action suggestions) queues for super-admin review.
- **D-14: Super-admin only role in v1; no clinic-admin HITL access.** All AI suggestions are global content — clinic-scoped HITL would require per-clinic content variants which are out of scope. Clinic admins see only the live-fired recommendations for their org via the analytics dashboard (read-only).
- **D-15: Whitelist-enum for `action_id`.** v1 whitelist: `{read_kb:<slug>, log_weight, log_injection, log_meal, view_curve, share_with_doctor, complete_onboarding_step, try_recipe:<slug>, watch_tutorial:<slug>}`. Claude digest + recommender NEVER emit free-text actions; if no whitelist match exists, the rec is content-only (deeplink + headline). Eliminates ~80% of HITL workload and prevents the "increase your dose to 2 mg" failure mode.

### Plan-Personalization Edge Fn (RECOMMEND-09)

- **D-16: Plan-personalization Edge Fn is SEPARATE from the recommender Edge Fn.** New function `supabase/functions/plan-personalize/`. Called by Phase 39 PAYWALL + Phase 40 SAVE with `{user_id, context: 'paywall' | 'save_offer', plan_id?}`. Returns `{offer_hint: 'annual_nudge' | 'discount_eligible' | 'pause_offer' | 'extended_trial', confidence, rationale}`. Phase 39/40 own the actual offer rendering — Phase 38 only ranks candidates.
- **D-17: Plan-personalization is rule-based in v1 (no LLM call).** Hand-coded rules from plan-history + activation event + paywall-dismissal count. Avoids LLM cost + latency on hot conversion path (<50ms p99 target). v1.4 can layer in an LLM judge if rules underperform.

### Embedding Lifecycle

- **D-18: Re-embed on content edit (not nightly diff).** When admin edits a KB article via the Phase 27/50 admin surface, an `after_update` trigger queues a re-embed job. Nightly cron handles NEW content + retry of failed embedding jobs. Prevents stale-embedding failure mode #5 from the AI-SPEC critical-failure-modes list.
- **D-19: Soft-delete cascade.** Content marked `deleted_at` → embedding row stays for 7 days (audit window) → daily cleanup removes embedding. Recommender retrieval filters `WHERE content.deleted_at IS NULL`.

### Claude's Discretion

- Exact `vector(1536)` table schema (column names, constraint shape, RLS policies) — planner picks following Phase 25 RLS conventions + Phase 50 D-28 separate-table pattern.
- HNSW `m` and `ef_construction` parameters — researcher tunes for expected row count (initial: ~2k KB + blog rows; cap at 50k v1 with index rebuild script).
- User-context vector composition recipe — researcher picks (likely weighted-sum of last-30d event-type embeddings + profile-text embedding); document in `38-RESEARCH.md`.
- Concrete pg_cron schedule expressions — planner uses Phase 25 cron pattern.
- Digest template (HTML/MJML/plain-text) — researcher picks following Phase 49 DIGEST patterns.
- Sentry instrumentation depth — researcher uses Phase 24 standard patterns.
- A/B variants for digest tone / recommender ranking — out of scope for Phase 38 (Phase 39 owns A/B trifecta).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### AI System Design (LOCKED by AI-SPEC)
- `.planning/phases/38-m5b-ai-recommender-pgvector-claude-digest/38-AI-SPEC.md` — **MUST READ before planning.** Locks no-framework architecture, GLP-1 domain context (6 rubric dimensions + 6 expert roles + WMHMDA/FDA SaMD constraints), 10 eval dimensions, 8 online + 9 offline guardrails, production monitoring (Vercel AI Gateway + PostHog + Sentry + Vitest LLM-judge harness).
- `.planning/phases/38-m5b-ai-recommender-pgvector-claude-digest/38-FRAMEWORK-SELECTION.md` — Framework decision rationale (no-framework + LlamaIndex TS as alt).

### Phase Roadmap + Requirements
- `.planning/REQUIREMENTS.md` §RECOMMEND-01..10 — full requirement statements (10 REQs).
- `.planning/ROADMAP.md` §"Phase 38" — phase entry + 5 success criteria.

### Phase 25 — HIPAA + Vendor BAA (LOCKED)
- `.planning/phases/25-hipaa-audit-hardening-vendor-baa-chain/25-CONTEXT.md` — clinical-vs-consumer Anthropic credential split; Resend vs SES email router; BAA-scope guard pattern at `supabase/functions/_shared/baa-scope.ts`.
- Memory `reference_supabase_pg_cron_vault_service_role_pattern` — pg_cron + vault.decrypted_secrets pattern for Edge Fn invocation.

### Phase 24 — Foundation (LOCKED)
- `.planning/phases/24-foundation-modular-admin-shell-event-taxonomy-server-side-posthog/24-CONTEXT.md` — server-side PostHog + AEM event registry; modular admin shell.
- `.planning/phases/24-*/24-*-PLAN.md` — event taxonomy definitions (TAXO-NN); use existing event names where applicable, register new ones for Phase 38 surfaces.

### Phase 28 — Org Schema (LOCKED for clinic surface)
- `.planning/phases/28-clinic-organizations-schema-rls-hardening/28-CONTEXT.md` — `withOrgScope` wrapper; RLS pattern Phase 38 clinic-admin read-only analytics view must follow.

### Phase 40 — SAVE Engine (CONTEXT + UI-SPEC LOCKED, PLAN pending)
- `.planning/phases/40-cancellation-save-offers-flow/40-CONTEXT.md` — SAVE engine API; Phase 38 fires `save_engine.trigger(user_id, reason)` only — Phase 40 owns offer selection.
- `.planning/phases/40-cancellation-save-offers-flow/40-UI-SPEC.md` — SAVE flow UI; win-back banner reuses this pattern.

### Phase 49 — Digest Patterns
- `.planning/phases/49-*/49-CONTEXT.md` (not yet written; reference DIGEST-01..04 in REQUIREMENTS) — Resend digest plumbing + 1-click unsubscribe pattern.

### Phase 50 — RAG KB (DOWNSTREAM, partially LOCKS Phase 38)
- `.planning/phases/50-admin-curated-rag-knowledge-base-peptide-topic-research-scra/50-CONTEXT.md` — D-28 separate `external_kb_embeddings` table; D-29 extends Phase 38 recommender Edge Fn (one Fn, two sources) — **Phase 38 planner MUST design Edge Fn API to accept multi-source query at v1 to avoid breaking change in Phase 50.**

### Cross-cutting memory references (from `.claude/projects/*/memory/`)
- `reference_supabase_edge_function_deploy` — bundler ignores import_map.json (use esm.sh); gateway forces text/plain + CSP sandbox.
- `reference_supabase_functions_deploy_no_linked_flag` — CLI v2.100.0 errors on `--linked` for function deploy.
- `reference_supabase_migration_filename_regex` — strict 14-digit timestamp; pre-emptive collision check at `20270704*` window (P25/P33/P50 occupy `20270702-3*`).
- `reference_postgres_dollar_quote_nesting_in_cron_body` — use named tags (`$cron$ ... $partition$`) inside `cron.schedule()` to avoid `$$` collision.
- `reference_supabase_v2_aal_api` — RLS test patterns for service-role Edge Fn calls.
- `reference_rls_fixture_gotrueclient_flake` — admin.generateLink + /auth/v1/verify pattern for RLS tests.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `supabase/functions/_shared/baa-scope.ts` (Phase 25): MUST wrap every AI Gateway call to enforce clinical-vs-consumer credential split.
- `supabase/functions/_shared/email-router.ts` (Phase 25): routes Resend (non-PHI) vs SES (PHI); digest uses Resend consumer path.
- `supabase/functions/_shared/posthog-server.ts` (Phase 24): all telemetry; never client-side capture for AI-layer events.
- `supabase/functions/_shared/refusal.ts` (Phase 12/25): refusal patterns for medical-advice prompts — extend for digest prompt guardrails.
- Phase 24 admin shell `src/admin/*` — HITL queue plugs in as a new module following Phase 27 admin patterns.
- `src/components/ui/Card.tsx` — dashboard "For you" card reuses bento Card primitive (`span={4}` or `span={6}`).
- Phase 50 admin curation UI patterns — HITL queue UX follows the Phase 50 review-queue pattern (different domain, same shape).

### Established Patterns
- **No npm imports in Edge Functions** — all deno deps via esm.sh URL specifiers (e.g., `https://esm.sh/@supabase/supabase-js@2.105.0`).
- **AI Gateway proxy posture** (v1.2 AI Coach) — all model calls via `https://ai-gateway.vercel.sh/v1` with Vercel-issued API key (NEVER vendor API keys directly).
- **pg_cron + vault** for scheduled Edge Fn invocation (NOT GitHub Actions / Vercel Cron).
- **Append-only audit tables** for HITL decisions (HIPAA-14 pattern).
- **Soft-delete with cascade behavior** (Phase 50 D-13 pattern) for content embeddings.

### Integration Points
- **Recommender Edge Fn ⟶ dashboard "For you" card**: card calls Edge Fn on mount, falls back to popular content on error/timeout.
- **Recommender Edge Fn ⟶ KB article footer**: footer calls Edge Fn with `surface_target=kb_footer&exclude_id=<current_kb>`.
- **Recommender Edge Fn ⟶ Phase 50 recommender extension**: Edge Fn already accepts `sources=['content_embeddings']`; Phase 50 adds `sources=['content_embeddings', 'external_kb_embeddings']`.
- **Win-back trigger ⟶ Phase 40 SAVE engine**: `save_engine.trigger(user_id, reason='inactive_14d')` — Phase 40 owns delivery.
- **Plan-personalization Edge Fn ⟶ Phase 39 PAYWALL + Phase 40 SAVE**: rule-based offer-hint API (NO LLM call in v1).
- **HITL queue ⟶ Phase 27 admin shell**: registers as a new admin module.
- **Telemetry ⟶ Phase 24 PostHog server-side**: new TAXO events (`recommend_impression`, `recommend_click`, `digest_send`, `digest_open`, `digest_click`, `win_back_trigger`, `hitl_approve`, `hitl_reject`, `hitl_edit`).

</code_context>

<specifics>
## Specific Ideas

- **"Future-proof multi-surface payload"** — user explicitly chose the option that ships dashboard + KB now AND wires render-target stubs for community/course so M4 + Phase 46 don't require AI-layer redeploy. Design the Edge Fn response with this in mind from day 1.
- **"Simple, easy to evaluate"** ethos for win-back v1 — single 14d-inactive threshold, max 1/30d. User explicitly rejected the multi-factor RECOMMEND-10 formula. Defer formula tuning to v1.4 once we have data.
- **Whitelist-only action_id** — user picked the HITL option that eliminates 80% of HITL workload via the action enum. This is load-bearing for the FDA SaMD safety posture.
- **Conservative HIPAA posture for digest** — user picked sanitized narrative across ALL tiers (free + paid + clinic) for v1. Don't add tiered PHI-depth back without explicit reconsideration.

</specifics>

<deferred>
## Deferred Ideas

- **PHI-bearing digest variant for paid users** — tier 3 narrative with drug + dose + weight values. Reconsider in v1.4 after HIPAA-readiness audit on consumer-side digest pipeline.
- **Multi-factor win-back churn formula** (RECOMMEND-10 verbatim) — `days-inactive × declining-streak × paywall-dismissals` score. Defer to v1.4 once 8+ weeks of churn data exist.
- **Per-type HITL queues** (recommender / digest / win-back as separate queues). Single queue ships v1; split in v1.4 if volume justifies.
- **Auto-pause digest after N unopened** — defer; rely on 1-click unsubscribe for v1.
- **LLM-based plan-personalization** — v1 is rule-based; add LLM judge in v1.4 if rules underperform on conversion rate.
- **A/B variants of digest tone / recommender ranking** — owned by Phase 39 A/B trifecta, not Phase 38.
- **Clinic-scoped HITL access** — out of scope; clinic admins are read-only consumers of analytics in v1.
- **Confidence-scored auto-approve thresholds** — defer; v1 uses simple KB-sourced rule, v1.4 can layer in calibrated confidence.
- **Cohere / Gemini embedding migration** — keep as escape hatch via AI Gateway; not exercised in Phase 38.

</deferred>

---

*Phase: 38-m5b-ai-recommender-pgvector-claude-digest*
*Context gathered: 2026-05-19*
