/**
 * Phase 10 Plan 10-09 — PatientActivityModal.
 *
 * Fills the Phase 9 D-15 stub "View activity" on Active Organizations rows.
 * Renders a two-tab modal (Operator views / Ranking events) with 25-row
 * pagination. Focus is returned to the trigger button on close.
 *
 * SECURITY (D-19): This component deliberately does NOT call posthog.capture.
 * The patient-side mirror modal is a transparency surface under HBNR/WMHMDA.
 * Meta-auditing patient transparency views would be surveillance theater.
 *
 * HBNR/WMHMDA defensible footer is ALWAYS visible at the bottom regardless of
 * the active tab (T-10-09-02 mitigation).
 */

import { type RefObject, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { Modal } from '@/components/ui/Modal';
import { Skeleton } from '@/components/ui/Skeleton';
import { PatientActivityRow } from './PatientActivityRow';
import { type ActivityTab, usePatientActivity } from './use-patient-activity';

interface PatientActivityModalProps {
  orgId: string;
  orgName: string;
  onClose: () => void;
  /** Ref to the trigger element — focus is returned on close (D-19 focus discipline). */
  triggerRef?: RefObject<HTMLElement | null>;
}

const TABS: { id: ActivityTab; label: string }[] = [
  { id: 'operator_views', label: 'Operator views' },
  { id: 'ranking_events', label: 'Ranking events' },
];

const LIMIT = 25;

interface TabPanelProps {
  orgId: string;
  orgName: string;
  tab: ActivityTab;
  offset: number;
  onPrev: () => void;
  onNext: () => void;
  onRetry: () => void;
}

function TabPanel({ orgId, orgName, tab, offset, onPrev, onNext, onRetry }: TabPanelProps) {
  const { rows, loading, error, hasMore, total } = usePatientActivity({
    orgId,
    tab,
    offset,
    limit: LIMIT,
  });

  const start = offset + 1;
  const end = offset + rows.length;

  if (loading) {
    return (
      <div className="space-y-2 py-2" role="status" aria-live="polite" aria-busy>
        <Skeleton className="h-10 w-full rounded-lg" />
        <Skeleton className="h-10 w-full rounded-lg" />
        <Skeleton className="h-10 w-full rounded-lg" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="py-6 text-center space-y-3">
        <p className="text-[14px] text-[var(--color-text-secondary)]">
          Couldn&apos;t load activity. Check your connection and try again.
        </p>
        <Button size="sm" onClick={onRetry}>
          Retry
        </Button>
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <EmptyState
        inline
        title={
          tab === 'operator_views'
            ? 'No views from this workspace yet.'
            : "Your data hasn't triggered any clinical-attention flags from this workspace."
        }
        body=""
      />
    );
  }

  return (
    <div>
      <div role="list">
        {rows.map((row) => (
          <PatientActivityRow key={row.id} row={row} orgName={orgName} />
        ))}
      </div>

      {/* Pagination footer */}
      {total > LIMIT && (
        <div className="flex items-center justify-between pt-3 mt-3 border-t border-[var(--color-border)]">
          <span className="text-[13px] text-[var(--color-text-secondary)]">
            Showing {start}–{end} of {total}
          </span>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="ghost"
              disabled={offset === 0}
              onClick={onPrev}
              leadingIcon={<ChevronLeft className="size-4" />}
              aria-label="Previous page"
            >
              Previous
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={!hasMore}
              onClick={onNext}
              aria-label="Next page"
            >
              Next
              <ChevronRight className="size-4 ml-1" aria-hidden />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

export function PatientActivityModal({
  orgId,
  orgName,
  onClose,
  triggerRef,
}: PatientActivityModalProps) {
  const [activeTab, setActiveTabRaw] = useState<ActivityTab>('operator_views');
  const [offset, setOffset] = useState(0);
  const retryRef = useRef<(() => void) | null>(null);

  function setActiveTab(tab: ActivityTab) {
    setActiveTabRaw(tab);
    setOffset(0); // Reset pagination on tab change
  }

  const handleClose = () => {
    onClose();
    // Return focus to the trigger element after the modal unmounts
    window.setTimeout(() => {
      triggerRef?.current?.focus();
    }, 50);
  };

  const handlePrev = () => setOffset((o) => Math.max(0, o - LIMIT));
  const handleNext = () => setOffset((o) => o + LIMIT);
  const handleRetry = () => retryRef.current?.();

  return (
    <Modal
      open
      onClose={handleClose}
      title={`Activity from ${orgName}`}
      size="lg"
      mobileFullscreen
    >
      <div className="space-y-4">
        {/* Subtitle */}
        <p className="text-[13px] text-[var(--color-text-secondary)] leading-snug">
          Every time someone from this workspace accessed your data. We keep this log for 13
          months.
        </p>

        {/* Tab nav */}
        <div
          role="tablist"
          aria-label="Activity tabs"
          className="flex gap-1 border-b border-[var(--color-border)]"
        >
          {TABS.map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={activeTab === t.id}
              aria-controls={`activity-panel-${t.id}`}
              id={`activity-tab-${t.id}`}
              type="button"
              onClick={() => setActiveTab(t.id)}
              className={[
                'px-4 py-2 text-[13px] font-medium rounded-t-lg transition-colors',
                activeTab === t.id
                  ? 'text-[var(--color-primary)] border-b-2 border-[var(--color-primary)] -mb-px'
                  : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text)]',
              ].join(' ')}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Tab body context description */}
        <p className="text-[13px] text-[var(--color-text-secondary)] leading-snug">
          {activeTab === 'operator_views'
            ? `Each row shows when a member of ${orgName} viewed a part of your data.`
            : "When this workspace's ranking flags your data for clinical attention, the event appears here. You can ask the clinic for the breakdown of any flag."}
        </p>

        {/* Tab panels */}
        {TABS.map((t) => (
          <div
            key={t.id}
            role="tabpanel"
            id={`activity-panel-${t.id}`}
            aria-labelledby={`activity-tab-${t.id}`}
            hidden={activeTab !== t.id}
          >
            {activeTab === t.id && (
              <TabPanel
                orgId={orgId}
                orgName={orgName}
                tab={t.id}
                offset={offset}
                onPrev={handlePrev}
                onNext={handleNext}
                onRetry={handleRetry}
              />
            )}
          </div>
        ))}

        {/* HBNR/WMHMDA defensible footer — always visible (T-10-09-02 + UI-SPEC L318) */}
        <div
          className="mt-4 pt-4 border-t border-[var(--color-border)]"
          data-testid="hbnr-footer"
        >
          <p className="text-[12px] text-[var(--color-text-secondary)] leading-relaxed">
            LeanShot keeps a complete record of every access. If you&apos;d like to request a copy
            or contest an entry, contact {orgName} directly or email{' '}
            <a
              href="mailto:support@leanshot.app"
              className="underline underline-offset-2 hover:text-[var(--color-text)] transition-colors"
            >
              support@leanshot.app
            </a>
            .
          </p>
        </div>
      </div>
    </Modal>
  );
}

