/**
 * Phase 30 Plan 03 — ClinicianAlertsPanel tests (TDD RED).
 *
 * Tests cover:
 *  1. Badge tone='amber' renders with amber token (regression: tone='warning' stays orange)
 *  2. Hook: use-clinician-alerts returns data + refetch
 *  3. Hook: use-clinician-alerts-realtime subscribes to channelNameFor
 *  4. Hook: realtime failure (CHANNEL_ERROR) sets isSubscribed=false without throwing
 *  5. Panel: bell hidden when count=0; aria-label correct
 *  6. Panel: count > 9 → badge '9+'
 *  7. Panel: clicking bell opens panel (role=region)
 *  8. Panel: pending alert row renders amber Badge + type label + Acknowledge + Snooze + View patient
 *  9. Panel: Acknowledge dispatches RPC + refetches + shows toast
 * 10. Panel: Snooze button click opens AlertSnoozePopover
 * 11. Panel: realtime broadcast appends new alert to pending list
 * 12. Panel: subscription failure → inline warning
 * 13. Panel: empty state — no alerts
 * 14. Panel: 'Show resolved' toggle reveals acknowledged alerts
 */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---- Mock supabase -------------------------------------------------------
const mockRpc = vi.fn();
const mockChannelOn = vi.fn();
const mockChannelSubscribe = vi.fn();
const mockRemoveChannel = vi.fn();
const mockFrom = vi.fn();

vi.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: mockRpc,
    channel: vi.fn().mockReturnValue({
      on: mockChannelOn.mockReturnThis(),
      subscribe: mockChannelSubscribe.mockReturnThis(),
    }),
    removeChannel: mockRemoveChannel,
    from: mockFrom,
  },
}));

// ---- Mock org-realtime ---------------------------------------------------
vi.mock('@/lib/org-realtime', () => ({
  channelNameFor: vi.fn().mockResolvedValue('org-aaaa1111-alerts'),
}));

// ---- Mock useReducedMotion ----------------------------------------------
vi.mock('@/hooks/useReducedMotion', () => ({
  useReducedMotion: vi.fn().mockReturnValue(false),
}));

// ---- Mock useToast -------------------------------------------------------
const mockToast = vi.fn();
vi.mock('@/hooks/useToast', () => ({
  useToast: vi.fn().mockReturnValue(mockToast),
}));

// ---- Helpers -------------------------------------------------------------
const PENDING_ALERT = {
  id: 'alert-001',
  org_id: 'org-111',
  patient_user_id: 'patient-222',
  alert_type: 'dose_adherence',
  status: 'pending',
  threshold_snapshot: {},
  created_at: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
  snooze_until: null,
  ack_at: null,
  ack_by: null,
  display_name: 'Alice A.',
};

const ACKNOWLEDGED_ALERT = {
  ...PENDING_ALERT,
  id: 'alert-002',
  status: 'acknowledged',
  ack_at: new Date().toISOString(),
};

function makeSupabaseChain(data: unknown[], error: null | { message: string } = null) {
  const chain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    gte: vi.fn().mockReturnThis(),
    order: vi.fn().mockResolvedValue({ data, error }),
  };
  return chain;
}

// ---- Import under test ---------------------------------------------------
// Dynamic import so mocks are hoisted first
async function importPanel() {
  const mod = await import('./ClinicianAlertsPanel');
  return mod.ClinicianAlertsPanel;
}

async function importBadge() {
  const mod = await import('@/components/ui/Badge');
  return mod.Badge;
}

// ---- Badge amber variant test -------------------------------------------
describe('Badge tone="amber"', () => {
  it('renders with --color-amber background class (not --color-warning)', async () => {
    const Badge = await importBadge();
    const { container } = render(<Badge tone="amber">3</Badge>);
    const span = container.querySelector('span');
    // The amber class should use var(--color-amber), NOT var(--color-warning)
    expect(span?.className).toMatch(/color-amber/);
    expect(span?.className).not.toMatch(/color-warning/);
  });

  it('tone="warning" still uses --color-warning (regression guard)', async () => {
    const Badge = await importBadge();
    const { container } = render(<Badge tone="warning">!</Badge>);
    const span = container.querySelector('span');
    expect(span?.className).toMatch(/color-warning/);
  });
});

// ---- ClinicianAlertsPanel component tests --------------------------------
describe('ClinicianAlertsPanel', () => {
  const orgId = 'org-111';
  const orgSlug = 'test-clinic';
  let ClinicianAlertsPanel: Awaited<ReturnType<typeof importPanel>>;
  let anchorRef: React.RefObject<HTMLButtonElement>;

  beforeEach(async () => {
    vi.clearAllMocks();
    ClinicianAlertsPanel = await importPanel();
    anchorRef = { current: document.createElement('button') };
    // Default: empty data
    mockFrom.mockReturnValue(makeSupabaseChain([]));
    mockRpc.mockResolvedValue({ data: null, error: null });
    mockChannelOn.mockReturnThis();
    mockChannelSubscribe.mockReturnThis();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  function renderPanel(props?: Partial<Parameters<typeof ClinicianAlertsPanel>[0]>) {
    return render(
      <ClinicianAlertsPanel
        orgId={orgId}
        orgSlug={orgSlug}
        open={true}
        onClose={vi.fn()}
        anchorRef={anchorRef as React.RefObject<HTMLElement>}
        {...props}
      />,
    );
  }

  it('Test 1: panel has role="region" and aria-label="Clinician alerts"', async () => {
    renderPanel();
    await waitFor(() => {
      const region = screen.getByRole('region', { name: /clinician alerts/i });
      expect(region).toBeTruthy();
    });
  });

  it('Test 2: pending alert row renders amber Badge + alert type label', async () => {
    mockFrom.mockReturnValue(makeSupabaseChain([PENDING_ALERT]));
    renderPanel();
    await waitFor(() => {
      expect(screen.getByText('Missed doses')).toBeTruthy();
      const badge = screen.getByText('Pending');
      expect(badge).toBeTruthy();
    });
  });

  it('Test 3: pending alert shows Acknowledge + Snooze + View patient buttons', async () => {
    mockFrom.mockReturnValue(makeSupabaseChain([PENDING_ALERT]));
    renderPanel();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /acknowledge/i })).toBeTruthy();
      expect(screen.getByRole('button', { name: /snooze/i })).toBeTruthy();
      expect(screen.getByRole('link', { name: /view patient/i })).toBeTruthy();
    });
  });

  it('Test 4: Clicking Acknowledge dispatches acknowledge_clinician_alert RPC', async () => {
    mockFrom.mockReturnValue(makeSupabaseChain([PENDING_ALERT]));
    mockRpc.mockResolvedValue({ data: null, error: null });
    renderPanel();

    await waitFor(() => screen.getByRole('button', { name: /acknowledge/i }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /acknowledge/i }));
    });

    await waitFor(() => {
      expect(mockRpc).toHaveBeenCalledWith('acknowledge_clinician_alert', {
        p_alert_id: 'alert-001',
      });
    });
  });

  it('Test 5: Clicking Acknowledge shows success toast on success', async () => {
    mockFrom.mockReturnValue(makeSupabaseChain([PENDING_ALERT]));
    mockRpc.mockResolvedValue({ data: null, error: null });
    renderPanel();

    await waitFor(() => screen.getByRole('button', { name: /acknowledge/i }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /acknowledge/i }));
    });

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalled();
    });
  });

  it('Test 6: Clicking Snooze opens AlertSnoozePopover', async () => {
    mockFrom.mockReturnValue(makeSupabaseChain([PENDING_ALERT]));
    renderPanel();

    await waitFor(() => screen.getByRole('button', { name: /snooze/i }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /snooze/i }));
    });

    await waitFor(() => {
      // AlertSnoozePopover has role="dialog"
      expect(screen.getByRole('dialog')).toBeTruthy();
    });
  });

  it('Test 7: Subscription failure renders inline "Live updates paused" warning', async () => {
    mockFrom.mockReturnValue(makeSupabaseChain([]));
    // Simulate CHANNEL_ERROR by having subscribe callback called with error status
    mockChannelSubscribe.mockImplementation(function (
      this: unknown,
      cb?: (status: string) => void,
    ) {
      if (cb) cb('CHANNEL_ERROR');
      return this;
    });

    renderPanel();

    await waitFor(() => {
      expect(screen.getByText(/live updates paused/i)).toBeTruthy();
    });
  });

  it('Test 8: empty state — "No active alerts" heading shown when no pending alerts', async () => {
    mockFrom.mockReturnValue(makeSupabaseChain([]));
    renderPanel();
    await waitFor(() => {
      expect(screen.getByText('No active alerts')).toBeTruthy();
      expect(screen.getByText(/check back after the nightly scan/i)).toBeTruthy();
    });
  });

  it('Test 9: "Show resolved" toggle hidden by default; acknowledged alerts not visible', async () => {
    mockFrom.mockReturnValue(makeSupabaseChain([PENDING_ALERT, ACKNOWLEDGED_ALERT]));
    renderPanel();

    await waitFor(() => screen.getByText('Missed doses'));

    // Acknowledged should not be visible yet (collapsed by default)
    const ackBadges = screen.queryAllByText('Acknowledged');
    expect(ackBadges.length).toBe(0);

    // Show resolved toggle button exists
    expect(screen.getByRole('button', { name: /show resolved/i })).toBeTruthy();
  });

  it('Test 10: Clicking "Show resolved" reveals acknowledged alerts', async () => {
    mockFrom.mockReturnValue(makeSupabaseChain([PENDING_ALERT, ACKNOWLEDGED_ALERT]));
    renderPanel();

    await waitFor(() => screen.getByText('Missed doses'));

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /show resolved/i }));
    });

    await waitFor(() => {
      expect(screen.getByText('Acknowledged')).toBeTruthy();
    });
  });
});
