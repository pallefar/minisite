/**
 * Phase 66 Plan 66-06 (AUTH-17) — UserDetailPage placeholder hosting <MfaStatusBadge>.
 *
 * Status: STANDALONE scaffold. No `/admin/users/<id>` route currently exists
 * in the project (verified during Phase 66-06 execution — only AdminMembersPage
 * is shipped as the bulk list). This file ships the integration shape
 * (`useMfaStatusForUser` data hook + `<UserDetailPage>` component composing
 * the badge next to a user's name) so that whichever future phase ships a
 * proper user-detail surface can drop this in verbatim.
 *
 * Tracked for wiring in Phase 70 (see Phase 66-06 SUMMARY.md).
 *
 * Data sources used here:
 *   - supabase.auth.admin.getUserById(userId) — returns User with
 *     `factors?: Factor[]` (zero or more); count of factors is the
 *     user's enrolled MFA-factor count. Requires service-role JWT; in the
 *     browser this is exposed via the existing admin Edge Function
 *     surface or `supabase.auth.admin` if service-role is wired. For
 *     a future wiring, replace this with the project's chosen admin user
 *     fetcher.
 *   - listRoleMfaRequirements() — Phase 66-06 lib; reads
 *     public.mfa_role_requirements (RLS: authenticated read).
 */
import { useEffect, useState } from 'react';
import { Card } from '@/components/ui/Card';
import { MfaStatusBadge } from './MfaStatusBadge';
import { listRoleMfaRequirements } from '@/lib/admin/role-mfa-config';

export interface UserDetailPageProps {
  /** auth.users.id of the target user. */
  userId: string;
  /** Display name (or email) shown next to the badge. */
  displayName: string;
  /** App role for the target user (e.g. 'admin', 'user'). */
  userRole: string;
  /** Enrolled MFA factor count for the target user. Supplied by caller's data layer. */
  userMfaFactors: number;
}

/**
 * Read-only user detail page placeholder. Composes the MFA badge next to the
 * user's name + shows a small "role requires MFA" hint when applicable.
 *
 * Future phases should extend this with the rest of the user-detail surface
 * (sessions, audit history, role editor, etc.) and replace the props-driven
 * MFA factor count with a live fetch.
 */
export function UserDetailPage({
  userId,
  displayName,
  userRole,
  userMfaFactors,
}: UserDetailPageProps) {
  const [roleRequirements, setRoleRequirements] = useState<Map<string, boolean> | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const rows = await listRoleMfaRequirements();
        if (cancelled) return;
        setRoleRequirements(new Map(rows.map((r) => [r.role, r.required])));
      } catch (e) {
        if (!cancelled) {
          setError(
            e instanceof Error ? e.message : 'Failed to load role requirements',
          );
          setRoleRequirements(new Map());
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main
      className="min-h-screen bg-[var(--color-bg)] text-[var(--color-text)] p-6"
      aria-labelledby="user-detail-page-heading"
      data-user-id={userId}
    >
      <header className="mb-6 flex items-center gap-3 flex-wrap">
        <h1
          id="user-detail-page-heading"
          className="text-[18px] font-semibold tracking-tight"
        >
          {displayName}
        </h1>
        {roleRequirements && (
          <MfaStatusBadge
            userMfaFactors={userMfaFactors}
            userRole={userRole}
            roleRequirements={roleRequirements}
          />
        )}
      </header>

      <Card variant="flat" padding="md">
        <dl className="grid grid-cols-1 gap-3 text-[13px]">
          <div className="flex justify-between gap-4">
            <dt className="text-[var(--color-text-tertiary)]">Role</dt>
            <dd className="font-semibold">{userRole}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-[var(--color-text-tertiary)]">Enrolled MFA factors</dt>
            <dd className="font-semibold">{userMfaFactors}</dd>
          </div>
        </dl>
      </Card>

      {error && (
        <p
          role="alert"
          className="mt-4 text-[11px] text-[var(--color-warning)]"
        >
          {error}
        </p>
      )}
    </main>
  );
}

export default UserDetailPage;
