# Phase 40: Cancellation Save-Offers Flow — Pattern Map

**Mapped:** 2026-05-21
**Files analyzed:** 14 new/modified artifact categories
**Analogs found:** 14 / 14 (all categories have a concrete existing analog)

This map is the planner's source-of-truth for "copy from THIS file" decisions across the six 40-* plans. Every entry below cites an absolute path + line range where the load-bearing pattern lives, plus the project-specific gotcha that bites if you ignore it. **All paths absolute from git root `/Users/karstenhaldan/minisite/`.**

> Project layout reminder: this is the `minisite` monorepo. `leanshot/` (Vite SPA) + `supabase/` (migrations + Edge Fns) are siblings. PLAN.md paths are relative to git root, NOT `/leanshot/`. Per memory `reference_minisite_monorepo_layout`.

---

## File Classification

| New/Modified File | Plan | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|------|-----------|----------------|---------------|
| `supabase/migrations/<ts>_p40_cancellation_offers_log.sql` | 40-01 | migration (table+RLS+triggers) | append-only ledger | `supabase/migrations/20270708000001_p35_xp_ledger.sql` | EXACT |
| `supabase/migrations/<ts>_p40_save_offer_rules.sql` | 40-01 | migration (admin CRUD table) | request-response | `supabase/migrations/20270602000010_cohort_definitions.sql` + `20270602000012_cohort_rpcs.sql` | EXACT |
| `supabase/migrations/<ts>_p40_offer_type_enum.sql` + `<ts>_p40_cancel_log_status_enum.sql` | 40-01 | migration (CHECK enum) | DDL | embedded `check (... in (...))` widening — see "Status enum" section below | role-match |
| `supabase/migrations/<ts>_p40_subscriptions_pause_cols.sql` | 40-02 | migration (ALTER) | DDL | `supabase/migrations/20270101000003_subscriptions_provider_guard.sql` | role-match |
| `supabase/migrations/<ts>_p40_stripe_coupon_seed.sql` (or seed Fn) | 40-01 | migration / one-shot seed | Stripe API call | RESEARCH §"Stripe coupon catalog seed" (no prior in-repo analog for idempotent Stripe seed; use seed-Fn pattern) | NO-ANALOG (NEW pattern) |
| `supabase/migrations/<ts>_p40_save_offer_rpcs.sql` | 40-05 | migration (SECDEF RPCs) | request-response | `supabase/migrations/20270602000012_cohort_rpcs.sql` lines 139-194 | EXACT |
| `supabase/migrations/<ts>_p40_pause_reminder_cron.sql` | 40-02 | migration (pg_cron) | event-driven (cron) | `supabase/migrations/20270708000021_p35_challenge_evaluate_cron.sql` | EXACT |
| `supabase/migrations/<ts>_p40_roi_view.sql` | 40-06 | migration (VIEW) | CRUD-read | `supabase/migrations/20270601000010_cohort_retention_view.sql` (referenced; aggregation view) | role-match |
| `supabase/functions/stripe-webhook/events/subscription-updated.ts` (EXTEND) | 40-02 | event handler | event-driven | `supabase/functions/stripe-webhook/events/subscription-updated.ts` (itself — extend in-place) | SELF |
| `supabase/functions/cancellation-decide-offer/index.ts` + helpers | 40-03 | Edge Fn (decide) | request-response (lookup-only) | `supabase/functions/recommend-next-best-action/` + `helpdesk-ai-assist/` (auth+admin+JSON pattern) | role-match |
| `supabase/functions/cancellation-accept-offer/index.ts` + helpers | 40-03 | Edge Fn (act) | request-response (Stripe write) | `supabase/functions/stripe-checkout/` + `admin-stripe-action/` | role-match |
| `supabase/functions/cancellation-feedback-to-ticket/index.ts` | 40-04 | Edge Fn (Sequel) | event-driven | `supabase/functions/lifecycle-behavior-triggered/` invoker pattern + RPC `create_ticket_with_first_message` | role-match |
| `supabase/functions/pause-reminder-fire/index.ts` | 40-02 | Edge Fn (cron worker) | event-driven (service-role) | `supabase/functions/challenge-evaluate-cron/index.ts` | EXACT |
| `supabase/functions/download-cancellation-roi-csv/index.ts` | 40-06 | Edge Fn (CSV stream) | streaming / file-I/O | `supabase/functions/bulk-csv-export/` (existing CSV stream Fn) | EXACT |
| `leanshot/src/components/dashboard/settings/cancellation/CancellationModal.tsx` (single chunk) | 40-04 | React component | request-response | `leanshot/src/components/changelog/WhatsNewDrawer.tsx` (lazy chunk via App.tsx line 135) + `leanshot/src/components/nps/QuarterlyNPSModal.tsx` (lazy chunk line 146) | role-match |
| `leanshot/src/components/admin/cancellation/CancellationModule.tsx` | 40-05 | admin module entry | request-response | `leanshot/src/components/admin/gamification/AdminGamificationModule.tsx` | EXACT |
| `leanshot/src/lib/admin/modules.ts` (EXTEND `ADMIN_MODULES`) | 40-05 | manifest entry | config | `leanshot/src/lib/admin/modules.ts` lines 82-94 (existing entries) | SELF |
| `leanshot/src/components/admin/cancellation/CancellationRoiTab.tsx` (Chart.js view + CSV link) | 40-06 | dashboard view | CRUD-read | `leanshot/src/components/admin/AdminMetricsMrrChart.tsx` | EXACT |
| `leanshot/src/lib/analytics/events.ts` (EXTEND) | 40-04 | analytics enum | config | (existing file — extension pattern) | SELF |
| `leanshot/src/types/cancellation.ts` (single-writer types) | 40-04 | TS types | config | `leanshot/src/types/index.ts` barrel pattern | role-match |

---

## Pattern Assignments

### 1. `cancellation_offers_log` append-only ledger (Plan 40-01)

**Analog:** `/Users/karstenhaldan/minisite/supabase/migrations/20270708000001_p35_xp_ledger.sql` (Phase 35 xp_ledger). Best fit: append-only, negative-space RLS, defense-in-depth UPDATE/DELETE block triggers, 2-axis (user_id + soft-FK on parent). Phase 7 `audit_logs` is the older sibling; xp_ledger is the more current template.

**Copy patterns:**

- **Negative-space RLS** (lines 50-72): NO INSERT/UPDATE/DELETE policy for `authenticated`. Denial-by-default IS the append-only enforcement. Service-role insert policy is explicit (grep-able intent) even though service_role bypasses RLS — Phase 19 documentation convention.
  ```sql
  alter table public.cancellation_offers_log enable row level security;
  create policy "cancellation_offers_log_select_admin" ...  -- support_admin+ read
  create policy "cancellation_offers_log_service_insert"
    on public.cancellation_offers_log for insert
    to service_role with check (true);
  -- NO UPDATE / NO DELETE / NO INSERT to `authenticated` (negative space)
  ```
- **Defense-in-depth append-only triggers** (lines 80-106): even a forgotten service_role grant cannot UPDATE/DELETE rows. Mirror `_p35_xp_ledger_block_update` + `_p35_xp_ledger_block_delete` verbatim, renamed `_p40_cancellation_offers_log_block_*`.
- **Named dollar-quote tags** (line 84 `$body$`, line 95 `$body$`): NEVER bare `$$`. Per `reference_postgres_dollar_quote_nesting_in_cron_body`.
- **`search_path = public, pg_catalog` SET clause** on trigger functions (line 83). Per `reference_supabase_migration_gotchas` SECDEF needs `extensions` for digest/uuid; for plain plpgsql triggers `public, pg_catalog` suffices.
- **Indexes** (lines 37-47): unique-index for dedup-key (xp_ledger uses `cycle_id`); composite `(user_id, created_at desc)` for per-user queries; `INCLUDE` index for aggregation. For Phase 40: `idx_offers_log_user(user_id, offered_at desc)`, `idx_offers_log_status_taken(status, taken_at desc) WHERE status in ('accepted','declined')`, `gin(cohort_snapshot) where status='accepted'` (per 40-RESEARCH Pattern 3).

**Project-specific gotcha:**
- `on delete set null` on `user_id` (xp_ledger line 13) — rows survive account deletion (Phase 7 D-03 / GDPR audit-retention). Phase 40 should mirror this for cohort-ROI longevity. CONTEXT 40-RESEARCH Pattern 3 uses `on delete cascade` — **planner must pick set-null** to match xp_ledger / audit_logs precedent.
- Append-only IS the schema invariant; do not write a SECDEF RPC for INSERT. Edge Fn writes directly with the service-role admin client. Per RESEARCH §Pitfall 4.

---

### 2. `save_offer_rules` admin-edited table (Plan 40-01) + SECDEF write RPCs (Plan 40-05)

**Analog (schema):** `/Users/karstenhaldan/minisite/supabase/migrations/20270602000010_cohort_definitions.sql` (table) — same shape: admin-only writes, support_admin+ reads, audit log integration via `log_admin_action`.

**Analog (SECDEF RPC):** `/Users/karstenhaldan/minisite/supabase/migrations/20270602000012_cohort_rpcs.sql` lines 139-194 (`cohort_define`) and 202-276 (`cohort_set_status` — state-machine RPC).

**Copy patterns:**

- **SECDEF function preamble** (lines 144-148):
  ```sql
  create or replace function public.save_offer_rule_create(...)
  returns uuid
  language plpgsql
  security definer
  set search_path = public, extensions, pg_catalog
  as $$
  ```
  Per `reference_supabase_migration_gotchas` Pitfall 2 — SECDEF needs `extensions` for `digest()`/`gen_random_uuid()`/etc.
- **Auth + role gate** (lines 149-158):
  ```sql
  v_caller uuid := auth.uid();
  if v_caller is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  if not public.is_admin_at_least('admin'::public.admin_role) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  ```
  Reuse `public.is_admin_at_least` (existing helper). For Phase 40: rules-create gated at `'admin'`; rules-archive gated at `'superadmin'` (mirror `cohort_set_status` lines 220-229 destructive-lifecycle gate).
- **Audit suppression + log** (lines 170-187):
  ```sql
  perform set_config('app.suppress_audit', 'on', true);
  insert into public.save_offer_rules (...) returning id into v_rule_id;
  perform public.log_admin_action(
    p_action_name => 'save_offer_rule_created', ...);
  ```
  Per `reference_supabase_migration_gotchas` Pitfall 4 — audit cascade needs `app.suppress_audit` GUC.
- **Grant pattern** (lines 193-194):
  ```sql
  revoke all on function public.save_offer_rule_create(...) from public;
  grant execute on function public.save_offer_rule_create(...) to authenticated;
  ```
- **Table-level RLS** (`save_offer_rules`): authenticated CANNOT direct-INSERT/UPDATE/DELETE — only via SECDEF RPCs. Mirror `revoke insert, update, delete on public.save_offer_rules from authenticated;` from RESEARCH Pattern 4 line 533.

**Project-specific gotcha:**
- The Edge Fn `cancellation-decide-offer` is **service-role** and reads `save_offer_rules` directly. It MUST NOT call the SECDEF write RPCs (they use `auth.uid()` and would NULL out). Per `feedback_rpc_auth_uid_vs_service_role_mismatch` + RESEARCH §Pitfall 4. SECDEF RPCs are called only from authenticated admin sessions in the admin UI.
- Per `feedback_admin_module_manifest_vs_router_branch_drift`: registering the admin module entry in `ADMIN_MODULES` is ONE step; AdminShell already routes via URL-prefix match (no router-branch drift risk for new module IDs). But the catchall fallback existed in P27. Verify `AdminLayout.tsx` switch routes via `route` key from manifest, not hardcoded.

---

### 3. Stripe webhook EXTENSION (Plan 40-02)

**Analog (file to EXTEND, not duplicate):** `/Users/karstenhaldan/minisite/supabase/functions/stripe-webhook/events/subscription-updated.ts` — already imports Stripe types, accepts `(event, admin, _d05Spy?)`, upserts the `subscriptions` row. Add a new section AFTER the existing upsert.

**Dispatcher (do NOT touch — `case 'customer.subscription.updated'` ALREADY routes here):** `/Users/karstenhaldan/minisite/supabase/functions/stripe-webhook/index.ts` lines 159-162.

**Copy patterns:**

- **Existing upsert pattern** (subscription-updated.ts lines 64-100):
  ```typescript
  export async function handle(event: Stripe.Event, admin: SupabaseClient, _d05Spy?: D05Spy): Promise<void> {
    const subscription = event.data.object as Stripe.Subscription;
    // ... computes currentPeriodEnd, trialEnd, planId, userId/clinicId from metadata ...
    const { error } = await admin.from('subscriptions').upsert({...});
  }
  ```
- **Phase 40 EXTENSION (drop-in after existing upsert):**
  ```typescript
  // ─── 40-02: pause_collection mirror ─────────────────────────────────────────
  const pauseCollection = subscription.pause_collection as
    | { behavior: 'void' | 'mark_uncollectible' | 'keep_as_draft'; resumes_at: number | null }
    | null;
  const newPausedUntil = pauseCollection?.resumes_at
    ? new Date(pauseCollection.resumes_at * 1000).toISOString()
    : null;
  const newIsPaused = pauseCollection !== null;

  // Read-back previous state to detect resume transition (T-0 email trigger)
  const { data: prev } = await admin
    .from('subscriptions')
    .select('is_paused')
    .eq('id', subId)
    .single();
  const wasPaused = (prev as { is_paused?: boolean } | null)?.is_paused === true;

  await admin.from('subscriptions')
    .update({ paused_until: newPausedUntil, is_paused: newIsPaused, reminded_t7: newIsPaused ? undefined : false })
    .eq('id', subId);

  // Auto-resume detection → fire T-0 confirmation email
  if (wasPaused && !newIsPaused) {
    await fireT0ResumeEmail(admin, subId, subscription);  // calls _shared/email-router.ts
  }
  ```
- **Phase 26 D-08 case-arm rule** (RESEARCH §Pitfall 1): **DO NOT** add `case 'customer.subscription.paused'` or `case 'customer.subscription.resumed'` to `index.ts`. They never fire for `pause_collection`. Extend `subscription-updated.ts` only.

**Project-specific gotcha:**
- API version pinned to `'2026-04-22.dahlia'` (index.ts line 64). `pause_collection.resumes_at` field is stable across this version. Do NOT mix legacy singular `discount` with `discounts[]` array (RESEARCH §Pitfall 2).
- Tests live at `subscription-updated.test.ts` (existing). EXTEND that file — add new `Deno.test()` blocks for: pause-start detection, pause-extend detection (resumes_at moves forward), auto-resume detection (pause_collection → null), no-op on unrelated update.
- Per memory `reference_stripe_legacy_key_and_supabase_token`: STRIPE_SECRET_KEY format is unprefixed (pre-2014 account); still valid.

---

### 4. Stripe `pause_collection` apply (Plan 40-03 — `cancellation-accept-offer`)

**Closest in-repo analog:** `/Users/karstenhaldan/minisite/supabase/functions/admin-stripe-action/` (admin-initiated Stripe subscription mutations) and `/Users/karstenhaldan/minisite/supabase/functions/stripe-checkout/` (auth+Stripe construction). For Stripe-SDK call shape, the verified version pin and SubtleCryptoProvider live in `stripe-webhook/index.ts`.

**Copy patterns:**

- **Stripe import + version pin** (stripe-webhook/index.ts line 28 + 64):
  ```typescript
  import Stripe from 'https://esm.sh/stripe@19?target=denonext';
  function getStripe(): Stripe {
    return new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, {
      apiVersion: '2026-04-22.dahlia' as Stripe.LatestApiVersion,
    });
  }
  ```
- **Pause apply** (RESEARCH §Code Examples lines 733-757 — VERIFIED via Stripe docs):
  ```typescript
  await stripe.subscriptions.update(subscriptionId, {
    pause_collection: { behavior: 'void', resumes_at: <unix-future> },
  });
  ```
- **Extend pause** (D-10) (RESEARCH lines 759-784): retrieve current `resumes_at`, add extension, update.

**Project-specific gotcha:**
- The accept-Fn calls Stripe with up to 2s latency. Per RESEARCH Open Q1: **SPLIT** decide vs accept Fns. UI shows skeleton during accept.
- `pause_collection` does NOT fire `customer.subscription.paused` webhook (RESEARCH §Pitfall 1) — local mirror happens only via the `subscription-updated.ts` extension above.
- A5 (assumption): trialing subs may reject pause — wrap in try/catch; on Stripe error fall back to `offer_type='discount'`; log to Sentry via `_shared/sentry.ts`.

---

### 5. Stripe `discounts[]` array append (Plan 40-03)

**Analog:** RESEARCH §Pattern 2 (lines 401-423). No prior Phase coupon-stacking-on-existing-sub in-repo — Phase 19/26 affiliate flow applied coupons at checkout time, not on already-active subs. **This is the closest pattern but it's a NEW shape.**

**Copy pattern (from RESEARCH, VERIFIED against Stripe docs):**

```typescript
async function applyDiscount(subscriptionId: string, couponId: string, stripe: Stripe) {
  const sub = await stripe.subscriptions.retrieve(subscriptionId, { expand: ['discounts'] });
  const existing = sub.discounts.map((d) => ({ coupon: (d.coupon as Stripe.Coupon).id }));
  await stripe.subscriptions.update(subscriptionId, {
    discounts: [...existing, { coupon: couponId }],
  });
}
```

**Project-specific gotcha:**
- **NEVER** use `subscriptions.update({ discount: couponId })` (legacy singular). It overwrites existing discounts and silently drops the affiliate coupon. Lint/test-time grep: `grep -rn 'discount:' supabase/functions/cancellation-*` must return ZERO matches (only `discounts:` plural). Per RESEARCH §Pitfall 2.
- A1 (assumption): `d.coupon` may be a string (id) OR an expanded Coupon object depending on prior expand state. Test asserts both code paths.
- D-15 stacking clamp (35%) happens at the **decide** Fn (anti-gaming.ts), not at the apply Fn. By the time apply runs, `offer_config.percent_off` is already the clamped final value.

---

### 6. Edge Fn split: decide (lookup) vs accept (Stripe write) (Plan 40-03)

**Closest existing 2-Fn pattern:**
- `supabase/functions/recommend-next-best-action/` (lookup-only, <100ms) ↔ `supabase/functions/track-rec-click/` (write-side) — RESEARCH pattern parallel.
- `supabase/functions/stripe-checkout/` (Stripe-write Fn auth + admin client init pattern).

**Copy patterns:**

- **Service-role Edge Fn skeleton** (challenge-evaluate-cron/index.ts lines 17-26):
  ```typescript
  import { checkServiceRoleBearer, corsHeaders, jsonError, jsonResponse, makeLazyAdmin } from '../_shared/lifecycle-utils.ts';
  import { captureServer, shutdownPostHog } from '../_shared/posthog-server.ts';
  const { admin, setAdminForTest, resetAdminForTest } = makeLazyAdmin();
  ```
  For Phase 40 `cancellation-decide-offer`: caller is the USER (JWT, not service-role) — use `checkUserBearer` pattern (validate JWT, get `auth.uid()`) instead of `checkServiceRoleBearer`. Look at `helpdesk-ai-assist/index.ts` for the user-bearer + admin-client shape (line 236 / 473 area).
- **Decide-offer skeleton** — directly copy RESEARCH lines 850-925. Key invariants:
  - Lookup-only — NO Stripe round-trip in decide Fn.
  - INSERT `cancellation_offers_log` with `status='offered'` returns `offer_id`.
  - Return early on D-02 cap, D-03 cooldown, D-04 clinic fork, D-15 zero-final-pct.
- **PostHog flush** (stripe-webhook/index.ts lines 244, 317-322):
  ```typescript
  try { /* main body */ } finally { await shutdownPostHog(); }
  ```
  RESEARCH §Pitfall 1 lesson — Deno isolate tears down immediately on Response; posthog-node batch flush must be `await`ed in `finally`.

**Project-specific gotcha:**
- Decide Fn writes log row directly with service-role admin (no SECDEF needed — RLS allows service_role inserts per Pattern 3 above). Accept Fn UPDATEs the same row from `'offered'` → `'accepted'` with `taken_at = now()`. **The append-only triggers (block_update) ALLOW status-machine transitions** only if you skip them via a single dedicated SECDEF UPDATE RPC OR explicitly carve out status-only transitions in the trigger body. **PLANNER NOTE:** xp_ledger triggers block ALL updates — Phase 40 needs a different design. Two options:
  - (a) Insert TWO rows: one at decide (offered), one at accept (accepted) linked via `offered_log_id` FK. Mirrors P19 affiliate `created` → `claimed` 2-row append.
  - (b) Carve trigger to allow `status` + `taken_at` + `declined_at` field updates only. More fragile.
  - **Recommend (a)** — strict append-only + simpler trigger. Planner must pick + document.
- Per memory `reference_supabase_functions_deploy_no_linked_flag` — `--linked` flag removed; omit on deploy. Also per memory `reference_supabase_functions_deploy_import_map_flag` — pass `--import-map` if Fn imports via aliases from `supabase/functions/import_map.json`.

---

### 7. T-7d pg_cron reminder (Plan 40-02)

**Analog (cron registration migration):** `/Users/karstenhaldan/minisite/supabase/migrations/20270708000021_p35_challenge_evaluate_cron.sql` (EXACT match — same shape: hourly cron, vault.decrypted_secrets bootstrap, net.http_post to Edge Fn).

**Analog (Edge Fn invoked by cron):** `/Users/karstenhaldan/minisite/supabase/functions/challenge-evaluate-cron/index.ts` lines 1-80 (EXACT match — service-role bearer check, per-user loop, captureServer + shutdownPostHog).

**Copy patterns:**

- **Cron schedule with vault** (P35 challenge cron lines 32-71):
  ```sql
  select cron.schedule(
    'p40-pause-t7-reminder',
    '0 * * * *',  -- hourly check at minute 0 (avoid minute 22 which P35 uses)
    $cron$
    do $invoke$
    declare v_secret text;
    begin
      select decrypted_secret into v_secret
        from vault.decrypted_secrets where name = 'service_role_key' limit 1;
      if v_secret is null then
        raise notice 'p40-pause-t7-reminder: service_role_key missing — skipping';
        return;
      end if;
      perform net.http_post(
        url := 'https://ytnsipxxmzgaebkqmokp.supabase.co/functions/v1/pause-reminder-fire',
        headers := jsonb_build_object(
          'Authorization', 'Bearer ' || v_secret,
          'Content-Type', 'application/json'
        ),
        body := '{}'::jsonb,
        timeout_milliseconds := 30000
      );
    exception when others then
      raise notice 'p40-pause-t7-reminder: error % — continuing', sqlerrm;
    end $invoke$;
    $cron$
  );
  ```
- **Pre-flight idempotent unschedule** (P35 cron lines 18-30): wrap in `do $unschedule$ ... $unschedule$` block; catches re-apply.
- **Named tag nesting**: `$cron$` outer, `$invoke$` inner, `$unschedule$` pre-flight. NEVER bare `$$`. Per `reference_postgres_dollar_quote_nesting_in_cron_body`.
- **Edge Fn worker** (challenge-evaluate-cron/index.ts):
  - `checkServiceRoleBearer(req)` gates entry (line 35).
  - Loop active candidates → per-user errors don't abort batch (lines 62-72).
  - `try { ... } finally { await shutdownPostHog(); }` envelope.

**Project-specific gotcha:**
- **Hardcoded Supabase URL** required (`https://ytnsipxxmzgaebkqmokp.supabase.co`). `current_setting('app.service_role_key')` GUC does NOT exist on this project — per `reference_supabase_pg_cron_vault_service_role_pattern`. Vault is the ONLY service-role-key source.
- **`sb_secret_*` token format** — per `reference_supabase_service_role_key_format_divergence`. Legacy HS256 JWTs get rejected 401. Don't `constantTimeEqual` against a hand-injected legacy token.
- **Minute slot** — pick a clean minute that doesn't pile with existing crons. P35 lists 05/07/12/15/22/27/37/42/52/57 as taken (challenge cron header lines 3-7). Use `0 * * * *` (minute 0) or `45 * * * *`.
- Per RESEARCH Open Q2: add `reminded_t7 boolean` column to `subscriptions` for dedup. Cron `UPDATE … SET reminded_t7=true` after net.http_post returns. On auto-resume the webhook extension resets `reminded_t7=false`.

---

### 8. `_shared/email-router.ts` shape (Plan 40-02 — both T-7d + T-0 emails)

**Verified signature** (`/Users/karstenhaldan/minisite/supabase/functions/_shared/email-router.ts` lines 51-96):

```typescript
export type EmailTemplate =
  | 'welcome' | 'receipt' | 'password_reset' | 'marketing_announcement'
  | 'nps_quarterly'
  | 'clinic_notification' | 'dose_alert' | 'doctor_share' | 'patient_access_log_notification'
  | 'csat_followup' | 'helpdesk_agent_reply' | 'sla_breach_alert' | 'helpdesk_unknown_sender';

export type SendEmailArgs = {
  template: EmailTemplate;
  to: string;
  vars: Record<string, unknown>;
  phi: boolean;   // SINGLE PHI switch — caller authoritative (PHI=true → SES, false → Resend)
};

export async function sendEmail(args: SendEmailArgs): Promise<SendEmailResult>;
```

**Phase 40 EXTENSION (Plan 40-02 owns the union widening):**

Add to `EmailTemplate` union: `'pause_reminder_t7' | 'pause_resumed_t0' | 'cancellation_complete_feedback'`.

**Copy patterns:**

- **Union extension + subjectFor + renderTemplate switch arms MUST land in the SAME commit.** Per memory `feedback_planner_missed_status_enum_widening` + the inline comment at email-router.ts lines 66-74 (Phase 37 lesson). Otherwise callers reference a value the router's `default` case routes to a generic subject + body → silent misroute.
- **PHI flag for Phase 40 emails:** `pause_reminder_t7` → `phi: false` (Resend) for consumer subs; `phi: true` (SES) for clinic-org subs per D-09. **Caller is authoritative** — `pause-reminder-fire` reads `subscription.clinic_id IS NOT NULL` and passes the boolean.
- **Subject + template rendering** — add cases at lines 138 (subjectFor) and 171 (renderTemplate). Templates live in `_shared/email-templates/`; mirror `nps-quarterly` precedent (Phase 42-07).

**Project-specific gotcha:**
- A9 (assumption): VERIFIED — signature is `{ template, to, vars, phi }` not the `{ template_name, recipient, props, phi_flag }` shape CONTEXT hinted. Plan 40-02 author must use the verified shape.
- Recipient email is SHA-256-hashed in logs (helper at lines 128-133). Never log raw `to`. Per T-25-03-I1.
- BAA suppression + Resend domain health check exist in `_shared/aws-ses-health-check.ts` + `_shared/resend-domain-health-check.ts` — sendEmail returns `{ skipped: true }` if vendor unhealthy. Treat skipped as success; do NOT retry.

---

### 9. `CancellationModal.tsx` single-chunk constraint (Plan 40-04)

**Closest analog (lazy chunk single-component modals):**
- `/Users/karstenhaldan/minisite/leanshot/src/components/changelog/WhatsNewDrawer.tsx` — registered in App.tsx line 135-137 as `WhatsNewDrawerHost = lazy(() => import('@/components/changelog/WhatsNewDrawer'))` and rendered at line 1877 conditionally on a state flag.
- `/Users/karstenhaldan/minisite/leanshot/src/components/nps/QuarterlyNPSModal.tsx` — App.tsx line 146-149 → renders 1884.
- `/Users/karstenhaldan/minisite/leanshot/src/components/dashboard/settings/DeleteAccountModal.tsx` (file pattern; not lazy because settings page is already lazy).

**Copy pattern (App.tsx lazy-modal registration):**

```typescript
// leanshot/src/App.tsx — add near line 146 (NPS lazy block)
const CancellationModalLazy = lazy(() =>
  import('@/components/dashboard/settings/cancellation/CancellationModal').then((m) => ({
    default: m.CancellationModal,
  })),
);

// Conditional render in the SettingsPage-spawned modal slot:
{cancellationOpen && (
  <CancellationModalLazy onClose={() => setCancellationOpen(false)} />
)}
```

**Internal structure (single chunk = single file tree resolved to ONE Vite chunk):**

- `CancellationModal.tsx` — outer wrapper, holds 3-step state machine `step: 1 | 2 | 3`.
- `steps/ReasonPicklistStep.tsx`, `steps/OfferStep.tsx`, `steps/LossSummaryStep.tsx` — **non-lazy imports** from inside `CancellationModal.tsx`. Vite chunks the directory tree as one because the entry is the outer Modal.
- `OfferCard.tsx`, `PauseControls.tsx` — same chunk.
- **DO NOT** use react-router or split into 3 routes. Per RESEARCH §Pitfall 8.

**Modal primitive:**

- `@/components/ui/Modal` (Phase 9 era, lines 60-62: `role="dialog" + aria-modal="true"`). Mirror DeleteAccountModal.tsx import pattern (line 43: `import { Modal } from '@/components/ui/Modal';`).
- Per CLAUDE.md AccessibilityConventions: `aria-label` required on icon-only buttons, `aria-busy` on the accept button while in-flight.

**Bundle ceiling (Plan 40-04 + 40-05):**

- `scripts/assert-bundle-budget.sh` table-driven config (lines 43-50). Add entries:
  ```
  "cancellation       13 D-17 three-step modal — single lazy chunk; if regressed move offer-card animation to sync-defer.ts. Plan 40-04 baseline."
  "admin-cancellation 10 Plan 40-05 admin module (rules editor + ROI tab). If regressed, lazy-split CancellationRoiTab from CancellationRulesTab."
  ```
- Per memory `feedback_executor_tdd_scaffolds_sibling_files` — both plans 40-04 and 40-05 modify the same `assert-bundle-budget.sh`; expect merge-time integration. Coordinate via STATE.md wave gates.
- Per memory `reference_bundle_budget_hash_hyphen` — fixed in Plan 10-11; safe to use hyphenated chunk names.

**Project-specific gotcha:**
- Per memory `feedback_executor_tdd_scaffolds_sibling_files`: parallel TDD executors will scaffold cross-plan dependency files. `src/types/cancellation.ts` (the `OfferConfig` + `OfferType` types) MUST be owned by ONE plan (40-04 or 40-03) — pick 40-04 and have 40-03 import from there.
- App.tsx is the single shared file ALL lazy modal registrations touch. Per `feedback_planner_iter1_anti_patterns` no-shared-file-choreography: 40-04 owns the App.tsx edit (one writer). 40-05's admin module entry lives in `lib/admin/modules.ts` (different file — no conflict).

---

### 10. Admin Save-Offer Rule Editor module (Plan 40-05)

**Analog (EXACT):** `/Users/karstenhaldan/minisite/leanshot/src/components/admin/gamification/AdminGamificationModule.tsx`. Three-subsection admin module with role-gated read + role-gated write actions. Mirrors what 40-05 needs (CancellationRulesTab + CancellationRoiTab + RuleEditor subforms).

**Copy patterns:**

- **Admin module shell** (AdminGamificationModule.tsx lines 32-95):
  ```typescript
  import { Suspense, lazy, useEffect, useState } from 'react';
  import { supabase } from '@/lib/supabase';
  import { hasMinRole, type AdminRole } from '@/lib/admin/roles';

  const CancellationRulesTab = lazy(() => import('./CancellationRulesTab'));
  const CancellationRoiTab = lazy(() => import('./CancellationRoiTab'));

  type Subsection = 'rules' | 'roi';

  export default function CancellationModule() {
    const [adminRole, setAdminRole] = useState<AdminRole | null>(null);
    // ... copy fetch+gate pattern from gamification lines 38-72 verbatim ...
    if (!hasMinRole(adminRole, 'admin')) { return <NoAccess />; }
    return ( /* tab nav + Suspense + selected tab */ );
  }
  ```
- **Manifest registration** (`leanshot/src/lib/admin/modules.ts` lines 82-94 — copy the `users` entry as template):
  ```typescript
  {
    key: 'cancellation',
    label: 'Cancellation',
    route: 'cancellation',
    icon: HeartCrackIcon,  // pick a lucide-react icon; HeartCrack or LogOut
    lazy: () =>
      import('@/components/admin/cancellation/CancellationModule').then((m) => ({
        default: m.default,
      })),
    flagKey: 'admin.cancellation.enabled',
    minRole: 'admin' as AdminRole,
  },
  ```
- **surfaceCheck (CLIENT HINT only)** — `leanshot/src/lib/org.ts` line 130. Per the comment at line 20-22: surfaceCheck is a UX affordance hint; the actual gate is the DB SECDEF role check. Don't rely on surfaceCheck for security — only for hiding/showing UI. Phase 40 admin UI buttons use `surfaceCheck('admin.cancellation.write_rules')` to hide edit-buttons; server SECDEF RPCs enforce.

**Project-specific gotcha:**
- Per memory `feedback_admin_module_manifest_vs_router_branch_drift`: switch-based SPA router + parallel module manifest silently drift. Phase 27 caught 6 pre-existing broken admin routes. Verify the URL-prefix catchall in `AdminLayout.tsx` correctly resolves `/admin/cancellation` to the new module. If AdminLayout uses a hardcoded switch on `route` keys, the new entry needs to be added to BOTH the manifest AND the switch — flag during plan-check.
- **`hasMinRole` source-of-truth:** `leanshot/src/lib/admin/roles.ts`. Roles ladder: `staff` < `support_admin` < `admin` < `superadmin`. Plan 40-05 rules-create gated at `admin`; rules-archive at `superadmin` (mirrors cohort_set_status pattern).

---

### 11. ROI Dashboard view + CSV export (Plan 40-06)

**Analog (chart):** `/Users/karstenhaldan/minisite/leanshot/src/components/admin/AdminMetricsMrrChart.tsx` — EXACT match: BaseChart wrapper, stacked bars + line overlay, theme-aware via `var(--color-*)` CSS variables, `useMemo<ChartConfiguration>` shape.

**Analog (CSV export Fn):** `/Users/karstenhaldan/minisite/supabase/functions/bulk-csv-export/` (existing CSV stream Edge Fn — auth + admin-role check + streaming response).

**Copy patterns:**

- **BaseChart wrapper** (AdminMetricsMrrChart.tsx lines 22-95):
  ```typescript
  const config = useMemo<ChartConfiguration>(() => ({
    type: 'bar',
    data: {
      labels: series.map((b) => b.bucket),
      datasets: [
        { label: 'Offered', type: 'bar', data: ..., backgroundColor: 'var(--color-surface-elevated)', stack: 'offers', yAxisID: 'y' },
        { label: 'Accepted', type: 'bar', data: ..., backgroundColor: 'var(--color-primary)', stack: 'offers', yAxisID: 'y' },
        { label: 'Take-rate %', type: 'line', data: ..., borderColor: 'var(--color-success)', yAxisID: 'y1', tension: 0.25 },
      ],
    },
    options: { ... },
  }), [series]);
  return <BaseChart config={config} />;
  ```
- **ROI view migration** (RESEARCH lines 927-950):
  ```sql
  create or replace view public.v_cancellation_offers_roi as
  select
    date_trunc('day', offered_at) as offered_day,
    offer_type, cohort_snapshot->>'cohort_id' as cohort_id, tenure_bucket,
    count(*) filter (where status='offered')  as shown_count,
    count(*) filter (where status='accepted') as accepted_count,
    count(*) filter (where status='declined') as declined_count,
    sum(case when status='accepted' and offer_type in ('discount','pause','extended_trial')
             then coalesce((offer_config->>'percent_off')::numeric, 0) * 12.99
             else 0 end) as deferred_mrr_cents_est
  from public.cancellation_offers_log
  group by 1, 2, 3, 4;
  ```
- **CSV Fn auth + stream** (mirror bulk-csv-export/index.ts):
  - JWT bearer check + `hasMinRole(role, 'admin')` server-side.
  - Response: `Content-Type: text/csv; charset=utf-8` + `Content-Disposition: attachment; filename="cancellation-roi-<yyyymmdd>.csv"`.
  - Stream rows via `Response(ReadableStream)` to avoid loading all into memory.

**Project-specific gotcha:**
- Plain SQL view is FINE for v1.3 (≤500 rows/mo per RESEARCH §ROI). Document the matview migration trigger at p95 > 500ms OR rowcount > 10k. Per memory `reference_supabase_pg_cron_vault_service_role_pattern` matview refresh would use the same cron+vault pattern.
- View inherits base-table RLS (Postgres semantics) — view selection requires the caller to satisfy `cancellation_offers_log_select_admin` policy. SECDEF view wrapper NOT needed.
- BaseChart at `leanshot/src/components/dashboard/charts/BaseChart.tsx` registers `...registerables` at module load — already bundled in `vendor-charts` manualChunk. Importing BaseChart in the admin module does NOT inflate the admin chunk.

---

### 12. Subscriptions table ALTER (paused_until + is_paused + reminded_t7) (Plan 40-02)

**Analog:** `/Users/karstenhaldan/minisite/supabase/migrations/20270101000003_subscriptions_provider_guard.sql` — existing ALTER on `subscriptions`. Original table at `20260601000019_stripe_subscriptions.sql` lines 51-68.

**Copy pattern:**

```sql
-- 202707NN1MM_p40_subscriptions_pause_cols.sql
alter table public.subscriptions
  add column if not exists paused_until timestamptz,
  add column if not exists is_paused boolean not null default false,
  add column if not exists reminded_t7 boolean not null default false;

create index if not exists idx_subscriptions_paused_t7
  on public.subscriptions(paused_until)
  where is_paused = true and reminded_t7 = false;
```

**Project-specific gotcha (A8):**
- **Grep for concurrent ALTERs at execute-time.** `grep -rn 'alter table public.subscriptions' supabase/migrations/` currently shows 3 prior migrations (20260601000019 base, 20270101000003 provider_guard, 20270601200001 P29 reconcile). Confirm no Phase 38/41 work touches the same table at merge time. Per memory `feedback_wave_n_push_correction_invalidates_wave_n_plus_1_plans` + `reference_migration_timestamp_collision_precheck`.
- **Partial index predicates MUST be IMMUTABLE.** `where is_paused = true and reminded_t7 = false` is column-only, IMMUTABLE-safe. Per `reference_supabase_migration_gotchas` Pitfall 1.
- **`subscriptions.id` is TEXT (Stripe `sub_*` ID), not UUID** (line 52 of 20260601000019). Foreign keys from `cancellation_offers_log.subscription_id` must use `text`.

---

### 13. Status enum widening (cancellation_offers_log.status + save_offer_rules.offer_type) (Plan 40-01)

**Pattern (NEW — applies project-wide rule, no single analog):** Per memory `feedback_planner_missed_status_enum_widening` AND `feedback_planner_iter1_anti_patterns` AND Phase 37 lesson:

**Rule: Ship the CHECK with ALL values at table creation. NEVER widen later.**

```sql
-- In the SAME migration that CREATEs cancellation_offers_log:
status text not null default 'offered' check (status in (
  'offered',                       -- decide-Fn insert
  'accepted',                      -- accept-Fn update (or 2nd-row append per pattern 6 above)
  'declined',                      -- decline-Fn / Step 3 cancel
  'expired',                       -- never-took within session (future cron sweep)
  'ineligible_lifetime_cap',       -- D-02 2-take cap
  'ineligible_cooldown'            -- D-03 12mo cooldown
));

-- In the SAME migration that CREATEs save_offer_rules:
offer_type text not null check (offer_type in (
  'pause',
  'discount',
  'extended_trial',
  'downgrade',
  'contact_csm',                   -- D-04 clinic-org fork
  'none'                           -- no rule matched / dry-run audit row
));
```

**If later phases need a 7th value:** Ship that value's CHECK widening in its OWN migration BEFORE the migration that first INSERTs the value. Two separate transactions. Plan-checker should grep for any cross-migration CHECK + USE collision.

**Per RESEARCH §Pitfall 3:** Single migration that BOTH widens CHECK and INSERTs the new value can fail with `23514` (check_violation). Postgres has special-cased table-rewriting ALTERs, but the safe path is always: enum-widen migration → next-migration uses the new value.

**Project-specific gotcha:**
- Plan 40-01 ships ALL six status values + ALL six offer_type values at table-creation time. Phase 40 plans 40-03..40-06 only USE values — never widen. Per Phase 37-09 enum-gap carryover lesson (D-37-09-1).
- `reason` column is also CHECK-constrained (`'too_expensive' | 'not_using' | 'found_alternative' | 'health_goals_changed' | 'temporary_break' | 'service_quality_issue' | 'other'`) per D-18 — same rule applies.

---

### 14. `cancellation-feedback-to-ticket` Edge Fn → P37 ticket-create (Plan 40-04)

**Analog (RPC to call):** `/Users/karstenhaldan/minisite/supabase/migrations/20270707000009_helpdesk_create_ticket_rpc.sql` — `public.create_ticket_with_first_message(p_subject, p_body, p_priority)` SECDEF RPC. Signature returns `uuid` ticket_id. Auth: caller MUST be authenticated (uses `auth.uid()` line 21).

**Analog (caller Fn pattern):** `/Users/karstenhaldan/minisite/supabase/functions/helpdesk-inbound/index.ts` lines 400-410 (existing `tickets` insert path) — but that's service-role direct-table. The RPC at `create_ticket_with_first_message` is the user-context path.

**Copy patterns:**

```typescript
// supabase/functions/cancellation-feedback-to-ticket/index.ts
import { createClient } from 'npm:@supabase/supabase-js@2';

Deno.serve(async (req) => {
  // 1. Require authenticated user (NOT service-role) — RPC reads auth.uid()
  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) return jsonError(401, 'unauthenticated');

  const userJwt = authHeader.slice(7);
  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${userJwt}` } },
  });

  const { reason, reason_other_text, sentiment_score } = await req.json();
  if (reason !== 'service_quality_issue') return jsonError(400, 'wrong_reason');

  // 2. Call SECDEF RPC with user context — auth.uid() resolves correctly
  const { data: ticketId, error } = await userClient.rpc('create_ticket_with_first_message', {
    p_subject: 'Feedback from cancellation: service quality issue',
    p_body: reason_other_text ?? 'User cited service quality issue at cancellation. No additional detail.',
    p_priority: 'p3',
  });
  if (error) return jsonError(500, 'rpc_failed');

  // 3. Tag the ticket — separate UPDATE (RPC doesn't accept tags param in v1.3 signature)
  await userClient.from('tickets')
    .update({ tags: ['cancellation-feedback'] })
    .eq('id', ticketId);

  return jsonResponse(200, { ticket_id: ticketId });
});
```

**Project-specific gotcha:**
- **MUST use user JWT, NOT service-role.** Per `feedback_rpc_auth_uid_vs_service_role_mismatch` + RESEARCH §Pitfall 4 — `create_ticket_with_first_message` references `auth.uid()` (line 21 of the RPC migration), `primary_org_id` lookup (line 41), and `org_members.role` derivation (lines 48-53). Service-role call gets `auth.uid() = null` → `raise exception 'unauthenticated'`. Forward the user JWT from the modal's `supabase.auth.getSession().access_token`.
- **PHI flag is server-derived** (RPC lines 47-54). For consumer users (no clinic org_members row) → `phi=false` → Resend. For clinic-org users → `phi=true` → SES. Phase 40 doesn't pass `phi` — RPC owns.
- **Subject length ≤ 200 chars** (RPC line 30). Truncate `reason_other_text` if needed.
- **Sentiment tagging** per P37 D-10: tag list `['cancellation-feedback', 'sentiment:negative']` — sentiment scoring happens client-side via existing `helpdesk-ai-assist` Fn OR is hardcoded `negative` for service_quality_issue. Planner picks; simpler = hardcoded negative.

---

## Shared Patterns

### Stripe SDK init + version pin
**Source:** `/Users/karstenhaldan/minisite/supabase/functions/stripe-webhook/index.ts` lines 28, 62-66.
**Apply to:** All Phase 40 Edge Fns calling Stripe (40-03 decide, accept; 40-01 coupon-seed).
```typescript
import Stripe from 'https://esm.sh/stripe@19?target=denonext';
const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, {
  apiVersion: '2026-04-22.dahlia' as Stripe.LatestApiVersion,
});
```

### Service-role admin client + lazy init
**Source:** `/Users/karstenhaldan/minisite/supabase/functions/_shared/lifecycle-utils.ts` (`makeLazyAdmin()`) + `challenge-evaluate-cron/index.ts` line 26.
**Apply to:** 40-02 `pause-reminder-fire`, 40-03 `cancellation-decide-offer`/`cancellation-accept-offer`, 40-04 `cancellation-feedback-to-ticket` (where service-role NOT user-JWT), 40-06 `download-cancellation-roi-csv`.
```typescript
import { checkServiceRoleBearer, makeLazyAdmin, jsonError, jsonResponse, corsHeaders } from '../_shared/lifecycle-utils.ts';
const { admin, setAdminForTest, resetAdminForTest } = makeLazyAdmin();
```

### PostHog flush in finally
**Source:** `/Users/karstenhaldan/minisite/supabase/functions/stripe-webhook/index.ts` lines 244, 317-322.
**Apply to:** Any Phase 40 Edge Fn that calls `captureServer(...)` for analytics.
```typescript
try { /* main logic with captureServer(...) */ }
finally { await shutdownPostHog(); }
```

### Sentry breadcrumbs + error capture
**Source:** `/Users/karstenhaldan/minisite/supabase/functions/_shared/sentry.ts` (imported in `subscription-updated.ts` line 15).
**Apply to:** All Phase 40 Edge Fns. PII safety: log `err.message` only, NEVER `event.data.object` or stripe payload (T-14-03-I1).

### CORS + response envelope
**Source:** `supabase/functions/stripe-webhook/cors.ts` (`BASE_RESPONSE_HEADERS`) + `_shared/lifecycle-utils.ts` (`corsHeaders, jsonError, jsonResponse`).
**Apply to:** All Phase 40 Edge Fns. Always `Cache-Control: private, no-store` on user-data responses.

### Admin role gate
**Source:** `/Users/karstenhaldan/minisite/leanshot/src/lib/admin/roles.ts` (`hasMinRole`) + `AdminGamificationModule.tsx` lines 38-72.
**Apply to:** 40-05 admin module wrapper, 40-06 ROI CSV Fn.

### Lazy modal registration in App.tsx
**Source:** `/Users/karstenhaldan/minisite/leanshot/src/App.tsx` lines 135-149 (`WhatsNewDrawerHost`, `QuarterlyNPSModalLazy`).
**Apply to:** 40-04 `CancellationModalLazy`. ONE writer to App.tsx (Plan 40-04 owns).

### Append-only ledger triggers
**Source:** `/Users/karstenhaldan/minisite/supabase/migrations/20270708000001_p35_xp_ledger.sql` lines 80-106.
**Apply to:** 40-01 `cancellation_offers_log`. Defense-in-depth `_p40_cancellation_offers_log_block_update` + `_block_delete` triggers. NOTE per §6 above: if the planner picks 2-row append pattern (decide row + accept row), triggers block ALL updates; if picks single-row status-machine, triggers must carve out status-field updates. Recommend 2-row pattern.

### SECDEF RPC preamble
**Source:** `/Users/karstenhaldan/minisite/supabase/migrations/20270602000012_cohort_rpcs.sql` lines 144-194.
**Apply to:** 40-05 `save_offer_rule_create`, `save_offer_rule_update`, `save_offer_rule_archive`, `save_offer_rule_activate`. Always:
- `language plpgsql security definer set search_path = public, extensions, pg_catalog`
- `auth.uid()` null-check (errcode `28000`)
- `is_admin_at_least('admin')` or `'superadmin'` for destructive (errcode `42501`)
- `set_config('app.suppress_audit', 'on', true)` + `log_admin_action(...)`
- `revoke all from public; grant execute to authenticated;`

### pg_cron + vault + named dollar quotes
**Source:** `/Users/karstenhaldan/minisite/supabase/migrations/20270708000021_p35_challenge_evaluate_cron.sql`.
**Apply to:** 40-02 pause-reminder cron. Named tags `$cron$`, `$invoke$`, `$unschedule$`. NEVER bare `$$`. Pre-flight idempotent unschedule. Hardcoded URL + vault.decrypted_secrets.

### TS types one-writer rule
**Source:** `/Users/karstenhaldan/minisite/leanshot/src/types/index.ts` (barrel export pattern).
**Apply to:** `src/types/cancellation.ts` — owned by 40-04. Re-export from `src/types/index.ts`. Plans 40-03, 40-05, 40-06 import from `@/types/cancellation`. Per `feedback_planner_iter1_anti_patterns` no-shared-file-choreography.

### Worktree commit safety
**Source:** memory `feedback_worktree_executor_pwd_drift_leaks_to_main` (validated W2 Phase 25).
**Apply to:** ALL Phase 40 plans. Per-commit `git rev-parse --show-toplevel` guard. Especially relevant for migration push tasks that may `cd` to primary checkout.

---

## No-Analog Cases (planner uses RESEARCH-provided patterns)

| File | Role | Reason | Use Instead |
|------|------|--------|-------------|
| `cancellation-seed-coupons` (one-shot Stripe API seed) | seed migration / Edge Fn | No prior in-repo Stripe-API-driven seed migration; Phase 26 affiliate coupons were created via Stripe Dashboard | RESEARCH §"Stripe coupon catalog seed" lines 786-818 — verbatim; uses `idempotencyKey: 'seed-<id>-v1'` + catches `resource_already_exists` |
| `cancellation-decide-offer` resolve-rule.ts (cohort × tenure × reason × priority) | service helper | Novel composition — no in-repo rule-resolver matches the cohort+tenure+reason 4-key composite priority pattern | RESEARCH §"Decide-offer Edge Fn skeleton" lines 850-925; query `save_offer_rules` ORDER BY priority ASC LIMIT 1 with all filters as AND-conditions; null filters mean "match any" |
| `anti-gaming.ts` D-15 stacking clamp | pure-fn TypeScript | Math formula is novel | RESEARCH lines 591-611 (`clampSavePct`); 15 lines; unit-testable in isolation |
| `OfferCard.tsx` 4-variant offer-type render | React component | No prior 4-variant offer card; closest is `HeroCard` (single-variant) | UI-SPEC 40-UI-SPEC.md Surface 1 Step 2 — copy contract + variant matrix already specced |

---

## Cross-Phase Coordination Concerns

Per memory `feedback_chunked_planning_integration_seam_blindspot`: chunked plans miss connective seams nobody owns. Phase 40 seams:

1. **`subscriptions` table schema** — 40-02 ALTERs (paused_until + is_paused + reminded_t7). A8 risk: Phase 38 or 41 may concurrently ALTER. Pre-merge grep at execute time.
2. **`stripe-webhook/events/subscription-updated.ts`** — 40-02 EXTENDS. If Phase 41 also extends (e.g., new metadata field), merge conflict in handler body. Worktree wave gate: 40-02 lands before any other phase touching this file.
3. **`leanshot/src/App.tsx`** — 40-04 adds one lazy modal block. If Phase 41/42 also add lazy modals concurrently, conflicting line-range edits. Wave gate: 40-04 lands serially.
4. **`leanshot/src/lib/admin/modules.ts`** — 40-05 adds one entry. Same risk as above. Wave gate.
5. **`_shared/email-router.ts`** EmailTemplate union — 40-02 widens. If Phase 41/42 also widen the same union, merge conflict (likely auto-resolvable since each phase appends; verify subjectFor + renderTemplate switch arms don't collide).
6. **`scripts/assert-bundle-budget.sh`** — 40-04 + 40-05 BOTH add entries. Same plan-cluster wave (Wave 2/3) but different `CHUNK_CONFIG` array indices; alphabetized — `admin-cancellation` before `cancellation` before `course-player`. Each plan inserts at its alphabetical position.
7. **`src/types/cancellation.ts`** — single writer (Plan 40-04). Plans 40-03/40-05/40-06 import only.
8. **PostHog flag keys** — `admin.cancellation.enabled`, `admin.cancellation.write_rules`, save-offer A/B variant flags from D-22. Need creation in PostHog dashboard pre-merge (HUMAN-UAT or via PostHog API).

---

## Metadata

**Analog search scope:**
- `supabase/migrations/` — 250+ files scanned, 6 direct analogs cited.
- `supabase/functions/` — 70+ Edge Fns scanned, 8 direct analogs cited.
- `leanshot/src/components/admin/` — full module tree; 2 direct analogs cited (gamification, cohort).
- `leanshot/src/lib/admin/` — modules.ts manifest pattern verified inline.

**Files read in extraction (no re-reads):**
- 40-CONTEXT.md (lines 1-202)
- 40-RESEARCH.md (lines 218-560, 780-1100, 1099-1267 — three non-overlapping windows)
- 40-UI-SPEC.md (section headers only; per-surface detail already in UI-SPEC consumed by 40-04)
- `supabase/functions/stripe-webhook/index.ts` (full — 333 lines)
- `supabase/functions/stripe-webhook/events/subscription-updated.ts` (lines 1-100)
- `supabase/functions/_shared/email-router.ts` (lines 51-150 + grep for signature)
- `supabase/functions/challenge-evaluate-cron/index.ts` (lines 1-80)
- `supabase/migrations/20270708000001_p35_xp_ledger.sql` (lines 1-120)
- `supabase/migrations/20270708000021_p35_challenge_evaluate_cron.sql` (full)
- `supabase/migrations/20260601000019_stripe_subscriptions.sql` (lines 1-80)
- `supabase/migrations/20270707000009_helpdesk_create_ticket_rpc.sql` (full)
- `supabase/migrations/20270602000012_cohort_rpcs.sql` (lines 130-230)
- `leanshot/src/components/admin/gamification/AdminGamificationModule.tsx` (lines 1-90)
- `leanshot/src/components/admin/cohort/CohortsPage.tsx` (lines 1-40)
- `leanshot/src/components/admin/AdminMetricsMrrChart.tsx` (lines 1-80)
- `leanshot/src/lib/admin/modules.ts` (lines 1-100)
- `leanshot/src/lib/org.ts` (lines 115-175 — surfaceCheck)
- `leanshot/src/App.tsx` (grep — lazy modal pattern)
- `leanshot/scripts/assert-bundle-budget.sh` (lines 1-50)

**Pattern extraction date:** 2026-05-21

---

## PATTERN MAPPING COMPLETE

**Phase:** 40 — Cancellation Save-Offers Flow
**Files classified:** 20 new/modified artifacts across 6 plans
**Analogs found:** 19 / 20 (1 NEW pattern — Stripe coupon seed — has clear RESEARCH-spec to follow)

### Coverage
- Files with EXACT analog: 11
- Files with role-match analog: 7
- Files self-extending: 3 (subscription-updated.ts, modules.ts, App.tsx, analytics/events.ts)
- Files with no analog (RESEARCH-spec only): 4 (coupon-seed Fn, resolve-rule.ts, anti-gaming.ts, OfferCard 4-variant)

### Key Patterns Identified
- Append-only ledger uses negative-space RLS + defense-in-depth UPDATE/DELETE triggers (xp_ledger template).
- All Edge Fns calling Stripe pin `apiVersion: '2026-04-22.dahlia'` and import via `https://esm.sh/stripe@19?target=denonext`.
- pg_cron + vault.decrypted_secrets is the ONLY service-role-key path in cron context (P35 template).
- Admin modules follow `ADMIN_MODULES` manifest entry + module-scoped lazy children + `hasMinRole` server-verified gate (gamification template).
- SECDEF RPCs ALWAYS preamble `language plpgsql security definer set search_path = public, extensions, pg_catalog` + `auth.uid()` null-check + `is_admin_at_least(...)` + `set_config('app.suppress_audit')` + `log_admin_action` (cohort template).
- Stripe webhook handler EXTENDS existing arms in-place (P26 26-07 lesson). No new case arms for events that never fire.
- Status enums declare ALL values at table creation; widening migrations are separate-tx, lessons-of-record from Phase 37.
- Worktree commits are guarded by `git rev-parse --show-toplevel` per Phase 25 W2 validation.

### Files Created
`/Users/karstenhaldan/minisite/leanshot/.planning/phases/40-cancellation-save-offers-flow/40-PATTERNS.md`

### Ready for Planning
Planner can now reference these analog patterns in each PLAN.md's `<action>` sections by absolute path + line range. All cross-cutting concerns (shared patterns, integration seams, coordination wave-gates) are explicit above so the planner does not need to re-derive them per plan.
