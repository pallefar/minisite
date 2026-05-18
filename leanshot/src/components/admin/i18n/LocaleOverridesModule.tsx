/**
 * Phase 32 Plan 32-04 I18N-08 — Admin "Locale Overrides" module.
 *
 * Surface: filter bar (lng + ns + key search) + list table + inline editor.
 * Per CONTEXT D-08: hot-patch translations per-org or globally without a
 * redeploy. Per Phase 24 D-05 / minRole='admin': RLS gates writes; this
 * UI is a thin wrapper over locale-overrides-client.
 *
 * Status-machine ownership (single-writer rule):
 *   - draft → published: ONLY via PublishButton (publishOverride).
 *   - published → draft: via OverrideEditor save with published=false.
 *   - delete: via the row's Delete action.
 *
 * No URL routing required — the module is mounted by AdminShell when the
 * pathname matches /admin/i18n-overrides (per ADMIN_MODULES.route).
 *
 * XSS mitigation (T-32-04-01): the value column is rendered as plain text via
 * React JSX — NEVER innerHTML / dangerouslySetInnerHTML. The OverrideEditor's
 * textarea also stays plain-text. CSP `script-src 'self'` is the depth gate
 * (Phase 12).
 */
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, CardHeader } from '@/components/ui/Card';
import {
  deleteOverride,
  listOverrides,
  upsertOverride,
  type OverrideRow,
  type OverrideUpsertInput,
} from './locale-overrides-client';
import { OverrideEditor } from './OverrideEditor';
import { PublishButton } from './PublishButton';

const LANGUAGES = ['', 'en', 'es'] as const;
const NAMESPACES = ['', 'common', 'nav', 'admin', 'clinic', 'kb', 'onboarding', 'patient', 'settings'] as const;

export default function LocaleOverridesModule() {
  const { t } = useTranslation('admin');
  const [lngFilter, setLngFilter] = useState<'' | 'en' | 'es'>('');
  const [nsFilter, setNsFilter] = useState<string>('');
  const [keySearch, setKeySearch] = useState<string>('');
  const [rows, setRows] = useState<OverrideRow[]>([]);
  const [editing, setEditing] = useState<OverrideRow | 'new' | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await listOverrides({
        lng: lngFilter === '' ? undefined : lngFilter,
        ns: nsFilter === '' ? undefined : nsFilter,
        keySearch: keySearch === '' ? undefined : keySearch,
      });
      setRows(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [lngFilter, nsFilter, keySearch]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function handleSave(input: OverrideUpsertInput) {
    await upsertOverride(input);
    setEditing(null);
    await refresh();
  }

  async function handleDelete(id: string) {
    if (!confirm(t('i18n_overrides.delete_confirm', 'Delete this override permanently?'))) {
      return;
    }
    try {
      await deleteOverride(id);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div className="space-y-4 max-w-5xl">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold text-[var(--color-text)]">
          {t('i18n_overrides.title', 'Locale Overrides')}
        </h1>
        <p className="text-sm text-[var(--color-text-secondary)]">
          {t('i18n_overrides.subtitle', 'Hot-patch translations per-org or globally without redeploying.')}
        </p>
      </header>

      <Card variant="flat" padding="lg">
        <CardHeader title={t('i18n_overrides.filter_title', 'Filter')} />
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mt-3">
          <label className="text-sm">
            <span className="block mb-1 text-xs font-semibold text-[var(--color-text-secondary)]">
              {t('i18n_overrides.lng_label', 'Language')}
            </span>
            <select
              value={lngFilter}
              onChange={(e) => setLngFilter(e.target.value as '' | 'en' | 'es')}
              className="w-full px-2 py-1.5 rounded border border-[var(--color-border)] bg-[var(--color-surface)]"
            >
              {LANGUAGES.map((l) => (
                <option key={l} value={l}>
                  {l === '' ? t('i18n_overrides.any', 'Any') : l}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            <span className="block mb-1 text-xs font-semibold text-[var(--color-text-secondary)]">
              {t('i18n_overrides.ns_label', 'Namespace')}
            </span>
            <select
              value={nsFilter}
              onChange={(e) => setNsFilter(e.target.value)}
              className="w-full px-2 py-1.5 rounded border border-[var(--color-border)] bg-[var(--color-surface)]"
            >
              {NAMESPACES.map((n) => (
                <option key={n} value={n}>
                  {n === '' ? t('i18n_overrides.any', 'Any') : n}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm md:col-span-2">
            <span className="block mb-1 text-xs font-semibold text-[var(--color-text-secondary)]">
              {t('i18n_overrides.key_search_label', 'Key search')}
            </span>
            <input
              type="text"
              value={keySearch}
              onChange={(e) => setKeySearch(e.target.value)}
              placeholder={t('i18n_overrides.key_search_placeholder', 'e.g. hero.cta')}
              className="w-full px-2 py-1.5 rounded border border-[var(--color-border)] bg-[var(--color-surface)] font-mono text-sm"
            />
          </label>
        </div>
        <div className="mt-3 flex items-center gap-2">
          <button
            type="button"
            onClick={() => setEditing('new')}
            className="px-3 py-1.5 rounded bg-[var(--color-primary)] text-[var(--color-primary-foreground)] text-sm font-semibold"
          >
            {t('i18n_overrides.new_button', 'New override')}
          </button>
          {loading && (
            <span className="text-xs text-[var(--color-text-secondary)]">
              {t('i18n_overrides.loading', 'Loading…')}
            </span>
          )}
        </div>
      </Card>

      {error && (
        <p role="alert" className="text-sm text-[var(--color-error,red)]">{error}</p>
      )}

      {editing && (
        <Card variant="elevated" padding="lg">
          <CardHeader
            title={
              editing === 'new'
                ? t('i18n_overrides.new_title', 'New override')
                : t('i18n_overrides.edit_title', 'Edit override')
            }
          />
          <div className="mt-3">
            <OverrideEditor
              override={editing === 'new' ? undefined : editing}
              onSave={handleSave}
              onCancel={() => setEditing(null)}
            />
          </div>
        </Card>
      )}

      <Card variant="flat" padding="lg">
        <CardHeader title={t('i18n_overrides.list_title', 'Overrides')} />
        {rows.length === 0 ? (
          <p className="mt-3 text-sm text-[var(--color-text-secondary)]">
            {t('i18n_overrides.empty', 'No overrides found.')}
          </p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-[var(--color-text-secondary)] border-b border-[var(--color-border)]">
                  <th className="py-2 pr-3">{t('i18n_overrides.col_lng', 'Lng')}</th>
                  <th className="py-2 pr-3">{t('i18n_overrides.col_ns', 'NS')}</th>
                  <th className="py-2 pr-3">{t('i18n_overrides.col_key', 'Key')}</th>
                  <th className="py-2 pr-3">{t('i18n_overrides.col_value', 'Value')}</th>
                  <th className="py-2 pr-3">{t('i18n_overrides.col_scope', 'Scope')}</th>
                  <th className="py-2 pr-3">{t('i18n_overrides.col_status', 'Status')}</th>
                  <th className="py-2">{t('i18n_overrides.col_actions', 'Actions')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className="border-b border-[var(--color-border)]">
                    <td className="py-2 pr-3 font-mono text-xs">{row.lng}</td>
                    <td className="py-2 pr-3 font-mono text-xs">{row.ns}</td>
                    <td className="py-2 pr-3 font-mono text-xs">{row.key}</td>
                    {/* Plain text only — see T-32-04-01 mitigation in module header */}
                    <td className="py-2 pr-3 max-w-xs truncate" title={row.value}>{row.value}</td>
                    <td className="py-2 pr-3 text-xs">
                      {row.org_id
                        ? t('i18n_overrides.org_scope', 'Org')
                        : t('i18n_overrides.global_scope_short', 'Global')}
                    </td>
                    <td className="py-2 pr-3 text-xs">
                      {row.published
                        ? t('i18n_overrides.published_label', 'Published')
                        : t('i18n_overrides.draft_label', 'Draft')}
                    </td>
                    <td className="py-2 space-x-2 whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => setEditing(row)}
                        className="text-xs font-semibold text-[var(--color-primary)] hover:underline"
                      >
                        {t('i18n_overrides.edit_button', 'Edit')}
                      </button>
                      {!row.published && (
                        <PublishButton
                          overrideId={row.id}
                          lng={row.lng}
                          ns={row.ns}
                          orgId={row.org_id}
                          onPublished={() => { void refresh(); }}
                        />
                      )}
                      <button
                        type="button"
                        onClick={() => { void handleDelete(row.id); }}
                        className="text-xs font-semibold text-red-500 hover:underline"
                      >
                        {t('i18n_overrides.delete_button', 'Delete')}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
