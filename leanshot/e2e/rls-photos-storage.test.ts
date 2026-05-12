/**
 * Phase 6 06-04 — live cross-tenant Storage RLS impersonation proof
 * (closes 06-PLAN-CHECK BL-1).
 *
 * The Storage RLS policies created in supabase/migrations/20260514000010_storage_bucket.sql
 * gate every object operation by folder prefix:
 *   (storage.foldername(name))[1] = auth.uid()::text
 *
 * This test PROVES the policies actually enforce that gate at runtime —
 * not just that the SQL is well-formed. Three impersonation assertions
 * mirror the Phase 5 rls-injections.test.ts shape:
 *
 *   1. DOWNLOAD: user B cannot read user A's photo via .download(path).
 *   2. UPLOAD-WITH-CHECK: user B cannot write into user A's folder prefix.
 *   3. LIST: user B cannot enumerate user A's folder contents.
 *
 * Plus a positive control (user A CAN download their own photo) to isolate
 * "RLS blocks user B" from "Storage broken in general".
 *
 * Pattern D env-var skip-gate: when SUPABASE_SERVICE_ROLE_KEY (or URL/ANON)
 * is absent the suite skips cleanly. CI runs with all three set.
 *
 * Picked up by the existing vitest-e2e.config.ts `e2e/rls-*.test.ts` glob
 * — no config change needed. Mirrors the project rule (Phase 5, reaffirmed
 * by 06-PLAN-CHECK BL-1): "every Supabase RLS surface MUST get a live
 * cross-tenant impersonation proof".
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, describe, expect, it } from 'vitest';

const URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const ANON = process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;

const SHOULD_RUN = Boolean(URL && ANON && SERVICE);
const describeIfLive = SHOULD_RUN ? describe : describe.skip;

// 1×1 minimal JPEG bytes (same red-pixel fixture used by the Playwright
// spec). Inline so the test has no external file dependency.
const JPEG_BYTES = new Uint8Array([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01,
  0x00, 0x01, 0x00, 0x00, 0xff, 0xdb, 0x00, 0x43, 0x00, 0x08, 0x06, 0x06, 0x07, 0x06, 0x05, 0x08,
  0x07, 0x07, 0x07, 0x09, 0x09, 0x08, 0x0a, 0x0c, 0x14, 0x0d, 0x0c, 0x0b, 0x0b, 0x0c, 0x19, 0x12,
  0x13, 0x0f, 0x14, 0x1d, 0x1a, 0x1f, 0x1e, 0x1d, 0x1a, 0x1c, 0x1c, 0x20, 0x24, 0x2e, 0x27, 0x20,
  0x22, 0x2c, 0x23, 0x1c, 0x1c, 0x28, 0x37, 0x29, 0x2c, 0x30, 0x31, 0x34, 0x34, 0x34, 0x1f, 0x27,
  0x39, 0x3d, 0x38, 0x32, 0x3c, 0x2e, 0x33, 0x34, 0x32, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x01,
  0x00, 0x01, 0x01, 0x01, 0x11, 0x00, 0xff, 0xc4, 0x00, 0x14, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0xff, 0xc4, 0x00, 0x14,
  0x10, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  0x00, 0x00, 0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00, 0x37, 0xff, 0xd9,
]);

describeIfLive('Phase 6 06-04 SC#3 + BL-1 — cross-tenant Storage RLS isolation on photos bucket', () => {
  // Lazy-construct the admin client so describe.skip does not crash on
  // missing env vars (createClient throws on undefined URL).
  let admin: SupabaseClient | null = null;
  const getAdmin = (): SupabaseClient => {
    if (!admin) {
      admin = createClient(URL!, SERVICE!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
    }
    return admin;
  };
  const createdUserIds: string[] = [];
  const createdStoragePaths: string[] = [];

  afterAll(async () => {
    if (!admin) return;
    // Clean up Storage objects first — Supabase admin.deleteUser does NOT
    // cascade to Storage (only to public.photos rows via the ON DELETE
    // CASCADE on user_id). Without this sweep the photos bucket would
    // accumulate orphan objects across CI runs.
    if (createdStoragePaths.length > 0) {
      try {
        await admin.storage.from('photos').remove(createdStoragePaths);
      } catch {
        // best-effort
      }
    }
    for (const id of createdUserIds) {
      try {
        await admin.auth.admin.deleteUser(id);
      } catch {
        // best-effort; the on-delete-cascade on user_id removes photos rows.
      }
    }
  });

  it(
    'user B cannot DOWNLOAD user A photo via Storage RLS (BL-1)',
    async () => {
      const adminClient = getAdmin();
      const passwordA = `Pass1234-${crypto.randomUUID().slice(0, 8)}`;
      const passwordB = `Pass1234-${crypto.randomUUID().slice(0, 8)}`;
      const emailA = `rls-photo-a-${Date.now()}@leanshot.test`;
      const emailB = `rls-photo-b-${Date.now()}@leanshot.test`;

      const { data: aRes, error: aErr } = await adminClient.auth.admin.createUser({
        email: emailA,
        password: passwordA,
        email_confirm: true,
      });
      if (aErr) throw aErr;
      const userA = aRes.user!;
      createdUserIds.push(userA.id);

      const { data: bRes, error: bErr } = await adminClient.auth.admin.createUser({
        email: emailB,
        password: passwordB,
        email_confirm: true,
      });
      if (bErr) throw bErr;
      const userB = bRes.user!;
      createdUserIds.push(userB.id);

      const userAClient = createClient(URL!, ANON!, {
        auth: { autoRefreshToken: false, persistSession: false, storageKey: 'rls-photo-a' },
      });
      const userBClient = createClient(URL!, ANON!, {
        auth: { autoRefreshToken: false, persistSession: false, storageKey: 'rls-photo-b' },
      });
      {
        const { error } = await userAClient.auth.signInWithPassword({
          email: emailA,
          password: passwordA,
        });
        if (error) throw error;
      }
      {
        const { error } = await userBClient.auth.signInWithPassword({
          email: emailB,
          password: passwordB,
        });
        if (error) throw error;
      }

      // Seed: user A uploads a JPEG into their own folder prefix.
      const photoId = crypto.randomUUID();
      const pathA = `${userA.id}/photos/${photoId}.jpg`;
      const blob = new Blob([JPEG_BYTES], { type: 'image/jpeg' });
      const { error: upErr } = await userAClient.storage.from('photos').upload(pathA, blob, {
        contentType: 'image/jpeg',
        upsert: false,
      });
      if (upErr) throw upErr;
      createdStoragePaths.push(pathA);

      // Positive control: user A can read their own object.
      const { data: aData, error: aReadErr } = await userAClient.storage
        .from('photos')
        .download(pathA);
      expect(aReadErr).toBeNull();
      expect(aData).toBeDefined();
      expect((aData as Blob).size).toBeGreaterThan(0);

      // THE PROOF (BL-1): user B cannot download user A's photo via RLS.
      // Supabase Storage returns a StorageApiError (400/403/Unauthorized).
      const { data: bData, error: bReadErr } = await userBClient.storage
        .from('photos')
        .download(pathA);
      // Either error is set OR returned data is empty/non-readable. The
      // RLS-blocked path returns an error; we assert at least one of these.
      const blocked =
        bReadErr !== null ||
        bData === null ||
        (bData instanceof Blob && bData.size === 0);
      expect(blocked).toBe(true);
    },
    30_000,
  );

  it(
    'user B cannot UPLOAD into user A folder prefix (WITH CHECK guard, BL-1)',
    async () => {
      const adminClient = getAdmin();
      const passwordA = `Pass1234-${crypto.randomUUID().slice(0, 8)}`;
      const passwordB = `Pass1234-${crypto.randomUUID().slice(0, 8)}`;
      const emailA = `rls-photo-up-a-${Date.now()}@leanshot.test`;
      const emailB = `rls-photo-up-b-${Date.now()}@leanshot.test`;

      const { data: aRes, error: aErr } = await adminClient.auth.admin.createUser({
        email: emailA,
        password: passwordA,
        email_confirm: true,
      });
      if (aErr) throw aErr;
      const userA = aRes.user!;
      createdUserIds.push(userA.id);

      const { data: bRes, error: bErr } = await adminClient.auth.admin.createUser({
        email: emailB,
        password: passwordB,
        email_confirm: true,
      });
      if (bErr) throw bErr;
      const userB = bRes.user!;
      createdUserIds.push(userB.id);

      const userBClient = createClient(URL!, ANON!, {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
          storageKey: 'rls-photo-up-b',
        },
      });
      const { error: signinErr } = await userBClient.auth.signInWithPassword({
        email: emailB,
        password: passwordB,
      });
      if (signinErr) throw signinErr;

      // User B attempts to write INTO user A's folder prefix. The INSERT
      // policy `(storage.foldername(name))[1] = auth.uid()::text` MUST
      // reject this with an RLS-violation error.
      const photoId = crypto.randomUUID();
      const impersonationPath = `${userA.id}/photos/${photoId}.jpg`;
      const blob = new Blob([JPEG_BYTES], { type: 'image/jpeg' });
      const { error: upErr } = await userBClient.storage
        .from('photos')
        .upload(impersonationPath, blob, {
          contentType: 'image/jpeg',
          upsert: false,
        });

      // Folder-prefix RLS rejects the write — error must be set.
      expect(upErr).not.toBeNull();

      // Belt-and-suspenders: confirm the object really isn't there via the
      // admin client. The negative `expect(upErr).not.toBeNull()` above is
      // the load-bearing assertion; this just isolates "RLS blocked the
      // upload" from "Storage accepted but reported an error".
      const { data: list } = await adminClient.storage
        .from('photos')
        .list(`${userA.id}/photos`);
      const foundImpersonation = (list ?? []).some((f) => f.name === `${photoId}.jpg`);
      expect(foundImpersonation).toBe(false);
      // Voiding unused var lint — userB is captured for clarity at the
      // assertion line above (createdUserIds.push tracks the test users).
      void userB;
    },
    30_000,
  );

  it(
    'user B cannot LIST user A folder contents (BL-1)',
    async () => {
      const adminClient = getAdmin();
      const passwordA = `Pass1234-${crypto.randomUUID().slice(0, 8)}`;
      const passwordB = `Pass1234-${crypto.randomUUID().slice(0, 8)}`;
      const emailA = `rls-photo-ls-a-${Date.now()}@leanshot.test`;
      const emailB = `rls-photo-ls-b-${Date.now()}@leanshot.test`;

      const { data: aRes, error: aErr } = await adminClient.auth.admin.createUser({
        email: emailA,
        password: passwordA,
        email_confirm: true,
      });
      if (aErr) throw aErr;
      const userA = aRes.user!;
      createdUserIds.push(userA.id);

      const { data: bRes, error: bErr } = await adminClient.auth.admin.createUser({
        email: emailB,
        password: passwordB,
        email_confirm: true,
      });
      if (bErr) throw bErr;
      const userB = bRes.user!;
      createdUserIds.push(userB.id);

      const userAClient = createClient(URL!, ANON!, {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
          storageKey: 'rls-photo-ls-a',
        },
      });
      const userBClient = createClient(URL!, ANON!, {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
          storageKey: 'rls-photo-ls-b',
        },
      });
      {
        const { error } = await userAClient.auth.signInWithPassword({
          email: emailA,
          password: passwordA,
        });
        if (error) throw error;
      }
      {
        const { error } = await userBClient.auth.signInWithPassword({
          email: emailB,
          password: passwordB,
        });
        if (error) throw error;
      }

      // Seed: user A uploads an object so there IS something to list.
      const photoId = crypto.randomUUID();
      const pathA = `${userA.id}/photos/${photoId}.jpg`;
      const blob = new Blob([JPEG_BYTES], { type: 'image/jpeg' });
      const { error: upErr } = await userAClient.storage.from('photos').upload(pathA, blob, {
        contentType: 'image/jpeg',
        upsert: false,
      });
      if (upErr) throw upErr;
      createdStoragePaths.push(pathA);

      // User B lists user A's folder. RLS may either return an empty list
      // OR filter the response — both are acceptable; the negative
      // invariant is "user A's photoId is NOT in the returned list".
      const { data: list } = await userBClient.storage
        .from('photos')
        .list(`${userA.id}/photos`);
      const filenames = (list ?? []).map((f) => f.name);
      expect(filenames).not.toContain(`${photoId}.jpg`);

      // Admin (service-role) listing confirms the seeded object really
      // exists — isolating "RLS hid it from B" from "object never got
      // created" (the upload step's null-error check above also covers
      // this, but the admin-list cross-check is the same defensive
      // pattern Phase 5's rls-injections.test.ts uses).
      const { data: adminList } = await adminClient.storage
        .from('photos')
        .list(`${userA.id}/photos`);
      const adminFilenames = (adminList ?? []).map((f) => f.name);
      expect(adminFilenames).toContain(`${photoId}.jpg`);
      void userB;
    },
    30_000,
  );
});

describe('Phase 6 06-04 SC#3 + BL-1 — gating', () => {
  it('runs against live cloud Storage when SUPABASE_SERVICE_ROLE_KEY is set', () => {
    if (!SHOULD_RUN) {
      // eslint-disable-next-line no-console
      console.warn(
        '[rls-photos-storage.test] SKIPPED — SUPABASE_SERVICE_ROLE_KEY (or URL/ANON) not set. CI gates this.',
      );
    }
    expect(true).toBe(true);
  });
});
