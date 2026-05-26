/**
 * Phase 61 Plan 61-06 — ClinicProtocolsPage unit tests.
 *
 * Run with:
 *   npx vitest run --config vite.config.ts src/components/clinic/protocols/__tests__/ClinicProtocolsPage.test.tsx
 */

import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ClinicProtocolsPage } from '../ClinicProtocolsPage';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const { mockFrom, mockRpc } = vi.hoisted(() => ({
  mockFrom: vi.fn(),
  mockRpc: vi.fn(),
}));

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: mockFrom,
    rpc: mockRpc,
  },
}));

vi.mock('@/lib/store', () => ({
  useStore: (selector: (s: unknown) => unknown) =>
    selector({
      toast: null,
      showToast: vi.fn(),
      dismissToast: vi.fn(),
    }),
}));

// Mock framer-motion to avoid animation complexity in tests
vi.mock('framer-motion', () => ({
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  motion: {
    div: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
      <div {...props}>{children}</div>
    ),
  },
  useDragControls: () => ({ start: vi.fn() }),
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const makeProtocol = (overrides = {}) => ({
  id: `proto-${Math.random().toString(36).slice(2)}`,
  version: 1,
  name: 'Test Protocol',
  compound: 'tirzepatide',
  audience: 'clinic',
  slug: 'test-protocol',
  updated_at: '2026-05-26T00:00:00Z',
  published_at: '2026-05-25T00:00:00Z',
  ...overrides,
});

const PROTO_1 = makeProtocol({ id: 'proto-1', name: 'Tirzepatide 12-Week Titration', compound: 'tirzepatide', audience: 'clinic' });
const PROTO_2 = makeProtocol({ id: 'proto-2', name: 'Retatrutide 16-Week Stack', compound: 'retatrutide', audience: 'B2C' });

// Build a chainable supabase mock
function makeChain(result: unknown) {
  const chain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockResolvedValue(result),
  };
  return chain;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  // Default mock: return 2 protocols
  mockFrom.mockReturnValue(makeChain({ data: [PROTO_1, PROTO_2], error: null }));
  // rpc for PatientPickerList
  mockRpc.mockResolvedValue({ data: [], error: null });
});

describe('ClinicProtocolsPage', () => {
  it('Test 1: renders both protocol names after load', async () => {
    render(<ClinicProtocolsPage orgId="org-1" />);
    await waitFor(() => {
      expect(screen.getByText('Tirzepatide 12-Week Titration')).toBeTruthy();
      expect(screen.getByText('Retatrutide 16-Week Stack')).toBeTruthy();
    });
  });

  it('Test 2: renders 2 Adopt for patient buttons', async () => {
    render(<ClinicProtocolsPage orgId="org-1" />);
    await waitFor(() => {
      const adoptBtns = screen.getAllByRole('button', { name: /adopt for patient/i });
      expect(adoptBtns).toHaveLength(2);
    });
  });

  it('Test 3: clicking Adopt button opens AdoptProtocolSheet with title', async () => {
    const user = userEvent.setup();
    render(<ClinicProtocolsPage orgId="org-1" />);

    await waitFor(() => {
      expect(screen.getByText('Tirzepatide 12-Week Titration')).toBeTruthy();
    });

    const adoptBtns = screen.getAllByRole('button', { name: /adopt for patient/i });
    await act(async () => {
      await user.click(adoptBtns[0]);
    });

    await waitFor(() => {
      expect(screen.getByText('Adopt Protocol')).toBeTruthy();
    });
  });

  it('Test 4: empty list returns EmptyState with correct copy', async () => {
    mockFrom.mockReturnValue(makeChain({ data: [], error: null }));
    render(<ClinicProtocolsPage orgId="org-1" />);

    await waitFor(() => {
      expect(screen.getByText('No published protocols')).toBeTruthy();
      expect(screen.getByText(/Protocols appear here once approved by two admins/i)).toBeTruthy();
    });
  });

  it('Test 5: error state shows error message', async () => {
    mockFrom.mockReturnValue(makeChain({ data: null, error: { message: 'DB error' } }));
    render(<ClinicProtocolsPage orgId="org-1" />);

    await waitFor(() => {
      expect(screen.getByText(/Failed to load protocols/i)).toBeTruthy();
    });
  });
});
