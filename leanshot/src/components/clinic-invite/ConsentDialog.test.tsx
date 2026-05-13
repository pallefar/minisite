/**
 * Phase 9 Plan 09-04 — ConsentDialog RTL coverage.
 *
 * Covers:
 *   - 10-checkbox render from DATA_TYPE_LABELS
 *   - W-5 defensive scope-init (Pitfall #8 jsonb drift)
 *   - Accept (existing mode) → acceptInviteExisting
 *   - Accept (new mode) → acceptInviteNew
 *   - Decline confirmation modal → rejectInvite
 *   - Accept failure error path
 *   - Explicit-exclusion copy verbatim
 *   - [COUNSEL REVIEW NEEDED] code marker (source file grep)
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as clinic from '@/lib/clinic';
import { DATA_TYPE_KEYS } from '@/types/clinic';
import { ConsentDialog } from './ConsentDialog';

vi.mock('@/lib/clinic', () => ({
  acceptInviteExisting: vi.fn(),
  acceptInviteNew: vi.fn(),
  rejectInvite: vi.fn(),
  hashInviteToken: vi.fn(async (t: string) => `hash-of-${t}`),
}));

const mockedAcceptExisting = vi.mocked(clinic.acceptInviteExisting);
const mockedAcceptNew = vi.mocked(clinic.acceptInviteNew);
const mockedReject = vi.mocked(clinic.rejectInvite);

function buildInvite(overrides: Record<string, unknown> = {}) {
  return {
    id: 'inv-1',
    email: 'alice@example.com',
    requested_scope: DATA_TYPE_KEYS.reduce<Record<string, boolean>>((acc, k) => {
      acc[k] = true;
      return acc;
    }, {}),
    org: { id: 'org-1', name: 'Acme Clinic', logo_storage_path: null },
    operator_first_name: 'Bob',
    expires_at: new Date(Date.now() + 86_400_000).toISOString(),
    ...overrides,
  };
}

describe('ConsentDialog — Plan 09-04', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders heading + 10 checkboxes pre-filled from requested_scope', () => {
    render(
      <ConsentDialog invite={buildInvite()} rawToken="raw-token" mode="existing" />,
    );
    expect(screen.getByRole('heading', { name: /Choose what to share/i })).toBeInTheDocument();
    const checkboxes = screen.getAllByRole('checkbox');
    expect(checkboxes).toHaveLength(10);
    for (const cb of checkboxes) {
      expect(cb).toBeChecked();
    }
  });

  it('renders all 10 data-type labels from DATA_TYPE_LABELS', () => {
    render(
      <ConsentDialog invite={buildInvite()} rawToken="raw-token" mode="existing" />,
    );
    expect(screen.getByText('Injections')).toBeInTheDocument();
    expect(screen.getByText('Body photos')).toBeInTheDocument();
    expect(screen.getByText('Doctor report')).toBeInTheDocument();
  });

  it('W-5 defensive scope-init: malformed requested_scope coerces to 10 strict-bool keys', () => {
    const malformed = {
      injections: true,
      weights: true,
      sleep: 'not-a-bool',
      photos: undefined,
      extra_key_not_in_catalog: true,
      // missing the other 6 keys entirely
    };
    render(
      <ConsentDialog
        invite={buildInvite({ requested_scope: malformed })}
        rawToken="raw-token"
        mode="existing"
      />,
    );
    const checkboxes = screen.getAllByRole('checkbox');
    // EXACTLY 10 checkboxes — extra_key_not_in_catalog cannot leak in
    expect(checkboxes).toHaveLength(10);
    // injections + weights → checked; everything else (including 'sleep' with
    // a non-boolean) coerces to false via strict `=== true`
    const checked = checkboxes.filter((cb) => (cb as HTMLInputElement).checked);
    expect(checked).toHaveLength(2);
  });

  it('explicit-exclusion copy from UI-SPEC line 230 is rendered verbatim', () => {
    render(
      <ConsentDialog invite={buildInvite()} rawToken="raw-token" mode="existing" />,
    );
    expect(
      screen.getByText(
        /AI coach conversations, account settings, and anything you delete are never shared\. This is a LeanShot privacy guarantee\./,
      ),
    ).toBeInTheDocument();
  });

  it('renders BAA placeholder banner with role=note + aria-label="Legal review pending"', () => {
    render(
      <ConsentDialog invite={buildInvite()} rawToken="raw-token" mode="existing" />,
    );
    const banner = screen.getByRole('note', { name: /Legal review pending/i });
    expect(banner).toBeInTheDocument();
    // Marker comment lives in source — not rendered UI:
    expect(banner.textContent).not.toMatch(/COUNSEL REVIEW NEEDED/);
  });

  it('[COUNSEL REVIEW NEEDED] comment marker present in source file', () => {
    const src = readFileSync(
      resolve(__dirname, 'ConsentDialog.tsx'),
      'utf8',
    );
    expect(src).toMatch(/COUNSEL REVIEW NEEDED/);
  });

  it('unchecking a box updates the controlled state', async () => {
    const user = userEvent.setup();
    render(
      <ConsentDialog invite={buildInvite()} rawToken="raw-token" mode="existing" />,
    );
    const checkboxes = screen.getAllByRole('checkbox');
    expect(checkboxes[0]).toBeChecked();
    await user.click(checkboxes[0]!);
    expect(checkboxes[0]).not.toBeChecked();
  });

  it('Accept (existing mode) calls acceptInviteExisting with current scope', async () => {
    mockedAcceptExisting.mockResolvedValue({
      ok: true,
      data: { membership_id: 'm-1', org_id: 'org-1' },
    });
    const user = userEvent.setup();
    render(
      <ConsentDialog invite={buildInvite()} rawToken="raw-token" mode="existing" />,
    );
    await user.click(screen.getByRole('button', { name: /Accept and join/i }));
    await waitFor(() => expect(mockedAcceptExisting).toHaveBeenCalledTimes(1));
    expect(mockedAcceptExisting).toHaveBeenCalledWith(
      expect.objectContaining({
        invite_token_hash: 'hash-of-raw-token',
        consent_scope: expect.any(Object),
      }),
    );
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: /You're connected/i })).toBeInTheDocument(),
    );
  });

  it("Accept (new mode) calls acceptInviteNew", async () => {
    mockedAcceptNew.mockResolvedValue({
      ok: true,
      data: { membership_id: 'm-2', org_id: 'org-1' },
    });
    const user = userEvent.setup();
    render(<ConsentDialog invite={buildInvite()} rawToken="raw-token" mode="new" />);
    await user.click(screen.getByRole('button', { name: /Accept and join/i }));
    await waitFor(() => expect(mockedAcceptNew).toHaveBeenCalledTimes(1));
  });

  it('Accept failure renders inline error message', async () => {
    mockedAcceptExisting.mockResolvedValue({ ok: false, error: 'email_mismatch' });
    const user = userEvent.setup();
    render(
      <ConsentDialog invite={buildInvite()} rawToken="raw-token" mode="existing" />,
    );
    await user.click(screen.getByRole('button', { name: /Accept and join/i }));
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(/email_mismatch/i),
    );
  });

  it('Decline opens confirmation modal then calls rejectInvite', async () => {
    mockedReject.mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    render(
      <ConsentDialog invite={buildInvite()} rawToken="raw-token" mode="existing" />,
    );
    await user.click(screen.getByRole('button', { name: /^Decline$/i }));
    // Confirmation modal opens
    await waitFor(() =>
      expect(screen.getByText(/Decline this invitation\?/i)).toBeInTheDocument(),
    );
    await user.click(screen.getByRole('button', { name: /Decline invitation/i }));
    await waitFor(() => expect(mockedReject).toHaveBeenCalledTimes(1));
    expect(mockedReject).toHaveBeenCalledWith({ invite_token_hash: 'hash-of-raw-token' });
  });
});
