# Phase 50: Admin-Curated RAG Knowledge Base — Peptide/Topic Research Scraper Feeding AI Tips + Newsletters - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in 50-CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-17
**Phase:** 50-Admin-Curated RAG Knowledge Base
**Areas discussed:** Scraping source strategy, Admin topic curation UX, Review/approval flow, Output surfaces + Phase 38 boundary, Cost guardrails, Scraper failure handling, AI coach citation UI, Freshness SLO, HIPAA/PHI posture, Medical disclaimer, PostHog event taxonomy, Pre-launch ops plan

---

## Scraping Source Strategy

### Q1: Source posture

| Option | Description | Selected |
|--------|-------------|----------|
| Curated allowlist only | Admin-maintained trusted source list (PubMed, FDA, manufacturer pages). Safer, easier ToS. | |
| Open-web first, allowlist as filter | Firecrawl/Exa open-web search; allowlist boosts ranking. | |
| Hybrid — admin chooses per topic | Each topic flagged curated OR open-web. Most flexible. | ✓ |

### Q2: Scraper backend

| Option | Description | Selected |
|--------|-------------|----------|
| Firecrawl | Available as skill; clean markdown; pay-per-credit. | ✓ |
| Exa.ai + Firecrawl extract | Exa for discovery, Firecrawl for extraction. | |
| Self-hosted Playwright + Readability.js | No vendor cost; heavy maintenance. | |

### Q3: ToS / robots.txt

| Option | Description | Selected |
|--------|-------------|----------|
| Respect robots.txt + excerpt-and-link | Excerpt + summary + canonical URL; link out. | ✓ |
| Summarize-and-host (no excerpts) | LLM-rewritten original summary hosted. | |
| Full-text host (allowlist) + excerpt (open-web) | CC-licensed full-text storage. | |

### Q4: Seed allowlist

| Option | Description | Selected |
|--------|-------------|----------|
| Ship with curated seed list | ~10-15 sources seeded; admin can edit. | ✓ |
| Empty allowlist — admin populates | No seeds. | |
| Ship seed as DB migration (editable) | Same as recommended; explicit DB seeding. | |

### Q5: Language / geo

| Option | Description | Selected |
|--------|-------------|----------|
| English-only at launch | Filter Firecrawl results lang=en. | |
| English + Spanish | Double the queue + Spanish allowlist. | |
| Language-agnostic | Scrape any language; LLM translates at retrieval. | ✓ |

**Notes:** Claude flagged hallucination risk on medical-content translation. Mitigation captured in D-05 for researcher to address.

### Q6: Trust score

| Option | Description | Selected |
|--------|-------------|----------|
| Admin-assigned trust tier (A/B/C) | Tier-A boosted in ranking; UI shows badge. | ✓ |
| Binary allowed/blocked | Simpler schema. | |
| Auto-scored via LLM | Programmatic; complex. | |

### Q7: Off-label peptide gating

| Option | Description | Selected |
|--------|-------------|----------|
| Strict on-label only | Exclude gray-market + forums; FDA-approved on-label only. | ✓ |
| On-label + research-only off-label | Include peer-reviewed off-label research. | |
| Permissive — admin decides | No content gate beyond allowlist. | |

---

## Admin Topic Curation UX

### Q1: Topic shape

| Option | Description | Selected |
|--------|-------------|----------|
| Free-text query + tag | Tag groups topics; simple to author. | ✓ |
| Structured form (drug + outcome + population + recency) | Precise; heavier UI. | |
| Question template | Variable substitution. | |

### Q2: Re-scrape cadence

| Option | Description | Selected |
|--------|-------------|----------|
| Per-topic cadence + global default | Topic-level override; default weekly. | ✓ |
| Single global cadence | Everything weekly. | |
| Adaptive based on found-new-content rate | Smart; complex telemetry. | |

### Q3: Bulk operations

| Option | Description | Selected |
|--------|-------------|----------|
| Single-row CRUD only | Add/edit/delete one at a time. | ✓ |
| CSV import + bulk edit | For seeding 100+ topics. | |
| Topic templates / cloning | Reduces repetitive authoring. | |

### Q4: Telemetry

| Option | Description | Selected |
|--------|-------------|----------|
| Per-topic dashboard | Docs ingested + RAG hits + impressions/clicks per topic. | ✓ |
| Aggregate only | Global counters only. | |
| Defer to v1.4 | No telemetry at launch. | |

### Q5: Authoring permission

| Option | Description | Selected |
|--------|-------------|----------|
| Super-admin only | Single source of truth. | ✓ |
| Super-admin + clinic admins | Per-org scope. | |
| Super-admin + content-editor role | New role for non-engineers. | |

### Q6: Delete semantics

| Option | Description | Selected |
|--------|-------------|----------|
| Soft-delete with cascade behavior | Content stays in RAG; topic stops scraping. | ✓ |
| Hard-delete with cascade purge | Delete content + embeddings. | |
| Hard-delete topic, keep content | Orphan. | |

### Q7: Versioning

| Option | Description | Selected |
|--------|-------------|----------|
| Last-edited-by + audit log only | No full history. | ✓ |
| Full version history (every edit) | Diff/revert capability. | |
| No history beyond updated_at | Lightest. | |

---

## Review and Approval Flow

### Q1: Trust model

| Option | Description | Selected |
|--------|-------------|----------|
| Human-in-the-loop (every chunk reviewed) | Safest. | |
| Tiered auto-publish | Tier-A auto; Tier-B/C reviewed. | ✓ |
| LLM-pre-filter + admin spot-check | Cheapest staffing. | |
| Auto-publish everything | Fastest, riskiest. | |

### Q2: Reject feedback

| Option | Description | Selected |
|--------|-------------|----------|
| Reject + reason → source-quality signal | Reasons aggregate per source. | ✓ |
| Reject silently | No metadata. | |
| Reject + auto-block URL prefix | Aggressive blocking. | |

### Q3: Re-validation

| Option | Description | Selected |
|--------|-------------|----------|
| Diff-detect + re-queue on material change | ≥20% diff or new sections → re-review. | ✓ |
| Always re-queue on any change | Highest safety. | |
| Approved = approved forever | No re-validation. | |

### Q4: Hallucination guard

| Option | Description | Selected |
|--------|-------------|----------|
| Quote-only mode for medical claims | Verbatim quotes for dosage/indication/contraindication/AE. | ✓ |
| LLM-judge fact-check before queueing | Second LLM call. | |
| No special guardrail | Admin catches in review. | |

### Q5: Queue SLA

| Option | Description | Selected |
|--------|-------------|----------|
| Soft SLA + backlog alert | Tier-B 7d / Tier-C 14d targets; Slack on >100. | ✓ |
| Hard SLA — auto-reject after N days | Auto-clean queue. | |
| No SLA — best-effort | Unbounded backlog. | |

### Q6: Takedown

| Option | Description | Selected |
|--------|-------------|----------|
| Soft-remove + audit log | Removed from retrieval; original preserved. | ✓ |
| Hard-delete + retroactive newsletter correction | Maximum transparency. | |
| Soft-remove, no notification | Quiet removal. | |

### Q7: Erratum detection

| Option | Description | Selected |
|--------|-------------|----------|
| Diff-detect + manual admin flag | Reuse diff-detect; manual otherwise. | ✓ |
| Source-specific erratum APIs (retraction-watch, FDA recall) | Highest safety. | |
| Manual only — no automation | Cheapest. | |

---

## Output Surfaces + Phase 38 Boundary

### Q1: Where does scraped content surface? (multi-select)

| Option | Description | Selected |
|--------|-------------|----------|
| AI coach answers with citations | Coach retrieval + inline citation badges. | ✓ |
| Dashboard 'Tip of the day' card | Daily-rotated tagged tip. | ✓ |
| Dedicated 'Peptide research' newsletter | Separate cadence from RECOMMEND-05. | ✓ |
| Public 'Research Hub' page (SEO) | `/research` page. | ✓ |

### Q2: Relation to Phase 38 RECOMMEND-05 weekly newsletter

| Option | Description | Selected |
|--------|-------------|----------|
| Separate cadence + template | Different voice / opt-in / template. | ✓ |
| Fold into RECOMMEND-05 | Augment Phase 38 weekly with 'Latest research'. | |
| Hybrid — P38 teaser + P50 monthly deep | Cross-references. | |

### Q3: Embeddings table

| Option | Description | Selected |
|--------|-------------|----------|
| Separate `external_kb_embeddings` table | Phase 38 internal, Phase 50 external. | ✓ |
| Share `content_embeddings` with `source_type` discriminator | One table. | |
| Defer until Phase 38 lands | Let Phase 38 decide first. | |

### Q4: Retrieval Edge Function

| Option | Description | Selected |
|--------|-------------|----------|
| Extend Phase 38's recommender | One Edge Fn, two sources. | ✓ |
| Separate `external-kb-retrieve` | Two Edge Fns. | |
| Single in Phase 50, refactor P38 | Inverts dependency. | |

### Q5: MVP cut

| Option | Description | Selected |
|--------|-------------|----------|
| Must-ship: AI coach + Tip-of-day; Slip: Newsletter + Hub | In-app first. | ✓ |
| Must-ship: AI coach + Newsletter; Slip: Tip + Hub | Email + chat. | |
| Must-ship: All four | No cut. | |
| Must-ship: AI coach only | Tightest. | |

### Q6: Research Hub auth

| Option | Description | Selected |
|--------|-------------|----------|
| Public + indexable | SEO + sitemap + canonical link-out. | ✓ |
| Logged-in users only | No SEO. | |
| Public summary + auth-gated full | Hybrid teaser-wall. | |

### Q7: Newsletter cadence + opt-in

| Option | Description | Selected |
|--------|-------------|----------|
| Monthly + opt-in default OFF | CAN-SPAM-safe; low-burden. | |
| Weekly + opt-in default ON for paid users | More engagement. | ✓ |
| Quarterly + opt-in default OFF | Slow. | |

---

## Cost / Reliability / Observability / Freshness

### Q1: Cost guardrails

| Option | Description | Selected |
|--------|-------------|----------|
| Monthly budget kill-switch + admin dashboard | 80% alert, 100% hard-stop. | ✓ |
| Soft cap only | Alert at 80%, no auto-pause. | |
| No budget controls | Trust vendor dashboards. | |

### Q2: Scraper failure handling

| Option | Description | Selected |
|--------|-------------|----------|
| Retry+backoff → Sentry → auto-pause source | 3 attempts, then pause. | ✓ |
| Sentry only — manual pause | Faster recovery. | |
| Silent degrade — log only | Cheapest. | |

### Q3: AI coach citation UI

| Option | Description | Selected |
|--------|-------------|----------|
| Inline footnote markers + expandable source card | Perplexity / NotebookLM pattern. | ✓ |
| Trailing source list at end of message | Simpler. | |
| No visible citation, long-press reveals | Cleanest text. | |

### Q4: Freshness SLO

| Option | Description | Selected |
|--------|-------------|----------|
| Per-source freshness tier + visible 'as of' | Tier-A 365d / B 90d / C 30d; de-rank stale. | ✓ |
| Hard exclude beyond N days | Clean cutoff. | |
| No staleness handling | Forever-fresh. | |

---

## HIPAA / Disclaimer / Ops / Events

### Q1: HIPAA / PHI

| Option | Description | Selected |
|--------|-------------|----------|
| External = non-PHI; events scrubbed on user_id join | Server-side capture strips user_id. | ✓ |
| Treat citation events as PHI-tainted | SES path + Sentry redact. | |
| No special PHI handling beyond v1.3 defaults | Trust existing masks. | |

### Q2: Disclaimer display

| Option | Description | Selected |
|--------|-------------|----------|
| Always-visible: source + 'as of' + tier + 'Not medical advice' | Standardized i18n string. | ✓ |
| Disclaimer on first surface per session | Banner once. | |
| Disclaimer in /legal only | Global. | |

### Q3: Pre-launch ops

| Option | Description | Selected |
|--------|-------------|----------|
| Karsten owns ops; seed 20 topics + 1 clinical advisor | Wave-0 ops task. | ✓ |
| Engineering owns queue at launch | Misaligned skill. | |
| Hold launch until clinical advisor signed | Blocks ship. | |

### Q4: Event taxonomy

| Option | Description | Selected |
|--------|-------------|----------|
| Lock names + properties now | Canonical taxonomy in CONTEXT.md. | ✓ |
| Defer to plan-phase | Risk of drift from Phase 24 registry. | |

---

## Claude's Discretion

- Schema-naming convention for new tables (`rag_topics`, `rag_chunks`, etc.) — researcher picks.
- HNSW vs IVFFlat index params for `external_kb_embeddings` — researcher follows Phase 38 CONTEXT.md decision.
- Chunking strategy (fixed-size, sentence-aware, semantic) — researcher picks.
- Specific row-count + RPS estimates for cron sizing — researcher computes.
- React component hierarchy for admin review queue UI — planner picks based on Phase 24 pattern.

## Deferred Ideas

See `50-CONTEXT.md` §"Deferred Ideas" — captured there for downstream agent visibility.
