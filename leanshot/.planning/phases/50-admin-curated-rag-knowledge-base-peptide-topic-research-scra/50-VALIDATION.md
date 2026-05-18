---
phase: 50
slug: admin-curated-rag-knowledge-base-peptide-topic-research-scra
status: draft
nyquist_compliant: true
wave_0_complete: false
created: 2026-05-18
---

# Phase 50 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework (unit / RLS / E2E)** | vitest 4.1.5 + Playwright (existing) + Deno test (Edge Fns) |
| **Config files** | `vitest.config.ts`, `playwright.config.ts`, per-Edge-Fn `<name>.test.ts` |
| **Quick run command** | `npm run lint && npm run typecheck && vitest run --changed` |
| **Full suite command** | `npm run lint && npm run typecheck && vitest run && npx playwright test && supabase db push --linked --dry-run` |
| **Estimated runtime** | ~120 s quick / ~480 s full |

---

## Sampling Rate

- **After every task commit:** `npm run lint && npm run typecheck && vitest run --changed`
- **After every plan wave:** Full suite command above
- **Before `/gsd:verify-work`:** Full suite green, plus Edge Fn smoke probes for Firecrawl / OpenAI / Anthropic / Resend startup health checks
- **Max feedback latency:** 120 s for quick, 480 s for full

---

## Per-Task Verification Map

Per-task IDs follow the convention `50-NN-MM` where `NN` is plan number and `MM` is task index. The map below lists one row per CONTEXT decision (D-ID) mapped to its owning plan and an automated verification command. Plans `must_haves.truths` mirror this mapping verbatim so the decision-coverage gate passes.

| D-ID | Plan | Wave | Test Type | Automated Command | Status |
|------|------|------|-----------|-------------------|--------|
| D-01 (hybrid topic posture) | 50-04 | 2 | unit | `vitest run src/lib/rag/__tests__/scrape-runner.test.ts -t "curated topic refuses non-allowlist URL"` | ⬜ pending |
| D-02 (Firecrawl backend) | 50-04 | 2 | unit | `vitest run src/lib/rag/__tests__/scrape-runner.test.ts -t "calls /v1/scrape and /v1/crawl"` | ⬜ pending |
| D-03 (robots.txt + excerpt-only storage) | 50-04 | 2 | unit | `vitest run src/lib/rag/__tests__/scrape-runner.test.ts -t "stores excerpt + canonical URL only; honors robots disallow"` | ⬜ pending |
| D-04 (seed allowlist) | 50-01 | 1 | SQL | `vitest run src/lib/rag/__tests__/seed-sources.test.ts -t "12 seed sources inserted with tier + domain"` | ⬜ pending |
| D-05 (language-agnostic verbatim medical facts) | 50-05 | 2 | unit | `vitest run src/lib/rag/__tests__/summarizer.test.ts -t "non-English dosage line preserved verbatim"` | ⬜ pending |
| D-06 (per-source tier A/B/C) | 50-01 | 1 | SQL | `supabase db push --linked --dry-run && vitest run src/lib/rag/__tests__/tier-check.test.ts` | ⬜ pending |
| D-07 (on-label gating) | 50-04 | 2 | unit | `vitest run src/lib/rag/__tests__/scrape-runner.test.ts -t "refuses scrape on excluded domains"` | ⬜ pending |
| D-08 (topic shape = query + tag) | 50-02 | 1 | unit | `vitest run src/lib/rag/__tests__/topic-crud.test.ts -t "topic shape"` | ⬜ pending |
| D-09 (per-topic cadence + pg_cron) | 50-04 | 2 | SQL | `vitest run src/lib/rag/__tests__/cron-orchestrator.test.ts -t "next_scrape_at computed from cadence"` | ⬜ pending |
| D-10 (single-row CRUD) | 50-02 | 1 | unit | `vitest run src/lib/rag/__tests__/topic-crud.test.ts -t "no bulk import surface"` | ⬜ pending |
| D-11 (per-topic telemetry) | 50-02 | 1 | unit | `vitest run src/lib/rag/__tests__/telemetry-rollup.test.ts` | ⬜ pending |
| D-12 (super-admin only) | 50-02 | 1 | RLS | `vitest run src/lib/rag/__tests__/topic-crud-rls.test.ts -t "non-superadmin cannot CRUD topics"` | ⬜ pending |
| D-13 (soft-delete + cascade behavior) | 50-02 | 1 | RLS | `vitest run src/lib/rag/__tests__/soft-delete.test.ts` | ⬜ pending |
| D-14 (last-edited-by + audit log) | 50-02 | 1 | unit | `vitest run src/lib/rag/__tests__/topic-audit.test.ts` | ⬜ pending |
| D-15 (tiered auto-publish) | 50-06 | 2 | unit + RLS | `vitest run src/lib/rag/__tests__/publish-flow.test.ts -t "Tier-A auto-publishes; B/C queue"` | ⬜ pending |
| D-16 (reject reason taxonomy + 5-rejects-30d signal) | 50-06 | 2 | unit | `vitest run src/lib/rag/__tests__/reject-reasons.test.ts` | ⬜ pending |
| D-17 (quote-only mode for medical claims) | 50-05 | 2 | unit | `vitest run src/lib/rag/__tests__/summarizer.test.ts -t "verbatim quote_blocks for dosage"` | ⬜ pending |
| D-18 (soft SLA + backlog alert) | 50-06 | 2 | unit | `vitest run src/lib/rag/__tests__/sla-backlog.test.ts` | ⬜ pending |
| D-19 (diff-detect re-validation) | 50-04 | 2 | unit | `vitest run src/lib/rag/__tests__/diff-detector.test.ts -t "20% threshold + section markers"` | ⬜ pending |
| D-20 (soft-remove takedown + audit log) | 50-06 | 2 | unit + RLS | `vitest run src/lib/rag/__tests__/retract.test.ts` | ⬜ pending |
| D-21 (erratum detection = D-19 + manual flag) | 50-06 | 2 | unit | `vitest run src/lib/rag/__tests__/erratum-flag.test.ts` | ⬜ pending |
| D-22 (MVP vs stretch wave split) | 50-07 + 50-09 | 3/4 | manifest | Wave 3 ships independently of Wave 4; `grep -l "wave: 4" 50-09-PLAN.md` |
| D-23 (coach citation footnote + popover) | 50-08 | 3 | E2E | `npx playwright test e2e/coach-citations.spec.ts` | ⬜ pending |
| D-24 (dashboard Tip of the day) | 50-08 | 3 | unit + E2E | `vitest run src/components/dashboard/cards/__tests__/TipOfTheDayCard.test.tsx && npx playwright test e2e/tip-of-day.spec.ts` | ⬜ pending |
| D-25 (Research newsletter separate from P38) | 50-09 | 4 | inspection | `grep -L "weekly Claude" supabase/functions/rag-newsletter-sender/*.ts` | ⬜ pending |
| D-26 (weekly cadence + opt-in default) | 50-09 | 4 | unit | `vitest run src/lib/rag/__tests__/newsletter-subscribe.test.ts` | ⬜ pending |
| D-27 (public /research hub + JSON-LD) | 50-09 | 4 | unit + E2E | `vitest run src/components/research/__tests__/ResearchHub.test.tsx && npx playwright test e2e/research-hub.spec.ts` | ⬜ pending |
| D-28 (separate external_kb_embeddings table) | 50-01 | 1 | SQL | `supabase db push --linked --dry-run && vitest run src/lib/rag/__tests__/embeddings-schema.test.ts` | ⬜ pending |
| D-29 (recommender Edge Fn extended) | 50-07 | 3 | unit | `vitest run src/lib/rag/__tests__/retrieve.test.ts -t "merges content_embeddings and external_kb_embeddings"` (NOTE: ships standalone rag-retrieve Edge Fn at v1.3 because P38 not yet built; see RESEARCH §Open Questions) | ⬜ pending |
| D-30 (cost ledger + budget + auto-pause) | 50-04 | 2 | unit | `vitest run src/lib/rag/__tests__/cost-ledger.test.ts -t "80%% email and 100%% auto-pause"` | ⬜ pending |
| D-31 (scraper failure backoff + Sentry + auto-pause source) | 50-04 | 2 | unit | `vitest run src/lib/rag/__tests__/scrape-runner.test.ts -t "3-attempt backoff and auto-pause after 3 failed runs"` | ⬜ pending |
| D-32 (freshness tier + visible as-of date) | 50-07 + 50-08 | 3 | unit | `vitest run src/lib/rag/__tests__/retrieve.test.ts -t "de-ranks stale chunks per tier window"` | ⬜ pending |
| D-33 (i18n disclaimer string shared across surfaces) | 50-08 | 3 | unit | `vitest run src/lib/i18n/__tests__/rag-strings.test.ts -t "single key rag.attribution and rag.disclaimer"` | ⬜ pending |
| D-34 (non-PHI + scrubbed citation events + session-recording regex) | 50-08 | 3 | regex + unit | `vitest run src/lib/posthog/__tests__/disable-recording-regex.test.ts -t "matches /admin/rag/* and /research/*"` | ⬜ pending |
| D-35 (PostHog event taxonomy registered) | 50-03 | 1 | unit | `vitest run src/lib/analytics/__tests__/events-registry.test.ts -t "13 rag_* events registered with property shapes"` | ⬜ pending |
| D-36 (pre-launch ops — Karsten + advisor) | n/a (ops) | 0 | manual | See Manual-Only Verifications below | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `FIRECRAWL_API_KEY` minted at firecrawl.dev and stored in Supabase Function Secrets (`supabase secrets set FIRECRAWL_API_KEY=…`)
- [ ] PostHog server-side project API key already exists from Phase 24 wave-0 (`POSTHOG_PROJECT_API_KEY`)
- [ ] Vercel AI Gateway tokens (OpenAI + Anthropic) from Phase 25 / Phase 38 already provisioned; health checks no-op with logged warning if missing per `[[reference_vendor_gated_send_health_check]]`
- [ ] Karsten authors 20 seed topics (D-36) before user-facing Wave 3 surfaces ship (does NOT block code merging; gate only)
- [ ] Clinical advisor recruited and onboarded (D-36) before user-facing Wave 3 surfaces ship (gate only)
- [ ] Existing vitest + Playwright + Deno test framework already installed — no Wave 0 framework install needed

---

## Manual-Only Verifications

| Behavior | Decision | Why Manual | Test Instructions |
|---|---|---|---|
| 20 seed topics authored | D-36 | Content authorship is human work | Run `select count(*) from public.rag_topics where deleted_at is null` against linked DB; assert ≥ 20 |
| Clinical advisor recruited | D-36 | Vendor/HR process | Karsten confirms contract signed; advisor email present in `admin_advisors` table |
| Firecrawl API key minted | Wave 0 | Browser-only signup | Karsten visits firecrawl.dev, mints key, runs `supabase secrets set FIRECRAWL_API_KEY=...` |
| 80% budget email actually delivered | D-30 | Requires live Resend send | Manually set `rag_cost_ledger` MTD to 81%, trigger cron, verify inbox |
| Auto-pause toggle flips in admin UI | D-30 | UI smoke | Force `rag_sources.paused_at = now()`, reload `/admin/rag/sources`, verify pulse badge |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or explicit Wave 0 / Manual dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references (Firecrawl key, clinical-advisor recruitment, seed-topic authorship)
- [x] No watch-mode flags (every verify uses `vitest run`, never `vitest`)
- [x] Feedback latency < 120s quick / 480s full
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
