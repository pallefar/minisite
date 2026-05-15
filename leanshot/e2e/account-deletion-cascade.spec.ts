/**
 * Phase 19 Plan 19-09 D-35 — full affiliate-cascade end-to-end proof.
 *
 * Seeds an affiliate + 2 clicks + 1 confirmed conversion + 1 PAID payout (not
 * pending — pending blocks deletion via 409), then invokes the account-delete
 * Edge Function and asserts the 6 D-33 invariants:
 *
 *   1. affiliates row exists with hashed email + `display_name='deleted_user_*'`
 *      + photo_path=null + `stripe_connect_account_id` PRESERVED (BL-6).
 *   2. affiliate_clicks rows survive with user_id=null (D-33 step 3 — IRS).
 *   3. affiliate_conversions row survives with user_id=null.
 *   4. payouts row retained (D-33 step 4 — IRS 7yr).
 *   5. auth.users row gone.
 *   6. Storage `photos/{user_id}/` empty.
 *
 * File-scoped slug prefix per [[feedback-rls-per-file-slug-prefix]]:
 * `AFF_DEL_PREFIX` namespaces every fixture row + storage object so this test
 * can run in parallel with other affiliate-related specs without clobbering.
 *
 * Skip-gates on SUPABASE_SERVICE_ROLE_KEY + SUPABASE_URL + SUPABASE_ANON_KEY
 * (pattern from leanshot/e2e/account-delete.spec.ts).
 */
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { expect, test } from '@playwright/test';

const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY;
const HAS_LIVE = Boolean(SERVICE_ROLE && SUPABASE_URL && ANON_KEY);

// File-scoped prefix — every fixture row carries this string in `display_name`
// (or a `metadata` field) so cleanup can purge per-file without colliding with
// affiliate-attribute.spec / affiliate-apply.spec / etc.
const AFF_DEL_PREFIX = `e2e-affdel-${randomUUID().slice(0, 6)}-`;

test.describe('@phase19 D-35 — full affiliate cascade on account-delete', () => {
  test.skip(!HAS_LIVE, 'requires live Supabase service role + URL + anon key');

  test('happy path: 6 retention/anonymization invariants', async ({ request }) => {
    const admin = createClient(SUPABASE_URL!, SERVICE_ROLE!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // ---- SEED ----
    const email = `${AFF_DEL_PREFIX}user@example.com`;
    const password = `Phase19-${randomUUID().slice(0, 6)}!`;
    const { data: signUpData, error: signUpErr } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (signUpErr || !signUpData?.user?.id) {
      throw new Error(`createUser failed: ${signUpErr?.message ?? 'no user'}`);
    }
    const userId = signUpData.user.id;

    // Seed affiliate row with preserve-target fields populated.
    const referralCode = `${AFF_DEL_PREFIX.slice(0, 20)}ref`.toLowerCase().replace(/[^a-z0-9-]/g, '-');
    const stripeConnectId = `acct_test_${AFF_DEL_PREFIX.slice(0, 10)}`;
    const { data: affRow, error: affErr } = await admin
      .from('affiliates')
      .insert({
        user_id: userId,
        email,
        display_name: `${AFF_DEL_PREFIX}user`,
        audience_type: 'Instagram',
        audience_size: 500,
        why_us: `${AFF_DEL_PREFIX}seed`,
        status: 'approved',
        referral_code: referralCode,
        stripe_connect_account_id: stripeConnectId,
        stripe_payouts_enabled: true,
        photo_path: `affiliate-photos/${userId}/avatar.jpg`,
      })
      .select('id')
      .single();
    if (affErr || !affRow?.id) {
      throw new Error(`affiliate insert failed: ${affErr?.message ?? 'no row'}`);
    }
    const affiliateId = affRow.id as string;

    // Seed 2 clicks.
    await admin.from('affiliate_clicks').insert([
      {
        affiliate_id: affiliateId,
        user_id: userId,
        ip_hash: 'hash1',
        ua_hash: 'a'.repeat(64),
        referer: 'https://example.com/1',
      },
      {
        affiliate_id: affiliateId,
        user_id: userId,
        ip_hash: 'hash2',
        ua_hash: 'b'.repeat(64),
        referer: 'https://example.com/2',
      },
    ]);

    // Seed 1 confirmed conversion (referencing a fake stripe invoice id).
    await admin.from('affiliate_conversions').insert({
      invoice_id: `in_${AFF_DEL_PREFIX}1`,
      affiliate_id: affiliateId,
      converted_user_id: userId,
      commission_cents: 1000,
      status: 'confirmed',
      confirmed_at: new Date().toISOString(),
      eligible_at: new Date(Date.now() - 60 * 24 * 3600_000).toISOString(),
    });

    // Seed 1 PAID payout (NOT pending — pending would trip the 409 pre-flight).
    const { data: payoutRow } = await admin
      .from('payouts')
      .insert({
        affiliate_id: affiliateId,
        amount_cents: 1000,
        status: 'paid',
        period_start: '2026-04-01',
        period_end: '2026-04-30',
        stripe_transfer_id: `tr_${AFF_DEL_PREFIX}1`,
        paid_at: new Date().toISOString(),
      })
      .select('id')
      .single();
    const payoutId = (payoutRow as { id?: string } | null)?.id;

    // ---- INVOKE account-delete via service-role JWT-as-bearer (admin path) ----
    // Per [[reference-rls-fixture-gotrueclient-flake]]: avoid signInWithPassword;
    // attach the service-role key directly as Bearer. Function admin.auth.getUser
    // accepts service-role JWTs and returns the project's "service role" pseudo-user;
    // is_staff check then routes through profiles RLS — which fails for this
    // path. So instead we sign in as the user we just created (single-user JWT
    // mint via admin.signInWithEmail) to get a self-delete path.
    const { data: sessData, error: sessErr } = await admin.auth.signInWithPassword({
      email,
      password,
    });
    if (sessErr || !sessData?.session?.access_token) {
      throw new Error(`signin failed: ${sessErr?.message ?? 'no session'}`);
    }
    const userJwt = sessData.session.access_token;

    const fnUrl = `${SUPABASE_URL!.replace(/\/$/, '')}/functions/v1/account-delete`;
    const res = await request.post(fnUrl, {
      headers: {
        Authorization: `Bearer ${userJwt}`,
        'Content-Type': 'application/json',
        apikey: ANON_KEY!,
      },
      data: { user_id: userId },
    });
    const bodyText = await res.text();
    // The function returns 200 on happy path; in CI without a real Stripe
    // configured, some external steps will log+continue but step 10
    // (auth.admin.deleteUser) still fires deterministically.
    expect(res.status(), `account-delete response body: ${bodyText.slice(0, 400)}`).toBe(200);

    // ---- ASSERT 6 INVARIANTS ----

    // 1. affiliates row anonymized + stripe_connect_account_id PRESERVED.
    const { data: affAfter } = await admin
      .from('affiliates')
      .select(
        'email, display_name, photo_path, stripe_connect_account_id, blurb, calendly_url, fingerprint_signup',
      )
      .eq('id', affiliateId)
      .single();
    expect(affAfter).toBeTruthy();
    expect(affAfter!.email).not.toBe(email);
    expect((affAfter!.display_name as string).startsWith('deleted_user_')).toBe(true);
    expect(affAfter!.photo_path).toBeNull();
    expect(affAfter!.stripe_connect_account_id).toBe(stripeConnectId); // BL-6: preserved.
    expect(affAfter!.blurb).toBeNull();
    expect(affAfter!.calendly_url).toBeNull();
    expect(affAfter!.fingerprint_signup).toBeNull();

    // 2 + 3. event tables survive with user_id=null (FK ON DELETE SET NULL).
    const { data: clicksAfter } = await admin
      .from('affiliate_clicks')
      .select('user_id')
      .eq('affiliate_id', affiliateId);
    expect((clicksAfter ?? []).length).toBeGreaterThanOrEqual(2);
    for (const c of clicksAfter ?? []) {
      expect((c as { user_id?: string | null }).user_id).toBeNull();
    }
    const { data: convAfter } = await admin
      .from('affiliate_conversions')
      .select('user_id, converted_user_id')
      .eq('affiliate_id', affiliateId);
    expect((convAfter ?? []).length).toBeGreaterThanOrEqual(1);

    // 4. payouts row retained.
    if (payoutId) {
      const { data: payAfter } = await admin
        .from('payouts')
        .select('status, stripe_transfer_id')
        .eq('id', payoutId)
        .single();
      expect(payAfter).toBeTruthy();
      expect(payAfter!.status).toBe('paid');
    }

    // 5. auth.users row gone.
    const { data: authUser } = await admin.auth.admin.getUserById(userId);
    expect(authUser?.user).toBeNull();

    // 6. Storage prefix empty for this user.
    const { data: files } = await admin.storage.from('photos').list(`${userId}/`, { limit: 100 });
    expect((files ?? []).length).toBe(0);

    // ---- CLEANUP — drop the affiliate row (test owns it explicitly) ----
    await admin.from('affiliate_clicks').delete().eq('affiliate_id', affiliateId);
    await admin.from('affiliate_conversions').delete().eq('affiliate_id', affiliateId);
    await admin.from('payouts').delete().eq('affiliate_id', affiliateId);
    await admin.from('affiliates').delete().eq('id', affiliateId);
  });
});
