/**
 * Phase 38 Plan 38-03 — multi-surface payload snapshot contract.
 *
 * Locks the response shape for the 4 surfaces (D-01) — dashboard, kb_footer,
 * community_feed, course_landing — so Phase 44 (community), Phase 46 (courses),
 * and Phase 50 (multi-source retrieval) cannot drift the recommender contract
 * without an intentional snapshot update.
 *
 * What we snapshot:
 *   - The KEY SET of each recommendation object (sorted) — NOT the values
 *     (deeplinks / titles / scores vary per call; we just lock the contract shape).
 *   - The presence of `recommendations` + `fallback` at the top level.
 *
 * Skip behavior:
 *   - Live-DB; auto-skips when SUPABASE env vars missing (same gate as recommender.spec.ts).
 */
import { randomUUID } from 'node:crypto';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { getUserAccessToken } from '../rls/helpers/admin-session';

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;

const SHOULD_RUN = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY && SERVICE);
const describeIfLive = SHOULD_RUN ? describe : describe.skip;

const MS_PREFIX = `p38-ms-${randomUUID().slice(0, 6)}`;

function fnUrl(name: string): string {
  return process.env.RECOMMEND_FN_URL ?? `${SUPABASE_URL}/functions/v1/${name}`;
}

type Surface = 'dashboard' | 'kb_footer' | 'community_feed' | 'course_landing';
const SURFACES: Surface[] = ['dashboard', 'kb_footer', 'community_feed', 'course_landing'];

interface RecResponse {
  recommendations: Array<Record<string, unknown>>;
  fallback: 'personalized' | 'popular';
}

/** Reduce a recommender response to a deterministic shape-only fingerprint. */
function fingerprint(body: RecResponse): {
  topLevelKeys: string[];
  fallbackKind: string;
  recommendationKeys: string[];
  hasSurfaceTargetArray: boolean;
} {
  const sample = body.recommendations[0] ?? {};
  return {
    topLevelKeys: Object.keys(body).sort(),
    fallbackKind: typeof body.fallback === 'string' ? 'string' : typeof body.fallback,
    recommendationKeys: Object.keys(sample).sort(),
    hasSurfaceTargetArray: Array.isArray(sample.surface_target),
  };
}

describeIfLive('Phase 38 Plan 38-03 — multi-surface payload contract (D-01)', () => {
  let admin: SupabaseClient;
  let userId: string;
  let userEmail: string;
  let userToken: string;

  beforeAll(async () => {
    admin = createClient(SUPABASE_URL!, SERVICE!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    userEmail = `${MS_PREFIX}-${randomUUID().slice(0, 4)}@leanshot-test.invalid`;
    const { data, error } = await admin.auth.admin.createUser({
      email: userEmail,
      email_confirm: true,
    });
    if (error || !data?.user) throw new Error(`createUser failed: ${error?.message}`);
    userId = data.user.id;
    userToken = await getUserAccessToken(userEmail);
  }, 60_000);

  afterAll(async () => {
    try {
      await admin.from('recommendation_events').delete().eq('user_id', userId);
    } catch {
      /* ignore */
    }
    try {
      if (userId) await admin.auth.admin.deleteUser(userId);
    } catch {
      /* ignore */
    }
  }, 60_000);

  for (const surface of SURFACES) {
    it(
      `payload shape locked for surface=${surface}`,
      async () => {
        const res = await fetch(fnUrl('recommend-next-best-action'), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${userToken}`,
            apikey: SUPABASE_ANON_KEY!,
          },
          body: JSON.stringify({ user_id: userId, surface }),
        });
        expect(res.status).toBe(200);
        const body = (await res.json()) as RecResponse;

        // Snapshot key shape — values (titles, deeplinks, ids, scores) vary per call.
        expect(fingerprint(body)).toMatchSnapshot(`recommender-${surface}-shape`);

        // Shape invariants — also asserted inline to give a clearer failure mode
        // than a snapshot diff would.
        expect(body.recommendations.length).toBeLessThanOrEqual(3);
        expect(['personalized', 'popular']).toContain(body.fallback);
        for (const rec of body.recommendations) {
          // 8 keys from RESEARCH Pattern 5 / D-03 (action_id is optional).
          expect(rec).toHaveProperty('recommendation_id');
          expect(rec).toHaveProperty('source_type');
          expect(rec).toHaveProperty('source_id');
          expect(rec).toHaveProperty('title');
          expect(rec).toHaveProperty('deeplink');
          expect(rec).toHaveProperty('score');
          expect(rec).toHaveProperty('surface_target');
          expect(rec).toHaveProperty('expires_at');
          expect(Array.isArray(rec.surface_target)).toBe(true);
          // The requested surface MUST appear in surface_target (D-01).
          expect(rec.surface_target as string[]).toContain(surface);
        }
      },
      45_000,
    );
  }
});
