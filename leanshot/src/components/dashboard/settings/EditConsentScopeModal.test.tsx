/**
 * Phase 9 Plan 09-05 — EditConsentScopeModal unit tests.
 *
 * Covers:
 *  - Renders 10 canonical checkboxes from DATA_TYPE_LABELS.
 *  - Defensive scope-init (Pitfall #8 / W-5 fix): drifted blob with missing
 *    'sleep' + extra 'foo' → modal still renders all 10 + Save payload omits
 *    'foo' and includes 'sleep:false'.
 *  - Toggle + Save calls updateConsentScope with full ConsentScope shape.
 *  - Save success calls onSaved + onClose.
 *  - Save failure surfaces inline error.
 */

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { updateConsentScope } from '@/lib/clinic';
import { DATA_TYPE_KEYS, type ConsentScope, type Membership } from '@/types/clinic';
import { EditConsentScopeModal, type MembershipWithOrg } from './EditConsentScopeModal';

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: vi.fn(),
    rpc: vi.fn(),
    storage: { from: vi.fn() },
  },
}));

vi.mock('@/lib/clinic', () => ({
  updateConsentScope: vi.fn(),
  revokeMembership: vi.fn(),
}));

const fullTrue: ConsentScope = DATA_TYPE_KEYS.reduce(
  (acc, k) => ({ ...acc, [k]: true }),
  {} as ConsentScope,
);

function mkMembership(scope: Partial<ConsentScope> | Record<string, unknown>): MembershipWithOrg {
  return {
    id: 'm-1',
    user_id: 'u-1',
    org_id: 'o-1',
    role_id: 'r-1',
    consent_scope: scope as ConsentScope,
    invited_from_invite_id: null,
    joined_at: new Date(Date.now() - 86400000).toISOString(),
    accepted_at: new Date(Date.now() - 86400000).toISOString(),
    revoked_at: null,
    last_scope_changed_at: null,
    organizations: { id: 'o-1', name: 'Acme Clinic' },
  } satisfies Membership & { organizations: { id: string; name: string } };
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('EditConsentScopeModal', () => {
  it('renders the 10 canonical checkboxes in canonical order', () => {
    render(
      <EditConsentScopeModal
        membership={mkMembership(fullTrue)}
        onSaved={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    const checkboxes = screen.getAllByRole('checkbox');
    expect(checkboxes).toHaveLength(DATA_TYPE_KEYS.length);
    // All pre-filled true.
    for (const c of checkboxes) expect((c as HTMLInputElement).checked).toBe(true);
  });

  it('defensively initializes from drifted jsonb (missing key + extra key)', async () => {
    const drifted: Record<string, unknown> = { ...fullTrue, foo: true };
    // Drop 'sleep' to simulate a row missing a key.
    delete (drifted as Record<string, unknown>).sleep;

    const onSaved = vi.fn();
    const onClose = vi.fn();
    (updateConsentScope as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      data: null,
    });

    render(
      <EditConsentScopeModal
        membership={mkMembership(drifted)}
        onSaved={onSaved}
        onClose={onClose}
      />,
    );

    // All 10 canonical checkboxes still render.
    const boxes = screen.getAllByRole('checkbox');
    expect(boxes).toHaveLength(DATA_TYPE_KEYS.length);

    // 'sleep' should be unchecked (missing key defaults to false).
    const sleepBox = screen.getByLabelText('Sleep') as HTMLInputElement;
    expect(sleepBox.checked).toBe(false);

    // Click save — verify payload has exactly 10 canonical keys, no 'foo'.
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => expect(updateConsentScope).toHaveBeenCalledTimes(1));
    const call = (updateConsentScope as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.membership_id).toBe('m-1');
    const sentScope = call.consent_scope as Record<string, unknown>;
    expect(Object.keys(sentScope).sort()).toEqual([...DATA_TYPE_KEYS].sort());
    expect('foo' in sentScope).toBe(false);
    expect(sentScope.sleep).toBe(false);
  });

  it('toggling a checkbox and saving sends updated scope + calls onSaved+onClose', async () => {
    const onSaved = vi.fn();
    const onClose = vi.fn();
    (updateConsentScope as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      data: null,
    });

    render(
      <EditConsentScopeModal
        membership={mkMembership(fullTrue)}
        onSaved={onSaved}
        onClose={onClose}
      />,
    );

    const user = userEvent.setup();
    // Toggle 'photos' off.
    await user.click(screen.getByLabelText('Body photos'));
    await user.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => expect(updateConsentScope).toHaveBeenCalledTimes(1));
    const payload = (updateConsentScope as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0]
      .consent_scope as ConsentScope;
    expect(payload.photos).toBe(false);
    expect(payload.injections).toBe(true);
    expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ photos: false }));
    expect(onClose).toHaveBeenCalled();
  });

  it('shows inline error on save failure', async () => {
    (updateConsentScope as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      error: 'network',
    });

    render(
      <EditConsentScopeModal
        membership={mkMembership(fullTrue)}
        onSaved={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/couldn't save/i);
    });
  });
});
