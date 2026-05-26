---
phase: 61-admin-protocol-creator
plan: "06"
subsystem: clinic-protocols
tags:
  - clinic
  - protocols
  - adopt-flow
  - supabase-rpc
dependency_graph:
  requires:
    - 61-01-db-tables-rls
    - 61-02-secdef-rpcs
  provides:
    - ClinicProtocolsPage
    - AdoptProtocolSheet
    - AdoptDiffModal
    - PatientPickerList
    - ClinicWorkspace-protocols-tab
  affects:
    - leanshot/src/components/clinic/ClinicWorkspace.tsx
tech_stack:
  added: []
  patterns:
    - rank_org_patients RPC for org-scoped patient list
    - Sheet DS primitive for AdoptProtocolSheet
    - Modal DS primitive for AdoptDiffModal
    - lazy/Suspense for code splitting
    - assign_protocol_to_patient SECDEF RPC
key_files:
  created:
    - leanshot/src/components/clinic/protocols/PatientPickerList.tsx
    - leanshot/src/components/clinic/protocols/ClinicProtocolsPage.tsx
    - leanshot/src/components/clinic/protocols/AdoptProtocolSheet.tsx
    - leanshot/src/components/clinic/protocols/AdoptDiffModal.tsx
    - leanshot/src/components/clinic/protocols/__tests__/ClinicProtocolsPage.test.tsx
    - leanshot/src/components/clinic/protocols/__tests__/AdoptProtocolSheet.test.tsx
    - leanshot/src/components/clinic/protocols/__tests__/AdoptDiffModal.test.tsx
  modified:
    - leanshot/src/components/clinic/ClinicWorkspace.tsx
decisions:
  - PatientPickerList uses rank_org_patients RPC (not a separate roster table) — matches established pattern from RosterTable
  - ClinicWorkspace tab system implemented as local useState (ClinicTab type) not URL routing — matches existing no-router pattern for consumer surfaces
  - AdoptDiffModal Cancel CTA is "Keep current schedule" per UI-SPEC revision iter-1
  - useToast mocked at hook level in tests (not store.getState) — matches pattern from RagCostPage tests
metrics:
  duration: "7m"
  completed: "2026-05-26"
  tasks_completed: 2
  files_created: 7
  files_modified: 1
  tests_added: 16
---

# Phase 61 Plan 06: Clinic Adopt Flow Summary

**One-liner:** Clinician protocol adoption flow — published-protocol list + patient-picker sheet + two-column diff modal + assign_protocol_to_patient RPC commit, wired into ClinicWorkspace via a new Protocols tab.

## What Was Built

### PatientPickerList.tsx

Reusable patient picker component that uses the `rank_org_patients` RPC — the same source of truth as the existing `RosterTable`. This avoids a separate table query and ensures org-scoping through the existing RLS/RPC pattern. The component accepts `orgId`, `selectedId`, and `onSelect` props. Loading uses Skeleton DS primitives; empty state uses `EmptyState` DS primitive.

**Roster picker reuse strategy:** The RESEARCH.md flagged "clinic_patient_roster" as an open question. After reading the actual roster source (`use-rank-roster.ts`, `RosterTable.tsx`), the patient list comes exclusively from `rank_org_patients` RPC which returns `user_id` + `display_name`. There is no separate roster table — the RPC abstracts the join. `PatientPickerList` reuses this same RPC call.

### ClinicProtocolsPage.tsx

Published-protocol list filtered to `review_state='published'`. Supports compound filter pills (tirzepatide/retatrutide/semaglutide/ghrp-2/other/All) and audience pills (clinic/B2C/All). Per-row "Adopt for patient" button (≥44px touch target, primary/accent per UI-SPEC). Empty state: "No published protocols / Protocols appear here once approved by two admins."

Deduplication: protocols are deduped by `id` keeping the highest version per base protocol.

### AdoptProtocolSheet.tsx

Sheet DS primitive wrapping `PatientPickerList` + "Preview assignment" CTA. Two-step flow: picker → diff modal → confirm. The sheet resets state on close (via `handleClose`). `AdoptDiffModal` only renders when a patient and protocol are both selected.

### AdoptDiffModal.tsx

Two-column diff preview modal. Fetches `protocol_steps` and the patient's 20 most recent `injections` in parallel via `Promise.all`. Builds a unified diff row set keyed by week. Rows where the patient's logged dose differs from the protocol expectation are highlighted in `var(--color-warning)`.

**Diff-row computation logic:**
1. Build a `Map<week, dose_mg>` from patient injections (first occurrence per week = most recent).
2. For each protocol step, look up the patient's dose for that week.
3. `differs = patientDose !== null && patientDose !== protocolDose`.
4. Warning color applied when `differs === true`.

Cancel CTA: "Keep current schedule" (per UI-SPEC revision iter-1 — not generic "Cancel").
Confirm CTA: "Assign to patient" — calls `supabase.rpc('assign_protocol_to_patient', { p_protocol_id, p_version, p_patient_id })`.

Success: `showToast('Protocol "..." assigned to ...', 'success')` + `onConfirmed()` (both overlays close).
Error: `showToast(error.message, 'error')` — `onConfirmed()` NOT called.

### ClinicWorkspace.tsx — Nav Extension

Added a `ClinicTab` type (`'roster' | 'protocols'`) and `currentTab` state. Added a tab nav bar (`role="tabpanel"`, `aria-selected`, focus ring). Lazy-loaded `ClinicProtocolsPage` with `Suspense`. The existing Roster content renders in a `tabpanel-roster` div; the new Protocols content renders in `tabpanel-protocols`. Additive only — no existing tab behavior changed.

## Deviations from Plan

None — plan executed exactly as written.

**PatientPickerList discovery note:** The plan said to use `clinic_patient_roster` as a placeholder if the real table was not findable. After reading `use-rank-roster.ts`, the real source is `rank_org_patients` RPC (no separate roster table exists). This is documented as a deviation-class discovery but was handled correctly without deviation — the PLAN itself said "read existing roster code to find table name."

**useToast test mock fix (Rule 1 - Bug):** The initial `AdoptDiffModal.test.tsx` mocked `@/lib/store` with a plain `useStore` selector, but `useToast` calls `useStore.getState()` as a static method which wasn't mocked. Fixed by mocking `@/hooks/useToast` directly (matching the pattern used by `RagCostPage.test.tsx` and `FederatedSourcesPage.test.tsx`).

## Auto-fixed Issues

**1. [Rule 1 - Bug] useToast getState() mock**
- **Found during:** Task 2 (AdoptDiffModal test run)
- **Issue:** `useStore.getState is not a function` — `useToast` calls `useStore.getState()` as a Zustand static method; mocking `useStore` as a selector-only function doesn't expose `.getState`
- **Fix:** Mocked `@/hooks/useToast` directly: `vi.mock('@/hooks/useToast', () => ({ useToast: () => mockShowToast }))`
- **Files modified:** `src/components/clinic/protocols/__tests__/AdoptDiffModal.test.tsx`
- **Commit:** d38f6cc2

## Known Stubs

None. All data flows are wired:
- `ClinicProtocolsPage` fetches real protocols from `public.protocols WHERE review_state='published'`
- `PatientPickerList` fetches real patients via `rank_org_patients` RPC
- `AdoptDiffModal` fetches real `protocol_steps` and `injections`
- `AdoptDiffModal` calls real `assign_protocol_to_patient` SECDEF RPC

## Threat Flags

No new threat surface introduced beyond what is documented in the plan's `<threat_model>`:
- T-61-06-01: Org-scoping via PatientPickerList → `rank_org_patients` RPC (RLS-backed)
- T-61-06-02: Injection data scoped to `eq('user_id', patientId)` with RLS backstop
- T-61-06-03: Accepted — UI prevents downgrade (latest version only shown)

## Self-Check: PASSED

- [x] `src/components/clinic/protocols/PatientPickerList.tsx` — FOUND
- [x] `src/components/clinic/protocols/ClinicProtocolsPage.tsx` — FOUND
- [x] `src/components/clinic/protocols/AdoptProtocolSheet.tsx` — FOUND
- [x] `src/components/clinic/protocols/AdoptDiffModal.tsx` — FOUND
- [x] `src/components/clinic/protocols/__tests__/ClinicProtocolsPage.test.tsx` — FOUND
- [x] `src/components/clinic/protocols/__tests__/AdoptProtocolSheet.test.tsx` — FOUND
- [x] `src/components/clinic/protocols/__tests__/AdoptDiffModal.test.tsx` — FOUND
- [x] `src/components/clinic/ClinicWorkspace.tsx` modified — FOUND
- [x] Commit f4b71ba2 — Task 1 (6 files)
- [x] Commit d38f6cc2 — Task 2 (2 files)
- [x] 16 unit tests pass (ClinicProtocolsPage: 5, AdoptProtocolSheet: 5, AdoptDiffModal: 6)
- [x] TypeScript clean — no errors in protocols/ or ClinicWorkspace.tsx
- [x] `ClinicProtocolsPage` in `ClinicWorkspace.tsx` — grep confirmed
- [x] `protocols` tab — grep confirmed
