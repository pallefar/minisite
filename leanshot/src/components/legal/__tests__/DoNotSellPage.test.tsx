/**
 * Phase 64 Plan 05 — DoNotSellPage vitest unit tests.
 * RED phase: tests written before implementation.
 *
 * Covers 6 behavior cases per PLAN.md §Task 2 <behavior>:
 * 1. Renders form with Name + Email + State-residency Select + 3 opt-out scope checkboxes
 * 2. Submitting without required fields shows inline validation errors; no network call
 * 3. Valid submit → fetch POST → success state with exact copy
 * 4. Error response → red error text with exact copy
 * 5. Primary CTA copy is exactly "Submit opt-out request"
 * 6. Confirmation Modal appears BEFORE submit with verbatim copy
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HelmetProvider } from 'react-helmet-async';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DoNotSellPage } from '../DoNotSellPage';

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

function renderDoNotSellPage() {
  return render(
    <HelmetProvider>
      <DoNotSellPage />
    </HelmetProvider>,
  );
}

describe('DoNotSellPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('Test 1: Renders form with Name + Email + State-residency Select + 3 opt-out scope checkboxes', () => {
    renderDoNotSellPage();
    // Name field
    expect(screen.getByLabelText(/your name/i)).toBeInTheDocument();
    // Email field
    expect(screen.getByLabelText(/your email/i)).toBeInTheDocument();
    // State residency select
    expect(screen.getByLabelText(/state residency/i)).toBeInTheDocument();
    // 3 opt-out scope checkboxes
    expect(screen.getByLabelText(/targeted advertising/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/sale of personal information/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/sharing with third parties/i)).toBeInTheDocument();
  });

  it('Test 2: Submitting without required fields shows validation errors; NO network call', async () => {
    renderDoNotSellPage();
    const user = userEvent.setup();
    // Find and click primary CTA (should trigger validation before modal)
    const submitBtn = screen.getByRole('button', { name: /submit opt-out request/i });
    await user.click(submitBtn);
    // Should show inline validation errors, NOT call fetch
    expect(mockFetch).not.toHaveBeenCalled();
    // Expect at least one error message visible
    expect(screen.getByText(/name is required/i)).toBeInTheDocument();
  });

  it('Test 3: Valid submit → fetch POST to privacy-optout-process → success state', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true }),
    });
    renderDoNotSellPage();
    const user = userEvent.setup();

    await user.type(screen.getByLabelText(/your name/i), 'Jane Doe');
    await user.type(screen.getByLabelText(/your email/i), 'jane@example.com');

    // Open confirmation modal — click the form submit button (first one)
    const buttons = screen.getAllByRole('button', { name: /submit opt-out request/i });
    await user.click(buttons[0]);

    // Confirm in the modal — click the modal's confirm button (last one)
    await waitFor(() => {
      expect(screen.getByText(/submit this opt-out request\?/i)).toBeInTheDocument();
    });
    const confirmBtns = screen.getAllByRole('button', { name: /submit opt-out request/i });
    await user.click(confirmBtns[confirmBtns.length - 1]);

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('privacy-optout-process'),
        expect.objectContaining({ method: 'POST' }),
      );
    });

    await waitFor(() => {
      expect(
        screen.getByText(/allow 24 hours for propagation/i),
      ).toBeInTheDocument();
    });
    // Confirmation email copy
    expect(screen.getByText(/confirmation email sent to/i)).toBeInTheDocument();
  });

  it('Test 4: Error response → renders red error text with "Try again" copy', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error: 'Internal error' }),
    });
    renderDoNotSellPage();
    const user = userEvent.setup();

    await user.type(screen.getByLabelText(/your name/i), 'Jane Doe');
    await user.type(screen.getByLabelText(/your email/i), 'jane@example.com');

    const buttons = screen.getAllByRole('button', { name: /submit opt-out request/i });
    await user.click(buttons[0]);

    // Wait for modal to open then confirm
    await waitFor(() => {
      expect(screen.getByText(/submit this opt-out request\?/i)).toBeInTheDocument();
    });
    const confirmBtns = screen.getAllByRole('button', { name: /submit opt-out request/i });
    await user.click(confirmBtns[confirmBtns.length - 1]);

    await waitFor(() => {
      expect(
        screen.getByText(/try again — if the problem persists, email privacy@leanshot\.app/i),
      ).toBeInTheDocument();
    });
  });

  it('Test 5: Primary CTA copy is exactly "Submit opt-out request"', () => {
    renderDoNotSellPage();
    const buttons = screen.getAllByRole('button', { name: /submit opt-out request/i });
    expect(buttons.length).toBeGreaterThanOrEqual(1);
    expect(buttons[0]).toBeInTheDocument();
  });

  it('Test 6: Confirmation Modal appears BEFORE submit with verbatim copy', async () => {
    renderDoNotSellPage();
    const user = userEvent.setup();

    await user.type(screen.getByLabelText(/your name/i), 'Jane Doe');
    await user.type(screen.getByLabelText(/your email/i), 'jane@example.com');

    const buttons = screen.getAllByRole('button', { name: /submit opt-out request/i });
    await user.click(buttons[0]);

    // Modal should be visible with verbatim copy from UI-SPEC §Copywriting
    await waitFor(() => {
      expect(
        screen.getByText(/submit this opt-out request\?/i),
      ).toBeInTheDocument();
    });
    // The "you can change your mind" text is split across a paragraph + link element,
    // so use a function matcher on the containing paragraph
    const modalParas = screen.getAllByText((_, el) => {
      return (el?.textContent ?? '').includes('You can change your mind later by emailing');
    });
    expect(modalParas.length).toBeGreaterThanOrEqual(1);
    expect(
      screen.getByText(/allow 24 hours for propagation across our systems/i),
    ).toBeInTheDocument();
    // fetch should NOT have been called yet (modal gates the call)
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
