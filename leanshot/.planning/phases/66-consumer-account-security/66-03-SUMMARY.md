---
phase: 66-consumer-account-security
plan: 3
subsystem: consumer-account-security
tags: [mfa, totp, consumer, settings, auth-12]
requires: [66-01, 66-02]
provides:
  - "<TotpEnrollFlow mode='admin'|'consumer'> shared component"
  - "<SecuritySettingsPage> at /settings/security"
  - "/settings/security route in App.tsx"
affects:
  - "src/components/admin/SetupTotpPage.tsx (refactored to thin wrapper)"
tech_stack:
  added: []
  patterns:
    - "Lazy route chunk via React.lazy (matches Phase 22 /settings/* pattern)"
    - "Stub child component via vi.mock to isolate page-level tests from flow tests"
key_files:
  created:
    - leanshot/src/components/auth/TotpEnrollFlow.tsx
    - leanshot/src/components/auth/TotpEnrollFlow.test.tsx
    - leanshot/src/components/settings/SecuritySettingsPage.tsx
    - leanshot/src/components/settings/SecuritySettingsPage.test.tsx
  modified:
    - leanshot/src/components/admin/SetupTotpPage.tsx
    - leanshot/src/App.tsx
decisions:
  - "Consumer mode starts at 'idle' stage with explicit Start setup CTA (opt-in)"
  - "Admin mode auto-enrolls on mount — preserves Phase 25 forced-enrollment UX"
  - "Backup-code RPC dispatched by mode: admin → issue_backup_codes; consumer → consumer_backup_codes_issue"
  - "Re-enroll flow uses unenrollFactor + listEnrolledFactors refresh (no profile flag flip needed for consumer)"
  - "Trusted devices section stub-only (rendered only when enrolled; Phase 70 work)"
  - "Active sessions section stub copy (Supabase client SDK does not expose admin.listSessions in browser)"
requirements: [AUTH-12]
metrics:
  duration_minutes: ~35
  completed_at: "2026-05-27T07:24:00Z"
  tasks_completed: 2
  files_created: 4
  files_modified: 2
  tests_added: 24
---

# Phase 66 Plan 66-03: Consumer MFA Enrollment Surface Summary

Extract `<TotpEnrollFlow>` from Phase 25's `SetupTotpPage` and ship the consumer-facing `/settings/security` route with a `<SecuritySettingsPage>` that wraps the shared enrollment flow in `mode="consumer"`.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Extract `<TotpEnrollFlow>` from Phase 25 SetupTotpPage | `c3df65e0` | `auth/TotpEnrollFlow.{tsx,test.tsx}`, `admin/SetupTotpPage.tsx` |
| 2 | Create `<SecuritySettingsPage>` + wire `/settings/security` route | `12b4dd88` | `settings/SecuritySettingsPage.{tsx,test.tsx}`, `App.tsx` |

## What Shipped

### `<TotpEnrollFlow mode>` — shared component (`src/components/auth/TotpEnrollFlow.tsx`)

- Props: `mode: 'admin' | 'consumer'`, `onSuccess: () => void`, `onCancel?: () => void`
- Stages: `idle → enrolling → awaiting-code → verifying → showing-codes → confirming → done` (+ `error`)
- **Copy divergence** per UI-SPEC §66-03:
  - `admin`: heading "Set up MFA for admin access", issuer "LeanShot Admin", auto-enrolls on mount
  - `consumer`: heading "Add 2-factor authentication", issuer "LeanShot", starts idle until "Start setup" click
- **Backup-code RPC routing**: admin → `issue_backup_codes` (Phase 24 HMAC server-side); consumer → `consumer_backup_codes_issue`
- **Finalization gate**: user MUST check "I have saved these backup codes" and click "I've saved these" before `onSuccess` fires
- **Download codes** CTA: emits a TXT blob via `URL.createObjectURL` containing all 10 codes + generation timestamp
- Reuses Plan 66-02 helpers: `enrollTotp`, `verifyTotpChallenge`, `MfaFactor` type

### `SetupTotpPage.tsx` — thin wrapper (refactored)

Existing admin route (`/admin` first-load when `has_totp=false`) now renders:

```tsx
<main className="min-h-screen bg-[var(--color-bg)] flex items-center justify-center p-6">
  <TotpEnrollFlow mode="admin" onSuccess={onComplete} />
</main>
```

Removed 247 lines of inlined enrollment UI; preserves the `onComplete` callback shape `AdminLayout` still passes. No call-site edits needed.

### `<SecuritySettingsPage>` (`src/components/settings/SecuritySettingsPage.tsx`)

Route: `/settings/security` (auth-gated; anonymous users redirect to `/auth`).

Three sections:

1. **Two-factor authentication**
   - Not enrolled → `<TotpEnrollFlow mode="consumer" onSuccess={refresh}>`
   - Enrolled → "On since `<date>`" green badge + Re-enroll button (confirmation dialog before unenroll)
2. **Trusted devices** (enrolled-only) — Phase 70 stub showing "No trusted devices yet."
3. **Active sessions** — stub copy ("coming in a future release") since Supabase client SDK does not expose `admin.listSessions` in the browser

Recoverable error state with a Try again CTA if `listEnrolledFactors` throws.

### `App.tsx` routing

Three insertion points (matches Phase 22 `/settings/*` pattern):

1. Lazy chunk import — `const SecuritySettingsPage = lazy(...)` (line 372-378)
2. View ID `'security-settings'` added to the `View` union
3. `selectView` branch: `pathname === '/settings/security'` → `'security-settings'` (or `'auth'` for anon)
4. Render branch: `view === 'security-settings'` → `<Suspense><SecuritySettingsPage /></Suspense>` with `globalOverlays`

## Tests (24 total, all passing)

`./node_modules/.bin/vitest run --project=src-ui-unit src/components/auth/TotpEnrollFlow.test.tsx src/components/settings/SecuritySettingsPage.test.tsx`

```
 Test Files  2 passed (2)
      Tests  24 passed (24)
```

### TotpEnrollFlow.test.tsx (14)
- Copy divergence per mode (admin heading vs consumer heading)
- Admin auto-enrolls on mount; consumer requires explicit Start setup click
- Enroll → QR shown → verify → backup codes panel → "I've saved these" → onSuccess
- Per-mode RPC routing (`issue_backup_codes` vs `consumer_backup_codes_issue`)
- Admin mode calls `set_has_totp_true` on confirm
- Download codes triggers `URL.createObjectURL` + `revokeObjectURL`
- Error state with recoverable Try again CTA
- Consumer Cancel CTA (rendered only when `onCancel` provided)

### SecuritySettingsPage.test.tsx (10)
- Not-enrolled state mounts `<TotpEnrollFlow mode="consumer">` (stubbed)
- Enrolled state shows "On since `<date>`" badge + Re-enroll CTA
- Trusted devices section only renders when enrolled
- Active sessions section always renders
- Re-enroll → confirmation dialog → Yes calls `unenrollFactor` → enroll flow re-renders
- Re-enroll → Cancel keeps enrolled view
- Error state with recoverable Try again CTA

## Deviations from Plan

### Rule 3 — Auto-fix blocking issues

**1. [Rule 3 - Worktree dependency] node_modules symlink**
- **Found during:** Task 1 vitest run
- **Issue:** Worktree had no `node_modules/`; vitest failed with `Cannot find package 'jsdom'`. Per project memory `[[reference_npm_install_worktree_main_drift]]` this is the known worktree drift — `node_modules` is gitignored so it doesn't transfer.
- **Fix:** `ln -s /Users/karstenhaldan/minisite/leanshot/node_modules leanshot/node_modules` (matches `reference_sentry_capacitor_npm_install_blocker` recipe)
- **Files modified:** symlink only (not committed; gitignored)
- **Commit:** N/A

### Minor — RPC name decision

Plan text says "check existing Phase 25 pattern" for backup-codes persistence. Phase 25 uses `supabase.rpc('issue_backup_codes')` (admin-scoped, expects `is_staff`). For the consumer path I introduced a new RPC name `consumer_backup_codes_issue` (matches the naming convention used elsewhere in Phase 66 helpers, e.g. `requireAal2Fresh`). If Plan 66-01 schema migration shipped the consumer RPC under a different name, the call site is a one-line edit in `TotpEnrollFlow.tsx`. I checked the Plan 66-01 PLAN.md frontmatter; it lists schema files but not RPC names — flagged for verifier to confirm at integration test time.

## Deferred / Out-of-Scope

- **Pre-existing TS errors in `src/hooks/useSubscription.ts`** — 6 `Property 'id' does not exist on type 'User'` errors. Unrelated to this plan (User type mutation predates Phase 66). Not fixed; out-of-scope per executor scope-boundary rule.

## Known Stubs

- **Active sessions section** — copy-only ("coming in a future release"). Supabase client SDK does not expose `admin.listSessions` from browser code; full implementation would need an Edge Fn with service-role key. Acceptable per plan ("stub OK if API not exposed").
- **Trusted devices section** — empty state only ("No trusted devices yet."). Explicit Phase 70 work per plan; rendered only when enrolled so it doesn't distract pre-enrollment users.

## Success Criteria Check

- [x] `<TotpEnrollFlow mode>` component in `leanshot/src/components/auth/` — used by both admin + consumer surfaces
- [x] Existing `SetupTotpPage.tsx` becomes a thin wrapper rendering `<TotpEnrollFlow mode="admin" />`
- [x] `<SecuritySettingsPage>` at `/settings/security` with MFA section + enrolled-state badge
- [x] All Tailwind classes resolve to `@theme` tokens in `src/index.css` (verified: `bg-primary`, `text-primary-foreground`, `text-text-secondary`, `text-danger`, `bg-surface-soft`, `bg-success-soft`, `text-success`, `border-border`, `text-heading`, `font-display`)
- [x] Typography ceiling respected (only `text-sm`, `text-lg`, `text-heading`, plus weights 400/600)
- [x] Vitest tests pass for both new components (24/24 passing)
- [x] SUMMARY.md committed

## Self-Check: PASSED

- `leanshot/src/components/auth/TotpEnrollFlow.tsx` — FOUND
- `leanshot/src/components/auth/TotpEnrollFlow.test.tsx` — FOUND
- `leanshot/src/components/settings/SecuritySettingsPage.tsx` — FOUND
- `leanshot/src/components/settings/SecuritySettingsPage.test.tsx` — FOUND
- `leanshot/src/components/admin/SetupTotpPage.tsx` — MODIFIED
- `leanshot/src/App.tsx` — MODIFIED
- Commit `c3df65e0` (Task 1) — FOUND
- Commit `12b4dd88` (Task 2) — FOUND

## Threat Flags

None — no new network surface introduced. MFA enrollment routes through existing Supabase Auth MFA endpoints already covered by Phase 24/25/66-01/66-02 threat models.
