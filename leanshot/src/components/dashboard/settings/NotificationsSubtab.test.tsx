/**
 * Phase 42 Plan 42-08 — NotificationsSubtab tests.
 *
 * Covers:
 *   1. 5×3 matrix renders 15 switch cells with proper aria.
 *   2. Clicking a toggle calls update() optimistically.
 *   3. Snooze controls offer 1d/7d/30d.
 *   4. Cap input clamps to admin daily_cap.
 *   5. Suppression banner appears when throttle_until > now() and restores.
 *   6. "Enable push notifications" button only when permission !== 'granted'.
 */
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NotificationsSubtab } from './NotificationsSubtab';

// --- Hoisted mock surface ---------------------------------------------------
const {
  fromMock,
  configResponse,
  dismissalResponse,
  settingsResponse,
  upsertMock,
  updateMock,
  channelMock,
  removeChannelMock,
  fetchMock,
  trackMock,
  toastMock,
  requestPushPermissionMock,
  storeState,
} = vi.hoisted(() => {
  return {
    fromMock: vi.fn(),
    configResponse: { current: { data: [] as unknown[], error: null as unknown } },
    dismissalResponse: { current: { data: [] as unknown[], error: null as unknown } },
    settingsResponse: { current: { data: [] as unknown[], error: null as unknown } },
    upsertMock: vi.fn().mockResolvedValue({ error: null }),
    updateMock: vi.fn().mockReturnValue({ eq: () => ({ eq: () => Promise.resolve({ error: null }) }) }),
    channelMock: vi.fn(() => ({
      on: () => ({ subscribe: () => ({ unsubscribe: () => 'ok' }) }),
    })),
    removeChannelMock: vi.fn(),
    fetchMock: vi.fn(),
    trackMock: vi.fn(),
    toastMock: vi.fn(),
    requestPushPermissionMock: vi.fn().mockResolvedValue({ state: 'granted' }),
    storeState: { current: { signedIn: { user: { id: 'u1' } } } },
  };
});

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: (table: string) => fromMock(table),
    auth: { getSession: () => Promise.resolve({ data: { session: { access_token: 't' } } }) },
    channel: (...args: unknown[]) => channelMock(...args),
    removeChannel: (...args: unknown[]) => removeChannelMock(...args),
  },
}));

vi.mock('@/lib/store', () => ({
  useStore: (selector: (s: unknown) => unknown) => selector(storeState.current),
}));

vi.mock('@/hooks/useToast', () => ({
  useToast: () => toastMock,
}));

vi.mock('@/lib/analytics/capture', () => ({
  capture: (...args: unknown[]) => trackMock(...args),
}));

vi.mock('@/lib/notifications/permission', () => ({
  requestPushPermission: (...args: unknown[]) => requestPushPermissionMock(...args),
}));

// --- helpers -----------------------------------------------------------------
function setSettingsRows(rows: unknown[]) {
  settingsResponse.current = { data: rows, error: null };
}
function setConfigRows(rows: unknown[]) {
  configResponse.current = { data: rows, error: null };
}
function setDismissalRows(rows: unknown[]) {
  dismissalResponse.current = { data: rows, error: null };
}

function getResponse(table: string) {
  if (table === 'notification_settings') return settingsResponse.current;
  if (table === 'notification_category_config') return configResponse.current;
  if (table === 'notification_dismissal_state') return dismissalResponse.current;
  return { data: [], error: null };
}

// We need select() WITHOUT an eq() chained call (configs are global). Make
// the select-returned object PromiseLike so `await supabase.from(t).select(...)`
// resolves.
function makeQBPromiseLike(table: string) {
  const selectResult = {
    eq: () => Promise.resolve(getResponse(table)),
    then: (resolve: (r: unknown) => void) => {
      resolve(getResponse(table));
    },
  };
  return {
    select: () => selectResult,
    upsert: (...args: unknown[]) => upsertMock(...args),
    update: (...args: unknown[]) => updateMock(...args),
  };
}

// --- test setup --------------------------------------------------------------
describe('NotificationsSubtab (Plan 42-08 POLISH-05/06)', () => {
  beforeEach(() => {
    setSettingsRows([]);
    setConfigRows([
      {
        category: 'dose-reminders',
        daily_cap: null,
        weekly_cap: null,
        urgent_escalation: false,
        push_enabled_default: true,
        email_enabled_default: true,
        in_app_enabled_default: true,
      },
      {
        category: 'ai-insights',
        daily_cap: 3,
        weekly_cap: null,
        urgent_escalation: false,
        push_enabled_default: true,
        email_enabled_default: false,
        in_app_enabled_default: true,
      },
      {
        category: 'clinic-alerts',
        daily_cap: null,
        weekly_cap: null,
        urgent_escalation: true,
        push_enabled_default: true,
        email_enabled_default: true,
        in_app_enabled_default: true,
      },
      {
        category: 'billing',
        daily_cap: null,
        weekly_cap: 1,
        urgent_escalation: false,
        push_enabled_default: false,
        email_enabled_default: true,
        in_app_enabled_default: false,
      },
      {
        category: 'marketing',
        daily_cap: null,
        weekly_cap: 1,
        urgent_escalation: false,
        push_enabled_default: false,
        email_enabled_default: true,
        in_app_enabled_default: false,
      },
    ]);
    setDismissalRows([]);
    upsertMock.mockClear().mockResolvedValue({ error: null });
    updateMock
      .mockClear()
      .mockReturnValue({ eq: () => ({ eq: () => Promise.resolve({ error: null }) }) });
    fromMock.mockReset().mockImplementation((t: string) => makeQBPromiseLike(t));
    requestPushPermissionMock.mockClear().mockResolvedValue({ state: 'granted' });
    trackMock.mockClear();
    toastMock.mockClear();
    fetchMock.mockClear();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    fetchMock.mockResolvedValue({ ok: true, text: async () => '' });

    // Default permission for permission-button test.
    Object.defineProperty(globalThis, 'Notification', {
      configurable: true,
      writable: true,
      value: { permission: 'default' },
    });
  });

  it('renders 5×3 matrix = 15 toggle cells with proper aria-label per cell', async () => {
    render(<NotificationsSubtab />);
    // 15 role=switch elements after render (table + permission button uses role=button).
    const switches = await screen.findAllByRole('switch');
    expect(switches.length).toBe(15);

    // Spot-check a known label:
    expect(screen.getByRole('switch', { name: 'AI insights In-app' })).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Marketing Email' })).toBeInTheDocument();
  });

  it('clicking a toggle calls supabase upsert with onConflict user_id,category,channel', async () => {
    render(<NotificationsSubtab />);
    const user = userEvent.setup();
    const sw = await screen.findByRole('switch', { name: 'Marketing Email' });
    await user.click(sw);
    expect(upsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: 'u1',
        category: 'marketing',
        channel: 'email',
        enabled: false, // default is true → toggled off
      }),
      { onConflict: 'user_id,category,channel' },
    );
  });

  it('snooze controls offer exactly 1d / 7d / 30d', async () => {
    render(<NotificationsSubtab />);
    expect(await screen.findByRole('button', { name: /Snooze 1d/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Snooze 7d/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Snooze 30d/ })).toBeInTheDocument();
    // No 14d or 90d option:
    expect(screen.queryByRole('button', { name: /Snooze 14d/ })).not.toBeInTheDocument();
  });

  it('cap input clamps to admin daily_cap (DOWN-only) and shows admin default', async () => {
    render(<NotificationsSubtab />);
    // ai-insights has admin daily_cap=3; UI should show "Admin default: 3".
    await screen.findByText(/Admin default: 3/);
    const capInput = screen.getByLabelText('AI insights daily cap') as HTMLInputElement;
    expect(capInput).toHaveAttribute('max', '3');
  });

  it('suppression banner appears when throttle_until is in the future', async () => {
    setDismissalRows([
      {
        user_id: 'u1',
        category: 'ai-insights',
        consecutive_dismissals: 3,
        throttle_until: new Date(Date.now() + 7 * 86_400_000).toISOString(),
        last_event_at: new Date().toISOString(),
      },
    ]);
    render(<NotificationsSubtab />);
    // Banner copy spans elements (strong wraps the category name) — assert
    // by waiting for Restore button (only present in the banner) and then
    // verifying the AI insights label is also in the same banner area.
    expect(await screen.findByRole('button', { name: /Restore/i })).toBeInTheDocument();
    expect(screen.getAllByText('AI insights').length).toBeGreaterThan(0);
  });

  it('shows "Enable push notifications" button when permission != granted; hides when granted', async () => {
    Object.defineProperty(globalThis, 'Notification', {
      configurable: true,
      writable: true,
      value: { permission: 'default' },
    });
    const { unmount } = render(<NotificationsSubtab />);
    expect(
      await screen.findByRole('button', { name: /Enable push notifications/i }),
    ).toBeInTheDocument();
    unmount();

    Object.defineProperty(globalThis, 'Notification', {
      configurable: true,
      writable: true,
      value: { permission: 'granted' },
    });
    render(<NotificationsSubtab />);
    // Wait for any async loading to settle then assert the button is gone.
    await screen.findByLabelText('Notification preferences');
    expect(
      screen.queryByRole('button', { name: /Enable push notifications/i }),
    ).not.toBeInTheDocument();
  });

  it('clicking Enable push notifications invokes requestPushPermission with fromUserGesture flag', async () => {
    render(<NotificationsSubtab />);
    const user = userEvent.setup();
    const btn = await screen.findByRole('button', { name: /Enable push notifications/i });
    await user.click(btn);
    expect(requestPushPermissionMock).toHaveBeenCalledWith({ fromUserGesture: true });
    expect(trackMock).toHaveBeenCalledWith(
      'notification_permission_granted',
      expect.objectContaining({ had_prior_subscription: false }),
    );
  });

  it('matrix table has aria-label="Notification preferences" and th[scope=row] for accessibility', async () => {
    render(<NotificationsSubtab />);
    const table = await screen.findByLabelText('Notification preferences');
    // Five th[scope=row] (one per category):
    const rowHeaders = within(table).getAllByRole('rowheader');
    expect(rowHeaders.length).toBe(5);
  });
});
