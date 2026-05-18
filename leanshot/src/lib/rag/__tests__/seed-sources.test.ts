/**
 * Phase 50 Plan 50-01 — rag_sources seed + tier defaults + CHECK constraint.
 *
 * Verifies, against the live cloud DB, that:
 *   T1: ≥ 12 rag_sources rows seeded
 *   T2: 5 Tier-A rows with freshness_window_days = 365
 *   T3: 5 Tier-B rows with freshness_window_days = 90
 *   T4: 2 Tier-C rows with freshness_window_days = 30
 *   T5: CHECK constraint rejects freshness_window_days = 0
 *
 * Pattern: service_role client only (read-only assertions on global seed).
 * No per-user fixtures needed because the seed is global and idempotent.
 *
 * Self-skips if SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY env vars absent.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const SHOULD_RUN = Boolean(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY);
const describeIfLive = SHOULD_RUN ? describe : describe.skip;

function getAdmin(): SupabaseClient {
  return createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

describeIfLive('Phase 50 Plan 50-01 — rag_sources seed', () => {
  const admin = getAdmin();

  it('seeds at least 12 rag_sources rows', async () => {
    const { count, error } = await admin
      .from('rag_sources')
      .select('id', { count: 'exact', head: true });
    expect(error).toBeNull();
    expect(count ?? 0).toBeGreaterThanOrEqual(12);
  });

  it('Tier A sources have freshness_window_days = 365 (expect 5)', async () => {
    const { data, error } = await admin
      .from('rag_sources')
      .select('domain, tier, freshness_window_days')
      .eq('tier', 'A')
      .eq('freshness_window_days', 365);
    expect(error).toBeNull();
    expect(data?.length ?? 0).toBeGreaterThanOrEqual(5);
  });

  it('Tier B sources have freshness_window_days = 90 (expect 5)', async () => {
    const { data, error } = await admin
      .from('rag_sources')
      .select('domain, tier, freshness_window_days')
      .eq('tier', 'B')
      .eq('freshness_window_days', 90);
    expect(error).toBeNull();
    expect(data?.length ?? 0).toBeGreaterThanOrEqual(5);
  });

  it('Tier C sources have freshness_window_days = 30 (expect 2)', async () => {
    const { data, error } = await admin
      .from('rag_sources')
      .select('domain, tier, freshness_window_days')
      .eq('tier', 'C')
      .eq('freshness_window_days', 30);
    expect(error).toBeNull();
    expect(data?.length ?? 0).toBeGreaterThanOrEqual(2);
  });

  it('CHECK constraint rejects freshness_window_days = 0', async () => {
    const { error } = await admin.from('rag_sources').insert({
      name: 'INVALID-test-0',
      domain: `invalid-${Date.now()}.test`,
      tier: 'A',
      freshness_window_days: 0,
    });
    expect(error).not.toBeNull();
    expect(error?.message ?? '').toMatch(/check|constraint/i);
  });
});
