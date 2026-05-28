/**
 * Phase 30 Plan 02 — useOrgSettingsRealtime hook tests.
 *
 * Covers all 5 behavior tests from the plan.
 */

import { renderHook, act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useOrgSettingsRealtime } from './use-org-settings-realtime';

// ---- Mocks (vi.hoisted to avoid hoisting issues) ----------------------------

const mocks = vi.hoisted(() => {
  // Capture handler refs
  let payloadHandler: ((payload: unknown) => void) | null = null;
  let statusCallback: ((status: string) => void) | null = null;

  const mockRemoveChannel = vi.fn().mockResolvedValue(undefined);
  const mockSubscribe = vi.fn().mockImplementation((callback?: (status: string) => void) => {
    if (callback) statusCallback = callback;
    return mockChannelObj;
  });
  const mockOn = vi
    .fn()
    .mockImplementation((_event: string, _filter: unknown, handler: (payload: unknown) => void) => {
      payloadHandler = handler;
      return mockChannelObj;
    });

  const mockChannelObj = {
    on: mockOn,
    subscribe: mockSubscribe,
  };

  const mockChannel = vi.fn().mockReturnValue(mockChannelObj);
  const mockChannelNameFor = vi.fn().mockResolvedValue('org-aaaa1111-settings');

  return {
    mockChannelNameFor,
    mockChannel,
    mockRemoveChannel,
    mockSubscribe,
    mockOn,
    mockChannelObj,
    getPayloadHandler: () => payloadHandler,
    getStatusCallback: () => statusCallback,
    resetHandlers: () => {
      payloadHandler = null;
      statusCallback = null;
    },
  };
});

vi.mock('@/lib/org-realtime', () => ({
  channelNameFor: mocks.mockChannelNameFor,
}));

vi.mock('@/lib/supabase', () => ({
  supabase: {
    channel: mocks.mockChannel,
    removeChannel: mocks.mockRemoveChannel,
  },
}));

// Import AFTER mocks

// ---- Tests -------------------------------------------------------------------

const ORG_ID = 'org-uuid-test-abc';

describe('useOrgSettingsRealtime', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resetHandlers();
    mocks.mockChannelNameFor.mockResolvedValue('org-aaaa1111-settings');
    mocks.mockSubscribe.mockImplementation((callback?: (status: string) => void) => {
      if (callback) {
        // Store callback via closure in the hoisted mock
        (mocks as typeof mocks & { _cb: typeof callback })._cb = callback;
      }
      return mocks.mockChannelObj;
    });
    mocks.mockOn.mockImplementation(
      (_event: string, _filter: unknown, handler: (payload: unknown) => void) => {
        (mocks as typeof mocks & { _handler: typeof handler })._handler = handler;
        return mocks.mockChannelObj;
      },
    );
    mocks.mockChannel.mockReturnValue(mocks.mockChannelObj);
    mocks.mockRemoveChannel.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('Test 1: mounts → channelNameFor called → supabase.channel invoked', async () => {
    const onWeightsChanged = vi.fn();
    const { unmount } = renderHook(() =>
      useOrgSettingsRealtime({ orgId: ORG_ID, onWeightsChanged }),
    );

    // Wait for async channelNameFor resolution
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });

    expect(mocks.mockChannelNameFor).toHaveBeenCalledWith(ORG_ID, 'settings');
    expect(mocks.mockChannel).toHaveBeenCalledWith('org-aaaa1111-settings');

    unmount();
  });

  it('Test 2: postgres_changes UPDATE event for matching org_id → onWeightsChanged invoked once', async () => {
    const onWeightsChanged = vi.fn();

    // Override on to capture handler
    let payloadHandler: ((p: unknown) => void) | null = null;
    mocks.mockOn.mockImplementation(
      (_event: string, _filter: unknown, handler: (payload: unknown) => void) => {
        payloadHandler = handler;
        return mocks.mockChannelObj;
      },
    );

    const { unmount } = renderHook(() =>
      useOrgSettingsRealtime({ orgId: ORG_ID, onWeightsChanged }),
    );

    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });

    expect(payloadHandler).not.toBeNull();

    // Simulate matching org_id UPDATE event
    act(() => {
      payloadHandler!({
        eventType: 'UPDATE',
        new: { org_id: ORG_ID, ranking_weights: { dose_adherence: 0.5 } },
        old: {},
      });
    });

    expect(onWeightsChanged).toHaveBeenCalledTimes(1);

    unmount();
  });

  it('Test 3: UPDATE event for different org_id → callback NOT invoked', async () => {
    const onWeightsChanged = vi.fn();

    let payloadHandler: ((p: unknown) => void) | null = null;
    mocks.mockOn.mockImplementation(
      (_event: string, _filter: unknown, handler: (payload: unknown) => void) => {
        payloadHandler = handler;
        return mocks.mockChannelObj;
      },
    );

    const { unmount } = renderHook(() =>
      useOrgSettingsRealtime({ orgId: ORG_ID, onWeightsChanged }),
    );

    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });

    act(() => {
      payloadHandler!({
        eventType: 'UPDATE',
        new: { org_id: 'other-org-id', ranking_weights: { dose_adherence: 0.4 } },
        old: {},
      });
    });

    expect(onWeightsChanged).not.toHaveBeenCalled();

    unmount();
  });

  it('Test 4: hook unmount calls supabase.removeChannel', async () => {
    const onWeightsChanged = vi.fn();
    const { unmount } = renderHook(() =>
      useOrgSettingsRealtime({ orgId: ORG_ID, onWeightsChanged }),
    );

    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });

    unmount();

    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });

    expect(mocks.mockRemoveChannel).toHaveBeenCalled();
  });

  it('Test 5: CHANNEL_ERROR subscription status → does NOT throw, logs warning', async () => {
    const onWeightsChanged = vi.fn();
    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    let statusCallback: ((status: string) => void) | null = null;
    mocks.mockSubscribe.mockImplementation((callback?: (status: string) => void) => {
      if (callback) statusCallback = callback;
      return mocks.mockChannelObj;
    });

    const { unmount } = renderHook(() =>
      useOrgSettingsRealtime({ orgId: ORG_ID, onWeightsChanged }),
    );

    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });

    expect(() => {
      act(() => {
        statusCallback?.('CHANNEL_ERROR');
      });
    }).not.toThrow();

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('HMAC channel subscribe failed'),
      ORG_ID,
    );

    consoleSpy.mockRestore();
    unmount();
  });
});
