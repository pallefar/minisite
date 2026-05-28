/**
 * Phase 15 Plan 08 — SiteSettingsPanel.
 *
 * /admin staff-only editor for the global `site_settings` singleton row
 * (D-15). The renderer's SEO cascade reads this row for site_name,
 * default_description, default_og_image, and favicon_url; per-page SEO
 * fields override these defaults on a published page basis.
 *
 * SECURITY POSTURE — T-15-08-04:
 *   The client `is_staff` render gate below is UX-only. The AUTHORITATIVE
 *   write protection is Postgres RLS on `public.site_settings`
 *   (migration 20261101000007 — `pol_site_settings_staff_update` /
 *   `pol_site_settings_staff_insert`, both gated by `public.is_staff()`).
 *
 *   This component writes through the NORMAL authenticated supabase client
 *   (`import { supabase }`). The write path is RLS-enforced from the
 *   browser — no privileged bypass anywhere in this module. A non-staff
 *   user who reaches this UI (by URL or DOM manipulation) cannot persist
 *   a change — Postgres rejects the update.
 *
 * UX:
 *   - Site name (Input)
 *   - Default meta description (Textarea)
 *   - Default OG image — AssetLibraryPicker trigger
 *   - Favicon URL (Input — supports any same-origin asset URL)
 *   - Save button with role=status + aria-live=polite save indicator.
 *
 *   On save failure: UI-SPEC error copy
 *   ("Couldn't save changes. Check your connection and try again.").
 */
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input, Textarea } from '@/components/ui/Input';
import { supabase } from '@/lib/supabase';
import { AssetLibraryPicker, type AssetSelection } from './AssetLibraryPicker';

interface SiteSettingsRow {
  id?: string;
  site_name: string;
  default_description: string;
  favicon_url: string;
  default_og_image: string;
}

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

const EMPTY: SiteSettingsRow = {
  site_name: '',
  default_description: '',
  favicon_url: '',
  default_og_image: '',
};

export function SiteSettingsPanel() {
  // Render-gate state: undefined = unknown, true = staff, false = not staff.
  // The undefined → boolean transition skips the brief "not staff" flicker
  // while the initial profiles query is in flight.
  const [isStaff, setIsStaff] = useState<boolean | undefined>(undefined);
  const [row, setRow] = useState<SiteSettingsRow>(EMPTY);
  const [rowId, setRowId] = useState<string | undefined>(undefined);
  const [loaded, setLoaded] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [pickerOpen, setPickerOpen] = useState(false);

  // Initial load: resolve is_staff + fetch the singleton site_settings row.
  // The authenticated supabase client RLS-enforces both queries.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Resolve is_staff. The Edge Function gate is the security boundary;
      // this client read is UX-only and may be denied by RLS for the row
      // itself — but profiles.select('is_staff').eq('id', me) is gated by
      // the standard profiles RLS so the user can read their own row.
      const { data: userData } = await supabase.auth.getUser();
      const uid = userData?.user?.id;
      if (!uid) {
        if (!cancelled) setIsStaff(false);
        return;
      }
      const { data: profile } = await supabase
        .from('profiles')
        .select('is_staff')
        .eq('id', uid)
        .maybeSingle();
      const staff = (profile as { is_staff?: boolean } | null)?.is_staff === true;
      if (cancelled) return;
      setIsStaff(staff);
      if (!staff) return;

      // Load the singleton site_settings row.
      const { data: settings } = await supabase
        .from('site_settings')
        .select('id, site_name, default_description, favicon_url, default_og_image')
        .limit(1)
        .maybeSingle();
      if (cancelled) return;
      if (settings) {
        const s = settings as Partial<SiteSettingsRow> & { id?: string };
        setRow({
          site_name: s.site_name ?? '',
          default_description: s.default_description ?? '',
          favicon_url: s.favicon_url ?? '',
          default_og_image: s.default_og_image ?? '',
        });
        setRowId(s.id);
      }
      setLoaded(true);
    })().catch(() => {
      if (!cancelled) setIsStaff(false);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const update = (patch: Partial<SiteSettingsRow>): void => {
    setRow((prev) => ({ ...prev, ...patch }));
  };

  const handleSave = async (): Promise<void> => {
    setSaveState('saving');
    try {
      // Upsert against the singleton. If a row already exists, update it by
      // id; otherwise insert. RLS gates both paths via is_staff().
      const payload: SiteSettingsRow & { id?: string } = rowId ? { ...row, id: rowId } : { ...row };
      const { error } = await supabase.from('site_settings').upsert(payload, { onConflict: 'id' });
      if (error) {
        setSaveState('error');
        return;
      }
      setSaveState('saved');
    } catch {
      setSaveState('error');
    }
  };

  if (isStaff === undefined) {
    // Initial probe — render nothing rather than flash a "not authorized"
    // message to a staff user whose `auth.getUser()` is still resolving.
    return null;
  }

  if (!isStaff) {
    return (
      <Card variant="flat" padding="md" className="m-6">
        <p className="text-[13px] text-[var(--color-text-secondary)]">
          You don&apos;t have access to site settings.
        </p>
      </Card>
    );
  }

  return (
    <div className="m-6 flex flex-col gap-4 max-w-2xl">
      <header>
        <h1 className="text-[20px] font-semibold tracking-tight">Site settings</h1>
        <p className="text-[13px] text-[var(--color-text-secondary)]">
          These defaults flow into every published landing page. Per-page SEO fields override them
          when set.
        </p>
      </header>

      <Card variant="flat" padding="md" className="flex flex-col gap-4">
        <Input
          label="Site name"
          hint="Appears suffixed to every page <title>."
          value={row.site_name}
          onChange={(e) => update({ site_name: e.target.value })}
        />

        <Textarea
          label="Default meta description"
          hint="Used when a page leaves Meta description blank."
          rows={3}
          value={row.default_description}
          onChange={(e) => update({ default_description: e.target.value })}
        />

        <div className="flex flex-col gap-1.5">
          {/* Field group label — the only interactive control is the
              "Choose default OG image" button whose aria-label carries the
              field's accessible name. */}
          <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--color-text-secondary)]">
            Default OG image
          </p>
          <p className="text-[12px] text-[var(--color-text-secondary)]">
            1200×630 recommended. Used when a page leaves OG image blank.
          </p>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => setPickerOpen(true)}
              aria-label="Choose default OG image"
            >
              Choose image
            </Button>
            {row.default_og_image ? (
              <span
                className="truncate text-[12px] text-[var(--color-text-tertiary)]"
                title={row.default_og_image}
              >
                {row.default_og_image}
              </span>
            ) : (
              <span className="text-[12px] text-[var(--color-text-tertiary)]">
                No image selected.
              </span>
            )}
          </div>
          <AssetLibraryPicker
            open={pickerOpen}
            onClose={() => setPickerOpen(false)}
            onSelect={(asset: AssetSelection) => {
              update({ default_og_image: asset.url });
              setPickerOpen(false);
            }}
          />
        </div>

        <Input
          label="Favicon URL"
          hint="SVG / ICO / PNG up to 512×512."
          value={row.favicon_url}
          onChange={(e) => update({ favicon_url: e.target.value })}
        />

        <div className="flex items-center justify-between gap-3">
          <Button
            variant="primary"
            size="md"
            onClick={() => void handleSave()}
            aria-busy={saveState === 'saving'}
            disabled={!loaded || saveState === 'saving'}
          >
            Save settings
          </Button>
          <div
            role="status"
            aria-live="polite"
            className="text-[13px] text-[var(--color-text-secondary)]"
          >
            {saveState === 'saving' && 'Saving...'}
            {saveState === 'saved' && 'Saved'}
            {saveState === 'error' && "Couldn't save changes. Check your connection and try again."}
          </div>
        </div>
      </Card>
    </div>
  );
}
