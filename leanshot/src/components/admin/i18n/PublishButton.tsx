/**
 * Phase 32 Plan 32-04 — Publish/Unpublish button for the LocaleOverridesModule.
 *
 * Click handler:
 *   1. publishOverride(id) flips published=true (RLS-gated admin write).
 *   2. broadcastPublish sends a redundant Realtime broadcast on the
 *      locale_overrides:{orgId|global} channel.
 *   3. onPublished() lets the parent module refresh the row list.
 *
 * The Realtime postgres_changes event also fires on the UPDATE; the broadcast
 * is a redundant signal so a client whose channel may have dropped the row
 * still invalidates. Per feedback_realtime_layer_e2e_pattern.md.
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { broadcastPublish, publishOverride } from './locale-overrides-client';

interface PublishButtonProps {
  overrideId: string;
  lng: 'en' | 'es';
  ns: string;
  orgId: string | null;
  onPublished: () => void;
  disabled?: boolean;
}

export function PublishButton({
  overrideId,
  lng,
  ns,
  orgId,
  onPublished,
  disabled,
}: PublishButtonProps) {
  const { t } = useTranslation('admin');
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    setPublishing(true);
    setError(null);
    try {
      await publishOverride(overrideId);
      // Best-effort broadcast — don't fail the publish if the channel is wonky.
      try {
        await broadcastPublish({ lng, ns, orgId });
      } catch (e) {
        console.warn('[i18n] broadcast failed (publish still succeeded)', e);
      }
      onPublished();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPublishing(false);
    }
  }

  return (
    <div className="inline-flex items-center gap-2">
      <button
        type="button"
        disabled={disabled || publishing}
        onClick={() => {
          void handleClick();
        }}
        aria-busy={publishing}
        className="text-sm font-semibold text-[var(--color-primary)] hover:underline disabled:opacity-50"
      >
        {publishing
          ? t('i18n_overrides.publishing', 'Publishing…')
          : t('i18n_overrides.publish_button', 'Publish')}
      </button>
      {error && (
        <span role="alert" className="text-xs text-[var(--color-error,red)]">
          {error}
        </span>
      )}
    </div>
  );
}

export default PublishButton;
