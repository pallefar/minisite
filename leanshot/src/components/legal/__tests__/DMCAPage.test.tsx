/**
 * Phase 64 Plan 05 — DMCAPage vitest unit tests.
 * RED phase: tests written before implementation.
 *
 * Covers 4 behavior cases per PLAN.md §Task 2 <behavior>:
 * 1. Renders LegalLayout with title="DMCA Notice & Takedown"
 * 2. Body sections: agent info (placeholder), takedown procedure, counter-notice procedure, safe-harbor disclaimer
 * 3. "Submit DMCA notice" CTA renders as mailto:abuse@leanshot.app link
 * 4. Page includes inline disclaimer noting agent registration is pending Phase 70 UAT operator action
 */
import { render, screen } from '@testing-library/react';
import { HelmetProvider } from 'react-helmet-async';
import { describe, it, expect } from 'vitest';
import { DMCAPage } from '../DMCAPage';

function renderDMCAPage() {
  return render(
    <HelmetProvider>
      <DMCAPage />
    </HelmetProvider>,
  );
}

describe('DMCAPage', () => {
  it('Test 1: Renders LegalLayout with title "DMCA Notice & Takedown"', () => {
    renderDMCAPage();
    // The title is rendered as the H1 by LegalLayout
    expect(
      screen.getByRole('heading', { level: 1, name: /DMCA Notice & Takedown/i }),
    ).toBeInTheDocument();
  });

  it('Test 2: Body sections — agent info, takedown procedure, counter-notice procedure, safe-harbor disclaimer', () => {
    renderDMCAPage();
    // Agent info section
    expect(screen.getAllByText(/designated dmca agent/i).length).toBeGreaterThanOrEqual(1);
    // Takedown procedure
    expect(screen.getAllByText(/takedown notice/i).length).toBeGreaterThanOrEqual(1);
    // Counter-notice procedure
    expect(screen.getAllByText(/counter.?notice/i).length).toBeGreaterThanOrEqual(1);
    // Safe harbor
    expect(screen.getAllByText(/safe.?harbor/i).length).toBeGreaterThanOrEqual(1);
    // abuse@leanshot.app must appear
    expect(screen.getAllByText(/abuse@leanshot\.app/i).length).toBeGreaterThanOrEqual(1);
  });

  it('Test 3: "Submit DMCA notice" CTA renders as mailto:abuse@leanshot.app link with correct subject', () => {
    renderDMCAPage();
    const link = screen.getByRole('link', { name: /submit dmca notice/i });
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute(
      'href',
      'mailto:abuse@leanshot.app?subject=DMCA%20Takedown%20Notice',
    );
  });

  it('Test 4: Page includes inline disclaimer noting agent registration is pending Phase 70 UAT', () => {
    renderDMCAPage();
    // Should mention pending operator action / U.S. Copyright Office / Phase 70
    expect(
      screen.getByText(/agent registration.*pending|pending.*agent registration|U\.S\. Copyright Office.*pending|pending.*U\.S\. Copyright Office/i),
    ).toBeInTheDocument();
  });
});
