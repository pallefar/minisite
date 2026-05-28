/**
 * Phase 22 Plan 22-09 — admin-impersonate Edge Function client wrapper.
 *
 * A1 PROBE verdict: PASS (336ms latency, see 22-A1-PROBE.md)
 *   → claims read from `session.user.app_metadata.impersonator_id` + `impersonation_exp`.
 *   No Custom Access Token Hook needed; no Vault `IMPERSONATION_JWT_SIGNING_KEY` needed.
 *
 * Security footgun (T-22-52 / [accept-and-document]):
 *   `startImpersonation()` stores the ADMIN's refresh_token in `sessionStorage` under
 *   `impersonation_admin_refresh` BEFORE swapping the supabase session to the target.
 *   This is the recovery key that lets `endImpersonation()` restore the admin's own
 *   session afterwards. The risk model:
 *     - XSS exposure window: limited by Phase 12 SPA CSP + 30-min impersonation TTL.
 *     - Bearer-token replay if leaked: same risk as any active session; admin can
 *       revoke via `admin.deleteUser` or sign-out-all-sessions if compromise suspected.
 *     - Cleared on `endImpersonation()` success (and on auto-expire via the banner).
 *   `sessionStorage` (not `localStorage`) so the token is scoped to the tab and
 *   wiped on tab-close — minimizing post-task lifetime.
 *
 * Idempotent end-impersonation: the Edge Function (22-03) already no-ops when
 * `app_metadata.impersonator_id` is null (no `updateUserById`, no audit row).
 */

import { supabase } from '@/lib/supabase';

/** Discriminated error codes returned by the admin-impersonate Edge Function. */
export type ImpersonationErrorCode =
  | 'not_staff'
  | 'invalid_target'
  | 'session_expired'
  | 'cannot_impersonate_self'
  | 'cannot_impersonate_admin'
  | 'unknown';

export class ImpersonationError extends Error {
  code: ImpersonationErrorCode;
  constructor(code: ImpersonationErrorCode, options?: { cause?: unknown }) {
    super(`impersonation:${code}`, options);
    this.name = 'ImpersonationError';
    this.code = code;
  }
}

/** Key for the admin's refresh_token stash during an impersonation session. */
export const ADMIN_REFRESH_STORAGE_KEY = 'impersonation_admin_refresh';

interface EdgeFnError {
  code?: string;
  error?: string;
  message?: string;
}

function mapEdgeFnError(e: EdgeFnError | undefined): ImpersonationError {
  const code = (e?.error ?? e?.code ?? '').toString();
  switch (code) {
    case 'not_staff':
      return new ImpersonationError('not_staff', { cause: e });
    case 'invalid_target_user_id':
    case 'invalid_target':
      return new ImpersonationError('invalid_target', { cause: e });
    case 'session_expired':
      return new ImpersonationError('session_expired', { cause: e });
    case 'cannot_impersonate_self':
      return new ImpersonationError('cannot_impersonate_self', { cause: e });
    case 'cannot_impersonate_admin':
      return new ImpersonationError('cannot_impersonate_admin', { cause: e });
    default:
      return new ImpersonationError('unknown', { cause: e });
  }
}

interface StartResponse {
  /** Magic-link URL returned by `admin.auth.admin.generateLink({type:'magiclink'})`. */
  action_link: string;
  /** Server-stamped expiry (ms epoch) — also encoded as `impersonation_exp` in JWT. */
  expires_at: number;
}

interface ImpersonationStartArgs {
  targetUserId: string;
}

/**
 * Begin impersonation: caches the admin's refresh_token in sessionStorage, calls
 * the admin-impersonate Edge Fn, swaps the supabase session to the target by
 * extracting access_token + refresh_token from the magic-link's URL fragment.
 *
 * After this resolves, `useImpersonation()` will read `active === true` from the
 * NEW session's `app_metadata.impersonator_id` claim (A1 PROBE PASS contract).
 */
export async function startImpersonation({
  targetUserId,
}: ImpersonationStartArgs): Promise<StartResponse> {
  // Stash admin refresh token BEFORE the session swap so endImpersonation can restore it.
  const { data: sessionData } = await supabase.auth.getSession();
  const adminRefresh = sessionData?.session?.refresh_token;
  if (adminRefresh) {
    try {
      sessionStorage.setItem(ADMIN_REFRESH_STORAGE_KEY, adminRefresh);
    } catch {
      /* private-mode browsers — fail-soft; endImpersonation falls through to signOut. */
    }
  }

  const { data, error } = await supabase.functions.invoke<{
    action_link: string;
    expires_at: number;
    error?: string;
    code?: string;
  }>('admin-impersonate', {
    body: { action: 'start', target_user_id: targetUserId },
  });

  if (error || !data || data.error) {
    throw mapEdgeFnError((error as EdgeFnError) ?? data);
  }

  // Extract access_token + refresh_token from the action_link's URL fragment.
  // Magic-link format: https://.../callback#access_token=...&refresh_token=...&expires_in=...&token_type=bearer&type=magiclink
  const hashIdx = data.action_link.indexOf('#');
  if (hashIdx === -1) {
    throw new ImpersonationError('unknown', {
      cause: new Error('action_link missing URL fragment'),
    });
  }
  const fragment = data.action_link.slice(hashIdx + 1);
  const params = new URLSearchParams(fragment);
  const accessToken = params.get('access_token');
  const refreshToken = params.get('refresh_token');
  if (!accessToken || !refreshToken) {
    throw new ImpersonationError('unknown', {
      cause: new Error('action_link missing access_token or refresh_token'),
    });
  }

  const setRes = await supabase.auth.setSession({
    access_token: accessToken,
    refresh_token: refreshToken,
  });
  if (setRes.error) {
    throw new ImpersonationError('unknown', { cause: setRes.error });
  }

  return { action_link: data.action_link, expires_at: data.expires_at };
}

interface ImpersonationEndArgs {
  targetUserId: string;
}

/**
 * End impersonation: invokes the Edge Fn (which clears
 * `app_metadata.impersonator_id` via service-role admin.updateUserById), then
 * restores the admin's own session from the sessionStorage stash.
 *
 * Idempotent at the Edge Fn layer — safe to call even if no impersonation is active.
 */
export async function endImpersonation({ targetUserId }: ImpersonationEndArgs): Promise<void> {
  const { data, error } = await supabase.functions.invoke<{
    ok?: boolean;
    error?: string;
    code?: string;
  }>('admin-impersonate', {
    body: { action: 'end', target_user_id: targetUserId },
  });

  if (error || data?.error) {
    throw mapEdgeFnError((error as EdgeFnError) ?? data);
  }

  // Restore admin session from sessionStorage stash.
  let adminRefresh: string | null = null;
  try {
    adminRefresh = sessionStorage.getItem(ADMIN_REFRESH_STORAGE_KEY);
  } catch {
    /* private-mode — fall through to signOut. */
  }

  if (adminRefresh) {
    const refreshRes = await supabase.auth.refreshSession({ refresh_token: adminRefresh });
    try {
      sessionStorage.removeItem(ADMIN_REFRESH_STORAGE_KEY);
    } catch {
      /* noop */
    }
    if (refreshRes.error) {
      // Refresh failed — fall back to signOut so the impersonated session doesn't linger.
      await supabase.auth.signOut();
      throw new ImpersonationError('session_expired', { cause: refreshRes.error });
    }
  } else {
    // No stash — sign out cleanly so we don't leave the impersonated session active.
    await supabase.auth.signOut();
  }
}
