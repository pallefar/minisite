# Phase 62: Insights & Research Engine - Context

**Gathered:** 2026-05-26
**Status:** Ready for planning
**Mode:** Smart Discuss (autonomous)

<domain>
## Phase Boundary

Anonymized aggregate research compilation across dose logs + body metrics + symptoms + retention + gamification + AI coach interactions. K-anonymity (k≥5) hard floor + differential privacy Laplace noise for cohorts 5-50. Admin research dashboard at `/admin/research` + white-paper publishing pipeline + public research blog at `/research/*` + RAG feedback loop (closes Phase 60 retriever with LeanShot-authored primary research).

**Surfaces delivered (8):**
1. **DB schema** — 5 rollup matviews (`insights_dose_rollup`, `insights_body_metrics_rollup`, `insights_retention_rollup`, `insights_engagement_rollup`, `insights_ai_interaction_rollup`) + 1 publication table (`research_publications`) + 1 audit table (`research_review_log`) + 1 queue table (`pending_rag_ingest`) + `profiles.research_consent` column add
2. **SECDEF RPCs** — `compile_research_cohort(p_filters)` (k-floor + Laplace inline), `publish_research(p_publication_id)` (2-person rule), `purge_research_data_for_revoked()`, custom PL/pgSQL `laplace_noise(value, epsilon)` function
3. **Cron jobs** — Daily 02:00 UTC matview REFRESH; Nightly 01:00 UTC purge for revoked consent; on-publish trigger → pending_rag_ingest queue
4. **Admin research dashboard** — `/admin/research` cohort builder UI + Chart.js retention curves + cross-tab matrix + epsilon-parameter display
5. **White-paper Edge Fn** — `research-publish` Edge Fn (markdown-it + @vercel/og)
6. **Public `/research/<slug>` hub** — Vite SPA route + helmet + JSON-LD ScholarlyArticle + sitemap.xml extension + RSS feed
7. **Profile consent UI** — Settings page toggle for `research_consent` (default false; opt-in only)
8. **CI grep gate** — `eval/phase62/no-phi-in-matviews.test.ts` — runtime + source-level PHI-leak gate

**Out of scope (defer to v1.5 / Phase 70 UAT):**
- Dedicated PDF generator (`@react-pdf/renderer` or `wkhtmltopdf`) — use HTML print stylesheet + browser "Print to PDF"
- AI-generated paper drafts (admin authors manually; AI-assist deferred)
- Interactive per-paper data viz (static charts in MVP)
- Per-paper comment thread (Phase 70 UAT decides if needed)
- Multi-author bylines (single reviewer per paper; co-authorship deferred)

</domain>

<decisions>
## Implementation Decisions

### Privacy Mechanics (Area 1)

- **K-anonymity (DB-layer enforcement)**: SECDEF RPC `compile_research_cohort(filters)` counts cohort first; returns `{suppressed: true, reason: 'k_floor'}` BEFORE materializing rollup when `cohort_size < 5`. Underlying matview SELECT filters `having count(distinct user_id) >= 5`. Defense-in-depth: client UI also displays suppressed banner; never trusts only client.
- **Differential privacy (DB-layer Laplace)**: Custom PL/pgSQL function `public.laplace_noise(value numeric, epsilon numeric)` using `gen_random_uuid` + `ln()` transform. NO npm dependency. Two epsilon profiles per `INSIGHTS-02`:
  - Admin output: `epsilon = 1.0` (looser; admin can see closer to truth)
  - Public publication output: `epsilon = 0.5` (tighter; protects against re-identification)
- **Revoke-consent cron**: Nightly 01:00 UTC `purge_research_data_for_revoked()` SECDEF — finds `profiles WHERE research_consent=false AND last_purged_at < consent_revoked_at`, deletes from every `insights_*_source` source table. Matviews refresh on next 02:00 UTC cron. 30-day SLA met with ~24h actual.
- **CI PHI-leak gate**: `eval/phase62/no-phi-in-matviews.test.ts`:
  - Source-level: `grep -rE "user_id|email|phone|address" supabase/migrations/2029*_insights*.sql` → MUST return zero matches on matview body
  - Runtime: query each matview, assert no columns named like PHI
- **Vault-bearer pattern for cron**: same as Phase 60 — `current_setting('app.service_role_key')` does NOT exist on this project; use `(SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='service_role_key')` per [[reference_supabase_pg_cron_vault_service_role_pattern]].

### Admin Dashboard + White-Paper + Public Hub + RAG Feedback (Area 2)

- **`/admin/research` cohort builder**: Mirror `/admin/protocols` Layout from Phase 61 + `AdminVendorSmokeDashboard.tsx` shell pattern from Phase 60.5. Form: compound multiselect + tenure-bucket select (`<3m`, `3-6m`, `6-12m`, `12m+`) + audience multiselect (B2C / clinic / both) + outcome-metric select (weight_change / dose_adherence / retention_30d / symptom_severity). POST to `compile_research_cohort` SECDEF RPC. Render via existing `chart.js` (4.4.6) + `BaseChart.tsx` wrapper (already in `package.json`). Retention curves use stacked-area chart pattern.
- **No new chart library**. Bundle stays small.
- **White-paper pipeline**:
  - Source: `content/research/*.md` markdown files under repo (git-versioned authoring)
  - Renderer: Edge Fn `research-publish` invokes `markdown-it` + `remark-gfm` (npm: import). NO mdx-bundler (heavy). Output: HTML body + JSON metadata
  - Storage: `research_publications` table — `(id uuid PK, slug text unique, markdown_path text, published_at timestamptz, reviewer_id uuid, created_by uuid, status enum 'draft|in_review|published|archived')`
  - 2-person review SECDEF: `publish_research(publication_id)` mirrors `publish_protocol` shape verbatim — rejects when `actor=created_by` with `SELF_REVIEW_REJECTED`. Uses Phase 61 `approve_rag_chunk` shape.
  - OG card: `@vercel/og` generates the share card (already in dependencies, used by Phase 60-13)
  - **NO dedicated PDF library in MVP**. HTML print stylesheet only ("Print to PDF" via browser). Defer @react-pdf to v1.5.
- **Public `/research/<slug>` route** — mirror Phase 60-13 `/knowledge/*` verbatim:
  - Vite client-render + `react-helmet-async` for meta/title/canonical
  - JSON-LD `ScholarlyArticle` schema (NOT `MedicalWebPage` like Phase 60-13 — research papers are scholarly publications)
  - Build-time `sitemap.xml` extension (append `/research/*` URLs)
  - **Public, no auth-wall, robots=index** (unlike Phase 60-13 which noindex'd clinical content) — research papers are SEO-discoverable to drive backlinks
  - RSS feed at `/research/rss.xml` build-time generated
- **RAG feedback loop**:
  - On `research_publications.status='published'` trigger → INSERT into `pending_rag_ingest(publication_id, queued_at)` queue table
  - Existing Phase 60 ingest cron polls + chunks ingested with `kb_chunks.source_type='leanshot_research'`, `tier='A'` (authoritative; skip admin review carveout — already 2-person-reviewed at publication time)
  - Asynchronous so publish doesn't block on RAG ingestion latency
- **Profile consent UI**: Settings page toggle. Default `false` (opt-in only per CAN-SPAM equivalent + HIPAA Privacy Rule §164.508 patient authorization). Revoke → sets `consent_revoked_at = now()`; next nightly cron purges.

### Claude's Discretion

- Exact matview column names (must match underlying source tables; planner will discover at execution).
- Tenure-bucket SQL implementation (`age(now(), profile.created_at)` cases).
- Cross-tab matrix UI layout (HTML table with `Table.tsx` primitive from `src/components/ui/`).
- Specific PostHog event names (`research_cohort_compiled`, `research_published`).
- Migration filename timestamps — use `20290102000001+` (following Phase 61's `20290101*` cluster).
- RSS feed pubDate format (RFC 822 standard).

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- **Admin shell**: `src/components/admin/AdminShell.tsx` + module manifest (Phase 61 `protocols` entry added). New `research` module slots in identically.
- **Chart.js wrapper**: `src/components/dashboard/charts/BaseChart.tsx` — theme-aware Chart.js. Reuse for retention curves + cross-tab visualizations.
- **2-person review SECDEF pattern**: Phase 61 `publish_protocol` (which mirrored Phase 60-08 `approve_rag_chunk`). Copy verbatim for `publish_research`.
- **`is_staff()` helper**: `supabase/migrations/20261101000006_is_staff_helper.sql` — use directly in RLS.
- **Public hub shell**: Phase 60-13 `/knowledge/*` — reuse `react-helmet-async` + sitemap + JSON-LD + `@vercel/og` patterns verbatim. Adapt `MedicalWebPage` → `ScholarlyArticle` schema.
- **OG card Edge Fn**: `@vercel/og` Edge runtime already in use (Phase 60-13). Mirror for research publication card.
- **Pg-cron vault pattern**: [[reference_supabase_pg_cron_vault_service_role_pattern]] — verbatim for daily-refresh + nightly-purge crons.
- **RAG ingest queue pattern**: Phase 60 chunker + embedder are reusable — they read from a queue, no new ingestion infra needed.
- **Settings page**: `src/components/dashboard/settings/SettingsPage.tsx` — add new `Research Consent` toggle section.

### Established Patterns
- Matviews refreshed via pg_cron at 02:00 UTC (Phase 60 cluster precedent).
- Migration filenames forward-dated `20290102*` (avoids back-dated push block per [[reference_supabase_back_dated_migration_blocks_push]]).
- SECDEF RPCs always: `SECURITY DEFINER SET search_path = public, pg_temp + is_staff() guard + FOR UPDATE locks + audit log INSERT`.
- Bare `CREATE POLICY` (no `IF NOT EXISTS` — unsupported on remote PG per Phase 61 close-out lesson).
- CI grep gates in `eval/phase<N>/` for "MUST NEVER happen in production" invariants per [[feedback_3_layer_must_never_invariant_pattern]].
- Public hub follows Phase 60-13 architecture (Vite client-render + helmet + JSON-LD + sitemap.xml).

### Integration Points
- **Admin router**: register `research` module in admin manifest + AdminShell switch.
- **App.tsx selectView**: add `/research/*` branch BEFORE marketing fallback (mirror Phase 60-13 `/knowledge/*` + Phase 61 `/protocols/*` precedent).
- **Settings page**: add `Research Consent` toggle section (default off).
- **Phase 60 RAG ingest**: read from `pending_rag_ingest` queue; tag chunks `source_type='leanshot_research'`.
- **`profiles` table**: ALTER TABLE add `research_consent boolean default false` + `consent_revoked_at timestamptz` + `last_purged_at timestamptz`.

</code_context>

<specifics>
## Specific Ideas

- **Seed 3 reference white papers** at migration time (gives QA + clinician demo content):
  1. "Tirzepatide titration adherence patterns" (uses Phase 61 protocol data — dogfood the protocol creator)
  2. "Weekly dose-to-weight-loss correlation across compounds" (uses Phase 35 dose-log data)
  3. "AI-coach interaction → retention uplift" (uses Phase 60 AI-coach data; opt-in cohort)
- **DP epsilon documentation**: each public publication page MUST display `epsilon = 0.5` + cohort size + suppressed-bucket count in a methods footer. Reader-transparency requirement per academic integrity.
- **k_floor sentinel UX**: when admin builds a cohort that breaches k<5, show explicit message `Cohort too small (k<5) — broaden filters` rather than silently failing. Cohort-builder form shows estimated cohort size in real-time.
- **RSS feed schema**: RFC 822 pubDate + GUID = publication URL + ScholarlyArticle metadata in `<atom:link rel="self">`.
- **research_consent revoke confirmation modal**: "Revoking will remove your data from future research within 24 hours. Already-published papers cite aggregate cohorts, not individuals — past publications are not retracted."

</specifics>

<deferred>
## Deferred Ideas

- Dedicated PDF generator (`@react-pdf/renderer` / `wkhtmltopdf`) — defer to v1.5 if requested
- AI-generated paper drafts (admin AI-assist) — defer to v1.5
- Interactive per-paper data viz (D3.js drilldown charts) — defer to v1.5
- Per-paper comment threads / peer review — defer to v1.5
- Multi-author bylines — single reviewer per paper in MVP; co-authorship in v1.5
- Hourly matview refresh (currently daily; revisit when admin volume warrants)
- Spanish localization of research blog — defer to v1.5 contractor expansion

</deferred>
