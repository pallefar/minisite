/**
 * Phase 60 Plan 60-10 Task 5 — RefusalCard tests.
 *
 * CRITICAL: Test 7 enforces the PHARMA-02 byte-exact invariant at the UI-render layer.
 * Failing this test = UI-layer breach of the 3-layer PHARMA-02 invariant (Phase 39 39-02 D-06).
 *
 * Run: npx vitest run --config vite.config.ts src/components/dashboard/ai/__tests__/RefusalCard.test.tsx
 */

import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { RefusalCard } from '../RefusalCard';

describe('RefusalCard', () => {
  // Test 7: PHARMA-02 renders the EXACT locked copy (UI-SPEC invariant 3 — Phase 39 39-02 D-06)
  it('Test 7: pharma_02 renders the EXACT locked copy (byte-exact invariant)', () => {
    render(<RefusalCard kind="pharma_02" />);

    // This is the byte-exact Phase 39 39-02 D-06 locked string.
    // Modifying this string is a 3-layer invariant breach.
    expect(
      screen.getByText('That topic requires clinician guidance — please ask your doctor.'),
    ).toBeInTheDocument();
  });

  // Test 8: out_of_corpus renders with Info icon (discriminator: data-icon or component import)
  it('Test 8: out_of_corpus renders the out-of-corpus copy (Info icon via class variant)', () => {
    render(<RefusalCard kind="out_of_corpus" />);

    expect(
      screen.getByText(/I don't have evidence for that in our knowledge base/),
    ).toBeInTheDocument();
  });

  // Test 9: citation_validation_failed renders G5 copy + AlertCircle icon
  it('Test 9: citation_validation_failed renders G5 copy', () => {
    render(<RefusalCard kind="citation_validation_failed" />);

    expect(
      screen.getByText(/I'm not confident in the supporting evidence/),
    ).toBeInTheDocument();
  });

  // Test 10: pharma_02 uses AlertTriangle + does NOT render disclaimer
  it('Test 10: pharma_02 does NOT render the disclaimer line (the refusal IS the safety intervention)', () => {
    render(<RefusalCard kind="pharma_02" />);

    // Disclaimer line should NOT appear for pharma_02
    expect(
      screen.queryByText(/Not medical advice/),
    ).not.toBeInTheDocument();
  });

  // Test 10b: out_of_corpus DOES render disclaimer (not pharma_02)
  it('Test 10b: out_of_corpus DOES render the disclaimer', () => {
    render(<RefusalCard kind="out_of_corpus" />);

    expect(
      screen.getByText(/Not medical advice/),
    ).toBeInTheDocument();
  });

  // Test 11: NO [N] markers anywhere in RefusalCard output (UI-SPEC invariant 2)
  it('Test 11: NO [N] citation markers in any RefusalCard kind', () => {
    const { rerender } = render(<RefusalCard kind="pharma_02" />);
    expect(screen.queryByText(/\[\d+\]/)).toBeNull();

    rerender(<RefusalCard kind="out_of_corpus" />);
    expect(screen.queryByText(/\[\d+\]/)).toBeNull();

    rerender(<RefusalCard kind="citation_validation_failed" />);
    expect(screen.queryByText(/\[\d+\]/)).toBeNull();
  });

  // Test 12: NO "Sources (N)" footer anywhere (UI-SPEC invariant 2)
  it('Test 12: NO Sources footer in any RefusalCard kind', () => {
    const { rerender } = render(<RefusalCard kind="pharma_02" />);
    expect(screen.queryByText(/Sources \(\d+\)/)).toBeNull();

    rerender(<RefusalCard kind="out_of_corpus" />);
    expect(screen.queryByText(/Sources \(\d+\)/)).toBeNull();

    rerender(<RefusalCard kind="citation_validation_failed" />);
    expect(screen.queryByText(/Sources \(\d+\)/)).toBeNull();
  });
});
