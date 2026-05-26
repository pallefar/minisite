/**
 * handler.test.ts — Vitest unit tests for research-publish handler.
 *
 * Phase 62 Plan 03. Task 1 (RED → GREEN cycle).
 *
 * Handler uses full dependency injection (no Deno.* or npm: imports at module
 * level) so these tests run under Vitest without Deno runtime.
 *
 * Tests:
 *  T1: Missing/placeholder SUPABASE_SERVICE_ROLE_KEY → 503 + Slack P1 called.
 *  T2: Missing publication_id → 400.
 *  T3: Publication not found → 404.
 *  T4: actor_id === created_by → 403 SELF_REVIEW_REJECTED (defense-in-depth).
 *  T5: Successful publish → 200 with ok:true, slug, published_at.
 *  T6: RPC raises SELF_REVIEW_REJECTED → 403.
 */

import { describe, it, expect, vi } from 'vitest';
import { handleResearchPublish, type HandlerDeps, type HandlerRequest } from '../handler';

// ──────────────────────────────────────────────────────────────────────────────
// Fixtures
// ──────────────────────────────────────────────────────────────────────────────

const ACTOR_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const AUTHOR_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const PUBLICATION_ID = '11111111-2222-3333-4444-555555555555';
const SLUG = 'tirzepatide-titration-adherence';

function makeBaseRequest(overrides: Partial<HandlerRequest> = {}): HandlerRequest {
  return {
    publication_id: PUBLICATION_ID,
    actor_id: ACTOR_ID,
    ...overrides,
  };
}

interface PublicationRow {
  id: string;
  slug: string;
  created_by: string;
  status: string;
  published_at: string | null;
  markdown_content?: string;
}

function makePublication(overrides: Partial<PublicationRow> = {}): PublicationRow {
  return {
    id: PUBLICATION_ID,
    slug: SLUG,
    created_by: AUTHOR_ID,
    status: 'in_review',
    published_at: null,
    ...overrides,
  };
}

// Duck-typed Supabase mock that supports from().select().eq().maybeSingle() pattern
// and from().rpc() pattern
function makeSupabaseMock(opts: {
  publicationRow?: PublicationRow | null;
  rpcError?: { message: string } | null;
  rpcData?: { slug: string; published_at: string } | null;
} = {}) {
  const {
    publicationRow = makePublication(),
    rpcError = null,
    rpcData = { slug: SLUG, published_at: '2026-06-01T00:00:00Z' },
  } = opts;

  // Track calls
  const rpcFn = vi.fn().mockResolvedValue({ data: rpcData, error: rpcError });

  const maybeSingleFn = vi.fn().mockResolvedValue({
    data: publicationRow,
    error: null,
  });
  const eqFn = vi.fn().mockReturnValue({ maybeSingle: maybeSingleFn });
  const selectFn = vi.fn().mockReturnValue({ eq: eqFn });
  const fromFn = vi.fn().mockReturnValue({ select: selectFn });

  const sb = {
    from: fromFn,
    rpc: rpcFn,
  };

  return { sb, mocks: { rpcFn, maybeSingleFn, eqFn, selectFn, fromFn } };
}

// ──────────────────────────────────────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────────────────────────────────────

describe('handleResearchPublish', () => {
  it('T1: returns 503 when supabaseServiceKey is a placeholder', async () => {
    const { sb } = makeSupabaseMock();
    const mockSlack = vi.fn().mockResolvedValue(undefined);

    const deps: HandlerDeps = {
      supabaseUrl: 'http://localhost:54321',
      supabaseServiceKey: 'placeholder-key',
      supabaseClient: sb,
      sendSlackAlertFn: mockSlack,
    };

    const result = await handleResearchPublish(makeBaseRequest(), deps);

    expect(result.status).toBe(503);
    expect(result.body.ok).toBe(false);
    expect(result.body.error).toMatch(/placeholder|service unavailable/i);
    expect(mockSlack).toHaveBeenCalledTimes(1);
    const slackCall = mockSlack.mock.calls[0] as [string, string];
    expect(slackCall[0]).toBe('P1');
  });

  it('T2: returns 400 when publication_id is missing', async () => {
    const { sb } = makeSupabaseMock();

    const deps: HandlerDeps = {
      supabaseUrl: 'http://localhost:54321',
      supabaseServiceKey: 'real-service-key',
      supabaseClient: sb,
    };

    const result = await handleResearchPublish({ publication_id: '', actor_id: ACTOR_ID }, deps);

    expect(result.status).toBe(400);
    expect(result.body.ok).toBe(false);
  });

  it('T3: returns 404 when publication not found', async () => {
    const { sb } = makeSupabaseMock({ publicationRow: null });

    const deps: HandlerDeps = {
      supabaseUrl: 'http://localhost:54321',
      supabaseServiceKey: 'real-service-key',
      supabaseClient: sb,
    };

    const result = await handleResearchPublish(makeBaseRequest(), deps);

    expect(result.status).toBe(404);
    expect(result.body.ok).toBe(false);
  });

  it('T4: returns 403 SELF_REVIEW_REJECTED when actor_id === created_by', async () => {
    const { sb } = makeSupabaseMock({
      publicationRow: makePublication({ created_by: ACTOR_ID }),
    });

    const deps: HandlerDeps = {
      supabaseUrl: 'http://localhost:54321',
      supabaseServiceKey: 'real-service-key',
      supabaseClient: sb,
    };

    const result = await handleResearchPublish(
      makeBaseRequest({ actor_id: ACTOR_ID }),
      deps,
    );

    expect(result.status).toBe(403);
    expect(result.body.error).toMatch(/SELF_REVIEW_REJECTED/);
  });

  it('T5: returns 200 on successful publish', async () => {
    const { sb, mocks } = makeSupabaseMock({
      rpcData: { slug: SLUG, published_at: '2026-06-01T00:00:00Z' },
    });

    const deps: HandlerDeps = {
      supabaseUrl: 'http://localhost:54321',
      supabaseServiceKey: 'real-service-key',
      supabaseClient: sb,
    };

    const result = await handleResearchPublish(makeBaseRequest(), deps);

    expect(result.status).toBe(200);
    expect(result.body.ok).toBe(true);
    expect(result.body.slug).toBe(SLUG);
    expect(result.body.published_at).toBeDefined();
    expect(mocks.rpcFn).toHaveBeenCalledOnce();
  });

  it('T6: returns 403 when RPC raises SELF_REVIEW_REJECTED', async () => {
    const { sb } = makeSupabaseMock({
      rpcError: { message: 'SELF_REVIEW_REJECTED: author cannot self-review' },
      rpcData: null,
    });

    const deps: HandlerDeps = {
      supabaseUrl: 'http://localhost:54321',
      supabaseServiceKey: 'real-service-key',
      supabaseClient: sb,
    };

    const result = await handleResearchPublish(makeBaseRequest(), deps);

    expect(result.status).toBe(403);
    expect(result.body.error).toMatch(/SELF_REVIEW_REJECTED/);
  });
});
