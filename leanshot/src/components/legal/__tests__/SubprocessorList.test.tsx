/**
 * Phase 64 Plan 04 — SubprocessorList tests (TDD RED → GREEN).
 *
 * Tests the public-facing SubprocessorList component that live-fetches
 * from public.subprocessor_snapshots (Phase 25 cron output).
 *
 * Mocks @/lib/supabase via vi.mock to avoid real network calls.
 */
import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SubprocessorList } from '../SubprocessorList';
import { supabase } from '@/lib/supabase';

// Mock the supabase client
vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: vi.fn(),
  },
}));

// Helper to build the Supabase chained query mock returning a specific result
function mockSupabaseQuery(result: { data: unknown; error: unknown }) {
  const maybeSingle = vi.fn().mockResolvedValue(result);
  const limit = vi.fn().mockReturnValue({ maybeSingle });
  const order = vi.fn().mockReturnValue({ limit });
  const select = vi.fn().mockReturnValue({ order });
  vi.mocked(supabase.from).mockReturnValue({ select } as ReturnType<typeof supabase.from>);
}

describe('SubprocessorList', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('Test 1: renders a table with columns Vendor / Purpose / BAA Status / Region when snapshot loads', async () => {
    mockSupabaseQuery({
      data: {
        captured_at: '2026-05-01T00:00:00Z',
        vendors: [
          { name: 'Supabase', purpose: 'Database & Auth', baa_status: 'Signed', region: 'us-east-1' },
          { name: 'Vercel', purpose: 'Hosting', baa_status: 'N/A', region: 'Global' },
        ],
      },
      error: null,
    });

    render(<SubprocessorList />);

    await waitFor(() => {
      expect(screen.getByText('Vendor')).toBeInTheDocument();
    });

    expect(screen.getByText('Purpose')).toBeInTheDocument();
    expect(screen.getByText('BAA Status')).toBeInTheDocument();
    expect(screen.getByText('Region')).toBeInTheDocument();
    expect(screen.getByText('Supabase')).toBeInTheDocument();
    expect(screen.getByText('Database & Auth')).toBeInTheDocument();
    expect(screen.getByText('Signed')).toBeInTheDocument();
    expect(screen.getByText('us-east-1')).toBeInTheDocument();
  });

  it('Test 2: empty snapshot → renders empty state message', async () => {
    mockSupabaseQuery({ data: null, error: null });

    render(<SubprocessorList />);

    await waitFor(() => {
      expect(
        screen.getByText(/Subprocessor list updating — check back shortly/i),
      ).toBeInTheDocument();
    });
  });

  it('Test 3: fetch error → renders error fallback with contact email', async () => {
    mockSupabaseQuery({ data: null, error: { message: 'connection refused' } });

    render(<SubprocessorList />);

    await waitFor(() => {
      expect(
        screen.getByText(/Unable to load subprocessor list/i),
      ).toBeInTheDocument();
    });
    expect(screen.getByText(/privacy@leanshot\.app/i)).toBeInTheDocument();
  });

  it('Test 4: shows loading skeleton while fetching', () => {
    // Never resolves — keep the loading state indefinitely
    const maybeSingle = vi.fn().mockReturnValue(new Promise(() => {}));
    const limit = vi.fn().mockReturnValue({ maybeSingle });
    const order = vi.fn().mockReturnValue({ limit });
    const select = vi.fn().mockReturnValue({ order });
    vi.mocked(supabase.from).mockReturnValue({ select } as ReturnType<typeof supabase.from>);

    render(<SubprocessorList />);

    // Loading skeleton/placeholder should be present immediately
    expect(screen.getByRole('status')).toBeInTheDocument();
  });
});
