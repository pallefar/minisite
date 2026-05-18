import { AnimatePresence, motion } from 'framer-motion';
import i18next from 'i18next';
import { ArrowLeft, ArrowRight, Check } from 'lucide-react';
import { useEffect, useState } from 'react';
import { DisclaimerBody } from '@/components/dashboard/DisclaimerModal';
import { Button } from '@/components/ui/Button';
import { Input, Select } from '@/components/ui/Input';
import { Pill, PillGroup } from '@/components/ui/Pill';
import { Skeleton } from '@/components/ui/Skeleton';
import { useHreflangTags } from '@/hooks/useHreflangTags';
import { useToast } from '@/hooks/useToast';
import { AIAvatar } from '@/illustrations/AIAvatar';
import {
  OnboardWelcome,
  OnboardMedication,
  OnboardBody,
  OnboardGoals,
  OnboardRoutine,
  OnboardReady,
  OnboardSnapshot,
} from '@/illustrations/OnboardSteps';
import { track } from '@/lib/analytics';
import { todayStr } from '@/lib/helpers';
import { useOrgOnboardingFlow } from '@/lib/onboarding-builder/use-org-onboarding-flow';
import { medLabel } from '@/lib/pharmacology';
import { useStore } from '@/lib/store';
import { supabase } from '@/lib/supabase';
import type {
  ActivityLevel,
  GoalType,
  LiftingLevel,
  MedicationId,
  Sex,
  Units,
  User,
  DoseUnit,
} from '@/types';
import type { OnboardingStepNode } from '@/types/onboarding-step';
import { ProgressIndicator } from './ProgressIndicator';
import { UnitToggle } from './UnitToggle';

interface OnboardingFlowProps {
  onCancel: () => void;
  onComplete: () => void;
}

/**
 * Phase 32 Plan 32-03 (I18N-02 / D-12) — derive the i18n-aware locale +
 * units defaults at the moment of signup completion. SIGNUP-TIME ONLY.
 *
 * Existing users keep their `units` preference forever — Pitfall 4
 * (32-RESEARCH §Pitfalls): locale and units are decoupled post-signup.
 * Settings → Language changes locale, NEVER units.
 *
 * Per CONTEXT D-12: when a new user signs up with `Accept-Language: es-*`
 * (i18next.language === 'es' at completion-time), default `units` to 'metric'
 * (kg) regardless of any draft toggle. The OnboardingFlow's draft already
 * starts at 'metric' so this is a defensive override — only triggers if an
 * ES-detected user explicitly flipped to imperial during the flow.
 */
export function deriveSignupLocaleAndUnits(draftUnits: Units): {
  locale: 'en' | 'es';
  units: Units;
} {
  const detected = (i18next.language ?? 'en').slice(0, 2);
  const isSpanish = detected === 'es';
  return {
    locale: isSpanish ? 'es' : 'en',
    // D-12: ES signup → force metric/kg; EN signup → preserve user's draft choice.
    units: isSpanish ? 'metric' : draftUnits,
  };
}

interface DraftState {
  name: string;
  units: Units;
  medication: MedicationId | '';
  dose: string;
  doseUnit: DoseUnit;
  startDate: string;
  weight: string;
  height: string;
  age: string;
  sex: Sex;
  bodyFat: string;
  goalWeight: string;
  goal: GoalType;
  protein: string;
  injectionDay: number;
  activity: ActivityLevel;
  lifting: LiftingLevel;
}

const TOTAL_STEPS = 8;

export function OnboardingFlow({ onCancel, onComplete }: OnboardingFlowProps) {
  // Phase 32 Plan 32-07 (I18N-01) — hreflang tags on the onboarding entry
  // point so search engines index the EN + ES variants of `/onboarding`.
  useHreflangTags();

  // Phase 31 Plan 06 D-10: render-branch hook — determines whether to show
  // the org's saved flow (invited patient) or the consumer DEFAULT_STEPS path.
  const flowState = useOrgOnboardingFlow();

  const setUser = useStore((s) => s.setUser);
  const upsertWeight = useStore((s) => s.upsertWeight);
  const toast = useToast();
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState<DraftState>({
    name: '',
    units: 'metric',
    medication: '',
    dose: '',
    doseUnit: 'mg',
    startDate: todayStr(),
    weight: '',
    height: '',
    age: '',
    sex: 'male',
    bodyFat: '',
    goalWeight: '',
    goal: 'fat-loss',
    protein: '',
    injectionDay: 0,
    activity: 'light',
    lifting: 'none',
  });

  const wU = draft.units === 'metric' ? 'kg' : 'lb';
  const hU = draft.units === 'metric' ? 'cm' : 'in';

  useEffect(() => {
    track('onboarding_started');
  }, []);

  // ── Phase 31 Plan 06: render-branch early returns ───────────────────────

  // Loading: show a lightweight skeleton while the hook's async query resolves
  if (flowState.status === 'loading') {
    return (
      <div className="min-h-screen bg-[var(--color-bg)] flex items-center justify-center p-4 md:p-6">
        <div className="w-full max-w-[560px]">
          <Skeleton className="h-[520px] rounded-[28px]" />
        </div>
      </div>
    );
  }

  // Completed: defense-in-depth null return (App.tsx gate short-circuits in production)
  if (flowState.status === 'completed') {
    return null;
  }

  // Org-flow: delegated to OrgOnboardingFlowRenderer
  if (flowState.status === 'org' && flowState.steps && flowState.steps.length > 0) {
    return (
      <OrgOnboardingFlowRenderer
        orgId={flowState.orgId!}
        orgName={flowState.orgName}
        steps={flowState.steps}
        onCancel={onCancel}
        onComplete={onComplete}
      />
    );
  }

  // Consumer / default: fall through to DEFAULT_STEPS render below
  // ────────────────────────────────────────────────────────────────────────

  const update = (patch: Partial<DraftState>): void => setDraft((d) => ({ ...d, ...patch }));

  const next = (): void => {
    if (step === 0) return; // Step 0 advances exclusively via handleAcknowledge (D-09)
    if (step === 1 && !draft.name.trim()) return toast('Please enter your name', 'error');
    if (step === 2 && !draft.medication) return toast('Please pick your medication', 'error');
    if (step === 3 && !draft.weight) return toast('Please enter your weight', 'error');
    track('onboarding_step_completed', { step });
    setStep((s) => Math.min(TOTAL_STEPS, s + 1));
  };
  const back = (): void => setStep((s) => Math.max(0, s - 1));

  const handleAcknowledge = (): void => {
    useStore.getState().acknowledgeDisclaimer('v1');
    track('disclaimer_acknowledged', { version: 'v1' });
    setStep(1);
  };

  const complete = (): void => {
    const weight = parseFloat(draft.weight);
    if (!weight) return toast('Weight is required', 'error');
    // Phase 32 Plan 32-03 (I18N-02 / D-12): derive signup-time locale + units
    // BEFORE the metric-dependent protein/calorie calculations so an
    // es-MX-detected signup who toggled imperial still gets kg-scaled targets.
    const { locale: signupLocale, units: signupUnits } = deriveSignupLocaleAndUnits(draft.units);
    const proteinFromBody = Math.round(weight * (signupUnits === 'metric' ? 1.6 : 0.8));
    const calorieBase = Math.round(weight * (signupUnits === 'metric' ? 22 : 10));
    const goalWeight = parseFloat(draft.goalWeight) || weight - 10;
    const protein = parseInt(draft.protein) || proteinFromBody;

    const user: User = {
      name: draft.name.trim() || 'Friend',
      units: signupUnits,
      medication: (draft.medication || 'ozempic') as MedicationId,
      dose: draft.dose || '0.25',
      doseUnit: draft.doseUnit,
      startDate: draft.startDate,
      startWeight: weight,
      height: parseFloat(draft.height) || null,
      age: parseInt(draft.age) || null,
      sex: draft.sex,
      bodyFat: parseFloat(draft.bodyFat) || null,
      goalWeight,
      goal: draft.goal,
      proteinTarget: protein,
      calorieTarget: calorieBase,
      fiberTarget: 30,
      waterTarget: 8,
      injectionDay: draft.injectionDay,
      activityLevel: draft.activity,
      liftingLevel: draft.lifting,
      createdAt: new Date().toISOString(),
      // Phase 32 Plan 32-03 (I18N-02): persist locale into the Zustand mirror
      // so the profilesLocale i18next detector resolves correctly on next boot.
      locale: signupLocale,
    };
    setUser(user);
    upsertWeight({
      date: draft.startDate,
      weight,
      bodyFat: parseFloat(draft.bodyFat) || null,
      ts: Date.now(),
    });
    track('onboarding_completed', { totalSteps: TOTAL_STEPS });
    // Phase 31 Plan 06 D-13: mark_onboarding_complete SECDEF — best-effort, fire-and-forget.
    // Local store mutations happen first; SECDEF writes profiles.completed_onboarding_at.
    // Only fires for authenticated users (anonymous users silently skip).
    // Errors are swallowed — onComplete() is NOT blocked by the SECDEF call.
    // Phase 32 Plan 32-03 (I18N-02): chain a profiles.locale write so the
    // server row matches the local mirror; same best-effort semantics
    // (anonymous skip + error swallow — UI already reflects the choice
    // and the local mirror is durable).
    void (async () => {
      try {
        const { data: authData } = await supabase.auth.getUser();
        if (authData?.user && !authData.user.is_anonymous) {
          await supabase.rpc('mark_onboarding_complete');
          await supabase
            .from('profiles')
            .update({ locale: signupLocale })
            .eq('id', authData.user.id);
        }
      } catch (err) {
        console.warn('[OnboardingFlow] mark_onboarding_complete failed (best-effort):', err);
      }
    })();
    onComplete();
  };

  return (
    <div className="min-h-screen bg-[var(--color-bg)] flex items-center justify-center p-4 md:p-6 safe-top safe-bottom">
      <div className="w-full max-w-[560px]">
        <div className="bg-[var(--color-surface)] rounded-[28px] border border-[var(--color-border)] shadow-lg overflow-hidden">
          {/* Full-bleed illustration banner */}
          <div className="relative h-[180px] md:h-[200px] bg-gradient-to-br from-[var(--color-primary-soft)] to-[var(--color-surface-elevated)] overflow-hidden">
            <AnimatePresence mode="wait">
              <motion.div
                key={step}
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.97 }}
                transition={{ duration: 0.4, ease: [0.25, 1, 0.5, 1] }}
                className="absolute inset-0 flex items-center justify-center"
              >
                {step === 1 && <OnboardWelcome className="w-full max-w-[320px]" />}
                {step === 2 && <OnboardMedication className="w-full max-w-[320px]" />}
                {step === 3 && <OnboardBody className="w-full max-w-[320px]" />}
                {step === 4 && <OnboardGoals className="w-full max-w-[320px]" />}
                {step === 5 && <OnboardRoutine className="w-full max-w-[320px]" />}
                {step === 6 && <OnboardSnapshot className="w-full max-w-[320px]" />}
                {step === 7 && <OnboardReady className="w-full max-w-[320px]" />}
              </motion.div>
            </AnimatePresence>
          </div>

          <div className="p-6 md:p-8">
            <ProgressIndicator step={step} total={TOTAL_STEPS} />
            <AnimatePresence mode="wait">
              <motion.div
                key={step}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.2 }}
              >
                {step === 0 && (
                  <div className="space-y-4">
                    <div>
                      <h1 className="text-[26px] font-bold tracking-tight">Before you start</h1>
                      <p className="text-[14px] text-[var(--color-text-secondary)] mt-1">
                        A quick note before we set things up.
                      </p>
                    </div>
                    <DisclaimerBody onAcknowledge={handleAcknowledge} />
                  </div>
                )}

                {step === 1 && (
                  <div className="space-y-4">
                    <div>
                      <h1 className="text-[26px] font-bold tracking-tight">
                        Welcome{' '}
                        <span className="font-display italic font-normal text-[var(--color-primary)]">
                          in.
                        </span>
                      </h1>
                      <p className="text-[14px] text-[var(--color-text-secondary)] mt-1">
                        Two minutes. Your data stays on this device — always.
                      </p>
                    </div>
                    <Input
                      label="Your name"
                      placeholder="First name"
                      autoComplete="given-name"
                      value={draft.name}
                      onChange={(e) => update({ name: e.target.value })}
                    />
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--color-text-secondary)] mb-2">
                        Units
                      </p>
                      <UnitToggle value={draft.units} onChange={(u) => update({ units: u })} />
                    </div>
                  </div>
                )}

                {step === 2 && (
                  <div className="space-y-4">
                    <div>
                      <h1 className="text-[26px] font-bold tracking-tight">Your medication</h1>
                      <p className="text-[14px] text-[var(--color-text-secondary)] mt-1">
                        We&apos;ll tailor everything to your med.
                      </p>
                    </div>
                    <Select
                      label="GLP-1 medication"
                      value={draft.medication}
                      onChange={(e) => update({ medication: e.target.value as MedicationId })}
                    >
                      <option value="">Select…</option>
                      <option value="ozempic">Ozempic (semaglutide)</option>
                      <option value="wegovy">Wegovy (semaglutide)</option>
                      <option value="mounjaro">Mounjaro (tirzepatide)</option>
                      <option value="zepbound">Zepbound (tirzepatide)</option>
                      <option value="rybelsus">Rybelsus (oral semaglutide)</option>
                      <option value="saxenda">Saxenda (liraglutide)</option>
                      <option value="trulicity">Trulicity (dulaglutide)</option>
                      <option value="retatrutide">Retatrutide</option>
                      <option value="compound-sema">Compounded semaglutide</option>
                      <option value="compound-tirz">Compounded tirzepatide</option>
                    </Select>
                    <div className="grid grid-cols-2 gap-3">
                      <Input
                        label="Current dose"
                        inputMode="decimal"
                        placeholder="0.5"
                        value={draft.dose}
                        onChange={(e) => update({ dose: e.target.value })}
                      />
                      <Select
                        label="Unit"
                        value={draft.doseUnit}
                        onChange={(e) => update({ doseUnit: e.target.value as DoseUnit })}
                      >
                        <option value="mg">mg</option>
                        <option value="units">units</option>
                        <option value="ml">ml</option>
                      </Select>
                    </div>
                    <Input
                      label="Start date"
                      type="date"
                      value={draft.startDate}
                      onChange={(e) => update({ startDate: e.target.value })}
                    />
                  </div>
                )}

                {step === 3 && (
                  <div className="space-y-4">
                    <div>
                      <h1 className="text-[26px] font-bold tracking-tight">Your starting point</h1>
                      <p className="text-[14px] text-[var(--color-text-secondary)] mt-1">
                        For real progress tracking.
                      </p>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <Input
                        label={`Weight (${wU})`}
                        type="number"
                        step="0.1"
                        inputMode="decimal"
                        value={draft.weight}
                        onChange={(e) => update({ weight: e.target.value })}
                      />
                      <Input
                        label={`Height (${hU})`}
                        type="number"
                        step="0.1"
                        inputMode="decimal"
                        value={draft.height}
                        onChange={(e) => update({ height: e.target.value })}
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <Input
                        label="Age"
                        type="number"
                        inputMode="numeric"
                        value={draft.age}
                        onChange={(e) => update({ age: e.target.value })}
                      />
                      <Select
                        label="Sex at birth"
                        value={draft.sex}
                        onChange={(e) => update({ sex: e.target.value as Sex })}
                      >
                        <option value="male">Male</option>
                        <option value="female">Female</option>
                      </Select>
                    </div>
                    <Input
                      label="Body fat % (optional)"
                      type="number"
                      step="0.1"
                      inputMode="decimal"
                      value={draft.bodyFat}
                      onChange={(e) => update({ bodyFat: e.target.value })}
                      hint="Skip if you don't have a recent reading. We'll estimate lean mass when you log it."
                    />
                  </div>
                )}

                {step === 4 && (
                  <div className="space-y-4">
                    <div>
                      <h1 className="text-[26px] font-bold tracking-tight">Your goals</h1>
                      <p className="text-[14px] text-[var(--color-text-secondary)] mt-1">
                        Where are you headed?
                      </p>
                    </div>
                    <Input
                      label={`Target weight (${wU})`}
                      type="number"
                      step="0.1"
                      inputMode="decimal"
                      value={draft.goalWeight}
                      onChange={(e) => update({ goalWeight: e.target.value })}
                    />
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--color-text-secondary)] mb-2">
                        Primary goal
                      </p>
                      <PillGroup>
                        {(['fat-loss', 'recomp', 'health', 'maintenance'] as const).map((g) => (
                          <Pill
                            key={g}
                            active={draft.goal === g}
                            onClick={() => update({ goal: g })}
                          >
                            {g === 'fat-loss'
                              ? 'Fat loss'
                              : g === 'recomp'
                                ? 'Recomp'
                                : g === 'health'
                                  ? 'Health markers'
                                  : 'Maintenance'}
                          </Pill>
                        ))}
                      </PillGroup>
                    </div>
                    <Input
                      label="Daily protein target"
                      type="number"
                      inputMode="numeric"
                      placeholder="grams (auto if blank)"
                      value={draft.protein}
                      onChange={(e) => update({ protein: e.target.value })}
                      hint="1.6–2.2g/kg goal weight to preserve muscle"
                    />
                  </div>
                )}

                {step === 5 && (
                  <div className="space-y-4">
                    <div>
                      <h1 className="text-[26px] font-bold tracking-tight">Your routine</h1>
                      <p className="text-[14px] text-[var(--color-text-secondary)] mt-1">
                        For smart nudges that actually fit.
                      </p>
                    </div>
                    <Select
                      label="Injection day"
                      value={draft.injectionDay}
                      onChange={(e) => update({ injectionDay: parseInt(e.target.value) })}
                    >
                      {[
                        'Sunday',
                        'Monday',
                        'Tuesday',
                        'Wednesday',
                        'Thursday',
                        'Friday',
                        'Saturday',
                      ].map((d, i) => (
                        <option key={d} value={i}>
                          {d}
                        </option>
                      ))}
                    </Select>
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--color-text-secondary)] mb-2">
                        Activity
                      </p>
                      <PillGroup>
                        {(['sedentary', 'light', 'moderate', 'very'] as const).map((a) => (
                          <Pill
                            key={a}
                            active={draft.activity === a}
                            onClick={() => update({ activity: a })}
                          >
                            {a === 'very' ? 'Very active' : a[0]!.toUpperCase() + a.slice(1)}
                          </Pill>
                        ))}
                      </PillGroup>
                    </div>
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--color-text-secondary)] mb-2">
                        Lifting experience
                      </p>
                      <PillGroup>
                        {(['none', 'beginner', 'intermediate', 'advanced'] as const).map((l) => (
                          <Pill
                            key={l}
                            active={draft.lifting === l}
                            onClick={() => update({ lifting: l })}
                          >
                            {l[0]!.toUpperCase() + l.slice(1)}
                          </Pill>
                        ))}
                      </PillGroup>
                    </div>
                  </div>
                )}

                {step === 6 && (
                  <div className="space-y-4">
                    <div>
                      <h1 className="text-[26px] font-bold tracking-tight">
                        Your starting{' '}
                        <span className="font-display italic font-normal text-[var(--color-primary)]">
                          snapshot
                        </span>
                      </h1>
                      <p className="text-[14px] text-[var(--color-text-secondary)] mt-1">
                        This is what we&apos;ll measure progress against. Looks right?
                      </p>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <SnapshotTile label="Name" value={draft.name || '—'} />
                      <SnapshotTile
                        label="Medication"
                        value={draft.medication ? medLabel(draft.medication as MedicationId) : '—'}
                      />
                      <SnapshotTile
                        label="Current dose"
                        value={draft.dose ? `${draft.dose} ${draft.doseUnit}` : '—'}
                      />
                      <SnapshotTile label="Started" value={draft.startDate} />
                      <SnapshotTile
                        label="Weight"
                        value={draft.weight ? `${draft.weight} ${wU}` : '—'}
                      />
                      <SnapshotTile
                        label="Goal"
                        value={draft.goalWeight ? `${draft.goalWeight} ${wU}` : '—'}
                      />
                      <SnapshotTile
                        label="Protein/day"
                        value={draft.protein ? `${draft.protein} g` : 'Auto'}
                      />
                      <SnapshotTile
                        label="Injection day"
                        value={
                          ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][draft.injectionDay] ??
                          ''
                        }
                      />
                    </div>
                  </div>
                )}

                {step === 7 && (
                  <div className="space-y-4">
                    <div className="flex items-start gap-3">
                      <AIAvatar size={56} className="shrink-0" />
                      <div>
                        <h1 className="text-[26px] font-bold tracking-tight">
                          You&apos;re{' '}
                          <span className="font-display italic font-normal text-[var(--color-primary)]">
                            all set.
                          </span>
                        </h1>
                        <p className="text-[14px] text-[var(--color-text-secondary)] mt-1">
                          Your AI coach is ready. Here&apos;s what&apos;s next:
                        </p>
                      </div>
                    </div>
                    <div className="space-y-2.5">
                      <NextStep
                        title="Open your dashboard"
                        body="Pre-filled with your data and today's focus."
                      />
                      <NextStep
                        title="Log your first injection"
                        body="Start your med-level curve from this dose."
                      />
                      <NextStep
                        title="Add your current vial"
                        body="Track supply and refill timing."
                      />
                    </div>
                    {/* Phase 5 D-03: post-onboarding contextual prompt — high-intent
                        "save your data" moment. Anonymous-by-default flow continues if
                        user dismisses; permanent users skip this entirely. */}
                    <div className="rounded-xl bg-[var(--color-primary-soft)] border border-[var(--color-primary)] p-3.5 mt-3">
                      <p className="text-[13px] font-semibold">Save your data across devices</p>
                      <p className="text-[12px] text-[var(--color-text-secondary)] mt-0.5">
                        Sign up to sync your injections to your account.
                      </p>
                      <Button
                        size="sm"
                        variant="primary"
                        className="mt-2.5"
                        onClick={() => {
                          window.location.hash = '#/auth/signup';
                        }}
                      >
                        Sign up — free
                      </Button>
                    </div>
                  </div>
                )}
              </motion.div>
            </AnimatePresence>

            {step === 0 ? null : (
              <div className="flex gap-2 mt-7">
                {step === 1 ? (
                  <Button variant="ghost" onClick={onCancel} className="flex-1">
                    Cancel
                  </Button>
                ) : (
                  <Button
                    variant="ghost"
                    onClick={back}
                    leadingIcon={<ArrowLeft className="size-4" />}
                    className="flex-1"
                  >
                    Back
                  </Button>
                )}
                {step < TOTAL_STEPS - 1 ? (
                  <Button
                    onClick={next}
                    trailingIcon={<ArrowRight className="size-4" />}
                    className="flex-1"
                  >
                    Continue
                  </Button>
                ) : (
                  <Button
                    onClick={complete}
                    trailingIcon={<Check className="size-4" />}
                    className="flex-1"
                  >
                    Open dashboard
                  </Button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// OrgOnboardingFlowRenderer — renders the clinic's customized onboarding flow
// ---------------------------------------------------------------------------

interface OrgOnboardingFlowRendererProps {
  orgId: string;
  orgName: string | null;
  steps: OnboardingStepNode[];
  onCancel: () => void;
  onComplete: () => void;
}

/**
 * Phase 31 Plan 06 D-10: org-customized onboarding render path.
 *
 * Reuses the same card chrome, ProgressIndicator, and existing step-form
 * contents (medication/consent/etc.) as the DEFAULT_STEPS consumer path.
 * Only the step ordering, welcome/intro_card text, and TOTAL count differ.
 *
 * Skipped steps (step.skip === true for skippable types) are advanced
 * automatically on render. Mandatory steps (medication, consent) ignore
 * the skip flag regardless.
 */
function OrgOnboardingFlowRenderer({
  orgName,
  steps,
  onCancel,
  onComplete,
}: OrgOnboardingFlowRendererProps) {
  const setUser = useStore((s) => s.setUser);
  const upsertWeight = useStore((s) => s.upsertWeight);
  const toast = useToast();

  // Filter to rendered steps (skip flag honoured for non-mandatory types)
  const SKIPPABLE_TYPES = new Set(['welcome', 'intro_card', 'goals', 'body_stats', 'doctor_invite', 'tour']);
  const MANDATORY_TYPES = new Set(['medication', 'consent']);

  const renderedSteps = steps.filter((s) => {
    // Mandatory steps ALWAYS render regardless of skip flag
    if (MANDATORY_TYPES.has(s.type)) return true;
    // Skippable types: omit when skip=true
    if (SKIPPABLE_TYPES.has(s.type) && s.skip === true) return false;
    return true;
  });

  const TOTAL = renderedSteps.length;

  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState<DraftState>({
    name: '',
    units: 'metric',
    medication: '',
    dose: '',
    doseUnit: 'mg',
    startDate: todayStr(),
    weight: '',
    height: '',
    age: '',
    sex: 'male',
    bodyFat: '',
    goalWeight: '',
    goal: 'fat-loss',
    protein: '',
    injectionDay: 0,
    activity: 'light',
    lifting: 'none',
  });

  const wU = draft.units === 'metric' ? 'kg' : 'lb';
  const hU = draft.units === 'metric' ? 'cm' : 'in';

  const update = (patch: Partial<DraftState>): void => setDraft((d) => ({ ...d, ...patch }));

  const next = (): void => {
    const current = renderedSteps[step];
    if (!current) return;
    if (current.type === 'medication' && !draft.medication) {
      return toast('Please pick your medication', 'error');
    }
    if (current.type === 'body_stats' && !draft.weight) {
      return toast('Please enter your weight', 'error');
    }
    track('onboarding_step_completed', { step, org_flow: true });
    setStep((s) => Math.min(TOTAL - 1, s + 1));
  };
  const back = (): void => setStep((s) => Math.max(0, s - 1));

  const complete = (): void => {
    const weight = parseFloat(draft.weight) || 80;
    // Phase 32 Plan 32-03 (I18N-02 / D-12): mirror the consumer-flow signup
    // locale derivation here so org-invited Spanish patients also land at
    // metric/kg defaults + a persisted profiles.locale row.
    const { locale: signupLocale, units: signupUnits } = deriveSignupLocaleAndUnits(draft.units);
    const proteinFromBody = Math.round(weight * (signupUnits === 'metric' ? 1.6 : 0.8));
    const calorieBase = Math.round(weight * (signupUnits === 'metric' ? 22 : 10));
    const goalWeight = parseFloat(draft.goalWeight) || weight - 10;
    const protein = parseInt(draft.protein) || proteinFromBody;

    const user: User = {
      name: draft.name.trim() || 'Friend',
      units: signupUnits,
      medication: (draft.medication || 'ozempic') as MedicationId,
      dose: draft.dose || '0.25',
      doseUnit: draft.doseUnit,
      startDate: draft.startDate,
      startWeight: weight,
      height: parseFloat(draft.height) || null,
      age: parseInt(draft.age) || null,
      sex: draft.sex,
      bodyFat: parseFloat(draft.bodyFat) || null,
      goalWeight,
      goal: draft.goal,
      proteinTarget: protein,
      calorieTarget: calorieBase,
      fiberTarget: 30,
      waterTarget: 8,
      injectionDay: draft.injectionDay,
      activityLevel: draft.activity,
      liftingLevel: draft.lifting,
      createdAt: new Date().toISOString(),
      locale: signupLocale,
    };
    setUser(user);
    if (parseFloat(draft.weight)) {
      upsertWeight({
        date: draft.startDate,
        weight: parseFloat(draft.weight),
        bodyFat: parseFloat(draft.bodyFat) || null,
        ts: Date.now(),
      });
    }
    track('onboarding_completed', { totalSteps: TOTAL, org_flow: true });
    // Phase 31 Plan 06 D-13: mark_onboarding_complete SECDEF — best-effort
    void (async () => {
      try {
        const { data: authData } = await supabase.auth.getUser();
        if (authData?.user && !authData.user.is_anonymous) {
          await supabase.rpc('mark_onboarding_complete');
          await supabase
            .from('profiles')
            .update({ locale: signupLocale })
            .eq('id', authData.user.id);
        }
      } catch (err) {
        console.warn('[OrgOnboardingFlowRenderer] mark_onboarding_complete failed:', err);
      }
    })();
    onComplete();
  };

  const currentStep = renderedSteps[step];

  return (
    <div className="min-h-screen bg-[var(--color-bg)] flex items-center justify-center p-4 md:p-6 safe-top safe-bottom">
      <div className="w-full max-w-[560px]">
        <div className="bg-[var(--color-surface)] rounded-[28px] border border-[var(--color-border)] shadow-lg overflow-hidden">
          {/* Full-bleed illustration banner */}
          <div className="relative h-[180px] md:h-[200px] bg-gradient-to-br from-[var(--color-primary-soft)] to-[var(--color-surface-elevated)] overflow-hidden">
            <AnimatePresence mode="wait">
              <motion.div
                key={step}
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.97 }}
                transition={{ duration: 0.4, ease: [0.25, 1, 0.5, 1] }}
                className="absolute inset-0 flex items-center justify-center"
              >
                {currentStep?.type === 'welcome' && <OnboardWelcome className="w-full max-w-[320px]" />}
                {currentStep?.type === 'intro_card' && <OnboardSnapshot className="w-full max-w-[320px]" />}
                {currentStep?.type === 'medication' && <OnboardMedication className="w-full max-w-[320px]" />}
                {currentStep?.type === 'goals' && <OnboardGoals className="w-full max-w-[320px]" />}
                {currentStep?.type === 'body_stats' && <OnboardBody className="w-full max-w-[320px]" />}
                {currentStep?.type === 'consent' && <OnboardReady className="w-full max-w-[320px]" />}
                {currentStep?.type === 'doctor_invite' && <OnboardRoutine className="w-full max-w-[320px]" />}
                {currentStep?.type === 'tour' && <OnboardReady className="w-full max-w-[320px]" />}
              </motion.div>
            </AnimatePresence>
          </div>

          <div className="p-6 md:p-8">
            <ProgressIndicator step={step} total={TOTAL} />
            <AnimatePresence mode="wait">
              <motion.div
                key={step}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.2 }}
              >
                {currentStep?.type === 'welcome' && (
                  <div className="space-y-4">
                    <div>
                      <h1 className="text-[26px] font-bold tracking-tight">
                        {currentStep.custom?.title ?? `Welcome to ${orgName ?? 'your clinic'}`}
                      </h1>
                      <p className="text-[14px] text-[var(--color-text-secondary)] mt-1">
                        {currentStep.custom?.body ?? 'Your treatment journey starts here.'}
                      </p>
                    </div>
                    <Input
                      label="Your name"
                      placeholder="First name"
                      autoComplete="given-name"
                      value={draft.name}
                      onChange={(e) => update({ name: e.target.value })}
                    />
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--color-text-secondary)] mb-2">
                        Units
                      </p>
                      <UnitToggle value={draft.units} onChange={(u) => update({ units: u })} />
                    </div>
                  </div>
                )}

                {currentStep?.type === 'intro_card' && (
                  <div className="space-y-4">
                    <div>
                      <h1 className="text-[26px] font-bold tracking-tight">
                        {currentStep.custom?.title ?? 'Getting started'}
                      </h1>
                      {currentStep.custom?.body && (
                        <p className="text-[14px] text-[var(--color-text-secondary)] mt-1">
                          {currentStep.custom.body}
                        </p>
                      )}
                    </div>
                    {currentStep.custom?.image_url && (
                      <img
                        src={currentStep.custom.image_url}
                        alt={currentStep.custom.title ?? 'Introduction'}
                        className="w-full rounded-xl object-cover max-h-48"
                      />
                    )}
                  </div>
                )}

                {currentStep?.type === 'medication' && (
                  <div className="space-y-4">
                    <div>
                      <h1 className="text-[26px] font-bold tracking-tight">Your medication</h1>
                      <p className="text-[14px] text-[var(--color-text-secondary)] mt-1">
                        We&apos;ll tailor everything to your med.
                      </p>
                    </div>
                    <Select
                      label="GLP-1 medication"
                      value={draft.medication}
                      onChange={(e) => update({ medication: e.target.value as MedicationId })}
                    >
                      <option value="">Select…</option>
                      <option value="ozempic">Ozempic (semaglutide)</option>
                      <option value="wegovy">Wegovy (semaglutide)</option>
                      <option value="mounjaro">Mounjaro (tirzepatide)</option>
                      <option value="zepbound">Zepbound (tirzepatide)</option>
                      <option value="rybelsus">Rybelsus (oral semaglutide)</option>
                      <option value="saxenda">Saxenda (liraglutide)</option>
                      <option value="trulicity">Trulicity (dulaglutide)</option>
                      <option value="retatrutide">Retatrutide</option>
                      <option value="compound-sema">Compounded semaglutide</option>
                      <option value="compound-tirz">Compounded tirzepatide</option>
                    </Select>
                    <div className="grid grid-cols-2 gap-3">
                      <Input
                        label="Current dose"
                        inputMode="decimal"
                        placeholder="0.5"
                        value={draft.dose}
                        onChange={(e) => update({ dose: e.target.value })}
                      />
                      <Select
                        label="Unit"
                        value={draft.doseUnit}
                        onChange={(e) => update({ doseUnit: e.target.value as DoseUnit })}
                      >
                        <option value="mg">mg</option>
                        <option value="units">units</option>
                        <option value="ml">ml</option>
                      </Select>
                    </div>
                    <Input
                      label="Start date"
                      type="date"
                      value={draft.startDate}
                      onChange={(e) => update({ startDate: e.target.value })}
                    />
                  </div>
                )}

                {currentStep?.type === 'goals' && (
                  <div className="space-y-4">
                    <div>
                      <h1 className="text-[26px] font-bold tracking-tight">Your goals</h1>
                      <p className="text-[14px] text-[var(--color-text-secondary)] mt-1">
                        Where are you headed?
                      </p>
                    </div>
                    <Input
                      label={`Target weight (${wU})`}
                      type="number"
                      step="0.1"
                      inputMode="decimal"
                      value={draft.goalWeight}
                      onChange={(e) => update({ goalWeight: e.target.value })}
                    />
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--color-text-secondary)] mb-2">
                        Primary goal
                      </p>
                      <PillGroup>
                        {(['fat-loss', 'recomp', 'health', 'maintenance'] as const).map((g) => (
                          <Pill
                            key={g}
                            active={draft.goal === g}
                            onClick={() => update({ goal: g })}
                          >
                            {g === 'fat-loss'
                              ? 'Fat loss'
                              : g === 'recomp'
                                ? 'Recomp'
                                : g === 'health'
                                  ? 'Health markers'
                                  : 'Maintenance'}
                          </Pill>
                        ))}
                      </PillGroup>
                    </div>
                  </div>
                )}

                {currentStep?.type === 'body_stats' && (
                  <div className="space-y-4">
                    <div>
                      <h1 className="text-[26px] font-bold tracking-tight">Your starting point</h1>
                      <p className="text-[14px] text-[var(--color-text-secondary)] mt-1">
                        For real progress tracking.
                      </p>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <Input
                        label={`Weight (${wU})`}
                        type="number"
                        step="0.1"
                        inputMode="decimal"
                        value={draft.weight}
                        onChange={(e) => update({ weight: e.target.value })}
                      />
                      <Input
                        label={`Height (${hU})`}
                        type="number"
                        step="0.1"
                        inputMode="decimal"
                        value={draft.height}
                        onChange={(e) => update({ height: e.target.value })}
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <Input
                        label="Age"
                        type="number"
                        inputMode="numeric"
                        value={draft.age}
                        onChange={(e) => update({ age: e.target.value })}
                      />
                      <Select
                        label="Sex at birth"
                        value={draft.sex}
                        onChange={(e) => update({ sex: e.target.value as Sex })}
                      >
                        <option value="male">Male</option>
                        <option value="female">Female</option>
                      </Select>
                    </div>
                  </div>
                )}

                {currentStep?.type === 'consent' && (
                  <div className="space-y-4">
                    <div>
                      <h1 className="text-[26px] font-bold tracking-tight">Consent &amp; disclaimer</h1>
                      <p className="text-[14px] text-[var(--color-text-secondary)] mt-1">
                        Please review before continuing.
                      </p>
                    </div>
                    <div className="rounded-xl bg-[var(--color-surface-elevated)] border border-[var(--color-border)] p-4 text-[13px] text-[var(--color-text-secondary)] space-y-2">
                      <p>LeanShot is a health-tracking app, not a medical device or provider.</p>
                      <p>All data is stored locally on your device unless you explicitly enable cloud sync.</p>
                      <p>Consult your doctor before making changes to your treatment plan.</p>
                    </div>
                  </div>
                )}

                {currentStep?.type === 'doctor_invite' && (
                  <div className="space-y-4">
                    <div>
                      <h1 className="text-[26px] font-bold tracking-tight">Connect your doctor</h1>
                      <p className="text-[14px] text-[var(--color-text-secondary)] mt-1">
                        Share progress with your care team.
                      </p>
                    </div>
                    <div className="rounded-xl bg-[var(--color-surface-elevated)] border border-[var(--color-border)] p-4 text-[13px] text-[var(--color-text-secondary)]">
                      <p>You can invite your doctor from the Settings page once you are set up.</p>
                    </div>
                  </div>
                )}

                {currentStep?.type === 'tour' && (
                  <div className="space-y-4">
                    <div>
                      <h1 className="text-[26px] font-bold tracking-tight">Quick tour</h1>
                      <p className="text-[14px] text-[var(--color-text-secondary)] mt-1">
                        Here is what LeanShot can do for you.
                      </p>
                    </div>
                    <div className="rounded-xl bg-[var(--color-surface-elevated)] border border-[var(--color-border)] p-4 text-[13px] text-[var(--color-text-secondary)]">
                      <p>Track injections, body metrics, nutrition, and mood — all in one place.</p>
                    </div>
                  </div>
                )}
              </motion.div>
            </AnimatePresence>

            <div className="flex gap-2 mt-7">
              {step === 0 ? (
                <Button variant="ghost" onClick={onCancel} className="flex-1">
                  Cancel
                </Button>
              ) : (
                <Button
                  variant="ghost"
                  onClick={back}
                  leadingIcon={<ArrowLeft className="size-4" />}
                  className="flex-1"
                >
                  Back
                </Button>
              )}
              {step < TOTAL - 1 ? (
                <Button
                  onClick={next}
                  trailingIcon={<ArrowRight className="size-4" />}
                  className="flex-1"
                >
                  Continue
                </Button>
              ) : (
                <Button
                  onClick={complete}
                  trailingIcon={<Check className="size-4" />}
                  className="flex-1"
                >
                  Open dashboard
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function SnapshotTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-[var(--color-surface-elevated)] border border-[var(--color-border)] p-3">
      <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--color-text-tertiary)]">
        {label}
      </div>
      <div className="text-[14px] font-semibold mt-0.5 truncate">{value}</div>
    </div>
  );
}

function NextStep({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex items-start gap-3 rounded-xl bg-[var(--color-surface-elevated)] border border-[var(--color-border)] p-3.5">
      <span className="size-8 rounded-xl bg-[var(--color-primary-soft)] text-[var(--color-primary)] inline-flex items-center justify-center shrink-0">
        <Check className="size-4" strokeWidth={2.4} />
      </span>
      <div className="min-w-0">
        <p className="text-[14px] font-semibold leading-snug">{title}</p>
        <p className="text-[12px] text-[var(--color-text-secondary)] leading-snug">{body}</p>
      </div>
    </div>
  );
}
