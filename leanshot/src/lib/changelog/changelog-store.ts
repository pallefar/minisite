/**
 * Phase 42 Plan 42-09 Task 1 — useChangelog() hook.
 *
 * Tiny "load-once-on-mount + manual refetch" store. We deliberately don't
 * pull TanStack Query in here — the codebase's neighbouring stores (notably
 * the settings-store landing in 42-08) use plain hook + useEffect with
 * Supabase. Cache lifetime: a single in-memory snapshot per mount; markRead
 * forces the dismissed-row refetch so the unread dot disappears immediately.
 *
 * Anonymous path: if `supabase.auth.getSession()` returns no session we
 * short-circuit with `{entries:[], hasUnread:false}` — admins can still
 * SELECT the table (auth-only RLS), but a logged-out browser shouldn't even
 * try (and shouldn't toast on failure).
 *
 * @returns `{entries, lastSeenAt, hasUnread, loading, markRead}`. `markRead()`
 *          POSTs to the `changelog-mark-read` Edge Fn (plan 42-06) and
 *          refetches the user_changelog_dismissed row on success.
 */
import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { computeHasUnread, type ChangelogEntry } from './drawer-trigger';

interface DismissedRow {
  last_seen_published_at: string | null;
}

interface UseChangelogResult {
  entries: ChangelogEntry[];
  lastSeenAt: string | null;
  hasUnread: boolean;
  loading: boolean;
  markRead: () => Promise<void>;
}

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL ?? '';

export function useChangelog(): UseChangelogResult {
  const [entries, setEntries] = useState<ChangelogEntry[]>([]);
  const [lastSeenAt, setLastSeenAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [accessToken, setAccessToken] = useState<string | null>(null);

  const fetchDismissed = useCallback(async (userId: string) => {
    const { data, error } = (await supabase
      .from('user_changelog_dismissed')
      .select('last_seen_published_at')
      .eq('user_id', userId)
      .maybeSingle()) as { data: DismissedRow | null; error: { message: string } | null };
    if (error) return null;
    return data?.last_seen_published_at ?? null;
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const { data: sessionData } = await supabase.auth.getSession();
        const session = sessionData?.session ?? null;
        if (!session?.user?.id) {
          if (!cancelled) {
            setEntries([]);
            setLastSeenAt(null);
            setLoading(false);
          }
          return;
        }
        if (!cancelled) setAccessToken(session.access_token ?? null);

        const entriesRes = (await supabase
          .from('changelog_entries')
          .select('id, slug, title, body_md, published_at')
          .order('published_at', { ascending: false })
          .limit(20)) as {
          data: ChangelogEntry[] | null;
          error: { message: string } | null;
        };

        const seen = await fetchDismissed(session.user.id);

        if (cancelled) return;
        setEntries(entriesRes.data ?? []);
        setLastSeenAt(seen);
        setLoading(false);
      } catch {
        // Fail-soft per CLAUDE.md: "AI outage = degraded coach UX, not full-app
        // outage". Same posture for the changelog drawer — silent fallback so
        // a network blip doesn't poison the topbar render.
        if (!cancelled) {
          setEntries([]);
          setLastSeenAt(null);
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fetchDismissed]);

  const markRead = useCallback(async () => {
    if (!accessToken) return;
    const url = `${SUPABASE_URL}/functions/v1/changelog-mark-read`;
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
      });
      if (!res.ok) return;
      const { data: sessionData } = await supabase.auth.getSession();
      const uid = sessionData?.session?.user?.id;
      if (!uid) return;
      const seen = await fetchDismissed(uid);
      setLastSeenAt(seen);
    } catch {
      // Same fail-soft posture as initial fetch — never toast from this hook.
    }
  }, [accessToken, fetchDismissed]);

  return {
    entries,
    lastSeenAt,
    hasUnread: computeHasUnread(entries, lastSeenAt),
    loading,
    markRead,
  };
}
