# Phase 14: Monetization Foundation — Pattern Map

**Generated:** 2026-05-14 (Phase 14 plan-phase, chunked)
**Source:** gsd-pattern-mapper agent (analog inventory across 18 files)

---

## Coverage Summary

- **TOTAL files:** 18 (12 net-new + 6 surgical-edit/shared)
- **Analogs found:** 17/18 (one no-analog: `scripts/stripe-bootstrap.ts` — repo only has `.sh` scripts; convention defined inline)

---

## File-by-File Analog Map

### Migrations

| File | Analog | Why |
|---|---|---|
| `supabase/migrations/20260601000XXX_subscriptions.sql` | `supabase/migrations/20260801000007_memberships.sql` (Phase 9 clinic memberships) + `20260801000011_clinic_rpcs.sql` (SECURITY DEFINER aggregator) | Same author, recent, audited by plan-checker iter 2; same shape (tenant table + RLS + partial index + SECURITY DEFINER function with `extensions` in search_path) |

**Excerpts to copy:**
- Table-create + IMMUTABLE partial index: `memberships.sql:31-55` (`create unique index … where revoked_at is null`)
- RLS enable + per-role SELECT policy: `memberships.sql:65-75`
- SECURITY DEFINER `count_active_patients()` spec verbatim from `14-RESEARCH.md` lines 677-699

### Edge Functions

| File | Analog | Why |
|---|---|---|
| `supabase/functions/stripe-checkout/index.ts` + `.test.ts` + `cors.ts` + `deno.json` | `supabase/functions/clinic-invite/index.ts` (Phase 9, JWT-authed) | Same auth shape (JWT → operator-scoped supabase client), same external-vendor-call shape (Resend ↔ Stripe), same `Deno.serve` dispatcher |
| `supabase/functions/stripe-webhook/index.ts` + `.test.ts` + `cors.ts` + `deno.json` | `supabase/functions/share/index.ts` (Phase 8, no-JWT secret-as-auth) | Public-internet unauthenticated POST with secret-as-auth; **CRITICAL:** Stripe-specific webhook pattern from `14-RESEARCH.md` §Pattern 1 |

**Reusable verbatim:**
- `clinic-invite/index.ts:62-167` — `SUPABASE_URL` env + service-role `admin` client + `jsonResponse`/`jsonError`/`jwtFromReq`/`userScopedClient` helpers
- `clinic-invite/index.ts:217-229` — JWT → operator pattern
- `clinic-invite/index.ts:549-586` — Dispatcher: `Deno.serve` + OPTIONS preflight + pathname segment routing
- `clinic-invite/cors.ts` (4 lines, wildcard origin, NO credentials header) — copy for stripe-checkout
- `clinic-invite/deno.json` — copy verbatim (4 lines)
- `clinic-invite/index.test.ts:36-89` — test shape with env stub + `__internal` re-export gate
- `share/index.ts:46-51` + `:356-384` + `:379-383` — admin block + dispatcher + generic-500 (NEVER echo upstream errors)

**Stripe webhook canonical pattern (from RESEARCH §Pattern 1 lines 232-289):**
```typescript
const body = await request.text(); // RAW body REQUIRED — NEVER JSON.parse first
let event: Stripe.Event;
try {
  event = await stripe.webhooks.constructEventAsync(
    body,
    signature,
    Deno.env.get('STRIPE_WEBHOOK_SECRET')!,
    undefined,
    cryptoProvider, // 5th arg REQUIRED on Deno: Stripe.createSubtleCryptoProvider()
  );
} catch (err) {
  return new Response(`bad sig: ${err.message}`, { status: 400 });
}
// Idempotency: INSERT INTO subscription_events ON CONFLICT (event_id) DO NOTHING
// Postgres code 23505 → return 200 ("already processed")
```

### Bootstrap script

| File | Analog | Note |
|---|---|---|
| `leanshot/scripts/stripe-bootstrap.ts` | NO TS-script analog; closest by intent: `leanshot/e2e/fixtures/seed-org-50.ts` | `leanshot/scripts/` has only `.sh` files; convention defined inline below |

**Convention defined (no prior analog):**
- Run via `npx tsx scripts/stripe-bootstrap.ts` (project uses Node v22 + TS strict; use `tsx` or pre-compile)
- Reads `STRIPE_SECRET_KEY` from `process.env` (NOT `VITE_`-prefixed)
- Outputs `STRIPE_PRICE_*` lines to stdout; user copies into `.env.example` + Vercel env + Supabase secrets per [[feedback_cli_over_paste_back]]
- Helpers `ensureProduct(name)`, `ensurePrice(productId, ...)`, `ensureMeter(name)` — all idempotent (`stripe.products.search` first; create only if missing)
- Reference: `14-RESEARCH.md` §"Bootstrap script" lines 527-585

### Components (net-new in `leanshot/src/components/billing/`)

| File | Analog | Excerpts to copy |
|---|---|---|
| `TierGate.tsx` | `ui/Modal.tsx` (reduced-motion) + `ui/Card.tsx` (variant-class pattern) | `Card.tsx:24-41` (`variantClasses: Record<CardVariant, string>` keyed by mode); same shape for `mode: 'blur-upsell' \| 'hard-block-no-ui' \| 'hard-block-cta'`. Reduced-motion: `reduced ? 'opacity-60' : 'blur-[10px] saturate-50'` |
| `PaywallUpsell.tsx` | `ui/Card.tsx` `StatTile` (lines 113-141) | `<Card variant="tonal" padding="md">` envelope with label + value + CTA; `var(--color-primary)` for CTA, `var(--color-primary-soft)` for surface |
| `PastDueBanner.tsx` | `ui/Toast.tsx` (ARIA) + `Card.tsx:37-38` (tonal styling) | `role="alert"` (NOT `status` — payment failure is a warning); warm-orange `var(--color-warning)`; "Update card" CTA opens Portal via `<a target="_blank" rel="noopener noreferrer">` |
| `ManageSubscriptionLink.tsx` | `dashboard/settings/SettingsPage.tsx` (existing section composition) | `<Card>` + `<Button>` row with `<CreditCard>` icon (already imported in SettingsPage); onClick fetches Portal URL from `stripe-checkout` Edge Function |

### Library

| File | Analog | Excerpts to copy |
|---|---|---|
| `leanshot/src/lib/billing.ts` | `leanshot/src/lib/clinic-permissions.ts` (module-level Map + pure helpers + JSDoc-heavy) | `:1-20` (multi-line doc header); `:25-37` (module-level Map + pure exports); `:35-37` (clearOnSignout pattern — wire `clearTierCache()` into `useStore.signOut` action) |

Functions `billing.ts` owns: `getActiveTier(state)` (Stripe-status → UX-tier collapse per RESEARCH Pitfall 6); `TIER_GATE_REGISTRY` policy object mapping feature-id → mode.

### Store edit

| File | Analog | Lines |
|---|---|---|
| `leanshot/src/lib/store.ts` (surgical) | In-file precedent | `store.ts:1872-1899` partialize block — add 4 lines for `tier`, `paid_until`, `plan_id`, `provider`. Initial values per RESEARCH §Pattern 3 lines 334-338. |

### Surgical UI edits

| File | Where | Note |
|---|---|---|
| `dashboard/charts/MedLevelChart.tsx` | Lines 157-168 (`'Projected'` dataset) + 191-210 (Upper/Lower bound bands) | These 4 dataset entries are the entire 7-day forecast overlay. Gate INSIDE `useMemo`: `userTier !== 'paid' ? [] : […]`. Add `const userTier = useStore((s) => s.tier);` near line 76. |
| `dashboard/ai/AIChatPanel.tsx` | Header lines 161-190 | **AIChatPanel currently has NO model selector — Phase 14 adds one.** Wrap new selector in `<TierGate tier="paid" mode="hard-block-cta" feature="advanced AI">`. Free users get "Free" pill badge using `:212-223` pill styling. |

### E2E specs (net-new)

| File | Analog | Notes |
|---|---|---|
| `e2e/checkout-trial-flow.spec.ts` | `e2e/active-shares.spec.ts` | Env gating `HAS_LIVE`, `SEEDED_USER` blob, service-role admin setup, `addInitScript` seed (NEVER `goto+evaluate+reload` per [[reference_playwright_state_seeding]]) |
| `e2e/past-due-banner.spec.ts` | `e2e/active-shares.spec.ts` + `e2e/clinic-ad-free.spec.ts` | Drive via Stripe test mode + webhook fire `invoice.payment_failed`; app reads via Supabase realtime; banner <10s |
| `e2e/clinic-metered-billing.spec.ts` | Same | Use Stripe test clock for monthly true-up; verify `count_active_patients()` + Billing Meters API call |

### CSP edit

| File | Analog | What changes |
|---|---|---|
| `leanshot/tests/csp/csp-snapshot.txt` | The file itself + `vercel.json` | Add: `connect-src` += `https://api.stripe.com https://m.stripe.network`; `script-src` += `https://js.stripe.com`; `frame-src` set to `'self' https://js.stripe.com https://hooks.stripe.com` (was `'none'`). **CRITICAL:** `vercel.json` AND `csp-snapshot.txt` MUST be in the SAME commit per `csp-snapshot.test.ts:8-13` plan-checker BLOCKER. |

---

## Cross-Cutting Patterns (inline into every relevant plan's `<invariants>` block)

### A. RLS cross-tenant impersonation proof test
**Source:** `src/test/audit-trigger.test.ts:26-95` — env-gated `describeIfLive`, service-role admin creates two users, anon-client signs in as user A and SELECTs user B's row → expect 0 rows.
**Apply to:** EVERY Phase 14 RLS surface — `subscriptions`, `stripe_customers`, `clinic_stripe_customers`, `subscription_events`. Project rule per [[reference_supabase_project]]; not optional.

### B. Idempotent webhook upsert (Phase 14 landmine #1)
**Source:** RESEARCH §Pattern 1 lines 267-277.
**Apply to:** `stripe-webhook/index.ts`. `INSERT INTO subscription_events ON CONFLICT (event_id) DO NOTHING`; code `23505` → return 200. Plan-checker BLOCKER if missing.

### C. Raw-body-before-verify (Pitfall 2 + 3)
**Source:** RESEARCH §Pattern 1 lines 252-262.
**Apply to:** `stripe-webhook/index.ts` — `await request.text()` MUST be the FIRST body operation. Deno test verifies via whitespace-mutated body returning 400.

### D. Token consumption (Phase 13 design system)
**Source:** `src/components/ui/Card.tsx:24-41`.
**Apply to:** ALL billing components. Forbidden: hex literals. Required tokens: `var(--color-warning)` (past-due), `var(--color-primary)` + `var(--color-primary-soft)` (upsell), `var(--color-surface)` + `var(--color-surface-elevated)` (cards), `var(--color-border)` (separators).

### E. Reduced-motion gating
**Source:** `src/hooks/useReducedMotion.ts` + RESEARCH §Pattern 4 line 389.
**Apply to:** `TierGate` blur-upsell (skip blur transition; opacity-60 fallback); `PastDueBanner` (skip slide-in).

### F. Pathspec discipline for parallel waves
**Source:** [[feedback_parallel_executor_git_isolation]].
**Apply to:** Every commit in parallel-wave plans uses `git commit -- <pathspec>`.

### G. Bundle isolation for Stripe.js
**Source:** RESEARCH §Pitfall 10 lines 508-519 + [[project_phase5_bundle_regression]].
**Apply to:** Any `@stripe/stripe-js` import MUST be dynamic (`await import('@stripe/stripe-js')`) inside a click-handler, never module-top. **Preferred:** skip the SDK entirely; use `window.location.href = session.url` (Hosted Checkout works without the JS SDK).

### H. CSP plan-checker contract
**Source:** `csp-snapshot.test.ts:8-13`.
**Apply to:** Any plan touching `vercel.json` MUST also touch `tests/csp/csp-snapshot.txt` in the SAME commit.

### I. TierGate registry orphan-check (anti-pattern #6 from [[feedback_planner_iter1_anti_patterns]])
**Source:** Phase 10 + Phase 13 13-07 addendum lessons.
**Apply to:** `leanshot/src/lib/billing.ts` `TIER_GATE_REGISTRY` — every registered feature key must have ≥1 non-test `<TierGate feature="…">` consumer. Plan-checker greps for orphans.

---

## Ready for Planning

Per-plan planners reference this map by file. Cross-cutting patterns A-I are inlined into every relevant plan's `<invariants>` block.
