/**
 * Phase 36 Plan 36-03 Task 3 — analytics-trigger-bus + useNPSPromptListener
 * + analytics.ts patch integration tests.
 *
 * Tests cover:
 *   - analytics-trigger-bus: dispatch helper + type guard + event constant.
 *   - useNPSPromptListener: subscribes on mount; on admissible event, calls
 *     decideNpsTrigger AND useNativeReviewTrigger().request() in parallel,
 *     unconditionally (D-17 + D-20).
 *   - Hook ignores events whose EVENTS[name].nps_trigger_eligible !== true.
 *   - setRating / reset state transitions for the host component.
 *   - W4 wiring contract: dispatchAnalyticsTrigger fires listeners registered
 *     via addEventListener(ANALYTICS_TRIGGER_EVENT, …).
 *   - V13-3 self-check (comment-stripped): no rating-aware predicate
 *     wrapping the .request() / decideNpsTrigger call sites.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import '@testing-library/jest-dom/vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useNPSPromptListener } from '@/hooks/useNPSPromptListener';
import {
  ANALYTICS_TRIGGER_EVENT,
  dispatchAnalyticsTrigger,
  isAnalyticsTriggerDetail,
} from '@/lib/nps/analytics-trigger-bus';

// --- Mocks ---------------------------------------------------------------
const mockDecide = vi.fn();
vi.mock('@/lib/nps/decide-client', () => ({
  decideNpsTrigger: (eventName: string) => mockDecide(eventName),
}));

const mockRequest = vi.fn<() => Promise<{ shown: boolean }>>(() =>
  Promise.resolve({ shown: false }),
);
vi.mock('@/hooks/useNativeReviewTrigger', () => ({
  useNativeReviewTrigger: () => ({ request: mockRequest }),
}));

// The events registry is consulted at runtime — we stub the relevant entries.
vi.mock('@/lib/analytics/events', () => ({
  EVENTS: {
    activation_completed: {
      name: 'activation_completed',
      version: 1,
      phi: false,
      owner: 'product',
      nps_trigger_eligible: true,
      description: '',
      payload: { parse: () => ({}) },
    },
    not_eligible_event: {
      name: 'not_eligible_event',
      version: 1,
      phi: false,
      owner: 'product',
      // nps_trigger_eligible: undefined
      description: '',
      payload: { parse: () => ({}) },
    },
  },
}));

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

describe('analytics-trigger-bus — W4 contract', () => {
  it('exports ANALYTICS_TRIGGER_EVENT constant = "leanshot:analytics-event"', () => {
    expect(ANALYTICS_TRIGGER_EVENT).toBe('leanshot:analytics-event');
  });

  it('isAnalyticsTriggerDetail accepts { name: string }', () => {
    expect(isAnalyticsTriggerDetail({ name: 'x' })).toBe(true);
    expect(isAnalyticsTriggerDetail({ name: 'x', properties: { a: 1 } })).toBe(true);
  });

  it('isAnalyticsTriggerDetail rejects invalid detail', () => {
    expect(isAnalyticsTriggerDetail(null)).toBe(false);
    expect(isAnalyticsTriggerDetail(undefined)).toBe(false);
    expect(isAnalyticsTriggerDetail({})).toBe(false);
    expect(isAnalyticsTriggerDetail({ name: 123 })).toBe(false);
    expect(isAnalyticsTriggerDetail({ name: '' })).toBe(false);
  });

  it('dispatchAnalyticsTrigger fires window listeners with matching detail', () => {
    const handler = vi.fn();
    const onEvent = (e: Event): void => {
      const ev = e as CustomEvent<unknown>;
      handler(ev.detail);
    };
    window.addEventListener(ANALYTICS_TRIGGER_EVENT, onEvent);
    dispatchAnalyticsTrigger({ name: 'activation_completed' });
    expect(handler).toHaveBeenCalledWith({ name: 'activation_completed' });
    window.removeEventListener(ANALYTICS_TRIGGER_EVENT, onEvent);
  });
});

describe('useNPSPromptListener — Plan 36-03 Task 3', () => {
  beforeEach(() => {
    mockDecide.mockReset();
    mockRequest.mockReset();
    mockRequest.mockResolvedValue({ shown: false });
  });

  afterEach(() => {
    cleanup();
  });

  it('on admissible event fire, calls BOTH decideNpsTrigger AND useNativeReviewTrigger().request() in parallel', async () => {
    mockDecide.mockResolvedValue({
      fire: true,
      copy_variant: 'control',
      cta_set: [
        {
          slug: 'trustpilot',
          url_pattern: 'https://www.trustpilot.com/review/leanshot.app',
        },
      ],
      rule_id: 'r1',
    });
    const { result } = renderHook(() => useNPSPromptListener());
    expect(result.current.decision).toBeNull();
    await act(async () => {
      window.dispatchEvent(
        new CustomEvent(ANALYTICS_TRIGGER_EVENT, {
          detail: { name: 'activation_completed' },
        }),
      );
    });
    await waitFor(() => {
      expect(mockDecide).toHaveBeenCalledWith('activation_completed');
      expect(mockRequest).toHaveBeenCalledTimes(1);
      expect(result.current.decision).toEqual(
        expect.objectContaining({ fire: true, rule_id: 'r1' }),
      );
    });
  });

  it('ignores events whose EVENTS entry has nps_trigger_eligible !== true', async () => {
    const { result } = renderHook(() => useNPSPromptListener());
    await act(async () => {
      window.dispatchEvent(
        new CustomEvent(ANALYTICS_TRIGGER_EVENT, {
          detail: { name: 'not_eligible_event' },
        }),
      );
    });
    // Give the microtask queue a tick.
    await new Promise((r) => setTimeout(r, 0));
    expect(mockDecide).not.toHaveBeenCalled();
    expect(mockRequest).not.toHaveBeenCalled();
    expect(result.current.decision).toBeNull();
  });

  it('ignores events with invalid detail (type guard rejection)', async () => {
    renderHook(() => useNPSPromptListener());
    await act(async () => {
      window.dispatchEvent(new CustomEvent(ANALYTICS_TRIGGER_EVENT, { detail: { name: 123 } }));
    });
    await new Promise((r) => setTimeout(r, 0));
    expect(mockDecide).not.toHaveBeenCalled();
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('ignores unknown event names', async () => {
    renderHook(() => useNPSPromptListener());
    await act(async () => {
      window.dispatchEvent(
        new CustomEvent(ANALYTICS_TRIGGER_EVENT, {
          detail: { name: 'totally_unregistered_event' },
        }),
      );
    });
    await new Promise((r) => setTimeout(r, 0));
    expect(mockDecide).not.toHaveBeenCalled();
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('setRating sets a rating value; reset clears decision and rating', () => {
    const { result } = renderHook(() => useNPSPromptListener());
    act(() => {
      result.current.setRating(4);
    });
    expect(result.current.rating).toBe(4);
    act(() => {
      result.current.reset();
    });
    expect(result.current.rating).toBeNull();
    expect(result.current.decision).toBeNull();
  });

  it('removes window listener on unmount (no further calls after dispose)', async () => {
    mockDecide.mockResolvedValue({ fire: false, reason: 'no_rule' });
    const { unmount } = renderHook(() => useNPSPromptListener());
    unmount();
    await act(async () => {
      window.dispatchEvent(
        new CustomEvent(ANALYTICS_TRIGGER_EVENT, {
          detail: { name: 'activation_completed' },
        }),
      );
    });
    await new Promise((r) => setTimeout(r, 0));
    expect(mockDecide).not.toHaveBeenCalled();
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('handles decideNpsTrigger rejection fail-soft (no throw, decision stays null)', async () => {
    mockDecide.mockRejectedValue(new Error('boom'));
    const { result } = renderHook(() => useNPSPromptListener());
    await act(async () => {
      window.dispatchEvent(
        new CustomEvent(ANALYTICS_TRIGGER_EVENT, {
          detail: { name: 'activation_completed' },
        }),
      );
    });
    await new Promise((r) => setTimeout(r, 0));
    expect(result.current.decision).toBeNull();
  });

  it('V13-3 self-check: no rating-aware predicate (rating|nps_score|is_promoter|is_detractor) precedes .request() (comment-stripped)', () => {
    const filePath = resolve(__dirname, '..', 'useNPSPromptListener.tsx');
    const source = stripComments(readFileSync(filePath, 'utf8'));
    // Match any conditional construct + a rating-identifier within 80 chars
    // ahead of .request(). The plan's grep gate enforces the same invariant
    // at CI scope; this asserts the per-file shape.
    const violations = source.match(
      /(?:if|\?|&&|\|\|)[^\n]{0,120}(?:rating|nps_score|is_promoter|is_detractor)[^\n]{0,120}\.request\s*\(/g,
    );
    expect(violations).toBeNull();
  });
});
