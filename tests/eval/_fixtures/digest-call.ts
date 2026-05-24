/**
 * Phase 38 Plan 38-10 — Helper to invoke the deployed digest + recommender
 * Edge Functions against the linked staging Supabase project.
 *
 * Uses the same Bearer-auth pattern as the production caller (winback-scorer
 * cron). Returns the raw JSON envelope plus the perf marker for cost-latency
 * tests.
 *
 * All callers MUST check SHOULD_RUN_EVAL before invoking; this helper does
 * not re-check (kept thin so failure modes surface in the test, not here).
 */
import { STAGING_BASE_URL } from './refset.ts';
import type { UserFactsForDigest } from '../_judge/llm-judge.ts';

export interface DigestEdgeResponse {
  narrative: string;
  actions: Array<{ id: string; reason: string }>;
}

export interface DigestCallResult {
  ok: boolean;
  status: number;
  body: DigestEdgeResponse | { error: string };
  latency_ms: number;
}

/**
 * Call the deployed `weekly-digest-summarize` Edge Function with the given
 * synthetic user facts. The function runs against linked staging Supabase
 * with the test seeder providing the user row + org row.
 */
export async function callDigest(
  userFacts: UserFactsForDigest,
  options: { fnName?: string; bearer?: string } = {},
): Promise<DigestCallResult> {
  const fnName = options.fnName ?? 'weekly-digest-summarize';
  const bearer = options.bearer ?? process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
  const url = `${STAGING_BASE_URL.replace(/\/$/, '')}/${fnName}`;
  const t0 = Date.now();
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${bearer}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ user_facts: userFacts }),
  });
  const latency_ms = Date.now() - t0;
  const text = await res.text();
  let body: DigestCallResult['body'];
  try {
    body = JSON.parse(text) as DigestCallResult['body'];
  } catch {
    body = { error: text.slice(0, 500) };
  }
  return { ok: res.ok, status: res.status, body, latency_ms };
}

export interface RecommenderItem {
  content_id: string;
  tags?: string[];
  score?: number;
  visible_to_user_id?: string | null;
  org_id?: string | null;
  published_at?: string | null;
  stale?: boolean;
}

export interface RecommenderCallResult {
  ok: boolean;
  status: number;
  items: RecommenderItem[];
  latency_ms: number;
}

export async function callRecommender(
  userId: string,
  options: { fnName?: string; bearer?: string; limit?: number } = {},
): Promise<RecommenderCallResult> {
  const fnName = options.fnName ?? 'recommend-next-best-action';
  const bearer = options.bearer ?? process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
  const limit = options.limit ?? 3;
  const url = `${STAGING_BASE_URL.replace(/\/$/, '')}/${fnName}`;
  const t0 = Date.now();
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${bearer}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ user_id: userId, limit }),
  });
  const latency_ms = Date.now() - t0;
  const text = await res.text();
  let items: RecommenderItem[] = [];
  try {
    const parsed = JSON.parse(text) as { items?: RecommenderItem[] };
    items = parsed.items ?? [];
  } catch {
    // leave items empty
  }
  return { ok: res.ok, status: res.status, items, latency_ms };
}
