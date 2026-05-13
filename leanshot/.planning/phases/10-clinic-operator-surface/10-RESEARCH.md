# Phase 10 — Clinic Operator Surface — Research

**Researched:** 2026-05-13
**Status:** Ready for planning
**Phase requirements:** CLINIC-04, CLINIC-05, CLINIC-07 (org-owner audit surface UI half)

> All locked decisions for Phase 10 already live in `10-CONTEXT.md` (D-01 through D-25). This RESEARCH.md focuses on the **technical knowledge gaps** between context and a plannable phase: the SECURITY DEFINER RPC mechanics, the Phase 8 SharePage extraction shape, the Realtime broadcast trigger SQL, jsPDF dynamic-import contract, the audit-row data model deltas, and the verification surfaces (pgTAP + Playwright). User Constraints come first per planner contract.

---

## User Constraints (verbatim from CONTEXT.md — planner MUST honor)

### Locked decisions (D-01 to D-25)

- **D-01:** SECURITY DEFINER RPC `rank_org_patients(p_org_id uuid)` returns ordered array of `(user_id uuid, display_name text, score smallint, breakdown jsonb, last_injection_at timestamptz, weight_trend_arrow text, recent_symptom_severity smallint, days_since_injection int, missed_dose_flag bool)`. RLS-gated by `has_permission(auth.uid(), p_org_id, 'patient_data.read')` via inner-join. Recomputes on every roster load — no materialized view, no cron. SLA: 50 patients < 500ms RPC latency.
- **D-02:** Score 0-100. Weights (highest→lowest): missed-dose flag, recent symptom severity, weight-trend reversal, days-since-injection, streak break. Reuses Phase 3 `pickFocus`/`generateInsights` weight architecture, batched per patient. `breakdown` jsonb is `{ "missed_dose": <signal_score>, "symptom_severity": <signal_score>, ... }`. Weights NOT org-tunable in v1.
- **D-03:** Refactor Phase 8's `SharePage` into a thin wrapper around a NEW `src/components/shared/ReadOnlyPatientView.tsx` accepting: `viewerMode: 'share' | 'clinic'`, `snapshot: SnapshotData`, `permissionMap?: { canViewPhotos: bool, canViewBreakdown: bool, ... }`. NEW shared chunk `read-only-patient-view`; both `share` and `clinic` lazy chunks depend on it.
- **D-04:** New `supabase/functions/clinic-snapshot/index.ts` mirroring Phase 8's `/share/snapshot`. Validates operator JWT → checks membership active + role permission + consent_scope → returns SnapshotResponse with `viewer_context: 'clinic'`, `org_id`, `patient_user_id`, `permission_map`. Cache-Control: `private, no-store` always. Audit-row writes per D-09 (per-section).
- **D-05:** Single denormalized RPC `rank_org_patients` returns ALL signal columns + score + breakdown in one row per patient. No follow-up per-patient queries from client.
- **D-06:** Pagination 50/page; default sort score DESC; column-click triggers new RPC call with `p_sort_column` + `p_sort_direction` params. Offset-based pagination is acceptable at scale; cursor as v2.
- **D-07:** New `/clinic/{slug}/settings/audit` tab in ClinicSettingsPage. Tab visibility gated by `has_permission(viewer, org_id, 'audit_log.read')`. Owner has by default.
- **D-08:** Audit tab filters: member dropdown / action-type dropdown / time-range picker (last 24h / 7d / 30d / custom). Per-row display: timestamp, actor (name + role badge), action, target, expandable details. **Per-patient mirror:** Phase 9's stubbed "View activity" on each Active Orgs row gets filled — clicking opens a modal with audit rows where `target_user_id = current patient AND org_id = membership.org_id`.
- **D-09:** Audit surface reads directly from `audit_logs`; Phase 7 D-04's retention cron handles purge. Operators see anything younger than 13 months. No CSV export, no archival banner in v1.
- **D-10:** New script `leanshot/e2e/fixtures/seed-org-50.ts` + Playwright spec `leanshot/e2e/roster-perf.spec.ts` — assert 50-patient roster renders < 2000ms via `page.evaluate(() => performance.now() - navigationStart)`. afterAll cleanup.
- **D-11:** New CI job `roster-perf` in `.github/workflows/ci.yml` triggered on PR when changed files match `leanshot/src/components/clinic/**` OR `supabase/migrations/*roster*.sql` OR `supabase/functions/clinic-snapshot/**`. Append AFTER Plan 08-05's `share-security-drill` job.
- **D-12:** Permission-gated sections of `ReadOnlyPatientView` are absent (not rendered) when operator lacks the relevant permission. Mirrors Phase 7-8-9 Settings NAV gating.
- **D-13:** Rank score 0-100 shown to both Coach and Viewer. Expandable breakdown tooltip with per-signal weights gated by NEW permission key `roster.read_breakdown` — added via row insert in `permissions` + `role_permissions` seed update (NOT a Phase 10 schema migration). Coach seeded with `roster.read_breakdown` = true; Viewer = false. Owner inherits.
- **D-14:** Below 768px viewport, roster table collapses to vertical card stack (`Card` primitive from Phase 8 UI-SPEC).
- **D-15:** Mobile drill-in replaces roster view with back button in clinic-context bar. Returns to roster on back. Desktop is split-pane (roster left, drill-in right) reusing Phase 8 SharePage layout via `ReadOnlyPatientView`.
- **D-16:** Operator's `/clinic/{slug}` subscribes to org-scoped Realtime channel from Phase 9 D-10. New broadcast trigger on `injections`, `weights`, `symptoms` INSERT (server-side filtered by org-member relationship + consent_scope) — operator UI patches the relevant roster row's signal columns. Score is NOT recomputed on each event; passive 30s refetch + manual "refresh" button handle score recompute.
- **D-17:** Row brief flash (200ms fade-in highlight, respects `prefers-reduced-motion`) on Realtime signal-column update. Threshold-cross toast (score crosses 70 = "needs attention").
- **D-18:** `rank_org_patients` RPC writes ONE audit_logs row per CALL with `actor_type='org_system'`, `action='rank_computed'`, `org_id=p_org_id`, `metadata={ patient_count, weights_snapshot, top_3_score_buckets }`. Per-patient audit row whenever a patient's score crosses a threshold (70+ "needs attention" or drops below): `target_user_id=patient`, `action='rank_threshold_crossed'`.
- **D-19:** Patient's "View activity" modal has TWO tabs: "Operator views" (audit rows from operator drill-ins, per-section granular per D-21) and "Ranking events" (threshold-crossing rows from D-18). Both filtered by `target_user_id = patient_id AND org_id = membership.org_id`.
- **D-20:** Per-row display: `<timestamp> — <actor display name> (<role>) <action verb> your <section>`. No IP, no UA, no device fingerprint visible. Actor name from `auth.users.user_metadata.display_name`, falls back to "a clinic member" if empty.
- **D-21:** Audit rows fire on section-component mount, not per-RPC. Sections: Injections, Weights, Symptoms, Photos, Doctor Report, Chart. Each section component calls `posthog.capture` AND writes an audit row via NEW `log_clinic_view(org_id, target_user_id, section_name)` SECURITY DEFINER RPC.
- **D-22:** Multi-select infrastructure on roster (checkbox per row, header "select all visible", selection state preserved across pagination). Three bulk actions: PDF (jsPDF dynamic-import), CSV (server-side), Open in tabs (capped at 5).
- **D-23:** Checkbox per row (40px hit target); header "X selected" pill with action menu dropdown; selection persists across column resort and pagination. Mobile: long-press to select; tap-to-drill remains primary.
- **D-24:** 10 PostHog events specified in `10-EVENTS.md`. PHI rules: NO patient IDs, NO patient names, NO score values (use `low`/`mid`/`high` buckets — 0-29/30-69/70-100), NO membership IDs. Org IDs OK.
- **D-25:** All events specified in `.planning/phases/10-clinic-operator-surface/10-EVENTS.md`. Each implementing plan `read_first` references it.

### Claude's Discretion (planner picks)

- `rank_org_patients` impl language: plpgsql vs Deno Edge Function. **Recommendation:** plpgsql (one round-trip, simpler RLS surface, easier to audit). Reserve Deno Edge Function for the per-section audit RPC `log_clinic_view` only if plpgsql proves limiting.
- Score-bucket boundaries: 0-29 low, 30-69 mid, 70-100 high (D-22/D-24 names; tunable).
- PDF assembly path: client-side jsPDF dynamic-import (Phase 7 D-NN proven; bundle cost already paid).
- Realtime broadcast trigger payload: `{ user_id, section: 'injections'|'weights'|'symptoms', changed_at }` minimum; planner can extend.
- Roster column ordering on desktop: Score | Patient | Last Dose | Weight Arrow | Symptom Sev | Days Since | Missed-Dose Flag.

### Deferred (out of scope — DO NOT plan)

- Custom rank weights per org (v2 if operators complain).
- "Send patient check-in message" / Resend-templated push (Phase 11+).
- CSV archival export for org audit (only if counsel asks).
- Cursor-based infinite-scroll roster (v2).
- Org-tunable score thresholds.

---

## Project Constraints (from CLAUDE.md)

- **Tech stack:** React 19 + Vite + TS strict + Tailwind v4 beta + Zustand. No new backend stack.
- **Local-first invariant:** Phase 10 surfaces are clinic-only and do not break local-first behavior on the patient app.
- **Bundle size:** chart.js + framer-motion + lucide-react are heavy. App.tsx already lazy-loads tabs/modals — preserve. Phase 5 regression memory: heavy SDKs go through `sync-defer.ts`. `jspdf` MUST be `await import('jspdf')`, never static.
- **Strict TypeScript:** no `any`, no `useStore(s => s)` whole-store reads, no static-import of `generateInsights`/`pickFocus` selectors (eslint-blocked).
- **Accessibility:** keyboard nav, screen-reader labels, color contrast, reduced-motion all end-to-end (per CLAUDE.md L13).
- **No HIPAA covered-entity features.** Phase 10's audit log is HBNR/WMHMDA defensible (D-18, D-19) but does NOT push us into BAA territory.
- **Synchronous hydration before first render** (`src/main.tsx:25-32`): operator routes `/clinic/{slug}` MUST also hydrate identically — no marketing flash for an operator-owned `auth.users` row.
- **Date storage:** ISO strings or `YYYY-MM-DD`, never `Date` objects.

---

## Standard Stack (this phase)

| Concern | Library / pattern | Version | Source / rationale |
|---------|-------------------|---------|---------------------|
| DB ranking RPC | plpgsql `SECURITY DEFINER` function with `SET search_path = public, extensions` | n/a | Memory `reference_supabase_migration_gotchas.md` — extensions search_path required for `digest()` etc. Use plpgsql for one-round-trip RLS-safe access. |
| Edge Function for snapshot | Deno + supabase-js `2.x` (matches Phase 8 `share/index.ts`) | per Phase 8 | One-to-one mirror of Phase 8 `/share/snapshot` with `viewer_context: 'clinic'`. |
| Edge Function for bulk CSV | Deno (no PDF, just text assembly) | per Phase 8 | Lightweight text-stream response. |
| Frontend PDF assembly | `jspdf` (already in package.json post-Phase 7) | per Phase 7 lock | `await import('jspdf')` dynamic — see `project_phase5_bundle_regression.md`. |
| Realtime broadcast trigger | Phase 9 D-10 pattern: `pg_notify`-style `realtime.send` from AFTER INSERT trigger with org-membership filter | n/a | Phase 9 already shipped this for `memberships` UPDATE; Phase 10 extends to `injections`/`weights`/`symptoms` INSERT. |
| Audit row writer | `audit_logs` table from Phase 7+8+9 (extended with new `action` enum values via `audit_logs_action_check` constraint update) | n/a | NO new table. New SECURITY DEFINER RPC `log_clinic_view` for per-section writes. |
| Date utilities | existing `relative-time` formatter in `src/lib/helpers.ts` (Phase 9 carry-forward) | n/a | Roster row metadata + audit row timestamps. |
| Charts in drill-in | `chart.js` via `BaseChart` primitive (`src/components/dashboard/charts/BaseChart.tsx`) | per Phase 8 | `ReadOnlyPatientView` chart section wraps `BaseChart` identically to SharePage today. |
| Icons | `lucide-react` ^0.460.0 | per project | New icons listed in 10-UI-SPEC L19. |
| Test runners | Vitest (unit), Playwright (e2e), Deno test (Edge Functions per memory `reference_deno_test_discovery.md` — `*.test.ts` naming) | per project | All new Deno tests use `<name>.test.ts` (NOT `*-test.ts`). |
| pgTAP cross-tenant impersonation | `pgtap` extension already enabled in Phase 5+ | n/a | Project rule from memory `reference_supabase_project.md` — every new RLS surface (RPC + Edge Function path) gets impersonation proof. |
| Bundle-size guard | existing CI `bundle-size` job from Phase 6 Plan 06-01 | n/a | Index ≤50 kB gz; Phase 9 close ~24.5 kB; Phase 10 must not exceed. |

---

## Architecture Patterns

### 1. SECURITY DEFINER RPC with permission inner-join (D-01)

```sql
-- skeleton; full impl in Plan 10-02
CREATE OR REPLACE FUNCTION rank_org_patients(
  p_org_id uuid,
  p_sort_column text DEFAULT 'score',
  p_sort_direction text DEFAULT 'desc',
  p_offset int DEFAULT 0,
  p_limit int DEFAULT 50
)
RETURNS TABLE (
  user_id uuid,
  display_name text,
  score smallint,
  breakdown jsonb,
  last_injection_at timestamptz,
  weight_trend_arrow text,
  recent_symptom_severity smallint,
  days_since_injection int,
  missed_dose_flag bool
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  -- RLS gate: has_permission must be TRUE for the caller on this org
  IF NOT EXISTS (
    SELECT 1
    WHERE has_permission(auth.uid(), p_org_id, 'patient_data.read')
  ) THEN
    RAISE EXCEPTION 'access_denied';
  END IF;

  -- Capture audit row for the rank computation (D-18)
  INSERT INTO audit_logs (actor_id, actor_type, action, org_id, metadata, created_at)
  VALUES (auth.uid(), 'org_system', 'rank_computed', p_org_id,
          jsonb_build_object('patient_count', /* computed */, 'weights_snapshot', /* fixed */),
          now());

  -- Return signal-columns + score per patient via inline calculation
  -- (each per-patient signal computed from Phase 3 weight architecture)
  RETURN QUERY
  SELECT ... ;  -- planner fills full SQL in Plan 10-02
END;
$$;
```

**Pitfalls (apply preventively per memory `reference_supabase_migration_gotchas.md`):**
1. SECURITY DEFINER functions MUST set `search_path = public, extensions` to access `digest()` / pgcrypto helpers (Phase 7 Plan 07-07 surfaced this).
2. If any partial index is added on `audit_logs` for the `rank_computed` queries, the predicate must be `IMMUTABLE` (Phase 7 Plan 07-07 lesson).
3. If cascade-DELETE crosses `audit_logs`, set `app.suppress_audit` GUC inside the trigger to skip mid-cascade fires (Phase 7 Plan 07-07 lesson). Phase 10 doesn't add cascade DELETE on `audit_logs`, but if patient deletion (Phase 7) intersects, ensure suppression works.

### 2. Edge Function with operator-JWT + 4-step auth (D-04)

`supabase/functions/clinic-snapshot/index.ts`:

```ts
// skeleton
export default async function handler(req: Request) {
  // 1. Validate JWT
  const jwt = req.headers.get('Authorization')?.replace('Bearer ', '');
  if (!jwt) return new Response('Unauthorized', { status: 401 });
  const supabase = createSupabaseClient({ jwt });
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new Response('Unauthorized', { status: 401 });

  // 2. Validate operator is active member of org
  const { data: membership } = await supabase
    .from('memberships')
    .select('id')
    .match({ user_id: user.id, org_id: orgId, revoked_at: null })
    .single();
  if (!membership) return new Response('Forbidden', { status: 403 });

  // 3. Validate has_permission(operator, org, 'patient_data.read')
  const { data: hasPermission } = await supabase.rpc('has_permission', {
    p_user_id: user.id,
    p_org_id: orgId,
    p_permission_key: 'patient_data.read',
  });
  if (!hasPermission) return new Response('Forbidden', { status: 403 });

  // 4. Validate patient consent_scope covers requested sections + patient is active member
  // ... (mirror Phase 8 SharePage section gating)

  // 5. Build SnapshotResponse with permission_map + viewer_context: 'clinic'
  const snapshot = buildSnapshot({ ... });

  // 6. Audit row per D-09 (section-level writes happen client-side via log_clinic_view RPC; this Edge Function writes one row per snapshot fetch with action='clinic_snapshot_loaded')
  await supabase.rpc('log_clinic_view', {
    p_org_id: orgId,
    p_target_user_id: patientUserId,
    p_section_name: 'snapshot_load',
  });

  return new Response(JSON.stringify(snapshot), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'private, no-store',
    },
  });
}
```

**Verification (Plan 10-04 testing):** Deno test file `clinic-snapshot.test.ts` (NOT `*-test.ts`) covers:
- Missing JWT → 401
- Valid JWT, no membership → 403
- Valid JWT, membership exists but `revoked_at != null` → 403
- Valid JWT, role lacks `patient_data.read` → 403
- Valid JWT, all checks pass, but consent_scope excludes a section → returned snapshot OMITS that section
- Cache-Control header is `private, no-store` on every status code

### 3. Phase 8 SharePage refactor → ReadOnlyPatientView extraction (D-03)

**Before (Phase 8):** `src/components/share/SharePage.tsx` is the monolith. State machine: code-entry → loading → snapshot-rendered → error/revoked. Renders all body sections directly.

**After (Phase 10 Plan 10-05):**

```
src/
  components/
    shared/
      ReadOnlyPatientView.tsx          NEW — body sections + permission_map gating
      ReadOnlyPatientView.test.tsx     NEW — Vitest, prop-driven
      sections/
        InjectionsSection.tsx          MOVED from share/
        WeightsSection.tsx             MOVED from share/
        SymptomsSection.tsx            MOVED from share/
        PhotosSection.tsx              MOVED from share/
        DoctorReportSection.tsx        MOVED from share/
        ChartSection.tsx               MOVED from share/
    share/
      SharePage.tsx                    REFACTORED — thin wrapper around ReadOnlyPatientView with viewerMode='share'
      CodeEntryScreen.tsx              UNCHANGED
      ShareRevokedScreen.tsx           UNCHANGED
      share-client.ts                  UNCHANGED
      SharePage.test.tsx               UPDATED — only tests share-mode chrome; section behavior tested in ReadOnlyPatientView.test
    clinic/
      drill-in/
        ClinicDrillInPage.tsx          NEW — thin wrapper around ReadOnlyPatientView with viewerMode='clinic' + permission_map
        ClinicDrillInSubBar.tsx        NEW
```

**Props contract (canonical TypeScript interface — single source of truth, defined in `src/types/snapshot.ts` extending Phase 8's existing SnapshotResponse type):**

```ts
// src/types/snapshot.ts (NEW or extension of existing types/index.ts)
export interface SnapshotData {
  patient_user_id: string;
  display_name: string;
  injections: Injection[];
  weights: WeightLog[];
  symptoms: SymptomLog[];
  photos: Photo[];
  doctor_report?: DoctorReport;
  // ... existing Phase 8 SnapshotResponse fields
  viewer_context: 'share' | 'clinic';
  org_id?: string; // present when viewer_context is 'clinic'
  permission_map?: ReadOnlyPermissionMap; // present when viewer_context is 'clinic'
}

export interface ReadOnlyPermissionMap {
  canViewPhotos: boolean;
  canViewBreakdown: boolean;
  canViewDoctorReport: boolean;
  // ...one boolean per gated section
}

export interface ReadOnlyPatientViewProps {
  snapshot: SnapshotData;
  viewerMode: 'share' | 'clinic';
  permissionMap?: ReadOnlyPermissionMap;
  onSectionMount?: (sectionName: string) => void; // clinic-mode fires log_clinic_view per section
}
```

**Bundle redistribution:** `share` chunk shrinks (~8 kB delta as section components leave); `clinic` chunk grows (~8 kB for drill-in shell + clinic-snapshot client); NEW shared `read-only-patient-view` chunk holds the section components + ReadOnlyPatientView itself (~10 kB); both `share` and `clinic` lazy-depend on it via dynamic `import()`.

**Anti-pattern from memory `feedback_planner_iter1_anti_patterns.md`:** Define the `SnapshotData` and `ReadOnlyPermissionMap` interfaces ONCE in `src/types/snapshot.ts` (or extend existing `src/types/index.ts`); do NOT redefine inside each consumer.

### 4. Realtime broadcast trigger on injections/weights/symptoms (D-16, D-17)

```sql
-- supabase/migrations/<phase-10-range>_clinic_realtime_broadcast.sql
CREATE OR REPLACE FUNCTION broadcast_patient_signal_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_section text := TG_ARGV[0]; -- 'injections' | 'weights' | 'symptoms'
  v_org_id uuid;
BEGIN
  -- For each org-membership the affected user belongs to with consent_scope[v_section] = true,
  -- emit a Realtime broadcast on the org's channel
  FOR v_org_id IN
    SELECT m.org_id
    FROM memberships m
    WHERE m.user_id = NEW.user_id
      AND m.revoked_at IS NULL
      AND (m.consent_scope ->> v_section)::bool = true
  LOOP
    PERFORM realtime.broadcast(
      'org-' || v_org_id::text,
      jsonb_build_object(
        'event', 'patient_signal_change',
        'user_id', NEW.user_id,
        'section', v_section,
        'changed_at', NEW.created_at
      )
    );
  END LOOP;
  RETURN NEW;
END;
$$;

CREATE TRIGGER injections_clinic_broadcast AFTER INSERT ON injections
  FOR EACH ROW EXECUTE FUNCTION broadcast_patient_signal_change('injections');
CREATE TRIGGER weights_clinic_broadcast AFTER INSERT ON weights
  FOR EACH ROW EXECUTE FUNCTION broadcast_patient_signal_change('weights');
CREATE TRIGGER symptoms_clinic_broadcast AFTER INSERT ON symptoms
  FOR EACH ROW EXECUTE FUNCTION broadcast_patient_signal_change('symptoms');
```

**Client-side subscription pattern (mirrors Phase 9 D-10):**

```ts
// inside ClinicWorkspace.tsx (Phase 9) — extended in Plan 10-03
useEffect(() => {
  const channel = supabase.channel(`org-${orgId}`)
    .on('broadcast', { event: 'patient_signal_change' }, ({ payload }) => {
      // Patch only the affected row's signal columns; do NOT re-fire rank RPC
      patchRosterRow(payload.user_id, payload.section, payload.changed_at);
      flashRow(payload.user_id); // 200ms reduced-motion-respecting highlight
    })
    .subscribe();
  return () => { supabase.removeChannel(channel); };
}, [orgId]);
```

### 5. log_clinic_view SECURITY DEFINER RPC (D-21)

```sql
-- supabase/migrations/<phase-10-range>_log_clinic_view.sql
CREATE OR REPLACE FUNCTION log_clinic_view(
  p_org_id uuid,
  p_target_user_id uuid,
  p_section_name text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  -- RLS gate: caller MUST be active member of p_org_id with patient_data.read OR patient_photos.read
  IF NOT EXISTS (
    SELECT 1 WHERE has_permission(auth.uid(), p_org_id,
      CASE WHEN p_section_name = 'photos' THEN 'patient_photos.read' ELSE 'patient_data.read' END
    )
  ) THEN
    RAISE EXCEPTION 'access_denied';
  END IF;

  -- The target patient MUST have an active membership with the org
  IF NOT EXISTS (
    SELECT 1 FROM memberships m
    WHERE m.user_id = p_target_user_id
      AND m.org_id = p_org_id
      AND m.revoked_at IS NULL
  ) THEN
    RAISE EXCEPTION 'patient_not_in_org';
  END IF;

  INSERT INTO audit_logs (actor_id, actor_type, action, org_id, target_user_id, metadata, created_at)
  VALUES (auth.uid(), 'org_member', 'section_view', p_org_id, p_target_user_id,
          jsonb_build_object('section', p_section_name), now());
END;
$$;
```

**Verification (Plan 10-06 pgTAP):** Cross-tenant impersonation — Operator A in Org 1 calls `log_clinic_view(org_2_id, ...)` → must `RAISE EXCEPTION`. Operator A in Org 1 calls `log_clinic_view(org_1_id, patient_in_org_2)` → must `RAISE EXCEPTION 'patient_not_in_org'`.

### 6. jsPDF dynamic-import contract (D-22)

```ts
// src/components/clinic/roster/BulkExportPDFFlow.tsx
const handleGeneratePDF = async () => {
  // CRITICAL: dynamic import only. Static import is forbidden.
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF();

  for (const patient of selectedPatients) {
    // fetch snapshot per patient (same clinic-snapshot Edge Function)
    const snapshot = await fetchClinicSnapshot(orgId, patient.user_id);
    // assemble per-patient section using existing chart-to-image pattern from Phase 7
    addPatientPage(doc, snapshot);
    // log audit row per included patient (D-22 acceptance criterion)
    await supabase.rpc('log_bulk_export_inclusion', {
      p_org_id: orgId,
      p_target_user_id: patient.user_id,
      p_export_type: 'pdf',
    });
  }

  const blob = doc.output('blob');
  saveAs(blob, `bulk-roster-${date}.pdf`);
};
```

**Bundle-size CI guard (existing job, Phase 6 Plan 06-01):** Will fail the PR if `jspdf` appears in any always-loaded chunk's manifest. Plan 10-08 must include a verification command: `! grep -r "from 'jspdf'" src/ | grep -v 'await import'` should return zero matches outside test files.

### 7. Per-patient mirror modal data fetch (D-19, D-20)

Edge Function `GET /patient-activity?org_id={...}` (NEW, `supabase/functions/patient-activity/index.ts`):

```ts
// pseudocode
export default async function handler(req: Request) {
  const jwt = req.headers.get('Authorization')?.replace('Bearer ', '');
  const supabase = createSupabaseClient({ jwt });
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new Response('Unauthorized', { status: 401 });

  const url = new URL(req.url);
  const orgId = url.searchParams.get('org_id');
  const tabType = url.searchParams.get('tab') ?? 'operator_views'; // or 'ranking_events'
  const offset = parseInt(url.searchParams.get('offset') ?? '0');
  const limit = 25;

  // RLS-safe SELECT — RLS policy on audit_logs already restricts to target_user_id = auth.uid() OR org_id IN <user's orgs>
  // For patient-side, we filter by target_user_id = auth.uid() AND org_id = orgId
  let query = supabase
    .from('audit_logs')
    .select('id, actor_id, action, target_user_id, org_id, metadata, created_at')
    .eq('target_user_id', user.id)
    .eq('org_id', orgId)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (tabType === 'operator_views') {
    query = query.in('action', ['section_view', 'patient_data.read', 'patient_photos.read']);
  } else if (tabType === 'ranking_events') {
    query = query.eq('action', 'rank_threshold_crossed');
  }

  const { data, error } = await query;
  if (error) return new Response('Internal Server Error', { status: 500 });

  // Enrich with actor display_name (D-20 fallback)
  const actorIds = [...new Set(data.map(r => r.actor_id))];
  const { data: actors } = await supabase
    .from('auth.users')
    .select('id, raw_user_meta_data')
    .in('id', actorIds);

  const enriched = data.map(row => ({
    ...row,
    actor_display_name: actors.find(a => a.id === row.actor_id)?.raw_user_meta_data?.display_name ?? 'a clinic member',
  }));

  return new Response(JSON.stringify({ rows: enriched, has_more: data.length === limit }), { status: 200 });
}
```

**RLS check (Plan 10-09 pgTAP):** Patient B impersonating Patient A's `auth.uid()` and calling this function → MUST return only Patient B's rows (RLS doesn't even let the SELECT past `target_user_id = auth.uid()`). Cross-tenant: Patient A in Org 1 querying `org_id = org_2_id` → returns empty (no rows where target_user_id matches AND org_id matches).

### 8. Audit-action enum extension (D-08, D-18, D-21, D-22)

Existing `audit_logs_action_check` constraint (Phase 7+8+9) currently includes:
`'member.invite' | 'member.accept' | 'member.decline' | 'member.revoke' | 'role.create' | 'role.update' | 'role.delete' | 'role.assign' | 'patient_data.read' | 'patient_photos.read'`

Phase 10 adds:
- `'rank_computed'` (D-18, system event)
- `'rank_threshold_crossed'` (D-18, per-patient flagging)
- `'section_view'` (D-21, per-section operator drill-in audit)
- `'bulk_pdf_export'` (D-22, per-included-patient)
- `'bulk_csv_export'` (D-22, per-included-patient)
- `'clinic_snapshot_loaded'` (D-04, optional umbrella row per drill-in mount)

Migration:

```sql
-- supabase/migrations/<phase-10-range>_extend_audit_action_enum.sql
ALTER TABLE audit_logs DROP CONSTRAINT IF EXISTS audit_logs_action_check;
ALTER TABLE audit_logs ADD CONSTRAINT audit_logs_action_check CHECK (
  action IN (
    'member.invite', 'member.accept', 'member.decline', 'member.revoke',
    'role.create', 'role.update', 'role.delete', 'role.assign',
    'patient_data.read', 'patient_photos.read',
    'rank_computed', 'rank_threshold_crossed', 'section_view',
    'bulk_pdf_export', 'bulk_csv_export', 'clinic_snapshot_loaded'
  )
);
```

---

## Don't Hand-Roll

| Concern | Use this instead | Rationale |
|---------|------------------|-----------|
| Date diff for `days_since_injection` | `EXTRACT(DAY FROM now() - injection.created_at)::int` (Postgres) + existing `relative-time` formatter (TS) | Existing utility; consistent across Phase 6+7+8+9. |
| Auth header parsing in Edge Function | `req.headers.get('Authorization')?.replace('Bearer ', '')` — same one-liner as Phase 8 `share/index.ts` | Established pattern. |
| RLS impersonation in pgTAP | `set local role authenticated; set local request.jwt.claims = '{"sub": "<uuid>"}';` (Phase 7 Plan 07-07 pattern) | Reuse exact incantation; do NOT roll a new auth-mock. |
| Skeleton loaders | `Skeleton` primitive in `src/components/ui/Skeleton.tsx` | Phase 1 + Phase 8 reuse. |
| Toast | `useToast` hook (`src/hooks/useToast.ts`) | Threshold-cross toast, bulk-action toast, hard-401 toast all use this. |
| Modal | `Modal` primitive (`src/components/ui/Modal.tsx`) — has focus-trap, Escape, ARIA built in | Used by PatientActivityModal, AuditCustomRangeModal, all bulk-action confirmations. |
| Confirmation dialog | `Confirm` primitive (`src/components/ui/Confirm.tsx`) — Phase 8/9 carry-forward | Bulk-action confirmations. |
| Permission gate | `has_permission()` SECURITY DEFINER from Phase 9 D-07 | Every Phase 10 RLS surface uses it. |
| Realtime channel join | `supabase.channel('org-<id>')` from Phase 9 D-10 | Just register a NEW broadcast event handler; channel itself already exists per org. |
| PDF page assembly | `jspdf` (already in package.json) — DYNAMIC IMPORT | Phase 7 lock; bundle invariant. |
| CSV row assembly | server-side string-concat in Edge Function (no library) | Symptoms CSV is < 1 MB for any realistic 30-day window over 50 patients; native `string.join('\n')` is fine. |

---

## Common Pitfalls

| Pitfall | Mitigation in plans | Source |
|---------|---------------------|--------|
| Static-import of `jspdf` | Plan 10-08 `acceptance_criteria` includes `! grep -rE "^import .* from ['\"]jspdf['\"]" src/` returns zero | memory `project_phase5_bundle_regression.md` |
| Per-event RPC spam on Realtime updates | Plan 10-03 explicitly wires the Realtime handler to ONLY patch row data; the rank RPC is fired ONLY by 30s timer + manual refresh button | D-16 |
| Cross-plan App.tsx writer choreography | Plan 10-05 (SharePage refactor) is the ONLY plan that writes to `App.tsx` (adds `/clinic/{slug}/patient/{user_id}` route inside the existing `clinic` lazy chunk). All other plans writing to `App.tsx` are forbidden — flag in plan-checker. | memory `feedback_planner_iter1_anti_patterns.md` |
| Hedge instructions in downstream plans | Plan-checker enforces: each plan's `<action>` blocks contain CONCRETE values, not "align with X" or "match the pattern from Y" | memory `feedback_planner_iter1_anti_patterns.md` |
| Defensive jsonb / opaque-ID contracts | Define `SnapshotData`, `ReadOnlyPermissionMap`, `RankRosterRow` ONCE in `src/types/snapshot.ts`; downstream plans MUST `import` from there, not redefine | memory `feedback_planner_iter1_anti_patterns.md` |
| VALIDATION flag flip-timing | Phase 10 has no validation flags to flip (no feature-flag gating for the operator surface — it's gated by `has_permission`) | memory `feedback_planner_iter1_anti_patterns.md` |
| Parallel executor git index contention | Wave 2 + Wave 3 plans MUST use `git commit -- <pathspec>` per memory rule | memory `feedback_parallel_executor_git_isolation.md` |
| Deno test naming gotcha | Every NEW Deno test in `supabase/functions/*/` MUST be named `<name>.test.ts` (NOT `*-test.ts`); CI directory walk only matches the dot form | memory `reference_deno_test_discovery.md` |
| Partial-index expression IMMUTABLE requirement | If Plan 10-02 adds a partial index for `rank_computed` audit queries, the predicate must be IMMUTABLE | memory `reference_supabase_migration_gotchas.md` |
| SECURITY DEFINER `extensions` search_path | Every NEW SECURITY DEFINER function (rank_org_patients, log_clinic_view, broadcast_patient_signal_change, log_bulk_export_inclusion) sets `SET search_path = public, extensions` | memory `reference_supabase_migration_gotchas.md` |
| Realtime row-flash starves screen-reader | Row flash announcement is debounced 1s and uses `aria-live="polite"` — see UI-SPEC L426 | 10-UI-SPEC accessibility contract |
| PostHog PHI leak | All 10 events use score buckets (`low`/`mid`/`high`), org_id only. Plan 10-10 verification grep — `! grep -rE "(patient_id|patient_name|user_id|score:[0-9])" src/components/clinic/ \| grep -v test` | D-24 |
| 13-month retention banner forgotten | Plan 10-07 acceptance criteria: AuditTab renders the dismissible 13-month notice on mount when localStorage key `clinic_audit_retention_dismissed` is unset | D-09 + UI-SPEC |
| `s.user!` non-null assertion regressions | Phase 7 inventory found 14 files / 15 occurrences. Plan 10-NN must NOT add new ones; use `if (!s.user) return null` guard pattern | memory `project_phase6_deferred_items.md` |

---

## Validation Architecture

Per memory `reference_supabase_project.md` — every NEW RLS surface gets a cross-tenant impersonation proof. Phase 10 RLS surfaces:

| Surface | Type | pgTAP test | Plan |
|---------|------|------------|------|
| `rank_org_patients(p_org_id)` RPC | SECURITY DEFINER function | Operator A in Org 1 calls `rank_org_patients(org_2_id)` → RAISES `access_denied` | Plan 10-02 |
| `log_clinic_view(p_org_id, p_target_user_id, p_section_name)` RPC | SECURITY DEFINER function | Operator A in Org 1 logs view for patient in Org 2 → RAISES `patient_not_in_org`; non-member calls → RAISES `access_denied` | Plan 10-04 |
| `broadcast_patient_signal_change` trigger | SECURITY DEFINER trigger | Patient A inserts injection → only orgs with active membership + consent_scope.injections=true receive the broadcast (test via `realtime.send` mock or by subscribing as Operator B in unaffected org and asserting no message) | Plan 10-03 |
| `clinic-snapshot` Edge Function path | HTTP endpoint | Deno test asserts: missing JWT → 401; non-member → 403; revoked membership → 403; insufficient permission → 403; consent_scope excludes section → that section absent in response; Cache-Control on every status code | Plan 10-04 |
| `patient-activity` Edge Function path | HTTP endpoint | Deno test asserts: patient B's JWT querying patient A's audit rows → only patient B's own rows returned (RLS) | Plan 10-09 |
| `bulk-csv-export` Edge Function path | HTTP endpoint | Deno test asserts: operator JWT only sees included-patients with active memberships AND `consent_scope.symptoms = true`; per-patient audit rows written | Plan 10-08 |
| `log_bulk_export_inclusion` RPC | SECURITY DEFINER function | pgTAP: cross-tenant call denied; happy-path call writes audit row | Plan 10-08 |

Plus 1 Playwright e2e per memory `reference_supabase_project.md`:

| Scenario | Spec | Plan |
|----------|------|------|
| 50-patient roster perf < 2s | `leanshot/e2e/roster-perf.spec.ts` | Plan 10-10 |
| Coach drill-in + section absence for Viewer | `leanshot/e2e/clinic-drill-in.spec.ts` | Plan 10-10 |
| Audit tab filter + per-patient mirror modal end-to-end | `leanshot/e2e/clinic-audit.spec.ts` | Plan 10-10 |
| Bulk PDF export of 3 patients | `leanshot/e2e/clinic-bulk-pdf.spec.ts` | Plan 10-10 |

---

## Code Examples (planner reference)

(All five reusable code snippets above are the canonical references. Planner copies the SQL skeleton for the RPC plan, the Edge Function skeleton for the snapshot plan, the trigger SQL for the realtime plan, the dynamic-import pattern for the bulk-export plan, and the Edge Function skeleton for patient-activity into the matching plan's `<action>` block — replacing pseudocode with concrete identifiers.)

---

## Open Questions / Confidence Levels

| Item | Confidence | Note |
|------|-----------|------|
| `realtime.broadcast` SQL function exists in Supabase 2.x | HIGH | Phase 9 D-10 already uses it for memberships UPDATE broadcast |
| `has_permission` helper signature | HIGH | Phase 9 D-07 locked: `has_permission(p_user_id uuid, p_org_id uuid, p_permission_key text) RETURNS bool` |
| jsPDF browser support for Inter / JetBrains Mono fonts | MEDIUM | Phase 7's doctor-report PDF uses jsPDF with default Helvetica fallback; bulk PDF will too. Custom font embedding is deferred (v2). [ASSUMED — plan must include a Vitest snapshot of generated PDF byte-prefix] |
| `audit_logs.org_id` column exists | HIGH | Phase 9 added it (D-08 carry-forward) |
| `audit_logs.target_user_id` column exists | HIGH | Phase 8 D-04 added it for share audit; Phase 9 carries forward |
| Vercel preview deploy URL pattern for CI roster-perf job | MEDIUM | Existing Phase 8 `share-security-drill` job uses `${{ vars.VERCEL_PREVIEW_URL }}` env var; Plan 10-11 mirrors. [CITED: ci.yml] |
| 50-patient seed via Supabase admin client speed | MEDIUM | Phase 8 e2e fixture seeds 5 shares in ~3s; 50 patients × 30 days of data ≈ ~30s; acceptable for the path-scoped CI job. [ASSUMED — plan-checker BL-1 may require benchmark] |

---

## Plan Outline (proposed wave structure for the planner)

**Wave 1 — Schema + permission seed (no code dependencies):**
- Plan 10-01: `roster.read_breakdown` permission seed + `audit_logs_action_check` enum extension migration

**Wave 2 — Backend primitives (parallel-safe; all depend on Wave 1):**
- Plan 10-02: `rank_org_patients` RPC + audit row writer + pgTAP cross-tenant impersonation tests
- Plan 10-03: Realtime broadcast triggers on injections/weights/symptoms + pgTAP consent_scope filter test
- Plan 10-04: `clinic-snapshot` Edge Function + `log_clinic_view` RPC + Deno tests + pgTAP cross-tenant test for log_clinic_view

**Wave 3 — Frontend extraction + drill-in (depends on Wave 2):**
- Plan 10-05: SharePage refactor → ReadOnlyPatientView extraction; defines canonical `SnapshotData` / `ReadOnlyPermissionMap` interfaces in `src/types/snapshot.ts`; updates SharePage tests; this is the ONLY plan that writes to App.tsx (adds drill-in route)
- Plan 10-06: Roster page (RosterTable + RosterRow + RosterMobileCard + ScoreChip + ScoreBreakdownPopover + RosterPagination) consuming `rank_org_patients` RPC + Realtime broadcast handler; row-flash + threshold-cross toast
- Plan 10-07: ClinicDrillInPage + ClinicDrillInSubBar consuming clinic-snapshot Edge Function + ReadOnlyPatientView with `viewerMode='clinic'` + per-section log_clinic_view fire on mount

**Wave 4 — Audit surfaces (parallel-safe; depend on Wave 3 for component primitives but only Wave 1+2 for data):**
- Plan 10-08: AuditTab + AuditFilterBar + AuditRow + AuditCustomRangeModal in ClinicSettingsPage NAV; reads from `audit_logs` directly via supabase-js (no new Edge Function — RLS does the work); 13-month dismissible notice
- Plan 10-09: PatientActivityModal + PatientActivityRow filling Phase 9 D-15 stub; `patient-activity` Edge Function + Deno test (RLS cross-tenant proof)

**Wave 5 — Bulk affordances + verification (depends on Waves 3+4):**
- Plan 10-10: RosterBulkSelectionBar + BulkExportPDFFlow (jsPDF dynamic-import) + BulkExportCSVFlow + BulkOpenInTabsFlow; `bulk-csv-export` Edge Function + Deno test; `log_bulk_export_inclusion` RPC + pgTAP
- Plan 10-11: 4 Playwright e2e specs (clinic-drill-in, clinic-audit, clinic-bulk-pdf, roster-perf) + path-scoped `roster-perf` CI job in ci.yml; PHI-safety grep + bundle-size verification + 10-EVENTS.md PostHog event audit

This ordering minimizes parallel-executor git index contention by clustering App.tsx writes into Plan 10-05 only and clustering ci.yml writes into Plan 10-11 only.

---

*Phase: 10-clinic-operator-surface*
*Research completed: 2026-05-13*
