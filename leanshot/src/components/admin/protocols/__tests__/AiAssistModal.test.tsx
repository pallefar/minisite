/**
 * Phase 61 Plan 61-05 — AiAssistModal unit tests.
 *
 * 4 behavior assertions:
 *  T1 — success path: modal renders dose + monitoring; click Apply calls onApply
 *  T2 — refusal path: renders 'Suggestion blocked' warning + 'Go to RAG queue →' link
 *  T3 — rate-limit 429 path: toast shown, modal closes
 *  T4 — loading state: Skeleton present, Apply button has aria-busy=true
 */

import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AiAssistModal } from '../AiAssistModal';

// ─── Mock supabase ────────────────────────────────────────────────────────────

let mockInvokeData: unknown = null;
let mockInvokeError: unknown = null;
let mockInvokeDelay = 0;

vi.mock('@/lib/supabase', () => ({
  supabase: {
    functions: {
      invoke: vi.fn(async () => {
        if (mockInvokeDelay > 0) {
          await new Promise((r) => setTimeout(r, mockInvokeDelay));
        }
        return { data: mockInvokeData, error: mockInvokeError };
      }),
    },
  },
}));

// ─── Mock useToast hook directly ─────────────────────────────────────────────

const mockShowToast = vi.fn();

vi.mock('@/hooks/useToast', () => ({
  useToast: () => mockShowToast,
}));

// Also mock store (used by other parts)
vi.mock('@/lib/store', () => ({
  useStore: (selector: (s: unknown) => unknown) =>
    selector({
      signedIn: null,
      toast: null,
      showToast: mockShowToast,
      dismissToast: vi.fn(),
    }),
  // getState needed by useToast's setTimeout branch
  useStore_DEPRECATED: undefined,
}));


// ─── Fixtures ─────────────────────────────────────────────────────────────────

const DEFAULT_PROPS = {
  open: true,
  onClose: vi.fn(),
  protocolId: 'proto-1',
  stepWeek: 3,
  compound: 'tirzepatide',
  priorStepsContext: 'Week 1: 2.5mg, Week 2: 5mg',
  onApply: vi.fn(),
};

const SUCCESS_RESPONSE = {
  dose_mg: 7.5,
  monitoring: ['weight', 'glucose'] as const,
  cited_chunk_ids: ['chunk-1', 'chunk-2'],
  refusal: false,
};

const REFUSAL_RESPONSE = {
  dose_mg: 0,
  monitoring: [],
  cited_chunk_ids: [],
  refusal: true,
  refusal_reason: 'No qualifying RAG evidence found for this compound.',
};

describe('AiAssistModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInvokeData = null;
    mockInvokeError = null;
    mockInvokeDelay = 0;
    DEFAULT_PROPS.onClose = vi.fn();
    DEFAULT_PROPS.onApply = vi.fn();
  });

  it('T1 — success path: dose + monitoring rendered; Apply calls onApply', async () => {
    mockInvokeData = SUCCESS_RESPONSE;

    render(<AiAssistModal {...DEFAULT_PROPS} />);

    await waitFor(() => {
      expect(screen.getByText('7.5 mg')).toBeTruthy();
      expect(screen.getByText('weight')).toBeTruthy();
      expect(screen.getByText('glucose')).toBeTruthy();
    });

    // Apply button should be present and enabled
    const applyBtn = screen.getByRole('button', { name: /Apply AI suggestion for week 3/i });
    expect(applyBtn).toBeTruthy();

    fireEvent.click(applyBtn);

    await waitFor(() => {
      expect(DEFAULT_PROPS.onApply).toHaveBeenCalledWith({
        dose_mg: 7.5,
        monitoring: ['weight', 'glucose'],
      });
    });
  });

  it('T2 — refusal path: Suggestion blocked warning + Go to RAG queue link', async () => {
    mockInvokeData = REFUSAL_RESPONSE;

    render(<AiAssistModal {...DEFAULT_PROPS} />);

    await waitFor(() => {
      expect(screen.getByText('Suggestion blocked')).toBeTruthy();
      const ragLink = screen.getByRole('link', { name: /Go to RAG queue/i });
      expect(ragLink).toBeTruthy();
      expect((ragLink as HTMLAnchorElement).href).toContain('/admin/rag');
    });

    // No Apply button in refusal state
    expect(screen.queryByRole('button', { name: /Apply AI suggestion/i })).toBeNull();
  });

  it('T3 — rate-limit 429: toast shown with correct copy, modal closes', async () => {
    mockInvokeData = { error: 'rate_limit_exceeded' };

    render(<AiAssistModal {...DEFAULT_PROPS} />);

    await waitFor(() => {
      expect(mockShowToast).toHaveBeenCalledWith(
        expect.stringContaining('AI assist limit reached for today'),
        'error',
      );
      expect(DEFAULT_PROPS.onClose).toHaveBeenCalledOnce();
    });
  });

  it('T4 — loading state: Skeleton present, Apply button has aria-busy=true', async () => {
    // Delay invoke so we can observe loading state
    mockInvokeDelay = 500;
    mockInvokeData = SUCCESS_RESPONSE;

    render(<AiAssistModal {...DEFAULT_PROPS} />);

    // Should immediately be in loading state
    const outputArea = document.querySelector('[aria-live="polite"]');
    expect(outputArea?.getAttribute('aria-busy')).toBe('true');

    // Apply button should be aria-busy while loading
    const applyBtn = screen.getByRole('button', { name: /Apply AI suggestion/i });
    expect(applyBtn.getAttribute('aria-busy')).toBe('true');

    // Skeleton should be rendered (Skeleton component uses skeleton-shimmer class)
    await waitFor(() => {
      const skeletons = document.querySelectorAll('.skeleton-shimmer');
      expect(skeletons.length).toBeGreaterThan(0);
    }, { timeout: 100 });
  });
});
