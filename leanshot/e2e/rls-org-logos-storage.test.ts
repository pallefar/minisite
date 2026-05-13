/**
 * Phase 9 Plan 09-01 — cross-tenant Storage RLS proof on `org-logos` bucket.
 *
 * Pitfall #6 verification: object name MUST be `<org_id>/logo.{ext}`
 * BUCKET-RELATIVE so `(storage.foldername(name))[1]` returns the org_id.
 *
 * Two assertions:
 *   1. Owner (user A) can upload `<org_id>/logo.png` to org-logos.
 *   2. Non-member (user B) CANNOT upload to user A's org folder
 *      (`org.update` permission gate denies).
 *   3. Public-read works for both users (bucket.public = true).
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, describe, expect, it } from 'vitest';

const URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const ANON = process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SHOULD_RUN = Boolean(URL && ANON && SERVICE);
const describeIfLive = SHOULD_RUN ? describe : describe.skip;

// Smallest valid PNG (1×1 transparent pixel).
const PNG_BYTES = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
  0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
  0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00,
  0x0a, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
  0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49,
  0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
]);

describeIfLive('Phase 9 Plan 09-01 — Storage RLS on org-logos bucket', () => {
  let admin: SupabaseClient | null = null;
  const getAdmin = (): SupabaseClient => {
    if (!admin) admin = createClient(URL!, SERVICE!, { auth: { autoRefreshToken: false, persistSession: false } });
    return admin;
  };
  const createdUserIds: string[] = [];
  const createdOrgIds: string[] = [];
  const uploadedPaths: string[] = [];

  afterAll(async () => {
    if (!admin) return;
    for (const p of uploadedPaths) try { await admin.storage.from('org-logos').remove([p]); } catch {/* */}
    for (const id of createdOrgIds) try { await admin.from('orgs').delete().eq('id', id); } catch {/* */}
    for (const id of createdUserIds) try { await admin.auth.admin.deleteUser(id); } catch {/* */}
  });

  it('owner can upload to <org_id>/logo.png; non-member cannot', async () => {
    const adminClient = getAdmin();
    const passwordA = `Pass1234-${crypto.randomUUID().slice(0, 8)}`;
    const passwordB = `Pass1234-${crypto.randomUUID().slice(0, 8)}`;
    const emailA = `rls-logo-a-${Date.now()}@leanshot.test`;
    const emailB = `rls-logo-b-${Date.now()}@leanshot.test`;

    const { data: aRes } = await adminClient.auth.admin.createUser({ email: emailA, password: passwordA, email_confirm: true });
    const userA = aRes?.user; if (!userA) throw new Error('userA');
    createdUserIds.push(userA.id);
    const { data: bRes } = await adminClient.auth.admin.createUser({ email: emailB, password: passwordB, email_confirm: true });
    const userB = bRes?.user; if (!userB) throw new Error('userB');
    createdUserIds.push(userB.id);

    const userAClient = createClient(URL!, ANON!, { auth: { autoRefreshToken: false, persistSession: false, storageKey: 'rls-logo-a' } });
    const userBClient = createClient(URL!, ANON!, { auth: { autoRefreshToken: false, persistSession: false, storageKey: 'rls-logo-b' } });
    await userAClient.auth.signInWithPassword({ email: emailA, password: passwordA });
    await userBClient.auth.signInWithPassword({ email: emailB, password: passwordB });

    const slugA = `rls-logo-a-${Date.now().toString(36)}`;
    const { data: createA, error: createAErr } = await userAClient.rpc('create_org', {
      p_name: 'RLS Logo A', p_slug: slugA, p_description: null, p_website_url: null,
    });
    if (createAErr) throw createAErr;
    const orgId = (createA as Array<{ org_id: string }> | null)?.[0]?.org_id;
    expect(orgId).toBeTruthy();
    createdOrgIds.push(orgId!);

    // PROOF #1: user A (Owner) can upload to <org_id>/logo.png.
    const path = `${orgId}/logo.png`;
    const { error: aUpErr } = await userAClient.storage.from('org-logos').upload(path, PNG_BYTES, {
      contentType: 'image/png', upsert: true,
    });
    expect(aUpErr).toBeNull();
    uploadedPaths.push(path);

    // PROOF #2: user B (non-member) CANNOT upload into user A's org folder.
    const { error: bUpErr } = await userBClient.storage.from('org-logos').upload(`${orgId}/attacker.png`, PNG_BYTES, {
      contentType: 'image/png', upsert: false,
    });
    expect(bUpErr).not.toBeNull();
    expect(
      /row-level security|403|unauthorized|denied/i.test(bUpErr?.message ?? ''),
    ).toBe(true);

    // PROOF #3: public-read works for any authenticated user (bucket.public = true).
    const { data: bDownload } = await userBClient.storage.from('org-logos').download(path);
    expect(bDownload).not.toBeNull();
  }, 45_000);
});

describe('Phase 9 RLS org-logos storage — gating', () => {
  it('runs against live cloud DB when SUPABASE_SERVICE_ROLE_KEY is set', () => {
    if (!SHOULD_RUN) {
      // eslint-disable-next-line no-console
      console.warn('[rls-org-logos-storage.test] SKIPPED — env not set.');
    }
    expect(true).toBe(true);
  });
});
