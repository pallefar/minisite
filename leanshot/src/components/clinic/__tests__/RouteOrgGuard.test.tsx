/**
 * Phase 28 Plan 06 Task 2 — RouteOrgGuard component tests.
 *
 * Tests (per plan Task 2, Tests 1-4):
 *   T1 (vitest, member state): RPC returns member → renders children + injects org into Zustand.
 *   T2 (vitest, pending invite): RPC returns pending_invite → renders OrgInviteAcceptance.
 *   T3 (vitest, not_found): RPC returns not_found → renders 404; currentOrg stays null.
 *   T4 (vitest, anti-enumeration leak check): Both not_found cases render IDENTICAL DOM.
 */

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useStore } from '@/lib/store';
import { RouteOrgGuard } from '../RouteOrgGuard';

// ---------------------------------------------------------------------------
// Supabase RPC mock — vi.hoisted prevents hoisting-before-initialization.
// ---------------------------------------------------------------------------
const { mockRpc } = vi.hoisted(() => ({
  mockRpc: vi.fn(),
}));

vi.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: mockRpc,
  },
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderGuard(slug: string) {
  return render(
    <RouteOrgGuard slug={slug}>
      <div data-testid="child-content">Clinic Dashboard</div>
    </RouteOrgGuard>,
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('RouteOrgGuard', () => {
  beforeEach(() => {
    // Reset store to no-org state before each test.
    useStore.getState().clearCurrentOrg();
    mockRpc.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  // ── T1: member state ──────────────────────────────────────────────────────

  it('T1: member state — renders children and injects org into Zustand', async () => {
    const orgSummary = {
      id: 'org-uuid-x',
      slug: 'acme-clinic',
      name: 'Acme Clinic',
      role: 'owner' as const,
    };
    mockRpc.mockResolvedValueOnce({
      data: { state: 'member', org_summary: orgSummary },
      error: null,
    });

    renderGuard('acme-clinic');

    // Wait for async RPC resolution.
    await waitFor(() => {
      expect(screen.getByTestId('child-content')).toBeInTheDocument();
    });

    // Verify Zustand org slice is populated.
    const storeState = useStore.getState();
    expect(storeState.currentOrg?.id).toBe('org-uuid-x');
    expect(storeState.currentOrg?.slug).toBe('acme-clinic');
    expect(storeState.currentOrg?.name).toBe('Acme Clinic');
    expect(storeState.currentOrgRole).toBe('owner');

    // Verify children are visible.
    expect(screen.getByText('Clinic Dashboard')).toBeInTheDocument();
  });

  // ── T2: pending_invite state ───────────────────────────────────────────────

  it('T2: pending_invite — renders OrgInviteAcceptance, not children', async () => {
    const inviteSummary = {
      invite_id: 'invite-uuid-y',
      role: 'clinician' as const,
      expires_at: '2027-06-08T00:00:00Z',
    };
    mockRpc.mockResolvedValueOnce({
      data: { state: 'pending_invite', invite_summary: inviteSummary },
      error: null,
    });

    renderGuard('beta-clinic');

    // Wait for invite acceptance UI to appear.
    await waitFor(() => {
      expect(screen.getByTestId('org-invite-acceptance')).toBeInTheDocument();
    });

    // Children should NOT be visible.
    expect(screen.queryByTestId('child-content')).not.toBeInTheDocument();
  });

  // ── T3: not_found state ───────────────────────────────────────────────────

  it('T3: not_found — renders generic 404, currentOrg stays null', async () => {
    mockRpc.mockResolvedValueOnce({
      data: { state: 'not_found' },
      error: null,
    });

    renderGuard('ghost-clinic');

    await waitFor(() => {
      expect(screen.getByTestId('org-not-found')).toBeInTheDocument();
    });

    // Children should NOT be visible.
    expect(screen.queryByTestId('child-content')).not.toBeInTheDocument();

    // Store should remain with no org.
    const storeState = useStore.getState();
    expect(storeState.currentOrg).toBeNull();
  });

  // ── T4: anti-enumeration leak check ──────────────────────────────────────

  it('T4: anti-enumeration — existing-no-relationship and non-existent render identical DOM', async () => {
    // First render: slug exists but no membership.
    mockRpc.mockResolvedValueOnce({ data: { state: 'not_found' }, error: null });
    const { container: c1 } = renderGuard('existing-slug-no-membership');
    await waitFor(() => expect(screen.getByTestId('org-not-found')).toBeInTheDocument());
    const html1 = c1.innerHTML;

    cleanup();
    useStore.getState().clearCurrentOrg();

    // Second render: slug doesn't exist at all.
    mockRpc.mockResolvedValueOnce({ data: { state: 'not_found' }, error: null });
    const { container: c2 } = renderGuard('totally-fake-slug-xyz');
    await waitFor(() => expect(screen.getByTestId('org-not-found')).toBeInTheDocument());
    const html2 = c2.innerHTML;

    // The rendered HTML must be identical — no copy/text that leaks existence.
    expect(html1).toBe(html2);
  });
});
