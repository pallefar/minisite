/**
 * Phase 27 plan 27-04 — AdminGlobals wrapper (single mount point in AdminLayout).
 *
 * Coordinates the Wave-1 parallel-edit conflict with Plan 27-03 (which also
 * adds a global UI surface: AdminCommandPalette). Both plans need a JSX line
 * inside AdminLayout — without this wrapper, the parallel executors would
 * race on the same AdminLayout edit and conflict in merge.
 *
 * Strategy (CONTEXT D-17 + 27-PATTERNS coordination):
 *   - AdminLayout mounts <AdminGlobals adminRole={...} /> once.
 *   - AdminGlobals hosts BOTH AdminAnomalyBanner (this plan) AND
 *     AdminCommandPalette (Plan 27-03) inside a Suspense boundary.
 *   - AdminCommandPalette is imported via React.lazy with a defensive try/catch
 *     so AdminGlobals compiles + runs even if Plan 27-03 hasn't shipped yet.
 *     When 27-03 lands, the lazy import resolves the real palette component;
 *     no AdminGlobals.tsx code changes needed.
 *
 * Per [[feedback_parallel_executor_git_isolation]] + [[feedback_realtime_layer_e2e_pattern]].
 */
import { lazy, Suspense, type ComponentType } from 'react';
import AdminAnomalyBanner from '@/components/admin/anomaly/AdminAnomalyBanner';
import type { AdminRole } from '@/lib/admin/roles';

interface AdminCommandPaletteProps {
  adminRole: AdminRole | null;
}

/**
 * Defensive lazy import: when Plan 27-03 has not yet shipped
 * AdminCommandPalette.tsx, the dynamic import resolves to a null component
 * so AdminGlobals still renders without errors.
 *
 * When 27-03 lands at src/components/admin/AdminCommandPalette.tsx with a
 * default export of (props: { adminRole }) => JSX.Element, this lazy import
 * picks it up automatically with no edits here.
 */
const AdminCommandPalette = lazy<ComponentType<AdminCommandPaletteProps>>(async () => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mod = (await import('@/components/admin/palette/AdminCommandPalette')) as any;
    const C = mod.default ?? mod.AdminCommandPalette ?? null;
    if (!C) return { default: () => null };
    return { default: C as ComponentType<AdminCommandPaletteProps> };
  } catch {
    // 27-03 not yet shipped — render nothing.
    return { default: () => null };
  }
});

interface AdminGlobalsProps {
  adminRole: AdminRole | null;
}

export function AdminGlobals({ adminRole }: AdminGlobalsProps) {
  return (
    <>
      <Suspense fallback={null}>
        <AdminCommandPalette adminRole={adminRole} />
      </Suspense>
      <AdminAnomalyBanner />
    </>
  );
}

export default AdminGlobals;
