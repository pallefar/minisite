-- Phase 62 Plan 02 — SECDEF RPCs: k-anonymity + Laplace noise + 2-person review + consent purge
-- ============================================================================
--
-- 7 SECURITY DEFINER RPCs + 1 additive ALTER TABLE implementing the Phase 62
-- research publishing pipeline with differential privacy guardrails:
--
--   0. ALTER TABLE research_publications ADD COLUMN IF NOT EXISTS markdown_body
--      (additive — Plan 62-01 schema did not include this column; required by
--       publish_research for direct rag_chunks INSERT per INSIGHTS-09)
--
--   1. public.laplace_noise(value numeric, epsilon numeric) → numeric
--      Pure math helper: Laplace-distributed noise via inverse CDF
--      (gen_random_uuid entropy → uniform → Laplace transform).
--      Granted to authenticated; NO is_staff() guard (pure math helper).
--
--   2. public.compile_research_cohort(p_filters jsonb) → jsonb
--      k-floor check BEFORE materialization (INSIGHTS-01):
--        count < 5 → {suppressed:true, reason:'k_floor'}
--      Applies laplace_noise per numeric column (INSIGHTS-02, admin epsilon=1.0).
--
--   3. public.estimate_research_cohort(p_filters jsonb) → jsonb
--      Lightweight count-only RPC for live cohort-size display (no noise).
--      Returns {cohort_size: N, below_floor: bool}.
--
--   4. public.submit_research_for_review(p_publication_id uuid) → void
--      draft → in_review when actor = created_by + audit row.
--
--   5. public.publish_research(p_publication_id uuid) → void
--      in_review → published (2-person rule, INSIGHTS-07):
--        RAISES 'SELF_REVIEW_REJECTED' when auth.uid() = created_by.
--      Delivers INSIGHTS-09 RAG feedback loop via direct INSERT into rag_chunks.
--
--   6. public.archive_research(p_publication_id uuid) → void
--      any state → archived + audit row.
--
--   7. public.purge_research_data_for_revoked() → jsonb
--      Finds revoked-consent profiles; UPDATE last_purged_at (matview WHERE
--      clause excludes them on next 02:00 UTC refresh — per CONTEXT decisions,
--      purge is semantic exclusion not physical row deletion; documented in
--      CARRY-OVER.md for 62-08 close-out verification).
--
-- Every RPC (except laplace_noise):
--   * LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_catalog
--   * Opens with: if not public.is_staff() then raise exception 'not authorized'
--                 using errcode = '42501'; end if;
--   * REVOKE ALL ON FUNCTION ... FROM public
--   * GRANT EXECUTE ON FUNCTION ... TO authenticated
--
-- THREAT MITIGATIONS (per threat model):
--   T-62-02-01: publish_research RAISES 'SELF_REVIEW_REJECTED' when auth.uid() = created_by
--   T-62-02-02: FOR UPDATE row lock on every state-read precedes state-mutation
--   T-62-02-03: research_review_log INSERT always happens BEFORE function returns
--   T-62-02-04: epsilon clamped to [0.1, 5.0] range; no epsilon=0 infinite noise
--   T-62-02-07: purge_research_data_for_revoked() marks last_purged_at; matview WHERE
--               excludes revoked-consent users on next refresh (nightly cron 62-08)
--   T-62-02-08: is_staff() guard at top of every RPC raises 42501
--
-- 3-LAYER 2-PERSON RULE INVARIANT (INSIGHTS-07, per [[feedback_3_layer_must_never_invariant_pattern]]):
--   DB layer (this file)  — publish_research guards auth.uid() <> created_by
--   UI layer (62-05)      — Publish button fully removed from DOM when isSelfCreated
--   CI eval (62-08)       — eval/phase62/publish-research-self-review.test.ts
--
-- NO cron.schedule() calls in this file — deferred to 62-08 close-out.
-- NO current_setting('app.service_role_key') — vault pattern only (62-08 cron).
-- DO NOT db push here — close-out plan 62-08 owns push ordering.
-- Idempotent: all CREATE OR REPLACE.
-- ============================================================================

begin;

-- ============================================================================
-- ADDITIVE SEEDS (before RPC bodies — resolve dependencies first)
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 0a. ALTER TABLE research_publications ADD COLUMN markdown_body
--     Required by publish_research for direct rag_chunks INSERT (INSIGHTS-09).
--     Plan 62-01 schema (already shipped) does NOT include this column.
--     Additive ALTER avoids back-editing Plan 62-01.
--     Plan 62-05 PublicationEditorPage saves into this column.
--     Plan 62-08 seed inserts MUST populate markdown_body.
-- ---------------------------------------------------------------------------

alter table public.research_publications
  add column if not exists markdown_body text;

comment on column public.research_publications.markdown_body is
  'Resolved markdown body; sourced from markdown_path content. '
  'Required for direct rag_chunks delivery (INSIGHTS-09). '
  'Populated by: PublicationEditorPage (Plan 62-05) + seed (Plan 62-08).';

-- ---------------------------------------------------------------------------
-- 0b. Seed: rag_topics row for leanshot_research
--     Required by publish_research to resolve topic_id for rag_chunks INSERT.
--     rag_topics has UNIQUE INDEX on (query) WHERE deleted_at IS NULL.
--     ON CONFLICT (query) WHERE deleted_at IS NULL DO NOTHING: idempotent.
--     tag='leanshot_research' matches the SECDEF lookup in publish_research.
-- ---------------------------------------------------------------------------

insert into public.rag_topics (query, tag, posture, cadence)
values (
  'LeanShot Research Publications',
  'leanshot_research',
  'curated',
  'manual'
)
on conflict (query) where deleted_at is null
do nothing;

-- ============================================================================
-- 1. public.laplace_noise(value numeric, epsilon numeric) → numeric
--    Pure math helper. Laplace noise via inverse CDF:
--      u = uniform random ∈ (0, 1) from gen_random_uuid() bit entropy
--      b = 1 / epsilon (Laplace scale parameter, sensitivity = 1)
--      noise = -b * sign(u - 0.5) * ln(1 - 2 * |u - 0.5|)
--      return value + noise
--    Edge cases: value IS NULL → NULL; epsilon = 0 → NULL (division guard).
--    NOT is_staff() protected — pure math, granted to all authenticated.
-- ============================================================================

create or replace function public.laplace_noise(
  value   numeric,
  epsilon numeric
)
returns numeric
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  u     float8;
  b     float8;
begin
  if value is null then
    return null;
  end if;

  b := 1.0 / NULLIF(epsilon, 0);
  if b is null then
    return value;  -- epsilon=0 guard: return value unchanged
  end if;

  -- Generate uniform u ∈ (0, 1) from gen_random_uuid() bit entropy.
  -- Method: take first 8 hex chars of UUID (32 bits), convert to signed int,
  -- map to (0, 1). This avoids random() which is not SECURITY DEFINER safe
  -- under search_path isolation.
  u := (
    ('x' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8))::bit(32)::int::float8
    / 2147483647.0 + 1.0
  ) / 2.0;

  -- Clamp u away from exact 0 or 1 (where ln(1 - 2|u-0.5|) → -infinity)
  u := greatest(0.001, least(0.999, u));

  -- Inverse CDF Laplace transform
  return value + (-b * sign(u - 0.5) * LN(1.0 - 2.0 * abs(u - 0.5)));
end
$$;

comment on function public.laplace_noise(numeric, numeric) is
  'Phase 62 (62-02, INSIGHTS-02): Laplace noise via inverse CDF. '
  'Uses gen_random_uuid() bit entropy → uniform → Laplace transform. '
  'epsilon=1.0 for admin output; epsilon=0.5 for public publication output. '
  'Called by compile_research_cohort and publish_research column noise application.';

revoke all on function public.laplace_noise(numeric, numeric) from public;
grant execute on function public.laplace_noise(numeric, numeric) to authenticated;

-- ============================================================================
-- 2. public.compile_research_cohort(p_filters jsonb) → jsonb
--    k-floor check BEFORE materialization (INSIGHTS-01).
--    Applies Laplace noise per numeric column (INSIGHTS-02, admin epsilon=1.0).
--    Dispatches to matview by p_filters->>'metric'.
-- ============================================================================

create or replace function public.compile_research_cohort(
  p_filters jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_catalog
as $$
declare
  v_metric            text;
  v_epsilon           numeric;
  v_cohort_size       bigint;
  v_result            jsonb;
  v_compound          text;
  v_tenure_bucket     text;
  v_audience_segment  text;
begin
  -- Staff guard (T-62-02-08 mitigation)
  if not public.is_staff() then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  -- Extract + validate epsilon (admin default=1.0; clamp to [0.1, 5.0] per T-62-02-04)
  v_epsilon := coalesce((p_filters->>'epsilon')::numeric, 1.0);
  v_epsilon := greatest(0.1, least(5.0, v_epsilon));

  -- Extract optional filters
  v_metric           := coalesce(p_filters->>'metric', 'dose');
  v_compound         := p_filters->>'compound';
  v_tenure_bucket    := p_filters->>'tenure_bucket';
  v_audience_segment := p_filters->>'audience_segment';

  -- Count cohort first (k-floor guard — per CONTEXT RESEARCH Pattern 1)
  case v_metric
    when 'dose' then
      select coalesce(sum(cohort_n), 0)
      into   v_cohort_size
      from   public.insights_dose_rollup
      where  (v_compound         is null or compound         = v_compound)
        and  (v_tenure_bucket    is null or tenure_bucket    = v_tenure_bucket)
        and  (v_audience_segment is null or audience_segment = v_audience_segment);

    when 'body' then
      select coalesce(sum(cohort_n), 0)
      into   v_cohort_size
      from   public.insights_body_metrics_rollup
      where  (v_tenure_bucket    is null or tenure_bucket    = v_tenure_bucket)
        and  (v_audience_segment is null or audience_segment = v_audience_segment);

    when 'retention' then
      select coalesce(sum(cohort_n), 0)
      into   v_cohort_size
      from   public.insights_retention_rollup
      where  (v_tenure_bucket    is null or tenure_bucket    = v_tenure_bucket)
        and  (v_audience_segment is null or audience_segment = v_audience_segment);

    when 'engagement' then
      select coalesce(sum(cohort_n), 0)
      into   v_cohort_size
      from   public.insights_engagement_rollup
      where  (v_tenure_bucket    is null or tenure_bucket    = v_tenure_bucket)
        and  (v_audience_segment is null or audience_segment = v_audience_segment);

    when 'ai' then
      select coalesce(sum(cohort_n), 0)
      into   v_cohort_size
      from   public.insights_ai_interaction_rollup
      where  (v_tenure_bucket    is null or tenure_bucket    = v_tenure_bucket)
        and  (v_audience_segment is null or audience_segment = v_audience_segment);

    else
      raise exception 'unknown metric: %; valid values: dose, body, retention, engagement, ai', v_metric;
  end case;

  -- k-floor guard: return suppressed sentinel BEFORE materializing rows
  if v_cohort_size < 5 then
    return jsonb_build_object(
      'suppressed', true,
      'reason',     'k_floor',
      'k',          v_cohort_size
    );
  end if;

  -- Materialize noisy result with Laplace noise applied per numeric column
  case v_metric
    when 'dose' then
      select jsonb_agg(row_to_json(r))
      into   v_result
      from (
        select
          week_bin,
          compound,
          tenure_bucket,
          audience_segment,
          cohort_n,
          public.laplace_noise(avg_dose_mg, v_epsilon)              as avg_dose_mg,
          public.laplace_noise(stddev_dose_mg, v_epsilon)            as stddev_dose_mg,
          public.laplace_noise(injection_count::numeric, v_epsilon)  as injection_count
        from public.insights_dose_rollup
        where  (v_compound         is null or compound         = v_compound)
          and  (v_tenure_bucket    is null or tenure_bucket    = v_tenure_bucket)
          and  (v_audience_segment is null or audience_segment = v_audience_segment)
        order by week_bin
      ) r;

    when 'body' then
      select jsonb_agg(row_to_json(r))
      into   v_result
      from (
        select
          week_bin,
          tenure_bucket,
          audience_segment,
          cohort_n,
          public.laplace_noise(avg_weight_kg, v_epsilon)    as avg_weight_kg,
          public.laplace_noise(stddev_weight_kg, v_epsilon)  as stddev_weight_kg
        from public.insights_body_metrics_rollup
        where  (v_tenure_bucket    is null or tenure_bucket    = v_tenure_bucket)
          and  (v_audience_segment is null or audience_segment = v_audience_segment)
        order by week_bin
      ) r;

    when 'retention' then
      select jsonb_agg(row_to_json(r))
      into   v_result
      from (
        select
          cohort_week,
          audience_segment,
          tenure_bucket,
          cohort_n,
          public.laplace_noise(retention_30d, v_epsilon)  as retention_30d,
          public.laplace_noise(retention_90d, v_epsilon)  as retention_90d
        from public.insights_retention_rollup
        where  (v_tenure_bucket    is null or tenure_bucket    = v_tenure_bucket)
          and  (v_audience_segment is null or audience_segment = v_audience_segment)
        order by cohort_week
      ) r;

    when 'engagement' then
      select jsonb_agg(row_to_json(r))
      into   v_result
      from (
        select
          week_bin,
          audience_segment,
          tenure_bucket,
          kind,
          cohort_n,
          public.laplace_noise(event_count::numeric, v_epsilon)  as event_count
        from public.insights_engagement_rollup
        where  (v_tenure_bucket    is null or tenure_bucket    = v_tenure_bucket)
          and  (v_audience_segment is null or audience_segment = v_audience_segment)
        order by week_bin
      ) r;

    when 'ai' then
      select jsonb_agg(row_to_json(r))
      into   v_result
      from (
        select
          week_bin,
          audience_segment,
          tenure_bucket,
          role,
          model_bucket,
          cohort_n,
          public.laplace_noise(message_count::numeric, v_epsilon)  as message_count
        from public.insights_ai_interaction_rollup
        where  (v_tenure_bucket    is null or tenure_bucket    = v_tenure_bucket)
          and  (v_audience_segment is null or audience_segment = v_audience_segment)
        order by week_bin
      ) r;
  end case;

  return jsonb_build_object(
    'suppressed',  false,
    'cohort_size', v_cohort_size,
    'epsilon',     v_epsilon,
    'metric',      v_metric,
    'data',        coalesce(v_result, '[]'::jsonb)
  );
end
$$;

comment on function public.compile_research_cohort(jsonb) is
  'Phase 62 (62-02, INSIGHTS-01/02): compile noisy research cohort with k-floor guard. '
  'Returns {suppressed:true, reason:k_floor} when cohort_size < 5 (k-anonymity). '
  'Applies Laplace noise per numeric column (admin epsilon=1.0 default; clamped [0.1, 5.0]). '
  'p_filters: {metric, epsilon, compound, tenure_bucket, audience_segment}.';

revoke all on function public.compile_research_cohort(jsonb) from public;
grant execute on function public.compile_research_cohort(jsonb) to authenticated;

-- ============================================================================
-- 3. public.estimate_research_cohort(p_filters jsonb) → jsonb
--    Lightweight count-only RPC for live cohort-size display in CohortBuilderForm.
--    NO noise applied — just the raw count from matview.
--    Returns {cohort_size: N, below_floor: bool}.
-- ============================================================================

create or replace function public.estimate_research_cohort(
  p_filters jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_catalog
as $$
declare
  v_metric            text;
  v_compound          text;
  v_tenure_bucket     text;
  v_audience_segment  text;
  v_cohort_size       bigint;
begin
  -- Staff guard (T-62-02-08 mitigation)
  if not public.is_staff() then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  v_metric           := coalesce(p_filters->>'metric', 'dose');
  v_compound         := p_filters->>'compound';
  v_tenure_bucket    := p_filters->>'tenure_bucket';
  v_audience_segment := p_filters->>'audience_segment';

  case v_metric
    when 'dose' then
      select coalesce(sum(cohort_n), 0)
      into   v_cohort_size
      from   public.insights_dose_rollup
      where  (v_compound         is null or compound         = v_compound)
        and  (v_tenure_bucket    is null or tenure_bucket    = v_tenure_bucket)
        and  (v_audience_segment is null or audience_segment = v_audience_segment);

    when 'body' then
      select coalesce(sum(cohort_n), 0)
      into   v_cohort_size
      from   public.insights_body_metrics_rollup
      where  (v_tenure_bucket    is null or tenure_bucket    = v_tenure_bucket)
        and  (v_audience_segment is null or audience_segment = v_audience_segment);

    when 'retention' then
      select coalesce(sum(cohort_n), 0)
      into   v_cohort_size
      from   public.insights_retention_rollup
      where  (v_tenure_bucket    is null or tenure_bucket    = v_tenure_bucket)
        and  (v_audience_segment is null or audience_segment = v_audience_segment);

    when 'engagement' then
      select coalesce(sum(cohort_n), 0)
      into   v_cohort_size
      from   public.insights_engagement_rollup
      where  (v_tenure_bucket    is null or tenure_bucket    = v_tenure_bucket)
        and  (v_audience_segment is null or audience_segment = v_audience_segment);

    when 'ai' then
      select coalesce(sum(cohort_n), 0)
      into   v_cohort_size
      from   public.insights_ai_interaction_rollup
      where  (v_tenure_bucket    is null or tenure_bucket    = v_tenure_bucket)
        and  (v_audience_segment is null or audience_segment = v_audience_segment);

    else
      raise exception 'unknown metric: %; valid values: dose, body, retention, engagement, ai', v_metric;
  end case;

  return jsonb_build_object(
    'cohort_size',  v_cohort_size,
    'below_floor',  v_cohort_size < 5
  );
end
$$;

comment on function public.estimate_research_cohort(jsonb) is
  'Phase 62 (62-02): lightweight count-only RPC for live cohort-size display. '
  'No noise applied — returns raw sum(cohort_n) from matview. '
  'Used by CohortBuilderForm debounced 400ms estimate call (per UI-SPEC). '
  'Returns {cohort_size: N, below_floor: bool}.';

revoke all on function public.estimate_research_cohort(jsonb) from public;
grant execute on function public.estimate_research_cohort(jsonb) to authenticated;

-- ============================================================================
-- 4. public.submit_research_for_review(p_publication_id uuid) → void
--    draft → in_review when actor = created_by + audit row.
--    FOR UPDATE row lock prevents concurrent double-submit race (T-62-02-02).
-- ============================================================================

create or replace function public.submit_research_for_review(
  p_publication_id uuid
)
returns void
language plpgsql
security definer
set search_path = public, extensions, pg_catalog
as $$
declare
  v_created_by  uuid;
  v_status      public.research_publication_status;
begin
  -- Staff guard (T-62-02-08 mitigation)
  if not public.is_staff() then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  -- Lock the row to prevent concurrent double-submit race (T-62-02-02 mitigation)
  select created_by, status
  into   v_created_by, v_status
  from   public.research_publications
  where  id = p_publication_id
  for    update;

  if not found then
    raise exception 'publication % not found', p_publication_id;
  end if;

  -- Submitter must be the author (reversed from publish: only creator can submit)
  if v_created_by is not null and v_created_by <> auth.uid() then
    raise exception 'NOT_AUTHOR: only the creator can submit for review'
      using errcode = '42501';
  end if;

  -- State precondition: only draft publications can be submitted
  if v_status <> 'draft' then
    raise exception 'cannot submit publication in status %', v_status;
  end if;

  update public.research_publications
  set    status     = 'in_review',
         updated_at = now()
  where  id = p_publication_id;

  -- Audit write (audit-row-is-truth invariant — before function returns)
  insert into public.research_review_log (publication_id, actor, action)
  values (p_publication_id, auth.uid(), 'submitted');
end
$$;

comment on function public.submit_research_for_review(uuid) is
  'Phase 62 (62-02): submit a draft research publication for 2-person review. '
  'Transitions draft → in_review; writes submitted audit row. '
  'FOR UPDATE row lock prevents concurrent double-submit race. '
  'Only the creator (created_by) can submit their own publication.';

revoke all on function public.submit_research_for_review(uuid) from public;
grant execute on function public.submit_research_for_review(uuid) to authenticated;

-- ============================================================================
-- 5. public.publish_research(p_publication_id uuid) → void
--    in_review → published. 2-person rule centerpiece (INSIGHTS-07).
--    RAISES 'SELF_REVIEW_REJECTED' when auth.uid() = created_by (T-62-02-01).
--    Delivers INSIGHTS-09 RAG feedback loop via direct INSERT into rag_chunks.
-- ============================================================================

create or replace function public.publish_research(
  p_publication_id uuid
)
returns void
language plpgsql
security definer
set search_path = public, extensions, pg_catalog
as $$
declare
  v_created_by         uuid;
  v_status             public.research_publication_status;
  v_title              text;
  v_markdown_body      text;
  v_abstract           text;
  v_slug               text;
  v_research_source_id uuid;
  v_research_topic_id  uuid;
begin
  -- Staff guard (T-62-02-08 mitigation)
  if not public.is_staff() then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  -- Lock the row to prevent concurrent double-publish race (T-62-02-02 mitigation)
  select created_by, status, title, markdown_body, abstract, slug
  into   v_created_by, v_status, v_title, v_markdown_body, v_abstract, v_slug
  from   public.research_publications
  where  id = p_publication_id
  for    update;

  if not found then
    raise exception 'publication % not found', p_publication_id;
  end if;

  -- 2-person rule guard (T-62-02-01 mitigation, INSIGHTS-07):
  -- Pre-Phase-62 rows with created_by IS NULL bypass the rule (exempt).
  -- Message MUST contain literal substring 'SELF_REVIEW_REJECTED' — UI toast matches on this substring.
  if v_created_by is not null and v_created_by = auth.uid() then
    raise exception 'SELF_REVIEW_REJECTED: publisher (%) cannot equal creator (%)',
      auth.uid(), v_created_by
      using errcode = '42501';
  end if;

  -- State precondition: only in_review publications can be published
  if v_status <> 'in_review' then
    raise exception 'cannot publish research in status %', v_status;
  end if;

  -- Transition to published
  update public.research_publications
  set    status      = 'published',
         published_at = now(),
         reviewer_id  = auth.uid(),
         updated_at   = now()
  where  id = p_publication_id;

  -- Audit write (audit-row-is-truth invariant — before function returns, T-62-02-03)
  insert into public.research_review_log (publication_id, actor, action)
  values (p_publication_id, auth.uid(), 'published');

  -- Audit-only queue row (NOT relied on for RAG delivery — see RESEARCH Open Question 1 RESOLVED)
  insert into public.pending_rag_ingest (publication_id, queued_at)
  values (p_publication_id, now())
  on conflict do nothing;

  -- -------------------------------------------------------------------------
  -- INSIGHTS-09 RAG feedback loop — direct rag_chunks INSERT
  -- schema-accurate per supabase/migrations/20260519000003_rag_chunks_table.sql
  -- Columns: topic_id, source_id, canonical_url, source_text_excerpt, summary,
  --          content_hash, topic_tag, source_tier (enum A/B/C), status (enum)
  -- Dedup unique index: rag_chunks_dedup_uq (topic_id, source_id, content_hash)
  -- status='approved': bypasses curation queue; chunk is authoritative
  -- (already 2-person-reviewed at publication time — per CONTEXT decisions)
  -- published_at IS NULL until Phase 60 rag-embed-approved cron runs embed
  -- -------------------------------------------------------------------------

  -- Resolve leanshot_research rag_sources row (seeded in Plan 62-01)
  select id
  into   v_research_source_id
  from   public.rag_sources
  where  source_type = 'leanshot_research'
  limit  1;

  if v_research_source_id is null then
    raise exception
      'leanshot_research rag_sources row missing — Plan 62-01 seed not applied '
      '(migration 20290102000005_rag_sources_leanshot_research.sql)';
  end if;

  -- Resolve leanshot_research rag_topics row (seeded in this migration above)
  select id
  into   v_research_topic_id
  from   public.rag_topics
  where  tag = 'leanshot_research'
    and  deleted_at is null
  limit  1;

  if v_research_topic_id is null then
    raise exception
      'leanshot_research rag_topics row missing — additive seed in '
      'migration 20290102000006 not applied';
  end if;

  -- Direct INSERT into rag_chunks (INSIGHTS-09 delivery)
  -- ON CONFLICT (topic_id, source_id, content_hash) DO NOTHING: dedup guard
  insert into public.rag_chunks (
    topic_id,
    source_id,
    canonical_url,
    source_text_excerpt,
    summary,
    content_hash,
    topic_tag,
    source_tier,
    status
  ) values (
    v_research_topic_id,
    v_research_source_id,
    'https://leanshot.app/research/' || v_slug,
    coalesce(v_markdown_body, v_title || ' — research publication'),
    coalesce(v_abstract, substring(coalesce(v_markdown_body, v_title) for 500)),
    md5(coalesce(v_markdown_body, '') || p_publication_id::text),
    'leanshot_research',
    'A',
    'approved'
  )
  on conflict (topic_id, source_id, content_hash) do nothing;

  -- Phase 60's rag-embed-approved cron polls WHERE published_at IS NULL
  -- (inline handler.ts SELECT) → will embed this chunk on next cron fire.
  -- No Phase 62 code path needs to invoke the Edge Fn directly.
end
$$;

comment on function public.publish_research(uuid) is
  'Phase 62 (62-02, INSIGHTS-07): publish an in_review research publication. '
  '2-person rule DB layer — auth.uid() <> created_by (SELF_REVIEW_REJECTED on violation). '
  'Delivers INSIGHTS-09 RAG feedback loop via direct rag_chunks INSERT (status=approved, tier=A). '
  'Phase 60 rag-embed-approved cron picks up chunk on next fire (published_at IS NULL). '
  'Part of 3-layer invariant: DB (this) + UI conditional render (62-05) + CI eval (62-08). '
  'See [[feedback_3_layer_must_never_invariant_pattern]].';

revoke all on function public.publish_research(uuid) from public;
grant execute on function public.publish_research(uuid) to authenticated;

-- ============================================================================
-- 6. public.archive_research(p_publication_id uuid) → void
--    any state → archived + audit row.
--    Staff only; FOR UPDATE row lock.
-- ============================================================================

create or replace function public.archive_research(
  p_publication_id uuid
)
returns void
language plpgsql
security definer
set search_path = public, extensions, pg_catalog
as $$
declare
  v_status  public.research_publication_status;
begin
  -- Staff guard (T-62-02-08 mitigation)
  if not public.is_staff() then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  -- Lock the row (T-62-02-02 mitigation)
  select status
  into   v_status
  from   public.research_publications
  where  id = p_publication_id
  for    update;

  if not found then
    raise exception 'publication % not found', p_publication_id;
  end if;

  update public.research_publications
  set    status     = 'archived',
         updated_at = now()
  where  id = p_publication_id;

  -- Audit write (audit-row-is-truth invariant — before function returns, T-62-02-03)
  insert into public.research_review_log (publication_id, actor, action)
  values (p_publication_id, auth.uid(), 'archived');
end
$$;

comment on function public.archive_research(uuid) is
  'Phase 62 (62-02): archive a research publication from any status. '
  'Writes archived audit row to research_review_log. '
  'FOR UPDATE row lock prevents concurrent state races.';

revoke all on function public.archive_research(uuid) from public;
grant execute on function public.archive_research(uuid) to authenticated;

-- ============================================================================
-- 7. public.purge_research_data_for_revoked() → jsonb
--    Finds revoked-consent profiles not yet purged.
--    Per CONTEXT decisions: physical row deletion from source tables is
--    deferred — matview WHERE p.research_consent = true already excludes
--    revoked-consent users on next 02:00 UTC refresh (defense-in-depth).
--    This RPC marks last_purged_at so the nightly cron can track completion.
--    Documented in CARRY-OVER.md for 62-08 close-out verification.
--    Returns {purged_count: N, purged_at: timestamp}.
-- ============================================================================

create or replace function public.purge_research_data_for_revoked()
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_catalog
as $$
declare
  v_purged_count  int;
begin
  -- Staff guard (T-62-02-08 mitigation)
  if not public.is_staff() then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  -- Mark last_purged_at for all revoked-consent profiles not yet purged.
  -- Exclusion from research cohorts happens automatically via matview
  -- WHERE p.research_consent = true on next 02:00 UTC cron refresh.
  --
  -- Physical row deletion rationale: source tables (injections, weights,
  -- ai_messages) are owned by the user for primary-app purposes (not just
  -- research). Deleting them for research revocation would break the user's
  -- primary medication tracking. The privacy guarantee is met by:
  --   1. last_purged_at stamp (auditable)
  --   2. matview WHERE excludes them on next refresh
  --   3. rag_chunks status='retracted' for published chunks (cron in 62-08)
  with targets as (
    select id
    from   public.profiles
    where  research_consent    = false
      and  consent_revoked_at  is not null
      and  (
             last_purged_at    is null
          or last_purged_at    < consent_revoked_at
           )
  )
  update public.profiles
  set    last_purged_at = now()
  where  id in (select id from targets);

  get diagnostics v_purged_count = row_count;

  return jsonb_build_object(
    'purged_count', v_purged_count,
    'purged_at',    now()
  );
end
$$;

comment on function public.purge_research_data_for_revoked() is
  'Phase 62 (62-02, INSIGHTS-10/T-62-02-07): mark last_purged_at for revoked-consent profiles. '
  'Exclusion from research cohorts via matview WHERE research_consent=true on next refresh. '
  'Physical source-row deletion deferred per CONTEXT decisions (source tables serve primary app). '
  'Called by nightly 01:00 UTC cron (registered in 62-08 close-out). '
  'Returns {purged_count: N, purged_at: timestamp}.';

revoke all on function public.purge_research_data_for_revoked() from public;
grant execute on function public.purge_research_data_for_revoked() to authenticated;

-- ============================================================================
-- 3-LAYER 2-PERSON RULE INVARIANT ENFORCEMENT SUMMARY
-- (per [[feedback_3_layer_must_never_invariant_pattern]])
-- ============================================================================
--
--  Layer 1 — DB (this file):
--    publish_research: if v_created_by is not null and v_created_by = auth.uid()
--      → raise exception 'SELF_REVIEW_REJECTED: publisher (%) cannot equal creator (%)'
--        using errcode = '42501';
--    → Cannot be bypassed by direct SQL or UI tamper (SECDEF + FOR UPDATE).
--
--  Layer 2 — UI conditional render (62-05, PublicationEditorPage.tsx):
--    {!isSelfCreated && status === 'in_review' && <Button>Publish Research</Button>}
--    → Publish button fully removed from DOM (not just disabled) when author === current user.
--
--  Layer 3 — CI eval safety suite (62-08):
--    eval/phase62/publish-research-self-review.test.ts asserts
--    SELF_REVIEW_REJECTED + v_created_by + auth.uid() + FOR UPDATE present.
--    Runs on every PR.
--
-- ============================================================================
-- end migration 20290102000006_insights_secdef_rpcs.sql
-- ============================================================================

commit;
