/**
 * Phase 64 Plan 64-06 — DsarPortalPage state-residency extension tests (LEGAL-03).
 *
 * 8 behaviors per 64-06-PLAN.md Task 2:
 *   Test 1: Rendered page contains a state-residency Select with 6 options (CA/VA/CO/CT/UT/OTHER)
 *   Test 2: Initially no state selected → no request-type checkboxes visible
 *   Test 3: Select CA → 5 request-type checkboxes visible with human-readable labels
 *   Test 4: Select UT → only 2 checkboxes visible (deletion, access) — narrower set
 *   Test 5: Submit with state=VA + checked ['deletion','access'] → 2 rows inserted into data_rights_requests
 *   Test 6: Cancel CTA copy is exactly "Keep my data rights pending"
 *   Test 7: Submitting deletion ALSO triggers initiate_account_deletion_rpc (legacy flow)
 *   Test 8: Successful insert renders DsarStatusCard with request_id
 */
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DsarPortalPage } from '@/components/dsar/DsarPortalPage';

// ─── Mock supabase ────────────────────────────────────────────────────────────
// We need to mock:
//   supabase.from('dsar_requests').select().eq().order().limit() — existing DSAR flow
//   supabase.from('data_rights_requests').insert([...]) — new multi-state flow
//   supabase.rpc('create_dsar_request') — existing export RPC
//   supabase.rpc('initiate_account_deletion_rpc') — legacy deletion RPC

const mockInsert = vi.fn();
const mockRpc = vi.fn();
const mockSelectBuilder = {
  select: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  order: vi.fn().mockReturnThis(),
  limit: vi.fn().mockResolvedValue({ data: [], error: null }),
  maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
};

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
    from: (table: string) => {
      if (table === 'data_rights_requests') {
        return { insert: mockInsert };
      }
      return mockSelectBuilder;
    },
    channel: (...args: unknown[]) => mockChannel(...args),
    removeChannel: (...args: unknown[]) => mockRemoveChannel(...args),
    storage: {
      from: (...args: unknown[]) => mockStorageFrom(...args),
    },
  },
}));

// ─── Mock Zustand store ───────────────────────────────────────────────────────
const mockUserId = '00000000-0000-0000-0000-0000000000bb';
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

// ─── Setup ────────────────────────────────────────────────────────────────────
beforeEach(() => {
  vi.clearAllMocks();
  mockSelectBuilder.select.mockReturnThis();
  mockSelectBuilder.eq.mockReturnThis();
  mockSelectBuilder.order.mockReturnThis();
  mockSelectBuilder.limit.mockResolvedValue({ data: [], error: null });
  mockSelectBuilder.maybeSingle.mockResolvedValue({ data: null, error: null });
});

afterEach(() => {
  vi.clearAllMocks();
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('DsarPortalPage state-residency extension (Phase 64 LEGAL-03)', () => {
  it('Test 1: renders state-residency select with 6 options (CA/VA/CO/CT/UT/OTHER)', async () => {
    render(<DsarPortalPage />);
    await waitFor(() => expect(mockSelectBuilder.limit).toHaveBeenCalled());

    // The select should be labeled "Which state do you reside in?"
    const select = screen.getByRole('combobox', { name: /which state do you reside in/i });
    expect(select).toBeTruthy();

    // 6 state options + placeholder/prompt option
    const options = within(select as HTMLElement).getAllByRole('option');
    const stateValues = options.map((o) => (o as HTMLOptionElement).value).filter(Boolean);
    expect(stateValues).toContain('CA');
    expect(stateValues).toContain('VA');
    expect(stateValues).toContain('CO');
    expect(stateValues).toContain('CT');
    expect(stateValues).toContain('UT');
    expect(stateValues).toContain('OTHER');
    expect(stateValues).toHaveLength(6);
  });

  it('Test 2: initially no state selected → no request-type checkboxes visible', async () => {
    render(<DsarPortalPage />);
    await waitFor(() => expect(mockSelectBuilder.limit).toHaveBeenCalled());

    // No checkboxes should be rendered before a state is selected
    const checkboxes = screen.queryAllByRole('checkbox');
    expect(checkboxes).toHaveLength(0);
  });

  it('Test 3: select CA → 5 checkboxes with human-readable labels', async () => {
    render(<DsarPortalPage />);
    await waitFor(() => expect(mockSelectBuilder.limit).toHaveBeenCalled());

    const user = userEvent.setup();
    const select = screen.getByRole('combobox', { name: /which state do you reside in/i });
    await user.selectOptions(select, 'CA');

    await waitFor(() => {
      const checkboxes = screen.getAllByRole('checkbox');
      expect(checkboxes).toHaveLength(5);
    });

    // Verify human-readable labels for CA request types
    expect(screen.getByLabelText(/delete my data/i)).toBeTruthy();
    expect(screen.getByLabelText(/access my data/i)).toBeTruthy();
    expect(screen.getByLabelText(/export my data in portable format/i)).toBeTruthy();
    expect(screen.getByLabelText(/opt out of sale/i)).toBeTruthy();
    expect(screen.getByLabelText(/limit use of my sensitive personal information/i)).toBeTruthy();
  });

  it('Test 4: select UT → only 2 checkboxes (deletion, access) — UCPA narrower', async () => {
    render(<DsarPortalPage />);
    await waitFor(() => expect(mockSelectBuilder.limit).toHaveBeenCalled());

    const user = userEvent.setup();
    const select = screen.getByRole('combobox', { name: /which state do you reside in/i });
    await user.selectOptions(select, 'UT');

    await waitFor(() => {
      const checkboxes = screen.getAllByRole('checkbox');
      expect(checkboxes).toHaveLength(2);
    });

    expect(screen.getByLabelText(/delete my data/i)).toBeTruthy();
    expect(screen.getByLabelText(/access my data/i)).toBeTruthy();
    // portability should NOT be present for UT
    expect(screen.queryByLabelText(/export my data in portable format/i)).toBeNull();
  });

  it('Test 5: submit with state=VA + checked [deletion, access] → 2 rows inserted into data_rights_requests', async () => {
    const newRequestId = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
    mockInsert.mockResolvedValue({
      data: [
        { id: newRequestId, state_residency: 'VA', request_type: 'deletion' },
        {
          id: 'dddddddd-dddd-dddd-dddd-dddddddddddd',
          state_residency: 'VA',
          request_type: 'access',
        },
      ],
      error: null,
    });
    // Legacy deletion RPC
    mockRpc.mockImplementation((name: string) => {
      if (name === 'initiate_account_deletion_rpc') {
        return Promise.resolve({ data: { id: 'legacy-id' }, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    });

    render(<DsarPortalPage />);
    await waitFor(() => expect(mockSelectBuilder.limit).toHaveBeenCalled());

    const user = userEvent.setup();
    const select = screen.getByRole('combobox', { name: /which state do you reside in/i });
    await user.selectOptions(select, 'VA');

    await waitFor(() => {
      expect(screen.getAllByRole('checkbox')).toHaveLength(5);
    });

    // Check deletion and access checkboxes
    await user.click(screen.getByLabelText(/delete my data/i));
    await user.click(screen.getByLabelText(/access my data/i));

    // Submit the data rights request form
    const submitBtn = screen.getByRole('button', { name: /submit data rights request/i });
    await user.click(submitBtn);

    await waitFor(() => {
      expect(mockInsert).toHaveBeenCalledTimes(1);
    });

    // Verify 2 rows inserted — one per request type
    const insertCall = mockInsert.mock.calls[0]?.[0] as unknown[];
    expect(Array.isArray(insertCall)).toBe(true);
    expect(insertCall).toHaveLength(2);

    const rows = insertCall as Array<{
      state_residency: string;
      request_type: string;
      user_id: string;
    }>;
    expect(rows.every((r) => r.state_residency === 'VA')).toBe(true);
    expect(rows.every((r) => r.user_id === mockUserId)).toBe(true);
    const types = rows.map((r) => r.request_type).sort();
    expect(types).toEqual(['access', 'deletion']);
  });

  it('Test 6: cancel CTA copy is exactly "Keep my data rights pending"', async () => {
    render(<DsarPortalPage />);
    await waitFor(() => expect(mockSelectBuilder.limit).toHaveBeenCalled());

    // The cancel button should use exact copy from UI-SPEC
    const cancelBtn = screen.getByRole('button', { name: 'Keep my data rights pending' });
    expect(cancelBtn).toBeTruthy();
  });

  it('Test 7: submitting deletion ALSO triggers initiate_account_deletion_rpc (legacy flow)', async () => {
    mockInsert.mockResolvedValue({
      data: [{ id: 'eeee-id', state_residency: 'CA', request_type: 'deletion' }],
      error: null,
    });
    mockRpc.mockImplementation((name: string) => {
      if (name === 'initiate_account_deletion_rpc') {
        return Promise.resolve({ data: { id: 'legacy-deletion-id' }, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    });

    render(<DsarPortalPage />);
    await waitFor(() => expect(mockSelectBuilder.limit).toHaveBeenCalled());

    const user = userEvent.setup();
    const select = screen.getByRole('combobox', { name: /which state do you reside in/i });
    await user.selectOptions(select, 'CA');

    await waitFor(() => {
      expect(screen.getAllByRole('checkbox')).toHaveLength(5);
    });

    await user.click(screen.getByLabelText(/delete my data/i));

    const submitBtn = screen.getByRole('button', { name: /submit data rights request/i });
    await user.click(submitBtn);

    await waitFor(() => {
      expect(mockRpc).toHaveBeenCalledWith('initiate_account_deletion_rpc');
    });
  });

  it('Test 8: successful insert renders DsarStatusCard with request_id', async () => {
    const newRequestId = 'ffffffff-ffff-ffff-ffff-ffffffffffff';
    mockInsert.mockResolvedValue({
      data: [{ id: newRequestId, state_residency: 'CO', request_type: 'access' }],
      error: null,
    });
    mockRpc.mockResolvedValue({ data: null, error: null });

    render(<DsarPortalPage />);
    await waitFor(() => expect(mockSelectBuilder.limit).toHaveBeenCalled());

    const user = userEvent.setup();
    const select = screen.getByRole('combobox', { name: /which state do you reside in/i });
    await user.selectOptions(select, 'CO');

    await waitFor(() => {
      expect(screen.getAllByRole('checkbox')).toHaveLength(6);
    });

    await user.click(screen.getByLabelText(/access my data/i));

    const submitBtn = screen.getByRole('button', { name: /submit data rights request/i });
    await user.click(submitBtn);

    await waitFor(() => {
      // DsarStatusCard renders after successful insert
      expect(screen.getByTestId('dsar-state-status-card')).toBeTruthy();
    });
  });
});
