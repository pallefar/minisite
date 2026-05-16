/**
 * Phase 22 Plan 22-06 — feature-flag-overrides wrapper tests (ADMIN-05).
 * Replaces 22-01 Wave 0 skip stubs.
 *
 * Behaviors:
 *   - loadOverrides queries feature_flag_overrides WHERE user_id = uid
 *     AND expires_at > now() (SQL-side filter per Pitfall 10).
 *   - isFeatureEnabledWithOverride returns cached override value when
 *     cache hit AND not expired.
 *   - Falls through to posthog.isFeatureEnabled when cache miss.
 *   - Falls through to posthog when cache hit but expired (defense-in-depth).
 *   - clearOverrideCache empties the cache.
 *   - Signature is sync (returns boolean, not Promise).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearOverrideCache,
  isFeatureEnabledWithOverride,
  loadOverrides,
} from '@/lib/consent/feature-flag-overrides';

const mockGt = vi.fn();
const mockEq = vi.fn(() => ({ gt: mockGt }));
const mockSelect = vi.fn(() => ({ eq: mockEq }));
const mockFrom = vi.fn(() => ({ select: mockSelect }));

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: (table: string) => mockFrom(table),
  },
}));

const mockPosthogIsFeatureEnabled = vi.fn();
vi.mock('posthog-js', () => ({
  default: {
    isFeatureEnabled: (key: string) => mockPosthogIsFeatureEnabled(key),
  },
}));

describe('feature-flag-overrides (Phase 22 ADMIN-05)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearOverrideCache();
  });
  afterEach(() => {
    clearOverrideCache();
  });

  it('loadOverrides queries feature_flag_overrides with SQL-side expires_at filter', async () => {
    mockGt.mockResolvedValue({ data: [], error: null });
    await loadOverrides('user-1');
    expect(mockFrom).toHaveBeenCalledWith('feature_flag_overrides');
    expect(mockSelect).toHaveBeenCalledWith('flag_key, value, expires_at');
    expect(mockEq).toHaveBeenCalledWith('user_id', 'user-1');
    expect(mockGt).toHaveBeenCalledTimes(1);
    const [col, value] = mockGt.mock.calls[0]!;
    expect(col).toBe('expires_at');
    // The value must be an ISO timestamp (string) for SQL-side filter.
    expect(typeof value).toBe('string');
    expect(() => new Date(value as string).toISOString()).not.toThrow();
  });

  it('isFeatureEnabledWithOverride returns cached override when not expired', async () => {
    const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    mockGt.mockResolvedValue({
      data: [{ flag_key: 'aff_manual_entry', value: true, expires_at: future }],
      error: null,
    });
    await loadOverrides('user-1');

    mockPosthogIsFeatureEnabled.mockReturnValue(false);
    expect(isFeatureEnabledWithOverride('aff_manual_entry')).toBe(true);
    // PostHog NOT consulted — override wins.
    expect(mockPosthogIsFeatureEnabled).not.toHaveBeenCalled();
  });

  it('falls through to PostHog when no override cached', async () => {
    mockGt.mockResolvedValue({ data: [], error: null });
    await loadOverrides('user-1');

    mockPosthogIsFeatureEnabled.mockReturnValue(true);
    expect(isFeatureEnabledWithOverride('some_flag')).toBe(true);
    expect(mockPosthogIsFeatureEnabled).toHaveBeenCalledWith('some_flag');
  });

  it('falls through to PostHog when cached override is expired (defense-in-depth)', async () => {
    // We seed the cache with an expired entry by mocking the SQL row even
    // though the .gt filter would normally have excluded it (covers the
    // race where loadOverrides resolved at T0 and we read at T+expiry+1).
    const past = new Date(Date.now() - 1_000).toISOString();
    mockGt.mockResolvedValue({
      data: [{ flag_key: 'aff_manual_entry', value: true, expires_at: past }],
      error: null,
    });
    await loadOverrides('user-1');

    mockPosthogIsFeatureEnabled.mockReturnValue(false);
    expect(isFeatureEnabledWithOverride('aff_manual_entry')).toBe(false);
    expect(mockPosthogIsFeatureEnabled).toHaveBeenCalledWith('aff_manual_entry');
  });

  it('clearOverrideCache evicts all entries', async () => {
    const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    mockGt.mockResolvedValue({
      data: [{ flag_key: 'aff_manual_entry', value: true, expires_at: future }],
      error: null,
    });
    await loadOverrides('user-1');
    expect(isFeatureEnabledWithOverride('aff_manual_entry')).toBe(true);

    clearOverrideCache();
    mockPosthogIsFeatureEnabled.mockReturnValue(false);
    expect(isFeatureEnabledWithOverride('aff_manual_entry')).toBe(false);
    expect(mockPosthogIsFeatureEnabled).toHaveBeenCalledWith('aff_manual_entry');
  });

  it('isFeatureEnabledWithOverride has a synchronous return type (not a Promise)', async () => {
    mockGt.mockResolvedValue({ data: [], error: null });
    await loadOverrides('user-1');
    mockPosthogIsFeatureEnabled.mockReturnValue(true);
    const result = isFeatureEnabledWithOverride('any');
    // Must be a plain boolean — not a Promise / thenable.
    expect(typeof result).toBe('boolean');
    expect((result as unknown as { then?: unknown }).then).toBeUndefined();
  });
});
