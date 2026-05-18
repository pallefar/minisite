/**
 * Phase 27 plan 27-05 — AnomalyConfigPage.
 *
 * Combined /admin/anomaly route page. Two sections:
 *   1. Firing alerts queue — AdminAnomalyAcknowledgeQueue (shipped by 27-04).
 *   2. Tracked funnels config — AdminAnomalyTrackedFunnelsConfig (this plan).
 *
 * Superadmin gate at page top:
 *   - Probes profiles.admin_role for the current user.
 *   - Non-superadmin sees NotAuthorizedCard (same as AdminShell's gate).
 *   - The CRUD RPCs are server-side gated regardless (Pattern S1 dual-layer)
 *     — this client gate is UX-only.
 *
 * Routing:
 *   - Default export so an ADMIN_MODULES entry can `lazy: () => import(...)`.
 *   - The ADMIN_MODULES entry itself is NOT added by this plan (anti-pattern
 *     guard: no shared-file choreography). Documented as a 1-line follow-up
 *     addendum in the SUMMARY: add an `{ key:'anomaly', label:'Anomaly',
 *     route:'anomaly', minRole:'superadmin', lazy:() => import(this file),
 *     flagKey:'admin.anomaly.enabled' }` entry to leanshot/src/lib/admin/modules.ts.
 *   - Until then, AdminAnomalyBanner's "View queue" button hash-routes to
 *     /#/admin/anomaly which is handled by AdminLayout's existing fallback;
 *     direct-mount via lazy() still works when the module entry lands.
 */
import { useEffect, useState } from 'react';
import { NotAuthorizedCard } from '@/components/admin/AdminShell';
import { Card } from '@/components/ui/Card';
import type { AdminRole } from '@/lib/admin/roles';
import { supabase } from '@/lib/supabase';
import { AdminAnomalyAcknowledgeQueue } from './AdminAnomalyAcknowledgeQueue';
import { AdminAnomalyTrackedFunnelsConfig } from './AdminAnomalyTrackedFunnelsConfig';

interface ProfileRow {
  is_staff?: boolean | null;
  admin_role?: AdminRole | null;
}

export function AnomalyConfigPage() {
  const [isSuperadmin, setIsSuperadmin] = useState<boolean | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: userData } = await supabase.auth.getUser();
      const uid = userData?.user?.id;
      if (!uid) {
        if (!cancelled) setIsSuperadmin(false);
        return;
      }
      const { data: profile } = await supabase
        .from('profiles')
        .select('is_staff, admin_role')
        .eq('id', uid)
        .maybeSingle();
      const p = profile as ProfileRow | null;
      if (cancelled) return;
      setIsSuperadmin(p?.admin_role === 'superadmin');
    })().catch(() => {
      if (!cancelled) setIsSuperadmin(false);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (isSuperadmin === undefined) return null;
  if (!isSuperadmin) return <NotAuthorizedCard />;

  return (
    <main
      className="min-h-screen bg-[var(--color-bg)] text-[var(--color-text)] p-6"
      aria-labelledby="anomaly-config-page-heading"
    >
      <header className="mb-6">
        <h1
          id="anomaly-config-page-heading"
          className="text-xl font-semibold tracking-tight"
        >
          Funnel anomaly admin
        </h1>
        <p className="text-xs text-[var(--color-text-secondary)] mt-1">
          Acknowledge firing alerts + manage which funnels the */5 cron polls.
        </p>
      </header>

      {/* Section 1 — Acknowledge queue (Plan 27-04). */}
      <section aria-labelledby="anomaly-firing-alerts-heading" className="mb-8">
        <Card variant="flat" padding="none">
          <h2 id="anomaly-firing-alerts-heading" className="sr-only">
            Firing alerts
          </h2>
          {/* The queue component owns its own header + table. */}
          <AdminAnomalyAcknowledgeQueue />
        </Card>
      </section>

      {/* Section 2 — Tracked funnels config (this plan). */}
      <AdminAnomalyTrackedFunnelsConfig />
    </main>
  );
}

export default AnomalyConfigPage;
