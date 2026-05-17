/**
 * THIS FILE IS THE ONLY PLACE allowed to construct a service-role client.
 * Enforced by eslint-rules/no-raw-service-role-client.cjs.
 *
 * @internal Edge Function / Deno runtime only. Do not import from src/ (browser bundle).
 *
 * Phase 28 Plan 28-02 D-05 — brand types for service-role client.
 * ADDENDUM A7: paths live under supabase/functions/_shared/ (not src/server/).
 * ADDENDUM A7: uses Deno.env.get (not process.env) — Deno / Edge Function runtime.
 */

// deno-lint-ignore-file no-explicit-any
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';

// ---------------------------------------------------------------------------
// Brand-type discriminant
// ---------------------------------------------------------------------------

declare const __OrgScope: unique symbol;

/**
 * Branded service-role client type.
 *
 * S = 'Unscoped':  .from() is typed `never` — callers cannot reach table data
 *                  without going through withOrgScope().
 * S = 'OrgScoped': .from() and .rpc() are fully typed — safe to call after the
 *                  Proxy has verified the org_id filter.
 *
 * .rpc() is always callable on both variants (per CONTEXT D-07 + Pitfall 6) because
 * SECDEF function bodies are the enforcement gate for RPC calls, not this Proxy.
 */
export type ServiceRoleClient<S extends 'OrgScoped' | 'Unscoped'> =
  Omit<SupabaseClient, 'from' | 'rpc'> & {
    readonly [__OrgScope]: S;
  } & (S extends 'OrgScoped'
    ? { from: SupabaseClient['from']; rpc: SupabaseClient['rpc'] }
    : { from: never; rpc: SupabaseClient['rpc'] });

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a service-role Supabase client with an intentionally scary name.
 *
 * Returns `ServiceRoleClient<'Unscoped'>` — a branded type whose `.from()`
 * method is typed `never`. The only safe way to call `.from(table)` is via
 * `withOrgScope(orgId, fn)` in with-org-scope.ts, which returns a
 * `ServiceRoleClient<'OrgScoped'>` with `.from()` fully exposed.
 *
 * Throws if SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars are missing
 * (fail-loud per ADDENDUM A7 — service-role client must never silently
 * degrade to anon access).
 */
export function _createServiceRoleClientUnsafe(): ServiceRoleClient<'Unscoped'> {
  const url = Deno.env.get('SUPABASE_URL');
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

  if (!url) throw new Error('[supabase-server] SUPABASE_URL env var is missing — cannot create service-role client.');
  if (!key) throw new Error('[supabase-server] SUPABASE_SERVICE_ROLE_KEY env var is missing — cannot create service-role client.');

  const client = createClient(url, key, {
    auth: { persistSession: false },
  });

  // Cast through unknown to attach the brand type.
  // The Proxy in withOrgScope re-exposes .from() for org-scoped callers.
  return client as unknown as ServiceRoleClient<'Unscoped'>;
}
