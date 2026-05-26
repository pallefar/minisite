# Phase 62: Insights & Research Engine — Research

**Researched:** 2026-05-26
**Domain:** PostgreSQL k-anonymity / differential privacy, matview rollups, white-paper publishing pipeline, public SPA routes, RAG feedback loop
**Confidence:** HIGH (all architecture decisions from verified CONTEXT.md; implementation patterns from inspected codebase)

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Privacy Mechanics (Area 1)**
- K-anonymity (DB-layer enforcement): SECDEF RPC `compile_research_cohort(filters)` counts cohort first; returns `{suppressed: true, reason: 'k_floor'}` BEFORE materializing rollup when `cohort_size < 5`. Underlying matview SELECT filters `having count(distinct user_id) >= 5`. Defense-in-depth: client UI also displays suppressed banner; never trusts only client.
- Differential privacy (DB-layer Laplace): Custom PL/pgSQL function `public.laplace_noise(value numeric, epsilon numeric)` using `gen_random_uuid` + `ln()` transform. NO npm dependency. Two epsilon profiles per INSIGHTS-02:
  - Admin output: `epsilon = 1.0` (looser; admin can see closer to truth)
  - Public publication output: `epsilon = 0.5` (tighter; protects against re-identification)
- Revoke-consent cron: Nightly 01:00 UTC `purge_research_data_for_revoked()` SECDEF — finds `profiles WHERE research_consent=false AND last_purged_at < consent_revoked_at`, deletes from every `insights_*_source` source table. Matviews refresh on next 02:00 UTC cron. 30-day SLA met with ~24h actual.
- CI PHI-leak gate: `eval/phase62/no-phi-in-matviews.test.ts` — source-level grep + runtime column check.
- Vault-bearer pattern for cron: `(SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='service_role_key')` per `reference_supabase_pg_cron_vault_service_role_pattern`.

**Admin Dashboard + White-Paper + Public Hub + RAG Feedback (Area 2)**
- `/admin/research` cohort builder: Mirror `/admin/protocols` Layout from Phase 61 + `AdminVendorSmokeDashboard.tsx` shell pattern from Phase 60.5.
- No new chart library. Chart.js 4.4.6 + BaseChart.tsx already in package.json.
- White-paper pipeline: Source: `content/research/*.md`. Renderer: Edge Fn `research-publish` invokes `markdown-it` (npm: import in Deno). NO mdx-bundler. Storage: `research_publications` table.
- 2-person review SECDEF: `publish_research(publication_id)` mirrors `publish_protocol` shape verbatim — rejects when `actor=created_by` with `SELF_REVIEW_REJECTED`.
- OG card: `@vercel/og` (already in dependencies at ^0.11.1).
- NO dedicated PDF library in MVP. HTML print stylesheet only.
- Public `/research/<slug>` route — mirror Phase 60-13 `/knowledge/*` verbatim. JSON-LD `ScholarlyArticle` schema (NOT `MedicalWebPage`). Public, no auth-wall, robots=index.
- RAG feedback loop: On `research_publications.status='published'` trigger → INSERT into `pending_rag_ingest(publication_id, queued_at)` queue table. Existing Phase 60 ingest cron polls + chunks ingested with `source_type='leanshot_research'`, `tier='A'`.
- Profile consent UI: Settings page toggle. Default `false` (opt-in only per HIPAA Privacy Rule §164.508).

### Claude's Discretion
- Exact matview column names (must match underlying source tables; planner will discover at execution).
- Tenure-bucket SQL implementation (`age(now(), profile.created_at)` cases).
- Cross-tab matrix UI layout (HTML table with `Table.tsx` primitive from `src/components/ui/`).
- Specific PostHog event names (`research_cohort_compiled`, `research_published`).
- Migration filename timestamps — use `20290102000001+` (following Phase 61's `20290101*` cluster).
- RSS feed pubDate format (RFC 822 standard).

### Deferred Ideas (OUT OF SCOPE)
- Dedicated PDF generator (`@react-pdf/renderer` / `wkhtmltopdf`) — defer to v1.5 if requested
- AI-generated paper drafts (admin AI-assist) — defer to v1.5
- Interactive per-paper data viz (D3.js drilldown charts) — defer to v1.5
- Per-paper comment threads / peer review — defer to v1.5
- Multi-author bylines — single reviewer per paper in MVP; co-authorship in v1.5
- Hourly matview refresh (currently daily; revisit when admin volume warrants)
- Spanish localization of research blog — defer to v1.5 contractor expansion
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| INSIGHTS-01 | K-anonymity (k≥5) enforced on every aggregate rollup view; cohorts <5 returned as `<suppressed>` | SECDEF RPC compile_research_cohort + HAVING clause on matview + 3-layer invariant pattern |
| INSIGHTS-02 | Differential privacy Laplace-noise injection for cohorts 5-50; epsilon configurable per output surface | Custom PL/pgSQL laplace_noise() function — no extension needed; 1.0 admin / 0.5 public |
| INSIGHTS-03 | 5 aggregate rollup matviews; ZERO PHI columns | Week-bin date aggregation over injections/weights/profiles/community_engagement/ai_messages |
| INSIGHTS-04 | Date binning to week-level for all metric rollups | `date_trunc('week', ...)` PostgreSQL function; no day-level public output |
| INSIGHTS-05 | Explicit opt-in `profiles.research_consent BOOLEAN DEFAULT false`; revoke triggers drop within 30 days | ALTER TABLE add column + nightly purge cron + SECDEF |
| INSIGHTS-06 | Admin research dashboard at `/admin/research` — cohort builder + cross-tab + retention curves | Chart.js BaseChart.tsx reuse; ProtocolsLayout mirror |
| INSIGHTS-07 | White-paper publishing pipeline — markdown-source + reviewer approval (2-person per PROTOCOL-04 pattern) | research_publications table + publish_research SECDEF mirroring publish_protocol exactly |
| INSIGHTS-08 | Public research blog at `/research/*` — SEO + sitemap + RSS feed | Mirror KnowledgeArticleDetailPage.tsx architecture verbatim |
| INSIGHTS-09 | RAG feedback loop — published white papers auto-ingested as source_type='leanshot_research' | pending_rag_ingest queue + Phase 60 rag-embed-approved cron reuse |
| INSIGHTS-10 | HIPAA compliance — aggregate-only output; no PHI leaves rollup view; compile_research_cohort rejects k-floor violations | Same as INSIGHTS-01 + CI grep gate on matview SQL + runtime column check |
</phase_requirements>

---

## Summary

Phase 62 builds the Insights & Research Engine: a privacy-preserving aggregate analytics pipeline, white-paper authoring + publishing workflow, a public scholarly research hub, and a RAG feedback loop that closes the Phase 60 knowledge-base cycle. The data layer is entirely PostgreSQL-native: materialized views over existing tables (injections, weights, profiles, community_engagement, ai_messages), a custom PL/pgSQL Laplace noise function, and a SECDEF RPC enforcing k-anonymity before any cohort output leaves the database.

All six UI surfaces (admin cohort builder, admin publications list, publication editor, public research index, public article page, settings consent toggle) have detailed specifications in 62-UI-SPEC.md and mirror established Phase 60/61 component patterns. The planner can skip UI design research and copy component structure directly from the analogs listed in the Component Inventory table.

The RAG feedback loop is asynchronous: publish event → `pending_rag_ingest` INSERT → existing Phase 60 cron reads queue → chunks the published markdown → embeds via `rag-embed-approved` → stores in `rag_chunks` with `source_type='leanshot_research'` and `tier='A'`. No new ingestion infrastructure is needed beyond the queue table and a trigger.

**Primary recommendation:** Plan in five waves — Wave 0 (DB schema: matviews + consent + queue + publications tables + cron); Wave 1 (SECDEF RPCs: compile_research_cohort + publish_research + purge); Wave 2 (research-publish Edge Fn + CI PHI gate); Wave 3 (admin UI: ResearchLayout + CohortBuilderForm + PublicationsListPage + PublicationEditorPage); Wave 4 (public /research/* SPA routes + sitemap + RSS + Settings consent toggle + close-out).

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| K-anonymity enforcement | Database (SECDEF RPC) | Client UI (warning banner) | k-floor is a data-layer invariant; client is defense-in-depth only |
| Differential privacy noise | Database (PL/pgSQL function) | — | All noise applied in DB before any data surfaces to API or client |
| Matview rollup refresh | Database (pg_cron) | — | Daily 02:00 UTC cron; no application-layer scheduling |
| Consent revocation purge | Database (SECDEF + pg_cron) | — | Nightly 01:00 UTC; must run without user session |
| Cohort builder form | Frontend (SPA admin) | Database (SECDEF RPC) | Admin-only; React reads from SECDEF RPC response |
| Retention curve rendering | Frontend (Chart.js BaseChart.tsx) | — | Already in bundle; stacked-area chart config |
| White-paper authoring | Frontend (admin editor) + Database | — | Markdown-path form + SECDEF state machine |
| Paper rendering (public) | Frontend (SPA client-render) | Edge Fn (markdown-it) | Vite SPA mirrors /knowledge/* architecture |
| SEO / JSON-LD / sitemap | Frontend (react-helmet-async) | Build-time (sitemap.xml extension) | Same as Phase 60-13 pattern |
| RAG ingest trigger | Database (trigger + pending_rag_ingest) | Phase 60 Edge Fn (rag-embed-approved) | Asynchronous queue; existing cron reads it |
| Research consent toggle | Frontend (Settings page) + Database | — | ALTER profiles + SECDEF update |
| PHI-leak CI gate | Test harness (eval/phase62/) | — | Source-level grep + runtime DB column check |

---

## Standard Stack

### Core — DB Layer
| Library / Pattern | Version / Form | Purpose | Why Standard |
|---|---|---|---|
| PostgreSQL materialized views | PG 15 (Supabase) | Aggregate rollup snapshots | Already in infra; REFRESH CONCURRENTLY available |
| PL/pgSQL SECURITY DEFINER | PG built-in | k-floor + noise + purge RPCs | Project invariant — every sensitive write is SECDEF |
| pg_cron | Extension (already enabled) | Daily matview refresh + nightly purge | Phase 60 cluster precedent; 7 jobs already registered |
| `gen_random_uuid()` | PG built-in (pgcrypto) | Laplace noise seed (via `encode(gen_random_uuid()::bytea, 'hex')`) | No external dependency |
| `date_trunc('week', ...)` | PG built-in | Week-level date binning (INSIGHTS-04) | Standard SQL; no extension |

### Core — Frontend
| Library | Version | Purpose | Why Standard |
|---|---|---|---|
| chart.js | 4.4.6 (in package.json) | Retention curves + cross-tab charts | Already in bundle; BaseChart.tsx wrapper exists |
| react-helmet-async | 2.0.5 (in package.json) | SEO meta/title/canonical on /research/* | Already used by Phase 60-13 /knowledge/* |
| react-markdown | 9.0.0 (in package.json) | Render publication body markdown | Already used by KnowledgeArticleDetailPage.tsx |
| dompurify | 3.2.0 (in package.json) | XSS sanitization of rendered markdown | Already used by sanitizeRagMarkdown helper |
| remark-gfm | 4.0.1 (in package.json) | GitHub-flavored markdown extensions | Already used with react-markdown |
| @vercel/og | 0.11.1 (in package.json) | OG share card generation | Already used by Phase 60-13 /knowledge/* |

### Core — Edge Functions
| Library | Version | Purpose | Why Standard |
|---|---|---|---|
| markdown-it | 14.2.0 (npm registry) | Markdown → HTML in research-publish Edge Fn | Lightweight; Deno-native via `npm:` specifier; no mdx-bundler overhead |
| @supabase/supabase-js@2 | ^2.105 (in deno.json pattern) | DB writes in Edge Fn | Standard project pattern |
| zod | ^3 (in deno.json pattern) | Input validation | Standard project pattern |

### Supporting
| Library | Version | Purpose | When to Use |
|---|---|---|---|
| framer-motion | 11.11.17 (in package.json) | Sheet/modal animations on admin surfaces | Inherited from DS primitives (Sheet, Modal) |
| lucide-react | 0.460.0 (in package.json) | All icons (AlertTriangle, FlaskConical, FileText, etc.) | Project icon standard |
| react-router-dom | (in package.json) | `/research/*` and `/admin/research` routing | Admin surfaces use react-router; consumer SPA uses Zustand TabId pattern |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Custom PL/pgSQL laplace_noise() | PostgreSQL `tablefunc` extension or external DP library | Extension may not be available on Supabase; custom function is auditable and zero-dep |
| markdown-it in Edge Fn | unified/remark in Edge Fn | remark ecosystem is heavier; markdown-it compiles markdown to HTML directly, simpler for Deno |
| Phase 60 rag-embed-approved cron reuse | New dedicated research ingestion Fn | Reuse avoids duplicating chunker/embedder logic; queue table decouples timing |

**Installation (new packages only — markdown-it for Edge Fn deno.json):**
```bash
# markdown-it is imported via deno.json imports map in research-publish Fn — no npm install needed:
# "npm:markdown-it@14": "npm:markdown-it@^14"
# All other packages are already in package.json
```

**Version verification:**
```bash
npm view markdown-it version      # → 14.2.0 (verified 2026-05-26)
npm view chart.js version         # → 4.5.1 (package.json pins 4.4.6)
npm view react-helmet-async version # → 3.0.0 (package.json pins 2.0.5)
npm view @vercel/og version       # → 0.11.1 (matches package.json)
```

---

## Package Legitimacy Audit

> slopcheck was not available at research time. All packages tagged [ASSUMED] based on registry verification only. The planner must gate each NEW package install behind a `checkpoint:human-verify` task.

| Package | Registry | Age | Downloads | Source Repo | slopcheck | Disposition |
|---------|----------|-----|-----------|-------------|-----------|-------------|
| markdown-it | npm | ~11 yrs | Very high (industry standard) | github.com/markdown-it/markdown-it | [ASSUMED] | Flagged — verify before use in Edge Fn |
| chart.js | npm | Already in package.json 4.4.6 | Very high | github.com/chartjs/Chart.js | [ASSUMED] | Already approved — in use |
| react-helmet-async | npm | Already in package.json 2.0.5 | High | github.com/staylor/react-helmet-async | [ASSUMED] | Already approved — in use |
| react-markdown | npm | Already in package.json 9.0.0 | Very high | github.com/remarkjs/react-markdown | [ASSUMED] | Already approved — in use |
| @vercel/og | npm | Already in package.json 0.11.1 | High | github.com/vercel/og | [ASSUMED] | Already approved — in use |
| dompurify | npm | Already in package.json 3.2.0 | Very high | github.com/cure53/DOMPurify | [ASSUMED] | Already approved — in use |

**Packages removed due to slopcheck [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none detected, but [ASSUMED] applies to markdown-it since slopcheck unavailable.

**Note:** Only `markdown-it` is a NEW package (Edge Fn deno.json only). All others are already in the project package.json and have been shipping in production.

---

## Architecture Patterns

### System Architecture Diagram

```
User Settings toggle ──→ profiles.research_consent = true / false
                                │
                                ├─→ [OFF] consent_revoked_at = now()
                                │          │
                                │          ↓ 01:00 UTC cron
                                │   purge_research_data_for_revoked() SECDEF
                                │          │
                                │          ↓ deletes from insights_* source tables
                                │
Admin /admin/research ──────→ CohortBuilderForm
        │                          │
        │              compile_research_cohort(filters) SECDEF
        │                          │
        │                    count cohort_size?
        │                     ├─ < 5 → {suppressed: true, reason: 'k_floor'}
        │                     └─ >= 5 → SELECT from insights_*_rollup matviews
        │                               + laplace_noise(value, epsilon=1.0)
        │                               → JSON cohort data
        │                          │
        │              BaseChart.tsx (retention curves, stacked-area)
        │              CrossTabMatrix.tsx (Table.tsx DS primitive)
        │
Admin Publication Editor ──→ content/research/*.md (git-versioned)
        │              submit_protocol_for_review / publish_research SECDEF
        │              (2-person rule: SELF_REVIEW_REJECTED if actor = created_by)
        │                          │
        │              research_publications.status = 'published'
        │                          │
        │                   DB trigger INSERT pending_rag_ingest
        │                          │
        │              [Phase 60 rag-embed-approved cron reads queue]
        │                          │
        │              rag_chunks INSERT (source_type='leanshot_research', tier='A',
        │                                 status='approved' — skips review)
        │
Public /research/<slug> ──→ ResearchArticlePage.tsx
        │                     react-helmet-async (ScholarlyArticle JSON-LD)
        │                     ReactMarkdown + DOMPurify
        │                     DpMethodsFooter (epsilon=0.5, cohortSize, suppressedBuckets)
        │                     @vercel/og (OG share card)
        │
Daily 02:00 UTC cron ──→ REFRESH MATERIALIZED VIEW insights_dose_rollup CONCURRENTLY
                          REFRESH MATERIALIZED VIEW insights_body_metrics_rollup CONCURRENTLY
                          REFRESH MATERIALIZED VIEW insights_retention_rollup CONCURRENTLY
                          REFRESH MATERIALIZED VIEW insights_engagement_rollup CONCURRENTLY
                          REFRESH MATERIALIZED VIEW insights_ai_interaction_rollup CONCURRENTLY
```

### Recommended Project Structure

```
supabase/migrations/
├── 20290102000001_insights_matviews.sql           # 5 matviews + laplace_noise() function
├── 20290102000002_insights_secdef_rpcs.sql        # compile_research_cohort + publish_research + purge
├── 20290102000003_research_publications_tables.sql # research_publications + research_review_log + pending_rag_ingest
├── 20290102000004_profiles_research_consent.sql   # ALTER profiles add research_consent + revoked_at + last_purged_at
├── 20290102000005_rag_sources_leanshot_research.sql # ALTER rag_sources add source_type IF NOT EXISTS + seed row
└── 20290102000099_insights_cron_schedules.sql     # pg_cron: matview refresh + purge + (deploy Fns FIRST)

supabase/functions/
└── research-publish/
    ├── deno.json                                  # npm:markdown-it@14 import
    ├── index.ts                                   # Deno.serve() entry
    └── handler.ts                                 # handler.ts/index.ts split (Deno test trap pattern)

content/research/                                  # git-versioned markdown sources
├── tirzepatide-titration-adherence.md
├── dose-weight-correlation.md
└── ai-coach-retention-uplift.md

eval/phase62/                                      # CI grep + runtime PHI gate (at git root)
└── no-phi-in-matviews.test.ts

src/components/
├── admin/research/
│   ├── ResearchLayout.tsx                         # Mirror ProtocolsLayout.tsx
│   ├── ResearchCohortPage.tsx
│   ├── CohortBuilderForm.tsx
│   ├── RetentionCurveChart.tsx                    # Thin BaseChart.tsx wrapper
│   ├── CrossTabMatrix.tsx
│   ├── PublicationsListPage.tsx                   # Mirror ProtocolsListPage.tsx
│   ├── PublicationEditorPage.tsx                  # Mirror ProtocolEditorPage.tsx
│   ├── PublicationStatusBadge.tsx
│   ├── ResearchReviewBanner.tsx                   # Mirror ProtocolReviewBanner.tsx
│   └── ResearchKeyboardHelpModal.tsx
├── research/                                      # Public /research/* hub
│   ├── ResearchRoute.tsx                          # Mirror KnowledgeRoute.tsx
│   ├── ResearchIndexPage.tsx                      # Mirror KnowledgeRootPage.tsx
│   ├── ResearchArticlePage.tsx                    # Mirror KnowledgeArticleDetailPage.tsx
│   ├── ResearchNotFound.tsx
│   └── DpMethodsFooter.tsx                        # Mandatory DP disclosure
└── dashboard/settings/
    └── ResearchConsentSection.tsx
```

### Pattern 1: SECDEF RPC compile_research_cohort

**What:** K-anonymity gate + Laplace noise injection for cohort queries
**When to use:** Every cohort compilation call from the admin dashboard

```sql
-- Source: Phase 62 CONTEXT.md decisions + Phase 61 publish_protocol pattern
CREATE OR REPLACE FUNCTION public.compile_research_cohort(
  p_filters jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_catalog
AS $$
DECLARE
  v_cohort_size int;
  v_epsilon     numeric := 1.0; -- admin output
BEGIN
  IF NOT public.is_staff() THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;

  -- Count BEFORE materializing (k-floor gate)
  SELECT COUNT(DISTINCT user_id)
  INTO   v_cohort_size
  FROM   insights_dose_rollup
  WHERE  /* apply p_filters compound/tenure/audience */
         1=1;

  IF v_cohort_size < 5 THEN
    RETURN jsonb_build_object('suppressed', true, 'reason', 'k_floor');
  END IF;

  -- Materialize with Laplace noise (admin epsilon=1.0)
  RETURN jsonb_build_object(
    'suppressed', false,
    'cohort_size', v_cohort_size,
    'epsilon', v_epsilon,
    'data', (
      SELECT jsonb_agg(row_to_json(r))
      FROM (
        SELECT week_bin,
               public.laplace_noise(avg_dose_mg, v_epsilon) AS avg_dose_mg,
               public.laplace_noise(retention_30d, v_epsilon) AS retention_30d
        FROM insights_dose_rollup
        WHERE /* filters */
        ORDER BY week_bin
      ) r
    )
  );
END;
$$;
```

### Pattern 2: Custom PL/pgSQL Laplace Noise Function

**What:** Differential privacy noise via Laplace mechanism — NO external dependency
**When to use:** Every numeric value returned from matview that goes to admin or public output

```sql
-- Source: Phase 62 CONTEXT.md decisions
-- Laplace mechanism: draw from Laplace(0, 1/epsilon) distribution
-- Using Box-Muller-style inversion via uniform random from gen_random_uuid()
CREATE OR REPLACE FUNCTION public.laplace_noise(
  value   numeric,
  epsilon numeric
)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  u  numeric;
  b  numeric;
BEGIN
  -- Draw uniform random from (0,1) via gen_random_uuid() entropy
  u := (('x' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8))::bit(32)::int::float8
        / 2147483647.0 + 1.0) / 2.0;

  -- Laplace scale parameter b = 1/epsilon (sensitivity assumed = 1)
  b := 1.0 / NULLIF(epsilon, 0);

  -- Laplace CDF inversion: L = -b * sign(u - 0.5) * ln(1 - 2 * |u - 0.5|)
  RETURN value + (-b * SIGN(u - 0.5) * LN(1.0 - 2.0 * ABS(u - 0.5)));
END;
$$;
```

### Pattern 3: Matview Definition (Zero PHI)

**What:** Week-binned aggregate rollup — zero PHI columns
**When to use:** All 5 insights matviews follow this shape

```sql
-- Source: Phase 62 CONTEXT.md + INSIGHTS-03/04
-- ZERO PHI: no user_id, email, phone, address column allowed
CREATE MATERIALIZED VIEW public.insights_dose_rollup AS
SELECT
  date_trunc('week', i.injected_at)    AS week_bin,
  i.medication_id                      AS compound,
  p.goal_type                          AS audience_segment,
  CASE
    WHEN age(now(), p.created_at) < interval '3 months' THEN '<3m'
    WHEN age(now(), p.created_at) < interval '6 months' THEN '3-6m'
    WHEN age(now(), p.created_at) < interval '12 months' THEN '6-12m'
    ELSE '12m+'
  END                                  AS tenure_bucket,
  COUNT(DISTINCT i.user_id)            AS cohort_n,  -- k-floor HAVING guard
  AVG(i.dose_mg)                       AS avg_dose_mg,
  STDDEV(i.dose_mg)                    AS stddev_dose_mg,
  COUNT(i.id)                          AS injection_count
FROM public.injections i
JOIN public.profiles p ON p.id = i.user_id
WHERE p.research_consent = true
GROUP BY 1, 2, 3, 4
HAVING COUNT(DISTINCT i.user_id) >= 5  -- INSIGHTS-01 k-floor
WITH NO DATA;

-- CI gate: grep -E "user_id|email|phone|address" on this file MUST return zero matches
-- (run by eval/phase62/no-phi-in-matviews.test.ts)
```

### Pattern 4: publish_research SECDEF (mirror publish_protocol)

**What:** 2-person review for white papers; SELF_REVIEW_REJECTED
**When to use:** Reviewer publishes a paper that a different admin submitted

```sql
-- Source: Phase 61 20290101000002_protocol_secdef_rpcs.sql publish_protocol shape — mirror verbatim
CREATE OR REPLACE FUNCTION public.publish_research(
  p_publication_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_catalog
AS $$
DECLARE
  v_created_by uuid;
  v_status     text;
BEGIN
  IF NOT public.is_staff() THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;

  SELECT created_by, status
  INTO   v_created_by, v_status
  FROM   public.research_publications
  WHERE  id = p_publication_id
  FOR    UPDATE;  -- T-62-02 row lock

  IF NOT FOUND THEN
    RAISE EXCEPTION 'publication % not found', p_publication_id;
  END IF;

  -- 2-person rule (mirrors publish_protocol T-61-02-01)
  IF v_created_by IS NOT NULL AND v_created_by = auth.uid() THEN
    RAISE EXCEPTION 'SELF_REVIEW_REJECTED: publisher (%) cannot equal creator (%)',
      auth.uid(), v_created_by
      USING ERRCODE = '42501';
  END IF;

  IF v_status <> 'in_review' THEN
    RAISE EXCEPTION 'cannot publish research in status %', v_status;
  END IF;

  UPDATE public.research_publications
  SET    status       = 'published',
         published_at  = now(),
         reviewer_id   = auth.uid(),
         updated_at    = now()
  WHERE  id = p_publication_id;

  -- Audit write
  INSERT INTO public.research_review_log (publication_id, actor, action)
  VALUES (p_publication_id, auth.uid(), 'published');

  -- RAG feedback loop: queue for ingestion
  INSERT INTO public.pending_rag_ingest (publication_id, queued_at)
  VALUES (p_publication_id, now())
  ON CONFLICT DO NOTHING;
END;
$$;
```

### Pattern 5: App.tsx Route Registration for /research/*

**What:** Add /research/* route branch — mirrors Phase 60-13 /knowledge/* pattern
**When to use:** ResearchRoute.tsx lazy-loaded before marketing fallback

```typescript
// Source: App.tsx lines 700-706 (Phase 60-13 /knowledge/* pattern — mirror verbatim)
// Add at line 706 position, AFTER /knowledge/* and BEFORE /protocols/*:
if (opts.pathname.startsWith('/research')) return 'research';

// Add to TabId union (line 638+):
| 'research'

// Add lazy import (after KnowledgeRoute import):
const ResearchRoute = lazy(() => import('@/components/research/ResearchRoute'));

// Add view render (after 'knowledge' branch in view switch):
if (view === 'research') {
  return (
    <HelmetProvider>
      <ResearchRoute />
    </HelmetProvider>
  );
}
```

### Pattern 6: handler.ts / index.ts Split for research-publish Edge Fn

**What:** Separate Deno.serve() from handler logic for Vitest testability
**When to use:** Mandatory per `reference_deno_test_top_level_serve_trap`

```typescript
// Source: supabase/functions/rag-embed-approved/handler.ts pattern (Phase 60-05 D-60-05-01)
// handler.ts — pure handler, no Deno.serve()
export interface HandlerDeps {
  supabase: SupabaseLike;
  markdownIt: { render(md: string): string };
}
export async function handleRequest(req: Request, deps: HandlerDeps): Promise<Response> { ... }

// index.ts — only entry point; imports handler, calls Deno.serve()
import { handleRequest } from './handler.ts';
Deno.serve((req) => handleRequest(req, { supabase: ..., markdownIt: ... }));
```

### Anti-Patterns to Avoid

- **user_id in matview SELECT list:** Will fail CI grep gate and violates INSIGHTS-03/INSIGHTS-10. Never include PHI columns in CREATE MATERIALIZED VIEW body.
- **Client-only k-floor enforcement:** Client UI shows warning but the SECDEF RPC MUST gate first. Client-only = trivially bypassable.
- **`current_setting('app.service_role_key')` in cron bodies:** This GUC does NOT exist on project ytnsipxxmzgaebkqmokp. Always use `(SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='service_role_key')`.
- **`IF NOT EXISTS` on CREATE POLICY:** Unsupported on remote PG version. Use bare `CREATE POLICY` — idempotency achieved by wrapping in `DROP POLICY IF EXISTS` first.
- **`$$...$$` nesting in cron body:** Always use named dollar-quote tags (`$cron$...$cron$` for outer, `$body$...$body$` for inner) per `reference_postgres_dollar_quote_nesting_in_cron_body`.
- **Back-dating migration timestamps:** Phase 62 migrations MUST use `20290102000001+`. Back-dated timestamps block `supabase db push` per `reference_supabase_back_dated_migration_blocks_push`.
- **epsilon=0.5 in admin output / epsilon=1.0 in public output:** These are reversed from their correct values. Admin=1.0 (looser), Public=0.5 (tighter). Planner must pin these constants in the RPC.
- **New chart library:** CONTEXT.md explicitly locks: "No new chart library." Use BaseChart.tsx with chart.js stacked-area configuration.
- **Deno.serve() at module top level in Edge Fn handler file:** Will abort all tests — separate index.ts (Deno.serve) from handler.ts (pure logic) per `reference_deno_test_top_level_serve_trap`.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| k-anonymity enforcement | Custom app-layer count check | `HAVING COUNT(DISTINCT user_id) >= 5` in matview + SECDEF RPC pre-check | DB-layer is the only reliable gate; app-layer can be bypassed |
| Laplace noise RNG | `Math.random()` in JS | PL/pgSQL `gen_random_uuid()` entropy | Cryptographic RNG; no dependency; audit trail in DB |
| Markdown → HTML rendering | Custom markdown parser | `markdown-it` (14.x, npm: in Deno) | Battle-tested; security-reviewed; handles edge cases |
| 2-person review state machine | Custom role checks per call site | Mirror `publish_protocol` SECDEF pattern exactly | 3-layer invariant + audit log + FOR UPDATE lock already proven |
| JSON-LD ScholarlyArticle | Manual `<script>` tag assembly | `react-helmet-async` `<script type="application/ld+json">` | Already in use; DOMPurify handles sanitization |
| Admin module registration | Custom route handler | `ADMIN_MODULES` manifest entry in `src/lib/admin/modules.ts` + AdminShell catch-all | Phase 61 protocols module set the pattern; catch-all branch already handles prefix matching |
| OG share card | Canvas-based renderer | `@vercel/og` (already ^0.11.1) | Already in use for /knowledge/* hub |

**Key insight:** Every building block for Phase 62 either already exists in the codebase (BaseChart.tsx, react-helmet-async, react-markdown, @vercel/og, publish_protocol SECDEF pattern) or is a thin DB-native construct (matview, PL/pgSQL laplace, pg_cron). Phase 62 is an assembly + wiring phase, not an invention phase.

---

## Runtime State Inventory

> Phase 62 is a new-feature phase (greenfield tables + routes). No rename/refactor/migration of existing data. Omit categories with no items.

| Category | Items Found | Action Required |
|----------|-------------|-----------------|
| Stored data | No existing research_* tables, no existing research_consent column in profiles | Migration creates them; zero pre-existing data to migrate |
| Live service config | Phase 60 rag-embed-approved cron already runs (phase60_embed_worker) | No reconfiguration — cron reads pending_rag_ingest queue generically once table + trigger exist |
| OS-registered state | None | None |
| Secrets/env vars | No new vendor secrets required. markdown-it is self-contained; no API key. | None |
| Build artifacts | None | None |

**rag_sources.source_type gap:** The `rag_sources` table was created in `20260519000002` WITHOUT a `source_type` column. However, `src/lib/knowledge/api.ts` (Phase 60-13) selects `source:rag_sources(id, name, source_type)` — this column exists on the remote DB (confirmed by the API shipping and working in Phase 60) but is NOT in any migration file. Phase 62 migration `20290102000005_rag_sources_leanshot_research.sql` MUST include:
```sql
ALTER TABLE public.rag_sources ADD COLUMN IF NOT EXISTS source_type text;
```
before inserting the `leanshot_research` seed row. This ensures idempotency on fresh project setup.

---

## Common Pitfalls

### Pitfall 1: source_type Column Not in Any Migration

**What goes wrong:** Planner writes a migration that only inserts the `leanshot_research` row into `rag_sources` without first adding the `source_type` column. Fresh project setup fails with "column source_type does not exist."
**Why it happens:** `api.ts` references `source_type` on `rag_sources` but this column was added to the remote DB outside of git-tracked migrations (likely during Phase 60 development).
**How to avoid:** Migration `20290102000005` MUST run `ALTER TABLE public.rag_sources ADD COLUMN IF NOT EXISTS source_type text;` first, THEN the `INSERT INTO rag_sources`.
**Warning signs:** `supabase db push` failure on fresh linked project; grep of all migrations returns zero `source_type` on `rag_sources`.

### Pitfall 2: PHI Column in Matview Body

**What goes wrong:** Developer includes `user_id` (for debugging) or `email` (for display) in the matview SELECT. CI grep gate catches it and blocks the pipeline.
**Why it happens:** Matviews over tables like `injections` (which has `user_id`) naturally include it when doing GROUP BY.
**How to avoid:** The `GROUP BY` clause MAY reference `user_id` for the `COUNT(DISTINCT user_id)` aggregate, but `user_id` MUST NOT appear in the final SELECT column list. Only aggregates, date bins, and non-identifying segment labels.
**Warning signs:** `grep -E "user_id|email|phone|address" supabase/migrations/2029*_insights*.sql` returns matches inside a SELECT clause body.

### Pitfall 3: Back-Dated Migration Timestamp

**What goes wrong:** A migration file gets named `20290101000004_*` (same cluster as Phase 61) and `supabase db push` refuses to push ANYTHING because the remote already applied `20290101000003`.
**Why it happens:** Planner uses `20290101` prefix for Phase 62 instead of `20290102`.
**How to avoid:** All Phase 62 migrations MUST use `20290102000001+`. Phase 61 applied `20290101000001/002/003`. Confirmed by `supabase migration list --linked | tail -5`.
**Warning signs:** `supabase db push` error "remote migration is ahead of local."

### Pitfall 4: Cron Registered Before Fn Deployed

**What goes wrong:** `pg_cron` registers the matview-refresh or purge cron targeting a non-existent Edge Fn endpoint. Cron fires within 15 minutes and hits a 404.
**Why it happens:** Close-out plan pushes `20290102000099_insights_cron_schedules.sql` before deploying `research-publish` Fn.
**How to avoid:** Per `feedback_fn_deploy_before_cron_db_push` — Fns MUST be deployed before cron migration. The matview-refresh cron does NOT call an Edge Fn (it's a direct SQL REFRESH) — this is safe. The purge cron calls `purge_research_data_for_revoked()` SECDEF directly — also safe. Only the RAG ingest trigger (which calls pending_rag_ingest INSERT, NOT an Edge Fn) is safe at migration time. The close-out plan order: deploy Fn → push DB → verify.
**Warning signs:** Cron job logs showing 404 responses for the research-publish Fn endpoint.

### Pitfall 5: SELF_REVIEW_REJECTED Message Substring Mismatch

**What goes wrong:** UI toast checks for `SELF_REVIEW_REJECTED` substring but the RPC EXCEPTION message uses a different capitalization or prefix.
**Why it happens:** Copy-paste drift between SECDEF and UI catch block.
**How to avoid:** The EXCEPTION message MUST contain the literal string `SELF_REVIEW_REJECTED` — UI toast at `ResearchReviewBanner.tsx` matches on this substring exactly per Phase 61 pattern.
**Warning signs:** Self-review attempt shows a generic error toast instead of the specific "Another admin must review" message.

### Pitfall 6: Vitest projects: block silently masks Phase 62 eval tests

**What goes wrong:** `npm test` collects 0 Phase 62 eval tests because `vitest.config.ts`'s `projects:` block overrides the default `include` pattern.
**Why it happens:** Per `reference_vitest_4_projects_config_masks_default` — the `projects:` block in vitest.config.ts silently masks default config.
**How to avoid:** Phase 62 eval tests at `eval/phase62/no-phi-in-matviews.test.ts` (git root) need a new Vitest project entry: `{ test: { name: 'phase62-eval', include: ['../eval/phase62/**/*.test.ts'] } }`. Run: `vitest run --project=phase62-eval`.
**Warning signs:** `npm test` reports "0 tests collected" for Phase 62 eval.

---

## Code Examples

### Retention Curve Chart Configuration

```typescript
// Source: BaseChart.tsx pattern + Chart.js stacked-area (line chart with fill)
// For RetentionCurveChart.tsx — thin wrapper on BaseChart.tsx
import type { ChartConfiguration } from 'chart.js';

function buildRetentionConfig(
  weekLabels: string[],
  retentionData: number[],
  epsilon: number,
): ChartConfiguration {
  return {
    type: 'line',
    data: {
      labels: weekLabels,
      datasets: [{
        label: 'Retention (30d)',
        data: retentionData,
        fill: true,
        backgroundColor: 'rgba(27, 72, 66, 0.15)', // var(--color-primary) at 15% alpha
        borderColor: 'var(--color-primary)',
        tension: 0.3,
      }],
    },
    options: {
      responsive: true,
      plugins: {
        legend: { labels: { font: { size: 11 }, color: 'var(--color-text-secondary)' } },
      },
      scales: {
        x: { ticks: { font: { size: 11 }, color: 'var(--color-chart-tick)' },
              grid: { color: 'var(--color-grid-line)' } },
        y: { min: 0, max: 1,
              ticks: { format: { style: 'percent' }, font: { size: 11 }, color: 'var(--color-chart-tick)' },
              grid: { color: 'var(--color-grid-line)' } },
      },
    },
  };
}
// Usage: <BaseChart key={theme} config={buildRetentionConfig(...)} ariaLabel="Retention curve" />
```

### Admin Module Manifest Entry

```typescript
// Source: src/lib/admin/modules.ts — mirror Phase 61 protocols entry (line 323-337)
// Import icon:
import { FlaskConical as FlaskConicalIcon } from 'lucide-react';

// Add to ADMIN_MODULES array after protocols entry:
{
  key: 'research',
  label: 'Research',
  route: 'research',
  icon: FlaskConicalIcon,
  lazy: () => import('@/components/admin/research/ResearchLayout'),
  flagKey: 'admin_research',
  minRole: 'staff',
},
```

### Pg-Cron Matview Refresh (daily 02:00 UTC)

```sql
-- Source: 20281201000099_phase60_cron_schedules.sql pattern — named dollar-quote tags
-- Mirrors phase60_eval_nightly job shape
SELECT cron.schedule(
  'phase62_matview_refresh',
  '0 2 * * *',
  $cron$
    REFRESH MATERIALIZED VIEW CONCURRENTLY public.insights_dose_rollup;
    REFRESH MATERIALIZED VIEW CONCURRENTLY public.insights_body_metrics_rollup;
    REFRESH MATERIALIZED VIEW CONCURRENTLY public.insights_retention_rollup;
    REFRESH MATERIALIZED VIEW CONCURRENTLY public.insights_engagement_rollup;
    REFRESH MATERIALIZED VIEW CONCURRENTLY public.insights_ai_interaction_rollup;
  $cron$
);
```

### PHI-Leak CI Gate Test

```typescript
// Source: eval/phase62/no-phi-in-matviews.test.ts (git root eval/phase62/)
// Based on kanon.test.ts pattern + 3-layer invariant (feedback_3_layer_must_never_invariant_pattern)
import { execSync } from 'node:child_process';
import { describe, it, expect } from 'vitest';

describe('Phase 62 — PHI-leak gate for insights matviews', () => {
  it('no PHI column names in matview migration SQL bodies', () => {
    // Source-level grep on matview migration files
    let output = '';
    try {
      output = execSync(
        'grep -rE "\\buser_id\\b|\\bemail\\b|\\bphone\\b|\\baddress\\b" ' +
        'supabase/migrations/20290102*_insights*.sql',
        { cwd: process.env['REPO_ROOT'] ?? process.cwd(), encoding: 'utf8' }
      );
    } catch {
      output = ''; // grep exit 1 = no matches = PASS
    }
    // Strip comments (lines starting with --)
    const violations = output.split('\n')
      .filter(l => l.trim() && !l.match(/^\s*--/))
      .filter(l => l.match(/\buser_id\b|\bemail\b|\bphone\b|\baddress\b/));
    expect(violations, `PHI columns found in matview SQL: ${violations.join('\n')}`).toHaveLength(0);
  });
});
```

### DpMethodsFooter Component

```tsx
// Source: 62-UI-SPEC.md Surface 4 — mandatory on every /research/<slug>
interface DpMethodsFooterProps {
  epsilon: number;
  cohortSize: number;
  suppressedBuckets: number;
}
export function DpMethodsFooter({ epsilon, cohortSize, suppressedBuckets }: DpMethodsFooterProps) {
  return (
    <aside
      aria-label="Differential privacy disclosure"
      className="rounded-card border border-[var(--color-border)] bg-[var(--color-surface-elevated)] p-4 mt-8 space-y-2"
    >
      <p className="text-[13px] font-semibold text-[var(--color-text)]">Methods & Privacy</p>
      <dl className="space-y-1 font-mono tabular-nums text-[11px] text-[var(--color-text-secondary)]">
        <div><dt className="sr-only">Differential privacy</dt>
             <dd>{`Differential privacy: ε = ${epsilon} (Laplace mechanism)`}</dd></div>
        <div><dt className="sr-only">Cohort size</dt>
             <dd>{`Cohort size: ${cohortSize} participants`}</dd></div>
        <div><dt className="sr-only">Suppressed buckets</dt>
             <dd>{`Suppressed buckets: ${suppressedBuckets}`}</dd></div>
        <div><dt className="sr-only">Date binning</dt>
             <dd>Date binning: weekly aggregates only</dd></div>
      </dl>
      <p className="text-[13px] text-[var(--color-text-tertiary)]">
        Individual data is never included. Cohorts with fewer than 5 participants are suppressed entirely.
      </p>
    </aside>
  );
}
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `CREATE POLICY IF NOT EXISTS` | Bare `CREATE POLICY` (drop-then-create) | Phase 61 close-out lesson | Remote PG does not support IF NOT EXISTS on policies |
| `supabase functions deploy --import-map` | Per-function `deno.json` imports | Supabase CLI v2.101.0 | `--import-map` silently ignored from v2.101.0; migrate to per-fn deno.json |
| `current_setting('app.service_role_key')` in cron | `vault.decrypted_secrets` SELECT | Phase 60 research | GUC doesn't exist on project ytnsipxxmzgaebkqmokp |
| `$$` nesting in cron body | Named dollar-quote tags (`$cron$`) | Phase 60 research | Nested `$$` silently closes outer quote |

**Deprecated/outdated:**
- `@react-pdf/renderer` for PDF: Deferred to v1.5 — use HTML print stylesheet only in Phase 62
- `@vercel/og` in separate Fn pattern: Already integrated in /knowledge/* — reuse same pattern

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `rag_sources.source_type` column exists on remote DB (added outside git-tracked migrations) | Standard Stack / Don't Hand-Roll | If absent on fresh project, `src/lib/knowledge/api.ts` SELECT fails; Phase 62 migration must add it defensively via ADD COLUMN IF NOT EXISTS |
| A2 | `markdown-it` 14.x is importable via `npm:markdown-it@14` in Deno 2.7 Edge Fn runtime | Standard Stack | If Deno edge runtime rejects the specifier, fall back to `marked` (simpler API, similar size) |
| A3 | Phase 60 `rag-embed-approved` cron reads from `pending_rag_ingest` generically (not hardcoded to specific source types) | Architecture / RAG feedback loop | If cron filters on specific source types, Phase 62 needs a dedicated ingest cron instead |
| A4 | `react-router-dom` is available for `/admin/research` routing (admin surface uses react-router per `reference_react_router_consumer_admin_split`) | Standard Stack | Admin shell uses react-router; confirmed by ProtocolsLayout.tsx using pathname-based routing (no router dependency for sub-nav) |

**If this table is empty:** Not applicable — see above assumptions.

---

## Open Questions (RESOLVED)

All three open questions are resolved by the planning_directives and confirmed in the 62-* PLAN files. Answers are tagged RESOLVED and the source plan task is named where applicable.

1. **pending_rag_ingest queue consumption by rag-embed-approved** — **RESOLVED**
   - **Answer (Option A from planning_directives): direct `rag_chunks` INSERT.** `publish_research` SECDEF RPC (Plan 62-02 Task 2) writes directly into `public.rag_chunks` (source_id pointing at the leanshot_research `rag_sources` row, `status='approved'`, `tier='A'`, `embedding=NULL`). Phase 60's existing `rag-embed-approved` cron polls `rag_chunks WHERE embedding IS NULL AND status='approved'` and embeds the body — no Edge Fn call is required from the RPC.
   - **`pending_rag_ingest` retained as audit / monitoring only.** The queue table is still populated (by the on-publish trigger from Plan 62-01 AND by the RPC's belt-and-suspenders INSERT), but delivery does NOT depend on it being consumed. The queue is read-only telemetry for the admin dashboard and post-publish forensics.
   - **VALIDATION verifier:** see Plan 62-08 close-out — `select count(*) from rag_chunks where source_id = (select id from rag_sources where source_type='leanshot_research') and status='approved'` MUST be ≥ 1 after the 3 seed publications are inserted.

2. **Source_type vs rag_sources row for leanshot_research** — **RESOLVED**
   - **Answer:** Plan 62-01 Task 3 ships `ALTER TABLE public.rag_sources ADD COLUMN IF NOT EXISTS source_type text;` in migration `20290102000005_rag_sources_leanshot_research.sql`, plus a single seed row `(name='LeanShot Research', domain='research.leanshot.app', tier='A', source_type='leanshot_research', freshness_window_days=365)`. All published papers link to this single source row via `rag_chunks.source_id`.

3. **REFRESH CONCURRENTLY requires unique index** — **RESOLVED**
   - **Answer:** Per-matview unique composite keys are declared in Plan 62-01 Task 2 (migration `20290102000002_insights_matviews.sql`):
     - `insights_dose_rollup` UNIQUE (week_bin, compound, tenure_bucket, audience_segment)
     - `insights_body_metrics_rollup` UNIQUE (week_bin, tenure_bucket, audience_segment)
     - `insights_retention_rollup` UNIQUE (week_bin, tenure_bucket, audience_segment)
     - `insights_engagement_rollup` UNIQUE (week_bin, tenure_bucket, audience_segment)
     - `insights_ai_interaction_rollup` UNIQUE (week_bin, tenure_bucket, audience_segment)
   - Plan 62-01 verify block (`grep -E "create unique index if not exists"`) enforces this count ≥ 5.

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Deno | research-publish Edge Fn tests | ✓ | 2.7.14 (at ~/.deno/bin/deno) | — |
| Node.js | Vitest + frontend build | ✓ | v22.18.0 | — |
| npm | Package management | ✓ | 10.9.3 | — |
| Supabase CLI | DB push + Fn deploy | ✓ | 2.101.0 | — |
| chart.js 4.4.6 | RetentionCurveChart.tsx | ✓ | In package.json | — |
| react-helmet-async | /research/* SEO | ✓ | 2.0.5 in package.json | — |
| react-markdown + dompurify | Paper rendering | ✓ | In package.json | — |
| @vercel/og | OG share cards | ✓ | 0.11.1 in package.json | — |
| markdown-it | research-publish Edge Fn | ✓ | 14.2.0 on npm (need deno.json entry) | marked@9 (simpler fallback) |
| pg_cron | Matview refresh + purge cron | ✓ | Enabled (7 Phase 60 jobs already registered) | — |
| vault.decrypted_secrets | Cron service_role bearer | ✓ | Live (Phase 60 cron confirms) | — |

**Missing dependencies with no fallback:** None.
**Missing dependencies with fallback:** `markdown-it` (needs deno.json entry in research-publish Fn; fallback to `marked` if deno.json import fails).

---

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 4.x (leanshot/vitest.config.ts) + Deno test (Edge Fn __tests__/) |
| Config file | leanshot/vitest.config.ts (projects: block — needs phase62-eval entry added in Wave 0) |
| Quick run command | `npx vitest run --project=phase62-eval` (from leanshot/) |
| Full suite command | `npx vitest run --project=phase62-eval --reporter=verbose` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| INSIGHTS-01 | k-floor: cohorts <5 suppressed | unit (source-level grep + DB column check) | `npx vitest run --project=phase62-eval` | ❌ Wave 0 |
| INSIGHTS-02 | Laplace noise applied to cohorts 5-50 | unit (SQL function output test) | `npx vitest run --project=phase62-eval` | ❌ Wave 0 |
| INSIGHTS-03 | Zero PHI columns in matview SQL | unit (grep test) | `npx vitest run --project=phase62-eval` | ❌ Wave 0 |
| INSIGHTS-04 | Week-level date binning only | unit (matview column type check) | `npx vitest run --project=phase62-eval` | ❌ Wave 0 |
| INSIGHTS-05 | research_consent opt-in + revoke within 30 days | integration (DB schema check) | `npx vitest run --project=phase62-eval` | ❌ Wave 0 |
| INSIGHTS-06 | Admin dashboard route renders | smoke (component mount) | `npx vitest run src/components/admin/research/` | ❌ Wave 3 |
| INSIGHTS-07 | publish_research 2-person rule enforced | unit (SELF_REVIEW_REJECTED assertion) | `npx vitest run --project=phase62-eval` | ❌ Wave 1 |
| INSIGHTS-08 | /research/* public route renders | smoke (component mount) | `npx vitest run src/components/research/` | ❌ Wave 4 |
| INSIGHTS-09 | RAG ingest triggered on publish | integration (pending_rag_ingest row existence) | `npx vitest run --project=phase62-eval` | ❌ Wave 1 |
| INSIGHTS-10 | No PHI in compile_research_cohort output | unit (JSON output column check) | `npx vitest run --project=phase62-eval` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `npx vitest run --project=phase62-eval` (from leanshot/)
- **Per wave merge:** `npx vitest run --project=phase62-eval && npm run typecheck`
- **Phase gate:** Full suite green + `supabase migration list --linked` confirms all `20290102*` migrations applied before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `eval/phase62/no-phi-in-matviews.test.ts` — covers INSIGHTS-01/03/10
- [ ] `eval/phase62/laplace-noise.test.ts` — covers INSIGHTS-02
- [ ] `eval/phase62/consent-schema.test.ts` — covers INSIGHTS-05
- [ ] vitest.config.ts phase62-eval project entry — required before any eval test runs
- [ ] `content/research/` directory + 3 seed markdown files — required before research-publish Fn tests

---

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes (admin surfaces) | `public.is_staff()` SECDEF guard on all RPCs |
| V3 Session Management | no (no new session handling) | — |
| V4 Access Control | yes | SECDEF + `is_staff()` guard; 2-person review for publish; no auth wall on public /research/* |
| V5 Input Validation | yes | zod validation in Edge Fn; `p_filters jsonb` sanitized in SECDEF |
| V6 Cryptography | yes (DP noise) | PL/pgSQL + `gen_random_uuid()` CSPRNG — never `Math.random()` |

### Known Threat Patterns for This Stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| PHI re-identification via matview query | Information Disclosure | k-floor HAVING clause + SECDEF RPC blocks sub-5 cohorts; CI grep gate prevents PHI columns in matview |
| Self-review of research publication | Tampering | SELF_REVIEW_REJECTED in publish_research SECDEF + DOM rule (button absent for author) |
| Laplace noise bypass via many queries | Information Disclosure | Noise re-applied fresh per compile_research_cohort call; no caching of noisy output |
| Markdown injection in publication body | Tampering/XSS | DOMPurify allowlist (same as sanitizeRagMarkdown helper in Phase 60-13) |
| Cron firing before Fn deployed | Denial of Service | deploy Fn BEFORE pushing cron migration (feedback_fn_deploy_before_cron_db_push pattern) |
| `user_id` leaking via aggregate timing attack | Information Disclosure | Week-level binning only (INSIGHTS-04); no day-level granularity publicly |

---

## Sources

### Primary (HIGH confidence)
- `leanshot/.planning/phases/62-insights-research-engine/62-CONTEXT.md` — all locked decisions, deferred items, integration points
- `leanshot/.planning/phases/62-insights-research-engine/62-UI-SPEC.md` — full component inventory, color tokens, typography contract
- `supabase/migrations/20290101000002_protocol_secdef_rpcs.sql` — publish_protocol shape (verbatim template for publish_research)
- `supabase/migrations/20281201000099_phase60_cron_schedules.sql` — pg_cron vault pattern + named dollar-quote tag pattern
- `src/components/admin/protocols/ProtocolsLayout.tsx` — ResearchLayout.tsx analog (verified verbatim match to UI-SPEC)
- `src/components/dashboard/charts/BaseChart.tsx` — RetentionCurveChart.tsx reuse point (verified props interface)
- `src/components/knowledge/KnowledgeArticleDetailPage.tsx` — ResearchArticlePage.tsx analog (verified react-helmet + react-markdown + DOMPurify pattern)
- `supabase/migrations/20260519000002_rag_sources_table_and_seed.sql` — rag_sources table structure (source_type column gap confirmed)
- `leanshot/.planning/STATE.md` — Phase 61 complete; Phase 62 is next; migration head confirmed as 20290101000003

### Secondary (MEDIUM confidence)
- `tests/eval/phase60/kanon.test.ts` — k-anonymity test pattern for eval/phase62/ tests
- `supabase/functions/rag-embed-approved/handler.ts` — handler.ts/index.ts split pattern + HandlerDeps interface
- `src/lib/admin/modules.ts` — ADMIN_MODULES manifest structure for `research` entry
- `src/App.tsx` — /knowledge/* and /protocols/* route registration patterns for /research/*
- `npm view markdown-it version` → 14.2.0 (verified 2026-05-26)

### Tertiary (LOW confidence — marked [ASSUMED])
- A1: `rag_sources.source_type` exists remotely (inferred from api.ts usage, not found in migrations)
- A3: `rag-embed-approved` cron reads `pending_rag_ingest` generically (inferred from CONTEXT.md description; cron code reads `rag_chunks WHERE embedding IS NULL`, not a queue table)

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all packages verified in package.json + npm registry
- Architecture: HIGH — all patterns lifted from verified CONTEXT.md + existing codebase
- DB layer: HIGH — PL/pgSQL patterns verified from Phase 61 migrations
- Pitfalls: HIGH — all from documented project memory entries
- RAG ingest mechanism: MEDIUM — CONTEXT.md describes pending_rag_ingest queue but existing rag-embed-approved cron reads rag_chunks directly (open question 1)

**Research date:** 2026-05-26
**Valid until:** 2026-06-26 (30 days; stable stack)
