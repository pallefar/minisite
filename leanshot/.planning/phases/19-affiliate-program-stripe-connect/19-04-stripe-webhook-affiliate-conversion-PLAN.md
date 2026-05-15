---
phase: 19
plan: 4
type: execute
wave: 3
depends_on: [1, 3]
files_modified:
  - /Users/karstenhaldan/minisite/supabase/functions/stripe-webhook/events/invoice-paid.ts
  - /Users/karstenhaldan/minisite/supabase/functions/stripe-webhook/events/invoice-paid.test.ts
  - /Users/karstenhaldan/minisite/supabase/functions/stripe-webhook/events/account-updated.ts
  - /Users/karstenhaldan/minisite/supabase/functions/stripe-webhook/events/account-updated.test.ts
  - /Users/karstenhaldan/minisite/supabase/functions/stripe-webhook/index.ts
  - /Users/karstenhaldan/minisite/supabase/functions/stripe-checkout/index.ts
  - /Users/karstenhaldan/minisite/supabase/functions/stripe-checkout/index.test.ts
  - /Users/karstenhaldan/minisite/supabase/migrations/20270101000010_feature_flags_aff_manual_entry.sql
  - /Users/karstenhaldan/minisite/leanshot/src/components/auth/SignUpForm.tsx
  - /Users/karstenhaldan/minisite/leanshot/src/components/auth/__tests__/SignUpForm.test.tsx
  - /Users/karstenhaldan/minisite/leanshot/src/lib/feature-flags.ts
  - /Users/karstenhaldan/minisite/leanshot/src/lib/__tests__/feature-flags.test.ts
autonomous: true
requirements: [AFF-02, AFF-03]
tags: [edge-fn, stripe-webhook, attribution, d-36-renewal-filter, d-23-manual-entry]

must_haves:
  truths:
    - "stripe-checkout reads `?aff=<code>` query param + persists into Stripe session_data.metadata.aff_code AND subscription.metadata.aff_code (Pitfall 2 — renewal survival)"
    - "stripe-webhook on invoice.paid filters by `billing_reason === 'subscription_create'` (D-36 — renewals do NOT count) AND inserts an idempotent affiliate_conversions row on invoice_id UNIQUE constraint"
    - "stripe-webhook on account.updated UPDATEs affiliates.stripe_payouts_enabled = acct.payouts_enabled (Pitfall 7 — block transfers.create if false)"
    - "affiliate_conversions row gets eligible_at = invoice_paid_at + interval '60 days' (D-30 chargeback hold)"
    - "BL-1 (D-23): feature_flags table seeds `aff_manual_entry=false` by default; SignUpForm conditionally renders a referral-code input behind that flag; stripe-checkout attributes via the manual-entry code value (validated against affiliates.referral_code) when present"
  artifacts:
    - path: "/Users/karstenhaldan/minisite/supabase/functions/stripe-webhook/events/invoice-paid.ts"
      provides: "Extended invoice.paid handler with affiliate-conversion path (D-36 filter + idempotent insert)"
      contains: "subscription_create"
    - path: "/Users/karstenhaldan/minisite/supabase/functions/stripe-webhook/events/account-updated.ts"
      provides: "NEW handler for Stripe Connect account.updated webhook event"
      contains: "stripe_payouts_enabled"
    - path: "/Users/karstenhaldan/minisite/supabase/functions/stripe-checkout/index.ts"
      provides: "Modified to read ?aff= param, _aff cookie, AND ?aff_manual=<code> param (D-23) and propagate into subscription_data.metadata.aff_code"
      contains: "aff_code"
    - path: "/Users/karstenhaldan/minisite/supabase/migrations/20270101000010_feature_flags_aff_manual_entry.sql"
      provides: "BL-1/D-23 — public.feature_flags table + seeded aff_manual_entry=false row"
      contains: "feature_flags"
    - path: "/Users/karstenhaldan/minisite/leanshot/src/components/auth/SignUpForm.tsx"
      provides: "BL-1/D-23 — conditional referral-code input behind aff_manual_entry flag"
      contains: "aff_manual_entry"
    - path: "/Users/karstenhaldan/minisite/leanshot/src/lib/feature-flags.ts"
      provides: "BL-1 — thin client wrapper over public.feature_flags table; cached at app boot"
      contains: "useFeatureFlag"
  key_links:
    - from: "stripe-webhook invoice.paid"
      to: "affiliate_conversions table (Plan 19-01)"
      via: "service-role INSERT with ON CONFLICT DO NOTHING on invoice_id"
      pattern: "affiliate_conversions"
    - from: "stripe-checkout (D-23 path)"
      to: "subscription.metadata.aff_code"
      via: "subscription_data.metadata"
      pattern: "aff_code"
    - from: "SignUpForm referral-code input (D-23)"
      to: "stripe-checkout"
      via: "URL param ?aff_manual=<code> propagated into Stripe metadata at checkout"
      pattern: "aff_manual"
---

<objective>
Extend the existing `stripe-webhook` Edge Function to attribute affiliate conversions on `invoice.paid`, register Stripe Connect `account.updated` events to track `payouts_enabled`, and propagate `?aff=<code>` from checkout URL → Stripe session metadata → subscription metadata (Pitfall 2 mitigation for renewals). PLUS the D-23 manual-entry path (BL-1): a feature_flags table + SignUpForm referral-code input + stripe-checkout attribution from the manual-entry code.

Purpose: AFF-02 (server-side conversion attribution) + AFF-03 (Connect account readiness tracking) + D-23 (web fallback for direct signups carrying a referral code from outside the cookie path). D-36 renewal filter is load-bearing — `invoice.paid` fires on every monthly renewal, so without `billing_reason === 'subscription_create'` we'd double-credit affiliates for repeat charges.

**Iter-1 revisions (2026-05-15):**
- **BL-4 wave bump:** This plan was Wave 2, now Wave 3 (because Plan 19-03 moved to Wave 2 for config.toml sequencing). Dependencies unchanged: `[1, 3]`.
- **BL-1 / D-23:** Added the manual-entry path as Task 3 (feature_flags table + SignUpForm conditional field + stripe-checkout `aff_manual` URL-param read).
- **W-2 hedges resolved:** All "if absent" / "use whatever the library's actual shape is" / "fallback if Phase 14 webhook is on v22" hedges resolved to concrete values via `read_first` grep against codebase. Stripe pin verified at v19 (Phase 14 lock).

Output: Modified `stripe-webhook/events/invoice-paid.ts`, new `account-updated.ts` handler, dispatcher registration, modified `stripe-checkout/index.ts` for `?aff=` plumbing, NEW feature_flags migration + SignUpForm field + feature-flags client helper + tests.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@/Users/karstenhaldan/minisite/leanshot/.planning/phases/19-affiliate-program-stripe-connect/19-CONTEXT.md
@/Users/karstenhaldan/minisite/leanshot/.planning/phases/19-affiliate-program-stripe-connect/19-CONTEXT-ADDENDUM-research.md
@/Users/karstenhaldan/minisite/leanshot/.planning/phases/19-affiliate-program-stripe-connect/19-PATTERNS.md
@/Users/karstenhaldan/minisite/leanshot/.planning/phases/19-affiliate-program-stripe-connect/19-01-schema-rls-tier-effective-PLAN.md
@/Users/karstenhaldan/minisite/supabase/functions/stripe-webhook/index.ts
@/Users/karstenhaldan/minisite/supabase/functions/stripe-webhook/events/invoice-paid.ts
@/Users/karstenhaldan/minisite/supabase/functions/stripe-checkout/index.ts
@/Users/karstenhaldan/minisite/leanshot/src/components/auth/SignUpForm.tsx

<interfaces>
From `stripe-webhook/events/invoice-paid.ts` (existing 40 lines — extending in place):
- `export async function handle(event: Stripe.Event, admin: SupabaseClient): Promise<void>`
- Existing flow: read `invoice.subscription` → UPDATE `subscriptions` set ux_tier='paid' / status / current_period_end.

From `stripe-webhook/index.ts` dispatcher: events are routed via switch in main handler. ADDING `account.updated` requires registering a new branch.

From `stripe-checkout/index.ts handleSession` (around line 372-374 per PATTERNS.md B.5): existing call to `stripe.checkout.sessions.create` with `subscription_data.metadata = {...}`. Need to add `aff_code` if `?aff=` query param present.

**Stripe version pin (W-2 resolution):** Phase 14 webhook is on `stripe@19` (verified via `grep -n 'esm.sh/stripe@' supabase/functions/stripe-*/`). All new Stripe SDK imports in this plan MUST use `https://esm.sh/stripe@19?target=denonext` with `apiVersion: '2026-04-22.dahlia'`. Do NOT pin a different version.

CONTEXT D-36: ONLY `billing_reason === 'subscription_create'` writes a commission row. Other billing_reason values (`subscription_cycle`, `manual`, `upcoming`, etc.) skip.
CONTEXT D-30: 60-day chargeback hold. Set `affiliate_conversions.eligible_at = invoice.status_transitions.paid_at + 60 days`.
RESEARCH Pitfall 2: `client_reference_id` doesn't survive renewals via Customer Portal — write `aff_code` into BOTH `session.metadata` AND `subscription_data.metadata` so future `invoice.paid` events can read it from the subscription.
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Extend stripe-checkout to propagate ?aff=<code> + _aff cookie + ?aff_manual=<code> into subscription.metadata.aff_code</name>
  <files>/Users/karstenhaldan/minisite/supabase/functions/stripe-checkout/index.ts, /Users/karstenhaldan/minisite/supabase/functions/stripe-checkout/index.test.ts</files>
  <read_first>
    /Users/karstenhaldan/minisite/supabase/functions/stripe-checkout/index.ts (full file — locate the existing `stripe.checkout.sessions.create` call and the `subscription_data.metadata` object construction; find the URL parsing logic)
    /Users/karstenhaldan/minisite/supabase/functions/stripe-checkout/index.test.ts (existing test scaffold)
    /Users/karstenhaldan/minisite/leanshot/.planning/phases/19-affiliate-program-stripe-connect/19-PATTERNS.md (section B.5 — checkout aff= modification note)
  </read_first>
  <acceptance_criteria>
    - `stripe-checkout/index.ts` reads `aff` from URL search params OR `aff_manual` from URL search params OR `_aff` cookie via `getCookies(req.headers.get('Cookie'))` — precedence order: `?aff=` > `?aff_manual=` > `_aff` cookie.
    - Regex `/^[a-z0-9-]{4,80}$/` validates the code BEFORE the DB lookup.
    - Affiliate lookup uses `admin.from('affiliates').select('id, status').eq('referral_code', affCode).maybeSingle()` and silently no-ops if `status !== 'approved'`.
    - `stripe.checkout.sessions.create` is called with three additive parameters: `client_reference_id: affCode ?? undefined`, `subscription_data.metadata.aff_code: affCode ?? ''`, top-level `metadata.aff_code: affCode ?? ''`. Existing fields untouched.
    - All 5 new Deno tests pass; existing Phase 14 tests still pass.
  </acceptance_criteria>
  <action>
Modify `stripe-checkout/index.ts` to read `?aff=<code>`, `?aff_manual=<code>` (D-23 BL-1), OR `_aff` cookie (Plan 19-02 set) from the checkout request and persist into Stripe metadata. This is the CRITICAL upstream of Task 2's attribution — without it, the webhook has no `aff_code` to read.

**Modification 1 — Read aff code from request (three sources):**
- Locate the `Deno.serve` handler (likely calls a `handleSession` helper or inlines session creation).
- Where the request body / URL is parsed, extract in this precedence order:
  1. `const affFromQuery = new URL(req.url).searchParams.get('aff');`
  2. `const affManualFromQuery = new URL(req.url).searchParams.get('aff_manual');` (BL-1 / D-23 — propagated from SignUpForm-driven checkout).
  3. `const affFromCookie = getCookies(req.headers.get('Cookie') ?? '')['_aff'] ?? null;`
- `const affCodeCandidate = affFromQuery ?? affManualFromQuery ?? affFromCookie ?? null;`
- If `affCodeCandidate`: validate against regex `/^[a-z0-9-]{4,80}$/` — silently drop if invalid (do NOT error the checkout request; affiliate attribution is best-effort).
- Look up via `admin.from('affiliates').select('id, status').eq('referral_code', affCodeCandidate).maybeSingle()` — if no row or `status !== 'approved'` → set `affCode = null` (silent no-op per RESEARCH V11 threat).

**Modification 2 — Propagate into Stripe session metadata:**
- Find the existing `stripe.checkout.sessions.create({ ... })` call (per PATTERNS.md B.5 around line 372-374 in stripe-checkout).
- ADD into the existing options: `client_reference_id: affCode ?? undefined,` (Stripe's first-party affiliate field — used in addition to metadata for redundancy).
- ADD/EXTEND existing `subscription_data: { ... metadata: { ... aff_code: affCode ?? '' } }` — the subscription is the canonical store for the aff code because `invoice.paid` on renewals reads from the subscription, not the session (RESEARCH Pitfall 2).
- ALSO ADD top-level `metadata: { aff_code: affCode ?? '' }` on the session itself (for `checkout.session.completed` if Phase 14 ever wires that handler later).
- DO NOT modify any other parameters of the existing call.

**Test additions in `index.test.ts`** (add to existing test file):
- Test A: `?aff=valid-code` + approved affiliate → `sessions.create` called with `client_reference_id='valid-code'` + `subscription_data.metadata.aff_code='valid-code'` + session-level `metadata.aff_code='valid-code'`.
- Test B: `?aff=valid-code` + pending affiliate → `client_reference_id` undefined; metadata `aff_code = ''`.
- Test C: `?aff=invalid!chars` → regex rejects; same as no aff (silent drop).
- Test D: no `?aff=` query param + `Cookie: _aff=cookie-code` + approved → `aff_code = 'cookie-code'` (cookie fallback wins).
- Test E: no `?aff=` + no cookie + `?aff_manual=manual-code` + approved → `aff_code = 'manual-code'` (BL-1 / D-23 manual-entry path wins).
- Test F: no `?aff=` + no cookie + no `?aff_manual=` → no error; sessions.create proceeds with empty aff metadata.

**Constraints:**
- DO NOT remove or change ANY existing field of `sessions.create` — additive only.
- DO NOT add `?aff=` validation to the URL parser if Phase 14 already has one — extend, don't fight.
- Commit with pathspec: `git commit -- supabase/functions/stripe-checkout/index.ts supabase/functions/stripe-checkout/index.test.ts` per [[feedback-parallel-executor-git-isolation]] — this file is shared with Phase 14 surface; pathspec prevents sibling-plan sweep.
- This is the ONLY plan in Phase 19 that touches `stripe-checkout/`. Plans 19-05 / 19-06 do NOT modify it.
  </action>
  <verify>
    <automated>cd /Users/karstenhaldan/minisite && deno test supabase/functions/stripe-checkout/index.test.ts --allow-env --allow-net</automated>
  </verify>
  <done>stripe-checkout extracts `aff_code` from `?aff=` query OR `?aff_manual=` query (BL-1) OR `_aff` cookie (fallback), in that precedence; validates against `affiliates.status='approved'`; persists into 3 Stripe metadata locations (session.client_reference_id, session.metadata, subscription_data.metadata); 6 new Deno tests pass; existing Phase 14 tests still pass.</done>
</task>

<task type="auto">
  <name>Task 2: Extend invoice-paid handler + add account-updated handler + register in dispatcher</name>
  <files>/Users/karstenhaldan/minisite/supabase/functions/stripe-webhook/events/invoice-paid.ts, /Users/karstenhaldan/minisite/supabase/functions/stripe-webhook/events/invoice-paid.test.ts, /Users/karstenhaldan/minisite/supabase/functions/stripe-webhook/events/account-updated.ts, /Users/karstenhaldan/minisite/supabase/functions/stripe-webhook/events/account-updated.test.ts, /Users/karstenhaldan/minisite/supabase/functions/stripe-webhook/index.ts</files>
  <read_first>
    /Users/karstenhaldan/minisite/supabase/functions/stripe-webhook/events/invoice-paid.ts (full 40 lines — extending in place)
    /Users/karstenhaldan/minisite/supabase/functions/stripe-webhook/index.ts (event dispatcher switch statement)
    /Users/karstenhaldan/minisite/supabase/functions/stripe-webhook/events/customer-subscription-updated.ts (closest analog for an event handler that updates a DB table — find file in directory listing)
    /Users/karstenhaldan/minisite/leanshot/.planning/phases/19-affiliate-program-stripe-connect/19-PATTERNS.md (section B.5 — exact extension pattern with code snippet for invoice-paid)
    /Users/karstenhaldan/minisite/leanshot/.planning/phases/19-affiliate-program-stripe-connect/19-CONTEXT-ADDENDUM-research.md (D-36 filter)
  </read_first>
  <acceptance_criteria>
    - `invoice-paid.ts` has the new affiliate-conversion path AFTER the existing tier-sync logic; checks `invoice.billing_reason === 'subscription_create'` and returns early on any other value.
    - `account-updated.ts` exports `async function handle(event, admin)` and UPDATEs `affiliates.stripe_payouts_enabled` when `stripe_connect_account_id` matches.
    - `stripe-webhook/index.ts` dispatcher has a new case branch for `account.updated`.
    - All 9 new Deno tests pass; existing Phase 14 webhook tests still pass.
    - Stripe SDK imports across all new/modified files pin `https://esm.sh/stripe@19?target=denonext` (W-2 — match Phase 14 lock).
  </acceptance_criteria>
  <action>
Two event handlers; one extended, one new. Both register in the dispatcher.

**File 1 (EXTEND) — `events/invoice-paid.ts`** (per PATTERNS.md B.5 extension pattern + D-36):
- Keep all existing logic at the top of `handle()` (subscription UPDATE for Phase 14 tier sync). Do NOT remove or reorder existing code.
- AFTER the existing logic but before the function returns, ADD the affiliate-conversion path:
  1. `if (invoice.billing_reason !== 'subscription_create') { return; }` — D-36 filter; renewals exit early.
  2. Resolve `aff_code` — preferred source is the subscription's metadata. Call `stripe.subscriptions.retrieve(subId)` if needed OR read from local subscription mirror if Phase 14 stores metadata. PATTERN: try `subscription.metadata?.aff_code`; fall back to `invoice.subscription_details?.metadata?.aff_code` (Stripe 2026 API); finally `invoice.lines.data[0]?.metadata?.aff_code`. If still null → `return` (no affiliate attribution).
  3. Validate code against approved affiliate: `select id, commission_rate_cents, status from affiliates where referral_code = $1 and status = 'approved'`. If no row → `return` (silent — RESEARCH V11).
  4. Compute `eligible_at`: `const paidAtMs = (invoice.status_transitions?.paid_at ?? Math.floor(Date.now() / 1000)) * 1000; const eligibleAt = new Date(paidAtMs + 60 * 24 * 3600 * 1000).toISOString();` (D-30 60-day chargeback hold).
  5. INSERT INTO `affiliate_conversions` with fields `affiliate_id`, `user_id` (resolved via subscription customer→user_id lookup OR null), `subscription_id: subId`, `invoice_id: invoice.id`, `commission_cents: affiliate.commission_rate_cents`, `status: 'pending'`, `eligible_at`, `invoice_paid_at: new Date(paidAtMs).toISOString()` — handle UNIQUE constraint violation `code === '23505'` as success (idempotent webhook replay per Pattern B from stripe-webhook/index.ts:175-198). On any other error → `throw new Error('affiliate-conversion-insert-failed');`.
  6. Console-log success at `info` level (PII-safe — only `{ affiliate_id, invoice_id }`).

**File 2 (NEW) — `events/account-updated.ts`** (per PATTERNS.md B.5 + Pitfall 7):
- Export `async function handle(event: Stripe.Event, admin: SupabaseClient): Promise<void>`.
- `const acct = event.data.object as Stripe.Account;` (event is `account.updated`).
- Look up affiliate: `select id from affiliates where stripe_connect_account_id = $1`. If no row → `return` (this account isn't ours).
- UPDATE `affiliates SET stripe_payouts_enabled = acct.payouts_enabled, updated_at = now() WHERE stripe_connect_account_id = acct.id` (D-37 #2 + Pitfall 7 — Plan 19-09 cron reads this column).
- If UPDATE error → `throw new Error('account-updated-affiliate-sync-failed');` (webhook will retry).

**File 3 (MODIFY) — `stripe-webhook/index.ts`** (dispatcher registration):
- Find the event-routing switch (likely something like `switch (event.type) { case 'invoice.paid': await invoicePaid.handle(...); case 'customer.subscription.updated': ... }`).
- ADD a new branch: `case 'account.updated': await accountUpdated.handle(event, admin); break;`
- Add the import at the top: `import * as accountUpdated from './events/account-updated.ts';` (match existing import style).
- DO NOT modify or reorder any existing case branches.

**Tests:**

`events/invoice-paid.test.ts` (add to existing file):
- Test X: `billing_reason='subscription_cycle'` (renewal) → `affiliate_conversions` INSERT NOT called (D-36).
- Test Y: `billing_reason='subscription_create'` + subscription.metadata.aff_code='valid' + approved affiliate → INSERT called with correct `commission_cents` + `eligible_at = paid_at + 60d`.
- Test Z: `billing_reason='subscription_create'` + no aff_code → INSERT NOT called.
- Test W: `billing_reason='subscription_create'` + aff_code points to suspended affiliate → INSERT NOT called.
- Test V: Duplicate webhook (same invoice.id replayed) → second call observes UNIQUE violation (code 23505) but does NOT throw (idempotent).
- Test U: existing Phase 14 tier-sync logic still runs (subscription UPDATE happens regardless of affiliate path).

`events/account-updated.test.ts` (NEW file):
- Test 1: account.id not in affiliates → no-op, no DB write.
- Test 2: account with `payouts_enabled=true` → affiliates row UPDATEd to `stripe_payouts_enabled=true`.
- Test 3: account with `payouts_enabled=false` → affiliates row UPDATEd to false (e.g. KYC re-verification needed).

**Constraints:**
- This plan is the ONLY Phase 19 plan modifying `stripe-webhook/events/invoice-paid.ts` and `stripe-webhook/index.ts`. NO sibling plan touches these files.
- All Stripe SDK imports pinned at `stripe@19` (W-2 resolution — Phase 14 lock).
- Commit with pathspec on this plan's files only.
- Test files: `.test.ts` ([[reference-deno-test-discovery]]).
- DO NOT push migrations or deploy functions; deploys at phase close.
  </action>
  <verify>
    <automated>cd /Users/karstenhaldan/minisite && deno test supabase/functions/stripe-webhook/events/invoice-paid.test.ts supabase/functions/stripe-webhook/events/account-updated.test.ts --allow-env --allow-net</automated>
  </verify>
  <done>invoice.paid handler filters renewals via `billing_reason==='subscription_create'`; idempotent INSERT on `invoice_id` UNIQUE; eligible_at correctly set to paid_at+60d; account.updated handler mirrors `payouts_enabled` flag; dispatcher routes `account.updated` to new handler; 9 new Deno tests green; existing Phase 14 tests still pass.</done>
</task>

<task type="auto">
  <name>Task 3 (BL-1 / D-23): feature_flags table + SignUpForm referral-code field + client feature-flag helper</name>
  <files>/Users/karstenhaldan/minisite/supabase/migrations/20270101000010_feature_flags_aff_manual_entry.sql, /Users/karstenhaldan/minisite/leanshot/src/lib/feature-flags.ts, /Users/karstenhaldan/minisite/leanshot/src/lib/__tests__/feature-flags.test.ts, /Users/karstenhaldan/minisite/leanshot/src/components/auth/SignUpForm.tsx, /Users/karstenhaldan/minisite/leanshot/src/components/auth/__tests__/SignUpForm.test.tsx</files>
  <read_first>
    /Users/karstenhaldan/minisite/leanshot/.planning/phases/19-affiliate-program-stripe-connect/19-CONTEXT.md (D-23 — full lock for aff_manual_entry: defaults OFF, admin can enable for specific campaigns, validates against `affiliates.referral_code`)
    /Users/karstenhaldan/minisite/leanshot/src/components/auth/SignUpForm.tsx (existing form structure; fresh-signup vs anon-promotion branches; PASSWORD_REGEX pattern)
    /Users/karstenhaldan/minisite/supabase/migrations/20261101000006_is_staff_helper.sql (analog for a small one-table helper migration with RLS)
    /Users/karstenhaldan/minisite/leanshot/src/components/ui/Input.tsx (Input primitive)
  </read_first>
  <acceptance_criteria>
    - Migration `20270101000010_feature_flags_aff_manual_entry.sql` creates `public.feature_flags` table (key text pk, enabled boolean not null default false, description text, updated_at timestamptz default now()) with RLS enabled; staff-all + authenticated-select policies; seeds ONE row `('aff_manual_entry', false, 'AFF-05 D-23: web fallback for direct signups with referral code from outside the cookie path. Enable per campaign.')`.
    - `src/lib/feature-flags.ts` exports `useFeatureFlag(key: string): boolean` hook + `loadFeatureFlags(): Promise<void>` boot helper; reads all rows once at app boot via supabase-js; caches in a Zustand-friendly module-level Map (no new store).
    - `SignUpForm.tsx` calls `useFeatureFlag('aff_manual_entry')`; when true, renders a `<Input>` labeled "Referral code (optional)" between email and password fields; submit flow propagates the entered code to checkout via URL param `?aff_manual=<code>` when redirecting to checkout (or via session-state if there's no immediate checkout step).
    - Code validation: client-side regex `/^[a-z0-9-]{4,80}$/`; on invalid code, show inline error "Referral code must be 4-80 lowercase letters, digits, or dashes". Empty input is valid (field is optional).
    - 4 new vitest tests pass; SignUpForm renders the field ONLY when flag enabled.
  </acceptance_criteria>
  <action>
**File 1 — `supabase/migrations/20270101000010_feature_flags_aff_manual_entry.sql`:**
- Create `public.feature_flags` table:
  ```
  create table if not exists public.feature_flags (
    key text primary key,
    enabled boolean not null default false,
    description text,
    updated_at timestamptz not null default now()
  );
  ```
- Enable RLS; add two named idempotent policies (per Phase 19 RLS pattern):
  - `pol_feature_flags_authenticated_read` — `for select to authenticated using (true)` (every signed-in user can read flag state; values are not sensitive).
  - `pol_feature_flags_staff_write` — `for all to authenticated using (public.is_staff()) with check (public.is_staff())` (admins toggle flags via admin UI in Phase 22).
- Seed row: `insert into public.feature_flags (key, enabled, description) values ('aff_manual_entry', false, 'AFF-05 D-23: web fallback for direct signups carrying a referral code from outside the cookie path. Default OFF; admin enables per campaign.') on conflict (key) do nothing;`.
- Header comment cites D-23 and notes that Phase 22 ADMIN-06 will surface the flag-toggle UI; for v1.2 admin uses a direct SQL UPDATE.

**File 2 — `src/lib/feature-flags.ts`:**
- Module-level cache: `const flagCache = new Map<string, boolean>();`
- Export `async function loadFeatureFlags(supabaseClient: SupabaseClient): Promise<void>`:
  - `const { data } = await supabaseClient.from('feature_flags').select('key, enabled');`
  - `data?.forEach(row => flagCache.set(row.key, row.enabled));`
  - On error: cache stays empty (false-default).
  - Call from `src/main.tsx` AFTER `await hydrate()` and BEFORE `createRoot().render(...)`. The boot path is synchronous-ish; flag-loading uses a separate `void loadFeatureFlags()` fire-and-forget — if the first render misses flag data, components using `useFeatureFlag` will re-render on flag-load completion via a tiny pub/sub.
- Export `function useFeatureFlag(key: string): boolean`:
  - Returns `flagCache.get(key) ?? false`.
  - Subscribes to a module-level pub/sub so on `loadFeatureFlags` completion, the hook re-runs in components.
- Export `function setFlagForTest(key: string, enabled: boolean): void` for test injection.

**File 3 — `src/lib/__tests__/feature-flags.test.ts`** (vitest):
- T1: `useFeatureFlag('aff_manual_entry')` returns false when cache is empty (default-off).
- T2: After `setFlagForTest('aff_manual_entry', true)`, `useFeatureFlag` returns true.
- T3: `loadFeatureFlags` populates the cache from a mocked supabase-js response.
- T4: `useFeatureFlag` re-renders subscribed components when the cache is updated (use renderHook + act).

**File 4 — `src/components/auth/SignUpForm.tsx` MODIFY:**
- Import `useFeatureFlag` from `@/lib/feature-flags`.
- Inside the component: `const showAffManual = useFeatureFlag('aff_manual_entry');`
- Add a third local state `const [affManual, setAffManual] = useState(''); const [errAffManual, setErrAffManual] = useState<string | undefined>();`
- When `showAffManual && !isAnon` (manual entry is for fresh-signup path; anon-promotion already has session-cookie attribution), render between email and password:
  ```
  <Input
    label="Referral code (optional)"
    value={affManual}
    onChange={(e) => { setAffManual(e.target.value); setErrAffManual(undefined); }}
    placeholder="coachjane-a3f2"
    error={errAffManual}
    autoComplete="off"
  />
  ```
- On submit, validate `affManual`:
  - Empty → OK, proceed.
  - Non-empty + matches `/^[a-z0-9-]{4,80}$/` → proceed.
  - Non-empty + invalid format → `setErrAffManual('Use 4-80 lowercase letters, digits, or dashes.'); return;`
- After successful signUp, if `affManual.length > 0`: propagate to the checkout step. There are two options depending on the signup flow:
  - If signUp immediately redirects to checkout: append `?aff_manual=<encodeURIComponent(affManual)>` to the redirect URL.
  - If signUp goes through email verification first: stash the code in `sessionStorage.setItem('leanshot_aff_manual', affManual)` and have the post-verify redirect (already in `signin?promote=1` flow) propagate it. **For v1.2 keep it simple:** sessionStorage write + read at checkout-trigger; Plan 19-09 SUMMARY notes this as the integration touchpoint with Phase 14 checkout.

**File 5 — `src/components/auth/__tests__/SignUpForm.test.tsx`** (vitest):
- T1: with flag OFF, the referral-code Input does NOT render.
- T2: with flag ON, the referral-code Input renders for non-anon users.
- T3: with flag ON + invalid code on submit → inline error, signUp NOT called.
- T4: with flag ON + valid code on submit → signUp called; sessionStorage `leanshot_aff_manual` is set.
- T5: with flag ON + empty code on submit → signUp called; sessionStorage NOT set.

**Constraints:**
- Migration timestamp `20270101000010` slots between 19-07's `…000008` and 19-08's `…000009`. **REORDER:** rename the migration to `20270101000010_feature_flags_aff_manual_entry.sql` (already correct in files_modified). Note: 19-08 uses `…000009`, 19-07 uses `…000006/7/8`. Final ordering: 01..04 (19-01) → 05 (19-01 RLS) → 06,07,08 (19-07) → 09 (19-08) → **10 (THIS plan)** → 11,12 (19-09).
- DO NOT introduce a new global store; the feature-flag cache is a Map + pub/sub (lighter weight than Zustand).
- SignUpForm field is gated by the flag at runtime — when the migration ships with `enabled=false`, the form behaves identically to today.
- Commit with pathspec on this task's files only.
  </action>
  <verify>
    <automated>cd /Users/karstenhaldan/minisite/leanshot && npm run test -- src/lib/__tests__/feature-flags.test.ts src/components/auth/__tests__/SignUpForm.test.tsx --run</automated>
  </verify>
  <done>feature_flags table migration ships with `aff_manual_entry=false` seed; useFeatureFlag hook reads from the cache; SignUpForm conditionally renders referral-code Input when flag is enabled; validation + propagation to checkout via sessionStorage path; 9 vitest tests pass.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| Stripe → stripe-webhook | Signature-verified via existing Phase 14 webhook secret; event.body is trusted post-verify |
| Browser → stripe-checkout | JWT-gated already; `?aff=` query param + `?aff_manual=` (BL-1) are the new untrusted inputs crossing |
| Edge Function → DB (service_role) | Trusted writes to affiliate_conversions + affiliates.stripe_payouts_enabled + feature_flags read |
| Authenticated user → feature_flags | RLS allows SELECT only; admin via is_staff() for writes; values are not sensitive |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-19-04-S | Spoofing | Webhook replay (same invoice.id) | mitigate | `affiliate_conversions.invoice_id UNIQUE` (Plan 19-01) + code 23505 swallowed → idempotent (Pattern from stripe-webhook/index.ts:175-198) |
| T-19-04-T | Tampering | Trojan aff_code in subscription.metadata | mitigate | Validate `status='approved'` server-side; non-approved silently no-ops (V11) |
| T-19-04-T | Tampering | Double-credit on renewal | mitigate | D-36 filter `billing_reason === 'subscription_create'` ONLY |
| T-19-04-T | Tampering | User injects ?aff= or ?aff_manual= for their own code | mitigate | Self-fraud signals (IP /24, fingerprint, email-domain) fire in Plan 19-07 trigger; flagged conversions → admin queue (D-25) |
| T-19-04-R | Repudiation | Conversion attribution dispute | mitigate | `invoice_id` is Stripe's canonical receipt; `commission_cents` captured at attribution time (immutable) |
| T-19-04-I | Information Disclosure | Stripe API errors echoed in webhook response | mitigate | Existing Phase 14 webhook never echoes; new handlers throw generic Error (Pattern S3) |
| T-19-04-D | DoS | Webhook replay flood | accept | Stripe rate-limits webhook delivery; UNIQUE constraint makes replays O(1) |
| T-19-04-E | Elevation of Privilege | Cookie-stuffing via `_aff` server-read fallback | mitigate | Cookie value is just a referral code; status check + fraud signals (Plan 19-07) catch self-attribution |
| T-19-04-E | Elevation of Privilege | Feature-flag tampering via direct DB write | mitigate | RLS `pol_feature_flags_staff_write` requires `is_staff()`; admin UI (Phase 22) gates the toggle |
</threat_model>

<verification>
- Task 1: stripe-checkout reads `?aff=` from query OR `?aff_manual=` (BL-1) OR `_aff` cookie; persists into 3 Stripe metadata locations
- Task 2 invoice-paid: D-36 renewal filter active; idempotent INSERT; eligible_at correctly set
- Task 2 account-updated: mirrors `payouts_enabled` to affiliates.stripe_payouts_enabled
- Task 3 BL-1: feature_flags table + SignUpForm conditional field + client helper; flag defaults OFF; admin flips via SQL UPDATE for v1.2
- All Phase 14 existing webhook tests still pass (no regressions)
- Total 15 new Deno + vitest tests pass
</verification>

<success_criteria>
- A user clicks `/r/{code}` → lands on co-branded landing → clicks Subscribe → checkout completes → `invoice.paid` fires → `affiliate_conversions` row appears with correct `commission_cents`, `eligible_at = paid_at + 60d`, `status='pending'`
- Same user's NEXT monthly renewal (invoice.paid with `billing_reason='subscription_cycle'`) → ZERO new conversion rows (D-36)
- Stripe Connect onboarding completes → `account.updated` webhook fires → `affiliates.stripe_payouts_enabled` flips to true (Plan 19-09 cron can now transfer)
- Webhook replay of same invoice.id → no double-credit (UNIQUE + 23505 swallow)
- **BL-1:** With `aff_manual_entry=true`, a user who direct-signs-up with a referral code in the SignUpForm input has their conversion attributed via `?aff_manual=<code>` propagation to stripe-checkout
- D-36 forward-compat: `subscription_create` for clinic-seat subs ALSO inserts a conversion if `aff_code` present (correct — initial paid = conversion)
</success_criteria>

<output>
After completion, create `19-04-SUMMARY.md`: cite all 15 test assertions; document the 3 Stripe metadata locations + 3 aff_code source paths (?aff= / ?aff_manual= / _aff cookie); BL-1 implementation summary (feature_flags table + SignUpForm field + client helper); flag for Plan 19-06 that the partner dashboard can read `affiliate_conversions` (RLS already set in Plan 19-01) without extra query; note for Plan 19-09 that one more migration (`…000010_feature_flags_…`) is included in the [BLOCKING] schema push.
</output>
