/**
 * Phase 9 Plan 09-03 — ClinicSettingsPage tests (shell + tab routing).
 *
 * Behavior tests 1, 2 from the plan. Test 23 (App.tsx untouched) is
 * verified by the verify step in the Bash assertion below, not by RTL.
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ClinicSettingsPage } from './ClinicSettingsPage';

const rpcMock = vi.fn();

type FromBuilder = {
  select: () => FromBuilder;
  eq: () => FromBuilder;
  is: () => FromBuilder;
  order: () => FromBuilder;
  limit: () => FromBuilder;
  then?: (
    onFulfilled: (v: { data: unknown[] | null; error: unknown }) => unknown,
  ) => unknown;
};
const fromResults = new Map<string, { data: unknown[] | null; error: unknown }>();
function makeFromBuilder(result: { data: unknown[] | null; error: unknown }): FromBuilder {
  const b: FromBuilder = {
    select: () => b,
    eq: () => b,
    is: () => b,
    order: () => b,
    limit: () => b,
    then(onFulfilled) {
      return Promise.resolve(result).then(onFulfilled);
    },
  };
  return b;
}

vi.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpcMock(...args),
    from: (table: string) =>
      makeFromBuilder(fromResults.get(table) ?? { data: [], error: null }),
    auth: {
      getSession: async () => ({ data: { session: { access_token: 't' } } }),
      getUser: async () => ({ data: { user: { id: 'u-1' } }, error: null }),
    },
    realtime: { setAuth: vi.fn() },
    channel: () => {
      const ch: {
        on: (...args: unknown[]) => typeof ch;
        subscribe: (...args: unknown[]) => { unsubscribe: () => void };
      } = {
        on: () => ch,
        subscribe: () => ({ unsubscribe: vi.fn() }),
      };
      return ch;
    },
    removeChannel: vi.fn(),
  },
}));

vi.mock('@/lib/store', () => ({
  useStore: Object.assign(
    () => undefined,
    {
      getState: () => ({
        showToast: vi.fn(),
        dismissToast: vi.fn(),
      }),
    },
  ),
}));

vi.mock('@/lib/clinic-permissions', () => ({
  useHasPermission: () => false,
  clearPermissionCache: vi.fn(),
}));

const ORG_ROW = {
  id: 'org-1',
  slug: 'demo-clinic',
  name: 'Demo Clinic',
  description: null,
  website_url: null,
  logo_storage_path: null,
  owner_user_id: 'u-1',
  created_at: '2026-01-01T00:00:00Z',
};

function setPath(p: string): void {
  window.history.pushState(null, '', p);
}

describe('ClinicSettingsPage', () => {
  beforeEach(() => {
    rpcMock.mockReset();
    fromResults.clear();
    fromResults.set('orgs', { data: [ORG_ROW], error: null });
    fromResults.set('roles', { data: [], error: null });
    fromResults.set('role_permissions', { data: [], error: null });
    fromResults.set('memberships', { data: [], error: null });
    fromResults.set('invites', { data: [], error: null });
    rpcMock.mockResolvedValue({ data: [], error: null });
  });

  afterEach(() => {
    setPath('/');
    fromResults.clear();
  });

  it('Test 1 — renders 3 tabs (Workspace + Members + Roles); landing tab is Workspace', async () => {
    setPath('/clinic/demo-clinic/settings');
    render(<ClinicSettingsPage />);
    await waitFor(() => expect(screen.getByText('Demo Clinic')).toBeInTheDocument());

    const workspaceBtn = screen.getByRole('button', { name: /Workspace$/ });
    const membersBtn = screen.getByRole('button', { name: /Members$/ });
    const rolesBtn = screen.getByRole('button', { name: /Roles$/ });

    expect(workspaceBtn).toHaveAttribute('aria-current', 'page');
    expect(membersBtn).not.toHaveAttribute('aria-current');
    expect(rolesBtn).not.toHaveAttribute('aria-current');

    // Workspace tab heading is visible
    expect(screen.getByText('Workspace settings')).toBeInTheDocument();
  });

  it('Test 2 — `/clinic/{slug}/settings/roles` mounts with Roles tab active', async () => {
    setPath('/clinic/demo-clinic/settings/roles');
    render(<ClinicSettingsPage />);
    await waitFor(() =>
      expect(screen.getByText('Roles and permissions')).toBeInTheDocument(),
    );
    const rolesBtn = screen.getByRole('button', { name: /Roles$/ });
    expect(rolesBtn).toHaveAttribute('aria-current', 'page');
  });

  it('Test 2b — tab switch updates URL via pushState (no remount)', async () => {
    setPath('/clinic/demo-clinic/settings');
    render(<ClinicSettingsPage />);
    await waitFor(() => expect(screen.getByText('Demo Clinic')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /Members$/ }));
    await waitFor(() =>
      expect(window.location.pathname).toBe('/clinic/demo-clinic/settings/members'),
    );
    // Heading from MembersTab renders.
    expect(
      screen.getByText('Active members of your workspace and pending invitations.'),
    ).toBeInTheDocument();
    const membersBtn = screen.getByRole('button', { name: /Members$/ });
    expect(membersBtn).toHaveAttribute('aria-current', 'page');
  });

  it('renders "Workspace not found" when slug does not resolve', async () => {
    fromResults.set('orgs', { data: [], error: null });
    setPath('/clinic/missing/settings');
    render(<ClinicSettingsPage />);
    await waitFor(() =>
      expect(screen.getByText('Workspace not found')).toBeInTheDocument(),
    );
  });
});
