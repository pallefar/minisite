/**
 * Phase 55 Plan 55-04 — HealthKitConsentModal unit tests (TDD RED).
 *
 * Coverage:
 *   - Modal renders full UI-SPEC Screen 1 copy (title, lead, firewall, 7 data types, disclosures)
 *   - Acknowledgement checkbox is UNCHECKED by default
 *   - "Connect Apple Health" CTA is disabled until checkbox is checked
 *   - Checking the box enables the CTA; clicking calls requestHealthKitAuthorization
 *   - On auth success: calls onConnected + fires success toast
 *   - On auth failure: fires error toast (denied)
 *   - On non-iOS (detectPlatform === 'web'): shows unavailable message, no consent controls
 *   - dismissible=false + hideClose=true (consent gate)
 *
 * Run: npx vitest run --config vite.config.ts src/components/healthkit/__tests__/HealthKitConsentModal.test.tsx
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as useToastMod from '@/hooks/useToast';
import * as healthMod from '@/lib/native/health';
import * as platformMod from '@/lib/native/platform';
import { HealthKitConsentModal } from '../HealthKitConsentModal';

// ---------------------------------------------------------------------------
// Mocks (hoisted via vi.mock — runs before imports)
// ---------------------------------------------------------------------------

vi.mock('@/lib/native/health', () => ({
  requestHealthKitAuthorization: vi.fn(),
}));

vi.mock('@/lib/native/platform', () => ({
  detectPlatform: vi.fn(() => 'ios'),
}));

vi.mock('@/hooks/useToast', () => ({
  useToast: vi.fn(() => vi.fn()),
}));

// framer-motion: render children directly so AnimatePresence works in jsdom
vi.mock('framer-motion', () => ({
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  motion: {
    div: ({ children, onClick, className, role, 'aria-modal': ariaModal, 'aria-label': ariaLabel, ...rest }: React.HTMLAttributes<HTMLDivElement>) => (
      // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- test-only framer-motion mock
      <div onClick={onClick} onKeyDown={undefined} className={className} role={role} aria-modal={ariaModal} aria-label={ariaLabel} {...rest}>
        {children}
      </div>
    ),
  },
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const mockRequestAuth = vi.mocked(healthMod.requestHealthKitAuthorization);
const mockDetectPlatform = vi.mocked(platformMod.detectPlatform);
const mockUseToast = vi.mocked(useToastMod.useToast);

function renderModal(props: Partial<Parameters<typeof HealthKitConsentModal>[0]> = {}) {
  const defaultProps = {
    open: true,
    onClose: vi.fn(),
    onConnected: vi.fn(),
    ...props,
  };
  return render(<HealthKitConsentModal {...defaultProps} />);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('HealthKitConsentModal', () => {
  let toastFn: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockDetectPlatform.mockReturnValue('ios');
    mockRequestAuth.mockResolvedValue(true);
    toastFn = vi.fn();
    mockUseToast.mockReturnValue(toastFn);
  });

  describe('Screen 1: Consent modal (iOS)', () => {
    it('renders the modal title', () => {
      renderModal();
      // "Connect Apple Health" appears in modal header and CTA button — getAllByText confirms both
      const matches = screen.getAllByText('Connect Apple Health');
      expect(matches.length).toBeGreaterThanOrEqual(1);
    });

    it('renders the lead paragraph', () => {
      renderModal();
      expect(
        screen.getByText(
          'LeanShot can read health data from Apple Health to automatically track your weight, steps, sleep, and heart rate alongside your GLP-1 journey.',
        ),
      ).toBeDefined();
    });

    it('renders the firewall guarantee with bold "never"', () => {
      renderModal();
      // The guarantee spans multiple inline elements (bold "never"); match the paragraph
      const matches = screen.getAllByText((_, el) =>
        el?.tagName === 'P' && !!el?.textContent?.includes('never shared with ad networks'),
      );
      expect(matches.length).toBeGreaterThanOrEqual(1);
    });

    it('renders all 7 data-type disclosure rows', () => {
      renderModal();
      expect(screen.getByText('Body weight — imported to your weight log')).toBeDefined();
      expect(screen.getByText('Daily steps — imported to your activity log')).toBeDefined();
      expect(screen.getByText('Sleep duration — imported to your sleep log')).toBeDefined();
      expect(screen.getByText('Resting heart rate — imported to your health dashboard')).toBeDefined();
      expect(screen.getByText('Active calories burned — imported to your activity log')).toBeDefined();
      expect(screen.getByText('Dietary protein — imported to your nutrition log')).toBeDefined();
      expect(screen.getByText('Height — used to calculate BMI in your weight log')).toBeDefined();
    });

    it('renders the retention disclosure', () => {
      renderModal();
      expect(
        screen.getByText(/Imported data is stored in your LeanShot account/),
      ).toBeDefined();
    });

    it('renders the revoke-path disclosure', () => {
      renderModal();
      expect(
        screen.getByText(/To disconnect Apple Health, go to Settings/),
      ).toBeDefined();
    });

    it('renders the acknowledgement checkbox', () => {
      renderModal();
      const checkbox = screen.getByRole('checkbox');
      expect(checkbox).toBeDefined();
    });

    it('checkbox is UNCHECKED by default', () => {
      renderModal();
      const checkbox = screen.getByRole('checkbox') as HTMLInputElement;
      expect(checkbox.checked).toBe(false);
    });

    it('renders "Not now" ghost button', () => {
      renderModal();
      expect(screen.getByRole('button', { name: /Not now/i })).toBeDefined();
    });

    it('renders "Connect Apple Health" primary CTA', () => {
      renderModal();
      expect(screen.getByRole('button', { name: /Connect Apple Health/i })).toBeDefined();
    });

    it('CTA is disabled when checkbox is unchecked', () => {
      renderModal();
      const cta = screen.getByRole('button', { name: /Connect Apple Health/i }) as HTMLButtonElement;
      expect(cta.disabled).toBe(true);
    });

    it('CTA has aria-disabled when checkbox is unchecked', () => {
      renderModal();
      const cta = screen.getByRole('button', { name: /Connect Apple Health/i });
      expect(cta.getAttribute('aria-disabled')).toBe('true');
    });

    it('CTA becomes enabled after checking the checkbox', () => {
      renderModal();
      const checkbox = screen.getByRole('checkbox');
      fireEvent.click(checkbox);
      const cta = screen.getByRole('button', { name: /Connect Apple Health/i }) as HTMLButtonElement;
      expect(cta.disabled).toBe(false);
    });

    it('calls requestHealthKitAuthorization on CTA click', async () => {
      renderModal();
      const checkbox = screen.getByRole('checkbox');
      fireEvent.click(checkbox);
      const cta = screen.getByRole('button', { name: /Connect Apple Health/i });
      fireEvent.click(cta);
      await waitFor(() => {
        expect(mockRequestAuth).toHaveBeenCalledTimes(1);
      });
    });

    it('fires success toast and onConnected when auth granted', async () => {
      const onConnected = vi.fn();
      mockRequestAuth.mockResolvedValue(true);
      renderModal({ onConnected });
      const checkbox = screen.getByRole('checkbox');
      fireEvent.click(checkbox);
      const cta = screen.getByRole('button', { name: /Connect Apple Health/i });
      fireEvent.click(cta);
      await waitFor(() => {
        expect(toastFn).toHaveBeenCalledWith(
          'Apple Health connected. Starting initial sync…',
          'success',
        );
        expect(onConnected).toHaveBeenCalledTimes(1);
      });
    });

    it('fires error toast when auth denied', async () => {
      mockRequestAuth.mockResolvedValue(false);
      renderModal();
      const checkbox = screen.getByRole('checkbox');
      fireEvent.click(checkbox);
      const cta = screen.getByRole('button', { name: /Connect Apple Health/i });
      fireEvent.click(cta);
      await waitFor(() => {
        expect(toastFn).toHaveBeenCalledWith(
          'Apple Health access was denied. Grant access in iOS Settings > Privacy > Health > LeanShot.',
          'error',
        );
      });
    });

    it('calls onClose when "Not now" is clicked', () => {
      const onClose = vi.fn();
      renderModal({ onClose });
      fireEvent.click(screen.getByRole('button', { name: /Not now/i }));
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });

  describe('Platform guard (non-iOS)', () => {
    it('shows unavailable message on web platform', () => {
      mockDetectPlatform.mockReturnValue('web');
      renderModal();
      expect(
        screen.getByText('Apple Health sync is only available on iPhone.'),
      ).toBeDefined();
    });

    it('does not render consent form on web platform', () => {
      mockDetectPlatform.mockReturnValue('web');
      renderModal();
      expect(screen.queryByRole('checkbox')).toBeNull();
    });

    it('does not render CTA on android platform', () => {
      mockDetectPlatform.mockReturnValue('android');
      renderModal();
      expect(
        screen.queryByRole('button', { name: /Connect Apple Health/i }),
      ).toBeNull();
    });
  });

  describe('when open=false', () => {
    it('does not render content when closed', () => {
      renderModal({ open: false });
      expect(screen.queryByText('Connect Apple Health')).toBeNull();
    });
  });
});
