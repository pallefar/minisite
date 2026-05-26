/**
 * Phase 60 Plan 60-10 Task 4 — CitationMarker tests.
 *
 * Run: npx vitest run --config vite.config.ts src/components/dashboard/ai/__tests__/CitationMarker.test.tsx
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CitationMarker } from '../CitationMarker';

const UUID_A = 'a1b2c3d4-e5f6-7890-abcd-ef0123456789';

describe('CitationMarker', () => {
  // Test 1: aria-label uses i18n key with refIndex
  it('Test 1: renders button with aria-label "Open citation 3" for refIndex=3', () => {
    render(
      <CitationMarker
        refIndex={3}
        chunkId={UUID_A}
        onActivate={vi.fn()}
      />,
    );

    const btn = screen.getByRole('button');
    // The i18n key 'citation_marker.aria' interpolates to "Open citation {{n}}"
    // The test-setup uses EN locale from public/locales/en/rag.json
    expect(btn).toHaveAttribute('aria-label', 'Open citation 3');
  });

  // Test 2: renders text content [3]
  it('Test 2: renders visible badge text "[3]"', () => {
    render(
      <CitationMarker
        refIndex={3}
        chunkId={UUID_A}
        onActivate={vi.fn()}
      />,
    );

    expect(screen.getByText('[3]')).toBeInTheDocument();
  });

  // Test 3: click invokes onActivate with chunkId and the button element
  it('Test 3: click invokes onActivate(chunkId, anchorEl)', () => {
    const onActivate = vi.fn();
    render(
      <CitationMarker
        refIndex={1}
        chunkId={UUID_A}
        onActivate={onActivate}
      />,
    );

    const btn = screen.getByRole('button');
    fireEvent.click(btn);

    expect(onActivate).toHaveBeenCalledTimes(1);
    expect(onActivate).toHaveBeenCalledWith(UUID_A, btn);
  });

  // Test 4: tap target ≥24px via p-[5px] padding around 14px badge
  // Note: jsdom's getBoundingClientRect returns 0,0 by default (no layout engine).
  // We verify the structure: padding p-[5px] is present in className,
  // which gives 5+14+5 = 24px per UI-SPEC §3 invariant 10.
  it('Test 4: button has p-[5px] class for ≥24px tap target (UI-SPEC §3 invariant 10)', () => {
    render(
      <CitationMarker
        refIndex={1}
        chunkId={UUID_A}
        onActivate={vi.fn()}
      />,
    );

    const btn = screen.getByRole('button');
    expect(btn.className).toContain('p-[5px]');
  });

  // Extra: different refIndex renders correctly
  it('renders [1] for refIndex=1', () => {
    render(<CitationMarker refIndex={1} chunkId={UUID_A} onActivate={vi.fn()} />);
    expect(screen.getByText('[1]')).toBeInTheDocument();
  });
});
