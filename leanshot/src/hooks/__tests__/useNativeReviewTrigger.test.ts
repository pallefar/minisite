/**
 * Phase 36 Plan 36-02 Task 3 — useNativeReviewTrigger hook tests.
 *
 * Asserts the v1.3 web no-op contract + V13-3 unconditional-wiring living
 * documentation. The v1.4 mobile-shell phase replaces review-shim.ts; the
 * hook API tested here MUST remain stable across that migration.
 */
import { describe, expect, it } from 'vitest';
import { useNativeReviewTrigger } from '@/hooks/useNativeReviewTrigger';
import { reviewShim } from '@/lib/native/review-shim';

describe('useNativeReviewTrigger (D-20 v1.3 web no-op)', () => {
  it('returns { shown: false } synchronously on web', async () => {
    const trigger = useNativeReviewTrigger();
    await expect(trigger.request()).resolves.toEqual({ shown: false });
  });

  it('reviewShim.request() also returns { shown: false } directly (contract surface)', async () => {
    await expect(reviewShim.request()).resolves.toEqual({ shown: false });
  });

  it('hook is callable outside a React render context (pure — no useState/useEffect deps in v1.3)', () => {
    // The hook returns synchronously without touching React internals. This
    // proves it does not violate Rules of Hooks if a call site invokes it
    // from a non-render code path (event handler, lib function, etc.).
    const trigger = useNativeReviewTrigger();
    expect(typeof trigger.request).toBe('function');
  });

  it('V13-3 unconditional usage (living documentation): trigger.request() called without a rating-conditioned ancestor PASSES', async () => {
    // The ESLint rule from Plan 36-01 BLOCKS conditional invocations whose
    // predicate references rating identifiers. This test fixture
    // demonstrates the COMPLIANT pattern (the only intended call site
    // shape):
    //
    //   const trigger = useNativeReviewTrigger();
    //   onActivationCompleted(() => trigger.request());   // UNCONDITIONAL ✓
    //
    // NOT this (V13-3 BLOCKER trips):
    //
    //   if (npsRating >= 4) trigger.request();           // rating-conditioned ✗
    //
    const trigger = useNativeReviewTrigger();
    const result = await trigger.request();
    expect(result.shown).toBe(false);
  });
});
