/**
 * Phase 62 Plan 62-07 (INSIGHTS-05) — ResearchConsentSection unit tests.
 *
 * Covers:
 *   - Toggle defaults to false when profile.research_consent is false
 *   - Toggle ON does not open revoke modal (silent enable)
 *   - Toggle OFF opens revoke confirmation modal
 *   - Modal confirm writes UPDATE with research_consent=false + consent_revoked_at
 *   - Modal cancel keeps consent=true and does NOT write
 *   - Confirm modal copy includes verbatim 'within 24 hours' substring
 *
 * Mock strategy: supabase returns a profile row with research_consent=false
 * on initial load; individual tests exercise the toggle interaction paths.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ResearchConsentSection } from '../ResearchConsentSection';

// --- Pure logic helpers (also exported from component) ----------------------

// Re-export for the getRevokeUpdate helper test
import { getRevokeUpdate } from '../ResearchConsentSection';

// --- Mocks ------------------------------------------------------------------

const mockUpdate = vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) });
const mockSelect = vi.fn().mockReturnValue({
  eq: vi.fn().mockReturnValue({
    single: vi.fn().mockResolvedValue({
      data: { research_consent: false, consent_revoked_at: null },
      error: null,
    }),
  }),
});
const mockFrom = vi.fn().mockImplementation((table: string) => {
  if (table === 'profiles') {
    return {
      select: mockSelect,
      update: mockUpdate,
    };
  }
  return { select: mockSelect, update: mockUpdate };
});
const mockGetUser = vi.fn().mockResolvedValue({
  data: { user: { id: 'u-test-1' } },
});

vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: { getUser: () => mockGetUser() },
    from: (table: string) => mockFrom(table),
  },
}));

vi.mock('@/hooks/useToast', () => ({ useToast: () => vi.fn() }));

vi.mock('@/components/ui/Modal', () => ({
  Modal: ({
    open,
    children,
    title,
    onClose,
  }: {
    open: boolean;
    children: React.ReactNode;
    title?: string;
    onClose?: () => void;
  }) =>
    open ? (
      <div role="dialog" aria-modal="true" data-testid="revoke-modal">
        {title && <h2>{title}</h2>}
        <button type="button" aria-label="Close" onClick={onClose} />
        {children}
      </div>
    ) : null,
}));

vi.mock('@/components/ui/Button', () => ({
  Button: ({
    children,
    onClick,
    variant,
    disabled,
    'aria-label': ariaLabel,
  }: {
    children?: React.ReactNode;
    onClick?: () => void;
    variant?: string;
    disabled?: boolean;
    'aria-label'?: string;
  }) => (
    <button
      type="button"
      onClick={onClick}
      data-variant={variant}
      disabled={disabled}
      aria-label={ariaLabel}
    >
      {children}
    </button>
  ),
}));

// --- Helpers ----------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  // Reset select mock to return research_consent=false by default
  mockSelect.mockReturnValue({
    eq: vi.fn().mockReturnValue({
      single: vi.fn().mockResolvedValue({
        data: { research_consent: false, consent_revoked_at: null },
        error: null,
      }),
    }),
  });
  mockUpdate.mockReturnValue({
    eq: vi.fn().mockResolvedValue({ error: null }),
  });
});

// --- Tests ------------------------------------------------------------------

describe('ResearchConsentSection (INSIGHTS-05)', () => {
  it('Toggle defaults to false when profile.research_consent is false', async () => {
    render(<ResearchConsentSection />);

    // Wait for initial fetch to complete
    await waitFor(() => {
      const toggle = screen.getByRole('switch', { name: /research consent/i });
      expect(toggle).toHaveAttribute('aria-checked', 'false');
    });
  });

  it('Toggle ON does not open revoke modal — calls supabase update with research_consent=true', async () => {
    render(<ResearchConsentSection />);

    await waitFor(() =>
      expect(screen.getByRole('switch', { name: /research consent/i })).toBeInTheDocument(),
    );

    const toggle = screen.getByRole('switch', { name: /research consent/i });
    fireEvent.click(toggle);

    // Modal must NOT appear for enable action
    await waitFor(() => {
      expect(screen.queryByTestId('revoke-modal')).not.toBeInTheDocument();
    });

    // supabase update should be called (enable path)
    await waitFor(() => {
      expect(mockUpdate).toHaveBeenCalled();
      const updateArg = mockUpdate.mock.calls[0][0];
      expect(updateArg).toMatchObject({ research_consent: true });
      // consent_revoked_at must be null when enabling
      expect(updateArg.consent_revoked_at).toBeNull();
    });
  });

  it('Toggle OFF opens revoke confirmation modal', async () => {
    // Start with consent=true so toggling OFF triggers the modal
    mockSelect.mockReturnValue({
      eq: vi.fn().mockReturnValue({
        single: vi.fn().mockResolvedValue({
          data: { research_consent: true, consent_revoked_at: null },
          error: null,
        }),
      }),
    });

    render(<ResearchConsentSection />);

    await waitFor(() => {
      const toggle = screen.getByRole('switch', { name: /research consent/i });
      expect(toggle).toHaveAttribute('aria-checked', 'true');
    });

    const toggle = screen.getByRole('switch', { name: /research consent/i });
    fireEvent.click(toggle);

    // Revoke modal must open
    await waitFor(() => {
      expect(screen.getByTestId('revoke-modal')).toBeInTheDocument();
    });
  });

  it('Modal confirm writes UPDATE with research_consent=false + consent_revoked_at', async () => {
    mockSelect.mockReturnValue({
      eq: vi.fn().mockReturnValue({
        single: vi.fn().mockResolvedValue({
          data: { research_consent: true, consent_revoked_at: null },
          error: null,
        }),
      }),
    });

    render(<ResearchConsentSection />);

    await waitFor(() =>
      expect(screen.getByRole('switch', { name: /research consent/i })).toHaveAttribute(
        'aria-checked',
        'true',
      ),
    );

    // Open the revoke modal
    fireEvent.click(screen.getByRole('switch', { name: /research consent/i }));

    await waitFor(() => expect(screen.getByTestId('revoke-modal')).toBeInTheDocument());

    // Click the confirm / revoke button
    const confirmBtn = screen.getByRole('button', { name: /revoke consent/i });
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(mockUpdate).toHaveBeenCalled();
      const updateArg = mockUpdate.mock.calls[0][0];
      expect(updateArg).toMatchObject({ research_consent: false });
      // consent_revoked_at must be a non-null ISO string
      expect(typeof updateArg.consent_revoked_at).toBe('string');
      expect(updateArg.consent_revoked_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });
  });

  it('Modal cancel keeps consent=true and does NOT write to DB', async () => {
    mockSelect.mockReturnValue({
      eq: vi.fn().mockReturnValue({
        single: vi.fn().mockResolvedValue({
          data: { research_consent: true, consent_revoked_at: null },
          error: null,
        }),
      }),
    });

    render(<ResearchConsentSection />);

    await waitFor(() =>
      expect(screen.getByRole('switch', { name: /research consent/i })).toHaveAttribute(
        'aria-checked',
        'true',
      ),
    );

    // Open the revoke modal
    fireEvent.click(screen.getByRole('switch', { name: /research consent/i }));
    await waitFor(() => expect(screen.getByTestId('revoke-modal')).toBeInTheDocument());

    // Click cancel
    const cancelBtn = screen.getByRole('button', { name: /keep consent enabled/i });
    fireEvent.click(cancelBtn);

    // Modal should close
    await waitFor(() => expect(screen.queryByTestId('revoke-modal')).not.toBeInTheDocument());

    // toggle should still show true (consent retained)
    const toggle = screen.getByRole('switch', { name: /research consent/i });
    expect(toggle).toHaveAttribute('aria-checked', 'true');

    // supabase update must NOT have been called
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("Confirm modal copy includes verbatim 'within 24 hours' substring", async () => {
    mockSelect.mockReturnValue({
      eq: vi.fn().mockReturnValue({
        single: vi.fn().mockResolvedValue({
          data: { research_consent: true, consent_revoked_at: null },
          error: null,
        }),
      }),
    });

    render(<ResearchConsentSection />);

    await waitFor(() =>
      expect(screen.getByRole('switch', { name: /research consent/i })).toHaveAttribute(
        'aria-checked',
        'true',
      ),
    );

    fireEvent.click(screen.getByRole('switch', { name: /research consent/i }));
    await waitFor(() => expect(screen.getByTestId('revoke-modal')).toBeInTheDocument());

    // The modal body must contain the verbatim copy substring
    expect(screen.getByText(/within 24 hours/i)).toBeInTheDocument();
  });
});

// --- Pure helper tests -------------------------------------------------------

describe('getRevokeUpdate helper', () => {
  it('returns research_consent=false with a valid ISO consent_revoked_at timestamp', () => {
    const result = getRevokeUpdate();
    expect(result.research_consent).toBe(false);
    expect(typeof result.consent_revoked_at).toBe('string');
    expect(result.consent_revoked_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});
