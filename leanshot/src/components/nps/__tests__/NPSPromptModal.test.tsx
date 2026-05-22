/**
 * Phase 36 Plan 36-03 Task 1 — NPSPromptModal (Surface A) tests.
 *
 * Covers:
 *   - 5 role="radio" stars inside role="radiogroup".
 *   - Submit disabled until a star is chosen.
 *   - Click star N → aria-checked toggles on Nth star; submit enabled.
 *   - Submit click → onRate called with N.
 *   - Arrow-key nav moves focus across stars (Home/End/ArrowLeft/ArrowRight).
 *   - Enter/Space selects the focused star.
 *   - Backdrop click → onDismiss invoked.
 *   - useReducedMotion=true → star buttons render WITHOUT the transition class.
 *
 * V13-3 self-check (also enforced by the project-level grep gate +
 * eslint-rules/no-conditional-native-review): the component file does NOT
 * import useNativeReviewTrigger or review-shim.
 */
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Strip block + line comments before scanning a source file for forbidden
 * tokens. Mirrors the comment-stripping convention used by the project-level
 * grep gate (leanshot/scripts/check-no-conditional-native-review.sh) — JSDoc
 * references to the very tokens we're forbidding must not self-invalidate
 * the gate.
 */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '') // block comments
    .replace(/^\s*\/\/.*$/gm, ''); // line comments
}

// --- Mock useReducedMotion per-test ---------------------------------------
const reducedMotionMock = vi.fn<() => boolean>(() => false);
vi.mock('@/hooks/useReducedMotion', () => ({
  useReducedMotion: () => reducedMotionMock(),
}));

import { NPSPromptModal } from '../NPSPromptModal';

describe('<NPSPromptModal /> — Plan 36-03 Task 1', () => {
  beforeEach(() => {
    reducedMotionMock.mockReturnValue(false);
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('renders role="dialog" and 5 role="radio" stars inside role="radiogroup"', () => {
    render(<NPSPromptModal open onRate={vi.fn()} onDismiss={vi.fn()} />);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    const group = screen.getByRole('radiogroup');
    expect(group).toBeInTheDocument();
    expect(group).toHaveAttribute(
      'aria-label',
      'How likely are you to recommend LeanShot? 1 to 5 stars.',
    );
    const stars = screen.getAllByRole('radio');
    expect(stars).toHaveLength(5);
    for (let i = 1; i <= 5; i++) {
      expect(stars[i - 1]).toHaveAttribute('aria-label', `Rate ${i} of 5 stars`);
    }
  });

  it('Submit is disabled until a star is selected; enables after click; calls onRate(N) on submit', async () => {
    const user = userEvent.setup();
    const onRate = vi.fn();
    render(<NPSPromptModal open onRate={onRate} onDismiss={vi.fn()} />);

    const submit = screen.getByRole('button', { name: 'Submit rating' });
    expect(submit).toBeDisabled();

    const stars = screen.getAllByRole('radio');
    await user.click(stars[2]); // star 3
    expect(stars[2]).toHaveAttribute('aria-checked', 'true');
    expect(submit).toBeEnabled();

    await user.click(submit);
    expect(onRate).toHaveBeenCalledWith(3);
  });

  it('ArrowRight from star 1 moves focus to star 2', async () => {
    render(<NPSPromptModal open onRate={vi.fn()} onDismiss={vi.fn()} />);
    const stars = screen.getAllByRole('radio');
    stars[0].focus();
    expect(document.activeElement).toBe(stars[0]);
    fireEvent.keyDown(stars[0], { key: 'ArrowRight' });
    expect(document.activeElement).toBe(stars[1]);
  });

  it('ArrowLeft, Home, End keyboard navigation', () => {
    render(<NPSPromptModal open onRate={vi.fn()} onDismiss={vi.fn()} />);
    const stars = screen.getAllByRole('radio');
    stars[3].focus();
    fireEvent.keyDown(stars[3], { key: 'ArrowLeft' });
    expect(document.activeElement).toBe(stars[2]);
    fireEvent.keyDown(stars[2], { key: 'Home' });
    expect(document.activeElement).toBe(stars[0]);
    fireEvent.keyDown(stars[0], { key: 'End' });
    expect(document.activeElement).toBe(stars[4]);
  });

  it('Enter selects the focused star', () => {
    render(<NPSPromptModal open onRate={vi.fn()} onDismiss={vi.fn()} />);
    const stars = screen.getAllByRole('radio');
    stars[3].focus();
    fireEvent.keyDown(stars[3], { key: 'Enter' });
    expect(stars[3]).toHaveAttribute('aria-checked', 'true');
  });

  it('Space selects the focused star', () => {
    render(<NPSPromptModal open onRate={vi.fn()} onDismiss={vi.fn()} />);
    const stars = screen.getAllByRole('radio');
    stars[1].focus();
    fireEvent.keyDown(stars[1], { key: ' ' });
    expect(stars[1]).toHaveAttribute('aria-checked', 'true');
  });

  it('Backdrop click invokes onDismiss', () => {
    const onDismiss = vi.fn();
    render(<NPSPromptModal open onRate={vi.fn()} onDismiss={onDismiss} />);
    // The DS Modal primitive treats the outer backdrop layer as a click
    // surface when dismissible=true; click the dialog backdrop (parent of
    // the inner panel) to trigger close.
    const backdrop = screen.getByRole('dialog');
    fireEvent.click(backdrop);
    expect(onDismiss).toHaveBeenCalled();
  });

  it('Close (X) button invokes onDismiss', async () => {
    const user = userEvent.setup();
    const onDismiss = vi.fn();
    render(<NPSPromptModal open onRate={vi.fn()} onDismiss={onDismiss} />);
    const close = screen.getByRole('button', { name: 'Close' });
    await user.click(close);
    expect(onDismiss).toHaveBeenCalled();
  });

  it('renders WITHOUT transition class when useReducedMotion=true', () => {
    reducedMotionMock.mockReturnValue(true);
    render(<NPSPromptModal open onRate={vi.fn()} onDismiss={vi.fn()} />);
    const stars = screen.getAllByRole('radio');
    for (const s of stars) {
      // No transition utility class present when reduced motion is on.
      expect(s.className).not.toMatch(/transition-colors|transition-\[/);
    }
  });

  it('renders WITH transition class when useReducedMotion=false', () => {
    reducedMotionMock.mockReturnValue(false);
    render(<NPSPromptModal open onRate={vi.fn()} onDismiss={vi.fn()} />);
    const stars = screen.getAllByRole('radio');
    expect(stars[0].className).toMatch(/transition-colors/);
  });

  it('V13-3 self-check: the source file does NOT import useNativeReviewTrigger or review-shim (comment-stripped)', () => {
    const filePath = resolve(__dirname, '..', 'NPSPromptModal.tsx');
    const source = stripComments(readFileSync(filePath, 'utf8'));
    expect(source).not.toMatch(/useNativeReviewTrigger/);
    expect(source).not.toMatch(/review-shim/);
    expect(source).not.toMatch(/from ['"]@\/lib\/supabase/);
  });

  it('forbidden-copy check: no "30 days" / "lifetime" / "you\'ll see this" strings (comment-stripped)', () => {
    const filePath = resolve(__dirname, '..', 'NPSPromptModal.tsx');
    const source = stripComments(readFileSync(filePath, 'utf8'));
    expect(source).not.toMatch(/30 days/i);
    expect(source).not.toMatch(/lifetime/i);
    expect(source).not.toMatch(/you'll see this/i);
  });
});
