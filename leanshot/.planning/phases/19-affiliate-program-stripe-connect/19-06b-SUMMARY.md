---
phase: 19
plan: 6b
subsystem: affiliate-partner-ui
tags: [ui, partner-dashboard, stripe-connect, edge-fn, route-registry, bl-2-path-a, w-1-split-b]
requirements: [AFF-04, AFF-08]
dependency_graph:
  requires:
    - 19-01 (affiliates schema)
    - 19-03 (stripe-connect-onboard + partner-account-status Edge Fns)
    - 19-05 (RouteDescriptor type, affiliate-apply-routes registry)
    - 19-06a (PartnerLayout, usePartnerContext, AffiliateProfile shape, placeholder StripeConnectOnboardingCard)
  provides:
    - PARTNER_ROUTES registry (consumed by Plan 19-09 App.tsx wiring)
    - Real 4-state StripeConnectOnboardingCard (overwrites 19-06a placeholder)
    - partner-profile-update Edge Function (BL-2 Path A — column allowlist write path)
    - PartnerLinksPage / PartnerPayoutsPage / PartnerAssetsPage components
  affects:
    - 19-09 (App.tsx import of PARTNER_ROUTES + AFFILIATE_APPLY_ROUTES)
    - 19-08 (marketing-assets bucket population — PartnerAssetsPage falls through to friendly empty state until seeded)
tech-stack:
  added: []
  patterns:
    - "Edge Function column allowlist (BL-2 Path A): Postgres RLS cannot restrict UPDATE per-column → JWT-gated Edge Fn is the canonical write path; RLS denies direct affiliate UPDATE"
    - "JIT Stripe onboarding URL (Plan 19-03 contract): never persisted; 5-min single-use per Pitfall 6"
    - "Route descriptor registry (BL-4): per-plan `src/routes/*-routes.ts` files; Plan 19-09 imports + wires into App.tsx"
key-files:
  created:
    - leanshot/src/components/partner/PartnerLinksPage.tsx
    - leanshot/src/components/partner/PartnerPayoutsPage.tsx
    - leanshot/src/components/partner/PartnerAssetsPage.tsx
    - leanshot/src/components/partner/PartnerTemplatePicker.tsx
    - leanshot/src/components/partner/PartnerCustomizeForm.tsx
    - leanshot/src/components/partner/__tests__/StripeConnectOnboardingCard.test.tsx
    - leanshot/src/components/partner/__tests__/PartnerCustomizeForm.test.tsx
    - leanshot/src/routes/partner-routes.ts
    - supabase/functions/partner-profile-update/index.ts
    - supabase/functions/partner-profile-update/index.test.ts
    - supabase/functions/partner-profile-update/deno.json
    - supabase/functions/partner-profile-update/cors.ts
  modified:
    - leanshot/src/components/partner/StripeConnectOnboardingCard.tsx (overwrote 19-06a placeholder with real 4-state machine per I-4 contract)
    - supabase/config.toml (appended [functions.partner-profile-update] verify_jwt = true — 4th writer after 19-02/19-03/19-05)
decisions:
  - "BL-2 Path A: column allowlist enforced server-side in Edge Function. Allowlist (the 6 user-mutable columns): display_name, photo_path, blurb, calendly_url, testimonial_quote, template_choice. Any other key in the body → 400 invalid_input."
  - "BL-4: src/App.tsx UNTOUCHED in this plan. PARTNER_ROUTES descriptor created for Plan 19-09 to wire."
  - "Single /partner prefix descriptor (vs. 4 exact descriptors): PartnerLayout owns sub-route switching internally; avoids 4× lazy-chunk re-fetch on every nav click."
  - "Stripe Connect onboarding URL is JIT-minted per click — never cached on the client. 5-min single-use per Pitfall 6 (19-03 contract)."
  - "Photo-upload Storage path: affiliate-photos/{user_id}/profile.{ext} — bucket creation + RLS owned by Plan 19-08."
  - "Marketing-assets bucket falls through to friendly toast when not yet seeded — Plan 19-08 populates."
metrics:
  duration_minutes: 9
  completed: 2026-05-15
---

# Phase 19 Plan 19-06b: Partner Links/Payouts/Assets + Real StripeConnectOnboardingCard + partner-profile-update Edge Fn Summary

W-1 part b/2 of the partner-dashboard surface. Ships:
1. The remaining 3 partner pages (`/partner/links`, `/partner/payouts`, `/partner/assets`).
2. The **real** 4-state Stripe Connect onboarding card (overwriting 19-06a's placeholder per the I-4 cross-wave contract).
3. The **BL-2 Path A** `partner-profile-update` Edge Function that enforces the 6-column allowlist server-side because Postgres RLS cannot restrict UPDATE per-column.
4. The **BL-4** route registry (`src/routes/partner-routes.ts`) consumed by Plan 19-09.

## What shipped

### `partner-profile-update` Edge Function (BL-2 Path A)

JWT-gated POST at `/functions/v1/partner-profile-update`. Enforces the 6-column allowlist:

```
ALLOWED_COLUMNS = ['display_name', 'photo_path', 'blurb', 'calendly_url',
                   'testimonial_quote', 'template_choice']
```

- **Auth path:** Bearer JWT → `admin.auth.getUser(jwt)` → `user.id` is the only identity the WHERE clause trusts (T-19-06b-S).
- **Allowlist gate:** any key outside `ALLOWED_COLUMNS` returns `400 invalid_input { invalid_column: <key> }` BEFORE any DB I/O (T-19-06b-T).
- **Per-column validation:** lengths (display_name 1..80, blurb ≤50, testimonial_quote ≤200, photo_path ≤200), `template_choice` ∈ {coach, story, method}, `calendly_url` host must be `calendly.com` or `*.calendly.com` (or empty).
- **Approved-only:** affiliate row must have `status = 'approved'` (403 otherwise; 404 if no row).
- **Rate limit:** 10 saves / 60s per user.id, in-memory (T-19-06b-D).
- **Service-role UPDATE:** bypasses RLS (Postgres can't restrict columns per policy). RLS on `affiliates` denies direct affiliate UPDATE → this Edge Fn is the canonical write path.

Config: `[functions.partner-profile-update] verify_jwt = true` appended to `supabase/config.toml` (4th writer in the Phase-19 chain after 19-02/19-03/19-05).

### Real StripeConnectOnboardingCard (overwrites 19-06a placeholder per I-4)

4-state machine per UI-SPEC §"Stripe Connect Onboarding Card":

| State | Behavior |
|-------|----------|
| `pending` | Tonal card · heading "Complete tax onboarding to receive payouts" · primary CTA "Start onboarding →" |
| `needs_info` | Tonal + warning border · "Stripe needs more info" · lists first 3 requirements + "+N more" · "Continue onboarding →" CTA + "Action needed" badge |
| `active` | **Hidden** (returns `null`) — UI-SPEC contract |
| `restricted` | Default card + danger left-border · "Your payout account is on hold" · shows `disabled_reason` · secondary `mailto:` CTA |

CTA flow: POST `/functions/v1/stripe-connect-onboard` with Bearer JWT → `{ url }` opened via `window.open(url, '_blank', 'noopener,noreferrer')`. URLs are 5-min single-use per Stripe — never persisted client-side.

Slide-down 300ms first-render animation; honored `useReducedMotion()`.

### /partner/links

Two-column desktop layout per UI-SPEC:
- Left (`span=6`): Referral URL in `font-mono`, Copy button → `navigator.clipboard.writeText` + "Link copied to clipboard" toast.
- Right (`span=6`): `<PartnerTemplatePicker>` — 3 cards (coach / story / method), `role="radiogroup"` + `role="radio"`, Enter/Space keyboard select, `aria-checked` for selection state.
- Bottom (`span=12`): `<PartnerCustomizeForm>` — 5 fields with conditional `testimonial_quote` (visible only when `selectedTemplate === 'story'`); Save POSTs the full 6-key body to `partner-profile-update`; client-side calendly host gate before submit.
- Bottom (`span=12`): Live-preview placeholder ("coming soon — Plan 19-08 owns landing renderers").

Photo upload: file → `supabase.storage.from('affiliate-photos').upload({user_id}/profile.{ext}, file, { upsert: true })`. Bucket creation + RLS owned by Plan 19-08.

### /partner/payouts

Top:
- Connect status pill (4 tones per UI-SPEC verbatim copy: "Tax onboarding · pending|action needed", "Payouts active", "Payouts on hold")
- `<StripeConnectOnboardingCard>` (same component, hidden when `active`)
- Next-payout banner: tonal card showing next 1st-of-month date

History table: 4 columns (date, amount, status badge, transfer ID); transfer-ID is click-to-copy (truncated to 12 chars). Empty state per UI-SPEC verbatim: "No payouts yet — Payouts run monthly on the 1st once you've earned at least $25 in confirmed commissions."

Data: `from('payouts').select(...).eq('affiliate_id', profile.id).order('created_at', { ascending: false })`. RLS-gated server-side; client-side filter is defense-in-depth.

### /partner/assets

3-col responsive grid (`grid-cols-1 sm:grid-cols-2 lg:grid-cols-3`). Hardcoded 8-asset manifest per CONTEXT D-14:
- Logo SVG / 200×200 PNG / 1200×1200 PNG
- Banners 728×90 / 300×250 / 1080×1080
- Swipe email & social copy (.txt)

Download flow: `supabase.storage.from('marketing-assets').createSignedUrl(path, 3600)` → opens in new tab. When the bucket isn't seeded yet (pre-19-08), surfaces a friendly toast ("This asset isn't ready yet — check back in a day or two") instead of failing silently.

### `src/routes/partner-routes.ts` (BL-4)

Single descriptor:
```
export const PARTNER_ROUTES: RouteDescriptor[] = [
  { match: 'prefix', path: '/partner',
    componentLoader: () => import('@/components/partner/PartnerLayout') as ... },
];
```

PartnerLayout (from 19-06a) reads `window.location.pathname` to drive sub-route switching — Plan 19-09 will extend the layout's child-rendering switch to dynamic-import Links/Payouts/Assets pages alongside Dashboard.

### config.toml — 4th writer in the chain

Block order (chronological, post-Phase-19):
1. `[functions.affiliate-attribute]` verify_jwt = false (Plan 19-02)
2. `[functions.stripe-connect-onboard]` verify_jwt = true (Plan 19-03)
3. `[functions.partner-account-status]` verify_jwt = true (Plan 19-03)
4. `[functions.affiliate-apply]` verify_jwt = false (Plan 19-05)
5. **`[functions.partner-profile-update]` verify_jwt = true (this plan)**

## Test results

**13/13 tests pass:**

- **4 Deno tests** (`supabase/functions/partner-profile-update/index.test.ts`):
  - T1: missing Bearer JWT → 401 unauthenticated
  - T2: body contains non-allowlisted column (`email`) → 400 invalid_input + UPDATE not called
  - T3: valid `{ template_choice: 'coach' }` → 200 ok + UPDATE called with the 1-column patch
  - T4: calendly_url with non-calendly host → 400 invalid_input + UPDATE not called

- **5 vitest tests** (`StripeConnectOnboardingCard.test.tsx`):
  - T1: `state='active'` → renders nothing
  - T2: `state='pending'` → heading + "Start onboarding" CTA
  - T3: `state='needs_info'` + 3 reqs → lists them + "+0 more"
  - T4: `state='restricted'` + disabled_reason → body has the reason + "Contact support" CTA
  - T5: CTA click → POST /stripe-connect-onboard + url opened in new tab

- **4 vitest tests** (`PartnerCustomizeForm.test.tsx`):
  - T1: `selectedTemplate='story'` → testimonial_quote VISIBLE
  - T2: `selectedTemplate='coach'` → testimonial_quote HIDDEN
  - T3: invalid calendly_url → error rendered + `partner-profile-update` NOT called
  - T4: valid save → POST `partner-profile-update` called with the exact 6-key body

Plus the 6 vitest from Plan 19-06a (`PartnerDashboard.test.tsx`) continue to pass with the real `StripeConnectOnboardingCard` shipped (15/15 total in the partner test directory).

## Verification commands

```
# Deno
deno test supabase/functions/partner-profile-update/index.test.ts --allow-env --allow-net
# → ok | 4 passed | 0 failed

# Vitest (all partner tests)
cd leanshot && ./node_modules/.bin/vitest run src/components/partner/__tests__/
# → Test Files  3 passed (3) · Tests  15 passed (15)

# Typecheck
cd leanshot && ./node_modules/.bin/tsc -b --noEmit
# → 0 errors

# Lint (new files)
./node_modules/.bin/eslint src/components/partner/{StripeConnectOnboardingCard,PartnerLinksPage,PartnerPayoutsPage,PartnerAssetsPage,PartnerTemplatePicker,PartnerCustomizeForm}.tsx src/components/partner/__tests__/{StripeConnectOnboardingCard,PartnerCustomizeForm}.test.tsx src/routes/partner-routes.ts
# → clean

# BL-4 verification
git diff --quiet src/App.tsx && echo "BL-4 OK"
# → BL-4 OK
```

## Commits in this plan

| # | Hash | Subject |
|---|------|---------|
| 1 | `7dd0ad9` | feat(19-06b): partner-profile-update Edge Fn — BL-2 Path A column allowlist (JWT-gated) |
| 2 | `2371f69` | feat(19-06b): StripeConnectOnboardingCard — real 4-state machine (overwrites 19-06a placeholder) |
| 3 | `44c5336` | feat(19-06b): /partner/links + /payouts + /assets pages + partner-routes registry |

## Threat-model references

| Threat ID | Coverage in this plan |
|-----------|----------------------|
| T-19-06b-S (spoofing) | `partner-profile-update` resolves `user.id` from JWT; WHERE clause never trusts request body |
| T-19-06b-T (tampering — non-allowlist column) | `ALLOWED_COLUMNS` gate in `partner-profile-update/index.ts` — any extra body key → 400; Deno T2 proves UPDATE is not called |
| T-19-06b-T (tampering — invalid template_choice) | `ALLOWED_TEMPLATES` enum gate; 400 with `invalid_field: 'template_choice'` |
| T-19-06b-T (XSS via display_name/blurb/testimonial) | React auto-escape (V5); server-side length caps mitigate quote-bomb |
| T-19-06b-R (repudiation — payout denied) | Payouts table has no UPDATE policy from client; `stripe_transfer_id` is the canonical reference (displayed in UI for support tickets) |
| T-19-06b-I (Storage URL TTL) | `createSignedUrl(path, 3600)` — 1-hour TTL; URL is not persisted past the download click |
| T-19-06b-D (DoS via save spam) | Per-user in-memory rate limit (10/60s); legitimate flow is the user clicking Save manually |
| T-19-06b-E (elevation — edit another affiliate) | WHERE clause = `affiliates.user_id = $jwt.user.id`; RLS denies cross-tenant UPDATE even if Edge Fn were bypassed (Plan 19-01) |

## BL-4 verification (App.tsx untouched)

```
$ git diff --quiet leanshot/src/App.tsx && echo "BL-4 OK — App.tsx untouched" || echo "BL-4 FAIL"
BL-4 OK — App.tsx untouched
```

Plan 19-09 (Wave 5) imports `PARTNER_ROUTES` + `AFFILIATE_APPLY_ROUTES` and wires both into App.tsx in one targeted commit.

## Deviations from plan

None applicable to Rules 1-3; one minor type-safety adjustment:

1. **[Rule 3 — Blocking issue] TypeScript cast in `partner-routes.ts`**
   - **Issue:** `RouteDescriptor.componentLoader` was typed as `() => Promise<{ default: ComponentType }>` (zero props), but `PartnerLayout.default` requires `children` + optional `__testActivePath`. Direct return triggered TS2322.
   - **Fix:** `import('@/components/partner/PartnerLayout') as unknown as Promise<{ default: ComponentType }>` — the cast surfaces the boundary explicitly. Plan 19-09's wiring is what supplies `children`; the route descriptor only signals "match this prefix, lazy-load this module" to the App.tsx matcher.
   - **Files modified:** `leanshot/src/routes/partner-routes.ts`
   - **Commit:** `44c5336`

2. **[Rule 3 — Blocking issue] `aria-pressed` removed from radio-role card in `PartnerTemplatePicker`**
   - **Issue:** ESLint `jsx-a11y/role-supports-aria-props` flagged `aria-pressed` on `role="radio"` — `aria-pressed` is for toggle buttons, not radios. `aria-checked` is the correct attribute for radio.
   - **Fix:** Dropped `aria-pressed`; kept `aria-checked={isSelected}`.
   - **Files modified:** `leanshot/src/components/partner/PartnerTemplatePicker.tsx`
   - **Commit:** `44c5336`

## Open items (for downstream plans)

| Item | Owner | Notes |
|------|-------|-------|
| Wire `PARTNER_ROUTES` into App.tsx (alongside `AFFILIATE_APPLY_ROUTES`) | Plan 19-09 | BL-4 contract |
| Extend PartnerLayout's child-rendering switch to dynamic-import Links/Payouts/Assets | Plan 19-09 | At this plan's close PartnerLayout only renders Dashboard; pathname-suffix routing for the other 3 pages is Plan 19-09's responsibility |
| Populate `marketing-assets/v1/` Storage bucket + bucket-level RLS | Plan 19-08 | PartnerAssetsPage falls through to friendly toast until seeded |
| Populate `affiliate-photos` Storage bucket + RLS (`{user_id}/profile.{ext}` paths) | Plan 19-08 | PartnerCustomizeForm photo upload depends on bucket existing |
| Live-preview render for /partner/links | Plan 19-08 | Landing renderers (coach/story/method) ship there |

## Self-Check: PASSED

Files created (verified via filesystem):
- FOUND: leanshot/src/components/partner/StripeConnectOnboardingCard.tsx (overwritten)
- FOUND: leanshot/src/components/partner/PartnerLinksPage.tsx
- FOUND: leanshot/src/components/partner/PartnerPayoutsPage.tsx
- FOUND: leanshot/src/components/partner/PartnerAssetsPage.tsx
- FOUND: leanshot/src/components/partner/PartnerTemplatePicker.tsx
- FOUND: leanshot/src/components/partner/PartnerCustomizeForm.tsx
- FOUND: leanshot/src/components/partner/__tests__/StripeConnectOnboardingCard.test.tsx
- FOUND: leanshot/src/components/partner/__tests__/PartnerCustomizeForm.test.tsx
- FOUND: leanshot/src/routes/partner-routes.ts
- FOUND: supabase/functions/partner-profile-update/index.ts
- FOUND: supabase/functions/partner-profile-update/index.test.ts
- FOUND: supabase/functions/partner-profile-update/deno.json
- FOUND: supabase/functions/partner-profile-update/cors.ts

Commits (verified via git log):
- FOUND: 7dd0ad9 — feat(19-06b): partner-profile-update Edge Fn
- FOUND: 2371f69 — feat(19-06b): StripeConnectOnboardingCard real
- FOUND: 44c5336 — feat(19-06b): /partner pages + routes
