---
phase: 16-capacitor-mobile-shells-ios-android
plan: 06
type: execute
wave: 2
depends_on: ["16-00-vendor-checkpoints-wave-0-harness"]
files_modified:
  - supabase/migrations/20270101000001_rc_subscriptions_provider.sql
  - supabase/migrations/20270101000002_tier_effective_view.sql
  - supabase/functions/revenuecat-webhook/index.ts
  - supabase/functions/revenuecat-webhook/index.test.ts
  - supabase/functions/revenuecat-webhook/cors.ts
  - supabase/functions/revenuecat-webhook/deno.json
  - supabase/config.toml
autonomous: true
requirements: [MONEY-06]
user_setup:
  - service: supabase-function-secret
    why: "RevenueCat webhook bearer + HMAC secret + service role for server-to-server upserts"
    env_vars:
      - name: REVENUECAT_WEBHOOK_AUTH
        source: "RevenueCat Dashboard → Project → Integrations → Webhooks → Authorization Header (set as 'Bearer <token>' on RC side; store the bare token on Supabase). Set via: supabase secrets set REVENUECAT_WEBHOOK_AUTH=<token> --project-ref ytnsipxxmzgaebkqmokp"
    dashboard_config:
      - task: "Register webhook URL in RevenueCat → Integrations → Webhooks: https://ytnsipxxmzgaebkqmokp.supabase.co/functions/v1/revenuecat-webhook"
        location: "RevenueCat Dashboard"

must_haves:
  truths:
    - "A RevenueCat INITIAL_PURCHASE webhook for user X writes a row to subscriptions with provider='revenuecat' and ux_tier reflecting the purchased entitlement"
    - "A RevenueCat CANCELLATION or EXPIRATION webhook for an active iOS subscriber sets current_period_end = now() (immediate downgrade per D-04 — deliberate asymmetry vs Stripe)"
    - "A replay of the same RC event_id returns 200 { duplicate: true } without re-writing subscriptions (idempotency)"
    - "An unsigned/unauthorized request to revenuecat-webhook returns 401 with Cache-Control: private, no-store and writes nothing"
    - "Selecting tier_effective for a user with active Stripe + cancelled RC returns tier='paid' (MAX(current_period_end) wins per D-02)"
    - "Selecting tier_effective for a user with cancelled Stripe + active RC returns tier='paid'"
    - "Selecting tier_effective for a user with both providers expired returns tier='free'"
    - "supabase functions deploy revenuecat-webhook succeeds (no bare-import bundle errors per reference_supabase_edge_function_deploy)"
  artifacts:
    - path: "supabase/migrations/20270101000001_rc_subscriptions_provider.sql"
      provides: "Idempotent provider-column reassertion + subscription_events.provider column + partial unique index on subscriptions(user_id, provider) for RC upserts"
      contains: "ADD COLUMN IF NOT EXISTS"
    - path: "supabase/migrations/20270101000002_tier_effective_view.sql"
      provides: "tier_effective view computing MAX(current_period_end) per user across providers"
      contains: "CREATE OR REPLACE VIEW public.tier_effective"
    - path: "supabase/functions/revenuecat-webhook/index.ts"
      provides: "HMAC-SHA256 verify + idempotent insert into subscription_events + dispatcher for 6 RC event types"
      exports: ["__internal"]
    - path: "supabase/functions/revenuecat-webhook/index.test.ts"
      provides: "Deno tests covering auth gate, HMAC verify, dispatcher dispatch table, D-04 immediate-downgrade math, idempotency"
    - path: "supabase/functions/revenuecat-webhook/cors.ts"
      provides: "BASE_RESPONSE_HEADERS with Content-Type: application/json + Cache-Control: private, no-store (mirrors stripe-webhook/cors.ts)"
    - path: "supabase/functions/revenuecat-webhook/deno.json"
      provides: "Deno task config + lint rules (mirrors stripe-webhook/deno.json)"
  key_links:
    - from: "supabase/functions/revenuecat-webhook/index.ts"
      to: "supabase/migrations/20270101000001_rc_subscriptions_provider.sql"
      via: "admin.from('subscriptions').upsert({...}, { onConflict: 'user_id,provider' })"
      pattern: "onConflict:\\s*['\"]user_id,provider['\"]"
    - from: "supabase/functions/revenuecat-webhook/index.ts"
      to: "subscription_events table"
      via: "admin.from('subscription_events').insert({ event_id, event_type, payload, provider: 'revenuecat' })"
      pattern: "provider:\\s*['\"]revenuecat['\"]"
    - from: "supabase/migrations/20270101000002_tier_effective_view.sql"
      to: "public.subscriptions"
      via: "SELECT user_id, MAX(current_period_end) FROM subscriptions GROUP BY user_id"
      pattern: "MAX\\(current_period_end\\)"
---

<objective>
Ship the **server half of MONEY-06**: a new `revenuecat-webhook` Edge Function that mirrors the existing `stripe-webhook` (Phase 14) pattern exactly — raw-body HMAC-SHA256 verification via Deno `crypto.subtle`, idempotent event ingestion via `subscription_events.event_id` PK, JSON-only responses with `Cache-Control: private, no-store`, and a 6-event dispatcher — paired with two migrations that (a) extend `subscription_events` with a `provider` discriminator and add a partial unique index on `subscriptions(user_id, provider)` so RC events can be safely upserted, and (b) create a `tier_effective` view computing per-user effective tier as `MAX(current_period_end) > now()` across providers (D-02).

The CANCELLATION + EXPIRATION handlers implement **immediate downgrade** (`current_period_end = now()`) per D-04 — a deliberate, documented asymmetry vs Stripe's grace-period behavior. Matches Apple's native subscription UX; researcher flagged this as a permanent platform-shape choice, NOT a bug to normalize.

Purpose: Without this Edge Function + view, the iOS RevenueCat purchase in Plan 16-05 has nowhere to land — the client SDK reports `customerInfo.entitlements.active.plus` locally, but cross-device tier sync (D-25, Realtime channel installed by 16-05) requires the DB row write. This plan closes that loop.

Output: One Edge Function (deployable via `supabase functions deploy revenuecat-webhook`), two migrations (`supabase db push --linked`), and a Deno test suite that runs in CI (`mobile.yml` lint+test job from 16-09; until 16-09 lands, run locally via `cd supabase/functions/revenuecat-webhook && deno task test`).
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/STATE.md
@.planning/phases/16-capacitor-mobile-shells-ios-android/16-CONTEXT.md
@.planning/phases/16-capacitor-mobile-shells-ios-android/16-RESEARCH.md
@.planning/phases/16-capacitor-mobile-shells-ios-android/16-PATTERNS.md

# Phase 14 stripe-webhook — the exact analog to mirror (read FIRST)
@../supabase/functions/stripe-webhook/index.ts
@../supabase/functions/stripe-webhook/index.test.ts
@../supabase/functions/stripe-webhook/cors.ts
@../supabase/functions/stripe-webhook/deno.json
@../supabase/migrations/20260601000019_stripe_subscriptions.sql

<interfaces>
<!-- Existing schema (Phase 14, 20260601000019_stripe_subscriptions.sql) the webhook writes to. -->
<!-- Executor MUST upsert against these EXACT column names — do not invent new columns. -->

table public.subscriptions:
  id                     text PRIMARY KEY           -- Stripe sub_xxx OR for RC: 'rc:' || event.app_user_id || ':' || event.product_id
  provider               text NOT NULL DEFAULT 'stripe'  -- CHECK in ('stripe','revenuecat') — ALREADY EXISTS
  user_id                uuid REFERENCES auth.users(id) ON DELETE CASCADE
  clinic_id              uuid REFERENCES public.orgs(id) ON DELETE CASCADE
  stripe_customer_id     text                       -- NULL for RC rows
  status                 text NOT NULL              -- 'active' | 'cancelled' | 'past_due' | RC event.type string
  ux_tier                text NOT NULL CHECK (ux_tier IN ('free','paid','past_due'))
  plan_id                text                       -- For RC: event.product_id (e.g., 'app.leanshot.plus.monthly')
  current_period_end     timestamptz                -- ⚠ For D-04 RC CANCELLATION/EXPIRATION: now(). For RENEWAL/INITIAL_PURCHASE: event.expiration_at_ms.
  trial_end              timestamptz
  cancel_at_period_end   boolean NOT NULL DEFAULT false
  metadata               jsonb NOT NULL DEFAULT '{}'::jsonb
  created_at             timestamptz NOT NULL DEFAULT now()
  updated_at             timestamptz NOT NULL DEFAULT now()
  CHECK ((user_id IS NULL) <> (clinic_id IS NULL))  -- exactly-one constraint

table public.subscription_events:
  event_id      text PRIMARY KEY           -- For RC: event.id (RC dashboard event UUID)
  event_type    text NOT NULL              -- For RC: event.type ('INITIAL_PURCHASE'|'RENEWAL'|'CANCELLATION'|'EXPIRATION'|'BILLING_ISSUE'|'PRODUCT_CHANGE'|'UNCANCELLATION'|'TRANSFER')
  subscription_id text REFERENCES subscriptions(id) ON DELETE SET NULL
  payload       jsonb NOT NULL
  received_at   timestamptz NOT NULL DEFAULT now()
  processed_at  timestamptz
  processing_error text
  -- NEW (this plan): provider text NOT NULL DEFAULT 'stripe' CHECK (provider IN ('stripe','revenuecat'))

stripe-webhook surface to mirror (existing — DO NOT RE-IMPLEMENT, REPLICATE):
  jsonResponse(status: number, body: Record<string, unknown>): Response   -- always uses BASE_RESPONSE_HEADERS
  BASE_RESPONSE_HEADERS = { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store' }
  handleRequest(request: Request, testCtx?: TestContext): Promise<Response>
  __internal = { handleRequest }
  Deno.serve((request) => handleRequest(request))
  admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } })
  // RAW BODY FIRST: const body = await request.text() — NEVER request.json() before verify
  // Idempotency: insert into subscription_events; on '23505' return 200 { duplicate: true }
  // PII: console.error logs err.message only, NEVER payload data
</interfaces>

<threat_surfaces>
<!-- Trust boundaries crossing this Edge Function. -->
- RevenueCat servers → public Supabase Edge Function URL (HTTPS, no IP allowlist available on free/Pro tier)
- Edge Function → public.subscriptions / public.subscription_events (service-role JWT)
- Edge Function → Supabase secrets (REVENUECAT_WEBHOOK_AUTH, SUPABASE_SERVICE_ROLE_KEY)
</threat_surfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Migrations — provider discriminator on subscription_events + partial unique index for RC upserts + tier_effective view</name>
  <files>supabase/migrations/20270101000001_rc_subscriptions_provider.sql, supabase/migrations/20270101000002_tier_effective_view.sql</files>
  <read_first>
    - supabase/migrations/20260601000019_stripe_subscriptions.sql (current subscriptions + subscription_events schema; provider column ALREADY exists on subscriptions — do NOT re-add as enum, that would trip the enum-add-in-same-tx anti-pattern from feedback_planner_iter1_anti_patterns.md)
    - reference_supabase_migration_gotchas.md memory: partial-index predicates must be IMMUTABLE; SECURITY DEFINER funcs need search_path with extensions; CREATE POLICY cannot forward-reference within the same transaction.
    - feedback_planner_iter1_anti_patterns.md: enum-add-in-same-tx (DO NOT ADD an enum + reference it from a new policy/constraint in the same migration); CREATE POLICY forward-refs.
  </read_first>
  <action>
    Create TWO migrations as separate files (separate transactions) per the enum-add-in-same-tx + CREATE-POLICY-forward-ref guardrails. The current `provider` column on `public.subscriptions` is a `text` with a CHECK constraint, NOT an enum — keep it text. Do not introduce a Postgres enum at any point.

    **File 1 — `supabase/migrations/20270101000001_rc_subscriptions_provider.sql`:**

    1. Header comment: phase 16, plan 06, requirement MONEY-06, references D-02 (tier reconciliation) + D-04 (immediate downgrade behavior is enforced at function level, not constraint level).
    2. `ALTER TABLE public.subscription_events ADD COLUMN IF NOT EXISTS provider text NOT NULL DEFAULT 'stripe';` — idempotent; preserves all existing Stripe rows with provider='stripe'.
    3. `ALTER TABLE public.subscription_events ADD CONSTRAINT IF NOT EXISTS subscription_events_provider_check CHECK (provider IN ('stripe','revenuecat'));` — must use IF NOT EXISTS or DO block (Postgres ≥ 16 supports `ADD CONSTRAINT IF NOT EXISTS` for CHECK; for compatibility wrap in `DO $$ BEGIN ... EXCEPTION WHEN duplicate_object THEN NULL; END $$;`). Verify the actual Postgres version Supabase uses for this project before locking syntax — prefer the DO-block form for portability.
    4. `CREATE INDEX IF NOT EXISTS idx_subscription_events_provider_received ON public.subscription_events(provider, received_at DESC);` — supports per-provider event-stream queries from clinic admin tools.
    5. **Partial unique index** on subscriptions to make `onConflict: 'user_id,provider'` upsert work for RC rows while preserving the existing text PK semantics for Stripe rows:
       ```sql
       CREATE UNIQUE INDEX IF NOT EXISTS idx_subscriptions_user_provider_unique
         ON public.subscriptions(user_id, provider)
         WHERE user_id IS NOT NULL;
       ```
       Predicate `user_id IS NOT NULL` is IMMUTABLE (no functions, no `now()`) — passes the partial-index gotcha from reference_supabase_migration_gotchas Pitfall 1. This guarantees one row per (user, provider) for user-scoped subs while clinic-scoped Stripe subs (user_id IS NULL) remain unique only by `id` PK.
    6. NO new RLS policies in this migration (event_events RLS already deny-all for authenticated — service-role bypasses; nothing changes).

    **File 2 — `supabase/migrations/20270101000002_tier_effective_view.sql`:**

    1. Header comment: phase 16, plan 06, MONEY-06, D-02 effective tier rule, MONEY-07 cross-platform sync.
    2. Create the view:
       ```sql
       CREATE OR REPLACE VIEW public.tier_effective AS
         SELECT
           user_id,
           MAX(current_period_end) AS effective_expires_at,
           CASE
             WHEN MAX(current_period_end) > now() THEN 'paid'
             WHEN bool_or(status = 'past_due') THEN 'past_due'
             ELSE 'free'
           END AS tier,
           array_agg(DISTINCT provider ORDER BY provider) AS providers
         FROM public.subscriptions
         WHERE user_id IS NOT NULL
         GROUP BY user_id;
       ```
       Notes: `now()` inside a view is fine (re-evaluated on each SELECT); only PARTIAL INDEX expressions require IMMUTABLE. `providers` array is useful for clinic admin observability (D-23 honest unified view).
    3. `COMMENT ON VIEW public.tier_effective IS 'Phase 16 D-02: per-user effective tier across Stripe + RevenueCat providers. tier=paid iff MAX(current_period_end) > now(). Mirrors clients reading their own sub status.';`
    4. RLS: `ALTER VIEW public.tier_effective SET (security_invoker = true);` — view runs with the caller's permissions; subscriptions table's existing RLS (`auth.uid() = user_id`) automatically scopes view rows. No new policy needed.
    5. Grant the view to authenticated: `GRANT SELECT ON public.tier_effective TO authenticated;`
    6. DO NOT create any SECURITY DEFINER function in this migration (avoids the search_path = extensions gotcha). If a future RPC wraps this view, that's a separate migration.

    **Verification command (executor must run before declaring done):**
    ```bash
    cd /Users/karstenhaldan/minisite
    supabase db push --linked --include-all --dry-run
    # Then for real (executor confirms with user first if changing live DB):
    # supabase db push --linked --include-all
    ```
    Per reference_supabase_worktree_temp_state, if the executor is in a worktree, copy `supabase/.temp/` from the main checkout BEFORE running `--linked` commands.
  </action>
  <verify>
    <automated>
      cd /Users/karstenhaldan/minisite && supabase db push --linked --dry-run 2>&1 | tee /tmp/16-06-migration-dryrun.log && \
      grep -E "ADD COLUMN IF NOT EXISTS provider|CREATE UNIQUE INDEX IF NOT EXISTS idx_subscriptions_user_provider_unique|CREATE OR REPLACE VIEW public.tier_effective|MAX\(current_period_end\)" /Users/karstenhaldan/minisite/supabase/migrations/20270101000001_rc_subscriptions_provider.sql /Users/karstenhaldan/minisite/supabase/migrations/20270101000002_tier_effective_view.sql | wc -l | grep -q "^[4-9]" && echo "PASS: 4 required tokens present and dry-run parsed"
    </automated>
    Also manually inspect:
    - File 1 contains NO `CREATE TYPE ... AS ENUM` (would trip enum-add-in-same-tx).
    - File 2 contains NO `SECURITY DEFINER` (avoids search_path gotcha).
    - Both files have `IF NOT EXISTS` on every DDL that targets an already-existing object.
  </verify>
  <done>
    Two new migration files exist, both pass `supabase db push --linked --dry-run`. The provider column on `subscription_events` is idempotently added (re-run safe). `idx_subscriptions_user_provider_unique` exists as a partial unique index with IMMUTABLE predicate. `public.tier_effective` view exists with security_invoker=true and computes MAX(current_period_end) per user.
  </done>
</task>

<task type="auto">
  <name>Task 2: Edge Function skeleton — cors.ts + deno.json + index.ts shell mirroring stripe-webhook, with HMAC-SHA256 verify replacing Stripe SubtleCryptoProvider</name>
  <files>supabase/functions/revenuecat-webhook/cors.ts, supabase/functions/revenuecat-webhook/deno.json, supabase/functions/revenuecat-webhook/index.ts</files>
  <read_first>
    - /Users/karstenhaldan/minisite/supabase/functions/stripe-webhook/index.ts (lines 1-234 in full — this plan REPLICATES this shape with RC-specific verify + dispatcher swap)
    - /Users/karstenhaldan/minisite/supabase/functions/stripe-webhook/cors.ts (10 lines — duplicate verbatim into revenuecat-webhook/cors.ts; same constraints apply: RC servers do not send Origin, no CORS needed)
    - /Users/karstenhaldan/minisite/supabase/functions/stripe-webhook/deno.json (duplicate verbatim)
    - 16-PATTERNS.md §"supabase/functions/revenuecat-webhook/index.ts" — has full structural pattern with HMAC code
    - 16-RESEARCH.md §"Pattern 4" lines 401-450 (current researcher pattern uses simpler Bearer-token shared-secret — see note below)
    - reference_supabase_edge_function_deploy.md memory: gateway overrides Content-Type for HTML only; JSON passes through. bundler ignores import_map.json — use esm.sh URLs (we use `npm:@supabase/supabase-js@2` which is the project-canonical Deno import; do NOT switch to jsr: even though Pattern 4 in RESEARCH shows jsr — match stripe-webhook exactly). `verify_jwt = false` MUST be set in supabase/config.toml for this function.
  </read_first>
  <action>
    **Decision: Auth = Bearer token AND HMAC-SHA256 (defense in depth).**

    RESEARCH Pattern 4 (line 416) uses Bearer-token only (`auth !== \`Bearer ${SHARED_SECRET}\``). CONTEXT D-02 + the orchestrator prompt say HMAC-SHA256. RevenueCat actually supports BOTH — a configurable Authorization header (commonly Bearer) AND a separate `X-RevenueCat-Signature` HMAC header if you enable webhook signing in the RC dashboard. We implement BOTH and reject if either is misconfigured: Bearer-token gate first (cheap), then HMAC verify over raw body (cryptographic). This matches stripe-webhook's defense posture (signature verification) without forcing RC to issue real HMAC headers in dashboard configurations that don't expose it. If `REVENUECAT_WEBHOOK_SECRET` env var is unset, HMAC verify is skipped (logged-warning only) — this allows the function to ship even before HMAC is enabled in the RC dashboard, while Bearer-token alone still blocks unauthorized requests. The Deno test suite (Task 3) covers both gates.

    **File 1 — `supabase/functions/revenuecat-webhook/cors.ts`** (verbatim duplicate of stripe-webhook/cors.ts, replace "stripe-webhook" → "revenuecat-webhook" in the docstring; keep `BASE_RESPONSE_HEADERS` identical: `Content-Type: application/json` + `Cache-Control: private, no-store`).

    **File 2 — `supabase/functions/revenuecat-webhook/deno.json`** (verbatim duplicate of stripe-webhook/deno.json).

    **File 3 — `supabase/functions/revenuecat-webhook/index.ts`:**

    Header docstring (mirror stripe-webhook lines 1-19) with adjustments:
    - Single source of truth for subscriptions writes from RevenueCat (D-02).
    - Security invariants: RAW BODY first; Bearer-token gate; optional HMAC-SHA256 verify when REVENUECAT_WEBHOOK_SECRET set; idempotency via subscription_events PK; PII safety (no payload in console.error); Cache-Control: private, no-store on every response; SERVICE_ROLE read once at cold-start.
    - Reference D-04 immediate-downgrade comment ("CANCELLATION/EXPIRATION → current_period_end = now(); deliberate asymmetry vs Stripe grace per D-04").

    Imports + module constants — copy stripe-webhook lines 21-56 with these swaps:
    - Remove `import Stripe from ...` and `cryptoProvider = Stripe.createSubtleCryptoProvider();`.
    - Add helper `function getWebhookSecret(): string { return Deno.env.get('REVENUECAT_WEBHOOK_SECRET') ?? ''; }` (returns '' when HMAC disabled — verify skipped).
    - Add helper `function getBearerSecret(): string { return Deno.env.get('REVENUECAT_WEBHOOK_AUTH') ?? ''; }`.
    - Keep `admin` client init identical to stripe-webhook lines 52-56.

    `jsonResponse` helper — copy stripe-webhook lines 59-64 verbatim.

    Test injection shim — copy stripe-webhook lines 66-72 verbatim; adapt the TestContext interface fields to RC-specific behaviors:
    ```ts
    interface TestContext {
      insertResult?: { data: null; error: { code: string; message: string } | null };
      handlerResult?: Error | undefined;
      // RC-specific: allow tests to mock subscriptions.upsert outcome
      upsertResult?: { data: null; error: { code: string; message: string } | null };
    }
    ```

    HMAC-SHA256 verify helper (NEW, no Stripe equivalent):
    ```ts
    function hexToBytes(hex: string): Uint8Array {
      // Accept optional 'sha256=' prefix that RC may emit
      const clean = hex.startsWith('sha256=') ? hex.slice(7) : hex;
      const out = new Uint8Array(clean.length / 2);
      for (let i = 0; i < out.length; i++) {
        out[i] = parseInt(clean.substring(i * 2, i * 2 + 2), 16);
      }
      return out;
    }
    async function verifyHmac(body: string, signatureHeader: string, secret: string): Promise<boolean> {
      try {
        const encoder = new TextEncoder();
        const key = await crypto.subtle.importKey(
          'raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify'],
        );
        const sigBytes = hexToBytes(signatureHeader);
        return await crypto.subtle.verify('HMAC', key, sigBytes, encoder.encode(body));
      } catch {
        return false;
      }
    }
    ```

    Dispatcher (NEW — replaces stripe-webhook's dispatch function):
    ```ts
    interface RcEvent {
      id: string;                  // RC dashboard event UUID — idempotency anchor
      type: string;                // 'INITIAL_PURCHASE' | 'RENEWAL' | 'PRODUCT_CHANGE' | 'CANCELLATION' | 'EXPIRATION' | 'BILLING_ISSUE' | 'UNCANCELLATION' | 'TRANSFER'
      app_user_id: string;         // Supabase user uuid
      product_id: string;          // e.g., 'app.leanshot.plus.monthly'
      expiration_at_ms: number | null;
      // ...other fields preserved in payload jsonb
    }

    async function dispatch(event: RcEvent, testCtx?: TestContext): Promise<void> {
      if (testCtx?.handlerResult instanceof Error) throw testCtx.handlerResult;

      // D-04: immediate downgrade for CANCELLATION + EXPIRATION (deliberate vs Stripe grace).
      const isImmediateDowngrade = event.type === 'CANCELLATION' || event.type === 'EXPIRATION';
      const currentPeriodEnd = isImmediateDowngrade
        ? new Date().toISOString()
        : event.expiration_at_ms != null
          ? new Date(event.expiration_at_ms).toISOString()
          : null;

      // Map RC event type → status + ux_tier
      let status: string;
      let uxTier: 'free' | 'paid' | 'past_due';
      switch (event.type) {
        case 'INITIAL_PURCHASE':
        case 'RENEWAL':
        case 'PRODUCT_CHANGE':
        case 'UNCANCELLATION':
          status = 'active'; uxTier = 'paid'; break;
        case 'CANCELLATION':
        case 'EXPIRATION':
          status = event.type.toLowerCase(); uxTier = 'free'; break;
        case 'BILLING_ISSUE':
          status = 'past_due'; uxTier = 'past_due'; break;
        case 'TRANSFER':
          // TRANSFER fires when subscription moves between RC app_user_ids (e.g., user account merge).
          // No tier change; just record the event. Skip subscriptions upsert.
          return;
        default:
          console.log('[revenuecat-webhook] unhandled event type', event.type);
          return;
      }

      // Deterministic id for RC subscription row (D-02 onConflict requires user_id+provider).
      // id field is informational only because uniqueness is enforced by idx_subscriptions_user_provider_unique.
      const subId = `rc:${event.app_user_id}:${event.product_id}`;

      if (testCtx?.upsertResult !== undefined) {
        if (testCtx.upsertResult.error) {
          throw new Error(`upsert failed: ${testCtx.upsertResult.error.message}`);
        }
        return;
      }

      const { error } = await admin.from('subscriptions').upsert({
        id: subId,
        provider: 'revenuecat',
        user_id: event.app_user_id,
        clinic_id: null,
        stripe_customer_id: null,
        status,
        ux_tier: uxTier,
        plan_id: event.product_id,
        current_period_end: currentPeriodEnd,
        metadata: { rc_event_type: event.type, rc_event_id: event.id },
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id,provider' });

      if (error) {
        // PII safety: log code + message, NEVER event payload.
        throw new Error(`subscriptions upsert: ${error.code ?? 'unknown'} ${error.message ?? ''}`);
      }
    }
    ```

    Core `handleRequest` — mirror stripe-webhook lines 132-224 with these swaps:
    1. Method guard identical (only POST).
    2. **Bearer-token gate FIRST** (cheap; runs before body read):
       ```ts
       const bearer = getBearerSecret();
       const auth = request.headers.get('authorization') ?? '';
       if (!bearer || auth !== `Bearer ${bearer}`) {
         return jsonResponse(401, { error: 'unauthorized' });
       }
       ```
    3. RAW BODY: `const body = await request.text();` — DO NOT call `request.json()` first.
    4. **HMAC verify (conditional on REVENUECAT_WEBHOOK_SECRET being set):**
       ```ts
       const hmacSecret = getWebhookSecret();
       if (hmacSecret) {
         const sigHeader = request.headers.get('x-revenuecat-signature') ?? '';
         if (!sigHeader) return jsonResponse(400, { error: 'missing-signature' });
         const ok = await verifyHmac(body, sigHeader, hmacSecret);
         if (!ok) {
           console.error('[revenuecat-webhook] bad signature');
           return jsonResponse(400, { error: 'bad-signature' });
         }
       }
       // If hmacSecret is '' (unset), HMAC step is skipped. Bearer-token alone gates auth.
       // Add a one-line console.warn at cold-start (NOT per-request) when secret is unset
       // — but only at startup. Simplest: top-level `if (!getWebhookSecret()) console.warn(...)` at module load (mark as DELIBERATE; do not gate function on it).
       ```
    5. Parse + idempotency insert:
       ```ts
       let event: RcEvent;
       try { event = JSON.parse(body).event ?? JSON.parse(body); }
       catch { return jsonResponse(400, { error: 'malformed-json' }); }

       if (!event?.id || !event?.type || !event?.app_user_id) {
         return jsonResponse(400, { error: 'malformed-event' });
       }

       let insertErr: { code: string; message: string } | null = null;
       if (testCtx?.insertResult !== undefined) {
         insertErr = testCtx.insertResult.error;
       } else {
         const { error } = await admin.from('subscription_events').insert({
           event_id: event.id,
           event_type: event.type,
           payload: event,
           provider: 'revenuecat',
         });
         insertErr = error as { code: string; message: string } | null;
       }

       if (insertErr) {
         if (insertErr.code === '23505') {
           return jsonResponse(200, { duplicate: true });
         }
         console.error('[revenuecat-webhook] subscription_events insert', insertErr.message);
         return jsonResponse(500, { error: 'internal' });
       }
       ```
       Note: RC webhook body shape is `{ event: { ... }, api_version: "..." }`. The dual fallback `JSON.parse(body).event ?? JSON.parse(body)` accommodates dashboards that send the event-only payload directly.
    6. Dispatch + processed_at update — mirror stripe-webhook lines 201-221, swap collection name in console.error message.
    7. `Deno.serve` + `__internal` export — mirror stripe-webhook lines 227-233.

    **PII invariant**: every `console.error` call MUST log `err.message` only — NEVER `event`, `event.payload`, `event.app_user_id`, or any object containing user data.

    **Bundle safety per reference_supabase_edge_function_deploy.md:**
    - Imports use `npm:@supabase/supabase-js@2` (matches stripe-webhook; bundler resolves this). Do NOT use bare `@supabase/supabase-js` import (will break deploy).
    - No `import_map.json` dependency.

    **supabase/config.toml** — append a new `[functions.revenuecat-webhook]` block with `verify_jwt = false`. RevenueCat servers do NOT have a Supabase user JWT; bearer-token + HMAC are the auth layer. Without this flag, Supabase's gateway rejects the request before it reaches our handler.
  </action>
  <verify>
    <automated>
      cd /Users/karstenhaldan/minisite/supabase/functions/revenuecat-webhook && \
      test -f index.ts && test -f cors.ts && test -f deno.json && \
      grep -v '^[[:space:]]*//' index.ts | grep -v '^[[:space:]]*\*' | grep -c "await request.text()" | grep -q "^1$" && \
      grep -v '^[[:space:]]*//' index.ts | grep -v '^[[:space:]]*\*' | grep -c "Bearer \${bearer}\|Bearer \$\{bearer\}" | grep -qv "^0$" && \
      grep -v '^[[:space:]]*//' index.ts | grep -v '^[[:space:]]*\*' | grep -c "crypto.subtle.verify" | grep -q "^1$" && \
      grep -v '^[[:space:]]*//' index.ts | grep -v '^[[:space:]]*\*' | grep -c "onConflict: 'user_id,provider'" | grep -q "^1$" && \
      grep -v '^[[:space:]]*//' index.ts | grep -v '^[[:space:]]*\*' | grep -c "provider: 'revenuecat'" | grep -q "^[12]$" && \
      grep -E "verify_jwt = false" /Users/karstenhaldan/minisite/supabase/config.toml | wc -l | grep -qv "^0$" && \
      echo "PASS: skeleton structural gates met"
    </automated>
    Also visually verify:
    - No `import_map.json` reference anywhere in revenuecat-webhook directory.
    - HMAC verify path uses `crypto.subtle.importKey('raw', ...)` + `crypto.subtle.verify('HMAC', ...)`.
    - Every `console.error` argument list does NOT contain `event`, `payload`, or `app_user_id`.
  </verify>
  <done>
    Three files committed under `supabase/functions/revenuecat-webhook/`. `supabase/config.toml` updated with `[functions.revenuecat-webhook] verify_jwt = false`. The function compiles under Deno (verified by Task 3's test loading the module). Bearer-token + HMAC dual gate matches stripe-webhook's signature-verify-first invariant. D-04 immediate-downgrade is enforced in the dispatcher switch statement (CANCELLATION/EXPIRATION → `current_period_end = new Date().toISOString()`).
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 3: Deno test suite — auth gate, HMAC verify, idempotency, D-04 downgrade math, dispatcher dispatch table</name>
  <files>supabase/functions/revenuecat-webhook/index.test.ts</files>
  <read_first>
    - /Users/karstenhaldan/minisite/supabase/functions/stripe-webhook/index.test.ts (mirror its structure — Deno test discovery, env var setup before module import, computeStripeSignatureHeader helper analog, testCtx injection pattern)
    - 16-PATTERNS.md §"Service-Role JWT" + §"Supabase Edge Function — Env Lazy Read" — confirms lazy env read pattern
    - reference_deno_test_discovery.md memory: file MUST be named `index.test.ts` (NOT `index-test.ts` — Deno directory-walk regex `{*_,*.,}test.*` does not match hyphen form). Test file basename here is correct.
  </read_first>
  <behavior>
    Twelve test cases covering every observable behavior of the webhook:

    AUTH GATE (no DB writes regardless of body):
    1. POST without Authorization header → 401 `{ error: 'unauthorized' }`, Cache-Control: private, no-store.
    2. POST with wrong Bearer token → 401 `{ error: 'unauthorized' }`.
    3. Method GET / PUT / DELETE → 405 `{ error: 'method-not-allowed' }`.
    4. OPTIONS preflight → 200 with Cache-Control header (matches stripe-webhook surface).

    HMAC VERIFY (only when REVENUECAT_WEBHOOK_SECRET is set):
    5. With HMAC secret set + missing `x-revenuecat-signature` header → 400 `{ error: 'missing-signature' }`.
    6. With HMAC secret set + bad signature → 400 `{ error: 'bad-signature' }`.
    7. With HMAC secret set + correct signature + correct Bearer → reaches dispatcher (200 ok in mocked test).
    8. With HMAC secret UNSET (env var empty) + correct Bearer + no x-revenuecat-signature header → reaches dispatcher (200 ok). Confirms graceful pre-HMAC-rollout shipping.

    IDEMPOTENCY:
    9. testCtx.insertResult.error.code = '23505' → 200 `{ duplicate: true }`, dispatcher NOT invoked.
    10. testCtx.insertResult.error.code = '08006' (connection failure) → 500 `{ error: 'internal' }`.

    D-04 DISPATCHER MATH (use the dispatch function directly via __internal or via handleRequest with testCtx.upsertResult mock):
    11. CANCELLATION event with `expiration_at_ms` 30 days in future → upsert payload has `current_period_end = approx now() ISO string` (not the future date) and `ux_tier = 'free'`. Verify via testCtx.upsertResult interception that mocks the upsert and captures the payload; assert `Math.abs(new Date(capturedPayload.current_period_end).getTime() - Date.now()) < 5000`.
    12. RENEWAL event with `expiration_at_ms` 30 days in future → upsert payload has `current_period_end = new Date(expiration_at_ms).toISOString()` (future), `ux_tier = 'paid'`, `status = 'active'`.

    PII SAFETY (compile-time + runtime grep):
    - Reuse stripe-webhook test 1.5 pattern: trigger handler error, capture console.error calls in test, assert NO arg contains `app_user_id` or `event.id` string substrings.

    Body parsing:
    - Malformed JSON body → 400 `{ error: 'malformed-json' }`.
    - Event missing required field (e.g., no `id`) → 400 `{ error: 'malformed-event' }`.
  </behavior>
  <action>
    1. Copy the env-var setup block from stripe-webhook/index.test.ts lines 25-35, substituting `REVENUECAT_WEBHOOK_AUTH` and `REVENUECAT_WEBHOOK_SECRET`. CRITICAL: `Deno.env.set(...)` MUST occur BEFORE the `import { __internal } from './index.ts'` line because the module's `admin` client init reads env at load time.
    2. Build the equivalent of stripe-webhook's `computeStripeSignatureHeader` for HMAC-SHA256:
       ```ts
       async function computeRcSignature(body: string, secret: string): Promise<string> {
         const enc = new TextEncoder();
         const key = await crypto.subtle.importKey(
           'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
         );
         const sig = await crypto.subtle.sign('HMAC', key, enc.encode(body));
         return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
       }
       ```
    3. For each behavior in the `<behavior>` block above, write a `Deno.test('...', async () => { ... })`. Mirror the helper functions from stripe-webhook test (`makeRequest`, `parseJsonResponse`).
    4. For tests that exercise the dispatcher (11, 12), inject a `testCtx.upsertResult = { data: null, error: null }` AND patch the dispatcher to surface the upsert payload via a module-level test capture. Cleanest: add a second test injection field `onUpsertCapture?: (payload: Record<string, unknown>) => void` to the TestContext interface in index.ts (Task 2), invoked just before the real `admin.from('subscriptions').upsert(...)` line. The test sets `onUpsertCapture` to push the payload into a closed-over array, then asserts properties.
       Trade-off: this adds a test seam to production code. Acceptable because the seam is gated on `testCtx !== undefined` (zero overhead in prod path) and mirrors the existing testCtx pattern from stripe-webhook.
    5. Ensure every test:
       - Sets `Cache-Control: private, no-store` on the response (assert via `response.headers.get('Cache-Control')`).
       - Asserts `Content-Type: application/json`.
    6. End with `Deno.test('PII safety: console.error never logs payload', ...)` that monkey-patches `console.error`, runs a failure path, and asserts captured args do not contain a known sentinel string from the input event.
    7. File MUST be named `index.test.ts` per reference_deno_test_discovery (NOT `index-test.ts`).
  </action>
  <verify>
    <automated>
      cd /Users/karstenhaldan/minisite/supabase/functions/revenuecat-webhook && \
      deno test --allow-all --no-check 2>&1 | tee /tmp/16-06-deno-test.log && \
      grep -E "ok\s+\|\s+([0-9]+) passed\s+\|\s+0 failed" /tmp/16-06-deno-test.log && \
      grep -c "Deno.test" index.test.ts | awk '$1 >= 12 { exit 0 } { exit 1 }' && \
      echo "PASS: ≥12 Deno tests defined and all pass"
    </automated>
    Manual verification:
    - Test for D-04 actually asserts `current_period_end ≈ now()` for CANCELLATION (not `expires_at`, not 30-days-future date).
    - PII test grep is on the exact `event.app_user_id` value used in the test payload, not a generic substring.
  </verify>
  <done>
    `index.test.ts` exists. `deno test` reports ≥12 passing tests, 0 failing. The D-04 immediate-downgrade assertion is concrete: CANCELLATION → captured upsert payload's `current_period_end` is within 5 seconds of `Date.now()` (NOT 30 days out). PII safety test passes.
  </done>
</task>

<task type="auto">
  <name>Task 4: Deploy + smoke-test against live Supabase (Pro tier from 16-00)</name>
  <files>(no files modified — deployment + smoke only; updates SUMMARY notes during 16-SUMMARY in execute step)</files>
  <read_first>
    - reference_supabase_edge_function_deploy.md memory: bundler ignores import_map.json (use esm.sh URLs); verify_jwt defaults true (we set false in config.toml Task 2); UAT-probe pattern for Function Secrets.
    - reference_supabase_worktree_temp_state.md memory: if executor is in a worktree, copy `supabase/.temp/` from main checkout BEFORE running any `supabase --linked` command.
    - feedback_parallel_executor_autonomy_drift.md memory: do NOT push migrations to live DB without explicit user confirmation if running in a parallel-executor wave; this task EXPLICITLY runs the deploy and requires the user-or-orchestrator gate.
  </read_first>
  <action>
    Pre-flight checks:
    1. Confirm `REVENUECAT_WEBHOOK_AUTH` Function Secret is set on the live Supabase project:
       ```bash
       supabase secrets list --project-ref ytnsipxxmzgaebkqmokp | grep -E "REVENUECAT_WEBHOOK_AUTH|REVENUECAT_WEBHOOK_SECRET"
       ```
       If `REVENUECAT_WEBHOOK_AUTH` is absent, HALT and emit a checkpoint asking the user to run `supabase secrets set REVENUECAT_WEBHOOK_AUTH=<token> --project-ref ytnsipxxmzgaebkqmokp` after creating the bearer token in RC dashboard. `REVENUECAT_WEBHOOK_SECRET` is optional at this stage (HMAC layer ships disabled if absent — Task 2 graceful pre-HMAC-rollout path).

    2. If executor is in a worktree, copy `.temp/`:
       ```bash
       if [ "$(git rev-parse --show-toplevel)" != "/Users/karstenhaldan/minisite" ]; then
         cp -r /Users/karstenhaldan/minisite/supabase/.temp $(git rev-parse --show-toplevel)/supabase/.temp
       fi
       ```

    3. Apply migrations:
       ```bash
       cd /Users/karstenhaldan/minisite
       supabase db push --linked --include-all
       ```
       Confirm both new migration files appear in the push output.

    4. Deploy the function:
       ```bash
       supabase functions deploy revenuecat-webhook --project-ref ytnsipxxmzgaebkqmokp
       ```
       Watch for bundler warnings about bare imports — if any appear, fix the import statement to use `npm:@supabase/supabase-js@2` (the canonical form used by stripe-webhook).

    5. Smoke test — three live curls against the deployed function:

       **a) Unauthorized (no Bearer):**
       ```bash
       curl -i -X POST "https://ytnsipxxmzgaebkqmokp.supabase.co/functions/v1/revenuecat-webhook" \
         -H "Content-Type: application/json" \
         -d '{"event":{"id":"evt_smoke_1","type":"INITIAL_PURCHASE","app_user_id":"00000000-0000-0000-0000-000000000000","product_id":"app.leanshot.plus.monthly","expiration_at_ms":null}}'
       ```
       Expected: `HTTP/2 401`, body `{"error":"unauthorized"}`, header `Cache-Control: private, no-store`.

       **b) Authorized but malformed event:**
       ```bash
       AUTH=$(supabase secrets list --project-ref ytnsipxxmzgaebkqmokp | grep REVENUECAT_WEBHOOK_AUTH | awk '{print $NF}')
       # NOTE: `supabase secrets list` does not return plaintext values — this is a placeholder.
       # In practice, the executor will need the user to provide the bearer value once for this smoke step,
       # OR the executor uses Supabase Studio → Settings → Edge Functions → Secrets to peek.
       # If unable, mark step (b) + (c) as deferred to a follow-up smoke run by the user.
       curl -i -X POST "https://ytnsipxxmzgaebkqmokp.supabase.co/functions/v1/revenuecat-webhook" \
         -H "Authorization: Bearer $AUTH" \
         -H "Content-Type: application/json" \
         -d '{"event":{"id":"evt_smoke_2","type":"INITIAL_PURCHASE"}}'
       ```
       Expected: `HTTP/2 400`, body `{"error":"malformed-event"}`.

       **c) Tier_effective view verification (DB-level, no function call):**
       ```bash
       supabase db execute --linked --query "SELECT user_id, tier, providers FROM public.tier_effective LIMIT 5;"
       ```
       Expected: query succeeds; no error about missing view; tier values are in `('free','paid','past_due')`.

    6. If (b) + (c) are blocked on credential retrieval, emit a CHECKPOINT (`checkpoint:human-action`) asking the user to confirm steps (b) and (c) manually after providing the bearer value, and proceed with (a) only as automated.

    **DO NOT** register the actual RC webhook URL in the RevenueCat dashboard from this task — that's a 16-10 UAT gate (live RC sandbox purchase requires the user's Apple Sandbox tester anyway).
  </action>
  <verify>
    <automated>
      # Step 5(a) automated:
      curl -s -o /tmp/16-06-smoke-a.json -w "%{http_code}\n" -X POST \
        "https://ytnsipxxmzgaebkqmokp.supabase.co/functions/v1/revenuecat-webhook" \
        -H "Content-Type: application/json" \
        -d '{"event":{"id":"evt_smoke_unauth","type":"INITIAL_PURCHASE","app_user_id":"00000000-0000-0000-0000-000000000000","product_id":"app.leanshot.plus.monthly","expiration_at_ms":null}}' | \
      grep -q "^401$" && grep -q "unauthorized" /tmp/16-06-smoke-a.json && \
      curl -sI "https://ytnsipxxmzgaebkqmokp.supabase.co/functions/v1/revenuecat-webhook" -X POST -H "Content-Type: application/json" -d '{}' | grep -qi "cache-control.*private.*no-store" && \
      echo "PASS: 401 + Cache-Control header confirmed via live curl"
    </automated>
    Plus DB-level:
    `supabase db execute --linked --query "SELECT to_regclass('public.tier_effective');"` returns `tier_effective` (not NULL).
  </verify>
  <done>
    Both migrations applied to live DB. Edge function deployed at `https://ytnsipxxmzgaebkqmokp.supabase.co/functions/v1/revenuecat-webhook`. Smoke step 5(a) passes (401 + Cache-Control); steps 5(b) and 5(c) either pass automated or are explicitly flagged for follow-up smoke in the SUMMARY with the exact curl commands documented.
  </done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| RevenueCat servers → revenuecat-webhook public URL | Untrusted internet POST; bearer-token + HMAC verify gate at function entry |
| revenuecat-webhook → public.subscriptions / subscription_events | Service-role JWT bypasses RLS; payload validated at function level before DB write |
| revenuecat-webhook → Supabase Function Secrets | REVENUECAT_WEBHOOK_AUTH + REVENUECAT_WEBHOOK_SECRET + SUPABASE_SERVICE_ROLE_KEY all read via `Deno.env.get` — never interpolated into responses or thrown errors |
| Authenticated user SELECT on tier_effective view | RLS enforced via security_invoker=true + underlying subscriptions RLS (auth.uid()=user_id); cross-tenant impersonation blocked |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-16-06-01 | Spoofing | revenuecat-webhook entry | mitigate | Bearer-token check on every POST; HMAC-SHA256 verify when REVENUECAT_WEBHOOK_SECRET set; 401/400 reject before any DB read |
| T-16-06-02 | Tampering | webhook body in transit | mitigate | HMAC-SHA256 verify over RAW body via Deno crypto.subtle.verify (matches stripe-webhook Pitfall 2 pattern) when secret configured; RAW body read FIRST before any JSON.parse |
| T-16-06-03 | Repudiation | event already processed but RC retries | mitigate | Idempotency via subscription_events.event_id PK + 23505 → 200 { duplicate: true } (replicates stripe-webhook Pattern B) |
| T-16-06-04 | Info disclosure | error responses leaking RC event payload | mitigate | jsonResponse always returns `{ error: '<short-code>' }`; console.error logs `err.message` only, NEVER the event/payload object (mirrors stripe-webhook T-14-03-I1); Task 3 test 'PII safety' enforces this |
| T-16-06-05 | Info disclosure | service-role key in response | mitigate | SUPABASE_SERVICE_ROLE_KEY read once into admin client at cold-start; never re-read; never interpolated into responses or thrown errors (stripe-webhook T-14-03-E1 pattern) |
| T-16-06-06 | DoS | unbounded retries from RC | accept | RevenueCat retry schedule is bounded (exponential backoff up to 72h per RC docs); 500 responses from this function trigger retries which is correct behavior; 200/400 stops retries |
| T-16-06-07 | Elevation | unauthorized tier upgrade via crafted event | mitigate | event.app_user_id is taken at face value because admin client (service-role) is the only writer; spoofing requires bypassing T-16-06-01 + T-16-06-02 first |
| T-16-06-08 | Tampering | tier_effective view bypass via direct subscriptions SELECT | mitigate | tier_effective uses security_invoker=true + GRANT SELECT to authenticated; underlying subscriptions RLS (auth.uid()=user_id) scopes rows; clinic_owner cross-org queries blocked at subscriptions table |
| T-16-06-09 | Repudiation | malicious provider value injection into subscription_events | mitigate | provider column CHECK constraint enforces in ('stripe','revenuecat'); webhook hardcodes 'revenuecat' on insert |
| T-16-06-10 | Info disclosure | rc_event_id leaked into metadata jsonb readable by user | accept | metadata is owner-scoped (user's own row); rc_event_id is opaque RC UUID; no PII; observability-positive (helps debugging) |

</threat_model>

<verification>
**End-to-end verification (after all 4 tasks):**

1. **Migration safety:** `supabase db push --linked --dry-run` parses cleanly on a fresh local DB copy. No `CREATE TYPE ... ENUM`, no `CREATE POLICY` forward-refs, no non-IMMUTABLE partial-index predicates.

2. **Function ships:** `supabase functions deploy revenuecat-webhook --project-ref ytnsipxxmzgaebkqmokp` succeeds with no bare-import warnings.

3. **Tier effective math:** Insert two fixture rows via `supabase db execute --linked`:
   ```sql
   -- Manual UAT step (executor runs after deploy):
   INSERT INTO subscriptions (id, provider, user_id, status, ux_tier, current_period_end)
   VALUES
     ('stripe_test_1', 'stripe', '<test_uuid>', 'cancelled', 'free', now() - interval '1 day'),
     ('rc:<test_uuid>:app.leanshot.plus.monthly', 'revenuecat', '<test_uuid>', 'active', 'paid', now() + interval '30 days');
   SELECT user_id, tier, providers FROM tier_effective WHERE user_id = '<test_uuid>';
   -- Expected: tier='paid', providers={revenuecat,stripe}
   ```
   Roll back via DELETE after verification. This must NOT remain in the migrations (one-shot probe only).

4. **D-04 enforcement:** Task 3 test 11 asserts CANCELLATION events set `current_period_end ≈ now()` — REGRESSION CHECK: if a future executor "fixes" this to match Stripe's grace-period behavior, the test fails. The asymmetry is intentional per D-04.

5. **Deno test suite green:** `cd supabase/functions/revenuecat-webhook && deno test --allow-all --no-check` → all ≥12 tests pass.

6. **Bundle budget:** N/A — Edge Function, not part of client bundle. The page-builder-runtime / clinic-budget ceilings from Phase 12 are unaffected.

7. **Phase 16 dependency unblock:** Plan 16-05 (`src/lib/native/iap.ts` + Realtime channel install) can now write to the live DB via this webhook; Plan 16-10 UAT (Apple Sandbox purchase) can validate end-to-end propagation.
</verification>

<success_criteria>
1. Both migrations applied on live Supabase project `ytnsipxxmzgaebkqmokp`; `\d+ subscription_events` shows `provider` column with CHECK constraint; `\d+ tier_effective` shows view with security_invoker=true.
2. Edge function deployed and accessible at `https://ytnsipxxmzgaebkqmokp.supabase.co/functions/v1/revenuecat-webhook`; live curl with no Bearer returns 401 + Cache-Control: private, no-store.
3. Deno test suite at `supabase/functions/revenuecat-webhook/index.test.ts` reports ≥12 passing tests, 0 failing.
4. D-04 immediate-downgrade asymmetry is enforced AND test-covered (regression-proof).
5. `supabase/config.toml` has `[functions.revenuecat-webhook]` block with `verify_jwt = false`.
6. Plan 16-05 has a working webhook endpoint to drive Realtime tier-flip propagation (D-25) on the iOS side.
7. No bare imports (`import X from '@supabase/...'`) in the function — all use `npm:` prefix per stripe-webhook canonical pattern.
8. No new SECURITY DEFINER functions introduced (avoids the search_path = extensions gotcha; deferred to a future migration if needed).
</success_criteria>

<output>
After completion, create `.planning/phases/16-capacitor-mobile-shells-ios-android/16-06-SUMMARY.md` documenting:
- The provider-discriminator + partial-unique-index design choice (why we kept text PK on subscriptions and added a secondary partial unique index instead of changing the PK shape).
- The D-04 asymmetry rationale (immediate downgrade is deliberate; researcher flagged but did not recommend Stripe-side normalization in P16).
- The Bearer + optional-HMAC dual-gate auth design (graceful pre-HMAC-rollout for the case where REVENUECAT_WEBHOOK_SECRET is not yet set in Supabase secrets).
- Smoke-test results from Task 4 (which steps were automated vs deferred to a follow-up live UAT).
- Any deferred items (e.g., if smoke step 5b had to be flagged for the user).
</output>
