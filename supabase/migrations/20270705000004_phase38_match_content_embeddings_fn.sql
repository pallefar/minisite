-- Phase 38 Plan 01 — match_content_embeddings RPC (multi-source future-proof).
--
-- Signature locked here for Phase 38 + Phase 50 callers (38-01-PLAN <interfaces>).
-- Threat T-38-01: Information Disclosure — mitigated by:
--   1. SECURITY INVOKER (honors caller JWT).
--   2. RAISE EXCEPTION when requesting_user_id IS NULL (Guardrail O4 belt+suspenders).
--   3. Filter `(c.visible_to_user_id IS NULL OR c.visible_to_user_id = requesting_user_id)`.
--   4. Filter c.deleted_at IS NULL AND ce.stale = false AND ce.last_embedded_at > now() - interval '30 days'.
--
-- SECURITY INVOKER chosen over DEFINER per memory `reference_supabase_migration_gotchas`
-- (DEFINER funcs with vector ops are landmines if search_path drifts; INVOKER lets
-- RLS continue to enforce content visibility on the join).
--
-- Phase 50 forward-compat: `sources text[] DEFAULT ARRAY['content_embeddings']`
-- + `source_tier_weights jsonb DEFAULT '{}'`. Phase 50-04 will switch to passing
-- ['content_embeddings','external_kb_embeddings'] and per-source weights without
-- altering the function signature.

create or replace function public.match_content_embeddings(
  query_embedding      vector(1536),
  match_count          int      default 10,
  requesting_user_id   uuid     default null,
  sources              text[]   default array['content_embeddings'],
  source_tier_weights  jsonb    default '{}'::jsonb
)
returns table (
  source_table    text,
  content_id      uuid,
  source_type     text,
  title           text,
  similarity      float,
  weighted_score  float
)
language plpgsql
security invoker
set search_path = public, extensions
as $$
declare
  weight_content   float;
  weight_external  float;
begin
  -- Guardrail O4: belt-and-suspenders cross-tenant block.
  if requesting_user_id is null then
    raise exception 'match_content_embeddings: requesting_user_id must not be NULL';
  end if;

  -- Phase 50 reweighting hook — default 1.0 if not provided.
  weight_content  := coalesce((source_tier_weights ->> 'content_embeddings')::float, 1.0);
  weight_external := coalesce((source_tier_weights ->> 'external_kb_embeddings')::float, 1.0);

  if 'content_embeddings' = any(sources) then
    return query
    select
      'content_embeddings'::text                                            as source_table,
      c.id                                                                  as content_id,
      c.kind                                                                as source_type,
      c.title                                                               as title,
      (1.0 - (ce.embedding <=> query_embedding))::float                     as similarity,
      ((1.0 - (ce.embedding <=> query_embedding)) * weight_content)::float  as weighted_score
    from public.content_embeddings ce
    join public.content c on c.id = ce.content_id
    where c.deleted_at is null
      and ce.stale = false
      and ce.last_embedded_at > now() - interval '30 days'
      and (c.visible_to_user_id is null or c.visible_to_user_id = requesting_user_id)
    order by ce.embedding <=> query_embedding asc
    limit match_count;
  end if;

  -- Phase 50 placeholder: 'external_kb_embeddings' branch will be added when
  -- that table ships (Phase 50-04). Today this branch is a no-op if requested
  -- so callers can pass the future source name without erroring.
  if 'external_kb_embeddings' = any(sources) then
    -- Intentional no-op: table not yet created. Phase 50-04 owns the body.
    return;
  end if;
end;
$$;

comment on function public.match_content_embeddings(vector, int, uuid, text[], jsonb) is
  'Phase 38 — multi-source vector ANN with cross-tenant guard. SECURITY INVOKER. Phase 50 extends with external_kb_embeddings source.';

-- Grant EXECUTE to authenticated + service_role. Anon is blocked.
grant execute on function public.match_content_embeddings(vector, int, uuid, text[], jsonb)
  to authenticated, service_role;

revoke execute on function public.match_content_embeddings(vector, int, uuid, text[], jsonb)
  from anon, public;
