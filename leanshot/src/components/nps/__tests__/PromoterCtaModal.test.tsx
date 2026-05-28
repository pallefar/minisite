/**
 * Phase 36 Plan 36-03 Task 2 — PromoterCtaModal (Surface B) tests.
 *
 * Coverage:
 *   - Empty ctaSet → "Thanks for the rating!" fallback + auto-dismiss at 1500ms.
 *   - 1-item ctaSet → 1 primary "Review on {DisplayName}" button; click invokes
 *     logCtaClick(slug) (fire-and-forget) + window.open(url_pattern, '_blank',
 *     'noopener,noreferrer') + onDismiss.
 *   - 2-item ctaSet → 2 buttons in order; body line mentions the first item's
 *     display name.
 *   - W9 — window.open URL argument comes directly from the prop's url_pattern
 *     (asserted via mock call args).
 *   - Forbidden copy: no "Apple App Store" / "Google Play" in rendered HTML
 *     OR in the source file (comment-stripped).
 *   - W9 self-check — the source file has zero `supabase` references
 *     (comment-stripped).
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PromoterCtaModal } from '../PromoterCtaModal';

// --- Mock decide-client ---------------------------------------------------
const mockLogCtaClick = vi.fn<(slug: string) => Promise<void>>(() => Promise.resolve());
vi.mock('@/lib/nps/decide-client', () => ({
  logCtaClick: (slug: string) => mockLogCtaClick(slug),
}));

// --- Mock window.open -----------------------------------------------------
const mockOpen = vi.fn();

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

describe('<PromoterCtaModal /> — Plan 36-03 Task 2 (W9 embedded url_pattern)', () => {
  beforeEach(() => {
    mockLogCtaClick.mockReset();
    mockLogCtaClick.mockResolvedValue(undefined);
    mockOpen.mockReset();
    vi.stubGlobal('open', mockOpen);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('empty ctaSet → "Thanks for the rating!" fallback + auto-dismiss at 1500ms', () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();
    render(<PromoterCtaModal open ctaSet={[]} onDismiss={onDismiss} />);
    expect(screen.getByText(/Thanks for the rating!/i)).toBeInTheDocument();
    // No CTA buttons.
    expect(screen.queryByRole('button', { name: /Review on/i })).toBeNull();
    // Auto-dismiss after 1500ms.
    expect(onDismiss).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1500);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('1-item ctaSet trustpilot → renders "Review on Trustpilot" + invokes logCtaClick + window.open + onDismiss', async () => {
    const user = userEvent.setup();
    const onDismiss = vi.fn();
    render(
      <PromoterCtaModal
        open
        ctaSet={[
          {
            slug: 'trustpilot',
            url_pattern: 'https://www.trustpilot.com/review/leanshot.app',
          },
        ]}
        onDismiss={onDismiss}
      />,
    );
    const btn = screen.getByRole('button', { name: /Review on Trustpilot/i });
    expect(btn).toBeInTheDocument();
    await user.click(btn);
    expect(mockLogCtaClick).toHaveBeenCalledWith('trustpilot');
    expect(mockOpen).toHaveBeenCalledWith(
      'https://www.trustpilot.com/review/leanshot.app',
      '_blank',
      'noopener,noreferrer',
    );
    expect(onDismiss).toHaveBeenCalled();
  });

  it('W9 — window.open URL argument is read from prop.url_pattern (not a hard-coded map)', async () => {
    const user = userEvent.setup();
    const customUrl = 'https://www.trustpilot.com/review/CUSTOM-PATH-PROOF';
    render(
      <PromoterCtaModal
        open
        ctaSet={[{ slug: 'trustpilot', url_pattern: customUrl }]}
        onDismiss={vi.fn()}
      />,
    );
    await user.click(screen.getByRole('button', { name: /Review on Trustpilot/i }));
    expect(mockOpen.mock.calls[0][0]).toBe(customUrl);
  });

  it('2-item ctaSet (g2 + capterra) → 2 buttons in order; body mentions G2 (first)', () => {
    render(
      <PromoterCtaModal
        open
        ctaSet={[
          { slug: 'g2', url_pattern: 'https://www.g2.com/products/leanshot' },
          {
            slug: 'capterra',
            url_pattern: 'https://www.capterra.com/p/leanshot/',
          },
        ]}
        onDismiss={vi.fn()}
      />,
    );
    const buttons = screen.getAllByRole('button', { name: /Review on/i });
    expect(buttons).toHaveLength(2);
    expect(buttons[0]).toHaveAccessibleName(/Review on G2/i);
    expect(buttons[1]).toHaveAccessibleName(/Review on Capterra/i);
    // Body line mentions the first item's display name.
    expect(screen.getByText(/share your experience on G2/i)).toBeInTheDocument();
  });

  it('rendered HTML contains zero "Apple App Store" / "Google Play" mentions', () => {
    const { container } = render(
      <PromoterCtaModal
        open
        ctaSet={[{ slug: 'trustpilot', url_pattern: 'https://x.example/' }]}
        onDismiss={vi.fn()}
      />,
    );
    expect(container.textContent ?? '').not.toMatch(/Apple App Store/i);
    expect(container.textContent ?? '').not.toMatch(/Google Play/i);
  });

  it('"Not now" secondary button invokes onDismiss', async () => {
    const user = userEvent.setup();
    const onDismiss = vi.fn();
    render(
      <PromoterCtaModal
        open
        ctaSet={[{ slug: 'trustpilot', url_pattern: 'https://x.example/' }]}
        onDismiss={onDismiss}
      />,
    );
    await user.click(screen.getByRole('button', { name: /Not now/i }));
    expect(onDismiss).toHaveBeenCalled();
  });

  it('logCtaClick is fire-and-forget — window.open + onDismiss happen even if logCtaClick rejects', async () => {
    const user = userEvent.setup();
    mockLogCtaClick.mockRejectedValueOnce(new Error('network'));
    const onDismiss = vi.fn();
    render(
      <PromoterCtaModal
        open
        ctaSet={[{ slug: 'trustpilot', url_pattern: 'https://x.example/' }]}
        onDismiss={onDismiss}
      />,
    );
    await user.click(screen.getByRole('button', { name: /Review on Trustpilot/i }));
    expect(mockOpen).toHaveBeenCalled();
    expect(onDismiss).toHaveBeenCalled();
  });

  it('W9 self-check: source file has zero `supabase` references (comment-stripped)', () => {
    const filePath = resolve(__dirname, '..', 'PromoterCtaModal.tsx');
    const source = stripComments(readFileSync(filePath, 'utf8'));
    expect(source).not.toMatch(/supabase/);
  });

  it('D-13 self-check: source file has zero "Apple App Store" / "Google Play" strings', () => {
    const filePath = resolve(__dirname, '..', 'PromoterCtaModal.tsx');
    const source = stripComments(readFileSync(filePath, 'utf8'));
    expect(source).not.toMatch(/Apple App Store/i);
    expect(source).not.toMatch(/Google Play/i);
  });

  it('V13-3 self-check: source file does not import useNativeReviewTrigger or review-shim', () => {
    const filePath = resolve(__dirname, '..', 'PromoterCtaModal.tsx');
    const source = stripComments(readFileSync(filePath, 'utf8'));
    expect(source).not.toMatch(/useNativeReviewTrigger/);
    expect(source).not.toMatch(/review-shim/);
  });
});
