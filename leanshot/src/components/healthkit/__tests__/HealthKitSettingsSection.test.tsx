/**
 * Phase 55 Plan 55-04 — HealthKitSettingsSection unit tests (TDD RED).
 *
 * Coverage (UI-SPEC Screens 2-4):
 *   - not-connected state: "Connect Apple Health" CTA visible
 *   - connected state: "Connected" badge, "Sync now", "Auto-sync enabled" Pill, Revoke button
 *   - revoked state: "Access revoked" badge, status line, "Reconnect" + purge button
 *   - Revoke: useConfirm gate with exact copy → revokeAccess() → success toast
 *   - Purge: useConfirm gate with exact copy ("Keep my data" cancel) → purgeImportedData() → success toast
 *   - non-iOS: unavailable message only, no interactive controls
 *
 * Run: npx vitest run --config vite.config.ts src/components/healthkit/__tests__/HealthKitSettingsSection.test.tsx
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('@/lib/native/health', () => ({
  isEnabled: vi.fn(),
  revokeAccess: vi.fn(),
  purgeImportedData: vi.fn(),
  syncNow: vi.fn(),
}));

vi.mock('@/lib/native/platform', () => ({
  detectPlatform: vi.fn(() => 'ios'),
}));

vi.mock('@/hooks/useToast', () => ({
  useToast: vi.fn(() => vi.fn()),
}));

vi.mock('@/hooks/useConfirm', () => ({
  useConfirm: vi.fn(() => ({
    confirm: vi.fn(async () => true),
    open: false,
    message: '',
    title: undefined,
    confirmLabel: 'Confirm',
    cancelLabel: 'Cancel',
    destructive: false,
    handleConfirm: vi.fn(),
    handleCancel: vi.fn(),
  })),
}));

// framer-motion: passthrough for AnimatePresence/motion used in Modal
vi.mock('framer-motion', () => ({
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  motion: {
    div: ({
      children,
      onClick,
      className,
      role,
      'aria-modal': ariaModal,
      'aria-label': ariaLabel,
      ...rest
    }: React.HTMLAttributes<HTMLDivElement>) => (
      <div
        onClick={onClick}
        className={className}
        role={role}
        aria-modal={ariaModal}
        aria-label={ariaLabel}
        {...rest}
      >
        {children}
      </div>
    ),
  },
}));

// ---------------------------------------------------------------------------
// SUT
// ---------------------------------------------------------------------------

import * as healthMod from '@/lib/native/health';
import * as platformMod from '@/lib/native/platform';
import * as useToastMod from '@/hooks/useToast';
import * as useConfirmMod from '@/hooks/useConfirm';
import { HealthKitSettingsSection } from '../HealthKitSettingsSection';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const mockIsEnabled = vi.mocked(healthMod.isEnabled);
const mockRevokeAccess = vi.mocked(healthMod.revokeAccess);
const mockPurgeImportedData = vi.mocked(healthMod.purgeImportedData);
const mockSyncNow = vi.mocked(healthMod.syncNow);
const mockDetectPlatform = vi.mocked(platformMod.detectPlatform);
const mockUseToast = vi.mocked(useToastMod.useToast);
const mockUseConfirm = vi.mocked(useConfirmMod.useConfirm);

function renderSection() {
  return render(<HealthKitSettingsSection />);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('HealthKitSettingsSection', () => {
  let toastFn: ReturnType<typeof vi.fn>;
  let confirmFn: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockDetectPlatform.mockReturnValue('ios');
    mockIsEnabled.mockResolvedValue(false);
    mockRevokeAccess.mockResolvedValue(undefined);
    mockPurgeImportedData.mockResolvedValue(undefined);
    mockSyncNow.mockResolvedValue({
      weight: 0,
      steps: 0,
      sleep: 0,
      heartRate: 0,
      calories: 0,
      height: 0,
    });
    toastFn = vi.fn();
    mockUseToast.mockReturnValue(toastFn);
    confirmFn = vi.fn(async () => true);
    mockUseConfirm.mockReturnValue({
      confirm: confirmFn,
      open: false,
      message: '',
      title: undefined,
      confirmLabel: 'Confirm',
      cancelLabel: 'Cancel',
      destructive: false,
      handleConfirm: vi.fn(),
      handleCancel: vi.fn(),
    });
  });

  describe('not-connected state (isEnabled = false, never connected)', () => {
    it('renders the card heading "Apple Health"', async () => {
      renderSection();
      await waitFor(() => {
        expect(screen.getByText('Apple Health')).toBeDefined();
      });
    });

    it('renders "Connect Apple Health" CTA', async () => {
      renderSection();
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /Connect Apple Health/i })).toBeDefined();
      });
    });

    it('does not render "Connected" or "Access revoked" badge', async () => {
      renderSection();
      await waitFor(() => {
        expect(screen.queryByText('Connected')).toBeNull();
        expect(screen.queryByText('Access revoked')).toBeNull();
      });
    });
  });

  describe('connected state (isEnabled = true)', () => {
    beforeEach(() => {
      mockIsEnabled.mockResolvedValue(true);
    });

    it('renders "Connected" success badge', async () => {
      renderSection();
      await waitFor(() => {
        expect(screen.getByText('Connected')).toBeDefined();
      });
    });

    it('renders "Sync now" tonal button', async () => {
      renderSection();
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /Sync now/i })).toBeDefined();
      });
    });

    it('renders "Auto-sync enabled" Pill toggle', async () => {
      renderSection();
      await waitFor(() => {
        expect(screen.getByText('Auto-sync enabled')).toBeDefined();
      });
    });

    it('renders "Revoke HealthKit access" destructive button', async () => {
      renderSection();
      await waitFor(() => {
        expect(
          screen.getByRole('button', { name: /Revoke HealthKit access/i }),
        ).toBeDefined();
      });
    });

    it('Revoke opens confirmation gate and calls revokeAccess on confirm', async () => {
      renderSection();
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /Revoke HealthKit access/i })).toBeDefined();
      });
      fireEvent.click(screen.getByRole('button', { name: /Revoke HealthKit access/i }));
      await waitFor(() => {
        expect(confirmFn).toHaveBeenCalledWith(
          expect.stringContaining('Future syncs will stop'),
          expect.objectContaining({
            title: 'Revoke Apple Health access?',
            confirmLabel: 'Revoke access',
            cancelLabel: 'Keep connected',
            destructive: true,
          }),
        );
        expect(mockRevokeAccess).toHaveBeenCalledTimes(1);
      });
    });

    it('fires success toast after revoke', async () => {
      renderSection();
      await waitFor(() =>
        expect(screen.getByRole('button', { name: /Revoke HealthKit access/i })).toBeDefined(),
      );
      fireEvent.click(screen.getByRole('button', { name: /Revoke HealthKit access/i }));
      await waitFor(() => {
        expect(toastFn).toHaveBeenCalledWith(
          'Apple Health access revoked. Future syncs are disabled.',
          'success',
        );
      });
    });

    it('does NOT call revokeAccess if confirmation is cancelled', async () => {
      confirmFn.mockResolvedValue(false);
      renderSection();
      await waitFor(() =>
        expect(screen.getByRole('button', { name: /Revoke HealthKit access/i })).toBeDefined(),
      );
      fireEvent.click(screen.getByRole('button', { name: /Revoke HealthKit access/i }));
      await waitFor(() => {
        expect(confirmFn).toHaveBeenCalledTimes(1);
        expect(mockRevokeAccess).not.toHaveBeenCalled();
      });
    });
  });

  describe('revoked state', () => {
    beforeEach(() => {
      // isEnabled returns false initially; component detects revoked via a separate flag
      // In implementation, revoked is tracked by local state after revokeAccess
      // For test purposes, simulate via the component's internal state toggle
      mockIsEnabled.mockResolvedValue(false);
    });

    it('renders "Delete imported Apple Health data" purge button when revoked', async () => {
      // Render with revoked prop / simulate revoked state
      // The component starts by checking isEnabled — since false AND we need revoked state,
      // we simulate by calling revoke first in the component lifecycle
      mockIsEnabled.mockResolvedValue(true); // start connected
      renderSection();
      // Wait for connected state
      await waitFor(() =>
        expect(screen.getByRole('button', { name: /Revoke HealthKit access/i })).toBeDefined(),
      );
      // Click revoke → confirm → revoked state
      fireEvent.click(screen.getByRole('button', { name: /Revoke HealthKit access/i }));
      await waitFor(() => {
        expect(screen.getByText('Access revoked')).toBeDefined();
        expect(
          screen.getByRole('button', { name: /Delete imported Apple Health data/i }),
        ).toBeDefined();
      });
    });

    it('Purge opens confirmation gate with "Keep my data" cancel label', async () => {
      mockIsEnabled.mockResolvedValue(true); // start connected so we can revoke
      renderSection();
      await waitFor(() =>
        expect(screen.getByRole('button', { name: /Revoke HealthKit access/i })).toBeDefined(),
      );
      fireEvent.click(screen.getByRole('button', { name: /Revoke HealthKit access/i }));
      await waitFor(() =>
        expect(screen.getByRole('button', { name: /Delete imported Apple Health data/i })).toBeDefined(),
      );
      fireEvent.click(screen.getByRole('button', { name: /Delete imported Apple Health data/i }));
      await waitFor(() => {
        expect(confirmFn).toHaveBeenCalledWith(
          expect.stringContaining('permanently delete'),
          expect.objectContaining({
            title: 'Delete imported Apple Health data?',
            confirmLabel: 'Delete imported data',
            cancelLabel: 'Keep my data',
            destructive: true,
          }),
        );
        expect(mockPurgeImportedData).toHaveBeenCalledTimes(1);
      });
    });

    it('fires purge success toast', async () => {
      mockIsEnabled.mockResolvedValue(true);
      renderSection();
      await waitFor(() =>
        expect(screen.getByRole('button', { name: /Revoke HealthKit access/i })).toBeDefined(),
      );
      fireEvent.click(screen.getByRole('button', { name: /Revoke HealthKit access/i }));
      await waitFor(() =>
        expect(screen.getByRole('button', { name: /Delete imported Apple Health data/i })).toBeDefined(),
      );
      fireEvent.click(screen.getByRole('button', { name: /Delete imported Apple Health data/i }));
      await waitFor(() => {
        expect(toastFn).toHaveBeenCalledWith(
          'Imported Apple Health data deleted from your account.',
          'success',
        );
      });
    });

    it('renders "Reconnect" button when revoked', async () => {
      mockIsEnabled.mockResolvedValue(true);
      renderSection();
      await waitFor(() =>
        expect(screen.getByRole('button', { name: /Revoke HealthKit access/i })).toBeDefined(),
      );
      fireEvent.click(screen.getByRole('button', { name: /Revoke HealthKit access/i }));
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /Reconnect/i })).toBeDefined();
      });
    });
  });

  describe('Platform guard (non-iOS)', () => {
    it('shows unavailable message on web platform', async () => {
      mockDetectPlatform.mockReturnValue('web');
      renderSection();
      await waitFor(() => {
        expect(
          screen.getByText('Apple Health sync is only available on iPhone.'),
        ).toBeDefined();
      });
    });

    it('does not render interactive controls on non-iOS', async () => {
      mockDetectPlatform.mockReturnValue('web');
      renderSection();
      await waitFor(() => {
        expect(screen.queryByRole('button', { name: /Connect Apple Health/i })).toBeNull();
        expect(screen.queryByRole('button', { name: /Sync now/i })).toBeNull();
      });
    });
  });
});
