/**
 * Phase 34 Plan 34-04 Task 2 (ONBOARD-02) — PKCE OAuth callback view.
 *
 * Mounted by App.tsx selectView() when window.location.pathname is
 * '/auth/callback' (PATH-routed, NOT hash — PKCE arrives as `?code=...`
 * query on a path URL because OAuth providers cannot redirect to `#`
 * fragments; see 34-RESEARCH Pitfall 1).
 *
 * Flow:
 *   1. exchangeCodeForSession(window.location.href) — supabase-js validates
 *      the OAuth code against GoTrue and mints a session.
 *   2. On success: read profiles.completed_onboarding_at; route to
 *      '/#/dashboard' if populated, else '/#/onboarding'.
 *   3. On error: route to '/#/auth/error' (existing hash surface).
 *
 * Magic-link's hash flow (#/auth/verify) is unaffected — main.tsx's
 * implicit-grant double-`#` fix (lines 51-69) handles that path only.
 */
import { useEffect, useState } from 'react';
import { mergeAnonSession } from '@/lib/onboarding/anon-merge';
import { supabase } from '@/lib/supabase';

export default function AuthCallbackView() {
  const [status, setStatus] = useState<'exchanging' | 'redirecting' | 'error'>('exchanging');

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const { data, error } = await supabase.auth.exchangeCodeForSession(window.location.href);
        if (cancelled) return;
        if (error || !data?.session?.user) {
          setStatus('error');
          window.location.replace('/#/auth/error');
          return;
        }
        const { data: prof } = await supabase
          .from('profiles')
          .select('completed_onboarding_at')
          .eq('id', data.session.user.id)
          .maybeSingle();
        if (cancelled) return;

        // Best-effort anon→authenticated merge (T-59-09: failure must never
        // block the redirect; wrapper swallows any rejection).
        try {
          await mergeAnonSession({ accessToken: data.session.access_token });
        } catch {
          // Intentionally swallowed — redirect always proceeds.
        }

        setStatus('redirecting');
        if (prof?.completed_onboarding_at) {
          window.location.replace('/#/dashboard');
        } else {
          window.location.replace('/#/onboarding');
        }
      } catch {
        if (cancelled) return;
        setStatus('error');
        window.location.replace('/#/auth/error');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div
      role="status"
      aria-live="polite"
      className="min-h-screen flex items-center justify-center bg-[var(--color-bg)]"
    >
      <div className="text-center">
        <div
          aria-hidden
          className="size-10 mx-auto mb-4 rounded-full border-2 border-[var(--color-primary)] border-t-transparent animate-spin"
        />
        <p className="text-[var(--color-text-muted)] text-sm">
          {status === 'error' ? 'Sign-in failed — redirecting…' : 'Signing you in…'}
        </p>
      </div>
    </div>
  );
}
