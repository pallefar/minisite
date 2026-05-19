# Phase 38: M5b AI Recommender (pgvector + Claude Digest) - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-19
**Phase:** 38-m5b-ai-recommender-pgvector-claude-digest
**Areas discussed:** Recommender surfaces + cold-start, Weekly digest defaults, Win-back model, HITL queue
**Discuss tool sequencing:** User chose "Both — AI-SPEC first, then continue discuss". AI-SPEC.md was generated via `/gsd-ai-integration-phase` (commit 7ca7747) BEFORE this CONTEXT.md was captured. AI-SPEC.md is referenced as the canonical AI-system design contract; this discussion captures product-shape decisions outside the AI-spec scope.

---

## Recommender Surfaces & Cold-Start

| Option | Description | Selected |
|--------|-------------|----------|
| Dashboard "For you" card only | Single surface; KB/community/course defer; popular-content cold-start | |
| Dashboard card + KB article footer | Two surfaces; skip community + course until those phases ship | |
| All three (dashboard + KB + future-proof) | Dashboard + KB now + render-target stubs for community/course; multi-surface Edge Fn payload from day 1 | ✓ |
| Recommender Edge Fn only, UI deferred | Phase 38 ships AI infra; all UI defers to a follow-on | |

**User's choice:** "All three (dashboard + KB + future-proof)"
**Notes:** Aligns with the user's standing aggressive-foundations preference on user-audience phases (memory: `feedback_aggressive_foundations`, `feedback_regulator_vs_user_audience_pattern`). Cold-start fallback locked at "popular content for <5 events in 14d" (D-02) to avoid zero-shot embedding-on-empty-profile failure mode.

---

## Weekly Claude Digest — Default + PHI Depth

| Option | Description | Selected |
|--------|-------------|----------|
| Opt-IN, sanitized narrative ("4 injections logged") | Conservative; users explicitly opt-in; never names dose/drug/weight | ✓ |
| Opt-OUT, sanitized narrative | Auto-enroll; sanitized only; 1-click unsubscribe | |
| Opt-OUT, full narrative (paid only) | Auto-enroll; paid gets full PHI-bearing narrative; requires PHI-aware send path | |
| Tiered: free=opt-in sanitized; paid=opt-out full; clinic=admin-toggle | Three regimes; per-audience tuned | |

**User's choice:** "Opt-IN, sanitized narrative ('4 injections logged')"
**Notes:** Conservative HIPAA posture for v1 across ALL tiers. Reduces v1 surface area; the tiered PHI-bearing variant is deferred to v1.4 after HIPAA-readiness audit on consumer-side digest pipeline. Auto-pause-after-N-unopened skipped in v1; rely on 1-click unsubscribe.

---

## Win-Back Threshold + Cadence

| Option | Description | Selected |
|--------|-------------|----------|
| Simple: 14d inactive → SAVE "come back"; max 1/30d | Single threshold, no formula | ✓ |
| Formula: score = days-inactive × streak-decline × paywall-dismissals; threshold 50; max 1/14d | RECOMMEND-10 verbatim multi-factor | |
| Two-tier: 7d nudge (in-app); 21d SAVE | Gentle escalation; reduces churn-prompt fatigue | |
| Defer to A/B test — ship 14d, instrument | Ship simplest, A/B tune via Phase 39 trifecta | |

**User's choice:** "Simple: 14d inactive → SAVE 'come back'; max 1/30d"
**Notes:** Win-back channel = email-first via Phase 25 Resend consumer router, with in-app banner on next session for 7 days after send (D-11). RECOMMEND-10 multi-factor formula explicitly deferred to v1.4 once we have 8+ weeks of churn data baseline.

---

## HITL Queue Scope + Auto-Approve

| Option | Description | Selected |
|--------|-------------|----------|
| Single queue, auto-approve KB-sourced recs; super-admin only | One queue, KB-sourced bypass | ✓ |
| Per-type queues; no auto-approve in v1 | Three queues (recommender/digest/win-back); safest, slowest | |
| Single queue; whitelist-only (no LLM-generated action text) | Action enum eliminates 80% of HITL | (combined with selected) |
| Confidence-scored queue: >0.9 auto-approve, 0.6-0.9 queue, <0.6 drop | Per-rec self-rated confidence; calibration unknown v1 | |

**User's choice:** "Single queue, auto-approve KB-sourced recs; super-admin only"
**Notes:** The whitelist-enum approach from option 3 is also adopted (D-15) as a parallel safety layer — Claude digest + recommender NEVER emit free-text actions; if no whitelist match exists, the rec is content-only. Together with KB-sourced auto-approve, this is load-bearing for the FDA SaMD safety posture surfaced in AI-SPEC §1b.

---

## Claude's Discretion

The following were noted in CONTEXT.md `Claude's Discretion` section:
- Exact `vector(1536)` table schema (columns, RLS, constraint shape) — planner picks following Phase 25 RLS conventions + Phase 50 D-28 separate-table pattern.
- HNSW `m` and `ef_construction` parameters — researcher tunes for expected row count.
- User-context vector composition recipe — researcher picks (likely weighted-sum of last-30d event-type embeddings + profile-text embedding); document in `38-RESEARCH.md`.
- Concrete pg_cron schedule expressions — planner uses Phase 25 cron pattern.
- Digest template (HTML/MJML/plain-text) — researcher picks following Phase 49 patterns.
- Sentry instrumentation depth — researcher uses Phase 24 standard patterns.

## Deferred Ideas (full list in CONTEXT.md `<deferred>`)

- PHI-bearing digest variant for paid users (v1.4)
- Multi-factor win-back churn formula (v1.4)
- Per-type HITL queues (v1.4 if volume justifies)
- Auto-pause digest after N unopened (defer)
- LLM-based plan-personalization (v1.4)
- Confidence-scored HITL auto-approve thresholds (v1.4)
- Cohere / Gemini embedding migration (escape hatch only)
- A/B variants of digest/recommender (owned by Phase 39 A/B trifecta)
- Clinic-scoped HITL access (out of scope; v1 is read-only analytics for clinic admins)
