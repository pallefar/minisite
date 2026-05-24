/**
 * Phase 39 Plan 39-05 Task 1 — SafetyInfoBadge tests.
 *
 * D-05 mandates the badge ALWAYS render alongside safety-category content.
 * Per UI-SPEC the badge uses sage (success) tone — NOT teal (accent
 * reserved-list). Copy is the fixed string "Safety info — always free".
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { SafetyInfoBadge } from './SafetyInfoBadge';

describe('SafetyInfoBadge', () => {
  it("renders the fixed copy 'Safety info — always free'", () => {
    render(<SafetyInfoBadge category="overdose-warning" />);
    expect(screen.getByText('Safety info — always free')).toBeTruthy();
  });

  it("uses the sage success tone (--color-success-soft bg + --color-success text), NOT teal accent", () => {
    const { container } = render(<SafetyInfoBadge category="contraindication-alert" />);
    const badge = container.querySelector('span');
    expect(badge).toBeTruthy();
    const cls = badge!.className;
    // success tone styling from Badge primitive
    expect(cls).toContain('bg-[var(--color-success-soft)]');
    expect(cls).toContain('text-[var(--color-success)]');
    // explicit guard: teal accent must NOT appear (UI-SPEC accent reserved-list)
    expect(cls).not.toContain('teal');
    expect(cls).not.toContain('--color-accent');
  });

  it('sets aria-label including the supplied category value', () => {
    render(<SafetyInfoBadge category="fda-black-box" />);
    const badge = screen.getByLabelText(/fda-black-box/);
    expect(badge).toBeTruthy();
    expect(badge.getAttribute('aria-label')).toBe('Always free safety information (fda-black-box)');
  });

  it('renders the badge for each of the 5 D-05 categories without crashing', () => {
    const categories = [
      'overdose-warning',
      'contraindication-alert',
      'fda-black-box',
      'serious-adverse-event-signal',
      'pregnancy-lactation-contraindication',
    ];
    for (const c of categories) {
      const { unmount } = render(<SafetyInfoBadge category={c} />);
      expect(screen.getByText('Safety info — always free')).toBeTruthy();
      unmount();
    }
  });
});
