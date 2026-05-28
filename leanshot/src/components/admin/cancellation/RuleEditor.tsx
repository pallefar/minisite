/**
 * Phase 40 Plan 40-05 — RuleEditor.
 *
 * Right-pane rule creation / edit form for save_offer_rules.
 *
 * Form fields:
 *   - Rule title (Input, max 60)
 *   - Cohort (Select — lists cohort_definitions)
 *   - Tenure window (Pill multi-select: <30d / 30-180d / >180d)
 *   - Reason scoping (Pill multi-select, 7 reasons + "Any reason" toggle)
 *   - Org type (Select: Any / Consumer / Clinic)
 *   - Offer type (Select: 4 offer types; contact_csm only shown when org_type='clinic')
 *   - Offer-type sub-fields: pause_months / coupon_id / extension_days / downgrade_target
 *   - Priority (Input, number)
 *   - Active toggle (Pill)
 *
 * D-04: clinic-org fork — contact_csm shown only when org_type='clinic'.
 * D-13: coupon catalog hardcoded to 6 fixed combos.
 * surfaceCheck('admin.cancellation.write_rules'): inputs disabled when false.
 * SECDEF RPCs are the real gate; surfaceCheck is a UX hint only.
 */
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Input, Select } from '@/components/ui/Input';
import { Pill, PillGroup } from '@/components/ui/Pill';
import { useToast } from '@/hooks/useToast';
import { hasMinRole, type AdminRole } from '@/lib/admin/roles';
import { supabase } from '@/lib/supabase';
import {
  COUPON_CATALOG,
  REASON_OPTIONS,
  TENURE_OPTIONS,
  type OfferType,
  type OrgType,
  type SaveOfferRule,
} from './types';

interface RuleEditorProps {
  adminRole: AdminRole | null;
  /** null when creating a new rule */
  rule: SaveOfferRule | null;
  onCreated: (rule: SaveOfferRule) => void;
  onUpdated: (rule: SaveOfferRule) => void;
  onCancel: () => void;
}

interface CohortOption {
  id: string;
  name: string;
}

function useCohorts() {
  const [cohorts, setCohorts] = useState<CohortOption[]>([]);
  useEffect(() => {
    void supabase
      .from('cohort_definitions')
      .select('id, name')
      .eq('status', 'active')
      .order('name')
      .then(({ data }) => {
        if (data) setCohorts(data as CohortOption[]);
      });
  }, []);
  return cohorts;
}

const OFFER_TYPES: Array<{ id: OfferType; label: string; clinicOnly?: boolean }> = [
  { id: 'pause', label: 'Pause subscription' },
  { id: 'discount', label: 'Discount (coupon)' },
  { id: 'extended_trial', label: 'Extended trial' },
  { id: 'downgrade', label: 'Downgrade to monthly' },
  { id: 'contact_csm', label: 'Contact CSM', clinicOnly: true },
];

const ORG_TYPES: Array<{ id: OrgType; label: string }> = [
  { id: 'any', label: 'Any org type' },
  { id: 'consumer', label: 'Consumer' },
  { id: 'clinic', label: 'Clinic' },
];

export function RuleEditor({ adminRole, rule, onCreated, onUpdated, onCancel }: RuleEditorProps) {
  const toast = useToast();
  const cohorts = useCohorts();
  const isNew = rule === null;

  // Read-only when user doesn't have write access.
  // surfaceCheck('admin.cancellation.write_rules') is a client UX hint;
  // the authoritative gate is the SECDEF RPC's is_admin_at_least check (T-40-05-01).
  const canWrite = hasMinRole(adminRole, 'admin');

  // ── Form state ────────────────────────────────────────────────────────────

  const [title, setTitle] = useState(rule?.title ?? '');
  const [cohortId, setCohortId] = useState<string>(rule?.cohort_id ?? '');
  const [tenureBuckets, setTenureBuckets] = useState<string[]>(rule?.tenure_buckets ?? []);
  const [reasons, setReasons] = useState<string[]>(rule?.reasons ?? []);
  const [orgType, setOrgType] = useState<OrgType>(rule?.org_type ?? 'any');
  const [offerType, setOfferType] = useState<OfferType>(rule?.offer_type ?? 'discount');
  const [pauseMonths, setPauseMonths] = useState<string>(String(rule?.pause_months ?? ''));
  const [couponId, setCouponId] = useState<string>(rule?.coupon_id ?? '');
  const [extensionDays, setExtensionDays] = useState<string>(String(rule?.extension_days ?? ''));
  const [priority, setPriority] = useState<string>(String(rule?.priority ?? 100));
  const [active, setActive] = useState(rule?.active ?? false);
  const [saving, setSaving] = useState(false);

  // Reset form when rule changes
  const prevRuleId = useRef<string | null>(rule?.id ?? null);
  useEffect(() => {
    if (rule?.id !== prevRuleId.current) {
      prevRuleId.current = rule?.id ?? null;
      setTitle(rule?.title ?? '');
      setCohortId(rule?.cohort_id ?? '');
      setTenureBuckets(rule?.tenure_buckets ?? []);
      setReasons(rule?.reasons ?? []);
      setOrgType(rule?.org_type ?? 'any');
      setOfferType(rule?.offer_type ?? 'discount');
      setPauseMonths(String(rule?.pause_months ?? ''));
      setCouponId(rule?.coupon_id ?? '');
      setExtensionDays(String(rule?.extension_days ?? ''));
      setPriority(String(rule?.priority ?? 100));
      setActive(rule?.active ?? false);
    }
  }, [rule]);

  // ── Toggle helpers ────────────────────────────────────────────────────────

  const toggleBucket = (id: string) => {
    setTenureBuckets((prev) => (prev.includes(id) ? prev.filter((b) => b !== id) : [...prev, id]));
  };

  const toggleReason = (id: string) => {
    setReasons((prev) => (prev.includes(id) ? prev.filter((r) => r !== id) : [...prev, id]));
  };

  // ── Validation ────────────────────────────────────────────────────────────

  const titleError = title.length > 60 ? 'Title must be 60 characters or fewer.' : '';
  const couponError =
    offerType === 'discount' && !couponId ? 'Select a coupon for discount offer.' : '';
  const isValid = title.trim().length > 0 && !titleError && !couponError;

  // ── Filter offer types by org type (D-04 clinic-org fork) ─────────────────

  const availableOfferTypes = OFFER_TYPES.filter((o) => !o.clinicOnly || orgType === 'clinic');

  // If current offerType is not available (clinic filter), reset to first available
  const resolvedOfferType: OfferType = availableOfferTypes.some((o) => o.id === offerType)
    ? offerType
    : availableOfferTypes[0]!.id;

  // ── Save ──────────────────────────────────────────────────────────────────

  const handleSave = async () => {
    if (!isValid || saving) return;
    setSaving(true);

    const params = {
      p_title: title.trim(),
      p_cohort_id: cohortId || null,
      p_tenure_buckets: tenureBuckets,
      p_reasons: reasons,
      p_org_type: orgType,
      p_offer_type: resolvedOfferType,
      p_pause_months: resolvedOfferType === 'pause' ? parseInt(pauseMonths) || null : null,
      p_coupon_id: resolvedOfferType === 'discount' ? couponId || null : null,
      p_extension_days:
        resolvedOfferType === 'extended_trial' ? parseInt(extensionDays) || null : null,
      p_downgrade_target: resolvedOfferType === 'downgrade' ? 'price_monthly' : null,
      p_priority: parseInt(priority) || 100,
      p_active: active,
    };

    if (isNew) {
      const { data, error } = await supabase.rpc('save_offer_rule_create', {
        p_title: params.p_title,
        p_cohort_id: params.p_cohort_id,
        p_tenure_buckets: params.p_tenure_buckets,
        p_reasons: params.p_reasons,
        p_org_type: params.p_org_type,
        p_offer_type: params.p_offer_type,
        p_pause_months: params.p_pause_months,
        p_coupon_id: params.p_coupon_id,
        p_extension_days: params.p_extension_days,
        p_downgrade_target: params.p_downgrade_target,
        p_priority: params.p_priority,
      });

      if (error || !data) {
        toast(`Failed to create rule: ${error?.message ?? 'Unknown error'}`, 'error');
        setSaving(false);
        return;
      }

      // Fetch the created rule to get all fields
      const { data: created } = await supabase
        .from('save_offer_rules')
        .select('*, cohort_definitions(name, member_count)')
        .eq('id', data as string)
        .single();

      if (created) {
        onCreated(created as SaveOfferRule);
        toast(`Rule "${params.p_title}" created.`, 'success');
      }
    } else {
      const { error } = await supabase.rpc('save_offer_rule_update', {
        p_id: rule!.id,
        p_title: params.p_title,
        p_cohort_id: params.p_cohort_id,
        p_tenure_buckets: params.p_tenure_buckets,
        p_reasons: params.p_reasons,
        p_org_type: params.p_org_type,
        p_offer_type: params.p_offer_type,
        p_pause_months: params.p_pause_months,
        p_coupon_id: params.p_coupon_id,
        p_extension_days: params.p_extension_days,
        p_downgrade_target: params.p_downgrade_target,
        p_priority: params.p_priority,
        p_active: params.p_active,
      });

      if (error) {
        toast(`Failed to update rule: ${error.message}`, 'error');
        setSaving(false);
        return;
      }

      const updated: SaveOfferRule = {
        ...rule!,
        title: params.p_title,
        cohort_id: params.p_cohort_id,
        tenure_buckets: params.p_tenure_buckets,
        reasons: params.p_reasons,
        org_type: params.p_org_type,
        offer_type: params.p_offer_type,
        pause_months: params.p_pause_months,
        coupon_id: params.p_coupon_id,
        extension_days: params.p_extension_days,
        downgrade_target: params.p_downgrade_target,
        priority: params.p_priority,
        active: params.p_active,
      };
      onUpdated(updated);
      toast(`Rule "${params.p_title}" updated.`, 'success');
    }

    setSaving(false);
  };

  // ── Render ────────────────────────────────────────────────────────────────

  const fieldDisabled = !canWrite || saving;

  return (
    <div className="space-y-5 p-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]">
      <h3 className="text-base font-semibold">
        {isNew ? 'New save-offer rule' : `Edit: ${rule.title}`}
      </h3>

      {!canWrite && (
        <div
          className="rounded p-3 bg-[var(--color-surface-elevated)] text-sm text-[var(--color-text-secondary)]"
          role="note"
        >
          You have read-only access to save-offer rules. Contact a superadmin to make changes.
        </div>
      )}

      {/* Rule title */}
      <div>
        <label htmlFor="rule-title" className="block text-sm font-medium mb-1">
          Rule title{' '}
          <span aria-hidden="true" className="text-[var(--color-danger)]">
            *
          </span>
        </label>
        <Input
          id="rule-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={60}
          disabled={fieldDisabled}
          aria-invalid={!!titleError}
          aria-describedby={titleError ? 'rule-title-error' : undefined}
          placeholder="e.g. High-value cohort — pause offer"
        />
        {titleError && (
          <p id="rule-title-error" className="mt-1 text-xs text-[var(--color-danger)]">
            {titleError}
          </p>
        )}
      </div>

      {/* Cohort */}
      <div>
        <label htmlFor="rule-cohort" className="block text-sm font-medium mb-1">
          Cohort (leave blank for any cohort)
        </label>
        <Select
          id="rule-cohort"
          value={cohortId}
          onChange={(e) => setCohortId(e.target.value)}
          disabled={fieldDisabled}
        >
          <option value="">Any cohort</option>
          {cohorts.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
      </div>

      {/* Tenure window */}
      <div>
        <p className="text-sm font-medium mb-2">Tenure window (empty = any tenure)</p>
        <PillGroup>
          {TENURE_OPTIONS.map((t) => (
            <Pill
              key={t.id}
              aria-pressed={tenureBuckets.includes(t.id)}
              disabled={fieldDisabled}
              onClick={() => toggleBucket(t.id)}
            >
              {t.label}
            </Pill>
          ))}
        </PillGroup>
      </div>

      {/* Reason scoping */}
      <div>
        <p className="text-sm font-medium mb-2">Cancellation reasons (empty = any reason)</p>
        <PillGroup>
          {REASON_OPTIONS.map((r) => (
            <Pill
              key={r.id}
              aria-pressed={reasons.includes(r.id)}
              disabled={fieldDisabled}
              onClick={() => toggleReason(r.id)}
            >
              {r.label}
            </Pill>
          ))}
        </PillGroup>
      </div>

      {/* Org type — D-04 clinic-org fork */}
      <div>
        <label htmlFor="rule-org-type" className="block text-sm font-medium mb-1">
          Org type
        </label>
        <Select
          id="rule-org-type"
          value={orgType}
          onChange={(e) => setOrgType(e.target.value as OrgType)}
          disabled={fieldDisabled}
        >
          {ORG_TYPES.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </Select>
        {orgType === 'clinic' && (
          <p className="mt-1 text-xs text-[var(--color-text-secondary)]">
            Clinic orgs see: discount + contact CSM only (no pause, extended trial, or downgrade per
            D-04).
          </p>
        )}
      </div>

      {/* Offer type */}
      <div>
        <label htmlFor="rule-offer-type" className="block text-sm font-medium mb-1">
          Offer type
        </label>
        <Select
          id="rule-offer-type"
          value={resolvedOfferType}
          onChange={(e) => setOfferType(e.target.value as OfferType)}
          disabled={fieldDisabled}
        >
          {availableOfferTypes.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </Select>
      </div>

      {/* Offer type sub-fields */}
      {resolvedOfferType === 'pause' && (
        <div>
          <label htmlFor="rule-pause-months" className="block text-sm font-medium mb-1">
            Pause duration
          </label>
          <Select
            id="rule-pause-months"
            value={pauseMonths}
            onChange={(e) => setPauseMonths(e.target.value)}
            disabled={fieldDisabled}
          >
            <option value="">Select duration</option>
            <option value="1">1 month</option>
            <option value="2">2 months</option>
            <option value="3">3 months</option>
          </Select>
        </div>
      )}

      {resolvedOfferType === 'discount' && (
        <div>
          <label htmlFor="rule-coupon" className="block text-sm font-medium mb-1">
            Coupon{' '}
            <span aria-hidden="true" className="text-[var(--color-danger)]">
              *
            </span>
          </label>
          <Select
            id="rule-coupon"
            value={couponId}
            onChange={(e) => setCouponId(e.target.value)}
            disabled={fieldDisabled}
            aria-invalid={!!couponError}
            aria-describedby={couponError ? 'rule-coupon-error' : undefined}
          >
            <option value="">Select coupon</option>
            {COUPON_CATALOG.map((c) => (
              <option key={c.id} value={c.id}>
                {c.id} — {c.label}
              </option>
            ))}
          </Select>
          {couponError && (
            <p id="rule-coupon-error" className="mt-1 text-xs text-[var(--color-danger)]">
              {couponError}
            </p>
          )}
          <p className="mt-1 text-xs text-[var(--color-text-secondary)] font-mono">
            Catalog: SAVE-(20|25|30)-(2|3)MO · validated at RPC (T-40-05-03)
          </p>
        </div>
      )}

      {resolvedOfferType === 'extended_trial' && (
        <div>
          <label htmlFor="rule-extension-days" className="block text-sm font-medium mb-1">
            Extension duration
          </label>
          <Select
            id="rule-extension-days"
            value={extensionDays}
            onChange={(e) => setExtensionDays(e.target.value)}
            disabled={fieldDisabled}
          >
            <option value="">Select duration</option>
            <option value="7">7 days</option>
            <option value="14">14 days</option>
            <option value="30">30 days</option>
          </Select>
        </div>
      )}

      {resolvedOfferType === 'downgrade' && (
        <div className="rounded p-3 bg-[var(--color-surface-elevated)] text-sm text-[var(--color-text-secondary)]">
          Downgrade offer: annual plan → monthly (price_monthly). No additional configuration
          required.
        </div>
      )}

      {resolvedOfferType === 'contact_csm' && (
        <div className="rounded p-3 bg-[var(--color-surface-elevated)] text-sm text-[var(--color-text-secondary)]">
          CSM contact card: user sees &ldquo;A team member will reach out within 24 hours.&rdquo;
          Available for clinic orgs only (D-04).
        </div>
      )}

      {/* Priority */}
      <div>
        <label htmlFor="rule-priority" className="block text-sm font-medium mb-1">
          Priority (lower = higher priority)
        </label>
        <Input
          id="rule-priority"
          type="number"
          min={1}
          max={9999}
          value={priority}
          onChange={(e) => setPriority(e.target.value)}
          disabled={fieldDisabled}
        />
        <p className="mt-1 text-xs text-[var(--color-text-secondary)]">
          cancellation-decide-offer queries ORDER BY priority ASC LIMIT 1. Lower wins.
        </p>
      </div>

      {/* Active toggle */}
      <div className="flex items-center gap-3">
        <p className="text-sm font-medium">Active</p>
        <Pill
          aria-pressed={active}
          disabled={fieldDisabled}
          onClick={() => setActive((v) => !v)}
          aria-label={active ? 'Deactivate this rule' : 'Activate this rule'}
        >
          {active ? 'Active' : 'Inactive'}
        </Pill>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-3 pt-2 border-t border-[var(--color-border)]">
        <Button
          variant="primary"
          onClick={() => void handleSave()}
          disabled={!isValid || !canWrite || saving}
          aria-busy={saving}
        >
          {saving ? 'Saving…' : isNew ? 'Create rule' : 'Save changes'}
        </Button>
        <Button variant="ghost" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
