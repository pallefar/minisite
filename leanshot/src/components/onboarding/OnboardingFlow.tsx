import { AnimatePresence, motion } from 'framer-motion';
import i18next from 'i18next';
import { ArrowLeft, ArrowRight, Check } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
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
import {
  activityLabel,
  doseUnitLabel,
  goalLabel,
  injectionDayLabel,
  injectionDayShortLabel,
  liftingLabel,
  medicationLabel,
  sexLabel,
} from '@/lib/i18n/onboarding-labels';
import { useConsumerOnboardingFlow } from '@/lib/onboarding-builder/use-consumer-onboarding-flow';
import { useOrgOnboardingFlow } from '@/lib/onboarding-builder/use-org-onboarding-flow';
import { medLabel } from '@/lib/pharmacology';
import { setNewsletterOptIn } from '@/lib/rag/newsletter-api';
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
import { ConsumerOnboardingRenderer } from './ConsumerOnboardingRenderer';
import { ProgressIndicator } from './ProgressIndicator';
import { NewsletterOptInStep } from './steps/NewsletterOptInStep';
import { UnitToggle } from './UnitToggle';

// Phase 60 Plan 60-12 (RAG-08): newsletter opt-in write at onboarding completion.
// Phase 60 Plan 60-12 (RAG-08): optional newsletter opt-in step (step 7).

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
  // Phase 60 Plan 60-12 (RAG-08): CAN-SPAM affirmative opt-in MUST default false.
  newsletterOptIn: boolean;
  protein: string;
  injectionDay: number;
  activity: ActivityLevel;
  lifting: LiftingLevel;
}

// Phase 60 Plan 60-12: bumped from 8 to 9 to accommodate NewsletterOptInStep
// inserted between snapshot (6) and ready (8). New order: 0-6, 7=newsletter, 8=ready.
const TOTAL_STEPS = 9;

export function OnboardingFlow({ onCancel, onComplete }: OnboardingFlowProps) {
  // Phase 32 Plan 32-07 (I18N-01) — hreflang tags on the onboarding entry
  // point so search engines index the EN + ES variants of `/onboarding`.
  useHreflangTags();

  const { t } = useTranslation(['onboarding', 'common']);

  // Phase 31 Plan 06 D-10: render-branch hook — determines whether to show
  // the org's saved flow (invited patient) or the consumer DEFAULT_STEPS path.
  const flowState = useOrgOnboardingFlow();
  // Phase 34 Plan 34-06 — render-branch into the consumer-renderer when the
  // consumer `onboarding_flows` row carries a populated config. Empty config
  // (the seeded control row) falls through to the legacy DEFAULT_STEPS body
  // below so we don't regress users while admins seed the new flow.
  const consumerFlowState = useConsumerOnboardingFlow();

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
    // Phase 60 Plan 60-12: CAN-SPAM affirmative opt-in — MUST default false.
    newsletterOptIn: false,
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

  // Phase 34 Plan 34-06: consumer config-driven renderer. Only switches in when
  // the new consumer `onboarding_flows.config` carries at least one step — the
  // seeded empty control row continues to fall through to the legacy
  // DEFAULT_STEPS body so we never regress sign-up while the new flow is being
  // built. The renderer owns its own DEFAULT_STEPS fallback for status='preview'
  // on the /onboard surface.
  if (
    (consumerFlowState.status === 'consumer' || consumerFlowState.status === 'preview') &&
    consumerFlowState.flow &&
    consumerFlowState.flow.config.length > 0
  ) {
    return <ConsumerOnboardingRenderer flow={consumerFlowState.flow} onComplete={onComplete} />;
  }

  // Consumer / default: fall through to DEFAULT_STEPS render below
  // ────────────────────────────────────────────────────────────────────────

  const update = (patch: Partial<DraftState>): void => setDraft((d) => ({ ...d, ...patch }));

  const next = (): void => {
    if (step === 0) return; // Step 0 advances exclusively via handleAcknowledge (D-09)
    if (step === 1 && !draft.name.trim())
      return toast(t('onboarding:error.name_required'), 'error');
    if (step === 2 && !draft.medication)
      return toast(t('onboarding:error.medication_required'), 'error');
    if (step === 3 && !draft.weight) return toast(t('onboarding:error.weight_required'), 'error');
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
    if (!weight) return toast(t('onboarding:error.weight_required'), 'error');
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

          // Phase 60 Plan 60-12 (RAG-08): newsletter opt-in persistence.
          // ONLY write when user explicitly opted in (newsletterOptIn=true).
          // No DB write for default-false case — DB default opted_in=false
          // means no row is needed until the user opts in (avoids row spam).
          if (draft.newsletterOptIn) {
            try {
              await setNewsletterOptIn({
                userId: authData.user.id,
                optedIn: true,
                topicTags: [],
              });
            } catch (newsletterErr) {
              // Newsletter opt-in failure MUST NOT block onboarding completion.
              // User can opt in via Settings later.
              console.warn(
                '[OnboardingFlow] newsletter opt-in failed (best-effort):',
                newsletterErr,
              );
              toast(t('common:error.generic'), 'info');
            }
          }
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
                      <h1 className="text-[26px] font-bold tracking-tight">
                        {t('onboarding:step.disclaimer.title')}
                      </h1>
                      <p className="text-[14px] text-[var(--color-text-secondary)] mt-1">
                        {t('onboarding:step.disclaimer.subtitle')}
                      </p>
                    </div>
                    <DisclaimerBody onAcknowledge={handleAcknowledge} />
                  </div>
                )}

                {step === 1 && (
                  <div className="space-y-4">
                    <div>
                      <h1 className="text-[26px] font-bold tracking-tight">
                        {t('onboarding:step.welcome.title_prefix')}{' '}
                        <span className="font-display italic font-normal text-[var(--color-primary)]">
                          {t('onboarding:step.welcome.title_accent')}
                        </span>
                      </h1>
                      <p className="text-[14px] text-[var(--color-text-secondary)] mt-1">
                        {t('onboarding:step.welcome.subtitle')}
                      </p>
                    </div>
                    <Input
                      label={t('onboarding:step.welcome.name_label')}
                      placeholder={t('onboarding:step.welcome.name_placeholder')}
                      autoComplete="given-name"
                      value={draft.name}
                      onChange={(e) => update({ name: e.target.value })}
                    />
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--color-text-secondary)] mb-2">
                        {t('onboarding:step.welcome.units_label')}
                      </p>
                      <UnitToggle value={draft.units} onChange={(u) => update({ units: u })} />
                    </div>
                  </div>
                )}

                {step === 2 && (
                  <div className="space-y-4">
                    <div>
                      <h1 className="text-[26px] font-bold tracking-tight">
                        {t('onboarding:step.medication.title')}
                      </h1>
                      <p className="text-[14px] text-[var(--color-text-secondary)] mt-1">
                        {t('onboarding:step.medication.subtitle')}
                      </p>
                    </div>
                    <Select
                      label={t('onboarding:step.medication.select_label')}
                      value={draft.medication}
                      onChange={(e) => update({ medication: e.target.value as MedicationId })}
                    >
                      <option value="">{t('onboarding:step.medication.select_placeholder')}</option>
                      {(
                        [
                          'ozempic',
                          'wegovy',
                          'mounjaro',
                          'zepbound',
                          'rybelsus',
                          'saxenda',
                          'trulicity',
                          'retatrutide',
                          'compound-sema',
                          'compound-tirz',
                        ] as MedicationId[]
                      ).map((id) => (
                        <option key={id} value={id}>
                          {medicationLabel(t, id)}
                        </option>
                      ))}
                    </Select>
                    <div className="grid grid-cols-2 gap-3">
                      <Input
                        label={t('onboarding:step.medication.dose_label')}
                        inputMode="decimal"
                        placeholder="0.5"
                        value={draft.dose}
                        onChange={(e) => update({ dose: e.target.value })}
                      />
                      <Select
                        label={t('onboarding:step.medication.unit_label')}
                        value={draft.doseUnit}
                        onChange={(e) => update({ doseUnit: e.target.value as DoseUnit })}
                      >
                        {(['mg', 'units', 'ml'] as DoseUnit[]).map((u) => (
                          <option key={u} value={u}>
                            {doseUnitLabel(t, u)}
                          </option>
                        ))}
                      </Select>
                    </div>
                    <Input
                      label={t('onboarding:step.medication.start_date_label')}
                      type="date"
                      value={draft.startDate}
                      onChange={(e) => update({ startDate: e.target.value })}
                    />
                  </div>
                )}

                {step === 3 && (
                  <div className="space-y-4">
                    <div>
                      <h1 className="text-[26px] font-bold tracking-tight">
                        {t('onboarding:step.body.title')}
                      </h1>
                      <p className="text-[14px] text-[var(--color-text-secondary)] mt-1">
                        {t('onboarding:step.body.subtitle')}
                      </p>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <Input
                        label={t('onboarding:step.body.weight_label', { unit: wU })}
                        type="number"
                        step="0.1"
                        inputMode="decimal"
                        value={draft.weight}
                        onChange={(e) => update({ weight: e.target.value })}
                      />
                      <Input
                        label={t('onboarding:step.body.height_label', { unit: hU })}
                        type="number"
                        step="0.1"
                        inputMode="decimal"
                        value={draft.height}
                        onChange={(e) => update({ height: e.target.value })}
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <Input
                        label={t('onboarding:step.body.age_label')}
                        type="number"
                        inputMode="numeric"
                        value={draft.age}
                        onChange={(e) => update({ age: e.target.value })}
                      />
                      <Select
                        label={t('onboarding:step.body.sex_label')}
                        value={draft.sex}
                        onChange={(e) => update({ sex: e.target.value as Sex })}
                      >
                        {(['male', 'female'] as Sex[]).map((s) => (
                          <option key={s} value={s}>
                            {sexLabel(t, s)}
                          </option>
                        ))}
                      </Select>
                    </div>
                    <Input
                      label={t('onboarding:step.body.body_fat_label')}
                      type="number"
                      step="0.1"
                      inputMode="decimal"
                      value={draft.bodyFat}
                      onChange={(e) => update({ bodyFat: e.target.value })}
                      hint={t('onboarding:step.body.body_fat_hint')}
                    />
                  </div>
                )}

                {step === 4 && (
                  <div className="space-y-4">
                    <div>
                      <h1 className="text-[26px] font-bold tracking-tight">
                        {t('onboarding:step.goals.title')}
                      </h1>
                      <p className="text-[14px] text-[var(--color-text-secondary)] mt-1">
                        {t('onboarding:step.goals.subtitle')}
                      </p>
                    </div>
                    <Input
                      label={t('onboarding:step.goals.target_weight_label', { unit: wU })}
                      type="number"
                      step="0.1"
                      inputMode="decimal"
                      value={draft.goalWeight}
                      onChange={(e) => update({ goalWeight: e.target.value })}
                    />
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--color-text-secondary)] mb-2">
                        {t('onboarding:step.goals.primary_goal_label')}
                      </p>
                      <PillGroup>
                        {(['fat-loss', 'recomp', 'health', 'maintenance'] as const).map((g) => (
                          <Pill
                            key={g}
                            active={draft.goal === g}
                            onClick={() => update({ goal: g })}
                          >
                            {goalLabel(t, g)}
                          </Pill>
                        ))}
                      </PillGroup>
                    </div>
                    <Input
                      label={t('onboarding:step.goals.protein_label')}
                      type="number"
                      inputMode="numeric"
                      placeholder={t('onboarding:step.goals.protein_placeholder')}
                      value={draft.protein}
                      onChange={(e) => update({ protein: e.target.value })}
                      hint={t('onboarding:step.goals.protein_hint')}
                    />
                  </div>
                )}

                {step === 5 && (
                  <div className="space-y-4">
                    <div>
                      <h1 className="text-[26px] font-bold tracking-tight">
                        {t('onboarding:step.routine.title')}
                      </h1>
                      <p className="text-[14px] text-[var(--color-text-secondary)] mt-1">
                        {t('onboarding:step.routine.subtitle')}
                      </p>
                    </div>
                    <Select
                      label={t('onboarding:step.routine.injection_day_label')}
                      value={draft.injectionDay}
                      onChange={(e) => update({ injectionDay: parseInt(e.target.value) })}
                    >
                      {[0, 1, 2, 3, 4, 5, 6].map((i) => (
                        <option key={i} value={i}>
                          {injectionDayLabel(t, i)}
                        </option>
                      ))}
                    </Select>
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--color-text-secondary)] mb-2">
                        {t('onboarding:step.routine.activity_label')}
                      </p>
                      <PillGroup>
                        {(['sedentary', 'light', 'moderate', 'very'] as const).map((a) => (
                          <Pill
                            key={a}
                            active={draft.activity === a}
                            onClick={() => update({ activity: a })}
                          >
                            {activityLabel(t, a)}
                          </Pill>
                        ))}
                      </PillGroup>
                    </div>
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--color-text-secondary)] mb-2">
                        {t('onboarding:step.routine.lifting_label')}
                      </p>
                      <PillGroup>
                        {(['none', 'beginner', 'intermediate', 'advanced'] as const).map((l) => (
                          <Pill
                            key={l}
                            active={draft.lifting === l}
                            onClick={() => update({ lifting: l })}
                          >
                            {liftingLabel(t, l)}
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
                        {t('onboarding:step.snapshot.title_prefix')}{' '}
                        <span className="font-display italic font-normal text-[var(--color-primary)]">
                          {t('onboarding:step.snapshot.title_accent')}
                        </span>
                      </h1>
                      <p className="text-[14px] text-[var(--color-text-secondary)] mt-1">
                        {t('onboarding:step.snapshot.subtitle')}
                      </p>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <SnapshotTile
                        label={t('onboarding:step.snapshot.tile_name')}
                        value={draft.name || '—'}
                      />
                      <SnapshotTile
                        label={t('onboarding:step.snapshot.tile_medication')}
                        value={draft.medication ? medLabel(draft.medication as MedicationId) : '—'}
                      />
                      <SnapshotTile
                        label={t('onboarding:step.snapshot.tile_dose')}
                        value={draft.dose ? `${draft.dose} ${draft.doseUnit}` : '—'}
                      />
                      <SnapshotTile
                        label={t('onboarding:step.snapshot.tile_started')}
                        value={draft.startDate}
                      />
                      <SnapshotTile
                        label={t('onboarding:step.snapshot.tile_weight')}
                        value={draft.weight ? `${draft.weight} ${wU}` : '—'}
                      />
                      <SnapshotTile
                        label={t('onboarding:step.snapshot.tile_goal')}
                        value={draft.goalWeight ? `${draft.goalWeight} ${wU}` : '—'}
                      />
                      <SnapshotTile
                        label={t('onboarding:step.snapshot.tile_protein')}
                        value={
                          draft.protein
                            ? `${draft.protein} g`
                            : t('onboarding:step.snapshot.protein_auto')
                        }
                      />
                      <SnapshotTile
                        label={t('onboarding:step.snapshot.tile_injection_day')}
                        value={injectionDayShortLabel(t, draft.injectionDay)}
                      />
                    </div>
                  </div>
                )}

                {/* Phase 60 Plan 60-12 (RAG-08): newsletter opt-in step (7).
                    Inserted AFTER snapshot review (6) and BEFORE final ready step (8).
                    CAN-SPAM: checkbox defaults unchecked via draft.newsletterOptIn=false.
                    Step is OPTIONAL — user may skip via Continue without checking. */}
                {step === 7 && (
                  <NewsletterOptInStep
                    checked={draft.newsletterOptIn}
                    onChange={(v) => update({ newsletterOptIn: v })}
                    onNext={next}
                    onBack={back}
                  />
                )}

                {step === 8 && (
                  <div className="space-y-4">
                    <div className="flex items-start gap-3">
                      <AIAvatar size={56} className="shrink-0" />
                      <div>
                        <h1 className="text-[26px] font-bold tracking-tight">
                          {t('onboarding:step.ready.title_prefix')}{' '}
                          <span className="font-display italic font-normal text-[var(--color-primary)]">
                            {t('onboarding:step.ready.title_accent')}
                          </span>
                        </h1>
                        <p className="text-[14px] text-[var(--color-text-secondary)] mt-1">
                          {t('onboarding:step.ready.subtitle')}
                        </p>
                      </div>
                    </div>
                    <div className="space-y-2.5">
                      <NextStep
                        title={t('onboarding:step.ready.next1_title')}
                        body={t('onboarding:step.ready.next1_body')}
                      />
                      <NextStep
                        title={t('onboarding:step.ready.next2_title')}
                        body={t('onboarding:step.ready.next2_body')}
                      />
                      <NextStep
                        title={t('onboarding:step.ready.next3_title')}
                        body={t('onboarding:step.ready.next3_body')}
                      />
                    </div>
                    {/* Phase 5 D-03: post-onboarding contextual prompt — high-intent
                        "save your data" moment. Anonymous-by-default flow continues if
                        user dismisses; permanent users skip this entirely. */}
                    <div className="rounded-xl bg-[var(--color-primary-soft)] border border-[var(--color-primary)] p-3.5 mt-3">
                      <p className="text-[13px] font-semibold">
                        {t('onboarding:step.ready.save_title')}
                      </p>
                      <p className="text-[12px] text-[var(--color-text-secondary)] mt-0.5">
                        {t('onboarding:step.ready.save_body')}
                      </p>
                      <Button
                        size="sm"
                        variant="primary"
                        className="mt-2.5"
                        onClick={() => {
                          window.location.hash = '#/auth/signup';
                        }}
                      >
                        {t('onboarding:step.ready.save_cta')}
                      </Button>
                    </div>
                  </div>
                )}
              </motion.div>
            </AnimatePresence>

            {/* Phase 60: step 7 = NewsletterOptInStep — renders its OWN nav buttons */}
            {step === 0 || step === 7 ? null : (
              <div className="flex gap-2 mt-7">
                {step === 1 ? (
                  <Button variant="ghost" onClick={onCancel} className="flex-1">
                    {t('common:action.cancel')}
                  </Button>
                ) : (
                  <Button
                    variant="ghost"
                    onClick={back}
                    leadingIcon={<ArrowLeft className="size-4" />}
                    className="flex-1"
                  >
                    {t('onboarding:nav.back')}
                  </Button>
                )}
                {step < TOTAL_STEPS - 1 ? (
                  <Button
                    onClick={next}
                    trailingIcon={<ArrowRight className="size-4" />}
                    className="flex-1"
                  >
                    {t('common:action.continue')}
                  </Button>
                ) : (
                  <Button
                    onClick={complete}
                    trailingIcon={<Check className="size-4" />}
                    className="flex-1"
                  >
                    {t('onboarding:nav.open_dashboard')}
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
  const { t } = useTranslation(['onboarding', 'common']);
  const setUser = useStore((s) => s.setUser);
  const upsertWeight = useStore((s) => s.upsertWeight);
  const toast = useToast();

  // Filter to rendered steps (skip flag honoured for non-mandatory types)
  const SKIPPABLE_TYPES = new Set([
    'welcome',
    'intro_card',
    'goals',
    'body_stats',
    'doctor_invite',
    'tour',
  ]);
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
    // OrgOnboardingFlowRenderer: newsletter opt-in defaults false (CAN-SPAM).
    newsletterOptIn: false,
  });

  const wU = draft.units === 'metric' ? 'kg' : 'lb';
  const hU = draft.units === 'metric' ? 'cm' : 'in';

  const update = (patch: Partial<DraftState>): void => setDraft((d) => ({ ...d, ...patch }));

  const next = (): void => {
    const current = renderedSteps[step];
    if (!current) return;
    if (current.type === 'medication' && !draft.medication) {
      return toast(t('onboarding:error.medication_required'), 'error');
    }
    if (current.type === 'body_stats' && !draft.weight) {
      return toast(t('onboarding:error.weight_required'), 'error');
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
                {currentStep?.type === 'welcome' && (
                  <OnboardWelcome className="w-full max-w-[320px]" />
                )}
                {currentStep?.type === 'intro_card' && (
                  <OnboardSnapshot className="w-full max-w-[320px]" />
                )}
                {currentStep?.type === 'medication' && (
                  <OnboardMedication className="w-full max-w-[320px]" />
                )}
                {currentStep?.type === 'goals' && <OnboardGoals className="w-full max-w-[320px]" />}
                {currentStep?.type === 'body_stats' && (
                  <OnboardBody className="w-full max-w-[320px]" />
                )}
                {currentStep?.type === 'consent' && (
                  <OnboardReady className="w-full max-w-[320px]" />
                )}
                {currentStep?.type === 'doctor_invite' && (
                  <OnboardRoutine className="w-full max-w-[320px]" />
                )}
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
                        {currentStep.custom?.title ??
                          t('onboarding:org.welcome_title', {
                            orgName: orgName ?? t('onboarding:org.your_clinic'),
                          })}
                      </h1>
                      <p className="text-[14px] text-[var(--color-text-secondary)] mt-1">
                        {currentStep.custom?.body ?? t('onboarding:org.welcome_subtitle')}
                      </p>
                    </div>
                    <Input
                      label={t('onboarding:step.welcome.name_label')}
                      placeholder={t('onboarding:step.welcome.name_placeholder')}
                      autoComplete="given-name"
                      value={draft.name}
                      onChange={(e) => update({ name: e.target.value })}
                    />
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--color-text-secondary)] mb-2">
                        {t('onboarding:step.welcome.units_label')}
                      </p>
                      <UnitToggle value={draft.units} onChange={(u) => update({ units: u })} />
                    </div>
                  </div>
                )}

                {currentStep?.type === 'intro_card' && (
                  <div className="space-y-4">
                    <div>
                      <h1 className="text-[26px] font-bold tracking-tight">
                        {currentStep.custom?.title ?? t('onboarding:org.intro_card_title')}
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
                        alt={currentStep.custom.title ?? t('onboarding:org.intro_card_img_alt')}
                        className="w-full rounded-xl object-cover max-h-48"
                      />
                    )}
                  </div>
                )}

                {currentStep?.type === 'medication' && (
                  <div className="space-y-4">
                    <div>
                      <h1 className="text-[26px] font-bold tracking-tight">
                        {t('onboarding:step.medication.title')}
                      </h1>
                      <p className="text-[14px] text-[var(--color-text-secondary)] mt-1">
                        {t('onboarding:step.medication.subtitle')}
                      </p>
                    </div>
                    <Select
                      label={t('onboarding:step.medication.select_label')}
                      value={draft.medication}
                      onChange={(e) => update({ medication: e.target.value as MedicationId })}
                    >
                      <option value="">{t('onboarding:step.medication.select_placeholder')}</option>
                      {(
                        [
                          'ozempic',
                          'wegovy',
                          'mounjaro',
                          'zepbound',
                          'rybelsus',
                          'saxenda',
                          'trulicity',
                          'retatrutide',
                          'compound-sema',
                          'compound-tirz',
                        ] as MedicationId[]
                      ).map((id) => (
                        <option key={id} value={id}>
                          {medicationLabel(t, id)}
                        </option>
                      ))}
                    </Select>
                    <div className="grid grid-cols-2 gap-3">
                      <Input
                        label={t('onboarding:step.medication.dose_label')}
                        inputMode="decimal"
                        placeholder="0.5"
                        value={draft.dose}
                        onChange={(e) => update({ dose: e.target.value })}
                      />
                      <Select
                        label={t('onboarding:step.medication.unit_label')}
                        value={draft.doseUnit}
                        onChange={(e) => update({ doseUnit: e.target.value as DoseUnit })}
                      >
                        {(['mg', 'units', 'ml'] as DoseUnit[]).map((u) => (
                          <option key={u} value={u}>
                            {doseUnitLabel(t, u)}
                          </option>
                        ))}
                      </Select>
                    </div>
                    <Input
                      label={t('onboarding:step.medication.start_date_label')}
                      type="date"
                      value={draft.startDate}
                      onChange={(e) => update({ startDate: e.target.value })}
                    />
                  </div>
                )}

                {currentStep?.type === 'goals' && (
                  <div className="space-y-4">
                    <div>
                      <h1 className="text-[26px] font-bold tracking-tight">
                        {t('onboarding:step.goals.title')}
                      </h1>
                      <p className="text-[14px] text-[var(--color-text-secondary)] mt-1">
                        {t('onboarding:step.goals.subtitle')}
                      </p>
                    </div>
                    <Input
                      label={t('onboarding:step.goals.target_weight_label', { unit: wU })}
                      type="number"
                      step="0.1"
                      inputMode="decimal"
                      value={draft.goalWeight}
                      onChange={(e) => update({ goalWeight: e.target.value })}
                    />
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--color-text-secondary)] mb-2">
                        {t('onboarding:step.goals.primary_goal_label')}
                      </p>
                      <PillGroup>
                        {(['fat-loss', 'recomp', 'health', 'maintenance'] as const).map((g) => (
                          <Pill
                            key={g}
                            active={draft.goal === g}
                            onClick={() => update({ goal: g })}
                          >
                            {goalLabel(t, g)}
                          </Pill>
                        ))}
                      </PillGroup>
                    </div>
                  </div>
                )}

                {currentStep?.type === 'body_stats' && (
                  <div className="space-y-4">
                    <div>
                      <h1 className="text-[26px] font-bold tracking-tight">
                        {t('onboarding:step.body.title')}
                      </h1>
                      <p className="text-[14px] text-[var(--color-text-secondary)] mt-1">
                        {t('onboarding:step.body.subtitle')}
                      </p>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <Input
                        label={t('onboarding:step.body.weight_label', { unit: wU })}
                        type="number"
                        step="0.1"
                        inputMode="decimal"
                        value={draft.weight}
                        onChange={(e) => update({ weight: e.target.value })}
                      />
                      <Input
                        label={t('onboarding:step.body.height_label', { unit: hU })}
                        type="number"
                        step="0.1"
                        inputMode="decimal"
                        value={draft.height}
                        onChange={(e) => update({ height: e.target.value })}
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <Input
                        label={t('onboarding:step.body.age_label')}
                        type="number"
                        inputMode="numeric"
                        value={draft.age}
                        onChange={(e) => update({ age: e.target.value })}
                      />
                      <Select
                        label={t('onboarding:step.body.sex_label')}
                        value={draft.sex}
                        onChange={(e) => update({ sex: e.target.value as Sex })}
                      >
                        {(['male', 'female'] as Sex[]).map((s) => (
                          <option key={s} value={s}>
                            {sexLabel(t, s)}
                          </option>
                        ))}
                      </Select>
                    </div>
                  </div>
                )}

                {currentStep?.type === 'consent' && (
                  <div className="space-y-4">
                    <div>
                      <h1 className="text-[26px] font-bold tracking-tight">
                        {t('onboarding:org.consent_title')}
                      </h1>
                      <p className="text-[14px] text-[var(--color-text-secondary)] mt-1">
                        {t('onboarding:org.consent_subtitle')}
                      </p>
                    </div>
                    <div className="rounded-xl bg-[var(--color-surface-elevated)] border border-[var(--color-border)] p-4 text-[13px] text-[var(--color-text-secondary)] space-y-2">
                      <p>{t('onboarding:org.consent_p1')}</p>
                      <p>{t('onboarding:org.consent_p2')}</p>
                      <p>{t('onboarding:org.consent_p3')}</p>
                    </div>
                  </div>
                )}

                {currentStep?.type === 'doctor_invite' && (
                  <div className="space-y-4">
                    <div>
                      <h1 className="text-[26px] font-bold tracking-tight">
                        {t('onboarding:org.doctor_invite_title')}
                      </h1>
                      <p className="text-[14px] text-[var(--color-text-secondary)] mt-1">
                        {t('onboarding:org.doctor_invite_subtitle')}
                      </p>
                    </div>
                    <div className="rounded-xl bg-[var(--color-surface-elevated)] border border-[var(--color-border)] p-4 text-[13px] text-[var(--color-text-secondary)]">
                      <p>{t('onboarding:org.doctor_invite_body')}</p>
                    </div>
                  </div>
                )}

                {currentStep?.type === 'tour' && (
                  <div className="space-y-4">
                    <div>
                      <h1 className="text-[26px] font-bold tracking-tight">
                        {t('onboarding:org.tour_title')}
                      </h1>
                      <p className="text-[14px] text-[var(--color-text-secondary)] mt-1">
                        {t('onboarding:org.tour_subtitle')}
                      </p>
                    </div>
                    <div className="rounded-xl bg-[var(--color-surface-elevated)] border border-[var(--color-border)] p-4 text-[13px] text-[var(--color-text-secondary)]">
                      <p>{t('onboarding:org.tour_body')}</p>
                    </div>
                  </div>
                )}
              </motion.div>
            </AnimatePresence>

            <div className="flex gap-2 mt-7">
              {step === 0 ? (
                <Button variant="ghost" onClick={onCancel} className="flex-1">
                  {t('common:action.cancel')}
                </Button>
              ) : (
                <Button
                  variant="ghost"
                  onClick={back}
                  leadingIcon={<ArrowLeft className="size-4" />}
                  className="flex-1"
                >
                  {t('onboarding:nav.back')}
                </Button>
              )}
              {step < TOTAL - 1 ? (
                <Button
                  onClick={next}
                  trailingIcon={<ArrowRight className="size-4" />}
                  className="flex-1"
                >
                  {t('common:action.continue')}
                </Button>
              ) : (
                <Button
                  onClick={complete}
                  trailingIcon={<Check className="size-4" />}
                  className="flex-1"
                >
                  {t('onboarding:nav.open_dashboard')}
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
