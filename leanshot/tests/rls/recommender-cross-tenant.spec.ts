/**
 * Phase 38 Plan 38-03 — Live cross-tenant impersonation proof for the
 * `recommend-next-best-action` Edge Function (T-38-13 mitigation).
 *
 * Project rules honored:
 *   - reference_supabase_project.md — every RLS surface gets a live cross-tenant test
 *   - feedback_rls_per_file_slug_prefix.md — file-scoped slug prefix on cleanup
 *   - reference_rls_fixture_gotrueclient_flake.md — uses admin.generateLink → /auth/v1/verify
 *     plain-fetch helper (NOT supabase-js signInWithPassword) for ES256-signed JWTs
 *
 * What we prove:
 *   T1 — User A's recommender response NEVER includes content rows whose
 *        `visible_to_user_id` points at user B (load-bearing per AI-SPEC §5 Dim 4).
 *   T2 — match_content_embeddings RPC raises EXCEPTION when called with
 *        requesting_user_id=NULL (Guardrail O4 belt+suspenders).
 *
 * Skip behavior:
 *   - When SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / SUPABASE_ANON_KEY missing,
 *     the suite skips cleanly (CI gates on env presence).
 *   - When RECOMMEND_FN_URL is missing, falls back to {SUPABASE_URL}/functions/v1/...
 *
 * NOTE: this suite is registered in vitest-e2e.config.ts include list — the
 * .spec.ts extension matches the affiliate-tier-* convention also living there.
 */
import { randomUUID } from 'node:crypto';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { getUserAccessToken } from './helpers/admin-session';

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;

const SHOULD_RUN = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY && SERVICE);
const describeIfLive = SHOULD_RUN ? describe : describe.skip;

// File-scoped slug prefix per feedback_rls_per_file_slug_prefix
const REC_PREFIX = `p38-rec-${randomUUID().slice(0, 6)}`;

function fnUrl(name: string): string {
  return process.env.RECOMMEND_FN_URL ?? `${SUPABASE_URL}/functions/v1/${name}`;
}

describeIfLive(
  'Phase 38 Plan 38-03 — recommender cross-tenant impersonation proof (T-38-13)',
  () => {
    let admin: SupabaseClient;
    let userAId: string;
    let userBId: string;
    let userAEmail: string;
    let userBEmail: string;
    let userATokenCache: string | null = null;
    /** Content row visible ONLY to user B — user A must NEVER see this. */
    let userBOnlyContentId: string;
    /** Public content row visible to everyone — user A SHOULD be able to see. */
    let publicContentId: string;

    beforeAll(async () => {
      admin = createClient(SUPABASE_URL!, SERVICE!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });

      userAEmail = `${REC_PREFIX}-a-${randomUUID().slice(0, 4)}@leanshot-test.invalid`;
      userBEmail = `${REC_PREFIX}-b-${randomUUID().slice(0, 4)}@leanshot-test.invalid`;

      const { data: userA, error: errA } = await admin.auth.admin.createUser({
        email: userAEmail,
        email_confirm: true,
      });
      if (errA || !userA?.user) throw new Error(`createUser A failed: ${errA?.message}`);
      userAId = userA.user.id;

      const { data: userB, error: errB } = await admin.auth.admin.createUser({
        email: userBEmail,
        email_confirm: true,
      });
      if (errB || !userB?.user) throw new Error(`createUser B failed: ${errB?.message}`);
      userBId = userB.user.id;

      // Seed two content rows + their embeddings: one public (visible_to_user_id=NULL),
      // one private to user B (visible_to_user_id=userBId).
      const fakeEmbedding = Array.from({ length: 1536 }, (_, i) => Math.sin(i + 1) * 0.01);

      const { data: publicRow, error: errPub } = await admin
        .from('content')
        .insert({
          kind: 'kb_article',
          title: `${REC_PREFIX}-public KB`,
          body_md: 'public KB body',
          visible_to_user_id: null,
          published_at: new Date().toISOString(),
        })
        .select('id')
        .single();
      if (errPub || !publicRow) throw new Error(`insert public content failed: ${errPub?.message}`);
      publicContentId = publicRow.id as string;

      const { data: privateRow, error: errPriv } = await admin
        .from('content')
        .insert({
          kind: 'kb_article',
          title: `${REC_PREFIX}-private B-only KB`,
          body_md: 'B-only KB body',
          visible_to_user_id: userBId,
          published_at: new Date().toISOString(),
        })
        .select('id')
        .single();
      if (errPriv || !privateRow) {
        throw new Error(`insert B-only content failed: ${errPriv?.message}`);
      }
      userBOnlyContentId = privateRow.id as string;

      // Insert embeddings for both content rows.
      const { error: errEmb } = await admin.from('content_embeddings').insert([
        {
          content_id: publicContentId,
          embedding: fakeEmbedding,
          body_sha256: `${REC_PREFIX}-public-sha`,
          last_embedded_at: new Date().toISOString(),
          stale: false,
        },
        {
          content_id: userBOnlyContentId,
          embedding: fakeEmbedding,
          body_sha256: `${REC_PREFIX}-private-sha`,
          last_embedded_at: new Date().toISOString(),
          stale: false,
        },
      ]);
      if (errEmb) throw new Error(`insert embeddings failed: ${errEmb.message}`);
    }, 60_000);

    afterAll(async () => {
      // Best-effort file-scoped cleanup — never throws.
      try {
        await admin
          .from('content_embeddings')
          .delete()
          .like('body_sha256', `${REC_PREFIX}%`);
      } catch {
        /* ignore */
      }
      try {
        await admin.from('content').delete().like('title', `${REC_PREFIX}%`);
      } catch {
        /* ignore */
      }
      try {
        await admin.from('recommendation_events').delete().eq('user_id', userAId);
      } catch {
        /* ignore */
      }
      try {
        await admin.from('recommendation_events').delete().eq('user_id', userBId);
      } catch {
        /* ignore */
      }
      try {
        if (userAId) await admin.auth.admin.deleteUser(userAId);
      } catch {
        /* ignore */
      }
      try {
        if (userBId) await admin.auth.admin.deleteUser(userBId);
      } catch {
        /* ignore */
      }
    }, 60_000);

    it(
      'T1: user A recommender response NEVER returns user B private content (load-bearing)',
      async () => {
        if (!userATokenCache) {
          userATokenCache = await getUserAccessToken(userAEmail);
        }
        const res = await fetch(fnUrl('recommend-next-best-action'), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${userATokenCache}`,
            apikey: SUPABASE_ANON_KEY!,
          },
          body: JSON.stringify({ user_id: userAId, surface: 'dashboard' }),
        });
        expect(res.status).toBe(200);
        const body = (await res.json()) as {
          recommendations: Array<{ source_id: string }>;
          fallback: string;
        };
        // The B-only content must NEVER appear in A's response — regardless of
        // whether A's path was personalized or fell back to popularity.
        const leakedIds = body.recommendations
          .map((r) => r.source_id)
          .filter((id) => id === userBOnlyContentId);
        expect(
          leakedIds,
          `cross-tenant leak: user A saw B-only content id ${userBOnlyContentId}`,
        ).toEqual([]);
      },
      45_000,
    );

    it(
      'T2: match_content_embeddings RPC rejects NULL requesting_user_id (Guardrail O4)',
      async () => {
        // Direct RPC call via service_role — this exercises the RAISE EXCEPTION
        // guard in the function body (NOT the Edge Fn).
        const fakeEmbedding = Array.from({ length: 1536 }, (_, i) => Math.sin(i + 1) * 0.01);
        const { error } = await admin.rpc('match_content_embeddings', {
          query_embedding: fakeEmbedding,
          match_count: 5,
          requesting_user_id: null,
          sources: ['content_embeddings'],
        });
        expect(error, 'RPC must reject NULL requesting_user_id').not.toBeNull();
        expect(error?.message ?? '').toMatch(/requesting_user_id/i);
      },
      30_000,
    );
  },
);
