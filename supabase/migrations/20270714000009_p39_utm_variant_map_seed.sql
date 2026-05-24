-- Phase 39 Plan 39-01 — utm_variant_map seed (4 rows).
--
-- CONTEXT references (39-CONTEXT.md):
--   D-09 (4 utm_source -> variant mappings: lean, transformation, clinical, default).
--
-- Pattern: chain a CTE so we can insert 4 placeholder variant_config rows for
--   surface='paywall' and reference their ids directly in the same statement.
--   Each variant_config row carries a config jsonb tagging which copy variant
--   it represents; Wave 2 admin UI surfaces the actual copy fields.
--
-- Idempotency: ON CONFLICT (utm_source) DO NOTHING on utm_variant_map.
--   The variant_config inserts are guarded by NOT EXISTS lookups using the
--   config->>'utm_seed_label' tag so re-applying is a no-op.

-- Step 1: seed the 4 variant_config rows (idempotent via NOT EXISTS on the
-- jsonb tag, since variant_config has no natural unique key beyond id).
insert into public.variant_config (surface, config)
select 'paywall',
       jsonb_build_object('utm_seed_label', label, 'copy_variant', label)
from (values ('lean'), ('transformation'), ('clinical'), ('default')) as t(label)
where not exists (
  select 1 from public.variant_config vc
  where vc.surface = 'paywall'
    and vc.config->>'utm_seed_label' = t.label
);

-- Step 2: map utm_source -> the just-seeded variant_config rows.
insert into public.utm_variant_map (utm_source, variant_id)
select t.utm_source, vc.id
from (values
  ('lean'),
  ('transformation'),
  ('clinical'),
  ('default')
) as t(utm_source)
join public.variant_config vc
  on vc.surface = 'paywall'
  and vc.config->>'utm_seed_label' = t.utm_source
on conflict (utm_source) do nothing;
