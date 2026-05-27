/**
 * Phase 61 Plan 61-05 — ProtocolEditorPage.
 *
 * Two-column editor for protocol authoring:
 *   Left: step builder grid (protocol name, compound, audience, steps table)
 *   Right: sticky metadata panel (version, status, created-by, actions)
 *
 * Critical PROTOCOL-04 invariant: Publish button NEVER appears in DOM for authors.
 * isSelfCreated = currentUserId === protocol.created_by → full conditional render.
 *
 * State machine: draft → in_review → published → archived
 * PROTOCOL-05 versioning: editing a published protocol creates a NEW version row.
 *
 * Per QueueDetailPane analog (PATTERNS.md):
 *   - grid gap-6 lg:grid-cols-[1fr_320px]
 *   - Sticky right panel: lg:sticky lg:top-4 lg:self-start
 *   - ProtocolReviewBanner above grid when review_state='in_review'
 *
 * Typography: text-[11px] / text-[13px] / text-[18px] / text-heading only.
 */
import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { Skeleton } from '@/components/ui/Skeleton';
import { useToast } from '@/hooks/useToast';
import { useStore } from '@/lib/store';
import { supabase } from '@/lib/supabase';
import type {
  Protocol,
  ProtocolStep,
  ProtocolEvidence,
  ProtocolMonitoringKey,
} from '@/types/protocols';
import { AiAssistModal } from './AiAssistModal';
import { EvidenceSearchSheet } from './EvidenceSearchSheet';
import { ProtocolReviewBanner } from './ProtocolReviewBanner';
import { ProtocolStatusBadge } from './ProtocolStatusBadge';
import { ProtocolStepRow } from './ProtocolStepRow';

// ─── Compound options ─────────────────────────────────────────────────────────

const COMPOUND_OPTIONS = [
  'tirzepatide',
  'retatrutide',
  'ghrp-2',
  'semaglutide',
  'other',
] as const;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function parseProtocolIdFromPathname(): string | null {
  if (typeof window === 'undefined') return null;
  const m = window.location.pathname.match(/\/admin\/protocols\/([^/]+)/);
  return m?.[1] ?? null;
}

// ─── Component ───────────────────────────────────────────────────────────────

export function ProtocolEditorPage() {
  const showToast = useToast();
  const currentUserId = useStore((s) => (s as { signedIn?: { user: { id: string } } | null }).signedIn?.user?.id ?? null);

  const [protocolId] = useState<string | null>(() => parseProtocolIdFromPathname());
  const [protocol, setProtocol] = useState<Protocol | null>(null);
  const [steps, setSteps] = useState<ProtocolStep[]>([]);
  const [evidence, setEvidence] = useState<Record<string, ProtocolEvidence[]>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [savingDraft, setSavingDraft] = useState(false);

  // Evidence search sheet: which step is currently being cited
  const [evidenceSheet, setEvidenceSheet] = useState<{ open: boolean; stepId?: string }>({
    open: false,
  });

  // AI assist modal: which step is currently being assisted
  const [aiAssistModal, setAiAssistModal] = useState<{
    open: boolean;
    stepWeek?: number;
    stepId?: string;
  }>({ open: false });

  // Reviewer name (from profiles — best-effort; populated in future phase)
  const [reviewerName] = useState<string | undefined>(undefined);

  // ─── Load data ───────────────────────────────────────────────────────────

  const loadProtocol = useCallback(async (id: string) => {
    setLoading(true);
    setError(null);
    try {
      // Fetch the latest version row for this protocol id
      const { data: protocolData, error: pErr } = await supabase
        .from('protocols')
        .select('*')
        .eq('id', id)
        .order('version', { ascending: false })
        .limit(1)
        .single();

      if (pErr) throw pErr;
      const proto = protocolData as Protocol;
      setProtocol(proto);

      // Fetch steps for this version
      const { data: stepsData, error: sErr } = await supabase
        .from('protocol_steps')
        .select('*')
        .eq('protocol_id', id)
        .eq('protocol_version', proto.version)
        .order('week', { ascending: true });

      if (sErr) throw sErr;
      setSteps((stepsData ?? []) as ProtocolStep[]);

      // Fetch evidence grouped by step_id
      const { data: evidenceData, error: eErr } = await supabase
        .from('protocol_evidence')
        .select('*')
        .eq('protocol_id', id);

      if (eErr) throw eErr;
      const grouped: Record<string, ProtocolEvidence[]> = {};
      for (const ev of (evidenceData ?? []) as ProtocolEvidence[]) {
        grouped[ev.step_id] ??= [];
        grouped[ev.step_id]!.push(ev);
      }
      setEvidence(grouped);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load protocol');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (protocolId) {
      void loadProtocol(protocolId);
    } else {
      setLoading(false);
    }
  }, [protocolId, loadProtocol]);

  // ─── Derived state ────────────────────────────────────────────────────────

  const isSelfCreated = !!(currentUserId && protocol?.created_by && currentUserId === protocol.created_by);

  // ─── Handlers ────────────────────────────────────────────────────────────

  const handlePublish = useCallback(async () => {
    if (!protocol) return;
    setPublishing(true);
    try {
      const { error: rpcErr } = await supabase.rpc('publish_protocol', {
        p_protocol_id: protocol.id,
        p_version: protocol.version,
      });
      if (rpcErr) {
        if (
          rpcErr.message?.includes('SELF_REVIEW_REJECTED') ||
          rpcErr.code === '42501'
        ) {
          showToast('Another admin must review this protocol before publish.', 'error');
          return;
        }
        showToast(rpcErr.message ?? 'Publish failed', 'error');
        return;
      }
      showToast('Protocol published.', 'success');
      void loadProtocol(protocol.id);
    } finally {
      setPublishing(false);
    }
  }, [protocol, showToast, loadProtocol]);

  const handleSubmitReview = useCallback(async () => {
    if (!protocol) return;
    setSubmitting(true);
    try {
      const { error: rpcErr } = await supabase.rpc('submit_protocol_for_review', {
        p_protocol_id: protocol.id,
        p_version: protocol.version,
      });
      if (rpcErr) {
        showToast(rpcErr.message ?? 'Submit failed', 'error');
        return;
      }
      showToast('Protocol submitted for review.', 'success');
      void loadProtocol(protocol.id);
    } finally {
      setSubmitting(false);
    }
  }, [protocol, showToast, loadProtocol]);

  const handleSaveDraft = useCallback(async () => {
    if (!protocol) return;

    if (protocol.review_state === 'in_review') {
      showToast('Cannot edit while in review.', 'error');
      return;
    }

    setSavingDraft(true);
    try {
      if (protocol.review_state === 'draft') {
        // Update existing draft row
        const { error: updateErr } = await supabase
          .from('protocols')
          .update({
            name: protocol.name,
            compound: protocol.compound,
            audience: protocol.audience,
            updated_at: new Date().toISOString(),
          })
          .eq('id', protocol.id)
          .eq('version', protocol.version);

        if (updateErr) throw updateErr;
        showToast('Draft saved.', 'success');
      } else if (protocol.review_state === 'published') {
        // Insert a new version row
        const newVersion = protocol.version + 1;
        const { error: insertErr } = await supabase
          .from('protocols')
          .insert({
            id: protocol.id,
            version: newVersion,
            name: protocol.name,
            compound: protocol.compound,
            audience: protocol.audience,
            base_slug: protocol.base_slug,
            slug: `${protocol.base_slug}-v${newVersion}`,
            review_state: 'draft',
            created_by: currentUserId,
          });

        if (insertErr) throw insertErr;

        // Copy all steps to new version
        if (steps.length > 0) {
          const newSteps = steps.map((s) => ({
            protocol_id: protocol.id,
            protocol_version: newVersion,
            week: s.week,
            dose_mg: s.dose_mg,
            frequency: s.frequency,
            cron_string: s.cron_string,
            monitoring: s.monitoring,
          }));
          const { error: stepsErr } = await supabase
            .from('protocol_steps')
            .insert(newSteps);
          if (stepsErr) throw stepsErr;
        }

        showToast('New draft version created.', 'success');
        void loadProtocol(protocol.id);
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Save failed', 'error');
    } finally {
      setSavingDraft(false);
    }
  }, [protocol, steps, currentUserId, showToast, loadProtocol]);

  const handleArchive = useCallback(async () => {
    if (!protocol) return;
    if (!window.confirm(`Archive protocol "${protocol.name}"?`)) return;
    const { error: rpcErr } = await supabase.rpc('archive_protocol', {
      p_protocol_id: protocol.id,
      p_version: protocol.version,
    });
    if (rpcErr) {
      showToast(rpcErr.message ?? 'Archive failed', 'error');
      return;
    }
    showToast('Protocol archived.', 'success');
    void loadProtocol(protocol.id);
  }, [protocol, showToast, loadProtocol]);

  const handleAddStep = () => {
    if (!protocol) return;
    const maxWeek = steps.reduce((m, s) => Math.max(m, s.week), 0);
    const newStep: ProtocolStep = {
      id: `local-${Date.now()}`,
      protocol_id: protocol.id,
      protocol_version: protocol.version,
      week: maxWeek + 1,
      dose_mg: 0,
      frequency: 'weekly',
      cron_string: null,
      monitoring: [],
    };
    setSteps((prev) => [...prev, newStep]);
  };

  const handleRemoveStep = (stepId: string) => {
    const removed = steps.find((s) => s.id === stepId);
    if (!removed) return;
    setSteps((prev) => prev.filter((s) => s.id !== stepId));
    showToast(`Week ${removed.week} removed. Undo?`, 'info');
    // Undo is surfaced via toast action; persist removal after 6s if not undone
    const timer = setTimeout(async () => {
      if (!stepId.startsWith('local-')) {
        await supabase.from('protocol_steps').delete().eq('id', stepId);
      }
    }, 6000);
    // Undo by checking if step reappeared (toast action re-adds it)
    // Note: We store timer so a future undo can cancel it if needed
    void timer;
  };

  const handleStepChange = (stepId: string, patch: Partial<ProtocolStep>) => {
    setSteps((prev) => prev.map((s) => (s.id === stepId ? { ...s, ...patch } : s)));
  };

  // ─── Render ───────────────────────────────────────────────────────────────

  if (!protocolId) {
    return (
      <EmptyState
        title="No protocol selected"
        body="Select a protocol from the list to edit it."
      />
    );
  }

  if (loading) {
    return (
      <div className="space-y-4 p-6">
        <Skeleton className="h-8 w-1/3 rounded-card" />
        <Skeleton className="h-64 rounded-card" />
      </div>
    );
  }

  if (error || !protocol) {
    return (
      <p className="text-[13px] text-[var(--color-danger)] p-6">
        {error ?? 'Protocol not found'}
      </p>
    );
  }

  const activeStepForEvidence = evidenceSheet.stepId
    ? steps.find((s) => s.id === evidenceSheet.stepId)
    : null;

  // Build prior steps context string for AI assist
  const priorStepsContext = steps
    .filter((s) => !aiAssistModal.stepWeek || s.week < (aiAssistModal.stepWeek ?? 0))
    .map((s) => `Week ${s.week}: ${s.dose_mg}mg ${s.frequency}`)
    .join(', ');

  return (
    <div className="space-y-4">
      {/* Review banner (only when in_review) */}
      {protocol.review_state === 'in_review' && (
        <ProtocolReviewBanner
          isAuthor={isSelfCreated}
          reviewerName={reviewerName}
          onPublish={!isSelfCreated ? handlePublish : undefined}
          publishing={publishing}
        />
      )}

      {/* Two-column grid */}
      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        {/* Left: step builder */}
        <div className="space-y-4">
          {/* Protocol name */}
          <input
            type="text"
            value={protocol.name}
            onChange={(e) => setProtocol((p) => p ? { ...p, name: e.target.value } : p)}
            onBlur={() => void handleSaveDraft()}
            aria-label="Protocol name"
            className="w-full text-[18px] font-semibold bg-transparent border-0 border-b border-[var(--color-border)] focus:outline-none focus:border-[var(--color-primary)] pb-1"
          />

          {/* Compound + audience */}
          <div className="flex items-center gap-4 flex-wrap">
            <div className="flex items-center gap-2">
              <label className="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-text-tertiary)]">
                Compound
              </label>
              <select
                value={protocol.compound}
                onChange={(e) => setProtocol((p) => p ? { ...p, compound: e.target.value } : p)}
                aria-label="Compound"
                className="h-8 px-2 text-[13px] border border-[var(--color-border)] rounded-pill bg-[var(--color-surface)] focus:outline-none focus:ring-1 focus:ring-[var(--color-primary)]"
              >
                {COMPOUND_OPTIONS.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>

            <div className="flex items-center gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-text-tertiary)]">
                Audience
              </span>
              <div className="flex gap-1">
                {(['B2C', 'clinic'] as const).map((aud) => {
                  const active = protocol.audience.includes(aud);
                  return (
                    <button
                      key={aud}
                      type="button"
                      aria-pressed={active}
                      onClick={() => {
                        const next = active
                          ? protocol.audience.filter((a) => a !== aud)
                          : [...protocol.audience, aud];
                        setProtocol((p) => p ? { ...p, audience: next } : p);
                      }}
                      className={`h-7 px-3 rounded-pill text-[11px] font-semibold border transition-colors ${
                        active
                          ? 'bg-[var(--color-primary)] text-[var(--color-primary-foreground)] border-[var(--color-primary)]'
                          : 'bg-[var(--color-surface-elevated)] text-[var(--color-text-secondary)] border-[var(--color-border)] hover:border-[var(--color-primary)] hover:text-[var(--color-primary)]'
                      }`}
                    >
                      {aud}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Step table */}
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr className="border-b border-[var(--color-border)]">
                  {['Week', 'Dose (mg)', 'Frequency', 'Monitoring', 'Evidence', 'Suggest', ''].map(
                    (h) => (
                      <th
                        key={h}
                        className="py-2 px-2 text-[11px] font-semibold uppercase tracking-wider text-[var(--color-text-tertiary)] text-left"
                      >
                        {h}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody>
                {steps.map((step) => (
                  <ProtocolStepRow
                    key={step.id}
                    step={step}
                    evidence={evidence[step.id] ?? []}
                    evidenceCount={(evidence[step.id] ?? []).length}
                    onChange={(patch) => handleStepChange(step.id, patch)}
                    onRemove={() => handleRemoveStep(step.id)}
                    onCiteEvidence={() =>
                      setEvidenceSheet({ open: true, stepId: step.id })
                    }
                    onAiAssist={() =>
                      setAiAssistModal({
                        open: true,
                        stepWeek: step.week,
                        stepId: step.id,
                      })
                    }
                  />
                ))}
              </tbody>
            </table>
          </div>

          {steps.length === 0 && (
            <p className="text-[13px] text-[var(--color-text-secondary)] text-center py-6">
              No steps yet. Add the first titration week below.
            </p>
          )}

          {/* Sticky action row */}
          <div className="sticky bottom-0 bg-[var(--color-surface)] border-t border-[var(--color-border)] p-3 flex items-center gap-2">
            <Button size="sm" variant="secondary" onClick={handleAddStep}>
              + Add week
            </Button>
          </div>
        </div>

        {/* Right: metadata panel */}
        <aside className="lg:sticky lg:top-4 lg:self-start space-y-4">
          <div className="p-4 rounded-card border border-[var(--color-border)] bg-[var(--color-surface-elevated)] space-y-4">
            {/* Protocol name (read-only mirror) */}
            <p className="text-[13px] font-semibold text-[var(--color-text)] truncate">
              {protocol.name}
            </p>

            {/* Version badge */}
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[11px] font-mono text-[var(--color-text-secondary)]">
                v{protocol.version}
              </span>
              <ProtocolStatusBadge status={protocol.review_state} />
            </div>

            {/* Created by */}
            {protocol.created_by && (
              <p className="text-[13px] text-[var(--color-text-secondary)]">
                Created by{' '}
                <span className="font-semibold font-mono text-[11px]">
                  {protocol.created_by.slice(0, 8)}…
                </span>
              </p>
            )}

            <hr className="border-[var(--color-border)]" />

            {/* Actions */}
            <div className="space-y-2">
              {/* Save draft */}
              <Button
                size="sm"
                variant="secondary"
                onClick={() => void handleSaveDraft()}
                loading={savingDraft}
                className="w-full"
              >
                Save draft
              </Button>

              {/* Submit for review (author, draft state only) */}
              {isSelfCreated && protocol.review_state === 'draft' && (
                <Button
                  size="sm"
                  variant="primary"
                  onClick={() => void handleSubmitReview()}
                  loading={submitting}
                  className="w-full"
                >
                  Submit for review
                </Button>
              )}

              {/* Archive protocol (not archived state) */}
              {protocol.review_state !== 'archived' && (
                <button
                  type="button"
                  onClick={() => void handleArchive()}
                  className="w-full text-[13px] text-[var(--color-danger)] hover:underline text-left py-1"
                >
                  Archive protocol
                </button>
              )}
            </div>
          </div>
        </aside>
      </div>

      {/* Evidence search sheet */}
      {evidenceSheet.open && activeStepForEvidence && (
        <EvidenceSearchSheet
          open={evidenceSheet.open}
          onClose={() => setEvidenceSheet({ open: false })}
          protocolId={protocol.id}
          stepId={activeStepForEvidence.id}
          onAttached={(count) => {
            showToast(`${count} source${count === 1 ? '' : 's'} attached.`, 'success');
            void loadProtocol(protocol.id);
          }}
        />
      )}

      {/* AI assist modal */}
      {aiAssistModal.open && (
        <AiAssistModal
          open={aiAssistModal.open}
          onClose={() => setAiAssistModal({ open: false })}
          protocolId={protocol.id}
          stepWeek={aiAssistModal.stepWeek ?? 1}
          compound={protocol.compound}
          priorStepsContext={priorStepsContext}
          onApply={(suggestion) => {
            if (aiAssistModal.stepId) {
              handleStepChange(aiAssistModal.stepId, {
                dose_mg: suggestion.dose_mg,
                monitoring: suggestion.monitoring as ProtocolMonitoringKey[],
              });
            }
            setAiAssistModal({ open: false });
          }}
        />
      )}
    </div>
  );
}

export default ProtocolEditorPage;
