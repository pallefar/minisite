/**
 * TicketForm — Phase 37 Plan 06 Task 3 (HELP-02).
 *
 * Authenticated-only new-ticket form. On submit calls Plan 01's SECDEF RPC
 * `create_ticket_with_first_message(p_subject, p_body, p_priority)` which
 * inserts a `public.tickets` row + the first `public.ticket_messages` row in
 * a single transaction (RLS-safe; auth.uid() ownership enforced server-side).
 *
 * Trust-boundary rules:
 *  - data-sentry-mask on the body textarea (HIPAA per leanshot/CLAUDE.md).
 *  - helpdesk.ticket.created analytics payload is length-only — never the raw
 *    subject or body (T-37-06-03 + T-37-06-05 mitigation).
 */
import { useState, type JSX } from 'react';
import { Button } from '@/components/ui/Button';
import { Input, Textarea } from '@/components/ui/Input';
import { track } from '@/lib/analytics';
import { supabase } from '@/lib/supabase';

export interface TicketFormProps {
  onSubmitted: (ticketId: string) => void;
  onCancel: () => void;
}

export default function TicketForm({
  onSubmitted,
  onCancel,
}: TicketFormProps): JSX.Element {
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    const trimmedSubject = subject.trim();
    const trimmedBody = body.trim();
    if (trimmedSubject.length === 0 || trimmedBody.length === 0) {
      setError('Subject and message are both required.');
      return;
    }
    if (trimmedSubject.length > 200) {
      setError('Subject must be 200 characters or fewer.');
      return;
    }
    setBusy(true);
    setError(null);
    const { data, error: rpcError } = await supabase.rpc(
      'create_ticket_with_first_message',
      {
        p_subject: trimmedSubject,
        p_body: trimmedBody,
        p_priority: 'p3',
      },
    );
    setBusy(false);
    if (rpcError || typeof data !== 'string') {
      setError(rpcError?.message ?? 'Could not create the ticket. Try again.');
      return;
    }
    // Length-only analytics — T-37-06-03 + T-37-06-05 mitigation.
    track('helpdesk.ticket.created', {
      ticket_id: data,
      subject_length: trimmedSubject.length,
      body_length: trimmedBody.length,
    });
    onSubmitted(data);
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3 p-3">
      <Input
        label="Subject"
        value={subject}
        onChange={(e) => setSubject(e.target.value)}
        maxLength={200}
        required
        placeholder="Briefly describe your question"
      />
      <Textarea
        label="Message body"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={5}
        required
        placeholder="What's going on? Include any error messages you saw."
        // HIPAA per leanshot/CLAUDE.md — clinician submissions can include PHI;
        // mask from Sentry session-replay capture.
        data-sentry-mask="true"
      />
      {error != null && (
        <p role="alert" className="text-xs text-[var(--color-danger)]">
          {error}
        </p>
      )}
      <div className="flex gap-2 justify-end">
        <Button type="button" variant="ghost" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
        <Button type="submit" disabled={busy} aria-busy={busy}>
          {busy ? 'Submitting…' : 'Submit ticket'}
        </Button>
      </div>
    </form>
  );
}
