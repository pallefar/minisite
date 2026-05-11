import { AnimatePresence, motion } from 'framer-motion';
import { ArrowLeft, ArrowRight, Check } from 'lucide-react';
import { useEffect, useState } from 'react';
import { DisclaimerBody } from '@/components/dashboard/DisclaimerModal';
import { Button } from '@/components/ui/Button';
import { Input, Select } from '@/components/ui/Input';
import { Pill, PillGroup } from '@/components/ui/Pill';
import { useToast } from '@/hooks/useToast';
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
import { medLabel } from '@/lib/pharmacology';
import { useStore } from '@/lib/store';
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
import { ProgressIndicator } from './ProgressIndicator';
import { UnitToggle } from './UnitToggle';

interface OnboardingFlowProps {
  onCancel: () => void;
  onComplete: () => void;
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
    const proteinFromBody = Math.round(weight * (draft.units === 'metric' ? 1.6 : 0.8));
    const calorieBase = Math.round(weight * (draft.units === 'metric' ? 22 : 10));
    const goalWeight = parseFloat(draft.goalWeight) || weight - 10;
    const protein = parseInt(draft.protein) || proteinFromBody;

    const user: User = {
      name: draft.name.trim() || 'Friend',
      units: draft.units,
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
    };
    setUser(user);
    upsertWeight({
      date: draft.startDate,
      weight,
      bodyFat: parseFloat(draft.bodyFat) || null,
      ts: Date.now(),
    });
    track('onboarding_completed', { totalSteps: TOTAL_STEPS });
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
                    <div>
                      <h1 className="text-[26px] font-bold tracking-tight">
                        You&apos;re{' '}
                        <span className="font-display italic font-normal text-[var(--color-primary)]">
                          all set.
                        </span>
                      </h1>
                      <p className="text-[14px] text-[var(--color-text-secondary)] mt-1">
                        Here&apos;s what&apos;s next:
                      </p>
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
