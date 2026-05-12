/**
 * Phase 6 Plan 06-02 — foreground blocking modal for the leanshot_v4 → cloud
 * migration. Per 06-UI-SPEC §1:
 *
 *   Fresh:    title "Migrating your data" + subtitle + entity-row list +
 *             "Continue with sync running" escape CTA.
 *   Resume:   title "Resuming migration" + subtitle "Picking up where we left
 *             off — X of Y sections done." + entity-row list + escape CTA.
 *   Complete: title "All done" + success illustration + "Continue to dashboard" CTA.
 *   Error:    title "Something went wrong" + retry CTA (only "corrupted" in v1).
 *
 * Gating contract: caller (App.tsx) renders this iff `migration_state != null`
 * OR `migrationError != null`. Net-new users hit neither so the modal never
 * mounts. The lazy chunk in App.tsx ensures net-new users don't pay the JS
 * cost either.
 */
import { CheckCircle2 } from 'lucide-react';
import { useMemo } from 'react';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { ENTITIES, type Entity } from '@/lib/migration';
import { useStore } from '@/lib/store';
import { MigrationEntityRow, type MigrationEntityRowStatus } from './MigrationEntityRow';

const ENTITY_NAMES: Record<Entity, string> = {
  photos: 'Photos',
  injections: 'Injections',
  weights: 'Weights',
  meals: 'Meals',
  workouts: 'Workouts',
  supplements: 'Supplements',
  mood: 'Mood entries',
  sleep: 'Sleep entries',
  symptoms: 'Symptoms',
  vials: 'Vials',
  settings: 'Settings',
};

export interface MigrationModalProps {
  /** Called when the user dismisses (mid-flight escape OR post-complete acknowledgement). */
  onContinue: () => void;
  /** Called when the user taps "Retry migration" on the corruption banner. */
  onRetry: () => void;
}

export function MigrationModal({ onContinue, onRetry }: MigrationModalProps) {
  const migration = useStore((s) => s.migration_state);
  const error = useStore((s) => s.migrationError);

  const doneCount = useMemo(() => {
    if (!migration) return 0;
    return ENTITIES.filter((e) => migration[e] === 'complete').length;
  }, [migration]);

  // Don't render when there's no migration to show.
  if (!migration && !error) return null;

  const isCorrupted = error === 'corrupted';
  const isComplete = migration?.complete === true;
  // "Resume" mode shows when at least one entity has finished but the overall
  // migration is not yet complete (i.e. we're picking up from a prior session).
  const isResume = !!migration && doneCount > 0 && !migration.complete;

  const title = isCorrupted
    ? 'Something went wrong'
    : isComplete
      ? 'All done'
      : isResume
        ? 'Resuming migration'
        : 'Migrating your data';

  return (
    <Modal open dismissible={false} hideClose title={title} size="md" onClose={onContinue}>
      {isCorrupted ? (
        <div className="flex flex-col gap-4 py-2">
          <p className="text-[14px] text-[var(--color-text-secondary)]">
            Your data is safe in the backup we saved before starting. Tap retry, or contact support
            if this keeps happening.
          </p>
          <Button onClick={onRetry} variant="primary" block>
            Retry migration
          </Button>
        </div>
      ) : isComplete ? (
        <div className="flex flex-col gap-5 text-center py-6">
          <CheckCircle2 className="size-12 mx-auto text-[var(--color-success)]" aria-hidden />
          <p className="text-[14px] text-[var(--color-text-secondary)]">
            Your history is safe in the cloud. You can now sync across devices.
          </p>
          <Button onClick={onContinue} variant="primary" block>
            Continue to dashboard
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <p className="text-[14px] text-[var(--color-text-secondary)]">
            {isResume
              ? `Picking up where we left off — ${doneCount} of ${ENTITIES.length} sections done.`
              : 'Saving your history to your account. This should take less than a minute.'}
          </p>
          <ol aria-label="Migration progress" className="flex flex-col">
            {ENTITIES.map((entity) => {
              const status: MigrationEntityRowStatus =
                (migration?.[entity] as MigrationEntityRowStatus | undefined) ?? 'pending';
              return (
                <MigrationEntityRow key={entity} name={ENTITY_NAMES[entity]} status={status} />
              );
            })}
          </ol>
          {/* aria-live transition-only announcer per 06-UI-SPEC §1 a11y — fires
              one polite announcement per state-mode change, not on every count
              tick (which would be SR spam). */}
          <span role="status" aria-live="polite" className="sr-only">
            {isResume ? 'Resuming migration' : 'Migrating your data'}
          </span>
          <Button onClick={onContinue} variant="ghost" block>
            Continue with sync running
          </Button>
        </div>
      )}
    </Modal>
  );
}
