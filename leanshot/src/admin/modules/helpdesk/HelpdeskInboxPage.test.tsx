/**
 * Phase 37 Plan 37-07 Task 2 — HelpdeskInboxPage tests.
 *
 * Behavior gates (HELP-04 + HELP-12):
 *   T1 — renders empty-state when supabase returns []
 *   T2 — renders ticket rows with subject + status + priority
 *   T3 — PHI rows surface a "PHI" badge
 *   T4 — toggling a status filter chip narrows the query
 *   T5 — toggling "Sentiment alerts only" filters to sentiment_alert_fired_at IS NOT NULL
 *   T6 — row click opens TicketDetailPage slide-over (asserted via dialog presence)
 *
 * Pattern follows HitlQueuePage.test.tsx — chainable supabase mock + dynamic
 * import after vi.doMock.
 */

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ─── Mock row shape ───────────────────────────────────────────────────────────
interface MockTicket {
  id: string;
  subject: string;
  status: 'open' | 'pending' | 'solved' | 'closed';
  priority: 'p1' | 'p2' | 'p3';
  assigned_to: string | null;
  sentiment_alert_fired_at: string | null;
  last_user_message_at: string | null;
  created_at: string;
  updated_at: string;
  phi: boolean;
}

function mkTicket(overrides: Partial<MockTicket> = {}): MockTicket {
  return {
    id: `tk-${Math.random().toString(36).slice(2, 8)}`,
    subject: 'Sample ticket',
    status: 'open',
    priority: 'p2',
    assigned_to: null,
    sentiment_alert_fired_at: null,
    last_user_message_at: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    phi: false,
    ...overrides,
  };
}

let mockTickets: MockTicket[] = [];
let lastFilterCalls: Array<{ method: string; args: unknown[] }> = [];

function makeBuilder(rows: MockTicket[]): Record<string, unknown> {
  const builder: Record<string, unknown> = {
    select: vi.fn(function (this: unknown) {
      lastFilterCalls.push({ method: 'select', args: [] });
      return this;
    }),
    in: vi.fn(function (this: unknown, ...args: unknown[]) {
      lastFilterCalls.push({ method: 'in', args });
      return this;
    }),
    eq: vi.fn(function (this: unknown, ...args: unknown[]) {
      lastFilterCalls.push({ method: 'eq', args });
      return this;
    }),
    not: vi.fn(function (this: unknown, ...args: unknown[]) {
      lastFilterCalls.push({ method: 'not', args });
      return this;
    }),
    order: vi.fn(function (this: unknown) {
      return this;
    }),
    limit: vi.fn(function (this: unknown) {
      return this;
    }),
    then: (resolve: (v: { data: MockTicket[]; error: null }) => void) => {
      resolve({ data: rows, error: null });
      return Promise.resolve({ data: rows, error: null });
    },
  };
  return builder;
}

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: () => makeBuilder(mockTickets),
    rpc: vi.fn(() => Promise.resolve({ data: null, error: null })),
    auth: {
      getUser: () => Promise.resolve({ data: { user: { id: 'agent-1' } }, error: null }),
    },
    channel: vi.fn(() => ({
      on: vi.fn().mockReturnThis(),
      subscribe: vi.fn(),
      unsubscribe: vi.fn(),
    })),
    removeChannel: vi.fn(),
    realtime: { setAuth: vi.fn() },
  },
}));

// TicketDetailPage is heavyweight (loads thread + AI suggestions + RPCs); mock
// to a minimal dialog so we can assert open-state without firing those queries.
vi.mock('./TicketDetailPage', () => ({
  __esModule: true,
  default: ({ ticketId, onClose }: { ticketId: string; onClose: () => void }) => (
    <div role="dialog" aria-label="ticket-detail">
      ticket-detail-{ticketId}
      <button type="button" onClick={onClose}>
        close-detail
      </button>
    </div>
  ),
}));

describe('HelpdeskInboxPage', () => {
  beforeEach(() => {
    mockTickets = [];
    lastFilterCalls = [];
    vi.clearAllMocks();
  });

  it('T1: renders empty-state when no tickets', async () => {
    mockTickets = [];
    const { default: HelpdeskInboxPage } = await import('./HelpdeskInboxPage');
    render(<HelpdeskInboxPage />);
    await waitFor(() => {
      expect(screen.getByText(/no tickets/i)).toBeTruthy();
    });
  });

  it('T2: renders ticket rows with subject', async () => {
    mockTickets = [
      mkTicket({ id: 'tk-1', subject: 'Glass on injection site' }),
      mkTicket({ id: 'tk-2', subject: 'Refund please' }),
    ];
    const { default: HelpdeskInboxPage } = await import('./HelpdeskInboxPage');
    render(<HelpdeskInboxPage />);
    await waitFor(() => {
      expect(screen.getByText('Glass on injection site')).toBeTruthy();
      expect(screen.getByText('Refund please')).toBeTruthy();
    });
  });

  it('T3: PHI rows show a PHI badge', async () => {
    mockTickets = [mkTicket({ id: 'tk-phi', subject: 'Side-effect Q', phi: true })];
    const { default: HelpdeskInboxPage } = await import('./HelpdeskInboxPage');
    render(<HelpdeskInboxPage />);
    await waitFor(() => {
      expect(screen.getByText('PHI')).toBeTruthy();
    });
  });

  it('T4: toggling status filter chip narrows query', async () => {
    mockTickets = [mkTicket({ id: 'tk-1' })];
    const { default: HelpdeskInboxPage } = await import('./HelpdeskInboxPage');
    render(<HelpdeskInboxPage />);
    await waitFor(() => {
      expect(screen.getByText(/sample ticket/i)).toBeTruthy();
    });
    // Initial load called .in('status', [...]) with default statuses (e.g. open+pending).
    const inCalls = lastFilterCalls.filter((c) => c.method === 'in');
    expect(inCalls.length).toBeGreaterThan(0);
    expect(inCalls[0].args[0]).toBe('status');

    // Toggle "closed" filter chip to add it.
    lastFilterCalls = [];
    fireEvent.click(screen.getByRole('button', { name: /closed/i }));
    await waitFor(() => {
      const inCalls2 = lastFilterCalls.filter((c) => c.method === 'in');
      expect(inCalls2.length).toBeGreaterThan(0);
      expect(Array.isArray(inCalls2[0].args[1])).toBe(true);
      // 'closed' is now in the status list.
      const statuses = inCalls2[0].args[1] as string[];
      expect(statuses).toContain('closed');
    });
  });

  it('T5: sentiment-alerts-only filter adds .not(...) clause', async () => {
    mockTickets = [mkTicket({ id: 'tk-1' })];
    const { default: HelpdeskInboxPage } = await import('./HelpdeskInboxPage');
    render(<HelpdeskInboxPage />);
    await waitFor(() => screen.getByText(/sample ticket/i));
    lastFilterCalls = [];
    fireEvent.click(screen.getByRole('button', { name: /sentiment alerts only/i }));
    await waitFor(() => {
      const notCalls = lastFilterCalls.filter((c) => c.method === 'not');
      expect(notCalls.length).toBeGreaterThan(0);
      expect(notCalls[0].args[0]).toBe('sentiment_alert_fired_at');
    });
  });

  it('T6: clicking a ticket row opens the detail slide-over', async () => {
    mockTickets = [mkTicket({ id: 'tk-open-me', subject: 'open me please' })];
    const { default: HelpdeskInboxPage } = await import('./HelpdeskInboxPage');
    render(<HelpdeskInboxPage />);
    await waitFor(() => screen.getByText('open me please'));
    fireEvent.click(screen.getByRole('button', { name: /open me please/i }));
    await waitFor(() => {
      expect(screen.getByRole('dialog', { name: 'ticket-detail' })).toBeTruthy();
      expect(screen.getByText('ticket-detail-tk-open-me')).toBeTruthy();
    });
  });
});
