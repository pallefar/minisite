-- Phase 48 Plan 48-06 Task 2 — Auto-flag trigger with PHI gate.
--
-- Implements:
--   D-08 (PHI gate at trigger WHEN clause): AFTER INSERT/UPDATE on
--     community_posts + community_comments WHEN community_spaces.org_id IS NULL
--     fires pg_net to claude-moderation Fn with
--     { content_type, content_id, body, space_id, author_id }.
--     Clinic-org content (org_id IS NOT NULL) NEVER reaches Anthropic.
--
-- Memory references (load-bearing):
--   reference_supabase_pg_cron_vault_service_role_pattern — vault bearer +
--     hardcoded Fn URL.
--   reference_supabase_migration_gotchas — SECDEF + search_path = public, extensions.
--   feedback_negation_grep_defeated_by_comment_string — committed body does
--     NOT mention `direct_messages` at all (no rejected-alternative strings).
--     Plan-checker greps `direct_messages` against this file and asserts 0.
--   feedback_rpc_auth_uid_vs_service_role_mismatch — fn is SECDEF so it can
--     invoke pg_net regardless of caller; auth.uid() is NOT referenced.
--
-- Threat model:
--   T-48-03 (I, PHI sent to Anthropic) — mitigated: WHEN clause filters
--     org_id IS NULL at the trigger level; pg_net is NEVER invoked for
--     clinic-org content.
--
-- Cross-plan integration:
--   - community_spaces.org_id: shipped Phase 44 (org-scoped spaces).
--   - claude-moderation Fn: shipped Plan 48-07 (Wave 1) — must be deployed
--     BEFORE this trigger fires in production (per memory
--     feedback_fn_deploy_before_cron_db_push). Plan 48-12 close-out
--     orchestrates Fn deploy → db push order.

create or replace function public.auto_flag_content()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $fn$
declare
  v_service_key  text;
  v_content_type text;
begin
  v_content_type := case TG_TABLE_NAME
                     when 'community_posts'    then 'post'
                     when 'community_comments' then 'comment'
                     else null
                   end;
  if v_content_type is null then return null; end if;

  select decrypted_secret into v_service_key
    from vault.decrypted_secrets where name = 'service_role_key' limit 1;

  perform net.http_post(
    url     := 'https://ytnsipxxmzgaebkqmokp.supabase.co/functions/v1/claude-moderation',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_service_key
    ),
    body    := jsonb_build_object(
      'content_type', v_content_type,
      'content_id',   NEW.id,
      'body',         NEW.body,
      'space_id',     NEW.space_id,
      'author_id',    NEW.author_id
    )
  );

  return null;
end;
$fn$;

-- PHI gate in trigger WHEN clauses (per D-08): pg_net never fires for
-- clinic-org content (Anthropic data-sharing surface conservatism).
-- Both posts and comments traverse to community_spaces.org_id; comments
-- carry their own space_id (denormalized per Phase 44 RESEARCH Pitfall 5)
-- so a direct WHERE s.id = NEW.space_id is sufficient for both tables.
drop trigger if exists trg_auto_flag_posts on public.community_posts;
create trigger trg_auto_flag_posts
  after insert or update on public.community_posts
  for each row
  when (exists (
    select 1 from public.community_spaces s
    where s.id = NEW.space_id and s.org_id is null
  ))
  execute function public.auto_flag_content();

drop trigger if exists trg_auto_flag_comments on public.community_comments;
create trigger trg_auto_flag_comments
  after insert or update on public.community_comments
  for each row
  when (exists (
    select 1 from public.community_spaces s
    where s.id = NEW.space_id and s.org_id is null
  ))
  execute function public.auto_flag_content();
