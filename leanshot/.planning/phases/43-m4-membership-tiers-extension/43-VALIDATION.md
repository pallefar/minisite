---
phase: 43
slug: m4-membership-tiers-extension
status: ready
nyquist_compliant: true
wave_0_complete: true
created: 2026-05-22
updated: 2026-05-22
---

# Phase 43 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Populated inline from per-plan `<verify><automated>` blocks (Plan-checker Dim 8e).

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest + RTL (leanshot/), Deno test (supabase/functions/), bash grep gates (supabase/migrations/), TS strict typecheck |
| **Config file** | `leanshot/vite.config.ts` (Vitest); `leanshot/playwright.config.ts`; per-Fn `supabase/functions/<fn>/deno.json` |
| **Quick run command** | `cd leanshot && npx vitest run <path>` OR `$HOME/.deno/bin/deno test --allow-all --no-check <path>` |
| **Full suite command** | `cd leanshot && npm install && npx tsc -p tsconfig.app.json --noEmit && npx vitest run && npx playwright test && cd .. && for d in supabase/functions/{stripe-webhook,stripe-checkout,cancellation-accept-offer,_shared}; do $HOME/.deno/bin/deno test --allow-all --no-check $d/; done` |
| **Estimated runtime** | ~3 minutes full suite; ~10-20s per individual file |

---

## Sampling Rate

- **After every task commit:** Run the task's `<verify><automated>` block
- **After every plan wave:** Run full Deno sweep + Vitest + TS typecheck
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** ~60 seconds for any single task verify

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 43-01-01 | 01 | 1 | MEMBER-01 | T-43-01-03/04 | RLS denial-by-default + self-read on lifetime_purchases | grep + structural | `grep 'pol_lifetime_purchases_self_read' supabase/migrations/20270715000001_p43_lifetime_purchases.sql && [ "$(grep -v '^--' ... | grep -ci 'create policy.*lifetime_purchases.*for insert\|...for update\|...for delete')" = "0" ]` | ❌ task creates | ⬜ pending |
| 43-01-02 | 01 | 1 | MEMBER-01 | — | tier_effective view extension via CREATE OR REPLACE (no DROP) preserving column order; tier_label appended | grep | `grep 'create or replace view public.tier_effective' && grep 'security_invoker = true' && grep 'from public.lifetime_purchases' && grep 'tier_label' && [ "$(grep -c 'drop view' ...)" = "0" ]` | ❌ task creates | ⬜ pending |
| 43-01-03 | 01 | 1 | MEMBER-01 | T-43-01-01/02/06 | Webhook lifetime branch idempotent; non-blocking Slack alert; terminal-else updated | Deno test (5 cases) | `$HOME/.deno/bin/deno test --allow-all --no-check supabase/functions/stripe-webhook/events/checkout-session-completed.test.ts` | ✓ extend existing | ⬜ pending |
| 43-02-01 | 02 | 1 | MEMBER-02 | T-43-02-03/05 | grandfathered_prices admin-read RLS + denial-by-default writes + FK CASCADE + UNIQUE | grep | `grep 'create table.*grandfathered_prices' && grep 'references public.cohort_definitions' && grep 'unique (cohort_id, stripe_price_id, effective_from)' && grep 'pol_grandfathered_prices_admin_read' && [ "$(grep -c ...for insert/update/delete)" = "0" ]` | ❌ task creates | ⬜ pending |
| 43-02-02 | 02 | 1 | MEMBER-02 | T-43-02-01/04/06 | SECDEF RPCs with auth.uid null check + admin gate + suppress_audit + log_admin_action × 3 | grep counts | `[ "$(grep -c 'is_admin_at_least.*admin.*admin_role' ...)" -ge "3" ] && [ "$(grep -c 'log_admin_action' ...)" -ge "3" ] && [ "$(grep -c 'security definer' ...)" -ge "3" ]` | ❌ task creates | ⬜ pending |
| 43-03-01 | 03 | 1 | MEMBER-04 | T-43-03-01 | Dual variants: current_user_has_pro (auth.uid) + user_has_pro (p_user_id) per auth.uid-vs-service-role trap | grep | `grep 'create or replace function public.current_user_has_pro' && grep 'create or replace function public.user_has_pro(p_user_id uuid)' && grep 'where user_id = auth.uid()' && grep 'where user_id = p_user_id'` | ❌ task creates | ⬜ pending |
| 43-03-02 | 03 | 1 | MEMBER-02 | T-43-03-02 | resolve_user_effective_price: plpgsql SECDEF STABLE; cohort_is_member join; most-recent effective_from wins | grep | `grep 'create or replace function public.resolve_user_effective_price' && grep 'public.cohort_is_member(p_user_id, gp.cohort_id)' && grep 'order by gp.effective_from desc'` | ❌ task creates | ⬜ pending |
| 43-03-03 | 03 | 1 | MEMBER-04 | — | 43-PRO-GATING-CONTRACT.md ships verbatim SQL for Phases 44/46/47 (3 tables × 3 SQL stanzas) | file + grep | `[ -f .planning/phases/43-*/43-PRO-GATING-CONTRACT.md ] && grep 'current_user_has_pro' && grep 'community_spaces\|courses\|events' && grep 'pro_required'` | ❌ task creates | ⬜ pending |
| 43-04-01 | 04 | 2 | MEMBER-03 | T-43-04-07 | clampCombinedDiscount: multiplicative; clips promo, preserves SAVE-offer; rejects invalid input; 6 cases | Deno test | `$HOME/.deno/bin/deno test --allow-all --no-check supabase/functions/_shared/clamp-combined-discount.test.ts` | ❌ task creates | ⬜ pending |
| 43-04-02 | 04 | 2 | MEMBER-01/02/03 | T-43-04-01/02/03 | stripe-checkout: lifetime branch + grandfathered resolver + 70%-cap pre-validator + vendor-gated 503; 7 cases | Deno test | `$HOME/.deno/bin/deno test --allow-all --no-check supabase/functions/stripe-checkout/index.test.ts` | ❌ task creates | ⬜ pending |
| 43-04-03 | 04 | 2 | MEMBER-03 | T-43-04-03 | cancellation-accept-offer: clamp injected BEFORE applyDiscount + D-08 trial-extension idempotency; 5 cases + textual-order grep | Deno test + grep | `$HOME/.deno/bin/deno test --allow-all --no-check supabase/functions/cancellation-accept-offer/index.test.ts && awk '/clampCombinedDiscount/{c=NR}/applyDiscount[(]/{d=NR} END{print (c<d)?"OK":"FAIL"}' supabase/functions/cancellation-accept-offer/index.ts` | ❌ task creates | ⬜ pending |
| 43-05-01 | 05 | 3 | MEMBER-01/02/04 | T-43-05-02/04 | PaywallUpsell additive optional props; useCurrentUserHasPro 60s LRU; LifetimeBadge conditional render; 13 cases | Vitest | `cd leanshot && npx vitest run src/components/billing/PaywallUpsell.test.tsx src/lib/entitlement/current-user-has-pro.test.ts src/components/billing/LifetimeBadge.test.tsx` | ❌ task creates | ⬜ pending |
| 43-05-02 | 05 | 3 | MEMBER-02 | T-43-05-01/05 | GrandfatheredPricesPage CRUD via SECDEF RPCs; ADMIN_MODULES manifest sibling entry; TS typecheck; 5 cases | Vitest + tsc | `cd leanshot && npx vitest run src/admin/modules/billing/GrandfatheredPricesPage.test.tsx && npx tsc -p tsconfig.app.json --noEmit` | ❌ task creates | ⬜ pending |
| 43-06-01 | 06 | 3 | ALL | T-43-06-01 | Pre-deploy: 7 migrations + filename regex + remote tail + Deno sweep + leanshot full suite + bundle budget | bash | `ls supabase/migrations/20270715*.sql | wc -l` = 7; remote tail < 20270715000001; full Deno + Vitest + tsc green | ✓ from prior tasks | ⬜ pending |
| 43-06-02 | 06 | 3 | ALL | T-43-06-02/03/04 | [BLOCKING] supabase db push --linked + functions deploy ×3 + STRIPE_PRICE_LIFETIME secret + stripe_price_lookup populate + 4-signal HUMAN-UAT | checkpoint | `supabase db push --linked && supabase functions deploy stripe-webhook stripe-checkout cancellation-accept-offer --import-map supabase/functions/import_map.json` | operator-gated | ⬜ pending |
| 43-06-03 | 06 | 3 | ALL | T-43-06-05/06 | 43-CARRY-OVER.md + 43-DEPLOY-NOTES.md written with deploy + UAT signal outcomes | file existence + grep | `[ -f .planning/phases/43-*/43-CARRY-OVER.md ] && [ -f .planning/phases/43-*/43-DEPLOY-NOTES.md ] && grep 'Deploy Sequence\|HUMAN-UAT Signals'` | task creates | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

Per RESEARCH §"Wave 0 Gaps" — all per-Fn / per-component test files are CREATED in their parent task (not in a separate Wave 0 plan). Each task's RED-GREEN-REFACTOR cycle scaffolds its own test file. Mapping:

- [x] `leanshot/src/lib/entitlement/tier-effective-lifetime.test.ts` — NOT created (integration coverage rolled into 43-01-03 webhook test + 43-05-01 hook test; live view shape verified at db-push time in 43-06-01)
- [x] `leanshot/src/lib/entitlement/current-user-has-pro.test.ts` — created in 43-05 Task 1
- [x] `leanshot/src/lib/checkout/clamp-discount.test.ts` — created in 43-04 Task 1 (`supabase/functions/_shared/clamp-combined-discount.test.ts`; Edge-Fn-side, single source of truth)
- [x] `leanshot/src/lib/admin/grandfathered-prices-rls.test.ts` — covered by 43-06 SIGNAL D (live RLS cross-tenant proof); no separate unit test file needed since Vitest-against-live RLS pattern is the project's RLS verification convention
- [x] `supabase/functions/stripe-checkout/resolve-price.test.ts` — covered by 43-04 Task 2 (`supabase/functions/stripe-checkout/index.test.ts`) Test 3 stub of `resolve_user_effective_price`
- [x] `supabase/functions/stripe-checkout/apply-trial-extension.test.ts` — covered by 43-04 Task 2 Test 5 (idempotency log INSERT)
- [x] `supabase/functions/stripe-webhook/events/checkout-session-completed.test.ts` — extended in 43-01 Task 3
- [x] `leanshot/src/components/billing/PaywallUpsell.test.tsx` — extended in 43-05 Task 1
- [x] `leanshot/src/admin/modules/billing/GrandfatheredPricesPage.test.tsx` — created in 43-05 Task 2
- [ ] `leanshot/e2e/grandfathered-price-silent.spec.ts` — DEFERRED to 43-06 HUMAN-UAT Signal B (manual operator walkthrough; e2e fixture for Stripe-test-mode pricing UI is operator-blocked per [[feedback_hitl_walkthrough_deferred_when_fixtures_missing]])
- [x] No framework install needed — vitest + playwright + deno already in use.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Coupon + SAVE-offer multiplicative stacking on live Stripe invoice | MEMBER-03 D-06 | Stripe test mode requires browser checkout; cannot mock the invoice-creation pipeline at e2e level | 43-06 HUMAN-UAT Signal C: create 50% promo coupon `TEST50`, simulate SAVE-offer 50%, attempt checkout → expect 400 |
| LIFETIME purchase end-to-end (Stripe Checkout test card → webhook → lifetime_purchases row → tier_effective.tier_label='lifetime' → LIFETIME badge in UI) | MEMBER-01 D-02 | Cross-system integration (Stripe + Supabase + browser) | 43-06 HUMAN-UAT Signal A: full browser walkthrough with test card 4242424242424242 |
| Grandfathered price displayed silently with NO upgrade banner | MEMBER-02 D-05 | UX-visual check; "absence of banner" hard to assert in unit tests | 43-06 HUMAN-UAT Signal B: admin creates override + test user visits /pricing |
| Cross-tenant RLS proof (live impersonation) for grandfathered_prices + lifetime_purchases | MEMBER-02/04 | Per [[reference_supabase_project]]: every RLS surface gets a live cross-tenant impersonation proof | 43-06 HUMAN-UAT Signal D: non-admin user supabase.from() returns empty / self-only rows |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies (4 truly manual items mapped to HUMAN-UAT signals)
- [x] Sampling continuity: no 3 consecutive tasks without automated verify (every plan task has grep/Deno/Vitest)
- [x] Wave 0 covered inline (test scaffolds created in parent task; no separate Wave 0 plan)
- [x] No watch-mode flags
- [x] Feedback latency < 60s per task verify
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved 2026-05-22 (planner-side; operator approves at 43-06 HUMAN-UAT signals)
