/**
 * Deno tests for generate-course-certificate Edge Function — Phase 46 Plan 07 Task 4.
 *
 * Per reference_deno_test_top_level_serve_trap: index.ts uses the
 * `import.meta.main && denoGlobal?.serve` guard so importing this module
 * does NOT spawn a real HTTP server.
 *
 * Coverage (8 cases per task spec):
 *   T1: OPTIONS → 204 (CORS preflight)
 *   T2: non-POST → 405
 *   T3: missing Authorization bearer → 401
 *   T4: invalid bearer (auth.getUser returns null user) → 401
 *   T5: missing course_id in body → 400
 *   T6: CERT_VERIFICATION_SECRET env empty → 500 'cert_secret_missing'
 *   T7: complete_course RPC says course incomplete → 403 'course_not_complete'
 *   T8a: complete_course returns already_issued=true → 200 + existing pdf_path, NO render call, NO upload call
 *   T8b: complete_course returns already_issued=false → 200 + render + upload + HMAC + UPDATE certificates
 *
 * Run: $HOME/.deno/bin/deno test --no-check --allow-env --allow-net supabase/functions/generate-course-certificate/index.test.ts
 */

import { assert, assertEquals, assertExists } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import {
  handler,
  setAdminForTest,
  resetAdminForTest,
  setUserClientFactoryForTest,
  resetUserClientFactoryForTest,
  setRenderForTest,
  resetRenderForTest,
} from './index.ts';

// ---------------------------------------------------------------------------
// Mock plumbing
// ---------------------------------------------------------------------------

interface RpcCall {
  name: string;
  args: Record<string, unknown>;
}

interface UploadCall {
  bucket: string;
  path: string;
  byteLength: number;
  contentType?: string;
  upsert?: boolean;
}

interface SignCall {
  bucket: string;
  path: string;
  ttl: number;
}

interface UpdateCall {
  table: string;
  patch: Record<string, unknown>;
  eqCol: string;
  eqVal: unknown;
}

let rpcCalls: RpcCall[] = [];
let uploadCalls: UploadCall[] = [];
let signCalls: SignCall[] = [];
let updateCalls: UpdateCall[] = [];
let renderCalls: number = 0;

function reset(): void {
  rpcCalls = [];
  uploadCalls = [];
  signCalls = [];
  updateCalls = [];
  renderCalls = 0;
  resetAdminForTest();
  resetUserClientFactoryForTest();
  resetRenderForTest();
  // Clean env so per-test set() controls
  try {
    Deno.env.delete('CERT_VERIFICATION_SECRET');
  } catch {
    /* ignore */
  }
}

interface CertRow {
  id: string;
  user_id: string;
  course_id: string;
  issued_at: string;
  pdf_path?: string | null;
}

interface MockFixtures {
  validToken?: string;
  userId?: string;
  fullName?: string;
  courseTitle?: string;
  certRow?: CertRow;
  rpcResult?: { data: Array<{ certificate_id: string; already_issued: boolean }> | null; error: { message: string } | null };
  uploadError?: { message: string } | null;
  signedUrl?: string | null;
  existingPdfPath?: string | null;
}

function makeMockAdmin(opts: MockFixtures): unknown {
  const {
    validToken = 'valid-jwt',
    userId = 'user-1',
    fullName = 'Alice Tester',
    courseTitle = 'Intro to GLP-1',
    certRow = {
      id: 'cert-1',
      user_id: userId,
      course_id: 'course-1',
      issued_at: '2026-02-01T00:00:00.000Z',
      pdf_path: null,
    },
    uploadError = null,
    signedUrl = 'https://signed.example/cert.pdf?token=abc',
    existingPdfPath = null,
  } = opts;

  return {
    auth: {
      getUser: (token: string) => {
        if (token === validToken) {
          return Promise.resolve({ data: { user: { id: userId } }, error: null });
        }
        return Promise.resolve({ data: { user: null }, error: null });
      },
    },
    from: (table: string) => {
      return {
        select: (_cols: string) => ({
          eq: (_col: string, _val: unknown) => ({
            single: () => {
              if (table === 'profiles') {
                return Promise.resolve({ data: { full_name: fullName }, error: null });
              }
              if (table === 'courses') {
                return Promise.resolve({ data: { title: courseTitle }, error: null });
              }
              if (table === 'certificates') {
                // For already_issued path, return existing pdf_path; otherwise return certRow
                if (existingPdfPath !== null) {
                  return Promise.resolve({
                    data: {
                      id: certRow.id,
                      user_id: certRow.user_id,
                      course_id: certRow.course_id,
                      issued_at: certRow.issued_at,
                      pdf_path: existingPdfPath,
                    },
                    error: null,
                  });
                }
                return Promise.resolve({ data: certRow, error: null });
              }
              return Promise.resolve({ data: null, error: null });
            },
          }),
        }),
        update: (patch: Record<string, unknown>) => ({
          eq: (col: string, val: unknown) => {
            updateCalls.push({ table, patch, eqCol: col, eqVal: val });
            return Promise.resolve({ data: null, error: null });
          },
        }),
      };
    },
    storage: {
      from: (bucket: string) => ({
        upload: (
          path: string,
          bytes: Uint8Array,
          opts2: { contentType?: string; upsert?: boolean },
        ) => {
          uploadCalls.push({
            bucket,
            path,
            byteLength: bytes.byteLength,
            contentType: opts2?.contentType,
            upsert: opts2?.upsert,
          });
          return Promise.resolve({ data: null, error: uploadError });
        },
        createSignedUrl: (path: string, ttl: number) => {
          signCalls.push({ bucket, path, ttl });
          return Promise.resolve({ data: { signedUrl }, error: null });
        },
      }),
    },
  };
}

function makeMockUserClient(rpcResult: MockFixtures['rpcResult']): unknown {
  return {
    rpc: (name: string, args: Record<string, unknown>) => {
      rpcCalls.push({ name, args });
      return Promise.resolve(rpcResult ?? { data: null, error: null });
    },
  };
}

function makeReq(opts: {
  method?: string;
  body?: unknown;
  bearer?: string | null;
}): Request {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (opts.bearer) headers['Authorization'] = `Bearer ${opts.bearer}`;
  return new Request('http://localhost/generate-course-certificate', {
    method: opts.method ?? 'POST',
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

Deno.test('T1: OPTIONS preflight → 204', async () => {
  reset();
  const res = await handler(new Request('http://localhost/', { method: 'OPTIONS' }));
  assertEquals(res.status, 204);
});

Deno.test('T2: non-POST → 405', async () => {
  reset();
  const res = await handler(new Request('http://localhost/', { method: 'GET' }));
  assertEquals(res.status, 405);
});

Deno.test('T3: missing Authorization bearer → 401', async () => {
  reset();
  Deno.env.set('CERT_VERIFICATION_SECRET', 'test-secret');
  setAdminForTest(makeMockAdmin({}));
  const res = await handler(makeReq({ body: { course_id: 'course-1' } }));
  assertEquals(res.status, 401);
  const json = await res.json();
  assertEquals(json.error, 'unauthorized');
});

Deno.test('T4: invalid bearer → 401', async () => {
  reset();
  Deno.env.set('CERT_VERIFICATION_SECRET', 'test-secret');
  setAdminForTest(makeMockAdmin({ validToken: 'valid-jwt' }));
  const res = await handler(makeReq({ body: { course_id: 'course-1' }, bearer: 'bogus' }));
  assertEquals(res.status, 401);
});

Deno.test('T5: missing course_id → 400', async () => {
  reset();
  Deno.env.set('CERT_VERIFICATION_SECRET', 'test-secret');
  setAdminForTest(makeMockAdmin({}));
  const res = await handler(makeReq({ body: {}, bearer: 'valid-jwt' }));
  assertEquals(res.status, 400);
});

Deno.test('T6: CERT_VERIFICATION_SECRET empty → 500 cert_secret_missing', async () => {
  reset();
  // do NOT set CERT_VERIFICATION_SECRET
  setAdminForTest(makeMockAdmin({}));
  const res = await handler(makeReq({ body: { course_id: 'course-1' }, bearer: 'valid-jwt' }));
  assertEquals(res.status, 500);
  const json = await res.json();
  assertEquals(json.error, 'cert_secret_missing');
});

Deno.test('T7: complete_course RPC returns course_not_complete → 403', async () => {
  reset();
  Deno.env.set('CERT_VERIFICATION_SECRET', 'test-secret');
  setAdminForTest(makeMockAdmin({}));
  setUserClientFactoryForTest(() =>
    makeMockUserClient({
      data: null,
      error: { message: 'course_not_complete: required 5 of 10' },
    }) as any,
  );
  const res = await handler(makeReq({ body: { course_id: 'course-1' }, bearer: 'valid-jwt' }));
  assertEquals(res.status, 403);
  const json = await res.json();
  assertEquals(json.error, 'course_not_complete');
});

Deno.test('T8a: already_issued=true → 200, NO render call, NO upload call, signed URL only', async () => {
  reset();
  Deno.env.set('CERT_VERIFICATION_SECRET', 'test-secret');
  setAdminForTest(
    makeMockAdmin({
      existingPdfPath: 'user-1/course-1-cert-1.pdf',
    }),
  );
  setUserClientFactoryForTest(() =>
    makeMockUserClient({
      data: [{ certificate_id: 'cert-1', already_issued: true }],
      error: null,
    }) as any,
  );
  setRenderForTest(() => {
    renderCalls++;
    return Promise.resolve(new Uint8Array([0x25, 0x50, 0x44, 0x46]));
  });

  const res = await handler(makeReq({ body: { course_id: 'course-1' }, bearer: 'valid-jwt' }));
  assertEquals(res.status, 200);
  const json = await res.json();
  assertEquals(json.already_issued, true);
  assertExists(json.download_url);
  assertEquals(renderCalls, 0, 'renderCertPdf MUST NOT be called when cert already issued');
  assertEquals(uploadCalls.length, 0, 'Storage upload MUST NOT happen when cert already issued');
  assertEquals(signCalls.length, 1, 'signed URL should be regenerated once');
  assertEquals(signCalls[0].ttl, 3600, 'signed URL TTL must be 60 min (3600s)');
  assertEquals(signCalls[0].bucket, 'certificates');
});

Deno.test('T8b: already_issued=false → 200, render + upload + HMAC + UPDATE, 3600s URL', async () => {
  reset();
  Deno.env.set('CERT_VERIFICATION_SECRET', 'test-secret-B');
  setAdminForTest(makeMockAdmin({}));
  setUserClientFactoryForTest(() =>
    makeMockUserClient({
      data: [{ certificate_id: 'cert-1', already_issued: false }],
      error: null,
    }) as any,
  );
  setRenderForTest(() => {
    renderCalls++;
    return Promise.resolve(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0xff, 0xff]));
  });

  const res = await handler(makeReq({ body: { course_id: 'course-1' }, bearer: 'valid-jwt' }));
  assertEquals(res.status, 200);
  const json = await res.json();
  assertEquals(json.already_issued, false);
  assertEquals(json.certificate_id, 'cert-1');
  assertExists(json.verification_token);
  assertExists(json.verification_url);
  assertExists(json.download_url);

  // Render must be called once
  assertEquals(renderCalls, 1, 'renderCertPdf should run exactly once');

  // Upload to certificates bucket at canonical path
  assertEquals(uploadCalls.length, 1);
  assertEquals(uploadCalls[0].bucket, 'certificates');
  assertEquals(uploadCalls[0].path, 'user-1/course-1-cert-1.pdf');
  assertEquals(uploadCalls[0].contentType, 'application/pdf');
  assertEquals(uploadCalls[0].upsert, true);
  assert(uploadCalls[0].byteLength > 0);

  // Signed URL at TTL=3600
  assertEquals(signCalls.length, 1);
  assertEquals(signCalls[0].ttl, 3600);
  assertEquals(signCalls[0].bucket, 'certificates');

  // UPDATE certificates row with verification_token + pdf_path
  const certUpdates = updateCalls.filter((u) => u.table === 'certificates');
  assertEquals(certUpdates.length, 1);
  assertEquals(certUpdates[0].eqCol, 'id');
  assertEquals(certUpdates[0].eqVal, 'cert-1');
  assertEquals(certUpdates[0].patch.pdf_path, 'user-1/course-1-cert-1.pdf');
  assertExists(certUpdates[0].patch.verification_token);

  // RPC call was via per-user client (not service-role direct write)
  assertEquals(rpcCalls.length, 1);
  assertEquals(rpcCalls[0].name, 'complete_course');
  assertEquals(rpcCalls[0].args.p_course_id, 'course-1');

  // verification_url has expected shape
  assert(
    (json.verification_url as string).startsWith('https://app.leanshot.app/verify/cert-1?t='),
    `verification_url shape: ${json.verification_url}`,
  );
});
