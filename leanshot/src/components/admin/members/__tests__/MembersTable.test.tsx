/**
 * Phase 22 Plan 22-06 — MembersTable RTL coverage.
 *
 * Covers behavior bullets from 22-06-PLAN Task 1:
 *   T1: renders 7 columns + correct headers (UI-SPEC copy)
 *   T2: sort click cycles asc → desc → reset (3-click-revert)
 *   T3: row click invokes onRowOpen (Enter key works too)
 *   T4: row actions menu opens with 6 items
 *   T5: loading state renders skeleton; empty rows renders EmptyState
 */
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { MembersTable } from '@/components/admin/members/MembersTable';
import type { Member } from '@/lib/admin/admin-api';

const SAMPLE: Member[] = [
  {
    user_id: 'u-1',
    email: 'alice@example.com',
    tier: 'paid',
    signup_date: '2026-05-01T00:00:00Z',
    last_active_at: '2026-05-15T12:00:00Z',
    clinic_name: null,
    country: 'US',
    stripe_status: 'active',
  },
  {
    user_id: 'u-2',
    email: 'bob@example.com',
    tier: 'free',
    signup_date: '2026-04-20T00:00:00Z',
    last_active_at: null,
    clinic_name: 'Acme Clinic',
    country: 'GB',
    stripe_status: 'none',
  },
];

describe('<MembersTable /> — Phase 22 Plan 22-06', () => {
  it('T1 — renders 7 columns with the UI-SPEC headers', () => {
    render(<MembersTable rows={SAMPLE} isLoading={false} />);
    const table = screen.getByTestId('members-table');
    const headers = within(table).getAllByRole('columnheader');
    // 1 select-all column + 7 data columns + 1 actions column = 9 <th>.
    // Phase 70-07 cascade-28: select-all column was added since this test's
    // baseline; 8 → 9 to match the current shape.
    expect(headers).toHaveLength(9);
    expect(within(table).getByRole('button', { name: /^Email/i })).toBeInTheDocument();
    expect(within(table).getByRole('button', { name: /^Tier/i })).toBeInTheDocument();
    expect(within(table).getByRole('button', { name: /^Signed up/i })).toBeInTheDocument();
    expect(within(table).getByRole('button', { name: /^Last active/i })).toBeInTheDocument();
    expect(within(table).getByRole('button', { name: /^Clinic/i })).toBeInTheDocument();
    expect(within(table).getByRole('button', { name: /^Country/i })).toBeInTheDocument();
    expect(within(table).getByRole('button', { name: /^Stripe/i })).toBeInTheDocument();
  });

  it('T2 — sort click cycles asc → desc → reset', async () => {
    const user = userEvent.setup();
    render(<MembersTable rows={SAMPLE} isLoading={false} />);
    const table = screen.getByTestId('members-table');
    const emailButton = within(table).getByRole('button', { name: /^Email/i });
    const emailHeader = emailButton.closest('th')!;

    expect(emailHeader.getAttribute('aria-sort')).toBe('none');
    await user.click(emailButton);
    expect(emailHeader.getAttribute('aria-sort')).toBe('ascending');
    await user.click(emailButton);
    expect(emailHeader.getAttribute('aria-sort')).toBe('descending');
    await user.click(emailButton);
    expect(emailHeader.getAttribute('aria-sort')).toBe('none');
  });

  it('T3 — row click invokes onRowOpen', async () => {
    const user = userEvent.setup();
    const onRowOpen = vi.fn();
    render(<MembersTable rows={SAMPLE} isLoading={false} onRowOpen={onRowOpen} />);
    const row = screen.getByTestId('member-row-u-1');
    await user.click(row);
    expect(onRowOpen).toHaveBeenCalledWith('u-1');
  });

  it('T3b — Enter key on focused row invokes onRowOpen', async () => {
    const user = userEvent.setup();
    const onRowOpen = vi.fn();
    render(<MembersTable rows={SAMPLE} isLoading={false} onRowOpen={onRowOpen} />);
    const row = screen.getByTestId('member-row-u-1');
    row.focus();
    await user.keyboard('{Enter}');
    expect(onRowOpen).toHaveBeenCalledWith('u-1');
  });

  it('T4 — row actions menu opens with 6 menuitem entries', async () => {
    const user = userEvent.setup();
    render(<MembersTable rows={SAMPLE} isLoading={false} />);
    // Both desktop table and mobile card render the same aria-label in jsdom
    // (no CSS media queries) — pick the first occurrence (desktop table).
    const triggers = screen.getAllByLabelText(/Open actions for alice@example.com/i);
    await user.click(triggers[0]!);
    const menus = screen.getAllByRole('menu', { name: /Actions for alice@example.com/i });
    const items = within(menus[0]!).getAllByRole('menuitem');
    expect(items).toHaveLength(6);
    const labels = items.map((i) => i.textContent?.trim());
    expect(labels).toEqual([
      'Impersonate',
      'Refund a charge…',
      'Cancel subscription…',
      'Deactivate',
      'Override feature flag',
      'View detail',
    ]);
  });

  it('T5a — loading state renders skeleton placeholders', () => {
    render(<MembersTable rows={null} isLoading={true} />);
    expect(screen.getByTestId('members-table-loading')).toBeInTheDocument();
    expect(screen.queryByTestId('members-table')).not.toBeInTheDocument();
  });

  it('T5b — empty rows renders EmptyState with the UI-SPEC copy', () => {
    render(<MembersTable rows={[]} isLoading={false} />);
    expect(screen.getByText(/No members match your filters/i)).toBeInTheDocument();
    expect(screen.getByText(/clearing your filters/i)).toBeInTheDocument();
  });
});
