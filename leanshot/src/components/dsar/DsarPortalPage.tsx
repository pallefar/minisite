/**
 * Phase 22 plan 22-11 — DSAR portal (GDPR-03, D-06).
 * Phase 64 plan 64-06 — State-residency extension (LEGAL-03).
 *
 * Patient-only self-serve entry point for GDPR Article 15 (right of access)
 * extended with state-privacy data rights (CCPA/CPRA / CDPA / CPA / CTDPA / UCPA).
 *
 * Two coexisting lanes per 64-CONTEXT.md D-DSAR-Portal-Extensions:
 *   Lane A (existing) — GDPR export bundle via `create_dsar_request` RPC.
 *   Lane B (new)      — State-flavor data rights via `data_rights_requests` INSERT.
 *     Deletion in Lane B ALSO triggers `initiate_account_deletion_rpc` (legacy
 *     Phase 22/35 flow) so operators see a unified audit of deletion requests.
 *
 * Flow per UI-SPEC §`/settings/privacy/dsar`:
 *   1. Hero card with heading "Your data" + body explaining the bundle scope
 *      + 30-day SLA badge + "Export my data" CTA (Lane A).
 *   2. State-residency card with Select + conditional checkboxes + submit (Lane B).
 *   3. Lane A CTA opens a confirmation Modal → create_dsar_request → DsarStatusCard.
 *   4. Lane A active request polls via Realtime (30s setInterval fallback).
 *   5. Lane B submit → validate → INSERT data_rights_requests (one row/type)
 *      → optionally call initiate_account_deletion_rpc if 'deletion' selected.
 *   6. Past Lane A requests render under "Previous exports".
 *
 * UI-SPEC §Copywriting:
 *   - Cancel CTA: "Keep my data rights pending" (NOT generic "Cancel").
 *   - Submit CTA: "Submit data rights request" (verb + noun).
 *   - No undefined Tailwind v4 tokens (per T-64-06-04 grep gate).
 */
import { ShieldCheck } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/hooks/useToast';
import {
  DsarError,
  getDsarRequest,
  listDsarRequests,
  requestDsarExport,
  subscribeDsarRequests,
  type DsarRequestRow,
} from '@/lib/dsar/dsar-export-client';
import {
  getRequestTypesForState,
  type RequestType,
  type StateCode,
} from '@/lib/dsar/state-request-types';
import { useStore } from '@/lib/store';
import { supabase } from '@/lib/supabase';
import { DsarStatusCard } from './DsarStatusCard';

// ─── Constants ────────────────────────────────────────────────────────────────

const STATUS_LABEL_MAP: Record<DsarRequestRow['status'], string> = {
  pending: 'Pending',
  in_progress: 'In progress',
  completed: 'Ready to download',
  rejected: 'Rejected',
};

const STATUS_FALLBACK_POLL_MS = 30_000;
const SIGNED_URL_TTL_SECONDS = 60 * 60; // 1 hour client-side download window

/**
 * Human-readable labels for each request type.
 * Per 64-06-PLAN.md Task 2 action item §4.
 */
const REQUEST_TYPE_LABELS: Record<RequestType, string> = {
  deletion: 'Delete my data',
  access: 'Access my data',
  portability: 'Export my data in portable format',
  correction: 'Correct inaccurate data about me',
  opt_out: 'Opt out of sale, sharing, or targeted advertising',
  limit_sensitive_use: 'Limit use of my sensitive personal information',
  opt_in_sensitive: 'Opt in to sensitive data processing',
};

/**
 * State option labels for the residency dropdown.
 */
const STATE_OPTIONS: Array<{ value: StateCode; label: string }> = [
  { value: 'CA', label: 'California' },
  { value: 'VA', label: 'Virginia' },
  { value: 'CO', label: 'Colorado' },
  { value: 'CT', label: 'Connecticut' },
  { value: 'UT', label: 'Utah' },
  { value: 'OTHER', label: 'Other / Not listed' },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Generate a fresh signed URL for the completed export. The original 7-day
 * Edge-Fn-minted URL is what's emailed to the user; the portal generates
 * its own short-lived URL when the user clicks Download from the page.
 */
async function generateDownloadUrl(exportPath: string): Promise<string | null> {
  try {
    const { data, error } = await supabase.storage
      .from('dsar-exports')
      .createSignedUrl(exportPath, SIGNED_URL_TTL_SECONDS);
    if (error || !data?.signedUrl) return null;
    return data.signedUrl;
  } catch {
    return null;
  }
}

// ─── State-residency status row (Lane B result) ───────────────────────────────

interface StateRequestResult {
  id: string;
  state_residency: StateCode;
  request_type: RequestType;
  submitted_at: string;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function DsarPortalPage() {
  const signedIn = useStore((s) => s.signedIn);
  const userId = signedIn?.user?.id ?? null;
  const toast = useToast();

  // ── Lane A (GDPR export) state ──────────────────────────────────────────────
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [activeRequest, setActiveRequest] = useState<DsarRequestRow | null>(null);
  const [history, setHistory] = useState<DsarRequestRow[]>([]);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [loadingHistory, setLoadingHistory] = useState(true);

  // ── Lane B (state-residency rights) state ───────────────────────────────────
  const [stateResidency, setStateResidency] = useState<StateCode | ''>('');
  const [selectedRequestTypes, setSelectedRequestTypes] = useState<RequestType[]>([]);
  const [stateRequestSubmitting, setStateRequestSubmitting] = useState(false);
  const [stateRequestResult, setStateRequestResult] = useState<StateRequestResult | null>(null);

  /**
   * When state changes, reset selected checkboxes so stale selections from
   * a previously selected state don't carry over.
   */
  const handleStateChange = (newState: StateCode | '') => {
    setStateResidency(newState);
    setSelectedRequestTypes([]);
  };

  const handleCheckboxChange = (rt: RequestType, checked: boolean) => {
    setSelectedRequestTypes((prev) =>
      checked ? [...prev, rt] : prev.filter((t) => t !== rt),
    );
  };

  // ── Lane A: Load history ───────────────────────────────────────────────────

  const refresh = useCallback(async (): Promise<void> => {
    setLoadingHistory(true);
    try {
      const rows = await listDsarRequests();
      const liveRow = rows.find((r) => r.status === 'pending' || r.status === 'in_progress');
      const completedOrRejected = rows.filter((r) => r !== liveRow);
      const mostRecentNonLive = rows.find(
        (r) => r.status === 'completed' || r.status === 'rejected',
      );
      const active = liveRow ?? mostRecentNonLive ?? null;
      setActiveRequest(active);
      setHistory(active ? completedOrRejected.filter((r) => r.id !== active.id) : rows);

      if (active?.status === 'completed' && active.export_path) {
        const url = await generateDownloadUrl(active.export_path);
        setDownloadUrl(url);
      }
    } catch (e) {
      console.error('[dsar-portal] listDsarRequests failed', e);
    } finally {
      setLoadingHistory(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  /**
   * Realtime subscription for live Lane A status transitions.
   * Falls back to a 30s setInterval poll for jsdom / blocked WebSockets.
   */
  useEffect(() => {
    if (!userId || !activeRequest) return;
    if (activeRequest.status === 'completed' || activeRequest.status === 'rejected') return;

    let unsubscribe: (() => void) | null = null;
    try {
      const sub = subscribeDsarRequests(userId, (row) => {
        if (row.id === activeRequest.id) {
          setActiveRequest(row);
          if (row.status === 'completed' && row.export_path) {
            void generateDownloadUrl(row.export_path).then(setDownloadUrl);
          }
        }
      });
      unsubscribe = sub.unsubscribe;
    } catch (e) {
      console.warn('[dsar-portal] Realtime subscribe failed; falling back to poll', e);
    }

    const pollId = window.setInterval(() => {
      void (async () => {
        const fresh = await getDsarRequest(activeRequest.id);
        if (fresh && fresh.status !== activeRequest.status) {
          setActiveRequest(fresh);
          if (fresh.status === 'completed' && fresh.export_path) {
            const url = await generateDownloadUrl(fresh.export_path);
            setDownloadUrl(url);
          }
        }
      })();
    }, STATUS_FALLBACK_POLL_MS);

    return () => {
      if (unsubscribe) unsubscribe();
      window.clearInterval(pollId);
    };
  }, [userId, activeRequest]);

  // ── Lane A: Confirm export handler ────────────────────────────────────────

  const handleConfirmExport = useCallback(async (): Promise<void> => {
    setSubmitting(true);
    try {
      const requestId = await requestDsarExport();
      const synthetic: DsarRequestRow = {
        id: requestId,
        user_id: userId ?? '',
        requested_at: new Date().toISOString(),
        completed_at: null,
        status: 'pending',
        rejection_reason: null,
        export_path: null,
        export_signed_url_expires_at: null,
      };
      setActiveRequest(synthetic);
      setConfirmOpen(false);
      toast("Export started. We'll email you when it's ready.", 'success');
      void refresh();
    } catch (e) {
      const err = e instanceof DsarError ? e : new DsarError('unknown');
      if (err.code === 'already_pending') {
        toast("You already have an active export. We'll email you when it's ready.", 'info');
        void refresh();
        setConfirmOpen(false);
      } else {
        toast("Couldn't start your export. Try again or contact support.", 'error');
      }
    } finally {
      setSubmitting(false);
    }
  }, [refresh, toast, userId]);

  // ── Lane B: Submit state-residency rights request ──────────────────────────

  const handleStateRightsSubmit = useCallback(async (): Promise<void> => {
    if (!stateResidency) {
      toast('Please select your state of residence.', 'error');
      return;
    }
    if (selectedRequestTypes.length === 0) {
      toast('Please select at least one data right to exercise.', 'error');
      return;
    }
    if (!userId) {
      toast('You must be signed in to submit a data rights request.', 'error');
      return;
    }

    setStateRequestSubmitting(true);
    try {
      // Insert one row per selected request_type — simplifies per-right status tracking.
      const rows = selectedRequestTypes.map((rt) => ({
        user_id: userId,
        state_residency: stateResidency,
        request_type: rt,
        details: null,
      }));

      const { data, error } = await supabase.from('data_rights_requests').insert(rows);

      if (error) {
        console.error('[dsar-portal] data_rights_requests insert failed', error);
        toast("Couldn't submit your request. Try again or contact support.", 'error');
        return;
      }

      // If 'deletion' is among selected types, ALSO trigger the legacy RPC
      // (Phase 22/35 flow) so the pending_account_deletions audit trail is preserved.
      if (selectedRequestTypes.includes('deletion')) {
        await supabase.rpc('initiate_account_deletion_rpc');
      }

      // Surface the first inserted row as the result card.
      const firstRow = Array.isArray(data) && data.length > 0 ? data[0] : null;
      if (firstRow) {
        setStateRequestResult({
          id: firstRow.id as string,
          state_residency: stateResidency,
          request_type: selectedRequestTypes[0] ?? 'access',
          submitted_at: new Date().toISOString(),
        });
      } else {
        // Even if we can't get the row back, show a success card placeholder.
        setStateRequestResult({
          id: 'submitted',
          state_residency: stateResidency,
          request_type: selectedRequestTypes[0] ?? 'access',
          submitted_at: new Date().toISOString(),
        });
      }

      toast(
        `Your data rights request has been submitted. We'll respond within 30 days.`,
        'success',
      );
      // Reset form
      setStateResidency('');
      setSelectedRequestTypes([]);
    } catch (e) {
      console.error('[dsar-portal] state rights submit error', e);
      toast("Couldn't submit your request. Try again or contact support.", 'error');
    } finally {
      setStateRequestSubmitting(false);
    }
  }, [stateResidency, selectedRequestTypes, userId, toast]);

  // ── Render ─────────────────────────────────────────────────────────────────

  // Available request types for currently selected state
  const availableRequestTypes =
    stateResidency ? getRequestTypesForState(stateResidency) : [];

  return (
    <div className="max-w-3xl mx-auto px-4 py-12 space-y-6">

      {/* ── Hero card (Lane A — GDPR data export) ──────────────────────────── */}
      <Card padding="lg">
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <span
              className="size-10 rounded-xl bg-[var(--color-primary-soft)] text-[var(--color-primary)] inline-flex items-center justify-center"
            >
              <ShieldCheck className="size-5" aria-hidden />
            </span>
            <h1 className="text-[18px] font-semibold tracking-tight">Your data</h1>
            <Badge tone="neutral">30-day SLA</Badge>
          </div>
          <p className="text-[13px] text-[var(--color-text-secondary)] leading-relaxed">
            You have the right to request a copy of all the data we hold about you. We&apos;ll
            prepare a download bundle including your injections, photos, weight logs, AI history,
            billing records, sharing history, and consent records. Some shared data (your
            doctor&apos;s notes, other clinic members&apos; records) is excluded.
          </p>
          <Button
            variant="primary"
            onClick={() => setConfirmOpen(true)}
            disabled={
              activeRequest?.status === 'pending' || activeRequest?.status === 'in_progress'
            }
          >
            Export my data
          </Button>
        </div>
      </Card>

      {/* Lane A active request status */}
      {activeRequest && <DsarStatusCard request={activeRequest} downloadUrl={downloadUrl} />}

      {/* Lane A history */}
      {!loadingHistory && history.length > 0 && (
        <Card padding="md">
          <h2 className="text-[18px] font-semibold mb-3">Previous exports</h2>
          <ul className="space-y-2">
            {history.map((row) => (
              <li
                key={row.id}
                className="flex items-center justify-between text-[13px]"
                data-testid="dsar-history-row"
              >
                <span className="text-[var(--color-text-secondary)]">
                  {new Date(row.requested_at).toLocaleDateString(undefined, {
                    year: 'numeric',
                    month: 'short',
                    day: 'numeric',
                  })}
                </span>
                <span className="text-[var(--color-text-tertiary)]">
                  {STATUS_LABEL_MAP[row.status]}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {/* ── State-residency data rights card (Lane B — LEGAL-03) ────────────── */}
      <Card padding="lg">
        <div className="space-y-5">
          <div>
            <h2 className="text-[18px] font-semibold text-[var(--color-text)]">
              Exercise your state data rights
            </h2>
            <p className="text-[13px] text-[var(--color-text-secondary)] leading-relaxed mt-1">
              State privacy laws grant you specific rights depending on where you live. Select your
              state to see which rights apply to you.
            </p>
          </div>

          {/* State-residency select */}
          <div className="space-y-1">
            <label
              htmlFor="state-residency-select"
              className="block text-[13px] font-semibold text-[var(--color-text)]"
            >
              Which state do you reside in?
            </label>
            <p className="text-[11px] text-[var(--color-text-tertiary)]">
              Different state laws grant different data rights. We tailor your request options based
              on residency.
            </p>
            <select
              id="state-residency-select"
              aria-label="Which state do you reside in?"
              value={stateResidency}
              onChange={(e) => handleStateChange(e.target.value as StateCode | '')}
              className="mt-1 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text)] text-[13px] px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]"
            >
              <option value="">Select your state…</option>
              {STATE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          {/* Conditional request-type checkboxes */}
          {availableRequestTypes.length > 0 && (
            <div className="space-y-2">
              <p className="text-[13px] font-semibold text-[var(--color-text)]">
                Which rights would you like to exercise?
              </p>
              <ul className="space-y-2">
                {availableRequestTypes.map((rt) => {
                  const labelId = `rt-label-${rt}`;
                  return (
                    <li key={rt} className="flex items-start gap-2">
                      <input
                        id={`rt-checkbox-${rt}`}
                        type="checkbox"
                        aria-labelledby={labelId}
                        checked={selectedRequestTypes.includes(rt)}
                        onChange={(e) => handleCheckboxChange(rt, e.target.checked)}
                        className="mt-0.5 rounded border-[var(--color-border)] text-[var(--color-primary)]"
                      />
                      <label
                        id={labelId}
                        htmlFor={`rt-checkbox-${rt}`}
                        className="text-[13px] text-[var(--color-text)] leading-relaxed cursor-pointer"
                      >
                        {REQUEST_TYPE_LABELS[rt]}
                      </label>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {/* Form actions */}
          <div className="flex gap-2 pt-1">
            <Button
              variant="ghost"
              onClick={() => {
                setStateResidency('');
                setSelectedRequestTypes([]);
              }}
              disabled={stateRequestSubmitting}
            >
              Keep my data rights pending
            </Button>
            <Button
              variant="primary"
              loading={stateRequestSubmitting}
              disabled={!stateResidency || selectedRequestTypes.length === 0}
              onClick={() => {
                void handleStateRightsSubmit();
              }}
            >
              Submit data rights request
            </Button>
          </div>

          {/* Lane B result status card */}
          {stateRequestResult && (
            <div
              data-testid="dsar-state-status-card"
              className="rounded-xl bg-[var(--color-surface)] border border-[var(--color-border)] p-4 space-y-1"
            >
              <p className="text-[13px] font-semibold text-[var(--color-text)]">
                Request submitted
              </p>
              <p className="text-[11px] text-[var(--color-text-tertiary)]">
                State: {stateRequestResult.state_residency} &middot; Submitted:{' '}
                {new Date(stateRequestResult.submitted_at).toLocaleDateString(undefined, {
                  year: 'numeric',
                  month: 'short',
                  day: 'numeric',
                })}
              </p>
              <p className="text-[13px] text-[var(--color-text-secondary)] leading-relaxed">
                We&apos;ll review your request and respond within 30 days to{' '}
                {signedIn?.user?.email ?? 'your email'}.
              </p>
            </div>
          )}
        </div>
      </Card>

      {/* ── Lane A confirmation modal ──────────────────────────────────────── */}
      <Modal
        open={confirmOpen}
        onClose={() => {
          if (!submitting) setConfirmOpen(false);
        }}
        title="Start your data export?"
        size="md"
      >
        <div className="space-y-4">
          <p className="text-[13px] text-[var(--color-text-secondary)] leading-relaxed">
            We&apos;ll prepare your data and email you when it&apos;s ready — typically within 24
            hours, up to 30 days. You can request another export later.
          </p>
          <div className="flex gap-2 justify-end">
            <Button
              variant="ghost"
              onClick={() => setConfirmOpen(false)}
              disabled={submitting}
            >
              Not now
            </Button>
            <Button
              variant="primary"
              loading={submitting}
              onClick={() => {
                void handleConfirmExport();
              }}
            >
              Start export
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
