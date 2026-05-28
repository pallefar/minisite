/**
 * Phase 61 Plan 07 Task 2 — ProtocolSummaryCard unit tests.
 */

import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { supabase } from '@/lib/supabase';
import { ProtocolSummaryCard } from '../ProtocolSummaryCard';

// ─── Mock supabase ────────────────────────────────────────────────────────────

const PROTOCOL_UUID = '00000000-0000-0000-0000-000000000061';

const mockSelectChain = {
  select: vi.fn(),
  eq: vi.fn(),
  order: vi.fn(),
  limit: vi.fn(),
};

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: vi.fn(),
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
});

function setupPublishedProtocolMock(weekCount: number) {
  // First call: protocols query
  const protocolsChain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue({
      data: [
        {
          id: PROTOCOL_UUID,
          name: 'Tirzepatide 12-week titration',
          compound: 'tirzepatide',
          base_slug: 'tirzepatide-12-week-titration',
          version: 1,
        },
      ],
      error: null,
    }),
  };
  // Second call: protocol_steps count query
  const stepsChain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    // Final resolved value with count
    then: undefined as unknown,
  };
  const stepsResolved = Promise.resolve({ count: weekCount, error: null });
  Object.defineProperty(stepsChain, 'then', { get: () => stepsResolved.then.bind(stepsResolved) });

  const callCount = 0;
  vi.mocked(supabase.from).mockImplementation((table: string) => {
    if (table === 'protocols') {
      return protocolsChain as ReturnType<typeof supabase.from>;
    }
    if (table === 'protocol_steps') {
      // Return a thenable chain
      const chain: Record<string, unknown> = {};
      chain['select'] = vi.fn().mockReturnValue(chain);
      chain['eq'] = vi.fn().mockReturnValue(chain);
      chain['then'] = stepsResolved.then.bind(stepsResolved);
      return chain as ReturnType<typeof supabase.from>;
    }
    return mockSelectChain as ReturnType<typeof supabase.from>;
  });
}

function setupNotFoundMock() {
  const emptyChain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue({
      data: [],
      error: null,
    }),
  };
  vi.mocked(supabase.from).mockReturnValue(emptyChain as ReturnType<typeof supabase.from>);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('ProtocolSummaryCard', () => {
  it('renders skeleton while loading', () => {
    // Never resolves — stays in loading state
    const neverChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnValue(new Promise(() => {})),
    };
    vi.mocked(supabase.from).mockReturnValue(neverChain as ReturnType<typeof supabase.from>);

    render(<ProtocolSummaryCard protocolId={PROTOCOL_UUID} />);
    expect(document.querySelector('.animate-pulse')).toBeTruthy();
  });

  it('renders protocol card with title, compound, weeks badge, and link after fetch', async () => {
    setupPublishedProtocolMock(6);
    render(<ProtocolSummaryCard protocolId={PROTOCOL_UUID} />);

    await waitFor(() => {
      expect(screen.getByText('Tirzepatide 12-week titration')).toBeInTheDocument();
    });
    expect(screen.getByText('tirzepatide')).toBeInTheDocument();
    expect(screen.getByText(/6 weeks/i)).toBeInTheDocument();
    const link = screen.getByText(/View full protocol/i);
    expect(link).toBeInTheDocument();
    expect(link.closest('a')).toHaveAttribute('href', '/protocols/tirzepatide-12-week-titration');
  });

  it('renders "Protocol unavailable" when no published protocol is found', async () => {
    setupNotFoundMock();
    render(<ProtocolSummaryCard protocolId={PROTOCOL_UUID} />);

    await waitFor(() => {
      expect(screen.getByText('Protocol unavailable')).toBeInTheDocument();
    });
  });
});
