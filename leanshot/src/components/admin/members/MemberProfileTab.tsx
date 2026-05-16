/**
 * Phase 22 Plan 22-06 — MemberProfileTab (read-only field list per UI-SPEC line 252).
 *
 * Surfaces the small read-only field set that admins need at a glance:
 *   user_id · signup_date · last_active · clinic · country · IP · browser.
 *
 * Schema source:
 *   - admin_list_members returns user_id, signup_date, last_active_at,
 *     clinic_name, country, stripe_status, tier, email — pass that row in.
 *   - IP / browser require an `admin_get_member_profile` RPC (deferred to
 *     v1.3 — see SUMMARY deferred items). Until that ships we render "—".
 */
import { Card } from '@/components/ui/Card';
import type { Member } from '@/lib/admin/admin-api';

interface FieldRow {
  label: string;
  value: string;
}

export interface MemberProfileTabProps {
  member: Member;
}

function fmt(value: string | null | undefined): string {
  if (!value) return '—';
  return value;
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

export function MemberProfileTab({ member }: MemberProfileTabProps) {
  const rows: FieldRow[] = [
    { label: 'User ID', value: member.user_id },
    { label: 'Email', value: member.email },
    { label: 'Signup date', value: fmtDate(member.signup_date) },
    { label: 'Last active', value: fmtDate(member.last_active_at) },
    { label: 'Clinic', value: fmt(member.clinic_name) },
    { label: 'Country', value: fmt(member.country) },
    { label: 'Tier', value: fmt(member.tier) },
    { label: 'Stripe status', value: fmt(member.stripe_status) },
    // Deferred (v1.3 admin_get_member_profile RPC):
    { label: 'Last IP', value: '—' },
    { label: 'Last browser', value: '—' },
  ];

  return (
    <Card variant="default" padding="lg" data-testid="member-profile-tab">
      <dl className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-3">
        {rows.map((r) => (
          <div key={r.label} className="flex flex-col">
            <dt className="text-xs font-semibold uppercase tracking-[0.06em] text-[var(--color-text-secondary)]">
              {r.label}
            </dt>
            <dd className="text-sm font-mono break-all text-[var(--color-text)]">
              {r.value}
            </dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}
