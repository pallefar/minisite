/**
 * Phase 37 Plan 37-08 Task 3 — MacroEditorPage tests (HELP-12).
 *
 * Behavior gates:
 *   T1 — renders list of macros
 *   T2 — Create-new flow inserts row via supabase.from('agent_macros').insert
 *   T3 — Edit existing row → Save calls update
 *   T4 — Delete uses inline confirmation (no window.confirm)
 *   T5 — Non-admin role disables Create / Save / Delete buttons
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

interface MockMacro {
  id: string;
  org_id: string;
  name: string;
  shortcut: string;
  body: string;
  created_by: string | null;
  updated_at: string | null;
}

let mockMacros: MockMacro[] = [];
let mockRole = 'support_admin';
const opCalls: Array<{ op: string; payload: unknown; table: string }> = [];

function mkMacro(overrides: Partial<MockMacro> = {}): MockMacro {
  return {
    id: `mc-${Math.random().toString(36).slice(2, 8)}`,
    org_id: 'org-1',
    name: 'Sample macro',
    shortcut: '/sample',
    body: 'Sample body',
    created_by: 'user-1',
    updated_at: null,
    ...overrides,
  };
}

function makeBuilder(table: string): Record<string, unknown> {
  const builder: Record<string, unknown> = {
    _table: table,
    _filters: [] as Array<[string, unknown]>,
    select: vi.fn(function (this: unknown) {
      return this;
    }),
    insert: vi.fn(function (this: { _table: string }, row: Record<string, unknown>) {
      opCalls.push({ op: 'insert', payload: row, table: this._table });
      if (this._table === 'agent_macros') {
        const m = mkMacro({
          id: `mc-${Date.now()}`,
          name: (row.name as string) ?? '',
          shortcut: (row.shortcut as string) ?? '',
          body: (row.body as string) ?? '',
        });
        mockMacros.push(m);
        return {
          select: () => ({
            single: () => Promise.resolve({ data: m, error: null }),
          }),
        };
      }
      return {
        select: () => ({
          single: () => Promise.resolve({ data: null, error: null }),
        }),
      };
    }),
    update: vi.fn(function (this: { _table: string }, row: Record<string, unknown>) {
      opCalls.push({ op: 'update', payload: row, table: this._table });
      return {
        eq: () => Promise.resolve({ data: null, error: null }),
      };
    }),
    delete: vi.fn(function (this: { _table: string }) {
      opCalls.push({ op: 'delete', payload: null, table: this._table });
      return {
        eq: () => Promise.resolve({ data: null, error: null }),
      };
    }),
    eq: vi.fn(function (
      this: { _filters: Array<[string, unknown]> },
      col: string,
      val: unknown,
    ) {
      this._filters.push([col, val]);
      return this;
    }),
    order: vi.fn(function (this: unknown) {
      return this;
    }),
    limit: vi.fn(function (this: unknown) {
      return this;
    }),
    single: vi.fn(function (this: { _table: string }) {
      if (this._table === 'org_members') {
        return Promise.resolve({
          data: { role: mockRole, org_id: 'org-1', user_id: 'user-1' },
          error: null,
        });
      }
      return Promise.resolve({ data: null, error: null });
    }),
    then: function (
      this: { _table: string },
      resolve: (v: { data: unknown[]; error: null }) => void,
    ) {
      if (this._table === 'agent_macros') {
        resolve({ data: mockMacros, error: null });
        return Promise.resolve({ data: mockMacros, error: null });
      }
      resolve({ data: [], error: null });
      return Promise.resolve({ data: [], error: null });
    },
  };
  return builder;
}

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: (table: string) => makeBuilder(table),
    rpc: vi.fn(() => Promise.resolve({ data: null, error: null })),
    auth: {
      getUser: () =>
        Promise.resolve({ data: { user: { id: 'user-1' } }, error: null }),
    },
  },
}));

describe('MacroEditorPage', () => {
  beforeEach(() => {
    mockMacros = [];
    mockRole = 'support_admin';
    opCalls.length = 0;
    vi.clearAllMocks();
  });

  it('T1: renders macro list', async () => {
    mockMacros = [
      mkMacro({ id: 'mc-1', name: 'Greet', shortcut: '/g', body: 'Hello!' }),
      mkMacro({ id: 'mc-2', name: 'Bye', shortcut: '/b', body: 'Goodbye!' }),
    ];
    const { default: MacroEditorPage } = await import('./MacroEditorPage');
    render(<MacroEditorPage />);
    await waitFor(() => {
      expect(screen.getByText('Greet')).toBeTruthy();
      expect(screen.getByText('Bye')).toBeTruthy();
    });
  });

  it('T2: create new macro inserts row', async () => {
    const { default: MacroEditorPage } = await import('./MacroEditorPage');
    render(<MacroEditorPage />);
    await waitFor(() =>
      screen.getByRole('button', { name: /new macro/i }),
    );
    fireEvent.click(screen.getByRole('button', { name: /new macro/i }));
    fireEvent.change(screen.getByLabelText(/name/i), {
      target: { value: 'New macro' },
    });
    fireEvent.change(screen.getByLabelText(/shortcut/i), {
      target: { value: '/new' },
    });
    fireEvent.change(screen.getByLabelText(/body/i), {
      target: { value: 'New body' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));
    await waitFor(() => {
      const ins = opCalls.find(
        (c) => c.op === 'insert' && c.table === 'agent_macros',
      );
      expect(ins).toBeTruthy();
      const payload = ins?.payload as Record<string, unknown>;
      expect(payload.name).toBe('New macro');
      expect(payload.shortcut).toBe('/new');
      expect(payload.body).toBe('New body');
    });
  });

  it('T3: edit existing macro fires update', async () => {
    mockMacros = [mkMacro({ id: 'mc-1', name: 'Old', shortcut: '/o', body: 'O' })];
    const { default: MacroEditorPage } = await import('./MacroEditorPage');
    render(<MacroEditorPage />);
    await waitFor(() => screen.getByText('Old'));
    fireEvent.click(screen.getByRole('button', { name: /edit old/i }));
    fireEvent.change(screen.getByLabelText(/name/i), {
      target: { value: 'Updated' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));
    await waitFor(() => {
      const upd = opCalls.find(
        (c) => c.op === 'update' && c.table === 'agent_macros',
      );
      expect(upd).toBeTruthy();
      const payload = upd?.payload as Record<string, unknown>;
      expect(payload.name).toBe('Updated');
    });
  });

  it('T4: delete uses inline confirmation, not window.confirm', async () => {
    mockMacros = [mkMacro({ id: 'mc-1', name: 'Bye-bye' })];
    const confirmSpy = vi.spyOn(window, 'confirm');
    const { default: MacroEditorPage } = await import('./MacroEditorPage');
    render(<MacroEditorPage />);
    await waitFor(() => screen.getByText('Bye-bye'));
    fireEvent.click(screen.getByRole('button', { name: /delete bye-bye/i }));
    // Should reveal an inline "Confirm" button rather than call window.confirm
    await waitFor(() =>
      screen.getByRole('button', { name: /confirm delete/i }),
    );
    expect(confirmSpy).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /confirm delete/i }));
    await waitFor(() => {
      const del = opCalls.find(
        (c) => c.op === 'delete' && c.table === 'agent_macros',
      );
      expect(del).toBeTruthy();
    });
    confirmSpy.mockRestore();
  });

  it('T5: non-admin role disables New macro button', async () => {
    mockRole = 'support_agent';
    const { default: MacroEditorPage } = await import('./MacroEditorPage');
    render(<MacroEditorPage />);
    await waitFor(() =>
      screen.getByRole('button', { name: /new macro/i }),
    );
    const btn = screen.getByRole('button', {
      name: /new macro/i,
    }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });
});
