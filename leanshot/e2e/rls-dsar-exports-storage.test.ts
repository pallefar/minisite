/**
 * Phase 22 Plan 22-12 — RLS proof for `storage.objects` in the `dsar-exports` bucket.
 *
 * Behaviors (Wave 0 it.skip replaced with live cross-tenant proofs):
 *   T1 service-role uploads a test object to `dsar-exports/{userA-id}/test.zip`.
 *   T2 user A can `list` their own folder and `createSignedUrl` for the object.
 *   T3 user B `list` of user A's folder returns ZERO entries (cross-tenant).
 *   T4 authenticated upload by user A to their own folder → 42501 / RLS deny
 *      (only service-role Edge Fn writes; clients can't self-stage a fake
 *      bundle).
 *
 * Per-file slug prefix `phase22-dsar-storage-rls`.
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

const DSAR_STORAGE_PREFIX = 'phase22-dsar-storage-rls';
const BUCKET = 'dsar-exports';

describeIfLive('Phase 22 plan 22-12 — RLS dsar-exports storage', () => {
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
  const stagedObjects: string[] = []; // full paths "{uid}/test-{stamp}.zip"

  beforeAll(async () => {
    const adminClient = getAdmin();
    const stamp = Date.now();
    const emailA = `${DSAR_STORAGE_PREFIX}-a-${stamp}@leanshot.test`;
    const emailB = `${DSAR_STORAGE_PREFIX}-b-${stamp}@leanshot.test`;
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
        storageKey: `${DSAR_STORAGE_PREFIX}-a`,
      },
    });
    const bClient = createClient(URL!, ANON!, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
        storageKey: `${DSAR_STORAGE_PREFIX}-b`,
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

    // Service-role uploads a test object to dsar-exports/{userA-id}/test.zip.
    const path = `${userA.id}/test-${stamp}.zip`;
    const bytes = new Blob([new Uint8Array([0x50, 0x4b, 0x03, 0x04])], {
      type: 'application/zip',
    });
    const { error: upErr } = await adminClient.storage
      .from(BUCKET)
      .upload(path, bytes, { contentType: 'application/zip', upsert: true });
    if (upErr) throw upErr;
    stagedObjects.push(path);
  }, 60_000);

  afterAll(async () => {
    if (!admin) return;
    for (const p of stagedObjects) {
      try {
        await admin.storage.from(BUCKET).remove([p]);
      } catch {
        /* best-effort */
      }
    }
    for (const id of createdUserIds) {
      try {
        // Also clean any objects under {uid}/ in case sub-folders accumulated.
        const { data: leftovers } = await admin.storage.from(BUCKET).list(id);
        if (Array.isArray(leftovers) && leftovers.length) {
          const paths = leftovers
            .filter((x) => x?.name)
            .map((x) => `${id}/${x.name}`);
          if (paths.length) {
            await admin.storage.from(BUCKET).remove(paths);
          }
        }
      } catch {
        /* best-effort */
      }
      try {
        await admin.auth.admin.deleteUser(id);
      } catch {
        /* best-effort */
      }
    }
  });

  it('user A lists own folder; user B sees ZERO of user A folder', async () => {
    const a = userA!;
    const b = userB!;

    const { data: aList, error: aErr } = await a.client.storage.from(BUCKET).list(a.id);
    expect(aErr).toBeNull();
    expect(Array.isArray(aList) && aList.length).toBeGreaterThanOrEqual(1);

    const { data: bList, error: bErr } = await b.client.storage.from(BUCKET).list(a.id);
    // Either an explicit empty array OR an RLS-driven error. Both prove deny.
    if (bErr) {
      expect(
        bErr.message?.includes('not found') ||
          bErr.message?.includes('Unauthorized') ||
          /row-level security/i.test(bErr.message ?? ''),
      ).toBeTruthy();
    } else {
      expect(bList).toEqual([]);
    }
  }, 30_000);

  it('user A can createSignedUrl for own bundle object', async () => {
    const a = userA!;
    const targetPath = stagedObjects[0];
    expect(targetPath).toBeTruthy();

    const { data, error } = await a.client.storage
      .from(BUCKET)
      .createSignedUrl(targetPath!, 60);
    expect(error).toBeNull();
    expect(data?.signedUrl).toMatch(/^https?:\/\//);
  }, 30_000);

  it('authenticated upload (user A) → 42501 / RLS deny (service-role only)', async () => {
    const a = userA!;
    const path = `${a.id}/attempt-${Date.now()}.zip`;
    const bytes = new Blob([new Uint8Array([0x00, 0x00])], { type: 'application/zip' });

    const { error } = await a.client.storage
      .from(BUCKET)
      .upload(path, bytes, { contentType: 'application/zip' });

    expect(error).not.toBeNull();
    expect(
      /row-level security/i.test(error!.message ?? '') ||
        /Unauthorized/i.test(error!.message ?? '') ||
        /policy/i.test(error!.message ?? ''),
    ).toBe(true);
  }, 30_000);
});

describe('Phase 22 plan 22-12 — RLS dsar-exports storage gating', () => {
  it('runs against live cloud DB when SUPABASE_SERVICE_ROLE_KEY is set', () => {
    if (!SHOULD_RUN) {
      // eslint-disable-next-line no-console
      console.warn(
        '[rls-dsar-exports-storage] SKIPPED — SUPABASE_SERVICE_ROLE_KEY (or URL/ANON) not set.',
      );
    }
    expect(true).toBe(true);
  });
});
