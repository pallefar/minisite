---
phase: 50-admin-curated-rag-knowledge-base-peptide-topic-research-scra
type: carry-over
status: deferred
created: 2026-05-18T20:23:00Z
deferred_to: Phase 51 (preferred — same milestone) OR v1.4 (if scope tightens)
---

# Phase 50 carry-over — Plan 50-09 (D-22 STRETCH wave)

Per Phase 50 CONTEXT D-22 the Wave 4 deliverables (Research newsletter + public `/research` hub + final cost-page polish) are **explicitly deferrable** — they ride on top of the MVP cut (Waves 1-3) and shipping them late does not break any other plan.

## What's deferred

### Plan 50-09 — Research newsletter Edge Fn + public /research hub + RagCostPage polish

D-22 STRETCH bundle:
- `supabase/functions/rag-newsletter-sender/index.ts` + HTML digest template + weekly cron
- `supabase/functions/rag-newsletter-unsubscribe-1click/index.ts`
- `supabase/migrations/<retimestamped>_rag_newsletter_cron.sql` (timestamp needs collision pre-check per [[reference_migration_timestamp_collision_precheck]])
- `src/pages/Research.tsx` + `src/pages/ResearchArticle.tsx` (public /research hub)
- `src/components/research/ResearchHubList.tsx` + `ResearchArticleDetail.tsx`
- `src/components/dashboard/settings/NewsletterSettings.tsx`
- `src/components/admin/rag/RagCostPage.tsx` (vendor cards + auto-pause + acknowledge-and-resume polish)
- 4 vitest specs + 2 Playwright e2e specs

### Vendor dependency

50-09 uses Resend (Phase 25 router) which is gated on Plan 25-03 SES + Resend deployment readiness. No new vendor signup required.

## Why deferred (vs other 50-* plans)

This is the **least load-bearing** wave of Phase 50:

- Wave 1 (50-01..03 — schema + admin shell + event registry): **complete (3/3)**. Required by every later wave.
- Wave 2 (50-04..06 — scrape + summarize + queue): **not started (0/3)**. Required for any chunk to exist.
- Wave 3 (50-07..08 — embeddings + AI Coach citations + Tip-of-day): **not started (0/2)**. The MUST-have user surfaces (D-22 MVP cut).
- Wave 4 (50-09 — newsletter + public Research hub + cost polish): **not started (0/1)**. D-22 STRETCH; can ship independently of Wave 3 if needed (no other plan depends on it).

So 50-09 is the only plan in the phase where deferring causes NO cascade. Waves 2 + 3 are the ones a future session must tackle to ship the actual MVP.

## Unblock plan

### Path A — Phase 51 closeout (preferred per D-22)

Phase 51 (full traffic + conversion tracking system) is the next-discussed phase in v1.3. CONTEXT D-22 explicitly cites Phase 51 as a valid landing spot for 50-09. After Waves 2-3 ship, fold 50-09 into Phase 51's plan list as a closeout addendum.

### Path B — v1.4 closeout

If v1.3 scope tightens further (likely given Phases 34-49 mostly unstarted), promote 50-09 to a v1.4 plan with its own phase number. The newsletter + Research hub then ships as a v1.4 feature.

## Cross-references

- 50-CONTEXT.md D-22 — the wave-boundary deferrability rule that authorized this carry-over
- 50-09-PLAN.md — full task breakdown ready to pick up
- Phase 51 51-CONTEXT.md (if 51 ends up the landing spot) should reference 50-09 in its Depends-on / RFC section
