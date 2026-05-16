/**
 * Phase 22 Plan 22-09 — useImpersonationReadOnly hook (ADMIN-03).
 *
 * Returns disabled-props that should be spread onto every interactive element
 * in the app when impersonation is active. This is the CLIENT-side UX gate:
 *
 *   <Button {...useImpersonationReadOnly().props} onClick={save}>Save</Button>
 *   <Input {...useImpersonationReadOnly().props} value={x} onChange={...} />
 *
 * The actual SECURITY boundary is the server-side RLS write-deny policies
 * shipped by migration 20270601000012_impersonation_write_deny_policies.sql
 * (51 policies × INSERT/UPDATE/DELETE on the 17 user-writable tables). This
 * hook just preempts the round-trip with a clear "why didn't this save"
 * affordance — even if it's bypassed, RLS will reject the mutation.
 *
 * Spread these props on writable surfaces best-effort (the AppShell sweep is
 * plan 22-12). RLS is the actual gate; the hook is defense-in-depth UX.
 */

import { useImpersonation } from '@/components/impersonation/useImpersonation';

export interface ImpersonationReadOnlyProps {
  disabled?: boolean;
  'aria-disabled'?: boolean;
  title?: string;
}

export interface UseImpersonationReadOnlyResult {
  disabled: boolean;
  props: ImpersonationReadOnlyProps;
}

export function useImpersonationReadOnly(): UseImpersonationReadOnlyResult {
  const { active } = useImpersonation();
  if (!active) {
    return { disabled: false, props: {} };
  }
  return {
    disabled: true,
    props: {
      disabled: true,
      'aria-disabled': true,
      title: 'Read-only during impersonation',
    },
  };
}
