/**
 * Phase 45 Plan 07b — DMInboxView.
 *
 * Replaces the 45-07a stub at leanshot/src/components/community/DMInboxView.tsx.
 * Per memory feedback_stub_then_replace_sibling_collision: same-wave sibling
 * 45-07a shipped a final-prop-signature stub; this plan ships the real surface.
 *
 * Responsibilities (truth-bound from 45-07b PLAN must_haves):
 *   - List the current user's DM threads via direct supabase query (RLS gates
 *     thread-list to participant-only — `creator_user_id = auth.uid()` OR
 *     `recipient_user_id = auth.uid()` policy lives in 45-02 RLS migration).
 *   - Subscribe via useDmInboxRealtime (45-07a hook): on incoming message,
 *     re-fetch the inbox so the new last-message preview + sort order land.
 *   - On window focus call public.update_community_last_active() (D-20 debounce
 *     signal for the 5-min "active" presence used by dm-create-thread Edge Fn
 *     to skip notify when the recipient is currently active).
 *   - Click a thread row → setActiveDmThread(thread.id); CommunityTabShell
 *     then dispatches DMThreadView.
 *
 * D-15 note: unread-count badge intentionally deferred to v1.3-uat-deferred per
 * memory feedback_milestone_uat_deferral_consolidation. Last-message preview is
 * what ships in v1.2. The use-dm-inbox-realtime hook still wakes the inbox so
 * new threads appear without a manual refresh.
 *
 * Analog: CommunityFeed.tsx (skeleton + list + RLS-gated query shape).
 */
import { useCallback, useEffect, useState, type JSX } from 'react';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Skeleton } from '@/components/ui/Skeleton';
import { useStore } from '@/lib/store';
import { supabase } from '@/lib/supabase';
import { useDmInboxRealtime } from '../use-dm-inbox-realtime';

// ─── Types ────────────────────────────────────────────────────────────────────

interface InboxThreadRow {
  id: string;
  creator_user_id: string;
  recipient_user_id: string;
  last_message_at: string | null;
  // Counterparty handle for display (resolved via a separate profile lookup
  // because PostgREST embedded joins on FK-to-profiles require an alias and
  // the trip-back-through-RLS is cheaper than embedding here).
  counterparty_handle: string | null;
  counterparty_display_name: string | null;
  // Last-message preview (truncated to ~80 chars for the row).
  last_message_preview: string | null;
}

export interface DMInboxViewProps {
  currentUserId: string;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function DMInboxView({ currentUserId }: DMInboxViewProps): JSX.Element {
  const setActiveDmThread = useStore((s) => s.setActiveDmThread);
  const [threads, setThreads] = useState<InboxThreadRow[] | null>(null);
  const [refreshNonce, setRefreshNonce] = useState(0);

  // ── Inbox fetch ─────────────────────────────────────────────────────────────
  // Two-step fetch (kept simple — feed has the same shape):
  //   1. Read dm_threads where the current user is creator OR recipient,
  //      ordered by last_message_at desc.
  //   2. Resolve counterparty handle/display_name + last-message preview in a
  //      single second pass (no PostgREST nested join — keeps RLS surface
  //      predictable and matches the CommunityFeed two-step pattern).
  useEffect(() => {
    if (!currentUserId) return;
    let cancelled = false;

    async function fetchInbox(): Promise<void> {
      // dm_threads RLS limits to participant rows; ordering by last_message_at
      // surfaces the freshest thread first (idx_dm_threads_recipient_last_msg).
      const { data: threadRows, error: threadErr } = await supabase
        .from('dm_threads')
        .select('id, creator_user_id, recipient_user_id, last_message_at, created_at')
        .or(`creator_user_id.eq.${currentUserId},recipient_user_id.eq.${currentUserId}`)
        .order('last_message_at', { ascending: false, nullsFirst: false })
        .limit(50);

      if (threadErr || !threadRows) {
        if (!cancelled) setThreads([]);
        return;
      }

      const rows = threadRows as Array<{
        id: string;
        creator_user_id: string;
        recipient_user_id: string;
        last_message_at: string | null;
      }>;

      if (rows.length === 0) {
        if (!cancelled) setThreads([]);
        return;
      }

      // Resolve counterparty profile rows.
      const counterpartyIds = rows.map((t) =>
        t.creator_user_id === currentUserId ? t.recipient_user_id : t.creator_user_id,
      );
      const { data: profileRows } = await supabase
        .from('profiles')
        .select('id, handle, display_name')
        .in('id', counterpartyIds);
      const profileById = new Map<string, { handle: string | null; display_name: string | null }>();
      for (const p of (profileRows ?? []) as Array<{
        id: string;
        handle: string | null;
        display_name: string | null;
      }>) {
        profileById.set(p.id, { handle: p.handle, display_name: p.display_name });
      }

      // Resolve last-message preview per thread (one row per thread). Cheap
      // single round-trip: select latest `body, thread_id, created_at` from
      // direct_messages restricted to these thread ids; pick the first row
      // per thread_id client-side (the table has idx on thread_id+created_at).
      const threadIds = rows.map((t) => t.id);
      const { data: msgRows } = await supabase
        .from('direct_messages')
        .select('thread_id, body, created_at')
        .in('thread_id', threadIds)
        .order('created_at', { ascending: false })
        .limit(threadIds.length * 4); // headroom: 4 most-recent per thread average
      const previewByThread = new Map<string, string>();
      for (const m of (msgRows ?? []) as Array<{
        thread_id: string;
        body: string;
        created_at: string;
      }>) {
        if (!previewByThread.has(m.thread_id)) {
          // Truncate to ~80 chars for the row; never render markdown here
          // (preview is plain-text; full body is rendered sanitized inside
          // DMThreadView via Phase 44 renderPostBodyHtml).
          const trimmed = m.body.replace(/\s+/g, ' ').trim();
          previewByThread.set(
            m.thread_id,
            trimmed.length > 80 ? `${trimmed.slice(0, 80)}…` : trimmed,
          );
        }
      }

      const merged: InboxThreadRow[] = rows.map((t) => {
        const counterpartyId =
          t.creator_user_id === currentUserId ? t.recipient_user_id : t.creator_user_id;
        const cp = profileById.get(counterpartyId);
        return {
          id: t.id,
          creator_user_id: t.creator_user_id,
          recipient_user_id: t.recipient_user_id,
          last_message_at: t.last_message_at,
          counterparty_handle: cp?.handle ?? null,
          counterparty_display_name: cp?.display_name ?? null,
          last_message_preview: previewByThread.get(t.id) ?? null,
        };
      });

      if (!cancelled) setThreads(merged);
    }

    void fetchInbox();
    return () => {
      cancelled = true;
    };
  }, [currentUserId, refreshNonce]);

  // ── Realtime — wake the inbox on incoming DM ────────────────────────────────
  // Hook is stable across renders by design (45-07a); the onNewMessage callback
  // must be memoized or the hook intentionally ignores deps to avoid leaks.
  const handleInboxWake = useCallback(() => {
    setRefreshNonce((n) => n + 1);
  }, []);
  useDmInboxRealtime(currentUserId || null, handleInboxWake);

  // ── D-20 presence debounce — fire update_community_last_active on focus ────
  useEffect(() => {
    if (!currentUserId) return;
    function pingPresence(): void {
      // SECDEF RPC; auth.uid() is read server-side. Errors are best-effort.
      // Wrap in Promise.resolve() so a rejection becomes a no-op catch (the
      // PostgrestFilterBuilder returned by .rpc() is thenable but its return
      // type does not expose .catch directly).
      void Promise.resolve(supabase.rpc('update_community_last_active')).then(
        () => undefined,
        () => undefined,
      );
    }
    // Fire once on mount + on every window focus thereafter.
    pingPresence();
    window.addEventListener('focus', pingPresence);
    return () => window.removeEventListener('focus', pingPresence);
  }, [currentUserId]);

  // ── Render ──────────────────────────────────────────────────────────────────

  if (!currentUserId) {
    return (
      <EmptyState
        title="Sign in required"
        body="Direct messages are only available to signed-in users."
      />
    );
  }

  if (threads === null) {
    return (
      <div className="p-4 space-y-2" role="status" aria-live="polite" aria-label="Loading inbox">
        <Skeleton className="h-16 w-full rounded-xl" />
        <Skeleton className="h-16 w-full rounded-xl" />
        <Skeleton className="h-16 w-full rounded-xl" />
      </div>
    );
  }

  if (threads.length === 0) {
    return (
      <EmptyState
        title="No conversations yet"
        body="Start a conversation from someone's profile in the directory."
      />
    );
  }

  return (
    <ul className="p-2 space-y-2" aria-label="Direct message inbox">
      {threads.map((t) => {
        const displayName = t.counterparty_display_name ?? t.counterparty_handle ?? 'Unknown';
        const handleSuffix = t.counterparty_handle ? `@${t.counterparty_handle}` : '';
        return (
          <li key={t.id}>
            <button
              type="button"
              onClick={() => setActiveDmThread(t.id)}
              className="w-full text-start focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)] rounded-xl"
              aria-label={`Open conversation with ${displayName}`}
            >
              <Card variant="interactive" padding="md">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2">
                      <span className="text-sm font-medium text-[var(--color-text)] truncate">
                        {displayName}
                      </span>
                      {handleSuffix ? (
                        <span className="text-xs text-[var(--color-fg-muted)] truncate">
                          {handleSuffix}
                        </span>
                      ) : null}
                    </div>
                    {t.last_message_preview ? (
                      <p className="text-sm text-[var(--color-fg-muted)] mt-1 truncate">
                        {t.last_message_preview}
                      </p>
                    ) : (
                      <p className="text-xs text-[var(--color-fg-muted)] mt-1 italic">
                        No messages yet
                      </p>
                    )}
                  </div>
                  {t.last_message_at ? (
                    <time
                      dateTime={t.last_message_at}
                      className="shrink-0 text-xs text-[var(--color-fg-muted)]"
                    >
                      {formatRelative(t.last_message_at)}
                    </time>
                  ) : null}
                </div>
              </Card>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatRelative(iso: string): string {
  try {
    const d = new Date(iso);
    const diffMs = Date.now() - d.getTime();
    const mins = Math.floor(diffMs / 60_000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days}d`;
    return d.toLocaleDateString();
  } catch {
    return '';
  }
}

export default DMInboxView;
