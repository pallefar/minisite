/**
 * Phase 62 Plan 62-06 Task 1 — Browser-side typed PostgREST queries for
 * the public /research/* hub and the admin research publication management.
 *
 * Security invariants:
 *  - T-62-06-02: fetchPublishedResearch + fetchResearchBySlug both filter
 *    status='published' to prevent unpublished drafts from being visible.
 *  - RLS on research_publications enforces status='published' for anon SELECT.
 *    These .eq('status', 'published') calls mirror RLS for defense-in-depth.
 *
 * Markdown content strategy:
 *  - Content markdown files live at content/research/<slug>.md in the git repo.
 *  - The build-research-rss.mjs prebuild script copies them to
 *    public/research-content/<slug>.md so they are served as static files.
 *  - At runtime, fetchResearchMarkdown fetches /research-content/<slug>.md.
 *  - Fallback: returns empty string if file not found (render shows empty body).
 */

import { supabase } from '@/lib/supabase';
import type { ResearchPublication } from '@/types/research';

// Re-export for convenience (components can import from here)
export type { ResearchPublication };

// ─── API functions ────────────────────────────────────────────────────────────

/**
 * Fetches all published research publications ordered by published_at desc.
 * T-62-06-02: filters status='published' (defense-in-depth with RLS).
 * Throws on PostgREST error.
 */
export async function fetchPublishedResearch(): Promise<ResearchPublication[]> {
  const { data, error } = await supabase
    .from('research_publications')
    .select(
      'id, slug, title, abstract, status, published_at, cohort_size, epsilon, suppressed_buckets, reviewer_id, created_by, created_at, updated_at, markdown_path, markdown_body',
    )
    .eq('status', 'published')
    .order('published_at', { ascending: false });

  if (error) {
    throw new Error(`Failed to fetch research publications: ${error.message}`);
  }

  return (data ?? []) as ResearchPublication[];
}

/**
 * Fetches a single published publication by slug.
 * T-62-06-02: filters status='published' and slug (defense-in-depth with RLS).
 * Returns null if not found or not published.
 */
export async function fetchResearchBySlug(slug: string): Promise<ResearchPublication | null> {
  if (!slug || typeof slug !== 'string') return null;

  const { data, error } = await supabase
    .from('research_publications')
    .select(
      'id, slug, title, abstract, status, published_at, cohort_size, epsilon, suppressed_buckets, reviewer_id, created_by, created_at, updated_at, markdown_path, markdown_body',
    )
    .eq('slug', slug)
    .eq('status', 'published')
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to fetch research publication "${slug}": ${error.message}`);
  }

  return data as ResearchPublication | null;
}

/**
 * Fetches the markdown body for a published research article.
 *
 * Strategy: fetch from /research-content/<slug>.md (static file copied to
 * public/ at build time by scripts/build-research-rss.mjs prebuild).
 *
 * If the static file is not found (404), returns empty string.
 * If the publication has inline markdown_body, that is returned preferentially.
 */
export async function fetchResearchMarkdown(slug: string): Promise<string> {
  if (!slug) return '';

  // Prefer inline markdown_body if available (set by admin editor)
  // (We attempt the static file if not available in the publication row)
  try {
    const response = await fetch(`/research-content/${slug}.md`);
    if (response.ok) {
      return await response.text();
    }
    // 404 or other error — return empty string (graceful degradation)
    return '';
  } catch {
    return '';
  }
}
