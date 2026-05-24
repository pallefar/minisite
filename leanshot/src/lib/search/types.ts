/**
 * Phase 49 Plan 09 — search result types.
 *
 * Mirror of the search_content RPC return shape (see
 * supabase/migrations/20271001000004_p49_search_content_rpc.sql). The
 * discriminant `type` keys the row into Posts / Lessons / Events sections;
 * the auxiliary id fields (space_id / course_id / module_id / start_at)
 * are populated per type by the RPC.
 *
 * Pure-types module — NO runtime imports (LOCKED so the search chunk
 * doesn't pay any extra index-graph cost).
 */

export type SearchResultType = 'post' | 'lesson' | 'event';

export interface SearchResult {
  type: SearchResultType;
  id: string;
  title: string | null;
  snippet: string | null;
  rank: number;
  space_id: string | null;
  course_id: string | null;
  module_id: string | null;
  start_at: string | null;
}
