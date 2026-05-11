/**
 * Phase 4 SC#5 + T-04-04 cross-tenant proof.
 *
 * Two anonymous users; user A's JWT-scoped client must see ONLY user A's
 * `ai_messages` rows, never user B's. Proves the RLS policy
 * `auth.uid() = user_id` enforces tenant isolation even when both users
 * coexist in the same physical table.
 *
 * Environment:
 *   SUPABASE_URL              — public, e.g. https://<ref>.supabase.co
 *   SUPABASE_ANON_KEY         — public anon JWT (publishable)
 *   SUPABASE_SERVICE_ROLE_KEY — PRIVATE service-role JWT (NEVER commit; CI secret only)
 *
 * Skipped automatically if `SUPABASE_SERVICE_ROLE_KEY` is not set (e.g. in
 * default local + GitHub Actions PR runs from forks). Wave-5 verification
 * runs this against the live cloud DB with the secret injected.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, describe, expect, it } from 'vitest';

const URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const ANON = process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;

const SHOULD_RUN = Boolean(URL && ANON && SERVICE);

const describeIfLive = SHOULD_RUN ? describe : describe.skip;

describeIfLive('Phase 4 SC#5 — cross-tenant RLS isolation on ai_messages', () => {
  const admin: SupabaseClient = createClient(URL!, SERVICE!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const createdUserIds: string[] = [];

  afterAll(async () => {
    for (const id of createdUserIds) {
      try {
        await admin.auth.admin.deleteUser(id);
      } catch {
        // best-effort cleanup
      }
    }
  });

  it('user A cannot read user B rows via RLS-scoped client', async () => {
    // 1. Create two anon users via the admin API.
    const { data: aRes, error: aErr } = await admin.auth.admin.createUser({
      email: `test-a-${Date.now()}@leanshot.test`,
      email_confirm: true,
    });
    if (aErr) throw aErr;
    const userA = aRes.user!;
    createdUserIds.push(userA.id);

    const { data: bRes, error: bErr } = await admin.auth.admin.createUser({
      email: `test-b-${Date.now()}@leanshot.test`,
      email_confirm: true,
    });
    if (bErr) throw bErr;
    const userB = bRes.user!;
    createdUserIds.push(userB.id);

    // 2. Seed ai_messages — one row per user, via service-role (bypasses RLS).
    const { error: insertAErr } = await admin.from('ai_messages').insert({
      user_id: userA.id,
      role: 'user',
      content: 'User A hello',
      mode: 'coach',
    });
    if (insertAErr) throw insertAErr;

    const { error: insertBErr } = await admin.from('ai_messages').insert({
      user_id: userB.id,
      role: 'user',
      content: 'User B secret',
      mode: 'coach',
    });
    if (insertBErr) throw insertBErr;

    // 3. Mint a session JWT for user A and build a JWT-scoped client.
    const { data: sessionA, error: sessionErr } =
      await admin.auth.admin.generateLink({
        type: 'magiclink',
        email: userA.email!,
      });
    if (sessionErr) throw sessionErr;

    // Sign-in as user A with the OTP token. Workaround: use the admin
    // `createUser` returned id directly to mint a session. Cleanest path:
    // service-role admin can also use `signInWithPassword` after setting
    // a password — but for this test we just verify RLS by setting the
    // Authorization header on a client to a JWT minted for user A.
    //
    // The simplest correct approach: use `admin.auth.admin.generateLink`
    // with type='magiclink', extract the `action_link` token, exchange
    // for a session. To keep the test concise, we instead create a client
    // with the user's access token by signing in via a fresh client with
    // signInWithPassword after setting one. Given complexity, we take the
    // pragmatic route: build a client using the admin's createSession
    // surrogate — if generateLink emits a `hashed_token`, exchange via
    // `verifyOtp({type:'magiclink', token_hash, email})`.
    const tokenHash = sessionA.properties?.hashed_token;
    if (!tokenHash) throw new Error('failed to mint magiclink token for user A');

    const userClient = createClient(URL!, ANON!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: verifyRes, error: verifyErr } = await userClient.auth.verifyOtp({
      type: 'magiclink',
      token_hash: tokenHash,
    });
    if (verifyErr) throw verifyErr;
    expect(verifyRes.session).toBeTruthy();

    // 4. Read ai_messages from user A's RLS-scoped client.
    const { data, error } = await userClient.from('ai_messages').select('*');
    if (error) throw error;

    // 5. Assert: only user A's row is visible.
    expect(data).toBeTruthy();
    expect(data!.length).toBe(1);
    expect(data![0]!.user_id).toBe(userA.id);
    expect(data![0]!.content).toBe('User A hello');
    // T-04-04 strict — user B's payload MUST NOT be in the visible set.
    expect(data!.some((r) => r.content === 'User B secret')).toBe(false);
  });
});

describe('Phase 4 SC#5 — gating', () => {
  it('runs against live cloud DB when SUPABASE_SERVICE_ROLE_KEY is set', () => {
    if (!SHOULD_RUN) {
      // Not a failure — communicate skipped state.
      // eslint-disable-next-line no-console
      console.warn(
        '[rls-ai-messages.test] SKIPPED — SUPABASE_SERVICE_ROLE_KEY not set in env. Wave-5 CI run gates this.',
      );
    }
    expect(true).toBe(true);
  });
});
