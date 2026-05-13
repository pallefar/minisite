/**
 * Phase 9 Plan 09-03 — useHasPermission hook + session-scoped permission cache.
 *
 * This hook is a UX-affordance helper. **The server (RLS + SECURITY DEFINER
 * RPC gates from Plan 09-01's `has_permission()` dispatcher) is the
 * security floor.** Use this hook to disable / hide buttons the current
 * user can't actually use; never to authorize a destructive action. Every
 * write path on the server re-checks via `has_permission(uid, org, key)`
 * inside the RPC body, so a stale or tampered cache cannot grant access.
 *
 * Cache shape: a module-level `Map<string, boolean>` keyed on
 * `${orgId}:${permissionKey}`. Cleared on:
 *   - Sign-out (wired into `useStore.signOut` action — see store.ts).
 *   - Explicit caller request via `clearPermissionCache()` (e.g., after a
 *     self-role-change so the user's affordance UI re-fetches).
 *
 * Pitfall #9 mitigation (RESEARCH.md): when `orgId` is null we return null
 * without firing any network call, avoiding the empty-list flash on
 * cold-load before the active org slice has resolved.
 */
import { useEffect, useState } from 'react';
import { supabase } from './supabase';
import type { PermissionKey } from '@/types/clinic';

const cache = new Map<string, boolean>();

/**
 * Reset the in-memory permission cache. Call from:
 *   - Sign-out path (so the next signed-in user does not inherit cached
 *     decisions made under the prior auth.uid()).
 *   - After any UI flow that may change the current user's permissions
 *     (e.g., the user's own role was changed by another operator and the
 *     Realtime broadcast trigger has fired).
 */
export function clearPermissionCache(): void {
  cache.clear();
}

/**
 * Returns the user's `has_permission` value for the (orgId, permissionKey)
 * pair, or null while the RPC is in-flight.
 *
 * Tri-state semantics:
 *   - `null`  → in-flight OR orgId not yet known. Callers should treat this
 *               as "not yet known"; defer affordance decisions.
 *   - `true`  → user has the permission per the cached server decision.
 *   - `false` → user does NOT have the permission OR the RPC errored.
 *               (Error coerces to false because this hook is a UX hint
 *               only; the server gate will produce the actionable error.)
 *
 * The RPC dispatches through Plan 09-01's STABLE `has_permission` function;
 * Postgres-side STABLE marking + the client cache here together keep the
 * effective network cost at ≤1 RPC per (orgId, permKey) per session.
 */
export function useHasPermission(
  orgId: string | null,
  permissionKey: PermissionKey,
): boolean | null {
  const [value, setValue] = useState<boolean | null>(() => {
    if (!orgId) return null;
    const cached = cache.get(`${orgId}:${permissionKey}`);
    return cached === undefined ? null : cached;
  });

  useEffect(() => {
    if (!orgId) {
      setValue(null);
      return;
    }
    const key = `${orgId}:${permissionKey}`;
    const cached = cache.get(key);
    if (cached !== undefined) {
      setValue(cached);
      return;
    }
    let cancelled = false;
    void (async () => {
      const { data: userData } = await supabase.auth.getUser();
      if (cancelled) return;
      const user = userData?.user;
      if (!user) {
        setValue(false);
        return;
      }
      const { data, error } = await supabase.rpc('has_permission', {
        p_user_id: user.id,
        p_org_id: orgId,
        p_permission_key: permissionKey,
      });
      if (cancelled) return;
      const result = error ? false : Boolean(data);
      cache.set(key, result);
      setValue(result);
    })();
    return () => {
      cancelled = true;
    };
  }, [orgId, permissionKey]);

  return value;
}
