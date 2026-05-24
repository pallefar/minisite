/**
 * Phase 48 Plan 48-10 — moderation domain types.
 *
 * Shared types consumed by admin/modules/moderation/* sub-views and api.ts.
 * Mirrors the SQL row shapes shipped in Plan 48-01 (community_reports
 * triage widening), Plan 48-03 (user_moderation_state), and Plan 48-05
 * (banned_words). Keep field names + nullability aligned with the DB
 * source-of-truth migrations; sub-views render directly off these.
 */

export type ModerationStatus = 'active' | 'muted' | 'banned' | 'temp_suspended';

export type BanSeverity = 'warn' | 'flag' | 'escalate';

export type ReportTargetType = 'post' | 'comment' | 'dm_message' | 'profile';

export type ReportStatus = 'open' | 'triaged' | 'resolved' | 'dismissed';

export interface ModerationReport {
  id: string;
  target_type: ReportTargetType;
  target_id: string;
  /** NULL for system-generated reports (claude_auto_flag, banned_word). */
  reporter_user_id: string | null;
  /**
   * Discriminated jsonb. Known shapes:
   *   { source: 'user', text: string }
   *   { source: 'claude_auto_flag', categories: string[], ... }
   *   { source: 'banned_word', match: string, severity: BanSeverity }
   */
  reason: { source: string; [key: string]: unknown };
  status: ReportStatus;
  triaged_by: string | null;
  triaged_at: string | null;
  dismissed_reason: string | null;
  created_at: string;
}

export interface BannedWord {
  id: string;
  word: string;
  severity: BanSeverity;
  case_insensitive: boolean;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface UserModerationState {
  user_id: string;
  status: ModerationStatus;
  applied_by: string;
  reason: string | null;
  /** Non-null iff status='temp_suspended'; enforced by CHECK constraint. */
  expires_at: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Joined shape for UserBansRoster — JOINs auth.users (email) + profiles
 * (display_name). Per memory `reference_profiles_email_vs_auth_users_email`
 * profiles has no email column; the email field originates from auth.users.
 */
export interface UserModerationRosterRow extends UserModerationState {
  email: string | null;
  display_name: string | null;
  handle: string | null;
}

export interface ModerationAuditRow {
  id: string;
  actor_user_id: string | null;
  action_type: string;
  target_type: string;
  target_id: string | null;
  before_state: Record<string, unknown> | null;
  after_state: Record<string, unknown> | null;
  reason: string | null;
  created_at: string;
}
