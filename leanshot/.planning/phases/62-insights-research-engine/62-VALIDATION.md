---
phase: 62-insights-research-engine
generated_from: per-plan <verify><automated> blocks
inline_generated: true
---

# Phase 62 — Validation Matrix

Per [[feedback_validation_md_inline_generation_when_missing]]: materialized inline from each PLAN.md `<verify><automated>` block. Source of truth lives in each PLAN.

## Per-plan automation commands

### 62-01 — DB schema + matviews + consent + queue
```bash
# Task 1: schema migration sanity
grep -E "CREATE POLICY .* IF NOT EXISTS" supabase/migrations/20290102000001_insights_schema.sql | wc -l | grep -q '^0$' \
  && grep -E "research_publication_status|research_publications|research_review_log" supabase/migrations/20290102000001_insights_schema.sql | wc -l \
       | awk '{ if ($1 >= 3) print "OK"; else { print "FAIL"; exit 1 } }'

# Task 2: 5 matviews + 5 unique idx + HAVING k-floor on each
node -e "const f=require('fs').readFileSync('supabase/migrations/20290102000002_insights_matviews.sql','utf8'); \
  const mvs=(f.match(/create materialized view if not exists/gi)||[]).length; \
  const havings=(f.match(/having count\(distinct/gi)||[]).length; \
  const uniqueIdx=(f.match(/create unique index if not exists/gi)||[]).length; \
  if(mvs!==5 || havings<5 || uniqueIdx<5){console.error('matview audit FAIL', {mvs,havings,uniqueIdx}); process.exit(1)} console.log('OK')"

# Task 3: consent + queue + rag_sources source_type
for f in supabase/migrations/20290102000003_research_consent_columns.sql \
         supabase/migrations/20290102000004_pending_rag_ingest_queue.sql \
         supabase/migrations/20290102000005_rag_sources_leanshot_research.sql; do
  test -f "$f" || { echo "MISSING $f"; exit 1; };
done
grep -q "ADD COLUMN IF NOT EXISTS research_consent" supabase/migrations/20290102000003_research_consent_columns.sql
grep -q "tg_enqueue_rag_ingest" supabase/migrations/20290102000004_pending_rag_ingest_queue.sql
grep -q "ADD COLUMN IF NOT EXISTS source_type" supabase/migrations/20290102000005_rag_sources_leanshot_research.sql
grep -q "leanshot_research" supabase/migrations/20290102000005_rag_sources_leanshot_research.sql
```

### 62-02 — SECDEF RPCs + eval suite
```bash
cd leanshot
# RED first (publish-research-self-review test should fail without the RPC migration):
npx vitest run --project=phase62-eval --reporter=verbose
# Expected at end of plan: GREEN
grep -qE "Tests +[1-9][0-9]* passed" /tmp/p62-eval-green.log
! grep -qE "[1-9][0-9]* failed" /tmp/p62-eval-green.log
```

### 62-03 — research-publish Edge Fn + renderer + seed markdown
```bash
cd leanshot
npx vitest run ../supabase/functions/research-publish/__tests__/handler.test.ts
npx vitest run src/lib/markdown/__tests__/research-renderer.test.ts
test -f supabase/functions/research-publish/index.ts
grep -q "if (import.meta.main)" supabase/functions/research-publish/index.ts
test -f ../content/research/tirzepatide-titration-adherence.md
test -f ../content/research/dose-weight-correlation.md
test -f ../content/research/ai-coach-retention-uplift.md
```

### 62-04 — Admin cohort builder UI
```bash
test -f leanshot/src/components/admin/research/ResearchLayout.tsx
test -f leanshot/src/components/admin/research/CohortBuilderForm.tsx
test -f leanshot/src/components/admin/research/CohortBuilderPage.tsx
test -f leanshot/src/components/admin/research/RetentionChart.tsx
test -f leanshot/src/components/admin/research/CrossTabMatrix.tsx
grep -q "key: 'research'" leanshot/src/lib/admin/modules.ts
cd leanshot && npx tsc -p tsconfig.app.json --noEmit
# Typography ceiling enforcement (comment-stripped):
grep -v '^[[:space:]]*//' src/components/admin/research/*.tsx \
  | grep -E "text-base|text-lg|text-md|text-sm|text-xl|text-2xl" | wc -l \
  | awk '{ if ($1 == 0) print "typography-OK"; else { print "typography-FAIL"; exit 1 } }'
```

### 62-05 — Admin publications UI
```bash
test -f leanshot/src/components/admin/research/PublicationsListPage.tsx
test -f leanshot/src/components/admin/research/PublicationEditorPage.tsx
test -f leanshot/src/components/admin/research/ResearchReviewBanner.tsx
test -f leanshot/src/components/admin/research/PublicationStatusBadge.tsx
test -f leanshot/src/components/admin/research/ResearchKeyboardHelpModal.tsx
grep -q "publish_research" leanshot/src/components/admin/research/PublicationEditorPage.tsx
grep -q "submit_research_for_review" leanshot/src/components/admin/research/PublicationEditorPage.tsx
grep -q "SELF_REVIEW_REJECTED" leanshot/src/components/admin/research/PublicationEditorPage.tsx
cd leanshot && npx tsc -p tsconfig.app.json --noEmit
```

### 62-06 — Public /research/* hub
```bash
test -f leanshot/src/components/research/ResearchRoute.tsx
test -f leanshot/src/components/research/ResearchIndexPage.tsx
test -f leanshot/src/components/research/ResearchArticlePage.tsx
test -f leanshot/src/components/research/ResearchNotFound.tsx
test -f leanshot/src/components/research/DpMethodsFooter.tsx
grep -q "startsWith('/research')" leanshot/src/App.tsx
grep -q "ScholarlyArticle" leanshot/src/components/research/ResearchArticlePage.tsx
# RSS / sitemap scripts:
test -f leanshot/scripts/build-research-rss.mjs
test -f leanshot/scripts/build-research-sitemap.mjs
grep -q "build-research-rss" leanshot/vite.config.ts
# @theme tokens audit:
for tok in color-bg color-surface color-primary color-warning color-surface-elevated color-rose-soft color-border color-text color-text-secondary color-text-tertiary color-admin-table-row-hover; do
  grep -q "$tok" leanshot/src/index.css || { echo "MISSING TOKEN $tok"; exit 1; };
done
cd leanshot && npx vitest run src/lib/research/__tests__/rss.test.ts
cd leanshot && npx tsc -p tsconfig.app.json --noEmit
```

### 62-07 — Settings research-consent toggle
```bash
test -f leanshot/src/components/dashboard/settings/ResearchConsentSection.tsx
grep -q "Revoke research consent" leanshot/src/components/dashboard/settings/ResearchConsentSection.tsx
grep -q "within 24 hours" leanshot/src/components/dashboard/settings/ResearchConsentSection.tsx
grep -q "ResearchConsentSection" leanshot/src/components/dashboard/settings/SettingsPage.tsx
grep -q "research-consent" leanshot/src/components/dashboard/settings/SettingsPage.tsx
cd leanshot && npx vitest run src/components/dashboard/settings/__tests__/ResearchConsentSection.test.tsx
cd leanshot && npx tsc -p tsconfig.app.json --noEmit
```

### 62-08 — Close-out: db push + Fn deploy + cron + docs
```bash
# Fn deployed
supabase functions list --project-ref ytnsipxxmzgaebkqmokp | grep -q "research-publish"

# Migrations applied
supabase migration list --linked | grep -q "20290102000099"
supabase migration list --linked | grep -q "20290102000006"

# Eval + tsc + build green
cd leanshot
npx vitest run --project=phase62-eval
npx tsc -p tsconfig.app.json --noEmit
npm run build 2>&1 | tail -10

# Doc state
grep -E "^- \[x\] 62-0[1-8]-PLAN" leanshot/.planning/ROADMAP.md | wc -l \
  | awk '{ if ($1 == 8) print "ROADMAP-OK"; else { print "ROADMAP-FAIL count=" $1; exit 1 } }'
grep -E "^- \[x\] \*\*INSIGHTS-(01|02|03|04|05|06|07|08|09|10)\*\*" leanshot/.planning/REQUIREMENTS.md | wc -l \
  | awk '{ if ($1 == 10) print "REQ-OK"; else { print "REQ-FAIL count=" $1; exit 1 } }'
test -f leanshot/.planning/phases/62-insights-research-engine/62-SUMMARY.md
test -f leanshot/.planning/phases/62-insights-research-engine/62-CARRY-OVER.md
```

## Cross-plan Phase 62 invariants (run before merging Wave 2)

```bash
# 1) No PHI columns in matview SELECT lists (comment-stripped)
grep -v '^[[:space:]]*--' supabase/migrations/20290102000002_insights_matviews.sql \
  | grep -E "\bemail\b|\bphone\b|\baddress\b" | grep -vE "count\(distinct|join |where |group by |on p\." | wc -l \
  | awk '{ if ($1 == 0) print "PHI-OK"; else { print "PHI-FAIL count=" $1; exit 1 } }'

# 2) 2-person rule literal substring exists in DB + UI
grep -q "SELF_REVIEW_REJECTED" supabase/migrations/20290102000006_insights_secdef_rpcs.sql
grep -q "SELF_REVIEW_REJECTED" leanshot/src/components/admin/research/PublicationEditorPage.tsx

# 3) Bare CREATE POLICY (no IF NOT EXISTS) across all Phase 62 migrations
! grep -rE "CREATE POLICY .* IF NOT EXISTS" supabase/migrations/20290102*.sql

# 4) Forward-dated timestamps only
ls supabase/migrations/20290102*.sql | grep -q "20290102" && \
  ! ls supabase/migrations/20290102*.sql | grep -E "^.*20290101"

# 5) No current_setting('app.service_role_key') anywhere (vault pattern only if needed)
! grep -r "current_setting('app.service_role_key')" supabase/migrations/20290102*.sql

# 6) Edge Fn handler/index split intact
grep -q "if (import.meta.main)" supabase/functions/research-publish/index.ts
! grep -q "Deno\.serve" supabase/functions/research-publish/handler.ts

# 7) Typography ceiling across all research surfaces
grep -v '^[[:space:]]*//' \
  leanshot/src/components/admin/research/*.tsx \
  leanshot/src/components/research/*.tsx \
  leanshot/src/components/dashboard/settings/ResearchConsentSection.tsx \
  | grep -E "text-base|text-lg|text-md|text-sm|text-xl|text-2xl" | wc -l \
  | awk '{ if ($1 == 0) print "typography-OK"; else { print "typography-FAIL"; exit 1 } }'

# 8) INSIGHTS-09 RAG feedback loop delivery — source-level + runtime
#    Source-level: publish_research body MUST INSERT into rag_chunks (not just enqueue pending_rag_ingest)
grep -qi "insert into public.rag_chunks" supabase/migrations/20290102000006_insights_secdef_rpcs.sql
grep -qi "source_type *= *'leanshot_research'" supabase/migrations/20290102000006_insights_secdef_rpcs.sql
grep -qi "tag *= *'leanshot_research'" supabase/migrations/20290102000006_insights_secdef_rpcs.sql
grep -qi "insert into public.rag_topics" supabase/migrations/20290102000006_insights_secdef_rpcs.sql
grep -qi "alter table public.research_publications add column if not exists markdown_body" supabase/migrations/20290102000006_insights_secdef_rpcs.sql

# 8b) Runtime (close-out 62-08 after seed): expect ≥1 rag_chunks row for the leanshot_research source
#    Run as part of 62-08 Task 2 close-out via psql or supabase db remote query:
#    psql "$SUPABASE_DB_URL" -tAc "select count(*) from public.rag_chunks where source_id = (select id from public.rag_sources where source_type = 'leanshot_research') and status = 'approved' and topic_tag = 'leanshot_research'" \
#      | awk '{ if ($1 >= 1) print "rag-delivery-OK"; else { print "rag-delivery-FAIL count=" $1; exit 1 } }'
#    Notes (schema-accurate per supabase/migrations/20260519000003_rag_chunks_table.sql):
#    - rag_chunks columns are: topic_id (FK NOT NULL), source_id (FK NOT NULL), canonical_url, source_text_excerpt, summary, content_hash, topic_tag, source_tier, status (default queued).
#    - publish_research RPC sets status='approved' AND topic_tag='leanshot_research' so this filter is sufficient.
#    - Phase 60 rag-embed-approved cron picks via published_at IS NULL filter (per supabase/functions/rag-embed-approved/handler.ts:128); embedding population is deferred to next cron fire (Phase 70 UAT confirmation).
```

## Requirements → automation map

| REQ | Verifier | Plans |
|-----|----------|-------|
| INSIGHTS-01 (k-anonymity) | eval/phase62/no-phi-in-matviews + SELF_REVIEW grep + matview HAVING audit | 62-01, 62-02 |
| INSIGHTS-02 (Laplace DP) | eval/phase62/laplace-noise + RPC body grep for `LN(` + `gen_random_uuid` | 62-02 |
| INSIGHTS-03 (matview zero-PHI) | grep-comment-stripped check 1 above + node matview count audit | 62-01 |
| INSIGHTS-04 (week binning) | grep `date_trunc('week'` in matview migration | 62-01 |
| INSIGHTS-05 (consent opt-in + revoke) | eval consent-schema + SettingsPage NAV grep + ResearchConsentSection tests | 62-01, 62-07 |
| INSIGHTS-06 (admin dashboard) | tsc + grep `compile_research_cohort` in CohortBuilderForm | 62-04 |
| INSIGHTS-07 (white paper 2-person) | eval publish-research-self-review + EditorPage grep | 62-02, 62-05 |
| INSIGHTS-08 (public hub + SEO + RSS) | grep ScholarlyArticle + sitemap script + rss.xml smoke | 62-06 |
| INSIGHTS-09 (RAG feedback loop) | rag_chunks INSERT inside publish_research body (grep) + post-seed rag_chunks count for source_type=leanshot_research (≥1) | 62-01, 62-02, 62-08 |
| INSIGHTS-10 (HIPAA — no PHI) | INSIGHTS-01 stack + SECDEF guards + CI grep gate | 62-01, 62-02 |

## Sampling rate

- Per plan commit: `npx vitest run --project=phase62-eval` from leanshot/
- Per wave merge: `cd leanshot && npx vitest run --project=phase62-eval && npx tsc -p tsconfig.app.json --noEmit`
- Phase gate (62-08): full eval suite + `supabase migration list --linked` + dev-server curl smoke + ROADMAP/STATE/REQUIREMENTS audit

## Deferred to Phase 70 UAT

(per [[feedback_milestone_uat_deferral_consolidation]] + UI-SPEC §accessibility baseline)
- Visual /admin/research/cohort + Publications + Editor walkthrough
- Visual /research/ + /research/<slug> on real device
- Real-data k_floor test (run cohort with <5 users matching filters)
- First scheduled cron fire (02:00 UTC + 01:00 UTC) confirmation
- RAG embedding population end-to-end (rag_chunks rows with source_type='leanshot_research' get `embedding` populated by Phase 60 rag-embed-approved cron on next fire — runtime confirmation; the INSERT itself is verified at close-out via the SQL count below)
- OG card render via @vercel/og (deferred — Plan 62-06 leaves OG image generation out of scope; can be added in Phase 70 if needed)

## Source

Inline-generated from per-plan `<verify><automated>` blocks; no separate researcher invocation per [[feedback_validation_md_inline_generation_when_missing]] (~3k tokens vs ~200k for full re-research).
