/**
 * Phase 22 Plan 22-09 — useImpersonation hook (ADMIN-03).
 *
 * Reads `app_metadata.impersonator_id` + `impersonation_exp` from the current
 * supabase session. Per A1 PROBE PASS (336ms — see 22-A1-PROBE.md), the
 * primary branch reads claims from `session.user.app_metadata` directly;
 * supabase-js auto-decodes the JWT into `user.app_metadata` on session creation.
 *
 * A FALLBACK branch decodes the access_token JWT payload manually as a defense
 * if `session.user.app_metadata` were ever missing the claim (e.g., a future
 * supabase-js version that lazy-loads metadata). The fallback is essentially
 * dead code today but is cheap insurance.
 *
 * `secondsRemaining` recomputes every 1s via setInterval. When it reaches 0,
 * the hook fires `endImpersonation()` automatically (and surfaces the toast
 * via the banner — see ImpersonationBanner).
 */

import type { Session } from '@supabase/supabase-js';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { endImpersonation as endImpersonationApi } from '@/lib/admin/admin-impersonate';
import { supabase } from '@/lib/supabase';

interface ImpersonationClaims {
  impersonator_id: string | null;
  impersonation_exp: number | null;
  target_email: string | null;
  target_user_id: string | null;
}

function readClaimsFromSession(session: Session | null): ImpersonationClaims {
  if (!session) {
    return {
      impersonator_id: null,
      impersonation_exp: null,
      target_email: null,
      target_user_id: null,
    };
  }

  // PRIMARY (A1 PROBE PASS): supabase-js decodes app_metadata onto user.
  const meta = session.user?.app_metadata as
    | { impersonator_id?: string | null; impersonation_exp?: number | null }
    | undefined;
  let impersonator_id: string | null = meta?.impersonator_id ?? null;
  let impersonation_exp: number | null =
    typeof meta?.impersonation_exp === 'number' ? meta.impersonation_exp : null;

  // FALLBACK (A1 FAIL — defensive only): decode JWT payload manually.
  if (impersonator_id === null && session.access_token) {
    try {
      const [, payloadB64] = session.access_token.split('.');
      if (payloadB64) {
        // base64url → base64
        const b64 = payloadB64.replace(/-/g, '+').replace(/_/g, '/');
        const padded = b64.padEnd(b64.length + ((4 - (b64.length % 4)) % 4), '=');
        const json = atob(padded);
        const payload = JSON.parse(json) as {
          app_metadata?: { impersonator_id?: string; impersonation_exp?: number };
        };
        const fmeta = payload?.app_metadata;
        if (fmeta?.impersonator_id) {
          impersonator_id = fmeta.impersonator_id;
          impersonation_exp =
            typeof fmeta.impersonation_exp === 'number' ? fmeta.impersonation_exp : null;
        }
      }
    } catch {
      /* malformed JWT — fall through with nulls. */
    }
  }

  return {
    impersonator_id,
    impersonation_exp,
    target_email: session.user?.email ?? null,
    target_user_id: session.user?.id ?? null,
  };
}

export interface UseImpersonationResult {
  active: boolean;
  impersonatorId: string | null;
  targetEmail: string | null;
  targetUserId: string | null;
  secondsRemaining: number;
  endImpersonation: () => Promise<void>;
}

export function useImpersonation(): UseImpersonationResult {
  const [session, setSession] = useState<Session | null>(null);
  const [now, setNow] = useState<number>(() => Date.now());

  // Subscribe to auth state once. Initial load comes from getSession; subsequent
  // updates flow through onAuthStateChange (covers token refresh + signOut).
  useEffect(() => {
    let mounted = true;
    void supabase.auth.getSession().then(({ data }) => {
      if (mounted) setSession(data.session);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
    });
    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  const claims = useMemo(() => readClaimsFromSession(session), [session]);

  // Recompute every 1s when impersonation is potentially active. Skip the
  // interval when there's no claim — saves render churn for the 99% case.
  const hasClaim = claims.impersonator_id !== null && claims.impersonation_exp !== null;
  useEffect(() => {
    if (!hasClaim) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [hasClaim]);

  const secondsRemaining = useMemo(() => {
    if (claims.impersonation_exp === null) return 0;
    return Math.max(0, Math.floor((claims.impersonation_exp - now) / 1000));
  }, [claims.impersonation_exp, now]);

  const active = Boolean(claims.impersonator_id && secondsRemaining > 0);

  // Stable endImpersonation ref. Memoize on targetUserId so identity is stable
  // while impersonating the same user (avoids re-firing auto-expire effects).
  const targetUserId = claims.target_user_id;
  const endImpersonationCb = useCallback(async () => {
    if (!targetUserId) return;
    await endImpersonationApi({ targetUserId });
  }, [targetUserId]);

  // Auto-expire: when claim exists AND secondsRemaining hits 0 AND we previously
  // had > 0, fire endImpersonation once. The `firedRef` prevents re-firing if
  // the session takes a tick to update after the call.
  const firedRef = useRef(false);
  useEffect(() => {
    if (!hasClaim) {
      firedRef.current = false;
      return;
    }
    if (secondsRemaining === 0 && !firedRef.current) {
      firedRef.current = true;
      void endImpersonationCb();
    }
  }, [hasClaim, secondsRemaining, endImpersonationCb]);

  return {
    active,
    impersonatorId: claims.impersonator_id,
    targetEmail: claims.target_email,
    targetUserId: claims.target_user_id,
    secondsRemaining,
    endImpersonation: endImpersonationCb,
  };
}
