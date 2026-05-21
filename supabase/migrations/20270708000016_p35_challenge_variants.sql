-- Phase 35 Plan 35-05 GAME-08 — Challenge variants table (D-20 A/B scope).
-- Max 2 variants per challenge enforced via:
--   1. CHECK (variant_key in ('A','B')) — limits key space to exactly 2 options
--   2. UNIQUE (challenge_id, variant_key) — prevents duplicate key per challenge
-- The create_weekly_challenge SECDEF RPC also enforces jsonb_array_length <= 2 at insert time.

create table public.challenge_variants (
  id uuid primary key default gen_random_uuid(),
  challenge_id uuid not null references public.weekly_challenges(id) on delete cascade,
  -- D-20: exactly 2 possible variants ('A' or 'B')
  variant_key text not null check (variant_key in ('A','B')),
  -- Variant-specific framing override (the A/B treatment text)
  framing text not null check (length(framing) between 3 and 280),
  -- Optional threshold override; null = fall back to parent challenge.threshold
  threshold int check (threshold is null or (threshold > 0 and threshold <= 1000)),
  created_at timestamptz not null default now(),
  -- LOAD-BEARING: prevents a 3rd variant attempt at DB level (D-20 max-2 constraint)
  unique (challenge_id, variant_key)
);

alter table public.challenge_variants enable row level security;

-- Authenticated users read variants only for active/completed challenges
create policy "challenge_variants_read" on public.challenge_variants
  for select to authenticated using (
    exists (
      select 1 from public.weekly_challenges c
       where c.id = challenge_variants.challenge_id
         and (c.status = 'active' or c.status = 'completed')
    )
  );

create policy "challenge_variants_service_write" on public.challenge_variants
  for all to service_role with check (true);

comment on table public.challenge_variants is
  'Phase 35 D-20 — max 2 variants per challenge (CHECK variant_key IN (A,B) + '
  'UNIQUE(challenge_id, variant_key)). PostHog Experiments flag binds variant_key. '
  'Threshold nullable — falls back to parent challenge.threshold when null.';
