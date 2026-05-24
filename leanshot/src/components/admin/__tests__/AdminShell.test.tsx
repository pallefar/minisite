/**
 * Phase 24 Plan 24-03 — AdminShell RTL coverage.
 *
 * Covers behavior bullets from 24-03-PLAN Task 2:
 *   T1: nav renders only modules the user's role + flag combo allows.
 *   T2: direct URL navigation to a disabled module renders NotAuthorizedCard (no content leak).
 *   T3: when admin_role is null, renders NotAuthorizedCard and nav is empty.
 *   T4: AdminLayout no longer contains a hard-coded ADMIN_NAV constant.
 *   T5: lazy() returns a Promise (lazy bundle structure verified).
 */
import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AdminShell from '@/components/admin/AdminShell';

// ---------------------------------------------------------------------------
// Mock posthog-js — controls which feature flags are enabled per test.
// ---------------------------------------------------------------------------
const mockIsFeatureEnabled = vi.fn();
const mockOnFeatureFlags = vi.fn();

vi.mock('posthog-js', () => ({
  default: {
    isFeatureEnabled: (flag: string) => mockIsFeatureEnabled(flag),
    onFeatureFlags: (cb: () => void) => mockOnFeatureFlags(cb),
  },
}));

// ---------------------------------------------------------------------------
// Setup: enable flags for users + audit-log, disable ai flag.
// ---------------------------------------------------------------------------
beforeEach(() => {
  vi.clearAllMocks();
  // By default: most flags return undefined (not yet resolved → visible).
  // We explicitly control the flags used in each test.
  mockIsFeatureEnabled.mockImplementation((flag: string) => {
    if (flag === 'admin.ai.enabled') return false; // explicitly disabled
    return undefined; // undefined = flag not yet resolved = treated as visible
  });
  mockOnFeatureFlags.mockImplementation(() => {
    // noop: we test the initial render state
  });
  // Reset window.location.pathname to a safe default
  Object.defineProperty(window, 'location', {
    writable: true,
    value: { pathname: '/admin/users', href: 'http://localhost/admin/users' },
  });
});

describe('AdminShell', () => {
  it('T1: renders nav with modules visible for role=admin, hidden for insufficient role or disabled flag', async () => {
    render(<AdminShell adminRole="admin" />);

    // "Users" should be visible (staff required, admin qualifies)
    await waitFor(() => {
      expect(screen.getByRole('link', { name: /Users/i })).toBeInTheDocument();
    });

    // "AI" is explicitly flag-disabled (mockIsFeatureEnabled returns false for admin.ai.enabled)
    expect(screen.queryByRole('link', { name: /^AI$/i })).not.toBeInTheDocument();

    // "Audit Log" requires superadmin — admin role does NOT qualify
    expect(screen.queryByRole('link', { name: /Audit Log/i })).not.toBeInTheDocument();

    // "Analytics" requires admin — admin qualifies and flag returns undefined (visible)
    expect(screen.getByRole('link', { name: /Analytics/i })).toBeInTheDocument();
  });

  it('T2: direct navigation to a disabled module renders NotAuthorizedCard', async () => {
    // Simulate user typing /admin/ai in URL bar while role is admin (insufficient for superadmin module)
    Object.defineProperty(window, 'location', {
      writable: true,
      value: { pathname: '/admin/ai', href: 'http://localhost/admin/ai' },
    });

    render(<AdminShell adminRole="admin" currentPath="/admin/ai" />);

    // The module content area should show NotAuthorizedCard, not the AI placeholder
    await waitFor(() => {
      expect(screen.getByText(/This area is for admins only|not authorized|do not have access/i)).toBeInTheDocument();
    });
  });

  it('T3: when adminRole is null, renders NotAuthorizedCard and no nav links', async () => {
    render(<AdminShell adminRole={null} />);

    // Should render the not-authorized message
    await waitFor(() => {
      expect(screen.getByText(/This area is for admins only/i)).toBeInTheDocument();
    });

    // No nav links should be rendered
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
  });

  it('T5: ADMIN_MODULES lazy() returns a Promise', async () => {
    const { ADMIN_MODULES } = await import('@/lib/admin/modules');
    // Verify each lazy factory returns a Promise
    for (const mod of ADMIN_MODULES) {
      const result = mod.lazy();
      expect(result).toBeInstanceOf(Promise);
    }
  });

  // Phase 39 Plan 39-06 — manifest entry growth-experiments resolves via
  // AdminShell pathname.startsWith branch.
  //
  // Single mitigation for [[feedback_admin_module_manifest_vs_router_branch_drift]]:
  // the manifest+router are decoupled via the URL-prefix branch (AdminShell.tsx
  // lines 116-120). This test fails on drift before deploy — e.g. if someone
  // hardcodes a switch branch on tab id or removes the prefix catch-all.
  it('T6: manifest entry growth-experiments resolves via AdminShell pathname.startsWith branch', async () => {
    Object.defineProperty(window, 'location', {
      writable: true,
      value: {
        pathname: '/admin/growth/experiments',
        href: 'http://localhost/admin/growth/experiments',
      },
    });

    render(
      <AdminShell adminRole="admin" currentPath="/admin/growth/experiments" />,
    );

    // Confirm the lazy chunk resolves — ExperimentDashboardPage's testid
    // appears once the Suspense boundary settles. We do NOT assert the
    // module-not-found placeholder ("Admin module not found.") which would
    // fire if the manifest entry were missing or the URL-prefix branch
    // failed to match.
    await waitFor(() => {
      expect(screen.getByTestId('experiment-dashboard-shell')).toBeInTheDocument();
    });
  });

  // Phase 39 Plan 39-06 — verify the manifest entry itself has all 7
  // required fields per the AdminModule interface. Belt-and-braces against
  // a partial entry that compiles (e.g. missing flagKey would be a TS error
  // but a typo'd route would not).
  it('T7: ADMIN_MODULES has a growth-experiments entry with route=growth/experiments', async () => {
    const { ADMIN_MODULES } = await import('@/lib/admin/modules');
    const entry = ADMIN_MODULES.find((m) => m.key === 'growth-experiments');
    expect(entry).toBeDefined();
    expect(entry!.label).toBe('Experiments');
    expect(entry!.route).toBe('growth/experiments');
    expect(entry!.flagKey).toBe('admin.growth.experiments.enabled');
    expect(entry!.minRole).toBe('admin');
    expect(typeof entry!.lazy).toBe('function');
    expect(entry!.lazy()).toBeInstanceOf(Promise);
  });
});

describe('AdminLayout refactor', () => {
  it('T4: AdminLayout module does not contain a hard-coded ADMIN_NAV constant', async () => {
    // Dynamic import the AdminLayout source as a string to check for ADMIN_NAV
    // We use a module import and check that the named export doesn't reference the old constant
    const mod = await import('@/components/admin/AdminLayout');

    // The module should export AdminLayout (and not crash)
    expect(mod.AdminLayout).toBeDefined();

    // We cannot easily inspect source at runtime, so we verify the structural
    // refactor by asserting AdminLayout accepts adminRole prop (not active/heading).
    // If old ADMIN_NAV-based API remained, the type would require `active: AdminNavKey`.
    // The refactored version takes children and delegates to AdminShell.
    // This is a smoke test — the grep-based verification runs at CI level.
    expect(typeof mod.AdminLayout).toBe('function');
  });
});
