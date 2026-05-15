/**
 * Phase 19 Plan 19-06b — PartnerCustomizeForm.
 *
 * 5-field customization form for the affiliate's landing page. Save button
 * POSTs to /functions/v1/partner-profile-update (BL-2 Path A column allowlist)
 * with the 6-field body { display_name, photo_path, blurb, calendly_url,
 * testimonial_quote, template_choice }.
 *
 * Spec:
 *   - 19-UI-SPEC.md §/partner/links Copywriting Contract (labels, helpers)
 *   - 19-CONTEXT.md D-18 (6 customization fields) + D-20 (no Storage transforms — raw img)
 *
 * Field visibility:
 *   - testimonial_quote only when selectedTemplate === 'story' (UI-SPEC) —
 *     uses Tailwind transition-opacity for the fade.
 *
 * Photo upload writes to Storage bucket `affiliate-photos/{user_id}/profile.{ext}`
 * via supabase-js Storage client. Bucket creation + RLS owned by Plan 19-08.
 *
 * Pre-submit validation (client-side):
 *   - calendly_url: empty OR valid URL whose host is calendly.com / *.calendly.com
 *   - Lengths: server enforces (display_name 1..80, blurb<=50, testimonial<=200);
 *     UI shows a soft counter so the user sees the limit before the server 400s.
 */
import { type ReactNode, useId, useRef, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Input, Textarea } from '@/components/ui/Input';
import { useToast } from '@/hooks/useToast';
import { cn } from '@/lib/helpers';
import { supabase } from '@/lib/supabase';
import type { TemplateChoice } from './PartnerTemplatePicker';

export interface PartnerCustomizeFormInitial {
  display_name: string;
  photo_path: string;
  blurb: string;
  calendly_url: string;
  testimonial_quote: string;
}

export interface PartnerCustomizeFormProps {
  userId: string;
  selectedTemplate: TemplateChoice;
  initial: PartnerCustomizeFormInitial;
  /** Called after a successful save (no args; consumer refreshes profile). */
  onSaved?: () => void;
}

/** Client-side calendly host gate — server is authoritative; this is UX-only. */
function validateCalendly(value: string): boolean {
  if (value === '') return true;
  let u: URL;
  try {
    u = new URL(value);
  } catch {
    return false;
  }
  const host = u.hostname.toLowerCase();
  return host === 'calendly.com' || host.endsWith('.calendly.com');
}

export function PartnerCustomizeForm({
  userId,
  selectedTemplate,
  initial,
  onSaved,
}: PartnerCustomizeFormProps): ReactNode {
  const toast = useToast();
  const [displayName, setDisplayName] = useState<string>(initial.display_name);
  const [photoPath, setPhotoPath] = useState<string>(initial.photo_path);
  const [blurb, setBlurb] = useState<string>(initial.blurb);
  const [calendlyUrl, setCalendlyUrl] = useState<string>(initial.calendly_url);
  const [testimonialQuote, setTestimonialQuote] = useState<string>(initial.testimonial_quote);
  const [calendlyError, setCalendlyError] = useState<string | null>(null);
  const [saving, setSaving] = useState<boolean>(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const photoFieldId = useId();

  const onPhotoChange = async (e: React.ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = e.target.files?.[0];
    if (!file) return;
    const ext = file.name.split('.').pop()?.toLowerCase() ?? 'jpg';
    const path = `${userId}/profile.${ext}`;
    try {
      const up = await supabase.storage
        .from('affiliate-photos')
        .upload(path, file, { upsert: true, contentType: file.type });
      if (up.error) {
        toast('Couldn’t upload photo. Try again.', 'error');
        return;
      }
      setPhotoPath(path);
      toast('Photo uploaded', 'success');
    } catch {
      toast('Couldn’t upload photo. Try again.', 'error');
    }
  };

  const onSave = async (): Promise<void> => {
    if (saving) return;

    // Pre-submit calendly check.
    if (!validateCalendly(calendlyUrl.trim())) {
      setCalendlyError('Use a calendly.com link, or leave this blank.');
      return;
    }
    setCalendlyError(null);

    setSaving(true);
    try {
      const base = (import.meta.env.VITE_SUPABASE_URL as string | undefined) ?? '';
      const sess = await supabase.auth.getSession();
      const jwt = sess.data.session?.access_token;
      if (!jwt) {
        toast('Please sign in again.', 'error');
        return;
      }

      const body = {
        display_name: displayName,
        photo_path: photoPath,
        blurb,
        calendly_url: calendlyUrl.trim(),
        testimonial_quote: testimonialQuote,
        template_choice: selectedTemplate,
      };

      const res = await fetch(`${base}/functions/v1/partner-profile-update`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${jwt}`,
          'Content-Type': 'application/json',
        },
        credentials: 'omit',
        body: JSON.stringify(body),
      });
      if (res.ok) {
        toast('Page updated', 'success');
        if (onSaved) onSaved();
      } else {
        const json = (await res.json().catch(() => null)) as { error?: string } | null;
        toast(json?.error ? `Save failed: ${json.error}` : 'Save failed', 'error');
      }
    } catch {
      toast('Save failed', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void onSave();
      }}
      className="space-y-4"
    >
      <h3 className="text-[14px] font-semibold text-[var(--color-text)]">Customize your page</h3>

      <Input
        label="Display name"
        value={displayName}
        maxLength={80}
        onChange={(e) => setDisplayName(e.target.value)}
        required
      />

      <div className="flex flex-col gap-1.5">
        <label
          htmlFor={photoFieldId}
          className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--color-text-secondary)]"
        >
          Profile photo
        </label>
        <input
          ref={fileInputRef}
          id={photoFieldId}
          type="file"
          accept="image/jpeg,image/png"
          onChange={(e) => {
            void onPhotoChange(e);
          }}
          className="text-[13px] text-[var(--color-text)] file:mr-3 file:px-3 file:py-1.5 file:rounded-pill file:border file:border-[var(--color-border)] file:bg-[var(--color-surface)] file:text-[var(--color-text)] file:cursor-pointer file:font-semibold file:text-[12px]"
        />
        <p className="text-[12px] text-[var(--color-text-tertiary)]">
          Square JPG or PNG, at least 400&times;400px. Falls back to a colored initial if blank.
        </p>
      </div>

      <Input
        label="Tagline (max 50 chars)"
        value={blurb}
        maxLength={50}
        onChange={(e) => setBlurb(e.target.value)}
        hint={`${blurb.length}/50`}
      />

      <Input
        label="Calendly URL (optional)"
        value={calendlyUrl}
        type="url"
        placeholder="https://calendly.com/your-link"
        onChange={(e) => {
          setCalendlyUrl(e.target.value);
          if (calendlyError) setCalendlyError(null);
        }}
        error={calendlyError ?? undefined}
      />

      <div
        className={cn(
          'transition-opacity duration-200',
          selectedTemplate === 'story' ? 'opacity-100' : 'opacity-0 h-0 overflow-hidden',
        )}
        aria-hidden={selectedTemplate !== 'story'}
      >
        {selectedTemplate === 'story' && (
          <Textarea
            label="Pull-quote (max 200 chars) — only used on 'the story' template"
            value={testimonialQuote}
            maxLength={200}
            rows={3}
            onChange={(e) => setTestimonialQuote(e.target.value)}
            hint={`${testimonialQuote.length}/200`}
          />
        )}
      </div>

      <div className="flex justify-end">
        <Button type="submit" variant="primary" loading={saving} aria-busy={saving || undefined}>
          Save changes
        </Button>
      </div>
    </form>
  );
}

export default PartnerCustomizeForm;
