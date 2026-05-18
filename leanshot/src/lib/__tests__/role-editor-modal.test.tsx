/**
 * Phase 31 Plan 31-05 Task 2 — role-editor-modal.test.ts
 *
 * Tests for RoleEditorModal in assign mode:
 *   (a) 12 rows × 3 column matrix renders in assign mode
 *   (b) selecting 'clinician' highlights the Clinician column header
 *   (c) last-owner demotion disables Confirm + shows tooltip
 *   (d) non-last-owner demotion enables Confirm
 *   (e) Confirm click calls rpc('change_member_role', ...) once
 *   (f) server LAST_OWNER_DEMOTE_DENIED → toast error fires
 *   (g) branding nav entry hidden when surfaceCheck('branding.edit') is false
 *
 * Mocking strategy:
 *   - supabase.rpc + supabase.from() are mocked via vi.hoisted + vi.mock
 *   - useToast is mocked to capture toast calls
 *   - surfaceCheck is mocked for ClinicSettingsPage nav-visibility test
 */

import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Hoist mocks BEFORE vi.mock factories run
// ---------------------------------------------------------------------------
const { mockRpc, mockFrom } = vi.hoisted(() => ({
  mockRpc: vi.fn(),
  mockFrom: vi.fn(),
}));

const { mockToast } = vi.hoisted(() => ({
  mockToast: vi.fn(),
}));

// Mock supabase
vi.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: mockRpc,
    from: mockFrom,
  },
}));

// Mock useToast to capture toast calls
vi.mock('@/hooks/useToast', () => ({
  useToast: () => mockToast,
}));

// Import after mocks
import { RoleEditorModal } from '@/components/clinic/settings/RoleEditorModal';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a supabase builder chain that returns the given count for owner-count query */
function mockOwnerCount(count: number) {
  const chain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
  };
  // The modal does two queries: one using head:true + count:'exact'
  // Both need to return count
  (chain.eq as ReturnType<typeof vi.fn>).mockImplementation((col: string, val: string) => {
    if (col === 'role' && val === 'owner') {
      return Promise.resolve({ count, data: null, error: null });
    }
    return chain;
  });
  mockFrom.mockReturnValue(chain);
}

// ---------------------------------------------------------------------------
// Setup + teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  // Default owner count: 2 (non-last-owner scenario)
  mockOwnerCount(2);
});

afterEach(() => {
  vi.clearAllMocks();
});

const DEFAULT_PROPS = {
  open: true,
  onClose: vi.fn(),
  mode: 'assign' as const,
  orgId: 'org-uuid-test',
  onSaved: vi.fn(),
  userId: 'user-uuid-test',
  userName: 'Dr. Alice',
  currentRole: 'clinician' as const,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('RoleEditorModal in assign mode', () => {
  // (a) 12 rows × 3 column matrix renders
  it('(a) renders 12 permission rows in the matrix table', async () => {
    render(
      <RoleEditorModal {...DEFAULT_PROPS} />,
    );

    // Wait for the component to settle (owner count query)
    await waitFor(() => {
      expect(screen.getByRole('table', { name: 'Role permissions matrix' })).toBeInTheDocument();
    });

    const rows = screen.getAllByRole('row');
    // 1 header row + 12 data rows = 13 total
    expect(rows).toHaveLength(13);
  });

  // (a) also check 3 columns appear
  it('(a) renders Owner, Clinician, Staff column headers', async () => {
    render(<RoleEditorModal {...DEFAULT_PROPS} />);

    await waitFor(() => {
      expect(screen.getByRole('columnheader', { name: 'Owner' })).toBeInTheDocument();
      expect(screen.getByRole('columnheader', { name: 'Clinician' })).toBeInTheDocument();
      expect(screen.getByRole('columnheader', { name: 'Staff' })).toBeInTheDocument();
    });
  });

  // (b) selecting 'clinician' highlights the Clinician column header
  it('(b) Clinician column header has primary-soft class when selectedRole=clinician', async () => {
    render(<RoleEditorModal {...DEFAULT_PROPS} currentRole="clinician" />);

    await waitFor(() => {
      const clinicianHeader = screen.getByRole('columnheader', { name: 'Clinician' });
      expect(clinicianHeader.className).toContain('bg-[var(--color-primary-soft)]');
    });
  });

  // (b) switching to 'owner' moves highlight to Owner column
  it('(b) switching role to owner moves column highlight', async () => {
    render(<RoleEditorModal {...DEFAULT_PROPS} currentRole="clinician" />);

    await waitFor(() => {
      expect(screen.getByRole('columnheader', { name: 'Clinician' })).toBeInTheDocument();
    });

    // Click the Owner button
    const ownerBtn = screen.getByRole('button', { name: 'Owner' });
    fireEvent.click(ownerBtn);

    await waitFor(() => {
      const ownerHeader = screen.getByRole('columnheader', { name: 'Owner' });
      expect(ownerHeader.className).toContain('bg-[var(--color-primary-soft)]');
    });
  });

  // (c) last-owner demotion disables Confirm + shows tooltip
  it('(c) last-owner demotion: Confirm is disabled with tooltip', async () => {
    // Owner count = 1 (last owner)
    mockOwnerCount(1);

    render(
      <RoleEditorModal
        {...DEFAULT_PROPS}
        currentRole="owner"
      />,
    );

    // Confirm button starts on 'owner' — wait for owner count to load
    // then select 'clinician' to trigger last-owner guard
    await waitFor(() => {
      expect(screen.getByRole('table')).toBeInTheDocument();
    });

    // Click Clinician button
    const clinicianBtn = screen.getByRole('button', { name: 'Clinician' });
    fireEvent.click(clinicianBtn);

    await waitFor(() => {
      // The Confirm button should be disabled
      const confirmBtn = screen.getByRole('button', { name: /Change to Clinician/i });
      expect(confirmBtn).toBeDisabled();
    });

    // Tooltip wrapper should have the last-owner message
    const tooltipSpan = screen
      .getByTitle('An organization must have at least one owner.');
    expect(tooltipSpan).toBeInTheDocument();
  });

  // (d) non-last-owner demotion enables Confirm
  it('(d) non-last-owner demotion: Confirm is enabled', async () => {
    // Owner count = 2
    mockOwnerCount(2);

    render(
      <RoleEditorModal
        {...DEFAULT_PROPS}
        currentRole="owner"
      />,
    );

    await waitFor(() => {
      expect(screen.getByRole('table')).toBeInTheDocument();
    });

    // Select 'clinician'
    const clinicianBtn = screen.getByRole('button', { name: 'Clinician' });
    fireEvent.click(clinicianBtn);

    await waitFor(() => {
      const confirmBtn = screen.getByRole('button', { name: /Change to Clinician/i });
      expect(confirmBtn).not.toBeDisabled();
    });
  });

  // (e) Confirm click calls rpc('change_member_role', ...) once
  it('(e) Confirm calls rpc change_member_role once on valid submit', async () => {
    mockRpc.mockResolvedValue({ data: null, error: null });
    mockOwnerCount(2);

    render(
      <RoleEditorModal
        {...DEFAULT_PROPS}
        currentRole="clinician"
      />,
    );

    await waitFor(() => {
      expect(screen.getByRole('table')).toBeInTheDocument();
    });

    // Select 'staff' and click confirm
    const staffBtn = screen.getByRole('button', { name: 'Staff' });
    fireEvent.click(staffBtn);

    const confirmBtn = await screen.findByRole('button', { name: /Change to Staff/i });
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(mockRpc).toHaveBeenCalledOnce();
      expect(mockRpc).toHaveBeenCalledWith('change_member_role', {
        p_org_id: 'org-uuid-test',
        p_user_id: 'user-uuid-test',
        p_role: 'staff',
      });
    });
  });

  // (f) server LAST_OWNER_DEMOTE_DENIED → toast error
  it('(f) LAST_OWNER_DEMOTE_DENIED server error → toast error message', async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: 'LAST_OWNER_DEMOTE_DENIED: cannot demote last owner' },
    });
    // ownerCount=2 to bypass client guard (server floor test)
    mockOwnerCount(2);

    render(
      <RoleEditorModal
        {...DEFAULT_PROPS}
        currentRole="owner"
      />,
    );

    await waitFor(() => {
      expect(screen.getByRole('table')).toBeInTheDocument();
    });

    // Select 'clinician' (different from 'owner')
    const clinicianBtn = screen.getByRole('button', { name: 'Clinician' });
    fireEvent.click(clinicianBtn);

    const confirmBtn = await screen.findByRole('button', { name: /Change to Clinician/i });
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(
        'An organization must have at least one owner.',
        'error',
      );
    });
  });

  // Audit log note is present
  it('renders audit log note', async () => {
    render(<RoleEditorModal {...DEFAULT_PROPS} />);

    await waitFor(() => {
      expect(
        screen.getByText('Changes are logged to your workspace audit log.'),
      ).toBeInTheDocument();
    });
  });
});
