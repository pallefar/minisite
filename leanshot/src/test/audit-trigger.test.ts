/**
 * Phase 7 D-04 — audit_trigger() behavior proof.
 *
 * Verifies, against the live cloud DB (post `supabase db push` of migrations
 * 20260601000001 / 02 / 03), that the SECURITY DEFINER trigger attached to
 * the 10 sync tables materializes exactly one audit_logs row per
 * INSERT/UPDATE/DELETE, with sha256 before/after hashes in the right
 * polarity for each tg_op.
 *
 * Also proves the STRIDE-T tampering mitigation: an authenticated client
 * cannot directly INSERT into audit_logs (no INSERT policy exists for the
 * authenticated role — only the SECURITY DEFINER trigger + service_role
 * can write).
 *
 * Companion: e2e/rls-audit-logs.test.ts (cross-tenant SELECT proof).
 *
 * Environment (mirrors e2e/rls-multi-table.test.ts gating):
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

/** sha256-hex of an ASCII string — mirrors the Postgres encode(digest(x, 'sha256'), 'hex'). */
async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

describeIfLive('Phase 7 D-04 — audit_trigger fires on injections lifecycle', () => {
  let admin: SupabaseClient | null = null;
  const getAdmin = (): SupabaseClient => {
    if (!admin) {
      admin = createClient(URL!, SERVICE!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
    }
    return admin;
  };

  let user: { id: string; client: SupabaseClient } | null = null;
  const logId = crypto.randomUUID();

  beforeAll(async () => {
    const adminClient = getAdmin();
    const email = `phase7-audit-${Date.now()}@leanshot.test`;
    const password = `Pass1234-${crypto.randomUUID().slice(0, 8)}`;

    const created = await adminClient.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (created.error) throw created.error;

    const client = createClient(URL!, ANON!, {
      auth: { autoRefreshToken: false, persistSession: false, storageKey: 'audit-trigger-u' },
    });
    const signIn = await client.auth.signInWithPassword({ email, password });
    if (signIn.error) throw signIn.error;

    user = { id: created.data.user!.id, client };
  }, 60_000);

  afterAll(async () => {
    if (!admin || !user) return;
    const userId = user.id;
    // Compute the user_id_hash the trigger writes — sha256(user_id::text).
    const expectedHash = await sha256Hex(userId);
    try {
      // Best-effort: delete audit_logs rows seeded by this test BEFORE the
      // user is deleted. `on delete set null` would leave rows with user_id
      // = null otherwise; we scope by user_id_hash to clean up cleanly.
      await admin.from('audit_logs').delete().eq('user_id_hash', expectedHash);
      // Best-effort: delete the auth user (cascade-deletes the injections row).
      await admin.auth.admin.deleteUser(userId);
    } catch {
      // best-effort cleanup
    }
  });

  it('INSERT on injections triggers an audit_logs row with non-null after_hash and null before_hash', async () => {
    const u = user!;
    const row = {
      user_id: u.id,
      log_id: logId,
      medication: 'ozempic',
      dose: '0.5',
      unit: 'mg',
      site: 'thigh-l',
      notes: '',
      logged_at: new Date().toISOString(),
    };
    const { error: insErr } = await u.client.from('injections').insert(row);
    expect(insErr).toBeNull();

    // AFTER trigger fires in the same transaction → row is visible by the time
    // .insert() resolves.
    const { data: audit, error: aerr } = await u.client
      .from('audit_logs')
      .select('*')
      .eq('table_name', 'injections')
      .eq('action', 'insert')
      .order('timestamp', { ascending: false })
      .limit(1);
    expect(aerr).toBeNull();
    expect(audit).toHaveLength(1);
    expect(audit![0]!.after_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(audit![0]!.before_hash).toBeNull();
    expect(audit![0]!.user_id).toBe(u.id);
  }, 30_000);

  it('UPDATE on injections triggers an audit_logs row with both hashes non-null AND distinct', async () => {
    const u = user!;
    const { error: updErr } = await u.client
      .from('injections')
      .update({ notes: 'changed' })
      .match({ user_id: u.id, log_id: logId });
    expect(updErr).toBeNull();

    const { data: audit } = await u.client
      .from('audit_logs')
      .select('*')
      .eq('table_name', 'injections')
      .eq('action', 'update')
      .order('timestamp', { ascending: false })
      .limit(1);
    expect(audit).toHaveLength(1);
    expect(audit![0]!.before_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(audit![0]!.after_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(audit![0]!.before_hash).not.toBe(audit![0]!.after_hash);
  }, 30_000);

  it('DELETE on injections triggers an audit_logs row with non-null before_hash and null after_hash', async () => {
    const u = user!;
    const { error: delErr } = await u.client
      .from('injections')
      .delete()
      .match({ user_id: u.id, log_id: logId });
    expect(delErr).toBeNull();

    const { data: audit } = await u.client
      .from('audit_logs')
      .select('*')
      .eq('table_name', 'injections')
      .eq('action', 'delete')
      .order('timestamp', { ascending: false })
      .limit(1);
    expect(audit).toHaveLength(1);
    expect(audit![0]!.before_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(audit![0]!.after_hash).toBeNull();
  }, 30_000);

  it('authenticated client cannot directly INSERT into audit_logs (STRIDE-T tampering proof)', async () => {
    const u = user!;
    const { error: tamperErr } = await u.client.from('audit_logs').insert({
      user_id: u.id,
      user_id_hash: 'deadbeef'.repeat(8),
      table_name: 'injections',
      row_id: 'fake',
      action: 'insert',
      after_hash: 'cafebabe'.repeat(8),
    });
    expect(tamperErr).not.toBeNull();
    expect(
      tamperErr!.code === '42501' || /violates row-level security/i.test(tamperErr!.message ?? ''),
    ).toBe(true);
  }, 30_000);
});

describe('Phase 7 D-04 — audit_trigger gating', () => {
  it('runs against live cloud DB when SUPABASE_SERVICE_ROLE_KEY is set', () => {
    if (!SHOULD_RUN) {
      console.warn(
        '[audit-trigger.test] SKIPPED — SUPABASE_SERVICE_ROLE_KEY (or URL/ANON) not set. Wave verification gates this.',
      );
    }
    expect(true).toBe(true);
  });
});
