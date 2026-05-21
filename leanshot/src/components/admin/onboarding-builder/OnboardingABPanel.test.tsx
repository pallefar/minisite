/**
 * Phase 34 Plan 34-09 ONBOARD-08 — OnboardingABPanel unit tests.
 *
 * Covers:
 *   - Vendor-unconfigured response → banner with Plan 34-10 pointer.
 *   - Empty experiment list → empty-state message.
 *   - Non-superadmin → Ship buttons disabled with "Superadmin only" title.
 *   - Superadmin → Ship click invokes ship-winner-flag with {flag_id, variant}.
 *   - Ship success → toast.success + refetch.
 *   - Ship error 'forbidden_not_superadmin' → toast.error with "Superadmin role required".
 */
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import OnboardingABPanel from './OnboardingABPanel';

// useToast returns a single function (see src/hooks/useToast.ts).
const mockToast = vi.fn();
vi.mock('@/hooks/useToast', () => ({
  useToast: () => mockToast,
}));

const mockGetUser = vi.fn();
const mockProfileMaybeSingle = vi.fn();
const mockInvoke = vi.fn();

vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      getUser: (...args: unknown[]) => mockGetUser(...args),
    },
    from: (_table: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () => mockProfileMaybeSingle(),
        }),
      }),
    }),
    functions: {
      invoke: (...args: unknown[]) => mockInvoke(...args),
    },
  },
}));

beforeEach(() => {
  mockToast.mockReset();
  mockGetUser.mockReset();
  mockProfileMaybeSingle.mockReset();
  mockInvoke.mockReset();
});

afterEach(() => {
  cleanup();
});

function primeUser(role: 'superadmin' | 'admin' | null): void {
  mockGetUser.mockResolvedValue({ data: { user: { id: 'user-abc' } } });
  mockProfileMaybeSingle.mockResolvedValue({
    data: role === null ? null : { admin_role: role },
    error: null,
  });
}

describe('OnboardingABPanel (Plan 34-09 ONBOARD-08)', () => {
  it('renders vendor-unconfigured banner when Edge Fn returns error vendor_unconfigured', async () => {
    primeUser('superadmin');
    mockInvoke.mockResolvedValue({
      data: { error: 'vendor_unconfigured', service: 'posthog' },
      error: null,
    });

    render(<OnboardingABPanel />);

    await waitFor(() => {
      expect(screen.getByText(/PostHog API key not yet configured/i)).toBeTruthy();
    });
    // Mentions Plan 34-10 as the owner of the human checkpoint.
    expect(screen.getByText(/Plan 34-10/i)).toBeTruthy();
  });

  it('renders empty-state when experiments list is empty', async () => {
    primeUser('superadmin');
    mockInvoke.mockResolvedValue({ data: { experiments: [] }, error: null });

    render(<OnboardingABPanel />);

    await waitFor(() => {
      expect(screen.getByText(/No onboarding experiments yet/i)).toBeTruthy();
    });
  });

  it('non-superadmin sees Ship buttons disabled with "Superadmin only" title', async () => {
    primeUser('admin');
    mockInvoke.mockResolvedValue({
      data: {
        experiments: [
          {
            id: 7,
            key: 'onboarding-cta-test',
            name: 'CTA test',
            current_rollout: 50,
            variants: ['control', 'B'],
          },
        ],
      },
      error: null,
    });

    render(<OnboardingABPanel />);

    await waitFor(() => {
      expect(screen.getByText(/CTA test/i)).toBeTruthy();
    });
    const buttons = screen.getAllByRole('button', { name: /Ship .* to 100%/i });
    expect(buttons.length).toBe(2);
    for (const btn of buttons) {
      expect((btn as HTMLButtonElement).disabled).toBe(true);
      expect(btn.getAttribute('title')).toBe('Superadmin only');
    }
  });

  it('superadmin click Ship → invokes ship-winner-flag with {flag_id, variant} + toast success', async () => {
    primeUser('superadmin');
    // First call: list_experiments. Second call: ship-winner-flag. Third: refetch.
    mockInvoke
      .mockResolvedValueOnce({
        data: {
          experiments: [
            { id: 7, key: 'onb-test', name: 'Onb test', current_rollout: 50, variants: ['B'] },
          ],
        },
        error: null,
      })
      .mockResolvedValueOnce({
        data: { ok: true, flag_id: '7', variant: 'B' },
        error: null,
      })
      .mockResolvedValueOnce({
        data: {
          experiments: [
            { id: 7, key: 'onb-test', name: 'Onb test', current_rollout: 100, variants: ['B'] },
          ],
        },
        error: null,
      });

    render(<OnboardingABPanel />);

    const btn = await screen.findByRole('button', { name: /Ship .B. to 100%/i });
    await waitFor(() => expect((btn as HTMLButtonElement).disabled).toBe(false));

    fireEvent.click(btn);

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith(
        'ship-winner-flag',
        expect.objectContaining({ body: { flag_id: '7', variant: 'B' } }),
      );
    });
    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(
        expect.stringMatching(/Shipped variant B/i),
        'success',
      );
    });
  });

  it('Ship returns forbidden_not_superadmin → toast.error "Superadmin role required"', async () => {
    primeUser('superadmin'); // client claims superadmin but server rejects
    mockInvoke
      .mockResolvedValueOnce({
        data: {
          experiments: [
            { id: 7, key: 'onb', name: 'Onb', current_rollout: 50, variants: ['B'] },
          ],
        },
        error: null,
      })
      .mockResolvedValueOnce({
        data: { error: 'forbidden_not_superadmin' },
        error: null,
      });

    render(<OnboardingABPanel />);

    const btn = await screen.findByRole('button', { name: /Ship .B. to 100%/i });
    await waitFor(() => expect((btn as HTMLButtonElement).disabled).toBe(false));

    fireEvent.click(btn);

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(
        expect.stringMatching(/Superadmin role required/i),
        'error',
      );
    });
  });
});
