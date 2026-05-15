/**
 * Phase 15 Plan 15-10 Task 1 — STUB.
 *
 * Task 2 of this same plan overwrites this file with the authored pricing
 * builder page block tree + SEO. This stub exists ONLY so that the Task 1
 * e2e fixture + spec can resolve their import + Playwright can discover the
 * tests before Task 2 lands.
 *
 * DO NOT consume the stub values — they are intentionally empty and will be
 * replaced. The HAS_LIVE-gated tests using these exports skip cleanly when
 * env is missing, so the stub never reaches a real assertion path.
 */

import type { BlockNode } from '@/lib/page-builder/block-schema';

export const PRICING_PAGE_BLOCKS: BlockNode[] = [];

export const PRICING_PAGE_SEO = {
  title: '',
  description: '',
  schemaType: 'WebPage' as const,
};
