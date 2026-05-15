---
phase: 16-capacitor-mobile-shells-ios-android
plan: 10
type: execute
wave: 4
depends_on: ["16-05", "16-06", "16-07", "16-08", "16-09"]
files_modified:
  - e2e/mobile/photo-soak.spec.ts
  - e2e/mobile/fixtures/seedTestPhotos.ts
  - scripts/sentry-fetch-events.mjs
  - scripts/sentry-app-start-p95.mjs
  - apps/ios/submission-response-templates.md
  - leanshot/.planning/phases/16-capacitor-mobile-shells-ios-android/16-UAT.md
  - leanshot/.planning/phases/16-capacitor-mobile-shells-ios-android/16-LAUNCH-CHECKLIST.md
  - package.json
autonomous: false
requirements: ["MOBILE-01", "MOBILE-02", "MOBILE-08", "MOBILE-09", "MONEY-06"]
tags: ["mobile", "uat", "soak", "app-store", "play-store", "sentry", "revenuecat"]
user_setup:
  - service: apple-sandbox-tester
    why: "MONEY-06 manual sandbox purchase UAT (R6 — RC sandbox automation not feasible per A4 of RESEARCH)"
    dashboard_config:
      - task: "Create Apple Sandbox tester account"
        location: "App Store Connect → Users and Access → Sandbox → Testers"
      - task: "Sign Sandbox tester into iPhone Settings → Developer → Sandbox Apple Account"
        location: "iPhone Settings (real device, not simulator)"
  - service: sentry
    why: "Auto-verify crash telemetry + cold-start p95 via Sentry events API (per feedback_verify_human_uat_via_cli)"
    env_vars:
      - name: SENTRY_AUTH_TOKEN
        source: "Sentry → Settings → Auth Tokens (scope: event:read, project:read)"
      - name: SENTRY_ORG_SLUG
        source: "Sentry org slug (URL segment)"
      - name: SENTRY_PROJECT_SLUG
        source: "Sentry project slug (Phase 1 project reused per D-17)"

must_haves:
  truths:
    - "200-photo gallery scroll runs 30 min in CI without fatal Sentry event and with < 3 memoryWarning events"
    - "TestFlight build accumulates ≥7 days of soak with zero fatal Sentry events tagged release=ios@<version>"
    - "Play Internal build accumulates ≥3 days of soak with zero fatal Sentry events tagged release=android@<version>"
    - "Sentry transaction app.start p95 over the 7-day TestFlight window is ≤10s"
    - "Manual Apple Sandbox purchase produces an entitlement, a revenuecat-webhook delivery, and a subscriptions row with provider='revenuecat'"
    - "App Store submission-response template covers D-13 (page-builder admin-authored) and D-24 (clinic-owner Stripe Portal)"
    - "Phase gate: no App Store / Play Store production promotion occurs until all UAT signals are green and captured in 16-LAUNCH-CHECKLIST.md"
  artifacts:
    - path: "e2e/mobile/photo-soak.spec.ts"
      provides: "30-min 200-photo soak with Sentry + memoryWarning assertions"
      contains: "test('200-photo gallery scroll"
    - path: "e2e/mobile/fixtures/seedTestPhotos.ts"
      provides: "Service-role admin client seeding 200 ~3MB photos into the test user's Storage bucket"
      contains: "export async function seedTestPhotos"
    - path: "scripts/sentry-fetch-events.mjs"
      provides: "Sentry API client for fatal-event counting (used by soak spec + UAT scripts)"
      contains: "fetchSentryEventsBySession"
    - path: "scripts/sentry-app-start-p95.mjs"
      provides: "Cold-start p95 telemetry check (Sentry transaction app.start over a date range)"
      contains: "app.start"
    - path: "apps/ios/submission-response-templates.md"
      provides: "Pre-written Apple §3.1.1 + §4.7 review-response copy"
      contains: "§3.1.1"
    - path: "leanshot/.planning/phases/16-capacitor-mobile-shells-ios-android/16-UAT.md"
      provides: "Manual UAT log (TestFlight day-by-day, Play Internal day-by-day, Sandbox purchase trace)"
    - path: "leanshot/.planning/phases/16-capacitor-mobile-shells-ios-android/16-LAUNCH-CHECKLIST.md"
      provides: "Phase-gate checklist controlling promotion to App Store / Play Store production"
  key_links:
    - from: "e2e/mobile/photo-soak.spec.ts"
      to: "e2e/mobile/fixtures/seedTestPhotos.ts"
      via: "seedTestPhotos({ count: 200, sizeMB: 3 })"
      pattern: "seedTestPhotos\\("
    - from: "e2e/mobile/photo-soak.spec.ts"
      to: "scripts/sentry-fetch-events.mjs"
      via: "fetchSentryEventsBySession(session.id) — imports or invokes the script"
      pattern: "fetchSentryEventsBySession"
    - from: "scripts/sentry-app-start-p95.mjs"
      to: "Sentry events API"
      via: "https://sentry.io/api/0/organizations/{org}/events/ — transaction=app.start"
      pattern: "app\\.start"
    - from: "apps/ios/submission-response-templates.md"
      to: "D-13 + D-24 mitigation"
      via: "Plan 16-05 PricingIOS.tsx hides Stripe + clinic_owner link to leanshot.app/clinic/billing"
      pattern: "clinic/billing"
    - from: "16-LAUNCH-CHECKLIST.md"
      to: "16-UAT.md"
      via: "Each phase-gate row references a UAT-log entry by date + Sentry query URL"
      pattern: "16-UAT\\.md"
---

<objective>
Phase-gate Phase 16 by validating the full mobile stack (iOS + Android) under
production-equivalent conditions before App Store / Play Store production
promotion.

Purpose: Catch WKWebView OOM and native crashes (R5 second-biggest risk per
RESEARCH §"Risk Surface") on real devices, validate MONEY-06 end-to-end against
Apple StoreKit Sandbox (R6 — RC sandbox automation infeasible per A4), and
ship a pre-written submission-response template (R7) that mitigates Apple
§3.1.1 + §4.7 review risk introduced by D-13 (page-builder runtime in the iOS
bundle) and D-24 (clinic-owner Stripe Portal carve-out).

Output:
- `e2e/mobile/photo-soak.spec.ts` — automated 30-min OOM harness per RESEARCH
  §"MOBILE-08 200-Photo OOM Soak Protocol"
- 7-day TestFlight + 3-day Play Internal soak gates (D-15) — manual UAT
  checkpoints with Sentry-API-verified pass criteria
- Apple Sandbox manual purchase UAT (R6)
- Apple §3.1.1 + §4.7 submission-response template at
  `apps/ios/submission-response-templates.md`
- Cold-start p95 ≤10s verification via Sentry `app.start` transaction
- Promotion-gate checklist that blocks production rollout until all UAT
  signals are green
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@leanshot/.planning/PROJECT.md
@leanshot/.planning/ROADMAP.md
@leanshot/.planning/STATE.md
@leanshot/.planning/phases/16-capacitor-mobile-shells-ios-android/16-CONTEXT.md
@leanshot/.planning/phases/16-capacitor-mobile-shells-ios-android/16-RESEARCH.md
@leanshot/.planning/phases/16-capacitor-mobile-shells-ios-android/16-VALIDATION.md
@leanshot/.planning/phases/16-capacitor-mobile-shells-ios-android/16-PLAN-OUTLINE.md

<!-- Direct dependencies — read their SUMMARYs once written -->
@leanshot/.planning/phases/16-capacitor-mobile-shells-ios-android/16-05-SUMMARY.md
@leanshot/.planning/phases/16-capacitor-mobile-shells-ios-android/16-06-SUMMARY.md
@leanshot/.planning/phases/16-capacitor-mobile-shells-ios-android/16-07-SUMMARY.md
@leanshot/.planning/phases/16-capacitor-mobile-shells-ios-android/16-08-SUMMARY.md
@leanshot/.planning/phases/16-capacitor-mobile-shells-ios-android/16-09-SUMMARY.md

<interfaces>
<!-- Key contracts the executor will consume — extracted ahead of time so no codebase scavenger-hunt. -->

From RESEARCH §"MOBILE-08 200-Photo OOM Soak Protocol" (canonical harness):
```
- 200 photos × ~3MB each seeded into the test user's Supabase Storage bucket
- Loop 30 minutes: scrollTo(bottom) → wait 2s → scrollTo(top) → wait 2s
- Assert fatalSentryEvents.length === 0
- Assert window.__memWarnCount < 3 (tolerate 2 system-noise events; fail at 3+)
- Capacitor exposes memoryWarning event; the wrapper increments
  window.__memWarnCount — wiring lives in Plan 16-02 native bridge or this
  plan if missing (verify against 16-02-SUMMARY before adding)
```

From RESEARCH §"MONEY-06 IAP Flow" (Sandbox happy path — manual portion only here; Playwright spec belongs to Plan 16-05):
```
- Configure Purchases with RC_SANDBOX_KEY
- offerings.current.availablePackages.find(p => p.product.identifier === 'app.leanshot.plus.monthly')
- After purchasePackage:
  - customerInfo.entitlements.active['plus'] is defined
  - subscriptions row with provider='revenuecat', status='INITIAL_PURCHASE' (poll up to 6 × 5s)
  - getEffectiveTier(userId) === 'paid'
```

Sentry Events API contract (used by scripts/sentry-fetch-events.mjs + sentry-app-start-p95.mjs):
```
GET https://sentry.io/api/0/organizations/{SENTRY_ORG_SLUG}/events/
Headers: Authorization: Bearer ${SENTRY_AUTH_TOKEN}
Query params:
  - project: {numeric project id} (resolve from SENTRY_PROJECT_SLUG)
  - field: id,level,release,session.id,timestamp,transaction
  - query: "release:ios@<ver> level:fatal" (fatal-count)
          OR "transaction:app.start release:ios@<ver>" (cold-start p95)
  - statsPeriod: 7d / 3d
Pagination: cursor in Link header (rel="next") — paginate until exhausted.
```

From `feedback_verify_human_uat_via_cli` (project memory):
> "gsd-verifier over-labels deploy/vendor checkpoints 'human_needed'; CLI auto-verifies most.
>  Phase 14: 6/6 verified via CLI, only the Stripe key needed from the user."
Apply: Wherever a UAT row CAN be verified via Sentry API, fastlane, or
App Store Connect API, do that — do not ask the user to paste counts back.
Only ask the user to (a) configure the Sandbox tester device, (b) run the
manual purchase, (c) approve the TestFlight build for external testers if the
soak crosses the public-promote line.

From CONTEXT D-04 (immediate-downgrade asymmetry):
The UAT submission-response template must NOT promise Stripe grace-period
behavior for iOS — D-04 deliberately diverges. Apple Settings shows the user
as no-longer-subscribed; this is correct behavior.

From CONTEXT D-13 (page-builder runtime risk):
The iOS bundle includes the Page Builder runtime (renders DB-stored block
trees from Phase 15). Mitigation language: "admin-authored only; LeanShot
operators write blocks via the operator console; users cannot author
HTML/JS." (Per RESEARCH Pitfall 10 — until a future phase introduces
user-authored blocks, §4.7 does not trigger.)

From CONTEXT D-24 (clinic-owner Stripe Portal carve-out):
Submission-response language: "Clinic billing is managed at
leanshot.app/clinic/billing for B2B accounts only. This is not a digital
subscription consumed by the iOS app — it is a service-administration
portal for clinic operators. Falls under Apple §3.1.1's 'service consumed
elsewhere' carve-out." Plan 16-05 implements the hide-IAP-for-clinic_owner
behavior; this plan documents the reviewer-facing justification.
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: 200-photo soak fixture + spec wiring</name>
  <files>e2e/mobile/photo-soak.spec.ts, e2e/mobile/fixtures/seedTestPhotos.ts, scripts/sentry-fetch-events.mjs, package.json</files>
  <read_first>
    - leanshot/.planning/phases/16-capacitor-mobile-shells-ios-android/16-RESEARCH.md §"MOBILE-08 200-Photo OOM Soak Protocol" (lines ~805–833)
    - leanshot/.planning/phases/16-capacitor-mobile-shells-ios-android/16-02-SUMMARY.md to confirm where memoryWarning → window.__memWarnCount is wired (if absent, wire it here in deeplink.ts or a new photos-page mount-effect — DO NOT scatter across components)
    - playwright.config.ts to confirm the `mobile` project exists (Wave 0 / Plan 16-00 should have added it; if missing, halt and surface a Wave-0 gap)
    - leanshot/src/lib/page-builder/* and leanshot/src/components/dashboard/tabs/PhotosTab.tsx (or whatever Phase 13 named the photo tab) to find the gallery scroll container — assertions must scroll the container, not window if the gallery is in a panel
    - reference_supabase_worktree_temp_state.md — fixture needs supabase/.temp/* present if invoked in a worktree
    - reference_rls_fixture_gotrueclient_flake.md — fixture uses SERVICE-ROLE-MINTED JWT via `headers.Authorization`, NOT `signInWithPassword`
  </read_first>
  <action>
    Implement `e2e/mobile/fixtures/seedTestPhotos.ts`:
    - `export async function seedTestPhotos({ userId, count, sizeMB }: { userId: string; count: number; sizeMB: number }): Promise<{ paths: string[] }>` per the interface block above.
    - Use `@supabase/supabase-js` with SUPABASE_SERVICE_ROLE_KEY env var to build an admin client. NEVER call `signInWithPassword` — this is the project rule from `reference_rls_fixture_gotrueclient_flake.md`. If a per-test JWT is needed for downstream RLS, mint it via `auth.admin.generateLink` or sign a JWT with the project's JWT secret (HS256, `sub: userId, role: 'authenticated'`) and pass via `headers.Authorization`.
    - Generate deterministic ~3MB photo blobs in-process (use a constant Uint8Array filled with random-but-deterministic-by-seed bytes, NOT real images — the harness validates decode/scroll load, not content. Document this in a comment).
    - Upload to `storage.from('photos').upload(`${userId}/${index}.png`, blob, { contentType: 'image/png' })` in parallel batches of 20 to avoid rate limits.
    - Return `paths` for cleanup.
    - Export a companion `cleanupTestPhotos({ userId })` that deletes all `${userId}/` Storage entries via the service-role admin client AND deletes any DB rows referencing those Storage paths (check leanshot/src/lib/storage.ts or the photos table schema for the FK chain).
    - Per `feedback_rls_per_file_slug_prefix.md`: use a file-scoped slug prefix in the userId (e.g. `photo-soak-${randomUUID()}`) so parallel test files do not clobber.

    Implement `scripts/sentry-fetch-events.mjs` (Node ESM):
    - `export async function fetchSentryEventsBySession(sessionId, { release, level, statsPeriod = '30m' })`
    - `export async function fetchSentryEventsByQuery(query, { statsPeriod, project })`
    - Reads `SENTRY_AUTH_TOKEN`, `SENTRY_ORG_SLUG`, `SENTRY_PROJECT_SLUG` from env; fails loudly with the exact env var name if missing.
    - Hits `GET /api/0/organizations/{org}/events/` with the contract documented in `<interfaces>` above.
    - Paginates via the `Link: <…>; rel="next"` header until exhausted.
    - Returns `Array<{ id, level, release, transaction, timestamp, session: { id } }>`.
    - CLI mode: `node scripts/sentry-fetch-events.mjs --query "release:ios@1.0.0 level:fatal" --statsPeriod 7d` prints the count + a JSON dump.

    Implement `e2e/mobile/photo-soak.spec.ts`:
    - Follow the RESEARCH harness verbatim (30-min loop, 2s scroll waits, both assertions).
    - Use `test.setTimeout(35 * 60_000)` (30 min loop + 5 min seed/teardown headroom).
    - Mark the spec `test.describe('@soak', () => { ... })` so CI can gate it behind a `--grep @soak` flag — the default Playwright run MUST NOT execute the 30-min loop.
    - `test.beforeAll`: seed 200 photos. `test.afterAll`: cleanup.
    - Inside the test: capture `sessionId` from a `window.__sentrySessionId` global set by Plan 16-04's Sentry init (verify it is set; if missing in 16-04-SUMMARY, set it in `src/lib/sentry.ts` here via a single-line `window.__sentrySessionId = Sentry.getCurrentScope().getSession()?.sid` after init).
    - Assert `fatalSentryEvents.length === 0` AND `memoryWarnings < 3`.
    - On failure, capture Sentry event IDs into the test failure message for triage.

    `package.json` script additions (use `npm pkg set` to avoid clobbering existing scripts):
    - `"test:soak": "playwright test --project=mobile --grep @soak"`
    - `"sentry:events": "node scripts/sentry-fetch-events.mjs"`
    - `"sentry:app-start-p95": "node scripts/sentry-app-start-p95.mjs"`

    Commit with `git commit -- e2e/mobile/photo-soak.spec.ts e2e/mobile/fixtures/seedTestPhotos.ts scripts/sentry-fetch-events.mjs package.json` per `feedback_parallel_executor_git_isolation.md`.
  </action>
  <acceptance_criteria>
    - `npm run typecheck` passes
    - `node scripts/sentry-fetch-events.mjs --query "level:fatal" --statsPeriod 1h` runs and prints a count (no Sentry results acceptable; runtime errors not)
    - `npx playwright test --project=mobile --grep @soak --list` lists exactly one test
    - Default `npm run test:e2e` does NOT include the @soak test (grep does not run by default)
    - `seedTestPhotos` is callable from a unit test that mocks supabase-js (do not actually upload during typecheck) — write a 1-test smoke that asserts the function signature + that it builds 200 upload promises
  </acceptance_criteria>
  <verify>
    <automated>npm run typecheck &amp;&amp; npx playwright test --project=mobile --grep @soak --list &amp;&amp; npm run test:unit -- e2e/mobile/fixtures/seedTestPhotos.test.ts</automated>
  </verify>
  <done>Photo-soak harness is committed, typechecks, and is gated behind `@soak` grep so it does not run in default CI.</done>
</task>

<task type="auto">
  <name>Task 2: Cold-start p95 telemetry script + submission-response template</name>
  <files>scripts/sentry-app-start-p95.mjs, apps/ios/submission-response-templates.md</files>
  <read_first>
    - leanshot/.planning/phases/16-capacitor-mobile-shells-ios-android/16-04-SUMMARY.md to confirm Sentry SDK is initialized BEFORE first render and the `app.start` transaction is wrapped around the root render (if missing, surface as a gap — the cold-start p95 is meaningless without this transaction)
    - leanshot/.planning/phases/16-capacitor-mobile-shells-ios-android/16-09-SUMMARY.md to confirm fastlane lanes tag Sentry releases as `ios@<version>` / `android@<version>` (D-17)
    - 16-RESEARCH.md §"Pitfall 4: Apple §3.1.1 Anti-Steering" (lines ~677–687) for the exact reviewer-note pattern
    - 16-RESEARCH.md §"Pitfall 10: D-13 Page Builder Runtime on iOS" (lines ~720–724) for §4.7 framing
    - 16-CONTEXT.md D-24 (clinic-owner Stripe Portal carve-out) for §3.1.1 service-consumed-elsewhere language
    - leanshot/.planning/phases/16-capacitor-mobile-shells-ios-android/16-05-SUMMARY.md to confirm clinic_owner IAP-hide is shipped and links to `leanshot.app/clinic/billing` (the submission-response cites this code path)
  </read_first>
  <action>
    Implement `scripts/sentry-app-start-p95.mjs` (Node ESM, ~80 lines):
    - Reuses `fetchSentryEventsByQuery` from Task 1's script (import via relative path).
    - `node scripts/sentry-app-start-p95.mjs --release ios@<ver> --statsPeriod 7d` queries `transaction:app.start release:ios@<ver>`, extracts the `transaction.duration` field from each event, computes p95, prints PASS/FAIL against the ≤10000ms threshold per MOBILE-08 cold-start criterion.
    - Exit code 0 on PASS, exit code 1 on FAIL, exit code 2 on insufficient samples (< 20 events — refuses to compute a confident p95).
    - Accepts `--threshold-ms` flag (default 10000) so the same script can verify Android (`--release android@<ver>`).
    - On success, prints `{ release, p95Ms, sampleSize, pass: true }` as JSON for piping into the LAUNCH-CHECKLIST.md update step in Task 4.

    Implement `apps/ios/submission-response-templates.md`. Structure:
    ```
    # Apple App Review Submission Response Templates

    > Pre-written copy for App Store Connect "Resolution Center" responses.
    > Filed proactively in the build's reviewer-note field on first submission.

    ## Reviewer-Note (filed at first submission)

    Hello App Review team,

    LeanShot is a GLP-1 self-tracking app. Two design choices may benefit from
    context before review:

    ### §3.1.1 — Clinic billing managed elsewhere
    [D-24 language — verbatim from <interfaces> block above; cite the
    specific iOS code path: PricingIOS.tsx hides Stripe checkout entirely for
    accounts with role='clinic_owner' and shows an explanatory link to
    leanshot.app/clinic/billing. This is Apple §3.1.1's "service consumed
    elsewhere" carve-out — clinic operators administer their B2B clinic
    seats; this is not an in-app digital subscription.]

    ### §4.7 — Page Builder runtime is admin-authored content only
    [D-13 language — verbatim from <interfaces> block. Cite:
    src/lib/page-builder/* renders block-trees stored in DB by LeanShot
    operators only. Users cannot author HTML/JS blocks. If a future release
    introduces user-authored blocks, that release will ship an iOS-safe-mode
    flag that disables block rendering on iOS.]

    Plus + Yearly purchases use RevenueCat exclusively (Apple StoreKit).
    Web-tier reconciliation via revenuecat-webhook Edge Function — server-
    side; iOS app never calls Stripe.

    ## §3.1.1 Rejection Response (if app is rejected for §3.1.1)
    [Same content as the reviewer note, restated as a reply. Include a build
    number reference and a 60-second screen-capture link if available.]

    ## §4.7 Rejection Response (if app is rejected for §4.7)
    [Cite Pitfall 10 mitigation: until v1.3, no user-authored blocks ship.
    Offer to demo via TestFlight the admin-only authoring surface, which
    lives at leanshot.app/admin/page-builder behind operator auth.]

    ## §3.1.1(a) Anti-Steering Response (DE/ES/FR storefronts)
    [Reserved — DE/ES/FR localized listings deferred to v1.2.1 per outline R4.
    Section stays as a stub; v1.2.1 ASO planner fills before non-US submission.]
    ```
    Length: 200–400 lines including the rejection responses. Reference D-13 and D-24 by ID throughout for traceability.

    Commit with `git commit -- scripts/sentry-app-start-p95.mjs apps/ios/submission-response-templates.md`.
  </action>
  <acceptance_criteria>
    - `node scripts/sentry-app-start-p95.mjs --help` prints usage including `--release`, `--statsPeriod`, `--threshold-ms`
    - Script exits with code 2 (not 0 or 1) when invoked with a release that has zero recorded `app.start` transactions
    - `apps/ios/submission-response-templates.md` mentions both `D-13` and `D-24` strings literally (greppable)
    - Template mentions `leanshot.app/clinic/billing` literally
    - Template includes both proactive reviewer-note AND rejection-response variants for §3.1.1 and §4.7
  </acceptance_criteria>
  <verify>
    <automated>node scripts/sentry-app-start-p95.mjs --help &gt; /dev/null &amp;&amp; grep -q "D-13" apps/ios/submission-response-templates.md &amp;&amp; grep -q "D-24" apps/ios/submission-response-templates.md &amp;&amp; grep -q "clinic/billing" apps/ios/submission-response-templates.md &amp;&amp; grep -q "§3.1.1" apps/ios/submission-response-templates.md &amp;&amp; grep -q "§4.7" apps/ios/submission-response-templates.md</automated>
  </verify>
  <done>Cold-start p95 script is runnable + correctly exits on insufficient samples; submission-response template covers D-13 + D-24 with greppable IDs and proactive + rejection-response variants.</done>
</task>

<task type="checkpoint:human-verify" gate="blocking">
  <name>Task 3: Manual UAT — TestFlight 7-day + Play Internal 3-day soak + Sandbox purchase</name>
  <what-built>
    - Plan 16-09 fastlane lane has uploaded the latest TestFlight build (iOS) and Play Internal AAB (Android) with Sentry release tags `ios@<ver>` and `android@<ver>`.
    - Plan 16-05 IAP UI (PricingIOS.tsx) is wired against the RC Sandbox key (RC dashboard ENV: sandbox).
    - Tasks 1 + 2 of this plan are committed; `scripts/sentry-fetch-events.mjs` + `scripts/sentry-app-start-p95.mjs` are callable.
    - `e2e/mobile/photo-soak.spec.ts` has been run once locally against a TestFlight build via Capacitor live-reload (`npm run test:soak`) and exited green.
  </what-built>
  <how-to-verify>
    Open `leanshot/.planning/phases/16-capacitor-mobile-shells-ios-android/16-UAT.md`
    (executor creates it as a structured log in Task 4 below; for this checkpoint, the executor pre-creates the skeleton). Fill in each row over the soak window.

    ## Sequence (executor performs CLI parts; pauses for user when checkpoint title says "USER:")

    ### 1. TestFlight install + Day-0 baseline (USER — once)
    - Install the latest TestFlight build on a real iPhone (iPhone 12 or newer; D-08 OOM target is iPhone 12 / 4GB).
    - Launch → land on Home in ≤10s (visual; if >10s, log in 16-UAT.md and continue — formal cold-start measurement is via Task 4 Sentry script, not stopwatch).
    - Reply with `testflight-installed YYYY-MM-DD HH:MM ios@<ver>` so the executor knows Day 0.

    ### 2. Play Internal install + Day-0 baseline (USER — once)
    - Install the latest Play Internal AAB on a real Android 14+ device.
    - Launch → land on Home in ≤10s.
    - Reply with `play-installed YYYY-MM-DD HH:MM android@<ver>`.

    ### 3. Apple Sandbox purchase UAT (USER — once)
    - Sign the Sandbox Apple ID into iPhone Settings → Developer → Sandbox Apple Account (per `user_setup` frontmatter).
    - Open the TestFlight build, navigate to `/pricing`.
    - Tap "Subscribe — Plus Monthly". Complete the Sandbox purchase prompt.
    - In a second device or laptop, the executor will:
      - `gsd-sdk query supabase.query "SELECT * FROM subscriptions WHERE provider='revenuecat' ORDER BY created_at DESC LIMIT 1"` to confirm the webhook landed a row
      - `node scripts/sentry-fetch-events.mjs --query "transaction:revenuecat-webhook" --statsPeriod 1h` to confirm zero webhook errors
    - Reply with `sandbox-purchase-done <YYYY-MM-DD HH:MM>` once you see the in-app paywall flip to "Plus active".

    ### 4. 7-day TestFlight soak (USER — passive)
    - Keep the TestFlight build installed and use it daily for 7 calendar days.
    - At least once per day, scroll the Photos tab (helps trigger Sentry breadcrumbs if OOM occurs).
    - Executor polls Sentry once per day via:
      `node scripts/sentry-fetch-events.mjs --query "release:ios@<ver> level:fatal" --statsPeriod 24h`
      and logs the count in 16-UAT.md.
    - On Day 7, executor runs `node scripts/sentry-app-start-p95.mjs --release ios@<ver> --statsPeriod 7d --threshold-ms 10000` and pastes the JSON output into 16-UAT.md.

    ### 5. 3-day Play Internal soak (USER — passive)
    - Same protocol as TestFlight, but 3 calendar days minimum.
    - Executor polls `release:android@<ver> level:fatal` daily.

    ### Pass criteria (executor enforces; do not approve if any row is red)
    - TestFlight: fatal-event count over 7-day window = 0
    - Play Internal: fatal-event count over 3-day window = 0
    - Cold-start p95: `node scripts/sentry-app-start-p95.mjs --release ios@<ver> --statsPeriod 7d` exits 0 (≤10000ms with ≥20 samples) AND same for Android over 3d
    - Sandbox purchase: subscriptions row exists with provider='revenuecat' AND customerInfo.entitlements.active['plus'] is truthy in-app
    - 200-photo soak (Task 1): one local run exited green (memWarnings < 3, 0 fatal)
  </how-to-verify>
  <resume-signal>
    User replies with `soak-pass <iso-date>` to approve all signals green.
    User replies with `soak-fail <reason>` to halt — executor opens a remediation
    sub-plan (likely a new plan 16-11 or a return to Plan 16-05/16-06 to fix
    the failure mode). Do NOT promote to production on partial-pass.
  </resume-signal>
</task>

<task type="auto">
  <name>Task 4: 16-UAT.md + 16-LAUNCH-CHECKLIST.md (phase-gate doc)</name>
  <files>leanshot/.planning/phases/16-capacitor-mobile-shells-ios-android/16-UAT.md, leanshot/.planning/phases/16-capacitor-mobile-shells-ios-android/16-LAUNCH-CHECKLIST.md</files>
  <read_first>
    - 16-VALIDATION.md §"Manual-Only Verifications" (the 5-row table is the canonical source for UAT row titles)
    - leanshot/.planning/v1.1-MILESTONE-AUDIT.md format for tier-of-evidence patterns (memory: project_v1.2_scoping_in_progress)
    - 16-CONTEXT.md D-15 (7-day TestFlight + 3-day Play Internal cadence is the SLA)
  </read_first>
  <action>
    Create `16-UAT.md` (the day-by-day log Task 3 fills in). Schema:
    ```
    ---
    phase: 16
    type: manual-uat
    status: in-progress | passed | failed
    testflight_build: ios@<ver>
    play_build: android@<ver>
    started: <iso-date>
    ---

    ## Day 0 baselines
    | Channel | Build | Installed (UTC) | Cold-start (visual) | Notes |
    |---------|-------|------------------|---------------------|-------|

    ## TestFlight soak (D-15: ≥7 days, target 0 fatal)
    | Day | Date | fatal count | Sentry query | Notes |
    |-----|------|-------------|--------------|-------|
    | 0 |  | 0 | release:ios@<ver> level:fatal statsPeriod=24h | baseline |
    | 1 |  |  |  |  |
    ... (rows for Day 1..7)

    ## Play Internal soak (D-15: ≥3 days, target 0 fatal)
    (rows for Day 1..3)

    ## Sandbox purchase trace
    | Step | Expected | Observed | Pass |
    |------|----------|----------|------|
    | Purchase prompt accepted |  |  |  |
    | customerInfo.entitlements.active['plus'] |  |  |  |
    | subscriptions row provider='revenuecat' |  |  |  |
    | revenuecat-webhook 0 errors (Sentry) |  |  |  |
    | In-app paywall flips to 'Plus active' |  |  |  |

    ## Cold-start p95 (MOBILE-08 cold-start criterion)
    | Platform | Window | p95 ms | Sample size | Pass? | sentry-app-start-p95 output |
    |----------|--------|--------|-------------|-------|------------------------------|

    ## Local 200-photo soak (this plan Task 1)
    | Run | Date | Fatal events | memWarnings | Pass? |

    ## Submission-response template
    | Doc | Path | Status |
    | App Store reviewer-note | apps/ios/submission-response-templates.md | drafted | filed at submission |

    ## Final UAT verdict
    [executor fills with `passed` / `failed` and the date]
    ```

    Create `16-LAUNCH-CHECKLIST.md`. This is the phase-gate doc — explicit promote/no-promote signal.
    ```
    ---
    phase: 16
    type: phase-gate
    status: draft | ready-to-promote | promoted
    ---

    # Phase 16 Launch Checklist

    > **No production promotion until every row below is checked AND linked
    > to its evidence file or Sentry query URL.**
    > Per CONTEXT D-15: 7-day TestFlight + 3-day Play Internal minimum.

    ## Soak gates (D-15)
    - [ ] TestFlight 7-day soak: 0 fatal events  → evidence: `16-UAT.md` TestFlight table
    - [ ] Play Internal 3-day soak: 0 fatal events → evidence: `16-UAT.md` Play table
    - [ ] Local 200-photo 30-min soak: pass → evidence: `e2e/mobile/photo-soak.spec.ts` CI run URL or local terminal output

    ## Telemetry gates (MOBILE-08, MOBILE-09)
    - [ ] iOS cold-start p95 ≤10s over 7-day window → evidence: `sentry-app-start-p95.mjs --release ios@<ver> --statsPeriod 7d` JSON output (pasted into `16-UAT.md`)
    - [ ] Android cold-start p95 ≤10s over 3-day window → evidence: same script with --release android@<ver>
    - [ ] Sentry receives test crash (Wave 0 + Wave 3 from VALIDATION) → evidence: `scripts/sentry-test-crash.mjs` exit 0

    ## IAP gate (MONEY-06)
    - [ ] Sandbox purchase: customerInfo.entitlements.active['plus'] truthy → evidence: `16-UAT.md` Sandbox trace
    - [ ] subscriptions row with provider='revenuecat' exists → evidence: SQL query output in `16-UAT.md`
    - [ ] revenuecat-webhook: 0 5xx over 7 days → evidence: Sentry query `transaction:revenuecat-webhook statsPeriod=7d`

    ## App Store review gates (R7)
    - [ ] `apps/ios/submission-response-templates.md` covers D-13 + D-24 → evidence: file path + grep result
    - [ ] Privacy Manifest validated (Plan 16-07) → evidence: `audit-privacy-manifest.mjs` exit 0
    - [ ] AASA reachable on `leanshot.app` AND `app.leanshot.app` (Plan 16-03) → evidence: CI curl-check log

    ## Promotion sign-off
    - [ ] User has explicitly approved soak-pass via Task 3 resume-signal
    - [ ] All open Sentry issues at level=error or fatal are triaged (closed, won't-fix-with-justification, or fix-shipping-in-v1.2.1)
    - [ ] `npm run test` passes on `main` at the release SHA
    - [ ] `npm run lint && npm run typecheck` pass on `main` at the release SHA

    ## Promotion log
    - **iOS App Store production:** `<date> | <build> | <release-notes-link>` (filled at promotion)
    - **Google Play production:** `<date> | <build> | <release-notes-link>` (filled at promotion)

    ## Phase verdict
    `[status: ready-to-promote]` set when every row is checked.
    `[status: promoted]` set after both stores accept the build.
    Until then: **no fastlane lane should target a production track.**
    ```

    Both files committed with a git commit message that names the requirements
    they close: `docs(16-10): UAT log + launch-checklist scaffold for MOBILE-01/02/08/09 + MONEY-06`.
    `git commit -- leanshot/.planning/phases/16-capacitor-mobile-shells-ios-android/16-UAT.md leanshot/.planning/phases/16-capacitor-mobile-shells-ios-android/16-LAUNCH-CHECKLIST.md` per parallel-executor isolation rule.
  </action>
  <acceptance_criteria>
    - Both files exist at the documented paths
    - 16-UAT.md frontmatter has `status: in-progress` initially
    - 16-LAUNCH-CHECKLIST.md frontmatter has `status: draft` initially
    - Every row in 16-LAUNCH-CHECKLIST.md has an "evidence:" link to a concrete artifact (file path or Sentry script + arguments)
    - `grep -c "evidence:" 16-LAUNCH-CHECKLIST.md` ≥ 12 (one per gate row)
    - The phrase "no fastlane lane should target a production track" appears verbatim (executor-facing reminder)
  </acceptance_criteria>
  <verify>
    <automated>test -f leanshot/.planning/phases/16-capacitor-mobile-shells-ios-android/16-UAT.md &amp;&amp; test -f leanshot/.planning/phases/16-capacitor-mobile-shells-ios-android/16-LAUNCH-CHECKLIST.md &amp;&amp; [ $(grep -v '^#' leanshot/.planning/phases/16-capacitor-mobile-shells-ios-android/16-LAUNCH-CHECKLIST.md | grep -c 'evidence:') -ge 12 ] &amp;&amp; grep -q "no fastlane lane should target a production track" leanshot/.planning/phases/16-capacitor-mobile-shells-ios-android/16-LAUNCH-CHECKLIST.md</automated>
  </verify>
  <done>16-UAT.md + 16-LAUNCH-CHECKLIST.md committed; both are populated with evidence-linked rows and status frontmatter; no production promotion can occur until the checklist flips to `status: ready-to-promote`.</done>
</task>

<task type="checkpoint:human-verify" gate="blocking">
  <name>Task 5: Final phase-gate sign-off — promote to App Store + Play Store production</name>
  <what-built>
    - Tasks 1–4 complete, committed, and on main.
    - User has replied `soak-pass <date>` in Task 3.
    - `16-LAUNCH-CHECKLIST.md` has every row checked and `status: ready-to-promote`.
    - Executor has pasted the final Sentry script outputs into `16-UAT.md` and verified zero fatal events.
  </what-built>
  <how-to-verify>
    Executor preflight (do BEFORE pausing for the user):
    1. `cat leanshot/.planning/phases/16-capacitor-mobile-shells-ios-android/16-LAUNCH-CHECKLIST.md | grep '\[ \]'` MUST return 0 unchecked rows.
    2. `grep "status:" leanshot/.planning/phases/16-capacitor-mobile-shells-ios-android/16-LAUNCH-CHECKLIST.md` MUST show `status: ready-to-promote`.
    3. `grep "status:" leanshot/.planning/phases/16-capacitor-mobile-shells-ios-android/16-UAT.md` MUST show `status: passed`.
    4. Verify fastlane lanes have a `--production` flag and that the executor has NOT run it yet (grep recent shell history or surface `git log --oneline -5` for confirmation).

    Then pause for the user:

    "All Phase 16 UAT gates are green. Ready to promote?

    - iOS: `bundle exec fastlane ios deploy_appstore` (filed for review)
    - Android: `bundle exec fastlane android deploy_play_production` (production track)

    Note: Apple review takes 24–72 hours after `deploy_appstore`. Google Play
    review takes 1–7 days after `deploy_play_production`. The store-side
    reviewer-note (drafted in `apps/ios/submission-response-templates.md`) will
    be filed automatically by the fastlane lane.

    Reply `promote-ios` to dispatch iOS only.
    Reply `promote-android` to dispatch Android only.
    Reply `promote-both` to dispatch both lanes.
    Reply `hold` to delay (the build stays in TestFlight / Play Internal)."
  </how-to-verify>
  <resume-signal>
    `promote-ios` | `promote-android` | `promote-both` | `hold`

    On `promote-*`:
    - Executor runs the fastlane lane(s) from a clean main checkout.
    - On lane success, executor flips `16-LAUNCH-CHECKLIST.md` `status:
      ready-to-promote` → `status: promoted`, fills the Promotion log rows
      with the date + build + release-notes-link, commits, and writes the
      Phase 16 SUMMARY.md.
    - The phase is verifier-ready (`/gsd-verify-work 16`) only after this
      checkpoint resolves.

    On `hold`:
    - Executor stops. Plan 16-10 SUMMARY notes that promotion is deferred.
      Phase remains in "soak passed, production held" state. A future
      session resumes by re-running Task 5 only.
  </resume-signal>
</task>

</tasks>

<threat_model>

## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| Sentry API → CI | `SENTRY_AUTH_TOKEN` grants read access to crash events; scoped to `event:read project:read` only |
| Apple StoreKit → RevenueCat → revenuecat-webhook → Supabase | Sandbox purchase crosses 4 trust zones; each transition validated |
| App Store Connect / Play Console → fastlane → production track | Final production promotion is the highest-stakes boundary; gated behind Task 5 checkpoint |
| User device → Sentry | Crash events contain breadcrumbs that may include PII (HBNR-adjacent — Phase 7 carry-over per RESEARCH §"Security Domain") |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-16-10-01 | Information Disclosure | Sentry events (PII leak) | mitigate | Plan 16-04 owns `beforeSend` scrub of email/phone/RC appUserID per RESEARCH §"Security Domain" V7. This plan re-verifies in Task 3 by sampling 5 random Sentry events and asserting no email/phone strings appear in the JSON dump. |
| T-16-10-02 | Tampering | Sandbox purchase replay | mitigate | RevenueCat server-side validation + idempotency on `event.id` in `revenuecat-webhook` (Plan 16-06 owns). This plan verifies in the Sandbox UAT row by attempting a second purchase of the same product and asserting NO second subscriptions row is created. |
| T-16-10-03 | Denial of Service | Apple §3.1.1 rejection | mitigate | `apps/ios/submission-response-templates.md` ships pre-written D-13 + D-24 justification. Plan-phase mitigation per CONTEXT D-13. |
| T-16-10-04 | Repudiation | Production promotion without UAT sign-off | mitigate | Task 5 checkpoint is `gate="blocking"`; `16-LAUNCH-CHECKLIST.md` is committed evidence; fastlane lane not invoked without explicit `promote-*` resume signal. |
| T-16-10-05 | Elevation of Privilege | Service-role JWT used by `seedTestPhotos.ts` leaks into committed code | mitigate | Fixture reads `SUPABASE_SERVICE_ROLE_KEY` from env; `.gitignore` already excludes `.env*`; CI uses GitHub Actions secrets. Task 1 asserts no service-role key in committed source via a grep gate. |
| T-16-10-06 | Spoofing | Sentry `release` tag forgery | accept | Sentry releases are tagged by fastlane (Plan 16-09); spoofing would require access to the SENTRY_AUTH_TOKEN, which is GitHub Actions secret-scoped. Risk is low; mitigation is access-control-level not code-level. |

</threat_model>

<verification>

After Tasks 1–4 commit (Task 5 is the phase-gate resume-signal pause):

```bash
# Artifacts present
test -f e2e/mobile/photo-soak.spec.ts
test -f e2e/mobile/fixtures/seedTestPhotos.ts
test -f scripts/sentry-fetch-events.mjs
test -f scripts/sentry-app-start-p95.mjs
test -f apps/ios/submission-response-templates.md
test -f leanshot/.planning/phases/16-capacitor-mobile-shells-ios-android/16-UAT.md
test -f leanshot/.planning/phases/16-capacitor-mobile-shells-ios-android/16-LAUNCH-CHECKLIST.md

# Typecheck + soak harness lists exactly one test
npm run typecheck
npx playwright test --project=mobile --grep @soak --list

# Submission-response template covers D-13 + D-24 + reviewer-facing IDs
grep -q "D-13" apps/ios/submission-response-templates.md
grep -q "D-24" apps/ios/submission-response-templates.md
grep -q "clinic/billing" apps/ios/submission-response-templates.md
grep -q "§3.1.1" apps/ios/submission-response-templates.md
grep -q "§4.7" apps/ios/submission-response-templates.md

# Launch checklist has evidence on every row
[ $(grep -v '^#' leanshot/.planning/phases/16-capacitor-mobile-shells-ios-android/16-LAUNCH-CHECKLIST.md | grep -c 'evidence:') -ge 12 ]

# No service-role key in committed code (T-16-10-05)
! grep -r "service_role" e2e/mobile/ src/lib/native/ --include="*.ts" --include="*.tsx" | grep -v "process.env" | grep -v "import.meta.env"

# Sentry scripts callable
node scripts/sentry-fetch-events.mjs --help > /dev/null
node scripts/sentry-app-start-p95.mjs --help > /dev/null
```

</verification>

<success_criteria>

Phase 16 verifier-ready when ALL of:

- [ ] `e2e/mobile/photo-soak.spec.ts` is committed, typechecks, and exits green on a local TestFlight live-reload run
- [ ] `scripts/sentry-fetch-events.mjs` + `scripts/sentry-app-start-p95.mjs` are callable from CLI with documented `--help` output
- [ ] `apps/ios/submission-response-templates.md` covers D-13 + D-24 with proactive + rejection-response variants
- [ ] `16-UAT.md` `status: passed` (filled by Task 3 after 7-day + 3-day soaks complete)
- [ ] `16-LAUNCH-CHECKLIST.md` `status: promoted` OR `status: ready-to-promote` with explicit `hold` justification
- [ ] Sentry fatal-event count over 7-day TestFlight window = 0 (CLI-verified)
- [ ] Sentry fatal-event count over 3-day Play Internal window = 0 (CLI-verified)
- [ ] `node scripts/sentry-app-start-p95.mjs --release ios@<ver> --statsPeriod 7d` exits 0 (p95 ≤10s, ≥20 samples)
- [ ] Same script exits 0 for `--release android@<ver> --statsPeriod 3d`
- [ ] Sandbox purchase UAT: subscriptions row exists with provider='revenuecat'; customerInfo.entitlements.active['plus'] truthy in-app
- [ ] User has explicitly issued one of `promote-ios` / `promote-android` / `promote-both` / `hold` in Task 5
- [ ] If `promote-*` issued, the corresponding fastlane lane has succeeded AND `16-LAUNCH-CHECKLIST.md` Promotion log row is filled with date + build + release-notes-link

</success_criteria>

<output>

After completion, create
`.planning/phases/16-capacitor-mobile-shells-ios-android/16-10-SUMMARY.md`
covering:

- Artifacts shipped (soak spec, Sentry scripts, submission-response template, UAT log, launch checklist)
- Final fatal-event counts (iOS 7-day + Android 3-day) with Sentry query URLs
- Cold-start p95 numbers (iOS + Android) with sample sizes
- Sandbox purchase trace (subscriptions row, entitlement state, in-app paywall flip)
- Promotion verdict (`promoted` with dates + build numbers, OR `held` with reason)
- Carry-overs to v1.2.1:
  - DE/ES/FR localized listings (R4 — deferred from Plan 16-08)
  - Capgo Live Updates rollout (R5 — D-12 bundled-only first)
  - Any fatal-event remediation that surfaces during soak

</output>
