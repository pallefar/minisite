/**
 * Phase 15 Plan 15-05 — FAQBlock + PricingBlock + property-configs + PropertyPanel tests.
 *
 * Covers (per 15-05-PLAN.md `<behavior>` for Task 2):
 *   - FAQBlock renders one accordion trigger per content.items entry; each trigger
 *     has aria-expanded reflecting open state; clicking a trigger toggles
 *     aria-expanded and reveals the panel (role=region).
 *   - FAQBlock with markup in q renders it as visible text (React escape).
 *   - PricingBlock renders the price in a Geist Mono token class and a CTA element
 *     with Button-primary token classes (no Stripe call).
 *   - property-configs exports a config entry for each of the 5 new block types;
 *     each config lists only content fields + token-bounded style controls.
 *   - PropertyPanel given a selected block of each new type resolves the new types.
 */
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { BlockNode } from '@/lib/page-builder/block-schema';
import { PROPERTY_CONFIGS } from '../editor/property-configs';
import { PropertyPanel } from '../editor/PropertyPanel';
import { FAQBlock } from './FAQBlock';
import { PricingBlock } from './PricingBlock';

function faqBlock(): BlockNode {
  return {
    id: 'fa1',
    type: 'faq',
    parent_id: null,
    order: 0,
    content: {
      heading: 'Frequently asked questions',
      items: [
        { q: 'First question?', a: 'First answer.' },
        { q: 'Second question?', a: 'Second answer.' },
      ],
    },
    style: {},
  };
}

function pricingBlock(): BlockNode {
  return {
    id: 'pr1',
    type: 'pricing',
    parent_id: null,
    order: 0,
    content: {
      heading: 'Pricing',
      plans: [
        {
          name: 'Plus',
          price: '$12.99',
          cadence: '/month',
          features: ['Feature A', 'Feature B'],
          ctaLabel: 'Get started',
        },
      ],
    },
    style: {},
  };
}

describe('FAQBlock', () => {
  it('renders one accordion trigger per content.items entry with aria-expanded=false by default', () => {
    render(<FAQBlock block={faqBlock()} />);
    const triggers = screen.getAllByRole('button', { expanded: false });
    expect(triggers).toHaveLength(2);
    expect(triggers[0]).toHaveTextContent('First question?');
    expect(triggers[1]).toHaveTextContent('Second question?');
  });

  it('clicking a trigger toggles aria-expanded and exposes the panel via role=region', async () => {
    const user = userEvent.setup();
    render(<FAQBlock block={faqBlock()} />);
    const firstTrigger = screen.getAllByRole('button')[0]!;
    expect(firstTrigger).toHaveAttribute('aria-expanded', 'false');
    await user.click(firstTrigger);
    expect(firstTrigger).toHaveAttribute('aria-expanded', 'true');
    // Panel exists with role=region — find the panel id from aria-controls.
    const panelId = firstTrigger.getAttribute('aria-controls');
    expect(panelId).toBeTruthy();
    const panel = document.getElementById(panelId!);
    expect(panel).toBeTruthy();
    expect(panel!.getAttribute('role')).toBe('region');
    expect(panel!).toHaveTextContent('First answer.');
  });

  it('renders item q as text (React escapes by default — no DOM injection)', () => {
    const block: BlockNode = {
      ...faqBlock(),
      content: {
        heading: 'FAQ',
        items: [{ q: '<script>alert(1)</script>', a: 'safe' }],
      },
    };
    render(<FAQBlock block={block} />);
    const trigger = screen.getByRole('button');
    // React renders the markup as text content, NOT as DOM.
    expect(trigger.textContent).toContain('<script>alert(1)</script>');
    // Confirm no <script> element was injected.
    expect(trigger.querySelector('script')).toBeNull();
  });
});

describe('PricingBlock', () => {
  it('renders the price string with the Geist Mono token class', () => {
    const { container } = render(<PricingBlock block={pricingBlock()} />);
    // The price element carries the Geist Mono class hook.
    const priceEl = container.querySelector('.block-pricing__price');
    expect(priceEl).toBeTruthy();
    expect(priceEl!.textContent).toContain('$12.99');
    // The component applies a font-family rooted in Geist Mono via inline style or class.
    // We assert the class hook is present (consumers verify token bounds).
    expect(priceEl!.className).toMatch(/font-\[Geist_Mono/);
  });

  it('renders the CTA as a button element with Button-primary token classes and a non-empty aria-label', () => {
    render(<PricingBlock block={pricingBlock()} />);
    const cta = screen.getByRole('button', { name: /get started/i });
    expect(cta).toBeTruthy();
    expect(cta.getAttribute('aria-label')).toBeTruthy();
    expect(cta.getAttribute('aria-label')!.length).toBeGreaterThan(0);
    // Button-primary uses --color-primary background token.
    expect(cta.className).toMatch(/bg-\[var\(--color-primary\)\]/);
    // 15-10 wires Stripe; this plan: no Stripe call attached.
    // Verify the button has no onClick prop wired (jsdom can't introspect React props,
    // but we can verify no data-stripe-* attributes exist).
    expect(cta.getAttribute('data-stripe')).toBeNull();
  });

  it('applies the selected-card teal-ring marker class on a recommended plan', () => {
    const block: BlockNode = {
      ...pricingBlock(),
      content: {
        heading: 'Pricing',
        plans: [
          {
            name: 'Recommended',
            price: '$132.49',
            cadence: '/year',
            features: ['x'],
            ctaLabel: 'Go',
            recommended: true,
          },
        ],
      },
    };
    const { container } = render(<PricingBlock block={block} />);
    const recommendedPlan = container.querySelector('.block-pricing__plan--recommended');
    expect(recommendedPlan).toBeTruthy();
  });
});

describe('property-configs', () => {
  it('exports a config entry for each of the 5 new block types', () => {
    expect(PROPERTY_CONFIGS).toBeTypeOf('object');
    for (const type of ['faq', 'pricing', 'testimonial', 'feature-grid', 'image-text'] as const) {
      expect(PROPERTY_CONFIGS[type]).toBeDefined();
      expect(Array.isArray(PROPERTY_CONFIGS[type].contentFields)).toBe(true);
    }
  });

  it('each config lists only token-bounded style controls — no hex/color-picker/typography fields', () => {
    for (const type of ['faq', 'pricing', 'testimonial', 'feature-grid', 'image-text'] as const) {
      const fields = PROPERTY_CONFIGS[type].contentFields;
      // Defensive: scan field kinds.
      for (const field of fields) {
        expect(field.kind).not.toBe('color');
        expect(field.kind).not.toBe('typography');
        expect(field.kind).not.toBe('hex');
      }
    }
  });
});

describe('PropertyPanel — 5 new block types resolve', () => {
  it.each(['faq', 'pricing', 'testimonial', 'feature-grid', 'image-text'] as const)(
    'renders the content fields for %s',
    (type) => {
      const block: BlockNode = {
        id: 't',
        type,
        parent_id: null,
        order: 0,
        content: {},
        style: {},
      };
      const { container } = render(
        <PropertyPanel selectedBlockId={'t'} blocks={[block]} onChange={() => {}} />,
      );
      // Heading reflects the type
      const header = within(container).getByText(
        new RegExp('^' + type.charAt(0).toUpperCase() + type.slice(1), 'i'),
      );
      expect(header).toBeTruthy();
      // For the 5 new types the panel must NOT show the placeholder fallback copy.
      expect(container.textContent ?? '').not.toContain('land in a later plan');
    },
  );
});
