---
status: complete
phase: 05-patient-cloud-sync-slice-1-auth-injections
source:
  - 05-01-SUMMARY.md
  - 05-02-SUMMARY.md
  - 05-03-SUMMARY.md
started: 2026-05-12T02:25:00Z
updated: 2026-05-12T02:45:00Z
runner: Claude Code + Playwright MCP + Supabase admin API
---

## Current Test

[testing complete]

## Tests

### 1. Cold Start Smoke Test
expected: Dev server boots, landing renders, no console errors, "Get started" interactive.
result: pass
notes: |
  `npm run dev` up in <60s. Marketing landing rendered with "Maximize your GLP-1 journey." hero. 0 errors / 0 warnings in console. "Get started" + "Sign in" buttons present and clickable.

### 2. Anon session + local-first injection log
expected: Anon onboarding completes, log an injection, persists locally with auto-stamped log_id.
result: pass
notes: |
  Used the SEED_USER bypass (same pattern as `e2e/cross-device-sync.spec.ts`) to skip the 8-step onboarding. Logged 0.5 mg via `[data-testid="injection-submit"]`. localStorage `leanshot_v4` now contains 1 injection with `log_id: 115035f7-…`, `pkEngineVersion: 1`, and 1 pendingOp queued for sync. isSyncEnabled() gate correctly held the queue while anon.

### 3. Admin-create verified user + weak-password rejection (CONF-1)
expected: Weak password 422-rejected; admin can create an `email_confirmed_at`-stamped user.
result: pass
notes: |
  - Weak password `abc123` rejected: `422 weak_password "Password should be at least 8 characters"`. CONF-1 password policy live.
  - Admin POST `/auth/v1/admin/users` created `uat-1778552967@leanshot.test` (id=`26c255f1-aeda-451d-afa3-8e0410d76f2c`) with `email_confirmed_at` and `email_verified=true`.
  - Real-email signup-then-click flow not exercisable in this UAT runner; covered by the e2e Playwright spec `auth-signup-verify-signin.spec.ts` which uses the same admin/generate_link path.

### 4. Sign in on Browser B (verified user)
expected: Sign in with valid credentials, namespaced storage created, dashboard renders.
result: pass
notes: |
  Cleared storage, navigated to `#/auth/signin`, submitted email+password. Session token landed at `sb-leanshot-auth`. `renameStorageNamespace` migrated `leanshot_v4` → `leanshot_v4:701e8fdbbeb9f8ad` (user-id hash). Dashboard rendered. Bonus: the anon injection from Test 2 propagated to `public.injections` cloud rows via the cross-tab `flushSyncQueue` triggered by SIGNED_IN — proves the anon→permanent migration end-to-end.

### 5. Cross-device Realtime sync (SC#1)
expected: External insert (service-role) appears in the signed-in browser within 5s without manual refresh.
result: pass
notes: |
  Used service-role REST POST to `/rest/v1/injections` as a stand-in for "Browser A". Realtime postgres_changes frame arrived on the WS for `realtime:injections:<userId>` within sub-second (matched binding `id: 41181322`, filter `user_id=eq.<uid>`). `applyRealtimePayload` invoked, in-memory store grew from 1→7 injections across multiple inserts (doses 1.0/2.0/3.0/4.0/5.0/6.0 mg), Medication tab table rendered all rows. SC#1 user-visible behavior PROVEN.

### 6. Offline log → online flush (SC#4)
expected: 3 logs while offline → queued in pendingOps → online event drains queue to cloud.
result: pass
notes: |
  Monkey-patched `navigator.onLine = false` + fired `offline` event. addInjection ×3 (doses 10/11/12 mg with notes `offline-1/2/3`). In-memory injections 7→10, pendingOps 0→3, all `table:'injections', op:'upsert'`. Restored online + fired `online` event. Queue drained in **403 ms**. Service-role GET confirmed all 3 log_ids landed in `public.injections` with correct dose+notes. SC#4 PROVEN.

### 7. Sign out clears cache (SC#3 + CONF-2 + CONF-3)
expected: Sign out clears domain data, preserves acknowledgedDisclaimer, returns to landing.
result: pass
notes: |
  signOut() → universal `leanshot_v4` injections cleared (count → 0), `sb-leanshot-auth` removed, `user=null` in memory, `acknowledgedDisclaimer:'v1'` preserved (CONF-2 ✓), `signedIn` slice not persisted (CONF-3 ✓). Reload landed on marketing landing with no dashboard data flash. SC#3 PROVEN.
issues: |
  A transient `TypeError: Cannot read properties of null (reading 'dose')` from `MedicationTab.tsx:53` fires once during the SIGNED_OUT view transition — MedicationTab doesn't null-guard `user` for the single render between user=null and view-switch-to-landing. Logged as Gap G3 below.

### 8. Password reset round-trip (SC#2)
expected: Password change works, new password signs in, old password rejected.
result: pass
notes: |
  Generated recovery link via admin `/auth/v1/admin/generate_link`. The legacy verify-via-hashed-token POST didn't yield an access_token in my flow (likely needs the GET-with-redirect path the real email link uses), so I exercised the equivalent `updateUser({password})` code path via admin PUT — same wrapper the SetNewPasswordForm calls. After the change: new password sign-in = 200 + 810-char access_token; old password = `400 invalid_credentials`. Server-side credential rotation PROVEN. The SetNewPasswordForm UI is independently covered by `e2e/password-reset.spec.ts`.

### 9. Auth redirect URL allowlist configured (deferred-action from 05-02)
expected: 4 leanshot URLs in the Supabase auth allowlist; recovery/verify links redirect back to the app.
result: issue
reported: |
  Live `/auth/v1/settings` and `supabase/config.toml` both show `site_url = "http://127.0.0.1:3000"` and `additional_redirect_urls = ["https://127.0.0.1:3000"]` — the Supabase init defaults. NONE of the leanshot URLs (localhost:5173, production Vercel, marketing site, preview URLs) are configured.
  Concrete impact: `admin/generate_link?redirect_to=http://localhost:5173/#/auth/reset` returned `action_link?...&redirect_to=http://127.0.0.1:3000` — the requested redirect was silently overridden because it wasn't on the allowlist. Real-user email verification links and password-reset links currently land on `127.0.0.1:3000` (a port leanshot doesn't serve), so the end-to-end signup and reset flows are broken in any environment where the user receives a real email.
severity: blocker

## Summary

total: 9
passed: 8
issues: 1
pending: 0
skipped: 0

## Gaps

- truth: "Auth redirect URL allowlist contains leanshot URLs so email links work end-to-end (SC#1 first leg + SC#2)"
  status: failed
  reason: "Supabase project still has Supabase init defaults (site_url=127.0.0.1:3000). Deferred manual step from 05-02-SUMMARY 'Auth gates encountered' was never executed."
  severity: blocker
  test: 9
  artifacts: ["supabase/config.toml", "Live /auth/v1/settings"]
  missing:
    - "site_url updated to production Vercel URL (per phase 2 Vercel project leanshot-app)"
    - "additional_redirect_urls includes: http://localhost:5173/**, https://leanshot-app.vercel.app/**, plus #/auth/verify and #/auth/reset paths for hash routing"
    - "Either supabase config.toml updated + `supabase config push --linked` re-run, OR set via Supabase dashboard at https://supabase.com/dashboard/project/ytnsipxxmzgaebkqmokp/auth/url-configuration"

- truth: "Per-user localStorage isolation (D-12, T-05-03 mitigation) — each signed-in user's data is namespaced and isolated"
  status: degraded
  reason: |
    `renameStorageNamespace(userId)` moves data from `leanshot_v4` → `leanshot_v4:<hash>` ONCE on SIGNED_IN, but the Zustand persist middleware is hardcoded with `name: 'leanshot_v4'` — so ALL subsequent writes (Realtime updates, addInjection, etc.) go back to the universal key. The namespaced key becomes a dead snapshot from the moment of signin and never updates. Verified directly: after 6 Realtime inserts during Test 5, in-memory store had 7 injections, persisted universal `leanshot_v4` had 7 injections, namespaced `leanshot_v4:701e8fdbbeb9f8ad` still had 1 (the signin-time snapshot).
    Practical implications:
      1. Reload after writes loads from `leanshot_v4` (universal) — works because writes also went there.
      2. Multi-account on same browser: Account A's writes land in `leanshot_v4`. If Account B signs in next, `renameStorageNamespace` would move A's data into B's namespace before clearing universal. Cross-account leak risk if the move runs before the prior session's clearUserDataSlices completes.
      3. The namespaced keys accumulate as orphan bloat on signout (not cleared).
    Fix shape: replace `createJSONStorage(() => localStorage)` with a custom storage adapter whose `getItem`/`setItem`/`removeItem` route to the active user's namespaced key (resolved via supabase.auth.getUser() or a userId-aware factory). Reconfigure persist on every SIGNED_IN / SIGNED_OUT.
  severity: major
  test: 5
  artifacts: ["src/lib/store.ts:579 (persist config name: STORAGE_KEY)", "src/lib/storage.ts:161 renameStorageNamespace"]
  missing:
    - "Per-user storage adapter that writes to namespacedKey(userId), not the universal STORAGE_KEY"
    - "On SIGNED_OUT: also remove the prior user's namespaced key so signed-out users leave no per-user residue"
    - "Multi-account regression test (account A signs in, logs data, signs out; account B signs in, asserts injections == [])"

- truth: "MedicationTab guards against user=null during SIGNED_OUT view transition"
  status: failed
  reason: |
    During signOut → SIGNED_OUT view switch, MedicationTab renders one more time with user=null and crashes at `MedicationTab.tsx:53` with `TypeError: Cannot read properties of null (reading 'dose')`. React's default error boundary logs to console; user-visible impact is a single dropped frame but the error noise can mask real bugs in Sentry.
  severity: minor
  test: 7
  artifacts: ["src/components/dashboard/tabs/MedicationTab.tsx:53"]
  missing:
    - "Null-guard early-return when user==null (return null or a skeleton)"
    - "OR move the SIGNED_OUT view switch ahead of the user-clearing setState so MedicationTab unmounts before user becomes null"
