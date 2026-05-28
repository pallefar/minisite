/**
 * Phase 32 Plan 32-04 — Inline editor for locale_overrides rows.
 *
 * Form fields:
 *   - lng:  en | es (CHECK constraint at DB layer)
 *   - ns:   text (the 8 namespaces from public/locales/en/*.json)
 *   - key:  dotted-path (e.g. 'hero.cta.log_dose')
 *   - value: plain text (NEVER rendered as HTML — see T-32-04-01 mitigation)
 *   - orgId: optional (NULL = global)
 *   - published: checkbox (default false = draft)
 *
 * Per CONTEXT D-10: lng is the 2-letter union ('en' | 'es') only — no
 * region-tagged values (es-MX, es-419) leak into the table.
 *
 * Per T-32-04-01 (XSS mitigation): the form never renders the value as HTML
 * preview. i18next + React escape interpolation; the admin sees a plain
 * textarea only.
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { OverrideRow, OverrideUpsertInput } from './locale-overrides-client';

const NAMESPACES = [
  'common',
  'nav',
  'admin',
  'clinic',
  'kb',
  'onboarding',
  'patient',
  'settings',
] as const;

interface OverrideEditorProps {
  override?: OverrideRow;
  /** orgs the current admin can scope overrides to; pass [] for system-superadmin (globals only). */
  availableOrgs?: { id: string; name: string }[];
  onSave: (input: OverrideUpsertInput) => Promise<void>;
  onCancel: () => void;
}

export function OverrideEditor({
  override,
  availableOrgs = [],
  onSave,
  onCancel,
}: OverrideEditorProps) {
  const { t } = useTranslation('admin');
  const [lng, setLng] = useState<'en' | 'es'>(override?.lng ?? 'en');
  const [ns, setNs] = useState<string>(override?.ns ?? 'common');
  const [key, setKey] = useState<string>(override?.key ?? '');
  const [value, setValue] = useState<string>(override?.value ?? '');
  const [orgId, setOrgId] = useState<string | null>(override?.org_id ?? null);
  const [published, setPublished] = useState<boolean>(override?.published ?? false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await onSave({
        id: override?.id,
        lng,
        ns,
        key,
        value,
        orgId,
        published,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="space-y-3 p-4 bg-[var(--color-surface-elevated)] rounded-lg"
    >
      <div className="grid grid-cols-2 gap-3">
        <label className="text-sm">
          <span className="block mb-1 text-xs font-semibold text-[var(--color-text-secondary)]">
            {t('i18n_overrides.lng_label', 'Language')}
          </span>
          <select
            value={lng}
            onChange={(e) => setLng(e.target.value as 'en' | 'es')}
            className="w-full px-2 py-1.5 rounded border border-[var(--color-border)] bg-[var(--color-surface)]"
            aria-label={t('i18n_overrides.lng_label', 'Language')}
          >
            <option value="en">English (en)</option>
            <option value="es">Español (es)</option>
          </select>
        </label>
        <label className="text-sm">
          <span className="block mb-1 text-xs font-semibold text-[var(--color-text-secondary)]">
            {t('i18n_overrides.ns_label', 'Namespace')}
          </span>
          <select
            value={ns}
            onChange={(e) => setNs(e.target.value)}
            className="w-full px-2 py-1.5 rounded border border-[var(--color-border)] bg-[var(--color-surface)]"
            aria-label={t('i18n_overrides.ns_label', 'Namespace')}
          >
            {NAMESPACES.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label className="block text-sm">
        <span className="block mb-1 text-xs font-semibold text-[var(--color-text-secondary)]">
          {t('i18n_overrides.key_label', 'Key (dotted path)')}
        </span>
        <input
          type="text"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          required
          placeholder={t('i18n_overrides.key_placeholder', 'namespace:section.element')}
          className="w-full px-2 py-1.5 rounded border border-[var(--color-border)] bg-[var(--color-surface)] font-mono text-sm"
        />
      </label>

      <label className="block text-sm">
        <span className="block mb-1 text-xs font-semibold text-[var(--color-text-secondary)]">
          {t('i18n_overrides.value_label', 'Value (translation text)')}
        </span>
        <textarea
          value={value}
          onChange={(e) => setValue(e.target.value)}
          required
          rows={3}
          placeholder={t('i18n_overrides.value_placeholder', 'Translation text')}
          className="w-full px-2 py-1.5 rounded border border-[var(--color-border)] bg-[var(--color-surface)]"
        />
      </label>

      <label className="block text-sm">
        <span className="block mb-1 text-xs font-semibold text-[var(--color-text-secondary)]">
          {t('i18n_overrides.scope_label', 'Scope')}
        </span>
        <select
          value={orgId ?? ''}
          onChange={(e) => setOrgId(e.target.value === '' ? null : e.target.value)}
          className="w-full px-2 py-1.5 rounded border border-[var(--color-border)] bg-[var(--color-surface)]"
        >
          <option value="">{t('i18n_overrides.global_scope', 'Global (all orgs)')}</option>
          {availableOrgs.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>
      </label>

      <label className="inline-flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={published}
          onChange={(e) => setPublished(e.target.checked)}
        />
        <span>{t('i18n_overrides.publish_immediately', 'Publish immediately')}</span>
      </label>

      {error && (
        <p role="alert" className="text-xs text-[var(--color-error,red)]">
          {error}
        </p>
      )}

      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={saving}
          aria-busy={saving}
          className="px-3 py-1.5 rounded bg-[var(--color-primary)] text-[var(--color-primary-foreground)] text-sm font-semibold disabled:opacity-50"
        >
          {saving ? t('i18n_overrides.saving', 'Saving…') : t('i18n_overrides.save_button', 'Save')}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="px-3 py-1.5 rounded border border-[var(--color-border)] text-sm"
        >
          {t('i18n_overrides.cancel_button', 'Cancel')}
        </button>
      </div>
    </form>
  );
}

export default OverrideEditor;
