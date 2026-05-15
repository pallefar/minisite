# Phase 16: Capacitor Mobile Shells (iOS + Android) — Pattern Map

**Mapped:** 2026-05-15
**Files analyzed:** 22 new/modified files
**Analogs found:** 19 / 22

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `src/lib/native/platform.ts` | utility | request-response | `src/lib/native/platform.ts` (stub) | exact (fill) |
| `src/lib/native/deeplink.ts` | utility | event-driven | `src/lib/clinic-realtime.ts` | role-match |
| `src/lib/native/biometric.ts` | utility | request-response | `src/lib/native/iap.ts` (stub) | exact (new fill) |
| `src/lib/native/share.ts` | utility | request-response | `src/lib/native/platform.ts` (stub) | exact (new fill) |
| `src/lib/native/iap.ts` | utility | event-driven | `src/lib/native/iap.ts` (stub) | exact (fill) |
| `src/components/PricingIOS.tsx` | component | request-response | `src/components/admin/pages/blocks/PricingBlock.tsx` | role-match |
| `src/components/BiometricGate.tsx` | component | request-response | `src/components/dashboard/settings/DeleteAccountModal.tsx` | role-match |
| `supabase/functions/revenuecat-webhook/index.ts` | service | event-driven | `/Users/karstenhaldan/minisite/supabase/functions/stripe-webhook/index.ts` | exact |
| `supabase/migrations/*_rc_subscriptions*.sql` | migration | CRUD | `supabase/migrations/2026031*_subscriptions*.sql` | exact |
| `capacitor.config.ts` | config | — | `vite.config.ts` | partial |
| `apps/ios/` + `apps/android/` | config | — | `vercel.json` | partial |
| `public/.well-known/apple-app-site-association` | config | request-response | `public/.well-known/` (any existing) | no analog |
| `public/.well-known/assetlinks.json` | config | request-response | — | no analog |
| `vercel.json` (modified) | config | request-response | `vercel.json` (existing) | exact |
| `apps/ios/App/App/PrivacyInfo.xcprivacy` | config | — | — | no analog |
| `fastlane/Fastfile` + `Matchfile` + `Appfile` | config | batch | `/Users/karstenhaldan/minisite/.github/workflows/ci.yml` | partial |
| `.github/workflows/mobile.yml` | config | batch | `/Users/karstenhaldan/minisite/.github/workflows/ci.yml` | role-match |
| `e2e/mobile/photo-soak.spec.ts` | test | event-driven | `e2e/checkout-trial-flow.spec.ts` | role-match |
| `e2e/mobile/iap-flow.spec.ts` | test | request-response | `e2e/checkout-trial-flow.spec.ts` | exact |
| `e2e/aso/aso-capture.spec.ts` | test | request-response | `e2e/clinic-ad-free.spec.ts` | role-match |
| `scripts/audit-privacy-manifest.mjs` | utility | batch | `scripts/assert-bundle-budget.sh` | role-match |
| `vitest-mobile.config.ts` + `src/lib/native/__mocks__/` | config+test | — | `vitest-e2e.config.ts` | role-match |

---

## Pattern Assignments

### `src/lib/native/platform.ts` (utility, request-response)

**Analog:** `src/lib/native/platform.ts` (existing stub, lines 1-9)

**Current stub pattern** (lines 1-9):
```typescript
// Phase 12 D-01 stub — platform detection bridge.
// Returns 'web' for all Phase 12-15 builds; Capacitor-aware detection lands in Phase 16.
// DO NOT import from ./health — enforced by import-x/no-restricted-paths in eslint.config.js.

export type Platform = 'web' | 'ios' | 'android' | 'capacitor-web';

export function detectPlatform(): Platform {
  return 'web';
}
```

**Fill pattern** (from RESEARCH.md §Pattern 1):
```typescript
// src/lib/native/platform.ts — Phase 16 fill
import { Capacitor } from '@capacitor/core';

export type Platform = 'web' | 'ios' | 'android' | 'capacitor-web';

export function detectPlatform(): Platform {
  const p = Capacitor.getPlatform(); // 'web' | 'ios' | 'android'
  if (p === 'ios' || p === 'android') return p;
  return Capacitor.isNativePlatform() ? 'capacitor-web' : 'web';
}
```

**ESLint firewall invariant:** This file sits in Zone 1 target path (`./src/lib/native/ads*.ts`). `platform.ts` itself has no zone restriction — it's safe to import from any non-ad-eligible surface. Do NOT add `@capacitor/*` as a restricted import here; the firewall is uni-directional (health → ad paths only).

---

### `src/lib/native/deeplink.ts` (utility, event-driven)

**Analog:** `src/lib/clinic-realtime.ts` — same event-listener-install-and-cleanup lifecycle.

**Event listener install pattern** (from `clinic-realtime.ts` lines 83-104):
```typescript
// Install pattern: ensure state first, then attach listener, return cleanup handle
async function subscribeBroadcast(topic, onChange) {
  if (!(await ensureSession())) return noOpChannel();
  await supabase.realtime.setAuth(); // pre-condition before attach
  const channel = supabase.channel(topic, { config: { private: true } })
    .on('broadcast', { event: 'INSERT' }, onChange)
    .on('broadcast', { event: 'UPDATE' }, onChange);
  await channel.subscribe();
  return channel; // caller calls channel.unsubscribe() in useEffect cleanup
}
```

**Fill pattern for deeplink** (from RESEARCH.md §Pattern 2):
```typescript
// src/lib/native/deeplink.ts — Phase 16 fill
import { App, type URLOpenListenerEvent } from '@capacitor/app';

const PATHNAME_PREFIXES = ['/clinic', '/pricing', '/faq', '/r/', '/share/'];
const HASH_PREFIXES = ['/auth/', '/legal/'];

export function installDeepLinkHandler(): void {
  App.addListener('appUrlOpen', (event: URLOpenListenerEvent) => {
    try {
      const u = new URL(event.url);
      const path = u.pathname;
      if (PATHNAME_PREFIXES.some((p) => path === p || path.startsWith(p))) {
        window.history.pushState({}, '', path + u.search);
        window.dispatchEvent(new PopStateEvent('popstate'));
        return;
      }
      for (const hp of HASH_PREFIXES) {
        if (path.startsWith(hp)) {
          window.location.hash = '#' + path + u.search;
          return;
        }
      }
      window.history.pushState({}, '', '/');
    } catch { /* Sentry picks this up */ }
  });
}
```

**Critical memory:** `reference_supabase_auth_traps.md` — implicit-grant + hash-routes = double-`#` bug. The `HASH_PREFIXES` list must NOT include auth email-link URLs (those must go through the URL-rewriter, not the hash setter).

---

### `src/lib/native/iap.ts` (utility, event-driven)

**Analog:** `src/lib/native/iap.ts` (existing stub) + `supabase/functions/stripe-checkout/index.ts` lazy-init pattern.

**Stub-to-fill pattern:**
- Existing stub exports `purchaseSubscription(_productId)` as `never` (throws).
- Phase 16 replaces the body with `@revenuecat/purchases-capacitor` calls.
- Pattern for lazy-init (from `stripe-checkout/index.ts` lines 82-106):

```typescript
// Lazy initialization — defer SDK construction until first call
// so tests can set env vars via Deno.env.set() (or vi.mock()) before invocation.
let _rcConfigured = false;

export async function configureRC(appUserID: string): Promise<void> {
  if (_rcConfigured) return;
  const platform = detectPlatform();
  if (platform !== 'ios' && platform !== 'android') return; // web: no-op
  const apiKey = platform === 'ios'
    ? import.meta.env.VITE_RC_API_KEY_IOS
    : import.meta.env.VITE_RC_API_KEY_ANDROID;
  await Purchases.configure({ apiKey, appUserID });
  _rcConfigured = true;
}
```

**D-22 trial-blocking pattern:** Check `offerEligibility` BEFORE presenting offerings:
```typescript
// RC offer-eligibility (D-22: block 2nd trial)
const eligibility = await Purchases.checkTrialOrIntroductoryPriceEligibility({
  productIdentifiers: ['app.leanshot.plus.monthly', 'app.leanshot.plus.yearly'],
});
// eligibility.eligibilityStatus === INTRO_ELIGIBILITY_STATUS.INELIGIBLE → hide intro offer
```

---

### `src/lib/native/biometric.ts` (utility, request-response)

**Analog:** `src/lib/native/platform.ts` (stub shape) — new file following the same module convention.

**Stub shape convention** (from all Phase 12 stubs):
```typescript
// Phase 12 D-01 stub comment header pattern:
// Phase 12 D-01 stub — <what this does>. Real implementation lands in Phase 16 (<REQ-ID>).
// DO NOT import from ./health — enforced by import-x/no-restricted-paths in eslint.config.js.

export type BiometricAvailability = 'available' | 'unavailable' | 'permission-denied';

export async function checkBiometric(): Promise<BiometricAvailability> { ... }
export async function authenticateWithBiometric(reason: string): Promise<boolean> { ... }
```

**Fill from RESEARCH:** `@capgo/capacitor-native-biometric` v8.4.5. API: `NativeBiometric.isAvailable()` + `NativeBiometric.verifyIdentity({ reason })`.

**Firewall zone:** `biometric.ts` is Zone 0 (shared shell per CONTEXT §"Integration Points"). No zone restriction needed — it is not a health or ad-eligible file.

---

### `src/lib/native/share.ts` (utility, request-response)

**Analog:** `src/lib/native/platform.ts` (stub shape) — new file following same module convention.

**Fill pattern:**
```typescript
// src/lib/native/share.ts — Phase 16 fill (MOBILE-10)
import { Share } from '@capacitor/share';
import { detectPlatform } from './platform';

export async function nativeShare(opts: { title: string; text: string; url: string }): Promise<void> {
  const platform = detectPlatform();
  if (platform === 'web') {
    // Web fallback: navigator.share or clipboard copy
    if (navigator.share) { await navigator.share(opts); return; }
    await navigator.clipboard.writeText(opts.url);
    return;
  }
  await Share.share(opts);
}
```

---

### `src/components/PricingIOS.tsx` (component, request-response)

**Analog:** `src/components/admin/pages/blocks/PricingBlock.tsx` (lines 1-112) — same plan-card layout with CTA button.

**Imports pattern** (from `PricingBlock.tsx` lines 1-14):
```typescript
import { Check } from 'lucide-react';
import type { BlockNode } from '@/lib/page-builder/block-schema';
import { backgroundToneClass, paddingForDensity } from './block-style-helpers';
```

**For PricingIOS.tsx — import pattern:**
```typescript
import { Check } from 'lucide-react';
import { detectPlatform } from '@/lib/native/platform';
// NO import from @/lib/stripe/* — D-13 gate
```

**Core component pattern** (clone from `PricingBlock.tsx` lines 62-111):
```tsx
// Plan card with recommended ring — exact DS token classes from PricingBlock:
const planClass = recommended
  ? 'bg-[var(--color-surface-elevated)] border-2 border-[var(--color-primary)] shadow-[0_0_0_4px_var(--color-primary-soft)] rounded-xl p-6 flex flex-col text-left'
  : 'bg-[var(--color-surface)] border border-[var(--color-border)] shadow-[var(--shadow-xs)] rounded-xl p-6 flex flex-col text-left';
```

**D-13 paywall fork — CTA button:**
```tsx
// PricingIOS.tsx CTA must invoke RC purchaseSubscription, NOT stripe-checkout
<button type="button" onClick={() => purchaseSubscription(productId)}>
  {plan.ctaLabel}
</button>
```

**D-24 clinic-owner gate:**
```tsx
const role = useStore((s) => s.signedIn?.role);
if (role === 'clinic_owner') {
  return <p>Clinic billing is managed at <a href="https://leanshot.app/clinic/billing">leanshot.app/clinic/billing</a></p>;
}
```

---

### `src/components/BiometricGate.tsx` (component, request-response)

**Analog:** `src/components/dashboard/settings/DeleteAccountModal.tsx` — gated-action modal with async operation + loading state + error mapping.

**Imports pattern** (from `account-delete.test.tsx` lines 14-20, inferring modal structure):
```typescript
import { useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/hooks/useToast';
import { authenticateWithBiometric } from '@/lib/native/biometric';
```

**Core modal pattern** (mirroring DeleteAccountModal's typed-confirm + async + error):
```tsx
const [loading, setLoading] = useState(false);
const [error, setError] = useState<string | null>(null);
const toast = useToast();

async function handleBiometricAuth() {
  setLoading(true);
  setError(null);
  try {
    const ok = await authenticateWithBiometric('Unlock LeanShot');
    if (ok) { onSuccess(); } else { setError('Authentication cancelled'); }
  } catch (err) {
    setError(err instanceof Error ? err.message : 'Authentication failed');
  } finally {
    setLoading(false);
  }
}
```

---

### `supabase/functions/revenuecat-webhook/index.ts` (service, event-driven)

**Analog:** `/Users/karstenhaldan/minisite/supabase/functions/stripe-webhook/index.ts` — exact mirror pattern.

**Full structural pattern** — copy the stripe-webhook skeleton verbatim, swap:

**Imports + client init pattern** (from `stripe-webhook/index.ts` lines 21-56):
```typescript
import { createClient } from 'npm:@supabase/supabase-js@2';
// Note: no Stripe import; RevenueCat webhook uses HMAC-SHA256, not Stripe's subtleCrypto

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const admin = createClient(
  SUPABASE_URL || 'https://placeholder.supabase.co',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || 'placeholder_key',
  { auth: { autoRefreshToken: false, persistSession: false } },
);
```

**Response helper pattern** (from `stripe-webhook/index.ts` lines 59-64):
```typescript
// BASE_RESPONSE_HEADERS includes Cache-Control: private, no-store (T-14-03-I2)
function jsonResponse(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: BASE_RESPONSE_HEADERS, // import from ./cors.ts or inline
  });
}
```

**RAW BODY pattern — CRITICAL** (from `stripe-webhook/index.ts` lines 152-156):
```typescript
// RAW BODY — read via request.text() BEFORE any other body operation.
// RevenueCat uses HMAC-SHA256 over the raw bytes; any prior .json() call breaks verify.
const body = await request.text();
```

**Signature verification pattern** (RC uses HMAC, not Stripe's subtleCrypto):
```typescript
// RevenueCat HMAC-SHA256 verification (replaces stripe.webhooks.constructEventAsync)
const signature = request.headers.get('X-RevenueCat-Signature') ?? '';
const secret = Deno.env.get('REVENUECAT_WEBHOOK_SECRET') ?? '';
const encoder = new TextEncoder();
const key = await crypto.subtle.importKey(
  'raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify'],
);
const sigBytes = hexToBytes(signature); // implement hexToBytes locally
const ok = await crypto.subtle.verify('HMAC', key, sigBytes, encoder.encode(body));
if (!ok) return jsonResponse(400, { error: 'bad-signature' });
```

**Idempotency pattern** (from `stripe-webhook/index.ts` lines 175-198):
```typescript
// Idempotency via subscription_events.event_id PRIMARY KEY (Pattern B from stripe-webhook)
const { error: insertErr } = await admin.from('subscription_events').insert({
  event_id: event.event_id, // RC uses event.event_id field
  event_type: event.event, // RC uses event.event (e.g., 'RENEWAL', 'CANCELLATION')
  payload: event,
  provider: 'revenuecat', // NEW: provider discriminator for the reconciliation table
});
if (insertErr?.code === '23505') {
  return jsonResponse(200, { duplicate: true });
}
```

**Dispatcher pattern** (mirrors `stripe-webhook/index.ts` lines 105-128):
```typescript
// RC event types that write to subscriptions table
switch (event.event) {
  case 'INITIAL_PURCHASE':
  case 'RENEWAL':
  case 'PRODUCT_CHANGE':
    // Write/update subscriptions row: provider='revenuecat', status='active', expires_at=event.expiration_at_ms
    break;
  case 'CANCELLATION':
  case 'EXPIRATION':
    // D-04: IMMEDIATE downgrade — set expires_at = now()
    break;
  case 'BILLING_ISSUE':
    // Update status='past_due' but do NOT change expires_at yet
    break;
  default:
    console.log('[revenuecat-webhook] unhandled event type', event.event);
}
```

**Deno.serve + internal exports** (from `stripe-webhook/index.ts` lines 227-233):
```typescript
Deno.serve((request: Request) => handleRequest(request));

export const __internal = { handleRequest };
```

**PII safety invariant** (from stripe-webhook comment header):
```typescript
// PII safety: every error response is { error: '<short-code>' }.
// console.error logs err.message but NEVER event payload data.
```

---

### `supabase/migrations/*_rc_subscriptions*.sql` (migration, CRUD)

**Analog:** Existing `supabase/migrations/2026031*_subscriptions*.sql` — must extend the existing `subscriptions` table, NOT create a parallel one.

**D-02 tier reconciliation rule** — the migration adds:
```sql
-- Add provider discriminator if not already present (idempotent ADD COLUMN IF NOT EXISTS)
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS provider text NOT NULL DEFAULT 'stripe';

-- tier_effective computed view or RPC (D-02):
-- Effective tier = MAX(stripe.expires_at, revenuecat.expires_at) > now()
CREATE OR REPLACE VIEW tier_effective AS
  SELECT
    user_id,
    MAX(current_period_end) AS effective_expires_at,
    CASE WHEN MAX(current_period_end) > now() THEN 'paid' ELSE 'free' END AS tier
  FROM subscriptions
  GROUP BY user_id;
```

**Migration safety:** Per `feedback_planner_iter1_anti_patterns.md` — enum-add-in-same-tx and CREATE POLICY forward-refs cause `supabase db push` failures. If `provider` becomes a Postgres enum, add it in a SEPARATE migration transaction from the policies that reference it.

---

### `capacitor.config.ts` (config)

**Analog:** `vite.config.ts` — same TS config-file convention (defineConfig pattern, TypeScript, default export).

**Structure pattern** (RESEARCH recommended + D-10 bundle IDs):
```typescript
// capacitor.config.ts — repo root, committed
import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  // D-10: bundle IDs split per-platform (PERMANENT)
  appId: 'app.leanshot', // base; cap add ios/android overrides per-platform
  appName: 'LeanShot',
  webDir: 'leanshot/dist', // per CONTEXT §"Established Patterns"
  server: {
    // D-12: always load bundled assets for monetization paths
    allowNavigation: ['leanshot.app', 'app.leanshot.app'],
  },
  ios: {
    // D-10: app.leanshot.ios PERMANENT
    // D-05 correction: iOS 15.0 minimum (Capacitor 8 mandates; not 14)
    scheme: 'app.leanshot.ios',
  },
  android: {
    // D-10: app.leanshot.android PERMANENT
    allowMixedContent: false,
  },
};

export default config;
```

---

### `vercel.json` (modified — AASA + assetlinks headers)

**Analog:** `vercel.json` (existing, lines 1-23) — append to the `headers` array.

**Existing headers pattern** (lines 10-22):
```json
{
  "headers": [
    {
      "source": "/(.*)",
      "headers": [
        { "key": "Content-Security-Policy", "value": "..." },
        { "key": "Strict-Transport-Security", "value": "..." }
      ]
    }
  ]
}
```

**New headers to ADD for AASA + assetlinks** (D-09):
```json
{
  "source": "/.well-known/apple-app-site-association",
  "headers": [
    { "key": "Content-Type", "value": "application/json" }
  ]
},
{
  "source": "/.well-known/assetlinks.json",
  "headers": [
    { "key": "Content-Type", "value": "application/json" }
  ]
}
```

**Critical:** AASA must NOT have a `.json` extension (Apple fetches it bare). `public/.well-known/apple-app-site-association` — no extension. Vercel serves static files from `public/` automatically. No rewrite rule needed; just the Content-Type header override.

---

### `.github/workflows/mobile.yml` (config, batch)

**Analog:** `/Users/karstenhaldan/minisite/.github/workflows/ci.yml` — exact structural pattern.

**Job structure pattern** (from `ci.yml` lines 1-30):
```yaml
name: Mobile CI
on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true

defaults:
  run:
    working-directory: leanshot

jobs:
  ios-build:
    name: iOS build + TestFlight upload
    runs-on: macos-latest  # D-14: macOS runner for Xcode
    timeout-minutes: 30
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: 'npm'
          cache-dependency-path: leanshot/package-lock.json
      - run: npm ci
      - run: npm run build
      # ... fastlane lanes
```

**Secret injection pattern** (from `ci.yml` lines 71-78):
```yaml
env:
  SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
  SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}
  # Mobile-specific:
  MATCH_PASSWORD: ${{ secrets.MATCH_PASSWORD }}
  FASTLANE_APPLE_APPLICATION_SPECIFIC_PASSWORD: ${{ secrets.FASTLANE_ASP }}
  RC_API_KEY_IOS: ${{ secrets.RC_API_KEY_IOS }}
  SENTRY_AUTH_TOKEN: ${{ secrets.SENTRY_AUTH_TOKEN }}
```

---

### `e2e/mobile/iap-flow.spec.ts` (test, request-response)

**Analog:** `e2e/checkout-trial-flow.spec.ts` — exact same pattern: service-role admin client, `createUser`, `addInitScript`, `pollUntil`, `afterAll` cleanup.

**HAS_LIVE gate pattern** (from `checkout-trial-flow.spec.ts` lines 24-33):
```typescript
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY;
const RC_API_KEY = process.env.RC_API_KEY_IOS; // additional gate for IAP flow

const HAS_LIVE = Boolean(SERVICE_ROLE && SUPABASE_URL && ANON_KEY && RC_API_KEY);
test.skip(!HAS_LIVE, 'requires HAS_LIVE env vars (SUPABASE + RC)');
```

**addInitScript pattern** (from `checkout-trial-flow.spec.ts` lines 163-173):
```typescript
// ALWAYS addInitScript — never goto + evaluate + reload (races supabase-js INITIAL_SESSION)
await page.addInitScript((blob: string) => {
  try {
    if (!localStorage.getItem('leanshot_v4')) {
      localStorage.setItem('leanshot_v4', blob);
      localStorage.setItem('leanshot_tour_seen_v4', '1');
    }
  } catch { /* private-mode noop */ }
}, SEEDED_BLOB);
```

**Service-role user create + cleanup pattern** (from `checkout-trial-flow.spec.ts` lines 130-144):
```typescript
test.afterAll(async () => {
  const admin = createClient(SUPABASE_URL!, SERVICE_ROLE!, { auth: { persistSession: false } });
  if (userId) {
    try { await admin.auth.admin.deleteUser(userId); } catch { /* best-effort */ }
  }
});
```

**pollUntil helper** (from `checkout-trial-flow.spec.ts` lines 105-115):
```typescript
async function pollUntil(
  predicate: () => Promise<boolean>,
  opts: { timeoutMs: number; intervalMs: number } = { timeoutMs: 10_000, intervalMs: 500 },
): Promise<void> {
  const deadline = Date.now() + opts.timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise<void>((resolve) => setTimeout(resolve, opts.intervalMs));
  }
  throw new Error(`pollUntil timed out after ${opts.timeoutMs}ms`);
}
```

---

### `e2e/mobile/photo-soak.spec.ts` (test, event-driven)

**Analog:** `e2e/checkout-trial-flow.spec.ts` — same service-role + HAS_LIVE pattern; soak uses `page.evaluate` + Sentry marker assertion.

**Soak-specific pattern** (from RESEARCH.md §OOM mitigation):
```typescript
test('200-photo soak — no OOM or WKWebView crash', async ({ page }) => {
  test.setTimeout(300_000); // 5 min for 200-photo load
  // Seed 200 photo rows via service-role admin client (NOT UI upload)
  // Then navigate and assert:
  await expect(page.getByTestId('photo-grid')).toBeVisible({ timeout: 60_000 });
  // Assert Sentry marker arrived (D-17 validation):
  const sentryMarker = await page.evaluate(() => window.__lastSentryMessage);
  expect(sentryMarker).toBe('photo-gallery-soak-complete');
  // Assert no crash: if OOM, Playwright loses connection and this line never runs
});
```

---

### `e2e/aso/aso-capture.spec.ts` (test, request-response)

**Analog:** `e2e/clinic-ad-free.spec.ts` — viewport-specific Playwright spec that navigates + asserts.

**Multi-viewport screenshot pattern** (from D-19 + RESEARCH):
```typescript
// ASO capture: iterate over store-required viewports (D-19)
const VIEWPORTS = [
  { name: 'iphone-15-pro-max', width: 430, height: 932 },
  { name: 'iphone-14', width: 390, height: 844 },
  { name: 'pixel-phone', width: 393, height: 873 },
];
for (const vp of VIEWPORTS) {
  await page.setViewportSize({ width: vp.width, height: vp.height });
  await page.goto('/');
  await page.screenshot({ path: `e2e/aso/screenshots/${vp.name}.png`, fullPage: false });
}
```

---

### `scripts/audit-privacy-manifest.mjs` (utility, batch)

**Analog:** `scripts/assert-bundle-budget.sh` — CI-gate script that exits 0 on pass, 1 on failure, emits `::error::` annotations.

**Script pattern** (from `assert-bundle-budget.sh` lines 1-30):
```bash
#!/usr/bin/env bash
# Emit GitHub Actions annotations on failure
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# ... check logic ...
if <guard fails>; then
  echo "::error::Privacy manifest missing required entry for <API>"
  exit 1
fi
echo "audit-privacy-manifest: PASS"
```

**For .mjs variant:**
```javascript
#!/usr/bin/env node
// scripts/audit-privacy-manifest.mjs
// Validates PrivacyInfo.xcprivacy against the 14-plugin inventory (D-18).
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const manifest = JSON.parse(readFileSync(
  resolve(import.meta.dirname, '../apps/ios/App/App/PrivacyInfo.xcprivacy'),
  'utf8'
));
// Assert required reason codes per Apple's canonical list for each of the 14 plugins
const REQUIRED_APIS = ['NSPrivacyAccessedAPICategoryUserDefaults', /* ... */];
// ...exit 1 on missing
```

---

### `vitest-mobile.config.ts` + `src/lib/native/__mocks__/` (config + test)

**Analog:** `vitest-e2e.config.ts` (lines 1-16) — separate vitest config with node environment.

**Config pattern** (from `vitest-e2e.config.ts` lines 1-16):
```typescript
import { defineConfig } from 'vitest/config';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'node', // or 'jsdom' for component tests
    globals: true,
    include: ['src/lib/native/**/*.test.ts', 'src/lib/native/__mocks__/**/*.ts'],
    testTimeout: 30000,
  },
});
```

**Mock pattern** (from `src/test/account-delete.test.tsx` lines 24-30):
```typescript
// vi.mock for Capacitor plugins — prevents actual native calls in unit tests
vi.mock('@capacitor/core', () => ({
  Capacitor: {
    getPlatform: vi.fn(() => 'web'),
    isNativePlatform: vi.fn(() => false),
  },
}));
vi.mock('@revenuecat/purchases-capacitor', () => ({
  Purchases: {
    configure: vi.fn(),
    getOfferings: vi.fn().mockResolvedValue({ current: null }),
    purchasePackage: vi.fn().mockResolvedValue({ customerInfo: { entitlements: {} } }),
  },
}));
```

**Skip pattern for test files** (from `checkout-trial-flow.spec.ts`):
```typescript
// Use test.skip, NOT it.fixme — see reference_vitest_skip_fixme.md
test.skip(!HAS_NATIVE, 'requires native device/simulator');
```

---

## Shared Patterns

### Service-Role JWT (all e2e tests requiring auth)
**Source:** `e2e/rls-injections.test.ts` lines 37-46 + `e2e/checkout-trial-flow.spec.ts` lines 130-144
**Apply to:** `e2e/mobile/iap-flow.spec.ts`, `e2e/mobile/photo-soak.spec.ts`
```typescript
const admin = createClient(SUPABASE_URL!, SERVICE_ROLE!, {
  auth: { autoRefreshToken: false, persistSession: false },
});
// Use admin.auth.admin.createUser({ email, password, email_confirm: true })
// NEVER signInWithPassword from test code (GoTrueClient cross-contamination flake)
```

### Supabase Edge Function — Env Lazy Read
**Source:** `/Users/karstenhaldan/minisite/supabase/functions/stripe-checkout/index.ts` lines 60-74
**Apply to:** `revenuecat-webhook/index.ts`
```typescript
// Lazy reads — NOT module-level const. Allows tests to call Deno.env.set() before invocation.
function env(name: string, fallback = ''): string {
  return Deno.env.get(name) ?? fallback;
}
```

### Supabase Edge Function — JSON-only Responses
**Source:** `/Users/karstenhaldan/minisite/supabase/functions/stripe-webhook/index.ts` lines 59-64
**Apply to:** `revenuecat-webhook/index.ts`
```typescript
// Per reference_supabase_edge_function_deploy.md: gateway overrides Content-Type to text/plain.
// Webhook should return JSON only. Include Cache-Control: private, no-store always.
const BASE_RESPONSE_HEADERS = {
  'Content-Type': 'application/json',
  'Cache-Control': 'private, no-store',
};
```

### ESLint Firewall — Adding New Native Files
**Source:** `eslint.config.js` lines 106-161
**Apply to:** All new files in `src/lib/native/`

The firewall has THREE blocks:
- **Block A** (`import-x/no-restricted-paths`): 6 zone-based directory restrictions. `biometric.ts` and `share.ts` are Zone 0 — they do NOT need to be added as new zone targets because they don't touch health data.
- **Block B** (`no-restricted-imports`): `*.ad-eligible.ts` naming convention — new native files must NOT use this suffix.
- **Block C** (`no-restricted-imports`): `posthog*.ts` wrapper glob.

**Critical gotcha** (from `reference_eslint_import_x_path_gotcha.md`): When targeting a `.ts` FILE (not a directory) in zone `target`, use a glob (e.g., `./src/lib/native/ads*.ts`). Bare path `./src/lib/native/ads` silently never fires.

**Capacitor imports ARE allowed** inside `src/lib/native/*.ts` files. The firewall only blocks `health.ts` → ad-eligible paths. Phase 16 does NOT need to add new zones for `@capacitor/*` or `@revenuecat/*` imports — those are intentional fill implementations.

### Realtime Tier-Flip Subscription (D-25)
**Source:** `src/lib/clinic-realtime.ts` lines 83-104
**Apply to:** `src/App.tsx` modification for `subscriptions:user_id=eq.X` channel

```typescript
// D-25 — Subscribe to subscriptions Postgres changes for tier flip
// Mirror the clinic-realtime pattern: setAuth first, then subscribe
const channel = supabase
  .channel(`subscriptions:user_id=eq.${userId}`)
  .on('postgres_changes', {
    event: 'UPDATE',
    schema: 'public',
    table: 'subscriptions',
    filter: `user_id=eq.${userId}`,
  }, (payload) => {
    // Update store tier from payload.new.tier or recompute via tier_effective view
    useStore.setState({ tier: computeTierFromRow(payload.new) });
  })
  .subscribe();
// Cleanup in useEffect return
return () => { void channel.unsubscribe(); };
```

### GitHub Actions — Additive Append Convention
**Source:** `/Users/karstenhaldan/minisite/.github/workflows/ci.yml` (pattern across Phase 8, 10, 12)
**Apply to:** `.github/workflows/mobile.yml`

Per `feedback_planner_iter1_anti_patterns.md` + existing CI comments: new CI jobs are APPENDED to `ci.yml` using the HI-2 additive append pattern, OR placed in a separate `mobile.yml` file (preferred for macOS-runner jobs given cost isolation). Mobile.yml runs independently; it should `needs: [lint, typecheck]` from `ci.yml` only if the GitHub Actions repo allows cross-workflow dependencies (it does not by default — keep mobile.yml self-contained with its own lint step).

### `page.addInitScript` State Seeding
**Source:** `e2e/checkout-trial-flow.spec.ts` lines 163-173
**Apply to:** All new Playwright e2e specs that need pre-seeded auth/store state

```typescript
// Per reference_playwright_state_seeding.md: ALWAYS addInitScript, NEVER goto+evaluate+reload
await page.addInitScript((blob: string) => {
  try {
    if (!localStorage.getItem('leanshot_v4')) {
      localStorage.setItem('leanshot_v4', blob);
      localStorage.setItem('leanshot_tour_seen_v4', '1');
    }
  } catch { /* private-mode noop */ }
}, SEEDED_BLOB);
```

### Per-File Slug Prefix in Fixtures
**Source:** `feedback_rls_per_file_slug_prefix.md`
**Apply to:** `e2e/mobile/iap-flow.spec.ts`, `e2e/mobile/photo-soak.spec.ts`

```typescript
// Each test file MUST declare its own file-scoped prefix to avoid clobbering
// sibling files' afterAll(cleanupTestPages(...)) under vitest file-parallelism.
const IAP_TEST_PREFIX = `iap-flow-${Date.now()}`; // unique per file
const PHOTO_SOAK_PREFIX = `photo-soak-${Date.now()}`;
```

---

## No Analog Found

Files with no close match in the codebase (planner should use RESEARCH.md patterns instead):

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `public/.well-known/apple-app-site-association` | config | request-response | No AASA files exist in codebase yet; JSON schema from Apple docs |
| `public/.well-known/assetlinks.json` | config | request-response | No assetlinks file exists; JSON schema from Google docs |
| `apps/ios/App/App/PrivacyInfo.xcprivacy` | config | — | No plist/xcprivacy files in codebase; hand-crafted from D-18 plugin inventory |
| `fastlane/Fastfile` + `Matchfile` + `Appfile` | config | batch | No fastlane files in codebase; use fastlane docs + RESEARCH.md §"Build Pipeline" |

---

## Metadata

**Analog search scope:** `src/lib/native/`, `src/components/`, `supabase/functions/`, `.github/workflows/`, `e2e/`, `scripts/`, `vercel.json`, `eslint.config.js`, `vite.config.ts`, `vitest-e2e.config.ts`
**Files scanned:** ~35 source files read or grep-searched
**Pattern extraction date:** 2026-05-15

### Critical Phase-Specific Gotchas (must appear in every PLAN.md)

1. **iOS 15.0 minimum, not 14.0** — CONTEXT D-05 says "iOS 14+" but Capacitor 8 mandates iOS 15.0. Lock `IPHONEOS_DEPLOYMENT_TARGET = 15.0` in xcconfig.

2. **ESLint firewall allows `@capacitor/*` inside `src/lib/native/`** — the firewall blocks health→ad flows only. No new zones needed for Capacitor plugin imports.

3. **`products` table gotcha** — NEVER use `.json` extension for `apple-app-site-association`. Apple fetches it bare.

4. **vercel.json Content-Type header MUST be a separate source entry** — adding to the `"/(.*)"` wildcard header block will NOT work because Vercel matches the most specific source first; AASA and assetlinks need their own `source` entries.

5. **RC webhook uses HMAC-SHA256, not Stripe's subtleCrypto** — same Deno `crypto.subtle` API is available, but the import key and verify call differ from `Stripe.createSubtleCryptoProvider()`.

6. **D-04 immediate downgrade** — `CANCELLATION` and `EXPIRATION` RC events must set `expires_at = now()`, NOT a future date. Deliberately asymmetric with Stripe's grace period.

7. **Bundle chunk for Capacitor** — `@capacitor/*` and `@revenuecat/purchases-capacitor` must be routed to a `vendor-capacitor` or `capacitor-bridge` chunk in `vite.config.ts` manualChunks (per D-12 CONTEXT §"5 chunk caps": `capacitor-bridge ≤15 kB gz`). Add a new regex to `vite.config.ts` analogous to the existing `vendor-supabase` rule.
