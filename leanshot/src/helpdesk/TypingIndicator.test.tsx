/**
 * TypingIndicator.test.tsx — Phase 37 Plan 06 Task 3 RED→GREEN.
 *
 * Verifies:
 *  - Renders accessible "typing" message when typingUserIds is non-empty (aria-live=polite)
 *  - Returns null when typingUserIds is empty
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import TypingIndicator from './TypingIndicator';

describe('TypingIndicator', () => {
  it('renders a polite live-region with the typing message when list is non-empty', () => {
    render(<TypingIndicator typingUserIds={['user-1']} />);
    const region = screen.getByRole('status');
    expect(region).toHaveAttribute('aria-live', 'polite');
    expect(region.textContent).toMatch(/typing/i);
  });

  it('renders nothing when typingUserIds is empty', () => {
    const { container } = render(<TypingIndicator typingUserIds={[]} />);
    expect(container.firstChild).toBeNull();
  });
});
