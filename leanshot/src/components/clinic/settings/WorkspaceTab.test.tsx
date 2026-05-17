/**
 * Phase 9 Plan 09-03 — WorkspaceTab tests.
 *
 * Behavior tests 3–6 from the plan + State Coverage Checklist for
 * Workspace tab (fresh load / dirty / submitting / error / Danger zone
 * Owner / Danger zone hidden non-Owner / typed confirm).
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Org } from '@/types/clinic';
import { WorkspaceTab } from './WorkspaceTab';

const rpcMock = vi.fn();
vi.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpcMock(...args),
    auth: { getUser: vi.fn(async () => ({ data: { user: null }, error: null })) },
  },
}));

const showToastMock = vi.fn();
vi.mock('@/lib/store', () => ({
  useStore: Object.assign(
    () => undefined,
    {
      getState: () => ({
        showToast: (...args: unknown[]) => showToastMock(...args),
        dismissToast: vi.fn(),
      }),
    },
  ),
}));

const hasPermissionMock = vi.fn();
vi.mock('@/lib/clinic-permissions', () => ({
  useHasPermission: (...args: unknown[]) => hasPermissionMock(...args),
  clearPermissionCache: vi.fn(),
}));

const SAMPLE_ORG: Org = {
  id: 'org-1',
  slug: 'demo-clinic',
  name: 'Demo Clinic',
  description: null,
  website_url: null,
  logo_storage_path: null,
  created_by: 'user-1',
  created_at: '2026-01-01T00:00:00Z',
};

describe('WorkspaceTab', () => {
  beforeEach(() => {
    rpcMock.mockReset();
    showToastMock.mockReset();
    hasPermissionMock.mockReset();
    hasPermissionMock.mockReturnValue(false); // default non-Owner
  });

  it('Test 4 — fresh load populates name + slug as read-only URL', () => {
    render(<WorkspaceTab org={SAMPLE_ORG} onOrgUpdated={() => {}} />);
    expect((screen.getByLabelText('Workspace name') as HTMLInputElement).value).toBe(
      'Demo Clinic',
    );
    const slugField = screen.getByLabelText(
      'Workspace URL (read-only)',
    ) as HTMLInputElement;
    expect(slugField.value).toBe('leanshot.app/clinic/demo-clinic');
    expect(slugField.disabled).toBe(true);
    expect(screen.getByText('Change URL? Contact support.')).toBeInTheDocument();
  });

  it('Test 4b — save calls update_org + emits toast + onOrgUpdated', async () => {
    rpcMock.mockResolvedValueOnce({ data: null, error: null });
    const onOrgUpdated = vi.fn();
    render(<WorkspaceTab org={SAMPLE_ORG} onOrgUpdated={onOrgUpdated} />);
    const nameInput = screen.getByLabelText('Workspace name');
    fireEvent.change(nameInput, { target: { value: 'Renamed Clinic' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() =>
      expect(rpcMock).toHaveBeenCalledWith('update_org', {
        p_org_id: 'org-1',
        p_name: 'Renamed Clinic',
      }),
    );
    expect(showToastMock).toHaveBeenCalledWith('Workspace updated.', 'success');
    expect(onOrgUpdated).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Renamed Clinic' }),
    );
  });

  it('Test 3 — non-Owner: Danger zone hidden', () => {
    hasPermissionMock.mockReturnValue(false);
    render(<WorkspaceTab org={SAMPLE_ORG} onOrgUpdated={() => {}} />);
    expect(screen.queryByText('Danger zone')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Delete workspace' }),
    ).not.toBeInTheDocument();
  });

  it('Test 3b — Owner: Danger zone visible with Delete workspace CTA', () => {
    hasPermissionMock.mockReturnValue(true);
    render(<WorkspaceTab org={SAMPLE_ORG} onOrgUpdated={() => {}} />);
    expect(screen.getByText('Danger zone')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Delete workspace' }),
    ).toBeInTheDocument();
  });

  it('Test 5 — typed-confirm requires slug match to enable destructive CTA', () => {
    hasPermissionMock.mockReturnValue(true);
    render(<WorkspaceTab org={SAMPLE_ORG} onOrgUpdated={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Delete workspace' }));
    const typeInput = screen.getByLabelText(
      'Type workspace slug to confirm deletion',
    );
    // Destructive button has same label as the danger-zone CTA; pick the one
    // inside the modal (the destructive variant). We grep by being disabled.
    const buttons = screen.getAllByRole('button', { name: 'Delete workspace' });
    const modalSubmit = buttons[buttons.length - 1];
    expect(modalSubmit).toBeDisabled();
    fireEvent.change(typeInput, { target: { value: 'wrong-slug' } });
    expect(modalSubmit).toBeDisabled();
    fireEvent.change(typeInput, { target: { value: 'demo-clinic' } });
    expect(modalSubmit).not.toBeDisabled();
  });

  it('Test 6 — delete submit calls delete_org + window.location.assign("/")', async () => {
    hasPermissionMock.mockReturnValue(true);
    rpcMock.mockResolvedValueOnce({ data: null, error: null });
    const assignMock = vi.fn();
    const originalLocation = window.location;
    Object.defineProperty(window, 'location', {
      configurable: true,
      writable: true,
      value: { ...originalLocation, assign: assignMock },
    });

    try {
      render(<WorkspaceTab org={SAMPLE_ORG} onOrgUpdated={() => {}} />);
      fireEvent.click(screen.getByRole('button', { name: 'Delete workspace' }));
      fireEvent.change(
        screen.getByLabelText('Type workspace slug to confirm deletion'),
        { target: { value: 'demo-clinic' } },
      );
      const buttons = screen.getAllByRole('button', { name: 'Delete workspace' });
      fireEvent.click(buttons[buttons.length - 1]);
      await waitFor(() =>
        expect(rpcMock).toHaveBeenCalledWith('delete_org', { p_org_id: 'org-1' }),
      );
      expect(showToastMock).toHaveBeenCalledWith('Workspace deleted.', 'success');
      expect(assignMock).toHaveBeenCalledWith('/');
    } finally {
      Object.defineProperty(window, 'location', {
        configurable: true,
        writable: true,
        value: originalLocation,
      });
    }
  });

  it('Test server-error — surfaces save-failure toast', async () => {
    rpcMock.mockResolvedValueOnce({
      data: null,
      error: { message: 'boom', code: '23505' },
    });
    render(<WorkspaceTab org={SAMPLE_ORG} onOrgUpdated={() => {}} />);
    fireEvent.change(screen.getByLabelText('Workspace name'), {
      target: { value: 'Renamed' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => {
      expect(showToastMock).toHaveBeenCalledWith(
        "Couldn't save changes. Check your connection and try again.",
        'error',
      );
    });
  });

  it('Test discard — reverts name to original', () => {
    render(<WorkspaceTab org={SAMPLE_ORG} onOrgUpdated={() => {}} />);
    const input = screen.getByLabelText('Workspace name') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'Different' } });
    expect(input.value).toBe('Different');
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
    expect(input.value).toBe('Demo Clinic');
  });
});
