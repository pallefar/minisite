/**
 * Phase 65 Plan 65-09 — TaxDashboard unit tests.
 *
 * 10 cases covering: data fetch on mount, header + Refresh, per-row revenue
 * formatting, 4 status tier classifications + badge tones, proximity bar
 * percent clamp, empty state, error state, and ADMIN_MODULES manifest entry.
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { supabase } from '@/lib/supabase';

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: vi.fn(),
    functions: { invoke: vi.fn() },
  },
}));

const mockFrom = supabase.from as unknown as ReturnType<typeof vi.fn>;
const mockInvoke = supabase.functions.invoke as unknown as ReturnType<typeof vi.fn>;

interface ThresholdRow {
  state: string;
  state_name: string;
  threshold_amount_cents: number;
  transaction_count_threshold: number | null;
}
interface RevenueRow {
  state: string;
  revenue_cents: number;
  last_transaction_at: string | null;
}

function setupQueries(thresholds: ThresholdRow[], revenue: RevenueRow[]) {
  // The component calls `.from('tax_nexus_thresholds').select(...)` then
  // `.from('tax_nexus_state_revenue').select(...)`. Both must return a chained
  // shape `.then`-able with { data, error }. We return a thenable to make the
  // chained calls awaitable.
  const makeThenable = (data: unknown) => ({
    select: () => Promise.resolve({ data, error: null }),
  });
  mockFrom.mockImplementation((table: string) => {
    if (table === 'tax_nexus_thresholds') return makeThenable(thresholds);
    if (table === 'tax_nexus_state_revenue') return makeThenable(revenue);
    return makeThenable([]);
  });
}

function setupError(table: 'tax_nexus_thresholds' | 'tax_nexus_state_revenue') {
  mockFrom.mockImplementation((t: string) => ({
    select: () =>
      t === table
        ? Promise.resolve({ data: null, error: new Error('rls denied') })
        : Promise.resolve({ data: [], error: null }),
  }));
}

beforeEach(() => {
  mockFrom.mockReset();
  mockInvoke.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

async function renderDashboard() {
  const { TaxDashboard } = await import('./TaxDashboard');
  return render(<TaxDashboard />);
}

describe('TaxDashboard', () => {
  it('case 1: fetches thresholds + matview revenue on mount', async () => {
    setupQueries([], []);
    await renderDashboard();
    await waitFor(() => {
      const tables = mockFrom.mock.calls.map((c) => c[0]);
      expect(tables).toContain('tax_nexus_thresholds');
      expect(tables).toContain('tax_nexus_state_revenue');
    });
  });

  it('case 2: renders H1 + Refresh button', async () => {
    setupQueries([], []);
    await renderDashboard();
    await waitFor(() => {
      expect(
        screen.getByRole('heading', { name: /Tax Nexus Monitoring/i, level: 1 }),
      ).toBeDefined();
    });
    expect(screen.getByRole('button', { name: /Refresh/i })).toBeDefined();
  });

  it('case 3: Refresh button invokes nexus-monitor Fn', async () => {
    setupQueries(
      [
        {
          state: 'CA',
          state_name: 'California',
          threshold_amount_cents: 50000000,
          transaction_count_threshold: 200,
        },
      ],
      [],
    );
    mockInvoke.mockResolvedValueOnce({ data: { refreshed: true }, error: null });
    await renderDashboard();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Refresh/i })).toBeDefined();
    });
    fireEvent.click(screen.getByRole('button', { name: /Refresh/i }));
    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('nexus-monitor', expect.anything());
    });
  });

  it('case 4: renders one row per threshold state', async () => {
    setupQueries(
      [
        {
          state: 'CA',
          state_name: 'California',
          threshold_amount_cents: 50000000,
          transaction_count_threshold: 200,
        },
        {
          state: 'TX',
          state_name: 'Texas',
          threshold_amount_cents: 50000000,
          transaction_count_threshold: 200,
        },
        {
          state: 'NY',
          state_name: 'New York',
          threshold_amount_cents: 50000000,
          transaction_count_threshold: 200,
        },
      ],
      [],
    );
    await renderDashboard();
    await waitFor(() => {
      expect(screen.getByText('California')).toBeDefined();
      expect(screen.getByText('Texas')).toBeDefined();
      expect(screen.getByText('New York')).toBeDefined();
    });
  });

  it('case 5: formats revenue + threshold as USD', async () => {
    setupQueries(
      [
        {
          state: 'CA',
          state_name: 'California',
          threshold_amount_cents: 50000000,
          transaction_count_threshold: 200,
        },
      ],
      [{ state: 'CA', revenue_cents: 25000000, last_transaction_at: null }],
    );
    await renderDashboard();
    await waitFor(() => {
      // $500,000 threshold and $250,000 revenue should render
      expect(screen.getAllByText(/\$500,000/).length).toBeGreaterThan(0);
      expect(screen.getAllByText(/\$250,000/).length).toBeGreaterThan(0);
    });
  });

  it('case 6: status tier badges classify <60 / 60-79 / 80-99 / ≥100', async () => {
    setupQueries(
      [
        {
          state: 'CA',
          state_name: 'California',
          threshold_amount_cents: 100000000,
          transaction_count_threshold: 200,
        }, // 50% → safe
        {
          state: 'TX',
          state_name: 'Texas',
          threshold_amount_cents: 100000000,
          transaction_count_threshold: 200,
        }, // 70% → monitoring
        {
          state: 'NY',
          state_name: 'New York',
          threshold_amount_cents: 100000000,
          transaction_count_threshold: 200,
        }, // 90% → at_risk
        {
          state: 'FL',
          state_name: 'Florida',
          threshold_amount_cents: 100000000,
          transaction_count_threshold: 200,
        }, // 110% → nexus_established
      ],
      [
        { state: 'CA', revenue_cents: 50000000, last_transaction_at: null },
        { state: 'TX', revenue_cents: 70000000, last_transaction_at: null },
        { state: 'NY', revenue_cents: 90000000, last_transaction_at: null },
        { state: 'FL', revenue_cents: 110000000, last_transaction_at: null },
      ],
    );
    await renderDashboard();
    await waitFor(() => {
      // "Safe" is unique to the badge (header reads "Tax Nexus Monitoring" + "Last refreshed").
      expect(screen.getByText(/^Safe$/)).toBeDefined();
      // "Monitoring" appears in the H1 + as a badge label — match exact-string badge.
      const monitoringMatches = screen.getAllByText(/^Monitoring$/);
      expect(monitoringMatches.length).toBe(1);
      expect(screen.getByText(/^At risk$/)).toBeDefined();
      expect(screen.getByText(/^Registration required$/)).toBeDefined();
    });
  });

  it('case 7: proximity bar width clamps to 100% when revenue exceeds threshold', async () => {
    setupQueries(
      [
        {
          state: 'FL',
          state_name: 'Florida',
          threshold_amount_cents: 100000000,
          transaction_count_threshold: 200,
        },
      ],
      [{ state: 'FL', revenue_cents: 200000000, last_transaction_at: null }],
    );
    await renderDashboard();
    await waitFor(() => {
      const bar = document.querySelector('[data-testid="proximity-bar-fill-FL"]') as HTMLElement;
      expect(bar).toBeDefined();
      // width should be 100% (clamped) — style.width contains "100%"
      expect(bar.style.width).toMatch(/100/);
    });
  });

  it('case 8: empty state when no threshold rows', async () => {
    setupQueries([], []);
    await renderDashboard();
    await waitFor(() => {
      expect(screen.getByText(/No tax data yet/i)).toBeDefined();
    });
  });

  it('case 9: error state shows Retry when threshold query fails', async () => {
    setupError('tax_nexus_thresholds');
    await renderDashboard();
    await waitFor(() => {
      expect(screen.getByText(/Failed to load tax data/i)).toBeDefined();
    });
    expect(screen.getByRole('button', { name: /Retry/i })).toBeDefined();
  });

  it("case 10: ADMIN_MODULES manifest contains 'tax' entry with TaxDashboard lazy import", async () => {
    const { ADMIN_MODULES } = await import('@/lib/admin/modules');
    const tax = ADMIN_MODULES.find((m) => m.key === 'tax');
    expect(tax).toBeDefined();
    expect(tax?.route).toBe('tax');
    expect(tax?.minRole).toBe('staff');
    // Verify the lazy import actually resolves to a component default
    const resolved = await tax?.lazy();
    expect(resolved?.default).toBeDefined();
    expect(typeof resolved?.default).toBe('function');
  });
});
