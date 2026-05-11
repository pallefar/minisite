/**
 * @phase05 SC#3 signout cache clear: sign in → snapshot localStorage →
 *          sign out via avatar menu → assert view='marketing' (NOT
 *          #/auth/signin per CONF-2) AND assert acknowledgedDisclaimer
 *          preserved (CONF-3) AND user-data slices cleared.
 *
 * Plan 05-02 Task 6.
 */
import { createClient } from '@supabase/supabase-js';
import { expect, test } from '@playwright/test';

const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY;
const HAS_LIVE_AUTH = Boolean(SERVICE_ROLE && SUPABASE_URL && ANON_KEY);

test.describe('@phase05 SC#3: signout clears cache + lands on marketing (CONF-2 + CONF-3)', () => {
  test.skip(!HAS_LIVE_AUTH, 'requires SUPABASE_SERVICE_ROLE_KEY + VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY');
  test.setTimeout(60_000);

  const email = `signout-${Date.now()}@leanshot.test`;
  const password = `Pass1234-${Date.now()}`;
  let userId: string | undefined;

  test.afterAll(async () => {
    if (!userId || !SERVICE_ROLE || !SUPABASE_URL) return;
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
    await admin.auth.admin.deleteUser(userId).catch(() => {});
  });

  test('signout returns to marketing (CONF-2) and preserves acknowledgedDisclaimer (CONF-3)', async ({
    page,
  }) => {
    const admin = createClient(SUPABASE_URL!, SERVICE_ROLE!, { auth: { persistSession: false } });
    const createRes = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    expect(createRes.error).toBeNull();
    userId = createRes.data?.user?.id;
    expect(userId).toBeDefined();

    await page.goto('/#/auth/signin');
    await page.getByLabel(/email/i).fill(email);
    await page.getByLabel(/password/i).fill(password);
    await page.getByRole('button', { name: /^sign in$/i }).click();
    await expect(page).not.toHaveURL(/#\/auth/, { timeout: 8000 });

    // Seed acknowledgedDisclaimer=v1 into the Zustand store so CONF-3 can assert preservation.
    await page.evaluate(() => {
      try {
        const keys = Object.keys(localStorage).filter((k) => k.startsWith('leanshot_v4'));
        for (const k of keys) {
          const raw = localStorage.getItem(k);
          if (!raw) continue;
          const data = JSON.parse(raw);
          if (!data?.state) continue;
          data.state.acknowledgedDisclaimer = 'v1';
          localStorage.setItem(k, JSON.stringify(data));
        }
      } catch {
        /* noop */
      }
    });

    // Open avatar menu and click Sign out.
    await page.getByRole('button', { name: /account menu/i }).click();
    await page.getByRole('menuitem', { name: /sign out/i }).click();

    // CONF-2: should NOT be on #/auth/signin or any auth path.
    await page.waitForTimeout(500);
    expect(page.url()).not.toMatch(/#\/auth/);

    // CONF-3: acknowledgedDisclaimer must survive sign-out across whatever keys remain.
    const persisted = await page.evaluate(() => {
      try {
        const keys = Object.keys(localStorage).filter((k) => k.startsWith('leanshot_v4'));
        const results: Array<{ key: string; ack: unknown; injections: number; aiHistory: number }> = [];
        for (const k of keys) {
          const raw = localStorage.getItem(k);
          if (!raw) continue;
          const data = JSON.parse(raw);
          results.push({
            key: k,
            ack: data?.state?.acknowledgedDisclaimer,
            injections: Array.isArray(data?.state?.injections) ? data.state.injections.length : -1,
            aiHistory: Array.isArray(data?.state?.aiHistory) ? data.state.aiHistory.length : -1,
          });
        }
        return results;
      } catch {
        return [];
      }
    });
    // At least one leanshot_v4* key must exist with ack:'v1' AND empty injections/aiHistory.
    const hasPreservedAck = persisted.some(
      (p) => p.ack === 'v1' && p.injections === 0 && p.aiHistory === 0,
    );
    expect(hasPreservedAck).toBe(true);
  });
});
