/**
 * Phase 15 Plan 15-10 Task 2 — Authored `pricing` builder page.
 *
 * Per D-10 + D-14: `/pricing` is a normal builder page (slug `pricing`) authored
 * from the Pricing template scaffold. This module is the committed source of
 * the live page. It is consumed by:
 *
 *   • `e2e/fixtures/page-builder/seed-pricing-page.ts` — the e2e seed inserts
 *     this block tree directly into `landing_page_revisions.blocks` so
 *     the test renders the same page that production serves.
 *   • the manual one-time scaffold (D-14): a staff user imports this block
 *     tree once via the editor's Pricing template; subsequent edits live in
 *     the database. This file is the documented source of the initial scaffold.
 *
 * Pricing math (matches Phase 14 D-09 + leanshot/.env.example):
 *   plus_monthly: $12.99 / month
 *   plus_yearly:  $132.49 / year  ($12.99 × 12 × 0.85 = $132.49 — save 15%)
 *
 * SEO (PAGE-05): exported `PRICING_PAGE_SEO` keeps title ≤60 chars and
 * description ≤160 chars; `schemaType: 'Product'` matches the JSON-LD auto-
 * generator allowlist in `json-ld.ts`.
 */

import type { ComponentType } from 'react';
import type { Platform } from '@/lib/native/platform';
import type { BlockNode } from '@/lib/page-builder/block-schema';

// ─── per-page SEO (PAGE-05) ──────────────────────────────────────────────────

export const PRICING_PAGE_SEO = {
  /** ≤60 chars — keeps SERP truncation safe. */
  title: 'Pricing — LeanShot',
  /** ≤160 chars — keeps SERP truncation safe. */
  description:
    'Track your GLP-1 protocol with drug-level projection and injection-site rotation. Plus plan: $12.99/mo or $132.49/yr — save 15%.',
  /**
   * Absolute canonical — required for Lighthouse SEO score (relative `/pricing` flagged invalid).
   * Hard-coded to the marketing host because Edge-Function-side request origin is unreliable.
   */
  canonical: 'https://leanshot.app/pricing',
  /** Allowlisted by `generateJsonLd` in json-ld.ts. */
  schemaType: 'Product' as const,
};

// ─── block tree ──────────────────────────────────────────────────────────────

export const PRICING_PAGE_BLOCKS: BlockNode[] = [
  // 1. Hero — sets the page intent.
  {
    id: 'pricing-hero',
    type: 'hero',
    parent_id: null,
    order: 0,
    content: {
      heading: 'One simple plan. Cancel anytime.',
      subheading:
        'Drug-level projection. Site rotation. AI coach with your own provider key. Built for people on GLP-1s.',
      ctaLabel: 'Start free',
      ctaHref: '/',
      secondaryCtaLabel: 'See features',
      secondaryCtaHref: '#features',
    },
    style: {
      backgroundTone: 'brand',
      alignment: 'center',
      spacingDensity: 'spacious',
    },
  },

  // 2. Pricing — the two real plans the Stripe Checkout wires to.
  {
    id: 'pricing-plans',
    type: 'pricing',
    parent_id: null,
    order: 1,
    content: {
      eyebrow: 'Pricing',
      heading: 'Pick a cadence that works for you',
      plans: [
        {
          name: 'Plus monthly',
          price: '$12.99',
          cadence: '/month',
          features: [
            '28-day past + 7-day projected drug-level curve',
            'Injection-site rotation tracker',
            'AI coach (bring your own Anthropic key)',
            'Doctor-share read-only link',
            'Cancel anytime',
          ],
          ctaLabel: 'Get started',
          checkoutPlan: 'plus_monthly',
        },
        {
          name: 'Plus yearly',
          price: '$132.49',
          cadence: '/year',
          features: [
            'Everything in Plus monthly',
            'Save 15% versus paying monthly',
            'Annual data export bundle',
            'Priority email support',
          ],
          recommended: true,
          ctaLabel: 'Get started',
          checkoutPlan: 'plus_yearly',
        },
      ],
    },
    style: {
      backgroundTone: 'default',
      alignment: 'center',
      spacingDensity: 'spacious',
    },
  },

  // 3. Footer — minimal nav so the page is not an island.
  {
    id: 'pricing-footer',
    type: 'footer',
    parent_id: null,
    order: 2,
    content: {
      logoText: 'LeanShot',
      copyright: '© LeanShot. Not a medical device.',
      navLinks: [
        { label: 'Privacy', href: '/#/legal/privacy' },
        { label: 'Terms', href: '/#/legal/terms' },
        { label: 'Medical disclaimer', href: '/#/legal/disclaimer' },
      ],
    },
    style: {
      backgroundTone: 'dark',
      alignment: 'center',
      spacingDensity: 'default',
    },
  },
];

// ─── Phase 16 Plan 16-05 — platform-aware pricing component switch ────────────
/**
 * Returns the React component that should render `/pricing` on the current
 * platform.
 *
 * • ios / android → dynamic-imports `@/components/PricingIOS` so its body
 *   (and the @revenuecat/purchases-capacitor surface it uses) never enters
 *   the web entry chunk. The caller awaits the promise + renders the result.
 * • web / capacitor-web → null. The caller should fall back to rendering
 *   the existing `PRICING_PAGE_BLOCKS` tree (Phase 15 invariant).
 *
 * Used by the published `/pricing` runtime to keep Apple §3.1.1 / Google §3.1.1
 * compliance (StoreKit/Play Billing on native; Stripe Checkout on web) under
 * the SAME slug + the SAME SEO surface.
 */
export async function getPricingComponent(
  platform: Platform,
): Promise<ComponentType | null> {
  if (platform === 'ios' || platform === 'android') {
    const m = await import('@/components/PricingIOS');
    return m.default;
  }
  return null;
}
