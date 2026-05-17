/**
 * withOrgScope — 4-layer org_id defense (Phase 28 Plan 28-02 D-04..D-08).
 *
 * @internal Edge Function / Deno runtime only. Do not import from src/ (browser bundle).
 *
 * Layer summary:
 *   1. Brand types      — _createServiceRoleClientUnsafe() returns ServiceRoleClient<'Unscoped'>
 *                         whose .from() is typed `never` (compile-time block).
 *   2. ESLint rule      — no-raw-service-role-client.cjs blocks raw createClient(..., SERVICE_ROLE_KEY)
 *                         outside supabase-server.ts (build-time block).
 *   3. Runtime Proxy    — withOrgScope() wraps the client in a Proxy that asserts
 *                         .eq('org_id', orgId) was applied before .then() resolves
 *                         for any table in ORG_SCOPED_TABLES (request-time block).
 *   4. Sentry alert     — OrgScopeBypassError triggers a fatal Sentry capture
 *                         (post-incident observability).
 *
 * CONTEXT D-07 + Pitfall 6: .rpc() is NOT policed by this Proxy. SECDEF function
 * bodies are the enforcement gate for RPC calls (Pattern S1). The Proxy intercepts
 * .from(table) only for tables in ORG_SCOPED_TABLES.
 *
 * Downstream phases extend ORG_SCOPED_TABLES per 28-EXTENSION-CONTRACT.md D-29.
 * Plan-checker BLOCKER: any new org-scoped migration without updating this const fails.
 */

import { type ServiceRoleClient, _createServiceRoleClientUnsafe } from './supabase-server.ts';
import * as Sentry from './sentry.ts';

// ---------------------------------------------------------------------------
// Allowlist of org-scoped tables (D-08)
// ---------------------------------------------------------------------------

/**
 * Tables that must always be filtered by org_id when accessed via service-role client.
 *
 * Downstream phases (P29, P30, P31, P40) MUST add their org-scoped tables here
 * when shipping new migrations. See 28-EXTENSION-CONTRACT.md for the checklist.
 *
 * Plan-checker BLOCKER: any `*-rls.test.ts` whose target table is missing from
 * this set will fail the plan-checker validation step.
 */
export const ORG_SCOPED_TABLES = new Set<string>([
  'organizations',
  'org_members',
  'org_invites',
  'org_subscriptions',
  'org_settings',
  'org_branding',
  'org_patient_links',
  'org_consent_grants',
  // Downstream phases extend this per 28-EXTENSION-CONTRACT.md D-29
]);

// ---------------------------------------------------------------------------
// Error class
// ---------------------------------------------------------------------------

/**
 * Thrown when a service-role query on an org-scoped table resolves without
 * an .eq('org_id', orgId) (or .in / .contains equivalent) filter.
 *
 * Also triggers a Sentry fatal-level capture with tag org_scope_bypass='true'.
 */
export class OrgScopeBypassError extends Error {
  constructor(
    public readonly table: string,
    public readonly orgId: string,
  ) {
    super(
      `[withOrgScope] Bypass detected: query on table '${table}' did not include ` +
        `.eq('org_id', '${orgId}') or equivalent. ` +
        `This is a multi-tenant data leak (V13-2a). Sentry fatal alert raised.`,
    );
    this.name = 'OrgScopeBypassError';
  }
}

// ---------------------------------------------------------------------------
// Internal filter-call tracker type
// ---------------------------------------------------------------------------

interface FilterCall {
  method: string;
  col: string;
  val: unknown;
}

// ---------------------------------------------------------------------------
// Internal builder Proxy factory
// ---------------------------------------------------------------------------

/**
 * Wrap a PostgrestQueryBuilder in a recursive Proxy that:
 *   1. Tracks .eq / .in / .contains filter calls (records col + val).
 *   2. At .then() resolution, asserts that an org_id filter for orgId is present.
 *   3. On missing filter: throws OrgScopeBypassError + emits Sentry fatal alert.
 *   4. Re-wraps ALL returned objects so chaining stays tracked.
 *
 * @param builder  The raw PostgrestQueryBuilder returned by supabase.from(table).
 * @param table    The table name (used in OrgScopeBypassError message + ORG_SCOPED_TABLES check).
 * @param orgId    The org_id that MUST appear in a filter call.
 */
function wrapBuilder(builder: unknown, table: string, orgId: string): unknown {
  const filterCalls: FilterCall[] = [];

  const handler: ProxyHandler<object> = {
    get(target, prop, recv) {
      const original = Reflect.get(target, prop, recv);

      if (typeof prop !== 'string') return original;

      // Track filter methods: .eq, .in, .contains
      if (prop === 'eq' || prop === 'in' || prop === 'contains') {
        if (typeof original === 'function') {
          return (...args: unknown[]) => {
            filterCalls.push({
              method: prop,
              col: args[0] as string,
              val: args[1],
            });
            const ret = (original as (...a: unknown[]) => unknown).apply(target, args);
            // Re-wrap chained return so subsequent calls are still tracked
            if (ret !== null && typeof ret === 'object') {
              return new Proxy(ret as object, handler);
            }
            return ret;
          };
        }
      }

      // Intercept .then() — PostgrestBuilder is a Promise-like (thenable)
      if (prop === 'then') {
        if (typeof original === 'function') {
          return (
            resolve?: ((v: unknown) => unknown) | null,
            reject?: ((e: unknown) => unknown) | null,
          ) => {
            const hasOrgScope = filterCalls.some((c) => {
              if (c.method === 'eq' && c.col === 'org_id' && c.val === orgId) {
                return true;
              }
              if (
                c.method === 'in' &&
                c.col === 'org_id' &&
                Array.isArray(c.val) &&
                (c.val as unknown[]).includes(orgId)
              ) {
                return true;
              }
              if (
                c.method === 'contains' &&
                c.col === 'org_ids' &&
                Array.isArray(c.val) &&
                (c.val as unknown[]).includes(orgId)
              ) {
                return true;
              }
              return false;
            });

            if (!hasOrgScope) {
              const err = new OrgScopeBypassError(table, orgId);
              // Layer 4: Sentry fatal alert (post-incident observability)
              Sentry.captureException(err, {
                level: 'fatal',
                tags: { org_scope_bypass: 'true' },
              });
              return Promise.reject(err).then(resolve ?? undefined, reject ?? undefined);
            }

            // Filter is present and correct — delegate to the real .then()
            return (original as (...a: unknown[]) => unknown).call(
              target,
              resolve ?? undefined,
              reject ?? undefined,
            ) as Promise<unknown>;
          };
        }
      }

      // For all other methods: re-wrap return value to preserve tracking through chain
      if (typeof original === 'function') {
        return (...args: unknown[]) => {
          const ret = (original as (...a: unknown[]) => unknown).apply(target, args);
          if (ret !== null && typeof ret === 'object') {
            return new Proxy(ret as object, handler);
          }
          return ret;
        };
      }

      return original;
    },
  };

  return new Proxy(builder as object, handler);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Execute `fn` with a service-role Supabase client that is Proxied to assert
 * org_id scoping on every org-scoped table query.
 *
 * Usage:
 * ```ts
 * const result = await withOrgScope(orgId, async (c) => {
 *   const { data, error } = await c
 *     .from('org_members')
 *     .select('*')
 *     .eq('org_id', orgId);   // REQUIRED — Proxy asserts this
 *   return data;
 * });
 * ```
 *
 * If fn calls c.from('org_members').select() without .eq('org_id', orgId),
 * the Proxy throws OrgScopeBypassError and emits a Sentry fatal alert.
 *
 * Non-org-scoped tables (tables NOT in ORG_SCOPED_TABLES) pass through
 * without interception — the Proxy only guards org-scoped data.
 *
 * .rpc() is NOT intercepted (per CONTEXT D-07 + Pitfall 6). SECDEF function
 * bodies are responsible for their own role / org_id checks.
 *
 * @param orgId  The org_id that MUST appear in every org-scoped table filter.
 * @param fn     Async function receiving the org-scoped client.
 * @returns      The resolved value of fn.
 * @throws       OrgScopeBypassError if an org-scoped table query lacks org_id filter.
 * @throws       Error if orgId is falsy.
 */
export async function withOrgScope<T>(
  orgId: string,
  fn: (client: ServiceRoleClient<'OrgScoped'>) => Promise<T>,
): Promise<T> {
  if (!orgId) throw new Error('[withOrgScope] orgId is required');

  const raw = _createServiceRoleClientUnsafe();

  // Layer 3: Runtime Proxy — intercept .from(table) for ORG_SCOPED_TABLES
  const proxiedClient = new Proxy(raw as unknown as object, {
    get(target, prop, recv) {
      if (prop === 'from') {
        return (table: string) => {
          const builder = (target as Record<string, unknown>)['from'];
          if (typeof builder !== 'function') {
            throw new Error('[withOrgScope] Internal: .from is not a function on target');
          }
          const queryBuilder = (builder as (t: string) => unknown).call(target, table);
          // Only intercept org-scoped tables
          if (!ORG_SCOPED_TABLES.has(table)) return queryBuilder;
          return wrapBuilder(queryBuilder, table, orgId);
        };
      }
      return Reflect.get(target, prop, recv);
    },
  });

  // Pass the branded proxied client to the user fn.
  // Cast via `as unknown as ServiceRoleClient<'OrgScoped'>` — safe because:
  //   a) The Proxy re-exposes .from() with org_id enforcement.
  //   b) .rpc() and all other methods pass through via Reflect.get.
  return fn(proxiedClient as unknown as ServiceRoleClient<'OrgScoped'>);
}
