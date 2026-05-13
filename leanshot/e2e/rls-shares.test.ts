/**
 * Phase 8 SHARE — extended RLS + structural proof for the `shares` surface.
 *
 * Project rule (memory `reference_supabase_project.md`): every RLS surface
 * gets a LIVE cross-tenant impersonation proof — not just policy SQL. This
 * file ships 5 real assertions, completing the Wave-0 scaffold:
 *
 *   1. cross-tenant — user B cannot SELECT user A's shares row (RLS)
 *   2. audit_logs.share_view row written when /share/snapshot is hit
 *   3. share_snapshot_view migration excludes ai_messages structurally
 *   4. /share/redeem code is single-use — second redeem returns 410
 *   5. /share/redeem per-share rate-limit — 6th wrong attempt returns 429
 *
 * Plan 08-05 Task 1 — completes the Wave-0 stubs.
 *
 * Environment:
 *   SUPABASE_URL              — public, e.g. https://<ref>.supabase.co
 *   SUPABASE_ANON_KEY         — public anon JWT (publishable)
 *   SUPABASE_SERVICE_ROLE_KEY — PRIVATE service-role JWT (NEVER commit; CI secret only)
 *
 * Skipped automatically if any required env var is absent (default local +
 * fork PR runs). CI sets these from repo secrets and gates merge.
 *
 * HI-6: every share created via `createTestShare` is admin-DELETED in
 * `afterAll(cleanupTestShares)` so concurrent CI runs don't accumulate
 * orphan rows.
 */

import { readFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, describe, expect, it } from 'vitest';

import { cleanupTestShares, createTestShare, hasLiveSupabase } from './fixtures/shares';

const URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const ANON = process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;

const SHOULD_RUN = hasLiveSupabase();
const describeIfLive = SHOULD_RUN ? describe : describe.skip;

const FN_BASE = URL ? `${URL}/functions/v1` : '';
// Repo-relative path is fine — vitest runs from leanshot/ (project root).
// resolvePath from cwd is robust across npm-scripts / Vitest worker.
const SNAPSHOT_VIEW_SQL_PATH = resolvePath(
  process.cwd(),
  '..',
  'supabase',
  'migrations',
  '20260701000004_share_snapshot_view.sql',
);

// Helper: locate the migration file whether vitest is run from /leanshot or
// from the repo root. Falls back through both candidates.
function readSnapshotViewSql(): string {
  const candidates = [
    SNAPSHOT_VIEW_SQL_PATH,
    resolvePath(process.cwd(), 'supabase', 'migrations', '20260701000004_share_snapshot_view.sql'),
  ];
  for (const candidate of candidates) {
    try {
      return readFileSync(candidate, 'utf8');
    } catch {
      // try next
    }
  }
  throw new Error(
    `share_snapshot_view migration not found at any of: ${candidates.join(', ')}`,
  );
}

describeIfLive('Phase 8 SHARE — extended RLS + structural proof', () => {
  let admin: SupabaseClient | null = null;
  const getAdmin = (): SupabaseClient => {
    if (!admin) {
      admin = createClient(URL!, SERVICE!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
    }
    return admin;
  };

  afterAll(async () => {
    // HI-6: clean up every share row created during the suite. Test users
    // (alice@/bob@) are stable across runs per the plan's accepted threats.
    await cleanupTestShares();
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 1) cross-tenant — user B cannot SELECT user A's shares row via RLS
  // ─────────────────────────────────────────────────────────────────────────
  it('cross-tenant — user B cannot SELECT user A shares row via RLS', async () => {
    const alice = await createTestShare({
      patientEmail: 'alice@test.com',
      label: 'alice-cross-tenant',
      expiresInHours: 24,
    });
    // Ensure bob exists too (look-up-or-create via the fixture's path —
    // we do this by creating a throwaway share for bob and discarding it;
    // simpler than re-exporting ensureTestUser).
    await createTestShare({
      patientEmail: 'bob@test.com',
      label: 'bob-warmup',
      expiresInHours: 1,
    });

    const bobClient = createClient(URL!, ANON!, {
      auth: { persistSession: false, autoRefreshToken: false, storageKey: 'rls-shares-bob' },
    });
    const { error: signInErr } = await bobClient.auth.signInWithPassword({
      email: 'bob@test.com',
      password: 'TestPass123!-leanshot-share-fixture',
    });
    if (signInErr) throw signInErr;

    // THE PROOF: user B reads ZERO of user A's shares. RLS returns empty
    // set silently rather than 403'ing.
    const { data, error } = await bobClient.from('shares').select('*').eq('id', alice.share_id);
    expect(error).toBeNull();
    expect(data).toEqual([]);

    // Defense in depth: confirm the row really exists via service-role.
    const { data: adminData } = await getAdmin().from('shares').select('*').eq('id', alice.share_id);
    expect(adminData).toHaveLength(1);
    expect(adminData![0]!.user_id).toBe(alice.patient_user_id);
  }, 30_000);

  // ─────────────────────────────────────────────────────────────────────────
  // 2) audit_logs row written on /share/snapshot view (SHARE-05)
  // ─────────────────────────────────────────────────────────────────────────
  it('audit row written on /snapshot view (SHARE-05)', async () => {
    const share = await createTestShare({
      patientEmail: 'alice@test.com',
      label: 'audit-view',
      expiresInHours: 1,
    });
    const redeem = await fetch(`${FN_BASE}/share/redeem`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:5173' },
      body: JSON.stringify({ token: share.raw_token, code: share.raw_code }),
    });
    expect(redeem.status).toBe(200);
    const setCookie = redeem.headers.get('set-cookie') ?? '';
    const match = setCookie.match(/recipient_session=[^;]+/);
    expect(match, `Set-Cookie missing recipient_session: ${setCookie}`).not.toBeNull();
    const cookie = match![0];

    const snap = await fetch(`${FN_BASE}/share/snapshot?token=${share.raw_token}`, {
      headers: { Cookie: cookie, Origin: 'http://localhost:5173' },
    });
    expect(snap.status).toBe(200);

    // Allow Postgres to commit the audit row before we count.
    await new Promise((r) => setTimeout(r, 500));

    const { count, error } = await getAdmin()
      .from('audit_logs')
      .select('*', { count: 'exact', head: true })
      .eq('share_id', share.share_id)
      .eq('actor_type', 'share_recipient')
      .eq('action', 'share_view');
    expect(error).toBeNull();
    expect(count).toBe(1);
  }, 30_000);

  // ─────────────────────────────────────────────────────────────────────────
  // 3) share_snapshot_view migration excludes ai_messages structurally
  // ─────────────────────────────────────────────────────────────────────────
  it('share_snapshot_view migration excludes ai_messages structurally', () => {
    const sql = readSnapshotViewSql().toLowerCase();
    // T-08-I7 / T-08-I1: AI columns MUST NEVER appear in the snapshot view.
    // Match identifier boundaries to avoid false negatives on incidental
    // substrings (e.g., a future comment containing "ai_messages" by name).
    expect(sql).not.toMatch(/\bai_messages\b/);
    expect(sql).not.toMatch(/\bai_history\b/);
    // Also forbid raw AI column names that might sneak in if someone tries
    // to "helpfully" join.
    expect(sql).not.toMatch(/\bai_conversation\b/);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 4) /share/redeem code is single-use — second redeem returns 410
  // ─────────────────────────────────────────────────────────────────────────
  it('code is single-use — second redeem returns 410 already-consumed', async () => {
    const share = await createTestShare({
      patientEmail: 'alice@test.com',
      label: 'single-use',
      expiresInHours: 1,
    });
    const r1 = await fetch(`${FN_BASE}/share/redeem`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:5173' },
      body: JSON.stringify({ token: share.raw_token, code: share.raw_code }),
    });
    expect(r1.status).toBe(200);

    const r2 = await fetch(`${FN_BASE}/share/redeem`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:5173' },
      body: JSON.stringify({ token: share.raw_token, code: share.raw_code }),
    });
    expect(r2.status).toBe(410);
    const body = await r2.json();
    expect(body.error).toBe('already-consumed');
  }, 30_000);

  // ─────────────────────────────────────────────────────────────────────────
  // 5) /share/redeem per-share rate-limit — 6th wrong attempt returns 429
  // ─────────────────────────────────────────────────────────────────────────
  it('per-share rate-limit — 6th wrong-code attempt within 60s returns 429', async () => {
    const share = await createTestShare({
      patientEmail: 'alice@test.com',
      label: 'rate-limit',
      expiresInHours: 1,
    });
    // 5 wrong-code requests should each return 401 invalid-code.
    for (let i = 0; i < 5; i++) {
      const r = await fetch(`${FN_BASE}/share/redeem`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:5173' },
        body: JSON.stringify({ token: share.raw_token, code: '999999' }),
      });
      expect(r.status, `attempt ${i + 1} expected 401`).toBe(401);
    }
    // 6th attempt — counter ≥5 within 60s → 429 rate-limited.
    const r6 = await fetch(`${FN_BASE}/share/redeem`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:5173' },
      body: JSON.stringify({ token: share.raw_token, code: '999999' }),
    });
    expect(r6.status).toBe(429);
    const body = await r6.json();
    expect(body.error).toBe('rate-limited');
    expect(typeof body.retry_after_sec).toBe('number');
  }, 60_000);
});

describe('Phase 8 SHARE — gating', () => {
  it('runs against live cloud DB when SUPABASE_SERVICE_ROLE_KEY is set', () => {
    if (!SHOULD_RUN) {
      // Not a failure — communicate skipped state.
      console.warn(
        '[rls-shares.test] SKIPPED — SUPABASE_SERVICE_ROLE_KEY (or URL/ANON) not set. CI gates this.',
      );
    }
    expect(true).toBe(true);
  });
});
