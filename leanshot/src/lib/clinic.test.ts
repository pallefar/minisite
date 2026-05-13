/**
 * Phase 9 Plan 09-02 Task 1 — typed RPC + storage wrappers + Realtime helpers.
 *
 * RED phase first: these tests define the contract (discriminated-union
 * return shape, Postgres-error-code mapping, W-1 invite_id-server-side
 * shape, isConsentScope drift defense, setAuth-before-subscribe ordering).
 */
/* eslint-disable import-x/order -- vi.mock factories must come BEFORE the
   imports they affect; this means imports of the mocked module live below
   the mock block, breaking strict import-grouping. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockRpc = vi.fn();
const mockStorageUpload = vi.fn();
const mockFrom = vi.fn();
const mockMaybeSingle = vi.fn();
const mockSetAuth = vi.fn();
const mockGetSession = vi.fn();
// Channel subscribe ordering — recorded in callOrder[]
const callOrder: string[] = [];

const channelOn = vi.fn().mockImplementation(function this_(this: unknown) {
  return this;
});
const channelSubscribe = vi.fn().mockImplementation(async () => {
  callOrder.push('subscribe');
  return 'SUBSCRIBED';
});
const mockChannel = vi.fn().mockImplementation(() => ({
  on: channelOn,
  subscribe: channelSubscribe,
}));

// supabase.from(...).select(...).eq(...).maybeSingle()
const fromChain = {
  select: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  maybeSingle: mockMaybeSingle,
};

vi.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: (...args: unknown[]) => mockRpc(...args),
    from: (...args: unknown[]) => {
      mockFrom(...args);
      return fromChain;
    },
    storage: {
      from: () => ({
        upload: (...args: unknown[]) => mockStorageUpload(...args),
        getPublicUrl: (path: string) => ({
          data: { publicUrl: `https://test.example/${path}` },
        }),
      }),
    },
    realtime: {
      setAuth: () => {
        callOrder.push('setAuth');
        return mockSetAuth();
      },
    },
    auth: {
      getSession: () => mockGetSession(),
    },
    channel: (name: string, opts?: unknown) => {
      callOrder.push(`channel:${name}`);
      return mockChannel(name, opts);
    },
    removeChannel: vi.fn(),
  },
}));
import type { ConsentScope } from '@/types/clinic';
import {
  createOrg,
  updateOrg,
  sendInvite,
  sendInviteViaRpc,
  cancelInvite,
  acceptInviteExisting,
  acceptInviteNew,
  rejectInvite,
  revokeMembership,
  updateConsentScope,
  updateMemberRole,
  createRole,
  updateRole,
  deleteRole,
  uploadOrgLogo,
  checkSlugAvailable,
} from './clinic';
import { subscribeToOrgChannel, subscribeToUserChannel } from './clinic-realtime';

const VALID_SCOPE: ConsentScope = {
  injections: true,
  weights: true,
  photos: true,
  symptoms: true,
  meals: true,
  workouts: true,
  supplements: true,
  mood: true,
  sleep: true,
  doctor_report: true,
};

beforeEach(() => {
  mockRpc.mockReset();
  mockStorageUpload.mockReset();
  mockFrom.mockReset();
  mockMaybeSingle.mockReset();
  mockSetAuth.mockReset();
  mockGetSession.mockReset();
  channelOn.mockClear();
  channelSubscribe.mockClear();
  mockChannel.mockClear();
  callOrder.length = 0;
  // Default: signed-in session — defer-mount-safe helpers only no-op when null.
  mockGetSession.mockResolvedValue({ data: { session: { access_token: 't' } }, error: null });
  mockSetAuth.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

// =============================================================================
// Test 1 — createOrg happy path
// =============================================================================

describe('createOrg', () => {
  it('returns {ok:true,data:{org_id,slug}} on success', async () => {
    mockRpc.mockResolvedValueOnce({
      data: [{ id: 'org-1', slug: 'acme' }],
      error: null,
    });
    const r = await createOrg({ name: 'Acme Clinic', slug: 'acme' });
    expect(r).toEqual({ ok: true, data: { org_id: 'org-1', slug: 'acme' } });
    expect(mockRpc).toHaveBeenCalledWith('create_org', {
      p_name: 'Acme Clinic',
      p_slug: 'acme',
      p_description: null,
      p_website_url: null,
    });
  });

  it('maps Postgres 23505 → slug_taken', async () => {
    mockRpc.mockResolvedValueOnce({
      data: null,
      error: { code: '23505', message: 'slug_taken' },
    });
    const r = await createOrg({ name: 'A', slug: 'taken' });
    expect(r).toEqual({ ok: false, error: 'slug_taken' });
  });

  it('maps Postgres 28000 → unauthenticated', async () => {
    mockRpc.mockResolvedValueOnce({
      data: null,
      error: { code: '28000', message: 'unauthenticated' },
    });
    const r = await createOrg({ name: 'A', slug: 'a' });
    expect(r).toEqual({ ok: false, error: 'unauthenticated' });
  });

  it('returns network on thrown error', async () => {
    mockRpc.mockRejectedValueOnce(new Error('boom'));
    const r = await createOrg({ name: 'A', slug: 'a' });
    expect(r).toEqual({ ok: false, error: 'network' });
  });
});

// =============================================================================
// Test 3 — sendInvite W-1 shape (invite_id always returned, no enumeration leak)
// =============================================================================

describe('sendInviteViaRpc (W-1) — legacy direct-RPC path', () => {
  it('lowercases + trims email; sends invite_token_hash + scope; returns {invite_id}', async () => {
    mockRpc.mockResolvedValueOnce({
      data: [{ invite_id: 'inv-uuid-123' }],
      error: null,
    });
    const r = await sendInviteViaRpc({
      org_id: 'org-1',
      email: '  Karsten@Example.com  ',
      requested_scope: VALID_SCOPE,
    });
    expect(r).toEqual({ ok: true, data: { invite_id: 'inv-uuid-123' } });
    const call = mockRpc.mock.calls[0];
    expect(call[0]).toBe('send_invite');
    const args = call[1] as Record<string, unknown>;
    expect(args.p_email).toBe('karsten@example.com');
    expect(args.p_org_id).toBe('org-1');
    expect(args.p_requested_scope).toEqual(VALID_SCOPE);
    // invite_token_hash is generated client-side — must be a non-empty string.
    expect(typeof args.p_invite_token_hash).toBe('string');
    expect((args.p_invite_token_hash as string).length).toBeGreaterThan(16);
  });

  it('rejects invalid consent scope shape (Pitfall #8 jsonb drift)', async () => {
    const partial = { injections: true } as unknown as ConsentScope;
    const r = await sendInviteViaRpc({
      org_id: 'org-1',
      email: 'a@b.com',
      requested_scope: partial,
    });
    expect(r).toEqual({ ok: false, error: 'invalid_scope' });
    expect(mockRpc).not.toHaveBeenCalled();
  });
});

describe('sendInvite (W-1) — Edge Function path', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    // Provide VITE_SUPABASE_URL via the vitest env stub.
    vi.stubEnv('VITE_SUPABASE_URL', 'https://stub.supabase.co');
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.unstubAllEnvs();
  });

  it('POSTs to /functions/v1/clinic-invite/send with Bearer JWT + W-1 response shape', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: true, invite_id: 'inv-uuid-edge' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const r = await sendInvite({
      org_id: 'org-1',
      email: '  Karsten@Example.com  ',
      requested_scope: VALID_SCOPE,
    });
    expect(r).toEqual({ ok: true, data: { invite_id: 'inv-uuid-edge' } });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://stub.supabase.co/functions/v1/clinic-invite/send');
    expect(init.method).toBe('POST');
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer t');
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body.email).toBe('karsten@example.com');
    expect(body.org_id).toBe('org-1');
    expect(body.requested_scope).toEqual(VALID_SCOPE);
    // CRITICAL: client must NOT generate the raw token or hash — Edge Function does.
    expect(body.invite_token_hash).toBeUndefined();
    expect(body.token).toBeUndefined();
  });

  it('rejects invalid consent scope shape BEFORE calling fetch (Pitfall #8)', async () => {
    const partial = { injections: true } as unknown as ConsentScope;
    const r = await sendInvite({
      org_id: 'org-1',
      email: 'a@b.com',
      requested_scope: partial,
    });
    expect(r).toEqual({ ok: false, error: 'invalid_scope' });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('maps 429 → rate_limited', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'rate_limited' }), { status: 429 }),
    );
    const r = await sendInvite({
      org_id: 'org-1',
      email: 'a@b.com',
      requested_scope: VALID_SCOPE,
    });
    expect(r).toEqual({ ok: false, error: 'rate_limited' });
  });

  it('maps 403 → forbidden', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'forbidden' }), { status: 403 }),
    );
    const r = await sendInvite({
      org_id: 'org-1',
      email: 'a@b.com',
      requested_scope: VALID_SCOPE,
    });
    expect(r).toEqual({ ok: false, error: 'forbidden' });
  });

  it('returns unauthenticated when there is no session', async () => {
    mockGetSession.mockResolvedValueOnce({ data: { session: null }, error: null });
    const r = await sendInvite({
      org_id: 'org-1',
      email: 'a@b.com',
      requested_scope: VALID_SCOPE,
    });
    expect(r).toEqual({ ok: false, error: 'unauthenticated' });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('returns network on fetch throw', async () => {
    fetchSpy.mockRejectedValueOnce(new Error('boom'));
    const r = await sendInvite({
      org_id: 'org-1',
      email: 'a@b.com',
      requested_scope: VALID_SCOPE,
    });
    expect(r).toEqual({ ok: false, error: 'network' });
  });
});

// =============================================================================
// Test 4 — uploadOrgLogo (size + MIME + path)
// =============================================================================

describe('uploadOrgLogo', () => {
  function makeFile(name: string, type: string, bytes: number): File {
    const blob = new Blob([new Uint8Array(bytes)], { type });
    return new File([blob], name, { type });
  }

  it('rejects files over 2 MB', async () => {
    const f = makeFile('logo.png', 'image/png', 2 * 1024 * 1024 + 1);
    const r = await uploadOrgLogo('org-1', f);
    expect(r).toEqual({ ok: false, error: 'file_too_large' });
    expect(mockStorageUpload).not.toHaveBeenCalled();
  });

  it('rejects non-png/jpeg MIME', async () => {
    const f = makeFile('logo.gif', 'image/gif', 1024);
    const r = await uploadOrgLogo('org-1', f);
    expect(r).toEqual({ ok: false, error: 'invalid_mime' });
  });

  it('uploads PNG to {orgId}/logo.png', async () => {
    mockStorageUpload.mockResolvedValueOnce({ data: { path: 'org-1/logo.png' }, error: null });
    const f = makeFile('foo.png', 'image/png', 1024);
    const r = await uploadOrgLogo('org-1', f);
    expect(r).toEqual({ ok: true, path: 'org-1/logo.png' });
    expect(mockStorageUpload).toHaveBeenCalledWith(
      'org-1/logo.png',
      f,
      expect.objectContaining({ contentType: 'image/png', upsert: true }),
    );
  });

  it('uploads JPEG to {orgId}/logo.jpg', async () => {
    mockStorageUpload.mockResolvedValueOnce({ data: { path: 'org-1/logo.jpg' }, error: null });
    const f = makeFile('foo.jpg', 'image/jpeg', 1024);
    const r = await uploadOrgLogo('org-1', f);
    expect(r).toEqual({ ok: true, path: 'org-1/logo.jpg' });
    expect(mockStorageUpload).toHaveBeenCalledWith(
      'org-1/logo.jpg',
      f,
      expect.objectContaining({ contentType: 'image/jpeg', upsert: true }),
    );
  });
});

// =============================================================================
// Test — checkSlugAvailable (regex + reserved + DB lookup)
// =============================================================================

describe('checkSlugAvailable', () => {
  it('rejects empty slug as invalid', async () => {
    const r = await checkSlugAvailable('');
    expect(r).toEqual({ available: false, reason: 'invalid' });
  });

  it('rejects slugs with invalid characters', async () => {
    const r = await checkSlugAvailable('Foo!');
    expect(r).toEqual({ available: false, reason: 'invalid' });
  });

  it('rejects reserved words', async () => {
    const r = await checkSlugAvailable('admin');
    expect(r).toEqual({ available: false, reason: 'reserved' });
  });

  it('returns available=true when DB lookup yields no row', async () => {
    mockMaybeSingle.mockResolvedValueOnce({ data: null, error: null });
    const r = await checkSlugAvailable('northside-endo');
    expect(r).toEqual({ available: true });
  });

  it('returns taken when DB lookup yields a row', async () => {
    mockMaybeSingle.mockResolvedValueOnce({ data: { id: 'org-1' }, error: null });
    const r = await checkSlugAvailable('acme');
    expect(r).toEqual({ available: false, reason: 'taken' });
  });
});

// =============================================================================
// Test 5/6 — Realtime helpers — setAuth BEFORE subscribe (Pitfall #2)
// =============================================================================

describe('subscribeToOrgChannel', () => {
  it('calls setAuth() BEFORE subscribe()', async () => {
    await subscribeToOrgChannel('org-1', () => {});
    const setAuthIdx = callOrder.indexOf('setAuth');
    const subscribeIdx = callOrder.indexOf('subscribe');
    expect(setAuthIdx).toBeGreaterThanOrEqual(0);
    expect(subscribeIdx).toBeGreaterThan(setAuthIdx);
  });

  it('uses the org:<id> topic with private:true config', async () => {
    await subscribeToOrgChannel('org-xyz', () => {});
    expect(mockChannel).toHaveBeenCalledWith('org:org-xyz', { config: { private: true } });
  });

  it('returns no-op channel when getSession() resolves null (defer-mount safety, Pitfall #9)', async () => {
    mockGetSession.mockResolvedValueOnce({ data: { session: null }, error: null });
    const ch = await subscribeToOrgChannel('org-1', () => {});
    expect(channelSubscribe).not.toHaveBeenCalled();
    expect(typeof ch.unsubscribe).toBe('function');
  });
});

describe('subscribeToUserChannel', () => {
  it('calls setAuth() BEFORE subscribe()', async () => {
    await subscribeToUserChannel('user-1', () => {});
    const setAuthIdx = callOrder.indexOf('setAuth');
    const subscribeIdx = callOrder.indexOf('subscribe');
    expect(setAuthIdx).toBeGreaterThanOrEqual(0);
    expect(subscribeIdx).toBeGreaterThan(setAuthIdx);
  });

  it('uses the user:<id> topic', async () => {
    await subscribeToUserChannel('user-xyz', () => {});
    expect(mockChannel).toHaveBeenCalledWith('user:user-xyz', { config: { private: true } });
  });
});

// =============================================================================
// Other RPC wrappers — happy paths + selected error mappings.
// =============================================================================

describe('updateOrg', () => {
  it('passes p_org_id + nullable fields', async () => {
    mockRpc.mockResolvedValueOnce({ data: null, error: null });
    const r = await updateOrg({
      org_id: 'org-1',
      name: 'New Name',
      logo_storage_path: 'org-1/logo.png',
    });
    expect(r).toEqual({ ok: true, data: null });
    expect(mockRpc).toHaveBeenCalledWith('update_org', {
      p_org_id: 'org-1',
      p_name: 'New Name',
      p_description: null,
      p_website_url: null,
      p_logo_storage_path: 'org-1/logo.png',
    });
  });

  it('maps 42501 → forbidden', async () => {
    mockRpc.mockResolvedValueOnce({
      data: null,
      error: { code: '42501', message: 'forbidden' },
    });
    const r = await updateOrg({ org_id: 'x' });
    expect(r).toEqual({ ok: false, error: 'forbidden' });
  });
});

describe('cancelInvite + rejectInvite + revokeMembership', () => {
  it('cancelInvite forwards p_invite_id', async () => {
    mockRpc.mockResolvedValueOnce({ data: null, error: null });
    const r = await cancelInvite({ invite_id: 'inv-1' });
    expect(r.ok).toBe(true);
    expect(mockRpc).toHaveBeenCalledWith('cancel_invite', { p_invite_id: 'inv-1' });
  });

  it('rejectInvite forwards token hash', async () => {
    mockRpc.mockResolvedValueOnce({ data: null, error: null });
    const r = await rejectInvite({ invite_token_hash: 'hash-abc' });
    expect(r.ok).toBe(true);
    expect(mockRpc).toHaveBeenCalledWith('reject_invite', { p_invite_token_hash: 'hash-abc' });
  });

  it('revokeMembership forwards membership_id', async () => {
    mockRpc.mockResolvedValueOnce({ data: null, error: null });
    const r = await revokeMembership({ membership_id: 'm-1' });
    expect(r.ok).toBe(true);
    expect(mockRpc).toHaveBeenCalledWith('revoke_membership', { p_membership_id: 'm-1' });
  });
});

describe('acceptInviteExisting + acceptInviteNew', () => {
  it('acceptInviteExisting validates scope and forwards both params', async () => {
    mockRpc.mockResolvedValueOnce({
      data: [{ membership_id: 'm-1', org_id: 'org-1' }],
      error: null,
    });
    const r = await acceptInviteExisting({
      invite_token_hash: 'hash',
      consent_scope: VALID_SCOPE,
    });
    expect(r).toEqual({ ok: true, data: { membership_id: 'm-1', org_id: 'org-1' } });
  });

  it('acceptInviteNew rejects invalid scope client-side', async () => {
    const r = await acceptInviteNew({
      invite_token_hash: 'hash',
      consent_scope: { injections: true } as unknown as ConsentScope,
    });
    expect(r).toEqual({ ok: false, error: 'invalid_scope' });
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('maps invite_email_mismatch → email_mismatch', async () => {
    mockRpc.mockResolvedValueOnce({
      data: null,
      error: { code: '42501', message: 'invite_email_mismatch' },
    });
    const r = await acceptInviteExisting({
      invite_token_hash: 'hash',
      consent_scope: VALID_SCOPE,
    });
    expect(r).toEqual({ ok: false, error: 'email_mismatch' });
  });

  it('maps invite_not_found_or_used → invalid_invite', async () => {
    mockRpc.mockResolvedValueOnce({
      data: null,
      error: { code: 'P0002', message: 'invite_not_found_or_used' },
    });
    const r = await acceptInviteExisting({
      invite_token_hash: 'hash',
      consent_scope: VALID_SCOPE,
    });
    expect(r).toEqual({ ok: false, error: 'invalid_invite' });
  });
});

describe('updateConsentScope + updateMemberRole', () => {
  it('updateConsentScope rejects invalid scope client-side', async () => {
    const r = await updateConsentScope({
      membership_id: 'm-1',
      consent_scope: {} as unknown as ConsentScope,
    });
    expect(r).toEqual({ ok: false, error: 'invalid_scope' });
  });

  it('updateConsentScope sends p_membership_id + p_consent_scope on valid input', async () => {
    mockRpc.mockResolvedValueOnce({ data: null, error: null });
    const r = await updateConsentScope({
      membership_id: 'm-1',
      consent_scope: VALID_SCOPE,
    });
    expect(r.ok).toBe(true);
    expect(mockRpc).toHaveBeenCalledWith('update_consent_scope', {
      p_membership_id: 'm-1',
      p_consent_scope: VALID_SCOPE,
    });
  });

  it('updateMemberRole forwards membership + role', async () => {
    mockRpc.mockResolvedValueOnce({ data: null, error: null });
    const r = await updateMemberRole({ membership_id: 'm-1', role_id: 'r-1' });
    expect(r.ok).toBe(true);
    expect(mockRpc).toHaveBeenCalledWith('update_member_role', {
      p_membership_id: 'm-1',
      p_role_id: 'r-1',
    });
  });
});

describe('createRole + updateRole + deleteRole', () => {
  it('createRole returns {role_id}', async () => {
    mockRpc.mockResolvedValueOnce({
      data: [{ role_id: 'r-new' }],
      error: null,
    });
    const r = await createRole({
      org_id: 'org-1',
      name: 'Nurse',
      description: null,
      permission_keys: ['org.read'],
    });
    expect(r).toEqual({ ok: true, data: { role_id: 'r-new' } });
  });

  it('updateRole forwards all four params', async () => {
    mockRpc.mockResolvedValueOnce({ data: null, error: null });
    const r = await updateRole({
      role_id: 'r-1',
      name: 'X',
      description: 'd',
      permission_keys: ['org.read'],
    });
    expect(r.ok).toBe(true);
    expect(mockRpc).toHaveBeenCalledWith('update_role', {
      p_role_id: 'r-1',
      p_name: 'X',
      p_description: 'd',
      p_permission_keys: ['org.read'],
    });
  });

  it('deleteRole forwards role_id', async () => {
    mockRpc.mockResolvedValueOnce({ data: null, error: null });
    const r = await deleteRole({ role_id: 'r-1' });
    expect(r.ok).toBe(true);
    expect(mockRpc).toHaveBeenCalledWith('delete_role', { p_role_id: 'r-1' });
  });
});
