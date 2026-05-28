/**
 * Phase 37 Plan 37-08 Task 3 — SLATargetsPage tests (HELP-12).
 *
 * Behavior gates:
 *   T1 — renders 3 rows (p1, p2, p3) with first_response and resolution inputs
 *   T2 — Save calls upsert on sla_targets
 *   T3 — alert_recipients chip input: Enter adds an email
 *   T4 — invalid email blocked
 *   T5 — non-admin role disables Save button
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

interface MockTarget {
  id: string;
  org_id: string;
  tier: 'p1' | 'p2' | 'p3';
  first_response_minutes: number;
  resolution_minutes: number;
  alert_recipients: string[];
}

let mockTargets: MockTarget[] = [];
let mockRole = 'support_admin';
const opCalls: Array<{ op: string; payload: unknown; table: string }> = [];

function makeBuilder(table: string): Record<string, unknown> {
  const builder: Record<string, unknown> = {
    _table: table,
    _filters: [] as Array<[string, unknown]>,
    select: vi.fn(function (this: unknown) {
      return this;
    }),
    upsert: vi.fn(function (this: { _table: string }, rows: unknown, options: unknown) {
      opCalls.push({
        op: 'upsert',
        payload: { rows, options },
        table: this._table,
      });
      return Promise.resolve({ data: null, error: null });
    }),
    eq: vi.fn(function (this: { _filters: Array<[string, unknown]> }, col: string, val: unknown) {
      this._filters.push([col, val]);
      return this;
    }),
    order: vi.fn(function (this: unknown) {
      return this;
    }),
    limit: vi.fn(function (this: unknown) {
      return this;
    }),
    single: vi.fn(function (this: { _table: string }) {
      if (this._table === 'org_members') {
        return Promise.resolve({
          data: { role: mockRole, org_id: 'org-1', user_id: 'user-1' },
          error: null,
        });
      }
      return Promise.resolve({ data: null, error: null });
    }),
    then: function (
      this: { _table: string },
      resolve: (v: { data: unknown[]; error: null }) => void,
    ) {
      if (this._table === 'sla_targets') {
        resolve({ data: mockTargets, error: null });
        return Promise.resolve({ data: mockTargets, error: null });
      }
      resolve({ data: [], error: null });
      return Promise.resolve({ data: [], error: null });
    },
  };
  return builder;
}

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: (table: string) => makeBuilder(table),
    rpc: vi.fn(() => Promise.resolve({ data: null, error: null })),
    auth: {
      getUser: () => Promise.resolve({ data: { user: { id: 'user-1' } }, error: null }),
    },
  },
}));

describe('SLATargetsPage', () => {
  beforeEach(() => {
    mockTargets = [
      {
        id: 't-1',
        org_id: 'org-1',
        tier: 'p1',
        first_response_minutes: 15,
        resolution_minutes: 240,
        alert_recipients: ['oncall@example.com'],
      },
      {
        id: 't-2',
        org_id: 'org-1',
        tier: 'p2',
        first_response_minutes: 60,
        resolution_minutes: 480,
        alert_recipients: [],
      },
      {
        id: 't-3',
        org_id: 'org-1',
        tier: 'p3',
        first_response_minutes: 240,
        resolution_minutes: 1440,
        alert_recipients: [],
      },
    ];
    mockRole = 'support_admin';
    opCalls.length = 0;
    vi.clearAllMocks();
  });

  it('T1: renders 3 tier rows', async () => {
    const { default: SLATargetsPage } = await import('./SLATargetsPage');
    render(<SLATargetsPage />);
    await waitFor(() => {
      expect(screen.getByText(/^p1$/i)).toBeTruthy();
      expect(screen.getByText(/^p2$/i)).toBeTruthy();
      expect(screen.getByText(/^p3$/i)).toBeTruthy();
    });
  });

  it('T2: Save calls upsert with edited fields', async () => {
    const { default: SLATargetsPage } = await import('./SLATargetsPage');
    render(<SLATargetsPage />);
    await waitFor(() => screen.getByLabelText(/p1 first response minutes/i));
    fireEvent.change(screen.getByLabelText(/p1 first response minutes/i), {
      target: { value: '20' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^save all$/i }));
    await waitFor(() => {
      const up = opCalls.find((c) => c.op === 'upsert');
      expect(up).toBeTruthy();
      // Rows include p1 with first_response_minutes=20
      const payload = up?.payload as { rows: unknown[]; options: unknown };
      const rows = payload.rows as Array<Record<string, unknown>>;
      const p1Row = rows.find((r) => r.tier === 'p1');
      expect(p1Row?.first_response_minutes).toBe(20);
    });
  });

  it('T3: chip input adds email on Enter', async () => {
    const { default: SLATargetsPage } = await import('./SLATargetsPage');
    render(<SLATargetsPage />);
    await waitFor(() => screen.getByLabelText(/p2 add recipient/i));
    const input = screen.getByLabelText(/p2 add recipient/i);
    fireEvent.change(input, { target: { value: 'new@example.com' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => {
      expect(screen.getByText('new@example.com')).toBeTruthy();
    });
  });

  it('T4: invalid email is not added', async () => {
    const { default: SLATargetsPage } = await import('./SLATargetsPage');
    render(<SLATargetsPage />);
    await waitFor(() => screen.getByLabelText(/p2 add recipient/i));
    const input = screen.getByLabelText(/p2 add recipient/i);
    fireEvent.change(input, { target: { value: 'not-an-email' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    // Either not added OR an error is surfaced. Just assert chip absent.
    expect(screen.queryByText('not-an-email')).toBeNull();
  });

  it('T5: non-admin role disables Save button', async () => {
    mockRole = 'support_agent';
    const { default: SLATargetsPage } = await import('./SLATargetsPage');
    render(<SLATargetsPage />);
    await waitFor(() => screen.getByRole('button', { name: /^save all$/i }));
    const btn = screen.getByRole('button', {
      name: /^save all$/i,
    }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });
});
