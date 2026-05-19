/**
 * Phase 42 Plan 42-09 Task 1 — pure helper for unread-flag computation.
 * Centralised so multiple nav surfaces (Topbar avatar dot, mobile nav badge,
 * future settings hint) all derive `hasUnread` the same way.
 */
import { describe, expect, it } from 'vitest';
import { computeHasUnread } from './drawer-trigger';

describe('computeHasUnread', () => {
  it('returns false when there are no entries', () => {
    expect(computeHasUnread([], null)).toBe(false);
    expect(computeHasUnread([], '2026-01-01T00:00:00Z')).toBe(false);
  });

  it('returns true when lastSeenAt is null and at least one entry exists', () => {
    expect(
      computeHasUnread(
        [{ id: '1', slug: 'a', title: 't', body_md: '', published_at: '2026-05-19T00:00:00Z' }],
        null,
      ),
    ).toBe(true);
  });

  it('returns true when any entry.published_at > lastSeenAt', () => {
    expect(
      computeHasUnread(
        [
          { id: '1', slug: 'a', title: 't', body_md: '', published_at: '2026-05-19T00:00:00Z' },
          { id: '2', slug: 'b', title: 't', body_md: '', published_at: '2026-01-01T00:00:00Z' },
        ],
        '2026-03-01T00:00:00Z',
      ),
    ).toBe(true);
  });

  it('returns false when all entries are older than lastSeenAt', () => {
    expect(
      computeHasUnread(
        [
          { id: '1', slug: 'a', title: 't', body_md: '', published_at: '2025-12-31T00:00:00Z' },
          { id: '2', slug: 'b', title: 't', body_md: '', published_at: '2026-01-01T00:00:00Z' },
        ],
        '2026-03-01T00:00:00Z',
      ),
    ).toBe(false);
  });

  it('returns false when lastSeenAt exactly equals the newest published_at', () => {
    expect(
      computeHasUnread(
        [{ id: '1', slug: 'a', title: 't', body_md: '', published_at: '2026-05-19T00:00:00Z' }],
        '2026-05-19T00:00:00Z',
      ),
    ).toBe(false);
  });
});
