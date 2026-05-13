# Phase 10 — PostHog Event Catalog (D-24, D-25)

**Created:** 2026-05-13
**Audience:** every Phase 10 plan must `read_first` this file
**PHI contract:** NO patient IDs, NO patient names, NO score values (use `low`/`mid`/`high` buckets — 0-29/30-69/70-100), NO membership IDs. Org IDs are organizational identifiers, not patient PHI — OK to capture. Comply with Phase 1 PostHog hygiene (no free-text health content).

---

## Score-bucket helper (canonical, used by every event property below)

```ts
// src/lib/clinic-events.ts
export type ScoreBucket = 'low' | 'mid' | 'high';
export const scoreBucket = (score: number): ScoreBucket =>
  score >= 70 ? 'high' : score >= 30 ? 'mid' : 'low';
```

---

## Events

### 1. `clinic_workspace_loaded`

| Property | Type | Source |
|----------|------|--------|
| `org_id` | uuid | route param `slug` resolved to org id via `orgs` table |

| Where it fires | Plan |
|----------------|------|
| `ClinicWorkspace.tsx` mount (Phase 9 ships this; Phase 10 may re-fire on route change) | Phase 9 — no Phase 10 work needed; verify already firing |

**PHI rationale:** Org ID is organizational; no patient data.

---

### 2. `clinic_roster_loaded`

| Property | Type | Source |
|----------|------|--------|
| `org_id` | uuid | route param |
| `patient_count` | int | result of `rank_org_patients` RPC `.length` |
| `render_ms` | int | `performance.now()` delta from RPC fire to last row paint |

| Where it fires | Plan |
|----------------|------|
| `RosterTable.tsx` after first render with data | Plan 10-06 |

**PHI rationale:** Patient count is aggregate; render time is performance metric.

---

### 3. `clinic_roster_sorted`

| Property | Type | Source |
|----------|------|--------|
| `column` | enum: `score` \| `name` \| `last_dose` \| `weight_trend` \| `symptom_severity` \| `days_since_injection` \| `missed_dose_flag` | column header click |
| `direction` | enum: `asc` \| `desc` | toggle state |

| Where it fires | Plan |
|----------------|------|
| `RosterTable.tsx` column-header `onClick` handler | Plan 10-06 |

**PHI rationale:** Sort metadata only.

---

### 4. `clinic_patient_drilled_in`

| Property | Type | Source |
|----------|------|--------|
| `org_id` | uuid | route param |
| `score_bucket` | enum: `low` \| `mid` \| `high` | `scoreBucket(row.score)` from clicked row |

**FORBIDDEN properties:** `patient_user_id`, `patient_name`, `score` (raw value)

| Where it fires | Plan |
|----------------|------|
| `RosterRow.tsx` / `RosterMobileCard.tsx` click handler — fire BEFORE navigating to `/clinic/{slug}/patient/{user_id}` | Plan 10-06 |

**PHI rationale:** Score bucket aggregates 30+ patients per bucket; org_id is org-scope, not patient-scope.

---

### 5. `clinic_drill_section_expanded`

| Property | Type | Source |
|----------|------|--------|
| `section_name` | enum: `injections` \| `weights` \| `symptoms` \| `photos` \| `doctor_report` \| `chart` | constant per section component |

**FORBIDDEN properties:** `patient_user_id`, `org_id` (intentionally — section views are aggregate-only at PostHog)

| Where it fires | Plan |
|----------------|------|
| Each section component (`InjectionsSection`, etc.) on first mount in clinic mode (debounced 1s); fires alongside the `log_clinic_view` RPC call (D-21) | Plan 10-07 |

**PHI rationale:** Section name is enum; no patient identifier. Cross-references with `clinic_patient_drilled_in` give us per-section engagement WITHOUT linking to a specific patient.

---

### 6. `clinic_audit_tab_opened`

| Property | Type | Source |
|----------|------|--------|
| `org_id` | uuid | current org context |

| Where it fires | Plan |
|----------------|------|
| `AuditTab.tsx` mount | Plan 10-08 |

**PHI rationale:** Org-scope only.

---

### 7. `clinic_audit_filter_applied`

| Property | Type | Source |
|----------|------|--------|
| `filter_type` | enum: `member` \| `action_type` \| `time_range` \| `clear_all` | which filter changed |
| `has_member_filter` | bool | snapshot of all 3 filter states after change |
| `has_action_filter` | bool | snapshot |
| `has_time_filter` | bool | snapshot |

**FORBIDDEN properties:** the actual member uuid, the actual action enum value, the actual date range — only booleans + filter-type-changed.

| Where it fires | Plan |
|----------------|------|
| `AuditFilterBar.tsx` after debounced filter-state apply | Plan 10-08 |

**PHI rationale:** Booleans only. Org-owner audit usage patterns without leaking which member is being audited.

---

### 8. `clinic_bulk_selected`

| Property | Type | Source |
|----------|------|--------|
| `count` | int | `selectedPatients.length` |
| `action_planned` | enum: `none` \| `pdf_export` \| `csv_export` \| `open_tabs` | initial state when actions menu opens; "none" if user clears without action |

**FORBIDDEN properties:** patient ids, patient names, individual scores.

| Where it fires | Plan |
|----------------|------|
| `RosterBulkSelectionBar.tsx` when count crosses 0→1 OR when user opens the action menu | Plan 10-10 |

**PHI rationale:** Count-only is aggregate.

---

### 9. `clinic_bulk_action_executed`

| Property | Type | Source |
|----------|------|--------|
| `action` | enum: `pdf_export` \| `csv_export` \| `open_tabs` | which action confirmed |
| `patient_count` | int | `selectedPatients.length` after confirmation modal `Confirm` |

| Where it fires | Plan |
|----------------|------|
| Each `BulkExport*Flow.tsx` after confirmation modal `Confirm` click, BEFORE the action begins | Plan 10-10 |

**PHI rationale:** Aggregate count + action; no individual patient.

---

### 10. `clinic_rank_breakdown_expanded`

| Property | Type | Source |
|----------|------|--------|
| `score_bucket` | enum: `low` \| `mid` \| `high` | `scoreBucket(row.score)` from the row whose breakdown popover opened |

**FORBIDDEN properties:** patient_user_id, raw score, individual signal weights from breakdown jsonb.

| Where it fires | Plan |
|----------------|------|
| `ScoreBreakdownPopover.tsx` mount | Plan 10-06 |

**PHI rationale:** Score bucket aggregates engagement with the breakdown affordance; gated by `roster.read_breakdown` permission so absence in PostHog also signals which orgs have Coach role assignments without naming them.

---

## Verification (Plan 10-11 acceptance criteria)

- `! grep -rE "(patient_user_id|patient_name|user_id|membership_id|raw_score|score:[0-9])" src/components/clinic/ src/lib/clinic-events.ts | grep -v 'test' | grep posthog` returns zero matches
- `! grep -rE "scoreBucket\\(row\\.score\\)" src/components/clinic/` proves bucket helper is wired (presence assertion)
- All 10 event names appear in `posthog.capture` calls under `src/components/clinic/` OR `src/components/dashboard/settings/PatientActivityModal.tsx` (modal does not capture — only operator-side captures; this is intentional per D-19)
- PostHog dashboard verification (manual, post-deploy): all 10 events appear in PostHog Live Events tab within 30s of executing each user action

---

## Patient-side: NO additional PostHog events

The patient-side `PatientActivityModal` (D-19) is intentionally NOT instrumented with PostHog events. Rationale: the modal exposes audit-trail data ABOUT the patient; capturing the patient's act of opening it would create a meta-audit trail (PostHog event "patient viewed audit log of org X") that would itself be sensitive. Patients' use of their own audit-log surface is intentionally invisible to product analytics.

---

*Phase: 10-clinic-operator-surface*
*Events catalog locked: 2026-05-13*
