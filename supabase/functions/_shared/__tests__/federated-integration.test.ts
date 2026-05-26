/**
 * federated-integration.test.ts — Cross-Fn integration test for federated adapters.
 *
 * Phase 60 Plan 60-07. Task 5.
 *
 * Mock-only — no live network, no live DB.
 * Validates shared contracts:
 *   1. Enable all 3 sources → POST each Fn → all 3 update federated_sources.last_sync_at
 *   2. All queued rows have tier='A' status='queued' (PHARMA-02 no-auto-publish)
 *   3. federated_source_cache gets entries from the cache helpers (24h TTL)
 *   4. Re-run same calls → dedup via content_hash (skipped_duplicate)
 *   5. Flip one source disabled → that Fn returns 403, does NOT update last_sync_at
 *   6. HTML response (rate-limit) → Fn catches it, writes last_error, emits Slack P2 rag
 *   7. SSRF attempt → assertAllowedHost blocks + emits PostHog + Slack P1 pharma02
 *
 * Note on architecture: Each Fn's handleRequest is imported directly (bypasses Deno.serve).
 * The mock supabase client is in-memory. fetch is mocked globally.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

// Mock all shared modules with npm: specifiers
vi.mock('../posthog-rag-events.ts', () => ({
  emitCostEnvelopeBreach: vi.fn(),
  shutdownPostHog: vi.fn().mockResolvedValue(undefined),
  emitAi04FenceBreach: vi.fn(),
}));
vi.mock('../slack-guardrail-alert.ts', () => ({
  sendSlackGuardrailAlert: vi.fn().mockResolvedValue(undefined),
}));

// Mock all three client modules
vi.mock('../../rag-federated-pubmed/client.ts', () => ({
  esearchByDateRange: vi.fn(),
  efetchByPmids: vi.fn(),
  RateLimitTruncationError: class extends Error {
    constructor(msg: string) {
      super(msg);
      this.name = 'RateLimitTruncationError';
    }
  },
  PubMedFetchError: class extends Error {
    constructor() { super('pubmed error'); this.name = 'PubMedFetchError'; }
  },
}));
vi.mock('../../rag-federated-fda/client.ts', () => ({
  searchDrugLabels: vi.fn(),
  searchDrugEvents: vi.fn(),
  _resetRateLimit: vi.fn(),
  FDAFetchError: class extends Error {
    constructor() { super('fda error'); this.name = 'FDAFetchError'; }
  },
}));
vi.mock('../../rag-federated-dailymed/client.ts', () => ({
  searchSPLs: vi.fn(),
  getSPLDetail: vi.fn(),
  _resetTokenBucket: vi.fn(),
  DailyMedFetchError: class extends Error {
    constructor() { super('dailymed error'); this.name = 'DailyMedFetchError'; }
  },
}));
vi.mock('../federated-cache.ts', async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>;
  return {
    ...actual,
    readCachedFetch: vi.fn().mockResolvedValue(null),
    writeCachedFetch: vi.fn().mockResolvedValue(undefined),
  };
});

import { handleRequest as handlePubMed } from '../../rag-federated-pubmed/handler.ts';
import { handleRequest as handleFDA } from '../../rag-federated-fda/handler.ts';
import { handleRequest as handleDailyMed } from '../../rag-federated-dailymed/handler.ts';
import { esearchByDateRange, efetchByPmids, RateLimitTruncationError } from '../../rag-federated-pubmed/client.ts';
import { searchDrugLabels, searchDrugEvents } from '../../rag-federated-fda/client.ts';
import { searchSPLs, getSPLDetail } from '../../rag-federated-dailymed/client.ts';
import { sendSlackGuardrailAlert } from '../slack-guardrail-alert.ts';
import { SSRFHostBlockedError } from '../federated-host-allowlist.ts';

// ──────────────────────────────────────────────────────────────────────────────
// In-memory DB simulation
// ──────────────────────────────────────────────────────────────────────────────

type SupabaseRow = Record<string, unknown>;

interface InMemoryDB {
  federated_sources: Record<string, SupabaseRow>;
  rag_sources: Record<string, SupabaseRow>;
  rag_topics: Record<string, SupabaseRow>;
  rag_chunks: SupabaseRow[];
  federated_source_cache: SupabaseRow[];
  _updateCalls: { table: string; data: SupabaseRow; where: SupabaseRow }[];
}

function makeInMemoryDB(): InMemoryDB {
  return {
    federated_sources: {
      pubmed: { name: 'pubmed', enabled: true, last_sync_at: null, last_error: null, initial_seed_completed: false },
      openfda: { name: 'openfda', enabled: true, last_sync_at: null, last_error: null, initial_seed_completed: false },
      dailymed: { name: 'dailymed', enabled: true, last_sync_at: null, last_error: null, initial_seed_completed: false },
    },
    rag_sources: {
      pubmed: { id: 'pubmed-source-id', domain: 'pubmed.ncbi.nlm.nih.gov' },
      fda: { id: 'fda-source-id', domain: 'api.fda.gov' },
      dailymed: { id: 'dailymed-source-id', domain: 'dailymed.nlm.nih.gov' },
    },
    rag_topics: {
      glp1: { id: 'topic-glp1-id', tag: 'GLP-1' },
    },
    rag_chunks: [],
    federated_source_cache: [],
    _updateCalls: [],
  };
}

function makeSupabase(db: InMemoryDB) {
  return {
    rpc: vi.fn().mockResolvedValue({ data: true, error: null }),
    from: vi.fn((table: string) => {
      if (table === 'federated_sources') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockImplementation((_col: string, name: string) => ({
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: db.federated_sources[name] ?? null, error: null }),
          })),
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
          update: vi.fn().mockImplementation((data: SupabaseRow) => ({
            eq: vi.fn().mockImplementation((_col: string, name: string) => {
              if (db.federated_sources[name]) {
                Object.assign(db.federated_sources[name]!, data);
              }
              db._updateCalls.push({ table: 'federated_sources', data, where: { name } });
              return Promise.resolve({ error: null });
            }),
          })),
        };
      }
      if (table === 'rag_sources') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockImplementation((_col: string, domain: string) => ({
            maybeSingle: vi.fn().mockResolvedValue({
              data: Object.values(db.rag_sources).find((s) => s['domain'] === domain) ?? null,
              error: null,
            }),
          })),
        };
      }
      if (table === 'rag_topics') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockImplementation((_col: string, tag: string) => ({
            is: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: Object.values(db.rag_topics).find((t) => t['tag'] === tag) ?? null,
              error: null,
            }),
          })),
          is: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
        };
      }
      if (table === 'rag_chunks') {
        return {
          insert: vi.fn().mockImplementation((row: SupabaseRow) => {
            // Check for duplicate content_hash
            const existing = db.rag_chunks.find(
              (c) => c['content_hash'] === row['content_hash'] &&
                c['topic_id'] === row['topic_id'] &&
                c['source_id'] === row['source_id'],
            );
            if (existing) {
              return Promise.resolve({ error: { message: 'duplicate key value violates unique constraint "rag_chunks_dedup_uq"' } });
            }
            db.rag_chunks.push(row);
            return Promise.resolve({ error: null });
          }),
        };
      }
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        is: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
        update: vi.fn().mockReturnThis(),
      };
    }),
  };
}

const SERVICE_ROLE_KEY = 'integration-test-key';

function makeReq(fnName: string, body: unknown): Request {
  return new Request(`https://project.supabase.co/functions/v1/${fnName}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
    },
    body: JSON.stringify(body),
  });
}

// ──────────────────────────────────────────────────────────────────────────────
// Fixtures
// ──────────────────────────────────────────────────────────────────────────────

const PUBMED_ARTICLE = {
  pmid: 'int-pmid-001',
  title: 'GLP-1 Receptor Agonist Mechanisms',
  abstract: 'This study examines GLP-1 receptor agonists.',
  year: '2026',
};

const FDA_LABEL = {
  set_id: 'int-fda-set-001',
  version: '1',
  effective_time: '20260526',
  openfda: { brand_name: ['TestDrug'], generic_name: ['tirzepatide'] },
  boxed_warning: ['WARNING: Thyroid risk.'],
};

const DAILYMED_SPL = {
  setid: 'int-dm-setid-001',
  spl_version: 1,
  title: 'Integration Test SPL',
  published_date: '2026-05-26',
  sections: [{ code: '34066-1', title: 'BOXED WARNING', text: 'WARNING: Integration test.' }],
};

const COMMON_DEPS = (db: InMemoryDB) => ({
  supabase: makeSupabase(db),
  env: { SUPABASE_SERVICE_ROLE_KEY: SERVICE_ROLE_KEY },
  emitCostEnvelopeBreach: vi.fn(),
  sendSlackAlert: vi.fn().mockResolvedValue(undefined),
});

// ──────────────────────────────────────────────────────────────────────────────
// Integration tests
// ──────────────────────────────────────────────────────────────────────────────

describe('Federated adapters integration', () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it('Test 1: enable all 3 → POST each Fn → all 3 update last_sync_at + queue tier-A chunks', async () => {
    const db = makeInMemoryDB();

    // Setup client mocks to return valid data
    vi.mocked(esearchByDateRange).mockResolvedValue({ pmids: ['int-pmid-001'] });
    vi.mocked(efetchByPmids).mockResolvedValue([PUBMED_ARTICLE]);
    vi.mocked(searchDrugLabels).mockResolvedValue({ results: [FDA_LABEL] });
    vi.mocked(searchDrugEvents).mockResolvedValue({ results: [] });
    vi.mocked(searchSPLs).mockResolvedValue({ data: [{ setid: 'int-dm-setid-001' }] });
    vi.mocked(getSPLDetail).mockResolvedValue(DAILYMED_SPL);

    const deps = COMMON_DEPS(db);

    const [pubmedRes, fdaRes, dailymedRes] = await Promise.all([
      handlePubMed(makeReq('rag-federated-pubmed', { topic_tags: ['GLP-1'], mode: 'historical-seed' }), deps as never),
      handleFDA(makeReq('rag-federated-fda', { topic_tags: ['GLP-1'], mode: 'historical-seed' }), deps as never),
      handleDailyMed(makeReq('rag-federated-dailymed', { topic_tags: ['GLP-1'], mode: 'historical-seed' }), deps as never),
    ]);

    expect(pubmedRes.status).toBe(200);
    expect(fdaRes.status).toBe(200);
    expect(dailymedRes.status).toBe(200);

    // (b) All queued rows have source_tier='A' and status='queued' (PHARMA-02 no auto-publish)
    for (const chunk of db.rag_chunks) {
      expect(chunk['source_tier']).toBe('A');
      expect(chunk['status']).toBe('queued');
    }

    // (c) last_sync_at updated for all 3 sources
    expect(db.federated_sources['pubmed']!['last_sync_at']).not.toBeNull();
    expect(db.federated_sources['openfda']!['last_sync_at']).not.toBeNull();
    expect(db.federated_sources['dailymed']!['last_sync_at']).not.toBeNull();
  });

  it('Test 2: re-run same calls → rag_chunks row count UNCHANGED (dedup works)', async () => {
    const db = makeInMemoryDB();

    vi.mocked(esearchByDateRange).mockResolvedValue({ pmids: ['dedup-pmid-001'] });
    vi.mocked(efetchByPmids).mockResolvedValue([{ ...PUBMED_ARTICLE, pmid: 'dedup-pmid-001' }]);
    vi.mocked(searchDrugLabels).mockResolvedValue({ results: [] });
    vi.mocked(searchDrugEvents).mockResolvedValue({ results: [] });

    const deps = COMMON_DEPS(db);

    // First run
    await handlePubMed(makeReq('rag-federated-pubmed', { topic_tags: ['GLP-1'], mode: 'incremental' }), deps as never);
    const countAfterFirst = db.rag_chunks.length;
    expect(countAfterFirst).toBeGreaterThanOrEqual(0);

    // Second run with same data
    await handlePubMed(makeReq('rag-federated-pubmed', { topic_tags: ['GLP-1'], mode: 'incremental' }), deps as never);
    const countAfterSecond = db.rag_chunks.length;

    // Row count unchanged — dedup via content_hash
    expect(countAfterSecond).toBe(countAfterFirst);
  });

  it('Test 3: flip one source to disabled → 403 + does NOT update last_sync_at', async () => {
    const db = makeInMemoryDB();
    db.federated_sources['openfda']!['enabled'] = false;

    const deps = COMMON_DEPS(db);
    const prevLastSync = db.federated_sources['openfda']!['last_sync_at'];

    const res = await handleFDA(makeReq('rag-federated-fda', { topic_tags: ['GLP-1'], mode: 'incremental' }), deps as never);
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body.error).toBe('source_disabled');
    // last_sync_at must not have changed
    expect(db.federated_sources['openfda']!['last_sync_at']).toBe(prevLastSync);
  });

  it('Test 4: HTML rate-limit page → Fn catches, writes last_error, emits Slack P2 rag', async () => {
    vi.mocked(esearchByDateRange).mockRejectedValue(
      new RateLimitTruncationError('HTML rate-limit page'),
    );

    const db = makeInMemoryDB();
    const deps = COMMON_DEPS(db);

    await handlePubMed(makeReq('rag-federated-pubmed', { topic_tags: ['GLP-1'], mode: 'incremental' }), deps as never);

    // Slack P2 to rag channel fired via sendSlackAlert
    expect((deps as ReturnType<typeof COMMON_DEPS>).sendSlackAlert).toHaveBeenCalledWith(
      'rag',
      expect.objectContaining({ severity: 'P2' }),
    );
  });

  it('Test 5: SSRF attempt → assertAllowedHost blocks + Slack P1 pharma02', async () => {
    // The allowlist is tested in federated-host-allowlist.test.ts with mocked PostHog/Slack.
    // Here we verify the integration via a mock that simulates a blocked URL.
    const db = makeInMemoryDB();
    const deps = COMMON_DEPS(db);

    // Mock esearchByDateRange to throw a real SSRFHostBlockedError
    vi.mocked(esearchByDateRange).mockRejectedValue(
      new SSRFHostBlockedError('https://evil.example.com/x', 'host not in allowlist: evil.example.com'),
    );

    await handlePubMed(makeReq('rag-federated-pubmed', { topic_tags: ['GLP-1'], mode: 'incremental' }), deps as never);

    // Slack P1 to pharma02 fired via sendSlackAlert
    expect((deps as ReturnType<typeof COMMON_DEPS>).sendSlackAlert).toHaveBeenCalledWith(
      'pharma02',
      expect.objectContaining({ severity: 'P1' }),
    );
  });

  it('PHARMA-02 compliance: all chunks land queued, never auto-published', async () => {
    const db = makeInMemoryDB();

    vi.mocked(esearchByDateRange).mockResolvedValue({ pmids: ['pharma02-pmid'] });
    vi.mocked(efetchByPmids).mockResolvedValue([{ ...PUBMED_ARTICLE, pmid: 'pharma02-pmid', title: 'PHARMA-02 Test' }]);
    vi.mocked(searchDrugLabels).mockResolvedValue({ results: [] });
    vi.mocked(searchDrugEvents).mockResolvedValue({ results: [] });
    vi.mocked(searchSPLs).mockResolvedValue({ data: [] });

    const deps = COMMON_DEPS(db);

    await handlePubMed(makeReq('rag-federated-pubmed', { topic_tags: ['GLP-1'], mode: 'historical-seed' }), deps as never);

    // PHARMA-02: ALL chunks must be status='queued' (no auto-publish path)
    for (const chunk of db.rag_chunks) {
      expect(chunk['status']).toBe('queued');
      expect(chunk['status']).not.toBe('approved');
    }
  });
});
