/**
 * Phase 9 Plan 09-03 — MembersTab tests.
 *
 * Behavior tests 7-12, 21, 24 from the plan + State Coverage Checklist for
 * Members tab.
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Role } from '@/types/clinic';
import { MembersTab } from './MembersTab';

// ---- Supabase mock --------------------------------------------------------
const rpcMock = vi.fn();
const removeChannelMock = vi.fn();
const setAuthMock = vi.fn();
const channelOnMock = vi.fn();
const channelSubscribeMock = vi.fn();

type FromBuilder = {
  select: (cols?: string) => FromBuilder;
  eq: (col: string, val: unknown) => FromBuilder;
  is: (col: string, val: unknown) => FromBuilder;
  then?: (onFulfilled: (v: { data: unknown[] | null; error: unknown }) => unknown) => unknown;
  __result: { data: unknown[] | null; error: unknown };
};

function makeFromBuilder(result: { data: unknown[] | null; error: unknown }): FromBuilder {
  const b: FromBuilder = {
    select: () => b,
    eq: () => b,
    is: () => b,
    __result: result,
    then(onFulfilled) {
      return Promise.resolve(result).then(onFulfilled);
    },
  };
  return b;
}

const fromResults = new Map<string, { data: unknown[] | null; error: unknown }>();

vi.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpcMock(...args),
    from: (tableName: string) =>
      makeFromBuilder(fromResults.get(tableName) ?? { data: [], error: null }),
    auth: {
      getSession: async () => ({ data: { session: { access_token: 't' } } }),
      getUser: async () => ({ data: { user: { id: 'u-self' } }, error: null }),
    },
    realtime: {
      setAuth: (...args: unknown[]) => setAuthMock(...args),
    },
    channel: () => {
      const ch: {
        on: (...args: unknown[]) => typeof ch;
        subscribe: (...args: unknown[]) => { unsubscribe: () => void };
      } = {
        on: (...args: unknown[]) => {
          channelOnMock(...args);
          return ch;
        },
        subscribe: (...sArgs: unknown[]) => {
          channelSubscribeMock(...sArgs);
          return { unsubscribe: vi.fn() };
        },
      };
      return ch;
    },
    removeChannel: (...args: unknown[]) => removeChannelMock(...args),
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

const ROLES: Role[] = [
  {
    id: 'role-owner',
    org_id: 'org-1',
    name: 'Owner',
    description: null,
    is_system: true,
    created_at: '2026-01-01T00:00:00Z',
  },
  {
    id: 'role-coach',
    org_id: 'org-1',
    name: 'Coach',
    description: null,
    is_system: true,
    created_at: '2026-01-01T00:00:00Z',
  },
  {
    id: 'role-viewonly',
    org_id: 'org-1',
    name: 'View-only',
    description: null,
    is_system: true,
    created_at: '2026-01-01T00:00:00Z',
  },
];

function nowMinus(ms: number): string {
  return new Date(Date.now() - ms).toISOString();
}
function nowPlus(ms: number): string {
  return new Date(Date.now() + ms).toISOString();
}

describe('MembersTab', () => {
  beforeEach(() => {
    rpcMock.mockReset();
    removeChannelMock.mockReset();
    setAuthMock.mockReset();
    channelOnMock.mockReset();
    channelSubscribeMock.mockReset();
    showToastMock.mockReset();
    fromResults.clear();
  });

  afterEach(() => {
    fromResults.clear();
  });

  it('Test 24 (B-4) — fetches via list_org_members RPC; renders 2 rows', async () => {
    rpcMock.mockImplementation((name: string) => {
      if (name === 'list_org_members') {
        return Promise.resolve({
          data: [
            {
              user_id: 'u-1',
              email: 'alice@example.com',
              role_id: 'role-coach',
              joined_at: nowMinus(86400000),
              revoked_at: null,
            },
            {
              user_id: 'u-2',
              email: 'bob@example.com',
              role_id: 'role-viewonly',
              joined_at: nowMinus(3600000),
              revoked_at: null,
            },
          ],
          error: null,
        });
      }
      return Promise.resolve({ data: null, error: null });
    });
    fromResults.set('memberships', {
      data: [
        { id: 'm-1', user_id: 'u-1', role_id: 'role-coach', joined_at: '', revoked_at: null },
        { id: 'm-2', user_id: 'u-2', role_id: 'role-viewonly', joined_at: '', revoked_at: null },
      ],
      error: null,
    });
    fromResults.set('invites', { data: [], error: null });

    render(<MembersTab orgId="org-1" roles={ROLES} />);
    await waitFor(() => {
      expect(screen.getByText('alice')).toBeInTheDocument();
      expect(screen.getByText('bob')).toBeInTheDocument();
    });
    expect(rpcMock).toHaveBeenCalledWith('list_org_members', { p_org_id: 'org-1' });
  });

  it('Test 8 — revoke flow: typed-confirm + revoke_membership RPC + toast', async () => {
    rpcMock.mockImplementation((name: string) => {
      if (name === 'list_org_members') {
        return Promise.resolve({
          data: [
            {
              user_id: 'u-1',
              email: 'alice@example.com',
              role_id: 'role-coach',
              joined_at: nowMinus(86400000),
              revoked_at: null,
            },
          ],
          error: null,
        });
      }
      if (name === 'revoke_membership') {
        return Promise.resolve({ data: null, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    });
    fromResults.set('memberships', {
      data: [{ id: 'm-1', user_id: 'u-1', role_id: 'role-coach', joined_at: '', revoked_at: null }],
      error: null,
    });
    fromResults.set('invites', { data: [], error: null });

    render(<MembersTab orgId="org-1" roles={ROLES} />);
    await waitFor(() => expect(screen.getByText('alice')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'Revoke access for alice' }));
    fireEvent.change(screen.getByLabelText('Type member name to confirm revoke'), {
      target: { value: 'alice' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Revoke access' }));
    await waitFor(() =>
      expect(rpcMock).toHaveBeenCalledWith('revoke_membership', {
        p_membership_id: 'm-1',
      }),
    );
    await waitFor(() =>
      expect(showToastMock).toHaveBeenCalledWith(
        "Access revoked. alice's data is no longer visible.",
        'success',
      ),
    );
  });

  it('Test 9 — cancel pending invite calls cancel_invite + toast', async () => {
    rpcMock.mockImplementation((name: string) => {
      if (name === 'list_org_members') {
        return Promise.resolve({ data: [], error: null });
      }
      if (name === 'cancel_invite') {
        return Promise.resolve({ data: null, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    });
    fromResults.set('memberships', { data: [], error: null });
    fromResults.set('invites', {
      data: [
        {
          id: 'inv-1',
          email: 'carol@example.com',
          org_id: 'org-1',
          expires_at: nowPlus(48 * 3600000),
          created_at: nowMinus(60000),
          accepted_at: null,
          rejected_at: null,
          consumed_at: null,
        },
      ],
      error: null,
    });

    render(<MembersTab orgId="org-1" roles={ROLES} />);
    await waitFor(() => expect(screen.getByText('carol@example.com')).toBeInTheDocument());

    fireEvent.click(
      screen.getByRole('button', { name: 'Cancel invitation for carol@example.com' }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Cancel invitation' }));
    await waitFor(() =>
      expect(rpcMock).toHaveBeenCalledWith('cancel_invite', { p_invite_id: 'inv-1' }),
    );
    await waitFor(() =>
      expect(showToastMock).toHaveBeenCalledWith('Invitation canceled.', 'success'),
    );
  });

  it('Test 10 — re-send invite triggers "Invitation re-sent." toast', async () => {
    rpcMock.mockResolvedValue({ data: [], error: null });
    fromResults.set('memberships', { data: [], error: null });
    fromResults.set('invites', {
      data: [
        {
          id: 'inv-1',
          email: 'dave@example.com',
          org_id: 'org-1',
          expires_at: nowPlus(48 * 3600000),
          created_at: nowMinus(60000),
          accepted_at: null,
          rejected_at: null,
          consumed_at: null,
        },
      ],
      error: null,
    });

    render(<MembersTab orgId="org-1" roles={ROLES} />);
    await waitFor(() => expect(screen.getByText('dave@example.com')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'Re-send invitation to dave@example.com' }));
    expect(showToastMock).toHaveBeenCalledWith('Invitation re-sent.', 'success');
  });

  it('Test 11 — invite expiring < 24h shows "Expires in {h}h" warning Pill', async () => {
    rpcMock.mockResolvedValue({ data: [], error: null });
    fromResults.set('memberships', { data: [], error: null });
    fromResults.set('invites', {
      data: [
        {
          id: 'inv-soon',
          email: 'eve@example.com',
          org_id: 'org-1',
          expires_at: nowPlus(6 * 3600000), // 6h
          created_at: nowMinus(60000),
          accepted_at: null,
          rejected_at: null,
          consumed_at: null,
        },
      ],
      error: null,
    });

    render(<MembersTab orgId="org-1" roles={ROLES} />);
    await waitFor(() => expect(screen.getByText(/Expires in 6h/)).toBeInTheDocument());
  });

  it('Test 12 — Invite patient CTA dispatches clinic:open-invite event', async () => {
    rpcMock.mockResolvedValue({ data: [], error: null });
    fromResults.set('memberships', { data: [], error: null });
    fromResults.set('invites', { data: [], error: null });

    let captured: CustomEvent | null = null;
    const handler = (e: Event): void => {
      captured = e as CustomEvent;
    };
    window.addEventListener('clinic:open-invite', handler);

    try {
      render(<MembersTab orgId="org-1" roles={ROLES} />);
      await waitFor(() => expect(rpcMock).toHaveBeenCalled());
      fireEvent.click(screen.getByRole('button', { name: 'Invite patient' }));
      expect(captured).not.toBeNull();
      expect((captured as unknown as CustomEvent).detail).toEqual({ orgId: 'org-1' });
    } finally {
      window.removeEventListener('clinic:open-invite', handler);
    }
  });

  it('Test 21 — role-change dropdown calls update_member_role', async () => {
    rpcMock.mockImplementation((name: string) => {
      if (name === 'list_org_members') {
        return Promise.resolve({
          data: [
            {
              user_id: 'u-1',
              email: 'alice@example.com',
              role_id: 'role-coach',
              joined_at: nowMinus(86400000),
              revoked_at: null,
            },
          ],
          error: null,
        });
      }
      if (name === 'update_member_role') {
        return Promise.resolve({ data: null, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    });
    fromResults.set('memberships', {
      data: [{ id: 'm-1', user_id: 'u-1', role_id: 'role-coach', joined_at: '', revoked_at: null }],
      error: null,
    });
    fromResults.set('invites', { data: [], error: null });

    render(<MembersTab orgId="org-1" roles={ROLES} />);
    await waitFor(() => expect(screen.getByText('alice')).toBeInTheDocument());
    const select = screen.getByLabelText('Change role for alice');
    fireEvent.change(select, { target: { value: 'role-viewonly' } });
    await waitFor(() =>
      expect(rpcMock).toHaveBeenCalledWith('update_member_role', {
        p_membership_id: 'm-1',
        p_role_id: 'role-viewonly',
      }),
    );
    await waitFor(() => expect(showToastMock).toHaveBeenCalledWith('Role updated.', 'success'));
  });

  it('Test 7 — empty members → empty state copy', async () => {
    rpcMock.mockResolvedValue({ data: [], error: null });
    fromResults.set('memberships', { data: [], error: null });
    fromResults.set('invites', { data: [], error: null });
    render(<MembersTab orgId="org-1" roles={ROLES} />);
    await waitFor(() =>
      expect(screen.getByText('No patients have accepted yet.')).toBeInTheDocument(),
    );
    expect(screen.getByText('No pending invitations.')).toBeInTheDocument();
  });
});
