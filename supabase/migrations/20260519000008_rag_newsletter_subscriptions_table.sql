-- Phase 50: rag_newsletter_subscriptions — per-user Research newsletter prefs per D-31/D-35
--
-- One row per user (UNIQUE user_id). frequency='off' or unsubscribed_at IS NOT NULL
-- means do-not-send. tags_followed[] filters which research-tag updates the user
-- wants in their weekly digest.
--
-- Idempotent.

create table if not exists public.rag_newsletter_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  frequency text not null check (frequency in ('weekly', 'off')) default 'weekly',
  tags_followed text[] not null default '{}',
  unsubscribed_at timestamptz,
  last_sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists rag_newsletter_subscriptions_user_uq
  on public.rag_newsletter_subscriptions (user_id);

do $$
begin
  if not exists (
    select 1 from pg_trigger where tgname = 'trg_rag_newsletter_subscriptions_updated_at'
  ) then
    create trigger trg_rag_newsletter_subscriptions_updated_at
      before update on public.rag_newsletter_subscriptions
      for each row execute function public.tg_set_updated_at();
  end if;
end $$;

alter table public.rag_newsletter_subscriptions enable row level security;
