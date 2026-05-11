-- Phase 4 D-04 + AI-05 (Cross-tenant isolation for AI history).
--
-- public.ai_messages — the conversation log written by the `ai-chat` Edge Function.
-- Two rows per round trip: one for the user turn, one for the assistant turn.
--
-- Integrity invariant (T-04-04 mitigation):
--   `user_id` is sourced ONLY from the verified JWT inside the Edge Function
--   (`admin.auth.getUser(jwt) → user.id`). It is NEVER taken from the request
--   body. The RLS `with check (auth.uid() = user_id)` policy enforces this at
--   the database layer for any future direct (non-service-role) writes.
--
-- Audit invariant: NO update / NO delete policy. The conversation is
-- append-only from any client surface; if cleanup is ever needed, it runs
-- via the service role (privileged code path) or as part of the pg_cron
-- ON DELETE CASCADE chain when the parent `auth.users` row is deleted.

create table public.ai_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  mode text not null default 'coach' check (mode in ('coach', 'macro-estimator')),
  model text,
  created_at timestamptz not null default now()
);

create index ai_messages_user_created_idx
  on public.ai_messages (user_id, created_at desc);

alter table public.ai_messages enable row level security;

-- Users can read their own messages.
create policy "ai_messages_select_own"
  on public.ai_messages
  for select
  using (auth.uid() = user_id);

-- Users can insert their own messages. The Edge Function uses the service
-- role to bypass RLS at write time, but still passes `user_id = user.id`
-- (verified JWT) — this policy ensures any future authenticated-client
-- write path (e.g. a Phase 5 "save manual note" UI) cannot impersonate.
create policy "ai_messages_insert_own"
  on public.ai_messages
  for insert
  with check (auth.uid() = user_id);
