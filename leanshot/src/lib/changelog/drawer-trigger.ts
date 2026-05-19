/**
 * Phase 42 Plan 42-09 Task 1 — pure "do we show the unread dot?" helper.
 *
 * Extracted so the Topbar avatar, future mobile-nav badge, and any other
 * nav surface all derive the same flag from the same (entries, lastSeenAt)
 * inputs without re-implementing the comparison.
 *
 * @param entries - Newest-first list of changelog rows as returned by the
 *                  backend (see plan 42-06). Only `published_at` is read.
 * @param lastSeenAt - The current user's `last_seen_published_at` from
 *                    `user_changelog_dismissed`, or `null` for a never-seen
 *                    user (counts every entry as unread).
 * @returns `true` iff there exists at least one entry strictly newer than
 *          `lastSeenAt` (strict so that calling markRead at T = newest does
 *          NOT immediately re-trigger the dot).
 */
export interface ChangelogEntry {
  id: string;
  slug: string;
  title: string;
  body_md: string;
  published_at: string;
}

export function computeHasUnread(
  entries: readonly ChangelogEntry[],
  lastSeenAt: string | null,
): boolean {
  if (entries.length === 0) return false;
  const cutoff = new Date(lastSeenAt ?? '1970-01-01T00:00:00Z').getTime();
  for (const entry of entries) {
    if (new Date(entry.published_at).getTime() > cutoff) return true;
  }
  return false;
}
