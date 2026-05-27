/**
 * Phase 66 Plan 66-06 — RoleMfaRequirementTable unit tests.
 *
 * Covers: load + render, superadmin toggle path, non-superadmin disabled path,
 * optimistic update + rollback on error, ADMIN_MODULES manifest entry.
 */

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { supabase } from '@/lib/supabase';

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: vi.fn(),
    rpc: vi.fn(),
    auth: { getUser: vi.fn() },
  },
}));


const mockFrom = supabase.from as unknown as ReturnType<typeof vi.fn>;
const mockRpc = supabase.rpc as unknown as ReturnType<typeof vi.fn>;
const mockGetUser = supabase.auth.getUser as unknown as ReturnType<typeof vi.fn>;

interface MfaRow {
  role: string;
  required: boolean;
  since: string;
}

function setupQueries(rows: MfaRow[], adminRole: string | null = 'superadmin') {
  mockGetUser.mockResolvedValue({ data: { user: { id: 'u-1' } }, error: null });
  mockFrom.mockImplementation((table: string) => {
    if (table === 'mfa_role_requirements') {
      return {
        select: () => ({
          order: () => Promise.resolve({ data: rows, error: null }),
        }),
      };
    }
    if (table === 'profiles') {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: () =>
              Promise.resolve({
                data: adminRole ? { admin_role: adminRole } : null,
                error: null,
              }),
          }),
        }),
      };
    }
    return { select: () => Promise.resolve({ data: [], error: null }) };
  });
}

const seeded: MfaRow[] = [
  { role: 'admin', required: true, since: '2026-01-01T00:00:00Z' },
  { role: 'clinic-admin', required: false, since: '2026-01-01T00:00:00Z' },
  { role: 'staff', required: false, since: '2026-01-01T00:00:00Z' },
  { role: 'superadmin', required: true, since: '2026-01-01T00:00:00Z' },
  { role: 'user', required: false, since: '2026-01-01T00:00:00Z' },
];

beforeEach(() => {
  mockFrom.mockReset();
  mockRpc.mockReset();
  mockGetUser.mockReset();
});

async function renderTable() {
  const { RoleMfaRequirementTable } = await import('./RoleMfaRequirementTable');
  return render(<RoleMfaRequirementTable />);
}

describe('RoleMfaRequirementTable', () => {
  it('renders heading + all 5 seeded rows', async () => {
    setupQueries(seeded);
    await renderTable();
    await waitFor(() => {
      expect(
        screen.getByRole('heading', { name: /Role MFA requirements/i, level: 1 }),
      ).toBeDefined();
    });
    for (const role of ['superadmin', 'admin', 'staff', 'clinic-admin', 'user']) {
      expect(screen.getByText(role)).toBeDefined();
    }
  });

  it('superadmin can toggle a checkbox — calls set_mfa_role_requirement RPC', async () => {
    setupQueries(seeded, 'superadmin');
    mockRpc.mockResolvedValueOnce({ data: null, error: null });
    await renderTable();
    const cb = (await screen.findByLabelText('MFA required for staff')) as HTMLInputElement;
    await waitFor(() => expect(cb.disabled).toBe(false));
    fireEvent.click(cb);
    await waitFor(() => {
      expect(mockRpc).toHaveBeenCalledWith('set_mfa_role_requirement', {
        p_role: 'staff',
        p_required: true,
      });
    });
  });

  it('non-superadmin sees disabled checkboxes + read-only notice', async () => {
    setupQueries(seeded, 'admin');
    await renderTable();
    const cb = (await screen.findByLabelText('MFA required for staff')) as HTMLInputElement;
    await waitFor(() => expect(cb.disabled).toBe(true));
    expect(screen.getByText(/viewing this read-only/i)).toBeDefined();
  });

  it('rollback on RPC error restores previous state + surfaces alert', async () => {
    setupQueries(seeded, 'superadmin');
    mockRpc.mockResolvedValueOnce({
      data: null,
      error: { code: '42501', message: 'forbidden: only superadmin can change MFA role requirements' },
    });
    await renderTable();
    const cb = (await screen.findByLabelText('MFA required for staff')) as HTMLInputElement;
    await waitFor(() => expect(cb.disabled).toBe(false));
    expect(cb.checked).toBe(false);
    fireEvent.click(cb);
    // After RPC failure, checkbox should rollback to unchecked + alert appears.
    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeDefined();
    });
    const cbAfter = screen.getByLabelText('MFA required for staff') as HTMLInputElement;
    expect(cbAfter.checked).toBe(false);
  });

  it('ADMIN_MODULES manifest registers key=users-security + route=users/security', async () => {
    const { ADMIN_MODULES } = await import('@/lib/admin/modules');
    const entry = ADMIN_MODULES.find((m) => m.key === 'users-security');
    expect(entry).toBeDefined();
    expect(entry?.route).toBe('users/security');
    expect(entry?.minRole).toBe('admin');
  });
});
