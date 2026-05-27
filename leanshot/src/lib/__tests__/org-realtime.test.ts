/**
 * Phase 28 Plan 04 — Vitest unit tests for src/lib/org-realtime.ts.
 *
 * Tests (per plan Task 3, Tests 1-4):
 *
 *   T1: channelNameFor(orgId, table) is deterministic — same inputs → same output.
 *   T2: channelNameFor returns different names for different org_ids.
 *   T3: channelNameFor returns different names for different tables.
 *   T4: Secret is cached — second call within session does NOT invoke the RPC again.
 *
 * Mocking strategy:
 *   - `supabase.rpc` is mocked to return a known 64-char hex secret.
 *   - Web Crypto API is available in Vitest's jsdom/browser environment
 *     (Node 20+ provides globalThis.crypto natively).
 *   - We pre-compute expected HMAC values using Node's `crypto.subtle` with the
 *     same known secret so we can assert exact output strings.
 *
 * Known secret (fixture): 32 zero bytes hex-encoded = 64 zeros.
 * This avoids hard-coding a real secret and keeps tests self-contained.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { _clearSecretCache, channelNameFor } from '../org-realtime';

// Use vi.hoisted to create the mock function BEFORE vi.mock's hoisted factory
// runs — this avoids the "Cannot access before initialization" ReferenceError.
const { mockRpc } = vi.hoisted(() => ({
  mockRpc: vi.fn(),
}));

vi.mock('../supabase', () => ({
  supabase: {
    rpc: mockRpc,
  },
}));

// Import after mock is registered.

// ── Fixture secret ────────────────────────────────────────────────────────────
// 64 hex chars = 32 zero bytes. Deterministic: lets us pre-compute expected HMAC.
const FIXTURE_SECRET_HEX = '0'.repeat(64);

/**
 * Pre-compute the expected HMAC-SHA-256 prefix for a given orgId and table.
 * Uses the Web Crypto API (available in Node 20+ / jsdom environment).
 */
async function expectedChannelName(orgId: string, table: string): Promise<string> {
  const bytes = new Uint8Array(32); // 32 zero bytes
  const key = await crypto.subtle.importKey(
    'raw',
    bytes.buffer,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const input = new TextEncoder().encode(`${orgId}:${table}`);
  const sig = await crypto.subtle.sign('HMAC', key, input);
  const hex = Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, '0')).join('');
  return `org-${hex.slice(0, 8)}-${table}`;
}

describe('org-realtime — channelNameFor', () => {
  beforeEach(() => {
    // Reset the module-level secret cache so each test starts clean.
    _clearSecretCache();

    // Default mock: return the fixture secret.
    mockRpc.mockResolvedValue({ data: FIXTURE_SECRET_HEX, error: null });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('T1: deterministic — same inputs return same channel name', async () => {
    const orgId = '11111111-1111-1111-1111-111111111111';
    const table = 'org_members';

    const first = await channelNameFor(orgId, table);
    const second = await channelNameFor(orgId, table);

    expect(first).toBe(second);

    // Verify format: org-{8 lowercase hex chars}-{table}
    expect(first).toMatch(/^org-[0-9a-f]{8}-org_members$/);
  });

  it('T1 (extended): output matches pre-computed expected HMAC', async () => {
    const orgId = '11111111-1111-1111-1111-111111111111';
    const table = 'org_members';

    const actual = await channelNameFor(orgId, table);
    const expected = await expectedChannelName(orgId, table);

    expect(actual).toBe(expected);
  });

  it('T2: distinct orgs → distinct channel names', async () => {
    const table = 'org_members';

    const nameX = await channelNameFor('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', table);
    _clearSecretCache();
    const nameY = await channelNameFor('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', table);

    expect(nameX).not.toBe(nameY);

    // Both must follow the format pattern.
    expect(nameX).toMatch(/^org-[0-9a-f]{8}-org_members$/);
    expect(nameY).toMatch(/^org-[0-9a-f]{8}-org_members$/);
  });

  it('T3: same org, distinct tables → distinct channel names', async () => {
    const orgId = '11111111-1111-1111-1111-111111111111';

    const nameMembers = await channelNameFor(orgId, 'org_members');
    _clearSecretCache();
    const nameInvites = await channelNameFor(orgId, 'org_invites');

    expect(nameMembers).not.toBe(nameInvites);

    expect(nameMembers).toMatch(/^org-[0-9a-f]{8}-org_members$/);
    expect(nameInvites).toMatch(/^org-[0-9a-f]{8}-org_invites$/);
  });

  it('T4: secret is cached — RPC called exactly once per cache lifetime', async () => {
    const orgId = '11111111-1111-1111-1111-111111111111';

    // First call — should invoke RPC.
    await channelNameFor(orgId, 'org_members');
    expect(mockRpc).toHaveBeenCalledTimes(1);
    expect(mockRpc).toHaveBeenCalledWith('get_realtime_channel_keying');

    // Second call — cache hit; RPC NOT called again.
    await channelNameFor(orgId, 'org_invites');
    expect(mockRpc).toHaveBeenCalledTimes(1); // still 1

    // Third call — still cached.
    await channelNameFor('22222222-2222-2222-2222-222222222222', 'org_members');
    expect(mockRpc).toHaveBeenCalledTimes(1); // still 1
  });

  it('T4 (cache clear): _clearSecretCache() causes RPC to be called again', async () => {
    const orgId = '11111111-1111-1111-1111-111111111111';

    await channelNameFor(orgId, 'org_members');
    expect(mockRpc).toHaveBeenCalledTimes(1);

    _clearSecretCache();

    await channelNameFor(orgId, 'org_members');
    expect(mockRpc).toHaveBeenCalledTimes(2);
  });

  it('throws when RPC returns an error', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: 'permission denied' } });

    await expect(channelNameFor('org-id', 'org_members')).rejects.toThrow(
      'get_realtime_channel_keying RPC failed: permission denied',
    );
  });

  it('throws when RPC returns null data (missing Vault secret)', async () => {
    mockRpc.mockResolvedValue({ data: null, error: null });

    await expect(channelNameFor('org-id', 'org_members')).rejects.toThrow(
      'get_realtime_channel_keying returned no data',
    );
  });
});
