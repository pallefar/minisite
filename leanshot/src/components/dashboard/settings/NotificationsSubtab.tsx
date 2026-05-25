/**
 * Phase 42 Plan 42-08 (POLISH-05/06) — Self-serve notification preference center.
 *
 * Layout per RESEARCH §Pattern 1 + CONTEXT D-07:
 *  1. (optional) Suppression banners for any category where dismissal_state.
 *     throttle_until > now() — "We've reduced <cat> frequency..." with Restore CTA.
 *  2. "Enable push notifications" button (only when Notification.permission !== 'granted').
 *  3. 5×3 matrix table (categories × channels) of accessible toggles.
 *  4. Snooze controls: category picker + 1d / 7d / 30d buttons.
 *  5. Frequency caps: per-category Input clamped to admin daily_cap (DOWN-only per D-04).
 *
 * Pitfall 3 enforcement: the push-permission Button is the ONLY call site
 * for requestPushPermission; the click handler passes fromUserGesture:true
 * inline so removing the call site requires deleting the button itself —
 * removing the guard cannot accidentally happen at distance.
 */

import { Bell, BellOff, Clock } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { useToast } from '@/hooks/useToast';
import { capture } from '@/lib/analytics/capture';
import { detectPlatform } from '@/lib/native/platform';
import { registerForPush } from '@/lib/native/push';
import { requestPushPermission } from '@/lib/notifications/permission';
import {
  keyOf,
  useNotificationSettings,
  type SettingKey,
} from '@/lib/notifications/settings-store';
import {
  CHANNELS,
  type Category,
  type CategoryConfig,
  type Channel,
  type DismissalState,
} from '@/lib/notifications/types';

// Phase 49 Plan 09 — narrow snoozeable categories (analytics event schema
// limits `notification_snoozed` to the original 5 categories per
// src/lib/analytics/events.ts).
// Phase 54 — Category union widened to 16 (helpdesk-reply + community/event cats).
// Snooze + the channel matrix only operate on the original 5 user-facing categories
// (the analytics `notification_snoozed` schema also limits to these 5). Pin explicitly
// so widening the Category union does not pull server-only categories into this UI.
type SnoozeableCategory =
  | 'dose-reminders'
  | 'ai-insights'
  | 'clinic-alerts'
  | 'billing'
  | 'marketing';
import { useStore } from '@/lib/store';
import { supabase } from '@/lib/supabase';

const CATEGORY_LABEL: Partial<Record<Category, string>> = {
  'dose-reminders': 'Dose reminders',
  'ai-insights': 'AI insights',
  'clinic-alerts': 'Clinic alerts',
  billing: 'Billing',
  marketing: 'Marketing',
  // Phase 54 Plan 05 — helpdesk-reply surfaced in channel matrix (PUSH-06).
  'helpdesk-reply': 'Helpdesk replies',
  // Phase 49 Plan 09 — community email digests (D-15 opt-IN).
  daily_community_digest: 'Daily community digest',
  weekly_community_digest: 'Weekly community digest',
};

// Phase 49 Plan 09 — digest categories surfaced in a dedicated "Email digests"
// section below (last-sent transparency + opt-in toggles). Kept OUT of the
// 5×3 channel matrix so the matrix stays at 5×3 = 15 toggles; the digests
// surface their email/in-app channels via the standalone DigestToggleRow.
const DIGEST_CATEGORIES: ReadonlyArray<Extract<Category, `${string}_digest`>> = [
  'daily_community_digest',
  'weekly_community_digest',
];

// Matrix-visible categories — the original 5 user-facing categories plus
// helpdesk-reply (Phase 54 Plan 05, PUSH-06). Excludes digest categories which
// have their own dedicated section below. Matrix iterates this list to build
// the 6×3 = 18 toggle grid.
const MATRIX_CATEGORIES: ReadonlyArray<Exclude<Category, `${string}_digest`>> = [
  'dose-reminders',
  'ai-insights',
  'clinic-alerts',
  'billing',
  'marketing',
  // Phase 54 Plan 05 — appended last to preserve existing snapshot ordering.
  'helpdesk-reply',
];

// Snooze-eligible categories — pinned to the original 5 per the analytics event
// schema (notification_snoozed in src/lib/analytics/events.ts). helpdesk-reply
// is excluded from snooze controls intentionally; the snooze fn on the server
// side also only accepts these 5. Frequency caps also scope to these 5 since the
// admin daily_cap rows in category_config seed only cover the original 5.
const SNOOZEABLE_MATRIX_CATEGORIES: ReadonlyArray<SnoozeableCategory> = [
  'dose-reminders',
  'ai-insights',
  'clinic-alerts',
  'billing',
  'marketing',
];

const CHANNEL_LABEL: Record<Channel, string> = {
  email: 'Email',
  'web-push': 'Push',
  'in-app': 'In-app',
};

// D-02 defaults — used when the user has no notification_settings row for a
// (category, channel) combo. The UI shows the smart default; the server-side
// fire decision uses category_config.*_default for the same purpose. Keeping
// them in sync here is a documentation-by-mirror tactic.
const DEFAULT_ENABLED: Partial<Record<Category, Record<Channel, boolean>>> = {
  'dose-reminders': { email: true, 'web-push': true, 'in-app': true },
  'ai-insights': { email: false, 'web-push': true, 'in-app': true },
  'clinic-alerts': { email: true, 'web-push': true, 'in-app': true },
  billing: { email: true, 'web-push': false, 'in-app': false },
  marketing: { email: true, 'web-push': false, 'in-app': false },
  // Phase 54 Plan 05 — helpdesk-reply defaults matching the 54-01 config seed.
  'helpdesk-reply': { email: true, 'web-push': true, 'in-app': true },
  // Phase 49 Plan 09 — D-15 opt-IN for community digests. Push:false because
  // digests are an email-only feature (no web-push fan-out per RESEARCH §D-15).
  daily_community_digest: { email: true, 'web-push': false, 'in-app': true },
  weekly_community_digest: { email: true, 'web-push': false, 'in-app': true },
};

function isEnabled(
  settings: Map<SettingKey, { enabled: boolean }>,
  category: Category,
  channel: Channel,
): boolean {
  const row = settings.get(keyOf(category, channel));
  if (!row) return DEFAULT_ENABLED[category]?.[channel] ?? false;
  return row.enabled;
}

export function NotificationsSubtab() {
  const signedIn = useStore((s) => s.signedIn);
  const userId = signedIn?.user?.id ?? null;
  const toast = useToast();

  const { settings, isLoading, update, refetch } = useNotificationSettings(userId);
  const [configs, setConfigs] = useState<CategoryConfig[]>([]);
  const [dismissals, setDismissals] = useState<DismissalState[]>([]);
  const [snoozeCategory, setSnoozeCategory] = useState<SnoozeableCategory>('ai-insights');
  const [snoozeBusy, setSnoozeBusy] = useState<number | null>(null);
  const [permission, setPermission] = useState<NotificationPermission | 'unknown'>(
    typeof Notification !== 'undefined' ? Notification.permission : 'unknown',
  );
  const [permBusy, setPermBusy] = useState(false);
  // Phase 54 Plan 05 — Quiet-hours timezone display (PUSH-07).
  // Read from profiles.timezone; fallback to Intl resolved tz then 'UTC'.
  const [userTimezone, setUserTimezone] = useState<string>(() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    } catch {
      return 'UTC';
    }
  });

  // Load category configs + dismissal states for the user.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const cfgRes = await supabase
        .from('notification_category_config')
        .select(
          'category, daily_cap, weekly_cap, urgent_escalation, push_enabled_default, email_enabled_default, in_app_enabled_default',
        );
      if (!cancelled && cfgRes.data) setConfigs(cfgRes.data as CategoryConfig[]);

      if (userId) {
        const dRes = await supabase
          .from('notification_dismissal_state')
          .select('user_id, category, consecutive_dismissals, throttle_until, last_event_at')
          .eq('user_id', userId);
        if (!cancelled && dRes.data) setDismissals(dRes.data as DismissalState[]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  // Phase 54 Plan 05 — fetch profiles.timezone for quiet-hours display.
  // Supabase client already imported; fetches once per userId change.
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    void (async () => {
      const { data } = await supabase
        .from('profiles')
        .select('timezone')
        .eq('id', userId)
        .maybeSingle();
      if (cancelled) return;
      const tz =
        (data as { timezone?: string | null } | null)?.timezone?.trim() || null;
      if (tz) setUserTimezone(tz);
    })();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const cfgByCat = useMemo(() => {
    const m = new Map<Category, CategoryConfig>();
    for (const c of configs) m.set(c.category, c);
    return m;
  }, [configs]);

  const throttledCats = useMemo(() => {
    const now = Date.now();
    return new Set(
      dismissals
        .filter((d) => d.throttle_until && new Date(d.throttle_until).getTime() > now)
        .map((d) => d.category),
    );
  }, [dismissals]);

  const handleToggle = useCallback(
    async (category: Category, channel: Channel) => {
      const current = isEnabled(settings, category, channel);
      const res = await update({ category, channel, enabled: !current });
      if (!res.ok) toast(res.error ?? 'Could not update preference', 'error');
    },
    [settings, update, toast],
  );

  const handleEnablePush = useCallback(async () => {
    setPermBusy(true);
    try {
      const platform = detectPlatform();

      if (platform === 'ios' || platform === 'android') {
        // Phase 54 Plan 05 — native soft-prompt path (PUSH-05).
        // Gesture gate is preserved: this callback only runs from the user click.
        // registerForPush does soft-prompt (checkPermissions → requestPermissions
        // only if 'prompt') — see src/lib/native/push.ts.
        const { data: sess } = await supabase.auth.getSession();
        const accessToken = sess.session?.access_token ?? '';
        const supabaseUrl = (import.meta.env.VITE_SUPABASE_URL as string | undefined) ?? '';
        const res = await registerForPush(accessToken, supabaseUrl);
        if (res.ok) {
          setPermission('granted');
          capture('notification_permission_granted', { had_prior_subscription: false });
          toast('Push notifications enabled', 'success');
        } else if (res.error?.startsWith('permission-denied')) {
          toast('System-level permission denied; enable in device settings', 'error');
        } else if (res.error?.startsWith('permission-')) {
          toast('Push permission not granted', 'info');
        } else {
          toast(`Could not register push: ${res.error ?? 'unknown'}`, 'error');
        }
      } else {
        // Web path — Pitfall 3 invariant: flag passed inline; this is the ONLY call site.
        const res = await requestPushPermission({ fromUserGesture: true });
        if (res.state === 'granted') {
          setPermission('granted');
          capture('notification_permission_granted', { had_prior_subscription: false });
          toast('Push notifications enabled', 'success');
        } else if (res.state === 'denied') {
          setPermission('denied');
          toast('Browser-level permission denied; enable in browser settings', 'error');
        } else if (res.state === 'unsupported') {
          toast(`Push not supported: ${res.reason}`, 'error');
        } else if (res.state === 'subscribe-failed') {
          toast(`Could not register push: ${res.error}`, 'error');
        } else {
          toast('Permission not granted', 'info');
        }
      }
    } finally {
      setPermBusy(false);
    }
  }, [toast]);

  const handleSnooze = useCallback(
    async (durationDays: 1 | 7 | 30) => {
      if (!userId) return;
      setSnoozeBusy(durationDays);
      try {
        const fnUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/notification-snooze`;
        const { data: sess } = await supabase.auth.getSession();
        const token = sess.session?.access_token;
        if (!token) {
          toast('Sign in required', 'error');
          return;
        }
        const res = await fetch(fnUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ category: snoozeCategory, duration_days: durationDays }),
        });
        if (!res.ok) {
          toast(`Snooze failed: ${res.status}`, 'error');
          return;
        }
        capture('notification_snoozed', {
          category: snoozeCategory,
          duration_days: durationDays,
        });
        toast(`${CATEGORY_LABEL[snoozeCategory]} snoozed for ${durationDays}d`, 'success');
        await refetch();
      } finally {
        setSnoozeBusy(null);
      }
    },
    [userId, snoozeCategory, toast, refetch],
  );

  const handleRestore = useCallback(
    async (category: Category) => {
      if (!userId) return;
      // WR-04: clear throttle_until by setting to null, not to now().
      // Setting to now() leaves a non-null value in the DB (breaks IS NULL
      // checks), and the optimistic update below would race with the write
      // (freshly computed new Date() is a few ms later, briefly re-showing
      // the suppression banner).
      const { error } = await supabase
        .from('notification_dismissal_state')
        .update({ throttle_until: null })
        .eq('user_id', userId)
        .eq('category', category);
      if (error) {
        toast(`Could not restore: ${error.message}`, 'error');
        return;
      }
      setDismissals((rows) =>
        rows.map((r) =>
          r.user_id === userId && r.category === category
            ? { ...r, throttle_until: null }
            : r,
        ),
      );
      toast(`${CATEGORY_LABEL[category]} frequency restored`, 'success');
    },
    [userId, toast],
  );

  const handleCapChange = useCallback(
    async (category: Category, raw: string) => {
      if (!userId) return;
      const cfg = cfgByCat.get(category);
      const adminCap = cfg?.daily_cap ?? null;
      const parsed = parseInt(raw, 10);
      if (Number.isNaN(parsed) || parsed < 0) return;
      // DOWNWARD-only per D-04: clamp client-side; the DB trigger from 42-05
      // enforces server-side (this is the helper layer).
      const clamped = adminCap !== null ? Math.min(parsed, adminCap) : parsed;
      // Apply to all 3 channel rows so the user_cap_override is consistent
      // (server-side fire-decision reads the row for the FIRING channel).
      for (const ch of CHANNELS) {
         
        await update({ category, channel: ch, user_cap_override: clamped });
      }
      if (adminCap !== null && parsed > adminCap) {
        toast(`Capped at admin default for ${CATEGORY_LABEL[category]}: ${adminCap}`, 'info');
      }
    },
    [userId, cfgByCat, update, toast],
  );

  if (!userId) {
    return (
      <Card variant="flat">
        <p className="text-[13px] text-[var(--color-text-secondary)]">
          Sign in to manage notification preferences.
        </p>
      </Card>
    );
  }

  return (
    <div className="space-y-4" data-testid="notifications-subtab">
      {/* Suppression banners */}
      {Array.from(throttledCats).map((cat) => (
        <Card key={cat} variant="flat">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-[13px] text-[var(--color-text-secondary)]">
              We&apos;ve reduced <strong>{CATEGORY_LABEL[cat]}</strong> frequency because
              you&apos;ve dismissed several.
            </p>
            <Button size="sm" variant="ghost" onClick={() => void handleRestore(cat)}>
              Restore
            </Button>
          </div>
        </Card>
      ))}

      {/* Push permission CTA */}
      {permission !== 'granted' && (
        <Card variant="flat">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h3 className="text-[14px] font-semibold flex items-center gap-2">
                <Bell className="size-4" aria-hidden /> Enable push notifications
              </h3>
              <p className="text-[12px] text-[var(--color-text-secondary)] mt-1">
                {permission === 'denied'
                  ? 'Browser-level permission denied; enable in browser settings.'
                  : 'Get system-level notifications even when LeanShot is closed.'}
              </p>
            </div>
            <Button
              size="sm"
              loading={permBusy}
              disabled={permission === 'denied'}
              leadingIcon={<Bell className="size-4" />}
              onClick={() => void handleEnablePush()}
            >
              Enable push notifications
            </Button>
          </div>
        </Card>
      )}

      {/* Phase 54 Plan 05 — Quiet hours section (PUSH-07, informational only).
          Window is fixed 22:00-08:00 server-side (push-dispatch). UI is
          read-only — no toggle implies disabling server enforcement (no backing
          column; enforcement is unconditional). */}
      <Card variant="flat" data-testid="quiet-hours-section">
        <div className="flex items-start gap-3">
          <Clock className="size-4 mt-[2px] shrink-0 text-[var(--color-text-secondary)]" aria-hidden />
          <div>
            <h3 className="text-[14px] font-semibold">Quiet hours</h3>
            <p className="text-[12px] text-[var(--color-text-secondary)] mt-1">
              Non-urgent push is paused{' '}
              <strong>22:00–08:00</strong> in your timezone ({userTimezone}). Urgent
              clinic alerts always deliver.
            </p>
          </div>
        </div>
      </Card>

      {/* 6×3 matrix per RESEARCH §Pattern 1 + Phase 54 helpdesk-reply row */}
      <Card>
        <div className="overflow-x-auto">
          <table
            aria-label="Notification preferences"
            className="w-full text-[13px] border-collapse"
            data-testid="notification-matrix"
          >
            <thead>
              <tr>
                <th className="text-start font-semibold py-2 pr-4">Category</th>
                {CHANNELS.map((ch) => (
                  <th key={ch} className="text-center font-semibold py-2 px-2">
                    {CHANNEL_LABEL[ch]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {MATRIX_CATEGORIES.map((cat) => (
                <tr key={cat} className="border-t border-[var(--color-border)]">
                  <th scope="row" className="text-start font-semibold py-3 pr-4">
                    {CATEGORY_LABEL[cat]}
                  </th>
                  {CHANNELS.map((ch) => {
                    const enabled = isEnabled(settings, cat, ch);
                    const label = `${CATEGORY_LABEL[cat]} ${CHANNEL_LABEL[ch]}`;
                    return (
                      <td key={ch} className="text-center py-3 px-2">
                        <button
                          type="button"
                          role="switch"
                          aria-checked={enabled}
                          aria-label={label}
                          disabled={isLoading}
                          onClick={() => void handleToggle(cat, ch)}
                          className={
                            'inline-flex items-center justify-center w-11 h-6 rounded-full transition-colors ' +
                            (enabled
                              ? 'bg-[var(--color-primary)]'
                              : 'bg-[var(--color-surface-elevated)] border border-[var(--color-border)]')
                          }
                        >
                          <span
                            className={
                              'inline-block size-5 rounded-full bg-white transition-transform ' +
                              (enabled ? 'translate-x-2' : '-translate-x-2')
                            }
                            aria-hidden
                          />
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Snooze controls */}
      <Card>
        <h3 className="text-[14px] font-semibold mb-2 flex items-center gap-2">
          <BellOff className="size-4" aria-hidden /> Snooze a category
        </h3>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <label className="text-[13px] flex items-center gap-2">
            <span className="text-[var(--color-text-secondary)]">Category:</span>
            <select
              aria-label="Snooze category"
              value={snoozeCategory}
              onChange={(e) => setSnoozeCategory(e.target.value as SnoozeableCategory)}
              className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 text-[13px]"
            >
              {SNOOZEABLE_MATRIX_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {CATEGORY_LABEL[c]}
                </option>
              ))}
            </select>
          </label>
          <div className="flex gap-2">
            {([1, 7, 30] as const).map((d) => (
              <Button
                key={d}
                size="sm"
                variant="ghost"
                loading={snoozeBusy === d}
                onClick={() => void handleSnooze(d)}
              >
                Snooze {d}d
              </Button>
            ))}
          </div>
        </div>
      </Card>

      {/* Frequency caps */}
      <Card>
        <h3 className="text-[14px] font-semibold mb-2">Frequency caps</h3>
        <p className="text-[12px] text-[var(--color-text-secondary)] mb-3">
          Lower the per-day cap below the admin default. You can decrease; you can&apos;t
          exceed the admin default.
        </p>
        <div className="space-y-2">
          {SNOOZEABLE_MATRIX_CATEGORIES.map((cat) => {
            const cfg = cfgByCat.get(cat);
            const adminCap = cfg?.daily_cap;
            if (adminCap === null || adminCap === undefined) {
              // Unlimited admin cap — show as informational only.
              return (
                <div
                  key={cat}
                  className="flex items-center justify-between text-[13px]"
                  data-cap-row={cat}
                >
                  <span>{CATEGORY_LABEL[cat]}</span>
                  <span className="text-[var(--color-text-tertiary)]">Unlimited</span>
                </div>
              );
            }
            const currentOverride =
              settings.get(keyOf(cat, 'in-app'))?.user_cap_override ?? null;
            return (
              <div
                key={cat}
                className="flex items-center justify-between gap-3 text-[13px]"
                data-cap-row={cat}
              >
                <span>{CATEGORY_LABEL[cat]}</span>
                <div className="flex items-center gap-2">
                  <span className="text-[var(--color-text-tertiary)] text-[12px]">
                    Admin default: {adminCap}
                  </span>
                  <Input
                    label=""
                    aria-label={`${CATEGORY_LABEL[cat]} daily cap`}
                    type="number"
                    inputMode="numeric"
                    min={0}
                    max={adminCap}
                    defaultValue={currentOverride !== null ? String(currentOverride) : ''}
                    placeholder={`≤ ${adminCap}`}
                    onBlur={(e) =>
                      e.target.value.trim() === ''
                        ? undefined
                        : void handleCapChange(cat, e.target.value)
                    }
                    className="w-24"
                  />
                </div>
              </div>
            );
          })}
        </div>
      </Card>

      {/* Phase 49 Plan 09 — Email digests section (D-15 opt-IN).
          Renders 2 standalone digest toggles + last-sent transparency line
          read from digest_send_log (kind='daily'|'weekly', most-recent
          sent_at). Toggles route through the same `handleToggle` /
          `useNotificationSettings` plumbing as the 5×3 matrix above. */}
      <Card>
        <h3 className="text-[14px] font-semibold mb-2">Email digests</h3>
        <p className="text-[12px] text-[var(--color-text-secondary)] mb-3">
          Recap of activity in your spaces. Daily and weekly are independent —
          opt out of one without affecting the other.
        </p>
        <div className="space-y-2" data-testid="email-digests-section">
          {DIGEST_CATEGORIES.map((cat) => (
            <DigestToggleRow
              key={cat}
              category={cat}
              label={CATEGORY_LABEL[cat] ?? cat}
              userId={userId}
              enabled={isEnabled(settings, cat, 'email')}
              isLoading={isLoading}
              onToggle={() => void handleToggle(cat, 'email')}
            />
          ))}
        </div>
      </Card>
    </div>
  );
}

interface DigestToggleRowProps {
  category: Extract<Category, `${string}_digest`>;
  label: string;
  userId: string;
  enabled: boolean;
  isLoading: boolean;
  onToggle: () => void;
}

/**
 * Phase 49 Plan 09 — single digest toggle row + last-sent transparency text.
 *
 * Reads the most-recent `digest_send_log` row for (user_id, kind, status='sent')
 * and renders a "Last sent N days ago" footnote. Empty state: "Never sent".
 */
function DigestToggleRow({
  category,
  label,
  userId,
  enabled,
  isLoading,
  onToggle,
}: DigestToggleRowProps) {
  const [lastSent, setLastSent] = useState<string | null>(null);
  const [loadingLast, setLoadingLast] = useState(true);
  const kind = category === 'daily_community_digest' ? 'daily' : 'weekly';

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoadingLast(true);
      const { data } = await supabase
        .from('digest_send_log')
        .select('sent_at')
        .eq('user_id', userId)
        .eq('kind', kind)
        .eq('status', 'sent')
        .order('sent_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (cancelled) return;
      setLastSent((data?.sent_at as string | undefined) ?? null);
      setLoadingLast(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [userId, kind]);

  const lastSentText = (() => {
    if (loadingLast) return '…';
    if (!lastSent) return 'Never sent';
    const days = Math.max(0, Math.floor((Date.now() - new Date(lastSent).getTime()) / 86_400_000));
    if (days === 0) return 'Last sent today';
    if (days === 1) return 'Last sent 1 day ago';
    return `Last sent ${days} days ago`;
  })();

  return (
    <div className="flex items-center justify-between gap-3" data-digest-row={category}>
      <div className="flex flex-col">
        <span className="text-[13px] font-medium">{label}</span>
        <span className="text-[11px] text-[var(--color-text-tertiary)]">{lastSentText}</span>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        aria-label={`${label} email`}
        disabled={isLoading}
        onClick={onToggle}
        className={
          'inline-flex items-center justify-center w-11 h-6 rounded-full transition-colors ' +
          (enabled
            ? 'bg-[var(--color-primary)]'
            : 'bg-[var(--color-surface-elevated)] border border-[var(--color-border)]')
        }
      >
        <span
          className={
            'inline-block size-5 rounded-full bg-white transition-transform ' +
            (enabled ? 'translate-x-2' : '-translate-x-2')
          }
          aria-hidden
        />
      </button>
    </div>
  );
}
