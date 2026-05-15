---
phase: 19
plan: 9
subsystem: affiliate-program-stripe-connect
tags: [edge-fn, pg-cron, stripe-transfers, cascade-delete, vault, route-wiring, e2e]
dependency_graph:
  requires:
    - 19-01 affiliates / payouts / event-tables schema + RLS
    - 19-04 stripe-webhook → affiliate_conversions writer
    - 19-05 affiliate-apply Edge Fn + AFFILIATE_APPLY_ROUTES registry
    - 19-06b partner-profile-update Edge Fn + PARTNER_ROUTES registry
    - 19-08 affiliate-impression Edge Fn + LANDING_ROUTES registry
  provides:
    - "AFF-06 — monthly Stripe transfers.create batch payout (Edge Fn + pg_cron)"
    - "AFF-10 — D-33 10-step affiliate-cascade on account-delete (Edge Fn + SQL fn)"
    - "MONEY-10 — Stripe customer/Connect/PaymentIntent cleanup + Resend audience remove + Storage delete"
    - "BL-4 — App.tsx wiring of 3 Phase-19 route registries (single Phase-19 writer)"
    - "BL-6 — finalize_affiliate_cascade(uuid) RETURNS TEXT (returns pre-anonymize email)"
    - "BL-7 — Vault-based service_role_key access for pg_cron"
    - "BL-11 — daily pending→confirmed transition pg_cron job"
    - "W-3 — daily payouts-from-conversions materialization pg_cron job"
    - "I-1 — `npm run check-bundle-budget` script wiring (50 kB index gz ceiling holds)"
  affects:
    - "P22 ADMIN-06 + DEL-01 (consumes account-delete Edge Function via POST /functions/v1/account-delete)"
tech_stack:
  added:
    - "Stripe SDK v19 — transfers.create + balance.retrieve usage (already pinned in Phase 14 + 19-04)"
    - "Supabase Vault — vault.decrypted_secrets read from pg_cron"
  patterns:
    - "Constant-time bearer compare against SUPABASE_SERVICE_ROLE_KEY for cron-invoked Edge Fns (Pattern S2 extension)"
    - "3-attempt retry with promote-to-failed + Resend admin alert (D-32 + clinic-invite/resend.ts clone)"
    - "10-step external-API + SQL-RPC cascade orchestrator (D-33 split)"
    - "Pre-construct lazy() wrappers per route-registry entry to preserve React.lazy component identity"
key_files:
  created:
    - path: /Users/karstenhaldan/minisite/supabase/functions/affiliate-payout/index.ts
      lines: 326
      role: edge-fn
    - path: /Users/karstenhaldan/minisite/supabase/functions/affiliate-payout/index.test.ts
      lines: 354
      role: test
    - path: /Users/karstenhaldan/minisite/supabase/functions/affiliate-payout/retry.ts
      lines: 156
      role: helper
    - path: /Users/karstenhaldan/minisite/supabase/functions/affiliate-payout/deno.json
      lines: 14
      role: config
    - path: /Users/karstenhaldan/minisite/supabase/functions/account-delete/index.ts
      lines: 516
      role: edge-fn
    - path: /Users/karstenhaldan/minisite/supabase/functions/account-delete/index.test.ts
      lines: 318
      role: test
    - path: /Users/karstenhaldan/minisite/supabase/functions/account-delete/deno.json
      lines: 14
      role: config
    - path: /Users/karstenhaldan/minisite/supabase/migrations/20270101000011_payouts_materialization_and_cron.sql
      lines: 108
      role: migration
    - path: /Users/karstenhaldan/minisite/supabase/migrations/20270101000012_account_delete_affiliate_cascade.sql
      lines: 120
      role: migration
    - path: /Users/karstenhaldan/minisite/supabase/migrations/20270101000013_service_role_key_vault_load.sql
      lines: 39
      role: migration
    - path: /Users/karstenhaldan/minisite/leanshot/e2e/account-deletion-cascade.spec.ts
      lines: 218
      role: e2e
  modified:
    - /Users/karstenhaldan/minisite/leanshot/src/App.tsx
    - /Users/karstenhaldan/minisite/supabase/config.toml
    - /Users/karstenhaldan/minisite/leanshot/package.json
decisions:
  - "BL-6 RETURNS TEXT (NOT void / NOT table) — Edge Fn needs original email for Resend.contacts.remove BEFORE anonymize"
  - "BL-7 Vault > GUC — service_role_key loaded out-of-band via Dashboard; migration 20270101000013 has ZERO secret material"
  - "BL-11 + W-3 + AFF-06 ordering — 00:15 → 00:30 → 1st-00:00 (confirm must run before materialize must run before transfer)"
  - "Lazy admin singleton (Proxy + getAdmin) — Module-level createClient throws at Deno test import time before env vars set; mirrors stripe-checkout pattern"
  - "60-day chargeback hold (D-30) enforced at MATERIALIZATION layer, not transfer layer — the W-3 cron's `not exists` clause prevents stale rows from ever entering the payouts queue"
  - "BL-4 resolver returns early from App body before view branches — keeps selectView untouched + lets Phase-19 routes shadow marketing/dashboard cleanly"
metrics:
  duration: "~50 minutes"
  completed: "2026-05-15"
---

# Phase 19 Plan 19-09: Payout Cron + Account-Delete Cascade Summary

Monthly Stripe transfers.create payout cron + D-33 10-step affiliate-cascade Edge Function + BL-7 Vault auth + BL-4 single-writer App.tsx wiring of 3 Phase-19 route registries. The phase-closing plan.

## What Shipped

- **`affiliate-payout` Edge Function (AFF-06):** cron-invoked monthly Stripe `transfers.create` with idempotency key (`affiliate_payout_<id>`). Filters: Pitfall 7 `stripe_payouts_enabled=false` → `status='blocked_onboarding'`; D-31 `paid_so_far + this_amount < tax_threshold_cents` → keep `pending`; happy path → `status='paid' + stripe_transfer_id`. On error: `incrementPayoutRetry` with 3-attempt limit + best-effort Resend admin alert at promote-to-failed.
- **3 pg_cron schedules** in migration `20270101000011`:
  - `affiliate-conversions-confirm` — 00:15 UTC daily (BL-11): pending → confirmed when `fraud_signals IS NULL OR '[]'::jsonb` AND `eligible_at <= now()`
  - `affiliate-payouts-materialize` — 00:30 UTC daily (W-3): rolls confirmed conversions into pending payouts rows with 60-day not-exists guard
  - `affiliate-monthly-payout` — 00:00 UTC 1st-of-month (AFF-06): `net.http_post` to affiliate-payout Edge Fn with Vault-sourced bearer
- **`account-delete` Edge Function (BL-6 + AFF-10 + MONEY-10):** orchestrates the D-33 10-step cascade. Self-delete or staff-delete only (JWT-gated). 409 `{error:'open_payouts', eta}` on pre-flight P0010. Steps: 1 pre-flight (RPC), 2-4 SQL anonymize (RPC), 5 Stripe customer.del with subscription cancel, 6 Stripe Connect accounts.del with balance pre-flight (Pitfall 1), 7 PaymentIntent cancel, 8 Resend contacts.remove with original_email from RPC (BL-6 proof), 9 Storage list+remove under `photos/{uid}/` and `photos/affiliate-photos/{uid}/`, 10 auth.admin.deleteUser (last).
- **`finalize_affiliate_cascade(p_user_id uuid) RETURNS TEXT` SQL function (BL-6 lock):** P0010 pre-flight raise; SELECT id, email INTO v_aff_id, v_email BEFORE the UPDATE; anonymize email+display_name+photo_path+blurb+calendly+testimonial+fingerprint+ip; PRESERVE stripe_connect_account_id (Edge Fn step 6 needs it); cascade-surviving audit_logs skeleton; RETURN v_email. Uses `set_config('app.suppress_audit', 'true', true)` (Pitfall 4 + 9 — is_local=true).
- **BL-7 Vault load (migration 20270101000013):** presence-check on `vault.decrypted_secrets`; ZERO secret material; documents the out-of-band Dashboard setup step (Plan 19-09 Task 0).
- **BL-4 App.tsx wiring (single-writer):** module-level imports of `AFFILIATE_APPLY_ROUTES` / `PARTNER_ROUTES` / `LANDING_ROUTES`; pre-constructed `lazy()` wrappers; `resolvePhase19Route(pathname)` with locked ordering LANDING (most-specific regex) → PARTNER prefix → AFFILIATE_APPLY exact+prefix; early-return branch above the existing view-selector. Verification: `git log --oneline 4fc0f9f..HEAD -- leanshot/src/App.tsx` returns ONLY this plan's commit (BL-4 single-writer contract).
- **Playwright cascade e2e (D-35) at `leanshot/e2e/account-deletion-cascade.spec.ts`:** file-scoped `AFF_DEL_PREFIX` per [[feedback-rls-per-file-slug-prefix]]; seeds affiliate + 2 clicks + 1 confirmed conversion + 1 PAID payout (not pending — pending trips 409); user-JWT POST to `/functions/v1/account-delete`; asserts 6 invariants (anonymize + connect_account_id preserved + clicks+conversions retained with user_id=null + payout retained + auth.users gone + Storage empty).
- **`check-bundle-budget` npm script (I-1):** wraps `assert-bundle-budget.sh` + `assert-clinic-bundle-budget.sh`. Both gates pass on current build (index gz 15.03 kB vs 50 kB hard ceiling).
- **`supabase/config.toml`:** `[functions.affiliate-payout] verify_jwt = true` + `[functions.account-delete] verify_jwt = true` blocks appended.

## Architecture Snapshot

```
pg_cron (00:15 UTC daily)  → confirm pending → confirmed (BL-11)
pg_cron (00:30 UTC daily)  → materialize confirmed → payouts pending (W-3)
pg_cron (1st 00:00 UTC)    → net.http_post → affiliate-payout Edge Fn (AFF-06)
                              │ vault.decrypted_secrets bearer
                              ▼
                           stripe.transfers.create (idempotencyKey)
                              │ on error → incrementPayoutRetry (3-attempt limit)
                              ▼
                           payouts UPDATE { status:'paid', stripe_transfer_id }

POST /functions/v1/account-delete (user JWT or staff JWT)
  → 1. pre-flight: RPC raises P0010 on open payouts → 409
  → 2-4. RPC finalize_affiliate_cascade (anonymize + return original email)
  → 5. Stripe customers.del (after subscriptions.cancel)
  → 6. Stripe accounts.del (balance pre-flight)
  → 7. paymentIntents.cancel for in-flight
  → 8. Resend contacts.remove(originalEmail)        ← BL-6 proof
  → 9. Storage list+remove (photos/{uid}, photos/affiliate-photos/{uid})
  → 10. auth.admin.deleteUser (LAST — cascades FK SET NULL)
```

## Tests Run

- `deno test supabase/functions/affiliate-payout/index.test.ts` → **8/8 pass**
- `deno test supabase/functions/account-delete/index.test.ts` → **6/6 pass**
- `tsc -b --noEmit` (leanshot) → **exit 0**
- `eslint src/App.tsx` → **0 errors** (auto-fix applied for import-x/order)
- `vite build` → **success**, index gz 15.03 kB
- `npm run check-bundle-budget` → **all chunks under ceiling** (index 15 kB / 50 kB max; clinic 27.18 kB / 28 kB; page-builder-runtime 5.07 kB / 25 kB; etc.)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Module-level `createClient(SUPABASE_URL, ...)` threw at Deno test import time**

- **Found during:** Task 1 + Task 2 verification (`deno test`)
- **Issue:** The first run of `deno test affiliate-payout/index.test.ts` failed with `Error: supabaseUrl is required` because supabase-js validates the URL at construction time, and the test file calls `Deno.env.set('SUPABASE_URL', ...)` AFTER importing `__internal`. The eager module-level `const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ...)` captured empty strings before the test could set them.
- **Fix:** Replaced eager admin construction with a Proxy-backed lazy `getAdmin()` singleton in BOTH affiliate-payout/index.ts AND account-delete/index.ts. Mirrors the established pattern from `supabase/functions/stripe-checkout/index.ts:121-148`. Also moved `SUPABASE_SERVICE_ROLE_KEY` capture to a lazy `getSupabaseServiceRoleKey()` function so the V2 constant-time bearer compare resolves at handler-call time.
- **Files modified:** `supabase/functions/affiliate-payout/index.ts`, `supabase/functions/account-delete/index.ts`, `supabase/functions/account-delete/index.test.ts` (T3 assertion fix for URL-encoded email).
- **Commit:** `a4dd6d9`

**2. [Rule 3 - Blocking] Missing `check-bundle-budget` npm script**

- **Found during:** I-1 bundle-gate verification
- **Issue:** Plan instructed `npm run check-bundle-budget` but the script did not exist in `leanshot/package.json`. Two underlying gate scripts (`assert-bundle-budget.sh` + `assert-clinic-bundle-budget.sh`) already exist under `leanshot/scripts/`.
- **Fix:** Added `"check-bundle-budget": "bash scripts/assert-bundle-budget.sh && bash scripts/assert-clinic-bundle-budget.sh"` to package.json scripts.
- **Files modified:** `leanshot/package.json`
- **Commit:** `67b02df`

**3. [Rule 1 - Lint] Pre-existing import-x/order error in App.tsx after registry imports added**

- **Found during:** Task 3 verification (eslint)
- **Issue:** The three new `@/routes/*` imports landed between existing `@/lib/*` imports and a multi-line `@/lib/sync-defer` import, tripping `import-x/order`.
- **Fix:** Ran `eslint src/App.tsx --fix` which moved the `@/routes/*` block to the end of the `@/*` import group (alphabetized) and concatenated the leading comment block. Verified post-fix: 0 errors.
- **Commit:** `67b02df` (auto-fix applied before commit)

### Auth / Vendor Gates (Tasks 0, 4, 5, 6)

The plan is `autonomous: false` — the following load-bearing tasks remain as vendor checkpoints for the orchestrator + user:

| Task | Type | What | Why deferred |
|------|------|------|--------------|
| Task 0 | Vault load (BL-7) | Load `service_role_key` into Supabase Vault via Dashboard → Project Settings → Vault | Out-of-band step — migration 20270101000013 contains zero secret material; must be done in Dashboard UI |
| Task 4 [BLOCKING] | Schema push | `supabase db push --linked` (13 Phase 19 migrations: 01-05, 04a, 06-13) | Worktree needs `supabase/.temp/` copied from main + `SUPABASE_ACCESS_TOKEN` env; vendor CLI not on PATH in agent environment |
| Task 5 [BLOCKING] | Edge Function deploys | `supabase functions deploy {fn} --linked` × 7 (affiliate-attribute, stripe-connect-onboard, partner-account-status, affiliate-apply, partner-profile-update, affiliate-impression, affiliate-payout, account-delete) | `supabase` CLI not on PATH in agent environment |
| Task 6 #1 | D-37 Wave-0 smoke #1 | `bash leanshot/scripts/wave-0-vercel-rewrite-smoke.sh` | Needs deployed Vercel + Edge Fn first (depends on Task 5) |
| Task 6 #2 | D-37 Wave-0 smoke #2 | `bash leanshot/scripts/wave-0-stripe-transfers-capability.sh` | Needs `STRIPE_SECRET_KEY` in env |

**None of these block the merge of the present worktree** — they are gated on user-side credential availability and on the post-merge deploy pipeline. Tasks 1-3 are fully landed and tested; Tasks 4-6 belong to the orchestrator's Phase 19 closeout sequence.

## Verification Snapshot (per <verification> contract)

- [x] Task 1 — 8 Deno tests pass; 3 pg_cron jobs declared in migration 20270101000011 (BL-11 + W-3 + AFF-06 ordering)
- [x] Task 2 — 6 Deno tests pass; SQL function `finalize_affiliate_cascade(uuid) RETURNS TEXT` (BL-6); stripe_connect_account_id PRESERVED in anonymize UPDATE
- [x] Task 3 — App.tsx wires 3 route registries; `grep -c "AFFILIATE_APPLY_ROUTES\|PARTNER_ROUTES\|LANDING_ROUTES" src/App.tsx` returns 12; tsc clean; eslint clean; BL-4 single-writer verified via git log
- [ ] Task 4 [BLOCKING] — `supabase db push --linked` deferred to orchestrator (CLI + token not available in agent env)
- [ ] Task 5 [BLOCKING] — Edge Function deploys deferred to orchestrator (CLI not available)
- [ ] Task 6 [BLOCKING] — D-37 smokes deferred to orchestrator post-deploy
- [x] I-1 bundle gate — `npm run check-bundle-budget` script wired; current build green (index 15.03 kB gz < 50 kB ceiling)
- [x] No STATE.md / ROADMAP.md modifications (orchestrator owns those post-merge)

## Phase 19 Rollup (for orchestrator)

This is the LAST plan of Phase 19. The full phase contributes:

- **13 migrations** (`20270101000001..05`, `20270101000004a`, `20270101000006..13`) — to push as ONE `supabase db push --linked` after BL-7 Vault setup is done.
- **8 new Edge Functions** in `/supabase/functions/`: `affiliate-attribute`, `stripe-connect-onboard`, `partner-account-status`, `affiliate-apply`, `partner-profile-update`, `affiliate-impression`, `affiliate-payout`, `account-delete`. Plus extensions to `stripe-webhook` + `stripe-checkout` (Phase 14 functions, redeploy required).
- **3 route registries** in `leanshot/src/routes/`: `affiliate-apply-routes.ts`, `partner-routes.ts`, `landing-routes.ts`. All consumed by App.tsx in this plan.
- **3 pg_cron jobs** registered: BL-11 confirm (00:15 UTC), W-3 materialize (00:30 UTC), AFF-06 monthly transfer (1st-of-month 00:00 UTC).

### Phase-19 deferred vendor passes for orchestrator

The orchestrator's Phase 19 closeout must coordinate the following (cross-plan, post-merge):

1. **Vault setup (BL-7 Task 0)** — Dashboard → Project Settings → Vault → Add new secret `service_role_key` with the project's service_role key.
2. **Schema push (Task 4 I-1)** — `supabase db push --linked` from main checkout (after copying `supabase/.temp/` if needed per [[reference-supabase-worktree-temp-state]]).
3. **Edge Function deploys (Task 5)** — parallel `supabase functions deploy {fn} --linked` for all 10 functions (per Phase 19 inventory).
4. **Cron verify** — `psql "$DATABASE_URL" -c "select jobname, schedule from cron.job where jobname like 'affiliate%' or jobname = 'affiliate-conversions-confirm'"` → expect 3 rows.
5. **Function-secret verify** — `service_role_key` reachable from `vault.decrypted_secrets` (BL-7 invariant).
6. **D-37 smokes** — `wave-0-vercel-rewrite-smoke.sh` (cookie + Vercel rewrite) and `wave-0-stripe-transfers-capability.sh` (Stripe Connect `transfers` capability) deferred from Wave 0 + 1.
7. **Resend domain verify** — `RESEND_API_KEY` + `RESEND_FROM` Function Secrets verified; `noreply@app.leanshot.app` domain status `verified` per [[reference-resend-phase9-wiring]].

## Self-Check

Files claimed:
- `supabase/functions/affiliate-payout/{index.ts, index.test.ts, retry.ts, deno.json}` — FOUND
- `supabase/functions/account-delete/{index.ts, index.test.ts, deno.json}` — FOUND
- `supabase/migrations/20270101000011_payouts_materialization_and_cron.sql` — FOUND
- `supabase/migrations/20270101000012_account_delete_affiliate_cascade.sql` — FOUND
- `supabase/migrations/20270101000013_service_role_key_vault_load.sql` — FOUND
- `leanshot/e2e/account-deletion-cascade.spec.ts` — FOUND
- `leanshot/src/App.tsx` modified (3 registry imports + resolver + early-return branch) — FOUND
- `supabase/config.toml` extended (`[functions.affiliate-payout]`, `[functions.account-delete]`) — FOUND
- `leanshot/package.json` extended (`check-bundle-budget` script) — FOUND

Commits claimed:
- `d91b910` feat(19-09): affiliate-payout Edge Fn + 3 pg_cron schedules + Vault auth — FOUND on branch
- `705d38d` feat(19-09): account-delete cascade Edge Fn + finalize_affiliate_cascade RETURNS TEXT — FOUND on branch
- `67b02df` feat(19-09): wire 3 Phase 19 route registries into App.tsx (BL-4 single writer) + check-bundle-budget script — FOUND on branch
- `a4dd6d9` fix(19-09): lazy admin singleton in affiliate-payout + account-delete (Deno test compat) — FOUND on branch

## Self-Check: PASSED
