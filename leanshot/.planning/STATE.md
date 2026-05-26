---
gsd_state_version: 1.0
milestone: v1.4
milestone_name: Launch Gate
status: executing
last_updated: "2026-05-26T11:27:26.824Z"
progress:
  total_phases: 20
  completed_phases: 8
  total_plans: 53
  completed_plans: 45
  percent: 45
---

# Milestone v1.4: Launch Readiness

**Status:** Executing Phase 60 — Plans 60-01 + 60-02 + 60-03 + 60-04 + 60-05 COMPLETE (2026-05-26)
**Phases:** 52-70 (19 phases)
**Requirements:** 200 REQ-IDs across 19 workstreams
**Source documents:**

- `.planning/PROJECT.md` (v1.4 Goals section)
- `.planning/MILESTONE-CONTEXT.md` (phase enumeration + scope contracts)
- `.planning/research/v1.4-launch-readiness-gaps.md` (4 blockers + 16 hard-debt items)
- `.planning/REQUIREMENTS.md` (v1.4 traceability)
- `.planning/ROADMAP.md` (phase details + UAT roll-up)

## Current Position

- **Phase:** 60 (RAG Knowledge Base Completion) — Wave 0 COMPLETE (3/15 plans); Waves 1-3 PAUSED on Phase 60.5 vendor pre-flight
- **Last completed:** Phase 60 Wave 1 — 60-09 (admin federated toggle UI, 5 tasks, 35 vitest, Option D resolution, ending 36d6c728). Prior: 60-08 (admin queue UI, ending d7d50153), 60-07 (ending 834d7542), 60-06 (ending f5b13378), 60-05 (ending 723c22cc), 60-04 (ending 941dfbb4), Wave 0: 60-01..03 (ending bc2b138f).
- **Status:** 60-09 COMPLETE (2026-05-26). Wave 1 continues: 60-10.

### Phase 60 PAUSE — Wave 1 vendor blockers (resume notes)

Wave 0 (3 plans) shipped CLEAN — no vendor secrets needed. **Wave 1 (6 plans) hits 4 different vendor blockers** spread across Phase 60.5 (consolidated vendor setup, inserted 2026-05-26 commit 443ffc4f).

**Wave 1 plans (vendor dependency map):**

- ✅ **60-04** (chunker Fn) — uses existing `ANTHROPIC_API_KEY` — CAN ship without Phase 60.5
- ✅ **60-05** (embed Fn) — uses `OPENROUTER_API_KEY` (set 2026-05-26 via Phase 60.5 override) — COMPLETE
- ⚠️ **60-06** (retrieval + rerank Fn) — needs `COHERE_API_KEY` (+ optional `JINA_API_KEY`) — UNSET; code can ship but runtime untestable until Phase 60.5
- ✅ **60-07** (federated PubMed/FDA/DailyMed) — works WITHOUT optional `PUBMED_API_KEY` + `OPENFDA_API_KEY` (rate-limited but functional) — CAN ship
- ✅ **60-08** (admin queue UI) — no vendor — CAN ship
- ✅ **60-09** (admin federated toggle UI) — no vendor — CAN ship

**Wave 2 (2 plans):**

- ✅ **60-10** (AI-coach citation UI) — depends_on 60-06 — code can ship, runtime gates on Phase 60.5
- ⚠️ **60-11** (tip-of-day card + Fn) — depends_on 60-06, 60-08 — gates on Phase 60.5

**Wave 3 (4 plans):**

- ⚠️ **60-12** (newsletter) — needs `NEWSLETTER_UNSUBSCRIBE_SIGNING_KEY` ✅ SET via openssl rand-hex-32 + RESEND_API_KEY ✅ existing — CAN ship
- ⚠️ **60-13** (public /knowledge hub) — depends_on 60-06 — gates on Phase 60.5
- ⚠️ **60-14** (cost dashboard) — needs `POSTHOG_PERSONAL_API_KEY` + `POSTHOG_PROJECT_ID` ✅ SET — partial
- ⚠️ **60-15 BLOCKING** (`autonomous: false`) — Phase close-out; gates on ALL above

**3 secrets set programmatically 2026-05-26 (Supabase secrets):**

- `POSTHOG_PROJECT_ID=140479`
- `RAG_RERANKER_PROVIDER=cohere` (env-flag default)
- `NEWSLETTER_UNSUBSCRIBE_SIGNING_KEY=<32-byte hex>` (openssl rand)

**Operator action required (Phase 60.5):**

- Sign up for Cohere → `COHERE_API_KEY` → `supabase secrets set --project-ref ytnsipxxmzgaebkqmokp COHERE_API_KEY=co_xxx`
- Verify Phase 50-07 Vercel AI Gateway deployment + capture `VERCEL_AI_GATEWAY_TOKEN` + `OPENAI_API_KEY` (or `AI_GATEWAY_API_KEY_CONSUMER` per 60-05 plan)
- PostHog dashboard → Personal API keys → create scope `query:read` → `POSTHOG_PERSONAL_API_KEY`
- (optional) Sign up for Jina / PubMed / OpenFDA for fallback rerank + relaxed federated rate-limits
- Supabase Dashboard → Database → Vault → add `slack_guardrail_webhook` row with Slack incoming-webhook URL
- Update `.planning/runbooks/vendor-secrets.md` with Phase 60-69 vendor registry rows
- Then re-dispatch `/gsd-autonomous --from 60 --to 69`

**Aggressive-foundations note:** Continuing Wave 1 inline WITHOUT Phase 60.5 secrets would land 60-04 + 60-07 + 60-08 + 60-09 CLEAN (code-only, runtime-defer to Phase 60.5). 60-05 + 60-06 would compile/test green (mocked) but their runtime smoke would fail until Phase 60.5. Operator may prefer to set Cohere + OpenAI keys FIRST (single dashboard session, ~10 min) before continuing.

### Phase 60 resume notes (investigated 2026-05-26, NOT yet started — saves re-investigation)

- **Scope = complete v1.3 Phase 50 Waves 2-4 + 2 NEW items.** Phase 50 dir `.planning/phases/50-admin-curated-rag-knowledge-base-peptide-topic-research-scra/`: Wave 1 (50-01..04: pgvector schema + admin shell + event registry + scrape) SHIPPED (have SUMMARYs). **50-05..09 are PLANNED-but-UNEXECUTED** (PLAN.md only, no SUMMARY) — detailed + mostly reusable:
  - 50-05 = Anthropic summarizer + sentence-aware chunker Edge Fn (quote-only D-17) → RAG-01/02
  - 50-06 = admin review queue UI + 5 SECDEF state-machine RPCs (queued→approved/rejected/retracted) → RAG-03
  - 50-07 = embedding pipeline (OpenAI text-embedding-3-small via Vercel AI Gateway) + retrieval Edge Fn (HNSW ANN + freshness/tier reweight) → RAG-04
  - 50-08 = AI-coach inline citations + popover + Tip-of-day Bento card + server-rag-event-relay + rag.attribution/disclaimer i18n → RAG-05/06
  - 50-09 = weekly Research newsletter (Resend) + public hub + NewsletterSettings + Cost dashboard → RAG-07/08/09 (STRETCH)
- **NEW (not in 50-05..09):** (a) cross-encoder RE-RANKER (success-crit 3, a/b vs raw cosine) → research the model/approach; (b) federated PubMed + OpenFDA + DailyMed adapters w/ per-source admin toggle (success-crit 4) → research the APIs; (c) public hub path is `/knowledge/*` in P60 goal vs `/research` in 50-09 — rename to `/knowledge`.
- **Approach:** plan FRESH in a new `60-rag-knowledge-base-completion-waves-2-4` dir (the 50-05..09 v1.3 plans are reference inputs — reuse task breakdowns, re-validate against v1.4). Map all to RAG-01..09. Aggressive-foundations: MVP+STRETCH both ship.
- **Defer to P70:** live scrape/embed against prod, live federated-source syncs, newsletter live send, on-device tip-of-day push, any vendor-key-gated live verification.

### Execution lesson for remaining phases (57-59 validated)

- **Use SEQUENTIAL-ON-MAIN executors, NOT worktrees.** Phase 58 worktrees hit: 217-commit stale-base fork (58-04), file-leaks (OnboardingFlow/clinic-invite), pwd-leak-to-main (58-01) — ~heavy remediation. Phases 57 (worktree, small/disjoint, OK) then 58 (worktree, painful) then 59 (sequential-on-main, CLEAN). For 60-69 default to sequential-on-main: spawn gsd-executor WITHOUT isolation, on main, one plan at a time; they edit + commit directly to main. Per-phase post-merge gate = tsc + targeted vitest + locale gate; full-suite baseline is ~106-110 failing/24-25 files (FLAKY EnvironmentTeardownError — gate by own-tests + no-net-new, not whole-suite pass). `|tail` hides vitest exit in zsh.

## Milestone Contract

Per `feedback_milestone_uat_deferral_consolidation` forward-looking variant:

- **Every phase 52-69 ships `autonomous: true`** with HUMAN-UAT signals EMPTY in its own frontmatter
- **Every per-phase HUMAN-UAT signal rolls up to Phase 70**
- **Phase 70 is `autonomous: false`** — single consolidated launch gate, multi-signal HUMAN-UAT
- **Ship rule for Phase 70:** TBD at Phase 70 planning (either all-signals-pass OR ≥X/Y inline-approved + critical-gate subset)

## Dependency Graph

```
P52 (Vendor Setup) gates:
  → P53 (Capacitor) → P57 (Watch needs mobile shell)
  → P54 (Push needs APNs/FCM)
  → P55 (HealthKit needs entitlement)
  → P59 (Apple OAuth needs service ID)
  → P61 (Protocol Creator needs Mux for clinical embeds)
  → most launch-gap phases (Stripe Tax, Mux, etc.)

P60 (RAG completion) gates:
  → P61 (Protocol Creator pulls RAG evidence)
  → P62 (Insights feeds back into RAG)

P64-68 (launch gaps) mostly parallel after carry-over
P69 (Design Polish) waits for P52-68 (audit AFTER all surfaces ship)
P70 (Consolidated UAT) waits for EVERYTHING (last phase)
```

## Accumulated Context

### Decisions locked at milestone authoring (2026-05-25)

- **D-01:** Vendor setup consolidates to Phase 52 (user direction: "ensure all is setup correctly from start of the milestone"). Eliminates per-phase secret-deferral pattern from v1.3.
- **D-02:** Phase 50 RAG resumes IN-PLACE (existing dir at `.planning/phases/50-*/`); not a fresh phase dir.
- **D-03:** Phase 20 (Ad Network) + Phase 21 (Watch Apps) both ship in v1.4 per `feedback_aggressive_foundations`. No descope.
- **D-04:** Spanish i18n contractor already engaged externally; Phase 58 is wiring + verification only.
- **D-05:** Launch-readiness gaps (4 blockers + 16 hard-debt) fold INTO v1.4 after carry-over, BEFORE design polish + UAT.
- **D-06:** Two new product features added (P61 Protocol Creator + P62 Insights & Research Engine) per user 2026-05-25 direction.
- **D-07:** Phase numbering continues from 51 (v1.3's last) — no `--reset-phase-numbers`.
- **D-08:** All per-phase HUMAN-UAT rolls up to Phase 70 per consolidated-UAT contract. No per-phase UAT during execution.
- **D-60-03-01:** EVAL_SUITE env var (not --suite CLI flag) for suite selection — Vitest 4.x workers don't inherit CLI args before --; env var is reliable cross-platform invocation.
- **D-60-03-02:** 41 deferred adversarial examples (fda-equivalence/kanon/drug-stack/stale-drift-extension) are not scope reduction — owner plans (60-04/06/07/13) fill inline during execution with regulatory/clinical expert review required.
- **D-60-03-03:** PLACEHOLDER-<bucket>-<NN> UUID convention in gold-set; Wave 1 (60-06) backfills with real chunk_ids after first chunker run via backfill-placeholder-uuids.ts script.
- **D-60-05-01:** handler.ts separated from index.ts in rag-embed-approved so Vitest (Node) can unit-test the handler without hitting Deno-specific npm: specifiers; HandlerDeps interface is the seam.
- **D-60-05-02:** emitAiGeneration userId = 'rag-system' for cron embed batches (D-13 invariant: non-empty userId required for $ai_generation; rag-system is canonical system actor from Phase 50 D-34).
- **D-60-05-03:** OpenRouter vendor route confirmed (2026-05-26 override): OPENROUTER_API_KEY for both chat + embed in Phase 60; Vercel AI Gateway eliminated for this Fn.
- **D-60-06-01:** Cohere Rerank v3.5 via REST API (not npm SDK) for Deno-native fetch compatibility and full mock control in tests.
- **D-60-06-02:** captureRagEvent (system-actor) used for refusal events — refusals are pipeline-level quality gates, not user-attributed telemetry; D-13 user-attribution applies to user-generated AI calls only.
- **D-60-06-03:** eval/phase60/dimensions/ created at git root per plan spec for Deno-native CLI runner; coexists with existing Vitest harness at tests/eval/phase60/.
- **D-60-09-01 (Option D):** Pull-history button in FederatedSourcesPage rendered DISABLED pending admin-action-token auth mechanism (60-15). 60-07 Fns designed for service-role/cron, not admin browser calls. SOURCE_META client-side const map derives display_name + sync_cadence_label (no new DB columns). Migration 20281201000020 ships list_federated_sources + set_federated_source_enabled RPCs (NOT pushed until 60-15).

### Todos

- [x] Phase 52 (Vendor Setup Foundation) shipped — VERIFICATION passed, review fixed, UI 22/24
- [ ] After Phase 52 ships: dispatch carry-over phases (53-63) in dependency order
- [ ] Then launch-gap phases (64-68) — mostly parallel
- [ ] Then design polish (69) after all surfaces ship
- [ ] Then consolidated UAT (70) — final launch gate

### Blockers

None at authoring time. Vendor accounts (Apple Dev / Play / Mux / Better Stack / HealthKit entitlement) need provisioning at Phase 52 dispatch per existing PROJECT.md Vendor Accounts table.

## Session Continuity

Authored via `/gsd-new-milestone v1.4` flow on 2026-05-25. All 4 artifacts written atomically:

- `.planning/REQUIREMENTS.md` (new — fresh for v1.4; v1.3 archived)
- `.planning/ROADMAP.md` (extended — milestone header + collapsed v1.1/v1.2/v1.3 details + new Phases 52-70 section)
- `.planning/PROJECT.md` (extended — v1.4 Goals section added; history preserved)
- `.planning/STATE.md` (this file — reset for v1.4)

Next step: `/gsd-plan-phase 52` to plan the Vendor Setup Foundation.
