/**
 * Phase 42 Plan 42-05 — shared notification types.
 *
 * Used by:
 *   - notification-fire-decision.ts (pure function)
 *   - notification-send / notification-dismiss / notification-snooze /
 *     push-subscribe Edge Fns
 *   - leanshot/tests/integration/notification-*.test.ts (re-exported via
 *     a compatibility import at the test boundary)
 *
 * Per feedback_planner_iter1_anti_patterns: payload jsonb is intentionally
 * open; downstream Edge Fn validates shape via zod gate for PHI-bearing
 * categories (clinic-alerts → {subject, deeplink} only per D-13).
 */

export type Category =
  | 'dose-reminders'
  | 'ai-insights'
  | 'clinic-alerts'
  | 'billing'
  | 'marketing';

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
 * Output of shouldFire(). Each channel boolean is the final decision for
 * that channel after combining: enabled flag + cap not exceeded + snooze
 * inactive + per-channel-disable.
 *
 * `urgent` is independent of the channel decisions and signals web-push
 * urgency='high' (D-03; only true for clinic-alerts).
 *
 * `reasons` records WHY each channel/result is what it is. Used by
 * downstream audit logging (T-42-05-06 repudiation defense).
 */
export interface FireDecision {
  email: boolean;
  push: boolean;
  in_app: boolean;
  urgent: boolean;
  reasons: {
    email: FireReason;
    push: FireReason;
    in_app: FireReason;
    cap?: CapReason;
  };
}

export type FireReason =
  | 'allowed'
  | 'disabled'
  | 'snoozed'
  | 'cap_exceeded'
  | 'no_setting_row';

export type CapReason = 'unlimited' | 'within_cap' | 'cap_exceeded' | 'throttled_halved';

/**
 * Input bundle for shouldFire(). The Edge Fn loads these from the DB then
 * passes them to the pure function. shouldFire() has no I/O imports.
 */
export interface ShouldFireInput {
  user_id: string;
  category: Category;
  /** All notification_settings rows for this (user, category). May be empty
   *  for fresh users — caller seeded none yet; defaults apply via cfg.*_default. */
  prefs: NotificationSetting[];
  cfg: CategoryConfig;
  /** May be undefined for fresh users (no dismissal events yet). */
  dismissal: DismissalState | null;
  firedTodayCount: number;
  firedThisWeekCount: number;
  /** ISO timestamp — pass new Date().toISOString() in production. Pure for testability. */
  now: string;
}
