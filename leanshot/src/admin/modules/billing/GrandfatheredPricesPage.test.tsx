/**
 * Phase 43 Plan 05 — GrandfatheredPricesPage RTL tests (MEMBER-02 D-03).
 *
 * Five behavior gates per the plan's <behavior> block:
 *   T1 — mounts + renders table with stub rows from supabase.from.
 *   T2 — create form submission → supabase.rpc('grandfathered_price_create')
 *        called with form values; reload triggered.
 *   T3 — update row inline → supabase.rpc('grandfathered_price_update') called
 *        with p_id + new values.
 *   T4 — delete row with confirm → supabase.rpc('grandfathered_price_delete')
 *        called with p_id.
 *   T5 — RPC error → error banner rendered with error.message text.
 *
 * Mock pattern (cloned from HitlQueuePage.test.tsx): chainable supabase.from
 * builder + vi.fn rpc() that captures args, plus a confirm() stub for T4.
 */

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

interface MockPrice {
  id: string;
  cohort_id: string;
  stripe_price_id: string;
  effective_from: string;
  effective_until: string | null;
  cohort: { id: string; name: string } | null;
}

interface MockCohort {
  id: string;
  name: string;
}

function mkPrice(overrides: Partial<MockPrice> = {}): MockPrice {
  return {
    id: 'price-row-1',
    cohort_id: 'cohort-A',
    stripe_price_id: 'price_abc123',
    effective_from: '2026-01-01T00:00:00Z',
    effective_until: null,
    cohort: { id: 'cohort-A', name: 'Founders Cohort' },
    ...overrides,
  };
}

let mockPrices: MockPrice[] = [];
let mockCohorts: MockCohort[] = [
  { id: 'cohort-A', name: 'Founders Cohort' },
  { id: 'cohort-B', name: 'Beta Cohort' },
];
let mockRpcCalls: Array<{ fn: string; args: Record<string, unknown> }> = [];
let mockRpcError: { message: string } | null = null;

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      const data = table === 'grandfathered_prices' ? mockPrices : mockCohorts;
      const builder: Record<string, unknown> = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        then: (resolve: (v: { data: unknown[]; error: null }) => void) => {
          resolve({ data, error: null });
          return Promise.resolve({ data, error: null });
        },
      };
      return builder;
    },
    rpc: vi.fn((fn: string, args: Record<string, unknown>) => {
      mockRpcCalls.push({ fn, args });
      if (mockRpcError) return Promise.resolve({ data: null, error: mockRpcError });
      // Simulate returning the new/affected id.
      return Promise.resolve({ data: args.p_id ?? 'new-price-id', error: null });
    }),
  },
}));

beforeEach(() => {
  mockPrices = [];
  mockCohorts = [
    { id: 'cohort-A', name: 'Founders Cohort' },
    { id: 'cohort-B', name: 'Beta Cohort' },
  ];
  mockRpcCalls = [];
  mockRpcError = null;
  vi.spyOn(window, 'confirm').mockReturnValue(true);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe('GrandfatheredPricesPage', () => {
  it('T1: mounts + renders table with 2 stub rows', async () => {
    mockPrices = [
      mkPrice({ id: 'price-1', stripe_price_id: 'price_aaa' }),
      mkPrice({
        id: 'price-2',
        stripe_price_id: 'price_bbb',
        cohort_id: 'cohort-B',
        cohort: { id: 'cohort-B', name: 'Beta Cohort' },
      }),
    ];
    const { GrandfatheredPricesPage } = await import('./GrandfatheredPricesPage');
    render(<GrandfatheredPricesPage />);
    await waitFor(() => {
      expect(screen.getByText('price_aaa')).toBeTruthy();
      expect(screen.getByText('price_bbb')).toBeTruthy();
    });
  });

  it('T2: create-form submit calls grandfathered_price_create with form values', async () => {
    const { GrandfatheredPricesPage } = await import('./GrandfatheredPricesPage');
    render(<GrandfatheredPricesPage />);

    // Wait for cohorts to load into the form.
    await waitFor(() => {
      expect(screen.getByLabelText(/cohort/i)).toBeTruthy();
    });

    const cohortSelect = screen.getByLabelText(/cohort/i) as HTMLSelectElement;
    fireEvent.change(cohortSelect, { target: { value: 'cohort-A' } });

    const priceInput = screen.getByLabelText(/stripe price id/i) as HTMLInputElement;
    fireEvent.change(priceInput, { target: { value: 'price_xyz999' } });

    const fromInput = screen.getByLabelText(/effective from/i) as HTMLInputElement;
    fireEvent.change(fromInput, { target: { value: '2026-06-01T00:00' } });

    const submitBtn = screen.getByRole('button', { name: /create/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      const call = mockRpcCalls.find((c) => c.fn === 'grandfathered_price_create');
      expect(call).toBeTruthy();
      expect(call!.args.p_cohort_id).toBe('cohort-A');
      expect(call!.args.p_stripe_price_id).toBe('price_xyz999');
    });
  });

  it('T3: inline-edit save calls grandfathered_price_update with p_id + new values', async () => {
    mockPrices = [mkPrice({ id: 'price-edit-target' })];
    const { GrandfatheredPricesPage } = await import('./GrandfatheredPricesPage');
    render(<GrandfatheredPricesPage />);

    await waitFor(() => expect(screen.getByText('price_abc123')).toBeTruthy());

    const editBtn = await screen.findByRole('button', { name: /^edit$/i });
    fireEvent.click(editBtn);

    // Inline edit mode — find the now-editable stripe_price_id input.
    const editInput = await screen.findByLabelText(/edit stripe price id/i);
    fireEvent.change(editInput, { target: { value: 'price_updated' } });

    const saveBtn = screen.getByRole('button', { name: /^save$/i });
    fireEvent.click(saveBtn);

    await waitFor(() => {
      const call = mockRpcCalls.find((c) => c.fn === 'grandfathered_price_update');
      expect(call).toBeTruthy();
      expect(call!.args.p_id).toBe('price-edit-target');
      expect(call!.args.p_stripe_price_id).toBe('price_updated');
    });
  });

  it('T4: delete-with-confirm calls grandfathered_price_delete with p_id', async () => {
    mockPrices = [mkPrice({ id: 'price-to-delete' })];
    const { GrandfatheredPricesPage } = await import('./GrandfatheredPricesPage');
    render(<GrandfatheredPricesPage />);

    await waitFor(() => expect(screen.getByText('price_abc123')).toBeTruthy());

    const delBtn = await screen.findByRole('button', { name: /^delete$/i });
    fireEvent.click(delBtn);

    await waitFor(() => {
      const call = mockRpcCalls.find((c) => c.fn === 'grandfathered_price_delete');
      expect(call).toBeTruthy();
      expect(call!.args.p_id).toBe('price-to-delete');
    });
  });

  it('T5: RPC error → error banner rendered with error.message', async () => {
    mockPrices = [mkPrice({ id: 'price-err' })];
    mockRpcError = { message: 'permission denied for grandfathered_prices' };
    const { GrandfatheredPricesPage } = await import('./GrandfatheredPricesPage');
    render(<GrandfatheredPricesPage />);

    await waitFor(() => expect(screen.getByText('price_abc123')).toBeTruthy());

    const delBtn = await screen.findByRole('button', { name: /^delete$/i });
    fireEvent.click(delBtn);

    await waitFor(() => {
      expect(screen.getByText(/permission denied for grandfathered_prices/i)).toBeTruthy();
    });
    // Row still rendered — error path must NOT clear loaded rows.
    expect(screen.getByText('price_abc123')).toBeTruthy();
  });
});
