# Phase 12: Bootstrap & Bundle Foundations - Context

**Gathered:** 2026-05-13
**Status:** Ready for planning

<domain>
## Phase Boundary

**Entry phase for milestone v1.2** — pure CI/operational foundations. After this phase, the codebase is ready to absorb the 10 net-new v1.2 workstreams (design system, monetization, mobile shells, push, health, affiliate, ads, watch, owner/admin, lifecycle email) without regression.

**In scope:**
1. Verify the hash-hyphen `assert-clinic-bundle-budget.sh` fix (already landed via Plan 10-11) and declare named per-chunk ceilings for the five v1.2 chunks that don't exist yet (`stripe-elements`, `adsense-glue`, `page-builder-runtime`, `web-push`, `capacitor-bridge`) with research-derived rough caps + `wave-0` skip until each chunk lands.
2. Set up the Two-tunnel firewall as ESLint `no-restricted-imports` rule blocking `src/lib/native/health.ts` from being imported by `src/lib/native/ads.ts` AND the broader "ad-eligible bag" (analytics, affiliate, Stripe metadata, marketing). Plus a deliberately-failing fixture file in a feature branch (does NOT merge) proving the rule trips static-build.
3. Land the Playwright e2e `clinic-ad-free.spec.ts` asserting zero ad-provider script tags and zero `<AdSlot>` mounts on `/clinic/*`, `/share/*`, `/admin/*`. CI hard gate.
4. Verify Resend domain `app.leanshot.app` (SPF/DKIM/DMARC) and send a real lifecycle email from `noreply@app.leanshot.app` (not the sandbox `onboarding@resend.dev`).
5. Provision human-prereq accounts: Apple Developer Program, Google Play Console, Stripe Connect (Express). Capture credentials into Vercel env + Supabase Function secrets.
6. Add a **CSP snapshot test** in CI that fails LOUDLY when production CSP drifts — CSP stays tight; each later phase widens it as the SDK lands.

**Explicitly NOT in scope (this phase ships code-only):**
- AdMob publisher approval (1–2 weeks; carried into Phase 20 entry conditions)
- AdSense publisher approval (requires live deployed app; carried into Phase 20 entry conditions)
- Resend tracking-pixel CSP origins (carried into Phase 22 lifecycle-email phase)
- Per-chunk **numeric tightening** beyond the rough caps — each owning phase tightens to actual + headroom on close
- Any actual SDK install (Stripe.js, AdMob, RevenueCat, GPT, dnd-kit) — owning phases install

</domain>

<decisions>
## Implementation Decisions

### Firewall module boundary & breadth

- **D-01 (LOCKED, firewall path):** The Two-tunnel firewall enforces against `src/lib/native/{health,ads,push,iap,deeplink,platform}.ts`. The canonical layout matches the SUMMARY.md "native bridge layer" naming and the path already referenced in Phase 16/18/20 ROADMAP success criteria. **Rejected:** the `src/lib/health/*` ↔ `src/lib/ads/*` schema from PITFALLS.md Pitfall 1 — it's domain-grouped, but every downstream phase is already pointing at `src/lib/native/*`. Two competing schemas would re-surface as confusion at every plan-phase.
- **D-02 (LOCKED, firewall breadth — FULL SPECTRUM):** The ESLint `no-restricted-imports` rule blocks `src/lib/native/health.ts` from being imported by **all four "second-tunnel" buckets**, not just `native/ads.ts`:
  1. `src/lib/native/ads*.ts` — the primary ad transport
  2. `src/lib/analytics/*` and any `src/lib/posthog*.ts` wrappers — closes the PostHog→ad-SDK distinctId leak path
  3. `src/lib/affiliate/*` and `src/lib/native/affiliate*.ts` — affiliate-attribute Edge Function payloads can reach advertiser-visible metadata
  4. Stripe metadata helpers — any file calling `stripe.customers.update` / `stripe.subscriptions.update` with a `metadata: {...}` arg (Connect partners and ad-reconciliation tools can read these)
  5. Generic ad-eligible bag — `src/lib/ads/*`, `src/lib/marketing/*`, and any file matching `*.ad-eligible.ts`
- **D-03 (LOCKED, firewall test):** A deliberately-failing fixture file (e.g. `src/lib/native/ads.fixture-violates-firewall.ts`) imports `health.ts` and lives on a `firewall-test-violation` branch that NEVER merges. CI on that branch must fail on the `no-restricted-imports` rule. Doc the branch SHA in CONTEXT so future audits can re-run.
- **D-04 (LOCKED, runtime + manifest belt-and-braces):** Phase 12 ships ESLint static check only. The runtime guard in `src/lib/ads/firewall.ts` (aborts AdMob.initialize() if HealthKit permission was ever granted) lands in Phase 18/20 alongside the SDKs. The Privacy Manifest (`PrivacyInfo.xcprivacy`) lands in Phase 16.

### Phase 12 scope split — code now, credentials trickle

- **D-05 (LOCKED, ship code-only Phase 12; credentials become entry conditions on later phases):** Phase 12 closes when (a) hash-hyphen verified, (b) firewall ESLint rule + failing-fixture branch merged, (c) clinic-ad-free.spec.ts green, (d) Resend domain verified + real email sent, (e) Apple Dev + Google Play + Stripe Connect provisioned. **AdMob + AdSense credentials are NOT Phase 12 gates** — they become entry conditions on Phase 20 (Ad Network). This unblocks Phase 13 design rollout immediately. **Rejected:** "hold Phase 12 closed until every vendor is approved" — circular (AdSense often needs a live deployed app, which requires Phase 13/14 done).
- **D-06 (LOCKED, vendor credential capture pattern):** As each vendor approves, capture credentials in (a) Vercel env (for build-time / Edge Function consumption) AND (b) Supabase Function secrets (for runtime in Deno Edge Functions). Naming convention: `STRIPE_*`, `APPLE_*`, `PLAY_*`, `ADMOB_*`, `ADSENSE_*`, `RESEND_*`. Update PROJECT.md "Vendor accounts" section as each lands (audit trail).

### Per-chunk bundle ceilings — names + research-derived rough caps now

- **D-07 (LOCKED, ceiling values):** Phase 12 declares the five new per-chunk ceilings with research-derived rough caps in `scripts/assert-clinic-bundle-budget.sh`. `wave-0` skip behavior protects until each chunk actually appears in `dist/`. Rough cap rationale (researcher MUST validate these against current vendor docs and adjust):
  - **`stripe-elements` ≤ 30,000 bytes gz** — Stripe.js loader is ~30 kB gz per Stripe official docs; Checkout integration adds form helpers
  - **`adsense-glue` ≤ 8,000 bytes gz** — GPT tag is loaded as a `<script>` (not bundled); the glue chunk is just `<AdSlot>` + placement config reader
  - **`page-builder-runtime` ≤ 25,000 bytes gz** — dnd-kit core + sortable ≈ 18–20 kB gz; recursive renderer adds ~5 kB
  - **`web-push` ≤ 3,000 bytes gz** — `web-push@3.6.7` server-side only; the browser-side is just the service-worker registration glue
  - **`capacitor-bridge` ≤ 15,000 bytes gz** — `@capacitor/core` ≈ 12 kB gz; native bridge wrappers (`src/lib/native/*.ts`) add ~3 kB before any plugin
- **D-08 (LOCKED, per-phase tightening cadence):** Each owning phase tightens the ceiling to actual + ~1 kB headroom at phase close (matches the existing `clinic` / `clinic-settings` / `clinic-invite` ceiling history in `assert-clinic-bundle-budget.sh`). Plan-checker for each owning phase MUST verify the ceiling drop is in the closing commit.
- **D-09 (LOCKED, index ceiling unchanged):** Index gz working ceiling stays at **24,500 bytes** (Phase 9 working ceiling); absolute hard block stays at **50,000 bytes** (Phase 6 absolute). No tightening in Phase 12.

### CSP posture — tight + snapshot test, per-phase widening

- **D-10 (LOCKED, tight CSP + CI snapshot test):** Phase 12 lands a CSP snapshot test in CI that captures the current production CSP (post-Phase-8-hot-fix state with Supabase + Resend origins) and fails the build LOUDLY when any CSP directive changes. Each later phase (14 Stripe, 15 page-builder if needed, 16 Capacitor IPC, 17 web-push, 19 RevenueCat, 20 GPT/AdSense/AdMob, 22 Resend tracking pixels) widens CSP as part of its plan AND updates the snapshot.
- **D-11 (LOCKED, snapshot location & shape):** Snapshot lives at `tests/csp/csp-snapshot.txt` (one directive per line, deterministic ordering); test diffs the live `vercel.json` `Content-Security-Policy` header value against the snapshot. Owning phases update both the header and the snapshot in the same commit.
- **D-12 (LOCKED, plan-checker contract):** Plan-checker for any phase that lands an SDK with new external origin MUST verify the CSP delta is in the plan + the snapshot update is in the plan. Pre-empts the Phase 8 reactive-break pattern.

### Bundle hash-hyphen fix — verification only

- **D-13 (NOTED, fix already landed):** Per memory `reference_bundle_budget_hash_hyphen.md` and `scripts/assert-clinic-bundle-budget.sh` lines 147–186, the hash-hyphen bug was fixed by Plan 10-11. Phase 12 verifies the fix with a regression test (a unit test or shell test that runs the script against a synthetic `dist/` with a hash containing `-` and confirms the chunk is measured, not `wave-0` skipped).

### Clinic-ad-free Playwright gate

- **D-14 (LOCKED, routes & assertions):** `e2e/clinic-ad-free.spec.ts` asserts on `/clinic/*`, `/share/*`, `/admin/*` (matches ROADMAP SC#3 and cross-cutting concern #2). For each route: (a) zero `<script>` tags whose src matches a hardcoded list of ad-provider origins (googletagservices.com, googlesyndication.com, googleadservices.com, doubleclick.net, admob, facebook.net/audience-network); (b) zero `<AdSlot>` component instances in DOM; (c) zero network requests to those origins captured during the page lifecycle. Three layers (DOM script tags + AdSlot mounts + network requests).
- **D-15 (LOCKED, CI gate timing):** `clinic-ad-free.spec.ts` runs as a PR-blocking gate from Phase 12 onward — every PR must pass it before merge. Independent of the `share-security-drill` job (which is a separate Phase 8 gate).

### Resend domain — `app.leanshot.app` subdomain

- **D-16 (LOCKED, use the subdomain pattern already encoded in ROADMAP SC#4):** Verify `app.leanshot.app` (not the apex `leanshot.app`) per the existing Resend wiring memory. The subdomain isolates email-sending reputation from the marketing site's potential future SMTP needs. SPF/DKIM/DMARC records published in the DNS provider; verification proof captured in Phase 12 SUMMARY + linked from PROJECT.md.
- **D-17 (LOCKED, sender + reply-to):** From = `LeanShot <noreply@app.leanshot.app>`. Reply-to = `support@leanshot.app` (apex). DMARC policy = `quarantine` initially, tighten to `reject` after 30-day report monitoring (Phase 22 entry condition).

### Claude's Discretion

- The exact rough-cap numbers in D-07 are research-derived guesses — `gsd-phase-researcher` MUST query current vendor docs (Stripe.js bundle size, dnd-kit + sortable bundle size, @capacitor/core bundle size, web-push package size) and either confirm or recommend revised caps before planning starts. If the researcher's numbers diverge by >20% from the rough caps, the planner adjusts.
- The exact ESLint rule syntax for `no-restricted-imports` patterns — the planner picks between `paths: [...]` and `patterns: [...]` shapes. PROJECT.md notes `eslint-plugin-import-x` is in use; the rule may need to live in `import-x/no-restricted-paths` form instead.
- The CSP snapshot test framework — Vitest unit test vs Playwright header-fetch vs shell diff. Planner picks based on existing test infrastructure.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Roadmap & Requirements
- `.planning/ROADMAP.md` — Phase 12 success criteria (5 SCs)
- `.planning/REQUIREMENTS.md` — Cross-cutting concerns #2, #3, #5, #6, #7 (Phase 12 owns these)
- `.planning/PROJECT.md` — v1.2 milestone scope, hard constraints, vendor list

### Research synthesis (HIGH confidence)
- `.planning/research/SUMMARY.md` — Executive summary; final stack decisions table; "Two-tunnel firewall" pattern name; bundle posture
- `.planning/research/PITFALLS.md` — Pitfall 1 (HealthKit→ads §5.1.3), Pitfall 2 (Apple IAP §3.1.1), Pitfall 3 (account deletion §5.1.1(v))
- `.planning/research/ARCHITECTURE.md` — Component layout, native bridge layer
- `.planning/research/STACK.md` — Vendor decisions with rationale
- `.planning/research/FEATURES.md` — Must-have / should-have / defer split

### Existing infrastructure to extend (NOT reinvent)
- `scripts/assert-clinic-bundle-budget.sh` — Existing per-chunk + index ceiling script; Phase 12 extends with five new chunk slots; hash-hyphen fix already landed at lines 147–186
- `eslint.config.js` — Existing flat config with `no-restricted-syntax` rules and `eslint-plugin-import-x`; Phase 12 adds `no-restricted-imports` (or `import-x/no-restricted-paths`)
- `src/lib/sync-defer.ts` — Existing deferred-init wrapper; every new SDK MUST route through this (referenced by D-07 rough caps)
- `vercel.json` — Existing CSP header (post-Phase-8-hot-fix state); Phase 12 snapshots this

### Phase context — v1.1 lessons that carry in
- `.planning/phases/08-doctor-read-share/08-CONTEXT.md` — Phase 8 hot-fix for prod CSP (motivates D-10/D-11/D-12 snapshot-test approach)
- Memory `reference_bundle_budget_hash_hyphen.md` — Hash-hyphen bug discovery + Plan 10-11 fix path
- Memory `reference_resend_phase9_wiring.md` — `RESEND_API_KEY` + `RESEND_FROM` Supabase Function secrets pattern; domain-verify check via Resend API
- Memory `project_phase5_bundle_regression.md` — Heavy SDKs MUST route through `sync-defer.ts` (D-07 contract)
- Memory `feedback_planner_iter1_anti_patterns.md` — 6 recurring BLOCKERs to pre-empt in plan-phase prompt
- Memory `feedback_parallel_executor_git_isolation.md` — Pathspec commits for parallel executors

### Cross-phase contracts this phase establishes
- Two-tunnel firewall ESLint rule — consumed by Phase 18 (HEALTH-07 implementation) and Phase 20 (AD-04 audit)
- CSP snapshot test — consumed by Phases 14/16/19/20/22 (each must update snapshot when widening CSP)
- Per-chunk ceilings — consumed by Phases 14/15/16/17/20 (each tightens on close)
- Vendor credentials checklist in PROJECT.md — consumed by Phases 14 (Stripe), 16 (Apple Dev + Play), 20 (AdMob + AdSense)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`scripts/assert-clinic-bundle-budget.sh`** — The proven shape for per-chunk ceilings. Phase 12 extends, doesn't rewrite. The `check_chunk_ceiling` function + `wave-0` skip logic + hash-stripping loop are all reusable.
- **`eslint.config.js`** — Already uses `no-restricted-syntax` for the `useStore(generateInsights|...)` block. The same pattern + `eslint-plugin-import-x` extends to `no-restricted-imports` cleanly.
- **`src/lib/sync-defer.ts`** — Mandatory deferred-init wrapper for every new SDK (D-07 contract). Phase 12 doesn't touch it but enshrines it as the cross-cutting rule for Phases 14/16/20.
- **`vercel.json`** — Existing CSP header is the snapshot baseline; Phase 12 captures it once and locks against drift.

### Established Patterns
- **Bundle-budget script style** — Per-chunk constants at top with rationale comment + historical progression; `wave-0` skip when chunk doesn't exist yet. New ceilings follow this shape.
- **ESLint flat config + project-relative globs** — The existing config supports `../shared/**/*.ts` style globs; firewall rule follows the same pattern.
- **CI hard-block + GitHub Actions annotations** — `echo "::error::"` + `exit 1` per bundle-budget script. Firewall fixture and clinic-ad-free e2e follow the same shape.
- **Reactive CSP fix pattern (Phase 8) → Proactive snapshot pattern (Phase 12)** — Inverts the failure mode.

### Integration Points
- **`scripts/assert-clinic-bundle-budget.sh`** — Add five new `*_CEILING` constants + five new `check_chunk_ceiling` calls
- **`eslint.config.js`** — Add `no-restricted-imports` (or `import-x/no-restricted-paths`) rules block in the existing `files: ['src/**/*.{ts,tsx}', ...]` section
- **`tests/csp/csp-snapshot.txt`** (new) + a vitest or shell test (new) — Read `vercel.json`, extract CSP header, diff against snapshot
- **`e2e/clinic-ad-free.spec.ts`** (new) — Sits alongside existing `clinic-*.spec.ts` files in `e2e/`
- **`.github/workflows/*.yml`** — Wire the new gates (clinic-ad-free, firewall fixture branch check, CSP snapshot) into CI

</code_context>

<specifics>
## Specific Ideas

- **User explicitly chose "full spectrum" firewall** (D-02) — the rule is intentionally maximalist. Documented because future contributors may want to relax it; the documented rationale prevents that.
- **User explicitly chose "ship code-only, credentials trickle"** (D-05) — unblocks Phase 13 immediately, avoids the AdSense circular dependency. This is the recommended path the option was framed as; locked.
- **User explicitly chose "research-derived rough caps NOW"** (D-07) — surfaces bundle bloat early, consistent with the "aggressive foundations" preference (memory `feedback_aggressive_foundations.md`). The researcher MUST validate caps against current docs.
- **User explicitly chose "tight CSP + snapshot test"** (D-10) — same belt-and-braces pattern; pre-empts the Phase 8 reactive break without prematurely widening CSP.
- **Subdomain `app.leanshot.app` for Resend, NOT apex** (D-16) — matches existing ROADMAP wording and isolates sending reputation.

</specifics>

<deferred>
## Deferred Ideas

- **Runtime firewall guard** (`src/lib/ads/firewall.ts` that aborts `AdMob.initialize()` if HealthKit permission was granted) — deferred to Phase 18/20 alongside SDK installs. D-04.
- **Privacy Manifest** (`PrivacyInfo.xcprivacy`) — deferred to Phase 16 (Capacitor iOS shell). D-04.
- **AdMob publisher credentials capture** — Phase 20 entry condition. D-05.
- **AdSense publisher credentials capture** — Phase 20 entry condition (often requires live deployed app). D-05.
- **Resend tracking-pixel CSP origins** — Phase 22 (Lifecycle email) widens CSP with the tracking-pixel origin. D-10.
- **DMARC policy tightening from `quarantine` to `reject`** — Phase 22 entry condition after 30-day report monitoring. D-17.
- **Per-chunk ceiling numeric tightening** — Phase 14/15/16/17/20 (each owning phase) tightens to actual + headroom on close. D-08.
- **`no-restricted-syntax` for the React Compiler-era hooks rules** — out of scope; cosmetic and unrelated to the firewall.
- **knip / ts-unused-exports CI gate** — Phase 23 (v1.1 Tech Debt Sweep) per PROJECT.md. Not blocking the v1.2 entry.

### Reviewed Todos (not folded)
None — no GSD todos surfaced for Phase 12.

</deferred>

---

*Phase: 12-bootstrap-bundle-foundations*
*Context gathered: 2026-05-13*
