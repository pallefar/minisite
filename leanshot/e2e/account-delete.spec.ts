/**
 * @phase07 SC: account-delete happy-path (COMPL-06 + D-03).
 *
 * Single-test e2e that exercises the entire delete lifecycle:
 *   1. Admin client seeds a user + sentinel rows in 3 sync tables + 1 photo.
 *   2. SPA flow: sign in → open Settings → Privacy → "Delete my account…".
 *   3. Typed-confirm gate: button stays disabled until typed === email
 *      (case-insensitive + trimmed).
 *   4. Click destructive button → toast → redirected away from dashboard.
 *   5. Assert T+0 invariants: pending_account_deletions row exists,
 *      audit_logs has `account_deleted_initiated` row, photos moved to
 *      `photos-pending-shred/<uid>/` prefix.
 *   6. Simulate T+30: admin back-dates initiated_at to 31 days ago, calls
 *      `run_finalize_account_deletions_cron_now` (the e2e test hook).
 *   7. Assert T+30 invariants: zero rows for user across all 13 tables;
 *      zero objects under both storage prefixes; exactly 2 audit-skeleton
 *      rows survive with user_id=null + user_id_hash intact.
 *
 * Skip-gates on SUPABASE_SERVICE_ROLE_KEY + VITE_SUPABASE_URL +
 * VITE_SUPABASE_ANON_KEY (pattern from auth-signup-verify-signin.spec.ts).
 *
 * Plan 07-07 Task 5 (TDD-tracked, autonomous=false plan).
 */
import { createHash } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { expect, test } from '@playwright/test';

const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY;
const HAS_LIVE = Boolean(SERVICE_ROLE && SUPABASE_URL && ANON_KEY);

const SYNC_TABLES = [
  'injections',
  'weights',
  'meals',
  'workouts',
  'supplements',
  'mood',
  'sleep',
  'symptoms',
  'vials',
  'settings',
  'ai_messages',
  'rate_limit_counters',
  'photos',
] as const;

const SEEDED_USER = {
  name: 'Delete Test User',
  medication: 'tirzepatide',
  startDate: '2026-01-01',
  startWeight: 100,
  height: 175,
  age: 35,
  sex: 'male',
  bodyFat: null,
  goalWeight: 80,
  goal: 'fat-loss',
  dose: '2.5',
  doseUnit: 'mg',
  units: 'metric',
  proteinTarget: 130,
  calorieTarget: 1800,
  fiberTarget: 30,
  waterTarget: 8,
  injectionDay: 1,
  activityLevel: 'moderate',
  liftingLevel: 'beginner',
  createdAt: '2026-01-01T00:00:00.000Z',
};
// Mirror cross-device-sync.spec.ts RC4 seed shape — migration_state.complete=true
// so maybeStartMigration's early-exit fires and the MigrationModal does NOT
// render post-signin (this spec is NOT testing migration).
const SEEDED_BLOB = JSON.stringify({
  state: {
    user: SEEDED_USER,
    injections: [],
    symptoms: [],
    weights: [],
    measurements: [],
    meals: [],
    water: {},
    foodNoise: {},
    workouts: [],
    steps: {},
    supplements: {},
    mood: [],
    sleep: [],
    nsvs: [],
    photos: [],
    vials: [],
    aiHistory: [],
    costs: [],
    pendingOps: [],
    acknowledgedDisclaimer: 'v1',
    migration_state: {
      startedAt: '2026-01-01T00:00:00Z',
      complete: true,
      snapshotKey: 'leanshot_v4_pre_cloud_backup',
      photos: 'complete',
      injections: 'complete',
      weights: 'complete',
      meals: 'complete',
      workouts: 'complete',
      supplements: 'complete',
      mood: 'complete',
      sleep: 'complete',
      symptoms: 'complete',
      vials: 'complete',
      settings: 'complete',
    },
  },
  version: 7,
});

test.describe('@phase07 account-delete COMPL-06: end-to-end happy path', () => {
  test.skip(!HAS_LIVE, 'requires SUPABASE_SERVICE_ROLE_KEY + VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY');
  test.setTimeout(120_000);

  const email = `pw-delete-${Date.now()}@leanshot.test`;
  const password = `Pass1234-${Date.now()}`;
  let userId: string | undefined;
  let userIdHash: string | undefined;

  test.afterAll(async () => {
    if (!SERVICE_ROLE || !SUPABASE_URL) return;
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
      auth: { persistSession: false },
    });
    // Best-effort cleanup of straggler audit rows (the finalize cron leaves
    // the skeleton survivors by design — that's the test invariant). Only
    // delete the test's own skeleton rows, identified by user_id_hash
    // (since user_id is null post-cascade). The supabase-js query builder
    // is then-able but not .catch-chainable, so wrap in try/catch.
    if (userIdHash) {
      try {
        await admin.from('audit_logs').delete().eq('user_id_hash', userIdHash);
      } catch {
        /* best-effort */
      }
    }
    if (userId) {
      // The user is most likely already gone (finalize cron deletes
      // auth.users), but call deleteUser idempotently in case a step failed
      // before the cron tick.
      try {
        await admin.auth.admin.deleteUser(userId);
      } catch {
        /* best-effort */
      }
    }
  });

  test('initiates → audit skeleton + pending row + photos moved; cron finalizes → all rows purged + 2 skeleton rows survive', async ({
    page,
  }) => {
    const admin = createClient(SUPABASE_URL!, SERVICE_ROLE!, {
      auth: { persistSession: false },
    });

    // ──────────────────────────────────────────────────────────────────
    // 1. Setup — admin creates the user + sentinel data.
    // ──────────────────────────────────────────────────────────────────
    const createRes = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    expect(createRes.error).toBeNull();
    userId = createRes.data.user?.id;
    expect(userId).toBeTruthy();
    userIdHash = createHash('sha256').update(userId!).digest('hex');

    // Sentinel rows in 3 sync tables — proves the cascade DELETE actually runs.
    const { error: injErr } = await admin.from('injections').insert({
      user_id: userId,
      log_id: crypto.randomUUID(),
      medication: 'ozempic',
      dose: '0.5',
      unit: 'mg',
      logged_at: new Date().toISOString(),
    });
    expect(injErr, 'seed injections').toBeNull();

    const { error: wErr } = await admin.from('weights').insert({
      user_id: userId,
      weight_id: crypto.randomUUID(),
      date: '2026-05-12',
      weight: 90,
      ts: Date.now(),
    });
    expect(wErr, 'seed weights').toBeNull();

    const photoId = crypto.randomUUID();
    const { error: pErr } = await admin.from('photos').insert({
      user_id: userId,
      photo_id: photoId,
      date: '2026-05-12',
      storage_path: `${userId}/photos/${photoId}.jpg`,
      mime_type: 'image/jpeg',
      size_bytes: 100,
    });
    expect(pErr, 'seed photos').toBeNull();

    // Upload a tiny sentinel image to Storage at <userId>/photos/<photoId>.jpg.
    const sentinelBytes = Buffer.from('test-image-bytes');
    const { error: upErr } = await admin.storage
      .from('photos')
      .upload(`${userId}/photos/${photoId}.jpg`, sentinelBytes, {
        contentType: 'image/jpeg',
        upsert: true,
      });
    expect(upErr, 'storage upload').toBeNull();

    // ──────────────────────────────────────────────────────────────────
    // 2. Seed the persisted Zustand blob via addInitScript — runs BEFORE
    // any SPA JS on every page nav, so hydrate() reads the seed and
    // post-signin lands on dashboard (not onboarding). The legacy "goto +
    // evaluate + reload" pattern raced supabase-js's INITIAL_SESSION(null)
    // against the seed write. See cross-device-sync.spec.ts seedUserAndSignIn
    // + .planning/debug/phase7-e2e-rc4-state-wipe-race.md.
    // The "if empty" guard makes this idempotent across the SPA's post-signin
    // namespace rename (leanshot_v4 → leanshot_v4:<hash>).
    // ──────────────────────────────────────────────────────────────────
    await page.addInitScript((blob: string) => {
      try {
        if (!localStorage.getItem('leanshot_v4')) {
          localStorage.setItem('leanshot_v4', blob);
          localStorage.setItem('leanshot_tour_seen_v4', '1');
        }
      } catch {
        /* private-mode noop */
      }
    }, SEEDED_BLOB);

    // ──────────────────────────────────────────────────────────────────
    // 3. SPA sign-in.
    // ──────────────────────────────────────────────────────────────────
    await page.goto('/#/auth/signin');
    await page.getByLabel(/email/i).fill(email);
    await page.getByLabel(/password/i).fill(password);
    await page.getByRole('button', { name: /^sign in$/i }).click();
    // Use 30s budget — cold-start dyn imports + supabase auth round-trip can
    // take 8-12s locally (CI is slower per cross-device-sync precedent).
    await expect(page).not.toHaveURL(/#\/auth/, { timeout: 30_000 });

    // The seeded migration_state.complete=true triggers MigrationModal's
    // "All done" success variant (aria-modal=true, intercepts pointer
    // events). Wait for it to appear (it renders after maybeStartMigration
    // resolves post-signin, typically 1-3s after URL transition) then
    // dismiss via "Continue to dashboard". The dialog has a backdrop with
    // pointer-events that blocks anything underneath until dismissed.
    const continueBtn = page.getByRole('button', {
      name: /continue to dashboard/i,
    });
    await continueBtn.waitFor({ state: 'visible', timeout: 15_000 });
    await continueBtn.click();
    // Wait for the modal to fully tear down (framer-motion exit animation).
    await expect(
      page.getByRole('dialog', { name: /all done/i }),
    ).not.toBeVisible({ timeout: 5_000 });

    // ──────────────────────────────────────────────────────────────────
    // 4. Open Settings → Privacy → click "Delete my account…".
    // ──────────────────────────────────────────────────────────────────
    await page
      .getByRole('button', { name: /open settings/i })
      .first()
      .click({ timeout: 30_000 });
    await page.getByRole('button', { name: /^privacy$/i }).click();
    // Phase 22 Plan 22-05: settings-side button is now "Delete account"
    // (UI-SPEC line 567) instead of "Delete my account…".
    await page.getByRole('button', { name: /^Delete account$/ }).click();

    // Modal verbatim copy assertions (e2e + RTL share the same substrings).
    // Phase 22 Plan 22-05: modal title is "Delete account" (no longer
    // "Delete my account"); body intro + bullets per UI-SPEC §Copywriting
    // line 569-570; typed-confirm is the literal "DELETE MY ACCOUNT"
    // phrase, not the user's email.
    const modal = page.getByRole('dialog', { name: /^Delete account$/i });
    await expect(modal).toBeVisible();
    await expect(
      modal.getByText('This will permanently delete your LeanShot account, including:'),
    ).toBeVisible();
    await expect(modal.getByText(/Same-email re-signup/i)).toBeVisible();
    await expect(modal.getByText(/7 years per IRS requirements/i)).toBeVisible();

    // ──────────────────────────────────────────────────────────────────
    // 4. Typed-confirm gate — Phase 22 UI-SPEC line 572-573 requires the
    //    literal "DELETE MY ACCOUNT" (case-sensitive, exact match).
    // ──────────────────────────────────────────────────────────────────
    // The destructive button shares its accessible name with the modal
    // title — scope by dialog and pick the button (not the heading).
    const confirmBtn = modal.getByRole('button', { name: /^Delete account$/ });
    await expect(confirmBtn).toBeDisabled();

    const input = page.getByLabel(/Type DELETE MY ACCOUNT to confirm/);
    // Mismatch (lowercase) — UI-SPEC says case-sensitive exact match.
    await input.fill('delete my account');
    await expect(confirmBtn).toBeDisabled();

    // Exact match — should enable.
    await input.fill('DELETE MY ACCOUNT');
    await expect(confirmBtn).toBeEnabled();

    // Email value left intentionally unused — Phase 22 typed-confirm is
    // phrase-based, not email-based. Keeping the variable for the audit
    // assertions later in this spec.
    void email;

    // ──────────────────────────────────────────────────────────────────
    // 5. Confirm — RPC fires, sessions deleted, redirected to auth view.
    // ──────────────────────────────────────────────────────────────────
    await confirmBtn.click();

    // Wait for the destructive flow to complete: modal closes AND we land on
    // the auth view (signOut redirects to #/auth/signin via the SPA's
    // SIGNED_OUT handler). Using both signals catches the case where the
    // modal closes for the wrong reason (e.g., recent_auth_required would
    // keep it open; only success or already_pending close it).
    await expect(modal).not.toBeVisible({ timeout: 15_000 });
    await expect(page).toHaveURL(/#\/auth\/signin|^https?:\/\/[^/]+\/?$/, {
      timeout: 15_000,
    });

    // ──────────────────────────────────────────────────────────────────
    // 6. Assert T+0 invariants.
    // ──────────────────────────────────────────────────────────────────
    const { data: pending } = await admin
      .from('pending_account_deletions')
      .select('user_id, initiated_at, photos_moved_at')
      .eq('user_id', userId!)
      .maybeSingle();
    expect(pending).toBeTruthy();
    expect(pending!.initiated_at).toBeTruthy();
    expect(pending!.photos_moved_at).toBeTruthy();

    // Audit-skeleton `account_deleted_initiated` row written inline by the RPC.
    const { data: audit, error: auditErr } = await admin
      .from('audit_logs')
      .select('action, user_id_hash')
      .eq('user_id', userId!)
      .eq('action', 'account_deleted_initiated');
    expect(auditErr).toBeNull();
    expect(audit).toHaveLength(1);
    expect(audit![0].user_id_hash).toBe(userIdHash);

    // Photo moved to `photos-pending-shred/<userId>/`.
    const { data: origList } = await admin.storage
      .from('photos')
      .list(`${userId}/photos`);
    expect(origList ?? []).toHaveLength(0);
    const { data: shredList } = await admin.storage
      .from('photos')
      .list(`photos-pending-shred/${userId}`);
    expect((shredList ?? []).length).toBeGreaterThan(0);

    // ──────────────────────────────────────────────────────────────────
    // 7. Simulate T+30 — back-date initiated_at + run cron now.
    // ──────────────────────────────────────────────────────────────────
    const thirtyOneDaysAgo = new Date(Date.now() - 31 * 86400_000).toISOString();
    const { error: backDateErr } = await admin
      .from('pending_account_deletions')
      .update({ initiated_at: thirtyOneDaysAgo })
      .eq('user_id', userId!);
    expect(backDateErr).toBeNull();

    const { error: cronErr } = await admin.rpc(
      'run_finalize_account_deletions_cron_now',
    );
    expect(cronErr).toBeNull();

    // ──────────────────────────────────────────────────────────────────
    // 8. Assert T+30 invariants — zero rows + 2 surviving skeleton rows.
    // ──────────────────────────────────────────────────────────────────
    const { data: userRow } = await admin.auth.admin.getUserById(userId!);
    expect(userRow.user).toBeNull();

    const { data: pending2 } = await admin
      .from('pending_account_deletions')
      .select('user_id')
      .eq('user_id', userId!);
    expect(pending2 ?? []).toHaveLength(0);

    for (const t of SYNC_TABLES) {
      const { data, error } = await admin
        .from(t)
        .select('*')
        .eq('user_id', userId!);
      expect(error, `${t} query failed`).toBeNull();
      expect(data ?? [], `${t} not empty`).toHaveLength(0);
    }

    const { data: shred } = await admin.storage
      .from('photos')
      .list(`photos-pending-shred/${userId}`);
    expect(shred ?? []).toHaveLength(0);
    const { data: origAfter } = await admin.storage
      .from('photos')
      .list(`${userId}/photos`);
    expect(origAfter ?? []).toHaveLength(0);

    // Skeleton survivors — exactly 2 ('account_deleted_initiated' +
    // 'account_deleted_finalized'). The cascade DELETE on auth.users sets
    // audit_logs.user_id to NULL (per `on delete set null`) on ALL of this
    // user's audit rows, including the per-row 'insert' entries from the
    // test's sentinel seeding. We assert on the SKELETON SUBSET only — the
    // contract is "skeletons survive forever", not "total row count == 2"
    // (the per-row entries get culled by 07-08's 13-month retention cron,
    // not by finalize). user_id_hash is the stable join key.
    const { data: survivingAudit } = await admin
      .from('audit_logs')
      .select('action, user_id')
      .eq('user_id_hash', userIdHash!)
      .like('action', 'account_deleted_%');
    expect(survivingAudit).toHaveLength(2);
    const actions = (survivingAudit ?? [])
      .map((r) => r.action as string)
      .sort();
    expect(actions).toEqual([
      'account_deleted_finalized',
      'account_deleted_initiated',
    ]);
    expect((survivingAudit ?? []).every((r) => r.user_id === null)).toBe(true);
  });
});
