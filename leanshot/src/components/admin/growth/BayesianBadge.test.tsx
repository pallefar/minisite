/**
 * Phase 39 Plan 39-07 Task 1 — BayesianBadge tri-state tests (PAGEAB-07 + D-12).
 *
 * Boundary posteriors: 0.0, 0.79, 0.80, 0.94, 0.95, 1.0.
 * Tones per UI-SPEC:
 *   <0.80 → neutral, label "Insufficient data (N%)"
 *   0.80–<0.95 → warning, label "Trending (N%)"
 *   ≥0.95 → success, label "Significant (N%)"
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { BayesianBadge } from './BayesianBadge';

describe('BayesianBadge (PAGEAB-07 / D-12)', () => {
  it('posterior 0.0 → neutral tone, "Insufficient data (0%)"', () => {
    render(<BayesianBadge posterior={0.0} />);
    const badge = screen.getByText('Insufficient data (0%)');
    expect(badge).toBeInTheDocument();
    // Badge tone=neutral uses `bg-[var(--color-surface-elevated)]`
    expect(badge.className).toContain('bg-[var(--color-surface-elevated)]');
  });

  it('posterior 0.79 → neutral, "Insufficient data (79%)"', () => {
    render(<BayesianBadge posterior={0.79} />);
    expect(screen.getByText('Insufficient data (79%)')).toBeInTheDocument();
  });

  it('posterior 0.80 → warning, "Trending (80%)"', () => {
    render(<BayesianBadge posterior={0.8} />);
    const badge = screen.getByText('Trending (80%)');
    expect(badge).toBeInTheDocument();
    expect(badge.className).toContain('bg-[var(--color-warning-soft)]');
  });

  it('posterior 0.94 → warning, "Trending (94%)"', () => {
    render(<BayesianBadge posterior={0.94} />);
    expect(screen.getByText('Trending (94%)')).toBeInTheDocument();
  });

  it('posterior 0.95 → success, "Significant (95%)"', () => {
    render(<BayesianBadge posterior={0.95} />);
    const badge = screen.getByText('Significant (95%)');
    expect(badge).toBeInTheDocument();
    expect(badge.className).toContain('bg-[var(--color-success-soft)]');
  });

  it('posterior 1.0 → success, "Significant (100%)"', () => {
    render(<BayesianBadge posterior={1.0} />);
    expect(screen.getByText('Significant (100%)')).toBeInTheDocument();
  });

  it('rounds 0.856 to 86 (Math.round)', () => {
    render(<BayesianBadge posterior={0.856} />);
    expect(screen.getByText('Trending (86%)')).toBeInTheDocument();
  });
});
