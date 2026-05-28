/**
 * Phase 37 Plan 37-08 Task 3 — RoutingRulesPage tests (HELP-12).
 *
 * Behavior gates:
 *   T1 — renders rule list
 *   T2 — create new rule inserts row
 *   T3 — priority Up/Down calls reorder_routing_rule RPC
 *   T4 — non-admin role disables Up/Down/Save
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

interface MockRule {
  id: string;
  org_id: string;
  name: string;
  tag_name: string;
  assign_to_user_id: string;
  priority: number;
  active: boolean;
}

let mockRules: MockRule[] = [];
let mockRole = 'support_admin';
const opCalls: Array<{ op: string; payload: unknown; table: string }> = [];
const rpcCalls: Array<{ fn: string; args: Record<string, unknown> }> = [];

function mkRule(overrides: Partial<MockRule> = {}): MockRule {
  return {
    id: `rr-${Math.random().toString(36).slice(2, 8)}`,
    org_id: 'org-1',
    name: 'Sample rule',
    tag_name: 'billing',
    assign_to_user_id: 'agent-1',
    priority: 100,
    active: true,
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
      const r = mkRule({ id: `rr-${Date.now()}`, ...(row as Partial<MockRule>) });
      mockRules.push(r);
      return {
        select: () => ({
          single: () => Promise.resolve({ data: r, error: null }),
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
    eq: vi.fn(function (this: { _filters: Array<[string, unknown]> }, col: string, val: unknown) {
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
      if (this._table === 'helpdesk_routing_rules') {
        resolve({ data: mockRules, error: null });
        return Promise.resolve({ data: mockRules, error: null });
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
    rpc: vi.fn((fn: string, args: Record<string, unknown>) => {
      rpcCalls.push({ fn, args });
      return Promise.resolve({ data: null, error: null });
    }),
    auth: {
      getUser: () => Promise.resolve({ data: { user: { id: 'user-1' } }, error: null }),
    },
  },
}));

describe('RoutingRulesPage', () => {
  beforeEach(() => {
    mockRules = [];
    mockRole = 'support_admin';
    opCalls.length = 0;
    rpcCalls.length = 0;
    vi.clearAllMocks();
  });

  it('T1: renders rule list', async () => {
    mockRules = [
      mkRule({ id: 'rr-1', name: 'Billing → Alice', priority: 50 }),
      mkRule({ id: 'rr-2', name: 'Refund → Bob', priority: 100 }),
    ];
    const { default: RoutingRulesPage } = await import('./RoutingRulesPage');
    render(<RoutingRulesPage />);
    await waitFor(() => {
      expect(screen.getByText('Billing → Alice')).toBeTruthy();
      expect(screen.getByText('Refund → Bob')).toBeTruthy();
    });
  });

  it('T2: create new rule inserts row', async () => {
    const { default: RoutingRulesPage } = await import('./RoutingRulesPage');
    render(<RoutingRulesPage />);
    await waitFor(() => screen.getByRole('button', { name: /new rule/i }));
    fireEvent.click(screen.getByRole('button', { name: /new rule/i }));
    fireEvent.change(screen.getByLabelText(/^name$/i), {
      target: { value: 'New rule' },
    });
    fireEvent.change(screen.getByLabelText(/tag/i), {
      target: { value: 'billing' },
    });
    fireEvent.change(screen.getByLabelText(/assign/i), {
      target: { value: 'agent-2' },
    });
    fireEvent.change(screen.getByLabelText(/priority/i), {
      target: { value: '50' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));
    await waitFor(() => {
      const ins = opCalls.find((c) => c.op === 'insert');
      expect(ins).toBeTruthy();
      expect((ins?.payload as Record<string, unknown>).name).toBe('New rule');
      expect((ins?.payload as Record<string, unknown>).priority).toBe(50);
    });
  });

  it('T3: Up/Down buttons call reorder_routing_rule RPC', async () => {
    mockRules = [
      mkRule({ id: 'rr-1', name: 'First', priority: 50 }),
      mkRule({ id: 'rr-2', name: 'Second', priority: 100 }),
    ];
    const { default: RoutingRulesPage } = await import('./RoutingRulesPage');
    render(<RoutingRulesPage />);
    await waitFor(() => screen.getByText('Second'));
    fireEvent.click(screen.getByRole('button', { name: /move second up/i }));
    await waitFor(() => {
      const call = rpcCalls.find((c) => c.fn === 'reorder_routing_rule');
      expect(call).toBeTruthy();
      expect(call?.args.p_rule_id).toBe('rr-2');
    });
  });

  it('T4: non-admin role disables New rule button', async () => {
    mockRole = 'support_agent';
    const { default: RoutingRulesPage } = await import('./RoutingRulesPage');
    render(<RoutingRulesPage />);
    await waitFor(() => screen.getByRole('button', { name: /new rule/i }));
    const btn = screen.getByRole('button', {
      name: /new rule/i,
    }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });
});
