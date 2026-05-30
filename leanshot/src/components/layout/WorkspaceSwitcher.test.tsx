/**
 * Phase 9 Plan 09-08 — WorkspaceSwitcher RTL coverage.
 *
 * Covers all 10 State Coverage Checklist rows from
 * .planning/phases/09-clinic-b2b-foundations/09-UI-SPEC.md §"Workspace
 * switcher" (lines 705-716) plus the Pitfall #8 single-identity invariant
 * (Test 17) and the Pitfall #9 defer-mount invariant (Test 1).
 *
 * Test 18 (W-7 bundle ceiling) lives outside this file — see the inline
 * build guard script in 09-08-PLAN.md `<verify>`.
 */
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkspaceSwitcher } from './WorkspaceSwitcher';

const mockGetSession = vi.fn();
const mockFrom = vi.fn();
const mockSubscribeToUserChannel = vi.fn();

vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: () => mockGetSession(),
    },
    from: (...args: unknown[]) => mockFrom(...args),
    storage: {
      from: () => ({
        getPublicUrl: (path: string) => ({
          data: { publicUrl: `https://test.example/${path}` },
        }),
      }),
    },
  },
}));

vi.mock('@/lib/clinic-realtime', () => ({
  subscribeToUserChannel: (...args: unknown[]) => mockSubscribeToUserChannel(...args),
}));

interface MembershipRow {
  id: string;
  org_id: string;
  role_id: string;
  organizations: {
    id: string;
    slug: string;
    name: string;
    logo_storage_path: string | null;
    created_by: string;
  };
  roles: { name: string } | null;
}

function buildFromChain(rows: MembershipRow[], err: unknown = null) {
  // Phase 70-07 cascade-54 — defense against a fire-and-forget
  // use-clinician-alerts rejection (.select().eq().in().gte().order()) leaking
  // into this file's run from a sibling clinic test. Every builder method
  // returns the chain and the chain is awaitable so background queries that
  // terminate on .in()/.order() resolve cleanly. The memberships query's
  // .eq().is() terminal (→ rows) is preserved. Mirrors cascade-53.
  const chain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    gte: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnValue(Promise.resolve({ data: rows, error: err })),
    then: (resolve: (v: { data: unknown[]; error: null }) => unknown) =>
      Promise.resolve({ data: [], error: null }).then(resolve),
  };
  return chain;
}

function setSession(userId: string | null) {
  if (userId === null) {
    mockGetSession.mockResolvedValue({ data: { session: null } });
  } else {
    mockGetSession.mockResolvedValue({
      data: { session: { user: { id: userId } } },
    });
  }
}

function setMemberships(rows: MembershipRow[]) {
  mockFrom.mockImplementation(() => buildFromChain(rows));
}

beforeEach(() => {
  mockGetSession.mockReset();
  mockFrom.mockReset();
  mockSubscribeToUserChannel.mockReset();
  mockSubscribeToUserChannel.mockResolvedValue({ unsubscribe: vi.fn() });
  window.history.replaceState({}, '', '/');
});

afterEach(() => {
  cleanup();
});

describe('WorkspaceSwitcher — defer-mount (Pitfall #9)', () => {
  it('Test 1: renders a skeleton trigger while auth.getSession() is pending', async () => {
    let resolveSession:
      | ((v: { data: { session: { user: { id: string } } | null } }) => void)
      | null = null;
    mockGetSession.mockReturnValue(
      new Promise((res) => {
        resolveSession = res;
      }),
    );
    setMemberships([]);

    render(<WorkspaceSwitcher />);

    // Skeleton present, no trigger button yet
    expect(screen.getByTestId('workspace-switcher-skeleton')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Switch workspace/i })).toBeNull();

    await act(async () => {
      resolveSession?.({ data: { session: { user: { id: 'u-1' } } } });
    });
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Switch workspace/i })).toBeInTheDocument();
    });
    expect(screen.queryByTestId('workspace-switcher-skeleton')).toBeNull();
  });

  it('Test 1b: renders nothing once auth resolves with null session', async () => {
    setSession(null);
    setMemberships([]);
    const { container } = render(<WorkspaceSwitcher />);
    await waitFor(() => {
      expect(container.querySelector('[data-testid="workspace-switcher-skeleton"]')).toBeNull();
    });
    expect(screen.queryByRole('button', { name: /Switch workspace/i })).toBeNull();
  });
});

describe('WorkspaceSwitcher — Personal-only state (Test 2)', () => {
  it('renders "Your LeanShot" trigger + dropdown with 3 groups + empty hints', async () => {
    setSession('u-1');
    setMemberships([]);
    const user = userEvent.setup();

    render(<WorkspaceSwitcher />);
    const trigger = await screen.findByRole('button', { name: /Switch workspace/i });
    expect(trigger).toHaveTextContent(/Your LeanShot/i);

    await user.click(trigger);
    const list = await screen.findByRole('listbox');
    expect(within(list).getByText('Personal account')).toBeInTheDocument();
    expect(within(list).getByText('Memberships')).toBeInTheDocument();
    expect(within(list).getByText('Workspaces I run')).toBeInTheDocument();

    expect(
      within(list).getByText("When clinics or coaches invite you, they'll appear here."),
    ).toBeInTheDocument();
    expect(
      within(list).getByText('Create a workspace to start managing patients.'),
    ).toBeInTheDocument();
  });
});

describe('WorkspaceSwitcher — Personal + 1 workspace (Test 3)', () => {
  it('shows 1 workspace row in group 3', async () => {
    setSession('u-1');
    setMemberships([
      {
        id: 'm-1',
        org_id: 'org-1',
        role_id: 'r-1',
        roles: { name: 'Owner' },
        organizations: {
          id: 'org-1',
          slug: 'acme',
          name: 'Acme Clinic',
          logo_storage_path: null,
          created_by: 'u-1',
        },
      },
    ]);
    const user = userEvent.setup();
    render(<WorkspaceSwitcher />);
    const trigger = await screen.findByRole('button', { name: /Switch workspace/i });
    await user.click(trigger);

    const list = await screen.findByRole('listbox');
    expect(within(list).getByText('Acme Clinic')).toBeInTheDocument();
    expect(within(list).getByText(/Operator · Owner/)).toBeInTheDocument();
    // Memberships group hint still visible
    expect(
      within(list).getByText("When clinics or coaches invite you, they'll appear here."),
    ).toBeInTheDocument();
  });
});

describe('WorkspaceSwitcher — Personal + 1 membership + 1 workspace (Test 4)', () => {
  it('renders 3 rows; no empty hints in groups 2/3', async () => {
    setSession('u-1');
    setMemberships([
      {
        id: 'm-1',
        org_id: 'org-1',
        role_id: 'r-1',
        roles: { name: 'View-only' },
        organizations: {
          id: 'org-1',
          slug: 'wellness',
          name: 'Wellness Co',
          logo_storage_path: null,
          created_by: 'other-user',
        },
      },
      {
        id: 'm-2',
        org_id: 'org-2',
        role_id: 'r-2',
        roles: { name: 'Owner' },
        organizations: {
          id: 'org-2',
          slug: 'acme',
          name: 'Acme Clinic',
          logo_storage_path: null,
          created_by: 'u-1',
        },
      },
    ]);
    const user = userEvent.setup();
    render(<WorkspaceSwitcher />);
    await user.click(await screen.findByRole('button', { name: /Switch workspace/i }));
    const list = await screen.findByRole('listbox');

    expect(within(list).getByText('Your LeanShot')).toBeInTheDocument();
    expect(within(list).getByText('Wellness Co')).toBeInTheDocument();
    expect(within(list).getByText('Acme Clinic')).toBeInTheDocument();
    expect(
      within(list).queryByText("When clinics or coaches invite you, they'll appear here."),
    ).toBeNull();
    expect(within(list).queryByText('Create a workspace to start managing patients.')).toBeNull();
  });
});

describe('WorkspaceSwitcher — active context indicator (Tests 5, 6)', () => {
  it('Test 5: personal-route → personal row has aria-current="true"', async () => {
    window.history.replaceState({}, '', '/');
    setSession('u-1');
    setMemberships([
      {
        id: 'm-2',
        org_id: 'org-2',
        role_id: 'r-2',
        roles: { name: 'Owner' },
        organizations: {
          id: 'org-2',
          slug: 'acme',
          name: 'Acme Clinic',
          logo_storage_path: null,
          created_by: 'u-1',
        },
      },
    ]);
    const user = userEvent.setup();
    render(<WorkspaceSwitcher />);
    await user.click(await screen.findByRole('button', { name: /Switch workspace/i }));

    const list = await screen.findByRole('listbox');
    const options = within(list).getAllByRole('option');
    const personalRow = options.find((o) => o.textContent?.includes('Your LeanShot'));
    expect(personalRow).toBeDefined();
    expect(personalRow).toHaveAttribute('aria-current', 'true');
    const acmeRow = options.find((o) => o.textContent?.includes('Acme Clinic'));
    expect(acmeRow).toBeDefined();
    expect(acmeRow).not.toHaveAttribute('aria-current', 'true');
  });

  it('Test 6: clinic-route → workspace row has aria-current="true"', async () => {
    window.history.replaceState({}, '', '/clinic/acme');
    setSession('u-1');
    setMemberships([
      {
        id: 'm-2',
        org_id: 'org-2',
        role_id: 'r-2',
        roles: { name: 'Owner' },
        organizations: {
          id: 'org-2',
          slug: 'acme',
          name: 'Acme Clinic',
          logo_storage_path: null,
          created_by: 'u-1',
        },
      },
    ]);
    const user = userEvent.setup();
    render(<WorkspaceSwitcher />);
    await user.click(await screen.findByRole('button', { name: /Switch workspace/i }));
    const list = await screen.findByRole('listbox');
    const options = within(list).getAllByRole('option');
    const acmeRow = options.find((o) => o.textContent?.includes('Acme Clinic'));
    expect(acmeRow).toBeDefined();
    expect(acmeRow).toHaveAttribute('aria-current', 'true');
    const personalRow = options.find((o) => o.textContent?.includes('Your LeanShot'));
    expect(personalRow).toBeDefined();
    expect(personalRow).not.toHaveAttribute('aria-current', 'true');
  });
});

describe('WorkspaceSwitcher — row click routing (Tests 7-10)', () => {
  function setupOneMembershipAndOneWorkspace() {
    setSession('u-1');
    setMemberships([
      {
        id: 'm-1',
        org_id: 'org-1',
        role_id: 'r-1',
        roles: { name: 'View-only' },
        organizations: {
          id: 'org-1',
          slug: 'wellness',
          name: 'Wellness Co',
          logo_storage_path: null,
          created_by: 'other-user',
        },
      },
      {
        id: 'm-2',
        org_id: 'org-2',
        role_id: 'r-2',
        roles: { name: 'Owner' },
        organizations: {
          id: 'org-2',
          slug: 'acme',
          name: 'Acme Clinic',
          logo_storage_path: null,
          created_by: 'u-1',
        },
      },
    ]);
  }

  it('Test 7: membership row click → /settings/organizations', async () => {
    window.history.replaceState({}, '', '/clinic/acme');
    setupOneMembershipAndOneWorkspace();
    const user = userEvent.setup();
    render(<WorkspaceSwitcher />);
    await user.click(await screen.findByRole('button', { name: /Switch workspace/i }));
    const list = await screen.findByRole('listbox');
    const wellnessRow = within(list)
      .getAllByRole('option')
      .find((o) => o.textContent?.includes('Wellness Co'));
    await user.click(wellnessRow!);
    expect(window.location.pathname).toBe('/settings/organizations');
  });

  it('Test 8: workspace row click → /clinic/{slug}', async () => {
    window.history.replaceState({}, '', '/');
    setupOneMembershipAndOneWorkspace();
    const user = userEvent.setup();
    render(<WorkspaceSwitcher />);
    await user.click(await screen.findByRole('button', { name: /Switch workspace/i }));
    const list = await screen.findByRole('listbox');
    const acmeRow = within(list)
      .getAllByRole('option')
      .find((o) => o.textContent?.includes('Acme Clinic'));
    await user.click(acmeRow!);
    expect(window.location.pathname).toBe('/clinic/acme');
  });

  it('Test 9: personal row click → /', async () => {
    window.history.replaceState({}, '', '/clinic/acme');
    setupOneMembershipAndOneWorkspace();
    const user = userEvent.setup();
    render(<WorkspaceSwitcher />);
    await user.click(await screen.findByRole('button', { name: /Switch workspace/i }));
    const list = await screen.findByRole('listbox');
    const personalRow = within(list)
      .getAllByRole('option')
      .find((o) => o.textContent?.includes('Your LeanShot'));
    await user.click(personalRow!);
    expect(window.location.pathname).toBe('/');
  });

  it('Test 10: Create-new-workspace footer click → /?create-workspace=1', async () => {
    setSession('u-1');
    setMemberships([]);
    const user = userEvent.setup();
    render(<WorkspaceSwitcher />);
    await user.click(await screen.findByRole('button', { name: /Switch workspace/i }));
    await user.click(await screen.findByRole('button', { name: /Create a new workspace/i }));
    expect(window.location.pathname + window.location.search).toBe('/?create-workspace=1');
  });
});

describe('WorkspaceSwitcher — keyboard nav (Test 11)', () => {
  it('Escape closes dropdown and returns focus to trigger', async () => {
    setSession('u-1');
    setMemberships([]);
    const user = userEvent.setup();
    render(<WorkspaceSwitcher />);
    const trigger = await screen.findByRole('button', { name: /Switch workspace/i });
    await user.click(trigger);
    expect(await screen.findByRole('listbox')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    await waitFor(() => {
      expect(screen.queryByRole('listbox')).toBeNull();
    });
    expect(document.activeElement).toBe(trigger);
  });

  it('ArrowDown moves focus to next option; Enter activates', async () => {
    window.history.replaceState({}, '', '/');
    setSession('u-1');
    setMemberships([
      {
        id: 'm-2',
        org_id: 'org-2',
        role_id: 'r-2',
        roles: { name: 'Owner' },
        organizations: {
          id: 'org-2',
          slug: 'acme',
          name: 'Acme Clinic',
          logo_storage_path: null,
          created_by: 'u-1',
        },
      },
    ]);
    const user = userEvent.setup();
    render(<WorkspaceSwitcher />);
    const trigger = await screen.findByRole('button', { name: /Switch workspace/i });
    await user.click(trigger);
    await screen.findByRole('listbox');
    // First option (personal) should auto-focus on open
    await user.keyboard('{ArrowDown}');
    // ArrowDown should land on Acme row
    await user.keyboard('{Enter}');
    expect(window.location.pathname).toBe('/clinic/acme');
  });
});

describe('WorkspaceSwitcher — ClinicContextBar integration (Test 14)', () => {
  it('ClinicContextBar renders the real WorkspaceSwitcher (no placeholder no-op)', async () => {
    setSession('u-1');
    setMemberships([
      {
        id: 'm-1',
        org_id: 'org-1',
        role_id: 'r-1',
        roles: { name: 'Owner' },
        organizations: {
          id: 'org-1',
          slug: 'acme',
          name: 'Acme Clinic',
          logo_storage_path: null,
          created_by: 'u-1',
        },
      },
    ]);
    const { ClinicContextBar } = await import('@/components/clinic/ClinicContextBar');
    render(
      <ClinicContextBar
        org={{
          id: 'org-1',
          slug: 'acme',
          name: 'Acme Clinic',
          description: null,
          website_url: null,
          logo_storage_path: null,
          created_by: 'u-1',
          created_at: '2026-01-01T00:00:00Z',
        }}
      />,
    );
    // Wait for switcher mount + dropdown opens
    const trigger = await screen.findByRole('button', { name: /Switch workspace/i });
    expect(trigger).toHaveAttribute('aria-haspopup', 'listbox');
    const user = userEvent.setup();
    await user.click(trigger);
    expect(await screen.findByRole('listbox')).toBeInTheDocument();
  });
});

describe('WorkspaceSwitcher — Realtime cross-context update (Test 16)', () => {
  it('refetches contexts on membership broadcast', async () => {
    setSession('u-1');
    let call = 0;
    mockFrom.mockImplementation(() => {
      call += 1;
      const rows: MembershipRow[] =
        call === 1
          ? []
          : [
              {
                id: 'm-new',
                org_id: 'org-new',
                role_id: 'r-new',
                roles: { name: 'View-only' },
                organizations: {
                  id: 'org-new',
                  slug: 'new-org',
                  name: 'New Org',
                  logo_storage_path: null,
                  created_by: 'other-user',
                },
              },
            ];
      return buildFromChain(rows);
    });

    let onChangeCb: ((p: unknown) => void) | null = null;
    mockSubscribeToUserChannel.mockImplementation(
      async (_userId: string, cb: (p: unknown) => void) => {
        onChangeCb = cb;
        return { unsubscribe: vi.fn() };
      },
    );

    const user = userEvent.setup();
    render(<WorkspaceSwitcher />);
    await screen.findByRole('button', { name: /Switch workspace/i });

    // Trigger a broadcast — should cause refetch
    await act(async () => {
      onChangeCb?.({ type: 'INSERT', table: 'memberships' });
    });

    await user.click(screen.getByRole('button', { name: /Switch workspace/i }));
    await waitFor(() => {
      expect(screen.getByText('New Org')).toBeInTheDocument();
    });
  });
});

describe('WorkspaceSwitcher — single-identity invariant (Test 17)', () => {
  it('with 0 memberships + 0 workspaces, Personal account group still renders + both empty hints visible', async () => {
    setSession('u-1');
    setMemberships([]);
    const user = userEvent.setup();
    render(<WorkspaceSwitcher />);
    await user.click(await screen.findByRole('button', { name: /Switch workspace/i }));
    const list = await screen.findByRole('listbox');

    // Personal-account group always renders
    expect(within(list).getByText('Personal account')).toBeInTheDocument();
    expect(within(list).getByText('Your LeanShot')).toBeInTheDocument();
    expect(within(list).getByText('Your tracking data')).toBeInTheDocument();

    // Both empty hints render verbatim
    expect(
      within(list).getByText("When clinics or coaches invite you, they'll appear here."),
    ).toBeInTheDocument();
    expect(
      within(list).getByText('Create a workspace to start managing patients.'),
    ).toBeInTheDocument();
  });
});
