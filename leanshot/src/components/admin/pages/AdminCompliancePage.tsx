/**
 * Phase 25 Plan 25-09 — /admin/compliance page entry.
 * HIPAA-12 (BAA chain admin UI) + HIPAA-13 (expiry alerts surface).
 *
 * Thin wrapper following the AdminAffiliatesPage shape: mounts ComplianceModule
 * inside AdminLayout (Mode B — legacy children pattern). AdminLayout already
 * gates at minRole='superadmin' via the AdminShell manifest entry; this page
 * is the lazy chunk target for the 'compliance' module entry.
 */
import { AdminLayout } from '@/components/admin/AdminLayout';
import { ComplianceModule } from '@/components/admin/compliance/ComplianceModule';

export function AdminCompliancePage() {
  return (
    <AdminLayout active="compliance" heading="Compliance">
      <ComplianceModule />
    </AdminLayout>
  );
}

export default AdminCompliancePage;
