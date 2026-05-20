/**
 * Phase 38 Plan 38-08 — HitlQueuePage RTL tests (RECOMMEND-07).
 *
 * Eight behavior gates from the plan:
 *  T1 — renders pending count + filter pills {All, recommender, digest, win_back} (D-12).
 *  T2 — empty pending list shown when supabase returns [] (non-super-admin path is
 *       enforced by RLS at runtime, but the page renders the same empty surface).
 *  T3 — clicking Approve on a digest row calls supabase.rpc('hitl_decide', {…approved})
 *       AND supabase.functions.invoke('weekly-digest', { body: { hitl_release_row_id } }).
 *  T4 — Reject calls hitl_decide with decision='rejected'; no functions.invoke for digest.
 *  T5 — Edit flow opens modal with editable narrative; saving calls hitl_decide with
 *       decision='edited' + edited_payload (the modified narrative bundle).
 *  T6 — auto_approved_kb rows render as audit-only — no Approve / Reject / Edit buttons.
 *  T7 — Bulk-approve N selected rows calls hitl_decide ONCE with all selected IDs.
 *  T8 — Stale badge appears on rows with created_at older than 7 days AND status='pending'.
 *
 * Pattern follows AuditLogModule.test.tsx — chainable supabase mock + dynamic
 * import of the module after vi.doMock to ensure the mock applies.
 */

import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ─── Chainable supabase mock ──────────────────────────────────────────────────

interface MockRow {
  id: string;
  type: 'recommender' | 'digest' | 'win_back';
  user_id: string | null;
  org_id: string | null;
  payload: Record<string, unknown>;
  source_type: string | null;
  action_id: string | null;
  status: 'pending' | 'approved' | 'rejected' | 'edited' | 'auto_approved_kb';
  decided_by: string | null;
  decided_at: string | null;
  decision_note: string | null;
  created_at: string;
}

function makePendingDigestRow(overrides: Partial<MockRow> = {}): MockRow {
  return {
    id: 'row-digest-1',
    type: 'digest',
    user_id: 'user-1',
    org_id: null,
    payload: {
      narrative:
        'You had a steady week — three injections logged, weight trending down by 0.4 kg.',
      actions: [
        { id: 'log_weight', reason: 'Keep your daily weight trend going.' },
        { id: 'read_kb', reason: 'Learn about plateau strategies.' },
      ],
    },
    source_type: 'digest_narrative',
    action_id: 'log_weight',
    status: 'pending',
    decided_by: null,
    decided_at: null,
    decision_note: null,
    created_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    ...overrides,
  };
}

function makeAutoApprovedKbRow(): MockRow {
  return makePendingDigestRow({
    id: 'row-kb-audit-1',
    type: 'recommender',
    status: 'auto_approved_kb',
    source_type: 'kb_article',
    action_id: 'read_kb',
    payload: {
      title: 'Plateau strategies',
      url: 'https://app.leanshot.app/kb/plateau-strategies',
    },
  });
}

function makeStaleRow(): MockRow {
  return makePendingDigestRow({
    id: 'row-stale-1',
    created_at: new Date(Date.now() - 9 * 24 * 60 * 60 * 1000).toISOString(),
  });
}

let mockRows: MockRow[] = [];
let mockRpcCalls: Array<{ fn: string; args: Record<string, unknown> }> = [];
let mockInvokeCalls: Array<{ fn: string; body: Record<string, unknown> }> = [];

function makeChainableBuilder(rows: MockRow[]) {
  const builder: Record<string, unknown> = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    then: (resolve: (v: { data: MockRow[]; error: null }) => void) => {
      resolve({ data: rows, error: null });
      return Promise.resolve({ data: rows, error: null });
    },
  };
  return builder;
}

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: (_table: string) => makeChainableBuilder(mockRows),
    rpc: vi.fn((fn: string, args: Record<string, unknown>) => {
      mockRpcCalls.push({ fn, args });
      // Simulate hitl_decide returning the updated rows.
      const ids = (args.row_ids as string[]) ?? [];
      const data = ids.map((id) => ({ id, status: args.decision as string }));
      return Promise.resolve({ data, error: null });
    }),
    functions: {
      invoke: vi.fn((fn: string, payload: { body: Record<string, unknown> }) => {
        mockInvokeCalls.push({ fn, body: payload.body });
        return Promise.resolve({ data: { status: 'sent' }, error: null });
      }),
    },
  },
}));

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('HitlQueuePage', () => {
  beforeEach(() => {
    mockRows = [];
    mockRpcCalls = [];
    mockInvokeCalls = [];
    vi.clearAllMocks();
  });

  it('T1: renders filter pills {All, recommender, digest, win_back} + pending count', async () => {
    mockRows = [makePendingDigestRow(), makePendingDigestRow({ id: 'row-digest-2' })];
    const { default: HitlQueuePage } = await import('./HitlQueuePage');
    render(<HitlQueuePage />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /^All/i })).toBeTruthy();
    });
    expect(screen.getByRole('button', { name: /recommender/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /digest/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /win_back/i })).toBeTruthy();
    // pending count surfaces somewhere on the page
    expect(screen.getByText(/2 pending/i)).toBeTruthy();
  });

  it('T2: empty queue renders empty-state copy', async () => {
    mockRows = [];
    const { default: HitlQueuePage } = await import('./HitlQueuePage');
    render(<HitlQueuePage />);
    await waitFor(() => {
      expect(screen.getByText(/no pending items|queue is empty|nothing to review/i)).toBeTruthy();
    });
  });

  it('T3: Approve on a digest row calls hitl_decide + functions.invoke weekly-digest', async () => {
    mockRows = [makePendingDigestRow()];
    const { default: HitlQueuePage } = await import('./HitlQueuePage');
    render(<HitlQueuePage />);

    await waitFor(() => expect(screen.getByText(/digest/i)).toBeTruthy());

    const approveBtn = await screen.findByRole('button', { name: /^Approve$/i });
    fireEvent.click(approveBtn);

    await waitFor(() => {
      expect(mockRpcCalls.some((c) => c.fn === 'hitl_decide' && c.args.decision === 'approved')).toBe(true);
    });
    expect(
      mockInvokeCalls.some(
        (c) => c.fn === 'weekly-digest' && c.body.hitl_release_row_id === 'row-digest-1',
      ),
    ).toBe(true);
  });

  it('T4: Reject calls hitl_decide with decision=rejected and does NOT invoke weekly-digest', async () => {
    mockRows = [makePendingDigestRow()];
    const { default: HitlQueuePage } = await import('./HitlQueuePage');
    render(<HitlQueuePage />);

    await waitFor(() => expect(screen.getByText(/digest/i)).toBeTruthy());

    const rejectBtn = await screen.findByRole('button', { name: /^Reject$/i });
    fireEvent.click(rejectBtn);

    await waitFor(() => {
      expect(
        mockRpcCalls.some((c) => c.fn === 'hitl_decide' && c.args.decision === 'rejected'),
      ).toBe(true);
    });
    expect(mockInvokeCalls.length).toBe(0);
  });

  it('T5: Edit opens modal with narrative; save calls hitl_decide with decision=edited + edited_payload', async () => {
    mockRows = [makePendingDigestRow()];
    const { default: HitlQueuePage } = await import('./HitlQueuePage');
    render(<HitlQueuePage />);

    await waitFor(() => expect(screen.getByText(/digest/i)).toBeTruthy());

    const editBtn = await screen.findByRole('button', { name: /^Edit$/i });
    fireEvent.click(editBtn);

    // Modal opens with a textarea preloaded with the narrative.
    const textarea = await screen.findByRole('textbox', { name: /narrative/i });
    expect((textarea as HTMLTextAreaElement).value).toMatch(/steady week/i);
    fireEvent.change(textarea, { target: { value: 'A revised narrative for QA.' } });

    const saveBtn = within(textarea.closest('[role="dialog"]') as HTMLElement).getByRole(
      'button',
      { name: /save|approve/i },
    );
    fireEvent.click(saveBtn);

    await waitFor(() => {
      const edited = mockRpcCalls.find(
        (c) => c.fn === 'hitl_decide' && c.args.decision === 'edited',
      );
      expect(edited).toBeTruthy();
      const payload = edited!.args.edited_payload as { narrative: string };
      expect(payload.narrative).toBe('A revised narrative for QA.');
    });
  });

  it('T6: auto_approved_kb rows render as audit-only (no Approve / Reject / Edit buttons)', async () => {
    mockRows = [makeAutoApprovedKbRow()];
    const { default: HitlQueuePage } = await import('./HitlQueuePage');
    render(<HitlQueuePage />);

    await waitFor(() => expect(screen.getByText(/Plateau strategies|kb_article/i)).toBeTruthy());

    expect(screen.queryByRole('button', { name: /^Approve$/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Reject$/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Edit$/i })).toBeNull();
    // Audit badge present
    expect(screen.getByText(/auto-approved|KB audit/i)).toBeTruthy();
  });

  it('T7: Bulk-approve N selected rows issues a single hitl_decide call with all IDs', async () => {
    mockRows = [
      makePendingDigestRow({ id: 'row-1' }),
      makePendingDigestRow({ id: 'row-2' }),
      makePendingDigestRow({ id: 'row-3' }),
    ];
    const { default: HitlQueuePage } = await import('./HitlQueuePage');
    render(<HitlQueuePage />);

    await waitFor(() => expect(screen.getAllByRole('checkbox').length).toBeGreaterThan(2));

    // Select all three row checkboxes (skip the header "select all" if present;
    // it's safe to click it too — selecting everything still yields one call).
    const checkboxes = screen.getAllByRole('checkbox');
    for (const cb of checkboxes) {
      if (!(cb as HTMLInputElement).checked) fireEvent.click(cb);
    }

    const bulkBtn = await screen.findByRole('button', { name: /Approve Selected/i });
    fireEvent.click(bulkBtn);

    await waitFor(() => {
      const bulk = mockRpcCalls.find(
        (c) => c.fn === 'hitl_decide' && c.args.decision === 'approved',
      );
      expect(bulk).toBeTruthy();
      const ids = bulk!.args.row_ids as string[];
      expect(ids.sort()).toEqual(['row-1', 'row-2', 'row-3']);
    });
    // One bulk approved RPC call (not three).
    expect(
      mockRpcCalls.filter(
        (c) => c.fn === 'hitl_decide' && c.args.decision === 'approved',
      ).length,
    ).toBe(1);
  });

  it('T8: rows older than 7 days with status=pending get a "stale" badge', async () => {
    mockRows = [makeStaleRow()];
    const { default: HitlQueuePage } = await import('./HitlQueuePage');
    render(<HitlQueuePage />);

    await waitFor(() => {
      expect(screen.getByText(/stale/i)).toBeTruthy();
    });
  });
});
