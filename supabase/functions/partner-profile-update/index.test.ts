/**
 * Phase 19 Plan 19-06b Deno test suite for `partner-profile-update` Edge Function.
 *
 * BL-2 Path A coverage (column allowlist + JWT auth):
 *   T1: missing Bearer JWT → 401 unauthenticated
 *   T2: body contains non-allowlisted column (`email`) → 400 invalid_input
 *   T3: valid body with template_choice='coach' → 200 + UPDATE called with 1-col patch
 *   T4: calendly_url with non-calendly host → 400 invalid_input
 *
 * Test seam: `__internal.setAdminClient(fakeAdmin)` swaps the service-role
 * client for a deterministic fake. `resetRateLimitState()` between tests.
 *
 * Run: `deno test --allow-env --allow-net supabase/functions/partner-profile-update/index.test.ts`
 */
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';

Deno.env.set('SUPABASE_URL', 'https://stub.supabase.co');
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'stub-service-role');

// Dynamic import AFTER env setup (mirrors affiliate-apply/index.test.ts):
// createClient validates SUPABASE_URL at module-load, so the env must be in
// place before the index.ts top-level `createClient(...)` runs.
const indexModule = await import('./index.ts');
const __internal = indexModule.__internal;

// ---------------------------------------------------------------------------
// Fake admin client
// ---------------------------------------------------------------------------

interface UpdateCapture {
  patch: Record<string, unknown>;
  filterId: string;
}

interface FakeAdminOpts {
  /** Resolved user.id from the JWT. Set null to simulate `getUser` failure. */
  jwtUserId: string | null;
  /** affiliates row returned by SELECT. Set null for not_an_affiliate. */
  affiliateRow?: { id: string; status: string } | null;
}

function buildFakeAdmin(opts: FakeAdminOpts): {
  admin: unknown;
  updates: UpdateCapture[];
} {
  const updates: UpdateCapture[] = [];
  const admin = {
    auth: {
      getUser(_jwt: string) {
        if (opts.jwtUserId === null) {
          return Promise.resolve({ data: { user: null }, error: null });
        }
        return Promise.resolve({
          data: { user: { id: opts.jwtUserId } },
          error: null,
        });
      },
    },
    from(table: string) {
      return {
        select(_cols: string) {
          const builder = {
            _filter: '' as string,
            eq(_col: string, val: string) {
              this._filter = val;
              return this;
            },
            maybeSingle() {
              if (table === 'affiliates') {
                return Promise.resolve({
                  data: opts.affiliateRow ?? null,
                  error: null,
                });
              }
              return Promise.resolve({ data: null, error: null });
            },
          };
          return builder;
        },
        update(patch: Record<string, unknown>) {
          return {
            eq(_col: string, id: string) {
              updates.push({ patch, filterId: id });
              return Promise.resolve({ data: null, error: null });
            },
          };
        },
      };
    },
  };
  return { admin, updates };
}

function buildReq(opts: { jwt?: string; body?: unknown }): Request {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (opts.jwt) headers['Authorization'] = `Bearer ${opts.jwt}`;
  return new Request('http://localhost/partner-profile-update', {
    method: 'POST',
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

Deno.test('T1 — missing Bearer JWT → 401 unauthenticated', async () => {
  __internal.resetRateLimitState();
  const { admin } = buildFakeAdmin({ jwtUserId: 'u-1', affiliateRow: { id: 'a-1', status: 'approved' } });
  __internal.setAdminClient(admin);

  // No Authorization header.
  const req = new Request('http://localhost/partner-profile-update', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ display_name: 'Alice' }),
  });
  const res = await __internal.handlePost(req);
  assertEquals(res.status, 401);
  const json = await res.json();
  assertEquals(json.error, 'unauthenticated');
});

Deno.test('T2 — non-allowlisted column (email) → 400 invalid_input', async () => {
  __internal.resetRateLimitState();
  const { admin, updates } = buildFakeAdmin({
    jwtUserId: 'u-1',
    affiliateRow: { id: 'a-1', status: 'approved' },
  });
  __internal.setAdminClient(admin);

  const req = buildReq({ jwt: 'fake-jwt', body: { display_name: 'Alice', email: 'evil@x.com' } });
  const res = await __internal.handlePost(req);
  assertEquals(res.status, 400);
  const json = await res.json();
  assertEquals(json.error, 'invalid_input');
  assertEquals(json.invalid_column, 'email');
  // UPDATE must NOT have been called when the allowlist gate failed.
  assertEquals(updates.length, 0);
});

Deno.test("T3 — valid body { template_choice: 'coach' } → 200 + UPDATE with 1-col patch", async () => {
  __internal.resetRateLimitState();
  const { admin, updates } = buildFakeAdmin({
    jwtUserId: 'u-1',
    affiliateRow: { id: 'a-1', status: 'approved' },
  });
  __internal.setAdminClient(admin);

  const req = buildReq({ jwt: 'fake-jwt', body: { template_choice: 'coach' } });
  const res = await __internal.handlePost(req);
  assertEquals(res.status, 200);
  const json = await res.json();
  assertEquals(json.ok, true);
  assertEquals(updates.length, 1);
  assertEquals(updates[0].patch.template_choice, 'coach');
  // Patch must also include updated_at (server-generated).
  assertEquals(typeof updates[0].patch.updated_at, 'string');
  // WHERE id = aff.id, not user_id; aff.id was resolved server-side.
  assertEquals(updates[0].filterId, 'a-1');
  // No stray columns in the patch.
  const keys = Object.keys(updates[0].patch).sort();
  assertEquals(keys, ['template_choice', 'updated_at']);
});

Deno.test('T4 — calendly_url with non-calendly host → 400 invalid_input', async () => {
  __internal.resetRateLimitState();
  const { admin, updates } = buildFakeAdmin({
    jwtUserId: 'u-1',
    affiliateRow: { id: 'a-1', status: 'approved' },
  });
  __internal.setAdminClient(admin);

  const req = buildReq({ jwt: 'fake-jwt', body: { calendly_url: 'https://evil.example.com/me' } });
  const res = await __internal.handlePost(req);
  assertEquals(res.status, 400);
  const json = await res.json();
  assertEquals(json.error, 'invalid_input');
  assertEquals(json.invalid_field, 'calendly_url');
  assertEquals(updates.length, 0);
});
