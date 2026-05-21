/**
 * Phase 35 Plan 35-05 — ChallengeForm RTL unit tests.
 *
 * Covers the 4 behavioral assertions from the plan:
 *   1. Submit disabled when title missing
 *   2. action_type field shown only when challenge_type=specific_action
 *   3. Add variant button disappears after 2 variants added (D-20 max-2)
 *   4. createWeeklyChallenge called with correctly-parsed payload on submit
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ChallengeForm from '../ChallengeForm';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

// Mock supabase to prevent actual calls
vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null } }) },
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error: null }),
    }),
    rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
  },
}));

// Mock admin-api — allow tests to spy/override
const mockCreateWeeklyChallenge = vi.fn().mockResolvedValue('new-challenge-id');

vi.mock('@/lib/gamification/admin-api', () => ({
  createWeeklyChallenge: (...args: unknown[]) => mockCreateWeeklyChallenge(...args),
  ChallengeApiError: class ChallengeApiError extends Error {
    code: string;
    constructor(code: string, message: string) {
      super(message);
      this.code = code;
      this.name = 'ChallengeApiError';
    }
  },
  shipWinnerChallengeVariant: vi.fn(),
  setCohortLeaderboardEnabled: vi.fn(),
}));

// Mock useToast to prevent store dependency
vi.mock('@/hooks/useToast', () => ({
  useToast: () => vi.fn(),
}));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ChallengeForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateWeeklyChallenge.mockResolvedValue('new-challenge-id');
  });

  it('disables submit button when title is missing', () => {
    render(<ChallengeForm />);
    const submitBtn = screen.getByRole('button', { name: /create challenge/i });
    expect(submitBtn).toBeDisabled();
  });

  it('shows action_type field only when challenge_type=specific_action', () => {
    render(<ChallengeForm />);
    // action_type field should NOT be visible with default challenge_type (log_count)
    expect(screen.queryByLabelText(/action type/i)).not.toBeInTheDocument();

    // Change challenge_type to specific_action
    const typeSelect = screen.getByLabelText(/challenge type/i);
    fireEvent.change(typeSelect, { target: { value: 'specific_action' } });

    // Now action_type field should appear
    expect(screen.getByLabelText(/action type/i)).toBeInTheDocument();
  });

  it('caps variants at 2 — Add variant button disappears after 2 added (D-20)', () => {
    render(<ChallengeForm />);

    // Initially no variants, "Add variant" button exists
    // First, open the variants accordion
    const summary = screen.getByText(/A\/B Variants/i);
    fireEvent.click(summary);

    // Click "Add variant" once (Variant A)
    const addBtn1 = screen.getByRole('button', { name: /add variant/i });
    fireEvent.click(addBtn1);

    // Click "Add variant" again (Variant B)
    const addBtn2 = screen.getByRole('button', { name: /add variant/i });
    fireEvent.click(addBtn2);

    // After 2 variants, the button should be gone
    expect(screen.queryByRole('button', { name: /add variant/i })).not.toBeInTheDocument();
  });

  it('calls createWeeklyChallenge with parsed payload on submit', async () => {
    const onSaved = vi.fn();
    render(<ChallengeForm onSaved={onSaved} />);

    // Fill required fields to enable submit
    fireEvent.change(screen.getByRole('textbox', { name: /title/i }), {
      target: { value: 'Test challenge' },
    });
    fireEvent.change(screen.getByRole('textbox', { name: /framing/i }), {
      target: { value: 'Test framing text here' },
    });
    fireEvent.change(screen.getByRole('spinbutton', { name: /threshold/i }), {
      target: { value: '5' },
    });
    // Set dates so active status can be set or use draft
    fireEvent.change(screen.getAllByDisplayValue('')[0], {
      target: { value: '2027-07-08T00:00' },
    });

    // Submit
    const submitBtn = screen.getByRole('button', { name: /create challenge/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(mockCreateWeeklyChallenge).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Test challenge',
          framing: 'Test framing text here',
          threshold: 5,
        }),
      );
    });
  });
});
