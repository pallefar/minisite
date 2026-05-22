-- Phase 36 Plan 36-01 — REVIEW-03: review_prompt_history append-only log.
--
-- CONTEXT references:
--   - D-05/D-08: hybrid cooldown (per-rule 30d + global 60d + 5-lifetime cap)
--     keyed on user_id; multi-device-respecting (server is source of truth).
--   - D-06: detractor suppression — extends to 90d after 1-2★ rating.
--   - D-07: lifetime cap is absolute (never reset).
--   - B2 fix (plan-checker iter-1): copy_variant text NULL column for Wave 4
--     `review_funnel_aggregate` by_variant breakdown. No events_mirror fallback.
--     Wave 2 step 10 INSERT writes the variant string sourced from PostHog flag
--     resolution (e.g. 'control', 'variant_a'). NULL = pre-A/B-experiment legacy.
--
-- Append-only contract (Pattern 6 from RESEARCH.md):
--   - user SELECT own; service-role INSERT; UPDATE + DELETE denied for all roles.
--   - rule_id ON DELETE SET NULL preserves history when admin deletes a rule.

begin;

create table if not exists public.review_prompt_history (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null references auth.users(id) on delete cascade,
  rule_id               uuid references public.review_prompt_rules(id) on delete set null,
  fired_at              timestamptz not null default now(),
  surface_dismissed_at  timestamptz,
  rating_value          int check (rating_value between 1 and 5),
  -- B2 fix: A/B variant breakdown column. Wave 2 writes the PostHog-resolved
  -- variant slug at INSERT time; Wave 4 funnel RPC reads this column directly.
  copy_variant          text null
);

comment on table public.review_prompt_history is
  'REVIEW-03: append-only NPS prompt fire log. Keyed on user_id; cross-device '
  'cooldown source of truth (D-08). copy_variant (B2 fix) carries the '
  'PostHog-resolved A/B variant slug — consumed by Wave 4 funnel aggregation. '
  'Lifetime cap (D-07) is enforced by Edge Fn checking row count; this table '
  'is append-only by RLS (no UPDATE/DELETE policies).';

create index if not exists ix_review_prompt_history_user_fired
  on public.review_prompt_history (user_id, fired_at desc);

create index if not exists ix_review_prompt_history_copy_variant
  on public.review_prompt_history (copy_variant)
  where copy_variant is not null;

alter table public.review_prompt_history enable row level security;

-- User can SELECT own rows.
drop policy if exists review_prompt_history_user_select on public.review_prompt_history;
create policy review_prompt_history_user_select
  on public.review_prompt_history
  for select
  to authenticated
  using (user_id = auth.uid());

-- Service-role INSERT only (Wave 2 Edge Fn writes).
drop policy if exists review_prompt_history_service_insert on public.review_prompt_history;
create policy review_prompt_history_service_insert
  on public.review_prompt_history
  for insert
  to service_role
  with check (true);

-- NO UPDATE / DELETE policies — append-only. RLS default-denies for all roles.

commit;
