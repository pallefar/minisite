/**
 * Phase 10 Plan 10-05 — ClinicDrillInPage STUB
 *
 * This file is a stub. Plan 10-07 overwrites this file with the real
 * drill-in implementation (ClinicContextBar + ClinicDrillInSubBar +
 * ReadOnlyPatientView with viewerMode='clinic' + permissionMap + onSectionMount
 * integration with log_clinic_view RPC from Plan 10-04).
 *
 * The route `/clinic/{slug}/patient/{user_id}` is registered in App.tsx
 * (Plan 10-05) and routes to this lazy chunk. Plan 10-07 fills it.
 */

export function ClinicDrillInPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--color-bg)] p-4">
      <p className="text-[13px] text-[var(--color-text-secondary)]">
        Loading patient data…
      </p>
    </div>
  );
}

export default ClinicDrillInPage;
