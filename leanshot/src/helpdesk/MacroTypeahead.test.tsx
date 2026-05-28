/**
 * MacroTypeahead.test.tsx — Phase 37 Plan 06 Task 3 RED→GREEN (HELP-10).
 *
 * Verifies:
 *  - Renders nothing when no macros (non-agent — agent_macros RLS returns 0 rows)
 *  - Loaded macros render as items (fuzzy match on shortcut + name via Fuse.js)
 *  - Click → onSelect(macro.body) fires
 *  - Typing a query filters the list (Fuse.js fuzzy)
 */

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import MacroTypeahead from './MacroTypeahead';

// supabase.from('agent_macros').select(...).order(...) chainable, returning rows.
const macroRowsRef: { rows: unknown[] | null } = { rows: [] };
vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: (_table: string) => ({
      select: () => ({
        order: () => Promise.resolve({ data: macroRowsRef.rows, error: null }),
      }),
    }),
  },
}));

describe('MacroTypeahead', () => {
  beforeEach(() => {
    macroRowsRef.rows = [];
  });

  it('renders nothing for non-agents (zero macro rows)', async () => {
    macroRowsRef.rows = [];
    const { container } = render(
      <MacroTypeahead query="" onSelect={() => {}} onClose={() => {}} />,
    );
    // Allow effect to settle
    await new Promise((r) => setTimeout(r, 50));
    expect(container.querySelector('[role="listbox"]')).toBeNull();
  });

  it('renders macros and clicking a result calls onSelect with the macro body', async () => {
    macroRowsRef.rows = [
      {
        id: 'm-1',
        shortcut: 'refund',
        name: 'Refund template',
        body: 'Sorry for the trouble — refund issued.',
        locale: 'en',
      },
      {
        id: 'm-2',
        shortcut: 'pause',
        name: 'Pause sub',
        body: 'Pause your subscription via Settings → Plan.',
        locale: 'en',
      },
    ];
    const onSelect = vi.fn();
    render(<MacroTypeahead query="ref" onSelect={onSelect} onClose={() => {}} />);

    const item = await waitFor(() => screen.getByRole('option', { name: /refund/i }));
    await userEvent.click(item);
    expect(onSelect).toHaveBeenCalledWith('Sorry for the trouble — refund issued.');
  });

  it('filters macros by fuzzy-matched query', async () => {
    macroRowsRef.rows = [
      { id: 'm-1', shortcut: 'refund', name: 'Refund template', body: 'r-body', locale: 'en' },
      { id: 'm-2', shortcut: 'pause', name: 'Pause sub', body: 'p-body', locale: 'en' },
      { id: 'm-3', shortcut: 'welcome', name: 'Welcome msg', body: 'w-body', locale: 'en' },
    ];
    render(<MacroTypeahead query="welc" onSelect={() => {}} onClose={() => {}} />);
    await waitFor(() => {
      expect(screen.getByRole('option', { name: /welcome/i })).toBeInTheDocument();
    });
    // 'refund' and 'pause' should not appear for the 'welc' query (Fuse strict-ish match).
    expect(screen.queryByRole('option', { name: /refund/i })).toBeNull();
    expect(screen.queryByRole('option', { name: /pause/i })).toBeNull();
  });
});
