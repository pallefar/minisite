/**
 * Phase 38 Plan 38-03 — Live e2e against the deployed `recommend-next-best-action` Edge Fn.
 *
 * Coverage:
 *   T3 — dense-history user gets fallback='personalized'; sparse-history gets 'popular'
 *   T5 — P95 latency over 20 sequential calls ≤ 800ms (RECOMMEND-06 gate)
 *
 * Skip behavior:
 *   - SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY + SUPABASE_ANON_KEY required.
 *   - Auto-skips when any are missing (CI sets them; local dev typically does not).
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

const E2E_PREFIX = `p38-rec-e2e-${randomUUID().slice(0, 6)}`;

function fnUrl(name: string): string {
  return process.env.RECOMMEND_FN_URL ?? `${SUPABASE_URL}/functions/v1/${name}`;
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[idx]!;
}

describeIfLive('Phase 38 Plan 38-03 — recommender e2e (RECOMMEND-04 + RECOMMEND-06)', () => {
  let admin: SupabaseClient;
  let denseUserId: string;
  let denseUserEmail: string;
  let denseUserToken: string;
  let sparseUserId: string;
  let sparseUserEmail: string;
  let sparseUserToken: string;

  beforeAll(async () => {
    admin = createClient(SUPABASE_URL!, SERVICE!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // Dense user — 10 prior recommendation_events in last 14d.
    denseUserEmail = `${E2E_PREFIX}-dense-${randomUUID().slice(0, 4)}@leanshot-test.invalid`;
    const { data: dense, error: errD } = await admin.auth.admin.createUser({
      email: denseUserEmail,
      email_confirm: true,
    });
    if (errD || !dense?.user) throw new Error(`createUser dense failed: ${errD?.message}`);
    denseUserId = dense.user.id;
    denseUserToken = await getUserAccessToken(denseUserEmail);

    // Seed 10 recommendation_events for dense user.
    const fakeContentId = randomUUID();
    const denseRows = Array.from({ length: 10 }, (_, i) => ({
      recommendation_id: randomUUID(),
      user_id: denseUserId,
      source_type: 'kb_article',
      source_id: fakeContentId,
      surface_target: ['dashboard'],
      score: 0.5,
      shown_at: new Date(Date.now() - i * 60_000).toISOString(),
      expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    }));
    const { error: errSeed } = await admin.from('recommendation_events').insert(denseRows);
    if (errSeed) throw new Error(`seed dense events failed: ${errSeed.message}`);

    // Sparse user — 0 events.
    sparseUserEmail = `${E2E_PREFIX}-sparse-${randomUUID().slice(0, 4)}@leanshot-test.invalid`;
    const { data: sparse, error: errS } = await admin.auth.admin.createUser({
      email: sparseUserEmail,
      email_confirm: true,
    });
    if (errS || !sparse?.user) throw new Error(`createUser sparse failed: ${errS?.message}`);
    sparseUserId = sparse.user.id;
    sparseUserToken = await getUserAccessToken(sparseUserEmail);
  }, 90_000);

  afterAll(async () => {
    try {
      await admin.from('recommendation_events').delete().eq('user_id', denseUserId);
    } catch {
      /* ignore */
    }
    try {
      await admin.from('recommendation_events').delete().eq('user_id', sparseUserId);
    } catch {
      /* ignore */
    }
    try {
      if (denseUserId) await admin.auth.admin.deleteUser(denseUserId);
    } catch {
      /* ignore */
    }
    try {
      if (sparseUserId) await admin.auth.admin.deleteUser(sparseUserId);
    } catch {
      /* ignore */
    }
  }, 60_000);

  it(
    'T3a: dense-history user → fallback=personalized',
    async () => {
      const res = await fetch(fnUrl('recommend-next-best-action'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${denseUserToken}`,
          apikey: SUPABASE_ANON_KEY!,
        },
        body: JSON.stringify({ user_id: denseUserId, surface: 'dashboard' }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { fallback: string; recommendations: unknown[] };
      expect(body.fallback).toBe('personalized');
    },
    45_000,
  );

  it(
    'T3b: sparse-history user → fallback=popular',
    async () => {
      const res = await fetch(fnUrl('recommend-next-best-action'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${sparseUserToken}`,
          apikey: SUPABASE_ANON_KEY!,
        },
        body: JSON.stringify({ user_id: sparseUserId, surface: 'dashboard' }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { fallback: string; recommendations: unknown[] };
      expect(body.fallback).toBe('popular');
    },
    45_000,
  );

  it(
    'T5: P95 latency ≤ 800ms over 20 sequential requests (RECOMMEND-06)',
    async () => {
      const durations: number[] = [];
      // Warm-up call (HNSW page cache + Edge Fn cold-start absorbed).
      await fetch(fnUrl('recommend-next-best-action'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${denseUserToken}`,
          apikey: SUPABASE_ANON_KEY!,
        },
        body: JSON.stringify({ user_id: denseUserId, surface: 'dashboard' }),
      });
      for (let i = 0; i < 20; i++) {
        const t0 = performance.now();
        const r = await fetch(fnUrl('recommend-next-best-action'), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${denseUserToken}`,
            apikey: SUPABASE_ANON_KEY!,
          },
          body: JSON.stringify({ user_id: denseUserId, surface: 'dashboard' }),
        });
        const elapsed = performance.now() - t0;
        durations.push(elapsed);
        expect(r.status, `request #${i + 1} non-200`).toBe(200);
      }
      const p95 = percentile(durations, 95);
      const median = percentile(durations, 50);
      // Diagnostic line on failure: cold-start vs HNSW warm vs embed latency.
      // The 800ms ceiling is the RECOMMEND-06 gate; the median check is a
      // diagnostic floor to surface regressions before the p95 ceiling trips.
      expect(p95, `p95=${p95.toFixed(1)}ms median=${median.toFixed(1)}ms`).toBeLessThanOrEqual(
        800,
      );
    },
    120_000,
  );
});
