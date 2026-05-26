/**
 * Phase 60 Plan 60-14 — rag-cost-query Edge Fn unit tests.
 *
 * Tests run via Deno:
 *   $HOME/.deno/bin/deno test --no-check supabase/functions/rag-cost-query/__tests__/posthog-query.test.ts
 *
 * Coverage:
 *   1. Admin auth: missing JWT → 401; non-staff JWT → 403
 *   2. Allowlist: unknown vendor → 400 { error: 'invalid_vendor' }
 *   3. Happy path: PostHog response → { vendor, mtd_usd, sparkline_7d }
 *   4. Cron-row aggregation: trace_prefix rollup path
 *   5. PostHog error passthrough: 429 → 429 { error: 'upstream_rate_limited' }
 *   6. PII assertion: PostHog extra columns (user_id) are stripped before browser
 */

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { handle } from "../index.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeReq(
  body: unknown,
  opts: { auth?: string; method?: string } = {},
): Request {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (opts.auth !== undefined) {
    headers["Authorization"] = opts.auth;
  }
  return new Request("https://fn.supabase.co/rag-cost-query", {
    method: opts.method ?? "POST",
    headers,
    body: JSON.stringify(body),
  });
}

// Stub Supabase admin client factory used by the Fn
function makeStubAdmin(opts: {
  isStaff?: boolean;
  userId?: string;
  error?: boolean;
}) {
  return {
    auth: {
      getUser: async (_jwt: string) => {
        if (opts.error) {
          return { data: { user: null }, error: { message: "invalid jwt" } };
        }
        return {
          data: { user: opts.userId ? { id: opts.userId } : null },
          error: null,
        };
      },
    },
    from: (_table: string) => ({
      select: (_col: string) => ({
        eq: (_col2: string, _val: string) => ({
          single: async () => ({
            data: opts.isStaff ? { is_staff: true } : { is_staff: false },
            error: null,
          }),
        }),
      }),
    }),
    rpc: async () => ({ data: null, error: null }),
  };
}

// Stub PostHog fetch responses
function makePostHogFetch(
  responseBody: unknown,
  status = 200,
): typeof fetch {
  return async (input: string | URL | Request, _init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url.includes("posthog.com") || url.includes("app.posthog.com")) {
      return new Response(JSON.stringify(responseBody), {
        status,
        headers: { "Content-Type": "application/json" },
      });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  };
}

// ---------------------------------------------------------------------------
// Test 1: Admin auth — missing JWT → 401
// ---------------------------------------------------------------------------

Deno.test("auth: missing JWT returns 401", async () => {
  const req = makeReq({ vendors: ["cohere_rerank"] }, { auth: undefined });
  const stubAdmin = makeStubAdmin({ error: true });
  const res = await handle(req, stubAdmin as never, makePostHogFetch({}));
  assertEquals(res.status, 401);
  const body = await res.json() as { error: string };
  assertEquals(body.error, "unauthorized");
});

// ---------------------------------------------------------------------------
// Test 1b: Admin auth — non-staff JWT → 403
// ---------------------------------------------------------------------------

Deno.test("auth: non-staff JWT returns 403", async () => {
  const req = makeReq({ vendors: ["cohere_rerank"] }, { auth: "Bearer valid-but-not-staff" });
  const stubAdmin = makeStubAdmin({ isStaff: false, userId: "user-123" });
  const res = await handle(req, stubAdmin as never, makePostHogFetch({}));
  assertEquals(res.status, 403);
  const body = await res.json() as { error: string };
  assertEquals(body.error, "forbidden");
});

// ---------------------------------------------------------------------------
// Test 2: Allowlist — unknown vendor → 400 { error: 'invalid_vendor' }
// ---------------------------------------------------------------------------

Deno.test("allowlist: unknown vendor returns 400 invalid_vendor", async () => {
  const req = makeReq(
    { vendors: ["malicious_vendor"] },
    { auth: "Bearer staff-jwt" },
  );
  const stubAdmin = makeStubAdmin({ isStaff: true, userId: "staff-123" });
  const res = await handle(req, stubAdmin as never, makePostHogFetch({}));
  assertEquals(res.status, 400);
  const body = await res.json() as { error: string };
  assertEquals(body.error, "invalid_vendor");
});

// ---------------------------------------------------------------------------
// Test 3: Happy path
// ---------------------------------------------------------------------------

Deno.test("happy path: returns aggregated cost + 7-day sparkline", async () => {
  const postHogResponse = {
    results: [
      ["2026-05-20", "1.23"],
      ["2026-05-21", "2.45"],
    ],
    columns: ["day", "cost"],
  };

  const req = makeReq(
    { vendors: ["cohere_rerank"], rangeDays: 7 },
    { auth: "Bearer staff-jwt" },
  );
  const stubAdmin = makeStubAdmin({ isStaff: true, userId: "staff-123" });
  const res = await handle(
    req,
    stubAdmin as never,
    makePostHogFetch(postHogResponse),
  );
  assertEquals(res.status, 200);
  const body = await res.json() as {
    results: Array<{ vendor: string; mtd_usd: number; sparkline_7d: number[]; last_day_with_data: string | null }>
  };
  assertEquals(Array.isArray(body.results), true);
  const row = body.results[0]!;
  assertEquals(row.vendor, "cohere_rerank");
  // mtd_usd = sum of all cost values
  const expectedMtd = 1.23 + 2.45;
  assertEquals(Math.abs(row.mtd_usd - expectedMtd) < 0.01, true);
  // sparkline_7d is padded to 7 entries
  assertEquals(row.sparkline_7d.length, 7);
  assertEquals(row.last_day_with_data, "2026-05-21");
});

// ---------------------------------------------------------------------------
// Test 4: Cron-row aggregation — trace_prefix rollup
// ---------------------------------------------------------------------------

Deno.test("trace rollup: returns aggregated cost for trace prefix", async () => {
  const postHogResponse = {
    results: [
      ["2026-05-19", "0.50"],
      ["2026-05-20", "0.75"],
      ["2026-05-21", "0.90"],
    ],
    columns: ["day", "cost"],
  };

  const req = makeReq(
    { traceRollups: ["tip_of_day"], rangeDays: 30 },
    { auth: "Bearer staff-jwt" },
  );
  const stubAdmin = makeStubAdmin({ isStaff: true, userId: "staff-123" });
  const res = await handle(
    req,
    stubAdmin as never,
    makePostHogFetch(postHogResponse),
  );
  assertEquals(res.status, 200);
  const body = await res.json() as {
    results: Array<{ vendor: string; mtd_usd: number; sparkline_7d: number[] }>
  };
  const row = body.results[0]!;
  assertEquals(row.vendor, "tip_of_day_per_day");
  const expectedMtd = 0.50 + 0.75 + 0.90;
  assertEquals(Math.abs(row.mtd_usd - expectedMtd) < 0.01, true);
});

// ---------------------------------------------------------------------------
// Test 5: PostHog error passthrough — 429 → 429 upstream_rate_limited
// ---------------------------------------------------------------------------

Deno.test("PostHog 429 → 429 upstream_rate_limited", async () => {
  const req = makeReq(
    { vendors: ["openai_embed"] },
    { auth: "Bearer staff-jwt" },
  );
  const stubAdmin = makeStubAdmin({ isStaff: true, userId: "staff-123" });
  const res = await handle(
    req,
    stubAdmin as never,
    makePostHogFetch({ error: "rate limited" }, 429),
  );
  assertEquals(res.status, 429);
  const body = await res.json() as { error: string };
  assertEquals(body.error, "upstream_rate_limited");
});

// ---------------------------------------------------------------------------
// Test 6: PII assertion — PostHog extra columns are stripped
// ---------------------------------------------------------------------------

Deno.test("PII: extra columns (user_id) are stripped from PostHog response", async () => {
  // PostHog response with extra PII columns
  const postHogResponse = {
    results: [
      ["2026-05-21", "1.50", "user-abc-123", "email@example.com"],
    ],
    columns: ["day", "cost", "user_id", "email"],
  };

  const req = makeReq(
    { vendors: ["firecrawl"] },
    { auth: "Bearer staff-jwt" },
  );
  const stubAdmin = makeStubAdmin({ isStaff: true, userId: "staff-123" });
  const res = await handle(
    req,
    stubAdmin as never,
    makePostHogFetch(postHogResponse),
  );
  assertEquals(res.status, 200);
  const body = await res.json() as {
    results: Array<Record<string, unknown>>
  };
  const row = body.results[0]!;
  // Only { vendor, mtd_usd, sparkline_7d, last_day_with_data } — NO user_id, NO email
  assertEquals("user_id" in row, false);
  assertEquals("email" in row, false);
  assertEquals("vendor" in row, true);
  assertEquals("mtd_usd" in row, true);
  assertEquals("sparkline_7d" in row, true);
});
