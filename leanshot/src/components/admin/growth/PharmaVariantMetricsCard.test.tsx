/**
 * Phase 39 Plan 39-08 Task 1 — PharmaVariantMetricsCard tests.
 *
 * Contract per <interfaces> + UI-SPEC line 204:
 *   (a) renders UI-SPEC copy verbatim with the supplied numeric values
 *       (formatted with one decimal for nps_delta, integer ratio for 1★)
 *   (b) null nps_delta renders the em-dash '—' placeholder
 *   (c) Sparkline rendered ONLY when trend_series.length > 0
 *   (d) one_star_rate_ratio > 2 surfaces a danger-tone visual cue
 *       (data-tone='danger' attribute on the card root)
 *
 * UI-SPEC line 132 forbids teal accent on clinical/Pharma surfaces.
 * Test (e) asserts no '--color-accent' or 'teal' substring appears in
 * the rendered DOM.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PharmaVariantMetricsCard } from './PharmaVariantMetricsCard';

describe('PharmaVariantMetricsCard', () => {
  it('(a) renders UI-SPEC composite copy verbatim with numeric values', () => {
    render(
      <PharmaVariantMetricsCard
        nps_delta={3.2}
        one_star_rate_ratio={1.4}
        conversion_uplift_pct={12.5}
      />,
    );
    // UI-SPEC line 204: "Conversion uplift: {N}% · NPS Δ: {N} · 1★ rate: {ratio}× baseline"
    expect(screen.getByText(/Conversion uplift:/)).toBeInTheDocument();
    expect(screen.getByText(/12\.5%/)).toBeInTheDocument();
    expect(screen.getByText(/NPS Δ:/)).toBeInTheDocument();
    expect(screen.getByText(/3\.2/)).toBeInTheDocument();
    expect(screen.getByText(/1★ rate:/)).toBeInTheDocument();
    expect(screen.getByText(/1\.4×/)).toBeInTheDocument();
    expect(screen.getByText(/baseline/)).toBeInTheDocument();
  });

  it('(b) null nps_delta renders em-dash placeholder', () => {
    const { container } = render(
      <PharmaVariantMetricsCard
        nps_delta={null}
        one_star_rate_ratio={1.0}
        conversion_uplift_pct={0}
      />,
    );
    // The composite paragraph contains "NPS Δ:" + "—" across sibling spans;
    // assert the joined textContent rather than a single text node.
    const text = container.textContent ?? '';
    expect(text).toMatch(/NPS Δ:\s*—/);
  });

  it('(c) renders Sparkline only when trend_series.length > 0', () => {
    const { container, rerender } = render(
      <PharmaVariantMetricsCard
        nps_delta={1}
        one_star_rate_ratio={1}
        conversion_uplift_pct={1}
      />,
    );
    expect(container.querySelector('svg')).toBeNull();

    rerender(
      <PharmaVariantMetricsCard
        nps_delta={1}
        one_star_rate_ratio={1}
        conversion_uplift_pct={1}
        trend_series={[1, 2, 3, 4]}
      />,
    );
    expect(container.querySelector('svg')).toBeInTheDocument();
  });

  it('(d) one_star_rate_ratio > 2 marks card data-tone=danger', () => {
    const { container } = render(
      <PharmaVariantMetricsCard
        nps_delta={-1}
        one_star_rate_ratio={2.5}
        conversion_uplift_pct={5}
      />,
    );
    const root = container.querySelector('[data-tone]') as HTMLElement;
    expect(root).toBeInTheDocument();
    expect(root.getAttribute('data-tone')).toBe('danger');
  });

  it('(d-control) one_star_rate_ratio <= 2 stays neutral', () => {
    const { container } = render(
      <PharmaVariantMetricsCard
        nps_delta={1}
        one_star_rate_ratio={1.9}
        conversion_uplift_pct={5}
      />,
    );
    const root = container.querySelector('[data-tone]') as HTMLElement;
    expect(root.getAttribute('data-tone')).toBe('neutral');
  });

  it('(e) no teal accent on the card (UI-SPEC line 132)', () => {
    const { container } = render(
      <PharmaVariantMetricsCard
        nps_delta={0}
        one_star_rate_ratio={1}
        conversion_uplift_pct={0}
      />,
    );
    const html = container.innerHTML;
    expect(html).not.toMatch(/--color-accent/);
    expect(html.toLowerCase()).not.toMatch(/teal/);
  });
});
