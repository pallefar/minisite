import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useStore } from '@/lib/store';
import { OnboardingFlow } from './OnboardingFlow';

describe('OnboardingFlow', () => {
  beforeEach(() => {
    // Reset store to initial state before each test
    useStore.setState({ user: null, acknowledgedDisclaimer: undefined });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('completes the 8-step happy path (Step 0 disclaimer + 1-7 onboarding) and calls setUser with a valid User', async () => {
    const setUserSpy = vi.spyOn(useStore.getState(), 'setUser');
    const onComplete = vi.fn();
    const onCancel = vi.fn();
    const user = userEvent.setup();

    // Do NOT wrap in StrictMode — RTL effects fire twice under StrictMode
    // and break call-count assertions (RESEARCH.md Pitfall 6)
    render(<OnboardingFlow onComplete={onComplete} onCancel={onCancel} />);

    // ── Step 0: Disclaimer acknowledge ──────────────────────────────────────
    expect(screen.getByText(/not medical advice/i)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /i understand/i }));

    // Step 1: Name + Continue
    const nameInput = await screen.findByLabelText(/your name/i);
    await user.type(nameInput, 'Alex');
    await user.click(screen.getByRole('button', { name: /continue/i }));

    // Step 2: Select medication + Continue
    await waitFor(() => screen.getByLabelText(/glp-1 medication/i));
    await user.selectOptions(screen.getByLabelText(/glp-1 medication/i), 'ozempic');
    await user.click(screen.getByRole('button', { name: /continue/i }));

    // Step 3: Weight (required) + Continue
    await waitFor(() => screen.getByLabelText(/weight/i));
    await user.type(screen.getByLabelText(/weight \(kg\)/i), '85');
    await user.click(screen.getByRole('button', { name: /continue/i }));

    // Step 4: Goals — all fields optional, just Continue
    await waitFor(() => screen.getByText(/your goals/i));
    await user.click(screen.getByRole('button', { name: /continue/i }));

    // Step 5: Routine — all fields optional, just Continue
    await waitFor(() => screen.getByText(/your routine/i));
    await user.click(screen.getByRole('button', { name: /continue/i }));

    // Step 6: Snapshot review — just Continue
    await waitFor(() => screen.getByText(/snapshot/i));
    await user.click(screen.getByRole('button', { name: /continue/i }));

    // Step 7: Ready — click "Open dashboard" to complete
    const finishButton = await screen.findByRole('button', { name: /open dashboard/i });
    await user.click(finishButton);

    // Assert onComplete was called
    expect(onComplete).toHaveBeenCalledTimes(1);

    // Assert setUser was called with a valid User-shaped object
    expect(setUserSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Alex',
        medication: 'ozempic',
        startWeight: 85,
        units: 'metric',
      }),
    );

    // Assert disclaimer was acknowledged (D-10)
    expect(useStore.getState().acknowledgedDisclaimer).toBe('v1');
  });
});
