/**
 * Phase 42 Plan 42-08 — client-side notification types.
 *
 * MIRRORS supabase/functions/_shared/notification-types.ts (intentional
 * duplication at the trust boundary — server-side types are Deno-resolved
 * and client cannot statically import from supabase/functions/). The two
 * type modules are tiny (~5 unions) so the maintenance cost is low; if
 * they drift, the runtime contract is the upsert key shape against
 * `notification_settings(user_id, category, channel)` which is enforced
 * at the DB level by the UNIQUE constraint shipped in Plan 42-05.
 */

export type Category =
  | 'dose-reminders'
  | 'ai-insights'
  | 'clinic-alerts'
  | 'billing'
  | 'marketing'
  // Phase 49 Plan 09 — community email digests. Default opt-IN per
  // 49-CONTEXT D-15; widens the CHECK constraint (see
  // supabase/migrations/20271001000005).
  | 'daily_community_digest'
  | 'weekly_community_digest';

export type Channel = 'email' | 'web-push' | 'in-app';

/** One row in notification_settings (per-user × category × channel). */
export interface NotificationSetting {
  user_id: string;
  category: Category;
  channel: Channel;
  enabled: boolean;
  /** ISO timestamp; null when not snoozed. */
  snoozed_until: string | null;
  /** User-set cap clamp; must be ≤ category_config.daily_cap (DOWNWARD-only). */
  user_cap_override: number | null;
}

/** One row in notification_category_config (per-category admin config). */
export interface CategoryConfig {
  category: Category;
  /** NULL = unlimited (D-04 clinical-uncapped pattern). */
  daily_cap: number | null;
  /** NULL = unlimited. */
  weekly_cap: number | null;
  urgent_escalation: boolean;
  push_enabled_default: boolean;
  email_enabled_default: boolean;
  in_app_enabled_default: boolean;
}

/** One row in notification_dismissal_state (D-05 sentiment tracking). */
export interface DismissalState {
  user_id: string;
  category: Category;
  consecutive_dismissals: number;
  /** ISO timestamp; null when not throttled. */
  throttle_until: string | null;
  last_event_at: string;
}

/**
 * Realtime payload shape inserted into user_notifications by
 * supabase/functions/notification-send/index.ts (Plan 42-05). The
 * `payload` jsonb column carries the user-facing copy; we read it via
 * Supabase Realtime's postgres_changes INSERT events.
 */
export interface UserNotificationRow {
  id: string;
  user_id: string;
  category: Category;
  channel: Channel;
  payload: {
    subject: string;
    body?: string;
    deeplink?: string;
    icon?: string;
    tag?: string;
    urgency?: 'low' | 'normal' | 'high';
  };
  fired_at: string;
  dismissed_at: string | null;
}

/**
 * Web-push payload contract — what notification-send Edge Fn POSTs through
 * web-push.sendNotification(). Must match the showNotification() call in
 * src/sw.ts so a server-side change here is paired with the SW handler.
 */
export interface WebPushPayload {
  title: string;
  body: string;
  icon?: string;
  tag?: string;
  urgency?: 'low' | 'normal' | 'high';
  deeplink?: string;
}

export const CATEGORIES: readonly Category[] = [
  'dose-reminders',
  'ai-insights',
  'clinic-alerts',
  'billing',
  'marketing',
  // Phase 49 Plan 09 — digest categories appended last so the matrix order
  // is unchanged for the original 5 (preserves existing snapshot tests).
  'daily_community_digest',
  'weekly_community_digest',
] as const;

export const CHANNELS: readonly Channel[] = ['email', 'web-push', 'in-app'] as const;
