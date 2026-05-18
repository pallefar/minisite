import { assertEquals } from 'jsr:@std/assert';
import { handle } from './charge-dispute-created.ts';

function makeEvent(opts: {
  disputeId?: string;
  amount?: number;
  charge?: unknown;
  eventId?: string;
} = {}): unknown {
  return {
    id: opts.eventId ?? 'evt_test_dispute_1',
    type: 'charge.dispute.created',
    data: {
      object: {
        id: opts.disputeId ?? 'dp_test_1',
        amount: opts.amount ?? 2599,
        charge: opts.charge ?? 'ch_test_d1',
      },
    },
  };
}

interface ConvRow {
  id: string;
  affiliate_id: string;
}

function makeMockAdmin(opts: {
  conversions?: ConvRow[];
  payouts?: Array<{ id: string; affiliate_id: string; adjustments: unknown[] }>;
}) {
  const conversionUpdates: Array<Record<string, unknown>> = [];
  const payoutUpdates: Array<Record<string, unknown>> = [];
  const fraudInserts: Array<Record<string, unknown>> = [];

  function selectChain(table: string) {
    const eqState: { value?: string } = {};
    const chain = {
      eq: (_k: string, v: string) => {
        eqState.value = v;
        return chain;
      },
      order: (_k: string, _o: unknown) => chain,
      limit: (_n: number) => chain,
      maybeSingle: () => {
        if (table === 'affiliate_conversions') {
          const row = (opts.conversions ?? []).find(() => true) ?? null;
          return Promise.resolve({ data: row, error: null });
        }
        return Promise.resolve({ data: null, error: null });
      },
      then: (
        resolve: (v: { data: unknown[]; error: unknown }) => void,
      ) => {
        if (table === 'payouts') {
          resolve({ data: opts.payouts ?? [], error: null });
        } else {
          resolve({ data: [], error: null });
        }
      },
    };
    return chain;
  }

  return {
    from(table: string) {
      return {
        select: (_cols: string) => selectChain(table),
        update: (payload: Record<string, unknown>) => ({
          eq: (_k: string, _v: string) => {
            if (table === 'affiliate_conversions') conversionUpdates.push(payload);
            if (table === 'payouts') payoutUpdates.push(payload);
            return Promise.resolve({ error: null });
          },
        }),
        insert: (payload: Record<string, unknown>) => {
          if (table === 'affiliate_fraud_signals') fraudInserts.push(payload);
          return Promise.resolve({ error: null });
        },
      };
    },
    _conversionUpdates: () => conversionUpdates,
    _payoutUpdates: () => payoutUpdates,
    _fraudInserts: () => fraudInserts,
  };
}

// Stub resolver — returns a fake Charge object with invoice id.
function mockResolver(invoice: string | null) {
  return (_chargeId: string) =>
    Promise.resolve(
      // deno-lint-ignore no-explicit-any
      ({ id: _chargeId, invoice } as any),
    );
}

Deno.test('no charge id → no-op', async () => {
  const admin = makeMockAdmin({});
  await handle(
    // deno-lint-ignore no-explicit-any
    makeEvent({ charge: null }) as any,
    // deno-lint-ignore no-explicit-any
    admin as any,
    mockResolver('in_test'),
  );
  assertEquals(admin._conversionUpdates().length, 0);
  assertEquals(admin._fraudInserts().length, 0);
});

Deno.test('resolver returns null → no-op', async () => {
  const admin = makeMockAdmin({});
  await handle(
    // deno-lint-ignore no-explicit-any
    makeEvent() as any,
    // deno-lint-ignore no-explicit-any
    admin as any,
    () => Promise.resolve(null),
  );
  assertEquals(admin._conversionUpdates().length, 0);
  assertEquals(admin._fraudInserts().length, 0);
});

Deno.test('charge has no invoice → no-op', async () => {
  const admin = makeMockAdmin({});
  await handle(
    // deno-lint-ignore no-explicit-any
    makeEvent() as any,
    // deno-lint-ignore no-explicit-any
    admin as any,
    mockResolver(null),
  );
  assertEquals(admin._conversionUpdates().length, 0);
  assertEquals(admin._fraudInserts().length, 0);
});

Deno.test('no matching conversion → no UPDATEs / no fraud insert', async () => {
  const admin = makeMockAdmin({ conversions: [] });
  await handle(
    // deno-lint-ignore no-explicit-any
    makeEvent() as any,
    // deno-lint-ignore no-explicit-any
    admin as any,
    mockResolver('in_test'),
  );
  assertEquals(admin._conversionUpdates().length, 0);
  assertEquals(admin._fraudInserts().length, 0);
});

Deno.test(
  'dispute marks conversion clawback_pending, appends chargeback AdjustmentEntry, inserts fraud_signals',
  async () => {
    const admin = makeMockAdmin({
      conversions: [{ id: 'conv_d1', affiliate_id: 'aff_d1' }],
      payouts: [{ id: 'po_d1', affiliate_id: 'aff_d1', adjustments: [] }],
    });
    await handle(
      // deno-lint-ignore no-explicit-any
      makeEvent() as any,
      // deno-lint-ignore no-explicit-any
      admin as any,
      mockResolver('in_test'),
    );

    assertEquals(admin._conversionUpdates()[0]?.status, 'clawback_pending');

    // deno-lint-ignore no-explicit-any
    const adj = (admin._payoutUpdates()[0]?.adjustments as any[]) ?? [];
    assertEquals(adj.length, 1);
    assertEquals(adj[0].type, 'chargeback');
    assertEquals(adj[0].amount_cents, -2599);

    const fraud = admin._fraudInserts()[0];
    assertEquals(fraud?.signal_type, 'chargeback');
    assertEquals(fraud?.affiliate_id, 'aff_d1');
    assertEquals(fraud?.conversion_id, 'conv_d1');
    // deno-lint-ignore no-explicit-any
    const fraudPayload = fraud?.payload as any;
    assertEquals(fraudPayload?.kind, 'chargeback');
    assertEquals(fraudPayload?.stripe_charge_id, 'ch_test_d1');
    assertEquals(fraudPayload?.stripe_event_id, 'evt_test_dispute_1');
    assertEquals(fraudPayload?.amount_cents, 2599);
  },
);

Deno.test('D-04: handler does NOT touch frozen_at column (no auto-freeze)', async () => {
  const src = await Deno.readTextFile(new URL('./charge-dispute-created.ts', import.meta.url));
  assertEquals(/\bfrozen_at\b/.test(src), false);
});

Deno.test('source contains no PHI keywords', async () => {
  const src = await Deno.readTextFile(new URL('./charge-dispute-created.ts', import.meta.url));
  const pattern = /\b(patient|medication|diagnosis|dose|lab)\b/i;
  assertEquals(pattern.test(src), false);
});
