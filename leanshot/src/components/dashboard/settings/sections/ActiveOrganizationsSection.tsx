// Phase 9 Plan 09-01 Wave-0 stub. Plan 09-05 OVERWRITES this file with the
// real "Active organizations" section (per-membership row: org name + logo,
// role label, joined_at, current consent_scope, edit-scope modal, "Revoke
// membership" button writing memberships.revoked_at via revoke_membership
// RPC). Mirrors Phase 8's Active-shares pattern.

export function ActiveOrganizationsSection() {
  return (
    <div className="space-y-2">
      <h2 className="text-[15px] font-semibold">Active organizations</h2>
      <p className="text-[13px] text-[var(--color-text-secondary)]">
        Phase 9 stub — Plan 09-05 overwrites this file.
      </p>
    </div>
  );
}

export default ActiveOrganizationsSection;
