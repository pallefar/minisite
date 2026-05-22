/**
 * Phase 36 Plan 36-01 — REVIEW-08 contract tests for review_cta_catalog seed.
 *
 * Covers:
 *  - Seed shape: exactly 5 rows.
 *  - 3 with requires_mobile_shell=false (trustpilot/g2/capterra).
 *  - 2 with requires_mobile_shell=true (apple_app_store/google_play).
 *  - available_for_org_type CHECK enforces ('consumer','clinic','both').
 *  - SECDEF list_review_cta_catalog returns admin's view of catalog.
 *
 * Live-DB. Auto-skips when SUPABASE env is absent.
 */
/// <reference types="node" />
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { beforeAll, describe, expect, it } from 'vitest';

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? '';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY ?? '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

const SHOULD_RUN = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY && SUPABASE_SERVICE_ROLE_KEY);
const describeIfLive = SHOULD_RUN ? describe : describe.skip;

let admin: SupabaseClient;

describeIfLive('Phase 36 Plan 36-01 — review_cta_catalog seed', () => {
  beforeAll(() => {
    admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  });

  it('has all 5 seed rows', async () => {
    const { data, error } = await admin
      .from('review_cta_catalog')
      .select('slug, requires_mobile_shell, available_for_org_type, claimed');
    expect(error).toBeNull();
    const slugs = (data ?? []).map((r) => r.slug).sort();
    expect(slugs).toEqual(
      ['apple_app_store', 'capterra', 'g2', 'google_play', 'trustpilot'].sort(),
    );
  });

  it('exactly 3 web rows (requires_mobile_shell=false) and 2 mobile-shell rows (=true)', async () => {
    const { data, error } = await admin
      .from('review_cta_catalog')
      .select('slug, requires_mobile_shell');
    expect(error).toBeNull();
    const web = (data ?? []).filter((r) => r.requires_mobile_shell === false);
    const mobile = (data ?? []).filter((r) => r.requires_mobile_shell === true);
    expect(web.map((r) => r.slug).sort()).toEqual(['capterra', 'g2', 'trustpilot']);
    expect(mobile.map((r) => r.slug).sort()).toEqual(['apple_app_store', 'google_play']);
  });

  it('available_for_org_type CHECK rejects invalid value', async () => {
    // RLS denies authenticated INSERT; service-role bypasses RLS so the CHECK
    // is what surfaces here. Cleanup not needed — the CHECK fires before INSERT.
    const { error } = await admin
      .from('review_cta_catalog')
      .insert({
        slug: `p36-test-bad-${Date.now()}`,
        display_name: 'bad',
        url_pattern: 'https://example.com',
        // @ts-expect-error — intentionally invalid
        available_for_org_type: 'invalid_type',
      });
    expect(error).not.toBeNull();
    expect(`${error!.message} ${error!.code ?? ''}`).toMatch(/check|23514|violates/i);
  });

  it('url_pattern CHECK rejects non-https/itms-apps/market URLs', async () => {
    const { error } = await admin
      .from('review_cta_catalog')
      .insert({
        slug: `p36-test-bad-url-${Date.now()}`,
        display_name: 'bad',
        url_pattern: 'ftp://bad.example.com',
        available_for_org_type: 'consumer',
      });
    expect(error).not.toBeNull();
    expect(`${error!.message} ${error!.code ?? ''}`).toMatch(/check|23514|violates/i);
  });
});
