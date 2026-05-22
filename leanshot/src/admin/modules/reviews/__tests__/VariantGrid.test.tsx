/**
 * Phase 36 Plan 36-04 Task 3 — VariantGrid tests (Surface E A/B variant grid).
 *
 * Covers:
 *  - Empty by_variant → "Only control variant active" copy
 *  - Populated by_variant → one row per variant in deterministic order
 *  - Ship-Winner button click opens Confirm modal "Ship '{variant}' to 100% traffic?"
 *  - Confirm → invokes supabase.functions.invoke('ship-winner-flag', { body: { flag_id, variant } })
 *  - Edge Fn error → error toast
 *  - data-action="ship-winner" attribute present on every Ship button
 */
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import VariantGrid from '../VariantGrid';

const mockInvoke = vi.fn();
const mockToast = vi.fn();

vi.mock('@/lib/supabase', () => ({
  supabase: {
    functions: {
      invoke: (...args: unknown[]) => mockInvoke(...args),
    },
  },
}));

vi.mock('@/hooks/useToast', () => ({
  useToast: () => mockToast,
}));

beforeEach(() => {
  mockInvoke.mockReset();
  mockToast.mockReset();
});

afterEach(() => {
  cleanup();
});

describe('VariantGrid (Phase 36 Plan 36-04 Task 3 — Ship-Winner reuse)', () => {
  it('renders "Only control variant active" copy when byVariant is empty', () => {
    render(<VariantGrid byVariant={{}} flagId="nps_prompt_copy" />);
    expect(screen.getByText(/Only control variant active/i)).toBeTruthy();
  });

  it('renders one row per variant with data-action="ship-winner" buttons', () => {
    render(
      <VariantGrid
        byVariant={{
          control: { prompts_shown: 100, rated_internal: 40 },
          variant_a: { prompts_shown: 95, rated_internal: 50 },
        }}
        flagId="nps_prompt_copy"
      />,
    );

    expect(screen.getByText('control')).toBeTruthy();
    expect(screen.getByText('variant_a')).toBeTruthy();

    const buttons = screen.getAllByRole('button', { name: /Ship variant/i });
    expect(buttons.length).toBe(2);
    for (const b of buttons) {
      expect(b.getAttribute('data-action')).toBe('ship-winner');
    }
  });

  it('Ship click opens Confirm modal; confirm invokes ship-winner-flag with {flag_id, variant}', async () => {
    mockInvoke.mockResolvedValueOnce({ data: { ok: true }, error: null });

    render(
      <VariantGrid
        byVariant={{
          variant_a: { prompts_shown: 95, rated_internal: 50 },
        }}
        flagId="nps_prompt_copy"
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /Ship variant/i }));

    // Confirm modal — copy verbatim "Ship 'variant_a' to 100% traffic?".
    await waitFor(() => {
      expect(screen.getByText(/Ship 'variant_a' to 100% traffic\?/i)).toBeTruthy();
    });

    // Click the modal's primary "Ship variant" CTA inside the dialog.
    const dialogButtons = screen.getAllByRole('button', { name: /Ship variant/i });
    // The last "Ship variant" button is the confirm-modal CTA (the row button has the same label).
    fireEvent.click(dialogButtons[dialogButtons.length - 1]);

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith(
        'ship-winner-flag',
        expect.objectContaining({
          body: { flag_id: 'nps_prompt_copy', variant: 'variant_a' },
        }),
      );
    });
    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(
        expect.stringMatching(/Shipped variant_a/i),
        'success',
      );
    });
  });

  it('Edge Fn error → error toast', async () => {
    mockInvoke.mockResolvedValueOnce({
      data: { error: 'forbidden_not_superadmin' },
      error: null,
    });

    render(
      <VariantGrid
        byVariant={{
          variant_a: { prompts_shown: 95, rated_internal: 50 },
        }}
        flagId="nps_prompt_copy"
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /Ship variant/i }));
    await waitFor(() => {
      expect(screen.getByText(/Ship 'variant_a' to 100% traffic\?/i)).toBeTruthy();
    });
    const dialogButtons = screen.getAllByRole('button', { name: /Ship variant/i });
    fireEvent.click(dialogButtons[dialogButtons.length - 1]);

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(
        expect.stringMatching(/Superadmin role required/i),
        'error',
      );
    });
  });
});
