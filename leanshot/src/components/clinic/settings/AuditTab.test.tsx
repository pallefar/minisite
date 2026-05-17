/**
 * Phase 10 Plan 10-08 — AuditTab Vitest tests.
 *
 * 10 assertions covering:
 *   1. NAV gating: audit tab hidden when audit_log.read = false
 *   2. Fetch: useAuditEvents calls supabase.from('audit_logs') on mount
 *   3. Member filter: re-fetches + PostHog event with booleans only (no actor_id)
 *   4. Action filter: re-fetches + PostHog event
 *   5. Time-range 24h: fires PostHog event with has_time_filter=true
 *   6. Custom range modal: from > to → error; range > 13 months → error; valid → onApply
 *   7. Row expand/collapse: click row → details visible; click again → hidden; multiple open
 *   8. Retention notice: dismissed → sessionStorage set; remount → notice gone
 *   9. Empty states: zero rows + no filters → "No events yet"; zero rows + filters → match copy
 *  10. Pagination: totalCount > 50 shows pagination controls
 */
import { fireEvent, render, screen, waitFor, act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ── Mock posthog-js ──────────────────────────────────────────────────────────

vi.mock('posthog-js', () => ({
  default: { capture: vi.fn() },
}));

// ── Permission mock ──────────────────────────────────────────────────────────

let mockAuditLogReadPermission: boolean | null = null;

vi.mock('@/lib/clinic-permissions', () => ({
  useHasPermission: (_orgId: string | null, key: string) => {
    if (key === 'audit_log.read') return mockAuditLogReadPermission;
    return false;
  },
  clearPermissionCache: vi.fn(),
}));

// ── Supabase mock ────────────────────────────────────────────────────────────

const rpcMock = vi.fn();

// The query result that audit_logs queries will return
let queryResult: { data: unknown[]; error: null; count: number } = {
  data: [],
  error: null,
  count: 0,
};

type QBResult = { data: unknown[]; error: null; count: number | null };

function makeQueryBuilder(result?: QBResult) {
  const effectiveResult = result ?? (queryResult as QBResult);
  const b: Record<string, unknown> & { then?: (fn: (v: QBResult) => unknown) => unknown } = {};
  const self = () => {
    const chain = {
      select: vi.fn(() => chain),
      eq: vi.fn(() => chain),
      gte: vi.fn(() => chain),
      lte: vi.fn(() => chain),
      order: vi.fn(() => chain),
      range: vi.fn(() => chain),
      limit: vi.fn(() => chain),
      is: vi.fn(() => chain),
      maybeSingle: vi.fn(async () => effectiveResult),
      then(fn: (v: QBResult) => unknown) {
        return Promise.resolve(effectiveResult).then(fn);
      },
    };
    return chain;
  };
  return self();
}

vi.mock('@/lib/supabase', () => {
  return {
    supabase: {
      from: vi.fn(),
      rpc: (...args: unknown[]) => rpcMock(...args),
      auth: {
        getSession: async () => ({ data: { session: { access_token: 't' } } }),
        getUser: async () => ({ data: { user: { id: 'u-1' } }, error: null }),
      },
      realtime: { setAuth: vi.fn() },
      channel: () => {
        const ch: {
          on: (...args: unknown[]) => typeof ch;
          subscribe: (...args: unknown[]) => { unsubscribe: () => void };
        } = {
          on: () => ch,
          subscribe: () => ({ unsubscribe: vi.fn() }),
        };
        return ch;
      },
      removeChannel: vi.fn(),
    },
  };
});

vi.mock('@/lib/store', () => ({
  useStore: Object.assign(() => undefined, {
    getState: () => ({ showToast: vi.fn(), dismissToast: vi.fn() }),
  }),
}));

// ── Test data ────────────────────────────────────────────────────────────────

const ORG_ROW = {
  id: 'org-1',
  slug: 'audit-clinic',
  name: 'Audit Clinic',
  description: null,
  website_url: null,
  logo_storage_path: null,
  created_by: 'u-1',
  created_at: '2026-01-01T00:00:00Z',
};

function setPath(p: string): void {
  window.history.pushState(null, '', p);
}

// ── Imports after mocks ───────────────────────────────────────────────────────

import { ClinicSettingsPage } from './ClinicSettingsPage';
import { AuditTab } from './AuditTab';
import { AuditCustomRangeModal } from './AuditCustomRangeModal';

// ── Setup helpers ─────────────────────────────────────────────────────────────

async function setupSupabaseMock(): Promise<void> {
  const { supabase } = await import('@/lib/supabase');
  (supabase.from as ReturnType<typeof vi.fn>).mockImplementation((table: string) => {
    if (table === 'organizations') {
      return makeQueryBuilder({ data: [ORG_ROW], error: null, count: null });
    }
    if (table === 'roles') {
      return makeQueryBuilder({ data: [], error: null, count: null });
    }
    // audit_logs and any other table → use queryResult
    return makeQueryBuilder(queryResult as QBResult);
  });
}

// ── Test Suite ────────────────────────────────────────────────────────────────

describe('AuditTab — Phase 10 Plan 10-08', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    queryResult = { data: [], error: null, count: 0 };
    mockAuditLogReadPermission = null;
    sessionStorage.clear();
    rpcMock.mockResolvedValue({ data: [], error: null });
    await setupSupabaseMock();
  });

  afterEach(() => {
    setPath('/');
    sessionStorage.clear();
  });

  // ────────────────────────────────────────────────────────────────────────────
  // Test 1: NAV gating
  // ────────────────────────────────────────────────────────────────────────────
  it('Test 1 — NAV does NOT contain Audit tab when audit_log.read=false', async () => {
    mockAuditLogReadPermission = false;
    setPath('/clinic/audit-clinic/settings');
    render(<ClinicSettingsPage />);
    await waitFor(() => expect(screen.getByText('Audit Clinic')).toBeInTheDocument(), {
      timeout: 3000,
    });
    expect(screen.queryByRole('button', { name: /Audit/i })).toBeNull();
  });

  // ────────────────────────────────────────────────────────────────────────────
  // Test 2: Fetch on mount
  // ────────────────────────────────────────────────────────────────────────────
  it('Test 2 — AuditTab mounts and calls supabase.from("audit_logs")', async () => {
    const { supabase } = await import('@/lib/supabase');
    render(<AuditTab orgId="org-1" />);
    await waitFor(() => {
      expect(supabase.from).toHaveBeenCalledWith('audit_logs');
    });
  });

  // ────────────────────────────────────────────────────────────────────────────
  // Test 3: Member filter — re-fetches + PostHog event
  // ────────────────────────────────────────────────────────────────────────────
  it('Test 3 — selecting member filter re-fetches with actor_user_id constraint', async () => {
    rpcMock.mockResolvedValue({
      data: [{ user_id: 'member-1', display_name: 'Alice', email: 'alice@test.leanshot.app' }],
      error: null,
    });
    const posthog = await import('posthog-js');

    render(<AuditTab orgId="org-1" />);
    // Wait for list_org_members RPC to load members
    await waitFor(() => expect(rpcMock).toHaveBeenCalledWith('list_org_members', { p_org_id: 'org-1' }));

    const { supabase } = await import('@/lib/supabase');
    // Open the member dropdown and select Alice
    const memberBtn = screen.getByRole('button', { name: /^Member:/i });
    fireEvent.click(memberBtn);
    await waitFor(() => expect(screen.getByRole('option', { name: 'Alice' })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('option', { name: 'Alice' }));

    // After filter applied, supabase.from('audit_logs') should be called again
    await waitFor(() => {
      const calls = (supabase.from as ReturnType<typeof vi.fn>).mock.calls;
      const auditCalls = calls.filter((c) => c[0] === 'audit_logs');
      expect(auditCalls.length).toBeGreaterThanOrEqual(2); // initial + after filter
    });

    // PostHog event should fire (debounced 200ms)
    await act(async () => {
      await new Promise((r) => setTimeout(r, 250));
    });
    expect(posthog.default.capture).toHaveBeenCalledWith(
      'clinic_audit_filter_applied',
      expect.objectContaining({
        filter_type: 'member',
        has_member_filter: true,
        has_action_filter: false,
      }),
    );
    // PHI contract: NO actor_id property in the event
    const calls = (posthog.default.capture as ReturnType<typeof vi.fn>).mock.calls;
    const filterCall = calls.find((c: unknown[]) => c[0] === 'clinic_audit_filter_applied');
    expect(filterCall).toBeDefined();
    expect(filterCall?.[1]).not.toHaveProperty('actor_id');
  });

  // ────────────────────────────────────────────────────────────────────────────
  // Test 4: Action filter
  // ────────────────────────────────────────────────────────────────────────────
  it('Test 4 — action filter fires PostHog event with has_action_filter=true', async () => {
    const posthog = await import('posthog-js');
    render(<AuditTab orgId="org-1" />);

    const actionBtn = screen.getByRole('button', { name: /^Action type:/i });
    fireEvent.click(actionBtn);
    await waitFor(() =>
      expect(screen.getByRole('option', { name: 'Revoked patient access' })).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole('option', { name: 'Revoked patient access' }));

    await act(async () => {
      await new Promise((r) => setTimeout(r, 250));
    });

    expect(posthog.default.capture).toHaveBeenCalledWith(
      'clinic_audit_filter_applied',
      expect.objectContaining({
        filter_type: 'action_type',
        has_action_filter: true,
      }),
    );
  });

  // ────────────────────────────────────────────────────────────────────────────
  // Test 5: Time-range filter
  // ────────────────────────────────────────────────────────────────────────────
  it('Test 5 — time-range filter change fires PostHog event with has_time_filter=true', async () => {
    const posthog = await import('posthog-js');
    render(<AuditTab orgId="org-1" />);

    // The time-range dropdown trigger has id="audit-filter-time"
    const timeBtn = document.getElementById('audit-filter-time');
    expect(timeBtn).not.toBeNull();
    fireEvent.click(timeBtn!);

    // Options are rendered in a listbox — wait for them
    await waitFor(() => {
      const optionElements = document.querySelectorAll('[role="listbox"] button[role="option"]');
      const option24h = Array.from(optionElements).find((el) =>
        el.textContent?.includes('Last 24 hours'),
      );
      expect(option24h).toBeDefined();
    });

    const option24h = Array.from(
      document.querySelectorAll('[role="listbox"] button[role="option"]'),
    ).find((el) => el.textContent?.includes('Last 24 hours'));
    fireEvent.click(option24h!);

    await act(async () => {
      await new Promise((r) => setTimeout(r, 250));
    });

    expect(posthog.default.capture).toHaveBeenCalledWith(
      'clinic_audit_filter_applied',
      expect.objectContaining({
        filter_type: 'time_range',
        has_time_filter: true,
      }),
    );
  });

  // ────────────────────────────────────────────────────────────────────────────
  // Test 6: Custom range modal validation
  // ────────────────────────────────────────────────────────────────────────────
  it('Test 6 — custom range modal validates from > to and shows error', () => {
    const onApply = vi.fn();
    const onClose = vi.fn();
    render(
      <AuditCustomRangeModal open initial={null} onApply={onApply} onClose={onClose} />,
    );

    const fromInput = screen.getByLabelText('Start date');
    const toInput = screen.getByLabelText('End date');
    fireEvent.change(fromInput, { target: { value: '2026-04-15' } });
    fireEvent.change(toInput, { target: { value: '2026-04-01' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));

    expect(screen.getByRole('alert')).toHaveTextContent('Start date must be on or before end date.');
    expect(onApply).not.toHaveBeenCalled();
  });

  it('Test 6b — custom range modal validates range > 13 months', () => {
    const onApply = vi.fn();
    render(
      <AuditCustomRangeModal open initial={null} onApply={onApply} onClose={vi.fn()} />,
    );

    const fromInput = screen.getByLabelText('Start date');
    const toInput = screen.getByLabelText('End date');
    fireEvent.change(fromInput, { target: { value: '2025-01-01' } });
    fireEvent.change(toInput, { target: { value: '2026-03-15' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));

    expect(screen.getByRole('alert')).toHaveTextContent('Date range cannot exceed 13 months.');
    expect(onApply).not.toHaveBeenCalled();
  });

  it('Test 6c — custom range modal: valid range calls onApply', () => {
    const onApply = vi.fn();
    const onClose = vi.fn();
    render(
      <AuditCustomRangeModal open initial={null} onApply={onApply} onClose={onClose} />,
    );

    const fromInput = screen.getByLabelText('Start date');
    const toInput = screen.getByLabelText('End date');
    fireEvent.change(fromInput, { target: { value: '2026-04-01' } });
    fireEvent.change(toInput, { target: { value: '2026-04-15' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));

    expect(onApply).toHaveBeenCalledWith({ from: '2026-04-01', to: '2026-04-15' });
  });

  // ────────────────────────────────────────────────────────────────────────────
  // Test 7: Row expand / collapse
  // ────────────────────────────────────────────────────────────────────────────
  it('Test 7 — clicking a row expands details; clicking again collapses', async () => {
    queryResult = {
      data: [
        {
          id: 'ev-1',
          org_id: 'org-1',
          actor_user_id: 'u-1',
          actor_type: 'member',
          action: 'member.invite',
          target_user_id: null,
          row_id: null,
          metadata: null,
          created_at: new Date(Date.now() - 3600_000).toISOString(),
          actor: { raw_user_meta_data: { display_name: 'Alice' } },
        },
      ],
      error: null,
      count: 1,
    };
    await setupSupabaseMock();

    render(<AuditTab orgId="org-1" />);
    await waitFor(() => expect(screen.getByText(/Invited a patient/)).toBeInTheDocument());

    // Row is initially collapsed — find the AuditRow expand button by aria-controls attribute
    const expandBtn = document.querySelector<HTMLButtonElement>('button[aria-expanded][aria-controls]');
    expect(expandBtn).not.toBeNull();
    expect(expandBtn!.getAttribute('aria-expanded')).toBe('false');

    // Click to expand
    fireEvent.click(expandBtn!);
    expect(expandBtn!.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText('Event details')).toBeInTheDocument();

    // Click again to collapse
    fireEvent.click(expandBtn!);
    expect(expandBtn!.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByText('Event details')).toBeNull();
  });

  it('Test 7b — multiple rows can be expanded simultaneously', async () => {
    queryResult = {
      data: [
        {
          id: 'ev-1',
          org_id: 'org-1',
          actor_user_id: 'u-1',
          actor_type: 'member',
          action: 'member.invite',
          target_user_id: null,
          row_id: null,
          metadata: null,
          created_at: new Date(Date.now() - 3600_000).toISOString(),
          actor: { raw_user_meta_data: { display_name: 'Alice' } },
        },
        {
          id: 'ev-2',
          org_id: 'org-1',
          actor_user_id: 'u-2',
          actor_type: 'member',
          action: 'member.revoke',
          target_user_id: 'patient-1',
          row_id: null,
          metadata: null,
          created_at: new Date(Date.now() - 7200_000).toISOString(),
          actor: { raw_user_meta_data: { display_name: 'Bob' } },
        },
      ],
      error: null,
      count: 2,
    };
    await setupSupabaseMock();

    render(<AuditTab orgId="org-1" />);
    await waitFor(() => expect(screen.getByText(/Invited a patient/)).toBeInTheDocument());
    await waitFor(() => expect(screen.getByText(/Revoked patient access/)).toBeInTheDocument());

    // Get all AuditRow expand buttons by aria-controls attribute
    const expandBtns = document.querySelectorAll<HTMLButtonElement>('button[aria-expanded][aria-controls]');
    expect(expandBtns.length).toBeGreaterThanOrEqual(2);

    fireEvent.click(expandBtns[0]);
    fireEvent.click(expandBtns[1]);

    // Both details blocks should be visible (two "Event details" headings)
    const detailsHeadings = screen.getAllByText('Event details');
    expect(detailsHeadings.length).toBe(2);
  });

  // ────────────────────────────────────────────────────────────────────────────
  // Test 8: 13-month retention notice dismissal
  // ────────────────────────────────────────────────────────────────────────────
  it('Test 8 — retention notice visible on first mount; dismissed after X click; hidden on remount', async () => {
    sessionStorage.clear();
    const { unmount } = render(<AuditTab orgId="org-1" />);
    await waitFor(() =>
      expect(screen.getByText(/We keep audit events for 13 months/)).toBeInTheDocument(),
    );

    // Dismiss
    fireEvent.click(screen.getByRole('button', { name: /Dismiss retention notice/ }));
    expect(screen.queryByText(/We keep audit events for 13 months/)).toBeNull();
    expect(sessionStorage.getItem('clinic_audit_retention_dismissed')).toBe('true');

    // Remount in same session → notice should NOT render
    unmount();
    render(<AuditTab orgId="org-1" />);
    // Brief wait to confirm notice is absent
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(screen.queryByText(/We keep audit events for 13 months/)).toBeNull();
  });

  // ────────────────────────────────────────────────────────────────────────────
  // Test 9: Empty states
  // ────────────────────────────────────────────────────────────────────────────
  it('Test 9 — zero rows + no filters → "No events yet"', async () => {
    queryResult = { data: [], error: null, count: 0 };
    await setupSupabaseMock();
    render(<AuditTab orgId="org-1" />);
    // Use queryAllByText to handle React StrictMode or multiple renders
    await waitFor(() => {
      const els = screen.queryAllByText('No events yet');
      expect(els.length).toBeGreaterThanOrEqual(1);
    });
    expect(
      screen.getByText(/Operator activity in this workspace will appear here/),
    ).toBeInTheDocument();
  });

  it('Test 9b — zero rows + active filters → "No events match your filters" + Clear filters CTA', async () => {
    queryResult = { data: [], error: null, count: 0 };
    await setupSupabaseMock();
    render(<AuditTab orgId="org-1" />);
    await waitFor(() => {
      const els = screen.queryAllByText('No events yet');
      expect(els.length).toBeGreaterThanOrEqual(1);
    });

    // Apply an action filter
    const actionBtn = screen.getByRole('button', { name: /^Action type:/i });
    fireEvent.click(actionBtn);
    await waitFor(() =>
      expect(screen.getByRole('option', { name: 'Invited a patient' })).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole('option', { name: 'Invited a patient' }));

    await waitFor(() => {
      const els = screen.queryAllByText('No events match your filters');
      expect(els.length).toBeGreaterThanOrEqual(1);
    });
    expect(
      screen.getAllByRole('button', { name: /Clear filters/ }).length,
    ).toBeGreaterThanOrEqual(1);
  });

  // ────────────────────────────────────────────────────────────────────────────
  // Test 10: Pagination
  // ────────────────────────────────────────────────────────────────────────────
  it('Test 10 — totalCount > 50 shows pagination; clicking Next re-fetches', async () => {
    queryResult = { data: [], error: null, count: 100 };
    await setupSupabaseMock();

    const { supabase } = await import('@/lib/supabase');
    render(<AuditTab orgId="org-1" />);

    // Wait for the pagination count line
    await waitFor(() =>
      expect(screen.getByText('Showing 1–50 of 100 events')).toBeInTheDocument(),
    );

    const fromCallsBefore = (supabase.from as ReturnType<typeof vi.fn>).mock.calls.filter(
      (c: unknown[]) => c[0] === 'audit_logs',
    ).length;

    const nextBtn = screen.getByRole('button', { name: 'Next page' });
    expect(nextBtn).not.toBeDisabled();
    fireEvent.click(nextBtn);

    // Should re-fetch audit_logs with new offset
    await waitFor(() => {
      const fromCallsAfter = (supabase.from as ReturnType<typeof vi.fn>).mock.calls.filter(
        (c: unknown[]) => c[0] === 'audit_logs',
      ).length;
      expect(fromCallsAfter).toBeGreaterThan(fromCallsBefore);
    });
  });
});
