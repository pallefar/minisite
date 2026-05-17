# Phase 50: Admin-Curated RAG Knowledge Base — Peptide/Topic Research Scraper Feeding AI Tips + Newsletters - Context

**Gathered:** 2026-05-17
**Status:** Ready for planning

<domain>
## Phase Boundary

Admin defines research topics → pipeline (Firecrawl) scrapes external sources (allowlist + open-web hybrid) → content normalized/summarized/chunked → review queue (tiered auto-publish) → embedded into a dedicated `external_kb_embeddings` pgvector table → surfaced to users via AI coach citations + dashboard "Tip of the day" cards (Phase 50 MVP) and via a "Research" newsletter + public Research Hub page (Phase 50 stretch / Phase 51 slip if scope tightens).

Phase 50 is **additive to Phase 38**: Phase 38 owns internal content embeddings (KB / community / courses / blog); Phase 50 owns external scraped content embeddings. Retrieval merges both via Phase 38's recommender Edge Function (extended in Phase 50, not duplicated).

**Carrying forward from earlier phases:**
- Phase 24: Modular admin shell (ADMIN-01) + event taxonomy registry — Phase 50 plugs in as a new admin module + new event family.
- Phase 25: Resend / AWS SES email router + dual-Anthropic credential split (consumer vs clinical) — research newsletter uses consumer Resend path (non-PHI content).
- Phase 25: HIPAA posture (PostHog `disable_session_recording_on_url`, Sentry PHI scrub) — extends to `/admin/rag/*` and `/research/*` routes.
- Phase 38: `content_embeddings vector(1536)` table + HNSW index + OpenAI `text-embedding-3-small` via Vercel AI Gateway + nightly embedding cron + RECOMMEND-06 telemetry pattern + RECOMMEND-07 human-in-the-loop review queue pattern + RECOMMEND-05 weekly Claude newsletter cadence — all reused as templates.
- Phase 49: Resend digest pattern + 1-click unsubscribe + per-user opt-out (DIGEST-04) — Phase 50 newsletter follows the same opt-out plumbing.

</domain>

<decisions>
## Implementation Decisions

### Scraping Source Strategy

- **D-01: Source posture is hybrid per-topic.** Each topic is flagged either `curated` (queries restricted to admin allowlist) or `open-web` (Firecrawl/Exa-style discovery). Admin chooses per topic. Trade-off: heavier admin UX, bimodal review queue, but maximum flexibility.
- **D-02: Firecrawl is the scraper backend.** Already available as a Claude Code skill; clean markdown output ready for chunking; pay-per-credit. No self-hosted Playwright at v1.3.
- **D-03: Robots.txt is honored; storage = excerpt + summary + canonical URL.** No full-text hosting; UI surfaces always link out to source for full content. Posture matches Google News / RSS aggregator.
- **D-04: Ship with a curated seed allowlist (~10–15 sources).** PubMed E-utilities, FDA drug labels, drugs.com monographs, Examine.com, Lilly/Novo manufacturer pages. Stored as DB seed (admin can edit/delete via UI from day 1), not code constant.
- **D-05: Language-agnostic scraping; LLM translates at retrieval-time.** Trade-off accepted: higher cost, latency, and hallucination risk on medical content vs. English-only filter. **Researcher MUST surface mitigation patterns** (e.g., retrieve in source language, translate only summary, never translate dosage/contraindication facts — keep verbatim in source language with translation as gloss).
- **D-06: Per-source trust tiers (A/B/C) assigned by admin.** Tier-A = FDA / PubMed peer-reviewed. Tier-B = established health sites (drugs.com, Examine.com). Tier-C = blogs / forums / lay-press. Retrieval ranking boosts Tier-A; UI surfaces a tier badge on every citation.
- **D-07: Strict on-label content gating.** Allowlist excludes gray-market peptide vendor sites + peptide-bro forums. RAG only surfaces FDA-approved GLP-1s and their on-label uses. Avoids FDA/FTC scrutiny + patient harm.

### Admin Topic Curation UX

- **D-08: Topic shape = free-text query + tag.** Tag groups topics into themes (e.g., `muscle-loss`, `nausea-management`, `dose-titration`); used for newsletter sections + retrieval filtering + tip-of-day rotation.
- **D-09: Per-topic re-scrape cadence + global default.** Each topic carries its own cadence (`daily | weekly | monthly | manual`); fallback default is `weekly`. Cron via Supabase `pg_cron` (same pattern as Phase 19 cron jobs).
- **D-10: Single-row CRUD only at v1.3.** No bulk CSV import, no template cloning at launch. Sufficient for <100 topics; defer bulk ops to v1.4.
- **D-11: Per-topic telemetry dashboard.** Each topic shows: docs ingested, RAG hits in last 7d, AI tip impressions/clicks, newsletter inclusions, source-tier mix. Reuses Phase 38 RECOMMEND-06 telemetry plumbing.
- **D-12: Super-admin only for topic authoring at v1.3.** No clinic-admin-scoped topics. Single source of truth for medical content; avoids per-clinic drift.
- **D-13: Soft-delete with cascade behavior.** Topic flagged `deleted_at`; ingested content stays in `external_kb_embeddings` (still surfaces in RAG); topic stops re-scraping; admin can restore. RLS filters `deleted_at IS NULL` for admin list view; retrieval ignores the flag.
- **D-14: Last-edited-by + audit log only (no full version history).** Track `last_edited_by` + `updated_at`; insert into a topic-audit table on each edit. Aligns with Phase 25 HIPAA-14 `phi_access_log` pattern for non-PHI metadata.

### Review and Approval Flow

- **D-15: Tiered auto-publish.** Tier-A (FDA / PubMed) chunks auto-publish on scrape. Tier-B and Tier-C land in the admin review queue. Cuts review burden ~70% while keeping risky-source content gated. **Risk acknowledged:** Tier-A source publishing erratum is mitigated by D-19 (diff re-validation) + D-21 (admin flag).
- **D-16: Reject + reason feeds source-quality signal.** Admin selects rejection reason from a fixed taxonomy: `off-topic | factually-wrong | off-label | low-quality | duplicate | safety-concern`. Reasons aggregate per source. If a Tier-A source accrues 5+ rejects in 30d → flag for trust-tier downgrade review by admin.
- **D-17: Quote-only mode for medical claims.** Summarizer extracts verbatim quotes (not paraphrases) for dosage, indication, contraindication, and adverse-event statements. Admin reviews source-text + extracted quote side-by-side. Paraphrase is allowed for general narrative content. Lowest hallucination risk for clinically load-bearing claims.
- **D-18: Soft SLA + backlog alert.** Tier-B target: reviewed within 7 days. Tier-C target: reviewed within 14 days. Backlog crossing 100 unreviewed items → admin Slack alert. SLA breach does NOT auto-publish; queue keeps growing until admin clears it.
- **D-19: Diff-detect re-validation.** Re-scrape compares to prior approved chunk: ≥20% text diff OR new sections → re-queue for review. Minor edits (typo, formatting) auto-apply.
- **D-20: Soft-remove takedown + audit log.** Admin marks chunk `retracted`; removed from RAG retrieval immediately; audit log captures actor, timestamp, reason. Original content preserved for compliance. Already-sent newsletters stay sent (no retroactive correction at v1.3).
- **D-21: Erratum detection = diff-detect + manual admin flag.** Reuse D-19 for textual changes. Source-specific erratum APIs (PubMed retraction-watch, FDA recall feed) deferred to v1.4.

### Output Surfaces + Phase 38 Boundary

- **D-22: MVP cut — AI coach citations + dashboard "Tip of the day" card ship in Phase 50 must-have wave; "Research" newsletter + public Research Hub page in stretch wave.** Plans should sequence accordingly: data layer + admin curation + review queue + embeddings + retrieval extension land first; newsletter + Research Hub can slip to a Phase 50 stretch wave OR a Phase 51 follow-on if scope tightens. **Planner should split must-ship from stretch as explicit waves with independent VALIDATION.**
- **D-23: AI coach citations render as inline footnote markers + expandable source card.** Inline `[1]` `[2]` superscripts. Tap/click expands a card: source title, tier badge, 1-line summary, "as of YYYY-MM-DD", "Open source" link-out. Familiar pattern (Perplexity / NotebookLM).
- **D-24: Dashboard "Tip of the day" card.** Bento card (reuses existing `Card` primitive with `span={4}` or `span={6}`). Rotates daily; topic-tag filtering aligns to user's drug + active themes (e.g., users on tirzepatide see `muscle-loss` and `dose-titration` tips). Shows source + 'as of' + tier badge + 'Not medical advice' microcopy.
- **D-25: Phase 50 "Research" newsletter is SEPARATE from Phase 38's RECOMMEND-05 weekly Claude email.** Different intent (research-desk curation vs. personalized weekly recap), different sender, different opt-in, different template. Avoid clutter; avoid opt-out conflation.
- **D-26: Research newsletter cadence = weekly; opt-in default ON for paid users.** Free users opt-in. CAN-SPAM compliance: 1-click unsubscribe in every email (reuses Phase 49 DIGEST-04 pattern). Paid-user auto-enrollment requires explicit signup-time disclosure.
- **D-27: Public Research Hub page = `/research`, public + indexable.** Reuses Phase 15 page-builder pattern for layout. SEO meta + sitemap + JSON-LD structured data (`Article` schema with `dateModified`). Canonical link-out to source on every item (preserves source SEO, avoids thin-content penalty).
- **D-28: Phase 50 uses a SEPARATE `external_kb_embeddings` table.** Not `source_type` discriminator on Phase 38's `content_embeddings`. Cleaner ownership + independent retention/takedown queries + easier per-table RLS. Retrieval merges results from both tables.
- **D-29: Phase 50 EXTENDS Phase 38's recommender Edge Function** (not a separate `external-kb-retrieve` function). One Edge Fn, two embeddings sources, results merged by score with optional source-tier reweighting. Avoids duplicate AI Gateway plumbing.

### Cost / Reliability / Observability

- **D-30: Monthly budget kill-switch + admin cost dashboard.** Per-vendor monthly budget caps (initial: Firecrawl $200/mo, OpenAI embeddings $50/mo, Anthropic summaries $300/mo — adjustable in admin UI). Cron tracks spend (Stripe-style usage rollup); 80% threshold → email admin; 100% → auto-pause scrapers (resume requires admin acknowledge). Admin dashboard shows MTD spend per vendor + per topic.
- **D-31: Scraper failure handling = retry + Sentry + auto-pause source.** Exponential backoff (3 attempts, 1m/5m/15m). Three consecutive failed runs → Sentry alert + auto-pause source + badge in admin UI ("Paused: 503 for 7d"). Prevents budget burn on broken endpoints. Admin manually resumes after fix.

### Content Freshness / Disclaimer / PHI

- **D-32: Per-source freshness tier + visible "as of" date.** Tier-A (FDA labels): 365d OK. Tier-B (research / news): 90d. Tier-C: 30d. Beyond threshold → retrieval de-ranks chunk + UI shows "as of YYYY-MM-DD" badge. Stale-but-relevant still surfaceable with warning, not hard-excluded (foundational research stays useful).
- **D-33: Always-visible attribution + disclaimer on every surfaced item.** Standardized microcopy: source name (linked) + "As of YYYY-MM-DD" + tier badge (A/B/C) + "Not medical advice — consult your clinician" string. One i18n-keyed disclaimer string shared across coach citation cards, tip-of-day cards, newsletter items, and Research Hub. **Researcher: confirm i18n-keying aligns with Phase 32 i18n approach.**
- **D-34: External content = non-PHI; citation events scrubbed on user-id join.** Scraped articles + admin queue contain no PHI ever. Coach blends external chunks with PHI-bearing chat history — `rag_citation_clicked` events captured server-side via PostHog Edge Function (Phase 24 server-side capture pattern), event properties strip `user_id`, keep only `chunk_id + source_tier + topic_tag + surface`. Admin-side review queue has no PHI exposure. Add `/admin/rag/*` and `/research/*` to PostHog `disable_session_recording_on_url` regex (extends HIPAA-17).

### PostHog Event Taxonomy (locked now, per Phase 24 registry)

- **D-35:** Canonical event names + property shapes:
  - `rag_topic_created` — props: `topic_id, tag, mode (curated|open-web), cadence`
  - `rag_topic_edited` — props: `topic_id, fields_changed[]`
  - `rag_topic_deleted` — props: `topic_id, soft`
  - `rag_scrape_run` — props: `topic_id, source_count, chunks_found, duration_ms, status (ok|partial|failed), cost_usd`
  - `rag_chunk_reviewed` — props: `chunk_id, source_tier, action (approved|rejected|edited), reject_reason?, queue_age_hours`
  - `rag_chunk_published` — props: `chunk_id, source_tier, topic_tag, auto_published (boolean)`
  - `rag_chunk_retracted` — props: `chunk_id, reason, surfaces_affected[]`
  - `rag_tip_impression` — props: `chunk_id, topic_tag, surface=tip-of-day` (server-side capture)
  - `rag_tip_clicked` — props: `chunk_id, topic_tag, surface=tip-of-day` (server-side capture)
  - `rag_citation_clicked` — props: `chunk_id, source_tier, topic_tag, surface (coach|tip|news|hub)` (server-side capture)
  - `rag_newsletter_subscribed` — props: `frequency, tags_followed[]`
  - `rag_newsletter_unsubscribed` — props: `via=1click|settings`
  - `rag_hub_pageview` — props: `chunk_id?, topic_tag?` (server-side capture for ITP/uBlock resilience per Phase 24)

### Pre-Launch Ops Plan (non-code, captured here for traceability)

- **D-36: Karsten owns ops; seed 20 topics + recruit 1 clinical advisor.** Karsten authors 20 initial topics covering top 5 GLP-1s × 4 high-interest themes each (e.g., tirzepatide × {muscle-loss, nausea, plateaus, titration}). Recruit a PA/NP/MD clinical advisor on hourly contract to review the Tier-B/C queue at SLA from launch. This is a Phase 50 wave-0 ops task, not a code task, but the plan-phase should call it out as an entry-condition for user-facing surfaces ("Don't ship coach citations until reviewer in place").

### Claude's Discretion

- Schema-naming convention for the new tables (`rag_topics`, `rag_chunks`, `rag_sources`, `external_kb_embeddings`, etc.) — researcher picks names following Phase 38 / Phase 22 conventions.
- HNSW vs IVFFlat index parameters for `external_kb_embeddings` — researcher follows Phase 38's decision (D-CONTEXT in 38-CONTEXT.md when it lands).
- Chunking strategy (fixed-size, sentence-aware, semantic) — researcher picks based on Firecrawl markdown output shape + retrieval quality vs. cost trade-off.
- Specific row-count + RPS estimates for cron sizing — researcher computes from seed-topic cadence math.
- React component hierarchy for admin review queue UI — planner picks based on Phase 24 admin-shell pattern.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase Roadmap + Requirements
- `.planning/REQUIREMENTS.md` §RECOMMEND-01..10 — Phase 38 internal-content RAG infra that Phase 50 extends (pgvector, OpenAI embeddings, AI Gateway, nightly cron, weekly Claude newsletter, human-in-loop queue).
- `.planning/REQUIREMENTS.md` §ADMIN-01 — modular admin shell pattern Phase 50 plugs into.
- `.planning/REQUIREMENTS.md` §DIGEST-01..04 — Phase 49 newsletter + 1-click unsubscribe pattern that Phase 50 "Research" newsletter reuses.
- `.planning/REQUIREMENTS.md` §HIPAA-14, §HIPAA-17 — audit-log + PostHog session-recording regex that Phase 50 extends.
- `.planning/ROADMAP.md` §"Phase 50" — phase entry (Depends on: Phase 49).
- `.planning/ROADMAP.md` §"Phase 38" — recommender + content embeddings infra.
- `.planning/ROADMAP.md` §"Phase 24" — modular admin shell + event taxonomy registry + server-side PostHog capture pattern.
- `.planning/ROADMAP.md` §"Phase 25" — Resend / SES email router + dual-Anthropic credentials + HIPAA hardening.
- `.planning/ROADMAP.md` §"Phase 32" — i18n approach (`?lang=es` query) for disclaimer + Research Hub localization.

### Codebase Maps + Stack Research
- `.planning/research/STACK.md` — v1.3 stack additions (pgvector, OpenAI 6.13.0 via AI Gateway, posthog-node 5.10.4 Edge Fn pattern, react-markdown 9.x, dompurify, Resend, AWS SES).
- `.planning/codebase/INTEGRATIONS.md` — current vendor wiring; no scraper exists yet.
- `.planning/codebase/STACK.md` — existing tech baseline.
- `.planning/codebase/STRUCTURE.md` — `src/lib/`, `src/components/dashboard/`, `src/components/dashboard/cards/` conventions.
- `.planning/codebase/CONVENTIONS.md` — naming + import + tailwind class-organization conventions.

### Vendor + External References
- Firecrawl docs (via Context7 `mcp__plugin_context7_context7__resolve-library-id` → `firecrawl`) — scraper API, robots.txt handling, credit pricing, batch crawl vs. extract endpoints.
- Phase 38 will produce `.planning/phases/38-*/38-CONTEXT.md` with the pgvector index decision (HNSW vs. IVFFlat). Phase 50 researcher MUST read it once Phase 38 plans.

### Memory (cross-session decisions that apply)
- `[[reference_supabase_db_query_linked]]` — read-only checks of cron presence + schema drift via `supabase db query --linked`.
- `[[reference_supabase_edge_function_deploy]]` — Function Secrets, esm.sh imports, UAT-probe pattern for vendor keys (Firecrawl key, OpenAI key, Anthropic key).
- `[[reference_supabase_migration_gotchas]]` — partial-index IMMUTABLE constraint, SECURITY DEFINER `extensions` search_path.
- `[[reference_rls_fixture_gotcha]]` — RLS test fixture pattern via admin.generateLink for cross-tenant impersonation proofs (apply to `rag_topics`, `external_kb_embeddings` RLS).
- `[[reference_vendor_gated_send_health_check]]` — vendor-gated send pattern for Firecrawl / OpenAI / Anthropic outage handling (build prod path + startup health check that no-ops with logged warning).
- `[[feedback_realtime_layer_e2e_pattern]]` — DB-level invariant assertions for review-queue state changes (chunk approved → embedding row exists).
- `[[reference_supabase_auth_traps]]` — free-tier email rate-limit (2/hour) — applies to "Research" newsletter test sends in e2e; use mock send.
- `[[project_v12_milestone_audit]]` — v1.3 = new features; v1.4 = deferred + tech debt.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`Card` primitive** (`src/components/ui/Card.tsx`) — bento card with `span={4|6|7|8|12}` variants; reuse for "Tip of the day" card on dashboard.
- **Phase 24 admin shell + modular router** (will exist at `src/components/admin/`) — Phase 50 registers as a new module: `Admin → AI → Knowledge Base` (topics + sources + queue + telemetry + cost dashboard).
- **Phase 24 server-side PostHog capture** (`supabase/functions/_shared/posthog-server.ts`) — reuse for `rag_tip_impression`, `rag_tip_clicked`, `rag_citation_clicked`, `rag_hub_pageview` (ITP/uBlock resilience).
- **Phase 25 email router** (`supabase/functions/_shared/email-router.ts`) — `phi:false` consumer path via Resend for the Research newsletter.
- **Phase 38 recommender Edge Function** (will exist at `supabase/functions/recommender/`) — Phase 50 EXTENDS to query both `content_embeddings` + `external_kb_embeddings` and merge by score.
- **Phase 38 nightly embedding cron** — Phase 50 adds a sibling cron for the external-content pipeline (scrape → review → approved chunks embed).
- **Phase 38 `content_embeddings` HNSW index decision** — Phase 50 mirrors the decision for `external_kb_embeddings`.
- **Phase 49 `unsubscribe-1click` Edge Function** (will exist) — Phase 50 Research newsletter reuses identical pattern.
- **`react-markdown` + `dompurify`** (Phase 13 / Phase 24 stack) — render scraped markdown safely in admin review queue + Research Hub page.
- **Phase 15 page-builder** — reuse layout primitives for `/research` Research Hub page.

### Established Patterns
- **Single-tenant admin authoring at v1.3** (super-admin only, no clinic-admin scope) — consistent with Phase 27 admin extensions.
- **Server-side PostHog capture for ad-blocker-eaten events** (Phase 24) — Phase 50 uses it for every user-facing impression/click.
- **Soft-delete + audit log** (Phase 25 HIPAA-14 pattern) — applied to topics, chunks, sources.
- **Per-source / per-vendor health-check startup probe** (`[[reference_vendor_gated_send_health_check]]`) — extended to Firecrawl / OpenAI / Anthropic keys at scraper startup.
- **i18n disclaimer string keyed via Phase 32** (`?lang=es` query) — the "Not medical advice" disclaimer is i18n-keyed, not hard-coded.

### Integration Points
- New tables: `rag_topics`, `rag_sources`, `rag_chunks` (review queue + approved + retracted states), `external_kb_embeddings vector(1536)`, `rag_topic_audit`, `rag_scrape_runs`, `rag_cost_ledger`, `rag_newsletter_subscriptions`.
- New cron jobs (`pg_cron`): per-topic scrape runner (cadence-driven), Tier-B/C queue-backlog monitor (daily), monthly cost rollup (daily), weekly Research newsletter sender.
- New Edge Functions: `rag-scrape-runner` (invoked by cron), `rag-summarize-and-chunk` (Anthropic-backed; quote-only mode for medical claims), `rag-newsletter-sender` (Resend), `rag-cost-tracker` (writes to `rag_cost_ledger`). Plus the EXTENSION of Phase 38's `recommender` Edge Function.
- New routes: `/admin/rag/topics`, `/admin/rag/sources`, `/admin/rag/queue`, `/admin/rag/telemetry`, `/admin/rag/cost`, `/research` (public Research Hub).
- New components: `TipOfTheDayCard.tsx` (dashboard bento), citation footnote rendering in `AIChatPanel.tsx`, admin queue UI under the Phase 24 admin shell.
- Migration to `_shared/posthog-server.ts` for all `rag_*` events.

</code_context>

<specifics>
## Specific Ideas

- **User's framing was explicit:** "scrapes the newest information on peptides etc" + "I as admin can add new topics" + "this info is then used by the AI to give suggestions, tips, create newsletters". All three legs (scrape, admin curation, AI surfacing) are first-class.
- **"Peptides" framing is broader than GLP-1.** D-07 (strict on-label only) intentionally narrows initial scope to FDA-approved GLP-1s; "peptides" branding can stay but content stays on-label. Off-label peer-reviewed research (e.g., tirzepatide for PCOS) was rejected as v1.3 scope.
- **Newsletter framing is distinct from Phase 38's weekly Claude email.** Phase 50 newsletter = research-desk-voice digest of approved external research per user's followed tags. Phase 38 newsletter = coach-voice personalized week recap.
- **Inspiration patterns named by Claude during discussion** (user did not name a reference, so these are Claude-suggested baselines for the researcher):
  - Perplexity / NotebookLM citation UX → for D-23 inline-footnote + expandable-card pattern.
  - Google News / RSS-aggregator → for D-03 excerpt-and-link posture.

</specifics>

<deferred>
## Deferred Ideas

- **Bulk topic CSV import + topic templates / cloning** — v1.4 if topic count crosses ~100.
- **Clinic-admin-scoped topic authoring** — v1.4 (post-org-context maturity).
- **Full version history per topic (every-edit diff/revert)** — v1.4 if medical-content governance demands.
- **Per-source erratum API integrations** (PubMed retraction-watch, FDA recall feed) — v1.4.
- **Retroactive newsletter corrections** when published chunk is later retracted — v1.4.
- **Hispanic GLP-1 Spanish-source-allowlist + Spanish-language scraping** — depends on Phase 32 i18n maturity + Spanish-source clinical-advisor recruitment; v1.4.
- **Self-hosted Playwright + Readability.js scraper** — only if Firecrawl economics or coverage breaks; v1.4+.
- **Public Research Hub "premium content gating"** (teaser + auth-gated full content) — v1.4 if conversion data justifies.
- **LLM-judge fact-check (second LLM call) on every chunk** — considered for D-17 hallucination guard; chose quote-only mode instead. Revisit at v1.4 if quote-only proves insufficient.
- **Hard SLA auto-reject on review queue** — chose soft-SLA + alert instead; revisit if backlog rot becomes real.

</deferred>

---

*Phase: 50-Admin-Curated RAG Knowledge Base — Peptide/Topic Research Scraper Feeding AI Tips + Newsletters*
*Context gathered: 2026-05-17*
