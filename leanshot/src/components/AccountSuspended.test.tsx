/**
 * Phase 48 Plan 11 — AccountSuspended consumer-blocker tests.
 *
 * Drives the GREEN implementation of the consumer-side ban/temp_suspend
 * full-page blocker. Reads `userModerationStatus` + `userModerationExpiresAt`
 * + `userModerationReason` from the Zustand store.
 *
 * Tests aligned with Plan 48-11 canonical behavior:
 *   - heading is status-aware ("Account suspended" / "Account suspended until …")
 *   - mailto:support@leanshot.app appeal link
 *   - role="alertdialog" + aria-modal="true" + h1 heading
 *   - expires_at shown ONLY when status === 'temp_suspended'
 *
 * Note: the original 48-06 RED stub's "signs out store on mount" + role="main"
 * todos diverge from the canonical Plan 48-11 spec (component is a pure render
 * that reads store; role is alertdialog per accessibility brief). Retargeted
 * to match PLAN behavior — recorded as a Rule 1 deviation in SUMMARY.
 */
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useStore } from '@/lib/store';

vi.mock('@/lib/store', () => ({
  useStore: vi.fn(),
}));

const mockUseStore = useStore as unknown as ReturnType<typeof vi.fn>;

interface ModerationSlice {
  userModerationStatus: 'active' | 'muted' | 'banned' | 'temp_suspended' | null;
  userModerationExpiresAt: string | null;
  userModerationReason: string | null;
}

function setStoreState(slice: ModerationSlice): void {
  mockUseStore.mockImplementation((selector: (s: ModerationSlice) => unknown) => selector(slice));
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

async function renderComponent() {
  const mod = await import('./AccountSuspended');
  const AccountSuspended = mod.default;
  return render(<AccountSuspended />);
}

describe('AccountSuspended', () => {
  it('renders headline + suspended-state copy', async () => {
    setStoreState({
      userModerationStatus: 'banned',
      userModerationExpiresAt: null,
      userModerationReason: null,
    });
    await renderComponent();
    const heading = screen.getByRole('heading', { level: 1 });
    expect(heading.textContent).toMatch(/account suspended/i);
  });

  it('renders appeals contact link (mailto:support@leanshot.app)', async () => {
    setStoreState({
      userModerationStatus: 'banned',
      userModerationExpiresAt: null,
      userModerationReason: null,
    });
    await renderComponent();
    const link = screen.getByRole('link', { name: /support@leanshot\.app/i });
    expect(link.getAttribute('href')).toBe('mailto:support@leanshot.app');
  });

  it('shows expires_at when status="temp_suspended"', async () => {
    setStoreState({
      userModerationStatus: 'temp_suspended',
      userModerationExpiresAt: '2026-12-31T00:00:00.000Z',
      userModerationReason: null,
    });
    await renderComponent();
    const heading = screen.getByRole('heading', { level: 1 });
    // toLocaleString output is locale-dependent; just assert a year fragment renders.
    expect(heading.textContent).toMatch(/until/i);
    expect(heading.textContent).toMatch(/2026/);
  });

  it('does NOT show "until" countdown when status="banned"', async () => {
    setStoreState({
      userModerationStatus: 'banned',
      userModerationExpiresAt: '2026-12-31T00:00:00.000Z', // present in slice but should be ignored
      userModerationReason: null,
    });
    await renderComponent();
    const heading = screen.getByRole('heading', { level: 1 });
    expect(heading.textContent).not.toMatch(/until/i);
  });

  it('renders reason text when present in store', async () => {
    setStoreState({
      userModerationStatus: 'banned',
      userModerationExpiresAt: null,
      userModerationReason: 'Violation of community guidelines',
    });
    await renderComponent();
    expect(screen.getByText(/violation of community guidelines/i)).toBeDefined();
  });

  it('accessible: role=alertdialog with aria-modal + h1 + keyboard-focusable mailto', async () => {
    setStoreState({
      userModerationStatus: 'banned',
      userModerationExpiresAt: null,
      userModerationReason: null,
    });
    const { container } = await renderComponent();
    const dialog = container.querySelector('[role="alertdialog"]');
    expect(dialog).not.toBeNull();
    expect(dialog!.getAttribute('aria-modal')).toBe('true');
    // h1 heading present
    expect(screen.getByRole('heading', { level: 1 })).toBeDefined();
    // mailto is an <a href> — natively keyboard focusable
    const link = screen.getByRole('link', { name: /support@leanshot\.app/i });
    expect(link.tagName).toBe('A');
  });
});
