/**
 * Phase 42 Plan 42-08 — NotificationsSubtab tests.
 * Phase 54 Plan 54-05 — Quiet-hours section + helpdesk-reply + native push branch.
 *
 * Covers:
 *   1. 6×3 matrix renders 18 switch cells + 2 digest = 20 total.
 *   2. Clicking a toggle calls update() optimistically.
 *   3. Snooze controls offer 1d/7d/30d (original 5 categories only).
 *   4. Cap input clamps to admin daily_cap (original 5 categories).
 *   5. Suppression banner appears when throttle_until > now() and restores.
 *   6. "Enable push notifications" button only when permission !== 'granted'.
 *   7. Quiet-hours section visible with timezone display.
 *   8. Helpdesk-replies row in the matrix.
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
  registerForPushMock,
  detectPlatformMock,
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
    registerForPushMock: vi.fn().mockResolvedValue({ ok: true }),
    detectPlatformMock: vi.fn().mockReturnValue('web'),
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

vi.mock('@/lib/native/push', () => ({
  registerForPush: (...args: unknown[]) => registerForPushMock(...args),
}));

vi.mock('@/lib/native/platform', () => ({
  detectPlatform: () => detectPlatformMock(),
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

// Phase 49 Plan 09 — `digest_send_log` mock surface: per-kind most-recent row.
const digestSendLogRows: {
  current: Record<'daily' | 'weekly', { sent_at: string } | null>;
} = { current: { daily: null, weekly: null } };

function getResponse(table: string) {
  if (table === 'notification_settings') return settingsResponse.current;
  if (table === 'notification_category_config') return configResponse.current;
  if (table === 'notification_dismissal_state') return dismissalResponse.current;
  if (table === 'profiles') return { data: { timezone: 'Europe/Oslo' }, error: null };
  return { data: [], error: null };
}

// We need select() WITHOUT an eq() chained call (configs are global). Make
// the select-returned object PromiseLike so `await supabase.from(t).select(...)`
// resolves.
function makeQBPromiseLike(table: string) {
  // Phase 49 Plan 09 — `digest_send_log` is queried with a 3-eq chain
  // + order + limit + maybeSingle; capture the `kind` filter to return the
  // correct row.
  if (table === 'digest_send_log') {
    let capturedKind: 'daily' | 'weekly' | null = null;
    const chain: Record<string, unknown> = {
      select: () => chain,
      eq: (col: string, val: string) => {
        if (col === 'kind') capturedKind = val as 'daily' | 'weekly';
        return chain;
      },
      order: () => chain,
      limit: () => chain,
      maybeSingle: () =>
        Promise.resolve({
          data: capturedKind ? digestSendLogRows.current[capturedKind] : null,
          error: null,
        }),
    };
    return chain;
  }
  // Phase 54 Plan 05 — profiles is queried with .select().eq(id).maybeSingle()
  if (table === 'profiles') {
    const profileChain: Record<string, unknown> = {
      select: () => profileChain,
      eq: () => profileChain,
      maybeSingle: () =>
        Promise.resolve({ data: { timezone: 'Europe/Oslo' }, error: null }),
    };
    return profileChain;
  }
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
    // Phase 49 Plan 09 — reset digest_send_log mock to empty (no rows).
    digestSendLogRows.current = { daily: null, weekly: null };
    upsertMock.mockClear().mockResolvedValue({ error: null });
    updateMock
      .mockClear()
      .mockReturnValue({ eq: () => ({ eq: () => Promise.resolve({ error: null }) }) });
    fromMock.mockReset().mockImplementation((t: string) => makeQBPromiseLike(t));
    requestPushPermissionMock.mockClear().mockResolvedValue({ state: 'granted' });
    registerForPushMock.mockClear().mockResolvedValue({ ok: true });
    detectPlatformMock.mockClear().mockReturnValue('web');
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

  it('renders 6×3 matrix = 18 matrix toggles + 2 digest toggles = 20 switch cells total', async () => {
    render(<NotificationsSubtab />);
    // 18 role=switch in the 6-row matrix + 2 in the Email digests section (Plan 49-09).
    // Phase 54 Plan 05: helpdesk-reply added as 6th row.
    // Permission button uses role=button so it's not counted.
    const switches = await screen.findAllByRole('switch');
    expect(switches.length).toBe(20);

    // Spot-check known labels:
    expect(screen.getByRole('switch', { name: 'AI insights In-app' })).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Marketing Email' })).toBeInTheDocument();
    // Phase 54 Plan 05 — helpdesk-reply row:
    expect(screen.getByRole('switch', { name: 'Helpdesk replies Email' })).toBeInTheDocument();
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
    // Six th[scope=row] — one per category (5 original + helpdesk-reply, Phase 54 Plan 05):
    const rowHeaders = within(table).getAllByRole('rowheader');
    expect(rowHeaders.length).toBe(6);
  });

  // ---------------------------------------------------------------------------
  // Phase 49 Plan 09 — Email digests section (D-15 opt-IN + last-sent transparency).
  // ---------------------------------------------------------------------------
  it('renders 2 digest toggles in the Email digests section (daily + weekly)', async () => {
    render(<NotificationsSubtab />);
    await screen.findByLabelText('Notification preferences');
    const section = screen.getByTestId('email-digests-section');
    expect(within(section).getByRole('switch', { name: /Daily community digest email/i })).toBeInTheDocument();
    expect(within(section).getByRole('switch', { name: /Weekly community digest email/i })).toBeInTheDocument();
  });

  it('toggling a digest off calls supabase upsert with enabled:false', async () => {
    render(<NotificationsSubtab />);
    const user = userEvent.setup();
    const section = await screen.findByTestId('email-digests-section');
    const dailyToggle = within(section).getByRole('switch', {
      name: /Daily community digest email/i,
    });
    // Default is enabled:true (D-15 opt-IN) → click flips to false.
    await user.click(dailyToggle);
    expect(upsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: 'u1',
        category: 'daily_community_digest',
        channel: 'email',
        enabled: false,
      }),
      { onConflict: 'user_id,category,channel' },
    );
  });

  it('renders "Last sent 1 day ago" when digest_send_log has a row 24h+ old', async () => {
    digestSendLogRows.current = {
      daily: { sent_at: new Date(Date.now() - 26 * 3600 * 1000).toISOString() },
      weekly: null,
    };
    render(<NotificationsSubtab />);
    expect(await screen.findByText(/Last sent 1 day ago/i)).toBeInTheDocument();
  });

  it('renders "Never sent" for digest categories with no digest_send_log row', async () => {
    digestSendLogRows.current = { daily: null, weekly: null };
    render(<NotificationsSubtab />);
    const section = await screen.findByTestId('email-digests-section');
    // Both rows show "Never sent" when no log rows exist.
    const neverSentMatches = await within(section).findAllByText(/Never sent/i);
    expect(neverSentMatches.length).toBe(2);
  });

  // ---------------------------------------------------------------------------
  // Phase 54 Plan 05 — Quiet hours section + helpdesk-reply + native push branch.
  // ---------------------------------------------------------------------------
  it('renders a Quiet hours section with the correct window and timezone', async () => {
    render(<NotificationsSubtab />);
    const section = await screen.findByTestId('quiet-hours-section');
    // Section heading:
    expect(within(section).getByText(/Quiet hours/i)).toBeInTheDocument();
    // Fixed window text:
    expect(within(section).getByText(/22:00/)).toBeInTheDocument();
    expect(within(section).getByText(/08:00/)).toBeInTheDocument();
    // Accurate copy — mentions urgent clinic alerts always deliver:
    expect(within(section).getByText(/Urgent\s+clinic alerts always deliver/i)).toBeInTheDocument();
    // Timezone from mocked profiles response:
    expect(within(section).getByText(/Europe\/Oslo/)).toBeInTheDocument();
  });

  it('Helpdesk replies row appears in the notification matrix', async () => {
    render(<NotificationsSubtab />);
    await screen.findByLabelText('Notification preferences');
    // All 3 channel switches for helpdesk-reply should be present:
    expect(screen.getByRole('switch', { name: 'Helpdesk replies Email' })).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Helpdesk replies Push' })).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Helpdesk replies In-app' })).toBeInTheDocument();
  });

  it('Enable push uses registerForPush on native (ios) platform', async () => {
    detectPlatformMock.mockReturnValue('ios');
    render(<NotificationsSubtab />);
    const user = userEvent.setup();
    const btn = await screen.findByRole('button', { name: /Enable push notifications/i });
    await user.click(btn);
    expect(registerForPushMock).toHaveBeenCalledWith('t', expect.any(String));
    expect(requestPushPermissionMock).not.toHaveBeenCalled();
  });

  it('Enable push uses web VAPID path on web platform', async () => {
    detectPlatformMock.mockReturnValue('web');
    render(<NotificationsSubtab />);
    const user = userEvent.setup();
    const btn = await screen.findByRole('button', { name: /Enable push notifications/i });
    await user.click(btn);
    expect(requestPushPermissionMock).toHaveBeenCalledWith({ fromUserGesture: true });
    expect(registerForPushMock).not.toHaveBeenCalled();
  });
});
