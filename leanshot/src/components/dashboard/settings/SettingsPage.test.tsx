import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { useStore } from '@/lib/store';
import { SettingsPage } from './SettingsPage';

/**
 * Phase 4 D-03 regression: the AI section + its nav entry must be gone
 * from Settings. The proxy-based AI flow needs no per-user key, so the
 * BYO UX is fully retired. This test guards the deletion across future
 * refactors of SettingsPage (a re-add would silently break SC#1).
 */
describe('SettingsPage — Phase 4 D-03 BYO key removal', () => {
  beforeEach(() => {
    useStore.setState({
      user: {
        name: 'Test',
        medication: 'tirzepatide',
        startDate: '2026-01-01',
        startWeight: 100,
        goalWeight: 80,
        dose: 2.5,
        doseUnit: 'mg',
        units: 'metric',
        proteinTarget: 130,
        calorieTarget: 1800,
        fiberTarget: 30,
        waterTarget: 8,
        goal: 'fat-loss',
        liftingLevel: 'beginner',
        sex: 'male',
        activityLevel: 'moderate',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
    });
  });

  it('does not render an "AI" or "AI assistant" nav entry', () => {
    render(<SettingsPage open onClose={() => {}} />);
    // The nav list lives inside the <nav aria-label="Settings sections">.
    const nav = screen.getByRole('navigation', { name: /settings sections/i });
    expect(nav.textContent ?? '').not.toMatch(/\bAI\b/);
  });

  it('does not render the "AI assistant" section heading anywhere', () => {
    render(<SettingsPage open onClose={() => {}} />);
    expect(screen.queryByText(/AI assistant/i)).toBeNull();
  });

  it('does not render an Anthropic API key input', () => {
    render(<SettingsPage open onClose={() => {}} />);
    expect(screen.queryByLabelText(/anthropic api key/i)).toBeNull();
    expect(screen.queryByPlaceholderText(/sk-ant-/i)).toBeNull();
  });
});
