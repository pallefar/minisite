/**
 * Phase 61 Plan 61-05 — ProtocolEditorPage unit tests.
 *
 * 5 behavior assertions:
 *  T1 — Author view: ProtocolReviewBanner shows pending copy; Publish Protocol ABSENT from DOM
 *  T2 — Reviewer view: Publish Protocol button present
 *  T3 — SELF_REVIEW_REJECTED RPC error → toast with correct copy
 *  T4 — Step removal triggers undo Toast (not a modal)
 *  T5 — Editing a published protocol creates a new version INSERT
 */

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Protocol, ProtocolStep } from '@/types/protocols';
import { ProtocolEditorPage } from '../ProtocolEditorPage';

// ─── Hoisted state (accessible inside vi.mock factory closures) ────────────────
// vi.hoisted() runs BEFORE module evaluation and BEFORE vi.mock() hoisting.

const { _state, mockShowToast } = vi.hoisted(() => {
  const _state = {
    protocolData: null as Protocol | null,
    stepsData: [] as ProtocolStep[],
    evidenceData: [] as unknown[],
    insertProtocolCalled: false,
    insertProtocolPayload: null as unknown,
    rpcError: null as { message?: string; code?: string } | null,
    userId: 'user-A',
  };
  const mockShowToast = vi.fn();
  return { _state, mockShowToast };
});

// ─── Mock useToast ────────────────────────────────────────────────────────────

vi.mock('@/hooks/useToast', () => ({
  useToast: () => mockShowToast,
}));

// ─── Mock supabase ────────────────────────────────────────────────────────────

vi.mock('@/lib/supabase', () => {
  const rpcFn = vi.fn(async () => ({ error: _state.rpcError }));

  return {
    supabase: {
      from: (table: string) => {
        if (table === 'protocols') {
          return {
            select: () => ({
              eq: () => ({
                order: () => ({
                  limit: () => ({
                    single: () => Promise.resolve({ data: _state.protocolData, error: null }),
                  }),
                }),
              }),
            }),
            update: () => ({
              eq: () => ({
                eq: () => Promise.resolve({ error: null }),
              }),
            }),
            insert: (payload: unknown) => {
              _state.insertProtocolCalled = true;
              _state.insertProtocolPayload = payload;
              return Promise.resolve({ error: null });
            },
          };
        }
        if (table === 'protocol_steps') {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  order: () => ({
                    then: (resolve: (val: unknown) => unknown) =>
                      Promise.resolve({ data: _state.stepsData, error: null }).then(resolve),
                  }),
                }),
              }),
            }),
            delete: () => ({
              eq: () => Promise.resolve({ error: null }),
            }),
            insert: () => Promise.resolve({ error: null }),
          };
        }
        if (table === 'protocol_evidence') {
          return {
            select: () => ({
              eq: () => ({
                then: (resolve: (val: unknown) => unknown) =>
                  Promise.resolve({ data: _state.evidenceData, error: null }).then(resolve),
              }),
            }),
          };
        }
        return {
          select: () => ({
            eq: () => ({
              then: (resolve: (val: unknown) => unknown) =>
                Promise.resolve({ data: [], error: null }).then(resolve),
            }),
          }),
        };
      },
      rpc: rpcFn,
    },
  };
});

// ─── Mock store ───────────────────────────────────────────────────────────────

vi.mock('@/lib/store', () => ({
  useStore: (selector: (s: unknown) => unknown) =>
    selector({
      signedIn: { user: { id: _state.userId } },
      toast: null,
      showToast: mockShowToast,
      dismissToast: vi.fn(),
    }),
}));

// ─── Mock CitationPopover (avoid complex rendering) ────────────────────────────

vi.mock('@/components/dashboard/ai/CitationPopover', () => ({
  CitationPopover: () => null,
}));

// ─── Mock AiAssistModal (avoid complex rendering in editor tests) ─────────────

vi.mock('../AiAssistModal', () => ({
  AiAssistModal: () => null,
}));

// ─── Mock EvidenceSearchSheet (avoid complex rendering in editor tests) ────────

vi.mock('../EvidenceSearchSheet', () => ({
  EvidenceSearchSheet: () => null,
}));

// ─── Helpers ─────────────────────────────────────────────────────────────────

function setPathnameProtocol(id: string) {
  Object.defineProperty(window, 'location', {
    value: { pathname: `/admin/protocols/${id}` },
    writable: true,
    configurable: true,
  });
}

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makeProtocol(overrides: Partial<Protocol> = {}): Protocol {
  return {
    id: 'proto-test-1',
    version: 1,
    name: 'Test Tirzepatide Protocol',
    compound: 'tirzepatide',
    audience: ['B2C'],
    base_slug: 'test-tirzepatide',
    slug: 'test-tirzepatide-v1',
    review_state: 'in_review',
    created_by: 'user-A',
    reviewed_by: null,
    published_at: null,
    reviewed_at: null,
    created_at: '2026-05-26T00:00:00Z',
    updated_at: '2026-05-26T00:00:00Z',
    ...overrides,
  };
}

function makeStep(week: number): ProtocolStep {
  return {
    id: `step-${week}`,
    protocol_id: 'proto-test-1',
    protocol_version: 1,
    week,
    dose_mg: week * 2.5,
    frequency: 'weekly',
    cron_string: null,
    monitoring: [],
  };
}


describe('ProtocolEditorPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _state.protocolData = null;
    _state.stepsData = [];
    _state.evidenceData = [];
    _state.rpcError = null;
    _state.insertProtocolCalled = false;
    _state.insertProtocolPayload = null;
    _state.userId = 'user-A';
    setPathnameProtocol('proto-test-1');
  });

  it('T1 — author view: banner shows pending copy; Publish Protocol ABSENT from DOM', async () => {
    _state.userId = 'user-A';
    _state.protocolData = makeProtocol({ created_by: 'user-A', review_state: 'in_review' });
    _state.stepsData = [];

    render(<ProtocolEditorPage />);

    await waitFor(() => {
      expect(screen.getByText('Pending review by another admin')).toBeTruthy();
    });

    // Critical PROTOCOL-04 check: button must NOT be in DOM at all
    expect(screen.queryByText('Publish Protocol')).toBeNull();
  });

  it('T2 — reviewer view: Publish Protocol button present', async () => {
    _state.userId = 'user-B'; // Different from created_by
    _state.protocolData = makeProtocol({ created_by: 'user-A', review_state: 'in_review' });
    _state.stepsData = [];

    render(<ProtocolEditorPage />);

    await waitFor(() => {
      expect(screen.getByText('Publish Protocol')).toBeTruthy();
    });

    // Reviewer sees banner with reviewer copy (not pending copy)
    expect(screen.queryByText('Pending review by another admin')).toBeNull();
  });

  it('T3 — SELF_REVIEW_REJECTED RPC error → toast with correct copy', async () => {
    _state.userId = 'user-B';
    _state.protocolData = makeProtocol({ created_by: 'user-A', review_state: 'in_review' });
    _state.stepsData = [];
    _state.rpcError = {
      code: '42501',
      message: 'SELF_REVIEW_REJECTED: publisher cannot equal creator',
    };

    render(<ProtocolEditorPage />);

    await waitFor(() => {
      expect(screen.getByText('Publish Protocol')).toBeTruthy();
    });

    fireEvent.click(screen.getByText('Publish Protocol'));

    await waitFor(() => {
      expect(mockShowToast).toHaveBeenCalledWith(
        'Another admin must review this protocol before publish.',
        'error',
      );
    });
  });

  it('T4 — step removal triggers undo Toast (not a confirm modal)', async () => {
    _state.userId = 'user-A';
    _state.protocolData = makeProtocol({ review_state: 'draft' });
    _state.stepsData = [makeStep(1), makeStep(2), makeStep(3)];

    render(<ProtocolEditorPage />);

    await waitFor(() => {
      // Step 2 remove button should be present
      expect(screen.getByLabelText('Remove step 2')).toBeTruthy();
    });

    fireEvent.click(screen.getByLabelText('Remove step 2'));

    await waitFor(() => {
      // Toast shows undo copy
      expect(mockShowToast).toHaveBeenCalledWith(
        expect.stringContaining('Week 2 removed'),
        'info',
      );
    });

    // No confirm modal appeared (undo via toast, not modal)
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('T5 — editing a published protocol creates a NEW version INSERT', async () => {
    _state.userId = 'user-A';
    _state.protocolData = makeProtocol({
      review_state: 'published',
      version: 1,
    });
    _state.stepsData = [makeStep(1), makeStep(2)];

    render(<ProtocolEditorPage />);

    await waitFor(() => {
      expect(screen.getByLabelText('Protocol name')).toBeTruthy();
    });

    // Click "Save draft" — triggers handleSaveDraft for a published protocol
    fireEvent.click(screen.getByText('Save draft'));

    await waitFor(() => {
      // supabase.from('protocols').insert called with version: 2, review_state: 'draft'
      expect(_state.insertProtocolCalled).toBe(true);
      const payload = _state.insertProtocolPayload as Record<string, unknown>;
      expect(payload.version).toBe(2);
      expect(payload.review_state).toBe('draft');
    });
  });
});
