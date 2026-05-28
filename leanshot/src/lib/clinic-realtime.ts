/**
 * Phase 9 Plan 09-02 — Realtime helpers for org-scoped and user-scoped
 * broadcast channels.
 *
 * Two invariants enforced here:
 *
 *   1. **setAuth-before-subscribe (Pitfall #2).** Private channels (`{
 *      config: { private: true } }`) require a fresh JWT to pass the
 *      `realtime.messages` SELECT RLS policy (migration 12). Calling
 *      `subscribe()` first silently fails with `CHANNEL_ERROR` — and the
 *      operator's roster never updates. We always `await
 *      supabase.realtime.setAuth()` immediately before `.subscribe()`.
 *
 *   2. **Defer-mount safety (Pitfall #9).** WorkspaceSwitcher and
 *      ClinicWorkspace may render BEFORE `supabase.auth.getSession()`
 *      resolves the persisted session. If we subscribe with a null JWT,
 *      the channel attaches with an anonymous token and the RLS policy
 *      rejects all messages forever (channel doesn't auto-reconnect with
 *      the right auth). We pre-check session existence and return a no-op
 *      unsubscribe handle when null — the caller can re-invoke once auth
 *      resolves.
 *
 * Topic naming follows migration 12 `clinic_org_topic_select`:
 *   - `org:<orgId>`  — broadcasts to all active members with `org.read`
 *   - `user:<userId>` — broadcasts to a single user (membership changes
 *     across orgs they belong to)
 *
 * Migration 13's `broadcast_membership_changes()` trigger emits to BOTH
 * topics on every memberships INSERT/UPDATE/DELETE, so a single revoke
 * propagates to the operator's roster AND to the patient's Active-orgs
 * tab simultaneously (D-10 two-layer revoke, Layer 1).
 */

import { supabase } from './supabase';

/**
 * Minimal no-op channel returned when there's no authenticated session at
 * subscribe time. Callers can compare the returned shape to detect the
 * deferred case and re-subscribe on auth-change.
 */
interface NoOpChannel {
  unsubscribe: () => Promise<'ok'>;
}

// `RealtimeChannel | NoOpChannel` — supabase-js's RealtimeChannel has an
// `unsubscribe()`; the no-op exposes the same surface for caller ergonomics.
export type ClinicChannel = NoOpChannel | { unsubscribe: () => Promise<'ok'> | unknown };

function noOpChannel(): NoOpChannel {
  return { unsubscribe: async () => 'ok' as const };
}

async function ensureSession(): Promise<boolean> {
  try {
    const { data } = await supabase.auth.getSession();
    return Boolean(data?.session);
  } catch {
    return false;
  }
}

// Loose broadcast payload type — supabase-js's `RealtimePostgresChangesPayload`
// is for postgres_changes, NOT broadcast. The migration-13 trigger emits raw
// payloads as `{ table, type, record, old_record }` JSON objects.
export type BroadcastChangePayload = {
  table?: string;
  type?: 'INSERT' | 'UPDATE' | 'DELETE';
  record?: Record<string, unknown>;
  old_record?: Record<string, unknown>;
  [k: string]: unknown;
};

type ChannelLike = {
  on: (
    event: string,
    filter: { event: string },
    cb: (payload: BroadcastChangePayload) => void,
  ) => ChannelLike;
  subscribe: () => Promise<'SUBSCRIBED' | string> | unknown;
  unsubscribe?: () => Promise<'ok'> | unknown;
};

async function subscribeBroadcast(
  topic: string,
  onChange: (payload: BroadcastChangePayload) => void,
): Promise<ClinicChannel> {
  if (!(await ensureSession())) return noOpChannel();

  // Pitfall #2 — setAuth() MUST precede subscribe() so the channel
  // attaches with a valid JWT and `realtime.messages` SELECT RLS passes.
  await supabase.realtime.setAuth();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const channel = (supabase.channel(topic, { config: { private: true } }) as any)
    .on('broadcast', { event: 'INSERT' }, (payload: BroadcastChangePayload) => onChange(payload))
    .on('broadcast', { event: 'UPDATE' }, (payload: BroadcastChangePayload) => onChange(payload))
    .on('broadcast', { event: 'DELETE' }, (payload: BroadcastChangePayload) =>
      onChange(payload),
    ) as ChannelLike;

  await channel.subscribe();
  return channel as ClinicChannel;
}

/**
 * Subscribe to membership changes for the given org. Fires `onChange`
 * for every INSERT/UPDATE/DELETE on `memberships` where `org_id` matches.
 *
 * RLS on `realtime.messages` (migration 12) checks `has_permission(uid,
 * orgId, 'org.read')` — non-members get nothing, even if the topic name
 * is correct.
 *
 * @returns a channel handle with `.unsubscribe()`. Idempotent; safe to
 *   call from a useEffect cleanup.
 */
export async function subscribeToOrgChannel(
  orgId: string,
  onChange: (payload: BroadcastChangePayload) => void,
): Promise<ClinicChannel> {
  return subscribeBroadcast(`org:${orgId}`, onChange);
}

/**
 * Subscribe to membership changes affecting the given user. Fires
 * `onChange` for every INSERT/UPDATE/DELETE on `memberships` where
 * `user_id` matches.
 *
 * RLS (migration 12) checks `auth.uid() = <userId>` — you can only
 * subscribe to your own user channel.
 */
export async function subscribeToUserChannel(
  userId: string,
  onChange: (payload: BroadcastChangePayload) => void,
): Promise<ClinicChannel> {
  return subscribeBroadcast(`user:${userId}`, onChange);
}
