/**
 * Phase 49 Plan 09 — searchContent RPC wrapper.
 *
 * Thin wrapper around `supabase.rpc('search_content', {...})` with zod
 * validation on the return shape. Front-loaded guards:
 *   - query.length < 3 → returns [] without calling the RPC (matches the
 *     min-3-char gate enforced in useDebouncedSearch + UI text).
 *   - lang defaults to 'english' but can be 'spanish' (per RPC signature
 *     in supabase/migrations/20271001000004).
 *
 * Errors:
 *   - PostgREST error → re-throw so the caller can render an error state.
 *   - Zod parse failure → re-throw (silent shape drift would mask schema bugs).
 */
import { z } from 'zod';
import { supabase } from '@/lib/supabase';
import type { SearchResult } from './types';

const searchRowSchema = z.object({
  type: z.enum(['post', 'lesson', 'event']),
  id: z.string().uuid(),
  title: z.string().nullable(),
  snippet: z.string().nullable(),
  rank: z.number(),
  space_id: z.string().uuid().nullable(),
  course_id: z.string().uuid().nullable(),
  module_id: z.string().uuid().nullable(),
  start_at: z.string().nullable(),
});

export async function searchContent(
  query: string,
  lang: 'english' | 'spanish' = 'english',
): Promise<SearchResult[]> {
  if (query.length < 3) return [];
  const { data, error } = await supabase.rpc('search_content', {
    p_query: query,
    p_lang: lang,
  });
  if (error) throw error;
  return z.array(searchRowSchema).parse(data ?? []);
}
