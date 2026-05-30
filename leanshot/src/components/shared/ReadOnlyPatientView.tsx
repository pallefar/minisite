/**
 * Phase 10 Plan 10-05 — ReadOnlyPatientView
 *
 * Single body-section composition component shared by:
 *   - Phase 8 SharePage (viewerMode='share') — renders all sections, no permissionMap
 *   - Phase 10 ClinicDrillInPage (viewerMode='clinic') — applies permissionMap per D-12
 *
 * D-12 (LOCKED, hide sections entirely): Permission-gated sections are ABSENT (not rendered)
 * when the operator lacks the relevant permission. No placeholder, no "no access" message.
 * Mirrors Phase 7-8-9 Settings NAV gating.
 *
 * D-21 (per-section audit granularity): Each section component calls onSectionMount ONCE
 * on first mount per drill-in instance via useRef guard inside the section component.
 * onSectionMount is the integration point for Plan 10-07's log_clinic_view RPC fire.
 *
 * T-10-05-02 mitigation: onSectionMount only fires for visible sections — sections are
 * UNMOUNTED entirely when permissionMap gates them out, so their useEffect never runs.
 *
 * Loaded in the NEW 'read-only-patient-view' shared lazy chunk (see vite.config.ts).
 * Both 'share' and 'clinic' lazy chunks depend on this chunk.
 *
 * Policy: no Zustand store reads, no supabase imports (INVARIANT from Phase 8 SharePage).
 */

import type { ReadOnlyPermissionMap, SnapshotData } from '@/types/snapshot';
import { ChartSection } from './sections/ChartSection';
import { DoctorReportSection } from './sections/DoctorReportSection';
import { InjectionsSection } from './sections/InjectionsSection';
import { PhotosSection } from './sections/PhotosSection';
import { SymptomsSection } from './sections/SymptomsSection';
import { WeightsSection } from './sections/WeightsSection';

export interface ReadOnlyPatientViewProps {
  snapshot: SnapshotData;
  viewerMode: 'share' | 'clinic';
  /**
   * Present when viewerMode='clinic'. Computed by clinic-snapshot Edge Function
   * (Plan 10-04) from the operator's role_permissions rows.
   * When absent (share mode), every section is visible — same as all-true map.
   */
  permissionMap?: ReadOnlyPermissionMap;
  /**
   * Integration point for Plan 10-07's log_clinic_view RPC fire.
   * Each visible section calls this ONCE on first mount with its section name.
   * Only fires for sections that are RENDERED (D-21 + T-10-05-02 guarantee).
   */
  onSectionMount?: (sectionName: string) => void;
}

/**
 * Determine whether a section should be visible given the viewerMode and permissionMap.
 *
 * Share mode → always visible (share recipient gets everything in the snapshot).
 * Clinic mode + no permissionMap → visible (fallback: own-everything assumption).
 * Clinic mode + permissionMap → check the relevant flag per D-12.
 *
 * Chart depends on injections data (it renders the PK curve from injection history).
 */
function isVisible(
  sectionKey: 'chart' | 'injections' | 'weights' | 'symptoms' | 'photos' | 'doctor_report',
  viewerMode: 'share' | 'clinic',
  permissionMap?: ReadOnlyPermissionMap,
): boolean {
  if (viewerMode === 'share') return true;
  if (!permissionMap) return true;
  switch (sectionKey) {
    case 'chart':
      // Chart derives from injections — same gate as injections per D-03 plan spec.
      return permissionMap.canViewInjections;
    case 'injections':
      return permissionMap.canViewInjections;
    case 'weights':
      return permissionMap.canViewWeights;
    case 'symptoms':
      return permissionMap.canViewSymptoms;
    case 'photos':
      return permissionMap.canViewPhotos;
    case 'doctor_report':
      return permissionMap.canViewDoctorReport;
    default:
      return true;
  }
}

export function ReadOnlyPatientView({
  snapshot,
  viewerMode,
  permissionMap,
  onSectionMount,
}: ReadOnlyPatientViewProps) {
  return (
    <div className="space-y-8">
      {isVisible('chart', viewerMode, permissionMap) && (
        <ChartSection
          data={snapshot.injections}
          medication={snapshot.medication}
          viewerMode={viewerMode}
          onMount={onSectionMount}
        />
      )}
      {isVisible('injections', viewerMode, permissionMap) && (
        <InjectionsSection
          data={snapshot.injections}
          viewerMode={viewerMode}
          onMount={onSectionMount}
        />
      )}
      {isVisible('weights', viewerMode, permissionMap) && (
        <WeightsSection data={snapshot.weights} viewerMode={viewerMode} onMount={onSectionMount} />
      )}
      {isVisible('symptoms', viewerMode, permissionMap) && (
        <SymptomsSection
          data={snapshot.symptoms}
          viewerMode={viewerMode}
          onMount={onSectionMount}
        />
      )}
      {isVisible('photos', viewerMode, permissionMap) && (
        <PhotosSection
          data={snapshot.photos}
          viewerMode={viewerMode}
          orgId={snapshot.org_id}
          onMount={onSectionMount}
        />
      )}
      {isVisible('doctor_report', viewerMode, permissionMap) && (
        <DoctorReportSection
          data={snapshot.doctor_report}
          viewerMode={viewerMode}
          onMount={onSectionMount}
        />
      )}
    </div>
  );
}

export default ReadOnlyPatientView;
