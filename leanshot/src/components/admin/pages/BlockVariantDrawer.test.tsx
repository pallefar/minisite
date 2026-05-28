/**
 * Phase 39 Plan 39-09 — BlockVariantDrawer RTL coverage.
 *
 * Per plan <behavior>:
 *   (a) Sheet renders from right at 480px width — wraps Sheet primitive (we
 *       assert the Sheet contract via role="dialog" + aria-modal="true").
 *   (b) Shows existing variants when block.variant_set_id is set + variants
 *       are passed in.
 *   (c) "Add variant" CTA at bottom.
 *   (d) Save invokes onSave callback with variantBlocks payload.
 *   (e) Close restores focus to the triggering "Add variant" button.
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { BlockNode } from '@/lib/page-builder/block-schema';
import { BlockVariantDrawer } from './BlockVariantDrawer';

function makeBlock(overrides: Partial<BlockNode> = {}): BlockNode {
  return {
    id: 'h1',
    type: 'hero',
    parent_id: null,
    order: 0,
    content: { heading: 'Hello', subheading: '', ctaLabel: 'Go', ctaHref: '/x' },
    style: {},
    ...overrides,
  };
}

describe('BlockVariantDrawer', () => {
  it('renders the Sheet primitive when open (role=dialog + aria-modal)', () => {
    render(
      <BlockVariantDrawer open onClose={() => {}} block={makeBlock()} onSave={async () => {}} />,
    );
    const dialog = screen.getByRole('dialog');
    expect(dialog).toBeInTheDocument();
    expect(dialog).toHaveAttribute('aria-modal', 'true');
  });

  it('does NOT render when open=false', () => {
    render(
      <BlockVariantDrawer
        open={false}
        onClose={() => {}}
        block={makeBlock()}
        onSave={async () => {}}
      />,
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('shows the empty-state message when no variants are passed in', () => {
    render(
      <BlockVariantDrawer open onClose={() => {}} block={makeBlock()} onSave={async () => {}} />,
    );
    expect(screen.getByTestId('variant-list-empty')).toBeInTheDocument();
  });

  it('lists existing variants when block.variant_set_id is set + variants prop populated', () => {
    const block = makeBlock({ variant_set_id: 'vs-1' });
    const variants: BlockNode[] = [makeBlock({ id: 'h1-v1' }), makeBlock({ id: 'h1-v2' })];
    render(
      <BlockVariantDrawer
        open
        onClose={() => {}}
        block={block}
        variants={variants}
        onSave={async () => {}}
      />,
    );
    expect(screen.queryByTestId('variant-list-empty')).not.toBeInTheDocument();
    expect(screen.getByTestId('variant-row-0')).toHaveTextContent('h1-v1');
    expect(screen.getByTestId('variant-row-1')).toHaveTextContent('h1-v2');
  });

  it('renders the "Add variant" CTA at the bottom', () => {
    render(
      <BlockVariantDrawer open onClose={() => {}} block={makeBlock()} onSave={async () => {}} />,
    );
    expect(screen.getByTestId('drawer-add-variant')).toHaveTextContent('Add variant');
  });

  it('Save invokes onSave with the variantBlocks payload (canonical clone appended)', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const block = makeBlock({ id: 'h1' });
    render(
      <BlockVariantDrawer open onClose={() => {}} block={block} variants={[]} onSave={onSave} />,
    );
    const user = userEvent.setup();
    await user.click(screen.getByTestId('drawer-add-variant'));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    const payload = onSave.mock.calls[0]?.[0] as BlockNode[];
    expect(payload).toHaveLength(1);
    expect(payload[0]?.id).toBe('h1-v1');
    // Cloned from canonical, only the id differs.
    expect(payload[0]?.type).toBe('hero');
    expect(payload[0]?.content).toEqual(block.content);
  });

  it('Close restores focus to the triggering button (restoreFocusTo prop)', async () => {
    // Stand up a wrapper component that toggles `open` so we can drive the
    // open→closed transition that the focus-restoration effect listens for.
    function Harness() {
      const [open, setOpen] = useState(true);
      const triggerRef = (el: HTMLButtonElement | null) => {
        // Cache the trigger node on first render so the focus-restoration
        // effect can find it after close.
        if (el) Harness.triggerEl = el;
      };
      return (
        <>
          <button
            type="button"
            data-testid="trigger"
            ref={triggerRef}
            onClick={() => setOpen(true)}
          >
            Add variant
          </button>
          <BlockVariantDrawer
            open={open}
            onClose={() => setOpen(false)}
            block={makeBlock()}
            restoreFocusTo={Harness.triggerEl ?? null}
            onSave={async () => {}}
          />
        </>
      );
    }
    Harness.triggerEl = null as HTMLElement | null;

    render(<Harness />);
    const user = userEvent.setup();
    // Sanity: trigger button is in the DOM.
    expect(screen.getByTestId('trigger')).toBeInTheDocument();
    // Close the drawer via the explicit Close button (Escape would also
    // work via Sheet's own keydown listener but the test is more stable
    // when we drive the close path explicitly).
    await user.click(screen.getByTestId('drawer-close'));
    // The focus-restoration effect runs on the next tick. waitFor + the
    // effect's setTimeout(0) collapse to "next microtask"; vi.waitFor
    // retries until the assertion passes or the timeout (default ~1s).
    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByTestId('trigger'));
    });
  });
});
