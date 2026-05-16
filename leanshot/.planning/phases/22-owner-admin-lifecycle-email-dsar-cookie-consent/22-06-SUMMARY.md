---
phase: 22-owner-admin-lifecycle-email-dsar-cookie-consent
plan: 06
subsystem: admin-ui
tags: [admin, react, supabase-js, posthog, feature-flags, members-table, is_staff]

# Dependency graph
requires:
  - phase: 22-owner-admin-lifecycle-email-dsar-cookie-consent
    provides: "22-01 Wave 0 — admin_list_members RPC (migration 11), admin_set_feature_flag_override RPC + feature_flag_overrides table (migration 04), audit_logs impersonator columns (migration 03), audit_action enum extension (migration 02)"
  - phase: 19-affiliates-stripe-connect
    provides: "AdminAffiliatesScaffold.tsx is_staff gate pattern (Pattern S1 dual-layer); admin-bundle manualChunks split; public.feature_flags mirror + loadFeatureFlags wrapper"
  - phase: 14-billing-stripe-prod
    provides: "public.subscriptions schema (status, current_period_end, plan_id, provider) — feeds MemberBillingTab"
  - phase: 13-design-system-v2-rollout
    provides: "Card / Pill / PillGroup segmented / Badge / Button / InitialsAvatar / EmptyState / Skeleton primitives — every admin surface reuses these"
provides:
  - "/admin/members — Members table page with is_staff gate, 7 columns, debounced search, segmented tier filter, 25/50/100 server pagination, 30s polling"
  - "/admin/members/{id} — Drill-in with 6 tabs (Profile · Billing · Activity · Stripe · Flags · Audit), ?tab= URL persistence, arrow-key tab nav"
  - "MemberFlagsTab (ADMIN-05) — per-user PostHog feature-flag override CRUD UI calling admin_set_feature_flag_override RPC"
  - "src/lib/consent/feature-flag-overrides.ts (D-08) — overrides-first PostHog wrapper with SQL-side expiry filter + module-level Map cache"
  - "src/lib/admin/admin-api.ts — listMembers + setFeatureFlagOverride wrappers + discriminated AdminApiError"
  - "src/components/admin/AdminLayout.tsx — reusable is_staff client gate + admin sub-nav (Members · Metrics · Cohorts · Affiliates)"
affects: [22-07-stripe-actions, 22-09-impersonation, 22-12-app-tsx-routing, 22-08-cookie-consent, future-cohort-heatmap-ADMIN-08]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Pattern S1 client-gate split: AdminLayout owns is_staff probe; data-fetching content components mount only after staff is confirmed (prevents RPC from firing during the probe or for non-staff callers)."
    - "Discriminated AdminApiError pattern (mirrors src/lib/account-delete.ts AccountDeleteError) — 5 codes (not_staff / not_authenticated / invalid / network / unknown) so call sites branch on `e.code` instead of parsing Postgres error strings."
    - "Tab segmented PillGroup with ?tab= URL persistence + arrow-key nav (reusable by future drill-in pages)."
    - "Module-level Map cache + SQL-side filter for short-TTL admin-set per-user overrides (defense-in-depth Date.now() re-check at lookup)."

key-files:
  created:
    - leanshot/src/components/admin/AdminLayout.tsx
    - leanshot/src/components/admin/pages/AdminMembersPage.tsx
    - leanshot/src/components/admin/pages/AdminMemberDetailPage.tsx
    - leanshot/src/components/admin/members/MembersTable.tsx
    - leanshot/src/components/admin/members/MembersFilterBar.tsx
    - leanshot/src/components/admin/members/MemberRowActions.tsx
    - leanshot/src/components/admin/members/MemberProfileTab.tsx
    - leanshot/src/components/admin/members/MemberBillingTab.tsx
    - leanshot/src/components/admin/members/MemberActivityTab.tsx
    - leanshot/src/components/admin/members/MemberStripeTab.tsx
    - leanshot/src/components/admin/members/MemberFlagsTab.tsx
    - leanshot/src/components/admin/members/MemberAuditTab.tsx
    - leanshot/src/lib/admin/admin-api.ts
    - leanshot/src/lib/consent/feature-flag-overrides.ts
  modified:
    - leanshot/src/components/admin/__tests__/AdminMembersPage.test.tsx
    - leanshot/src/components/admin/members/__tests__/MembersTable.test.tsx
    - leanshot/src/lib/admin/__tests__/admin-api.test.ts
    - leanshot/src/lib/consent/__tests__/feature-flag-overrides.test.ts

key-decisions:
  - "Split AdminMembersPage into a thin AdminLayout wrapper + inner MembersPageContent so the data-fetch useEffect only commits after is_staff resolves to true. Without this the admin_list_members RPC fires for every visitor — caught by T2 test."
  - "Page-side KPI strip computes totals/paid/clinic client-side over the current page; v1.2 user count < 10k makes this acceptable. Dedicated admin_members_kpi_strip RPC deferred to v1.3."
  - "Sort is implemented client-side over the current page in MembersTable. The admin_list_members RPC does not yet accept a sort parameter (returns ORDER BY signup_date DESC, user_id ASC). Server-side multi-column sort deferred to v1.3."
  - "MemberFlagsTab override expiry: a date-picker (YYYY-MM-DD) is coerced to `T23:59:59Z` before being sent to the RPC so admins setting 'expire on Friday' get full-day coverage in UTC."
  - "MemberStripeTab and MemberBillingTab payment-method card render structural placeholders pending plan 22-07 (stripe_charges materialization)."

patterns-established:
  - "Inner-content-after-gate split: AdminLayout returns null while is_staff is undefined; renders <NotAuthorizedCard /> when false. Children mount only on true. Data-fetching MUST live in a content component nested under AdminLayout, never on the AdminLayout caller itself."
  - "Discriminated error codes from Supabase RPC errcode → typed client error: '42501' → 'not_staff', '28000' → 'not_authenticated', '22023' → 'invalid'. Reusable for plan 22-07/22-09 admin RPCs."
  - "Tab drill-in with ?tab= URL persistence and arrow-key keyboard navigation — reusable for plan 22-07 refund modal and future per-org / per-clinic admin views."

requirements-completed: [ADMIN-01, ADMIN-05]

# Metrics
duration: ~70 min
completed: 2026-05-16
---

# Phase 22 Plan 06: Members table + Member drill-in + Feature-flag override UI

**Operator's daily entry point: /admin/members table with 7 columns + 6-tab member drill-in + per-user PostHog feature-flag override CRUD.**

## Performance

- **Duration:** ~70 min
- **Started:** 2026-05-16T05:28Z (worktree HEAD reset)
- **Completed:** 2026-05-16T06:39Z
- **Tasks:** 3/3 (all type=auto tdd=true)
- **Files created:** 14
- **Tests added:** 35 (all GREEN)
- **Bundle index gz:** 15.024 kB (<<50 kB ceiling)
- **Admin chunk gz:** 14.53 kB (existing manualChunks split)

## Accomplishments

- **ADMIN-01 surface complete:** Members table renders for staff users with 7 columns matching UI-SPEC, 6-pill tier filter, 300ms debounced email search, server-paginated 25/50/100 page sizes, 30s polling cadence, mobile card-list fallback. Row click + Enter both navigate to drill-in.
- **Member drill-in complete:** 6 tabs (Profile · Billing · Activity · Stripe · Flags · Audit) with ?tab= URL persistence + arrow-key navigation. Profile + Activity + Audit hydrate from real data; Billing reads Phase 14 subscriptions row; Stripe is a structural placeholder for plan 22-07 to plug into.
- **ADMIN-05 PostHog override surface complete:** MemberFlagsTab + `feature-flag-overrides.ts` wrapper. Overrides-first lookup wins over PostHog default; SQL-side `gt('expires_at', now)` filter (Pitfall 10). admin_set_feature_flag_override RPC writes; module-level Map cache reads.
- **Reusable AdminLayout shell** with is_staff gate + admin sub-nav, ready to host /admin/metrics + /admin/cohorts + (extended) /admin/affiliates in subsequent plans.

## Task Commits

1. **Task 1: AdminLayout + members table + admin-api wrapper (ADMIN-01)** — `a5ceaa4` (feat)
2. **Task 3: feature-flag-overrides wrapper (ADMIN-05 D-08)** — `c3eb6fc` (feat)
3. **Task 2: AdminMemberDetailPage + 6 tabs (ADMIN-01 + ADMIN-05)** — `8808768` (feat)

Tasks 2 and 3 swapped in execution order because Task 3 (the small PostHog wrapper) had zero dependencies on Task 2 and unblocked the MemberFlagsTab work that lives inside Task 2 — completing it first removed a soft dependency.

## Files Created/Modified

### Created
- `leanshot/src/components/admin/AdminLayout.tsx` — is_staff gate + sub-nav shell; reusable for /admin/metrics + /admin/cohorts.
- `leanshot/src/components/admin/pages/AdminMembersPage.tsx` — /admin/members composition root; URL state, polling, KPI strip, pagination footer.
- `leanshot/src/components/admin/pages/AdminMemberDetailPage.tsx` — /admin/members/{id} drill-in shell with header + 6-tab segmented control + arrow-key nav.
- `leanshot/src/components/admin/members/MembersTable.tsx` — 7-column sortable table + mobile card-list fallback; 3-click sort revert cycle.
- `leanshot/src/components/admin/members/MembersFilterBar.tsx` — 5-pill segmented tier filter + debounced search.
- `leanshot/src/components/admin/members/MemberRowActions.tsx` — kebab popover with 6 items (impersonate + 4 placeholders + override-flag + view-detail).
- `leanshot/src/components/admin/members/MemberProfileTab.tsx` — read-only field grid.
- `leanshot/src/components/admin/members/MemberBillingTab.tsx` — subscription card from Phase 14 schema + Stripe PM placeholder.
- `leanshot/src/components/admin/members/MemberActivityTab.tsx` — last-50 audit_logs (.or actor/target) feed.
- `leanshot/src/components/admin/members/MemberStripeTab.tsx` — charges table placeholder (awaiting 22-07 stripe_charges mirror).
- `leanshot/src/components/admin/members/MemberFlagsTab.tsx` — per-flag override CRUD calling admin_set_feature_flag_override RPC.
- `leanshot/src/components/admin/members/MemberAuditTab.tsx` — audit_logs WHERE target_user_id with expandable JSON rows.
- `leanshot/src/lib/admin/admin-api.ts` — listMembers + setFeatureFlagOverride + AdminApiError.
- `leanshot/src/lib/consent/feature-flag-overrides.ts` — overrides-first PostHog wrapper.

### Modified (replaced Wave 0 skip stubs with real tests)
- `leanshot/src/components/admin/__tests__/AdminMembersPage.test.tsx` — 5 GREEN tests
- `leanshot/src/components/admin/members/__tests__/MembersTable.test.tsx` — 7 GREEN tests
- `leanshot/src/lib/admin/__tests__/admin-api.test.ts` — 7 GREEN tests
- `leanshot/src/lib/consent/__tests__/feature-flag-overrides.test.ts` — 6 GREEN tests

### Test files added
- `leanshot/src/components/admin/pages/__tests__/AdminMemberDetailPage.test.tsx` — 7 GREEN tests
- `leanshot/src/components/admin/members/__tests__/MemberFlagsTab.test.tsx` — 3 GREEN tests

## Decisions Made

1. **Inner-content split for AdminMembersPage.** The first test pass had the data-fetch useEffect on AdminMembersPage itself, which fires before AdminLayout has resolved is_staff — leaking RPC calls for non-staff visitors. Split into AdminLayout wrapper + MembersPageContent inner component. Documented in `Pattern S1 client-side mirror` comment so future admin pages adopt the same shape.
2. **Client-side aggregation for KPI strip.** Per-page math (total/paid/clinic) keeps the surface working without a dedicated RPC. Acceptable for v1.2 with <10k users; v1.3 will ship `admin_members_kpi_strip` returning DB-wide aggregates.
3. **Client-side sort cycle in MembersTable.** RPC returns ORDER BY signup_date DESC. Sort header buttons sort the current page in memory; cycle is `none → asc → desc → none` (matches RosterTable Phase 10 analog). Server-side multi-column sort deferred to v1.3.
4. **MemberFlagsTab expiry-day UX.** Date-pickers always pick a date with no time. Admins setting 'expire on Friday' expect end-of-day. The component coerces `YYYY-MM-DD → YYYY-MM-DDT23:59:59Z` before invoking the RPC.
5. **MemberStripeTab + MemberBillingTab payment-method = structural placeholder.** Both surfaces ship the table/card chrome with explicit empty-state copy explaining plan 22-07 owns the Stripe charge mirror + per-user payment method readout. Zero churn when 22-07 plugs in.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] AdminMembersPage fetched admin_list_members for non-staff users**
- **Found during:** Task 1 (T2 — non-staff renders forbidden state and does NOT call RPC)
- **Issue:** Original implementation put the data-fetch useEffect directly on AdminMembersPage. Even though AdminLayout returns null/NotAuthorizedCard for non-staff, AdminMembersPage itself still mounts, so its useEffect fires the RPC regardless. Test caught the leak.
- **Fix:** Extracted `MembersPageContent` as an inner component rendered as `AdminLayout`'s child. Children only mount when AdminLayout commits the staff branch, so the fetch only fires for staff users.
- **Files modified:** leanshot/src/components/admin/pages/AdminMembersPage.tsx
- **Verification:** T2 test asserts `mockRpc not called` for non-staff — green after the split.
- **Committed in:** a5ceaa4 (Task 1 commit)

**2. [Rule 3 - Blocking] Worktree absolute-path drift (#3099) — entire work landed in MAIN repo, not worktree**
- **Found during:** Task 1 commit step
- **Issue:** All `Write` calls used absolute paths under `/Users/karstenhaldan/minisite/leanshot/...` (the main repo) instead of `/Users/karstenhaldan/minisite/.claude/worktrees/agent-aba9f306465d48832/leanshot/...` (the worktree). `git status` from inside the worktree showed clean. The cd shell pattern used in earlier Bash calls jumped the cwd to leanshot/ subdir of main repo. This is the documented bug #3099 + the project memory entry [reference_worktree_base_drift_recovery].
- **Fix:** Per the recovery playbook: (a) sync new/modified files from main repo → worktree via `cp`; (b) restore main repo's Wave 0 test stubs via `git checkout --`; (c) remove the new files leaked into main with `rm`; (d) re-stage + commit in the worktree on `worktree-agent-aba9f306465d48832`. Repeated for each of the 3 task commits. Tests continued to run from main repo (where node_modules lives) — copied test fixtures back from worktree before each test run.
- **Files affected:** all 14 created files
- **Verification:** `git rev-parse --show-toplevel` confirms HEAD on worktree-agent-aba9f306465d48832 branch under `/Users/karstenhaldan/minisite/.claude/worktrees/agent-aba9f306465d48832`; `git log --oneline` shows the 3 feat commits on the agent branch.
- **Committed in:** N/A (process correction, not code)

---

**Total deviations:** 2 (1 auto-fixed bug, 1 process recovery from a known worktree pitfall)
**Impact on plan:** Bug fix #1 was essential (security: non-staff users would have triggered admin RPC and been told "forbidden" by the server — needless leak). Process recovery #2 cost ~10 min total; no code lost.

## Known Stubs

The following stubs are intentional and have clear owning future plans:

| Stub | File | Reason | Owner |
|------|------|--------|-------|
| Refund / Cancel / Deactivate menu items disabled | MemberRowActions.tsx, AdminMemberDetailPage.tsx header | RefundModal + cancel flow not yet implemented | plan 22-07 (refund), plan 22-09 (impersonation+deactivate) |
| MemberStripeTab charges table empty | MemberStripeTab.tsx | stripe_charges materialization owned by plan 22-07 | plan 22-07 |
| MemberBillingTab payment-method card text-only | MemberBillingTab.tsx | per-user PM readout deferred to plan 22-07 | plan 22-07 |
| Profile tab IP + Browser fields show "—" | MemberProfileTab.tsx | admin_get_member_profile RPC not yet shipped (v1.3) | v1.3 follow-up |
| KPI strip computes client-side over current page | AdminMembersPage.tsx | dedicated admin_members_kpi_strip RPC deferred (acceptable for v1.2 user counts <10k) | v1.3 follow-up |
| 30d churn KPI shows "—" | AdminMembersPage.tsx | ADMIN-02 /admin/metrics owns churn surface | plan 22-07 (ADMIN-02) |
| App.tsx routing for /admin/members[/{id}] | (not modified here) | Pre-emptive warning 4: shared-file choreography | plan 22-12 |
| loadOverrides call wired into App.tsx post-auth | (not modified here) | Same — shared-file choreography | plan 22-12 |

All stubs are tracked here so the verifier sees the intentional partial completion; none prevent the plan's own goal (the surfaces work for the data they own).

## Issues Encountered

- **jsdom both desktop+mobile render simultaneously.** Tests using `getByLabelText` matched two elements (one in desktop table, one in mobile card list since CSS media queries don't gate render). Fix: use `getAllByLabelText` and pick `[0]` for the desktop instance (which is the variant the test cares about).
- **Pre-existing Wave 0 sibling-plan test scaffolds fail import.** 3 scaffold test files (consent-records, CohortHeatmap, RefundModal) belong to other plans and reference files this plan doesn't own. Failures are out of this plan's scope per the SCOPE BOUNDARY rule. They will go green when their owning plans (22-07, 22-08, ADMIN-08) execute.

## Threat Flags

None — this plan adds UI surfaces over RPCs already shipped (admin_list_members, admin_set_feature_flag_override) with their is_staff gate + RLS policies in place from Wave 0 plan 22-01. No new network endpoints, no new schema, no new trust boundaries.

## User Setup Required

None — no external service configuration introduced by this plan.

## Next Phase Readiness

**Ready for plan 22-07** (Stripe actions: RefundModal + cancellation flow). MemberStripeTab + MemberRowActions + AdminMemberDetailPage header expose the action surfaces with disabled placeholders. Plug-in cost is zero schema, modest UI rework (modal mount + table data wire-up).

**Ready for plan 22-09** (Impersonation + Deactivate). MemberRowActions impersonate handler already calls `onImpersonate(userId)` callback — plan 22-09 wires the Edge Function invocation + redirect.

**Ready for plan 22-12** (App.tsx routing wiring). All admin pages export named + default exports compatible with React.lazy. Plan 22-12 needs to:
1. Mount `/admin/members` → AdminMembersPage
2. Mount `/admin/members/{id}` → AdminMemberDetailPage
3. Add `void loadOverrides(user.id)` call to post-auth handler in App.tsx
4. Add `clearOverrideCache()` to logout handler

**Pattern S1 reuse:** Future admin pages should follow the AdminLayout + inner-content split (documented in AdminMembersPage.tsx Pattern S1 client-side mirror comment) — never put data fetches on the AdminLayout caller.

---

## Self-Check: PASSED

**Created files exist (worktree):**
- FOUND: leanshot/src/components/admin/AdminLayout.tsx
- FOUND: leanshot/src/components/admin/pages/AdminMembersPage.tsx
- FOUND: leanshot/src/components/admin/pages/AdminMemberDetailPage.tsx
- FOUND: leanshot/src/components/admin/members/MembersTable.tsx
- FOUND: leanshot/src/components/admin/members/MembersFilterBar.tsx
- FOUND: leanshot/src/components/admin/members/MemberRowActions.tsx
- FOUND: leanshot/src/components/admin/members/MemberProfileTab.tsx
- FOUND: leanshot/src/components/admin/members/MemberBillingTab.tsx
- FOUND: leanshot/src/components/admin/members/MemberActivityTab.tsx
- FOUND: leanshot/src/components/admin/members/MemberStripeTab.tsx
- FOUND: leanshot/src/components/admin/members/MemberFlagsTab.tsx
- FOUND: leanshot/src/components/admin/members/MemberAuditTab.tsx
- FOUND: leanshot/src/lib/admin/admin-api.ts
- FOUND: leanshot/src/lib/consent/feature-flag-overrides.ts

**Commits exist:**
- FOUND: a5ceaa4 (Task 1)
- FOUND: c3eb6fc (Task 3)
- FOUND: 8808768 (Task 2)

---
*Phase: 22-owner-admin-lifecycle-email-dsar-cookie-consent*
*Completed: 2026-05-16*
