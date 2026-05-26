/**
 * NewsletterSettings.tsx — Research newsletter opt-in toggle in Settings.
 *
 * Phase 60 Plan 60-12 Task 3.
 *
 * CAN-SPAM affirmative opt-in: default state is ALWAYS OFF/unchecked.
 * Per CONTEXT.md D-26 + UI-SPEC §Critical UI Invariant #9, the CAN-SPAM
 * affirmative opt-in rule OVERRIDES any legacy "default ON for paid users"
 * behavior. The DB also defaults opted_in=false.
 *
 * The server-managed rotation token is intentionally absent from all reads
 * and writes in this component (T-60-12-04 defense-in-depth).
 */

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Pill, PillGroup } from '@/components/ui/Pill';
import { useToast } from '@/hooks/useToast';
import {
  getNewsletterSubscription,
  setNewsletterOptIn,
  type NewsletterSubscription,
} from '@/lib/rag/newsletter-api';
import { useStore } from '@/lib/store';

// ─── Fallback topic tags ────────────────────────────────────────────────────
// Used when kb_topics table is not yet accessible from the client-side.
// Follow-up: wire to kb_topics distinct values query (tracked in SUMMARY.md).
const FALLBACK_TOPIC_TAGS = [
  'glp-1',
  'peptide-research',
  'off-label-safety',
  'metabolic-health',
] as const;

// ─── Component ──────────────────────────────────────────────────────────────

export function NewsletterSettings() {
  const { t } = useTranslation(['rag', 'common']);
  const toast = useToast();
  const signedIn = useStore((s) => s.signedIn);
  const userId = signedIn?.user?.id ?? '';

  const [subscription, setSubscription] = useState<NewsletterSubscription | null>(null);
  const [loading, setLoading] = useState(true);

  // Local draft state
  const [draftOptedIn, setDraftOptedIn] = useState(false);
  const [draftTopicTags, setDraftTopicTags] = useState<string[]>([]);

  // Save state
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Load current subscription
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    void (async () => {
      setLoading(true);
      try {
        const sub = await getNewsletterSubscription(userId);
        if (cancelled) return;
        setSubscription(sub);
        // CAN-SPAM: initial state matches what was persisted (default false from DB)
        setDraftOptedIn(sub.opted_in);
        setDraftTopicTags(sub.topic_tags ?? []);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const handleToggle = () => {
    setDraftOptedIn((v) => !v);
    setSaveError(null);
  };

  const handleTopicToggle = (tag: string) => {
    setDraftTopicTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag],
    );
  };

  const handleSave = async () => {
    if (!userId) return;
    setSaving(true);
    setSaveError(null);
    try {
      const updated = await setNewsletterOptIn({
        userId,
        optedIn: draftOptedIn,
        // Only pass topicTags when opting in; preserve existing when opting out
        ...(draftOptedIn ? { topicTags: draftTopicTags } : {}),
      });
      setSubscription(updated);
      setDraftOptedIn(updated.opted_in);
      setDraftTopicTags(updated.topic_tags ?? []);
      toast('Saved', 'success');
    } catch {
      setSaveError("Couldn't save preferences. Try again.");
    } finally {
      setSaving(false);
    }
  };

  // Show skeleton while loading
  if (loading) {
    return (
      <div className="space-y-4">
        <div className="h-5 w-40 bg-[var(--color-surface-elevated)] rounded animate-pulse" />
        <div className="h-12 bg-[var(--color-surface-elevated)] rounded animate-pulse" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Section heading — per UI-SPEC §Typography: text-lg / 600 */}
      <h2 className="text-lg font-semibold">{t('rag:newsletter.section_heading')}</h2>

      {/* Toggle row */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <span className="text-sm font-medium">{t('rag:newsletter.toggle_label')}</span>
          <span className="text-sm text-[var(--color-text-secondary)]">
            {t('rag:newsletter.toggle_sublabel')}
          </span>
        </div>
        {/* Role=switch is the accessible toggle per WAI-ARIA */}
        <button
          type="button"
          role="switch"
          aria-checked={draftOptedIn}
          aria-label={t('rag:newsletter.toggle_label')}
          onClick={handleToggle}
          className={
            'flex-shrink-0 inline-flex items-center justify-center w-11 h-6 rounded-full transition-colors ' +
            (draftOptedIn
              ? 'bg-[var(--color-primary)]'
              : 'bg-[var(--color-surface-elevated)] border border-[var(--color-border)]')
          }
        >
          <span
            className={
              'inline-block size-5 rounded-full bg-white transition-transform ' +
              (draftOptedIn ? 'translate-x-2' : '-translate-x-2')
            }
            aria-hidden
          />
        </button>
      </div>

      {/* Topic-tag multi-select — visible when opted in */}
      {draftOptedIn && (
        <div className="space-y-2">
          <p className="text-sm font-semibold text-[var(--color-text-secondary)]">
            Topics
          </p>
          <PillGroup>
            {FALLBACK_TOPIC_TAGS.map((tag) => (
              <Pill
                key={tag}
                role="checkbox"
                aria-checked={draftTopicTags.includes(tag)}
                active={draftTopicTags.includes(tag)}
                onClick={() => handleTopicToggle(tag)}
              >
                {tag}
              </Pill>
            ))}
          </PillGroup>
          {/* Also render any existing topic_tags from the subscription that aren't in FALLBACK */}
          {(subscription?.topic_tags ?? [])
            .filter((tag) => !(FALLBACK_TOPIC_TAGS as readonly string[]).includes(tag))
            .map((tag) => (
              <Pill
                key={tag}
                role="checkbox"
                aria-checked={draftTopicTags.includes(tag)}
                active={draftTopicTags.includes(tag)}
                onClick={() => handleTopicToggle(tag)}
              >
                {tag}
              </Pill>
            ))}
        </div>
      )}

      {/* Save button */}
      <Button
        variant="primary"
        aria-busy={saving}
        disabled={saving}
        onClick={() => void handleSave()}
      >
        {t('rag:newsletter.save_cta')}
      </Button>

      {/* Inline error — not a toast per plan (saves context below the button) */}
      {saveError && (
        <p className="text-sm text-[var(--color-danger)]">{saveError}</p>
      )}
    </div>
  );
}
