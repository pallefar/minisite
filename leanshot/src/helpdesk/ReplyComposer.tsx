/**
 * ReplyComposer — Phase 37 Plan 06 Task 3 (HELP-09 + HELP-10).
 *
 * Textarea at the bottom of TicketThread. On `/` at column 0 opens
 * MacroTypeahead overlay; selecting a macro inserts its body and closes the
 * overlay. For non-agents (RLS returns 0 macros) the overlay renders nothing
 * and the composer behaves as a plain textarea.
 *
 * HIPAA: `data-sentry-mask` on the body textarea per CLAUDE.md.
 *
 * MacroTypeahead is React.lazy()-imported so its cmdk + fuse.js weight lives
 * in a sub-chunk (T-37-06-06 mitigation — keeps helpdesk-widget root ≤25 kB gz).
 */
import { lazy, Suspense, useState, type JSX } from 'react';

import { Button } from '@/components/ui/Button';
import { Textarea } from '@/components/ui/Input';
import { track } from '@/lib/analytics';
import { supabase } from '@/lib/supabase';

const MacroTypeahead = lazy(() => import('./MacroTypeahead'));

export interface ReplyComposerProps {
  ticketId: string;
  onTyping?: () => void;
  onSent?: () => void;
}

export default function ReplyComposer({
  ticketId,
  onTyping,
  onSent,
}: ReplyComposerProps): JSX.Element {
  const [body, setBody] = useState('');
  const [macroOpen, setMacroOpen] = useState(false);
  const [macroQuery, setMacroQuery] = useState('');
  const [busy, setBusy] = useState(false);

  function handleChange(e: React.ChangeEvent<HTMLTextAreaElement>): void {
    const next = e.target.value;
    setBody(next);
    onTyping?.();
    // Slash-command — open MacroTypeahead when input starts with '/' (column 0).
    if (next.startsWith('/')) {
      setMacroOpen(true);
      setMacroQuery(next.slice(1));
    } else if (macroOpen) {
      setMacroOpen(false);
      setMacroQuery('');
    }
  }

  async function handleSend(): Promise<void> {
    const trimmed = body.trim();
    if (trimmed.length === 0) return;
    setBusy(true);
    const { error } = await supabase.from('ticket_messages').insert({
      ticket_id: ticketId,
      author_kind: 'user',
      body: trimmed,
      via: 'widget',
    });
    setBusy(false);
    if (error) return;
    track('helpdesk.ticket.replied', { ticket_id: ticketId, body_length: trimmed.length });
    setBody('');
    setMacroOpen(false);
    setMacroQuery('');
    onSent?.();
  }

  return (
    <div className="flex flex-col gap-2 p-3 border-t border-[var(--color-border)]">
      {macroOpen && (
        <Suspense fallback={null}>
          <MacroTypeahead
            query={macroQuery}
            onSelect={(macroBody) => {
              setBody(macroBody);
              setMacroOpen(false);
              setMacroQuery('');
            }}
            onClose={() => setMacroOpen(false)}
          />
        </Suspense>
      )}
      <Textarea
        label="Reply"
        value={body}
        onChange={handleChange}
        rows={3}
        placeholder="Type your reply — use / for macros"
        // HIPAA per leanshot/CLAUDE.md (PHI may appear in clinician replies).
        data-sentry-mask="true"
      />
      <div className="flex justify-end">
        <Button
          type="button"
          onClick={() => {
            void handleSend();
          }}
          disabled={busy || body.trim().length === 0}
          aria-busy={busy}
        >
          {busy ? 'Sending…' : 'Send'}
        </Button>
      </div>
    </div>
  );
}
