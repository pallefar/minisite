/**
 * Phase 15 Plan 15-05 — PreviewPane tests.
 *
 * Covers (per 15-05-PLAN.md `<behavior>` for Task 3):
 *   - <iframe> renders with a non-empty title and sandbox attribute
 *   - three viewport toggle buttons (desktop/tablet/mobile), each with aria-label
 *     and aria-pressed; exactly one has aria-pressed=true at a time; default desktop
 *   - clicking tablet sets aria-pressed=true on tablet, false on desktop/mobile,
 *     and changes the iframe wrapper width to 768px
 *   - iframe src points at /{slug}?preview=true (same-origin staff draft)
 *   - Skeleton placeholder is shown until iframe onLoad fires
 */
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { PreviewPane } from './PreviewPane';

describe('PreviewPane', () => {
  it('renders an <iframe> with a non-empty title and a sandbox attribute', () => {
    const { container } = render(<PreviewPane pageSlug="test-slug" />);
    const iframe = container.querySelector('iframe');
    expect(iframe).toBeTruthy();
    const title = iframe!.getAttribute('title');
    expect(title).toBeTruthy();
    expect(title!.length).toBeGreaterThan(0);
    const sandbox = iframe!.getAttribute('sandbox');
    expect(sandbox).not.toBeNull();
    // Threat T-15-05-03: no top-navigation, no popups.
    expect(sandbox).not.toContain('allow-top-navigation');
    expect(sandbox).not.toContain('allow-popups');
  });

  it('renders three viewport toggle buttons, each with aria-label and aria-pressed; exactly one pressed; default desktop', () => {
    render(<PreviewPane pageSlug="x" />);
    const desktop = screen.getByRole('button', { name: /desktop/i });
    const tablet = screen.getByRole('button', { name: /tablet/i });
    const mobile = screen.getByRole('button', { name: /mobile/i });
    for (const btn of [desktop, tablet, mobile]) {
      expect(btn.getAttribute('aria-label')).toBeTruthy();
      expect(btn.getAttribute('aria-pressed')).toBeTruthy();
    }
    expect(desktop.getAttribute('aria-pressed')).toBe('true');
    expect(tablet.getAttribute('aria-pressed')).toBe('false');
    expect(mobile.getAttribute('aria-pressed')).toBe('false');
  });

  it('clicking tablet updates aria-pressed and the iframe wrapper width to 768px', async () => {
    const user = userEvent.setup();
    const { container } = render(<PreviewPane pageSlug="x" />);
    const tablet = screen.getByRole('button', { name: /tablet/i });
    await user.click(tablet);
    expect(tablet.getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: /desktop/i }).getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByRole('button', { name: /mobile/i }).getAttribute('aria-pressed')).toBe('false');
    // The iframe wrapper carries inline style with width=768px (or maxWidth).
    const wrapper = container.querySelector('[data-testid="preview-iframe-wrapper"]') as HTMLElement | null;
    expect(wrapper).toBeTruthy();
    const cssWidth = wrapper!.style.width || wrapper!.style.maxWidth;
    expect(cssWidth).toBe('768px');
  });

  it('the iframe src points at /{slug}?preview=true (same-origin staff draft)', () => {
    const { container } = render(<PreviewPane pageSlug="my-page" />);
    const iframe = container.querySelector('iframe')!;
    const src = iframe.getAttribute('src') ?? '';
    expect(src).toContain('my-page');
    expect(src).toContain('preview=true');
    // No cross-origin (no http:// http:// scheme prefix; starts with '/').
    expect(src.startsWith('/')).toBe(true);
  });

  it('shows a Skeleton placeholder until the iframe onLoad fires', () => {
    const { container } = render(<PreviewPane pageSlug="x" />);
    const skeletonBefore = container.querySelector('[data-testid="preview-skeleton"]');
    expect(skeletonBefore).toBeTruthy();
    // Fire the iframe's load event.
    const iframe = container.querySelector('iframe')!;
    fireEvent.load(iframe);
    const skeletonAfter = container.querySelector('[data-testid="preview-skeleton"]');
    expect(skeletonAfter).toBeNull();
  });
});
