/**
 * Phase 58 Plan 58-02 — exhaustive static-key helpers for onboarding option arrays.
 *
 * react-i18next + i18next-parser require STATIC literal keys (no template
 * literals). OnboardingFlow.tsx iterates over MedicationId / GoalType /
 * ActivityLevel / LiftingLevel / Sex enums in .map() calls — template-string
 * lookups (`t(\`onboarding:${id}\`)`) would produce zero parser hits, leaving
 * EN keys unextracted.
 *
 * Each helper uses an exhaustive `switch` per the nav-labels.ts pattern:
 *   - Every case holds a STATIC `t('onboarding:...')` literal the AST walker
 *     can resolve.
 *   - The `never` default provides compile-time coverage if the union gains
 *     a new member.
 */

import type { TFunction } from 'i18next';
import type { PrimaryGoal } from '@/components/onboarding/ConsumerOnboardingRenderer';
import type { ActivityLevel, DoseUnit, GoalType, LiftingLevel, MedicationId, Sex } from '@/types';

// ──────────────────────────────────────────────────────────────────────────
// Medication labels (clinical strings — P70 signoff via clinical-glossary.md)
// ──────────────────────────────────────────────────────────────────────────

export function medicationLabel(t: TFunction, id: MedicationId): string {
  switch (id) {
    case 'ozempic':
      return t('onboarding:step.medication.ozempic');
    case 'wegovy':
      return t('onboarding:step.medication.wegovy');
    case 'mounjaro':
      return t('onboarding:step.medication.mounjaro');
    case 'zepbound':
      return t('onboarding:step.medication.zepbound');
    case 'rybelsus':
      return t('onboarding:step.medication.rybelsus');
    case 'saxenda':
      return t('onboarding:step.medication.saxenda');
    case 'trulicity':
      return t('onboarding:step.medication.trulicity');
    case 'retatrutide':
      return t('onboarding:step.medication.retatrutide');
    case 'compound-sema':
      return t('onboarding:step.medication.compound_sema');
    case 'compound-tirz':
      return t('onboarding:step.medication.compound_tirz');
    default: {
      const _exhaustive: never = id;
      return _exhaustive;
    }
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Goal type labels (GoalType)
// ──────────────────────────────────────────────────────────────────────────

export function goalLabel(t: TFunction, id: GoalType): string {
  switch (id) {
    case 'fat-loss':
      return t('onboarding:step.goals.goal_fat_loss');
    case 'recomp':
      return t('onboarding:step.goals.goal_recomp');
    case 'health':
      return t('onboarding:step.goals.goal_health');
    case 'maintenance':
      return t('onboarding:step.goals.goal_maintenance');
    default: {
      const _exhaustive: never = id;
      return _exhaustive;
    }
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Activity level labels (ActivityLevel)
// ──────────────────────────────────────────────────────────────────────────

export function activityLabel(t: TFunction, id: ActivityLevel): string {
  switch (id) {
    case 'sedentary':
      return t('onboarding:step.routine.activity_sedentary');
    case 'light':
      return t('onboarding:step.routine.activity_light');
    case 'moderate':
      return t('onboarding:step.routine.activity_moderate');
    case 'very':
      return t('onboarding:step.routine.activity_very');
    default: {
      const _exhaustive: never = id;
      return _exhaustive;
    }
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Lifting level labels (LiftingLevel)
// ──────────────────────────────────────────────────────────────────────────

export function liftingLabel(t: TFunction, id: LiftingLevel): string {
  switch (id) {
    case 'none':
      return t('onboarding:step.routine.lifting_none');
    case 'beginner':
      return t('onboarding:step.routine.lifting_beginner');
    case 'intermediate':
      return t('onboarding:step.routine.lifting_intermediate');
    case 'advanced':
      return t('onboarding:step.routine.lifting_advanced');
    default: {
      const _exhaustive: never = id;
      return _exhaustive;
    }
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Sex labels (Sex)
// ──────────────────────────────────────────────────────────────────────────

export function sexLabel(t: TFunction, id: Sex): string {
  switch (id) {
    case 'male':
      return t('onboarding:step.body.sex_male');
    case 'female':
      return t('onboarding:step.body.sex_female');
    default: {
      const _exhaustive: never = id;
      return _exhaustive;
    }
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Dose unit labels (DoseUnit)
// ──────────────────────────────────────────────────────────────────────────

export function doseUnitLabel(t: TFunction, id: DoseUnit): string {
  switch (id) {
    case 'mg':
      return t('onboarding:step.medication.unit_mg');
    case 'units':
      return t('onboarding:step.medication.unit_units');
    case 'ml':
      return t('onboarding:step.medication.unit_ml');
    default: {
      const _exhaustive: never = id;
      return _exhaustive;
    }
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Primary goal labels for ConsumerOnboardingRenderer (PrimaryGoal)
// ──────────────────────────────────────────────────────────────────────────

export function primaryGoalLabel(t: TFunction, id: PrimaryGoal): string {
  switch (id) {
    case 'lose-weight':
      return t('onboarding:consumer.goal.lose_weight');
    case 'build-muscle':
      return t('onboarding:consumer.goal.build_muscle');
    case 'new-prescription':
      return t('onboarding:consumer.goal.new_prescription');
    case 'build-habit':
      return t('onboarding:consumer.goal.build_habit');
    case 'doctor-monitored':
      return t('onboarding:consumer.goal.doctor_monitored');
    case 'family-supporter':
      return t('onboarding:consumer.goal.family_supporter');
    case 'manage-symptoms':
      return t('onboarding:consumer.goal.manage_symptoms');
    case 'track-with-vial-supply':
      return t('onboarding:consumer.goal.track_with_vial_supply');
    default: {
      const _exhaustive: never = id;
      return _exhaustive;
    }
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Injection day labels (0=Sunday…6=Saturday)
// ──────────────────────────────────────────────────────────────────────────

export function injectionDayLabel(t: TFunction, day: number): string {
  switch (day) {
    case 0:
      return t('onboarding:step.routine.day_sunday');
    case 1:
      return t('onboarding:step.routine.day_monday');
    case 2:
      return t('onboarding:step.routine.day_tuesday');
    case 3:
      return t('onboarding:step.routine.day_wednesday');
    case 4:
      return t('onboarding:step.routine.day_thursday');
    case 5:
      return t('onboarding:step.routine.day_friday');
    case 6:
      return t('onboarding:step.routine.day_saturday');
    default:
      return String(day);
  }
}

// Short injection day labels used in the snapshot tile
export function injectionDayShortLabel(t: TFunction, day: number): string {
  switch (day) {
    case 0:
      return t('onboarding:step.routine.day_short_sunday');
    case 1:
      return t('onboarding:step.routine.day_short_monday');
    case 2:
      return t('onboarding:step.routine.day_short_tuesday');
    case 3:
      return t('onboarding:step.routine.day_short_wednesday');
    case 4:
      return t('onboarding:step.routine.day_short_thursday');
    case 5:
      return t('onboarding:step.routine.day_short_friday');
    case 6:
      return t('onboarding:step.routine.day_short_saturday');
    default:
      return String(day);
  }
}
