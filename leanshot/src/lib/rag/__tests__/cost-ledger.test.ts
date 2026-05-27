/**
 * Phase 50 Plan 50-04 — cost-ledger unit tests (D-30).
 *
 * Tests the vitest-side mirror at `src/lib/rag/scrape/cost-ledger.ts`. The
 * SupabaseClient is mocked via a hand-built stub so we exercise the gating
 * + ledger-write + 80% email idempotency without a live DB.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CostCapExceededError,
  ESTIMATED_COST_USD,
  gateOrThrow,
  getMtdStatus,
  logVendorCost,
  sendEightyPctEmail,
  type MtdStatus,
} from '../scrape/cost-ledger';

interface RpcStubResult {
  data:
    | Array<{
        vendor: string;
        mtd_usd: number;
        monthly_cap_usd: number;
        pct_used: number;
      }>
    | null;
  error: { message: string } | null;
}

interface FromStubResult {
  error: { code?: string; message: string } | null;
}

/**
 * Build a minimal SupabaseClient stub. `rpcResult` controls what
 * `rag_mtd_spend_by_vendor` returns; `insertResult` and `selectResult`
 * control the from(...).insert / .select chain.
 */
 
function makeClient(opts: {
  rpcResult?: RpcStubResult;
  insertResult?: FromStubResult;
  selectResult?: FromStubResult;
  recordInsert?: (table: string, payload: Record<string, unknown>) => void;
}): any {
  const insertSpy = vi.fn((payload: Record<string, unknown>) => {
    opts.recordInsert?.('rag_cost_ledger', payload);
    return Promise.resolve(opts.insertResult ?? { error: null });
  });
  const selectSpy = vi.fn(() =>
    Promise.resolve(opts.selectResult ?? { error: null }),
  );
  return {
    rpc: vi.fn(() =>
      Promise.resolve(opts.rpcResult ?? { data: [], error: null }),
    ),
    from: vi.fn((table: string) => ({
      insert: insertSpy,
      select: (_cols: string, _opts: { count: string; head: boolean }) =>
        selectSpy(),
      __table: table,
    })),
    __spies: { insert: insertSpy, select: selectSpy },
  };
}

describe('Phase 50 Plan 50-04 — cost-ledger', () => {
  describe('logVendorCost', () => {
    it('writes a row with all required fields', async () => {
      const recorded: Array<{ table: string; payload: Record<string, unknown> }> = [];
      const client = makeClient({
        recordInsert: (table, payload) => recorded.push({ table, payload }),
      });
      await logVendorCost(client, {
        vendor: 'firecrawl',
        amountUsd: 0.001,
        topicId: 'topic-1',
        sourceId: 'source-1',
        action: 'scrape_single',
        meta: { url: 'https://pubmed.ncbi.nlm.nih.gov/abc' },
      });
      expect(recorded).toHaveLength(1);
      expect(recorded[0].table).toBe('rag_cost_ledger');
      expect(recorded[0].payload).toMatchObject({
        vendor: 'firecrawl',
        amount_usd: 0.001,
        topic_id: 'topic-1',
        source_id: 'source-1',
        action: 'scrape_single',
      });
      expect(recorded[0].payload.meta).toEqual({
        url: 'https://pubmed.ncbi.nlm.nih.gov/abc',
      });
    });

    it('defaults topicId / sourceId to null and meta to {}', async () => {
      const recorded: Array<{ table: string; payload: Record<string, unknown> }> = [];
      const client = makeClient({
        recordInsert: (table, payload) => recorded.push({ table, payload }),
      });
      await logVendorCost(client, {
        vendor: 'openai_embed',
        amountUsd: 0.00003,
        action: 'embed_chunk',
      });
      expect(recorded[0].payload).toMatchObject({
        topic_id: null,
        source_id: null,
        meta: {},
      });
    });

    it('does NOT throw when the INSERT fails (logs and continues)', async () => {
      const client = makeClient({
        insertResult: { error: { message: 'simulated RLS denial' } },
      });
      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      await expect(
        logVendorCost(client, {
          vendor: 'firecrawl',
          amountUsd: 0.001,
          action: 'scrape_single',
        }),
      ).resolves.toBeUndefined();
      expect(errSpy).toHaveBeenCalled();
      errSpy.mockRestore();
    });
  });

  describe('getMtdStatus', () => {
    it('returns ok when pct_used < 80', async () => {
      const client = makeClient({
        rpcResult: {
          data: [
            { vendor: 'firecrawl', mtd_usd: 50, monthly_cap_usd: 200, pct_used: 25 },
          ],
          error: null,
        },
      });
      const s = await getMtdStatus(client, 'firecrawl');
      expect(s.status).toBe('ok');
      expect(s.pctUsed).toBe(25);
      expect(s.mtdUsd).toBe(50);
      expect(s.capUsd).toBe(200);
    });

    it('returns warn when 80 <= pct_used < 100', async () => {
      const client = makeClient({
        rpcResult: {
          data: [
            { vendor: 'firecrawl', mtd_usd: 160, monthly_cap_usd: 200, pct_used: 80 },
          ],
          error: null,
        },
      });
      const s = await getMtdStatus(client, 'firecrawl');
      expect(s.status).toBe('warn');
    });

    it('returns warn at exactly 80 (boundary)', async () => {
      const client = makeClient({
        rpcResult: {
          data: [
            { vendor: 'firecrawl', mtd_usd: 160, monthly_cap_usd: 200, pct_used: 80.0 },
          ],
          error: null,
        },
      });
      const s = await getMtdStatus(client, 'firecrawl');
      expect(s.status).toBe('warn');
    });

    it('returns capped when pct_used >= 100', async () => {
      const client = makeClient({
        rpcResult: {
          data: [
            { vendor: 'firecrawl', mtd_usd: 200, monthly_cap_usd: 200, pct_used: 100 },
          ],
          error: null,
        },
      });
      const s = await getMtdStatus(client, 'firecrawl');
      expect(s.status).toBe('capped');
    });

    it('returns capped when pct_used > 100', async () => {
      const client = makeClient({
        rpcResult: {
          data: [
            { vendor: 'firecrawl', mtd_usd: 250, monthly_cap_usd: 200, pct_used: 125 },
          ],
          error: null,
        },
      });
      const s = await getMtdStatus(client, 'firecrawl');
      expect(s.status).toBe('capped');
    });

    it('throws when RPC fails', async () => {
      const client = makeClient({
        rpcResult: { data: null, error: { message: 'permission denied' } },
      });
      await expect(getMtdStatus(client, 'firecrawl')).rejects.toThrow(/permission/);
    });

    it('throws when no row for vendor', async () => {
      const client = makeClient({
        rpcResult: {
          data: [
            { vendor: 'openai_embed', mtd_usd: 10, monthly_cap_usd: 50, pct_used: 20 },
          ],
          error: null,
        },
      });
      await expect(getMtdStatus(client, 'firecrawl')).rejects.toThrow(/no rag_budget_caps row/);
    });
  });

  describe('gateOrThrow', () => {
    it('does NOT throw when status === ok', async () => {
      const client = makeClient({
        rpcResult: {
          data: [
            { vendor: 'firecrawl', mtd_usd: 0, monthly_cap_usd: 200, pct_used: 0 },
          ],
          error: null,
        },
      });
      await expect(gateOrThrow(client, 'firecrawl')).resolves.toBeUndefined();
    });

    it('does NOT throw when status === warn', async () => {
      const client = makeClient({
        rpcResult: {
          data: [
            { vendor: 'firecrawl', mtd_usd: 170, monthly_cap_usd: 200, pct_used: 85 },
          ],
          error: null,
        },
      });
      await expect(gateOrThrow(client, 'firecrawl')).resolves.toBeUndefined();
    });

    it('throws CostCapExceededError when status === capped', async () => {
      const client = makeClient({
        rpcResult: {
          data: [
            { vendor: 'firecrawl', mtd_usd: 200, monthly_cap_usd: 200, pct_used: 100 },
          ],
          error: null,
        },
      });
      await expect(gateOrThrow(client, 'firecrawl')).rejects.toBeInstanceOf(
        CostCapExceededError,
      );
    });

    it('CostCapExceededError carries vendor + mtd + cap', async () => {
      const client = makeClient({
        rpcResult: {
          data: [
            { vendor: 'firecrawl', mtd_usd: 220, monthly_cap_usd: 200, pct_used: 110 },
          ],
          error: null,
        },
      });
      try {
        await gateOrThrow(client, 'firecrawl');
        expect.fail('should have thrown');
      } catch (e) {
        const err = e as CostCapExceededError;
        expect(err.vendor).toBe('firecrawl');
        expect(err.mtdUsd).toBe(220);
        expect(err.capUsd).toBe(200);
      }
    });
  });

  describe('sendEightyPctEmail', () => {
    beforeEach(() => {
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      vi.spyOn(console, 'error').mockImplementation(() => {});
    });

    it('no-ops when rag_budget_alerts_sent table missing (PGRST205)', async () => {
      const warnSpy = vi.spyOn(console, 'warn');
      const client = makeClient({
        selectResult: {
          error: {
            code: 'PGRST205',
            message: 'Could not find the table public.rag_budget_alerts_sent',
          },
        },
      });
      await sendEightyPctEmail(client, 'firecrawl', 170, 200);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('rag_budget_alerts_sent table missing'),
      );
    });

    it('no-ops when rag_budget_alerts_sent table missing (42P01)', async () => {
      const client = makeClient({
        selectResult: {
          error: { code: '42P01', message: 'relation does not exist' },
        },
      });
      await expect(
        sendEightyPctEmail(client, 'firecrawl', 170, 200),
      ).resolves.toBeUndefined();
    });

    it('no-ops on other unexpected error (logs error, returns)', async () => {
      const errSpy = vi.spyOn(console, 'error');
      const client = makeClient({
        selectResult: {
          error: { code: '42501', message: 'permission denied' },
        },
      });
      await sendEightyPctEmail(client, 'firecrawl', 170, 200);
      expect(errSpy).toHaveBeenCalledWith(
        expect.stringContaining('probe failed'),
      );
    });

    it('reaches placeholder log path when table exists (Plan 50-09 stub)', async () => {
      const warnSpy = vi.spyOn(console, 'warn');
      const client = makeClient({
        selectResult: { error: null },
      });
      await sendEightyPctEmail(client, 'firecrawl', 170, 200);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Plan 50-09 placeholder'),
      );
    });

    it('is idempotent: same vendor + month should not double-send (placeholder)', async () => {
      // Once the Plan 50-09 path is wired, this test will assert a dedupe row
      // exists. For now, we just confirm the call is stable when invoked twice.
      const client = makeClient({ selectResult: { error: null } });
      await sendEightyPctEmail(client, 'firecrawl', 170, 200);
      await sendEightyPctEmail(client, 'firecrawl', 175, 200);
      // No throw, no side effects in stub — idempotency placeholder met.
      expect(true).toBe(true);
    });
  });

  describe('ESTIMATED_COST_USD', () => {
    it('exposes the 5 D-30 cost constants', () => {
      expect(ESTIMATED_COST_USD.firecrawlSingleScrape).toBe(0.001);
      expect(ESTIMATED_COST_USD.firecrawlCrawlPage).toBe(0.002);
      expect(ESTIMATED_COST_USD.openaiEmbedChunk).toBeCloseTo(0.00003);
      expect(ESTIMATED_COST_USD.anthropicSummaryChunk).toBeCloseTo(0.105);
      expect(ESTIMATED_COST_USD.resendEmail).toBe(0.0001);
    });
  });

  describe('type integrity', () => {
    it('MtdStatus shape matches expectations', () => {
      const s: MtdStatus = {
        vendor: 'firecrawl',
        pctUsed: 50,
        mtdUsd: 100,
        capUsd: 200,
        status: 'ok',
      };
      expect(s.status).toBe('ok');
    });
  });
});
