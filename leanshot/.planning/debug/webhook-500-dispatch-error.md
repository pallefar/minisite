---
status: resolved
trigger: "webhook 500 — with the Stripe Dashboard logs open, the dispatch() error surfaces immediately"
created: 2026-05-14T09:45:00Z
updated: 2026-05-14T10:15:00Z
---

## Current Focus

hypothesis: "invoice-upcoming.ts had a runtime value import of 'stripe' (bare specifier) that failed when dynamically imported by the dispatcher — import map not applied to dynamic-import subgraph in Supabase hosted Edge Runtime"
test: "All 6 event handlers are dynamically imported BEFORE the switch in dispatch() — one broken import throws and 500s every event type"
expecting: "Fix is commit fa21de1 (local main, not yet on origin/main): change bare 'stripe' → full esm.sh URL in invoice-upcoming.ts"
next_action: "Push fa21de1 to origin/main and redeploy stripe-webhook Edge Function"

## Symptoms

expected: "Stripe webhook endpoint returns 2xx and processes the event (signature verify → dispatch to per-event handler → DB write)."
actual: "Endpoint returns HTTP 500. With the Stripe Dashboard webhook delivery logs open, the failure is in dispatch() and surfaces immediately on every delivery."
errors: "Dynamic import of ./events/invoice-upcoming.ts throws at runtime — bare 'stripe' specifier is not resolved via import_map.json in the Supabase hosted Edge Runtime's dynamic-import subgraph."
timeline: "Never worked. Has 500'd since the webhook handler was first deployed in Phase 14 (Stripe billing)."
reproduction: "Reproducible both ways — `stripe trigger` / `stripe events resend` against the deployed endpoint AND real Stripe events. ALL event types 500 (not isolated to one event)."

## Eliminated

- Stripe signature verification (constructEventAsync + createSubtleCryptoProvider): correctly implemented
- Env secret names (STRIPE_WEBHOOK_SECRET, STRIPE_SECRET_KEY): correctly named and lazy-read
- API version string ('2026-04-22.dahlia' cast): does not affect constructEventAsync — no API call made during signature verification
- Per-event handler logic (checkout-session-completed, subscription-updated, customer-subscription-deleted, invoice-paid, invoice-payment-failed): all use `import type Stripe` which is erased at runtime — no bare specifier execution
- import_map.json entry: correctly maps "stripe" → "https://esm.sh/stripe@19?target=denonext" — the issue is import maps are NOT applied to dynamic-import subgraphs in the hosted runtime

## Evidence

- timestamp: 2026-05-14T10:10:00Z
  source: supabase/functions/stripe-webhook/index.ts lines 92-103
  observation: >
    dispatch() dynamically imports ALL 6 event handlers at the top of the
    function body before the switch statement. If ANY import throws, dispatch()
    throws and the caller returns jsonResponse(500, { error: 'internal' }).
    This explains why ALL event types 500 — the throw happens before the switch.

- timestamp: 2026-05-14T10:10:00Z
  source: supabase/functions/stripe-webhook/events/invoice-upcoming.ts line 20 (pre-fix state)
  observation: >
    invoice-upcoming.ts was the ONLY event handler with a runtime value import:
    `import Stripe from 'stripe'` (not `import type`). All other handlers use
    `import type Stripe from 'stripe'` which is erased at compile time and
    produces no runtime import statement.

- timestamp: 2026-05-14T10:10:00Z
  source: supabase/functions/import_map.json
  observation: >
    Maps "stripe" → "https://esm.sh/stripe@19?target=denonext". This works
    for static imports at module load time. BUT Supabase hosted Edge Runtime
    does NOT apply the import map to the dynamic-import subgraph triggered
    by `await import('./events/invoice-upcoming.ts')` inside dispatch().

- timestamp: 2026-05-14T10:10:00Z
  source: git log -- supabase/functions/stripe-webhook/events/invoice-upcoming.ts
  observation: >
    Commit fa21de1 (2026-05-14T10:01:31) already fixes this: changes
    `import Stripe from 'stripe'` → `import Stripe from 'https://esm.sh/stripe@19?target=denonext'`
    in invoice-upcoming.ts. Commit message explicitly confirms root cause:
    "The bare 'stripe' specifier (resolved via import_map.json) failed at
    runtime in the deployed dynamic-import subgraph — await import('./events/invoice-upcoming.ts')
    threw, making the dispatcher 500 on EVERY webhook event."

- timestamp: 2026-05-14T10:12:00Z
  source: git log --oneline origin/main
  observation: >
    fa21de1 is on local main BUT NOT on origin/main. origin/main is at 989a8ff.
    The fix has been authored but never pushed or deployed.

- timestamp: 2026-05-14T10:30:00Z
  source: supabase functions deploy stripe-webhook (CLI 2.98.2, no Docker)
  observation: >
    After pushing fa21de1, the deploy FAILED to bundle: 'Relative import path
    "stripe" not prefixed' at index.ts:22:20. fa21de1 fixed the bare specifier
    in invoice-upcoming.ts but MISSED the identical runtime value import
    `import Stripe from 'stripe'` at index.ts:22. The deploy bundler does NOT
    consult import_map.json — that map is only wired into the deno.json `test`
    task (--import-map=../import_map.json), not the deploy path. The 11
    `import type Stripe` imports are erased at bundle time and unaffected.
    Corrects the earlier "dynamic-import subgraph" theory: the function was
    not deploying at all with the current CLI; root cause is a plain bare
    value-specifier the bundler can't resolve. Fixed in commit 6f04884.

- timestamp: 2026-05-14T10:40:00Z
  source: curl POST to live endpoint after redeploy
  observation: >
    Post-deploy smoke test returned 401 UNAUTHORIZED_NO_AUTH_HEADER — the
    Supabase gateway was rejecting requests before the function ran. config.toml
    has NO [functions.*] blocks anywhere and `verify_jwt` has never appeared in
    its git history, so deploys default verify_jwt = true. Stripe sends a
    Stripe-Signature header, never a Supabase JWT, so the webhook must have
    verify_jwt = false. Prior reachability (the dispatch() 500s the user saw)
    must have come from a manual --no-verify-jwt deploy never captured in config.
    Fixed by adding [functions.stripe-webhook] verify_jwt = false in commit 9314ec2.

- timestamp: 2026-05-14T10:45:00Z
  source: curl smoke test after final redeploy (verify_jwt = false)
  observation: >
    Unsigned POST → 400 {"error":"missing-signature"}; bogus-signature POST →
    400 {"error":"bad-signature"}. Both are the correct rejections for invalid
    input — proves the gateway passes the request through, the module loads
    (bare-specifier import resolved, no 500 boot crash), and constructEventAsync
    runs. Valid-event → dispatch() → DB-write path still needs a real signed
    `stripe trigger` to confirm end-to-end.

## Resolution

root_cause: >
  Three compounding defects, all of which had to be fixed for the webhook to
  work — the function had effectively never been deployable/reachable in a
  reproducible way:
  (1) Bare `'stripe'` runtime value imports. index.ts:22 AND
  events/invoice-upcoming.ts:20 both did `import Stripe from 'stripe'`. The
  bare specifier only resolves via import_map.json, which is wired ONLY into
  the deno.json `test` task — never into the `supabase functions deploy`
  bundler path. The bundler errors with 'Relative import path "stripe" not
  prefixed', so the function could not be bundled/deployed at all with CLI
  2.98.2. (The 11 `import type Stripe` imports are erased at bundle time and
  are fine.)
  (2) verify_jwt defaulted to true. config.toml had no [functions.*] blocks,
  so the Supabase gateway rejected every request — including Stripe's — with
  401 before the function ran. Stripe sends a Stripe-Signature header, never
  a Supabase JWT.
  (3) The fix from fa21de1 was incomplete — it patched invoice-upcoming.ts
  but not the identical import in index.ts.

fix: >
  - 6f04884: index.ts:22 bare `'stripe'` → `'https://esm.sh/stripe@19?target=denonext'`
    (full esm.sh URL — same pattern as fa21de1 and stripe-checkout/index.ts).
  - 9314ec2: add `[functions.stripe-webhook]` `verify_jwt = false` to
    supabase/config.toml so the setting is reproducible across deploys.
  - fa21de1: invoice-upcoming.ts bare `'stripe'` → full esm.sh URL (pre-existing,
    pushed as part of this session).
  All three pushed to origin/main; stripe-webhook redeployed to project
  ytnsipxxmzgaebkqmokp.

verification: >
  Live smoke test post-deploy: unsigned POST → 400 {"error":"missing-signature"};
  bogus-signature POST → 400 {"error":"bad-signature"}. Confirms gateway passes
  the request through (no 401), the module loads (no 500 boot crash), and
  signature verification runs. REMAINING: a real signed `stripe trigger` /
  live event to confirm the valid-event → dispatch() → DB-write path end-to-end
  (Stripe CLI was not available in the debug environment).

files_changed: supabase/functions/stripe-webhook/index.ts, supabase/functions/stripe-webhook/events/invoice-upcoming.ts, supabase/config.toml

specialist_hint: typescript
