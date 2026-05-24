-- Phase 39 Plan 39-01 — experiment_results materialized view.
--
-- CONTEXT references (39-CONTEXT.md):
--   D-01 (composite_score = paid_rate * retention_30d_rate as a single column
--   that Ship-Winner reads — multiplicative gate so retention regressions block
--   shipping even with paid lift),
--   D-02 (refund_rate_7d column drives kill-switch cron in Plan 39-03),
--   D-12 (posterior column drives the 95% Bayesian-significance Ship-Winner gate).
--
-- Purpose:
--   Per-variant per-surface aggregation of paid_rate, retention_30d_rate,
--   composite_score, refund_rate_7d, posterior, sample_size. Refreshed by the
--   Phase 51 pg_cron job (extended in close-out Plan 39-10) AFTER traffic
--   matviews are populated.
--
-- Wave 1 ship: matview shape + composite_score column. Per-row aggregation
--   bodies are placeholder NULL for paid_rate / retention_30d_rate /
--   refund_rate_7d / posterior / sample_size — Wave 2 plans populate them via
--   a refresh-SQL RPC that joins subscriptions / activation_events / refunds.
--   composite_score is computed inline as (paid_rate * retention_30d_rate);
--   NULL × NULL = NULL until aggregation lands, which Ship-Winner gates on.
--
-- Pattern: mirrors 20270708000012_p35_leaderboard_matview.sql shape (matview +
--   refresh CONCURRENTLY supported via a unique index on the row key).

create materialized view if not exists public.experiment_results as
select
  ue.variant_id,
  ue.surface,
  null::numeric                                     as paid_rate,
  null::numeric                                     as retention_30d_rate,
  (null::numeric * null::numeric)                   as composite_score,
  null::numeric                                     as refund_rate_7d,
  null::numeric                                     as posterior,
  count(*)::bigint                                  as sample_size
from public.user_experiments ue
where ue.variant_id is not null
group by ue.variant_id, ue.surface;

comment on materialized view public.experiment_results is
  'Phase 39 D-01: per-variant aggregation matview. composite_score = paid_rate '
  '* retention_30d_rate (multiplicative gate). Wave 1 ships SHAPE only; Wave 2 '
  'extends refresh RPC to populate paid_rate / retention_30d_rate / '
  'refund_rate_7d / posterior from subscriptions + activation_events + refunds. '
  'Refreshed by Phase 51 pg_cron job (extended in Plan 39-10 close-out).';

-- Unique index on (variant_id, surface) — required for REFRESH CONCURRENTLY.
-- Surface is non-null in user_experiments check constraint; variant_id non-null
-- in this matview's where clause — so (variant_id, surface) is genuinely unique.
create unique index if not exists experiment_results_variant_surface_idx
  on public.experiment_results (variant_id, surface);
