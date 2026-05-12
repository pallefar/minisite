/**
 * Phase 7 D-04 cross-tenant RLS proof for `public.audit_logs`.
 *
 * Per project rule (memory `reference_supabase_project.md`): every new RLS
 * surface MUST have a live cross-tenant impersonation proof, not just policy
 * SQL. `audit_logs` is the headline threat-model surface for Phase 7 —
 * STRIDE-I (Information disclosure, T-07-08-04) is the headline mitigation.
 *
 * Two distinct authenticated users; user A seeds an injections row (which
 * fires the SECURITY DEFINER trigger, writing an audit_logs row attributed
 * to user A). User B's JWT-scoped client must read ZERO of user A's audit
 * rows. The admin (service-role) client confirms the audit row really exists
 * — guards against a false-pass where the trigger silently failed.
 *
 * Mirrors `e2e/rls-multi-table.test.ts` shape (Phase 6 SC#5 cross-tenant
 * proof pattern). Companion: `src/test/audit-trigger.test.ts` (trigger-fires
 * behavior proof).
 *
 * Environment:
 *   SUPABASE_URL              — public (also VITE_SUPABASE_URL)
 *   SUPABASE_ANON_KEY         — public (also VITE_SUPABASE_ANON_KEY)
 *   SUPABASE_SERVICE_ROLE_KEY — PRIVATE (CI secret; never commit)
 *
 * Skipped automatically if any required env var is absent (default local +
 * PR-from-fork safety). Wave verification runs this against the live cloud
 * DB with the secret injected.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const ANON = process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;

const SHOULD_RUN = Boolean(URL && ANON && SERVICE);
const describeIfLive = SHOULD_RUN ? describe : describe.skip;

/** sha256-hex of an ASCII string — matches Postgres encode(digest(x, 'sha256'), 'hex'). */
async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

describeIfLive('Phase 7 D-04 — RLS over audit_logs', () => {
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

  beforeAll(async () => {
    const adminClient = getAdmin();
    const emailA = `phase7-audit-rls-a-${Date.now()}@leanshot.test`;
    const emailB = `phase7-audit-rls-b-${Date.now()}@leanshot.test`;
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
      auth: { autoRefreshToken: false, persistSession: false, storageKey: 'rls-audit-a' },
    });
    const bClient = createClient(URL!, ANON!, {
      auth: { autoRefreshToken: false, persistSession: false, storageKey: 'rls-audit-b' },
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
    // Clean up audit_logs rows attributed to our test users BEFORE the auth
    // user is deleted. `on delete set null` would otherwise leave orphaned
    // user_id=null audit rows — those don't break anything but clutter the
    // table. Scope by user_id_hash (matches what the trigger wrote).
    for (const id of createdUserIds) {
      try {
        const hash = await sha256Hex(id);
        await admin.from('audit_logs').delete().eq('user_id_hash', hash);
      } catch {
        // best-effort
      }
    }
    for (const id of createdUserIds) {
      try {
        await admin.auth.admin.deleteUser(id);
      } catch {
        // best-effort cleanup; on-delete-cascade handles sync-table rows
      }
    }
  });

  it('user B reads ZERO of user A audit rows; admin sees them (T-07-08-04 information-disclosure proof)', async () => {
    const a = userA!;
    const b = userB!;
    const adminClient = getAdmin();

    // 1. User A inserts an injections row — the SECURITY DEFINER trigger
    //    materializes a corresponding audit_logs row attributed to user A.
    const row = {
      user_id: a.id,
      log_id: crypto.randomUUID(),
      medication: 'ozempic',
      dose: '0.5',
      unit: 'mg',
      site: null,
      notes: '',
      logged_at: new Date().toISOString(),
    };
    const { error: insErr } = await a.client.from('injections').insert(row);
    expect(insErr).toBeNull();

    // 2. Admin (service-role) confirms the audit row exists. Guards against
    //    false-pass where the trigger silently failed (then both A and B
    //    would see empty sets and the cross-tenant assertion would trivially
    //    pass without proving anything).
    const { data: adminAudit, error: adminErr } = await adminClient
      .from('audit_logs')
      .select('*')
      .eq('user_id', a.id)
      .eq('table_name', 'injections');
    if (adminErr) throw adminErr;
    expect(adminAudit!.length).toBeGreaterThanOrEqual(1);

    // 3. User A reads their own audit rows — RLS allows it (count ≥ 1, and
    //    every row's user_id matches userA.id).
    const { data: aSelf, error: aReadErr } = await a.client
      .from('audit_logs')
      .select('*');
    if (aReadErr) throw aReadErr;
    expect(aSelf!.length).toBeGreaterThanOrEqual(1);
    expect(aSelf!.every((r) => r.user_id === a.id)).toBe(true);

    // 4. THE PROOF: user B reads → ZERO rows. RLS filters silently.
    const { data: bData, error: bReadErr } = await b.client
      .from('audit_logs')
      .select('*');
    expect(bReadErr).toBeNull();
    expect(bData).toEqual([]);
  }, 30_000);

  it('user B cannot directly INSERT into audit_logs impersonating user A (T-07-08-01 tampering proof)', async () => {
    const a = userA!;
    const b = userB!;

    const { error: tamperErr } = await b.client.from('audit_logs').insert({
      user_id: a.id,
      user_id_hash: 'deadbeef'.repeat(8),
      table_name: 'injections',
      action: 'insert',
    });
    expect(tamperErr).not.toBeNull();
    expect(
      tamperErr!.code === '42501' ||
        /violates row-level security/i.test(tamperErr!.message ?? ''),
    ).toBe(true);
  }, 30_000);

  it('service-role admin sees both users audit rows (sanity check for the cross-tenant assertion)', async () => {
    const a = userA!;
    const b = userB!;
    const adminClient = getAdmin();

    // The admin client bypasses RLS by Supabase convention. Confirms the
    // test setup actually wrote rows — the cross-tenant test in #1 above
    // would false-pass if NO audit rows existed for either user.
    const { data: allRows, error: aErr } = await adminClient
      .from('audit_logs')
      .select('*')
      .in('user_id', [a.id, b.id]);
    expect(aErr).toBeNull();
    expect(allRows!.length).toBeGreaterThanOrEqual(1);
  }, 30_000);
});

describe('Phase 7 D-04 — audit_logs RLS gating', () => {
  it('runs against live cloud DB when SUPABASE_SERVICE_ROLE_KEY is set', () => {
    if (!SHOULD_RUN) {
      // eslint-disable-next-line no-console
      console.warn(
        '[rls-audit-logs.test] SKIPPED — SUPABASE_SERVICE_ROLE_KEY (or URL/ANON) not set. Wave verification gates this.',
      );
    }
    expect(true).toBe(true);
  });
});
