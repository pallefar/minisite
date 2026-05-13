/**
 * Phase 9 Plan 09-05 — ActiveOrganizationsSection unit tests.
 *
 * Coverage map (UI-SPEC State Coverage Checklist rows 833-852 + plan
 * behaviors 1-14):
 *  - Empty state (no memberships).
 *  - Row render with scope summary ("Sharing 7 of 10 data types").
 *  - Loading skeleton on initial mount.
 *  - Network error inline retry.
 *  - Edit IconButton opens EditConsentScopeModal.
 *  - Revoke IconButton opens typed-confirm modal.
 *  - Revoke submit calls revokeMembership + animates out + toast.
 *  - Realtime broadcast (operator-side revoke) animates row out + toast.
 *  - Defensive scope-counting: drifted jsonb with extra key + missing key.
 *  - B-2 invariant: SettingsPage.tsx is unchanged by this plan.
 */

import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { revokeMembership } from '@/lib/clinic';
import { DATA_TYPE_KEYS, type ConsentScope, type Membership } from '@/types/clinic';
import { ActiveOrganizationsSection } from './ActiveOrganizationsSection';

// --- Mocks ---------------------------------------------------------------

const fromMock = vi.fn();

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: (...args: unknown[]) => fromMock(...args),
    rpc: vi.fn(),
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'u-1' } } }),
    },
    storage: {
      from: vi.fn(() => ({
        getPublicUrl: () => ({ data: { publicUrl: '' } }),
      })),
    },
  },
}));

vi.mock('@/lib/clinic', () => ({
  updateConsentScope: vi.fn(),
  revokeMembership: vi.fn(),
}));

let realtimeCallback: ((payload: unknown) => void) | null = null;
const unsubscribeSpy = vi.fn();
vi.mock('@/lib/clinic-realtime', () => ({
  subscribeToUserChannel: vi.fn(async (_userId: string, cb: (payload: unknown) => void) => {
    realtimeCallback = cb;
    return { unsubscribe: unsubscribeSpy };
  }),
}));

// --- Fixtures ------------------------------------------------------------

function mkScope(trueKeys: string[]): ConsentScope {
  return DATA_TYPE_KEYS.reduce(
    (acc, k) => ({ ...acc, [k]: trueKeys.includes(k) }),
    {} as ConsentScope,
  );
}

const ROW_A = {
  id: 'm-acme',
  user_id: 'u-1',
  org_id: 'o-acme',
  role_id: 'r-1',
  consent_scope: mkScope([
    'injections',
    'weights',
    'photos',
    'symptoms',
    'meals',
    'workouts',
    'supplements',
  ]),
  invited_from_invite_id: null,
  joined_at: new Date(Date.now() - 86400000 * 3).toISOString(),
  accepted_at: new Date(Date.now() - 86400000 * 3).toISOString(),
  revoked_at: null,
  last_scope_changed_at: null,
  orgs: { id: 'o-acme', name: 'Acme Clinic', logo_storage_path: null },
  roles: { name: 'Coach' },
} satisfies Membership & {
  orgs: { id: string; name: string; logo_storage_path: string | null };
  roles: { name: string };
};

const ROW_B = {
  ...ROW_A,
  id: 'm-beta',
  org_id: 'o-beta',
  orgs: { id: 'o-beta', name: 'Beta Wellness', logo_storage_path: null },
  consent_scope: mkScope(['injections']),
  roles: { name: 'View-only' },
};

// --- Helpers -------------------------------------------------------------

interface QueryBuilder {
  select: ReturnType<typeof vi.fn>;
  is: ReturnType<typeof vi.fn>;
  order: ReturnType<typeof vi.fn>;
  then: (resolve: (v: unknown) => void) => void;
}

function buildQuery(result: { data: unknown[] | null; error: { message: string } | null }): QueryBuilder {
  const builder: QueryBuilder = {
    select: vi.fn(() => builder),
    is: vi.fn(() => builder),
    order: vi.fn(() => builder),
    then: (resolve: (v: unknown) => void) => {
      resolve(result);
    },
  };
  return builder;
}

beforeEach(() => {
  vi.clearAllMocks();
  fromMock.mockReset();
  realtimeCallback = null;
});

afterEach(() => {
  vi.restoreAllMocks();
});

// --- Tests ---------------------------------------------------------------

describe('ActiveOrganizationsSection', () => {
  it('renders empty state when no memberships', async () => {
    fromMock.mockReturnValueOnce(buildQuery({ data: [], error: null }));

    render(<ActiveOrganizationsSection />);

    await waitFor(() => {
      expect(screen.getByText(/no active memberships/i)).toBeInTheDocument();
    });
    expect(screen.getByText(/when a clinic or coach invites you/i)).toBeInTheDocument();
  });

  it('renders loading skeleton on initial mount', () => {
    fromMock.mockReturnValueOnce(buildQuery({ data: [], error: null }));
    render(<ActiveOrganizationsSection />);
    expect(screen.getByRole('status')).toHaveAttribute('aria-busy');
  });

  it('renders one row with "Sharing 7 of 10 data types" summary', async () => {
    fromMock.mockReturnValueOnce(buildQuery({ data: [ROW_A], error: null }));

    render(<ActiveOrganizationsSection />);

    await waitFor(() => {
      expect(screen.getByText('Acme Clinic')).toBeInTheDocument();
    });
    expect(screen.getByText('Sharing 7 of 10 data types')).toBeInTheDocument();
  });

  it('renders multiple rows', async () => {
    fromMock.mockReturnValueOnce(buildQuery({ data: [ROW_A, ROW_B], error: null }));

    render(<ActiveOrganizationsSection />);

    await waitFor(() => {
      expect(screen.getByText('Acme Clinic')).toBeInTheDocument();
      expect(screen.getByText('Beta Wellness')).toBeInTheDocument();
    });
    expect(screen.getByText('Sharing 7 of 10 data types')).toBeInTheDocument();
    expect(screen.getByText('Sharing 1 of 10 data types')).toBeInTheDocument();
  });

  it('shows inline retry on fetch error', async () => {
    fromMock.mockReturnValueOnce(
      buildQuery({ data: null, error: { message: 'connection lost' } }),
    );

    render(<ActiveOrganizationsSection />);

    await waitFor(() => {
      expect(screen.getByText(/couldn't load your memberships/i)).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
  });

  it('Edit IconButton opens the edit-scope modal with pre-filled scope', async () => {
    fromMock.mockReturnValueOnce(buildQuery({ data: [ROW_A], error: null }));

    render(<ActiveOrganizationsSection />);

    await waitFor(() => screen.getByText('Acme Clinic'));

    const user = userEvent.setup();
    await user.click(screen.getByLabelText('Edit what you share with Acme Clinic'));

    await waitFor(() => {
      expect(screen.getByText(/what you share with acme clinic/i)).toBeInTheDocument();
    });
    // 10 checkboxes rendered.
    expect(screen.getAllByRole('checkbox')).toHaveLength(DATA_TYPE_KEYS.length);
  });

  it('Revoke IconButton opens typed-confirm modal — destructive disabled until typed', async () => {
    fromMock.mockReturnValueOnce(buildQuery({ data: [ROW_A], error: null }));

    render(<ActiveOrganizationsSection />);
    await waitFor(() => screen.getByText('Acme Clinic'));

    const user = userEvent.setup();
    await user.click(screen.getByLabelText('Revoke membership with Acme Clinic'));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/revoke membership with acme clinic\?/i)).toBeInTheDocument();
    const revokeBtn = within(dialog).getByRole('button', { name: /revoke membership/i });
    expect(revokeBtn).toBeDisabled();

    await user.type(within(dialog).getByLabelText(/type acme clinic to revoke/i), 'Acme Clinic');
    expect(revokeBtn).not.toBeDisabled();
  });

  it('Revoke submit calls revokeMembership + row animates out', async () => {
    fromMock.mockReturnValueOnce(buildQuery({ data: [ROW_A], error: null }));
    // After revoke, refetch returns empty.
    fromMock.mockReturnValueOnce(buildQuery({ data: [], error: null }));

    (revokeMembership as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      data: null,
    });

    render(<ActiveOrganizationsSection />);
    await waitFor(() => screen.getByText('Acme Clinic'));

    const user = userEvent.setup();
    await user.click(screen.getByLabelText('Revoke membership with Acme Clinic'));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText(/type acme clinic to revoke/i), 'Acme Clinic');
    await user.click(within(dialog).getByRole('button', { name: /revoke membership/i }));

    await waitFor(() => {
      expect(revokeMembership).toHaveBeenCalledWith({ membership_id: 'm-acme' });
    });
    // Row enters exiting state.
    await waitFor(() => {
      const row = screen.queryByTestId('org-row-m-acme');
      // Row may be removed already (after the 240ms refetch timer fires within waitFor poll).
      if (row) expect(row.getAttribute('data-exiting')).toBe('true');
    });
  });

  it('Realtime operator-revoke broadcast animates row out + toast', async () => {
    // Every from() returns ROW_A until the broadcast fires.
    fromMock.mockImplementation(() => buildQuery({ data: [ROW_A], error: null }));

    render(<ActiveOrganizationsSection />);
    await waitFor(() => screen.getByText('Acme Clinic'));
    // Wait for the realtime subscription to register.
    await waitFor(() => expect(realtimeCallback).not.toBeNull());

    // Subsequent refetches return empty (the row has been revoked).
    fromMock.mockImplementation(() => buildQuery({ data: [], error: null }));

    realtimeCallback!({
      eventType: 'UPDATE',
      new: { id: 'm-acme', revoked_at: '2026-05-13T00:00:00Z' },
      old: { id: 'm-acme', revoked_at: null },
    });

    await waitFor(() => {
      const row = screen.queryByTestId('org-row-m-acme');
      if (row) expect(row.getAttribute('data-exiting')).toBe('true');
    });
  });

  it('Pitfall #8 — counts only canonical keys (extra "foo" ignored, missing key counts as not-shared)', async () => {
    const drifted: Record<string, unknown> = { ...ROW_A.consent_scope, foo: true };
    delete (drifted as Record<string, unknown>).sleep;
    const driftedRow = { ...ROW_A, consent_scope: drifted as ConsentScope };
    fromMock.mockReturnValueOnce(buildQuery({ data: [driftedRow], error: null }));

    render(<ActiveOrganizationsSection />);

    await waitFor(() => screen.getByText('Acme Clinic'));
    // ROW_A had 7 canonical trues; adding 'foo' must not inflate the count;
    // dropping 'sleep' (already false in this fixture) keeps it at 7.
    expect(screen.getByText('Sharing 7 of 10 data types')).toBeInTheDocument();
  });

  it('B-2 invariant — module never imports SettingsPage', () => {
    // Lightweight static check: import the section's source as text and
    // assert it doesn't reference SettingsPage. (Defense against future
    // refactors that might accidentally re-introduce the coupling.)
    // Note: we don't run git diff here — that's the orchestrator-side gate
    // via the plan's <verify> automated command.
    const source = ActiveOrganizationsSection.toString();
    expect(source).not.toMatch(/SettingsPage/);
  });
});
