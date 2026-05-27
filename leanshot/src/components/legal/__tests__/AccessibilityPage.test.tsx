/**
 * Phase 64 Plan 05 — AccessibilityPage vitest unit tests.
 * RED phase: tests written before implementation.
 *
 * Covers 3 behavior cases per PLAN.md §Task 2 <behavior>:
 * 1. Renders LegalLayout with title="Accessibility Statement"
 * 2. Page body mentions WCAG 2.2 AA + ADA Title III + accessibility@leanshot.app + 30-day SLA
 * 3. "Report an accessibility issue" CTA renders as mailto link
 */
import { render, screen } from '@testing-library/react';
import { HelmetProvider } from 'react-helmet-async';
import { describe, it, expect } from 'vitest';
import { AccessibilityPage } from '../AccessibilityPage';

function renderAccessibilityPage() {
  return render(
    <HelmetProvider>
      <AccessibilityPage />
    </HelmetProvider>,
  );
}

describe('AccessibilityPage', () => {
  it('Test 1: Renders LegalLayout with title "Accessibility Statement"', () => {
    renderAccessibilityPage();
    // The title is rendered as the H1 by LegalLayout
    expect(screen.getByRole('heading', { level: 1, name: /accessibility statement/i })).toBeInTheDocument();
  });

  it('Test 2: Page body mentions WCAG 2.2 AA + ADA Title III + accessibility@leanshot.app + 30-day SLA', () => {
    renderAccessibilityPage();
    // Use getAllByText to handle cases where text appears in multiple elements
    expect(screen.getAllByText(/WCAG 2\.2 AA/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/ADA Title III/i).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/accessibility@leanshot\.app/i).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/30.?day/i).length).toBeGreaterThanOrEqual(1);
  });

  it('Test 3: "Report an accessibility issue" CTA renders as mailto:accessibility@leanshot.app link', () => {
    renderAccessibilityPage();
    const link = screen.getByRole('link', { name: /report an accessibility issue/i });
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute('href', expect.stringContaining('mailto:accessibility@leanshot.app'));
  });
});
