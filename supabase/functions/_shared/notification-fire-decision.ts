/**
 * Phase 42 Plan 42-05 — server-authoritative fire-decision pure function.
 *
 * PURE: no I/O imports. Verified by the Task 2 grep gate:
 *   grep -E "supabase-js|fetch|createClient" notification-fire-decision.ts
 * returns zero matches.
 *
 * Inputs (loaded by notification-send Edge Fn):
 *   - prefs           : notification_settings rows for (user, category)
 *   - cfg             : notification_category_config row for category
 *   - dismissal       : notification_dismissal_state row (or null on fresh user)
 *   - firedTodayCount : rolling 24h count of user_notifications.fired_at
 *   - firedThisWeekCount : rolling 7d count
 *   - now             : current timestamp (passed in for testability)
 *
 * Logic:
 *   1. computeEffectiveCap(cfg, dismissal, now)
 *        → null if cfg.daily_cap is null (UNLIMITED)
 *        → cfg.daily_cap / 2 (floored) when dismissal.throttle_until > now (D-05 halving)
 *        → cfg.daily_cap otherwise
 *      THEN clamp DOWNWARD by max(prefs[*].user_cap_override) when present.
 *      (DOWNWARD only — the DB trigger guarantees override ≤ admin cap; we
 *      defensively take the min.)
 *   2. isSnoozeActive(prefs, now) → true if any pref has snoozed_until > now.
 *   3. Per channel: enabled if a matching prefs row exists with enabled=true,
 *      OR no row exists and cfg.{channel}_enabled_default === true.
 *   4. capExceeded = effectiveCap !== null && firedTodayCount >= effectiveCap.
 *      Weekly cap (cfg.weekly_cap) applied same way against firedThisWeekCount.
 *   5. Final per-channel:
 *        snoozed     → false, reason 'snoozed'
 *        not enabled → false, reason 'disabled'
 *        capExceeded → false, reason 'cap_exceeded'
 *        else        → true,  reason 'allowed'
 *   6. urgent = cfg.urgent_escalation (set true for clinic-alerts).
 */

import type {
  CapReason,
  Category,
  CategoryConfig,
  Channel,
  DismissalState,
  FireDecision,
  FireReason,
  NotificationSetting,
  ShouldFireInput,
} from './notification-types.ts';

// ─── helpers ──────────────────────────────────────────────────────────────────

/**
 * Returns the effective DAILY cap to apply, accounting for D-05 halving and
 * DOWNWARD user override. NULL = unlimited.
 */
export function computeEffectiveCap(
  cfg: CategoryConfig,
  dismissal: DismissalState | null,
  prefs: NotificationSetting[],
  now: string,
): { cap: number | null; reason: CapReason } {
  // 1. Start with admin cap (possibly null = unlimited).
  let base = cfg.daily_cap;
  let reason: CapReason = base === null ? 'unlimited' : 'within_cap';

  // 2. Apply D-05 halving when throttle is active.
  if (
    base !== null &&
    dismissal &&
    dismissal.throttle_until &&
    dismissal.throttle_until > now
  ) {
    base = Math.floor(base / 2);
    reason = 'throttled_halved';
  }

  // 3. DOWNWARD-only user override. If multiple rows have overrides (e.g. one
  //    per channel), take the MIN — most restrictive interpretation, safe for
  //    cap enforcement. The DB trigger guarantees each value ≤ admin cap.
  const overrides = prefs
    .map((p) => p.user_cap_override)
    .filter((v): v is number => v !== null && v !== undefined);
  if (overrides.length > 0) {
    const userMin = Math.min(...overrides);
    if (base === null || userMin < base) {
      base = userMin;
      // Keep the prior `reason` if it was throttled; otherwise mark within_cap.
      if (reason !== 'throttled_halved') reason = 'within_cap';
    }
  }

  return { cap: base, reason };
}

/**
 * Returns true if any setting row for this (user, category) has an active snooze.
 */
export function isSnoozeActive(prefs: NotificationSetting[], now: string): boolean {
  return prefs.some((p) => p.snoozed_until !== null && p.snoozed_until > now);
}

/**
 * Looks up the (category, channel) preference row. Returns null if absent —
 * caller falls back to cfg.{channel}_enabled_default.
 */
function findPref(
  prefs: NotificationSetting[],
  channel: Channel,
): NotificationSetting | null {
  return prefs.find((p) => p.channel === channel) ?? null;
}

/**
 * Per-channel enabled check: explicit pref row wins; otherwise admin default.
 * Returns {enabled, hasPref} so callers can distinguish 'disabled' vs 'no_setting_row'.
 */
function channelEnabled(
  prefs: NotificationSetting[],
  channel: Channel,
  cfg: CategoryConfig,
): { enabled: boolean; hasPref: boolean } {
  const pref = findPref(prefs, channel);
  if (pref) return { enabled: pref.enabled, hasPref: true };

  const fallback =
    channel === 'email'
      ? cfg.email_enabled_default
      : channel === 'web-push'
        ? cfg.push_enabled_default
        : cfg.in_app_enabled_default;
  return { enabled: fallback, hasPref: false };
}

// ─── shouldFire ───────────────────────────────────────────────────────────────

/**
 * Main entry point. Returns FireDecision for all three channels.
 */
export function shouldFire(input: ShouldFireInput): FireDecision {
  const { prefs, cfg, dismissal, firedTodayCount, firedThisWeekCount, now } = input;

  // 1. Snooze gate (applies to ALL channels).
  const snoozed = isSnoozeActive(prefs, now);

  // 2. Effective daily cap (NULL = unlimited).
  const { cap: effDailyCap, reason: capReason } = computeEffectiveCap(
    cfg,
    dismissal,
    prefs,
    now,
  );

  // 3. Cap evaluation.
  const dailyCapExceeded =
    effDailyCap !== null && firedTodayCount >= effDailyCap;
  const weeklyCapExceeded =
    cfg.weekly_cap !== null && firedThisWeekCount >= cfg.weekly_cap;
  const capExceeded = dailyCapExceeded || weeklyCapExceeded;

  // 4. Per-channel decision builder.
  function decide(channel: Channel): { fire: boolean; reason: FireReason } {
    if (snoozed) return { fire: false, reason: 'snoozed' };

    const { enabled, hasPref } = channelEnabled(prefs, channel, cfg);
    if (!enabled) {
      return { fire: false, reason: hasPref ? 'disabled' : 'no_setting_row' };
    }
    if (capExceeded) return { fire: false, reason: 'cap_exceeded' };
    return { fire: true, reason: 'allowed' };
  }

  const emailDecision = decide('email');
  const pushDecision = decide('web-push');
  const inAppDecision = decide('in-app');

  return {
    email: emailDecision.fire,
    push: pushDecision.fire,
    in_app: inAppDecision.fire,
    urgent: cfg.urgent_escalation,
    reasons: {
      email: emailDecision.reason,
      push: pushDecision.reason,
      in_app: inAppDecision.reason,
      cap: capExceeded ? 'cap_exceeded' : capReason,
    },
  };
}

// Re-export types so the Edge Fn + tests can import everything from one path.
export type {
  CapReason,
  Category,
  CategoryConfig,
  Channel,
  DismissalState,
  FireDecision,
  FireReason,
  NotificationSetting,
  ShouldFireInput,
};
