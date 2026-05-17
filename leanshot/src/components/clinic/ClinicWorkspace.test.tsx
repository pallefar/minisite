/**
 * Phase 9 Plan 09-02 — ClinicWorkspace RTL coverage.
 *
 * Tests:
 *   - Loading skeletons render before org row hydrates.
 *   - Hydrated state renders ClinicContextBar + empty-roster shell.
 *   - "Invite patient" CTA opens InvitePatientModal.
 *   - Error state shows retry button.
 *   - ContextBar org-name truncation to 32 chars.
 *   - WorkspaceSwitcher trigger placeholder has correct aria-label.
 */
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ClinicWorkspace } from './ClinicWorkspace';

const mockMaybeSingle = vi.fn();

// Plan 09-08 — WorkspaceSwitcher (mounted by ClinicContextBar) also reads
// memberships via from('memberships').select(...).eq(...).is(...). The chain
// terminates with `.is()` returning a Promise rather than `.maybeSingle()`.
// Add `is()` here so both consumers can share the chain in this test file.
const fromChain = {
  select: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  is: vi.fn().mockResolvedValue({ data: [], error: null }),
  maybeSingle: mockMaybeSingle,
};

vi.mock('@/lib/supabase', () => {
  const mockChannelReturn = {
    on: vi.fn().mockReturnThis(),
    subscribe: vi.fn().mockReturnThis(),
  };
  return {
    supabase: {
      from: () => fromChain,
      storage: {
        from: () => ({
          getPublicUrl: (path: string) => ({
            data: { publicUrl: `https://test.example/${path}` },
          }),
        }),
      },
      rpc: vi.fn().mockResolvedValue({ data: [], error: null }),
      channel: vi.fn().mockReturnValue(mockChannelReturn),
      removeChannel: vi.fn(),
      auth: {
        getSession: vi
          .fn()
          .mockResolvedValue({ data: { session: { user: { id: 'u-1' } } } }),
      },
    },
  };
});

// Plan 09-08 — WorkspaceSwitcher subscribes to user-channel for cross-context
// updates. Stub so the test doesn't depend on real Realtime infra.
vi.mock('@/lib/clinic-realtime', () => ({
  subscribeToUserChannel: vi.fn().mockResolvedValue({ unsubscribe: vi.fn() }),
}));

// Stub clinic.ts so InvitePatientModal child can render without breaking.
vi.mock('@/lib/clinic', () => ({
  sendInvite: vi.fn().mockResolvedValue({ ok: true, data: { invite_id: 'inv-1' } }),
}));

vi.mock('@/hooks/useToast', () => ({
  useToast: () => vi.fn(),
}));

beforeEach(() => {
  mockMaybeSingle.mockReset();
  fromChain.select.mockReturnThis();
  fromChain.eq.mockReturnThis();
  // Default route under /clinic/acme so slug parses correctly.
  window.history.replaceState({}, '', '/clinic/acme');
});

afterEach(() => {
  cleanup();
  document.body.style.overflow = '';
});

const TEST_ORG = {
  id: 'org-1',
  slug: 'acme',
  name: 'Acme Endocrinology',
  description: null,
  website_url: null,
  logo_storage_path: null,
  created_by: 'u-1',
  created_at: '2026-05-13T00:00:00Z',
};

describe('ClinicWorkspace — loading + hydrated', () => {
  it('renders the loading skeleton while the org row is hydrating', async () => {
    // Never-resolving promise to stay in loading state
    mockMaybeSingle.mockReturnValueOnce(new Promise(() => {}));
    render(<ClinicWorkspace />);
    expect(screen.getByTestId('clinic-workspace-loading')).toBeInTheDocument();
  });

  it('renders RosterTable + ClinicContextBar once hydrated (Phase 10 Plan 10-06)', async () => {
    mockMaybeSingle.mockResolvedValueOnce({ data: TEST_ORG, error: null });
    render(<ClinicWorkspace />);
    await screen.findByTestId('clinic-workspace');
    // ContextBar with org name (appears in both bar + page heading)
    expect(screen.getAllByText(TEST_ORG.name).length).toBeGreaterThanOrEqual(2);
    // Phase 10: RosterTable renders instead of Phase 9 empty shell. With rpc
    // mocked to return [] the roster shows empty state (no patients yet).
    await waitFor(() =>
      expect(screen.getByText(/No patients yet/i)).toBeInTheDocument(),
    );
    // Invite patient CTA (now in roster section header, not empty state)
    expect(screen.getByRole('button', { name: /Invite patient/i })).toBeInTheDocument();
    // Plan 09-08 — real WorkspaceSwitcher mounted in the ContextBar.
    await waitFor(() =>
      expect(
        screen.getByRole('button', {
          name: /^Switch workspace\. Currently in/,
        }),
      ).toBeInTheDocument(),
    );
  });

  it('opens InvitePatientModal when "Invite patient" CTA is clicked (Phase 10: button in roster header)', async () => {
    mockMaybeSingle.mockResolvedValueOnce({ data: TEST_ORG, error: null });
    render(<ClinicWorkspace />);
    await screen.findByTestId('clinic-workspace');
    // Wait for RosterTable to render (loading resolves to empty state with the invite button)
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Invite patient/i })).toBeInTheDocument(),
    );
    await userEvent.click(screen.getByRole('button', { name: /Invite patient/i }));
    // Modal title is "Invite a patient"
    await waitFor(() =>
      expect(screen.getByRole('dialog', { name: /Invite a patient/i })).toBeInTheDocument(),
    );
  });
});

describe('ClinicWorkspace — error path', () => {
  it('renders retry button when supabase.from errors', async () => {
    mockMaybeSingle.mockResolvedValueOnce({
      data: null,
      error: { message: 'network' },
    });
    render(<ClinicWorkspace />);
    await screen.findByTestId('clinic-workspace-error');
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
  });

  it('retry re-fires the load', async () => {
    mockMaybeSingle
      .mockResolvedValueOnce({ data: null, error: { message: 'network' } })
      .mockResolvedValueOnce({ data: TEST_ORG, error: null });
    render(<ClinicWorkspace />);
    await screen.findByTestId('clinic-workspace-error');
    await userEvent.click(screen.getByRole('button', { name: /retry/i }));
    await screen.findByTestId('clinic-workspace');
    expect(screen.getAllByText(TEST_ORG.name).length).toBeGreaterThanOrEqual(1);
  });
});

describe('ClinicContextBar — name truncation + monogram fallback', () => {
  it('truncates org names over 32 chars with an ellipsis', async () => {
    const longOrg = {
      ...TEST_ORG,
      name: 'A Very Long Workspace Name That Goes On And On',
    };
    mockMaybeSingle.mockResolvedValueOnce({ data: longOrg, error: null });
    render(<ClinicWorkspace />);
    await screen.findByTestId('clinic-workspace');
    const bar = screen.getByTestId('clinic-context-bar');
    // The visible name span ends with an ellipsis
    expect(bar.textContent).toMatch(/…/);
  });

  it('renders monogram fallback when logo_storage_path is null', async () => {
    mockMaybeSingle.mockResolvedValueOnce({ data: TEST_ORG, error: null });
    render(<ClinicWorkspace />);
    await screen.findByTestId('clinic-workspace');
    // No <img> in the context bar (monogram path)
    const bar = screen.getByTestId('clinic-context-bar');
    expect(bar.querySelector('img')).toBeNull();
    // Monogram is the first letter of the org name
    expect(bar.textContent).toMatch(/A/);
  });

  it('renders <img> when logo_storage_path is present', async () => {
    mockMaybeSingle.mockResolvedValueOnce({
      data: { ...TEST_ORG, logo_storage_path: 'org-1/logo.png' },
      error: null,
    });
    render(<ClinicWorkspace />);
    await screen.findByTestId('clinic-workspace');
    const bar = screen.getByTestId('clinic-context-bar');
    const img = bar.querySelector('img');
    expect(img).not.toBeNull();
    expect(img?.getAttribute('alt')).toBe('Acme Endocrinology logo');
  });
});

describe('ClinicWorkspace — invite-from-query-string handoff', () => {
  it('auto-opens InvitePatientModal when ?invite=1 is present (OrgCreateFlow handoff)', async () => {
    window.history.replaceState({}, '', '/clinic/acme?invite=1');
    mockMaybeSingle.mockResolvedValueOnce({ data: TEST_ORG, error: null });
    render(<ClinicWorkspace />);
    await screen.findByTestId('clinic-workspace');
    expect(screen.getByRole('dialog', { name: /Invite a patient/i })).toBeInTheDocument();
  });
});
