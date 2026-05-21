/**
 * Phase 40 Plan 40-07 D-07 — PausedBanner unit tests.
 *
 * 4 cases covering: null renders when not paused, visible with correct
 * D-07 verbatim copy when paused, CTA dispatches leanshot:open-settings,
 * and reduced-motion fallback renders without motion.div.
 *
 * vi.mock() calls are hoisted by vitest to module scope.
 */
import { render, screen, fireEvent } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { useStore } from '@/lib/store';

// ─── Mocks ───────────────────────────────────────────────────────────────────

vi.mock('@/lib/store', () => ({
  useStore: vi.fn(),
}));

vi.mock('@/hooks/useReducedMotion', () => ({
  useReducedMotion: vi.fn(),
}));

// Mock framer-motion so AnimatePresence/motion.div render without JSDOM warnings
vi.mock('framer-motion', () => ({
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  motion: {
    div: ({
      children,
      ...props
    }: React.HTMLAttributes<HTMLDivElement> & { children?: React.ReactNode }) => (
      <div data-testid="motion-div" {...props}>
        {children}
      </div>
    ),
  },
}));

const mockUseStore = useStore as unknown as ReturnType<typeof vi.fn>;
const mockUseReducedMotion = useReducedMotion as unknown as ReturnType<typeof vi.fn>;

function setStoreState(is_paused: boolean, paused_until: string | null): void {
  // useStore is called twice (once for is_paused, once for paused_until)
  // mock returns the selected value for each call
  mockUseStore.mockImplementation(
    (selector: (s: { is_paused: boolean; paused_until: string | null }) => unknown) =>
      selector({ is_paused, paused_until }),
  );
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

// ─── Tests ────────────────────────────────────────────────────────────────────

async function renderBanner() {
  const { PausedBanner } = await import('./PausedBanner');
  return render(<PausedBanner />);
}

describe('PausedBanner', () => {
  it('case (a): renders null when is_paused=false', async () => {
    setStoreState(false, null);
    mockUseReducedMotion.mockReturnValue(false);
    const { container } = await renderBanner();
    expect(container.firstChild).toBeNull();
  });

  it('case (b): visible with D-07 copy + date when is_paused=true', async () => {
    setStoreState(true, '2026-08-01T00:00:00.000Z');
    mockUseReducedMotion.mockReturnValue(false);
    await renderBanner();
    const status = screen.getByRole('status');
    expect(status).toBeDefined();
    expect(status.getAttribute('aria-live')).toBe('polite');
    // D-07 verbatim copy check (locale-tolerant)
    const text = status.textContent ?? '';
    expect(text).toMatch(/Your account is paused/i);
    expect(text).toMatch(/logging resumes .+\.\s*Resume now\?/i);
    // "Resume now?" CTA is present
    expect(screen.getByRole('button', { name: /Resume now\?/i })).toBeDefined();
  });

  it('case (c): CTA dispatches leanshot:open-settings event', async () => {
    setStoreState(true, '2026-08-01T00:00:00.000Z');
    mockUseReducedMotion.mockReturnValue(false);
    const dispatchSpy = vi.spyOn(window, 'dispatchEvent');

    await renderBanner();
    const button = screen.getByRole('button', { name: /Resume now\?/i });
    fireEvent.click(button);

    expect(dispatchSpy).toHaveBeenCalledOnce();
    const calledEvent = dispatchSpy.mock.calls[0][0] as CustomEvent;
    expect(calledEvent.type).toBe('leanshot:open-settings');
  });

  it('case (d): reduced-motion=true renders static block (no motion-div)', async () => {
    setStoreState(true, '2026-08-01T00:00:00.000Z');
    mockUseReducedMotion.mockReturnValue(true);
    await renderBanner();
    // Banner is still visible
    const status = screen.getByRole('status');
    expect(status).toBeDefined();
    // No framer-motion wrapper when reduced motion is active
    expect(screen.queryByTestId('motion-div')).toBeNull();
  });
});
