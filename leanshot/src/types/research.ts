/**
 * Phase 62 Plan 62-05 Task 0 — Canonical ResearchPublication type export.
 *
 * Single source of truth for the ResearchPublication domain type.
 * Consumed by:
 *   - Plan 62-05 admin UI (PublicationsListPage, PublicationEditorPage)
 *   - Plan 62-06 public hub (ResearchArticlePage, lib/research/api.ts)
 *
 * Shape mirrors the research_publications DB schema from Plan 62-01
 * + the epsilon/cohort_size/suppressed_buckets columns from Plan 62-02.
 *
 * Imported as: `import type { ResearchPublication, ResearchPublicationStatus } from '@/types/research';`
 * DO NOT re-declare this type in any consumer file.
 */

export type ResearchPublicationStatus = 'draft' | 'in_review' | 'published' | 'archived';

export interface ResearchPublication {
  id: string;
  slug: string;
  markdown_path: string;
  markdown_body: string | null;
  title: string;
  abstract: string | null;
  status: ResearchPublicationStatus;
  created_by: string | null;
  reviewer_id: string | null;
  published_at: string | null;
  cohort_size: number | null;
  epsilon: number | null;
  suppressed_buckets: number | null;
  created_at: string;
  updated_at: string;
}
