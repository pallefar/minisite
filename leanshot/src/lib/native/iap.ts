// Phase 16 Plan 16-05 Task 1 — RevenueCat IAP bridge (MONEY-06 client half).
//
// Replaces the Phase 12 throw-stub. This module is the SOLE legitimate import
// site for `@revenuecat/purchases-capacitor` in the codebase — every paywall
// or `?upgrade=` flow that touches StoreKit/Play Billing routes through these
// public functions. Per CONTEXT D-01 the app uses one entitlement (`plus`)
// and two products (`app.leanshot.plus.monthly`, `app.leanshot.plus.yearly`,
// reverse-DNS per D-03).
//
// Web platforms short-circuit to typed no-op results (or, for the never-on-
// web `purchaseSubscription`, throw) so the SPA bundle that statically pulls
// this module via lazy `getPricingComponent()` never hits a native binding.
//
// Trial gating: D-22 (block 2nd trial). `checkTrialEligibility()` consults
// RC's `checkTrialOrIntroductoryPriceEligibility` so the paywall can hide
// the "Start with 7 days free" copy when the device is already past trial.
//
// API keys (PUBLIC SDK keys per RC docs — see T-16-05-04 in PLAN threat
// model) are read from Vite env vars at module-init time. If the key is
// missing on a native platform we throw `RcConfigError` so the calling
// code can surface a vendor-not-configured state rather than crashing
// inside the SDK (vendor-gated send health pattern).
//
// DO NOT import from ./health — enforced by import-x/no-restricted-paths
// in eslint.config.js (Phase 12 D-02 zone firewall).
import { Purchases, INTRO_ELIGIBILITY_STATUS } from '@revenuecat/purchases-capacitor';
import { detectPlatform } from './platform';

// ─── Public types ───────────────────────────────────────────────────────────

export type IapProvider = 'apple' | 'google';

export interface Package {
  /** RC package id (e.g. `$rc_monthly`, `$rc_annual`). */
  identifier: string;
  /** Store product id (D-03 — `app.leanshot.plus.monthly` / `.yearly`). */
  productIdentifier: string;
  /** Localized price string from the store (e.g. `$12.99`, `€11,99`). */
  priceString: string;
}

export interface Offering {
  identifier: string;
  monthlyPackage: Package | null;
  yearlyPackage: Package | null;
}

export interface PurchaseResult {
  customerInfo: { entitlements: { active: Record<string, unknown> } };
  /** True when the user dismissed the StoreKit/Play Billing sheet without buying. */
  cancelled: boolean;
}

export interface TrialEligibility {
  monthlyEligible: boolean;
  yearlyEligible: boolean;
}

/**
 * Thrown by `configureRC` when running on a native platform without the
 * corresponding `VITE_RC_API_KEY_*` env var. Lets the caller distinguish
 * "vendor not configured" from a real SDK failure (which throws a plain
 * Error from inside `Purchases.configure`).
 */
export class RcConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RcConfigError';
  }
}

// ─── Module-level idempotency ───────────────────────────────────────────────

let _configured = false;
let _currentAppUserID: string | null = null;
// L2: coalesce concurrent first-callers (paywall mount + ?upgrade= handler) onto a
// single in-flight configure() so the SDK is never double-configured. Cleared on
// failure (to allow retry) and by logOutRC() / __resetForTests().
let _configurePromise: Promise<void> | null = null;

// ─── Helpers ────────────────────────────────────────────────────────────────

function isNativePlatform(): boolean {
  const p = detectPlatform();
  return p === 'ios' || p === 'android';
}

function nativeApiKey(): string {
  const platform = detectPlatform();
  if (platform === 'ios') {
    return import.meta.env.VITE_RC_API_KEY_IOS ?? '';
  }
  if (platform === 'android') {
    return import.meta.env.VITE_RC_API_KEY_ANDROID ?? '';
  }
  return '';
}

function isUserCancelled(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const candidate = err as { userCancelled?: boolean; code?: string };
  if (candidate.userCancelled === true) return true;
  // RC native exceptions sometimes surface as { code: 'PURCHASE_CANCELLED' }
  if (typeof candidate.code === 'string' && /cancel/i.test(candidate.code)) return true;
  return false;
}

// ─── Public surface ─────────────────────────────────────────────────────────

/**
 * Configure RevenueCat for the current user. Idempotent — repeat calls with
 * the same `appUserID` are no-ops; a different `appUserID` triggers
 * `Purchases.logIn` (preserves entitlement attribution across sign-out /
 * sign-in cycles without re-configuring the SDK).
 *
 * Web platforms: silent no-op (the RC SDK is not safe to invoke from
 * standard browser builds; the IAP path is iOS/Android only).
 */
export async function configureRC(appUserID: string): Promise<void> {
  if (!isNativePlatform()) {
    // Web no-op — IAP is mobile-only per D-13.
    return;
  }
  if (_configured) {
    if (_currentAppUserID !== appUserID) {
      await Purchases.logIn({ appUserID });
      _currentAppUserID = appUserID;
    }
    return;
  }
  // L2: memoize the first configure() so two near-simultaneous callers share one
  // SDK init instead of racing (the `_configured` flag was previously written only
  // AFTER the await, so both could pass the guard). The apiKey check throws
  // synchronously BEFORE the promise is memoized so a missing key still rejects.
  if (!_configurePromise) {
    const apiKey = nativeApiKey();
    if (!apiKey) {
      throw new RcConfigError(
        `RevenueCat SDK key missing for platform ${detectPlatform()} — set VITE_RC_API_KEY_IOS / VITE_RC_API_KEY_ANDROID in .env.local`,
      );
    }
    _configurePromise = Purchases.configure({ apiKey, appUserID }).then(() => {
      _configured = true;
      _currentAppUserID = appUserID;
    });
    // On a transient configure failure, clear the memo so a later call can retry.
    _configurePromise.catch(() => {
      _configurePromise = null;
    });
  }
  await _configurePromise;
  // If a concurrent first-caller configured under a different appUserID, switch now.
  if (_configured && _currentAppUserID !== appUserID) {
    await Purchases.logIn({ appUserID });
    _currentAppUserID = appUserID;
  }
}

/**
 * Returns the current RC offering shaped for the paywall. Null on web, or
 * when RC has no current offering configured (dashboard misconfiguration).
 */
export async function getOfferings(): Promise<Offering | null> {
  if (!isNativePlatform()) {
    return null;
  }
  const result = await Purchases.getOfferings();
  type RcPkg = {
    identifier?: string;
    product?: { identifier?: string; priceString?: string };
  };
  const current = (result as { current?: unknown }).current as
    | {
        identifier?: string;
        monthly?: RcPkg;
        annual?: RcPkg;
        availablePackages?: RcPkg[];
      }
    | null
    | undefined;
  if (!current) return null;
  const mapPackage = (pkg: RcPkg | undefined): Package | null => {
    if (!pkg || !pkg.product) return null;
    return {
      identifier: pkg.identifier ?? '',
      productIdentifier: pkg.product.identifier ?? '',
      priceString: pkg.product.priceString ?? '',
    };
  };
  // L4: the built-in $rc_monthly / $rc_annual identifiers populate current.monthly /
  // current.annual. A dashboard offering built with CUSTOM package identifiers leaves
  // those null — fall back to scanning availablePackages by store product id so the
  // paywall still resolves prices + a purchasable package (instead of a silent dead
  // paywall: sdkReady=true, selectedPkg=null, prices show "—").
  const byProduct = (productId: string): RcPkg | undefined =>
    (current.availablePackages ?? []).find((p) => p.product?.identifier === productId);
  const monthly = current.monthly ?? byProduct('app.leanshot.plus.monthly');
  const annual = current.annual ?? byProduct('app.leanshot.plus.yearly');
  return {
    identifier: current.identifier ?? 'default',
    monthlyPackage: mapPackage(monthly),
    yearlyPackage: mapPackage(annual),
  };
}

/**
 * Trigger a StoreKit / Play Billing purchase for the given store product id.
 * Returns `{ cancelled: true }` (NOT thrown) when the user dismisses the
 * sheet so the caller can silently restore UI state. Network / config
 * errors re-throw so the caller can toast.
 *
 * Web platforms ALWAYS throw — the `?upgrade=` handler in App.tsx must
 * gate on `detectPlatform()` before calling this function.
 */
export async function purchaseSubscription(productId: string): Promise<PurchaseResult> {
  if (!isNativePlatform()) {
    throw new Error('purchaseSubscription is not available on web');
  }
  const offering = await getOfferings();
  if (!offering) {
    throw new Error('No matching package — RC offerings unavailable');
  }
  const wantsMonthly = offering.monthlyPackage?.productIdentifier === productId;
  const wantsYearly = offering.yearlyPackage?.productIdentifier === productId;
  if (!wantsMonthly && !wantsYearly) {
    throw new Error(`No matching package for product ${productId}`);
  }
  // RC `Purchases.purchasePackage` expects the full RC package object (with
  // internal fields the native SDK needs), NOT our simplified `Package`.
  // Re-fetch the raw offering to retrieve it.
  const raw = await Purchases.getOfferings();
  const rawCurrent = (raw as { current?: unknown }).current as
    | {
        monthly?: unknown;
        annual?: unknown;
        availablePackages?: Array<{ product?: { identifier?: string } }>;
      }
    | null
    | undefined;
  // L4: mirror getOfferings' fallback so an offering with custom package ids still
  // resolves the raw RC package the native SDK needs to complete the purchase.
  const rawByProduct = (productId: string): unknown =>
    (rawCurrent?.availablePackages ?? []).find((p) => p.product?.identifier === productId);
  const rawPkg = wantsMonthly
    ? (rawCurrent?.monthly ?? rawByProduct('app.leanshot.plus.monthly'))
    : (rawCurrent?.annual ?? rawByProduct('app.leanshot.plus.yearly'));
  try {
    // RC SDK types narrow `aPackage` to `PurchasesPackage`; we re-fetch the
    // raw object precisely so it IS that shape at runtime. Cast is safe
    // because we just retrieved it from `Purchases.getOfferings().current`.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await Purchases.purchasePackage({ aPackage: rawPkg as any });
    return {
      customerInfo: (result as { customerInfo: PurchaseResult['customerInfo'] }).customerInfo,
      cancelled: false,
    };
  } catch (err) {
    if (isUserCancelled(err)) {
      return {
        customerInfo: { entitlements: { active: {} } },
        cancelled: true,
      };
    }
    throw err;
  }
}

/**
 * Tell RC to look up any prior purchases for this device's Apple/Google ID
 * and re-grant the entitlement. Web no-op.
 */
export async function restorePurchases(): Promise<PurchaseResult['customerInfo'] | null> {
  if (!isNativePlatform()) {
    return null;
  }
  // M3: return customerInfo so the caller can inspect entitlements.active['plus']
  // and resync the DB-backed store tier. A reinstall/TRANSFER restore that the
  // webhook no-ops would otherwise leave the user gated as free despite a
  // "Purchases restored." toast.
  const result = (await Purchases.restorePurchases()) as
    | { customerInfo?: PurchaseResult['customerInfo'] }
    | undefined;
  return result?.customerInfo ?? null;
}

/**
 * D-22: check whether the device is still eligible for the 7-day intro
 * offer on each product. RC's status enum is mapped to a simple boolean per
 * product. UNKNOWN is conservatively treated as INELIGIBLE so we never
 * promise a trial that the store will silently strip at checkout.
 *
 * Web returns `{ false, false }` (paywall uses native IAP only).
 */
export async function checkTrialEligibility(): Promise<TrialEligibility> {
  if (!isNativePlatform()) {
    return { monthlyEligible: false, yearlyEligible: false };
  }
  const productIdentifiers = ['app.leanshot.plus.monthly', 'app.leanshot.plus.yearly'];
  const result = (await Purchases.checkTrialOrIntroductoryPriceEligibility({
    productIdentifiers,
  })) as Record<string, { status?: unknown }>;
  const eligible = (status: unknown): boolean =>
    status === INTRO_ELIGIBILITY_STATUS.INTRO_ELIGIBILITY_STATUS_ELIGIBLE;
  return {
    monthlyEligible: eligible(result['app.leanshot.plus.monthly']?.status),
    yearlyEligible: eligible(result['app.leanshot.plus.yearly']?.status),
  };
}

/**
 * L1: log RevenueCat out on sign-out (shared-device hygiene + RC analytics /
 * attribution correctness). Resets module idempotency so the next configureRC()
 * cleanly re-binds the SDK to the new user. Web no-op.
 */
export async function logOutRC(): Promise<void> {
  if (!isNativePlatform()) {
    return;
  }
  try {
    if (_configured) {
      await Purchases.logOut();
    }
  } finally {
    _configured = false;
    _currentAppUserID = null;
    _configurePromise = null;
  }
}

/**
 * Test-only hook — resets module-level idempotency state so tests can verify
 * the configure-once-then-logIn flow across `vi.resetModules()` boundaries.
 * NEVER call from production code.
 */
export function __resetForTests(): void {
  _configured = false;
  _currentAppUserID = null;
  _configurePromise = null;
}
