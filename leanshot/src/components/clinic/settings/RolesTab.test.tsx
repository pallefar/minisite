/**
 * Phase 9 Plan 09-03 — RolesTab tests.
 *
 * Behavior tests 13-18 from the plan + State Coverage Checklist rows.
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RolesTab } from './RolesTab';

const rpcMock = vi.fn();

type FromBuilder = {
  select: () => FromBuilder;
  eq: () => FromBuilder;
  order: () => FromBuilder;
  then?: (onFulfilled: (v: { data: unknown[] | null; error: unknown }) => unknown) => unknown;
};
const fromResults = new Map<string, { data: unknown[] | null; error: unknown }>();
function makeFromBuilder(result: { data: unknown[] | null; error: unknown }): FromBuilder {
  const b: FromBuilder = {
    select: () => b,
    eq: () => b,
    order: () => b,
    then(onFulfilled) {
      return Promise.resolve(result).then(onFulfilled);
    },
  };
  return b;
}

vi.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpcMock(...args),
    from: (table: string) => makeFromBuilder(fromResults.get(table) ?? { data: [], error: null }),
  },
}));

const showToastMock = vi.fn();
vi.mock('@/lib/store', () => ({
  useStore: Object.assign(() => undefined, {
    getState: () => ({
      showToast: (...args: unknown[]) => showToastMock(...args),
      dismissToast: vi.fn(),
    }),
  }),
}));

const SYSTEM_ROLES = [
  {
    id: 'role-owner',
    org_id: 'org-1',
    name: 'Owner',
    description: 'Full access to the workspace, including settings, members, and patient data.',
    is_system: true,
    created_at: '2026-01-01T00:00:00Z',
  },
  {
    id: 'role-coach',
    org_id: 'org-1',
    name: 'Coach',
    description:
      'Reads patient data and photos. Cannot manage members, roles, or workspace settings.',
    is_system: true,
    created_at: '2026-01-01T00:00:01Z',
  },
  {
    id: 'role-viewonly',
    org_id: 'org-1',
    name: 'View-only',
    description: 'Reads patient data without photos. Cannot manage anything.',
    is_system: true,
    created_at: '2026-01-01T00:00:02Z',
  },
];

describe('RolesTab', () => {
  beforeEach(() => {
    rpcMock.mockReset();
    showToastMock.mockReset();
    fromResults.clear();
  });

  afterEach(() => {
    fromResults.clear();
  });

  it('Test 13 — renders 3 system roles with Default badges + no delete affordance', async () => {
    fromResults.set('roles', { data: SYSTEM_ROLES, error: null });
    fromResults.set('role_permissions', { data: [], error: null });
    fromResults.set('memberships', { data: [], error: null });

    render(<RolesTab orgId="org-1" />);
    await waitFor(() => expect(screen.getByText('Owner')).toBeInTheDocument());
    expect(screen.getByText('Coach')).toBeInTheDocument();
    expect(screen.getByText('View-only')).toBeInTheDocument();
    // 3 Default badges
    expect(screen.getAllByText('Default')).toHaveLength(3);
    // No "Delete role X" CTAs on system rows
    expect(screen.queryByRole('button', { name: 'Delete role Owner' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete role Coach' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete role View-only' })).not.toBeInTheDocument();
  });

  it('Test 13b — custom roles empty state copy', async () => {
    fromResults.set('roles', { data: SYSTEM_ROLES, error: null });
    fromResults.set('role_permissions', { data: [], error: null });
    fromResults.set('memberships', { data: [], error: null });
    render(<RolesTab orgId="org-1" />);
    await waitFor(() => expect(screen.getByText('No custom roles.')).toBeInTheDocument());
    expect(screen.getByText('Default roles work for most workspaces.')).toBeInTheDocument();
  });

  it('Test 14 — Create role flow opens RoleEditorModal then calls create_role', async () => {
    fromResults.set('roles', { data: SYSTEM_ROLES, error: null });
    fromResults.set('role_permissions', { data: [], error: null });
    fromResults.set('memberships', { data: [], error: null });

    rpcMock.mockImplementation((name: string) => {
      if (name === 'create_role') {
        return Promise.resolve({ data: { role_id: 'role-NEW' }, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    });

    render(<RolesTab orgId="org-1" />);
    await waitFor(() => expect(screen.getByText('Owner')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'Create role' }));
    // Modal opened
    expect(screen.getByLabelText('Role name')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Role name'), {
      target: { value: 'Triage' },
    });
    fireEvent.click(screen.getByRole('checkbox', { name: 'View patient data' }));
    // Click the modal's Create role submit (the *last* such button — header CTA renders earlier).
    const createButtons = screen.getAllByRole('button', { name: 'Create role' });
    fireEvent.click(createButtons[createButtons.length - 1]);

    await waitFor(() =>
      expect(rpcMock).toHaveBeenCalledWith(
        'create_role',
        expect.objectContaining({
          p_org_id: 'org-1',
          p_name: 'Triage',
          p_permission_keys: ['patient_data.read'],
        }),
      ),
    );
  });

  it('Test 16 — delete custom role 0 members: copy + submit calls delete_role', async () => {
    const customRole = {
      id: 'role-triage',
      org_id: 'org-1',
      name: 'Triage',
      description: null,
      is_system: false,
      created_at: '2026-05-01T00:00:00Z',
    };
    fromResults.set('roles', { data: [...SYSTEM_ROLES, customRole], error: null });
    fromResults.set('role_permissions', {
      data: [{ role_id: 'role-triage', permission_key: 'patient_data.read' }],
      error: null,
    });
    fromResults.set('memberships', { data: [], error: null });

    rpcMock.mockImplementation((name: string) => {
      if (name === 'delete_role') {
        return Promise.resolve({
          data: { reassigned_count: 0 },
          error: null,
        });
      }
      return Promise.resolve({ data: null, error: null });
    });

    render(<RolesTab orgId="org-1" />);
    await waitFor(() => expect(screen.getByText('Triage')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'Delete role Triage' }));
    expect(
      screen.getByText('This role is not assigned to any members. Deleting it cannot be undone.'),
    ).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Type role name to confirm delete'), {
      target: { value: 'Triage' },
    });
    const buttons = screen.getAllByRole('button', { name: 'Delete role' });
    fireEvent.click(buttons[buttons.length - 1]);
    await waitFor(() =>
      expect(rpcMock).toHaveBeenCalledWith('delete_role', { p_role_id: 'role-triage' }),
    );
    expect(showToastMock).toHaveBeenCalledWith(
      'Role "Triage" deleted. 0 members moved to View-only.',
      'success',
    );
  });

  it('Test 17 — delete custom role N members: reassignment copy + count in toast', async () => {
    const customRole = {
      id: 'role-triage',
      org_id: 'org-1',
      name: 'Triage',
      description: null,
      is_system: false,
      created_at: '2026-05-01T00:00:00Z',
    };
    fromResults.set('roles', { data: [...SYSTEM_ROLES, customRole], error: null });
    fromResults.set('role_permissions', { data: [], error: null });
    fromResults.set('memberships', {
      data: [
        { role_id: 'role-triage', revoked_at: null },
        { role_id: 'role-triage', revoked_at: null },
        { role_id: 'role-triage', revoked_at: null },
      ],
      error: null,
    });

    rpcMock.mockImplementation((name: string) => {
      if (name === 'delete_role') {
        return Promise.resolve({ data: { reassigned_count: 3 }, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    });

    render(<RolesTab orgId="org-1" />);
    await waitFor(() => expect(screen.getByText('Triage')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'Delete role Triage' }));
    expect(
      screen.getByText('3 members will be moved to the View-only role. Deleting cannot be undone.'),
    ).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Type role name to confirm delete'), {
      target: { value: 'Triage' },
    });
    const buttons = screen.getAllByRole('button', { name: 'Delete role' });
    fireEvent.click(buttons[buttons.length - 1]);
    await waitFor(() =>
      expect(showToastMock).toHaveBeenCalledWith(
        'Role "Triage" deleted. 3 members moved to View-only.',
        'success',
      ),
    );
  });

  it('Test 15 — edit custom role opens RoleEditorModal pre-filled then calls update_role', async () => {
    const customRole = {
      id: 'role-triage',
      org_id: 'org-1',
      name: 'Triage',
      description: 'Initial role',
      is_system: false,
      created_at: '2026-05-01T00:00:00Z',
    };
    fromResults.set('roles', { data: [...SYSTEM_ROLES, customRole], error: null });
    fromResults.set('role_permissions', {
      data: [{ role_id: 'role-triage', permission_key: 'patient_data.read' }],
      error: null,
    });
    fromResults.set('memberships', { data: [], error: null });

    rpcMock.mockImplementation((name: string) => {
      if (name === 'update_role') return Promise.resolve({ data: null, error: null });
      return Promise.resolve({ data: null, error: null });
    });

    render(<RolesTab orgId="org-1" />);
    await waitFor(() => expect(screen.getByText('Triage')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'Edit role Triage' }));
    // Modal pre-fills name
    expect((screen.getByLabelText('Role name') as HTMLInputElement).value).toBe('Triage');
    expect(
      (screen.getByRole('checkbox', { name: 'View patient data' }) as HTMLInputElement).checked,
    ).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() =>
      expect(rpcMock).toHaveBeenCalledWith(
        'update_role',
        expect.objectContaining({
          p_role_id: 'role-triage',
          p_name: 'Triage',
        }),
      ),
    );
  });

  it('Test 18 — system role rows do NOT render a delete IconButton (defense in depth)', async () => {
    fromResults.set('roles', { data: SYSTEM_ROLES, error: null });
    fromResults.set('role_permissions', { data: [], error: null });
    fromResults.set('memberships', { data: [], error: null });
    render(<RolesTab orgId="org-1" />);
    await waitFor(() => expect(screen.getByText('Owner')).toBeInTheDocument());
    SYSTEM_ROLES.forEach((r) => {
      expect(
        screen.queryByRole('button', { name: `Delete role ${r.name}` }),
      ).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: `Edit role ${r.name}` })).not.toBeInTheDocument();
    });
  });
});
