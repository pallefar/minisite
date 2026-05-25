---
phase: 53-capacitor-mobile-shells-ios-android
plan: 04
type: execute
wave: 1
depends_on: []
files_modified:
  - supabase/functions/revenuecat-webhook/SECRETS-RUNBOOK.md
autonomous: true
requirements: [MOBILE-06]
user_setup: []

must_haves:
  truths:
    - "The revenuecat-webhook Edge Fn verifies the RC Authorization against REVENUECAT_WEBHOOK_SECRET/REVENUECAT_WEBHOOK_AUTH and is fail-soft (401 on bad/absent Bearer, HMAC step skipped when secret unset — never hard-crashes)"
    - "An RC subscription event mirrors INTO the existing canonical public.subscriptions table (provider='revenuecat'), idempotently, with the Stripe row model staying canonical (RC reflects)"
    - "The mirror upsert targets the existing idx_subscriptions_user_provider_unique anchor (onConflict user_id,provider) — no parallel/duplicate subscriptions table is created"
    - "REVENUECAT_WEBHOOK_SECRET + REVENUECAT_WEBHOOK_AUTH are documented as server-only (NON-VITE) secrets whose real values are set at Phase 70"
    - "Verification is automatable without live RevenueCat: the committed Deno test suite runs green file-targeted"
  artifacts:
    - path: "supabase/functions/revenuecat-webhook/index.ts"
      provides: "RC webhook → public.subscriptions mirror (PRE-EXISTING from Phase 16-06 — this plan verifies + owns it for MOBILE-06, does NOT rewrite)"
      contains: "onConflict: 'user_id,provider'"
    - path: "supabase/functions/revenuecat-webhook/index.test.ts"
      provides: "Auth + HMAC + idempotency + canonical-mirror regression suite (PRE-EXISTING — runs as the MOBILE-06 verification gate)"
      contains: "provider, 'revenuecat'"
    - path: "supabase/functions/revenuecat-webhook/SECRETS-RUNBOOK.md"
      provides: "Phase-70 secret-provisioning runbook for REVENUECAT_WEBHOOK_SECRET + REVENUECAT_WEBHOOK_AUTH (server-only, fail-soft pre-rollout)"
      contains: "REVENUECAT_WEBHOOK_SECRET"
  key_links:
    - from: "supabase/functions/revenuecat-webhook/index.ts"
      to: "public.subscriptions (canonical Stripe-shared table)"
      via: "admin.from('subscriptions').upsert(..., { onConflict: 'user_id,provider' })"
      pattern: "from\\('subscriptions'\\)\\.upsert"
    - from: "supabase/functions/revenuecat-webhook/index.ts"
      to: "REVENUECAT_WEBHOOK_SECRET / REVENUECAT_WEBHOOK_AUTH"
      via: "Deno.env.get at request time (HMAC fail-soft + Bearer gate)"
      pattern: "REVENUECAT_WEBHOOK_(SECRET|AUTH)"
---

<objective>
Own and verify MOBILE-06's webhook half: the RevenueCat webhook → canonical-subscription mirror. The Edge Fn, the canonical-table mirror, the HMAC/Bearer secret integration, and the regression test ALREADY EXIST (shipped Phase 16 Plan 06 / MONEY-06). This plan formally assigns MOBILE-06's webhook deliverable to Phase 53, proves the mirror lands in the EXISTING canonical `public.subscriptions` table (never a parallel table), and documents the deferred-to-Phase-70 server secrets.

Purpose: REQUIREMENTS MOBILE-06 requires "REVENUECAT_WEBHOOK_SECRET integrated; webhook → Supabase row mirror (subscription stays canonical in Stripe + RC reflects)". 53-02 ships only the RC client SDK env stubs (VITE_RC_API_KEY_*). This plan covers the server-side webhook+mirror+secret so MOBILE-06 is fully owned within Phase 53 — without rewriting working, tested code.

Output: a server-secret provisioning runbook; a verified green test run proving the existing webhook mirrors into the canonical table.

CRITICAL — do NOT rewrite or duplicate: `supabase/functions/revenuecat-webhook/index.ts` already implements the full webhook. There is exactly one canonical subscription table: `public.subscriptions` (text PK; `provider` column CHECK includes 'revenuecat'; Stripe rows are canonical, RC rows reflect). DO NOT create a second subscriptions table, a second webhook function, or a parallel RC-only table. If a behavior gap is found during verification, FIX index.ts in place (minimal) and note it in the SUMMARY — do not fork.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/STATE.md
@leanshot/.planning/phases/53-capacitor-mobile-shells-ios-android/53-RESEARCH.md

# PRE-EXISTING implementation this plan verifies + owns (read, do NOT rewrite):
@supabase/functions/revenuecat-webhook/index.ts
@supabase/functions/revenuecat-webhook/index.test.ts
@supabase/functions/revenuecat-webhook/cors.ts
@supabase/functions/revenuecat-webhook/deno.json

# Canonical subscription schema this mirror writes INTO (read, do NOT duplicate):
@supabase/migrations/20260601000019_stripe_subscriptions.sql
@supabase/migrations/20270601000022_rc_subscriptions_provider.sql

<facts>
- CANONICAL TABLE = `public.subscriptions` (defined in migration 20260601000019, Phase 14-01 for Stripe). Columns: id text PK, provider text default 'stripe' CHECK (provider in ('stripe','revenuecat')), user_id, clinic_id, stripe_customer_id, status, ux_tier, plan_id, current_period_end, trial_end, cancel_at_period_end, metadata jsonb, created_at, updated_at. Stripe rows are canonical; RC rows REFLECT (mirror) into the same table with provider='revenuecat'.
- The RC mirror upsert anchor is the partial unique index `idx_subscriptions_user_provider_unique ON subscriptions(user_id, provider) WHERE user_id IS NOT NULL`, shipped by migration 20270601000022 (no-op/idempotent; Phase 19 shipped the live copy first). The webhook upserts with `{ onConflict: 'user_id,provider' }` against this index → one RC row per (user, provider). DO NOT add a new unique index or a new table.
- The webhook ALREADY integrates REVENUECAT_WEBHOOK_SECRET: it is the OPTIONAL HMAC-SHA256 verify secret (Deno.env.get('REVENUECAT_WEBHOOK_SECRET')). When UNSET it logs a one-line cold-start console.warn and SKIPS HMAC, relying on the Bearer gate alone — this is the deliberate fail-soft pre-rollout behavior (matches the vendor-secret-deferred-to-Phase-70 stance). REVENUECAT_WEBHOOK_AUTH is the REQUIRED Bearer token (401 when absent/wrong). Both are SERVER-ONLY Supabase Function Secrets — NEVER VITE_-prefixed, NEVER in the client bundle.
- The webhook is idempotent via `subscription_events.event_id` PRIMARY KEY insert: Postgres 23505 → 200 { duplicate: true } so RC stops retrying. `subscription_events.provider` column + CHECK ('stripe','revenuecat') already exist (migration 20270601000022).
- D-04 immediate-downgrade asymmetry: CANCELLATION + EXPIRATION set current_period_end = now() (free immediately, matches Apple UX). This is DELIBERATE and regression-tested — DO NOT normalize to Stripe grace-period behavior.
- Deno binary is NOT on PATH — invoke as `$HOME/.deno/bin/deno`.
- Deno.serve top-level trap: this function uses `Deno.serve(...)` at module top level. Run the test FILE-TARGETED (`index.test.ts`), NEVER dir-targeted, and pass `--no-check` per reference_deno_test_top_level_serve_trap.
- `.env.example` (leanshot/.env.example) is OWNED by 53-02 (adds the VITE_RC_API_KEY_* client keys). This plan does NOT touch .env.example to preserve zero file overlap + Wave-1 parallelism; the server-only webhook secrets are declared in the new SECRETS-RUNBOOK.md instead. (If a future consolidation wants them in .env.example too, that is a 53-02 concern — note it in the SUMMARY, do not edit .env.example here.)
- Model the runbook tone/structure on the existing P52 vendor-secret deferral stance (Phase 52 runbook + memory reference_vapid_keypair_supabase_setup): server secret set via `supabase secrets set --project-ref <ref>`, value pending until Phase 70, fail-soft until then.
- tsc is unaffected by this plan: no leanshot/src/ files are touched; the Edge Fn is Deno-runtime (outside the Vite tsconfig).
</facts>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Pre-flight verify the existing webhook mirrors into the canonical table (no rewrite)</name>
  <files>(read-only verification — no file edits unless a real gap is found in supabase/functions/revenuecat-webhook/index.ts)</files>
  <action>Confirm — by READING the committed files, not rewriting them — that the RC webhook already satisfies MOBILE-06's webhook+mirror+secret contract: (1) index.ts reads REVENUECAT_WEBHOOK_SECRET (optional HMAC) + REVENUECAT_WEBHOOK_AUTH (required Bearer) and is fail-soft (401 on bad Bearer; HMAC skipped + console.warn when REVENUECAT_WEBHOOK_SECRET unset — no hard crash); (2) the dispatch() upsert targets `public.subscriptions` via `admin.from('subscriptions').upsert(payload, { onConflict: 'user_id,provider' })` with provider:'revenuecat' — i.e. it mirrors INTO the existing canonical Stripe-shared table, NOT a parallel table; (3) the upsert anchor idx_subscriptions_user_provider_unique exists in migration 20270601000022; (4) idempotency via subscription_events.event_id 23505→200. Run the committed Deno test FILE-TARGETED to prove the contract is green. If and ONLY if a genuine contract gap is found (e.g. upsert pointed at a non-canonical table, or a hard-crash on absent secret), apply the MINIMAL in-place fix to index.ts and document it in the SUMMARY — never fork a second function/table, never weaken a test. Per scope_reduction_prohibition: if the existing code already satisfies the contract (expected), record that as "MOBILE-06 webhook half pre-satisfied by Phase 16-06; Phase 53 owns + verifies it" — this is correct ownership, NOT a scope reduction.</action>
  <verify>
    <automated>cd supabase/functions/revenuecat-webhook && $HOME/.deno/bin/deno test --no-check --allow-all --import-map=../import_map.json index.test.ts 2>&1 | grep -Eq '([1-9][0-9]* passed)\s*\|\s*0 failed' && grep -q "onConflict: 'user_id,provider'" index.ts && grep -q "provider: 'revenuecat'" index.ts && grep -q "REVENUECAT_WEBHOOK_SECRET" index.ts && grep -q "from('subscriptions')" index.ts</automated>
  </verify>
  <done>Committed Deno test suite runs green (N passed | 0 failed); index.ts upserts into public.subscriptions with provider:'revenuecat' + onConflict user_id,provider; REVENUECAT_WEBHOOK_SECRET integrated. No parallel table/function exists. Any in-place fix (if needed) is minimal and noted in SUMMARY.</done>
</task>

<task type="auto">
  <name>Task 2: Verify canonical-model guards (no duplicate table) + RC provider discriminator</name>
  <files>(read-only verification — grep gates over migrations)</files>
  <action>Prove the mirror writes into the ONE canonical subscriptions model and that the RC provider discriminator is registered — without adding any migration. Confirm via grep that: (1) exactly one `create table public.subscriptions` exists across supabase/migrations/ (the canonical Phase 14 table) — there is NO parallel revenuecat_subscriptions / rc_subscriptions table; (2) the canonical table's provider CHECK includes 'revenuecat' (migration 20260601000019); (3) the upsert anchor idx_subscriptions_user_provider_unique is declared (migration 20270601000022); (4) subscription_events.provider column + CHECK ('stripe','revenuecat') exist (same migration). A new migration is NOT needed — all RC-origin entitlements (status, ux_tier, plan_id=product_id, current_period_end, metadata.rc_event_*) reuse existing canonical columns; the RC row is discriminated solely by provider='revenuecat'. Do NOT add a column or table. Document in the SUMMARY the exact canonical table targeted: public.subscriptions (and that no migration was added).</action>
  <verify>
    <automated>cd /Users/karstenhaldan/minisite && test "$(grep -rl 'create table public.subscriptions' supabase/migrations/ | wc -l | tr -d ' ')" = "1" && ! grep -rEiq 'create table public\.(revenuecat_subscriptions|rc_subscriptions|revenuecat_subscription_mirror)' supabase/migrations/ && grep -q "provider in ('stripe','revenuecat')" supabase/migrations/20260601000019_stripe_subscriptions.sql && grep -q 'idx_subscriptions_user_provider_unique' supabase/migrations/20270601000022_rc_subscriptions_provider.sql</automated>
  </verify>
  <done>Exactly one canonical public.subscriptions table; zero parallel RC subscription tables; provider CHECK includes 'revenuecat'; the (user_id,provider) upsert anchor + subscription_events.provider discriminator exist. No new migration added.</done>
</task>

<task type="auto">
  <name>Task 3: RevenueCat webhook secret provisioning runbook (Phase-70-gated, server-only)</name>
  <files>supabase/functions/revenuecat-webhook/SECRETS-RUNBOOK.md</files>
  <action>Create `supabase/functions/revenuecat-webhook/SECRETS-RUNBOOK.md` documenting the two server-only RevenueCat webhook secrets and their Phase-70 provisioning, modeled on the Phase 52 vendor-secret deferral stance. Cover: (1) REVENUECAT_WEBHOOK_AUTH — REQUIRED Bearer token; configured in the RevenueCat dashboard as the `Authorization: Bearer <token>` header on the webhook; stored bare in Supabase via `supabase secrets set REVENUECAT_WEBHOOK_AUTH=<token> --project-ref <ref>`; when ABSENT the webhook returns 401 on every request (deliberate — RC retries until provisioned). (2) REVENUECAT_WEBHOOK_SECRET — OPTIONAL HMAC-SHA256 verify secret; when UNSET the webhook logs a one-line cold-start warn and skips HMAC, gating on Bearer alone (fail-soft pre-rollout); enable HMAC in the RC dashboard + set this secret at Phase 70 to add the second auth layer. State PLAINLY: both are SERVER-ONLY Supabase Function Secrets — NEVER VITE_-prefixed, NEVER in the client bundle (contrast with the VITE_RC_API_KEY_* PUBLIC SDK keys declared in .env.example by 53-02, which ARE browser-safe). State the webhook endpoint URL shape `https://<project-ref>.supabase.co/functions/v1/revenuecat-webhook` and the RC-dashboard webhook configuration steps. State the deferral plainly as Phase-70-gated (NOT "v1"/"temporary"): the webhook is deployed and fail-soft today; real secret values + HMAC enforcement + live RC→mirror UAT land at Phase 70. Note the mirror target table is public.subscriptions (provider='revenuecat') so an operator reading this runbook knows where RC state lands. Do NOT put any real secret value in the runbook — placeholders only. Do NOT edit .env.example (owned by 53-02).</action>
  <verify>
    <automated>cd /Users/karstenhaldan/minisite && test -f supabase/functions/revenuecat-webhook/SECRETS-RUNBOOK.md && grep -q 'REVENUECAT_WEBHOOK_SECRET' supabase/functions/revenuecat-webhook/SECRETS-RUNBOOK.md && grep -q 'REVENUECAT_WEBHOOK_AUTH' supabase/functions/revenuecat-webhook/SECRETS-RUNBOOK.md && grep -qi 'Phase 70' supabase/functions/revenuecat-webhook/SECRETS-RUNBOOK.md && grep -qi 'server-only\|server only' supabase/functions/revenuecat-webhook/SECRETS-RUNBOOK.md && grep -q 'public.subscriptions' supabase/functions/revenuecat-webhook/SECRETS-RUNBOOK.md && ! grep -q 'VITE_REVENUECAT\|VITE_RC_WEBHOOK' supabase/functions/revenuecat-webhook/SECRETS-RUNBOOK.md</automated>
  </verify>
  <done>SECRETS-RUNBOOK.md documents both server-only secrets, the fail-soft pre-rollout behavior, the RC-dashboard config + endpoint URL, the public.subscriptions mirror target, and the Phase-70 gating — with no real secret values and no VITE_-prefixed webhook secret.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| RevenueCat servers → webhook | Untrusted server-to-server POST; gated by Bearer token (required) + HMAC-SHA256 (optional, fail-soft) |
| Webhook → public.subscriptions | Service-role write into the canonical Stripe-shared table; RLS-bypassed; idempotency-anchored on subscription_events.event_id |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-53-10 | Spoofing | Forged RC webhook POST | mitigate | Required Bearer gate (REVENUECAT_WEBHOOK_AUTH) returns 401 before body read; optional HMAC-SHA256 (REVENUECAT_WEBHOOK_SECRET) verifies raw-body signature once enabled at Phase 70 (existing index.ts behavior — verified, not rebuilt) |
| T-53-11 | Tampering | Duplicate / replayed RC events corrupting subscription state | mitigate | Idempotency via subscription_events.event_id PRIMARY KEY (23505 → 200 duplicate); mirror upsert is deterministic on (user_id, provider) — existing behavior, regression-tested |
| T-53-12 | Information Disclosure | REVENUECAT_WEBHOOK_SECRET / AUTH leaking into client bundle | mitigate | Both are server-only Supabase Function Secrets (NON-VITE); runbook explicitly forbids VITE_ prefixing; grep gate in Task 3 asserts no VITE_REVENUECAT/VITE_RC_WEBHOOK var exists |
| T-53-13 | Tampering | A parallel/duplicate RC subscriptions table diverging from canonical Stripe state | mitigate | Task 2 grep gate asserts exactly one public.subscriptions table + zero parallel RC tables; RC rows reflect into canonical model discriminated by provider='revenuecat' |
| T-53-SC | Tampering | npm/gem installs | accept | No packages installed; revenuecat-webhook deps (@supabase/supabase-js via import_map) pre-existing + `[Approved]` per RESEARCH Package Legitimacy Audit |
</threat_model>

<verification>
- Committed Deno test suite for revenuecat-webhook runs green file-targeted (auth + HMAC + idempotency + canonical-mirror + D-04 + PII).
- index.ts upserts into public.subscriptions (provider='revenuecat', onConflict user_id,provider) — canonical mirror, not a parallel table.
- Exactly one public.subscriptions table across migrations; zero RC-only subscription tables; provider CHECK + (user_id,provider) anchor + subscription_events.provider discriminator present.
- SECRETS-RUNBOOK.md declares REVENUECAT_WEBHOOK_SECRET + REVENUECAT_WEBHOOK_AUTH as server-only, fail-soft, Phase-70-gated, with the public.subscriptions mirror target — no real values, no VITE_ prefix.
</verification>

<success_criteria>
MOBILE-06's webhook+mirror+secret half is formally owned + verified within Phase 53: the pre-existing revenuecat-webhook Edge Fn is proven to mirror RC events into the canonical public.subscriptions table (Stripe canonical, RC reflects) with REVENUECAT_WEBHOOK_SECRET integrated and fail-soft; the deferred server secrets are documented for Phase 70 provisioning. No duplicate table, no duplicate function, no scope reduction. Live RC→mirror UAT + real secret values + HMAC enforcement explicitly deferred to Phase 70.
</success_criteria>

<output>
Create `.planning/phases/53-capacitor-mobile-shells-ios-android/53-04-SUMMARY.md` when done. Record: the canonical mirror table targeted (public.subscriptions, provider='revenuecat'), that the webhook+mirror were pre-satisfied by Phase 16-06 and Phase 53 now owns+verifies them, any minimal in-place index.ts fix (if any), and the Phase 70 deferral (real REVENUECAT_WEBHOOK_AUTH/SECRET values + HMAC enforcement + live RC→mirror UAT).
</output>
