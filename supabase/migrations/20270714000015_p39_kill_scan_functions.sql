-- Phase 39 Plan 39-03 — Kill-scan SQL functions for the 3 lifecycle/kill crons.
--
-- CONTEXT references (39-CONTEXT.md):
--   D-02 (PAYWALL refund-rate hard-kill at 2× CONTROL baseline; no cooldown)
--   D-03 (PHARMA NPS drop ≥5 OR 1★ rate > 2× baseline — either-trigger)
--   D-04 (Single Slack channel #growth-experiments — vault decrypted_secrets)
--   D-11 (42-day lifecycle: warn day 35, hard-cut day 42 + traffic_to_control)
--
-- Threat mitigations (39-03-PLAN.md <threat_model>):
--   T-39-03-04: kill-scan functions MUST NOT reference the JWT-derived caller
--   identity helper — they run in service-role context (pg_cron). Per
--   [[feedback_rpc_auth_uid_vs_service_role_mismatch]], read tables directly
--   via aggregated SQL. Per [[feedback_negation_grep_defeated_by_comment_string]],
--   the literal name of the forbidden function is kept out of comments so that
--   plan-level negation greps remain clean.
--   T-39-03-09: cron logs aggregated counts + variant_id only; no per-user PII.
--
-- Idempotency contract:
--   Re-running on an already-warned/archived/killed variant is a no-op.
--   Achieved via WHERE warned_at IS NULL / archived_at IS NULL guards on UPDATE
--   so subsequent invocations match zero rows.
--
-- Slack invocation pattern (per [[reference_supabase_pg_cron_vault_service_role_pattern]]):
--   net.http_post with vault.decrypted_secrets bearer; pg_net is async so
--   pg_cron does not await. If Slack flaps, alerts drop silently (T-39-03-05
--   accept residual).
--
-- review_submissions table note (PHARMA 1★ branch):
--   Plan 39-08 plans this table; it does NOT yet exist on main as of
--   Phase 39 Wave 2. The pharma kill-scan defensively probes via
--   to_regclass and silently skips the 1★ branch when absent.
--   NPS branch is fully active in Wave 2 (quarterly_nps_responses exists per
--   migration 20270704000020).

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- ============================================================================
-- p39_variant_42day_archive_scan() — D-11 lifecycle
-- ============================================================================

create or replace function public.p39_variant_42day_archive_scan()
returns void
language plpgsql
security definer
set search_path = public, extensions
as $fn$
declare
  v_warned_count int := 0;
  v_archived_count int := 0;
  v_secret text;
  v_variant record;
begin
  -- Warn pass: variants between day 35 and day 42 with no prior warn.
  with warned as (
    update public.page_variants
       set warned_at = now()
     where warned_at is null
       and archived_at is null
       and created_at <= now() - interval '35 days'
       and created_at >  now() - interval '42 days'
    returning id
  )
  select count(*) into v_warned_count from warned;

  -- Archive pass: variants past day 42 still active. Flip traffic to control.
  with archived as (
    update public.page_variants
       set archived_at = now(),
           traffic_to_control = true
     where archived_at is null
       and created_at <= now() - interval '42 days'
    returning id
  )
  select count(*) into v_archived_count from archived;

  if v_warned_count = 0 and v_archived_count = 0 then
    return;
  end if;

  -- Fetch vault service-role key for slack-alert-experiments call.
  select decrypted_secret into v_secret
    from vault.decrypted_secrets
   where name = 'service_role_key'
   limit 1;

  if v_secret is null then
    raise notice 'p39_variant_42day_archive_scan: service_role_key missing from vault — skipping slack';
    return;
  end if;

  -- Fire warn alert (one per variant warned this run).
  for v_variant in
    select id from public.page_variants
     where warned_at >= now() - interval '5 minutes'
       and archived_at is null
  loop
    perform net.http_post(
      url := 'https://ytnsipxxmzgaebkqmokp.supabase.co/functions/v1/slack-alert-experiments',
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || v_secret,
        'Content-Type', 'application/json'
      ),
      body := jsonb_build_object(
        'kind', 'archive_warn_35d',
        'variant_id', v_variant.id::text,
        'message', format('Page variant %s reaches 35-day warn threshold (D-11)', v_variant.id),
        'context', jsonb_build_object('days_old', 35)
      ),
      timeout_milliseconds := 30000
    );
  end loop;

  -- Fire archive alert (one per variant archived this run).
  for v_variant in
    select id from public.page_variants
     where archived_at >= now() - interval '5 minutes'
  loop
    perform net.http_post(
      url := 'https://ytnsipxxmzgaebkqmokp.supabase.co/functions/v1/slack-alert-experiments',
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || v_secret,
        'Content-Type', 'application/json'
      ),
      body := jsonb_build_object(
        'kind', 'archive_42d',
        'variant_id', v_variant.id::text,
        'message', format('Page variant %s archived at 42-day boundary; traffic returned to control', v_variant.id),
        'context', jsonb_build_object('traffic_to_control', true)
      ),
      timeout_milliseconds := 30000
    );
  end loop;

  raise notice 'p39_variant_42day_archive_scan: warned=% archived=%', v_warned_count, v_archived_count;
end
$fn$;

comment on function public.p39_variant_42day_archive_scan() is
  'Phase 39 D-11: daily 42-day variant lifecycle scan. Warns at day 35, hard-cuts at day 42 (sets archived_at + traffic_to_control). Idempotent. Fires slack-alert-experiments via vault decrypted_secrets.';

revoke all on function public.p39_variant_42day_archive_scan() from public;
grant execute on function public.p39_variant_42day_archive_scan() to service_role;

-- ============================================================================
-- p39_refund_rate_kill_scan() — D-02 refund-rate kill
-- ============================================================================

create or replace function public.p39_refund_rate_kill_scan()
returns void
language plpgsql
security definer
set search_path = public, extensions
as $fn$
declare
  v_baseline numeric;
  v_secret text;
  v_killed record;
  v_killed_count int := 0;
begin
  -- Baseline: control 30-day refund rate. Control = subscriptions whose user
  -- has NO non-control user_experiments row for paywall OR whose mapped
  -- variant_id is null. Simplest service-role-safe proxy: refunds among users
  -- with no paywall variant_id assignment in user_experiments.
  -- Refund-rate = refunded subs in window / total subs in window.
  with control_window as (
    select s.id, s.refunded_at
      from public.subscriptions s
     where s.created_at >= now() - interval '30 days'
       and not exists (
         select 1 from public.user_experiments ue
          where ue.user_id = s.user_id
            and ue.surface = 'paywall'
            and ue.variant_id is not null
       )
  )
  select case when count(*) = 0 then 0::numeric
              else count(*) filter (where refunded_at is not null)::numeric / count(*)::numeric
         end
    into v_baseline
    from control_window;

  -- Per non-control variant: compute 7d refund rate among users assigned to it.
  -- Kill if 7d_rate > 2 * baseline AND variant not already archived.
  for v_killed in
    with variant_window as (
      select ue.variant_id,
             count(*) as total,
             count(*) filter (where s.refunded_at is not null
                              and s.refunded_at >= now() - interval '7 days') as refunds_7d
        from public.user_experiments ue
        join public.subscriptions s on s.user_id = ue.user_id
       where ue.surface = 'paywall'
         and ue.variant_id is not null
         and s.created_at >= now() - interval '7 days'
       group by ue.variant_id
    ),
    flagged as (
      select vw.variant_id,
             vw.total,
             vw.refunds_7d,
             (vw.refunds_7d::numeric / nullif(vw.total, 0)::numeric) as rate_7d
        from variant_window vw
       where vw.total > 0
         and (vw.refunds_7d::numeric / nullif(vw.total, 0)::numeric) > 2 * v_baseline
         and 2 * v_baseline > 0
    ),
    killed as (
      update public.variant_config vc
         set archived_at = now()
        from flagged f
       where vc.id = f.variant_id
         and vc.archived_at is null
      returning vc.id, f.rate_7d, f.refunds_7d, f.total
    )
    select * from killed
  loop
    v_killed_count := v_killed_count + 1;

    if v_secret is null then
      select decrypted_secret into v_secret
        from vault.decrypted_secrets
       where name = 'service_role_key'
       limit 1;
    end if;

    if v_secret is not null then
      perform net.http_post(
        url := 'https://ytnsipxxmzgaebkqmokp.supabase.co/functions/v1/slack-alert-experiments',
        headers := jsonb_build_object(
          'Authorization', 'Bearer ' || v_secret,
          'Content-Type', 'application/json'
        ),
        body := jsonb_build_object(
          'kind', 'refund_kill',
          'variant_id', v_killed.id::text,
          'message', format('Paywall variant %s auto-killed: 7d refund rate %s > 2x control baseline %s',
                            v_killed.id,
                            round(v_killed.rate_7d, 4),
                            round(v_baseline, 4)),
          'context', jsonb_build_object(
            'rate_7d', v_killed.rate_7d,
            'baseline_30d', v_baseline,
            'refunds_7d', v_killed.refunds_7d,
            'total_7d', v_killed.total
          )
        ),
        timeout_milliseconds := 30000
      );
    end if;
  end loop;

  raise notice 'p39_refund_rate_kill_scan: baseline=% killed=%', v_baseline, v_killed_count;
end
$fn$;

comment on function public.p39_refund_rate_kill_scan() is
  'Phase 39 D-02: daily refund-rate kill scan. Computes 30d CONTROL baseline + 7d per-variant rate; auto-archives variant_config rows whose 7d rate > 2x baseline. Idempotent (skips already-archived). Reads subscriptions.refunded_at directly with no JWT-derived caller identity (service-role context per T-39-03-04). Fires slack-alert-experiments kind=refund_kill via vault decrypted_secrets.';

revoke all on function public.p39_refund_rate_kill_scan() from public;
grant execute on function public.p39_refund_rate_kill_scan() to service_role;

-- ============================================================================
-- p39_pharma_nps_kill_scan() — D-03 NPS OR 1★ either-trigger
-- ============================================================================

create or replace function public.p39_pharma_nps_kill_scan()
returns void
language plpgsql
security definer
set search_path = public, extensions
as $fn$
declare
  v_secret text;
  v_killed record;
  v_killed_count int := 0;
  v_review_table_exists boolean;
begin
  -- Pre-check: review_submissions table may not exist yet (Plan 39-08 plans it).
  -- If absent, run NPS branch only; skip 1★ branch.
  select to_regclass('public.review_submissions') is not null into v_review_table_exists;

  -- Iterate active pharma variants.
  -- NPS branch: lifetime NPS for variant assignees vs prior-30d baseline.
  --   NPS = (% promoters score>=9) - (% detractors score<=6) scaled to -100..100.
  --   If lifetime NPS < baseline_NPS - 5 (drop of 5+ points), kill.
  for v_killed in
    with assignees as (
      select ue.variant_id, ue.user_id, ue.created_at as assigned_at
        from public.user_experiments ue
        join public.variant_config vc on vc.id = ue.variant_id
       where ue.surface = 'pharma'
         and vc.archived_at is null
    ),
    -- Variant lifetime NPS (responses since assignment, per variant).
    variant_nps as (
      select a.variant_id,
             count(*) as n,
             100.0 * (
               count(*) filter (where qnr.score >= 9)::numeric
               - count(*) filter (where qnr.score <= 6)::numeric
             ) / nullif(count(*), 0)::numeric as nps
        from assignees a
        join public.quarterly_nps_responses qnr
          on qnr.user_id = a.user_id
         and qnr.responded_at >= a.assigned_at
       group by a.variant_id
    ),
    -- Baseline: prior-30d NPS across the entire pharma surface population
    -- (not per-variant — global trend).
    baseline_nps as (
      select 100.0 * (
               count(*) filter (where score >= 9)::numeric
               - count(*) filter (where score <= 6)::numeric
             ) / nullif(count(*), 0)::numeric as nps
        from public.quarterly_nps_responses
       where responded_at >= now() - interval '60 days'
         and responded_at <  now() - interval '30 days'
    ),
    flagged_nps as (
      select vn.variant_id,
             vn.nps as variant_nps,
             bn.nps as baseline_nps
        from variant_nps vn
       cross join baseline_nps bn
       where vn.n >= 5
         and bn.nps is not null
         and vn.nps is not null
         and vn.nps < bn.nps - 5
    ),
    killed as (
      update public.variant_config vc
         set archived_at = now()
        from flagged_nps f
       where vc.id = f.variant_id
         and vc.archived_at is null
      returning vc.id, f.variant_nps, f.baseline_nps, 'nps_drop'::text as trigger_kind
    )
    select * from killed
  loop
    v_killed_count := v_killed_count + 1;
    if v_secret is null then
      select decrypted_secret into v_secret
        from vault.decrypted_secrets
       where name = 'service_role_key'
       limit 1;
    end if;
    if v_secret is not null then
      perform net.http_post(
        url := 'https://ytnsipxxmzgaebkqmokp.supabase.co/functions/v1/slack-alert-experiments',
        headers := jsonb_build_object(
          'Authorization', 'Bearer ' || v_secret,
          'Content-Type', 'application/json'
        ),
        body := jsonb_build_object(
          'kind', 'nps_kill',
          'variant_id', v_killed.id::text,
          'message', format('Pharma variant %s auto-killed: NPS dropped from %s to %s (>=5 point drop)',
                            v_killed.id,
                            round(v_killed.baseline_nps, 1),
                            round(v_killed.variant_nps, 1)),
          'context', jsonb_build_object(
            'variant_nps', v_killed.variant_nps,
            'baseline_nps', v_killed.baseline_nps,
            'trigger', 'nps_drop_5_or_more'
          )
        ),
        timeout_milliseconds := 30000
      );
    end if;
  end loop;

  -- 1★ review-rate branch: skip if table absent on main.
  if v_review_table_exists then
    for v_killed in execute $dyn$
      with assignees as (
        select ue.variant_id, ue.user_id, ue.created_at as assigned_at
          from public.user_experiments ue
          join public.variant_config vc on vc.id = ue.variant_id
         where ue.surface = 'pharma'
           and vc.archived_at is null
      ),
      variant_rate as (
        select a.variant_id,
               count(*) as n,
               count(*) filter (where rs.rating = 1)::numeric / nullif(count(*), 0)::numeric as one_star_rate
          from assignees a
          join public.review_submissions rs
            on rs.user_id = a.user_id
           and rs.submitted_at >= now() - interval '7 days'
         group by a.variant_id
      ),
      baseline_rate as (
        select count(*) filter (where rating = 1)::numeric / nullif(count(*), 0)::numeric as rate
          from public.review_submissions
         where submitted_at >= now() - interval '30 days'
      ),
      flagged as (
        select vr.variant_id,
               vr.one_star_rate,
               br.rate as baseline_rate
          from variant_rate vr
         cross join baseline_rate br
         where vr.n >= 5
           and br.rate is not null
           and br.rate > 0
           and vr.one_star_rate > 2 * br.rate
      ),
      killed as (
        update public.variant_config vc
           set archived_at = now()
          from flagged f
         where vc.id = f.variant_id
           and vc.archived_at is null
        returning vc.id, f.one_star_rate, f.baseline_rate, 'one_star_rate'::text as trigger_kind
      )
      select * from killed
    $dyn$
    loop
      v_killed_count := v_killed_count + 1;
      if v_secret is null then
        select decrypted_secret into v_secret
          from vault.decrypted_secrets
         where name = 'service_role_key'
         limit 1;
      end if;
      if v_secret is not null then
        perform net.http_post(
          url := 'https://ytnsipxxmzgaebkqmokp.supabase.co/functions/v1/slack-alert-experiments',
          headers := jsonb_build_object(
            'Authorization', 'Bearer ' || v_secret,
            'Content-Type', 'application/json'
          ),
          body := jsonb_build_object(
            'kind', 'nps_kill',
            'variant_id', v_killed.id::text,
            'message', format('Pharma variant %s auto-killed: 1-rating rate exceeded 2x baseline', v_killed.id),
            'context', jsonb_build_object('trigger', 'one_star_rate_2x_baseline')
          ),
          timeout_milliseconds := 30000
        );
      end if;
    end loop;
  end if;

  raise notice 'p39_pharma_nps_kill_scan: killed=% (review_table_exists=%)',
               v_killed_count, v_review_table_exists;
end
$fn$;

comment on function public.p39_pharma_nps_kill_scan() is
  'Phase 39 D-03: weekly pharma either-trigger kill (NPS drop >=5 OR 1-rating rate > 2x baseline). NPS branch reads quarterly_nps_responses directly. 1-rating branch defensively probes review_submissions via to_regclass and skips if table absent (Plan 39-08 owns the table). Idempotent. No JWT-derived caller identity used (service-role context per T-39-03-04). Fires slack-alert-experiments kind=nps_kill via vault decrypted_secrets.';

revoke all on function public.p39_pharma_nps_kill_scan() from public;
grant execute on function public.p39_pharma_nps_kill_scan() to service_role;
