import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useStore } from '@/lib/store';
import type { User } from '@/types';
import { App } from './App';

// Stub the lazy-loaded dashboard tab modules so the dashboard branch renders
// deterministically without the test having to wait on real chunk loads.
// Only stub modules that the dashboard renders by default (currentTab === 'home').
vi.mock('@/components/dashboard/tabs/HomeTab', () => ({
  HomeTab: () => <div data-testid="home-tab-stub">HomeTabStub</div>,
}));
vi.mock('@/components/marketing/Landing', () => ({
  Landing: () => <div data-testid="marketing-stub">MarketingStub</div>,
}));
vi.mock('@/components/onboarding/OnboardingFlow', () => ({
  OnboardingFlow: () => <div data-testid="onboarding-stub">OnboardingStub</div>,
}));

// GuidedTour reads localStorage on mount via shouldShowTour; stub to avoid the
// auto-open setTimeout that would otherwise leak across tests.
vi.mock('@/components/dashboard/tour/GuidedTour', () => ({
  GuidedTour: () => null,
  shouldShowTour: () => false,
}));

function makeUser(): User {
  // Mirrors the User shape declared in src/types/index.ts (Phase 1 baseline).
  return {
    name: 'Alex',
    units: 'metric',
    medication: 'ozempic',
    dose: '0.25',
    doseUnit: 'mg',
    startDate: '2026-05-01',
    startWeight: 85,
    height: 175,
    age: 35,
    sex: 'male',
    bodyFat: null,
    goalWeight: 78,
    goal: 'fat-loss',
    proteinTarget: 150,
    calorieTarget: 2000,
    fiberTarget: 30,
    waterTarget: 2500,
    injectionDay: 1,
    activityLevel: 'moderate',
    liftingLevel: 'beginner',
    createdAt: '2026-05-01T00:00:00.000Z',
  };
}

describe('App — dashboard-render disclaimer fallback (D-11)', () => {
  beforeEach(() => {
    // Reset the persisted slice we touch. Other slices stay at their defaults.
    useStore.setState({ user: null, acknowledgedDisclaimer: undefined, currentTab: 'home' });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('does NOT mount the fallback for an acknowledged user on the dashboard (acked-dashboard)', async () => {
    useStore.setState({ user: makeUser(), acknowledgedDisclaimer: 'v1' });
    render(<App />);

    // Wait for the dashboard tab content to render so we know the App tree is live.
    await screen.findByTestId('home-tab-stub');
    expect(screen.queryByText(/not medical advice/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /i understand/i })).not.toBeInTheDocument();
  });

  it('mounts the fallback for an unacknowledged dashboard user (unacked-dashboard)', async () => {
    useStore.setState({ user: makeUser(), acknowledgedDisclaimer: undefined });
    render(<App />);

    expect(await screen.findByText(/not medical advice/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /i understand/i })).toBeInTheDocument();
  });

  it('mounts the fallback for a v3-migrated user (acknowledgedDisclaimer === undefined per 02-01 migration)', async () => {
    // Same observable behavior as the unacked case, but documented as a separate
    // assertion because v3→v5 migrants are the explicit motivation for the D-11
    // fallback (RESEARCH Pitfall 5: any default-true would silently grandfather them).
    useStore.setState({ user: makeUser(), acknowledgedDisclaimer: undefined });
    render(<App />);

    expect(await screen.findByText(/not medical advice/i)).toBeInTheDocument();
  });

  it('does NOT mount the fallback when there is no user (acked-onboarding / unacked-onboarding equivalence)', async () => {
    // user === null → marketing branch → no dashboard render → fallback is not mounted
    // regardless of acknowledgedDisclaimer value. Covers both `undefined` and `'v1'` cases
    // because the dashboard branch is the only call site.
    useStore.setState({ user: null, acknowledgedDisclaimer: undefined });
    render(<App />);

    await screen.findByTestId('marketing-stub');
    expect(screen.queryByText(/not medical advice/i)).not.toBeInTheDocument();

    // And again with 'v1' set — still no fallback (no dashboard branch).
    useStore.setState({ user: null, acknowledgedDisclaimer: 'v1' });
    expect(screen.queryByText(/not medical advice/i)).not.toBeInTheDocument();
  });

  it('removes the fallback after the user clicks "I understand" and writes acknowledgedDisclaimer = "v1"', async () => {
    useStore.setState({ user: makeUser(), acknowledgedDisclaimer: undefined });
    const user = userEvent.setup();
    render(<App />);

    const ack = await screen.findByRole('button', { name: /i understand/i });
    await user.click(ack);

    await waitFor(() => {
      expect(screen.queryByText(/not medical advice/i)).not.toBeInTheDocument();
    });
    expect(useStore.getState().acknowledgedDisclaimer).toBe('v1');
  });
});
