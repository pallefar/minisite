/**
 * Shared utilities for lifecycle Edge Functions — Phase 22 plan 22-02.
 *
 * Extracts the lazy admin singleton + Proxy pattern from
 * `affiliate-payout/index.ts` lines 41-88 (W-2/test-injectable) and the
 * CORS + bearer-compare from `clinic-invite/index.ts` so each lifecycle
 * function stays thin.
 *
 * Each lifecycle function imports `makeLazyAdmin`, `getCorsHeaders`,
 * `jsonResponse`, `jsonError`, `constantTimeEqual`, `bearerFromReq`.
 *
 * The `makeLazyAdmin()` factory returns BOTH a Proxy `admin` (for runtime
 * use) AND a `setAdminForTest(client)` hook so per-function index.test.ts
 * can stub the supabase client after module import.
 */
import { createClient } from 'npm:@supabase/supabase-js@2';
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

export const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
};

export function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

export function jsonError(status: number, code: string): Response {
  return jsonResponse(status, { error: code });
}

/** Constant-time string compare — same length AND same bytes. */
export function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

export function bearerFromReq(req: Request): string | null {
  const h = req.headers.get('Authorization') ?? '';
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? (m[1] ?? null) : null;
}

export interface LazyAdminHandle {
  admin: SupabaseClient;
  setAdminForTest(client: unknown): void;
  resetAdminForTest(): void;
}

/**
 * Build a lazy admin singleton + Proxy. The Proxy reads the underlying
 * instance lazily so `setAdminForTest` works AFTER module import (the
 * Deno test suite sets env vars after `import './index.ts'`).
 */
export function makeLazyAdmin(): LazyAdminHandle {
  let _adminInstance: SupabaseClient | null = null;
  const getAdmin = (): SupabaseClient => {
    if (_adminInstance === null) {
      const url = Deno.env.get('SUPABASE_URL') ?? '';
      const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
      _adminInstance = createClient(url, key, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
    }
    return _adminInstance;
  };
  const admin = new Proxy({} as Record<string | symbol, unknown>, {
    get(_t, prop: string | symbol): unknown {
      const a = getAdmin() as unknown as Record<string | symbol, unknown>;
      const val = a[prop];
      return typeof val === 'function' ? (val as (...args: unknown[]) => unknown).bind(a) : val;
    },
  }) as unknown as SupabaseClient;
  return {
    admin,
    setAdminForTest(client) {
      _adminInstance = client as SupabaseClient;
    },
    resetAdminForTest() {
      _adminInstance = null;
    },
  };
}

/** Validate bearer matches SUPABASE_SERVICE_ROLE_KEY (cron-invoked fns). */
export function checkServiceRoleBearer(req: Request): boolean {
  const bearer = bearerFromReq(req);
  const expected = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!bearer || !expected) return false;
  return constantTimeEqual(bearer, expected);
}
