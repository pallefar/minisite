/**
 * Phase 22 Plan 22-07 — /admin/affiliates page (ADMIN-06).
 *
 * Thin wrapper that mounts the AdminAffiliatesReviewQueue inside the shared
 * AdminLayout. The queue itself owns the is_staff probe + RPC writes; this
 * page exists so that App.tsx (plan 22-12) can React.lazy() a single
 * default-exported route component, mirroring how /admin/members and
 * /admin/metrics already wire up.
 *
 * NOTE: The Phase 19 AdminAffiliatesScaffold (read-only applications list at
 * /admin/affiliates) is intentionally NOT removed by this plan. Plan 22-12
 * will decide whether the review queue replaces or supplements that route.
 * For now this page is the canonical mount point for the conversion review
 * surface defined in UI-SPEC §/admin/affiliates lines 268-274.
 */
import { AdminLayout } from '@/components/admin/AdminLayout';
import { AdminAffiliatesReviewQueue } from '@/components/admin/AdminAffiliatesReviewQueue';

export function AdminAffiliatesPage() {
  return (
    <AdminLayout active="affiliates" heading="Affiliate conversions">
      <AdminAffiliatesReviewQueue />
    </AdminLayout>
  );
}

export default AdminAffiliatesPage;
