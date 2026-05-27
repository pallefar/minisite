/**
 * Phase 66 Plan 66-06 (AUTH-17) — Per-user MFA status badge.
 *
 * Three states:
 *   - 'on'                     userMfaFactors > 0
 *                              → green   "MFA on"        (tone: success)
 *   - 'required-not-enrolled'  roleRequirements.get(userRole) === true
 *                              && userMfaFactors === 0
 *                              → amber   "MFA required"  (tone: warning)
 *   - 'off'                    neither of the above
 *                              → grey    "MFA off"       (tone: neutral)
 *
 * Reuses the existing <Badge> primitive (src/components/ui/Badge.tsx) which
 * already maps tones to the verified @theme tokens
 * (--color-success-soft/--color-success, --color-warning-soft/--color-warning,
 *  --color-surface-elevated/--color-text-secondary for neutral). This avoids
 * the Phase 60 "undefined-token-renders-invisible" trap — all tokens used
 * here go through Badge's lookup table.
 *
 * Pure presentational component: caller supplies userMfaFactors + userRole +
 * the role-requirements map (fetched once and cached by the parent page).
 */
import { Badge } from '@/components/ui/Badge';

export type MfaStatusState = 'on' | 'required-not-enrolled' | 'off';

export interface MfaStatusBadgeProps {
  /** Number of enrolled MFA factors on the user (typically `factors.length` from supabase.auth.admin.getUser). */
  userMfaFactors: number;
  /** The user's app role (e.g. 'admin', 'staff', 'user'). */
  userRole: string;
  /**
   * Role → required-MFA mapping fetched once via listRoleMfaRequirements().
   * Use `new Map(rows.map(r => [r.role, r.required]))` to construct.
   */
  roleRequirements: Map<string, boolean>;
}

export function resolveMfaStatus(
  userMfaFactors: number,
  userRole: string,
  roleRequirements: Map<string, boolean>,
): MfaStatusState {
  if (userMfaFactors > 0) return 'on';
  if (roleRequirements.get(userRole) === true) return 'required-not-enrolled';
  return 'off';
}

export function MfaStatusBadge({
  userMfaFactors,
  userRole,
  roleRequirements,
}: MfaStatusBadgeProps) {
  const state = resolveMfaStatus(userMfaFactors, userRole, roleRequirements);

  if (state === 'on') {
    return (
      <Badge tone="success" aria-label="MFA on" data-testid="mfa-status-badge" data-state="on">
        MFA on
      </Badge>
    );
  }
  if (state === 'required-not-enrolled') {
    return (
      <Badge
        tone="warning"
        aria-label="MFA required but not enrolled"
        data-testid="mfa-status-badge"
        data-state="required-not-enrolled"
      >
        MFA required
      </Badge>
    );
  }
  return (
    <Badge tone="neutral" aria-label="MFA off" data-testid="mfa-status-badge" data-state="off">
      MFA off
    </Badge>
  );
}

export default MfaStatusBadge;
