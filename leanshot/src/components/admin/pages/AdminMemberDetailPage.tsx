/**
 * Phase 22 Plan 22-06 — /admin/members/{id} drill-in (ADMIN-01 + ADMIN-05).
 *
 * Header (avatar + name/email + tier + Stripe badge + action cluster) +
 * 6-tab Pill segmented control. Active tab persisted in `?tab=` URL query.
 *
 * Tabs:
 *   Profile · Billing · Activity · Stripe · Flags · Audit
 *
 * Member metadata is loaded via admin_list_members RPC with `p_search`
 * filtering on the email — the RPC already returns the 8-field shape we
 * need for the header. (A dedicated `admin_get_member_profile(id)` RPC
 * is deferred to v1.3; for v1.2 we hydrate from the list RPC + a small
 * id-based fallback if email match fails.)
 *
 * Route wiring into App.tsx is plan 22-12.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AdminLayout } from '@/components/admin/AdminLayout';
import { MemberActivityTab } from '@/components/admin/members/MemberActivityTab';
import { MemberAuditTab } from '@/components/admin/members/MemberAuditTab';
import { MemberBillingTab } from '@/components/admin/members/MemberBillingTab';
import { MemberFlagsTab } from '@/components/admin/members/MemberFlagsTab';
import { MemberProfileTab } from '@/components/admin/members/MemberProfileTab';
import { MemberStripeTab } from '@/components/admin/members/MemberStripeTab';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { InitialsAvatar } from '@/components/ui/InitialsAvatar';
import { Pill, PillGroup } from '@/components/ui/Pill';
import type { Member } from '@/lib/admin/admin-api';
import { supabase } from '@/lib/supabase';

type TabKey = 'profile' | 'billing' | 'activity' | 'stripe' | 'flags' | 'audit';

const TABS: { key: TabKey; label: string }[] = [
  { key: 'profile', label: 'Profile' },
  { key: 'billing', label: 'Billing' },
  { key: 'activity', label: 'Activity' },
  { key: 'stripe', label: 'Stripe' },
  { key: 'flags', label: 'Flags' },
  { key: 'audit', label: 'Audit' },
];

function readActiveTabFromUrl(): TabKey {
  if (typeof window === 'undefined') return 'profile';
  const params = new URLSearchParams(window.location.search);
  const t = params.get('tab') as TabKey | null;
  if (t && TABS.some((x) => x.key === t)) return t;
  return 'profile';
}

function writeActiveTabToUrl(tab: TabKey): void {
  if (typeof window === 'undefined') return;
  const params = new URLSearchParams(window.location.search);
  if (tab === 'profile') {
    params.delete('tab');
  } else {
    params.set('tab', tab);
  }
  const next = params.toString();
  const url = `${window.location.pathname}${next ? '?' + next : ''}`;
  window.history.replaceState({}, '', url);
}

function tierBadgeTone(tier: string): 'success' | 'info' | 'warning' | 'neutral' {
  switch (tier) {
    case 'paid':
      return 'success';
    case 'clinic_seat':
      return 'info';
    case 'past_due':
      return 'warning';
    default:
      return 'neutral';
  }
}

interface DetailContentProps {
  userId: string;
}

function MemberDetailContent({ userId }: DetailContentProps) {
  const [member, setMember] = useState<Member | null | undefined>(undefined);
  const [activeTab, setActiveTab] = useState<TabKey>(() => readActiveTabFromUrl());

  useEffect(() => {
    writeActiveTabToUrl(activeTab);
  }, [activeTab]);

  const loadMember = useCallback(async () => {
    // v1.2 hydration: pull from admin_list_members with high p_size and find
    // by user_id. v1.3 dedicated admin_get_member_profile RPC will replace.
    try {
      const { data, error } = await supabase.rpc('admin_list_members', {
        p_search: null,
        p_tier: null,
        p_page: 1,
        p_size: 200,
      });
      if (error) {
        console.error('[admin-member-detail] rpc failed', error.message);
        setMember(null);
        return;
      }
      const all = (Array.isArray(data) ? data : []) as Member[];
      const m = all.find((row) => row.user_id === userId) ?? null;
      setMember(m);
    } catch (e) {
      console.error('[admin-member-detail] threw', e);
      setMember(null);
    }
  }, [userId]);

  useEffect(() => {
    void loadMember();
  }, [loadMember]);

  // Arrow-key navigation across the tab Pill group.
  const handleTabKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const idx = TABS.findIndex((t) => t.key === activeTab);
    if (idx < 0) return;
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      const next = TABS[(idx + 1) % TABS.length]!;
      setActiveTab(next.key);
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      const next = TABS[(idx - 1 + TABS.length) % TABS.length]!;
      setActiveTab(next.key);
    }
  };

  const tabContent = useMemo(() => {
    if (!member) return null;
    switch (activeTab) {
      case 'profile':
        return <MemberProfileTab member={member} />;
      case 'billing':
        return <MemberBillingTab userId={member.user_id} />;
      case 'activity':
        return <MemberActivityTab userId={member.user_id} />;
      case 'stripe':
        return <MemberStripeTab userId={member.user_id} />;
      case 'flags':
        return <MemberFlagsTab userId={member.user_id} />;
      case 'audit':
        return <MemberAuditTab userId={member.user_id} />;
      default:
        return null;
    }
  }, [activeTab, member]);

  if (member === undefined) {
    return (
      <Card variant="flat" padding="lg">
        <p className="text-sm text-[var(--color-text-secondary)]">Loading member…</p>
      </Card>
    );
  }
  if (member === null) {
    return (
      <Card variant="flat" padding="lg">
        <h2 className="text-base font-semibold mb-1">Member not found</h2>
        <p className="text-sm text-[var(--color-text-secondary)]">
          No matching user_id in the admin list. The user may have been deleted.
        </p>
      </Card>
    );
  }

  const tierTone = tierBadgeTone(member.tier);

  return (
    <>
      {/* Header */}
      <Card variant="default" padding="lg" className="mb-4" data-testid="member-detail-header">
        <div className="flex flex-wrap items-center gap-4">
          <InitialsAvatar size="md" rounded="full" name={member.email} />
          <div className="flex-1 min-w-0">
            <div className="text-xl font-semibold truncate">{member.email}</div>
            <div className="text-xs text-[var(--color-text-secondary)] font-mono truncate">
              {member.user_id}
            </div>
            <div className="flex items-center gap-2 mt-2">
              <Badge tone={tierTone}>{member.tier}</Badge>
              <Badge tone="neutral">{member.stripe_status}</Badge>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="secondary" size="sm">
              Impersonate
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled
              title="Cancel flow lands in plan 22-07"
              aria-label="Cancel subscription"
            >
              Cancel
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled
              title="Refund flow lands in plan 22-07"
              aria-label="Refund last charge"
            >
              Refund
            </Button>
          </div>
        </div>
      </Card>

      {/* Tab bar — outer div forwards arrow-key navigation from focused pills */}
      {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions -- presentational keyboard router; the PillGroup inside owns the tablist role */}
      <div onKeyDown={handleTabKeyDown} className="mb-4">
        <PillGroup segmented aria-label="Member detail tabs">
          {TABS.map((t) => (
            <Pill
              key={t.key}
              size="sm"
              active={activeTab === t.key}
              onClick={() => setActiveTab(t.key)}
              role="tab"
              aria-selected={activeTab === t.key}
              data-tab-key={t.key}
            >
              {t.label}
            </Pill>
          ))}
        </PillGroup>
      </div>

      <div role="tabpanel" aria-label={`${activeTab} tab`}>
        {tabContent}
      </div>
    </>
  );
}

export interface AdminMemberDetailPageProps {
  /** Defaults to extracting the trailing /admin/members/{id} segment. */
  userId?: string;
}

function extractUserIdFromPath(): string {
  if (typeof window === 'undefined') return '';
  const match = window.location.pathname.match(/\/admin\/members\/([^/?#]+)/);
  return match?.[1] ?? '';
}

export function AdminMemberDetailPage({ userId }: AdminMemberDetailPageProps = {}) {
  const id = userId ?? extractUserIdFromPath();
  return (
    <AdminLayout active="members" heading="Member detail">
      {id ? (
        <MemberDetailContent userId={id} />
      ) : (
        <Card variant="flat" padding="lg">
          <p className="text-sm text-[var(--color-text-secondary)]">
            No member id supplied.
          </p>
        </Card>
      )}
    </AdminLayout>
  );
}

export default AdminMemberDetailPage;
