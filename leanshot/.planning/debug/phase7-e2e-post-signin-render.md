---
status: investigating
trigger: "6/7 deferred e2e specs fail post-signin in prod-build CI; 7th (signout) fails downstream. Local dev passes. After 3 progressive fix attempts in Plan 07-01 (budget raises, store-gate widening, role-based locators), CI still reports 4 pass / 7 fail."
created: 2026-05-12T12:00:00Z
updated: 2026-05-12T12:05:00Z
---

## Current Focus

hypothesis: "AppShell renders, but a downstream assertion (e.g., wait for `dashboard` testid OR `primary navigation` nav OR `Migrating your data` heading OR `injection-submit`) cannot resolve in time. Most likely culprit (per code read): post-signin the spec waits for `<nav aria-label='Primary navigation'>`, BUT in `seedUserAndSignIn` the seeded state already has `user: SEED_USER` so the auth subscriber's INITIAL_SESSION (fires immediately on supabase init) would have seen NO session and `setSession(null)`. After form submit, `SIGNED_IN` fires and the chain runs. Need actual Playwright trace evidence."
test: "Download CI playwright-report artifact from run 25731926117 and read traces for one failing spec (offline-log-then-sync) to identify the exact step that fails AND the page state at that moment."
expecting: "Trace will show one of: (a) signin form submit succeeds but URL stays on #/auth/* (=> hash never clears, no navigation), (b) view transitions but Sidebar nav is not in DOM (=> Suspense never resolves), (c) URL transitions and nav is in DOM (=> later assertion is the real failure)."
next_action: "Run `gh run download 25731926117 --name playwright-report -D /tmp/pw` and inspect the failing trace HTML/JSON."

## Symptoms

expected: "All 7 re-enabled e2e specs pass in CI (11/11 green)"
actual: "4 pass / 7 fail across 3 CI runs (25730420437, 25731078841, 25731926117). Failure: post-signin assertion never resolves (`getByTestId('dashboard')`, `getByRole('navigation', { name: /primary navigation/i })`, `getByRole('heading', { name: 'Migrating your data' })`)."
errors: "element(s) not found within timeout, hits per-test setTimeout ceiling (90s/120s)"
reproduction: "Push commit; wait for CI; observe e2e-smoke job fail with 4 pass / 7 fail."
started: "First observed when 07-01 flipped the 7 test.fixme markers to test"

## Eliminated

(none yet — investigation just started)

## Evidence

- timestamp: 2026-05-12T12:00:00Z
  checked: "src/lib/storage.ts:170-178 (namespacedKey)"
  found: "Namespaced key shape is `leanshot_v4:<16hex>` — uses a COLON, not underscore."
  implication: "Specs that filter `localStorage.key.startsWith('leanshot_v4')` still match. Comments in signout-cache-clear.spec.ts that say 'leanshot_v4_user_<hash>' are stale but the startsWith() glob still works. NOT a failure cause."

- timestamp: 2026-05-12T12:01:00Z
  checked: "src/lib/store.ts:1157-1165 (setSession)"
  found: "setSession only writes to the `signedIn` slice. Never touches `state.user`."
  implication: "The seeded `state.user` survives the SIGNED_IN handler. Therefore selectView({user: SEED_USER, hash}) should return 'dashboard' once hash clears."

- timestamp: 2026-05-12T12:02:00Z
  checked: "src/components/auth/SignInForm.tsx:74-83 (signin submit)"
  found: "After signIn() resolves with no error, the form calls history.replaceState(null, '', window.location.pathname) + dispatches a HashChangeEvent. App.tsx's view recompute should fire and selectView returns 'dashboard'."
  implication: "URL/view transition is gated on signIn promise resolving. If signIn never resolves (e.g., supabase-js stuck on cold WebSocket open) the form stays in #/auth/signin and the test never reaches dashboard."

- timestamp: 2026-05-12T12:03:00Z
  checked: "07-01-SUMMARY.md §CI evidence + 07-01-findings.md"
  found: "Failing 6 specs all pre-seed `leanshot_v4` localStorage blob with `user: SEED_USER`. Passing 4 specs (auth-signup-verify-signin, onboarding, password-reset) DO NOT seed — they signup fresh and never hit the seeded-state path."
  implication: "The differentiator is the pre-seeded `state.user`. The 4 passing specs go through the marketing → signup → onboarding → dashboard path; the failing specs go through 'seed → reload → signin from #/auth/signin'. Difference candidates: (a) the seeded blob carries acknowledgedDisclaimer='v1' and disrupts a check, (b) page.reload after seed has a timing issue with hydrate(), (c) signin from the pre-existing auth page differs from the post-signup auth page."

## Resolution

root_cause: ""
fix: ""
verification: ""
files_changed: []
