/**
 * Phase 22 Plan 22-12 — RLS proof for `public.consent_records` (GDPR-02).
 *
 * Behaviors (Wave 0 it.skip replaced with live cross-tenant proofs):
 *   T1 anonymous client INSERT with user_id=null + anonymous_id → permitted
 *      (cookie consent banner shipping pre-signup uses this path).
 *   T2 authenticated user A INSERT with own user_id → permitted; row appears
 *      in user A's SELECT.
 *   T3 user B SELECT for user A's row → ZERO results (cross-tenant deny).
 *   T4 authenticated DELETE → 42501 (append-only audit per GDPR Art. 7(1);
 *      no DELETE policy installed by plan 22-01 migration).
 *
 * Per-file slug prefix `phase22-consent-records-rls`.
 *
 * Auto-skips when SUPABASE_SERVICE_ROLE_KEY missing.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const ANON = process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SHOULD_RUN = Boolean(URL && ANON && SERVICE);
const describeIfLive = SHOULD_RUN ? describe : describe.skip;

const CONSENT_RECORDS_PREFIX = 'phase22-consent-records-rls';

describeIfLive('Phase 22 plan 22-12 — RLS consent_records', () => {
  let admin: SupabaseClient | null = null;
  const getAdmin = (): SupabaseClient => {
    if (!admin) {
      admin = createClient(URL!, SERVICE!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
    }
    return admin;
  };

  let userA: { id: string; client: SupabaseClient } | null = null;
  let userB: { id: string; client: SupabaseClient } | null = null;
  const createdUserIds: string[] = [];
  const seededAnonIds: string[] = [];

  beforeAll(async () => {
    const adminClient = getAdmin();
    const stamp = Date.now();
    const emailA = `${CONSENT_RECORDS_PREFIX}-a-${stamp}@leanshot.test`;
    const emailB = `${CONSENT_RECORDS_PREFIX}-b-${stamp}@leanshot.test`;
    const pwA = `Pass1234-${crypto.randomUUID().slice(0, 8)}`;
    const pwB = `Pass1234-${crypto.randomUUID().slice(0, 8)}`;

    const aRes = await adminClient.auth.admin.createUser({
      email: emailA,
      password: pwA,
      email_confirm: true,
    });
    if (aRes.error) throw aRes.error;
    const bRes = await adminClient.auth.admin.createUser({
      email: emailB,
      password: pwB,
      email_confirm: true,
    });
    if (bRes.error) throw bRes.error;

    const aClient = createClient(URL!, ANON!, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
        storageKey: `${CONSENT_RECORDS_PREFIX}-a`,
      },
    });
    const bClient = createClient(URL!, ANON!, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
        storageKey: `${CONSENT_RECORDS_PREFIX}-b`,
      },
    });
    {
      const { error } = await aClient.auth.signInWithPassword({ email: emailA, password: pwA });
      if (error) throw error;
    }
    {
      const { error } = await bClient.auth.signInWithPassword({ email: emailB, password: pwB });
      if (error) throw error;
    }

    userA = { id: aRes.data.user!.id, client: aClient };
    userB = { id: bRes.data.user!.id, client: bClient };
    createdUserIds.push(userA.id, userB.id);
  }, 60_000);

  afterAll(async () => {
    if (!admin) return;
    for (const id of createdUserIds) {
      try {
        await admin.from('consent_records').delete().eq('user_id', id);
      } catch {
        /* best-effort */
      }
    }
    for (const aid of seededAnonIds) {
      try {
        await admin.from('consent_records').delete().eq('anonymous_id', aid);
      } catch {
        /* best-effort */
      }
    }
    for (const id of createdUserIds) {
      try {
        await admin.auth.admin.deleteUser(id);
      } catch {
        /* best-effort */
      }
    }
  });

  it('anonymous INSERT with user_id=null + anonymous_id permitted (pre-signup banner path)', async () => {
    // Use a fresh anon client (no signed-in user).
    const anonClient = createClient(URL!, ANON!, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
        storageKey: `${CONSENT_RECORDS_PREFIX}-anon`,
      },
    });
    const anonId = `${CONSENT_RECORDS_PREFIX}-${crypto.randomUUID()}`;
    seededAnonIds.push(anonId);

    const { error } = await anonClient.from('consent_records').insert({
      user_id: null,
      anonymous_id: anonId,
      categories: { essential: true, analytics: false, marketing: false, personalization: false },
      decision_type: 'reject_all',
      user_agent: 'jsdom test',
      country_code: 'DE',
    });
    expect(error).toBeNull();
  }, 30_000);

  it('authenticated user A INSERT with own user_id permitted; cross-tenant user B SELECT returns []', async () => {
    const a = userA!;
    const b = userB!;
    const anonId = `${CONSENT_RECORDS_PREFIX}-${crypto.randomUUID()}`;
    seededAnonIds.push(anonId);

    const { error: insErr } = await a.client.from('consent_records').insert({
      user_id: a.id,
      anonymous_id: anonId,
      categories: { essential: true, analytics: true, marketing: false, personalization: false },
      decision_type: 'customize',
      user_agent: 'jsdom test',
      country_code: 'US',
    });
    expect(insErr).toBeNull();

    const { data: aSelf } = await a.client
      .from('consent_records')
      .select('*')
      .eq('user_id', a.id);
    expect(aSelf!.length).toBeGreaterThanOrEqual(1);

    const { data: bSees } = await b.client
      .from('consent_records')
      .select('*')
      .eq('user_id', a.id);
    expect(bSees).toEqual([]);
  }, 30_000);

  it('authenticated DELETE → 42501 (consent history is append-only per GDPR Art. 7(1))', async () => {
    const a = userA!;
    const adminClient = getAdmin();

    // Seed a row to attempt deleting.
    const { data: seed, error: seedErr } = await adminClient
      .from('consent_records')
      .insert({
        user_id: a.id,
        anonymous_id: `${CONSENT_RECORDS_PREFIX}-${crypto.randomUUID()}`,
        categories: { essential: true, analytics: false, marketing: false, personalization: false },
        decision_type: 'reject_all',
        user_agent: 'svc-role test',
        country_code: 'FR',
      })
      .select('id')
      .single();
    if (seedErr) throw seedErr;

    const { error: delErr } = await a.client
      .from('consent_records')
      .delete()
      .eq('id', seed!.id);

    // Two acceptable outcomes per Supabase semantics:
    //   (a) `error.code === '42501'` (explicit RLS violation), OR
    //   (b) `error === null` but `count === 0` because the DELETE matched
    //       zero rows due to RLS filtering out the target row first.
    // Both prove the user cannot delete consent_records.
    if (delErr) {
      expect(
        delErr.code === '42501' || /row-level security/i.test(delErr.message ?? ''),
      ).toBe(true);
    } else {
      // Verify the row still exists via service-role.
      const { data: stillThere } = await adminClient
        .from('consent_records')
        .select('id')
        .eq('id', seed!.id)
        .maybeSingle();
      expect(stillThere?.id).toBe(seed!.id);
    }
  }, 30_000);
});

describe('Phase 22 plan 22-12 — RLS consent_records gating', () => {
  it('runs against live cloud DB when SUPABASE_SERVICE_ROLE_KEY is set', () => {
    if (!SHOULD_RUN) {
      // eslint-disable-next-line no-console
      console.warn(
        '[rls-consent-records] SKIPPED — SUPABASE_SERVICE_ROLE_KEY (or URL/ANON) not set.',
      );
    }
    expect(true).toBe(true);
  });
});
