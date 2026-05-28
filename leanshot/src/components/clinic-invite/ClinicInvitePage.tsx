/**
 * Phase 9 Plan 09-04 — ClinicInvitePage state-machine router.
 *
 * Overwrites the Plan 09-01 stub. App.tsx routing remains unchanged (B-2:
 * Plan 09-01 already wired the lazy import + `clinic-invite` selectView
 * branch — DO NOT edit App.tsx in this plan).
 *
 * State machine (UI-SPEC §"Patient-side: Clinic invitation landing page"):
 *
 *   State A — Loading              ("Opening invitation…" + Skeleton)
 *   State B — valid_logged_in      → <ConsentDialog mode="existing"/>
 *   State C — valid_logged_out     → magic-link sign-in prompt
 *   State D — valid_new_user       → <InviteSignupForm/>
 *   State E — expired              ("This invitation has expired" + Close)
 *   State F — already_used         ("…already been used" + Done)
 *   State G — canceled             ("…has been canceled" + Close)
 *   State H — load_error           (generic + Refresh)
 *
 * Invariants:
 *
 *   1. **Pitfall #9 anonymous-context rule** — ZERO `useStore` calls in
 *      this file or anywhere under `src/components/clinic-invite/`. The
 *      browser may be unauthenticated when this page first mounts; the
 *      Edge Function lookup response carries all rendering data.
 *
 *   2. **No `s.user!`** — project anti-pattern, never reintroduced.
 *
 *   3. **No App.tsx edits** — Plan 09-01 owns the lazy import + the
 *      `clinic-invite` selectView branch. The CI assertion
 *      `git diff HEAD~1 -- src/App.tsx | wc -l == 0` is the regression
 *      guard.
 *
 *   4. **Return-from-email-link round trip** — the page subscribes to
 *      `supabase.auth.onAuthStateChange` so a fresh `SIGNED_IN` event
 *      after the patient clicks the verification link re-fires the
 *      lookup and resolves to State B without a manual reload. The
 *      callback only triggers a refetch on `SIGNED_IN` (not
 *      `INITIAL_SESSION`) so cold mounts don't double-fetch.
 */
import { Check, Clock, XCircle } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Skeleton } from '@/components/ui/Skeleton';
import { supabase } from '@/lib/supabase';
import { ConsentDialog } from './ConsentDialog';
import { InviteSignupForm } from './InviteSignupForm';

/* eslint-disable @typescript-eslint/no-explicit-any */
type LookupInvite = {
  id: string;
  email: string;
  requested_scope: any; // loose at the boundary — ConsentDialog W-5 coerces
  org: { id: string; name: string; logo_storage_path: string | null };
  operator_first_name: string;
  expires_at: string;
};
/* eslint-enable @typescript-eslint/no-explicit-any */

type LookupState =
  | 'valid_logged_in'
  | 'valid_logged_out_existing'
  | 'valid_new_user'
  | 'expired'
  | 'already_used'
  | 'canceled'
  | 'not_found'
  | 'load_error';

interface LookupResponse {
  state: LookupState;
  invite?: LookupInvite;
}

type PageState =
  | { kind: 'loading' }
  | { kind: 'state_b'; invite: LookupInvite }
  | { kind: 'state_c'; invite: LookupInvite; magicSent: boolean }
  | { kind: 'state_d'; invite: LookupInvite }
  | { kind: 'state_e'; orgName: string | null }
  | { kind: 'state_f' }
  | { kind: 'state_g'; orgName: string | null }
  | { kind: 'state_h' };

const TOKEN_RE = /^\/clinic-invite\/([A-Za-z0-9_-]+)/;

function readTokenFromPath(): string | null {
  const m = window.location.pathname.match(TOKEN_RE);
  return m ? (m[1] ?? null) : null;
}

function mapLookupToPageState(r: LookupResponse): PageState {
  if (r.state === 'valid_logged_in' && r.invite) return { kind: 'state_b', invite: r.invite };
  if (r.state === 'valid_logged_out_existing' && r.invite)
    return { kind: 'state_c', invite: r.invite, magicSent: false };
  if (r.state === 'valid_new_user' && r.invite) return { kind: 'state_d', invite: r.invite };
  if (r.state === 'expired') return { kind: 'state_e', orgName: r.invite?.org?.name ?? null };
  if (r.state === 'already_used') return { kind: 'state_f' };
  if (r.state === 'canceled') return { kind: 'state_g', orgName: r.invite?.org?.name ?? null };
  if (r.state === 'not_found' || r.state === 'load_error') return { kind: 'state_h' };
  return { kind: 'state_h' };
}

export function ClinicInvitePage() {
  const { t } = useTranslation(['clinic', 'common']);
  const [state, setState] = useState<PageState>({ kind: 'loading' });
  const tokenRef = useRef<string | null>(null);

  const doLookup = useCallback(async (): Promise<void> => {
    const token = tokenRef.current;
    if (!token) {
      setState({ kind: 'state_h' });
      return;
    }
    setState({ kind: 'loading' });
    try {
      const base = import.meta.env.VITE_SUPABASE_URL as string | undefined;
      if (!base) {
        setState({ kind: 'state_h' });
        return;
      }
      const url = `${base}/functions/v1/clinic-invite/lookup?token=${encodeURIComponent(token)}`;
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      try {
        const { data } = await supabase.auth.getSession();
        if (data.session?.access_token) {
          headers['Authorization'] = `Bearer ${data.session.access_token}`;
        }
      } catch {
        /* anonymous lookup is allowed */
      }
      const res = await fetch(url, { headers });
      if (!res.ok && res.status !== 401 && res.status !== 404) {
        setState({ kind: 'state_h' });
        return;
      }
      const body = (await res.json()) as LookupResponse;
      setState(mapLookupToPageState(body));
    } catch {
      setState({ kind: 'state_h' });
    }
  }, []);

  // Initial mount: extract token + first lookup.
  useEffect(() => {
    const token = readTokenFromPath();
    tokenRef.current = token;
    if (!token) {
      setState({ kind: 'state_h' });
      return;
    }
    void doLookup();
  }, [doLookup]);

  // Return-from-email-link round trip: re-fire lookup on SIGNED_IN. We
  // intentionally do NOT refire on INITIAL_SESSION because the cold-mount
  // lookup above is already in flight at that point.
  useEffect(() => {
    let subscription: { unsubscribe: () => void } | null = null;
    try {
      const ret = supabase.auth.onAuthStateChange((event) => {
        if (event === 'SIGNED_IN') {
          void doLookup();
        }
      });
      subscription = ret.data.subscription;
    } catch {
      /* fail-soft — return-from-email-link still works on manual reload */
    }
    return () => {
      subscription?.unsubscribe();
    };
  }, [doLookup]);

  // ────────────────────────────────────────────────────────────────────
  // Render
  // ────────────────────────────────────────────────────────────────────
  return (
    <main
      role="main"
      className="min-h-screen bg-[var(--color-bg)] text-[var(--color-text)] px-5 py-10 md:py-16"
    >
      <div className="mx-auto max-w-[720px]">
        {/* Always-present wordmark for anonymous-context trust */}
        <header className="mb-6 flex items-center justify-center">
          <span className="text-[20px] font-extrabold tracking-tight text-[var(--color-primary)]">
            LeanShot
          </span>
        </header>

        {state.kind === 'loading' && <StateA />}

        {state.kind === 'state_b' && (
          <ConsentDialog invite={state.invite} rawToken={tokenRef.current ?? ''} mode="existing" />
        )}

        {state.kind === 'state_c' && (
          <StateC
            invite={state.invite}
            magicSent={state.magicSent}
            onSendMagicLink={async () => {
              try {
                await supabase.auth.signInWithOtp({
                  email: state.invite.email,
                  options: { emailRedirectTo: window.location.href },
                });
                setState({ kind: 'state_c', invite: state.invite, magicSent: true });
              } catch {
                /* fail-soft — UI shows confirmation regardless to avoid email-enumeration */
                setState({ kind: 'state_c', invite: state.invite, magicSent: true });
              }
            }}
          />
        )}

        {state.kind === 'state_d' && (
          <Card variant="elevated" padding="lg" className="max-w-[480px] mx-auto">
            <InviteSignupForm
              email={state.invite.email}
              orgName={state.invite.org.name}
              onAlreadyRegistered={() =>
                setState({ kind: 'state_c', invite: state.invite, magicSent: false })
              }
            />
          </Card>
        )}

        {state.kind === 'state_e' && <StateE orgName={state.orgName} />}
        {state.kind === 'state_f' && <StateF />}
        {state.kind === 'state_g' && <StateG orgName={state.orgName} />}
        {state.kind === 'state_h' && <StateH onRetry={doLookup} />}

        <footer className="mt-10 text-center text-[12px] text-[var(--color-text-tertiary)]">
          {t('clinic:invite.footer')}
        </footer>
      </div>
    </main>
  );
}

export default ClinicInvitePage;

/* ──────────────────────────────────────────────────────────────────── */
/* State sub-renderers                                                  */
/* ──────────────────────────────────────────────────────────────────── */

function StateA() {
  const { t } = useTranslation('clinic');
  return (
    <Card variant="default" padding="lg" className="max-w-[640px] mx-auto">
      <h1 className="text-[22px] font-bold tracking-tight">{t('clinic:invite.loading')}</h1>
      <div className="mt-4 flex flex-col gap-3">
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-4 w-1/2" />
        <Skeleton className="h-32 w-full" />
      </div>
    </Card>
  );
}

function StateC({
  invite,
  magicSent,
  onSendMagicLink,
}: {
  invite: LookupInvite;
  magicSent: boolean;
  onSendMagicLink: () => Promise<void>;
}) {
  const { t } = useTranslation('clinic');
  const [sending, setSending] = useState(false);
  return (
    <Card variant="elevated" padding="lg" className="max-w-[480px] mx-auto">
      <h1 className="text-[24px] font-bold tracking-tight">
        {t('clinic:invite.magic_link.signin_title')}
      </h1>
      <p className="mt-2 text-[14px] text-[var(--color-text-secondary)]">
        {t('clinic:invite.magic_link.signin_body', { orgName: invite.org.name })}
      </p>
      {magicSent ? (
        <p className="mt-5 text-[14px] text-[var(--color-success)]" role="status">
          {t('clinic:invite.magic_link.sent')}
        </p>
      ) : (
        <div className="mt-5 flex flex-col gap-3">
          <p className="text-[13px] text-[var(--color-text-tertiary)]">
            {t('clinic:invite.magic_link.hint', { email: invite.email })}
          </p>
          <Button
            variant="primary"
            loading={sending}
            onClick={async () => {
              setSending(true);
              try {
                await onSendMagicLink();
              } finally {
                setSending(false);
              }
            }}
          >
            {t('clinic:invite.magic_link.cta')}
          </Button>
        </div>
      )}
    </Card>
  );
}

function StateE({ orgName }: { orgName: string | null }) {
  const { t } = useTranslation('clinic');
  return (
    <Card variant="elevated" padding="lg" className="max-w-[480px] mx-auto text-center">
      <EmptyState
        illustration={<Clock className="size-10" aria-hidden />}
        title={t('clinic:invite.error.expired_title')}
        body={
          orgName
            ? t('clinic:invite.error.expired_body_org', { orgName })
            : t('clinic:invite.error.expired_body_generic')
        }
        cta={
          <Button variant="ghost" onClick={() => (window.location.href = '/')}>
            {t('clinic:invite.action.done')}
          </Button>
        }
      />
    </Card>
  );
}

function StateF() {
  const { t } = useTranslation('clinic');
  return (
    <Card variant="elevated" padding="lg" className="max-w-[480px] mx-auto text-center">
      <EmptyState
        illustration={<Check className="size-10" aria-hidden />}
        title={t('clinic:invite.error.already_used_title')}
        body={t('clinic:invite.error.already_used_body')}
        cta={
          <Button variant="primary" onClick={() => (window.location.href = '/')}>
            {t('clinic:invite.action.done')}
          </Button>
        }
      />
    </Card>
  );
}

function StateG({ orgName }: { orgName: string | null }) {
  const { t } = useTranslation('clinic');
  return (
    <Card variant="elevated" padding="lg" className="max-w-[480px] mx-auto text-center">
      <EmptyState
        illustration={<XCircle className="size-10 text-[var(--color-danger)]" aria-hidden />}
        title={t('clinic:invite.error.canceled_title')}
        body={
          orgName
            ? t('clinic:invite.error.canceled_body_org', { orgName })
            : t('clinic:invite.error.canceled_body_generic')
        }
        cta={
          <Button variant="ghost" onClick={() => (window.location.href = '/')}>
            {t('clinic:invite.action.done')}
          </Button>
        }
      />
    </Card>
  );
}

function StateH({ onRetry }: { onRetry: () => Promise<void> }) {
  const { t } = useTranslation('clinic');
  const [retrying, setRetrying] = useState(false);
  return (
    <Card variant="elevated" padding="lg" className="max-w-[480px] mx-auto text-center">
      <EmptyState
        title={t('clinic:invite.error.load_title')}
        body={t('clinic:invite.error.load_body')}
        cta={
          <Button
            variant="primary"
            loading={retrying}
            onClick={async () => {
              setRetrying(true);
              try {
                await onRetry();
              } finally {
                setRetrying(false);
              }
            }}
          >
            {t('clinic:invite.action.retry')}
          </Button>
        }
      />
    </Card>
  );
}
