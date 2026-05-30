/**
 * Phase 28 Plan 01 — cross-tenant RLS proof for `org_branding`.
 *
 * Tests (per plan Task 3, Tests 3-5):
 *   T3: User A cannot SELECT org_branding of Org Y.
 *   T4: User A cannot INSERT into org_branding of Org Y.
 *   T5: User A cannot UPDATE org_branding of Org Y.
 *
 * Phase 31 Plan 31-02 extensions (T6–T16):
 *   T6:  Cross-tenant save_org_branding denial (SECDEF permission gate)
 *   T7:  oklch format rejection (INVALID_OKLCH_FORMAT)
 *   T8:  radius_scale rejection (INVALID_RADIUS_SCALE)
 *   T9:  font rejection (INVALID_FONT_FAMILY)
 *   T10: WCAG text/bg contrast fail (CONTRAST_TEXT_BG_FAIL)
 *   T11: WCAG primary/bg contrast fail (CONTRAST_PRIMARY_BG_FAIL)
 *   T12: Happy path upsert + audit_logs row
 *   T13: Storage path-prefix DENIAL (owner of orgX cannot write to orgY prefix)
 *   T14: Storage path-prefix ALLOW (owner of orgY can write to orgY prefix) + public-read
 *   T15: Edge Fn 403 cross-tenant (orgX session cannot mint URL for orgY)
 *   T16: Edge Fn 200 own org (orgY session mints URL for orgY)
 */

import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  SHOULD_RUN,
  cleanupByPrefix,
  createTwoOrgsTwoUsers,
  getAdmin,
  makeSlugPrefix,
  type TwoOrgsTwoUsers,
} from './_fixtures/p28-rls-fixture';

const TEST_SLUG_PREFIX = makeSlugPrefix(path.basename(__filename));
const describeIfLive = SHOULD_RUN ? describe : describe.skip;

describeIfLive('P28 RLS — org_branding cross-tenant isolation', () => {
  let fixture: TwoOrgsTwoUsers;

  beforeAll(async () => {
    fixture = await createTwoOrgsTwoUsers(TEST_SLUG_PREFIX);
    // Seed org_branding for Org Y via admin.
    const admin = getAdmin();
    await admin.from('org_branding').upsert({
      org_id: fixture.orgY,
      primary_color: '#FF0000',
    });
  }, 60_000);

  afterAll(async () => {
    await cleanupByPrefix(TEST_SLUG_PREFIX);
  });

  it('T3: User A cannot SELECT org_branding of Org Y', async () => {
    const { orgY, sessA } = fixture;
    const { data, error } = await sessA.client
      .from('org_branding')
      .select('org_id')
      .eq('org_id', orgY);
    expect(error).toBeNull();
    expect(data ?? []).toHaveLength(0);
  }, 30_000);

  it('T4: User A cannot INSERT into org_branding of Org Y', async () => {
    const { orgY, sessA } = fixture;
    const { error } = await sessA.client.from('org_branding').insert({ org_id: orgY });
    expect(error).not.toBeNull();
  }, 30_000);

  it('T5: User A cannot UPDATE org_branding of Org Y', async () => {
    const { orgY, sessA } = fixture;
    await sessA.client.from('org_branding').update({ primary_color: '#00FF00' }).eq('org_id', orgY);
    // Verify Org Y branding unchanged via admin.
    const admin = getAdmin();
    const { data } = await admin
      .from('org_branding')
      .select('primary_color')
      .eq('org_id', orgY)
      .single();
    expect(data?.primary_color).toBe('#FF0000'); // unchanged
  }, 30_000);

  it('T: User B (member) CAN SELECT their own org_branding', async () => {
    const { orgY, sessB } = fixture;
    const { data, error } = await sessB.client
      .from('org_branding')
      .select('org_id')
      .eq('org_id', orgY);
    expect(error).toBeNull();
    expect((data ?? []).length).toBeGreaterThan(0);
  }, 30_000);
});

// =============================================================================
// Phase 31 Plan 31-02 — save_org_branding SECDEF + Storage path-prefix isolation
//
// Reuses the same fixture (TEST_SLUG_PREFIX, TwoOrgsTwoUsers) from the P28 block above.
// afterAll cleanup is shared — single-source slug-prefix cleanup per
// [[feedback_rls_per_file_slug_prefix]].
//
// Fixture note: createTwoOrgsTwoUsers already inserts both users as role='owner'
// of their respective org (P28-rls-fixture.ts lines 185/192). No additional
// role elevation is needed for T6–T16.
// =============================================================================

describeIfLive('P31 RLS — save_org_branding SECDEF + Storage path-prefix isolation', () => {
  let fixture: TwoOrgsTwoUsers;

  const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? '';

  beforeAll(async () => {
    // Re-create the fixture using the same slug prefix so cleanup remains single-source.
    fixture = await createTwoOrgsTwoUsers(TEST_SLUG_PREFIX + '-p31');
  }, 90_000);

  afterAll(async () => {
    await cleanupByPrefix(TEST_SLUG_PREFIX + '-p31');
  });

  // -------------------------------------------------------------------------
  // T6: Cross-tenant save_org_branding denial
  // -------------------------------------------------------------------------
  it('T6: user A cannot save_org_branding for Org Y (cross-tenant denial)', async () => {
    const { orgY, sessA } = fixture;
    const { error } = await sessA.client.rpc('save_org_branding', {
      p_org_id: orgY,
      p_tokens: { primary_color: 'oklch(0.20 0.18 240)' },
    });
    expect(error).not.toBeNull();
    const isPrivError =
      error?.code === '42501' ||
      error?.message?.includes('insufficient_privilege') ||
      error?.message?.includes('42501');
    expect(isPrivError).toBe(true);
  }, 30_000);

  // -------------------------------------------------------------------------
  // T7: oklch format rejection
  // -------------------------------------------------------------------------
  it('T7: save_org_branding rejects non-oklch color (INVALID_OKLCH_FORMAT)', async () => {
    const { orgY, sessB } = fixture;
    const { error } = await sessB.client.rpc('save_org_branding', {
      p_org_id: orgY,
      p_tokens: { primary_color: 'rgb(255, 0, 0)' },
    });
    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/INVALID_OKLCH_FORMAT/);
  }, 30_000);

  // -------------------------------------------------------------------------
  // T8: radius_scale rejection
  // -------------------------------------------------------------------------
  it('T8: save_org_branding rejects invalid radius_scale (INVALID_RADIUS_SCALE)', async () => {
    const { orgY, sessB } = fixture;
    const { error } = await sessB.client.rpc('save_org_branding', {
      p_org_id: orgY,
      p_tokens: { radius_scale: 'huge' },
    });
    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/INVALID_RADIUS_SCALE/);
  }, 30_000);

  // -------------------------------------------------------------------------
  // T9: Font family rejection
  // -------------------------------------------------------------------------
  it('T9: save_org_branding rejects font not in curated list (INVALID_FONT_FAMILY)', async () => {
    const { orgY, sessB } = fixture;
    const { error } = await sessB.client.rpc('save_org_branding', {
      p_org_id: orgY,
      p_tokens: { heading_font: 'Comic Sans' },
    });
    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/INVALID_FONT_FAMILY/);
  }, 30_000);

  // -------------------------------------------------------------------------
  // T10: WCAG text/bg contrast fail
  // -------------------------------------------------------------------------
  it('T10: save_org_branding rejects low-contrast text/bg pair (CONTRAST_TEXT_BG_FAIL)', async () => {
    const { orgY, sessB } = fixture;
    // text_color L=0.95 and bg_color L=0.97 → contrast ~1.08, well below 4.5
    const { error } = await sessB.client.rpc('save_org_branding', {
      p_org_id: orgY,
      p_tokens: {
        text_color: 'oklch(0.95 0.01 90)',
        bg_color: 'oklch(0.97 0.01 90)',
      },
    });
    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/CONTRAST_TEXT_BG_FAIL/);
  }, 30_000);

  // -------------------------------------------------------------------------
  // T11: WCAG primary/bg contrast fail
  // -------------------------------------------------------------------------
  it('T11: save_org_branding rejects low-contrast primary/bg pair (CONTRAST_PRIMARY_BG_FAIL)', async () => {
    const { orgY, sessB } = fixture;
    // primary_color L=0.92 and bg_color L=0.95 → contrast ~1.21, well below 3.0
    const { error } = await sessB.client.rpc('save_org_branding', {
      p_org_id: orgY,
      p_tokens: {
        primary_color: 'oklch(0.92 0.05 240)',
        bg_color: 'oklch(0.95 0.02 240)',
      },
    });
    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/CONTRAST_PRIMARY_BG_FAIL/);
  }, 30_000);

  // -------------------------------------------------------------------------
  // T12: Happy path — upsert all 10 fields + audit_logs row
  // -------------------------------------------------------------------------
  it('T12: save_org_branding happy path persists all 10 fields + writes audit_logs row', async () => {
    const { orgY, sessB } = fixture;
    const admin = getAdmin();

    const tokens = {
      primary_color: 'oklch(0.20 0.18 240)',
      accent_color: 'oklch(0.55 0.10 150)',
      bg_color: 'oklch(0.97 0.02 95)',
      text_color: 'oklch(0.15 0.02 50)',
      heading_font: 'Fraunces',
      body_font: 'Inter',
      radius_scale: 'md',
      logo_url: 'https://example.com/logo.png',
      favicon_url: 'https://example.com/favicon.ico',
      support_email: 'support@example.com',
    };

    const { error } = await sessB.client.rpc('save_org_branding', {
      p_org_id: orgY,
      p_tokens: tokens,
    });
    expect(error).toBeNull();

    // Verify all 10 fields persisted via admin read.
    const { data: row, error: readErr } = await admin
      .from('org_branding')
      .select(
        'primary_color, accent_color, bg_color, text_color, heading_font, body_font, radius_scale, logo_url, favicon_url, support_email',
      )
      .eq('org_id', orgY)
      .single();
    expect(readErr).toBeNull();
    expect(row?.primary_color).toBe(tokens.primary_color);
    expect(row?.accent_color).toBe(tokens.accent_color);
    expect(row?.bg_color).toBe(tokens.bg_color);
    expect(row?.text_color).toBe(tokens.text_color);
    expect(row?.heading_font).toBe(tokens.heading_font);
    expect(row?.body_font).toBe(tokens.body_font);
    expect(row?.radius_scale).toBe(tokens.radius_scale);
    expect(row?.logo_url).toBe(tokens.logo_url);
    expect(row?.favicon_url).toBe(tokens.favicon_url);
    expect(row?.support_email).toBe(tokens.support_email);

    // Verify audit_logs row written (T-31-02-10 mitigate).
    const { data: auditRows, error: auditErr } = await admin
      .from('audit_logs')
      .select('id, action_name')
      .eq('action_name', 'org_branding.update')
      // Phase 70-07 cascade-45 — `->` returns jsonb; comparing it 'eq' a uuid string
      // made PostgREST cast and throw 22P02. Use `->>` (text extraction) to match the
      // org_id value save_org_branding writes into after_data.
      .filter('after_data->>org_id', 'eq', orgY)
      .limit(5);
    expect(auditErr).toBeNull();
    expect((auditRows ?? []).length).toBeGreaterThanOrEqual(1);
  }, 30_000);

  // -------------------------------------------------------------------------
  // T13: Storage path-prefix DENIAL
  // -------------------------------------------------------------------------
  it('T13: owner of orgX cannot upload to org-branding at orgY prefix (Storage RLS denial)', async () => {
    const { orgX: _orgX, orgY, sessA } = fixture;
    const admin = getAdmin();

    // User A (owner of orgX) tries to upload to orgY's prefix.
    const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const { error: uploadErr } = await sessA.client.storage
      .from('org-branding')
      .upload(`${orgY}/logo.png`, new Blob([pngBytes], { type: 'image/png' }), { upsert: true });

    expect(uploadErr).not.toBeNull();

    // Confirm no object was created at that path via admin.
    const { data: objects } = await admin.storage
      .from('org-branding')
      .list(orgY, { search: 'logo.png' });
    const found = (objects ?? []).find((o) => o.name === 'logo.png');
    expect(found).toBeUndefined();
  }, 30_000);

  // -------------------------------------------------------------------------
  // T14: Storage path-prefix ALLOW + public-read
  // -------------------------------------------------------------------------
  it('T14: owner of orgY can upload to org-branding at orgY prefix + anonymous GET succeeds', async () => {
    const { orgY, sessB } = fixture;

    const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const { error: uploadErr } = await sessB.client.storage
      .from('org-branding')
      .upload(`${orgY}/logo-test.png`, new Blob([pngBytes], { type: 'image/png' }), {
        upsert: true,
      });
    expect(uploadErr).toBeNull();

    // Anonymous GET against the public-read URL (T-31-02-07 accept).
    if (SUPABASE_URL) {
      const publicUrl = `${SUPABASE_URL}/storage/v1/object/public/org-branding/${orgY}/logo-test.png`;
      const resp = await fetch(publicUrl);
      // Expect 200 (object exists and bucket is public-read).
      expect(resp.status).toBe(200);
    }
  }, 30_000);

  // -------------------------------------------------------------------------
  // T15: Edge Fn 403 cross-tenant (sessA cannot mint URL for orgY)
  // -------------------------------------------------------------------------
  it('T15: Edge Fn returns 403 when caller is not owner of target org', async () => {
    const { orgY, sessA } = fixture;
    if (!SUPABASE_URL) {
      // Skip if no URL configured (env-gated like other live tests).
      return;
    }

    const resp = await fetch(`${SUPABASE_URL}/functions/v1/branding-asset-upload-url`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${sessA.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ org_id: orgY, kind: 'logo', ext: 'png' }),
    });
    expect(resp.status).toBe(403);
    const json = (await resp.json()) as { error: string };
    expect(json.error).toBe('insufficient_privilege');
  }, 30_000);

  // -------------------------------------------------------------------------
  // T16: Edge Fn 200 own org (sessB mints URL for orgY)
  // -------------------------------------------------------------------------
  it('T16: Edge Fn returns 200 + upload_url for owner calling against their own org', async () => {
    const { orgY, sessB } = fixture;
    if (!SUPABASE_URL) {
      return;
    }

    const resp = await fetch(`${SUPABASE_URL}/functions/v1/branding-asset-upload-url`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${sessB.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ org_id: orgY, kind: 'logo', ext: 'png' }),
    });
    expect(resp.status).toBe(200);
    const json = (await resp.json()) as { upload_url?: string; token?: string };
    expect(typeof json.upload_url).toBe('string');
    expect(typeof json.token).toBe('string');
  }, 30_000);
});

describe('P28 RLS org_branding — gating check', () => {
  it('skips when SUPABASE_SERVICE_ROLE_KEY is not set', () => {
    if (!SHOULD_RUN) console.warn('[rls-org-branding.test] SKIPPED — env not set.');
    expect(true).toBe(true);
  });
});
