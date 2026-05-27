/**
 * Phase 48 Plan 48-10 — moderation admin API surface.
 *
 * Thin wrappers around supabase.rpc + supabase.functions.invoke so sub-views
 * (ReportsQueue, BannedWordsEditor, UserBansRoster, ApplyModerationForm)
 * speak in domain verbs ("triage this report") rather than RPC string keys.
 *
 * RPCs called here are all SECDEF + is_staff()-gated server-side
 * (migrations 20270901000003/000006/000009/000011/000016). Client-side
 * minRole on the admin module is the Pattern S1 UX layer.
 */
import type {
  BanSeverity,
  ModerationStatus,
  UserModerationRosterRow,
} from '@/lib/moderation/types';
import { supabase } from '@/lib/supabase';

// ── Report triage ───────────────────────────────────────────────────────────

export async function triageReport(reportId: string): Promise<void> {
  const { error } = await supabase.rpc('triage_report', { p_report_id: reportId });
  if (error) throw error;
}

export async function dismissReport(reportId: string, reason: string): Promise<void> {
  const { error } = await supabase.rpc('dismiss_report', {
    p_report_id: reportId,
    p_reason: reason,
  });
  if (error) throw error;
}

export async function resolveReport(reportId: string): Promise<void> {
  const { error } = await supabase.rpc('resolve_report', { p_report_id: reportId });
  if (error) throw error;
}

// ── User moderation ─────────────────────────────────────────────────────────

export async function applyUserModeration(args: {
  userId: string;
  status: ModerationStatus;
  reason: string | null;
  expiresAt: string | null;
}): Promise<void> {
  const { error } = await supabase.rpc('apply_user_moderation', {
    p_user_id: args.userId,
    p_status: args.status,
    p_reason: args.reason,
    p_expires_at: args.expiresAt,
  });
  if (error) throw error;
}

export async function listUserModerationRoster(
  search: string | null,
): Promise<UserModerationRosterRow[]> {
  const { data, error } = await supabase.rpc('list_user_moderation_roster', {
    p_search: search,
  });
  if (error) throw error;
  return (data ?? []) as UserModerationRosterRow[];
}

// ── Banned words ────────────────────────────────────────────────────────────

export async function bannedWordUpsert(word: string, severity: BanSeverity): Promise<string> {
  const { data, error } = await supabase.rpc('banned_word_upsert', {
    p_word: word,
    p_severity: severity,
  });
  if (error) throw error;
  return data as string;
}

export async function bannedWordRemove(id: string): Promise<void> {
  const { error } = await supabase.rpc('banned_word_remove', { p_id: id });
  if (error) throw error;
}

export interface SweepBatch {
  processed: number;
  matches: number;
  next_cursor: string | null;
  done: boolean;
}

export async function invokeBannedWordsSweep(
  table: 'community_posts' | 'community_comments',
  startCursor: string | null,
): Promise<SweepBatch> {
  const { data, error } = await supabase.functions.invoke('banned-words-sweep', {
    body: { table, start_cursor: startCursor, batch_size: 100 },
  });
  if (error) throw error;
  return data as SweepBatch;
}
