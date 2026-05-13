# Phase 14: Monetization Foundation (Stripe web + clinic seats) - Context

**Gathered:** 2026-05-13
**Status:** Ready for planning
**Mode:** mvp (vertical-slice planning)

<domain>
## Phase Boundary

The keystone monetization phase. A web user can subscribe via Stripe Checkout (hosted, 7-day card-required trial → auto-convert), manage their subscription via Stripe Customer Portal, and downstream features gate cleanly on a `tier` slice in the Zustand store. A clinic owner is billed via a **hybrid base+overage model** ($99/mo base covering up to 10 patients + $9/active-patient overage from 11+) with monthly true-up via Stripe metered billing. Webhook state is the single source of truth — the DB never drifts. Card-failure dunning surfaces a `past_due` banner.

**In scope:**

1. **Schema** — `subscriptions`, `subscription_events`, `stripe_customers` tables (Postgres, RLS-protected per project rule from `reference_supabase_project.md`). Every RLS surface gets a live cross-tenant impersonation proof test, not just policy SQL.
2. **Edge Functions** — `stripe-checkout` (creates Checkout session for web tier + clinic tier), `stripe-webhook` (verifies signature via Stripe SDK on Deno, deduplicates by `event.id`, writes `subscription_events` + updates `subscriptions`). Bundle target: stay tiny (Phase 12 didn't reserve a `stripe-elements` chunk for Edge-Function code; the chunk cap was for client-side Stripe.js if we'd picked Elements — we picked Checkout, so client-side ships only the redirect glue).
3. **Web tier model** — `tier` Zustand slice: `'free' | 'paid' | 'past_due'` + `paid_until`, `plan_id`, `provider: 'stripe'`. `<TierGate tier="paid" fallback="blur-upsell">` component as the canonical gating primitive.
4. **Pricing — web** — Single product `LeanShot Plus` with 2 recurring prices: monthly + annual (15% off). Free is the absence of a subscription (no `tier='free'` price ID).
5. **Pricing — clinic** — Single product `LeanShot Clinic` with 2 prices: base ($99/mo, includes 10 active patients) + metered overage ($9/active-patient/mo from patient #11). One Checkout session attaches both prices.
6. **Bootstrap script** — `scripts/stripe-bootstrap.ts` creates the 5 prices (3 web + 2 clinic) idempotently via Stripe API; outputs price IDs into `.env.example`. Live price IDs land in Vercel env vars + Supabase Function secrets, fetched/verified via Stripe MCP per memory `feedback_cli_over_paste_back`.
7. **`<TierGate>` component** — Default behavior is `blur-upsell` (8-12 px gaussian blur over the gated feature + centered upsell card "Subscribe to unlock — 7-day free trial"). Per-feature exception types: `hard-block-no-ui` (ads when they ship), `hard-block-cta` (advanced AI model selector). Always-on `past_due` banner is separate from TierGate (top-of-dashboard chrome).
8. **Paywalled features in v1.2 scope:**
   - **Pharmacology projection 7-day forecast curve overlay** (paid only) — past 28 days stays free per D-05.
   - **Advanced AI coach model selector** (paid only — basic rule-based coach stays free).
   - **Ad-free** — placeholder gate (no ads ship until Phase 20, but the slot exists in the TierGate registry).
9. **Customer Portal** — link from settings → opens Stripe-hosted Portal in new tab. Stripe handles all payment-method / cancel / change-plan UX. Return URL = `/settings?from=portal` so a webhook+refresh cycle picks up the change within 10 seconds (SC #2).
10. **Past_due flow** — when Stripe sends `invoice.payment_failed` AND `subscription.status = past_due`, the webhook flips `tier='past_due'`. Banner renders at every dashboard view top; "Update card" CTA opens Customer Portal in a new tab. On `invoice.paid` after retry, banner clears via `tier='paid'`.
11. **CSP add** — `script-src` gets `https://js.stripe.com`; `frame-src` gets `https://js.stripe.com https://hooks.stripe.com`; `connect-src` gets `https://api.stripe.com https://m.stripe.network`. Verified via Phase 12 12-04 CSP snapshot test.

**Explicitly NOT in scope:**

- **iOS/Android in-app subscriptions** (MONEY-06) — Phase 16 with RevenueCat (Apple §3.1.1 + Google §3.1.1 forbid Stripe for digital in-app subs).
- **Cross-platform tier reconciliation** (MONEY-07) — Phase 19 (consumes both `provider='stripe'` and `provider='revenuecat'` rows; takes whichever expires later).
- **Account-deletion Stripe cascade** (MONEY-10) — Phase 19 (Affiliate phase owns the full delete-cascade since it crosses Connect payouts retention).
- **Pricing page UI** — Phase 15 (page builder + pricing-page template + Checkout-button block) consumes the live price IDs we ship here.
- **Push notification on card failure** — PUSH-05 is Phase 17 (Push Notifications phase). Phase 14 ships banner + Stripe email; push hook fires from Phase 17 consuming the `subscription_events` insert.
- **`subscriptions` admin dashboard** — Phase 22 (Admin operator surface).
- **Stripe Connect for affiliate payouts** — Phase 19 (account scaffolded in Phase 12; payout flow Phase 19).

</domain>

<canonical_refs>
## Canonical References

**Project plumbing (MUST READ before research/planning):**
- `.planning/ROADMAP.md` (line 71) — Phase 14 goal + SCs + 7 REQ-IDs (MONEY-01..05, 08, 09)
- `.planning/REQUIREMENTS.md` (lines 101-114) — MONEY-NN acceptance lines
- `leanshot/CLAUDE.md` — Tailwind v4 + Zustand + path alias `@/*` + router-less view selector + `useReducedMotion` gating + hex-literal anti-pattern
- `leanshot/src/lib/store.ts` — Zustand store; `tier` slice gets added here as partialized state
- `leanshot/src/types/index.ts` — domain types barrel; `Subscription` / `Tier` types land here
- `supabase/functions/` (repo root, NOT `leanshot/supabase/`) — Edge Function home. Existing siblings: `share`, `clinic-invite`, `bulk-csv-export`, `ai-chat`. `stripe-checkout` + `stripe-webhook` join them.
- `supabase/migrations/` — Postgres migrations. New migrations follow Phase 7+ patterns from `reference_supabase_migration_gotchas`: IMMUTABLE partial-index expressions, SECURITY DEFINER functions need `extensions` in search_path, direct DELETE on `storage.objects` requires `set_config('storage.allow_delete_query', 'true', true)`, cascade DELETE crossing audit_logs needs `app.suppress_audit` GUC hook.
- `leanshot/tests/csp/csp-snapshot.txt` + `csp-snapshot.test.ts` — Phase 12 CSP gate. Stripe directives added here.
- `leanshot/.planning/phases/12-bootstrap-bundle-foundations/12-05-SUMMARY.md` — Stripe Connect Express vendor scaffold landed Phase 12. Live keys + webhook endpoints provisioned at the vendor level.

**Memory carryovers (LeanShot reference):**
- [[reference_supabase_project]] — RLS surface rule MUST apply to `subscriptions` table: live cross-tenant impersonation proof test, not just policy SQL.
- [[reference_supabase_migration_gotchas]] — apply to any Phase 14 migrations.
- [[feedback_cli_over_paste_back]] — fetch Stripe price IDs + webhook secrets via MCP, not user paste-back.
- [[feedback_aggressive_foundations]] — Phase 14 has BOTH user-facing UX (banner, blur-upsell, Checkout) AND process/infra (webhook, idempotency). Aggressive on user-facing; lean on infra mechanics.
- [[feedback_regulator_vs_user_audience_pattern]] — same dual-audience: dunning banner = end-user (aggressive UX); webhook signature verify = process (terse, library-default).
- [[feedback_parallel_executor_git_isolation]] — pathspec discipline for parallel wave execution.
- [[feedback_worktree_cleanup_cwd_trap]] — always run cleanup loop from `git rev-parse --show-toplevel`.
- [[reference_worktree_executor_handoff]] (Phase 13 empirical correction) — always run cleanup loop regardless of return marker; spot-check `git log main` before trusting completion.
- [[feedback_planner_iter1_anti_patterns]] — 11 patterns to pre-empt in planner prompt, especially Pattern 6 (centralized constants/components ≠ wired consumers).
- [[feedback_addendum_pattern_for_mid_execution_pivots]] — addendum plan if verifier catches a gap mid-execution.

**External docs (research will fetch):**
- Stripe Checkout Server reference (session creation, line_items, trial_period_days, success_url, cancel_url)
- Stripe Webhooks signature verification on Deno (needs `stripe.webhooks.constructEventAsync` for native crypto)
- Stripe Customer Portal configuration (allowed actions: cancel + change payment method + change plan)
- Stripe Metered Billing (`recurring.usage_type='metered'` + usage records via `usage_records.create`)

</canonical_refs>

<code_context>
## Reusable Assets + Patterns

**Existing primitives Phase 14 reuses directly:**
- `useStore` + `partialize` partialization pattern in `store.ts` — `tier` slice added here.
- Zustand selector convention `useStore((s) => s.tier)` per CLAUDE.md.
- Edge Function deployment via `supabase functions deploy <name>` (Phase 5/8/9/10 pattern).
- Edge Function tests via Deno `<name>.test.ts` in `supabase/functions/<name>/` (Phase 5 lesson: Deno test discovery glob is `{*_,*.,}test.*` per memory `reference_deno_test_discovery`).
- RLS policy + cross-tenant impersonation proof test pattern (Phase 5 BL-1 / Phase 6+).
- Modal pattern (`Modal.tsx` + `Sheet.tsx`) for the in-app paywall upsell card.
- Settings page (`SettingsPage.tsx`) for the "Manage subscription" entry point.

**Existing infrastructure Phase 14 hooks into:**
- Phase 4 Supabase Auth (`auth.users` + `linkIdentity`-via-`updateUser` for password promotion).
- Phase 5 patient profile (`patient_profiles`) — `tier` joins here via `user_id`.
- Phase 9 clinic schema (`clinics`, `clinic_memberships`) — clinic-tier subscriptions join `clinic_id`.
- Phase 9 `clinic_invites` — "active patient" count joins this + last activity timestamp from `injections`/`weights`/`meals`/`workouts` (whichever table the patient most recently wrote to).
- Phase 13 token system — `past_due` banner uses warning tokens (`var(--color-warning)` warm-orange); upsell card uses primary tokens.

**Net-new files for Phase 14:**
- `supabase/migrations/20260601000XXX_subscriptions.sql` (subscriptions + subscription_events + stripe_customers + RLS + active-patient-count function)
- `supabase/functions/stripe-checkout/index.ts` + `.test.ts`
- `supabase/functions/stripe-webhook/index.ts` + `.test.ts`
- `scripts/stripe-bootstrap.ts`
- `leanshot/src/components/billing/TierGate.tsx`
- `leanshot/src/components/billing/PaywallUpsell.tsx` (the inline upsell card the blur overlay reveals)
- `leanshot/src/components/billing/PastDueBanner.tsx`
- `leanshot/src/components/billing/ManageSubscriptionLink.tsx` (Settings entry)
- `leanshot/src/lib/billing.ts` (`<TierGate>` policy registry + `getActiveTier()` helper)
- E2E specs: `leanshot/e2e/checkout-trial-flow.spec.ts`, `leanshot/e2e/past-due-banner.spec.ts`, `leanshot/e2e/clinic-metered-billing.spec.ts` (Stripe test mode + fixture clock)
- `leanshot/src/components/dashboard/cards/MedLevelChart.tsx` — gated by TierGate for the 7-day forecast overlay (existing file, surgical addition)
- `leanshot/src/components/dashboard/ai/AIChatPanel.tsx` — model selector wrapped in TierGate (existing file, surgical addition)

**Bundle ceiling context (Phase 12 + Phase 13):**
- Index chunk ceiling 50 kB gz; current 13.62 kB. Phase 14 adds `tier` slice (~0.5 kB) + TierGate primitive (~1 kB) + PastDueBanner (~0.5 kB). Comfortably under.
- Phase 12 12-01 named `stripe-elements` chunk cap ≤30 kB exists but UNUSED — we picked Checkout, not Elements. The chunk simply won't ship. Plan-checker should NOT flag this as a regression.
- Stripe.js client-side (`@stripe/stripe-js`) is ~30 kB gz BUT only loads on the `/checkout` redirect transition — it's `import()`-dynamic from the "Upgrade" CTA, not in the index. Same pattern as Phase 5 supabase-js deferred init.

**Known landmines:**
1. Stripe webhook idempotency: `event.id` MUST have a UNIQUE constraint on `subscription_events`; webhook handler upserts on conflict. Stripe retries 24h on non-2xx; replays happen at any time.
2. Webhook signature verification on Deno: standard `stripe.webhooks.constructEvent` doesn't work — needs `constructEventAsync` for `crypto.subtle.timingSafeEqual`. Phase 14 research must verify Stripe SDK version supports it.
3. Customer Portal return URL: must add to Vercel domain allowlist in Stripe Dashboard Portal settings.
4. Metered billing usage records: idempotency key recommended (`{clinic_id}_{period_start}` or similar) so re-runs don't double-charge. Stripe's `idempotency_key` header on `usage_records.create`.
5. `tier='past_due'` is technically a UX state, not a Stripe state. Stripe has `incomplete`, `past_due`, `canceled`, `unpaid`, etc. Phase 14 collapses `past_due` + `unpaid` → UX `past_due`; `canceled` → UX `free` (after `current_period_end`).
6. The `tier` field MUST survive offline: persisted via `partialize` in Zustand. Stale `tier` if user lapses while offline is acceptable — they regain `paid` on next online + webhook sync.

</code_context>

<decisions>
## Implementation Decisions

### Clinic billing model

- **D-01 (LOCKED, clinic billing structure):** **Hybrid base + per-active-patient overage.** Single Stripe Checkout attaches 2 prices: base recurring ($99/mo, includes 10 active patients) + metered recurring ($9/active-patient/mo from patient #11). Stripe creates 2 price IDs under one product (`LeanShot Clinic`). **Rejected:** per-active-only (worse UX for small clinics: per-patient anxiety at 1 patient). **Rejected:** per-operator-seat (disincentivizes adding light-touch staff).

- **D-02 (LOCKED, active-patient definition):** A patient counts as "active" for the metered-overage line-item if and only if BOTH: (1) the patient has accepted the clinic invite (`clinic_memberships.status='active'`); AND (2) the patient has written to any of {`injections`, `weights`, `meals`, `workouts`, `symptoms`} within the last 30 rolling days. Counter recomputed via a Postgres function `count_active_patients(clinic_id uuid)` called by the monthly true-up Edge Function (runs on Stripe billing period close via `invoice.upcoming` webhook OR a Vercel cron). **Rejected:** invite-accepted-regardless (charges for ghosts). **Rejected:** any-activity-only (excludes brand-new patients).

### Pharmacology projection paywall

- **D-03 (LOCKED, paywall split):** **Past free / future paid.** Free users see the historical 28-day pharmacology curve (their own data, charted). Paid unlocks the 7-day forecast overlay (the projection line drawn forward from "today"). Splits the feature at a defensible value boundary — "see your data" is free, "see the future" is paid. **Rejected:** entire-card-paywall-at-GA (blocks the headline feature at the worst onboarding moment). **Rejected:** all-free-at-GA-paywall-test-later (harder to retrofit a paywall users got used to).

- **D-04 (LOCKED, paywall scope):** Just the 7-day forecast curve overlay layer in `MedLevelChart.tsx`. 28-day past, half-life math, site-rotation v2 with numbered dots (Phase 13), titration plan, dose history — all stay free. Surgical paywall surface = one chart layer with a `<TierGate tier="paid">` wrapper.

### `<TierGate>` UX policy

- **D-05 (LOCKED, default policy):** **`blur-upsell`** — 8-12 px gaussian blur over the gated feature + centered upsell card ("Subscribe to unlock [feature] — 7-day free trial"). Preview-then-pay pattern; users see what they're getting. CSS `backdrop-filter: blur(10px)` + an overlay card (z-index above the blurred content). Respect `prefers-reduced-motion` (skip the blur transition animation).

- **D-06 (LOCKED, ad-free exception):** **`hard-block-no-ui`** — no ad UI element renders for paid users (no upsell-over-blank-space — would defeat the purpose). When ads ship (Phase 20), `<TierGate tier="paid" mode="hide-ads">` renders nothing for paid; renders ad slot for free.

- **D-07 (LOCKED, advanced AI coach exception):** **`hard-block-cta`** on the model selector dropdown in `AIChatPanel.tsx`. Free users see the basic rule-based coach with a "Free" pill label + an "Upgrade" CTA in the panel header pointing to the upsell modal. No blur-overlay (the basic coach is a different UI, not the same UI blurred).

- **D-08 (LOCKED, past_due banner):** Always-visible at top of every dashboard view when `tier='past_due'`, regardless of TierGate state. Renders independently of `<TierGate>` (it's chrome, not a feature gate). Uses warm-orange `var(--color-warning)` from Phase 13 token system. "Update card" CTA opens Stripe Customer Portal in a new tab.

### Pricing model + Stripe product source

- **D-09 (LOCKED, web tier granularity):** **Free + paid-monthly + paid-yearly (15% annual discount).** 1 Stripe product (`LeanShot Plus`) with 2 recurring prices: monthly + yearly. Free is the absence of a subscription. Concrete numbers to confirm during research: monthly $9.99 vs $12.99 — TBD by research/planner. Annual = monthly × 12 × 0.85. **Rejected:** single monthly tier (~25% LTV loss). **Rejected:** lifetime SKU at GA (deferred to v1.3+; complicates dunning + cancel for lifetime users).

- **D-10 (LOCKED, clinic pricing):** **$99/mo base (10 patients included) + $9/active-patient/mo overage.** Floor revenue per clinic of $99 even with 1 patient; overage kicks in at patient #11. Defensible vs Healthie ($199 base) and SimplePractice ($69 + per-clinician). 50 active patients = $99 + 40×$9 = $459/mo.

- **D-11 (LOCKED, product source):** **`scripts/stripe-bootstrap.ts`** creates the 5 prices idempotently via Stripe API at first run; outputs price IDs into `.env.example` placeholders. Script checks for existing products by `name` (idempotent — safe to re-run). Live price IDs land in Vercel env vars (`VITE_STRIPE_PRICE_PLUS_MONTHLY`, `_YEARLY`, `STRIPE_PRICE_CLINIC_BASE`, `_OVERAGE`) + Supabase Function secrets (same names) via `vercel env add` and `supabase secrets set`, fetched via Stripe MCP per [[feedback_cli_over_paste_back]]. **Rejected:** Dashboard-UI (not reproducible). **Rejected:** DB-stored `products` table (over-engineering for v1.2; revisit if in-app pricing experiments become a thing).

### Inherited from goal text (informational — restate goal/SCs)

- **D-12 [informational]:** Hosted Checkout (NOT Elements) — goal phrasing.
- **D-13 [informational]:** 7-day card-required trial, auto-convert — SC #1.
- **D-14 [informational]:** Webhook is source of truth; DB never drifts — goal phrasing.
- **D-15 [informational]:** RLS + cross-tenant impersonation proof test required for `subscriptions` — project rule from [[reference_supabase_project]].
- **D-16 [informational]:** CSP additions: `js.stripe.com`, `m.stripe.network`, `hooks.stripe.com`, `api.stripe.com` — verified by Phase 12 12-04 CSP snapshot test.
- **D-17 [informational]:** Phase 14 = web + clinic only. MONEY-06 → Phase 16; MONEY-07 → Phase 19; MONEY-10 → Phase 19.

</decisions>

<deferred>
## Deferred Ideas

- **Lifetime SKU** — strong cash-flow + reduces churn for early adopters but complicates dunning (no `current_period_end`). v1.3+ candidate.
- **In-app pricing experiments via DB `products` table** — overkill for v1.2. Revisit if marketing wants to A/B-test price points without code deploys.
- **Push notification on card failure (PUSH-05)** — Phase 17 owns. Phase 14 ships banner + Stripe email; push hook fires from Phase 17 consuming `subscription_events` insert.
- **Annual prepay incentive UX** — show "save 15%" badge on annual price in Checkout (default Stripe UI handles this; we don't need custom code). v1.2.x polish.
- **Tax handling** — Stripe Tax (`automatic_tax: { enabled: true }`) for VAT/US sales tax. Research will confirm if turning this on is just a flag or needs `tax_id_collection` + customer-tax-ID inputs. Likely flag-only for v1.2 launch.
- **Promo codes / coupon support** — Stripe Checkout `allow_promotion_codes: true` flag. Marketing-driven; defer until first promo campaign.
- **Subscriptions admin dashboard** — Phase 22 owns. View all subscriptions, refund, comp accounts, MRR/churn metrics.

</deferred>

<scope_guardrail>
## Scope Guardrail

**Phase 14 ships the Stripe foundation: schema + Edge Functions + `<TierGate>` + Checkout + Portal + clinic metering + dunning banner. It does NOT ship:**
- Mobile in-app subscriptions (Phase 16 RevenueCat)
- Cross-platform tier reconciliation (Phase 19)
- Account-deletion Stripe cascade (Phase 19)
- Pricing page UI (Phase 15 page builder)
- Push notification on card failure (Phase 17)
- Admin dashboard for subscriptions (Phase 22)
- Tax handling, coupon flows, lifetime SKU (deferred above)

**If scope creep surfaces during research/planning/execution:**
- New SDK / new vendor dependency → defer (every vendor add is its own phase entry per [[feedback_vendor_account_circular_dependency]]).
- Stripe Elements / embedded card UI → REJECT (goal locks Checkout; revisiting Elements is its own phase).
- DB-backed pricing-experiment plumbing → REJECT (deferred).

</scope_guardrail>

<success_criteria_carry>
## Success Criteria (verbatim from ROADMAP Phase 14)

1. User on the web app clicks "Upgrade" → lands on Stripe Checkout → enters card → starts a 7-day trial → returns to the app → sees `tier='paid'` reflected in UI (ad-free, advanced AI, optional pharma-projection); on day 8 Stripe auto-charges, `subscriptions` row stays current. — Enforced by `stripe-checkout` Edge Function + webhook handler + `tier` Zustand slice + E2E `checkout-trial-flow.spec.ts` using Stripe test mode.
2. User opens "Manage subscription" → opens Stripe-hosted Customer Portal in a new tab → changes payment method / cancels / changes plan → returns to the app → `subscription_events` webhook landed and `tier` reflects the change within 10 seconds. — Enforced by Portal link in Settings + webhook handler + return-URL refresh path.
3. Clinic owner adds their 11th patient → Stripe metered billing line item is incremented for the current period → end-of-month invoice reflects the per-active-patient charge for all 11. — Enforced by `count_active_patients()` Postgres function + metered usage record write in webhook handler / cron + E2E `clinic-metered-billing.spec.ts`.
4. User's card fails mid-cycle → Stripe Smart Retries kick in (retries 1/3/5) → user sees `past_due` banner in UI + receives Stripe-driven dunning email; banner clears on successful retry. — Enforced by webhook handler `invoice.payment_failed`/`paid` → `tier='past_due'`/`'paid'` + `<PastDueBanner>` + E2E `past-due-banner.spec.ts`.
5. Visitor sees a pricing page (built via Phase 15 PAGE-09 wire-up later) with a comparison table; clicking "Subscribe" lands them on live Stripe Checkout with the correct price ID; `<TierGate>` correctly blocks premium features for `tier='free'` users. — **Phase 14 portion:** ships live price IDs via env vars consumable by Phase 15 + `<TierGate>` primitive. Phase 15 builds the pricing page UI.

</success_criteria_carry>

<next_step>
**Next:** `/clear` then `/gsd-plan-phase 14 leanshot --chunked` (Phase 14 is bounded but multi-faceted — schema migration + 2 Edge Functions + bootstrap script + 5 components + 3 E2E specs ≈ 6-7 plans; chunked parallel planning saves ~30 min per [[feedback_parallel_chunked_planning]]).

**Pre-flight checks for planner:**
- [ ] Confirm Stripe Connect Express account from Phase 12 is fully approved (not still in test-mode pending review).
- [ ] Verify `supabase/functions/import_map.json` exists at repo root and supports adding Stripe SDK import.
- [ ] Confirm `STRIPE_SECRET_KEY` (test) + `STRIPE_WEBHOOK_SECRET` are set in Supabase Function secrets via `supabase secrets list`.
- [ ] Research should confirm Stripe SDK version on Deno supports `constructEventAsync` for webhook signature verification (the synchronous variant doesn't work).
- [ ] Phase 12 reserved a `stripe-elements` chunk cap; Phase 14 plan-checker should NOT flag missing-chunk as regression (the chunk simply won't ship since we picked Checkout, not Elements).
- [ ] CSP additions to `tests/csp/csp-snapshot.txt` are part of one of the Wave-1 plans (likely `stripe-webhook` or a dedicated CSP migration plan).

</next_step>
