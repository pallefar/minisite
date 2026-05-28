/**
 * Phase 62 Plan 62-05 — Canonical ResearchPublication types.
 *
 * Single source of truth for the research_publications domain type.
 * Consumed by:
 *   - Plan 62-05 admin UI (PublicationsListPage, PublicationEditorPage)
 *   - Plan 62-06 public hub (ResearchIndexPage, ResearchArticlePage, lib/research/api.ts)
 *
 * Shape mirrors the DB schema from:
 *   supabase/migrations/20290102000001_insights_schema.sql       (base table)
 *   supabase/migrations/20290102000006_insights_secdef_rpcs.sql  (markdown_body column added)
 *
 * IMPORTANT: Do not widen these interfaces without a corresponding
 * migration — they are the single source of truth for DB ↔ UI contracts.
 *
 * Imported as: `import type { ResearchPublication, ResearchPublicationStatus } from '@/types/research';`
 * DO NOT re-declare this type in any consumer file (per Plan 62-06 revision iter-1).
 */

/** State machine for research publication review workflow (mirrors ENUM). */
export type ResearchPublicationStatus = 'draft' | 'in_review' | 'published' | 'archived';

/**
 * A research publication (white-paper).
 * 2-person review rule: published requires reviewer !== created_by (enforced via SECDEF RPC).
 */
export interface ResearchPublication {
  id: string; // uuid
  slug: string; // URL-friendly identifier
  markdown_path: string; // path to .md file in content/research/
  markdown_body: string | null; // inline markdown content (added Plan 62-02 Task 2)
  title: string;
  abstract: string | null;
  status: ResearchPublicationStatus;
  created_by: string | null; // uuid of authoring admin
  reviewer_id: string | null; // uuid of reviewing admin (NOT created_by)
  published_at: string | null; // ISO timestamptz
  cohort_size: number | null; // participant count from compile_research_cohort
  epsilon: number | null; // differential privacy epsilon used
  suppressed_buckets: number | null; // DP suppressed bucket count
  created_at: string; // ISO timestamptz
  updated_at: string; // ISO timestamptz; set by tg_set_updated_at trigger
}
