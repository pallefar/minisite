/**
 * Phase 41 Plan 41-06 — AllowlistPage RTL tests.
 *
 * 4 behaviors per PLAN.md §Task 1 <behavior>:
 *   T1: non-superadmin → NotAuthorizedCard (Pattern S1 page-level gate)
 *   T2: empty state copy when listHostnames returns []
 *   T3: 3 rows → AllowlistTable + AddHostnameForm both present
 *   T4: listHostnames rejects → WifiOff error card + Retry button
 *
 * Mocks supabase + @/lib/admin/iframe-allowlist (NOT live RPC).
 */
import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

let mockAuthRole: 'superadmin' | 'admin' | 'staff' = 'superadmin';
const mockListHostnames = vi.fn();

vi.mock('@/lib/admin/iframe-allowlist', () => ({
  listHostnames: (...args: unknown[]) => mockListHostnames(...args),
}));

vi.mock('@/lib/supabase', () => {
  const profilesBuilder = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn(() => Promise.resolve({ data: { admin_role: mockAuthRole }, error: null })),
  };
  return {
    supabase: {
      auth: {
        getUser: vi.fn(() => Promise.resolve({ data: { user: { id: 'user-1' } }, error: null })),
      },
      from: (_table: string) => profilesBuilder,
    },
  };
});

vi.mock('@/lib/store', () => ({
  useStore: {
    getState: () => ({
      showToast: vi.fn(),
      dismissToast: vi.fn(),
    }),
  },
}));

describe('AllowlistPage', () => {
  beforeEach(() => {
    mockListHostnames.mockReset();
    mockAuthRole = 'superadmin';
  });

  async function renderPage() {
    const { AllowlistPage } = await import('../AllowlistPage');
    render(<AllowlistPage />);
  }

  it('T1: non-superadmin (staff) renders NotAuthorizedCard', async () => {
    mockAuthRole = 'staff';
    mockListHostnames.mockResolvedValue([]);
    await renderPage();
    await waitFor(() => {
      expect(screen.getByText(/admin console/i)).toBeTruthy();
    });
    // listHostnames must NOT be called when denied at the page-level gate.
    expect(mockListHostnames).not.toHaveBeenCalled();
  });

  it('T2: empty state copy renders when listHostnames returns []', async () => {
    mockAuthRole = 'superadmin';
    mockListHostnames.mockResolvedValue([]);
    await renderPage();
    await waitFor(() => {
      expect(screen.getByText('No hostnames on the allowlist yet')).toBeTruthy();
    });
    expect(screen.getByText(/Add the first hostname above/i)).toBeTruthy();
  });

  it('T3: 3 rows renders AllowlistTable + AddHostnameForm', async () => {
    mockAuthRole = 'superadmin';
    mockListHostnames.mockResolvedValue([
      {
        id: 'r1',
        hostname: 'a.example.com',
        added_by_user_id: 'u1',
        added_at: new Date(Date.now() - 86_400_000).toISOString(),
        last_used_at: null,
      },
      {
        id: 'r2',
        hostname: 'b.example.com',
        added_by_user_id: 'u2',
        added_at: new Date(Date.now() - 2 * 86_400_000).toISOString(),
        last_used_at: new Date(Date.now() - 3600_000).toISOString(),
      },
      {
        id: 'r3',
        hostname: 'c.example.com',
        added_by_user_id: 'u3',
        added_at: new Date(Date.now() - 3 * 86_400_000).toISOString(),
        last_used_at: null,
      },
    ]);
    await renderPage();
    await waitFor(() => {
      expect(screen.getByText('a.example.com')).toBeTruthy();
    });
    expect(screen.getByText('b.example.com')).toBeTruthy();
    expect(screen.getByText('c.example.com')).toBeTruthy();
    // AddHostnameForm submit button present above the table.
    expect(screen.getByRole('button', { name: /add hostname/i })).toBeTruthy();
  });

  it('T4: listHostnames rejects → WifiOff error card + Retry', async () => {
    mockAuthRole = 'superadmin';
    mockListHostnames.mockRejectedValue(new Error('network failure'));
    await renderPage();
    await waitFor(() => {
      expect(screen.getByText(/We couldn’t load the allowlist/i)).toBeTruthy();
    });
    expect(screen.getByRole('button', { name: /retry/i })).toBeTruthy();
  });
});
