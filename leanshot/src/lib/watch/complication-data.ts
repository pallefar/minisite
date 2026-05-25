// DO NOT import from src/lib/native/health.ts or any ad-eligible surface —
// enforced by ESLint no-health-in-ad-context rule (Layer 1) and
// scripts/check-no-health-in-ad-context.sh (Layer 3, extended in WATCH-08).
import { calcStreak } from '@/hooks/useStreaks';
import { SITES } from '@/lib/constants';
import type { PersistedState } from '@/lib/storage';
import type { InjectionSite } from '@/types';

/**
 * Phase 57 Plan 57-03 — Watch complication data (WATCH-05, WATCH-06, WATCH-08).
 *
 * Pure functions that derive Apple Watch complication / Wear OS tile data from
 * the phone-side PersistedState snapshot. No side effects; no network calls.
 * The output is serialized over WatchConnectivity / DataClient to the watch.
 */

/**
 * Data shape surfaced on the watch complication / Wear OS tile.
 * All fields must be JSON-serializable for transfer over watch protocols.
 */
export interface WatchComplicationData {
  /** Next scheduled injection date as YYYY-MM-DD, or null when user is not set up. */
  nextDoseDate: string | null;
  /** Consecutive injection-day streak count (via calcStreak). */
  currentStreak: number;
  /** Next recommended injection site in SITES rotation order, or null when all sites are recent. */
  nextSite: InjectionSite | null;
  /** User's medication name (MedicationId string). Empty string when user is null. */
  medication: string;
  /** Most recent injection formatted as "<dose> <unit>", or null when no injections. */
  lastDose: string | null;
}

/** Empty default returned when state.user is null. */
const EMPTY_DEFAULT: WatchComplicationData = {
  nextDoseDate: null,
  currentStreak: 0,
  nextSite: null,
  medication: '',
  lastDose: null,
};

/**
 * watchComplicationData — derive watch complication data from PersistedState.
 *
 * Pure function; no side effects. All derived values use the same data sources
 * as their on-phone counterparts:
 *   - nextDoseDate: modular day arithmetic from user.injectionDay
 *   - currentStreak: calcStreak (useStreaks.ts) with injection predicate
 *   - nextSite: SiteRotationCard.tsx lines 23-30 recency logic, extracted pure
 *   - medication: user.medication
 *   - lastDose: state.injections[0].dose + unit
 *
 * @param state - PersistedState snapshot from the phone.
 * @param today - Optional override for "today" (used in tests for determinism).
 * @returns WatchComplicationData ready for watch transfer, or the empty default
 *          when state.user is null.
 */
export function watchComplicationData(
  state: PersistedState,
  today: Date = new Date(),
): WatchComplicationData {
  if (!state.user) return { ...EMPTY_DEFAULT };

  const { user, injections } = state;

  // --- nextDoseDate ---
  // Compute the number of days until the next scheduled injection day.
  // daysUntilNext = ((injectionDay - today.getDay() + 7) % 7) || 7
  // The `|| 7` handles the "today is the injection day" case — next occurrence
  // is 7 days from now, not 0 (which would be "today" and would break).
  const daysUntilNext = ((user.injectionDay - today.getDay() + 7) % 7) || 7;
  const nextDoseDate_d = new Date(today);
  nextDoseDate_d.setDate(nextDoseDate_d.getDate() + daysUntilNext);
  const nextDoseDate = nextDoseDate_d.toISOString().slice(0, 10);

  // --- currentStreak ---
  // Mirror the injection streak predicate from useStreaks.ts:
  //   calcStreak((ds) => injections.some((inj) => inj.datetime.startsWith(ds)))
  const currentStreak = calcStreak(
    (ds) => injections.some((inj) => inj.datetime.startsWith(ds)),
    today,
  );

  // --- nextSite ---
  // Match SiteRotationCard.tsx (lines 13-30): a site is the 'next' recommendation
  // only when it has NOT been used in the last 14 days (canonical 'empty' status).
  // Sites used <7d are 'recent', 7-14d are 'older' — neither is eligible as 'next'.
  // Use only the most recent 8 injections (same slice as SiteRotationCard).
  const sitesUsedWithin14d = new Set<InjectionSite>();
  injections.slice(0, 8).forEach((inj) => {
    if (!inj.site) return;
    const days = (today.getTime() - new Date(inj.datetime).getTime()) / 86_400_000;
    if (days < 14) sitesUsedWithin14d.add(inj.site);
  });
  const nextSite = (SITES.find((s) => !sitesUsedWithin14d.has(s)) ?? null) as InjectionSite | null;

  // --- medication ---
  const medication = user.medication as string;

  // --- lastDose ---
  const newest = injections[0] ?? null;
  const lastDose = newest ? `${newest.dose} ${newest.unit}` : null;

  return { nextDoseDate, currentStreak, nextSite, medication, lastDose };
}

/**
 * watchSiteRecommendation — convenience wrapper returning only the next site.
 *
 * Delegates entirely to watchComplicationData so the recommendation logic
 * stays in one place (WATCH-06).
 *
 * @param state - PersistedState snapshot from the phone.
 * @param today - Optional override for "today" (used in tests for determinism).
 * @returns Next recommended InjectionSite, or null.
 */
export function watchSiteRecommendation(
  state: PersistedState,
  today: Date = new Date(),
): InjectionSite | null {
  return watchComplicationData(state, today).nextSite;
}
