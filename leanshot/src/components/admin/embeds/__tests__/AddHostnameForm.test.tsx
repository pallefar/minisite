/**
 * Phase 41 Plan 41-06 — AddHostnameForm RTL tests.
 *
 * 8 behaviors per PLAN.md §Task 1 <behavior>:
 *   T1 empty input → "Hostname is required"
 *   T2 protocol → "Enter hostname only — no protocol"
 *   T3 path → "Enter hostname only — no path or query"
 *   T4 wildcard '*' → "Wildcards and leading dots are not supported"
 *   T5 leading dot '.' → same wildcard error
 *   T6 duplicate → "[hostname] is already on the allowlist"
 *   T7 success → addHostname called + onAdded + input cleared + Toast success
 *   T8 server 42501 → "Only superadmins can add hostnames"
 *
 * Mocks @/lib/admin/iframe-allowlist (NOT live RPC) per
 * feedback_executor_tdd_scaffolds_sibling_files.
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockAddHostname = vi.fn();

vi.mock('@/lib/admin/iframe-allowlist', () => ({
  addHostname: (...args: unknown[]) => mockAddHostname(...args),
}));

vi.mock('@/lib/supabase', () => ({
  supabase: { __mocked: true },
}));

const mockShowToast = vi.fn();
const mockDismissToast = vi.fn();

vi.mock('@/lib/store', () => ({
  useStore: {
    getState: () => ({
      showToast: mockShowToast,
      dismissToast: mockDismissToast,
    }),
  },
}));

describe('AddHostnameForm', () => {
  beforeEach(() => {
    mockAddHostname.mockReset();
    mockShowToast.mockReset();
    mockDismissToast.mockReset();
  });

  async function setup(
    overrides: { allowlist?: Array<{ hostname: string }>; onAdded?: (h: string) => void } = {},
  ) {
    const { AddHostnameForm } = await import('../AddHostnameForm');
    const onAdded = overrides.onAdded ?? vi.fn();
    render(
      <AddHostnameForm
        allowlist={overrides.allowlist ?? []}
        onAdded={onAdded}
      />,
    );
    return { onAdded };
  }

  function getSubmit(): HTMLButtonElement {
    return screen.getByRole('button', { name: /add hostname/i }) as HTMLButtonElement;
  }

  function getInput(): HTMLInputElement {
    return screen.getByLabelText(/hostname/i) as HTMLInputElement;
  }

  it('T1: empty input shows "Hostname is required"', async () => {
    await setup();
    fireEvent.click(getSubmit());
    expect(await screen.findByText('Hostname is required')).toBeTruthy();
    expect(mockAddHostname).not.toHaveBeenCalled();
  });

  it('T2: protocol shows "Enter hostname only — no protocol"', async () => {
    await setup();
    fireEvent.change(getInput(), { target: { value: 'https://meet.example.com' } });
    fireEvent.click(getSubmit());
    expect(await screen.findByText(/no protocol/i)).toBeTruthy();
    expect(mockAddHostname).not.toHaveBeenCalled();
  });

  it('T3: path shows "Enter hostname only — no path or query"', async () => {
    await setup();
    fireEvent.change(getInput(), { target: { value: 'meet.example.com/path' } });
    fireEvent.click(getSubmit());
    expect(await screen.findByText(/no path or query/i)).toBeTruthy();
  });

  it('T4: wildcard "*" shows wildcard error', async () => {
    await setup();
    fireEvent.change(getInput(), { target: { value: '*.example.com' } });
    fireEvent.click(getSubmit());
    expect(
      await screen.findByText(/wildcards and leading dots are not supported/i),
    ).toBeTruthy();
  });

  it('T5: leading dot shows wildcard error', async () => {
    await setup();
    fireEvent.change(getInput(), { target: { value: '.example.com' } });
    fireEvent.click(getSubmit());
    expect(
      await screen.findByText(/wildcards and leading dots are not supported/i),
    ).toBeTruthy();
  });

  it('T6: duplicate shows "[hostname] is already on the allowlist"', async () => {
    await setup({ allowlist: [{ hostname: 'meet.example.com' }] });
    fireEvent.change(getInput(), { target: { value: 'meet.example.com' } });
    fireEvent.click(getSubmit());
    expect(
      await screen.findByText('meet.example.com is already on the allowlist'),
    ).toBeTruthy();
  });

  it('T7: valid input calls addHostname + onAdded + clears + toast success', async () => {
    mockAddHostname.mockResolvedValue({ id: 'row-1' });
    const onAdded = vi.fn();
    await setup({ onAdded });
    fireEvent.change(getInput(), { target: { value: 'meet.example.com' } });
    fireEvent.click(getSubmit());

    await waitFor(() => {
      expect(mockAddHostname).toHaveBeenCalledWith(expect.anything(), 'meet.example.com');
    });
    await waitFor(() => {
      expect(onAdded).toHaveBeenCalledWith('meet.example.com');
    });
    expect(getInput().value).toBe('');
    expect(mockShowToast).toHaveBeenCalledWith(
      'Added meet.example.com to allowlist',
      'success',
    );
  });

  it('T8: 42501 server error shows "Only superadmins can add hostnames"', async () => {
    mockAddHostname.mockRejectedValue({ code: '42501', message: 'permission denied' });
    await setup();
    fireEvent.change(getInput(), { target: { value: 'meet.example.com' } });
    fireEvent.click(getSubmit());
    expect(
      await screen.findByText('Only superadmins can add hostnames'),
    ).toBeTruthy();
  });
});
