/**
 * MacroTypeahead — Phase 37 Plan 06 Task 3 (HELP-10).
 *
 * Opened by ReplyComposer when the user types `/` at column 0. Loads the
 * caller's visible rows from `public.agent_macros` once on mount; non-agents
 * see zero rows (RLS-enforced) and the component renders nothing — composer
 * remains usable as a plain textarea.
 *
 * Fuse.js fuzzy matching against `shortcut` + `name`. The library is only
 * imported here (and not eagerly from HelpdeskWidget.tsx), so its bytes stay
 * in this lazy sub-chunk — protecting the helpdesk-widget root chunk's 25 kB
 * gz ceiling (T-37-06-06 mitigation).
 */
import Fuse from 'fuse.js';
import { useEffect, useMemo, useState, type JSX } from 'react';
import { supabase } from '@/lib/supabase';

type Macro = {
  id: string;
  shortcut: string;
  name: string;
  body: string;
  locale: string;
};

export interface MacroTypeaheadProps {
  query: string;
  onSelect: (body: string) => void;
  onClose: () => void;
}

export default function MacroTypeahead({
  query,
  onSelect,
  onClose,
}: MacroTypeaheadProps): JSX.Element | null {
  const [macros, setMacros] = useState<Macro[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { data, error } = await supabase
        .from('agent_macros')
        .select('id, shortcut, name, body, locale')
        .order('shortcut', { ascending: true });
      if (cancelled) return;
      if (error || !Array.isArray(data) || data.length === 0) {
        setMacros([]);
        return;
      }
      setMacros(data as Macro[]);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const fuse = useMemo(() => {
    if (!macros || macros.length === 0) return null;
    return new Fuse(macros, {
      keys: ['shortcut', 'name'],
      threshold: 0.4,
      includeScore: true,
    });
  }, [macros]);

  // Non-agent or pre-load: render nothing so the composer textarea stays usable.
  if (macros === null) return null;
  if (macros.length === 0) return null;

  const visible = fuse && query.length > 0 ? fuse.search(query).map((r) => r.item) : macros;

  if (visible.length === 0) return null;

  return (
    <ul
      role="listbox"
      aria-label="Macro templates"
      className="border border-[var(--color-border)] rounded-md bg-[var(--color-surface)] shadow-md max-h-48 overflow-y-auto"
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose();
      }}
    >
      {visible.map((m) => (
        <li key={m.id}>
          <button
            type="button"
            role="option"
            aria-selected="false"
            onClick={() => onSelect(m.body)}
            className="text-start w-full p-2 hover:bg-[var(--color-surface-elevated)] flex flex-col"
          >
            <span className="text-xs text-[var(--color-fg-muted)]">/{m.shortcut}</span>
            <span className="text-sm">{m.name}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}
