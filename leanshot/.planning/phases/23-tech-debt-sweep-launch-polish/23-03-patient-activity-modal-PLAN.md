---
phase: 23-tech-debt-sweep-launch-polish
plan: 03
type: execute
wave: 2
depends_on: [23-01]
files_modified:
  - leanshot/src/components/clinic/drill-in/PatientActivityModal.tsx
  - leanshot/src/components/clinic/drill-in/ClinicDrillInPage.tsx
  - leanshot/src/components/clinic/drill-in/PatientActivityModal.test.tsx
  - leanshot/tests/rls/patient-activity-modal-rls.test.ts
  - leanshot/src/App.tsx
autonomous: true
requirements: [DEBT-01]
tags: [drill-in, modal, vertical-slice, lazy-import, clinic, rls]

must_haves:
  truths:
    - "Operator clicks `View activity` on a patient row in the clinic drill-in page → PatientActivityModal opens with all the impersonated patient's logged data (injections + weights + meals + workouts + symptoms + photo uploads) interleaved chronologically newest-first."
    - "Operator viewing patient A's activity sees ONLY patient A's data — cross-tenant RLS confirmed via live impersonation-context test (per project rule [[reference-supabase-project]])."
    - "PatientActivityModal source is loaded via `React.lazy(() => import(...))` so the ClinicDrillInPage entry chunk does NOT grow when the modal isn't opened — index gz stays ≤24.5 kB (Phase 12 invariant)."
    - "Modal closes on Esc, on backdrop click, and on explicit close button. Focus returns to the `View activity` button. `role=\"dialog\"` + `aria-modal=\"true\"` per project a11y convention."
    - "Empty-state copy ('No logged activity yet for this patient.') renders when impersonated patient has 0 entries across all categories."
    - "No new `test.fixme` / `test.skip` / `describe.only` is introduced in any new test file shipped by this plan. If a scenario MUST be deferred (e.g. live-env-gated impersonation test), the defer marker MUST be accompanied by a `// see deferred-tests.md#<anchor>` comment on the same or preceding line — Plan 23-01's `scripts/audit-deferred-tests.mjs` CI lint will block the merge otherwise. Add the corresponding registry entry to `.planning/deferred-tests.md` in the same commit."
  artifacts:
    - path: "leanshot/src/components/clinic/drill-in/PatientActivityModal.tsx"
      provides: "Chronological-merge modal showing impersonated patient's full timeline"
      min_lines: 80
      exports: ["PatientActivityModal"]
    - path: "leanshot/src/components/clinic/drill-in/PatientActivityModal.test.tsx"
      provides: "Vitest coverage — chronological merge, RLS-scoped fetch, empty state, a11y"
      min_lines: 60
    - path: "leanshot/tests/rls/patient-activity-modal-rls.test.ts"
      provides: "Live cross-tenant impersonation-context RLS test"
      min_lines: 50
    - path: "leanshot/src/components/clinic/drill-in/ClinicDrillInPage.tsx"
      provides: "`handleViewActivity` callback wires to lazy-loaded PatientActivityModal + state flag"
      contains: "PatientActivityModal"
    - path: "leanshot/src/App.tsx"
      provides: "PatientActivityModal lazy chunk import (or local lazy() in ClinicDrillInPage.tsx — choose lighter wiring)"
      contains: "PatientActivityModal"
  key_links:
    - from: "leanshot/src/components/clinic/drill-in/ClinicDrillInPage.tsx"
      to: "leanshot/src/components/clinic/drill-in/PatientActivityModal.tsx"
      via: "React.lazy(() => import(...)) + state-flag toggle inside handleViewActivity"
      pattern: "PatientActivityModal|lazy.*PatientActivity"
    - from: "leanshot/src/components/clinic/drill-in/PatientActivityModal.tsx"
      to: "Supabase tables: injections, weights, meals, workouts, symptoms, photos"
      via: "supabase client SELECT with auth.uid() = impersonated patient_id via operator impersonation context (Phase 9/22)"
      pattern: "supabase.from\\((injections|weights|meals|workouts|symptoms|photos)\\)"
    - from: "leanshot/src/components/clinic/drill-in/PatientActivityModal.tsx"
      to: "src/components/ui/Modal.tsx"
      via: "wraps Modal primitive with role=dialog, aria-modal=true, Esc/backdrop close, focus trap"
      pattern: "import.*Modal.*from.*'@/components/ui/Modal'"
---

<objective>
DEBT-01 closeout: wire the existing `View activity` callback stub at `ClinicDrillInPage.tsx:287` to a real `PatientActivityModal` that shows the impersonated patient's full logged-activity timeline (all six data domains chronologically interleaved per D-01). Vertical-slice plan: data fetch + UI + tests + RLS verification all ship together as one mergeable feature.

Purpose: Closes the Plan 10-09 carry-forward (the "// TODO Plan 10-09 — open PatientActivityModal" stub has been live since Phase 10). Operator's drill-in is currently a roster-only view with no fuller history surface; this delivers it.

Output: Working modal + test coverage + RLS proof. No new RLS policies (re-uses Phase 9/22 impersonation-context per D-02).
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@leanshot/.planning/phases/23-tech-debt-sweep-launch-polish/23-CONTEXT.md
@leanshot/src/components/clinic/drill-in/ClinicDrillInPage.tsx
@leanshot/src/components/ui/Modal.tsx
@leanshot/src/App.tsx
@leanshot/src/types/clinic.ts

# Phase 10 + 22 prior art:
@leanshot/.planning/phases/10-clinic-operator-surface/10-09-PLAN.md
@leanshot/.planning/phases/22-onboarding-account-mgmt-cs-admin/

# Existing impersonation-context RLS patterns:
# - Phase 9 added operator-on-behalf-of patient policies on injections/weights/meals/workouts/symptoms tables.
# - Phase 22 hardened the impersonation activate/deactivate flow + audit_logs entry on every activate.
# - Per D-02 PatientActivityModal does NOT need new RLS policies — the SELECT against any of the 6 tables under an active impersonation context returns the impersonated patient's rows.

# RLS test fixture reference: leanshot/tests/rls/page-builder-rls.test.ts is the established
# pattern (per [[reference-supabase-project]] every RLS surface gets an impersonation proof).
# CAUTION: per [[reference-rls-fixture-gotruclient-flake]] the Phase 15 GoTrue cross-contamination
# bug exists in jsdom + parallel vitest — use the service-role-minted JWT via headers.Authorization
# pattern NOT signInWithPassword. Per [[feedback-rls-per-file-slug-prefix]] declare a file-scoped
# slug prefix (e.g. PATIENT_ACTIVITY_PREFIX = 'patact-') to avoid cross-test cleanup clobber.

<interfaces>
ClinicDrillInPage.tsx existing stub (lines 287-293):
```typescript
// View activity callback — Plan 10-09 wires the modal.
// Until then, this is a safe no-op that warns in dev.
const handleViewActivity = useCallback(() => {
  // TODO Plan 10-09 — open PatientActivityModal
  console.warn('[ClinicDrillInPage] PatientActivityModal not yet available (Plan 10-09).');
}, []);
```
Replace `console.warn` with `setIsActivityModalOpen(true)` after introducing `useState` for the flag. Render `<PatientActivityModal patientId={selectedPatient.id} open={isActivityModalOpen} onClose={() => setIsActivityModalOpen(false)} />` inside the existing JSX.

App.tsx lazy-import pattern (line ~115-121):
```typescript
const ClinicDrillInPage = lazy(() =>
  import('@/components/clinic/drill-in/ClinicDrillInPage').then((m) => ({ default: m.ClinicDrillInPage }))
);
```
Mirror for PatientActivityModal — EITHER add a sibling lazy() in App.tsx (consistent with other modals) OR keep the lazy() local inside ClinicDrillInPage.tsx (cheaper since the modal is only ever reached from the drill-in page). Recommend local lazy in ClinicDrillInPage.tsx to keep App.tsx tidy and confirm the modal chunk is split out of the ClinicDrillInPage chunk.

PatientActivityModal props:
```typescript
export interface PatientActivityModalProps {
  patientId: string;     // impersonated patient's user_id
  open: boolean;
  onClose: () => void;
}
```

Chronological merge shape:
```typescript
type ActivityEntry =
  | { kind: 'injection'; ts: string; data: Injection }
  | { kind: 'weight'; ts: string; data: WeightLog }
  | { kind: 'meal'; ts: string; data: Meal }
  | { kind: 'workout'; ts: string; data: Workout }
  | { kind: 'symptom'; ts: string; data: SymptomLog }
  | { kind: 'photo'; ts: string; data: { photo_id: string; storage_path: string; date: string } };
```
Sort `entries.sort((a, b) => b.ts.localeCompare(a.ts))` for newest-first.

RLS test slug prefix (per project rule):
```typescript
const PATIENT_ACTIVITY_PREFIX = 'patact-';
afterAll(() => cleanupTestPages(PATIENT_ACTIVITY_PREFIX));
```

Modal primitive shape (existing src/components/ui/Modal.tsx):
- `<Modal open={open} onClose={onClose} title="Patient activity"><ModalBody>...</ModalBody></Modal>`
- Already handles role=dialog, aria-modal, Esc + backdrop close, focus return.
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Create PatientActivityModal.tsx with chronological merge + lazy-load</name>
  <files>leanshot/src/components/clinic/drill-in/PatientActivityModal.tsx</files>
  <behavior>
    - Renders a `<Modal>` (re-using `src/components/ui/Modal.tsx`) titled "Patient activity" when `open=true`.
    - Fetches in parallel from 6 Supabase tables (`injections`, `weights`, `meals`, `workouts`, `symptoms`, `photos`) filtered by the impersonated patient (RLS does the scoping per D-02 — caller passes `patientId` as a tag/key but the actual filter is `auth.uid() = patient_id` via active impersonation context, no client-side `eq` needed).
    - Merges all 6 result sets into a single `ActivityEntry[]` sorted newest-first by timestamp (`logged_at` / `created_at` / `date` depending on table — normalize to one ISO string at merge time).
    - Renders each entry with a kind-specific icon (lucide-react: Syringe / Weight / Utensils / Activity / Frown / Camera) + a one-line summary + timestamp via `formatDistanceToNow` or equivalent helper.
    - Empty state when merged array is empty: "No logged activity yet for this patient."
    - Loading state: skeleton rows while any fetch is in flight.
    - Error state per category: silently omit the failing category + log to console (no full-modal error blocks one slow table from showing others).
  </behavior>
  <action>Create `leanshot/src/components/clinic/drill-in/PatientActivityModal.tsx` exporting `PatientActivityModal` per the `<interfaces>` props shape. Use `useEffect` to fire 6 parallel `supabase.from(...).select(...).order(...).limit(100)` queries on `open=true`; keep results in a single `useState<ActivityEntry[] | null>(null)` (null = loading, [] = empty). Re-use existing UI primitives (`Modal`, `Badge` for entry kind, `Skeleton` for loading rows, `EmptyState` for empty case). NO new fetch helper — call `supabase` directly via the existing `supabase` import from `@/lib/supabase` (or wherever the project's singleton lives). DO NOT use `s.user!` non-null assertions (Phase 23 DEBT-02 lint rule will catch it). Limit each query to 100 rows for v1 (no pagination — out of scope, deferrable to v1.3 if operators ask).</action>
  <verify>
    <automated>cd leanshot && npx vitest run src/components/clinic/drill-in/PatientActivityModal.test.tsx 2>&1 | tail -20</automated>
  </verify>
  <done>File exists, exports PatientActivityModal, all tests from Task 2 pass, `npm run lint` exits 0 with new `*.user!` rule from 23-01 active.</done>
</task>

<task type="auto">
  <name>Task 2: Write PatientActivityModal.test.tsx (vitest + RTL)</name>
  <files>leanshot/src/components/clinic/drill-in/PatientActivityModal.test.tsx</files>
  <action>Create vitest + React Testing Library spec covering: (a) renders nothing when `open=false`; (b) renders skeleton during fetch; (c) renders 6-category merged timeline newest-first when all queries return data (mock supabase responses with 2 entries per table, expect 12 timeline rows in descending-timestamp order); (d) renders empty state when all 6 queries return []; (e) renders partial timeline when one query rejects (e.g. workouts throws — still shows injections/weights/etc.); (f) calls `onClose` when Esc pressed (delegated to underlying Modal); (g) accessibility — `role="dialog"`, `aria-modal="true"` present; (h) no `s.user!` usage in source (regex assertion on file contents to belt-and-suspenders the ESLint rule from 23-01). Use `vi.mock('@/lib/supabase', () => ({ supabase: { from: vi.fn(() => mockChainable) }}))` pattern.</action>
  <verify>
    <automated>cd leanshot && npx vitest run src/components/clinic/drill-in/PatientActivityModal.test.tsx --reporter=verbose 2>&1 | tail -30</automated>
  </verify>
  <done>≥8 test cases, all passing.</done>
</task>

<task type="auto">
  <name>Task 3: Wire handleViewActivity → PatientActivityModal in ClinicDrillInPage.tsx</name>
  <files>leanshot/src/components/clinic/drill-in/ClinicDrillInPage.tsx</files>
  <action>Replace the `console.warn` stub in `handleViewActivity` (line ~287-292) with `setIsActivityModalOpen(true)`. Introduce `const [isActivityModalOpen, setIsActivityModalOpen] = useState(false);` near the top of the component. Add `const PatientActivityModal = lazy(() => import('./PatientActivityModal').then((m) => ({ default: m.PatientActivityModal })));` at module scope (above the component) — this ensures the modal source is code-split into its own chunk. Render `<Suspense fallback={null}>{isActivityModalOpen && <PatientActivityModal patientId={selectedPatient.id} open={isActivityModalOpen} onClose={() => setIsActivityModalOpen(false)} />}</Suspense>` inside the existing JSX (location: after the roster table, before the closing wrapper div). Remove the `// TODO Plan 10-09` comment + `console.warn` line entirely — the carry-forward is closed. Run `cd leanshot && npm run build` and confirm a new `PatientActivityModal-<hash>.js` chunk appears in `dist/assets/`; the `ClinicDrillInPage-<hash>.js` chunk must NOT grow more than 0.5 kB gz (the modal is lazy, only its lazy() wrapper code is in the page chunk).</action>
  <verify>
    <automated>cd leanshot && npm run build 2>&1 | tail -30; ls leanshot/dist/assets/PatientActivityModal-*.js 2>/dev/null && echo "modal chunk exists"; bash leanshot/scripts/assert-clinic-bundle-budget.sh 2>&1 | tail -10</automated>
  </verify>
  <done>Stub callback wired, modal opens on click in a real browser, build succeeds, dedicated chunk emitted, bundle budget passes.</done>
</task>

<task type="auto">
  <name>Task 4: Write live cross-tenant impersonation RLS test</name>
  <files>leanshot/tests/rls/patient-activity-modal-rls.test.ts</files>
  <action>Create a live RLS test following the established `tests/rls/page-builder-rls.test.ts` pattern: declare `const PATIENT_ACTIVITY_PREFIX = 'patact-';` at file scope (per [[feedback-rls-per-file-slug-prefix]] to avoid cross-test cleanup clobber). Use service-role-minted JWT via `createClient(url, key, { global: { headers: { Authorization: 'Bearer <jwt>' }}})` — NOT `signInWithPassword` (per [[reference-rls-fixture-gotruclient-flake]]). Test scenario: (a) create org O1 with operator opA + patient pA + 3 injections for pA; (b) create org O2 with operator opB + patient pB + 3 injections for pB; (c) activate impersonation context for opA → pA via existing RPC `set_impersonation_context(target_user_id)`; (d) run the same 6 parallel queries the modal runs → expect ONLY pA's 3 injections, 0 from pB; (e) deactivate impersonation, activate opB → pB context, repeat → expect ONLY pB's 3 injections; (f) attempt the SELECT WITHOUT any impersonation context as opA → expect 0 rows for any patient that isn't opA themselves. Self-skip via `describeIfLive` when `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` env vars absent (matches the existing `tests/rls/*.test.ts` pattern). `afterAll(() => cleanupTestPages(PATIENT_ACTIVITY_PREFIX))`.</action>
  <verify>
    <automated>cd leanshot && SUPABASE_URL="${SUPABASE_URL:-}" SUPABASE_SERVICE_ROLE_KEY="${SUPABASE_SERVICE_ROLE_KEY:-}" SUPABASE_ANON_KEY="${SUPABASE_ANON_KEY:-}" npx vitest run tests/rls/patient-activity-modal-rls.test.ts --reporter=verbose 2>&1 | tail -30</automated>
  </verify>
  <done>≥3 RLS scenarios pass live OR self-skip cleanly when env vars absent. No GoTrue flake (uses service-role-JWT path).</done>
</task>

</tasks>

<verification>
1. `cd leanshot && npm run lint && npm run typecheck && npm run test:unit` all exit 0.
2. `cd leanshot && npm run build` succeeds; `ls leanshot/dist/assets/PatientActivityModal-*.js` shows the lazy chunk.
3. `cd leanshot && bash scripts/assert-clinic-bundle-budget.sh` exits 0 (index gz ≤24.5 kB).
4. Manual: visit `/clinic/<org-slug>` as operator → click `View activity` on any patient → modal opens with their timeline → close via Esc.
5. Live RLS test passes against `ytnsipxxmzgaebkqmokp` when env present.
</verification>

<success_criteria>
- DEBT-01 closed: `View activity` is no longer a no-op.
- Bundle ceiling preserved (24.5 kB gz index).
- RLS cross-tenant proof on file (not just policy SQL — actual impersonation invocation).
- a11y: Esc + backdrop + role=dialog + aria-modal all wired via existing Modal primitive.
</success_criteria>

<output>
After completion, create `.planning/phases/23-tech-debt-sweep-launch-polish/23-03-SUMMARY.md` with: dist/ chunk size for PatientActivityModal-<hash>.js, ClinicDrillInPage chunk delta, RLS test status (live / skipped), test count + pass/fail breakdown, and any cross-category fetch errors observed during manual smoke.
</output>
