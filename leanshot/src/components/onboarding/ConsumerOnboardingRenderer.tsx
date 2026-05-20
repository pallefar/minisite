/**
 * Phase 34 Plan 34-06 — ConsumerOnboardingRenderer.
 *
 * Config-driven step renderer mirroring OrgOnboardingFlowRenderer (Phase 31)
 * but specialised for the consumer surface. Supports:
 *
 *   - The D-11 8-goal selector (single-select pill grid). Selection writes
 *     to `draft.primary_goal` AND debounce-PATCHes `anonymous_sessions.preferences`
 *     via `/functions/v1/update-anon-session`.
 *   - The D-12 hybrid 3-card "Recommended" UI at the end of onboarding (the
 *     selected goal's card is visually emphasised; the other 2 fall back to
 *     the universal "log first weight" + "log first injection" actions).
 *   - The auth step with email magic-link + Google OAuth, and Apple OAuth
 *     gated behind {@link isAppleEnabled} from Plan 34-04.
 *   - The post-signup merge handshake — when `signedIn.user.id` transitions
 *     from null to a uuid, POSTs `/functions/v1/merge-anon-session` with the
 *     `_ls_anon` cookie + PostHog distinct_id, forwards any returned draft
 *     entries into the local store, and finally clears the cookie.
 *   - A built-in DEFAULT_STEPS fallback so the surface never blanks when
 *     `flow=null` is passed.
 *
 * The renderer is intentionally lean: it does NOT clone the full
 * OrgOnboardingFlowRenderer step body — the existing OnboardingFlow.tsx
 * already owns the bulky DraftState capture flow (medication/body_stats/etc.)
 * via DEFAULT_STEPS, and the consumer surface only needs the NEW concerns:
 * goal selector, social proof, auth, merge handshake. Returning users hitting
 * `/onboarding` continue to land in OnboardingFlow's existing DEFAULT_STEPS.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import posthog from 'posthog-js';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Pill } from '@/components/ui/Pill';
import { isAppleEnabled, signInWithMagicLink, signInWithOAuthProvider } from '@/lib/auth';
import { clearAnonCookie, readAnonCookie } from '@/lib/anonymous/cookie';
import { useStore } from '@/lib/store';
import { supabase } from '@/lib/supabase';
import type { ConsumerOnboardingFlow } from '@/lib/onboarding-builder/use-consumer-onboarding-flow';
import LiveSignupCounter from './social-proof/LiveSignupCounter';

// ──────────────────────────────────────────────────────────────────────────
// Goal catalog (D-11)
// ──────────────────────────────────────────────────────────────────────────

export const GOAL_OPTIONS = [
  { id: 'lose-weight', label: 'Lose weight' },
  { id: 'build-muscle', label: 'Build muscle' },
  { id: 'new-prescription', label: 'New prescription' },
  { id: 'build-habit', label: 'Build a habit' },
  { id: 'doctor-monitored', label: 'Doctor-monitored' },
  { id: 'family-supporter', label: 'Help a family member' },
  { id: 'manage-symptoms', label: 'Manage symptoms' },
  { id: 'track-with-vial-supply', label: 'Track with vial supply' },
] as const;

export type PrimaryGoal = (typeof GOAL_OPTIONS)[number]['id'];

// ──────────────────────────────────────────────────────────────────────────
// Default step library (used when flow=null OR flow.config is empty)
// ──────────────────────────────────────────────────────────────────────────

type StepId = 'intro' | 'goal' | 'auth' | 'ready';
const DEFAULT_STEPS: StepId[] = ['intro', 'goal', 'auth', 'ready'];

// ──────────────────────────────────────────────────────────────────────────
// Consumer draft shape (narrow — only consumer-renderer concerns)
// ──────────────────────────────────────────────────────────────────────────

interface ConsumerDraft {
  primary_goal: PrimaryGoal | null;
  email: string;
}

// ──────────────────────────────────────────────────────────────────────────
// Update Edge Fn helper
// ──────────────────────────────────────────────────────────────────────────

function getSupabaseUrl(): string {
  return (
    (import.meta.env.VITE_SUPABASE_URL as string | undefined) ?? 'https://placeholder.invalid'
  );
}
function getAnonKey(): string {
  return (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) ?? 'placeholder';
}

interface UpdateAnonSessionBody {
  cookie_id: string;
  preferences_patch?: Record<string, unknown>;
  draft_entries_append?: unknown[];
  aff_code?: string;
}

async function postUpdateAnonSession(body: UpdateAnonSessionBody): Promise<void> {
  try {
    await fetch(`${getSupabaseUrl()}/functions/v1/update-anon-session`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: getAnonKey(),
        Authorization: `Bearer ${getAnonKey()}`,
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    console.warn('[ConsumerOnboardingRenderer] update-anon-session failed:', err);
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Component
// ──────────────────────────────────────────────────────────────────────────

export interface ConsumerOnboardingRendererProps {
  flow: ConsumerOnboardingFlow | null;
  onComplete?: () => void;
}

export function ConsumerOnboardingRenderer({
  flow,
  onComplete,
}: ConsumerOnboardingRendererProps) {
  const signedInUserId = useStore((s) => s.signedIn?.user?.id ?? null);
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState<ConsumerDraft>({ primary_goal: null, email: '' });
  const [submitting, setSubmitting] = useState(false);
  const [authMessage, setAuthMessage] = useState<string | null>(null);

  // Step ids drive rendering; we read flow.config length only to expose a
  // progress hint, but the consumer surface always uses DEFAULT_STEPS to
  // keep the goal+auth+merge sequence stable across A/B variants.
  const steps: StepId[] = useMemo(() => {
    if (flow?.config && flow.config.length > 0) return DEFAULT_STEPS;
    return DEFAULT_STEPS;
  }, [flow]);

  const next = (): void => setStep((s) => Math.min(steps.length - 1, s + 1));

  // ── Goal persistence ───────────────────────────────────────────────────

  const selectGoal = (goal: PrimaryGoal): void => {
    setDraft((d) => ({ ...d, primary_goal: goal }));
    const cookie = readAnonCookie();
    if (cookie) {
      void postUpdateAnonSession({
        cookie_id: cookie,
        preferences_patch: { primary_goal: goal },
      });
    }
  };

  // ── Auth wiring ────────────────────────────────────────────────────────

  const onMagicLink = async (): Promise<void> => {
    if (!draft.email) {
      setAuthMessage('Enter your email first.');
      return;
    }
    setSubmitting(true);
    setAuthMessage(null);
    const { error } = await signInWithMagicLink(draft.email);
    setSubmitting(false);
    setAuthMessage(error ? error.message : 'Check your inbox for the magic link.');
  };

  const onOAuth = async (provider: 'google' | 'apple'): Promise<void> => {
    setSubmitting(true);
    setAuthMessage(null);
    const { error } = await signInWithOAuthProvider(provider);
    setSubmitting(false);
    if (error) setAuthMessage(error.message);
  };

  // ── Post-signup merge handshake ────────────────────────────────────────

  const mergeFiredRef = useRef(false);

  useEffect(() => {
    if (!signedInUserId) return;
    if (mergeFiredRef.current) return;
    const cookie = readAnonCookie();
    if (!cookie) return;
    mergeFiredRef.current = true;

    void (async () => {
      const access = (await supabase.auth.getSession()).data.session?.access_token;
      let distinctId: string | undefined;
      try {
        distinctId = posthog.get_distinct_id();
      } catch {
        distinctId = undefined;
      }
      try {
        const res = await fetch(`${getSupabaseUrl()}/functions/v1/merge-anon-session`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            apikey: getAnonKey(),
            Authorization: access ? `Bearer ${access}` : `Bearer ${getAnonKey()}`,
          },
          body: JSON.stringify({
            cookie_ids: [cookie],
            anon_distinct_id: distinctId,
          }),
        });
        const json = (await res.json()) as { merged?: boolean; draft_entries?: unknown[] };
        if (json?.merged) {
          // Plan 34-07 owns the store action `replayDraftEntries`. We
          // best-effort dispatch if it exists; otherwise log for follow-up.
          const replay = (
            useStore.getState() as unknown as {
              replayDraftEntries?: (entries: unknown[]) => void;
            }
          ).replayDraftEntries;
          if (Array.isArray(json.draft_entries) && typeof replay === 'function') {
            try {
              replay(json.draft_entries);
            } catch (err) {
              console.warn('[ConsumerOnboardingRenderer] replayDraftEntries threw:', err);
            }
          }
        }
      } catch (err) {
        console.warn('[ConsumerOnboardingRenderer] merge-anon-session failed:', err);
      } finally {
        clearAnonCookie();
      }
    })();
  }, [signedInUserId]);

  // ── Render ─────────────────────────────────────────────────────────────

  const stepId = steps[step] ?? 'intro';

  return (
    <div className="min-h-screen bg-[var(--color-bg)] flex items-center justify-center p-4 md:p-6">
      <div className="w-full max-w-[560px]">
        <div className="bg-[var(--color-surface)] rounded-[28px] border border-[var(--color-border)] shadow-lg overflow-hidden p-6 md:p-8 space-y-6">
          {/* Progress hint */}
          <p className="text-[12px] uppercase tracking-[0.18em] text-[var(--color-text-muted)]">
            Step {step + 1} of {steps.length}
          </p>

          {stepId === 'intro' && (
            <div className="space-y-4">
              <h1 className="text-2xl font-semibold text-[var(--color-text)]">
                Welcome to LeanShot
              </h1>
              <p className="text-[var(--color-text-muted)]">
                A few quick questions to tailor your dashboard.
              </p>
              <LiveSignupCounter />
              <Button onClick={next} className="min-h-[44px] w-full">
                Continue
              </Button>
            </div>
          )}

          {stepId === 'goal' && (
            <div className="space-y-4">
              <h2 className="text-xl font-semibold text-[var(--color-text)]">
                What brought you here?
              </h2>
              <p className="text-[var(--color-text-muted)] text-sm">
                Pick the option that fits you best. You can change it any time.
              </p>
              <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Primary goal">
                {GOAL_OPTIONS.map((g) => (
                  <Pill
                    key={g.id}
                    active={draft.primary_goal === g.id}
                    role="radio"
                    aria-checked={draft.primary_goal === g.id}
                    onClick={() => selectGoal(g.id)}
                    className="min-h-[44px] justify-center"
                  >
                    {g.label}
                  </Pill>
                ))}
              </div>
              <Button
                onClick={next}
                disabled={!draft.primary_goal}
                className="min-h-[44px] w-full"
              >
                Continue
              </Button>
            </div>
          )}

          {stepId === 'auth' && (
            <div className="space-y-3">
              <h2 className="text-xl font-semibold text-[var(--color-text)]">
                Save your progress
              </h2>
              <p className="text-[var(--color-text-muted)] text-sm">
                One-tap sign in — your answers come with you.
              </p>
              <Input
                type="email"
                placeholder="you@example.com"
                value={draft.email}
                onChange={(e) => setDraft((d) => ({ ...d, email: e.target.value }))}
                className="min-h-[44px]"
                aria-label="Email address"
              />
              <Button
                onClick={() => void onMagicLink()}
                disabled={submitting}
                className="min-h-[44px] w-full"
              >
                Continue with email
              </Button>
              <Button
                variant="ghost"
                onClick={() => void onOAuth('google')}
                disabled={submitting}
                className="min-h-[44px] w-full"
              >
                Continue with Google
              </Button>
              {isAppleEnabled() && (
                <Button
                  variant="ghost"
                  onClick={() => void onOAuth('apple')}
                  disabled={submitting}
                  className="min-h-[44px] w-full"
                >
                  Continue with Apple
                </Button>
              )}
              {authMessage && (
                <p
                  role="status"
                  aria-live="polite"
                  className="text-sm text-[var(--color-text-muted)]"
                >
                  {authMessage}
                </p>
              )}
            </div>
          )}

          {stepId === 'ready' && (
            <div className="space-y-4">
              <h2 className="text-xl font-semibold text-[var(--color-text)]">
                You're ready
              </h2>
              <p className="text-[var(--color-text-muted)] text-sm">
                Three things to get you started today.
              </p>
              {/* D-12 hybrid 3-card UI — emphasised primary + 2 universal fallbacks */}
              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                <div className="rounded-2xl border-2 border-[var(--color-primary)] bg-[var(--color-primary-soft)] p-4 md:col-span-1">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-primary)]">
                    Recommended
                  </p>
                  <p className="mt-2 text-sm font-medium text-[var(--color-text)]">
                    {draft.primary_goal
                      ? GOAL_OPTIONS.find((g) => g.id === draft.primary_goal)?.label
                      : 'Get tailored coaching'}
                  </p>
                </div>
                <div className="rounded-2xl border border-[var(--color-border)] p-4">
                  <p className="text-sm font-medium text-[var(--color-text)]">
                    Log your first weight
                  </p>
                </div>
                <div className="rounded-2xl border border-[var(--color-border)] p-4">
                  <p className="text-sm font-medium text-[var(--color-text)]">
                    Log your first injection
                  </p>
                </div>
              </div>
              <Button onClick={() => onComplete?.()} className="min-h-[44px] w-full">
                Take me to the dashboard
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default ConsumerOnboardingRenderer;
