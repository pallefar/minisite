---
phase: 61-admin-protocol-creator
plan: 06
type: execute
wave: 1
depends_on:
  - 61-01-db-tables-rls
files_modified:
  - src/components/clinic/protocols/ClinicProtocolsPage.tsx
  - src/components/clinic/protocols/AdoptProtocolSheet.tsx
  - src/components/clinic/protocols/AdoptDiffModal.tsx
  - src/components/clinic/protocols/PatientPickerList.tsx
  - src/components/clinic/protocols/__tests__/ClinicProtocolsPage.test.tsx
  - src/components/clinic/protocols/__tests__/AdoptProtocolSheet.test.tsx
  - src/components/clinic/protocols/__tests__/AdoptDiffModal.test.tsx
  - src/components/clinic/ClinicWorkspace.tsx
autonomous: true
requirements:
  - PROTOCOL-06
must_haves:
  truths:
    - "ClinicWorkspace adds a 'Protocols' nav tab; selecting it renders ClinicProtocolsPage"
    - "ClinicProtocolsPage lists ONLY review_state='published' protocols filterable by compound + audience"
    - "Per-row 'Adopt for patient' button (accent primary, ≥44px touch target) opens AdoptProtocolSheet"
    - "AdoptProtocolSheet shows PatientPickerList; 'Preview assignment' advances to AdoptDiffModal"
    - "AdoptDiffModal two-column 'Current schedule' vs 'Protocol expectation' diff; 'Assign to patient' calls assign_protocol_to_patient SECDEF RPC"
    - "On success toast 'Protocol assigned' + both overlays close"
    - "Empty state copy: 'No published protocols' / 'Protocols appear here once approved by two admins.'"
  artifacts:
    - path: "src/components/clinic/protocols/ClinicProtocolsPage.tsx"
      provides: "Clinician published-protocols list + Adopt CTA per row"
      exports: ["ClinicProtocolsPage"]
    - path: "src/components/clinic/protocols/AdoptProtocolSheet.tsx"
      provides: "Sheet wrapping PatientPickerList + Preview CTA"
      exports: ["AdoptProtocolSheet"]
    - path: "src/components/clinic/protocols/AdoptDiffModal.tsx"
      provides: "Two-column diff preview + RPC commit"
      exports: ["AdoptDiffModal"]
    - path: "src/components/clinic/protocols/PatientPickerList.tsx"
      provides: "Reusable patient picker (extracted from Phase 30 roster if not already standalone)"
      exports: ["PatientPickerList"]
  key_links:
    - from: "AdoptDiffModal Confirm"
      to: "assign_protocol_to_patient SECDEF RPC"
      via: "supabase.rpc('assign_protocol_to_patient', { p_protocol_id, p_version, p_patient_id })"
      pattern: "assign_protocol_to_patient"
    - from: "ClinicProtocolsPage list query"
      to: "public.protocols WHERE review_state='published'"
      via: "supabase.from('protocols').select(...).eq('review_state', 'published')"
      pattern: "review_state.*published"
---

<objective>
Ship the clinician-facing protocol adoption workflow per PROTOCOL-06. Clinicians browse published protocols, select a patient from their roster, preview the assignment diff, and commit via the assign_protocol_to_patient SECDEF RPC from Plan 02.

Purpose: Bridges admin-authored protocols to patient dose-log. Uses the idempotent ON CONFLICT (patient_id, protocol_id) DO UPDATE pattern so re-assignment to a newer version is safe (Pitfall 3).

Output: 4 new components + 3 unit tests + ClinicWorkspace nav extension.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@/Users/karstenhaldan/minisite/leanshot/.planning/phases/61-admin-protocol-creator/61-CONTEXT.md
@/Users/karstenhaldan/minisite/leanshot/.planning/phases/61-admin-protocol-creator/61-UI-SPEC.md
@/Users/karstenhaldan/minisite/leanshot/.planning/phases/61-admin-protocol-creator/61-PATTERNS.md

# Sheet analog:
@/Users/karstenhaldan/minisite/leanshot/src/components/admin/rag/RejectReasonSheet.tsx

# Patient roster (Phase 30) — picker reuse target:
@/Users/karstenhaldan/minisite/leanshot/src/components/clinic/roster

# ClinicWorkspace nav extension point:
@/Users/karstenhaldan/minisite/leanshot/src/components/clinic/ClinicWorkspace.tsx

# Types from Plan 01:
@/Users/karstenhaldan/minisite/leanshot/src/types/protocols.ts
</context>

<tasks>

<task type="auto">
  <name>Task 1: PatientPickerList + ClinicProtocolsPage + AdoptProtocolSheet (+ 2 tests)</name>
  <files>src/components/clinic/protocols/PatientPickerList.tsx, src/components/clinic/protocols/ClinicProtocolsPage.tsx, src/components/clinic/protocols/AdoptProtocolSheet.tsx, src/components/clinic/protocols/__tests__/ClinicProtocolsPage.test.tsx, src/components/clinic/protocols/__tests__/AdoptProtocolSheet.test.tsx</files>
  <action>
Step 1 — Read `src/components/clinic/roster/` once to identify the patient-list component. Per RESEARCH.md Open Question 1, this picker may be embedded in a page-level component. Find the smallest export that:
- accepts an `orgSlug` (or org context) prop
- renders a selectable list of patients
- exposes an `onSelect` callback

If a reusable component exists (e.g. `RosterTable` or `PatientList`), import it directly in AdoptProtocolSheet and SKIP writing PatientPickerList.tsx (remove it from `files_modified` and update this plan's SUMMARY noting the reuse).

If no standalone reusable list exists, write `src/components/clinic/protocols/PatientPickerList.tsx` extracting the list rendering into a focused component:

```typescript
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { Skeleton } from '@/components/ui/Skeleton';
import { EmptyState } from '@/components/ui/EmptyState';

interface Patient { id: string; name: string; email?: string }

export interface PatientPickerListProps {
  orgSlug: string;
  selectedId?: string | null;
  onSelect: (patient: Patient) => void;
}

export function PatientPickerList({ orgSlug, selectedId, onSelect }: PatientPickerListProps) {
  const [patients, setPatients] = useState<Patient[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Query clinic org membership table (Phase 30 schema — read existing roster code to find table name)
      const { data } = await supabase.from('clinic_patient_roster').select('patient_id, patient_name').eq('org_slug', orgSlug);
      if (!cancelled) {
        setPatients(data?.map(r => ({ id: r.patient_id, name: r.patient_name })) ?? []);
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [orgSlug]);

  if (loading) return <div>{[0,1,2].map(i => <Skeleton key={i} className="h-12 mb-2" />)}</div>;
  if (patients.length === 0) return <EmptyState title="No patients" body="Invite patients to your clinic to assign protocols." />;

  return (
    <ul role="listbox" aria-label="Select a patient" className="space-y-1">
      {patients.map(p => {
        const isSelected = p.id === selectedId;
        return (
          <li key={p.id}>
            <button
              type="button"
              role="option"
              aria-selected={isSelected}
              className={`w-full text-left px-3 py-2 rounded-card text-[13px] ${isSelected ? 'bg-[var(--color-primary)] text-[var(--color-primary-foreground)]' : 'hover:bg-[var(--color-surface-elevated)]'}`}
              onClick={() => onSelect(p)}
            >
              {p.name}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
```

NOTE: The actual roster table/column names MUST be read from existing roster code — replace `clinic_patient_roster` + `patient_id`/`patient_name` with the real schema after reading `src/components/clinic/roster/` source.

Step 2 — `ClinicProtocolsPage.tsx`:

Props:
```typescript
export interface ClinicProtocolsPageProps {
  orgSlug: string;
}
```

Behavior:
- Fetch published protocols: `supabase.from('protocols').select('id, version, name, compound, audience, slug, base_slug, review_state, updated_at, published_at').eq('review_state', 'published').order('updated_at', { ascending: false })`. Dedupe by `id` (keep highest version).
- Filter UI: Compound dropdown (tirzepatide/retatrutide/ghrp-2/semaglutide/other/All) + Audience Pills (B2C, clinic, All)
- Table columns: Name | Compound | Audience | Version | Last Updated | Adopt
- Each row's Adopt button: `<Button variant="primary" size="md" className="min-h-[44px]" onClick={() => setAdoptSheetProtocol(row)}>Adopt for patient</Button>` per UI-SPEC ≥44px touch target rule
- Render `<AdoptProtocolSheet open={!!adoptSheetProtocol} onClose={() => setAdoptSheetProtocol(null)} orgSlug={orgSlug} protocol={adoptSheetProtocol} />` as a sibling
- Empty state per UI-SPEC: `<EmptyState title="No published protocols" body="Protocols appear here once approved by two admins." />`
- H1 'Protocols' (text-heading font-semibold, 28px/600)
- Loading: 3 × Skeleton rows

Step 3 — `AdoptProtocolSheet.tsx`:

Props:
```typescript
export interface AdoptProtocolSheetProps {
  open: boolean;
  onClose: () => void;
  orgSlug: string;
  protocol: { id: string; version: number; name: string; compound: string } | null;
}
```

State: `selectedPatient: Patient | null`, `diffModalOpen: boolean`.

Behavior:
- Sheet shell: `<Sheet open={open} onClose={onClose} title="Adopt Protocol">`
- Heading inside sheet body: 'Select a patient' (text-[13px] font-semibold)
- `<PatientPickerList orgSlug={orgSlug} selectedId={selectedPatient?.id} onSelect={setSelectedPatient} />`
- Footer Button row: 'Preview assignment' (primary, accent, disabled when !selectedPatient) → onClick: setDiffModalOpen(true)
- Render `<AdoptDiffModal open={diffModalOpen} ... onConfirmed={() => { setDiffModalOpen(false); onClose(); }} />` when selectedPatient + protocol present

Step 4 — Tests:

`ClinicProtocolsPage.test.tsx`:
- Mock `@/lib/supabase` returning 2 published protocols
- Render `<ClinicProtocolsPage orgSlug="acme" />`
- Assert both protocol names visible; 2 'Adopt for patient' buttons present
- Click first Adopt button → AdoptProtocolSheet renders with open=true (assert title 'Adopt Protocol' visible)
- Mock supabase to return empty list → EmptyState 'No published protocols' visible

`AdoptProtocolSheet.test.tsx`:
- Mock PatientPickerList via `vi.mock` returning a simple stub that calls onSelect on click
- Render with open=true, protocol={id, version, name, compound}
- Initial state: 'Preview assignment' button disabled
- Click PatientPickerList stub → 'Preview assignment' becomes enabled
- Click Preview → AdoptDiffModal child renders (assert by title 'Assignment preview')

Constraints:
  - Typography ceiling: only text-[11px], text-[13px], text-[18px], text-heading
  - All @theme tokens (none new added in this plan; rely on Plan 04 Task 1 additions)
  - 44px touch targets on Adopt button
  - Read actual roster table name from `src/components/clinic/roster/` before finalizing PatientPickerList SQL
  </action>
  <verify>
    <automated>cd /Users/karstenhaldan/minisite/leanshot && test -f src/components/clinic/protocols/ClinicProtocolsPage.tsx && test -f src/components/clinic/protocols/AdoptProtocolSheet.tsx && npx vitest run --config vite.config.ts src/components/clinic/protocols/__tests__/ClinicProtocolsPage.test.tsx src/components/clinic/protocols/__tests__/AdoptProtocolSheet.test.tsx 2>&1 | tail -20 | grep -E "passed|✓"</automated>
  </verify>
  <done>ClinicProtocolsPage + AdoptProtocolSheet render; PatientPickerList either reused or extracted; 2 unit tests green.</done>
</task>

<task type="auto">
  <name>Task 2: AdoptDiffModal + ClinicWorkspace nav extension</name>
  <files>src/components/clinic/protocols/AdoptDiffModal.tsx, src/components/clinic/protocols/__tests__/AdoptDiffModal.test.tsx, src/components/clinic/ClinicWorkspace.tsx</files>
  <action>
Step 1 — `AdoptDiffModal.tsx`:

Props:
```typescript
export interface AdoptDiffModalProps {
  open: boolean;
  onClose: () => void;
  onConfirmed: () => void;
  patientId: string;
  patientName: string;
  protocol: { id: string; version: number; name: string; compound: string };
}
```

Behavior:
- On open: fetch protocol steps (`supabase.from('protocol_steps').select('week, dose_mg, frequency, monitoring').eq('protocol_id', protocol.id).eq('protocol_version', protocol.version).order('week')`) AND most-recent N injections for this patient (`supabase.from('injections').select('week_number, dose_mg, ...').eq('user_id', patientId).order('created_at', { ascending: false }).limit(20)`).
- Build a unified row set keyed by week 1..max(protocol_step.week)
- Two-column layout `grid grid-cols-2 gap-4 mb-4`:
  - Left column header: 'Current schedule' (text-[13px] font-semibold)
  - Right column header: 'Protocol expectation' (text-[13px] font-semibold)
  - Each row: `Week N • {patient_dose_or_em_dash}mg` LEFT | `Week N • {protocol_dose}mg {frequency}` RIGHT
  - When patient_dose !== protocol_dose: wrap differing side in `text-[var(--color-warning)]`
- Footer:
  - 'Keep current schedule' (secondary) → onClose
  - 'Assign to patient' (primary, accent, aria-busy={assigning})
- On Assign click:
  ```typescript
  setAssigning(true);
  const { error } = await supabase.rpc('assign_protocol_to_patient', {
    p_protocol_id: protocol.id,
    p_version: protocol.version,
    p_patient_id: patientId,
  });
  setAssigning(false);
  if (error) {
    showToast({ tone: 'danger', message: error.message ?? 'Assignment failed' });
    return;
  }
  showToast({ tone: 'success', message: `Protocol "${protocol.name}" assigned to ${patientName}` });
  onConfirmed();
  ```

Step 2 — Test `AdoptDiffModal.test.tsx`:
- Mock supabase.from chains:
  - `from('protocol_steps').select(...).eq(...).eq(...).order(...)` → returns 3 protocol steps
  - `from('injections').select(...).eq(...).order(...).limit(...)` → returns 2 patient injections
- Mock supabase.rpc returning `{ error: null }` for success
- Render with open=true; assert 'Current schedule' + 'Protocol expectation' headers
- Assert at least one row contains warning-colored differing dose
- Click 'Assign to patient' → assert rpc called with `{ p_protocol_id, p_version, p_patient_id: 'p1' }`
- Assert success toast triggered (spy on useToast hook); assert onConfirmed callback fires
- Separate test: rpc returns error → danger toast; onConfirmed NOT called

Step 3 — Extend `ClinicWorkspace.tsx`:

Read the file once. Locate:
- Tab type/enum (TabId-like)
- Tab rendering switch/router
- Tab nav UI (links/buttons)

Add a new tab entry:
- Tab key: `'protocols'`
- Label: 'Protocols'
- Lazy import: `const ClinicProtocolsPage = lazy(() => import('@/components/clinic/protocols/ClinicProtocolsPage').then(m => ({ default: m.ClinicProtocolsPage })));`
- Render block: `case 'protocols': return <Suspense fallback={<Skeleton />}><ClinicProtocolsPage orgSlug={orgSlug} /></Suspense>;`

If ClinicWorkspace uses path-based routing (likely `/clinic/{slug}/protocols`), add the URL pathname segment to the resolver. The exact pattern is determined by reading the file. If route shape is `/clinic/{slug}/<tab>`, the new tab path is `protocols`.

Constraints:
  - DO NOT break existing tabs — additive only
  - Lazy load to preserve code-splitting per CLAUDE.md constraint
  - Match existing tab nav visual pattern (link styles, active state) — read existing tab declarations once
  </action>
  <verify>
    <automated>cd /Users/karstenhaldan/minisite/leanshot && test -f src/components/clinic/protocols/AdoptDiffModal.tsx && grep -q "ClinicProtocolsPage" src/components/clinic/ClinicWorkspace.tsx && grep -q "protocols" src/components/clinic/ClinicWorkspace.tsx && npx tsc -p tsconfig.app.json --noEmit 2>&1 | grep -E "error TS" | grep -E "(ClinicWorkspace|protocols)" | (! grep -q .) && npx vitest run --config vite.config.ts src/components/clinic/protocols/__tests__/AdoptDiffModal.test.tsx 2>&1 | tail -15 | grep -E "passed|✓"</automated>
  </verify>
  <done>AdoptDiffModal renders + RPC call verified by unit test; ClinicWorkspace nav includes Protocols tab routing to ClinicProtocolsPage; tsc clean.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| Clinician browser → assign_protocol_to_patient RPC | SECDEF RPC requires is_staff(); clinician role is staff-equivalent in current schema. Validation that protocol is published happens inside RPC. |
| Clinician browser → public.protocols SELECT | RLS public_published_select policy filters to review_state='published' for non-admin staff |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-61-06-01 | Elevation of privilege | Clinician adopts protocol for patient outside their org | mitigate | Per CONTEXT.md Phase 30 org-scoping is owned by patient-roster query — PatientPickerList only returns patients in caller's org via existing roster RLS. assign_protocol_to_patient RPC trusts the call but DB-level org-scoping is Phase 30's responsibility |
| T-61-06-02 | Information disclosure | Diff modal exposes another patient's injection data | mitigate | Patient injection query uses `eq('user_id', patientId)` where patientId came from authorized PatientPickerList selection; RLS on injections table backstops |
| T-61-06-03 | Tampering | Re-assignment to older version (downgrade attack) | accept | ON CONFLICT DO UPDATE replaces version unconditionally — UI prevents downgrade by listing only latest version per id; downgrade via direct API call is staff-only and acceptable for v1.4 |
</threat_model>

<verification>
- 3 unit tests pass: ClinicProtocolsPage, AdoptProtocolSheet, AdoptDiffModal
- `grep "ClinicProtocolsPage" src/components/clinic/ClinicWorkspace.tsx` returns 1 match
- `npx tsc -p tsconfig.app.json --noEmit` shows no new errors in clinic/protocols/ or ClinicWorkspace.tsx
- AdoptDiffModal RPC call verified via mock assertion on `assign_protocol_to_patient`
</verification>

<success_criteria>
- [ ] 3-4 new components shipped (ClinicProtocolsPage, AdoptProtocolSheet, AdoptDiffModal, PatientPickerList if extracted)
- [ ] 3 unit tests green
- [ ] ClinicWorkspace registers 'protocols' tab with lazy import
- [ ] Adopt button ≥44px touch target
- [ ] All success/error paths through assign_protocol_to_patient RPC
</success_criteria>

<output>
Create `.planning/phases/61-admin-protocol-creator/61-06-SUMMARY.md` documenting the roster picker reuse strategy, diff-row computation logic, and the ClinicWorkspace nav extension.
</output>
