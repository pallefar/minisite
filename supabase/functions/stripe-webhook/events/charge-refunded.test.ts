import { assertEquals } from 'jsr:@std/assert';
import { handle } from './charge-refunded.ts';

function makeEvent(
  overrides: { id?: string; charge?: Partial<Record<string, unknown>> } = {},
): Stripe.Event {
  return {
    id: overrides.id ?? 'evt_test_refund_1',
    type: 'charge.refunded',
    data: {
      object: {
        id: 'ch_test_1',
        invoice: 'in_test_1',
        amount_refunded: 1299,
        ...overrides.charge,
      },
    },
    // deno-lint-ignore no-explicit-any
  } as any;
}

interface ConvRow {
  id: string;
  affiliate_id: string;
  commission_cents: number;
  invoice_id: string;
}
interface PayoutRow {
  id: string;
  affiliate_id: string;
  adjustments: unknown[];
}

function makeMockAdmin(opts: {
  conversions?: ConvRow[];
  payouts?: PayoutRow[];
}) {
  const conversionUpdates: Array<Record<string, unknown>> = [];
  const payoutUpdates: Array<Record<string, unknown>> = [];

  function selectChain(table: string) {
    const eqState: { key?: string; value?: string } = {};
    const chain = {
      eq: (k: string, v: string) => {
        eqState.key = k;
        eqState.value = v;
        return chain;
      },
      order: (_k: string, _o: unknown) => chain,
      limit: (_n: number) => chain,
      maybeSingle: () => {
        if (table === 'affiliate_conversions') {
          const row =
            (opts.conversions ?? []).find((c) => c.invoice_id === eqState.value) ?? null;
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
      };
    },
    _conversionUpdates: () => conversionUpdates,
    _payoutUpdates: () => payoutUpdates,
  };
}

Deno.test('no invoice → no-op (no UPDATEs)', async () => {
  const admin = makeMockAdmin({});
  // deno-lint-ignore no-explicit-any
  await handle(makeEvent({ charge: { invoice: null } }), admin as any);
  assertEquals(admin._conversionUpdates().length, 0);
  assertEquals(admin._payoutUpdates().length, 0);
});

Deno.test('no matching conversion → no UPDATEs', async () => {
  const admin = makeMockAdmin({ conversions: [] });
  // deno-lint-ignore no-explicit-any
  await handle(makeEvent(), admin as any);
  assertEquals(admin._conversionUpdates().length, 0);
  assertEquals(admin._payoutUpdates().length, 0);
});

Deno.test('refund appends AdjustmentEntry to most-recent payout', async () => {
  const admin = makeMockAdmin({
    conversions: [
      { id: 'conv_1', affiliate_id: 'aff_1', commission_cents: 260, invoice_id: 'in_test_1' },
    ],
    payouts: [{ id: 'po_1', affiliate_id: 'aff_1', adjustments: [] }],
  });
  // deno-lint-ignore no-explicit-any
  await handle(makeEvent(), admin as any);
  assertEquals(admin._conversionUpdates()[0]?.status, 'clawback_pending');
  // deno-lint-ignore no-explicit-any
  const adj = (admin._payoutUpdates()[0]?.adjustments as any[]) ?? [];
  assertEquals(adj.length, 1);
  assertEquals(adj[0].type, 'refund');
  assertEquals(adj[0].amount_cents, -1299);
  assertEquals(adj[0].related_event_id, 'evt_test_refund_1');
  assertEquals(adj[0].related_conversion_id, 'conv_1');
});

Deno.test('refund with no existing payout — conversion still marked clawback_pending', async () => {
  const admin = makeMockAdmin({
    conversions: [
      { id: 'conv_2', affiliate_id: 'aff_2', commission_cents: 260, invoice_id: 'in_test_1' },
    ],
    payouts: [],
  });
  // deno-lint-ignore no-explicit-any
  await handle(makeEvent(), admin as any);
  assertEquals(admin._conversionUpdates()[0]?.status, 'clawback_pending');
  assertEquals(admin._payoutUpdates().length, 0);
});

Deno.test('source contains no PHI keywords', async () => {
  const src = await Deno.readTextFile(new URL('./charge-refunded.ts', import.meta.url));
  const pattern = /\b(patient|medication|diagnosis|dose|lab)\b/i;
  assertEquals(pattern.test(src), false);
});

// Minimal Stripe.Event type alias for the test file (avoids pulling in the npm:stripe types).
// deno-lint-ignore no-explicit-any
type Stripe = { Event: any };
// deno-lint-ignore no-namespace
declare namespace Stripe {
  // deno-lint-ignore no-explicit-any
  type Event = any;
}
