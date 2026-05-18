---
phase: 31-white-label-path-based-org-roles-clinic-onboarding-builder
verified: 2026-05-18T11:50:00Z
revised: 2026-05-18T12:15:00Z
status: passed-with-deferred-human
score: 3/3 must-haves verified (after 31-07 gap-closure migration)
overrides_applied: 0
gap_closure:
  plan: "31-07"
  migration: "supabase/migrations/20270601700001_p31_07_log_org_action_helper.sql"
  pushed: 2026-05-18T12:10:00Z
  approach: "proper fix (per user choice) — ship NEW log_org_action() audit helper gated on org membership (not is_admin_at_least), rewire 4 affected SECDEFs to use it"
  closed:
    - "BLOCKER #1: change_member_role 2-arg signature bug + admin-gate"
    - "BLOCKER #2: save_org_branding admin-gate"
    - "missed BLOCKER #3 (not in original verifier report): activate_onboarding_flow_version had same 2-arg signature bug — fixed in same migration"
human_verification:
  - test: "Org owner manually saves branding (logo, primary color) via BrandingTab"
    expected: "Branding saves successfully and the clinic path shows updated colors on next load (no 42501 toast)"
    why_human: "Cannot test org-owner auth context programmatically without creating a full org+member fixture; the Playwright e2e for branding was not included in the phase. log_org_action's org-member gate confirmed live via pg_get_function_arguments; the actual call path needs a real org-owner session to fully exercise."
    status: deferred
  - test: "Org owner assigns clinician role to a staff member via RoleEditorModal"
    expected: "Role is updated in org_members; no error toast for the owner; audit_logs row inserted with actor_type='org_member' and metadata.actor_role='owner'"
    why_human: "role-editor-modal vitest mocks supabase.rpc — does not exercise the live change_member_role SECDEF path. 31-07 verified the SECDEF body via pg_proc but a real org-owner session is needed for the full path."
    status: deferred
  - test: "Org owner restores a prior onboarding flow version via OnboardingTab"
    expected: "Selected version becomes active; audit row written"
    why_human: "Same as above — activate_onboarding_flow_version was also fixed in 31-07; needs live org-owner session."
    status: deferred
---

# Phase 31: White-Label (Path-Based) + Org Roles + Clinic Onboarding Builder — Verification Report

**Phase Goal:** Each clinic can theme itself path-based, admin per 3-role matrix, and customize patient onboarding via the same dnd-kit primitives Phase 15 shipped.
**Verified:** 2026-05-18T11:50:00Z
**Status:** gaps_found
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Visiting `/clinic/{slug}/...` applies `org_branding` CSS-var overlay (logo, primary color, accent, favicon) within first paint; no flash of unstyled theme | VERIFIED | `brand-tokens.ts` exports `applyBrandTokens`+`parseClinicSlug`; `main.tsx` pre-mount block runs synchronously BEFORE `void hydrate()`; `index.css` `@theme {}` fallback chains confirmed (`--color-primary: var(--brand-primary, ...)` etc.); `resolve_clinic_branding` live on DB with anon+authenticated grants; Playwright 3/3 pass |
| 2 | Org admin assigns 3 roles (owner / clinician / staff); UI gates admin actions per role; permission matrix enforced server-side (RLS) and client-side (UI) | FAILED | `change_member_role` SECDEF calls `log_admin_action(text, jsonb)` (2-arg) — no such overload exists; runtime "function does not exist" error rolls back every role change. `save_org_branding` 6-arg call is correct but `log_admin_action` raises `42501` for org owners (not system admins), rolling back branding saves. |
| 3 | Clinic admin drags onboarding steps (reusing Phase 15 dnd-kit primitives) and saves org-specific onboarding flow; invited patients see that org's flow on first sign-in | VERIFIED | `SortableTreePanel<OnboardingStepNode>` extracted and consumed by `OnboardingTab`; `save_org_onboarding_flow` exception-wrapped for best-effort audit; `OrgOnboardingFlowRenderer` in `OnboardingFlow.tsx`; `App.tsx` routes invited patients to dashboard; Playwright 4/4 e2e pass; `profiles.completed_onboarding_at` confirmed on live DB |

**Score:** 2/3 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/lib/brand-tokens.ts` | parseClinicSlug, applyBrandTokens, fetchClinicBranding, BRAND_CACHE_KEY_PREFIX | VERIFIED | 6 named exports; bare fetch; 242 lines |
| `src/main.tsx` | pre-mount brand block BEFORE hydrate() | VERIFIED | Lines 142-181: synchronous warm-paint + async refresh + favicon injection |
| `src/index.css` | Tailwind v4 fallback chains for --brand-* | VERIFIED | `--color-primary: var(--brand-primary, ...)`, `--color-bg: var(--brand-bg, ...)`, `--color-text: var(--brand-text, ...)`, font/radius brand aliases |
| `src/lib/org.ts` | ROLE_PERMISSIONS 12-key const | VERIFIED | 12 keys: owner has all 12, clinician has 4, staff has 2 |
| `src/components/clinic/settings/RoleEditorModal.tsx` | 12x3 matrix + last-owner guard + change_member_role RPC | VERIFIED | `ORG_MATRIX_PERMISSION_KEYS` (12 keys), `ORG_ROLES` (3 roles), last-owner guard (line ~211+), `supabase.rpc('change_member_role', ...)` call |
| `src/components/clinic/settings/BrandingTab.tsx` | surfaceCheck('branding.edit') gate + WCAG meter + upload + save_org_branding | VERIFIED | 1055 lines; full implementation with oklch validation, WCAG contrast meter, upload zones via Edge Fn, optimistic undo |
| `src/components/clinic/settings/OnboardingTab.tsx` | SortableTreePanel<OnboardingStepNode> + save_org_onboarding_flow | VERIFIED | 1005 lines; SortableTreePanel consumed at line 48; save/activate/version-history all wired |
| `src/components/ui/SortableTreePanel.tsx` | Generic dnd-kit primitive extracted from Phase 15 | VERIFIED | 185 lines; generic type param `T`; Phase 15 a11y contract preserved |
| `src/lib/onboarding-builder/use-org-onboarding-flow.ts` | 4-state hook for invited patients | VERIFIED | 202 lines; Zustand auth source; two-phase DB query |
| `src/components/onboarding/OnboardingFlow.tsx` | OrgOnboardingFlowRenderer render branch | VERIFIED | Lines 121-128: org branch; `OrgOnboardingFlowRenderer` at line 673; `mark_onboarding_complete` at line 782 |
| `src/App.tsx` | selectView routes non-anonymous signed-in patients to dashboard | VERIFIED | Lines 591-596: extends selectView for verified non-anonymous patients without LeanShot user |
| `e2e/clinic-brand-first-paint.spec.ts` | 3 first-paint smoke scenarios | VERIFIED | 3 tests; PLAYWRIGHT_RUN_P31=1 gate; addInitScript seeding |
| `e2e/patient-org-onboarding.spec.ts` | 4 patient onboarding e2e scenarios | VERIFIED | 4 tests; org flow renders / timestamp / skip / first-clinic-wins |
| `supabase/migrations/20270601500001_p31_03_resolve_clinic_branding.sql` | Public SECDEF resolve_clinic_branding | VERIFIED | Live on DB; anon+authenticated grants confirmed |
| `supabase/migrations/20270601400007_p31_04_change_member_role.sql` | change_member_role SECDEF | STUB | Lives on DB but calls 2-arg log_admin_action which doesn't exist; fails at runtime |
| `supabase/migrations/20270601400003_p31_02_branding_expand_and_wcag.sql` | save_org_branding SECDEF | STUB | Lives on DB but log_admin_action raises 42501 for org owners; no exception wrapper |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `main.tsx` pre-mount | `applyBrandTokens` in `brand-tokens.ts` | import + call before `hydrate()` | WIRED | Lines 9-12 import; lines 142-181 call site |
| `main.tsx` | `parseClinicSlug` | import + pathname check | WIRED | `parseClinicSlug(window.location.pathname)` at line 143 |
| `OnboardingTab.tsx` | `SortableTreePanel<OnboardingStepNode>` | import + render | WIRED | Line 48 import; integrated with `isDragDisabled` for mandatory steps |
| `OnboardingFlow.tsx` | `useOrgOnboardingFlow` | import + flowState.status check | WIRED | Line 22 import; line 70 call; line 122 branch |
| `App.tsx` | `useOrgOnboardingFlow` | import + dashboard gate | WIRED | Line 44 import; line 628 call; lines 1501-1506 gate |
| `RoleEditorModal` assign mode | `supabase.rpc('change_member_role', ...)` | call in onConfirm handler | WIRED (but SECDEF broken) | Line 349; SECDEF fails at runtime due to 2-arg log_admin_action |
| `BrandingTab` | `supabase.rpc('save_org_branding', ...)` | call in handleSave | WIRED (but SECDEF broken for org owners) | SECDEF fails at runtime due to log_admin_action 42501 |
| `index.css` | `--brand-*` CSS vars | Tailwind v4 `@theme {}` fallback chain | WIRED | `--color-primary: var(--brand-primary, ...)` etc. |
| `resolve_clinic_branding` SECDEF | `org_branding` + `organizations` tables | JOIN on org_id | WIRED | Live on DB; anon grant confirmed |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|--------------|--------|--------------------|--------|
| `main.tsx` brand block | `_brandSlug` / `BrandTokens` | `localStorage` warm-paint + `fetchClinicBranding` → `resolve_clinic_branding` RPC → `org_branding` table | Yes — live RPC with DB query | FLOWING |
| `OnboardingTab.tsx` | `steps: OnboardingStepNode[]` | `supabase.rpc('save_org_onboarding_flow')` / `supabase.from('org_onboarding_flows').select(...)` | Yes — real DB reads/writes | FLOWING |
| `OrgOnboardingFlowRenderer` | `flowState.steps` | `useOrgOnboardingFlow` → `profiles` + `org_onboarding_flows` SELECT | Yes — real DB reads | FLOWING |
| `RoleEditorModal` assign mode | `selectedRole` → `change_member_role` RPC | `supabase.rpc('change_member_role', ...)` | Yes — real RPC exists but SECDEF broken at audit step | HOLLOW (SECDEF fails at runtime) |
| `BrandingTab` | `branding tokens` → `save_org_branding` RPC | `supabase.rpc('save_org_branding', ...)` | Yes — real RPC exists but SECDEF fails for org owners | HOLLOW (SECDEF fails at runtime) |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| TypeScript compiles clean | `cd leanshot && npm run typecheck` | PASSED (exit 0) | PASS |
| Phase 31 vitest suite | `npx vitest run role-matrix-sync.test.ts role-editor-modal.test.tsx wcag-contrast.test.ts use-org-onboarding-flow.test.ts OnboardingFlowOrgBranch.test.tsx` | 4 passed / 1 skipped; 37 tests passed + 38 skipped (wave-2-gated env-gate) | PASS |
| `org_member_role` enum has 3 correct values | live DB query | `owner, clinician, staff` | PASS |
| All 12 Phase 31 SECDEFs present on live DB | live DB query | All 12 present (has_permission x2 overloads included) | PASS |
| `profiles.completed_onboarding_at` column exists | live DB query | `timestamp with time zone` confirmed | PASS |
| `org_onboarding_flows_active_per_org` partial unique index | live DB query | Present | PASS |
| Both storage buckets present | live DB query | `org-branding` and `org-onboarding-assets` confirmed | PASS |
| `change_member_role` 2-arg log_admin_action overload | live DB query (pronargs check) | Only 6-arg overload exists — 2-arg call will fail at runtime | FAIL |
| `save_org_branding` log_admin_action permission for org owners | live DB function check | `log_admin_action` calls `is_admin_at_least('staff'::admin_role)` — org owners fail | FAIL |

### Probe Execution

No probe scripts defined for this phase. Step 7c SKIPPED.

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|---------|
| ORG-11 | 31-03 | White-label theming per clinic (CSS-var overlay + custom logo + custom colors + favicon); path-based | SATISFIED | `resolve_clinic_branding` live; `brand-tokens.ts` + `main.tsx` pre-mount block; Playwright 3/3 |
| ORG-12 | 31-00, 31-01, 31-05 | Org admin manages 3 roles (owner / clinician / staff) with permission matrix; UI gates admin actions | BLOCKED | `has_permission` SECDEF live and correct; `ROLE_PERMISSIONS` 12-key TS const correct; UI RoleEditorModal full 12x3 matrix; BUT `change_member_role` and `save_org_branding` fail at runtime due to `log_admin_action` issues |
| ORG-13 | 31-04, 31-05, 31-06 | Per-clinic onboarding flow override (clinics customize patient-invite onboarding via Phase 15 dnd-kit) | SATISFIED | `org_onboarding_flows` table live; `SortableTreePanel` generic primitive; `OnboardingTab` + `OnboardingFlow` wired end-to-end; Playwright 4/4 |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `supabase/migrations/20270601400007_p31_04_change_member_role.sql` | 70-77 | `log_admin_action(text, jsonb)` — 2-arg call; no such overload exists in live DB | BLOCKER | `change_member_role` SECDEF fails at runtime with "function does not exist"; role assignment never commits |
| `supabase/migrations/20270601400003_p31_02_branding_expand_and_wcag.sql` | 309-319 | `log_admin_action` called without exception wrap; `is_admin_at_least('staff'::admin_role)` fails for org owners | BLOCKER | `save_org_branding` SECDEF fails for org owners (non-system admins); branding never saves |

No TBD / FIXME / XXX debt markers found in any Phase 31 source file (grep scan confirmed clean).

### Human Verification Required

#### 1. Branding Save for Org Owner

**Test:** Log in as an org owner (non-system-admin), navigate to `/clinic/{slug}/settings/branding`, change the primary color to a valid oklch value, click Save.
**Expected:** Branding saves successfully (no error toast), and reloading `/clinic/{slug}/` shows the new primary color in the first-paint CSS vars.
**Why human:** The Playwright first-paint spec uses localStorage seeding (no real DB write path exercised). The RLS branding e2e test is env-gated. The `save_org_branding` SECDEF runtime behavior for org owners cannot be verified without a live auth session that holds only `org_member_role = 'owner'` (not `admin_role`).

#### 2. Role Change for Org Owner

**Test:** Log in as an org owner, navigate to the members list, open RoleEditorModal in assign mode for a staff member, select Clinician, click Confirm.
**Expected:** The member's role updates to Clinician immediately, no error toast shown.
**Why human:** `change_member_role` vitest mocks `supabase.rpc` — it does not exercise the live SECDEF path. The 2-arg `log_admin_action` call failure was discovered via static migration analysis, not from a running test.

---

## Gaps Summary

**Two blockers prevent SC#2 from being satisfied in production:**

**Gap 1 — `change_member_role` 2-arg `log_admin_action` call (BLOCKER for ORG-12)**

The SECDEF `change_member_role` in migration `20270601400007` calls `log_admin_action('org_member.role_changed', jsonb_build_object(...))` with 2 arguments. The only `log_admin_action` overload on the live DB takes 6 arguments `(text, uuid, text, text, jsonb, jsonb)`. At runtime, this will raise `ERROR: function log_admin_action(text, jsonb) does not exist`, which causes the enclosing PL/pgSQL transaction to abort — rolling back the role update in step (d) as well. The fix is to wrap the `perform public.log_admin_action(...)` call in a `BEGIN...EXCEPTION WHEN OTHERS THEN NULL; END;` block (the same best-effort pattern applied in migration `20270601600001` for `save_org_onboarding_flow`), OR to fix the call signature to match the 6-arg overload.

**Gap 2 — `save_org_branding` `log_admin_action` auth guard (BLOCKER for ORG-11 writes and ORG-12)**

`save_org_branding` correctly calls the 6-arg `log_admin_action`. However, `log_admin_action` itself checks `is_admin_at_least('staff'::public.admin_role)` and raises if the caller is not a system admin. Org owners who are not also system admins will get `42501` from `log_admin_action`, causing the upsert in step 8 to be rolled back. The fix is to wrap the `log_admin_action` call in `BEGIN...EXCEPTION WHEN OTHERS THEN NULL; END;` (best-effort, same as `save_org_onboarding_flow` fix).

**Root cause (both gaps):** The `log_admin_action` cross-phase compatibility gap was flagged in 31-02-SUMMARY and 31-04-SUMMARY as a carry-over. Plan 31-06 fixed it ONLY for `save_org_onboarding_flow` (migration `20270601600001`). The fix was not applied to `save_org_branding` or `change_member_role`.

**Recommendation:** Two new inline migrations (following the existing `20270601600001` pattern):
- `20270601600005_p31_fix_save_org_branding_audit.sql` — exception-wrap for `save_org_branding`
- `20270601600006_p31_fix_change_member_role_audit.sql` — exception-wrap (or signature fix) for `change_member_role`

---

## Carry-Over Items (Informational — Not Blocking)

The following items were noted in plan SUMMARY files and have been scored:

| Item | Assessment |
|------|-----------|
| `org_branding.logo_alt_text` absent (uses `o.name`) | ACCEPTABLE — correct semantic fallback; no patient impact |
| `organizations.updated_at` absent (uses `coalesce(b.updated_at, o.created_at)`) | ACCEPTABLE — cache-busting semantics preserved |
| `org_subscriptions` table never shipped (P28 D-14) — guarded by `to_regclass` check | ACCEPTABLE — guard works; P29 deferred work not needed for P31 |
| `_is_org_member` SECDEF fixes Phase 28-era RLS recursion — should it be back-ported as P28 addendum? | RECOMMENDATION: 31-06 fix is sufficient for P31; a P28 addendum entry in `.planning/deferred-tests.md` is recommended but not blocking |
| Phase 31 vitest `role-matrix-sync.test.ts` 38 assertions env-gated (wave-2-gated) | ACCEPTABLE — CI exercises them when `SUPABASE_SERVICE_ROLE_KEY` set; local run skips cleanly |
| `has_permission` shows `anon` execute in `information_schema.role_routine_grants` | NOT A SECURITY ISSUE — this is the pre-existing `has_permission(uuid, uuid, text)` overload from an older migration; the P31 `has_permission(org_member_role, text)` correctly revokes from `public` in migration `20270601310101` |
| `log_admin_action` cross-phase admin-vs-org-owner gap for all P31 SECDEFs | PARTIAL — `save_org_onboarding_flow` fixed; `save_org_branding` and `change_member_role` not fixed — see Gaps above |

---

_Verified: 2026-05-18T11:50:00Z_
_Verifier: Claude (gsd-verifier)_
