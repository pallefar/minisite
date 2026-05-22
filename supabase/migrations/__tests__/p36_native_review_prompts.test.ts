/**
 * Phase 36 Plan 36-01 — REVIEW-08 contract tests for native_review_prompts.
 *
 * Covers:
 *  - platform CHECK rejects values outside ('ios','android').
 *  - Service-role INSERT works for valid platforms.
 *  - v1.3 ships EMPTY — no production fires until v1.4 mobile shell.
 *
 * Live-DB. Auto-skips when SUPABASE env is absent.
 */
/// <reference types="node" />
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? '';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY ?? '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

const SHOULD_RUN = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY && SUPABASE_SERVICE_ROLE_KEY);
const describeIfLive = SHOULD_RUN ? describe : describe.skip;

const TEST_PREFIX = `p36-native-${Date.now().toString(36)}`;
let admin: SupabaseClient;

describeIfLive('Phase 36 Plan 36-01 — native_review_prompts', () => {
  let userId: string;
  const insertedIds: string[] = [];

  beforeAll(async () => {
    admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const email = `${TEST_PREFIX}-${Math.random().toString(36).slice(2, 8)}@example.test`;
    const { data: u, error } = await admin.auth.admin.createUser({
      email,
      password: 'p36-test-password-12345',
      email_confirm: true,
    });
    if (error || !u?.user) throw error ?? new Error('createUser failed');
    userId = u.user.id;
  }, 120_000);

  afterAll(async () => {
    if (!admin) return;
    if (insertedIds.length > 0) {
      await admin.from('native_review_prompts').delete().in('id', insertedIds);
    }
    await admin.auth.admin.deleteUser(userId).catch(() => undefined);
  });

  it('accepts platform=ios', async () => {
    const { data, error } = await admin
      .from('native_review_prompts')
      .insert({ user_id: userId, platform: 'ios' })
      .select('id')
      .single();
    expect(error).toBeNull();
    if (data?.id) insertedIds.push(data.id);
  });

  it('accepts platform=android', async () => {
    const { data, error } = await admin
      .from('native_review_prompts')
      .insert({ user_id: userId, platform: 'android' })
      .select('id')
      .single();
    expect(error).toBeNull();
    if (data?.id) insertedIds.push(data.id);
  });

  it('rejects platform outside enum (CHECK violation)', async () => {
    const { error } = await admin
      .from('native_review_prompts')
      // @ts-expect-error — intentionally invalid value
      .insert({ user_id: userId, platform: 'web' });
    expect(error).not.toBeNull();
    expect(`${error!.message} ${error!.code ?? ''}`).toMatch(/check|23514|violates/i);
  });
});
