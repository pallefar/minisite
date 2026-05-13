---
phase: 09-clinic-b2b-foundations
plan: 05
subsystem: clinic-b2b-foundations
tags: [settings, patient-ux, memberships, consent-scope, revoke, realtime, rtl-tests]
status: complete
dependency_graph:
  requires:
    - "Plan 09-01: src/types/clinic.ts (ConsentScope, DATA_TYPE_KEYS, DATA_TYPE_LABELS, Membership, Org, Role)"
    - "Plan 09-01: SettingsPage NAV entry 'organizations' + lazy mount + ActiveOrganizationsSection.tsx stub"
    - "Plan 09-01: memberships SELECT RLS (memberships_select_own) + update_consent_scope/revoke_membership RPCs"
    - "Plan 09-02: src/lib/clinic.ts updateConsentScope + revokeMembership wrappers (parallel-execution stub shipped here pending merge)"
    - "Plan 09-02: src/lib/clinic-realtime.ts subscribeToUserChannel helper (parallel-execution stub shipped here pending merge)"
  provides:
    - "Patient-side Active organizations tab (D-15) — populated list of memberships with per-row Edit + Revoke"
    - "Per-membership scope-edit modal (D-06) — defensive jsonb hydration via DATA_TYPE_KEYS canonical filter"
    - "Patient-side self-revoke flow (CLINIC-03 second half) — typed-confirm UX + audit_logs capture half"
    - "Realtime cross-context broadcast handler (D-10 Layer 1 patient direction) — operator revoke animates row out + toast"
  affects:
    - "Plan 09-10 (cross-context revoke-latency drill — exercises the operator side of the same broadcast)"
    - "Phase 10 patient-mirror surfaces (operator action mirroring; prop contract here stays stable)"
tech-stack:
  added:
    - "(none — pure composition of existing UI primitives + Plan 09-01 types + Plan 09-02 wrappers)"
  patterns:
    - "Defensive jsonb scope-init (`DATA_TYPE_KEYS.reduce(...)`) — Pitfall #8 jsonb-drift defense, mirrors Plan 09-04 W-5 fix"
    - "Optimistic row-exit animation (set-then-timeout-then-refetch) — mirrors Phase 8 ActiveSharesSection pattern"
    - "Realtime user-channel subscription with cancellation guard — defer-mount-safe for null auth.getUser() result"
    - "Stable callback identity via toastRef + rowsRef — avoids re-subscribing the channel per render"
key-files:
  created:
    - "leanshot/src/components/dashboard/settings/EditConsentScopeModal.tsx (160 lines)"
    - "leanshot/src/components/dashboard/settings/EditConsentScopeModal.test.tsx (5 tests)"
    - "leanshot/src/components/dashboard/settings/sections/ActiveOrganizationsSection.test.tsx (10 tests)"
    - "leanshot/src/lib/clinic.ts (parallel-execution stub — Plan 09-02 owns real impl)"
    - "leanshot/src/lib/clinic-realtime.ts (parallel-execution stub — Plan 09-02 owns real impl)"
  modified:
    - "leanshot/src/components/dashboard/settings/sections/ActiveOrganizationsSection.tsx (overwrote Plan 09-01 stub — 470 lines)"
decisions:
  - "Two-commit pathspec hygiene: parallel-execution stubs (src/lib/clinic{,-realtime}.ts) committed separately from the 4 plan-owned files, so the orchestrator's merge-time conflict resolver against Plan 09-02 surfaces clearly."
  - "Logo render uses `supabase.storage.from('org-logos').getPublicUrl(path)` per Plan 09-01's Storage bucket convention; `onError` hides the broken `<img>` so a stale path silently falls back to the Building2 monogram (no UI red-X)."
  - "Realtime broadcast handler treats any non-revoke payload as a generic refetch trigger — keeps the handler dumb so future broadcast event types (scope-edit, member-added) don't need handler changes."
  - "Exit-animation timeout (240ms) matches the CSS transition-duration declared on the row's `transition-[opacity,transform]` class — keeps the visual exit aligned with the refetch."
metrics:
  duration_minutes: ~45
  tasks_complete: 1
  tasks_total: 1
  tests_added: 15
  files_created: 5
  files_modified: 1
  completed: 2026-05-13
---

# Phase 9 Plan 09-05: Active Organizations + Scope Edit Summary

Patient-side org-management slice — Settings → Active organizations tab + per-row Edit + Revoke + Realtime cross-context broadcast handler. Overwrites Plan 09-01's `ActiveOrganizationsSection.tsx` stub and adds `EditConsentScopeModal.tsx`. Plan 09-02 dependencies (`src/lib/clinic.ts`, `src/lib/clinic-realtime.ts`) stubbed in this branch for parallel-execution compile (orchestrator resolves at merge).

## What landed

### 1. `src/components/dashboard/settings/sections/ActiveOrganizationsSection.tsx` (overwrites Plan 09-01 stub)

470 lines. Mirrors the Phase 8 `ActiveSharesSection` pattern (skeleton → empty | error | populated list → typed-confirm revoke modal → refetch after mutation) and extends it with two new behaviors:

- **Realtime user-channel subscription** via `subscribeToUserChannel` (Plan 09-02) — operator-side revoke broadcasts trigger row exit animation + toast `{org name} ended your membership.`
- **Per-row scope summary** — `Sharing {N} of 10 data types` where N counts only canonical `DATA_TYPE_KEYS` trues, so an extra key on a drift-affected blob (Pitfall #8) cannot inflate the displayed count.

Rows render org logo (Storage public URL with monogram fallback), name, role pill, joined relative-time, scope summary, Edit IconButton (`aria-label="Edit what you share with {org name}"`), Revoke IconButton (`aria-label="Revoke membership with {org name}"`). Revoke opens a typed-confirm modal that disables the destructive button until the user types the org name case-insensitively (matches Phase 8 / Phase 7 `DeleteAccountModal` pattern). On submit calls `revokeMembership({membership_id})`; row animates out (240ms exit transition aligned with the CSS `transition-[opacity,transform]` duration) then refetches.

`useStore` is never used here — the patient's identity is read from `supabase.auth.getUser()` so the component does not couple to the Zustand store (which has no Phase 9 fields). The mount-effect that registers the Realtime subscription cancels via a captured `cancelled` flag; the unsubscribe runs on unmount.

### 2. `src/components/dashboard/settings/EditConsentScopeModal.tsx`

160 lines. Controlled modal pre-filled from `membership.consent_scope` via the W-5 defensive hydration pattern:

```typescript
const [scope, setScope] = useState<ConsentScope>(() =>
  DATA_TYPE_KEYS.reduce(
    (acc, k) => ({ ...acc, [k]: (raw as Record<string, unknown>)[k] === true }),
    {} as ConsentScope,
  ),
);
```

Always renders exactly 10 checkboxes, in canonical `DATA_TYPE_KEYS` order, regardless of input shape. Save dispatches `updateConsentScope({membership_id, consent_scope})` — the payload always has the canonical 10 keys, so the server-side `_validate_consent_scope` check (Plan 09-01 helper) cannot reject due to drift. On success: calls `onSaved(scope)` then `onClose()`. On failure: inline alert `Couldn't save. Check your connection and try again.`.

### 3. Tests (15 total, all pass)

**`ActiveOrganizationsSection.test.tsx` — 10 RTL tests:**

- Empty state copy + heading
- Loading skeleton on initial mount (aria-busy)
- One row renders with "Sharing 7 of 10 data types"
- Multi-row render
- Network error → inline retry button
- Edit IconButton opens EditConsentScopeModal with 10 pre-filled checkboxes
- Revoke IconButton opens typed-confirm modal; destructive button disabled until typed
- Revoke submit calls `revokeMembership({membership_id})` + row enters exiting state
- Realtime operator-revoke broadcast animates the matching row out
- Pitfall #8 defense — drifted jsonb (extra `foo` key + missing `sleep` key) still renders the canonical 7-true count

**`EditConsentScopeModal.test.tsx` — 5 RTL tests:**

- Renders 10 canonical checkboxes
- Defensive scope-init: drifted blob (extra `foo` key + missing `sleep`) → modal renders all 10 + Save payload omits `foo` + includes `sleep:false`
- Toggle a checkbox + Save → `updateConsentScope` receives the modified scope + `onSaved` + `onClose` both fire
- Save failure surfaces inline `Couldn't save…` alert
- B-2 invariant — module body never references `SettingsPage`

### 4. Parallel-execution stubs (chore commit `d42431f`)

`src/lib/clinic.ts` + `src/lib/clinic-realtime.ts` — minimal contract-only modules so the worktree-branch test runner can resolve the imports. The contracts mirror Plan 09-02's `<interfaces>` block exactly. Orchestrator's merge resolver replaces these with Plan 09-02's real implementations.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Auto-fix blocking issue] Parallel-execution stubs for `@/lib/clinic` and `@/lib/clinic-realtime`**

- **Found during:** Task 1 (first test run)
- **Issue:** Plan 09-05 imports from `@/lib/clinic` (`updateConsentScope`, `revokeMembership`) and `@/lib/clinic-realtime` (`subscribeToUserChannel`). Plan 09-02 owns the real implementations of those files, but 09-02 runs in parallel with 09-05 in Wave 2 — neither module exists on the 09-05 worktree branch. Vite's import-analysis pass fails at test-load time with "Failed to resolve import '@/lib/clinic'".
- **Fix:** Created minimal contract-only stub modules at `src/lib/clinic.ts` and `src/lib/clinic-realtime.ts`. Stubs export the exact symbols Plan 09-02 declares in its `<interfaces>` block (lines 125-132). Stub bodies return `{ok:false, error:'not_implemented_until_09_02'}` and a no-op unsubscribe respectively. Committed separately as `chore(09-05): parallel-execution stubs ...` so the merge conflict against Plan 09-02 is structural (same file paths, different bodies) and trivially resolved in favor of Plan 09-02's real implementation.
- **Files modified:** `src/lib/clinic.ts`, `src/lib/clinic-realtime.ts` (both new)
- **Commit:** `d42431f`

**2. [Rule 1 - Bug] TypeScript signature mismatch between `subscribeToUserChannel` callback (`unknown`) and Plan 09-05 handler typed as `RealtimePayload`**

- **Found during:** Task 1 (`tsc -b` pass after first green test run)
- **Issue:** `subscribeToUserChannel(_userId, _onChange: (payload: unknown) => void)` per the contract; passing a `(payload: RealtimePayload) => void` was a TS error.
- **Fix:** Accept `unknown` then cast to `RealtimePayload` inside the body. Keeps the contract honest and the body type-narrowed.
- **Files modified:** `src/components/dashboard/settings/sections/ActiveOrganizationsSection.tsx`
- **Commit:** `c46b085` (bundled into the main feat commit)

**3. [Rule 1 - Bug] Test pollution between "Revoke submit" and "Realtime broadcast" cases**

- **Found during:** Task 1 (15/15 pass on second run; the first run had 14/15 due to `mockReturnValueOnce` queue persistence across tests)
- **Issue:** `vi.clearAllMocks()` does NOT drain the per-call queue installed by `mockReturnValueOnce`. The "Revoke submit" test queued two responses; only one was consumed (the second was held pending the 240ms refetch timer which finished after test exit). The next test then received the leftover response.
- **Fix:** Added `fromMock.mockReset()` to `beforeEach` (full reset including implementation queue). Replaced `mockReturnValueOnce` chains with `mockImplementation` for the Realtime test (returns a fresh QueryBuilder per call).
- **Files modified:** `src/components/dashboard/settings/sections/ActiveOrganizationsSection.test.tsx`
- **Commit:** `c46b085`

### Out-of-scope (deferred)

- **`@testing-library/dom` `getByText` waitFor noise** — Phase 9 RTL tests still emit DOM dumps on failure (because Phase 8 disabled the prettyDOM length cap somewhere). Not a 09-05 regression; covered by the codebase's existing Phase 8 baseline.
- **`role="list"` and `role="listitem"` redundancy** — the UI-SPEC line 691 mentions accessibility roles, but eslint-plugin-jsx-a11y flags them as redundant since `<ul>`/`<li>` have those roles implicitly. Removed the explicit `role=` attrs; the spec's intent (screen-reader announces "list with N items") is satisfied by the implicit role.

## Verification

- `npx vitest run src/components/dashboard/settings/EditConsentScopeModal.test.tsx src/components/dashboard/settings/sections/ActiveOrganizationsSection.test.tsx` → **15 pass / 0 fail**
- `npx tsc -b` → **clean** (no type errors)
- `npx eslint <all 6 files>` → **clean** (no errors, no warnings)
- `npm run build` → **success** (SettingsPage chunk 47.84 kB / 14.24 kB gz; index 20.50 kB gz — both well below ceilings)
- `git diff HEAD~2 -- src/components/dashboard/settings/SettingsPage.tsx | wc -l` → **0** (B-2 invariant verified — SettingsPage.tsx not touched by this plan's commits)
- `grep -rn "s\.user!"` in the 6 changed files → **0 actual assertions** (2 doc-comment mentions in module headers)

## Success Criteria Check

1. ✅ Patient-side Active organizations renders rows + scope summary + Edit + Revoke (`OrgRow` component, behavior tests 3+4).
2. ✅ EditConsentScopeModal updates consent_scope via `updateConsentScope` RPC with defensive scope-init (W-5 pattern, behavior tests 2+3 in modal suite).
3. ✅ Revoke flow writes `revoked_at` server-side (via Plan 09-01 `revoke_membership` RPC) + animates row out + toast + audit_logs row server-side (CLINIC-07 capture half — verified by Plan 09-09's RLS impersonation drill, not in-band here).
4. ✅ Realtime user-channel cross-context updates work (`subscribeToUserChannel` registers + payload handler animates + toast).
5. ✅ Bundle delta within budget (index 20.50 kB gz; SettingsPage chunk 14.24 kB gz). The full Phase 9 settings-chunk delta budget (≤4 kB) is bounded by these specific files — Plan 09-04 ConsentDialog ships in its own chunk and Plans 09-06+ ship Edge-Function call wrappers not bundled into the SettingsPage chunk.
6. ✅ SettingsPage NAV array properly extended by Plan 09-01 (`'organizations'` entry between `'shares'` and `'recovery'`; render branch wired) — verified, untouched here.
7. ✅ No SettingsPage edits (B-2 — `git diff` shows 0 lines).

## Threat Flags

None — all surfaces declared in the plan's `<threat_model>` are mitigated by the implementation:

- **T-09-29 (consent_scope drift attack):** EditConsentScopeModal iterates `DATA_TYPE_KEYS` (not `Object.keys`) in both the checkbox render and the Save payload construction. The Plan 09-01 server-side `_validate_consent_scope` is the second layer.
- **T-09-30 (Realtime user-channel leak):** The component subscribes via `subscribeToUserChannel(user.id, …)`; the server-side `realtime.messages` RLS policy (Plan 09-01 migration 12) gates the `user:` topic on `auth.uid() = parsed user_id`. No client-side trust assumption.
- **T-09-31 (patient denies revoking):** `revokeMembership` RPC (Plan 09-01) writes the `membership_revoked` audit_logs row with `actor_type='org_member'` (self-revoke branch) + `org_id` + `user_id_hash`. Visible in Phase 10's audit-surface UI.

## Self-Check

```
FOUND: src/components/dashboard/settings/sections/ActiveOrganizationsSection.tsx (modified, 470 lines)
FOUND: src/components/dashboard/settings/sections/ActiveOrganizationsSection.test.tsx (new, 10 tests)
FOUND: src/components/dashboard/settings/EditConsentScopeModal.tsx (new, 160 lines)
FOUND: src/components/dashboard/settings/EditConsentScopeModal.test.tsx (new, 5 tests)
FOUND: src/lib/clinic.ts (new — parallel-execution stub)
FOUND: src/lib/clinic-realtime.ts (new — parallel-execution stub)
FOUND commit d42431f (parallel-execution stubs)
FOUND commit c46b085 (Active orgs section + scope edit modal + tests)
VERIFIED: src/components/dashboard/settings/SettingsPage.tsx unchanged (0 diff lines)
VERIFIED: 15/15 tests pass
VERIFIED: tsc clean
VERIFIED: eslint clean on all 6 changed files
VERIFIED: npm run build success
```

## Self-Check: PASSED
