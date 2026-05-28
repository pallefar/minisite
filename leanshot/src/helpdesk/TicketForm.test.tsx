/**
 * TicketForm.test.tsx — Phase 37 Plan 06 Task 3 RED→GREEN (HELP-02).
 *
 * Verifies:
 *  - subject + body submit call supabase.rpc('create_ticket_with_first_message')
 *    with { p_subject, p_body, p_priority: 'p3' }
 *  - helpdesk.ticket.created event uses length-only payload (NO raw subject/body)
 *  - onSubmitted(ticket_id) called with the returned uuid
 *  - data-sentry-mask attribute present on the body textarea (HIPAA per CLAUDE.md)
 *  - Empty subject/body → no RPC call
 */

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import TicketForm from './TicketForm';

const trackMock = vi.fn();
vi.mock('@/lib/analytics', () => ({
  track: (...args: unknown[]) => trackMock(...args),
}));

const rpcMock = vi.fn();
vi.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpcMock(...args),
  },
}));

describe('TicketForm', () => {
  beforeEach(() => {
    trackMock.mockReset();
    rpcMock.mockReset();
  });

  it('calls create_ticket_with_first_message with subject+body and emits length-only analytics', async () => {
    const newTicketId = '11111111-2222-3333-4444-555555555555';
    rpcMock.mockResolvedValueOnce({ data: newTicketId, error: null });

    const onSubmitted = vi.fn();
    render(<TicketForm onSubmitted={onSubmitted} onCancel={() => {}} />);

    const subjectInput = screen.getByLabelText(/subject/i);
    const bodyInput = screen.getByLabelText(/body|message/i);
    await userEvent.type(subjectInput, 'Cannot log my dose');
    await userEvent.type(bodyInput, 'When I tap the inject button nothing happens.');
    await userEvent.click(screen.getByRole('button', { name: /submit|send|create/i }));

    await waitFor(() => {
      expect(rpcMock).toHaveBeenCalledWith(
        'create_ticket_with_first_message',
        expect.objectContaining({
          p_subject: 'Cannot log my dose',
          p_body: 'When I tap the inject button nothing happens.',
          p_priority: 'p3',
        }),
      );
    });

    expect(onSubmitted).toHaveBeenCalledWith(newTicketId);

    expect(trackMock).toHaveBeenCalledWith('helpdesk.ticket.created', {
      ticket_id: newTicketId,
      subject_length: 'Cannot log my dose'.length,
      body_length: 'When I tap the inject button nothing happens.'.length,
    });

    // T-37-06-03 + T-37-06-05 defence-in-depth: raw subject/body MUST NOT appear in any analytics call.
    for (const call of trackMock.mock.calls) {
      const props = call[1] ?? {};
      const json = JSON.stringify(props);
      expect(json).not.toContain('Cannot log my dose');
      expect(json).not.toContain('nothing happens');
    }
  });

  it('renders body textarea with data-sentry-mask (HIPAA per CLAUDE.md)', () => {
    render(<TicketForm onSubmitted={() => {}} onCancel={() => {}} />);
    const bodyInput = screen.getByLabelText(/body|message/i);
    expect(bodyInput).toHaveAttribute('data-sentry-mask');
  });

  it('does not call RPC when subject or body is empty', async () => {
    render(<TicketForm onSubmitted={() => {}} onCancel={() => {}} />);
    await userEvent.click(screen.getByRole('button', { name: /submit|send|create/i }));
    expect(rpcMock).not.toHaveBeenCalled();
  });
});
