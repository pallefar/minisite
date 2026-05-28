/**
 * Phase 28 Plan 28-07 — clinic-orgs ADMIN_MODULES preview module.
 *
 * Preview pane: org count + member count rollup via browser anon-client
 * (RLS-gated; shows ONLY orgs/members the admin is a member of).
 *
 * Full Members & Invites UI ships in Phase 31.
 *
 * Queries:
 *   - supabase.from('organizations').select('id', { count: 'exact', head: true })
 *   - supabase.from('org_members').select('id', { count: 'exact', head: true })
 *
 * Surface token: `var(--color-surface-elevated)` — matches AdminShell and
 * other admin card components (SettingsModule, AuditLogModule patterns).
 * `bg-surface` is not a project Tailwind token; use the CSS custom property form.
 */
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';

export default function ClinicOrgsPreview() {
  const [orgCount, setOrgCount] = useState<number | null>(null);
  const [memberCount, setMemberCount] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [orgRes, memberRes] = await Promise.all([
          supabase.from('organizations').select('id', { count: 'exact', head: true }),
          supabase.from('org_members').select('id', { count: 'exact', head: true }),
        ]);
        if (cancelled) return;
        if (orgRes.error) {
          setError(orgRes.error.message);
          return;
        }
        if (memberRes.error) {
          setError(memberRes.error.message);
          return;
        }
        setOrgCount(orgRes.count ?? 0);
        setMemberCount(memberRes.count ?? 0);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Unknown error');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) {
    return (
      <p className="text-sm text-[var(--color-error,red)]" role="alert">
        Failed to load clinic org stats: {error}
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <h2 className="text-sm font-semibold text-[var(--color-text-secondary)] uppercase tracking-[0.08em]">
        Clinic Orgs — Preview
      </h2>
      <div className="grid grid-cols-2 gap-4">
        <div
          className="rounded-lg bg-[var(--color-surface-elevated)] border border-[var(--color-border)] p-4"
          aria-label="Organizations count"
        >
          <div className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--color-text-tertiary)]">
            Orgs
          </div>
          <div
            className="mt-1.5 text-3xl font-bold leading-tight"
            role="status"
            aria-live="polite"
            aria-label={`Organizations: ${orgCount ?? 'loading'}`}
          >
            {orgCount !== null ? orgCount : '—'}
          </div>
        </div>
        <div
          className="rounded-lg bg-[var(--color-surface-elevated)] border border-[var(--color-border)] p-4"
          aria-label="Members count"
        >
          <div className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--color-text-tertiary)]">
            Members
          </div>
          <div
            className="mt-1.5 text-3xl font-bold leading-tight"
            role="status"
            aria-live="polite"
            aria-label={`Members: ${memberCount ?? 'loading'}`}
          >
            {memberCount !== null ? memberCount : '—'}
          </div>
        </div>
      </div>
      <p className="text-xs text-[var(--color-text-secondary)]">
        Showing orgs and members visible to your admin account (RLS-gated). Full Members &amp;
        Invites UI ships in Phase 31.
      </p>
    </div>
  );
}
