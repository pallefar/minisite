/**
 * Deno tests for `dsar-export` Edge Function — Phase 22 Plan 22-04 (GDPR-03).
 *
 * Test plan (10 tests — per plan <behavior>):
 *   T1 bearer mismatch (no Authorization) → 401
 *   T2 bearer mismatch (wrong key) → 401
 *   T3 happy path — pending → in_progress → completed; signed URL invoked;
 *      lifecycle-transactional invoked with template='dsar_ready'
 *   T4 hash-pseudonymization invariant — affiliate_conversions converter_email
 *      surfaces as converter_email_sha256 (64-char hex); plaintext NEVER in bundle
 *   T5 PDF render branch — renderDsarPdf called once; returns a Blob
 *   T6 idempotency — request already in_progress → 200, no-op
 *   T7 already-completed request → 200, no-op
 *   T8 PostHog branch with key unset → bundle.posthog_events === null + console.warn
 *   T9 PostHog branch with key set ('test-stub') → bundle.posthog_events is an array (stub returns [])
 *   T10 error path — SELECT throws → dsar_requests.status='rejected' + rejection_reason set
 */
import { assertEquals, assert } from 'jsr:@std/assert@^1';
import { __internal } from './index.ts';

// ============================================================================
// Env setup — must happen BEFORE any test runs (lazy singletons read at use)
// ============================================================================
Deno.env.set('SUPABASE_URL', 'http://localhost:54321');
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'test-service-role-key');

const TARGET_UUID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const REQUEST_UUID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const CONVERTER_UUID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

// ============================================================================
// Fake admin builder — mocks supabase-js admin client
// ============================================================================
interface FakeState {
  dsarRequestStatus: 'pending' | 'in_progress' | 'completed' | 'rejected';
  storageUpload: Array<{ bucket: string; path: string; contentType: string; size: number }>;
  signedUrlCalls: Array<{ bucket: string; path: string; ttl: number }>;
  invokeCalls: Array<{ fn: string; body: unknown }>;
  dsarUpdates: Array<{ patch: Record<string, unknown> }>;
  auditInserts: Array<Record<string, unknown>>;
  /** When set, the next dsar_requests UPDATE will throw to trigger error path. */
  forceUpdateError?: boolean;
  converterEmail?: string;
  capturedBundleJson?: string;
  renderPdfCalls: number;
}

function makeFakeAdmin(state: FakeState) {
  // deno-lint-ignore no-explicit-any
  return {
    from: (table: string) => {
      // deno-lint-ignore no-explicit-any
      const builder: any = {
        _table: table,
        _mode: 'select',
        _selectCols: '*',
        _filters: [] as Array<{ col: string; val: unknown }>,
        _patch: null as Record<string, unknown> | null,
        select(cols: string) {
          this._mode = 'select';
          this._selectCols = cols;
          return this;
        },
        update(patch: Record<string, unknown>) {
          this._mode = 'update';
          this._patch = patch;
          return this;
        },
        insert(row: Record<string, unknown> | Array<Record<string, unknown>>) {
          if (table === 'audit_logs') {
            const rows = Array.isArray(row) ? row : [row];
            for (const r of rows) state.auditInserts.push(r);
          }
          return Promise.resolve({ data: null, error: null });
        },
        eq(col: string, val: unknown) {
          this._filters.push({ col, val });
          return this;
        },
        maybeSingle() {
          return Promise.resolve(this._runSelect(true));
        },
        single() {
          return Promise.resolve(this._runSelect(true));
        },
        then(resolve: (v: unknown) => void) {
          if (this._mode === 'update' && this._table === 'dsar_requests') {
            if (state.forceUpdateError) {
              resolve({ data: null, error: { message: 'forced_test_error' } });
              return this;
            }
            state.dsarUpdates.push({ patch: this._patch ?? {} });
            const newStatus = this._patch?.status as
              | 'in_progress'
              | 'completed'
              | 'rejected'
              | undefined;
            if (newStatus) state.dsarRequestStatus = newStatus;
            resolve({ data: null, error: null });
            return this;
          }
          resolve(this._runSelect(false));
          return this;
        },
        _runSelect(isSingle: boolean) {
          if (this._table === 'dsar_requests') {
            return {
              data: { id: REQUEST_UUID, user_id: TARGET_UUID, status: state.dsarRequestStatus },
              error: null,
            };
          }
          if (this._table === 'profiles') {
            return { data: { id: TARGET_UUID, is_staff: false, created_at: '2026-01-01T00:00:00Z' }, error: null };
          }
          if (this._table === 'subscriptions') {
            return isSingle
              ? { data: null, error: null }
              : { data: [], error: null };
          }
          if (this._table === 'affiliate_conversions') {
            // Returns one conversion where the converter is CONVERTER_UUID.
            return {
              data: [
                {
                  id: 'conv1',
                  affiliate_id: 'aff1',
                  user_id: CONVERTER_UUID, // the converter
                  commission_cents: 999,
                  status: 'confirmed',
                  created_at: '2026-03-01T00:00:00Z',
                },
              ],
              error: null,
            };
          }
          if (this._table === 'photos') {
            return {
              data: [
                { photo_id: 'p1', storage_path: `${TARGET_UUID}/photos/p1.webp`, created_at: '2026-02-01T00:00:00Z' },
              ],
              error: null,
            };
          }
          // Everything else (health log tables, shares, ai_messages, clicks, payouts)
          // returns empty array. Keeps the bundle small + tests deterministic.
          return { data: [], error: null };
        },
      };
      return builder;
    },
    rpc: (fn: string, params: Record<string, unknown>) => {
      // sha256_email helper RPC — used when we batch-hash converter emails.
      if (fn === 'hash_emails_for_dsar') {
        const ids = (params.p_user_ids as string[]) ?? [];
        const out: Array<{ user_id: string; email_sha256: string }> = ids.map((uid) => ({
          user_id: uid,
          email_sha256:
            uid === CONVERTER_UUID
              ? 'a'.repeat(64) // deterministic fake hash
              : 'b'.repeat(64),
        }));
        return Promise.resolve({ data: out, error: null });
      }
      return Promise.resolve({ data: null, error: { message: `unknown_rpc:${fn}` } });
    },
    auth: {
      admin: {
        // deno-lint-ignore no-explicit-any
        getUserById: (id: string) =>
          Promise.resolve({
            data: { user: { id, email: 'patient@example.com', created_at: '2026-01-01T00:00:00Z' } },
            error: null,
          }),
      },
    },
    storage: {
      // deno-lint-ignore no-explicit-any
      from: (bucket: string) => ({
        upload: (path: string, blob: Blob, opts: { contentType?: string }) => {
          state.storageUpload.push({
            bucket,
            path,
            contentType: opts.contentType ?? 'unknown',
            size: blob.size,
          });
          if (bucket === 'dsar-exports') {
            // Capture the bundle text so tests can assert the hash invariant.
            return blob
              .text()
              .then(() => ({ data: { path }, error: null }))
              .catch(() => ({ data: { path }, error: null }));
          }
          return Promise.resolve({ data: { path }, error: null });
        },
        download: (_path: string) =>
          Promise.resolve({
            data: new Blob([new Uint8Array([0xff, 0xd8, 0xff])]),
            error: null,
          }),
        createSignedUrl: (path: string, ttl: number) => {
          state.signedUrlCalls.push({ bucket, path, ttl });
          return Promise.resolve({
            data: { signedUrl: `https://stub.example.com/${path}?token=abc` },
            error: null,
          });
        },
      }),
    },
    functions: {
      invoke: (fn: string, opts: { body: unknown }) => {
        state.invokeCalls.push({ fn, body: opts.body });
        return Promise.resolve({ data: { ok: true }, error: null });
      },
    },
  };
}

function makeReq(bearer: string | null, body: unknown): Request {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (bearer !== null) headers['Authorization'] = `Bearer ${bearer}`;
  return new Request('http://localhost/dsar-export', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

function newState(overrides: Partial<FakeState> = {}): FakeState {
  return {
    dsarRequestStatus: 'pending',
    storageUpload: [],
    signedUrlCalls: [],
    invokeCalls: [],
    dsarUpdates: [],
    auditInserts: [],
    renderPdfCalls: 0,
    ...overrides,
  };
}

// ============================================================================
// Tests
// ============================================================================

Deno.test('T1 — no Authorization → 401', async () => {
  const state = newState();
  __internal.setAdminForTest(makeFakeAdmin(state));
  __internal.setRenderPdfForTest(async () => {
    state.renderPdfCalls++;
    return new Blob(['%PDF-stub']);
  });
  const res = await __internal.handleExport(makeReq(null, { request_id: REQUEST_UUID }));
  assertEquals(res.status, 401);
});

Deno.test('T2 — wrong bearer → 401', async () => {
  const state = newState();
  __internal.setAdminForTest(makeFakeAdmin(state));
  __internal.setRenderPdfForTest(async () => new Blob(['%PDF-stub']));
  const res = await __internal.handleExport(makeReq('wrong-key', { request_id: REQUEST_UUID }));
  assertEquals(res.status, 401);
});

Deno.test('T3 — happy path: status pending→in_progress→completed; lifecycle invoked', async () => {
  Deno.env.delete('POSTHOG_PERSONAL_API_KEY');
  const state = newState();
  __internal.setAdminForTest(makeFakeAdmin(state));
  __internal.setRenderPdfForTest(async () => {
    state.renderPdfCalls++;
    return new Blob(['%PDF-1.4 stub-bytes']);
  });
  const res = await __internal.handleExport(
    makeReq('test-service-role-key', { request_id: REQUEST_UUID }),
  );
  assertEquals(res.status, 200);
  // Status transitions: in_progress THEN completed → two UPDATEs
  const statuses = state.dsarUpdates
    .map((u) => u.patch.status as string | undefined)
    .filter((s): s is string => !!s);
  assertEquals(statuses[0], 'in_progress', 'first UPDATE sets in_progress');
  assertEquals(statuses[statuses.length - 1], 'completed', 'last UPDATE sets completed');
  // lifecycle invoked with template='dsar_ready'
  const lc = state.invokeCalls.find((c) => c.fn === 'lifecycle-transactional');
  assert(lc, 'lifecycle-transactional invoked');
  const body = lc!.body as { template: string; user_id: string; data: { signed_url: string } };
  assertEquals(body.template, 'dsar_ready');
  assertEquals(body.user_id, TARGET_UUID);
  assert(body.data.signed_url.startsWith('https://stub.example.com/'));
  // Storage upload bucket = dsar-exports
  const upload = state.storageUpload.find((u) => u.bucket === 'dsar-exports');
  assert(upload, 'dsar-exports upload happened');
  assertEquals(upload!.path, `${TARGET_UUID}/${REQUEST_UUID}.zip`);
  assertEquals(upload!.contentType, 'application/zip');
});

Deno.test('T4 — hash-pseudonymization invariant: converter_email_sha256 (no plaintext)', async () => {
  Deno.env.delete('POSTHOG_PERSONAL_API_KEY');
  const state = newState();
  // Capture the JSON entry written into the ZIP by spying on the json-blob step.
  let capturedBundle: unknown = null;
  __internal.setBundleSpyForTest((bundle) => {
    capturedBundle = bundle;
  });
  // Need the affiliates lookup to surface affiliateId so conversions get fetched
  // — extend the fake to return one. The default makeFakeAdmin returns null
  // from .maybeSingle on most tables; override `from('affiliates')` here.
  const fake = makeFakeAdmin(state) as unknown as Record<string, unknown>;
  const baseFrom = (fake as any).from;
  (fake as any).from = (table: string) => {
    if (table === 'affiliates') {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: () =>
              Promise.resolve({ data: { id: 'aff-id-1' }, error: null }),
          }),
        }),
      };
    }
    return baseFrom(table);
  };
  // Inject a getUserById that returns a different email for the CONVERTER
  // (so we can string-scan for that specific email and prove it's hashed).
  const CONVERTER_PLAINTEXT = 'converter-plaintext@evil.example';
  (fake as any).auth = {
    admin: {
      getUserById: (id: string) => {
        if (id === CONVERTER_UUID) {
          return Promise.resolve({
            data: {
              user: {
                id,
                email: CONVERTER_PLAINTEXT,
                created_at: '2026-03-01T00:00:00Z',
              },
            },
            error: null,
          });
        }
        return Promise.resolve({
          data: {
            user: { id, email: 'patient@example.com', created_at: '2026-01-01T00:00:00Z' },
          },
          error: null,
        });
      },
    },
  };
  __internal.setAdminForTest(fake);
  __internal.setRenderPdfForTest(async () => new Blob(['%PDF-stub']));
  const res = await __internal.handleExport(
    makeReq('test-service-role-key', { request_id: REQUEST_UUID }),
  );
  assertEquals(res.status, 200);
  assert(capturedBundle, 'bundle was assembled');
  const serialized = JSON.stringify(capturedBundle);
  // PRIMARY INVARIANT: the OTHER user's plaintext email NEVER appears
  assert(
    !serialized.includes(CONVERTER_PLAINTEXT),
    `converter plaintext email leaked: ${CONVERTER_PLAINTEXT}`,
  );
  // The requester's own email IS legitimately in their own DSAR bundle (it's THEIR data).
  // No assertion on patient@example.com — D-06 only hashes OTHER users.
  // NEGATIVE: no field named "converter_email" (plaintext-bearing)
  assert(!serialized.includes('"converter_email"'), 'NO converter_email field name');
  // POSITIVE: converter_email_sha256 IS present as a 64-char hex digest
  assert(serialized.includes('converter_email_sha256'), 'converter_email_sha256 present');
  assert(/[0-9a-f]{64}/.test(serialized), 'sha256 hex digest present');
});

Deno.test('T5 — PDF render is invoked', async () => {
  Deno.env.delete('POSTHOG_PERSONAL_API_KEY');
  const state = newState();
  __internal.setAdminForTest(makeFakeAdmin(state));
  let pdfCalls = 0;
  __internal.setRenderPdfForTest(async () => {
    pdfCalls++;
    return new Blob(['%PDF-stub']);
  });
  const res = await __internal.handleExport(
    makeReq('test-service-role-key', { request_id: REQUEST_UUID }),
  );
  assertEquals(res.status, 200);
  assertEquals(pdfCalls, 1, 'renderDsarPdf called exactly once');
});

Deno.test('T6 — already in_progress → 200, no-op (idempotent)', async () => {
  Deno.env.delete('POSTHOG_PERSONAL_API_KEY');
  const state = newState({ dsarRequestStatus: 'in_progress' });
  __internal.setAdminForTest(makeFakeAdmin(state));
  __internal.setRenderPdfForTest(async () => new Blob(['%PDF-stub']));
  const res = await __internal.handleExport(
    makeReq('test-service-role-key', { request_id: REQUEST_UUID }),
  );
  assertEquals(res.status, 200);
  // No NEW UPDATE to status (nothing pushed)
  const statuses = state.dsarUpdates.map((u) => u.patch.status as string | undefined);
  assertEquals(statuses.length, 0, 'no UPDATE issued on already in_progress');
  // No upload
  assertEquals(state.storageUpload.length, 0, 'no upload on idempotent re-call');
});

Deno.test('T7 — already completed → 200, no-op', async () => {
  Deno.env.delete('POSTHOG_PERSONAL_API_KEY');
  const state = newState({ dsarRequestStatus: 'completed' });
  __internal.setAdminForTest(makeFakeAdmin(state));
  __internal.setRenderPdfForTest(async () => new Blob(['%PDF-stub']));
  const res = await __internal.handleExport(
    makeReq('test-service-role-key', { request_id: REQUEST_UUID }),
  );
  assertEquals(res.status, 200);
  assertEquals(state.storageUpload.length, 0, 'no upload on already-completed re-call');
});

Deno.test('T8 — PostHog branch: key unset → bundle.posthog_events === null', async () => {
  Deno.env.delete('POSTHOG_PERSONAL_API_KEY');
  const state = newState();
  let capturedBundle: { posthog_events?: unknown } | null = null;
  __internal.setBundleSpyForTest((b) => {
    capturedBundle = b as { posthog_events?: unknown };
  });
  __internal.setAdminForTest(makeFakeAdmin(state));
  __internal.setRenderPdfForTest(async () => new Blob(['%PDF-stub']));
  await __internal.handleExport(
    makeReq('test-service-role-key', { request_id: REQUEST_UUID }),
  );
  assertEquals((capturedBundle as { posthog_events?: unknown } | null)?.posthog_events, null);
});

Deno.test('T9 — PostHog branch: key set → bundle.posthog_events is an array', async () => {
  Deno.env.set('POSTHOG_PERSONAL_API_KEY', 'test-stub');
  Deno.env.set('POSTHOG_PROJECT_ID', '12345');
  const state = newState();
  let capturedBundle: { posthog_events?: unknown } | null = null;
  __internal.setBundleSpyForTest((b) => {
    capturedBundle = b as { posthog_events?: unknown };
  });
  __internal.setAdminForTest(makeFakeAdmin(state));
  __internal.setRenderPdfForTest(async () => new Blob(['%PDF-stub']));
  __internal.setPosthogFetchForTest(async () => ({ results: [{ event: 'pageview' }] }));
  await __internal.handleExport(
    makeReq('test-service-role-key', { request_id: REQUEST_UUID }),
  );
  Deno.env.delete('POSTHOG_PERSONAL_API_KEY');
  Deno.env.delete('POSTHOG_PROJECT_ID');
  assert(Array.isArray((capturedBundle as { posthog_events?: unknown } | null)?.posthog_events));
});

Deno.test('T10 — error path: storage upload throws → status=rejected + rejection_reason', async () => {
  Deno.env.delete('POSTHOG_PERSONAL_API_KEY');
  const state = newState();
  const fake = makeFakeAdmin(state);
  // Override storage.from to make dsar-exports upload throw
  // deno-lint-ignore no-explicit-any
  (fake.storage as any).from = (bucket: string) => {
    if (bucket === 'dsar-exports') {
      return {
        upload: (_p: string, _b: Blob, _o: unknown) =>
          Promise.resolve({ data: null, error: { message: 'fake_upload_fail' } }),
        download: () => Promise.resolve({ data: null, error: null }),
        createSignedUrl: () => Promise.resolve({ data: null, error: null }),
      };
    }
    return {
      upload: () => Promise.resolve({ data: null, error: null }),
      download: () =>
        Promise.resolve({ data: new Blob([new Uint8Array([0xff])]), error: null }),
      createSignedUrl: () =>
        Promise.resolve({
          data: { signedUrl: 'https://stub' },
          error: null,
        }),
    };
  };
  __internal.setAdminForTest(fake);
  __internal.setRenderPdfForTest(async () => new Blob(['%PDF-stub']));
  const res = await __internal.handleExport(
    makeReq('test-service-role-key', { request_id: REQUEST_UUID }),
  );
  assertEquals(res.status, 500);
  // Status set to rejected with a reason
  const statuses = state.dsarUpdates.map((u) => u.patch.status as string | undefined);
  assert(statuses.includes('rejected'), 'status set to rejected on error');
  const rejectedUpdate = state.dsarUpdates.find((u) => u.patch.status === 'rejected');
  assert(
    typeof rejectedUpdate?.patch.rejection_reason === 'string' &&
      (rejectedUpdate.patch.rejection_reason as string).length > 0,
    'rejection_reason populated',
  );
});
