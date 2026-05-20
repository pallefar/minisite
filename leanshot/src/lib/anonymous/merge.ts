/**
 * Phase 34 Plan 34-05 — browser-side caller for the `merge-anon-session`
 * Edge Function.
 *
 * Plan 34-06 (`useConsumerOnboardingFlow`) wires the call site post-signup.
 * This module is the typed contract between browser and Edge Fn — the wire
 * shape is locked in by `merge.test.ts`.
 *
 * Contract:
 *   POST /functions/v1/merge-anon-session
 *   Authorization: Bearer <supabase user access token>
 *   Body: { cookie_ids: string[1..8], anon_distinct_id?: string }
 *   Response (200):
 *     - { merged: true,  draft_entries: unknown[] }
 *     - { merged: false }
 *
 * The caller does NOT manually retry — fail-open is intentional: the user's
 * authenticated session is already valid; losing the anon preferences merge
 * once is acceptable, but blocking signup completion on a merge failure is
 * not (D-08 buckets are nice-to-have, not load-bearing).
 */

export interface MergeAnonSessionRequest {
  cookie_ids: string[];
  anon_distinct_id?: string;
}

export interface MergeAnonSessionSuccess {
  merged: true;
  draft_entries: unknown[];
}

export interface MergeAnonSessionNoop {
  merged: false;
}

export type MergeAnonSessionResponse = MergeAnonSessionSuccess | MergeAnonSessionNoop;

export interface CallMergeAnonSessionArgs {
  /** Supabase Functions base URL — typically `${SUPABASE_URL}/functions/v1`. */
  functionsBaseUrl: string;
  /** Supabase access token (Bearer JWT) from the post-signup session. */
  accessToken: string;
  /** Request body — cookie_ids + optional posthog anon_distinct_id. */
  body: MergeAnonSessionRequest;
  /** Test seam — defaults to global fetch. */
  fetchImpl?: typeof fetch;
}

/**
 * POST to `/functions/v1/merge-anon-session` with the auth-bearer + body shape
 * locked in `merge.test.ts`. Returns the parsed JSON response; the caller
 * decides whether to replay draft_entries into the dashboard.
 *
 * Errors (network / non-200) bubble — Plan 34-06's hook catches and degrades.
 */
export async function callMergeAnonSession(
  args: CallMergeAnonSessionArgs,
): Promise<MergeAnonSessionResponse> {
  const fetcher = args.fetchImpl ?? fetch;
  const url = `${args.functionsBaseUrl.replace(/\/$/, '')}/merge-anon-session`;
  const res = await fetcher(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${args.accessToken}`,
    },
    body: JSON.stringify(args.body),
  });
  if (!res.ok) {
    throw new Error(`merge-anon-session HTTP ${res.status}`);
  }
  const json = (await res.json()) as MergeAnonSessionResponse;
  return json;
}
