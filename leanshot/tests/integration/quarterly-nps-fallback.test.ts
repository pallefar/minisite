/**
 * Phase 42 Plan 42-07 (POLISH-12) — Quarterly NPS in-app fallback eligibility test.
 *
 * D-21 fallback: if a user hasn't responded to their quarterly NPS within
 * 30 days of the email send AND they log in during that window, the
 * frontend (Plan 42-10) shows an in-app modal.
 *
 * The eligibility predicate is computed via a SELECT EXISTS query in the
 * frontend store layer; this test pins the predicate's shape and behavior:
 *
 *   isInAppFallbackEligible(userId, quarter) =
 *     EXISTS quarterly_nps_nonces(user_id=$1, quarter=$2)         -- email was sent
 *     AND now() - nonce.created_at > 30 days                       -- 30d window elapsed
 *     AND NOT EXISTS quarterly_nps_responses(user_id, quarter)     -- not yet responded
 *
 * This file pins the data layer behavior via service-role SELECTs against
 * seeded fixtures. The frontend can call this same predicate via a Postgres
 * function or build it from the two SELECT EXISTS subqueries; either way the
 * truth-table tested here is the contract.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const LIVE_OK = Boolean(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY);
const liveDescribe = LIVE_OK ? describe : describe.skip;

const FB_PREFIX = `p42-fallback-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
const FB_QUARTER = '2026-Q2';

// In-test predicate matching the production frontend's data layer contract.
async function isInAppFallbackEligible(
  admin: SupabaseClient,
  userId: string,
  quarter: string,
  windowDays = 30,
): Promise<boolean> {
  const cutoff = new Date(Date.now() - windowDays * 86400 * 1000).toISOString();
  // 1. Email sent (nonce row exists) AND older than `windowDays`.
  const { data: nonces } = await admin
    .from('quarterly_nps_nonces')
    .select('nonce, created_at')
    .eq('user_id', userId)
    .eq('quarter', quarter)
    .lt('created_at', cutoff)
    .limit(1);
  if (!nonces || nonces.length === 0) return false;
  // 2. NOT yet responded.
  const { data: responses } = await admin
    .from('quarterly_nps_responses')
    .select('id')
    .eq('user_id', userId)
    .eq('quarter', quarter)
    .limit(1);
  return !responses || responses.length === 0;
}

liveDescribe('Phase 42 Plan 42-07 — in-app fallback eligibility (D-21)', () => {
  let admin: SupabaseClient;
  let userAId: string;
  let userBId: string;
  let userCId: string;

  beforeAll(async () => {
    admin = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const ts = Date.now();

    const mk = async (slug: string) => {
      const { data, error } = await admin.auth.admin.createUser({
        email: `${FB_PREFIX}-${slug}-${ts}@leanshot.test`,
        password: `P-${crypto.randomUUID().slice(0, 8)}`,
        email_confirm: true,
      });
      if (error) throw new Error(`createUser ${slug}: ${error.message}`);
      return data.user!.id;
    };

    userAId = await mk('a');
    userBId = await mk('b');
    userCId = await mk('c');

    // Backdate user A nonce to >30 days ago. We can't override DEFAULT now()
    // via PostgREST; we INSERT then UPDATE created_at directly.
    const aNonce = `${FB_PREFIX}-a-${crypto.randomUUID()}`;
    await admin.from('quarterly_nps_nonces').insert({
      nonce: aNonce,
      user_id: userAId,
      quarter: FB_QUARTER,
    });
    const oldDate = new Date(Date.now() - 31 * 86400 * 1000).toISOString();
    await admin
      .from('quarterly_nps_nonces')
      .update({ created_at: oldDate })
      .eq('nonce', aNonce);

    // User B: nonce sent, but ALSO responded — should be ineligible.
    const bNonce = `${FB_PREFIX}-b-${crypto.randomUUID()}`;
    await admin.from('quarterly_nps_nonces').insert({
      nonce: bNonce,
      user_id: userBId,
      quarter: FB_QUARTER,
    });
    await admin
      .from('quarterly_nps_nonces')
      .update({ created_at: oldDate, used_at: oldDate })
      .eq('nonce', bNonce);
    await admin.from('quarterly_nps_responses').insert({
      user_id: userBId,
      quarter: FB_QUARTER,
      score: 7,
      responded_via: 'email',
    });

    // User C: nonce sent <30 days ago — within window, NOT yet eligible.
    const cNonce = `${FB_PREFIX}-c-${crypto.randomUUID()}`;
    await admin.from('quarterly_nps_nonces').insert({
      nonce: cNonce,
      user_id: userCId,
      quarter: FB_QUARTER,
    });
  }, 90_000);

  afterAll(async () => {
    if (!admin) return;
    for (const uid of [userAId, userBId, userCId].filter(Boolean)) {
      try {
        await admin.from('quarterly_nps_responses').delete().eq('user_id', uid);
      } catch { /* best-effort */ }
      try {
        await admin.from('quarterly_nps_nonces').delete().eq('user_id', uid);
      } catch { /* best-effort */ }
      try {
        await admin.auth.admin.deleteUser(uid);
      } catch { /* best-effort */ }
    }
  }, 60_000);

  it('user A (nonce >30d ago, no response) → eligible', async () => {
    expect(await isInAppFallbackEligible(admin, userAId, FB_QUARTER)).toBe(true);
  });

  it('user B (already responded) → ineligible', async () => {
    expect(await isInAppFallbackEligible(admin, userBId, FB_QUARTER)).toBe(false);
  });

  it('user C (nonce <30d ago) → ineligible (still in email window)', async () => {
    expect(await isInAppFallbackEligible(admin, userCId, FB_QUARTER)).toBe(false);
  });
});
