/**
 * Phase 42 Plan 42-10 Task 1 — QuarterlyNPSModal + eligibility unit tests.
 *
 * Coverage (per plan behaviors):
 *   Eligibility T1: signed-in 95d ago + responded this quarter → eligible=false.
 *   Eligibility T2: signed-in 30d ago + no response + nonce >30d → eligible=true.
 *   Eligibility T3: signed-in 30d ago + no response + nonce <30d → eligible=false.
 *   Eligibility T4: signed-in 100d ago → eligible=false.
 *   Modal T1: renders 5 star buttons + open-text textarea + Submit + Skip.
 *   Modal T2: click star N → submit POSTs { score: N*2, comment, nonce, responded_via:'in-app' }.
 *   Modal T3: Skip POSTs { score: null, responded_via:'in-app', nonce, skipped:true }.
 *
 * The eligibility tests mock `supabase.rpc` and treat the RPC contract
 * (returns { eligible, nonce, quarter } jsonb) as a typed boundary. The
 * DB-side logic is asserted by the cron + RLS integration suite shipped in
 * 42-07; here we only assert the client wrapper correctly typecasts and
 * defaults.
 */
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isUserEligibleForQuarterlyNPS } from '@/lib/nps/quarterly-eligibility';
import { QuarterlyNPSModal } from './QuarterlyNPSModal';

// ---------------------------------------------------------------------------
// Supabase mock — only `rpc` is exercised by the eligibility wrapper. The
// modal itself uses raw `fetch`, mocked separately per test.
// ---------------------------------------------------------------------------
const mockRpc = vi.fn();

vi.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: (...args: unknown[]) => mockRpc(...args),
  },
}));

// Analytics capture is fail-soft inside the modal; mock to silence + assert.
const mockCapture = vi.fn();
vi.mock('@/lib/analytics/capture', () => ({
  capture: (...args: unknown[]) => mockCapture(...args),
}));

describe('isUserEligibleForQuarterlyNPS — Plan 42-10 Task 1', () => {
  beforeEach(() => {
    mockRpc.mockReset();
  });

  it('T1: signed-in 95d ago + already responded → eligible=false', async () => {
    // The RPC encapsulates the DB logic. We assert the client wrapper
    // returns the RPC's eligible=false faithfully.
    mockRpc.mockResolvedValueOnce({
      data: { eligible: false, nonce: null, quarter: '2026-Q2' },
      error: null,
    });
    const result = await isUserEligibleForQuarterlyNPS();
    expect(result.eligible).toBe(false);
    expect(result.nonce).toBeNull();
    expect(result.quarter).toBe('2026-Q2');
    expect(mockRpc).toHaveBeenCalledWith('is_user_eligible_for_quarterly_nps');
  });

  it('T2: signed-in 30d ago + no response + nonce >30d → eligible=true + nonce', async () => {
    mockRpc.mockResolvedValueOnce({
      data: { eligible: true, nonce: 'nonce-abc', quarter: '2026-Q2' },
      error: null,
    });
    const result = await isUserEligibleForQuarterlyNPS();
    expect(result.eligible).toBe(true);
    expect(result.nonce).toBe('nonce-abc');
    expect(result.quarter).toBe('2026-Q2');
  });

  it('T3: signed-in 30d ago + no response + nonce <30d → eligible=false (email window open)', async () => {
    mockRpc.mockResolvedValueOnce({
      data: { eligible: false, nonce: null, quarter: '2026-Q2' },
      error: null,
    });
    const result = await isUserEligibleForQuarterlyNPS();
    expect(result.eligible).toBe(false);
    expect(result.nonce).toBeNull();
  });

  it('T4: signed-in 100d ago → eligible=false (inactive per D-23)', async () => {
    mockRpc.mockResolvedValueOnce({
      data: { eligible: false, nonce: null, quarter: '2026-Q2' },
      error: null,
    });
    const result = await isUserEligibleForQuarterlyNPS();
    expect(result.eligible).toBe(false);
  });

  it('T5: RPC error → eligible=false (fail-soft)', async () => {
    mockRpc.mockResolvedValueOnce({ data: null, error: { message: 'rpc failed' } });
    const result = await isUserEligibleForQuarterlyNPS();
    expect(result.eligible).toBe(false);
    expect(result.nonce).toBeNull();
  });

  it('T6: RPC throws → eligible=false (network outage fail-soft)', async () => {
    mockRpc.mockRejectedValueOnce(new Error('network'));
    const result = await isUserEligibleForQuarterlyNPS();
    expect(result.eligible).toBe(false);
  });
});

describe('<QuarterlyNPSModal /> — Plan 42-10 Task 1', () => {
  beforeEach(() => {
    mockCapture.mockReset();
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('Modal T1: renders 5 star buttons + textarea + Submit + Skip', () => {
    const onClose = vi.fn();
    render(
      <QuarterlyNPSModal
        open
        onClose={onClose}
        nonce="n-1"
        quarter="2026-Q2"
        endpointUrl="https://test.local/fn"
      />,
    );
    // 5 stars with aria-label "Rate N star(s)".
    for (let i = 1; i <= 5; i++) {
      expect(
        screen.getByRole('button', { name: `Rate ${i} star${i === 1 ? '' : 's'}` }),
      ).toBeInTheDocument();
    }
    // Open-text textarea.
    expect(screen.getByPlaceholderText(/Optional/i)).toBeInTheDocument();
    // Noun-qualified CTAs.
    expect(screen.getByRole('button', { name: /Submit feedback/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Skip this quarter/i })).toBeInTheDocument();
  });

  it('Modal T2: click star 4 → submit POSTs { score: 8, comment, nonce, responded_via:in-app, skipped:false }', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
    const onClose = vi.fn();
    render(
      <QuarterlyNPSModal
        open
        onClose={onClose}
        nonce="n-42"
        quarter="2026-Q3"
        endpointUrl="https://test.local/fn"
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Rate 4 stars' }));
    const textarea = screen.getByPlaceholderText(/Optional/i);
    await user.type(textarea, 'Great app');
    await user.click(screen.getByRole('button', { name: /Submit feedback/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [calledUrl, calledOpts] = fetchMock.mock.calls[0];
    expect(calledUrl).toBe('https://test.local/fn');
    expect(calledOpts.method).toBe('POST');
    const body = JSON.parse(calledOpts.body as string);
    expect(body.score).toBe(8); // 4 stars * 2 → 8 on 0-10 scale.
    expect(body.comment).toBe('Great app');
    expect(body.nonce).toBe('n-42');
    expect(body.quarter).toBe('2026-Q3');
    expect(body.responded_via).toBe('in-app');
    expect(body.skipped).toBe(false);

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(mockCapture).toHaveBeenCalledWith('nps_quarterly_responded', {
      score: 8,
      responded_via: 'in-app',
    });
  });

  it('Modal T3: Skip → POSTs { score: null, responded_via:in-app, nonce, skipped:true }', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
    const onClose = vi.fn();
    render(
      <QuarterlyNPSModal
        open
        onClose={onClose}
        nonce="n-skip"
        quarter="2026-Q3"
        endpointUrl="https://test.local/fn"
      />,
    );

    await user.click(screen.getByRole('button', { name: /Skip this quarter/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [, calledOpts] = fetchMock.mock.calls[0];
    const body = JSON.parse(calledOpts.body as string);
    expect(body.score).toBeNull();
    expect(body.responded_via).toBe('in-app');
    expect(body.nonce).toBe('n-skip');
    expect(body.skipped).toBe(true);
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('Modal T4: submit fails (non-ok response) → error banner + modal stays open', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 500 });
    vi.stubGlobal('fetch', fetchMock);
    const onClose = vi.fn();
    render(
      <QuarterlyNPSModal
        open
        onClose={onClose}
        nonce="n-fail"
        quarter="2026-Q3"
        endpointUrl="https://test.local/fn"
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Rate 5 stars' }));
    await user.click(screen.getByRole('button', { name: /Submit feedback/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('Modal T5: Submit disabled until a star is selected', () => {
    const onClose = vi.fn();
    render(
      <QuarterlyNPSModal
        open
        onClose={onClose}
        nonce="n-1"
        quarter="2026-Q2"
        endpointUrl="https://test.local/fn"
      />,
    );
    const submit = screen.getByRole('button', { name: /Submit feedback/i });
    expect(submit).toBeDisabled();
  });
});
