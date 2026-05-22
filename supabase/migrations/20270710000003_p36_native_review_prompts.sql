-- Phase 36 Plan 36-01 — REVIEW-08 / D-18: native_review_prompts scaffolding.
--
-- CONTEXT references:
--   - D-17/D-18/D-19: server-side fire-log for native (iOS SKStoreReviewController +
--     Android In-App Review). v1.3 ships EMPTY — no fires until v1.4 Capacitor
--     mobile shell wires the plugin call site. Schema lock-in only.
--   - V13-3 BLOCKER (D-21): native fire path NEVER conditional on rating.
--
-- Quotas per platform (D-19):
--   - iOS: 3 fires per rolling 365d (Apple policy enforced client-side by OS;
--     server refuses beyond cap to avoid wasted requests).
--   - Android: per Google's In-App Review quota (also enforced server-side).
--
-- Append-only contract: same shape as review_prompt_history (Pattern 6).

begin;

create table if not exists public.native_review_prompts (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  platform   text not null check (platform in ('ios','android')),
  fired_at   timestamptz not null default now()
);

comment on table public.native_review_prompts is
  'REVIEW-08 / D-18: native review-prompt fire log (iOS SKStoreReview / '
  'Android In-App Review). v1.3 ships empty — v1.4 Capacitor mobile shell '
  'wires the plugin call site. Cross-platform quotas tracked separately per '
  'D-19; web NPS quota (5 lifetime from D-05) is SEPARATE from native quota.';

create index if not exists ix_native_review_prompts_user_platform_fired
  on public.native_review_prompts (user_id, platform, fired_at desc);

alter table public.native_review_prompts enable row level security;

-- Deny all direct DML for authenticated. Service-role INSERT only (v1.4 Edge Fn).
-- v1.3: no INSERT path exists (per D-18 — empty table).
drop policy if exists native_review_prompts_service_insert on public.native_review_prompts;
create policy native_review_prompts_service_insert
  on public.native_review_prompts
  for insert
  to service_role
  with check (true);

-- User SELECT own (rare — admin debugging only — but keep symmetric with web NPS).
drop policy if exists native_review_prompts_user_select on public.native_review_prompts;
create policy native_review_prompts_user_select
  on public.native_review_prompts
  for select
  to authenticated
  using (user_id = auth.uid());

-- NO UPDATE / DELETE policies — append-only.

commit;
