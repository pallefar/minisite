// Phase 8 Plan 08-03 — ActiveSharesSection unit/contract tests.
//
// Covers the seven RED-phase behaviors for the patient-side Settings → Active
// shares surface:
//   1. Skeleton on initial fetch.
//   2. Empty state when listActiveShares() returns [].
//   3. Populated list (multi-row) renders label + meta + Pill + revoke IconButton.
//   4. Revoke IconButton click → typed-confirm modal opens with verbatim copy.
//   5. Typed-confirm gate: destructive button disabled until input == lowercase label.
//   6. Successful revoke optimistically removes row + emits success toast.
//   7. Failed revoke restores the row + emits danger toast.

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { listActiveShares, revokeShare, type ShareWithStats } from '@/lib/shares';
import { useStore } from '@/lib/store';
import { ActiveSharesSection } from './ActiveSharesSection';

// Mock the supabase client so the module's network calls don't fire.
vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: vi.fn(),
    rpc: vi.fn(),
  },
}));

// Mock the lib/shares wrapper so tests drive deterministic state.
vi.mock('@/lib/shares', () => ({
  listActiveShares: vi.fn(),
  revokeShare: vi.fn(),
  createShare: vi.fn(),
  shareLinkFor: (t: string) => `http://test/#/share/${t}`,
}));

// Mock the CreateShareModal — Task 2 ships the real one. The list section's
// CTA opens it; this test only needs to verify the wiring, not the modal body.
vi.mock('./CreateShareModal', () => ({
  CreateShareModal: ({ open }: { open: boolean }) =>
    open ? <div data-testid="create-share-modal-open" /> : null,
}));

const SHARE_A: ShareWithStats = {
  id: 'share-a-uuid',
  user_id: 'user-uuid',
  label: 'Dr. Smith — Q2 review',
  expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
  revoked_at: null,
  code_consumed_at: null,
  created_at: new Date().toISOString(),
  view_count: 3,
  last_viewed_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
  recipient_ua_families: ['Chrome'],
  recipient_ip_families: ['203.0.113.0/16'],
};

const SHARE_B: ShareWithStats = {
  id: 'share-b-uuid',
  user_id: 'user-uuid',
  label: 'Dr. Lee — second opinion',
  expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
  revoked_at: null,
  code_consumed_at: null,
  created_at: new Date().toISOString(),
  view_count: 0,
  last_viewed_at: null,
  recipient_ua_families: [],
  recipient_ip_families: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  // The component reads `useStore((s) => s.user)` to guard against null —
  // seed a minimal user so the section renders (Phase 7 D-06 pattern).
  useStore.setState({
    user: {
      name: 'Test Patient',
      medication: 'tirzepatide',
      startDate: '2026-01-01',
      startWeight: 100,
      goalWeight: 80,
      dose: 2.5,
      doseUnit: 'mg',
      units: 'metric',
      proteinTarget: 130,
      calorieTarget: 1800,
      fiberTarget: 30,
      waterTarget: 8,
      goal: 'fat-loss',
      liftingLevel: 'beginner',
      sex: 'male',
      activityLevel: 'moderate',
    } as unknown as Parameters<typeof useStore.setState>[0] extends infer T ? T : never,
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ActiveSharesSection — Plan 08-03', () => {
  it('renders skeleton on mount before fetch resolves', async () => {
    let resolveFetch: (v: ShareWithStats[]) => void;
    vi.mocked(listActiveShares).mockReturnValueOnce(
      new Promise<ShareWithStats[]>((resolve) => {
        resolveFetch = resolve;
      }),
    );

    render(<ActiveSharesSection />);

    // Skeletons (aria-hidden divs with skeleton-shimmer) should be present
    // BEFORE the fetch resolves. They live inside the section card.
    expect(document.querySelectorAll('.skeleton-shimmer').length).toBeGreaterThan(0);

    // Resolve so the test cleans up.
    resolveFetch!([]);
    await waitFor(() => {
      expect(screen.queryByText(/No active shares/i)).toBeInTheDocument();
    });
  });

  it('renders empty state when listActiveShares returns []', async () => {
    vi.mocked(listActiveShares).mockResolvedValueOnce([]);

    render(<ActiveSharesSection />);

    await waitFor(() => {
      expect(screen.getByText(/No active shares/i)).toBeInTheDocument();
    });
    // Verbatim copy per UI-SPEC.
    expect(
      screen.getByText(
        /When you share your data with a doctor, the link and code will appear here so you can revoke it later\./i,
      ),
    ).toBeInTheDocument();
  });

  it('renders one row per active share with label + Active Pill + revoke button', async () => {
    vi.mocked(listActiveShares).mockResolvedValue([SHARE_A, SHARE_B]);

    render(<ActiveSharesSection />);

    await waitFor(() => {
      expect(screen.getByText(SHARE_A.label)).toBeInTheDocument();
    });
    expect(screen.getByText(SHARE_B.label)).toBeInTheDocument();

    // Each row has a revoke IconButton with aria-label "Revoke share for {label}".
    expect(
      screen.getByRole('button', { name: `Revoke share for ${SHARE_A.label}` }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: `Revoke share for ${SHARE_B.label}` }),
    ).toBeInTheDocument();
  });

  it('revoke IconButton click opens typed-confirm modal with verbatim copy', async () => {
    vi.mocked(listActiveShares).mockResolvedValue([SHARE_A]);

    render(<ActiveSharesSection />);
    await waitFor(() => screen.getByText(SHARE_A.label));

    const user = userEvent.setup();
    await user.click(
      screen.getByRole('button', { name: `Revoke share for ${SHARE_A.label}` }),
    );

    // Modal title + body + buttons match UI-SPEC verbatim.
    expect(screen.getByText(/Revoke this share\?/i)).toBeInTheDocument();
    expect(
      screen.getByText(
        /The doctor's open page will return an error within seconds and the share link will stop working\./i,
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /^Revoke share$/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Keep share$/i })).toBeInTheDocument();
  });

  it('typed-confirm: destructive button disabled until input matches lowercase label', async () => {
    vi.mocked(listActiveShares).mockResolvedValue([SHARE_A]);

    render(<ActiveSharesSection />);
    await waitFor(() => screen.getByText(SHARE_A.label));

    const user = userEvent.setup();
    await user.click(
      screen.getByRole('button', { name: `Revoke share for ${SHARE_A.label}` }),
    );

    const revokeBtn = screen.getByRole('button', { name: /^Revoke share$/i });
    expect(revokeBtn).toBeDisabled();

    const input = screen.getByLabelText(new RegExp(`Type ${SHARE_A.label}`, 'i'));
    await user.type(input, 'wrong value');
    expect(revokeBtn).toBeDisabled();

    // Lowercase comparison — typing the lowercase form enables the button.
    await user.clear(input);
    await user.type(input, SHARE_A.label.toLowerCase());
    expect(revokeBtn).toBeEnabled();
  });

  it('successful revoke optimistically removes row + shows success toast', async () => {
    // First fetch returns both shares; post-revoke refetch returns just SHARE_B
    // so the optimistic remove is reconciled (no SHARE_A flash-back).
    vi.mocked(listActiveShares)
      .mockResolvedValueOnce([SHARE_A, SHARE_B])
      .mockResolvedValue([SHARE_B]);
    vi.mocked(revokeShare).mockResolvedValueOnce(undefined);

    render(<ActiveSharesSection />);
    await screen.findByText(SHARE_A.label);

    const user = userEvent.setup();
    // Toast must be captured BEFORE 2.4s auto-dismiss. Use spy on store.showToast.
    const showToastSpy = vi.spyOn(useStore.getState(), 'showToast');

    await user.click(
      await screen.findByRole('button', { name: `Revoke share for ${SHARE_A.label}` }),
    );
    const input = await screen.findByLabelText(new RegExp(`Type ${SHARE_A.label}`, 'i'));
    await user.type(input, SHARE_A.label.toLowerCase());
    await user.click(screen.getByRole('button', { name: /^Revoke share$/i }));

    await waitFor(() => {
      expect(screen.queryByText(SHARE_A.label)).not.toBeInTheDocument();
    });
    expect(vi.mocked(revokeShare)).toHaveBeenCalledWith(SHARE_A.id);

    // Toast surfaces with verbatim success copy.
    expect(showToastSpy).toHaveBeenCalledWith(
      expect.stringMatching(/Share revoked\. Doctor's page is now disabled\./i),
      'success',
    );
  });

  it('failed revoke restores row + shows danger toast', async () => {
    vi.mocked(listActiveShares).mockResolvedValue([SHARE_A]);
    vi.mocked(revokeShare).mockRejectedValueOnce(new Error('network'));

    render(<ActiveSharesSection />);
    await screen.findByText(SHARE_A.label);

    const user = userEvent.setup();
    const showToastSpy = vi.spyOn(useStore.getState(), 'showToast');

    await user.click(
      await screen.findByRole('button', { name: `Revoke share for ${SHARE_A.label}` }),
    );
    const input = await screen.findByLabelText(new RegExp(`Type ${SHARE_A.label}`, 'i'));
    await user.type(input, SHARE_A.label.toLowerCase());
    await user.click(screen.getByRole('button', { name: /^Revoke share$/i }));

    await waitFor(() => {
      expect(showToastSpy).toHaveBeenCalledWith(
        expect.stringMatching(/Couldn't revoke\. Check your connection and try again\./i),
        'error',
      );
    });
    // Row should be restored after failure.
    expect(screen.getByText(SHARE_A.label)).toBeInTheDocument();
  });

  it('Create share link CTA opens the CreateShareModal', async () => {
    vi.mocked(listActiveShares).mockResolvedValueOnce([]);

    render(<ActiveSharesSection />);
    await waitFor(() => screen.getByText(/No active shares/i));

    const user = userEvent.setup();
    // Multiple CTAs may exist (empty state + section header). Click the first.
    const ctas = screen.getAllByRole('button', { name: /^Create share link$/i });
    expect(ctas.length).toBeGreaterThan(0);
    await user.click(ctas[0]);

    expect(screen.getByTestId('create-share-modal-open')).toBeInTheDocument();
  });

  it('aggregate view count is rendered from listActiveShares (SHARE-05 wire test)', async () => {
    vi.mocked(listActiveShares).mockResolvedValue([SHARE_A]);

    render(<ActiveSharesSection />);
    await waitFor(() => screen.getByText(SHARE_A.label));

    // SHARE_A has view_count=3 — rendered as the bold count inside the meta line.
    const row = screen.getByText(SHARE_A.label).closest('li');
    expect(row).not.toBeNull();
    // The view-count span is the only `<span class="numerals-tabular font-semibold">3</span>`
    // in the row; assert via class predicate to disambiguate from other digits.
    const countSpan = (row as HTMLElement).querySelector('span.numerals-tabular.font-semibold');
    expect(countSpan?.textContent).toBe('3');
  });
});
