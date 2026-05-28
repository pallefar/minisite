/**
 * Phase 42 Plan 42-09 Task 2 — Topbar unread-dot UI tests.
 *
 * Separate file from WhatsNewDrawer.test.tsx because the Topbar mounts a
 * lot of i18next + store machinery; isolating the supabase + useChangelog
 * mock here keeps test failures readable.
 *
 * Covers:
 *   - UI test 4: avatar Button gets a `data-unread="true"` indicator span
 *     when hasUnread === true; absent when hasUnread === false.
 *   - UI test 5: aria-label switches between "What's new — N unread updates"
 *     and "Profile menu" (delegated to AvatarMenu when no unread).
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

// Mock useChangelog ONCE per test by re-importing the Topbar with a fresh
// vi.doMock so each test controls the return value.
const renderTopbar = async (override: { hasUnread: boolean; entries?: number }) => {
  vi.resetModules();
  vi.doMock('@/lib/changelog/changelog-store', () => ({
    useChangelog: () => ({
      entries: Array.from({ length: override.entries ?? 0 }, (_, i) => ({
        id: String(i),
        slug: `s-${i}`,
        title: `t-${i}`,
        body_md: '',
        published_at: '2026-05-19T00:00:00Z',
      })),
      lastSeenAt: null,
      hasUnread: override.hasUnread,
      loading: false,
      markRead: vi.fn(),
    }),
  }));
  // Minimal i18n stub so <Topbar> can render without bootstrapping react-i18next
  vi.doMock('react-i18next', () => ({
    useTranslation: () => ({ t: (key: string, fallback?: string) => fallback ?? key }),
  }));
  // Stub the Zustand store to a benign default
  vi.doMock('@/lib/store', () => ({
    useStore: (selector: (s: unknown) => unknown) =>
      selector({
        currentTab: 'home',
        setTab: () => {},
        signedIn: { user: { id: 'u-1', email: 'a@b.c' }, verified: true },
        signOut: () => {},
      }),
  }));
  vi.doMock('@/hooks/useTheme', () => ({
    useTheme: () => ({ theme: 'light', toggle: () => {} }),
  }));
  vi.doMock('@/hooks/useToast', () => ({
    useToast: () => () => {},
  }));
  const mod = await import('../layout/Topbar');
  return render(
    <mod.Topbar
      onLogDose={() => {}}
      onOpenReport={() => {}}
      onOpenAI={() => {}}
      onOpenWhatsNew={() => {}}
    />,
  );
};

describe('Topbar — unread-dot indicator', () => {
  it('UI test 4a: shows unread-dot span when hasUnread === true', async () => {
    await renderTopbar({ hasUnread: true, entries: 3 });
    const dot = document.querySelector('[data-testid="whats-new-unread-dot"]');
    expect(dot).not.toBeNull();
  });

  it('UI test 4b: hides unread-dot span when hasUnread === false', async () => {
    await renderTopbar({ hasUnread: false, entries: 0 });
    const dot = document.querySelector('[data-testid="whats-new-unread-dot"]');
    expect(dot).toBeNull();
  });

  it('UI test 5: avatar Button has aria-label="What\'s new — N unread updates" when hasUnread', async () => {
    await renderTopbar({ hasUnread: true, entries: 3 });
    const btn = screen.getByRole('button', { name: /what's new — 3 unread/i });
    expect(btn).toBeInTheDocument();
  });
});
