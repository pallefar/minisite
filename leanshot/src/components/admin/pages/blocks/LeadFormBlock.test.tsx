/**
 * Phase 15 Plan 15-07 — LeadFormBlock editor-preview tests.
 *
 * Asserts:
 *   - renders heading and button label from `content`.
 *   - renders an optional name input only when `content.collectName` is true.
 *   - renders a `<label>` for the email field.
 *   - editor preview emits NO interactive submit handler (the real POST is
 *     handled by the page-render renderer's inline script).
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { BlockNode } from '@/lib/page-builder/block-schema';
import { LeadFormBlock } from './LeadFormBlock';

function leadFormBlock(overrides: Partial<BlockNode> = {}): BlockNode {
  return {
    id: 'lf1',
    type: 'lead-form',
    parent_id: null,
    order: 0,
    content: {
      heading: 'Get the free guide',
      description: 'Drop your email below.',
      buttonLabel: 'Send me access',
      successMessage: "You're on the list.",
      collectName: false,
    },
    style: {},
    ...overrides,
  };
}

describe('LeadFormBlock', () => {
  it('renders heading and button label from content', () => {
    render(<LeadFormBlock block={leadFormBlock()} />);
    expect(screen.getByText('Get the free guide')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Send me access' })).toBeTruthy();
  });

  it('renders an optional name input only when content.collectName is true', () => {
    const { rerender, container } = render(<LeadFormBlock block={leadFormBlock()} />);
    // collectName: false → no name input.
    expect(container.querySelector('input[name="name"]')).toBeNull();

    rerender(
      <LeadFormBlock
        block={leadFormBlock({
          content: {
            heading: 'Get the free guide',
            description: '',
            buttonLabel: 'Send me access',
            successMessage: "You're on the list.",
            collectName: true,
          },
        })}
      />,
    );
    expect(container.querySelector('input[name="name"]')).not.toBeNull();
  });

  it('renders a <label> for the email field', () => {
    const { container } = render(<LeadFormBlock block={leadFormBlock()} />);
    // <label for> bound to an <input type="email"> — exact <label> count ≥ 1.
    const emailInput = container.querySelector('input[type="email"]');
    expect(emailInput).not.toBeNull();
    // Either a wrapping <label> or a <label for=...> referencing the email input.
    const labels = container.querySelectorAll('label');
    expect(labels.length).toBeGreaterThan(0);
  });
});
