# Phase 60: RAG Knowledge Base Completion (Waves 2-4) — Context

**Gathered:** 2026-05-26
**Status:** Ready for planning
**Mode:** Smart Discuss (autonomous) — preceded by AI-integration phase per [[feedback_ai_integration_then_discuss_pattern]]

> **AI-SPEC.md owns system design.** This file captures product-shape only. Planner MUST read `60-AI-SPEC.md` first for framework choice, retrieval/synthesis pipeline, citation contract, eval strategy, guardrails. CONTEXT.md is additive UX/UI guidance.

<domain>
## Phase Boundary

Complete v1.3 Phase 50 Waves 2-4 in a fresh phase dir, reusing `.planning/phases/50-*/50-05..09-PLAN.md` as reference inputs (re-validate against v1.4). Aggressive-foundations: ship MVP + STRETCH together.

**Surfaces delivered:**
1. Admin scrape→chunker→embedder pipeline (50-05 reference) — Anthropic-haiku summarizer + sentence-aware chunker + OpenAI text-embedding-3-small via Vercel AI Gateway
2. Admin review/curation queue (50-06 reference) — 5 SECDEF state-machine RPCs (queued→approved/rejected/retracted); 2-person rule
3. AI-coach inline citation integration (50-08 reference) — `[N]` markers + click popover + Sources footer
4. Cross-encoder re-ranker (NEW) — Cohere Rerank v3.5 primary, Jina v2 fallback; a/b vs raw cosine per success criterion #3
5. Federated source adapters (NEW) — PubMed E-utilities + OpenFDA + DailyMed; per-source admin toggle; 24h cache
6. Tip-of-day Bento card + push (50-08 reference extended)
7. Weekly Resend research newsletter (50-09 reference)
8. Public `/knowledge/*` SEO hub (50-09 reference; path rename from `/research`)
9. Cost dashboard at `/admin/research/cost` (50-09 reference)

**Out of scope (defer to P70):**
- Live scrape/embed runtime verify against prod
- Federated live source syncs (run once at staging, defer prod cron to P70)
- Newsletter live send (Resend ID created, send-fire deferred)
- On-device tip-of-day push delivery (works in browser; mobile push verified in P70 device-UAT)
- Any vendor-key-gated live verification

</domain>

<decisions>
## Implementation Decisions

### Admin Curation Queue (50-06 extension)

- **2-person review rule (publisher ≠ creator)** — SECDEF `approve_rag_chunk(...)` rejects when `auth.uid() = chunks.created_by` per [[feedback_3_layer_must_never_invariant_pattern]] precedent (Phase 39 39-02 D-06). Extends the safety carveout shape.
- **Full-card per item layout** — inline chunk text preview + source URL + topic-tag dropdown + tier-select (A/B/C) + reject-with-notes textarea. Matches Phase 50 50-06 PLAN. No bulk operations in MVP (defer to STRETCH if admin load demands).
- Rejection workflow: hard delete from `kb_chunks_queue` + write `kb_chunk_rejections(chunk_id, reason, actor_id, at)` for audit. No "send back to scrape with notes" loop (admin re-scrapes URL with corrections if needed).
- State machine: `queued → approved | rejected | retracted` (retracted = previously-approved chunk removed when source URL retracted; admin action via 5th SECDEF RPC).

### AI-Coach Citation UI (50-08 extension)

- **Inline `[1]` superscript markers** anchored to per-message chunk list. Render via existing `react-markdown` + custom remark plugin that resolves `[chunk_id]` → numbered superscript.
- **Click-to-open popover** — chunk title + verbatim quote (the load-bearing `verbatim_quote` from `CitedAnswerSchema` per AI-SPEC §4) + source URL + tier badge + freshness timestamp. ESC-to-close. Matches existing modal a11y pattern (`role="dialog"` + `aria-modal="true"` per `src/components/ui/Modal.tsx`).
- **Both inline `[N]` AND "Sources (N)" footer** at message end. Footer collapsed by default (chevron toggle); auto-expands on screen-reader nav.
- No hover-preview (breaks mobile + a11y).
- Citation marker render is mobile-tap-target ≥24px (extends from 11-13px superscript with invisible padded hitbox).

### Tip-of-Day Bento Card + Push (50-08 extension)

- **Home tab Bento card** at top-right `<Card span={4}>` slot — title + 1-sentence summary + "Read full source" link to `/knowledge/<topic>/<slug>`. New per day at 00:00 UTC.
- **Push integration via Phase 54 prefs** — add "Research tips" category to existing `push_subscription_categories` table; honors existing frequency-cap (≤1/day) + quiet-hours. No new opt-in screen.
- **Single tip per day** (no carousel; reduces complexity in MVP). Generation = single-chunk synthesis path with separate prompt template per AI-SPEC §5 Dim #13 ("personalization appropriateness").
- Card variant: `<Card variant="elevated">` matching Phase 38 hero-card pattern.

### Public /knowledge/* Hub + Newsletter (50-09 extension)

- **Nested URL structure** — `/knowledge/<topic>/<slug>` (e.g., `/knowledge/glp-1/tirzepatide-titration-week-4`). Topic = `topic_tag` from `kb_chunks` (GLP-1, peptide-research, off-label-safety, etc.). Sitemap groups by topic.
- **SSR strategy: Vite client-render + `react-helmet-async` for `<title>`/`<meta>`/`<link rel="canonical">` + JSON-LD `MedicalWebPage` schema + build-time `sitemap.xml` generation**. Respects CLAUDE.md "no SSR" constraint. Googlebot renders JS since 2019 — acceptable risk for MVP. Prerender escape-hatch documented if Lighthouse Indexability score <90 at audit.
- Per-page meta: `title` = chunk title + " — LeanShot Knowledge"; `description` = verbatim_quote (first 160 chars); `canonical` = absolute URL; `og:image` = generated card via `@vercel/og` (already in package.json).
- Auth-wall: **public, no auth required** — rate-limited via Edge Middleware (Phase 67 OPS-08 will tighten); robots.txt allows all crawlers; `noindex` only on chunks where `kb_chunks.public_visibility=false`.
- **Newsletter shape: top-3 newly-curated tier-A chunks (last 7d) + 1 retrieval-popular evergreen chunk + admin-editable intro** sent via Resend weekly Sunday 9am ET. Resend audience = `newsletter_subscribers` (opt-in only).
- **Opt-in surface: Settings page toggle + onboarding optional checkbox (default UNCHECKED per CAN-SPAM affirmative opt-in)** — one-click unsubscribe via `List-Unsubscribe` mail header + in-app toggle parity.

### Federated Source Adapters (NEW)

- **Per-source admin toggle** — `federated_sources(name, enabled, sync_cron, last_sync_at, last_error)`. Sources: `pubmed`, `openfda`, `dailymed`. Each ships own Edge Fn with zod-validated REST client + 24h cache table.
- **Sync cadence: daily 3am UTC** via pg_cron + vault-stored service-role-key per [[reference_supabase_pg_cron_vault_service_role_pattern]].
- **Initial seed: last-30-days only** on enable (avoids cost explosion). Admin can request full-historical-pull via separate one-shot button.
- **Federated chunks auto-tagged tier A** (NLM/FDA = authoritative) but **still require admin review** before publishing. PHARMA-02 carveout applies to ALL sources regardless of authority.

### Cross-Encoder Re-Ranker (NEW)

- **Cohere Rerank v3.5** primary (TS SDK). **Jina Reranker v2** fallback via env-flag `RAG_RERANKER_PROVIDER=cohere|jina`. Both invoked over HTTP (no model weights in Edge runtime).
- a/b verification: success criterion #3 measured via `eval/phase60/rerank-delta.test.ts` — recall@5 + MRR with rerank vs without on 40-example labeled gold-set (per AI-SPEC §5 Dim #4). Target: ≥+0.10 absolute precision delta.
- Cost guardrail: rerank only top-N=20 chunks (after vector top-50); ≤$0.002/query per AI-SPEC §4b cost table.

### i18n Decisions

- All admin-facing UI strings keyed via existing i18n infrastructure (Phase 58 ES wiring shipped).
- Newsletter body templates: English-only at MVP (Spanish version queued for v1.5).
- `/knowledge/*` public hub: English-only at MVP. Spanish content gated on Phase 58 contractor expanding KB.

### Telemetry / Observability

- Per AI-SPEC §7: PostHog LLM Analytics primary; `$ai_generation` + `$ai_evaluation` events on all synthesis Edge Fn calls.
- Tip-of-day delivery telemetry via existing Phase 54 push pipeline (PostHog `push_delivered` + `push_opened` events).
- Newsletter open-rate via Resend webhook → PostHog event.
- Slack alert on guardrail trips (PHARMA-02 / FDA-equivalence / cost-envelope-breach / k-anon-floor-breach) per vault-stored webhook URL.

### Claude's Discretion

- Exact Tailwind v4 token choices for citation popover, tip-of-day card variants — defer to UI-SPEC (gsd-ui-phase will generate).
- Exact biomedical-section regex patterns for chunker — researcher to validate against gold-set during plan-phase.
- Per-Edge-Fn deno.json import map composition — follow existing project conventions per [[reference_supabase_functions_deploy_import_map_flag]].
- Cost-dashboard chart variants (line / bar / sparkline) — defer to UI-SPEC.

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets

- **Phase 50 Wave 1 (v1.3) data layer** — `kb_*` tables (`kb_sources`, `kb_chunks`, `kb_chunks_queue`, `kb_topics`, embedding column already pgvector(1536)). HNSW index already created. RPC `match_external_kb_embeddings` exists per AI-SPEC §3.
- **Phase 50 Wave 1 admin shell** — `/admin/rag/*` routes already render (per [[reference_react_router_consumer_admin_split]]); add new pages alongside.
- **Phase 50 Wave 1 event registry** — `kb_admin_events` table for audit; reuse for queue actions.
- **Phase 50 Wave 1 scrape Edge Fn** — `supabase/functions/kb-scrape-url/` exists; chunker/embedder Edge Fns are new siblings.
- **AI-coach (`AIChatPanel.tsx` + `src/lib/ai.ts`)** — existing Anthropic direct-SDK pattern; Phase 60 50-08 wires citation enrichment additively. AI-04 fence around `<user_data>` per AI-SPEC §6 G2 must be preserved.
- **Push pipeline (Phase 54)** — `push_subscription_categories` + frequency-cap + quiet-hours all shipped; add "Research tips" category row.
- **i18n (Phase 58)** — `t()` helper + ES locale dictionary; admin strings already routed through it.
- **Bento Card primitive** — `src/components/ui/Card.tsx` with `span={4|6|7|8|12}` + variants `default | elevated | interactive | hero | flat`.
- **Modal/Popover primitives** — `Modal.tsx`, `Sheet.tsx` with full a11y (`role="dialog"`, `aria-modal="true"`).
- **Resend lifecycle email pipeline (Phase 22/40)** — newsletter ships as new template under existing send infrastructure.
- **`react-markdown` + `rehype-raw` + `remark-gfm`** — already in package.json; citation `[N]` superscript renders via custom remark plugin.
- **`@vercel/og`** — already in deps; tip-of-day + newsletter card images.
- **PostHog client + server** — `posthog-js` ^1.372 + `supabase/functions/_shared/posthog-server.ts` from Phase 50-09.

### Established Patterns

- **Edge Fn convention**: per-fn `deno.json` import map (CLI v2.101.0+ ignores `--import-map` flag per [[reference_supabase_functions_deploy_import_map_flag]]).
- **`Deno.serve` MUST be guarded** by `import.meta.main` per [[reference_deno_test_top_level_serve_trap]] so tests don't dangle.
- **SECDEF RPC pattern**: read [[reference_profiles_email_vs_auth_users_email]] before assuming `profiles.email` exists — it doesn't; JOIN `auth.users`.
- **Idempotent inserts**: `INSERT … ON CONFLICT … DO UPDATE` per [[reference_postgres_no_insert_on_conflict_do_delete]] (toggle/delete needs `SELECT FOR UPDATE` then branch).
- **`public.is_staff()`** RLS guard at `supabase/migrations/20261101000006_is_staff_helper.sql` per [[reference_supabase_is_staff_helper]] — admin-only routes use this directly, NOT a parallel `staff_users` table.
- **pg_cron + Edge Fn**: vault-stored service-role-key + hardcoded URL per [[reference_supabase_pg_cron_vault_service_role_pattern]] (`current_setting('app.service_role_key')` does NOT exist).
- **Cron body $$-quoting**: use named tags (`$cron$`, `$partition$`) per [[reference_postgres_dollar_quote_nesting_in_cron_body]] when nesting `DO $$..$$` inside `cron.schedule(..., $$...$$)`.
- **Migration ordering**: don't back-date migrations per [[reference_supabase_back_dated_migration_blocks_push]] — would block `db push` for everything.

### Integration Points

- `/admin/rag/queue` (new) — queue review page; sibling of existing `/admin/rag/*` routes.
- `/admin/rag/federated` (new) — per-source admin toggle page.
- `/admin/research/cost` (new) — cost dashboard (extends Phase 50-09 reference).
- `/knowledge/<topic>/<slug>` (new public consumer route) — extend consumer `TabId` union OR use admin-style Routes for `/knowledge/*` per [[reference_react_router_consumer_admin_split]]; planner picks.
- `AIChatPanel.tsx` — citation `[N]` render + popover render. Additive props on existing surface.
- Home `<HomeTab>` — Bento card slot top-right for tip-of-day.
- `<SettingsPage>` — newsletter opt-in toggle.
- `<OnboardingFlow>` — optional newsletter checkbox at appropriate step (planner picks slot; default unchecked).
- `supabase/functions/_shared/` — shared retrieval + refusal-gate helpers (per AI-SPEC §3 entry point pattern).
- PostHog Cloud (existing project 140479) — `$ai_generation` + `$ai_evaluation` events.

</code_context>

<specifics>
## Specific Ideas

- **Reuse Phase 50 50-05..09 PLAN.md as research starting points** — planner shouldn't re-derive task breakdowns; cite each plan as the source per [[feedback_planner_prompt_explicit_reuse_targets]].
- **Cohere Rerank v3.5 primary, Jina v2 fallback** — env-flag-gated swap per AI-SPEC §2 Soft Lock-In row.
- **`/research` → `/knowledge` rename** — Phase 50 50-09 plan referenced `/research`; Phase 60 STATE explicitly overrides to `/knowledge/*` (Phase 62 owns `/research/<slug>` for white-papers).
- **Admin curation queue must surface tier and topic_tag editing** — federated PubMed/FDA/DailyMed chunks land tier-A by default but admin can demote if quality drops.
- **Tip-of-day generation uses Haiku not Sonnet** — single-chunk simple synthesis; cost-routing per AI-SPEC §4 model lineup ($0.005 vs $0.029).
- **Cost dashboard MUST show three Phase 60 rows extending Phase 50-09 RagCostPage** — NOT a duplicate component; planner reads `50-09-PLAN.md` for the existing component first.

</specifics>

<deferred>
## Deferred Ideas

- **Bulk admin approve** (same-tier same-topic batch) — defer to v1.5 if admin load proves heavy.
- **Spanish `/knowledge/*` content** — gated on Phase 58 contractor expanding KB; v1.5 candidate.
- **Carousel tip-of-day (3 tips)** — MVP ships single tip; consider rotation if engagement low.
- **Per-user personalized tip ranking** — MVP uses topic-tag relevance only; rec-engine fold-in deferred to v1.5.
- **Semantic-cache for repeat queries** — AI-SPEC §4b notes "exact-match now, semantic deferred to Wave 4 stretch"; ship exact-match in MVP, evaluate semantic at end of phase.
- **Prerender per-page at build via vite-plugin-prerender** — escape hatch if Lighthouse Indexability <90 at audit; client-render is the bet.
- **Newsletter Spanish version** — v1.5.
- **Auth-wall after N reads/day on `/knowledge/*`** — Phase 67 rate-limit owns this; Phase 60 ships public.
- **Federated source auto-curation (no admin review for gov sources)** — explicit decision: ALL chunks pass admin queue regardless of authority. Revisit if admin throughput becomes bottleneck.
- **Live runtime verification of scrape/embed/federated-sync/newsletter-send/on-device-push** — Phase 70 device-UAT consolidates per `feedback_milestone_uat_deferral_consolidation`.

</deferred>
