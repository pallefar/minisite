/**
 * Phase 8 Plan 08-03 — typed wrappers around the Phase 8 share RPCs +
 * audit_logs aggregate read.
 *
 * Public surface (consumed by ActiveSharesSection + CreateShareModal +
 * Plan 08-04 SharePage tests):
 *   - createShare(req)       → public.create_share RPC (Plan 08-01)
 *   - revokeShare(shareId)   → public.revoke_share RPC (Plan 08-01)
 *   - listActiveShares()     → SELECT shares (RLS-scoped) + audit aggregate
 *   - shareLinkFor(rawToken) → patient-facing share URL builder
 *
 * Threat model (T-08-T3 / T-08-I6): the RPCs server-side filter by
 * auth.uid(); the audit_logs SELECT is RLS-scoped to the patient. The
 * client never touches token_hash / access_code_hash — both stay
 * server-side per the Phase 8 D-02/D-03 trust boundary.
 *
 * Performance note (08-03 plan output §3): the audit aggregate is folded
 * in-memory after a single `actor_type='share_recipient' AND share_id IN(...)`
 * SELECT. The partial index `audit_logs_share_recipient_idx` from Plan 08-01
 * makes this O(active_shares × view_count); for the v1 user-count scale
 * (≤10 active shares, ≤100 views per share) the latency is well under the
 * 100ms perceived-interaction budget. A server-side aggregate RPC is
 * deferred to v2 unless live timing data falsifies the assumption.
 */

import { supabase } from '@/lib/supabase';
import type { Share, CreateShareRequest, CreateShareResponse } from '@/types/share';

/**
 * Share row decorated with per-share aggregate metadata from audit_logs.
 * Plan 08-04 consumes the underlying Share fields; the *_count / *_at /
 * *_families fields are consumed only by the patient-side Settings UI.
 */
export interface ShareWithStats extends Share {
  view_count: number;
  last_viewed_at: string | null;
  recipient_ua_families: string[];
  recipient_ip_families: string[];
}

export async function createShare(req: CreateShareRequest): Promise<CreateShareResponse> {
  const { data, error } = await supabase.rpc('create_share', {
    p_label: req.label,
    p_expires_at: req.expires_at,
  });
  if (error) throw new Error(`create_share failed: ${error.message}`);
  if (!data) throw new Error('create_share returned no rows');
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new Error('create_share returned empty result');
  return {
    share_id: row.share_id,
    raw_token: row.raw_token,
    raw_code: row.raw_code,
  };
}

export async function listActiveShares(): Promise<ShareWithStats[]> {
  const nowIso = new Date().toISOString();
  // SELECT shares (RLS-scoped to auth.uid()) WHERE revoked_at IS NULL AND
  // expires_at > now(). Ordered descending so the most recently-created
  // share is on top of the patient's list.
  const { data: shares, error: e1 } = await supabase
    .from('shares')
    .select('id, user_id, label, expires_at, revoked_at, code_consumed_at, created_at')
    .is('revoked_at', null)
    .gt('expires_at', nowIso)
    .order('created_at', { ascending: false });
  if (e1) throw new Error(`list shares failed: ${e1.message}`);
  if (!shares || shares.length === 0) return [];

  const ids = shares.map((s) => s.id);
  // audit_logs SELECT — RLS scopes patient to own rows (user_id = auth.uid()).
  // actor_type='share_recipient' + share_id ∈ ids is supported by the
  // partial index from 20260701000001_audit_logs_share_columns.sql.
  const { data: audit, error: e2 } = await supabase
    .from('audit_logs')
    .select('share_id, timestamp, recipient_ua_family, recipient_ip_family')
    .eq('actor_type', 'share_recipient')
    .in('share_id', ids);
  if (e2) throw new Error(`audit aggregate failed: ${e2.message}`);

  type AuditRow = {
    share_id: string | null;
    timestamp: string;
    recipient_ua_family: string | null;
    recipient_ip_family: string | null;
  };

  interface StatBucket {
    count: number;
    last: string | null;
    uaSet: Set<string>;
    ipSet: Set<string>;
  }

  const stats = new Map<string, StatBucket>();
  for (const a of (audit ?? []) as AuditRow[]) {
    if (!a.share_id) continue;
    const bucket: StatBucket = stats.get(a.share_id) ?? {
      count: 0,
      last: null,
      uaSet: new Set<string>(),
      ipSet: new Set<string>(),
    };
    bucket.count += 1;
    if (!bucket.last || a.timestamp > bucket.last) bucket.last = a.timestamp;
    if (a.recipient_ua_family) bucket.uaSet.add(a.recipient_ua_family);
    if (a.recipient_ip_family) bucket.ipSet.add(a.recipient_ip_family);
    stats.set(a.share_id, bucket);
  }

  return shares.map((s) => {
    const st: StatBucket = stats.get(s.id) ?? {
      count: 0,
      last: null,
      uaSet: new Set<string>(),
      ipSet: new Set<string>(),
    };
    return {
      ...(s as Share),
      view_count: st.count,
      last_viewed_at: st.last,
      recipient_ua_families: [...st.uaSet],
      recipient_ip_families: [...st.ipSet],
    };
  });
}

export async function revokeShare(shareId: string): Promise<void> {
  const { error } = await supabase.rpc('revoke_share', { p_share_id: shareId });
  if (error) throw new Error(`revoke_share failed: ${error.message}`);
}

/**
 * Build the patient-shareable URL from a raw token. Mirrors the SPA's
 * existing hash-route convention (`#/share/<token>`); the doctor browser
 * lands on the `selectView === 'share'` branch which Plan 08-04 wires up.
 */
export function shareLinkFor(rawToken: string): string {
  return `${window.location.origin}/#/share/${rawToken}`;
}
