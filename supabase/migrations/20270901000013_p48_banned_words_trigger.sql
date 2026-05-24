-- Phase 48 Plan 48-06 Task 1 — banned_words match trigger on community_posts + community_comments.
--
-- Implements:
--   D-10 (banned-word match trigger): AFTER INSERT/UPDATE on posts/comments;
--     ILIKE-ANY loop body → community_reports INSERT with
--     reason->>'source'='banned_word'; severity='escalate' fires pg_net to
--     email-router with phi:false (admin-to-admin).
--
-- Body shape forked from supabase/migrations/20270703000012_trigger_ad_etl_backfill_secdef.sql.
--
-- Memory references (load-bearing):
--   reference_supabase_pg_cron_vault_service_role_pattern — net.http_post uses
--     vault.decrypted_secrets WHERE name='service_role_key' + hardcoded
--     functions URL. NEVER current_setting('app.service_role_key').
--   reference_postgres_no_insert_on_conflict_do_delete — uses
--     `on conflict do nothing` (relies on the partial UNIQUE
--     community_reports_banned_word_dedup_uniq shipped in Plan 48-01).
--   reference_supabase_migration_gotchas — SECDEF needs search_path including
--     extensions (avoid search_path injection); trigger fn declares both.
--   feedback_negation_grep_defeated_by_comment_string — committed body does NOT
--     mention `direct_messages` even as a rejected alternative.
--   feedback_rpc_auth_uid_vs_service_role_mismatch — trigger fired by the
--     ROW writer's context (could be authenticated user via SECDEF community
--     write RPCs); the SECDEF on this trigger fn gives it service-role bypass
--     to INSERT into community_reports regardless of caller.
--
-- Threat model:
--   T-48-20 (T, banned_words trigger fires on direct_messages) — mitigated:
--     trigger NOT declared on direct_messages (DMs uniformly skip auto-mod).
--
-- Cross-plan integration:
--   - community_reports_banned_word_dedup_uniq: 20270901000001 (Plan 48-01).
--   - log_moderation_action: 20270901000009 (Plan 48-04).
--   - banned_words table: 20270901000010 (Plan 48-05).
--   - email-router Fn: pre-existing (notification fan-out).

create or replace function public.banned_words_match()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $fn$
declare
  r              record;
  v_target_type  text;
  v_service_key  text;
begin
  v_target_type := case TG_TABLE_NAME
                     when 'community_posts'    then 'post'
                     when 'community_comments' then 'comment'
                     else null
                   end;
  if v_target_type is null then return null; end if;

  for r in select word, severity, case_insensitive from public.banned_words loop
    if (case when r.case_insensitive
             then NEW.body ilike '%' || r.word || '%'
             else NEW.body  like '%' || r.word || '%'
        end)
    then
      insert into public.community_reports
        (target_type, target_id, reporter_user_id, reason, status)
      values
        (v_target_type, NEW.id, null,
         jsonb_build_object('source','banned_word','word',r.word,'severity',r.severity),
         'open')
      on conflict do nothing;

      perform public.log_moderation_action(
        p_action_type => 'banned_word_match',
        p_target_type => v_target_type,
        p_target_id   => NEW.id,
        p_after       => jsonb_build_object('word', r.word, 'severity', r.severity),
        p_reason      => null
      );

      if r.severity = 'escalate' then
        select decrypted_secret into v_service_key
          from vault.decrypted_secrets where name = 'service_role_key' limit 1;
        perform net.http_post(
          url     := 'https://ytnsipxxmzgaebkqmokp.supabase.co/functions/v1/email-router',
          headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'Authorization', 'Bearer ' || v_service_key
          ),
          body    := jsonb_build_object(
            'template',    'banned_word_escalate',
            'phi',         false,
            'category',    'banned_word_escalate',
            'word',        r.word,
            'target_type', v_target_type,
            'target_id',   NEW.id,
            'author_id',   NEW.author_id
          )
        );
      end if;
    end if;
  end loop;
  return null;
end;
$fn$;

-- Triggers on community_posts + community_comments.
-- INTENTIONALLY no trigger on a 4th table (D-10): DMs uniformly skip auto-mod.
drop trigger if exists trg_banned_words_match_posts on public.community_posts;
create trigger trg_banned_words_match_posts
  after insert or update on public.community_posts
  for each row execute function public.banned_words_match();

drop trigger if exists trg_banned_words_match_comments on public.community_comments;
create trigger trg_banned_words_match_comments
  after insert or update on public.community_comments
  for each row execute function public.banned_words_match();
