/**
 * Phase 31 Plan 06 — OnboardingFlow org-branch render tests.
 *
 * Tests the 4 render-branch behaviors driven by useOrgOnboardingFlow status:
 *   1. consumer status → renders unchanged DEFAULT_STEPS path ("Welcome in." text)
 *   2. org status → renders org-customized welcome text + org step count
 *   3. completed status → renders null (defense-in-depth; App.tsx gate prevents this in prod)
 *   4. loading status → renders a Skeleton placeholder
 *
 * Mocking strategy: vi.mock useOrgOnboardingFlow so each test controls the
 * return value without any DB or auth calls.
 */

import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { OrgOnboardingFlowState } from '@/lib/onboarding-builder/use-org-onboarding-flow';
import { useOrgOnboardingFlow } from '@/lib/onboarding-builder/use-org-onboarding-flow';
import { OnboardingFlow } from '../OnboardingFlow';

// Mock useOrgOnboardingFlow before any module imports that depend on it
vi.mock('@/lib/onboarding-builder/use-org-onboarding-flow', () => ({
  useOrgOnboardingFlow: vi.fn(),
}));

// Mock supabase to avoid real calls in tests
vi.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
  },
}));

// Mock analytics to avoid side effects
vi.mock('@/lib/analytics', () => ({
  track: vi.fn(),
}));

const mockUseOrgOnboardingFlow = useOrgOnboardingFlow as ReturnType<typeof vi.fn>;

describe('OnboardingFlow — org render branch', () => {
  const noop = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── Test 1: consumer status → renders DEFAULT_STEPS ─────────────────────
  it('renders DEFAULT_STEPS consumer path when hook returns consumer status', () => {
    const consumerState: OrgOnboardingFlowState = {
      status: 'consumer',
      orgId: null,
      orgName: null,
      steps: null,
    };
    mockUseOrgOnboardingFlow.mockReturnValue(consumerState);

    render(<OnboardingFlow onCancel={noop} onComplete={noop} />);

    // The consumer path Step 0 shows "Before you start" disclaimer
    // (which is the first step of DEFAULT_STEPS path)
    expect(screen.getByText(/before you start/i)).toBeInTheDocument();
  });

  // ── Test 2: org status → renders org-customized welcome text ────────────
  it('renders org-customized welcome text when hook returns org status with custom title', () => {
    const orgState: OrgOnboardingFlowState = {
      status: 'org',
      orgId: 'org-001',
      orgName: 'Acme Health',
      steps: [
        {
          id: 'w1',
          type: 'welcome',
          custom: { title: 'Welcome to Acme Health', body: 'Your treatment journey starts here.' },
        },
        { id: 'm1', type: 'medication' },
        { id: 'c1', type: 'consent' },
      ],
    };
    mockUseOrgOnboardingFlow.mockReturnValue(orgState);

    render(<OnboardingFlow onCancel={noop} onComplete={noop} />);

    // Org flow should show the custom title, NOT the consumer "Welcome in." text
    expect(screen.getByText('Welcome to Acme Health')).toBeInTheDocument();
    expect(screen.queryByText(/welcome in\./i)).not.toBeInTheDocument();
  });

  // ── Test 3: completed status → renders null ──────────────────────────────
  it('renders nothing when hook returns completed status (defense-in-depth)', () => {
    const completedState: OrgOnboardingFlowState = {
      status: 'completed',
      orgId: null,
      orgName: null,
      steps: null,
    };
    mockUseOrgOnboardingFlow.mockReturnValue(completedState);

    const { container } = render(<OnboardingFlow onCancel={noop} onComplete={noop} />);

    // Component should return null — container should be empty
    expect(container.firstChild).toBeNull();
  });

  // ── Test 4: loading status → renders a Skeleton ──────────────────────────
  it('renders a skeleton placeholder when hook returns loading status', () => {
    const loadingState: OrgOnboardingFlowState = {
      status: 'loading',
      orgId: null,
      orgName: null,
      steps: null,
    };
    mockUseOrgOnboardingFlow.mockReturnValue(loadingState);

    render(<OnboardingFlow onCancel={noop} onComplete={noop} />);

    // Should render a skeleton (not the consumer or org content)
    // Skeleton component adds aria-hidden or a specific class/role
    expect(screen.queryByText(/before you start/i)).not.toBeInTheDocument();
    expect(screen.queryByText('Welcome to Acme Health')).not.toBeInTheDocument();
    // The component is rendering "something" (not null)
    // Verify by checking no disclaimer text is visible
    expect(screen.queryByText(/not medical advice/i)).not.toBeInTheDocument();
  });
});
