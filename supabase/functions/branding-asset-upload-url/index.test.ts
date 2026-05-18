/**
 * branding-asset-upload-url Edge Function — unit tests
 *
 * Tests E1–E5 per plan 31-02 Task 2 <behavior>:
 *   E1: Missing Authorization header → 401 {error: 'missing_jwt'}
 *   E2: Valid JWT + owner of orgX + valid body → 200 {upload_url, path, token}
 *   E3: Valid JWT + owner of orgX + body targeting orgY → 403 {error: 'insufficient_privilege'}
 *   E4: Invalid kind ('banner') → 400 {error: 'invalid_kind'}
 *   E5: Invalid ext ('gif') for org-branding → 400 {error: 'invalid_ext'}
 *
 * Clients are mock-injected via HandlerDeps so no live Supabase project is needed.
 * Tests use Deno.test with sanitizeOps: false, sanitizeResources: false to avoid
 * timer/resource leak warnings from the mock clients.
 *
 * Filename: index.test.ts (NOT index-test.ts) per [[reference_deno_test_discovery]].
 */

import { assertEquals } from 'jsr:@std/assert@1';
import { handler, type HandlerDeps } from './index.ts';

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

const ORG_X = 'aaaa0000-0000-0000-0000-000000000001';
const ORG_Y = 'bbbb0000-0000-0000-0000-000000000002';
const VALID_JWT_OWNER_X = 'valid-jwt-owner-of-org-x';

/** Build a mock JWT-scoped client that simulates role/permission RPC responses. */
function makeJwtClient(opts: {
  /** org_id → role value returned by get_caller_role */
  roleMap: Record<string, string | null>;
  /** (role, perm) → boolean returned by has_permission */
  permMap: Record<string, boolean>;
}) {
  return (_jwt: string) => ({
    rpc: (name: string, params: Record<string, unknown>) => {
      if (name === 'get_caller_role') {
        const role = opts.roleMap[params.p_org_id as string] ?? null;
        return Promise.resolve({ data: role, error: null });
      }
      if (name === 'has_permission') {
        const key = `${params.p_role}:${params.p_perm}`;
        const hasPerm = opts.permMap[key] ?? false;
        return Promise.resolve({ data: hasPerm, error: null });
      }
      return Promise.resolve({ data: null, error: { message: `unknown rpc ${name}` } });
    },
  });
}

/** Build a mock service-role client that simulates Storage.createSignedUploadUrl. */
function makeServiceClient(opts: {
  /** Whether createSignedUploadUrl succeeds */
  succeed: boolean;
}) {
  return () => ({
    storage: {
      from: (_bucket: string) => ({
        createSignedUploadUrl: (path: string) => {
          if (opts.succeed) {
            return Promise.resolve({
              data: {
                signedUrl: `https://supabase.example.com/storage/v1/upload/sign/${path}?token=abc`,
                token: 'mock-token-abc',
                path,
              },
              error: null,
            });
          }
          return Promise.resolve({ data: null, error: { message: 'storage error' } });
        },
      }),
    },
  });
}

/** Owner-of-orgX deps: get_caller_role returns 'owner', has_permission('owner','branding.edit') = true */
const ownerXDeps: HandlerDeps = {
  jwtClientFactory: makeJwtClient({
    roleMap: { [ORG_X]: 'owner' },
    permMap: { 'owner:branding.edit': true },
  }) as HandlerDeps['jwtClientFactory'],
  serviceClientFactory: makeServiceClient({ succeed: true }) as HandlerDeps['serviceClientFactory'],
};

/** Cross-tenant deps: orgY → role null → has_permission false */
const crossTenantDeps: HandlerDeps = {
  jwtClientFactory: makeJwtClient({
    roleMap: { [ORG_X]: 'owner', [ORG_Y]: null }, // caller not in orgY
    permMap: { 'owner:branding.edit': true, 'null:branding.edit': false },
  }) as HandlerDeps['jwtClientFactory'],
  serviceClientFactory: makeServiceClient({ succeed: true }) as HandlerDeps['serviceClientFactory'],
};

function makeRequest(
  opts: {
    method?: string;
    authHeader?: string | null;
    body?: unknown;
  } = {},
): Request {
  const { method = 'POST', authHeader = `Bearer ${VALID_JWT_OWNER_X}`, body } = opts;
  const headers = new Headers({ 'Content-Type': 'application/json' });
  if (authHeader !== null) {
    headers.set('Authorization', authHeader);
  }
  return new Request('https://example.com/functions/v1/branding-asset-upload-url', {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

Deno.test({
  name: 'E1: missing Authorization header → 401 missing_jwt',
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const req = makeRequest({ authHeader: null, body: { org_id: ORG_X, kind: 'logo', ext: 'png' } });
    const res = await handler(req, ownerXDeps);
    assertEquals(res.status, 401);
    const json = await res.json();
    assertEquals(json.error, 'missing_jwt');
  },
});

Deno.test({
  name: 'E2: valid JWT + owner of orgX + valid body → 200 with upload_url and token',
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const req = makeRequest({ body: { org_id: ORG_X, kind: 'logo', ext: 'png' } });
    const res = await handler(req, ownerXDeps);
    assertEquals(res.status, 200);
    const json = await res.json();
    // Must have upload_url, token, path, bucket
    assertEquals(typeof json.upload_url, 'string');
    assertEquals(typeof json.token, 'string');
    assertEquals(json.path, `${ORG_X}/logo.png`);
    assertEquals(json.bucket, 'org-branding');
  },
});

Deno.test({
  name: 'E3: valid JWT for orgX but targeting orgY → 403 insufficient_privilege',
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const req = makeRequest({ body: { org_id: ORG_Y, kind: 'logo', ext: 'png' } });
    const res = await handler(req, crossTenantDeps);
    assertEquals(res.status, 403);
    const json = await res.json();
    assertEquals(json.error, 'insufficient_privilege');
  },
});

Deno.test({
  name: 'E4: invalid kind (banner) → 400 invalid_kind',
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const req = makeRequest({ body: { org_id: ORG_X, kind: 'banner', ext: 'png' } });
    const res = await handler(req, ownerXDeps);
    assertEquals(res.status, 400);
    const json = await res.json();
    assertEquals(json.error, 'invalid_kind');
  },
});

Deno.test({
  name: 'E5: invalid ext (gif) for org-branding kind → 400 invalid_ext',
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const req = makeRequest({ body: { org_id: ORG_X, kind: 'logo', ext: 'gif' } });
    const res = await handler(req, ownerXDeps);
    assertEquals(res.status, 400);
    const json = await res.json();
    assertEquals(json.error, 'invalid_ext');
  },
});

Deno.test({
  name: 'E5b: gif also rejected for favicon',
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const req = makeRequest({ body: { org_id: ORG_X, kind: 'favicon', ext: 'gif' } });
    const res = await handler(req, ownerXDeps);
    assertEquals(res.status, 400);
    const json = await res.json();
    assertEquals(json.error, 'invalid_ext');
  },
});

Deno.test({
  name: 'E5c: svg rejected for intro_card (org-onboarding-assets)',
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const req = makeRequest({ body: { org_id: ORG_X, kind: 'intro_card', ext: 'svg' } });
    const res = await handler(req, ownerXDeps);
    assertEquals(res.status, 400);
    const json = await res.json();
    assertEquals(json.error, 'invalid_ext');
  },
});

Deno.test({
  name: 'E2b: intro_card uses org-onboarding-assets bucket',
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const req = makeRequest({ body: { org_id: ORG_X, kind: 'intro_card', ext: 'png' } });
    const res = await handler(req, ownerXDeps);
    assertEquals(res.status, 200);
    const json = await res.json();
    assertEquals(json.bucket, 'org-onboarding-assets');
    assertEquals(json.path, `${ORG_X}/intro_card.png`);
  },
});
