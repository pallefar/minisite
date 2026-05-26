/**
 * Phase 60 Plan 60-13 — Topic slug ↔ display name mapping.
 *
 * Shared between the browser hub components and the build-time
 * scripts/build-sitemap.ts script. Any change to the slug set here MUST
 * be reflected in rag_chunks.topic_tag values in the database.
 *
 * RESERVED_SLUGS: these must never be used as chunk slugs (enforced at API
 * layer + 60-01 RPC at write time). Checked via isReservedSlug().
 *
 * T-60-13-INFO-3: reserved-slug validator prevents articles from being
 * reachable at /knowledge/<topic>/index etc., which could clash with
 * internal routing or indexing.
 */

// ─── Reserved slug values ────────────────────────────────────────────────────

export const RESERVED_SLUGS = [
  'index',
  'search',
  'topics',
  'rss',
  'feed',
  'latest',
  'popular',
] as const;

export type ReservedSlug = (typeof RESERVED_SLUGS)[number];

/**
 * Returns true if `s` is in the RESERVED_SLUGS list.
 * Used at API layer (zod refine) to reject reserved values before PostgREST.
 */
export function isReservedSlug(s: string): boolean {
  return (RESERVED_SLUGS as readonly string[]).includes(s);
}

// ─── Topic display names ─────────────────────────────────────────────────────

/**
 * Canonical slug → display name mapping for v1.4 corpus topics.
 * Keys MUST match rag_chunks.topic_tag values in the database.
 *
 * Format: kebab-case slug → Title Case display name.
 */
export const TOPIC_DISPLAY_NAMES: Record<string, string> = {
  'glp-1': 'GLP-1 Agonists',
  'peptide-research': 'Peptide Research',
  'off-label-safety': 'Off-Label Safety',
  'metabolic-health': 'Metabolic Health',
  tirzepatide: 'Tirzepatide',
  semaglutide: 'Semaglutide',
  liraglutide: 'Liraglutide',
  compounding: 'Compounding',
  nutrition: 'Nutrition',
  lifestyle: 'Lifestyle',
};

/**
 * Returns the display name for a topic slug, or title-cases the slug as a
 * fallback (e.g. 'new-topic' → 'New-topic').
 */
export function getTopicDisplayName(slug: string): string {
  if (slug in TOPIC_DISPLAY_NAMES) {
    return TOPIC_DISPLAY_NAMES[slug]!;
  }
  // Fallback: title-case the first word of the slug
  return slug
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}
