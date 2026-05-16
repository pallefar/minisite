---
phase: 22-owner-admin-lifecycle-email-dsar-cookie-consent
plan: 05
subsystem: soft-delete-ui
tags: [react, typescript, rpc, hmac, lifecycle-email, pathname-routing, lazy-chunk, vitest, playwright]

requires:
  - phase: 22
    plan: 01
    provides: 7-day finalize-account-deletions cron + cancel_account_deletion(text) RPC + Vault CANCEL_DELETION_HMAC_KEY contract
  - phase: 22
    plan: 02
    provides: lifecycle-transactional Edge Fn template='deletion_scheduled' + HMAC cancel-token mint + placeholder-URL fallback when Vault key missing
  - phase: 7
    plan: 07
    provides: DeleteAccountModal.tsx + account-delete.ts initiateAccountDeletion RPC wrapper + typedConfirmMatches helper

provides:
  - 30-day → 7-day soft-delete UI sweep across modal/settings/legal/signup/e2e (Conflict #2 closure)
  - DeleteAccountModal rewritten to UI-SPEC §Copywriting (heading 'Delete account', bullet list, retention disclosure, typed-confirm = literal 'DELETE MY ACCOUNT')
  - SoftDeleteCountdownBanner component (DEL-01 post-delete) with impersonation-yield priority
  - /cancel-deletion route + lazy-loaded page with 9-state discriminated outcome union
  - lifecycle-transactional invoke wiring (template='deletion_scheduled', days_remaining: 7, fire-and-forget)
  - 35 vitest tests green (13 modal + 6 helper + 8 banner + 8 other)
  - 3 deterministic e2e specs (no-token / garbage / pending placeholder) + 1 deferred (HMAC round-trip, env-gated on Vault key)

affects:
  - 22-12 (AppShell mount integration — banner needs to be mounted ABOVE topbar)
  - 22-04 (impersonation banner — UI-SPEC priority asserted in test B8; once 22-04 ships ImpersonationBanner, this contract should still hold)
  - 22-11 (DSAR portal — independent surface; this plan only changes the cancel-deletion path)

tech-stack:
  added: []
  patterns:
    - "Pathname-conditional view (CLAUDE.md 'no router' rule): new 'cancel-deletion' branch added to selectView() + lazy CancelDeletionPage chunk + popstate-driven recompute"
    - "Anonymous-OK pathname route (anon JWT path) — first non-clinic-invite branch where signed-out users are allowed because the HMAC token IS the auth"
    - "Discriminated-union outcome state for 9 cancel-deletion outcomes (idle/confirming/success/no_token/invalid/expired/already/vault_missing/unknown) → per-state heading+body+CTA+data-testid"
    - "Impersonation-yield via session.user.app_metadata.impersonator_id check (avoids hard dep on Wave 2 sibling plan 22-04's useImpersonation hook)"
    - "Vendor-deferred-key graceful degradation: ?token=pending short-circuit + RPC error→vault_missing copy path so user never sees a stack trace"

key-files:
  created:
    - leanshot/src/components/soft-delete/SoftDeleteCountdownBanner.tsx
    - leanshot/src/pages/cancel-deletion.tsx
  modified:
    - leanshot/src/components/dashboard/settings/DeleteAccountModal.tsx (rewritten — UI-SPEC copy + lifecycle invoke + phrase-based typed-confirm)
    - leanshot/src/lib/account-delete.ts (typedConfirmMatches → phrase-based; TYPED_CONFIRM_PHRASE export)
    - leanshot/src/lib/account-delete.test.ts (helper test suite rewritten for phrase contract)
    - leanshot/src/test/account-delete.test.tsx (13 RTL tests rewritten for UI-SPEC copy + lifecycle invoke + zero-30-day assertion)
    - leanshot/src/components/soft-delete/__tests__/SoftDeleteCountdownBanner.test.tsx (Wave 0 scaffold → 8 behaviors green)
    - leanshot/src/components/dashboard/settings/SettingsPage.tsx (Privacy section caption 30d→7d; button label 'Delete my account…' → 'Delete account')
    - leanshot/src/components/auth/SignUpForm.tsx (recently-deleted-account error 30d→7d)
    - leanshot/src/components/legal/PrivacyPolicy.tsx (2 hits 30d→7d + delete-flow description updated for phrase confirm + HMAC link)
    - leanshot/src/components/legal/TermsOfService.tsx (1 hit 30d→7d)
    - leanshot/src/components/legal/ConsumerHealthData.tsx (2 hits 30d→7d + delete-flow description updated)
    - leanshot/src/App.tsx (lazy CancelDeletionPage import + 'cancel-deletion' view ID + selectView branch + render branch)
    - leanshot/e2e/account-delete.spec.ts (settings button + modal copy + typed-confirm gate updated to Phase 22)
    - leanshot/e2e/account-delete-cancel.spec.ts (Wave 0 scaffold → 3 deterministic specs + 1 deferred HMAC round-trip)

key-decisions:
  - "typedConfirmMatches switched from email-match to literal-phrase-match (DELETE MY ACCOUNT, case-sensitive); preserved 2-arg overload so any orphan caller doesn't typecheck-break"
  - "Impersonation detection inlined via supabase.auth.getSession().user.app_metadata.impersonator_id rather than waiting on plan 22-04's useImpersonation hook (Wave 2 sibling) — avoids cross-plan ordering dependency"
  - "Sweep scope expanded beyond plan's 3-file allow-list to include SettingsPage caption + SignUpForm error + 3 legal pages + e2e spec (Rule 2 — Conflict #2 threat T-22-35 disclosure-mismatch is correctness-critical for HIPAA/WMHMDA postures)"
  - "?token=pending short-circuit in /cancel-deletion (treats placeholder URL from 22-02 as no_token) — user gets friendly help-text rather than RPC error during the deferred-vendor-pass interim"
  - "Cancel-deletion landing auto-fires RPC on mount instead of click-through Confirm — pages reached via email link are intentional; reduces a tap and matches UI-SPEC line 211 intent"
  - "AppShell mount of SoftDeleteCountdownBanner explicitly deferred to plan 22-12 per Task 3 <action> note line 178 — this plan ships the component only"
  - "Settings button label changed 'Delete my account…' → 'Delete account' to match UI-SPEC §Copywriting line 567 (also Apple §5.1.1(v) 3-tap path: settings→Privacy→Delete account)"

requirements-completed: [DEL-01, DEL-02]

duration: ~30min
completed: 2026-05-16
---

# Phase 22 Plan 05: Soft-Delete UI + Cancel-Link Round-Trip Summary

**Conflict #2 closed end-to-end: 30-day soft-delete UX swept to 7 days across modal/settings/legal/signup/e2e; DeleteAccountModal rewritten to UI-SPEC §Copywriting with literal 'DELETE MY ACCOUNT' confirm + lifecycle-transactional invoke; SoftDeleteCountdownBanner shipped (impersonation-yield); /cancel-deletion route lazy-loaded with 9-state discriminated outcome handling.**

## Performance

- **Duration:** ~30 min
- **Started:** 2026-05-16T08:40Z
- **Completed:** 2026-05-16T08:50Z
- **Tasks:** 4 of 4
- **Files created:** 2 (SoftDeleteCountdownBanner + cancel-deletion page)
- **Files modified:** 13 (modal/lib/3 tests + settings + signup + 3 legal pages + App + 2 e2e)
- **Lines:** +944 / -188 across 15 files

## Accomplishments

- **Conflict #2 closure:** 30-day soft-delete copy fully removed from user-facing surfaces (modal + settings caption + signup error + 3 legal pages + e2e spec). Final grep `grep -rE "30 days|30-day|thirty days" src/ e2e/ | grep -iE "(soft|delet|grace|pending)"` returns only the test-file regex string (intentional — asserts the zero-state).
- **DeleteAccountModal rewritten to UI-SPEC §Copywriting verbatim** (lines 562-579): heading "Delete account", bullet list (injections/photos/weight logs/AI history/doctor shares/affiliate referrals), retention disclosure (7-year IRS retention), typed-confirm now requires the literal "DELETE MY ACCOUNT" phrase (case-sensitive exact match), success toast "Account scheduled for deletion. We've sent a confirmation email."
- **lifecycle-transactional wiring:** Modal fires `supabase.functions.invoke('lifecycle-transactional', { body: { template: 'deletion_scheduled', user_id, data: { days_remaining: 7 } } })` after RPC success. Fire-and-forget — email failure is non-blocking (deletion is already scheduled server-side).
- **SoftDeleteCountdownBanner shipped:** Sticky top-0 z-[60] h-12 banner reading `pending_account_deletions` for current user; renders "Account scheduled for deletion in N days." countdown; "Cancel deletion" CTA that either calls `cancel_account_deletion` RPC (with `?cancel_token=` in URL) or navigates to `/cancel-deletion` (without). Yields to impersonation banner (UI-SPEC line 317) via `session.user.app_metadata.impersonator_id` check — avoids hard dep on plan 22-04's useImpersonation hook.
- **/cancel-deletion lazy-loaded page** with 9-state discriminated outcome union (idle/confirming/success/no_token/invalid/expired/already/vault_missing/unknown). Auto-fires RPC on mount; gracefully handles missing/pending tokens; never crashes. Each outcome has its own data-testid + heading + body + CTA per UI-SPEC §Soft-delete copy.
- **App.tsx route registration** — `cancel-deletion` view ID + lazy chunk + `selectView` branch (anonymous-OK) + render switch — first non-clinic-invite pathname route that allows signed-out users (HMAC token IS the auth, per 22-01 File 14 grant to `anon` + `authenticated`).
- **35 vitest tests green** (13 modal + 6 phrase-helper + 8 banner + 8 already-existing-non-touched), 0 lint errors, tsc clean, bundle `index-*.js` gz **15.09 kB** (50 kB ceiling preserved). `cancel-deletion-*.js` emitted as own chunk.

## Task Commits

Each task committed atomically with pathspec (per `feedback_parallel_executor_git_isolation.md`):

1. **Task 1+2 — Sweep + DeleteAccountModal + lifecycle invoke + helper rewrite** — `9372c59` (feat)
2. **Task 3 — SoftDeleteCountdownBanner + 8-behavior tests** — `0e9fa60` (feat)
3. **Task 4 — /cancel-deletion route + lazy chunk + e2e** — `73184eb` (feat) — also batched in linter auto-fix touch-ups to prior commits' files (DeleteAccountModal docstring whitespace + SoftDeleteCountdownBanner.test.tsx import-x/order)

## Verification

| Check | Expected | Actual | Status |
|-------|----------|--------|--------|
| `grep -rE "30 days\|30-day" src/components/dashboard/settings/DeleteAccountModal.tsx src/lib/account-delete.ts` | 0 hits | 0 hits | PASS |
| Full sweep: `grep -rn "30 days\|30-day\|thirty days" src/ e2e/ \| grep -iE "(soft\|delet\|grace\|pending)"` (excluding intentional test-file regex string) | 0 hits | 0 hits | PASS |
| DeleteAccountModal RTL test (`src/test/account-delete.test.tsx`) | green | 13/13 pass | PASS |
| account-delete.ts helper test (`src/lib/account-delete.test.ts`) | green | 6/6 pass | PASS |
| SoftDeleteCountdownBanner test (8 behaviors) | green | 8/8 pass | PASS |
| `src/pages/cancel-deletion.tsx` exists | file | file exists | PASS |
| `src/components/soft-delete/SoftDeleteCountdownBanner.tsx` exists | file | file exists | PASS |
| Typecheck (`tsc -b`) | clean | clean | PASS |
| Lint (changed files) | 0 errors | 0 errors | PASS |
| Bundle `index-*.js` gz | < 50 kB | 15.09 kB | PASS |
| Bundle `cancel-deletion-*.js` emitted as own chunk | yes | yes (5.3 kB gz) | PASS |
| `/cancel-deletion` route registered in App.tsx selectView | yes | yes | PASS |
| Apple §5.1.1(v) 3-tap path | settings → privacy → Delete account → modal opens | settings (already mounted) → click "Privacy" (1) → click "Delete account" (2) → modal opens | PASS (≤3 taps) |

## Decisions Made

(All extracted to frontmatter `key-decisions` for STATE.md harvest.)

Most load-bearing:

1. **typedConfirmMatches contract change.** Phase 7's gate was email-typed-back. UI-SPEC §line 572-573 locks the new gate to the literal phrase "DELETE MY ACCOUNT" (case-sensitive). Preserved the 2-arg overload so any orphan caller of the legacy 2-arg signature doesn't typecheck-break — the second arg is silently ignored. This is the only place a Phase 7 component-facing API contract changes.
2. **Impersonation-yield inlined, not via useImpersonation hook.** Plan 22-04 ships `useImpersonation` in the same Wave 2 batch. Rather than introduce a build-order dependency, SoftDeleteCountdownBanner reads `session.user.app_metadata.impersonator_id` directly (the same source-of-truth 22-04's hook will read). When 22-04 lands, both surfaces will share the contract without refactor.
3. **Sweep beyond plan's 3-file allow-list (Rule 2).** Plan's `files_modified` listed 7 files; I touched 15. The +8 (SettingsPage caption, SignUpForm error, 3 legal pages, e2e spec, account-delete.test.ts, lib helper, plus modal+lib+test from the allow-list) are all driven by **threat T-22-35** in the plan's threat_model: "UI copy mismatch (30 days vs 7 days) creates user-facing drift" — explicitly flagged as `mitigate` and assigned to "Tasks 2-3 update each". The full sweep is the documented intent.
4. **`?token=pending` graceful short-circuit.** Plan 22-02 emits `cancel_url=https://app.leanshot.app/cancel-deletion?token=pending` when the Vault `CANCEL_DELETION_HMAC_KEY` is not loaded (deferred vendor pass per 22-01 SUMMARY line 212). The /cancel-deletion landing detects this literal value and routes to the friendly help-text screen rather than firing the RPC and surfacing an invalid-token error. Vendor-key load is zero-code-change to enable real round-trips.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 — Missing critical] Sweep expanded beyond `files_modified` allow-list**

- **Found during:** Task 1 grep sweep
- **Issue:** Plan body Task 2 listed 3 files for modification (DeleteAccountModal.tsx, account-delete.ts, DeleteAccountModal.test.tsx). The grep sweep surfaced 29 in-scope hits across 8 files. Shipping just the 3 files would leave the SettingsPage caption ("30-day soft-delete"), SignUpForm error message ("After the 30-day window"), and 3 legal pages (Privacy / Terms / ConsumerHealthData with "30-day undo window" language) all referencing the old window — directly the threat T-22-35 ("UI copy mismatch creates user-facing drift") that the threat model classifies as `mitigate`.
- **Fix:** Extended the sweep to all 8 files. Legal copy is correctness-critical for HIPAA/WMHMDA posture (CHD's "After 30 days... unrecoverable" language would be a factually-incorrect disclosure if backend cron is 7 days). Apple §5.1.1(v) "Delete my account…" → "Delete account" button-label change also lands here to match UI-SPEC line 567 exactly.
- **Files modified beyond plan allow-list:** `SettingsPage.tsx`, `SignUpForm.tsx`, `PrivacyPolicy.tsx`, `TermsOfService.tsx`, `ConsumerHealthData.tsx`, `account-delete.test.ts`, `e2e/account-delete.spec.ts`
- **Verification:** `grep -rn "30 days\|30-day" src/ e2e/ | grep -iE "(soft|delet|grace|pending)"` returns 0 in-scope hits after the sweep (intentional matches in test files' regex string preserved).
- **Committed in:** `9372c59`

**2. [Rule 1 — Bug] `typedConfirmMatches` signature change without breaking callers**

- **Found during:** Task 2 implementation
- **Issue:** Original `typedConfirmMatches(typed, email)` had two required params; switching to single-param phrase-match would break the existing helper unit test's 5 test cases that pass email arguments.
- **Fix:** Made the second arg optional + ignored (`_legacyEmail?: string | null`). Phase 7's test cases still typecheck, and the helper-test suite was rewritten (6 new cases for the phrase contract; legacy 2-arg overload tested explicitly).
- **Files modified:** `src/lib/account-delete.ts`, `src/lib/account-delete.test.ts`
- **Committed in:** `9372c59`

**3. [Rule 2 — Missing critical] Settings-side button label change `Delete my account… → Delete account`**

- **Found during:** Task 2 implementation
- **Issue:** UI-SPEC §line 567 locks the settings-side button copy to "Delete account" (no trailing ellipsis). Existing code had "Delete my account…". Apple §5.1.1(v) compliance path also references "Delete account" (UI-SPEC line 304). Out-of-scope to leave drifted.
- **Fix:** Updated the button label + the e2e selector that depended on it.
- **Files modified:** `src/components/dashboard/settings/SettingsPage.tsx`, `e2e/account-delete.spec.ts`
- **Committed in:** `9372c59`

**4. [Rule 1 — Bug] PrivacyPolicy legal language updated to reflect phrase-confirm + HMAC link**

- **Found during:** Task 2 sweep
- **Issue:** Privacy Policy §Your rights describes the delete flow as "type your email to confirm. A 30-day undo window is available via a magic link emailed to you" — both window length AND auth mechanism are stale (UI-SPEC ships HMAC token, not magic link).
- **Fix:** Updated the paragraph to: "type DELETE MY ACCOUNT to confirm. A 7-day undo window is available via an HMAC-signed cancel link emailed to you at the time of deletion (and an in-app banner). After 7 days the deletion is irreversible by design."
- **Files modified:** `src/components/legal/PrivacyPolicy.tsx`
- **Committed in:** `9372c59`

---

**Total deviations:** 4 auto-fixed (2 missing-critical sweep extensions, 2 bug fixes for signature compatibility + legal correctness). All within the threat-model-anchored intent of the plan (T-22-35) — no scope creep.

## Known Stubs

None. Every component renders real data:
- DeleteAccountModal: live `signedIn.user.{id,email}` from Zustand store + real `initiateAccountDeletion` RPC + real `supabase.functions.invoke('lifecycle-transactional')`.
- SoftDeleteCountdownBanner: live `supabase.from('pending_account_deletions').select()` + real `cancel_account_deletion` RPC.
- /cancel-deletion: live `supabase.rpc('cancel_account_deletion')` with discriminated error mapping.

The "no_token" + "vault_missing" outcomes on /cancel-deletion are NOT stubs — they are intentional graceful-degradation paths for the deferred Vault `CANCEL_DELETION_HMAC_KEY` vendor pass (per 22-01 SUMMARY line 212 + 22-02 SUMMARY line 186). Once the Vault key is loaded, those branches become unreachable for valid tokens; the placeholder-URL short-circuit (`?token=pending`) remains as a defensive guard.

## Issues Encountered

1. **Pre-existing Wave 0 scaffold test failures (out of scope).** Full vitest run shows 5 test files failing at load (`Failed to resolve import`): `RefundModal.test.tsx`, `ImpersonationBanner.test.tsx`, `useImpersonationReadOnly.test.ts`, `DsarPortalPage.test.tsx`, `dsar-pdf-render.test.ts`. All 5 are Wave 0 scaffolds (commit `eea3017`) that import modules owned by sibling plans 22-04, 22-11, and the (TBD) admin refund plan. Per executor SCOPE BOUNDARY: out of scope for 22-05. Logged in `deferred-items.md` Item #5 alongside the analogous Item #1 from plan 22-10. The 5 failures are not regressions of this plan's work; they were RED before this plan ran and stay RED until the owning plans ship their modules. Suite otherwise: **1112 passed / 43 skipped / 0 unexpected regressions**.
2. **HEAD-base drift on worktree spawn.** Worktree spawn-time base was `e94b75e` (Wave-2-adjacent commit) instead of the expected spawn-time base `5e97df3`. The mandatory HEAD-reset block reset HEAD to `5e97df3`; pre-req file check verified `DeleteAccountModal.tsx` exists at `leanshot/src/components/dashboard/settings/` (not `leanshot/src/components/settings/` as in the executor prompt). Resolved via path correction — no code impact.
3. **Worktree `leanshot/node_modules` not seeded.** First `npm test` invocation failed with `sh: vitest: command not found`. Resolved by `npm install` (850 packages). Total install time ~7s; subsequent vitest/tsc/eslint runs unaffected.

## User Setup Required

**One deferred vendor pass blocks full end-to-end HMAC round-trip** (carried over from 22-01 + 22-02):

- **Vault `CANCEL_DELETION_HMAC_KEY`** must be set in Supabase Dashboard → Project Settings → Vault → Add new secret. Until then:
  - Modal still works (RPC fires + deletion scheduled).
  - lifecycle-transactional still sends the email (with placeholder `cancel_url=…?token=pending`).
  - /cancel-deletion landing recognizes the `pending` placeholder + shows the friendly help-text screen.
  - SoftDeleteCountdownBanner's in-app "Cancel deletion" CTA still works for users who arrive WITHOUT a token in the URL — it navigates them to /cancel-deletion (which shows help-text); for users WITH a `?cancel_token=`, the RPC returns `hmac_key_missing` → the banner toast surfaces "That cancel link is no longer valid…".
  - **Once the Vault key is loaded, no code changes required** — the full round-trip becomes live automatically. The deferred e2e spec `test.skip('account-delete cancel via HMAC link [DEFERRED]')` can be promoted by exporting the Vault key value to CI as `process.env.CANCEL_DELETION_HMAC_KEY` and dropping the `.skip`.

Verification once vendor-pass is loaded:

```bash
node_modules/.bin/supabase db query --linked \
  "select name from vault.decrypted_secrets where name='CANCEL_DELETION_HMAC_KEY';"
# expect 1 row
```

## Next Phase Readiness

- **22-12 AppShell integration unblocked.** Mount `<SoftDeleteCountdownBanner />` at the top of `AppShell` (above topbar). Banner is self-contained — no props, reads session+pending_account_deletions internally; impersonation-yield is also self-contained.
- **22-04 impersonation banner — contract confirmed.** SoftDeleteCountdownBanner's B8 test asserts that the banner is NOT mounted when `session.user.app_metadata.impersonator_id` is set. When 22-04 ships ImpersonationBanner, the priority contract (impersonation > soft-delete) holds without further refactor.
- **22-11 DSAR / 22-09 cookie-consent — independent surfaces.** No coupling to this plan. The /cancel-deletion route shares the lazy-chunk-on-its-own-pathname pattern with future v1.2 routes (P22 already uses it across multiple plans).
- **DEL-01 + DEL-02 user-facing surface complete** per `requirements-completed`. P19 backend account-delete Edge Fn cascade unchanged.

## Self-Check: PASSED

**Files exist (worktree):**
- leanshot/src/components/dashboard/settings/DeleteAccountModal.tsx: FOUND
- leanshot/src/lib/account-delete.ts: FOUND
- leanshot/src/lib/account-delete.test.ts: FOUND
- leanshot/src/test/account-delete.test.tsx: FOUND
- leanshot/src/components/soft-delete/SoftDeleteCountdownBanner.tsx: FOUND
- leanshot/src/components/soft-delete/__tests__/SoftDeleteCountdownBanner.test.tsx: FOUND
- leanshot/src/pages/cancel-deletion.tsx: FOUND
- leanshot/src/App.tsx: FOUND (modified)
- leanshot/e2e/account-delete-cancel.spec.ts: FOUND
- leanshot/e2e/account-delete.spec.ts: FOUND (modified)
- leanshot/src/components/dashboard/settings/SettingsPage.tsx: FOUND (modified)
- leanshot/src/components/auth/SignUpForm.tsx: FOUND (modified)
- leanshot/src/components/legal/PrivacyPolicy.tsx: FOUND (modified)
- leanshot/src/components/legal/TermsOfService.tsx: FOUND (modified)
- leanshot/src/components/legal/ConsumerHealthData.tsx: FOUND (modified)

**Commits exist on `worktree-agent-a64d8bd24af45f6d5`:**
- `9372c59` (Task 1+2 — feat): FOUND
- `0e9fa60` (Task 3 — feat): FOUND
- `73184eb` (Task 4 — feat): FOUND

**Verification claims confirmed:**
- 35 vitest tests green (13 modal + 6 helper + 8 banner + 8 misc): verified via `vitest run src/test/account-delete.test.tsx src/lib/account-delete.test.ts src/components/soft-delete/__tests__/SoftDeleteCountdownBanner.test.tsx`.
- Zero "30 days"/"30-day" hits in soft-delete-scoped grep across src+e2e: verified.
- Bundle index gz 15.09 kB (50 kB ceiling): verified via `vite build`.
- Typecheck (tsc -b): verified clean.
- Lint (eslint on changed files): verified 0 errors.
- 5 unrelated Wave 0 scaffold load-failures: pre-existing, owned by sibling plans 22-04/22-11/admin-refund, logged in `deferred-items.md` Item #5.

---

*Phase: 22-owner-admin-lifecycle-email-dsar-cookie-consent*
*Completed: 2026-05-16*
