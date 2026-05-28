/**
 * Phase 37 Plan 37-07 Task 2 — TicketDetailPage tests (HELP-04, D-05, D-08).
 *
 * Behavior gates:
 *   T1 — fires logPhiAccess once on mount when ticket.phi === true
 *   T2 — does NOT call logPhiAccess on re-mount with same ticket+agent (dedupe via useRef)
 *   T3 — does NOT call logPhiAccess when ticket.phi === false
 *   T4 — clicking "Insert draft into composer" populates the textarea (does NOT send)
 *   T5 — clicking "Send reply" calls the helpdesk-agent-reply-send Edge Fn (explicit click only)
 *   T6 — onMount does NOT auto-send draft (D-08 verbatim)
 */

import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ─── Mock supabase ────────────────────────────────────────────────────────────

interface TicketRow {
  id: string;
  org_id: string;
  user_id: string;
  subject: string;
  status: string;
  phi: boolean;
}
interface MessageRow {
  id: string;
  ticket_id: string;
  author_kind: string;
  body: string;
  created_at: string;
}
interface SuggestionRow {
  ticket_id: string;
  suggested_tags: unknown;
  suggested_route_user_id: string | null;
  suggested_route_confidence: number | null;
  draft_reply: string;
  sentiment_score: number | null;
  created_at: string;
}

const mockTicket: TicketRow = {
  id: 'tk-phi-1',
  org_id: 'org-1',
  user_id: 'patient-1',
  subject: 'Side-effect',
  status: 'open',
  phi: true,
};
let ticketRow: TicketRow = { ...mockTicket };
let messages: MessageRow[] = [];
let suggestion: SuggestionRow | null = null;

const insertCalls: Array<{ table: string; row: Record<string, unknown> }> = [];
const updateCalls: Array<{ table: string; patch: Record<string, unknown> }> = [];
const invokeCalls: Array<{ fn: string; body: Record<string, unknown> }> = [];
const rpcCalls: Array<{ fn: string; args: Record<string, unknown> }> = [];

function maybeSingleBuilder(row: unknown): Record<string, unknown> {
  const b: Record<string, unknown> = {
    select: vi.fn(function (this: unknown) {
      return this;
    }),
    eq: vi.fn(function (this: unknown) {
      return this;
    }),
    order: vi.fn(function (this: unknown) {
      return this;
    }),
    limit: vi.fn(function (this: unknown) {
      return this;
    }),
    maybeSingle: vi.fn(() => Promise.resolve({ data: row, error: null })),
    single: vi.fn(() => Promise.resolve({ data: row, error: null })),
    then: (resolve: (v: { data: unknown; error: null }) => void) => {
      resolve({ data: row, error: null });
      return Promise.resolve({ data: row, error: null });
    },
  };
  return b;
}

function listBuilder(rows: unknown[]): Record<string, unknown> {
  const b: Record<string, unknown> = {
    select: vi.fn(function (this: unknown) {
      return this;
    }),
    eq: vi.fn(function (this: unknown) {
      return this;
    }),
    order: vi.fn(function (this: unknown) {
      return this;
    }),
    limit: vi.fn(function (this: unknown) {
      return this;
    }),
    then: (resolve: (v: { data: unknown[]; error: null }) => void) => {
      resolve({ data: rows, error: null });
      return Promise.resolve({ data: rows, error: null });
    },
  };
  return b;
}

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      if (table === 'tickets') {
        return {
          ...maybeSingleBuilder(ticketRow),
          update: (patch: Record<string, unknown>) => {
            updateCalls.push({ table, patch });
            return {
              eq: vi.fn(() => Promise.resolve({ error: null })),
            };
          },
        };
      }
      if (table === 'ticket_messages') {
        return {
          ...listBuilder(messages),
          insert: (row: Record<string, unknown>) => {
            insertCalls.push({ table, row });
            const inserted: MessageRow = {
              id: 'msg-new-1',
              ticket_id: ticketRow.id,
              author_kind: (row.author_kind as string) ?? 'agent',
              body: (row.body as string) ?? '',
              created_at: new Date().toISOString(),
            };
            return {
              select: () => ({
                single: () => Promise.resolve({ data: inserted, error: null }),
              }),
            };
          },
        };
      }
      if (table === 'ticket_ai_suggestions') {
        return maybeSingleBuilder(suggestion);
      }
      return listBuilder([]);
    },
    rpc: vi.fn((fn: string, args: Record<string, unknown>) => {
      rpcCalls.push({ fn, args });
      return Promise.resolve({ data: null, error: null });
    }),
    auth: {
      getUser: () =>
        Promise.resolve({
          data: { user: { id: 'agent-1' } },
          error: null,
        }),
    },
    functions: {
      invoke: vi.fn((fn: string, payload: { body: Record<string, unknown> }) => {
        invokeCalls.push({ fn, body: payload.body });
        return Promise.resolve({ data: { ok: true }, error: null });
      }),
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

// Track logPhiAccess invocations.
const logPhiAccessSpy = vi.fn();
vi.mock('@/lib/hipaa/phi-access-rpc', () => ({
  logPhiAccess: (args: unknown) => {
    logPhiAccessSpy(args);
    return Promise.resolve();
  },
}));

describe('TicketDetailPage', () => {
  beforeEach(() => {
    ticketRow = { ...mockTicket };
    messages = [];
    suggestion = null;
    insertCalls.length = 0;
    updateCalls.length = 0;
    invokeCalls.length = 0;
    rpcCalls.length = 0;
    logPhiAccessSpy.mockClear();
    vi.clearAllMocks();
  });

  it('T1: fires logPhiAccess once when ticket.phi === true', async () => {
    ticketRow = { ...mockTicket, phi: true };
    const { default: TicketDetailPage } = await import('./TicketDetailPage');
    render(<TicketDetailPage ticketId="tk-phi-1" onClose={() => {}} />);
    await waitFor(() => {
      expect(logPhiAccessSpy).toHaveBeenCalledTimes(1);
      const call = logPhiAccessSpy.mock.calls[0][0] as {
        accessedUserId: string;
        reason: string;
      };
      expect(call.accessedUserId).toBe('patient-1');
      expect(call.reason).toMatch(/agent.*inbox/i);
    });
  });

  it('T2: does NOT call logPhiAccess on re-mount with same ticket+agent (dedupe)', async () => {
    ticketRow = { ...mockTicket, phi: true };
    const { default: TicketDetailPage } = await import('./TicketDetailPage');
    const { rerender } = render(<TicketDetailPage ticketId="tk-phi-1" onClose={() => {}} />);
    await waitFor(() => expect(logPhiAccessSpy).toHaveBeenCalledTimes(1));
    // Re-render same instance — should NOT fire again.
    rerender(<TicketDetailPage ticketId="tk-phi-1" onClose={() => {}} />);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
    expect(logPhiAccessSpy).toHaveBeenCalledTimes(1);
  });

  it('T3: does NOT call logPhiAccess when ticket.phi === false', async () => {
    ticketRow = { ...mockTicket, phi: false };
    const { default: TicketDetailPage } = await import('./TicketDetailPage');
    render(<TicketDetailPage ticketId="tk-phi-1" onClose={() => {}} />);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 30));
    });
    expect(logPhiAccessSpy).not.toHaveBeenCalled();
  });

  it('T4: Insert draft button populates composer textarea (no auto-send)', async () => {
    ticketRow = { ...mockTicket, phi: false };
    suggestion = {
      ticket_id: 'tk-phi-1',
      suggested_tags: [{ tag: 'billing', confidence: 0.9 }],
      suggested_route_user_id: null,
      suggested_route_confidence: null,
      draft_reply: 'Hello — sorry to hear that.',
      sentiment_score: -0.1,
      created_at: new Date().toISOString(),
    };
    const { default: TicketDetailPage } = await import('./TicketDetailPage');
    render(<TicketDetailPage ticketId="tk-phi-1" onClose={() => {}} />);
    const insertBtn = await screen.findByRole('button', { name: /insert draft/i });
    fireEvent.click(insertBtn);
    const ta = (await screen.findByRole('textbox', { name: /reply/i })) as HTMLTextAreaElement;
    expect(ta.value).toBe('Hello — sorry to hear that.');
    // Crucial — no invoke fired by inserting the draft.
    expect(invokeCalls.length).toBe(0);
    expect(insertCalls.length).toBe(0);
  });

  it('T5: Send button explicitly invokes the Edge Fn (and inserts message row)', async () => {
    ticketRow = { ...mockTicket, phi: false };
    const { default: TicketDetailPage } = await import('./TicketDetailPage');
    render(<TicketDetailPage ticketId="tk-phi-1" onClose={() => {}} />);
    const ta = (await screen.findByRole('textbox', { name: /reply/i })) as HTMLTextAreaElement;
    fireEvent.change(ta, { target: { value: 'manual reply' } });
    fireEvent.click(screen.getByRole('button', { name: /send reply/i }));
    await waitFor(() => {
      expect(insertCalls.length).toBe(1);
      expect(invokeCalls.length).toBe(1);
      expect(invokeCalls[0].fn).toBe('helpdesk-agent-reply-send');
      expect(invokeCalls[0].body.ticket_id).toBe('tk-phi-1');
    });
  });

  it('T6: onMount does NOT auto-send draft (D-08)', async () => {
    ticketRow = { ...mockTicket, phi: false };
    suggestion = {
      ticket_id: 'tk-phi-1',
      suggested_tags: [],
      suggested_route_user_id: null,
      suggested_route_confidence: null,
      draft_reply: 'Auto-draft content',
      sentiment_score: 0.1,
      created_at: new Date().toISOString(),
    };
    const { default: TicketDetailPage } = await import('./TicketDetailPage');
    render(<TicketDetailPage ticketId="tk-phi-1" onClose={() => {}} />);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 30));
    });
    // No insert + no invoke fired on mount, even though a draft exists.
    expect(insertCalls.length).toBe(0);
    expect(invokeCalls.length).toBe(0);
  });
});
