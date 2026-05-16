/**
 * Phase 22 plan 22-11 — DsarPortalPage + DsarStatusCard tests (GDPR-03).
 *
 * Owners: 22-11. Replaces the 22-01 Wave-0 scaffold (it.skip placeholders).
 *
 * 10 behaviors from 22-11-PLAN.md task 2:
 *   1. Hero card renders heading "Your data" + body + SLA badge + Export CTA.
 *   2. Export CTA opens confirmation modal with copy "Start your data export?" + Cancel/Confirm.
 *   3. Confirm invokes supabase.rpc('create_dsar_request') → success toast + status card visible.
 *   4. 'already_pending' RPC error → info toast (per UI-SPEC) instead of generic error.
 *   5. DsarStatusCard tone mapping (pending/in_progress/completed/rejected → neutral/info/success/danger).
 *   6. Completed status → Download bundle CTA + "Available until {date}" caption.
 *   7. Rejected status → rejection_reason + Contact support mailto link.
 *   8. aria-live='polite' on status badge so transitions announce.
 *   9. dsar-pdf-render is the v1.3 seam — symbol exists, runtime throws at v1.2 (UI doesn't call it).
 *  10. listDsarRequests history surfaces past requests as date + status rows under "Previous exports".
 */
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DsarPortalPage } from '@/components/dsar/DsarPortalPage';
import { DsarStatusCard } from '@/components/dsar/DsarStatusCard';
import type { DsarRequestRow } from '@/lib/dsar/dsar-export-client';
import { renderDsarPdf } from '@/lib/dsar/dsar-pdf-render';

// NOTE: Imports under test sit above so import-x/order is satisfied, but the
// vi.mock calls below are hoisted by Vitest's compiler to run BEFORE these
// imports resolve at runtime. Mock-state variables (`mockRpc`, `mockFrom`,
// etc.) are intentionally NOT referenced inside the vi.mock factories'
// captured closures so the hoist ordering is safe.

// ─── Mock supabase (network) ──────────────────────────────────────────────────

const mockRpc = vi.fn();
const mockFromBuilder = {
  select: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  order: vi.fn().mockReturnThis(),
  limit: vi.fn(),
  maybeSingle: vi.fn(),
};
const mockFrom = vi.fn(() => mockFromBuilder);

const mockChannelObj = {
  on: vi.fn().mockReturnThis(),
  subscribe: vi.fn().mockReturnThis(),
};
const mockChannel = vi.fn(() => mockChannelObj);
const mockRemoveChannel = vi.fn();

const mockCreateSignedUrl = vi.fn();
const mockStorageFrom = vi.fn(() => ({
  createSignedUrl: mockCreateSignedUrl,
}));

vi.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: (...args: unknown[]) => mockRpc(...args),
    from: (...args: unknown[]) => mockFrom(...args),
    channel: (...args: unknown[]) => mockChannel(...args),
    removeChannel: (...args: unknown[]) => mockRemoveChannel(...args),
    storage: {
      from: (...args: unknown[]) => mockStorageFrom(...args),
    },
  },
}));

// ─── Mock Zustand store for signedIn slice ────────────────────────────────────

const mockUserId = '00000000-0000-0000-0000-0000000000aa';
const mockSignedIn = {
  user: { id: mockUserId, email: 'patient@example.com', is_anonymous: false },
  verified: true,
};
vi.mock('@/lib/store', () => ({
  useStore: (selector: (s: { signedIn: typeof mockSignedIn }) => unknown) =>
    selector({ signedIn: mockSignedIn }),
}));

// ─── Toast capture ────────────────────────────────────────────────────────────

const toastSpy = vi.fn();
vi.mock('@/hooks/useToast', () => ({
  useToast: () => toastSpy,
}));

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const REQ_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

function mkRow(overrides: Partial<DsarRequestRow> = {}): DsarRequestRow {
  return {
    id: REQ_ID,
    user_id: mockUserId,
    requested_at: '2026-05-16T10:00:00.000Z',
    completed_at: null,
    status: 'pending',
    rejection_reason: null,
    export_path: null,
    export_signed_url_expires_at: null,
    ...overrides,
  };
}

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  mockFromBuilder.select.mockReturnThis();
  mockFromBuilder.eq.mockReturnThis();
  mockFromBuilder.order.mockReturnThis();
  mockFromBuilder.limit.mockResolvedValue({ data: [], error: null });
  mockFromBuilder.maybeSingle.mockResolvedValue({ data: null, error: null });
});

afterEach(() => {
  vi.clearAllMocks();
});

// ─── DsarPortalPage tests ─────────────────────────────────────────────────────

describe('DsarPortalPage (Phase 22 GDPR-03)', () => {
  it('Test 1: renders hero card with heading, body, SLA badge, Export CTA', async () => {
    render(<DsarPortalPage />);
    expect(screen.getByRole('heading', { name: 'Your data' })).toBeTruthy();
    expect(screen.getByText(/right to request a copy/i)).toBeTruthy();
    expect(screen.getByText(/30-day SLA/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Export my data' })).toBeTruthy();
    await waitFor(() => expect(mockFrom).toHaveBeenCalledWith('dsar_requests'));
  });

  it('Test 2: Export CTA opens confirmation modal with copy + Cancel/Confirm', async () => {
    render(<DsarPortalPage />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Export my data' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Start your data export?')).toBeTruthy();
    expect(within(dialog).getByText(/typically within 24 hours/i)).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: 'Not now' })).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: 'Start export' })).toBeTruthy();
  });

  it('Test 3: Confirm calls create_dsar_request RPC + shows status card + success toast', async () => {
    mockRpc.mockResolvedValueOnce({ data: REQ_ID, error: null });
    // beforeEach already stubbed limit() to resolve {data: [], error: null} so
    // the initial mount yields no active request (Export CTA stays enabled).
    render(<DsarPortalPage />);
    // Wait for the initial refresh to settle before clicking — otherwise the
    // reconcile-refresh queued below could be consumed by the mount call.
    await waitFor(() => expect(mockFrom).toHaveBeenCalledWith('dsar_requests'));
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Export my data' }));
    // Queue the reconcile-refresh return AFTER the initial mount call is in
    // flight; this resolution only fires after the RPC succeeds.
    mockFromBuilder.limit.mockResolvedValueOnce({
      data: [mkRow({ status: 'pending' })],
      error: null,
    });
    await user.click(await screen.findByRole('button', { name: 'Start export' }));
    await waitFor(() => expect(mockRpc).toHaveBeenCalledWith('create_dsar_request'));
    await waitFor(() =>
      expect(toastSpy).toHaveBeenCalledWith(
        "Export started. We'll email you when it's ready.",
        'success',
      ),
    );
    expect(screen.getByTestId('dsar-status-card')).toBeTruthy();
  });

  it("Test 4: 'already_pending' RPC error surfaces info toast (not generic error)", async () => {
    mockRpc.mockResolvedValueOnce({
      data: null,
      error: { code: 'P0008', message: 'already_pending' },
    });
    render(<DsarPortalPage />);
    await waitFor(() => expect(mockFrom).toHaveBeenCalledWith('dsar_requests'));
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Export my data' }));
    await user.click(await screen.findByRole('button', { name: 'Start export' }));
    await waitFor(() => expect(mockRpc).toHaveBeenCalled());
    await waitFor(() =>
      expect(toastSpy).toHaveBeenCalledWith(
        expect.stringMatching(/already have an active export/i),
        'info',
      ),
    );
    expect(toastSpy).not.toHaveBeenCalledWith(
      expect.stringMatching(/Couldn't start your export/),
      'error',
    );
  });

  it('Test 10: history renders past requests under "Previous exports"', async () => {
    const completedRow = mkRow({
      id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
      status: 'completed',
      requested_at: '2026-05-01T10:00:00.000Z',
      completed_at: '2026-05-02T10:00:00.000Z',
      export_path: `${mockUserId}/old-export.zip`,
      export_signed_url_expires_at: '2026-05-09T10:00:00.000Z',
    });
    const rejectedRow = mkRow({
      id: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
      status: 'rejected',
      requested_at: '2026-04-01T10:00:00.000Z',
      completed_at: '2026-04-02T10:00:00.000Z',
      rejection_reason: 'export_failed:upload_failed',
    });
    // listDsarRequests returns newest-first; the activeRequest picks the first
    // completed/rejected when no live row exists; the rest seed history.
    mockFromBuilder.limit.mockResolvedValueOnce({
      data: [completedRow, rejectedRow],
      error: null,
    });
    mockCreateSignedUrl.mockResolvedValueOnce({
      data: { signedUrl: 'https://example.com/signed' },
      error: null,
    });
    render(<DsarPortalPage />);
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Previous exports' })).toBeTruthy(),
    );
    const historyRows = screen.getAllByTestId('dsar-history-row');
    expect(historyRows).toHaveLength(1);
    expect(historyRows[0]?.textContent).toMatch(/Rejected/);
  });
});

// ─── DsarStatusCard tests ─────────────────────────────────────────────────────

describe('DsarStatusCard (Phase 22 GDPR-03)', () => {
  it('Test 5: tone mapping per state (4 statuses → 4 distinct labels)', () => {
    const states: Array<{ status: DsarRequestRow['status']; label: string }> = [
      { status: 'pending', label: 'Pending' },
      { status: 'in_progress', label: 'In progress' },
      { status: 'completed', label: 'Ready to download' },
      { status: 'rejected', label: 'Rejected' },
    ];
    for (const { status, label } of states) {
      const { unmount } = render(<DsarStatusCard request={mkRow({ status })} />);
      expect(screen.getByText(label)).toBeTruthy();
      unmount();
    }
  });

  it('Test 6: completed status → Download CTA + caption with expiry', () => {
    render(
      <DsarStatusCard
        request={mkRow({
          status: 'completed',
          export_path: `${mockUserId}/bundle.zip`,
          export_signed_url_expires_at: '2026-06-01T10:00:00.000Z',
        })}
        downloadUrl="https://example.com/signed-download"
      />,
    );
    expect(screen.getByRole('button', { name: 'Download bundle' })).toBeTruthy();
    expect(screen.getByText(/Available until/i)).toBeTruthy();
  });

  it('Test 7: rejected status → reason inline + Contact support mailto link', () => {
    render(
      <DsarStatusCard
        request={mkRow({
          status: 'rejected',
          rejection_reason: 'export_failed:upload_failed',
        })}
      />,
    );
    expect(screen.getByText(/We couldn't process this request/i)).toBeTruthy();
    expect(screen.getByText('export_failed:upload_failed')).toBeTruthy();
    const link = screen.getByRole('link', { name: /Contact support/i });
    expect(link.getAttribute('href')).toBe('mailto:support@leanshot.app');
  });

  it("Test 8: aria-live='polite' on status badge so transitions announce", () => {
    render(<DsarStatusCard request={mkRow({ status: 'in_progress' })} />);
    const badge = screen.getByTestId('dsar-status-badge');
    expect(badge.getAttribute('aria-live')).toBe('polite');
  });
});

// ─── dsar-pdf-render tests (Test 9) ───────────────────────────────────────────

describe('dsar-pdf-render (Phase 22 GDPR-03)', () => {
  it('Test 9: v1.3 seam — symbol exists, throws at v1.2 (UI does not call it)', async () => {
    expect(typeof renderDsarPdf).toBe('function');
    await expect(renderDsarPdf({})).rejects.toThrow(/v1\.3-reserved/);
  });
});
