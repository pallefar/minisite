# Phase 60 PLAN-OUTLINE

**Phase goal:** Resume v1.3 Phase 50 Waves 2-4 in-place to complete: scrape+chunk pipeline, embedding worker, admin curation queue (2-person rule + 5 SECDEF state-machine RPCs), AI-coach inline citation integration, cross-encoder re-ranker (Cohere Rerank v3.5 primary / Jina v2 fallback), federated PubMed/OpenFDA/DailyMed adapters, tip-of-day Bento card + push, weekly Resend newsletter, public `/knowledge/*` SEO hub, and cost dashboard extension. Aggressive-foundations: MVP + STRETCH both ship.

**Wave model:** 4 waves
- **Wave 0** — Data layer (migrations only: tables + SECDEF RPCs + shared Edge Fn helpers; no Fn deploys, no cron yet)
- **Wave 1** — Edge Functions + admin UI (chunker, embed, retrieval+rerank, federated adapters, queue UI, federated toggle UI)
- **Wave 2** — Consumer surfaces (AI-coach citation UI, tip-of-day Bento card + generation Fn)
- **Wave 3** — Newsletter + public hub + cost dashboard + **[BLOCKING] deploy-Fns-then-push-schema-with-cron** finalization

**Executor model:** sequential-on-main per STATE.md execution lesson (no worktrees; one plan at a time on `main`; post-plan tsc + targeted vitest + locale gate; full-suite ~106-110 failing/24-25 baseline is FLAKY EnvironmentTeardownError — gate by own-tests + no-net-new).

**Reuse targets** (per `[[feedback_planner_prompt_explicit_reuse_targets]]`):
- 60-04 reuses `.planning/phases/50-admin-curated-rag-knowledge-base-peptide-topic-research-scra/50-05-PLAN.md` (Anthropic summarizer + sentence-aware chunker) — re-validate prompt/chunker against v1.4 codebase
- 60-05 reuses `.../50-07-PLAN.md` Tasks 1-2,5 (OpenAI embeddings wrapper + rag-embed-approved Fn + embed cron) — re-validate Vercel AI Gateway routing
- 60-06 reuses `.../50-07-PLAN.md` Tasks 3-4,6 (merge.ts cosine+freshness+tier reweight + rag-retrieve Fn) AND extends with NEW Cohere Rerank v3.5 / Jina v2 fallback path per AI-SPEC §2 Soft Lock-In
- 60-08 reuses `.../50-06-PLAN.md` (admin review queue UI + 5 SECDEF state-machine RPCs)
- 60-10 reuses `.../50-08-PLAN.md` Tasks 1-4 (citation marker + popover + remark plugin + AIChatPanel augment)
- 60-11 reuses `.../50-08-PLAN.md` Task 5 (TipOfTheDayCard + dashboard mount) + extends with Haiku-cheap generation Fn
- 60-12 reuses `.../50-09-PLAN.md` Tasks 2-3 (rag-newsletter-sender + 1-click unsubscribe Edge Fn) + RFC 8058 List-Unsubscribe-Post header
- 60-13 reuses `.../50-09-PLAN.md` Tasks 1,4 (public hub list + article detail + NewsletterSettings + OnboardingFlow opt-in checkbox) **with path rename `/research` → `/knowledge/<topic>/<slug>`** per CONTEXT.md (Phase 62 owns `/research/<slug>` for white-papers)
- 60-14 reuses `.../50-09-PLAN.md` Task 4 RagCostPage extension (Phase 60 adds 3 NEW cost rows to existing component — NOT duplicate)

**Vendor secrets pre-flight** (per `[[feedback_vendor_secret_preflight_surface]]` — operator must run `supabase secrets list --project-ref <project-ref>` BEFORE Wave 0 dispatch; surface missing in dispatch confirmation):

| Secret | Status | Owner Plan |
|--------|--------|------------|
| `ANTHROPIC_API_KEY` | ✅ verify (exists from v1.3) | 60-04, 60-11 |
| `OPENAI_API_KEY` | NEW (via Vercel AI Gateway) | 60-05 |
| `VERCEL_AI_GATEWAY_TOKEN` | verify Phase 50-07 deployment | 60-05 |
| `COHERE_API_KEY` | NEW (primary reranker) | 60-06 |
| `JINA_API_KEY` | NEW optional (fallback reranker) | 60-06 |
| `RAG_RERANKER_PROVIDER` env-flag | NEW (values `cohere`\|`jina`) | 60-06 |
| `RESEND_API_KEY` | ✅ verify (exists from v1.3 Phase 22) | 60-12 |
| `PUBMED_API_KEY` | NEW optional (relaxes rate limit) | 60-07 |
| `OPENFDA_API_KEY` | NEW optional | 60-07 |
| `POSTHOG_PROJECT_API_KEY` | ✅ verify (LLM Analytics tracing) | 60-04..14 |
| Slack webhook URL (vault `slack_guardrail_webhook`) | NEW vault entry | 60-04..07,11,12 |
| `SUPABASE_SERVICE_ROLE_KEY` (vault `service_role_key`) | ✅ existing | 60-15 cron |

## Plans

| Plan ID | Objective | Wave | Depends On | Requirements | Files Modified (preview) |
|---------|-----------|------|------------|--------------|---------------------------|
| 60-01-data-layer-migrations | Add 4 new tables (`federated_sources`, `federated_source_cache`, `newsletter_subscribers`, `kb_chunk_rejections`) + 5 SECDEF state-machine RPCs (`approve_rag_chunk`, `reject_rag_chunk`, `retract_rag_chunk`, `queue_rag_chunk`, `list_rag_review_queue`) using `public.is_staff()` guard + 2-person rule (`actor_id != created_by`) + `INSERT...ON CONFLICT...DO UPDATE` pattern. Extend `push_subscription_categories` (Phase 54) with `research_tips` row. NO cron schedules yet (deferred to 60-15 per Fn-deploy-before-cron rule). | 0 | — | RAG-03, RAG-06, RAG-07, RAG-08 | `supabase/migrations/20281201000001_phase60_kb_tables.sql`, `supabase/migrations/20281201000002_phase60_secdef_rpcs.sql`, `supabase/migrations/20281201000003_phase60_push_categories.sql` |
| 60-02-shared-edge-helpers | Add `supabase/functions/_shared/rag-retrieve.ts` (shared HTTP client for AI-coach + tip-of-day + newsletter consumers), `_shared/posthog-rag-events.ts` (typed `$ai_generation`/`$ai_evaluation`/`rag_citation_validation_failed`/`rag_refusal_emitted`/`rag_cost_envelope_breach` emitters reusing `_shared/posthog-server.ts`), `_shared/slack-guardrail-alert.ts` (vault-stored webhook fetch). Per-Fn `deno.json` import maps for downstream Fns (CLI v2.101.0+ ignores `--import-map`). `Deno.serve` guards stubbed under `import.meta.main`. | 0 | 60-01 | RAG-04, RAG-05 | `supabase/functions/_shared/rag-retrieve.ts`, `supabase/functions/_shared/posthog-rag-events.ts`, `supabase/functions/_shared/slack-guardrail-alert.ts` |
| 60-03-eval-harness-and-gold-set | Author labeled gold-set fixture (40 examples per AI-SPEC §5 reference dataset) at `eval/phase60/gold-set.jsonl` + harness `eval/phase60/run.ts` (`--suite=refusal\|citation\|safety\|kanon\|rerank-delta`) + CI workflow `.github/workflows/eval-phase60.yml` (PR-gate on `src/lib/rag/**` or `supabase/functions/rag-**` touches). Emits `$ai_evaluation` PostHog events per dimension. RED-state harness only — actual Fn calls land in 60-04..07. | 0 | — | RAG-04, RAG-05 | `eval/phase60/gold-set.jsonl`, `eval/phase60/run.ts`, `eval/phase60/dimensions/*.ts`, `.github/workflows/eval-phase60.yml` |
| 60-04-summarizer-chunker-fn | Reuse 50-05 verbatim where applicable: `supabase/functions/rag-summarize-and-chunk/{prompt.ts,anthropic.ts,chunker.ts,index.ts}` — Anthropic-haiku quote-only summarizer (D-17 verbatim quote contract) + sentence-aware semantic chunker + prompt-injection fence + per-fn `deno.json` + `Deno.serve` under `import.meta.main`. Inserts to `kb_chunks_queue` (Wave 1 already shipped). PHARMA-02 safety carveout applies (3-layer invariant per `[[feedback_3_layer_must_never_invariant_pattern]]`). Vitest suites + Deno integration test (HUMAN-quoted-vs-paraphrase gold-set). | 1 | 60-01, 60-02, 60-03 | RAG-01 | `supabase/functions/rag-summarize-and-chunk/{prompt.ts,anthropic.ts,chunker.ts,index.ts,deno.json,__tests__/integration.test.ts}`, `src/lib/rag/__tests__/{summarizer,chunker}.test.ts` |
| 60-05-embed-pipeline-fn | Reuse 50-07 Tasks 1-2,5: `supabase/functions/rag-embed-approved/{openai.ts,index.ts}` — OpenAI `text-embedding-3-small` via Vercel AI Gateway (1536-dim → existing pgvector(1536) column + HNSW index from Phase 50 Wave 1). Batch insert + retry-with-backoff + cost telemetry to `$ai_generation`. Per-fn `deno.json`. Vitest mocks AI Gateway response. | 1 | 60-01, 60-02 | RAG-02 | `supabase/functions/rag-embed-approved/{openai.ts,index.ts,deno.json,__tests__/embed.test.ts}` |
| 60-06-retrieval-and-rerank-fn | Reuse 50-07 Tasks 3-4: `supabase/functions/rag-retrieve/{merge.ts,index.ts}` (cosine top-50 via `match_external_kb_embeddings` RPC + freshness/tier reweight). **EXTEND with NEW Cohere Rerank v3.5 primary + Jina Reranker v2 fallback** via env-flag `RAG_RERANKER_PROVIDER=cohere\|jina` per AI-SPEC §2. Top-N=20 rerank cap (cost guardrail ≤$0.002/query). Returns top-3 to caller. Eval suite `--suite=rerank-delta` enforces ≥+0.10 recall@5 + MRR delta vs raw cosine on gold-set per success criterion #3. Per-fn `deno.json`. | 1 | 60-01, 60-02, 60-03, 60-05 | RAG-04, RAG-05 | `supabase/functions/rag-retrieve/{merge.ts,cohere-rerank.ts,jina-rerank.ts,index.ts,deno.json,__tests__/{merge,rerank}.test.ts}`, `eval/phase60/dimensions/rerank-delta.ts` |
| 60-07-federated-adapters | NEW: 3 Edge Fns — `rag-federated-pubmed` (NLM E-utilities), `rag-federated-fda` (OpenFDA drug/event/label endpoints), `rag-federated-dailymed` (DailyMed REST). Each: zod-validated REST client + 24h cache via `federated_source_cache` table + per-source rate-limit handling + last-30-days seed on enable (cost guardrail) + auto-tag `tier='A'` (still requires admin review). Per-fn `deno.json`. Vitest mocks each REST API. NO cron registration yet (deferred to 60-15). | 1 | 60-01, 60-02 | RAG-06 | `supabase/functions/rag-federated-pubmed/{index.ts,client.ts,deno.json}`, `supabase/functions/rag-federated-fda/{index.ts,client.ts,deno.json}`, `supabase/functions/rag-federated-dailymed/{index.ts,client.ts,deno.json}`, `src/lib/rag/__tests__/federated-{pubmed,fda,dailymed}.test.ts` |
| 60-08-admin-queue-ui | Reuse 50-06 Tasks 2-4,6: `src/components/admin/rag/RagQueuePage.tsx` + `QueueDetailPane.tsx` (side-by-side source/quote layout per UI-SPEC §17) + `RejectReasonSheet.tsx` + `EditChunkModal.tsx` + `RetractChunkModal.tsx` + `src/lib/admin/rag/chunk-api.ts` (typed wrapper over 5 SECDEF RPCs from 60-01). Tier/topic_tag editing inline. 2-person-rule UI badge (publish disabled when `actor_id === created_by`). Mounts at `/admin/rag/queue` per react-router admin split. Full a11y baseline (modal role/aria-modal/aria-label). Vitest + Playwright E2E (5 RPCs + happy/sad paths). | 1 | 60-01, 60-02 | RAG-03 | `src/components/admin/rag/{RagQueuePage,QueueDetailPane,RejectReasonSheet,EditChunkModal,RetractChunkModal}.tsx`, `src/lib/admin/rag/chunk-api.ts`, `src/components/admin/AdminRoutes.tsx` (route entry), `tests/e2e/admin/rag-queue.spec.ts` |
| 60-09-admin-federated-toggle-ui | NEW: `src/components/admin/rag/FederatedSourcesPage.tsx` at `/admin/rag/federated` — per-source toggle (3 rows: PubMed/FDA/DailyMed) + last_sync_at + last_error display + "Pull historical" one-shot button (admin action, fires 60-07 Fn). UI-SPEC §18 surface contract. Reads/writes `federated_sources` table via SECDEF RPC. Vitest + a11y. | 1 | 60-01, 60-07 | RAG-06 | `src/components/admin/rag/FederatedSourcesPage.tsx`, `src/lib/admin/rag/federated-api.ts`, `src/components/admin/AdminRoutes.tsx` (route entry) |
| 60-10-ai-coach-citation-ui | Reuse 50-08 Tasks 1-4: `src/lib/rag/i18n.ts` (rag.attribution/disclaimer ICU keys EN+ES via Phase 58 i18next) + `src/lib/rag/retrieve-client.ts` (browser→`/functions/v1/rag-retrieve` wrapper) + `src/components/ai/CitationMarker.tsx` (`[N]` superscript, ≥24px invisible tap-hitbox) + `src/components/ai/CitationPopover.tsx` (verbatim_quote + source URL + tier + freshness + ESC-close + role=dialog/aria-modal) + remark plugin `src/lib/rag/remark-citations.ts` resolving `[chunk_id]` → numbered superscript. **Augment `AIChatPanel.tsx` additively** — preserve AI-04 `<user_data>` fence per AI-SPEC §6 G2. Sanitize verbatim_quote via existing DOMPurify per UI-SPEC §3. Sources footer collapsible. Vitest + Playwright. | 2 | 60-01, 60-02, 60-06 | RAG-04 | `src/lib/rag/{i18n,retrieve-client,remark-citations,server-rag-events-relay}.ts`, `src/components/ai/{CitationMarker,CitationPopover,SourcesFooter}.tsx`, `src/components/ai/AIChatPanel.tsx`, `locales/{en,es}/rag.json` |
| 60-11-tip-of-day-card-and-fn | Reuse 50-08 Task 5: `src/components/dashboard/cards/TipOfTheDayCard.tsx` (`<Card variant="elevated" span={4}>` slot top-right of `HomeTab.tsx`) — title + 1-sentence summary + "Read full source" link to `/knowledge/<topic>/<slug>`. **EXTEND with NEW** `supabase/functions/rag-tip-of-day-generate/` Edge Fn (Haiku-cheap single-chunk synthesis per AI-SPEC §4 cost lineup; $0.005/run; daily 00:00 UTC scheduled in 60-15). Writes to `kb_tip_of_day(date, chunk_id, generated_at)` table (add migration to 60-01 if not present — verify). Push category `research_tips` (from 60-01 `push_subscription_categories` extension) honors Phase 54 freq-cap + quiet-hours. UI-SPEC §22 tip-card surface + §23 push notification surface. | 2 | 60-01, 60-02, 60-06, 60-08 | RAG-07 | `src/components/dashboard/cards/TipOfTheDayCard.tsx`, `src/components/dashboard/tabs/HomeTab.tsx` (mount), `supabase/functions/rag-tip-of-day-generate/{index.ts,prompt.ts,deno.json}`, `supabase/migrations/20281201000004_kb_tip_of_day_table.sql` (if not in 60-01) |
| 60-12-newsletter-fns-and-opt-in-ui | Reuse 50-09 Tasks 2-3 + Settings opt-in toggle (Task 4 partial): `supabase/functions/rag-newsletter-sender/` (Resend send Edge Fn — top-3 newly-curated tier-A chunks last-7d + 1 retrieval-popular evergreen + admin-editable intro) + `supabase/functions/rag-newsletter-unsubscribe-1click/` (RFC 8058 `List-Unsubscribe-Post: List-Unsubscribe=One-Click` POST handler — flips `newsletter_subscribers.opted_in=false` via stored-token compare per `[[feedback_rls_stored_token_verification_pattern]]`) + `supabase/functions/_shared/email-templates/rag-newsletter.html` Resend template + `src/components/dashboard/settings/NewsletterSettings.tsx` (Settings page toggle, default OFF per CAN-SPAM affirmative opt-in) + `src/components/onboarding/steps/NewsletterOptInStep.tsx` checkbox (planner picks insertion slot in OnboardingFlow.tsx — default UNCHECKED). Resend webhook → PostHog `newsletter_opened` event. UI-SPEC §24-26. Newsletter EN-only at MVP (ES queued v1.5 per CONTEXT.md). | 3 | 60-01, 60-02 | RAG-08 | `supabase/functions/rag-newsletter-sender/{index.ts,deno.json}`, `supabase/functions/rag-newsletter-unsubscribe-1click/{index.ts,deno.json}`, `supabase/functions/_shared/email-templates/rag-newsletter.html`, `src/components/dashboard/settings/NewsletterSettings.tsx`, `src/components/dashboard/settings/SettingsPage.tsx` (mount), `src/components/onboarding/OnboardingFlow.tsx` (insertion slot), `src/components/onboarding/steps/NewsletterOptInStep.tsx` |
| 60-13-public-knowledge-hub | Reuse 50-09 Task 1 with **`/research` → `/knowledge/<topic>/<slug>`** rename: `src/components/knowledge/KnowledgeRootPage.tsx` (UI-SPEC §21) + `KnowledgeTopicIndexPage.tsx` (UI-SPEC §20) + `KnowledgeArticleDetailPage.tsx` (UI-SPEC §19) using `react-helmet-async` for `<title>`/`<meta description>`/`<link rel="canonical">` + JSON-LD `MedicalWebPage` schema + `@vercel/og` per-page card images. Public no-auth (FDA disclaimer footer per UI-SPEC §3 critical invariant). Rate-limited via existing Edge Middleware. `noindex` only on `kb_chunks.public_visibility=false`. Build-time `scripts/build-sitemap.ts` outputs `public/sitemap.xml` grouped by topic. Consumer router: extend admin-style Routes at `/knowledge/*` per `[[reference_react_router_consumer_admin_split]]` (admin-phase widening; consumer surface gets new `<Route>` block). Vitest + Playwright. **Prerender escape-hatch documented in PLAN comment** (vite-plugin-prerender) if Lighthouse Indexability <90 at audit — NOT shipped at MVP per CONTEXT.md deferred. | 3 | 60-01, 60-06, 60-10 | RAG-09 | `src/components/knowledge/{KnowledgeRootPage,KnowledgeTopicIndexPage,KnowledgeArticleDetailPage,KnowledgeBreadcrumb,SourcesPanel}.tsx`, `src/App.tsx` (route mount per consumer-admin split), `scripts/build-sitemap.ts`, `public/robots.txt` (knowledge allow), `tests/e2e/knowledge-hub.spec.ts` |
| 60-14-cost-dashboard-extension | Reuse 50-09 Task 4 **RagCostPage extension (NOT duplicate)** per CONTEXT.md "Specific Ideas": read existing `src/components/admin/research/RagCostPage.tsx` from 50-09 first; add 3 NEW Phase 60 cost rows (Cohere rerank, Jina rerank, federated-source-fetch overhead). UI-SPEC §17 cost dashboard contract (table + sparklines via existing `<Sparkline>` primitive). Reads from `$ai_generation` events via PostHog query OR `rag_cost_log` table (planner picks based on existing 50-09 implementation). Mounts at `/admin/research/cost`. Vitest. | 3 | 60-01 | RAG-04, RAG-05, RAG-06 | `src/components/admin/research/RagCostPage.tsx` (extension only), `src/lib/admin/research/cost-api.ts` |
| 60-15-deploy-fns-push-schema-cron-BLOCKING | **[BLOCKING]** Per `[[feedback_fn_deploy_before_cron_db_push]]` strict ordering: (1) `supabase functions deploy rag-summarize-and-chunk rag-embed-approved rag-retrieve rag-federated-pubmed rag-federated-fda rag-federated-dailymed rag-tip-of-day-generate rag-newsletter-sender rag-newsletter-unsubscribe-1click --project-ref <ref>` — atomic deploy of all 9 Phase 60 Fns. (2) THEN write cron migration `supabase/migrations/20281201000099_phase60_cron_schedules.sql` registering: federated-sync daily 03:00 UTC (3 jobs: pubmed/fda/dailymed), embed worker every 5min, tip-of-day daily 00:00 UTC, newsletter weekly Sunday 09:00 ET, eval nightly 02:00 UTC. Vault `service_role_key` + hardcoded URL per `[[reference_supabase_pg_cron_vault_service_role_pattern]]`. Use named `$cron$`/`$partition$` dollar-quote tags per `[[reference_postgres_dollar_quote_nesting_in_cron_body]]`. (3) `cd leanshot && supabase db push --linked` (SUPABASE_ACCESS_TOKEN env var per `[[reference_supabase_back_dated_migration_blocks_push]]` — verify no back-dated migration). (4) Verify deploy via `supabase functions list` + `select * from cron.job where jobname like 'phase60_%'`. (5) Phase-close ROADMAP toggle. Phase CANNOT pass verification without this. | 3 | 60-04, 60-05, 60-06, 60-07, 60-11, 60-12 | RAG-01, RAG-02, RAG-04, RAG-05, RAG-06, RAG-07, RAG-08 | `supabase/migrations/20281201000099_phase60_cron_schedules.sql`, `.planning/phases/60-rag-knowledge-base-completion-waves-2-4/60-DEPLOY-EVIDENCE.md` |

## Coverage map (REQUIREMENT → PLAN_ID)

- **RAG-01** (scrape pipeline → chunker → queue) → 60-04, 60-15
- **RAG-02** (embedding worker pgvector batch insert OpenAI text-embedding-3-small) → 60-05, 60-15
- **RAG-03** (admin curation surface; 2-person review; 5 SECDEF state-machine RPCs) → 60-01, 60-08
- **RAG-04** (AI-coach citation integration; top-k retrieval injected into system prompt + footnotes) → 60-02, 60-06, 60-10, 60-14, 60-15
- **RAG-05** (re-ranker; cross-encoder Cohere v3.5 + Jina v2 fallback; ≥+0.10 precision delta) → 60-02, 60-06, 60-14, 60-15
- **RAG-06** (federated PubMed + OpenFDA + DailyMed adapters; per-source admin toggle; 24h cache) → 60-01, 60-07, 60-09, 60-14, 60-15
- **RAG-07** (tip-of-day cron + Bento card + push category) → 60-01, 60-11, 60-15
- **RAG-08** (weekly Resend newsletter; opt-in; 1-click unsubscribe RFC 8058) → 60-01, 60-12, 60-15
- **RAG-09** (public `/knowledge/*` SEO hub; sitemap; rate-limited) → 60-13

**All 9 RAG-* REQ-IDs mapped to ≥1 plan. No orphans.**

## Cross-cutting constraints

### Schema-push BLOCKING task
- **60-15** owns the schema-push gate. Per `[[feedback_fn_deploy_before_cron_db_push]]`: Fns deploy FIRST (otherwise cron fires within 15min of `db push` to non-existent endpoints). 60-15 sequence is strict: deploy 9 Fns → write cron migration → `supabase db push --linked` → verify via `cron.job` query + `functions list`.

### Fn-deploy-before-cron-push (per `[[feedback_fn_deploy_before_cron_db_push]]`)
- Migration files 60-01..60-12 contain ZERO `cron.schedule(...)` calls. Cron schedules live exclusively in `20281201000099_phase60_cron_schedules.sql` (60-15) and are pushed AFTER all 9 Fns are live.

### 2-person review enforcement (per `[[feedback_3_layer_must_never_invariant_pattern]]` precedent)
- **60-01** SECDEF RPC `approve_rag_chunk(p_chunk_id uuid)` rejects when `auth.uid() = (SELECT created_by FROM kb_chunks_queue WHERE id = p_chunk_id)` — DB layer
- **60-08** UI badge disables Publish button when `currentUserId === chunk.created_by` — UI layer
- **60-03** eval suite `--suite=safety` includes 2-person-rule bypass test (constructed adversarial payload) — CI layer
- 3 layers independent + each tested

### Stub-then-replace targets (per `[[feedback_stub_then_replace_sibling_collision]]`)
- **None this phase** — sequential-on-main eliminates sibling collision risk. Each plan owns its files cleanly per `files_modified` column. (NOTE: 60-10 and 60-13 both touch `src/lib/rag/i18n.ts` family — 60-10 creates it; 60-13 reads only. `depends_on: 60-10` edge in 60-13 ensures order — declared above.)

### PHARMA-02 / FDA-equivalence carveouts
- All 3 federated adapters (60-07) auto-tag `tier='A'` but STILL pass through admin queue (60-08); no auto-publish for any source regardless of authority. Documented in CONTEXT.md decisions and AI-SPEC §6 guardrails.

### Cohere/Jina env-flag swap (per AI-SPEC §2 Soft Lock-In)
- 60-06 uses `Deno.env.get('RAG_RERANKER_PROVIDER')` as the only branch point. Both client paths fully implemented (no stub fallback). Operator sets `cohere` (default) or `jina` via `supabase secrets set`.

### Verbatim-quote XSS hardening (per UI-SPEC §3)
- 60-10 CitationPopover sanitizes `verbatim_quote` via existing DOMPurify before render. AI-SPEC `CitedAnswerSchema.verbatim_quote` is load-bearing — fail-closed refusal emits `rag_citation_validation_failed` event when schema parse fails.

### react-router consumer-admin split (per `[[reference_react_router_consumer_admin_split]]`)
- 60-13 extends consumer-side `App.tsx` with new `<Route path="/knowledge/*">` block (consumer-surface phase = allowed to widen). Admin pages 60-08/09 use existing admin Routes pattern. No router introduction in consumer SPA.

### Newsletter affirmative opt-in (CAN-SPAM)
- 60-12 Settings toggle + onboarding checkbox default UNCHECKED. Stored token RLS-gated for 1-click unsubscribe (anon SELECT RLS + read-only stored token per `[[feedback_rls_stored_token_verification_pattern]]`).

### Codebase-maps stale (per `[[reference_codebase_maps_stale_post_v1_0]]`)
- All plans grep `src/` directly for v1.4 patterns (Supabase + Edge Fns); do NOT rely on `.planning/codebase/*.md` v1.0 localStorage descriptions.

### Vitest 4.x projects-config trap (per `[[reference_vitest_4_projects_config_masks_default]]`)
- Test runs in 60-04..14 use `npx vitest run --config vite.config.ts` (not plain `npm test`) to bypass `vitest.config.ts` projects block masking.

### Deno test top-level serve trap (per `[[reference_deno_test_top_level_serve_trap]]`)
- Every Edge Fn `Deno.serve()` guarded by `import.meta.main` (declared in 60-02 helper convention + enforced in 60-04..07, 60-11, 60-12 Fn implementations).

## Threat Model summary (per ASVS L1 — full STRIDE register in each PLAN.md)

High-severity surfaces (block on `high`):
- **T-60-SSRF-1** (Spoofing/Tampering, 60-04 + 60-07) — admin-controlled URL paste + federated REST URLs → SSRF via internal IP / metadata endpoint → mitigate: URL allowlist (https-only + explicit-host registry); fail-closed
- **T-60-XSS-1** (Tampering, 60-10 + 60-13) — `verbatim_quote` + scraped HTML render → mitigate: DOMPurify sanitize at render-time; CSP report-only mode via VENDOR-07 Sentry report-uri
- **T-60-SQLI-1** (Tampering, 60-13) — `/knowledge/*` search params → mitigate: zod-validate query params; parameterized PostgREST query
- **T-60-AUTHN-1** (Spoofing, 60-08) — 2-person review bypass → mitigate: SECDEF RPC `actor_id != created_by` DB-enforced (60-01) + UI badge (60-08) + eval safety suite (60-03)
- **T-60-RFC8058-1** (Tampering, 60-12) — unsubscribe-link token forgery → mitigate: stored-token RLS-gated browser fetch + constant-time compare; List-Unsubscribe-Post per RFC 8058
- **T-60-PHARMA-02** (Information Disclosure, 60-04 + 60-07) — 3-layer carveout regression → mitigate: ESLint AST rule + runtime helper + CI grep gate (Phase 39 39-02 D-06 precedent)
- **T-60-DOS-1** (Denial of Service, 60-07 + 60-13) — federated adapter rate-limit DoS + public-hub crawl burst → mitigate: per-source backoff (60-07) + Edge Middleware rate-limit (60-13); Phase 67 OPS-08 tightens

## Audit Self-Check

- ✅ Every locked CONTEXT.md decision (D-01..D-11+) has a task implementing it (full audit in each PLAN.md per `<context_fidelity>` block)
- ✅ Every deferred idea (bulk approve, Spanish, carousel, personalized ranking, semantic-cache, prerender, ES newsletter, auth-wall-after-N) MUST NOT appear — verified
- ✅ All 9 RAG-* REQ-IDs covered by ≥1 plan in `requirements` frontmatter
- ✅ All 4 source types (GOAL / REQ / RESEARCH / CONTEXT) accounted for; no scope reduction; no "v1/v2/static-for-now/placeholder" language
- ✅ Schema push BLOCKING task explicit (60-15)
- ✅ Fn-deploy-BEFORE-cron-push ordering explicit (60-15 sequence steps 1→2→3)
- ✅ Vendor secrets pre-flighted in outline header (operator surfaces before Wave 0 dispatch)

## OUTLINE COMPLETE — 15 plans
