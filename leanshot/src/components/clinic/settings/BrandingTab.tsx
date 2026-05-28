/**
 * Phase 31 Plan 31-05 Task 3 — BrandingTab
 *
 * Branding form + live WCAG meter + upload zones + live preview +
 * save_org_branding RPC wiring.
 *
 * Architecture:
 *   - surfaceCheck('branding.edit') gate at component root
 *   - Two-column layout md+ (left: form, right: sticky preview)
 *   - Logo/favicon upload zones via branding-asset-upload-url Edge Fn
 *   - 4 oklch color rows with live WCAG meter
 *   - Font dropdowns (heading + body)
 *   - Radius scale segmented control (4 pills)
 *   - Support email input
 *   - "Preview defaults" toggle (isolated — does NOT mutate global tokens)
 *   - Save calls save_org_branding RPC with inline error mapping for WCAG fails
 *   - Optimistic + 6s undo inline for Remove logo / Remove favicon
 *
 * UI-SPEC §Surface 1 verbatim copy contract (section "Copywriting Contract /
 * BrandingTab") — tab label "Branding", heading "Clinic branding", etc.
 */
import { AlertCircle, Check, Eye, EyeOff, Palette, Upload, X } from 'lucide-react';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input, Select } from '@/components/ui/Input';
import { Pill, PillGroup } from '@/components/ui/Pill';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { useToast } from '@/hooks/useToast';
import { surfaceCheck } from '@/lib/org';
import { supabase } from '@/lib/supabase';
import { parseOklch, computeWcagContrast } from '@/lib/wcag-contrast';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BrandingTabProps {
  orgId: string;
  orgSlug: string;
}

interface BrandingForm {
  logo_url: string | null;
  favicon_url: string | null;
  primary_color: string;
  accent_color: string;
  bg_color: string;
  text_color: string;
  heading_font: string;
  body_font: string;
  radius_scale: 'sm' | 'md' | 'lg' | 'xl';
  support_email: string;
}

const FONT_OPTIONS = ['Inter', 'Fraunces', 'JetBrains Mono', 'Lora', 'IBM Plex Sans'] as const;

const RADIUS_OPTIONS: readonly { value: BrandingForm['radius_scale']; label: string }[] = [
  { value: 'sm', label: 'Small' },
  { value: 'md', label: 'Medium' },
  { value: 'lg', label: 'Large' },
  { value: 'xl', label: 'Extra Large' },
];

const LEANSHOT_DEFAULTS: Omit<BrandingForm, 'logo_url' | 'favicon_url' | 'support_email'> = {
  primary_color: 'oklch(0.6 0.2 140)',
  accent_color: 'oklch(0.7 0.15 200)',
  bg_color: 'oklch(0.98 0 0)',
  text_color: 'oklch(0.15 0 0)',
  heading_font: 'Fraunces',
  body_font: 'Inter',
  radius_scale: 'md',
};

const DEFAULT_FORM: BrandingForm = {
  logo_url: null,
  favicon_url: null,
  primary_color: '',
  accent_color: '',
  bg_color: '',
  text_color: '',
  heading_font: 'Inter',
  body_font: 'Inter',
  radius_scale: 'md',
  support_email: '',
};

// ---------------------------------------------------------------------------
// Inline undo banner (optimistic remove pattern)
// ---------------------------------------------------------------------------

interface UndoBanner {
  kind: 'logo' | 'favicon';
  restoredUrl: string | null;
  timerId: ReturnType<typeof setTimeout>;
}

// ---------------------------------------------------------------------------
// NoPermission placeholder
// ---------------------------------------------------------------------------

function NoPermission() {
  return (
    <Card variant="flat">
      <div className="py-6 px-4 text-center">
        <Palette className="size-8 text-[var(--color-text-tertiary)] mx-auto mb-2" aria-hidden />
        <p className="text-[14px] font-semibold text-[var(--color-text)]">Access restricted</p>
        <p className="text-[13px] text-[var(--color-text-secondary)] mt-1">
          You don&apos;t have permission to edit clinic branding.
        </p>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// PreviewPane — receives resolved tokens; uses inline style scoping
// so --brand-* vars only apply inside this container (isolated from global html)
// ---------------------------------------------------------------------------

interface ResolvedTokens {
  bg_color: string;
  text_color: string;
  primary_color: string;
  accent_color: string;
  heading_font: string;
  body_font: string;
  radius_scale: BrandingForm['radius_scale'];
  logo_url: string | null;
}

const RADIUS_REM: Record<BrandingForm['radius_scale'], string> = {
  sm: '0.625rem',
  md: '0.875rem',
  lg: '1.25rem',
  xl: '1.5rem',
};

function PreviewPane({
  tokens,
  showingDefaults,
}: {
  tokens: ResolvedTokens;
  showingDefaults: boolean;
}) {
  const bgOk = parseOklch(tokens.bg_color);
  const textOk = parseOklch(tokens.text_color);
  const primaryOk = parseOklch(tokens.primary_color);

  const containerStyle: CSSProperties = {
    '--brand-bg': bgOk ? tokens.bg_color : 'oklch(0.98 0 0)',
    '--brand-text': textOk ? tokens.text_color : 'oklch(0.15 0 0)',
    '--brand-primary': primaryOk ? tokens.primary_color : 'oklch(0.6 0.2 140)',
    '--brand-heading-font': tokens.heading_font || 'Inter',
    '--brand-body-font': tokens.body_font || 'Inter',
    '--brand-radius': RADIUS_REM[tokens.radius_scale],
  } as CSSProperties;

  return (
    <div
      className="rounded-xl border border-[var(--color-border)] overflow-hidden relative"
      style={containerStyle}
      role="img"
      aria-label="Live preview of clinic branding"
    >
      {showingDefaults && (
        <div className="absolute top-2 right-2 z-10 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg px-2 py-1 text-[10px] font-semibold text-[var(--color-text-secondary)]">
          Showing LeanShot defaults
        </div>
      )}

      {/* Fake mini sidebar */}
      <div
        className="flex"
        style={{
          backgroundColor: 'var(--brand-bg)',
          borderBottom: '1px solid rgba(0,0,0,0.08)',
        }}
      >
        <div
          className="w-8 flex items-center justify-center py-3 shrink-0"
          style={{
            borderInlineEnd: '3px solid var(--brand-primary)',
          }}
        >
          {tokens.logo_url ? (
            <img src={tokens.logo_url} alt="Clinic logo" className="w-5 h-5 object-contain" />
          ) : (
            <span
              className="text-[10px] font-bold"
              style={{ color: 'var(--brand-primary)' }}
              aria-hidden
            >
              C
            </span>
          )}
        </div>

        {/* Fake content area header */}
        <div className="flex-1 px-3 py-2">
          <p
            className="text-[11px] font-semibold"
            style={{
              fontFamily: 'var(--brand-heading-font)',
              color: 'var(--brand-text)',
            }}
          >
            Dashboard
          </p>
        </div>
      </div>

      {/* Fake card body */}
      <div className="p-4" style={{ backgroundColor: 'var(--brand-bg)' }}>
        <div
          className="p-3 border border-[rgba(0,0,0,0.08)]"
          style={{
            borderRadius: 'var(--brand-radius)',
            backgroundColor: 'rgba(255,255,255,0.5)',
          }}
        >
          <p
            className="text-[13px] font-semibold mb-1"
            style={{
              fontFamily: 'var(--brand-heading-font)',
              color: 'var(--brand-text)',
            }}
          >
            Patient data stays private
          </p>
          <p
            className="text-[11px] mb-3"
            style={{
              fontFamily: 'var(--brand-body-font)',
              color: 'var(--brand-text)',
              opacity: 0.7,
            }}
          >
            Your clinic information is stored securely.
          </p>
          {/* Fake CTA button */}
          <button
            type="button"
            className="px-3 py-1.5 text-[11px] font-semibold text-white"
            style={{
              backgroundColor: 'var(--brand-primary)',
              borderRadius: 'var(--brand-radius)',
            }}
            tabIndex={-1}
            aria-hidden
          >
            View details
          </button>
        </div>

        {/* Text sample */}
        <p
          className="mt-3 text-[11px]"
          style={{
            fontFamily: 'var(--brand-body-font)',
            color: 'var(--brand-text)',
            opacity: 0.85,
          }}
        >
          Patient data stays private
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function BrandingTab({ orgId, orgSlug: _orgSlug }: BrandingTabProps) {
  const toast = useToast();
  const reducedMotion = useReducedMotion();

  // Permission gate (defense-in-depth alongside NAV visibleWhen)
  if (!surfaceCheck('branding.edit')) {
    return <NoPermission />;
  }

  return <BrandingTabInner orgId={orgId} toast={toast} reducedMotion={reducedMotion} />;
}

// Inner component (after permission gate — hooks must be called unconditionally)
function BrandingTabInner({
  orgId,
  toast,
  reducedMotion,
}: {
  orgId: string;
  toast: (message: string, kind?: 'success' | 'error' | 'info') => void;
  reducedMotion: boolean;
}) {
  const [form, setForm] = useState<BrandingForm>(DEFAULT_FORM);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [previewDefaults, setPreviewDefaults] = useState(false);
  const [uploading, setUploading] = useState<{ logo: boolean; favicon: boolean }>({
    logo: false,
    favicon: false,
  });
  const [colorErrors, setColorErrors] = useState<Record<string, string | null>>({});
  const [emailError, setEmailError] = useState<string | null>(null);
  const [inlineErrors, setInlineErrors] = useState<{
    textBg: string | null;
    primaryBg: string | null;
  }>({ textBg: null, primaryBg: null });
  const [undoBanner, setUndoBanner] = useState<UndoBanner | null>(null);

  // Refs for undo timer cleanup
  const undoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load initial branding on mount
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoading(true);
      const { data } = await supabase
        .from('org_branding')
        .select('*')
        .eq('org_id', orgId)
        .limit(1)
        .maybeSingle();
      if (!cancelled && data) {
        setForm({
          logo_url: data.logo_url ?? null,
          favicon_url: data.favicon_url ?? null,
          primary_color: data.primary_color ?? '',
          accent_color: data.accent_color ?? '',
          bg_color: data.bg_color ?? '',
          text_color: data.text_color ?? '',
          heading_font: data.heading_font ?? 'Inter',
          body_font: data.body_font ?? 'Inter',
          radius_scale: (data.radius_scale as BrandingForm['radius_scale']) ?? 'md',
          support_email: data.support_email ?? '',
        });
      }
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [orgId]);

  // Cleanup undo timer on unmount
  useEffect(() => {
    return () => {
      if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    };
  }, []);

  // ---------------------------------------------------------------------------
  // WCAG live meter
  // ---------------------------------------------------------------------------
  const textBgContrast =
    parseOklch(form.text_color) && parseOklch(form.bg_color)
      ? computeWcagContrast(form.text_color, form.bg_color)
      : null;
  const primaryBgContrast =
    parseOklch(form.primary_color) && parseOklch(form.bg_color)
      ? computeWcagContrast(form.primary_color, form.bg_color)
      : null;

  const textBgPassing = textBgContrast !== null && textBgContrast >= 4.5;
  const primaryBgPassing = primaryBgContrast !== null && primaryBgContrast >= 3.0;

  const anyInvalidOklch = ['text_color', 'bg_color', 'primary_color', 'accent_color'].some((k) => {
    const val = form[k as keyof BrandingForm] as string;
    return val.trim().length > 0 && parseOklch(val) === null;
  });

  const saveDisabled =
    anyInvalidOklch ||
    (form.text_color.trim().length > 0 && form.bg_color.trim().length > 0 && !textBgPassing) ||
    (form.primary_color.trim().length > 0 &&
      form.bg_color.trim().length > 0 &&
      !primaryBgPassing) ||
    submitting;

  // ---------------------------------------------------------------------------
  // Color field change handler
  // ---------------------------------------------------------------------------
  const handleColorChange = (field: keyof BrandingForm, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
    // Clear inline server errors when user edits color
    if (field === 'text_color' || field === 'bg_color') {
      setInlineErrors((prev) => ({ ...prev, textBg: null }));
    }
    if (field === 'primary_color' || field === 'bg_color') {
      setInlineErrors((prev) => ({ ...prev, primaryBg: null }));
    }
  };

  const handleColorBlur = (field: string, value: string) => {
    if (value.trim().length > 0 && parseOklch(value) === null) {
      setColorErrors((prev) => ({
        ...prev,
        [field]: 'Enter a valid oklch() color (e.g., oklch(0.65 0.18 240)).',
      }));
    } else {
      setColorErrors((prev) => ({ ...prev, [field]: null }));
    }
  };

  // ---------------------------------------------------------------------------
  // Upload handler
  // ---------------------------------------------------------------------------
  const handleUpload = async (kind: 'logo' | 'favicon', file: File) => {
    // Client-side pre-validation
    if (file.size > 500 * 1024) {
      toast(`${kind === 'logo' ? 'Logo' : 'Favicon'} must be under 500 KB.`, 'error');
      return;
    }
    const allowed =
      kind === 'logo'
        ? ['image/png', 'image/jpeg', 'image/svg+xml']
        : ['image/x-icon', 'image/vnd.microsoft.icon', 'image/png'];
    if (!allowed.includes(file.type)) {
      toast(
        `Invalid file type. ${kind === 'logo' ? 'Use PNG, JPG, or SVG.' : 'Use ICO or PNG.'}`,
        'error',
      );
      return;
    }

    setUploading((prev) => ({ ...prev, [kind]: true }));
    try {
      const { data, error } = await supabase.functions.invoke('branding-asset-upload-url', {
        body: { p_org_id: orgId, p_kind: kind },
      });
      if (error || !data?.upload_url) {
        toast('Upload failed. Please try again.', 'error');
        return;
      }
      const putRes = await fetch(data.upload_url as string, {
        method: 'PUT',
        body: file,
        headers: { 'content-type': file.type },
      });
      if (!putRes.ok) {
        toast('Upload failed. Please try again.', 'error');
        return;
      }
      const field = kind === 'logo' ? 'logo_url' : 'favicon_url';
      setForm((prev) => ({ ...prev, [field]: data.public_url as string }));
    } finally {
      setUploading((prev) => ({ ...prev, [kind]: false }));
    }
  };

  // ---------------------------------------------------------------------------
  // Remove handler (optimistic + 6s undo)
  // ---------------------------------------------------------------------------
  const handleRemove = (kind: 'logo' | 'favicon') => {
    const field = kind === 'logo' ? 'logo_url' : 'favicon_url';
    const snapshot = form[field];

    // Optimistic clear
    setForm((prev) => ({ ...prev, [field]: null }));

    // Cancel any existing undo timer
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current);

    const timerId = setTimeout(() => {
      setUndoBanner(null);
    }, 6000);
    undoTimerRef.current = timerId;

    setUndoBanner({ kind, restoredUrl: snapshot, timerId });
  };

  const handleUndo = () => {
    if (!undoBanner) return;
    const field = undoBanner.kind === 'logo' ? 'logo_url' : 'favicon_url';
    setForm((prev) => ({ ...prev, [field]: undoBanner.restoredUrl }));
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    setUndoBanner(null);
  };

  // ---------------------------------------------------------------------------
  // Save handler
  // ---------------------------------------------------------------------------
  const handleSave = async () => {
    if (saveDisabled) return;
    setSubmitting(true);
    try {
      const { error } = await supabase.rpc('save_org_branding', {
        p_org_id: orgId,
        p_tokens: {
          logo_url: form.logo_url,
          favicon_url: form.favicon_url,
          primary_color: form.primary_color || null,
          accent_color: form.accent_color || null,
          bg_color: form.bg_color || null,
          text_color: form.text_color || null,
          heading_font: form.heading_font || null,
          body_font: form.body_font || null,
          radius_scale: form.radius_scale || null,
          support_email: form.support_email || null,
        },
      });
      if (error) {
        if (error.message.includes('CONTRAST_TEXT_BG_FAIL')) {
          setInlineErrors((prev) => ({
            ...prev,
            textBg:
              "Text color doesn't have enough contrast against the background. Adjust either color and try again.",
          }));
        } else if (error.message.includes('CONTRAST_PRIMARY_BG_FAIL')) {
          setInlineErrors((prev) => ({
            ...prev,
            primaryBg:
              "Primary color doesn't have enough contrast against the background. Adjust either color and try again.",
          }));
        } else {
          toast('Something went wrong. Please try again or contact support.', 'error');
        }
        return;
      }
      toast('Branding saved — patients will see this on their next visit.', 'success');
    } finally {
      setSubmitting(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Preview tokens
  // ---------------------------------------------------------------------------
  const previewTokens: ResolvedTokens = previewDefaults
    ? {
        bg_color: LEANSHOT_DEFAULTS.bg_color,
        text_color: LEANSHOT_DEFAULTS.text_color,
        primary_color: LEANSHOT_DEFAULTS.primary_color,
        accent_color: LEANSHOT_DEFAULTS.accent_color,
        heading_font: LEANSHOT_DEFAULTS.heading_font,
        body_font: LEANSHOT_DEFAULTS.body_font,
        radius_scale: LEANSHOT_DEFAULTS.radius_scale,
        logo_url: form.logo_url,
      }
    : {
        bg_color: form.bg_color,
        text_color: form.text_color,
        primary_color: form.primary_color,
        accent_color: form.accent_color,
        heading_font: form.heading_font,
        body_font: form.body_font,
        radius_scale: form.radius_scale,
        logo_url: form.logo_url,
      };

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="h-6 w-48 bg-[var(--color-surface-elevated)] rounded-xl animate-pulse" />
        <div className="h-32 bg-[var(--color-surface-elevated)] rounded-xl animate-pulse" />
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  return (
    <div className="space-y-6">
      {/* Header */}
      <header>
        <h1 className="text-[20px] font-semibold tracking-tight text-[var(--color-text)]">
          Clinic branding
        </h1>
        <p className="text-[13px] text-[var(--color-text-secondary)] mt-1">
          Customize how patients experience your clinic.
        </p>
      </header>

      {/* Undo banner */}
      {undoBanner && (
        <div
          role="status"
          aria-live="polite"
          className="flex items-center justify-between gap-3 p-3 rounded-xl bg-[var(--color-surface-elevated)] border border-[var(--color-border)] text-[13px]"
        >
          <span className="text-[var(--color-text-secondary)]">
            {undoBanner.kind === 'logo' ? 'Logo' : 'Favicon'} removed.
          </span>
          <button
            type="button"
            onClick={handleUndo}
            className="text-[var(--color-primary)] font-semibold hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] rounded"
          >
            Undo
          </button>
        </div>
      )}

      {/* Two-column layout md+ */}
      <div className="flex flex-col md:flex-row gap-6 items-start">
        {/* Left column: form */}
        <div className="flex-1 space-y-5 min-w-0 md:min-w-[320px]">
          {/* Logo upload */}
          <div>
            <p className="text-[13px] font-semibold text-[var(--color-text)] mb-2">Logo</p>
            <UploadZone
              kind="logo"
              currentUrl={form.logo_url}
              uploading={uploading.logo}
              reducedMotion={reducedMotion}
              accept=".png,.jpg,.jpeg,.svg"
              size="160x80"
              hint="PNG, JPG, or SVG · max 500 KB"
              onUpload={(file) => void handleUpload('logo', file)}
              onRemove={() => handleRemove('logo')}
            />
          </div>

          {/* Favicon upload */}
          <div>
            <p className="text-[13px] font-semibold text-[var(--color-text)] mb-2">Favicon</p>
            <UploadZone
              kind="favicon"
              currentUrl={form.favicon_url}
              uploading={uploading.favicon}
              reducedMotion={reducedMotion}
              accept=".ico,.png"
              size="64x64"
              hint="ICO or PNG · max 500 KB"
              onUpload={(file) => void handleUpload('favicon', file)}
              onRemove={() => handleRemove('favicon')}
            />
          </div>

          {/* Color rows */}
          <div className="space-y-3">
            <p className="text-[13px] font-semibold text-[var(--color-text)]">Colors</p>
            <p className="text-[12px] text-[var(--color-text-secondary)]">
              Enter colors in oklch() format, e.g.{' '}
              <code className="font-mono">oklch(0.65 0.18 240)</code>
            </p>
            {(
              [
                { key: 'bg_color', label: 'Background', cssVar: '--brand-bg' },
                { key: 'text_color', label: 'Text', cssVar: '--brand-text' },
                { key: 'primary_color', label: 'Primary', cssVar: '--brand-primary' },
                { key: 'accent_color', label: 'Accent', cssVar: '--brand-accent' },
              ] as const
            ).map(({ key, label }) => {
              const val = form[key];
              const parsed = parseOklch(val);
              const swatchBg = parsed ? val : undefined;

              return (
                <div key={key} className="flex items-start gap-3">
                  {/* Swatch */}
                  <div
                    className="w-8 h-8 rounded-lg border border-[var(--color-border)] shrink-0 mt-[2px]"
                    style={swatchBg ? { backgroundColor: swatchBg } : undefined}
                    aria-hidden
                  />
                  <div className="flex-1 min-w-0">
                    <label
                      htmlFor={`color-${key}`}
                      className="text-[12px] font-semibold text-[var(--color-text)] mb-1 block"
                    >
                      {label}
                    </label>
                    <input
                      id={`color-${key}`}
                      type="text"
                      value={val}
                      onChange={(e) => handleColorChange(key, e.target.value)}
                      onBlur={(e) => handleColorBlur(key, e.target.value)}
                      placeholder="oklch(0.5 0.15 240)"
                      aria-label={`${label} color in oklch format`}
                      className={[
                        'w-full h-9 px-3 rounded-xl border font-mono text-[12px] bg-[var(--color-surface)]',
                        'focus:outline-none focus:border-[var(--color-primary)]',
                        'focus:shadow-[0_0_0_3px_var(--color-primary-soft)]',
                        'transition-[box-shadow,border-color]',
                        colorErrors[key]
                          ? 'border-[var(--color-danger)]'
                          : 'border-[var(--color-border)]',
                      ].join(' ')}
                    />
                    {colorErrors[key] && (
                      <p
                        role="alert"
                        aria-live="polite"
                        className="text-[11px] text-[var(--color-danger)] mt-1"
                      >
                        {colorErrors[key]}
                      </p>
                    )}
                  </div>
                </div>
              );
            })}

            {/* WCAG live meter */}
            <div className="space-y-2 mt-2">
              {/* Row 1: Text on background */}
              <div className="flex items-center gap-2">
                {textBgContrast !== null && textBgPassing ? (
                  <Check size={14} className="text-[var(--color-success)] shrink-0" aria-hidden />
                ) : textBgContrast !== null ? (
                  <AlertCircle
                    size={14}
                    className="text-[var(--color-danger)] shrink-0"
                    aria-hidden
                  />
                ) : null}
                <span className="text-[12px] text-[var(--color-text-secondary)]">
                  Text on background:{' '}
                  <span
                    className={
                      textBgContrast === null
                        ? 'text-[var(--color-text-tertiary)]'
                        : textBgPassing
                          ? 'text-[var(--color-success)] font-semibold'
                          : 'text-[var(--color-danger)] font-semibold'
                    }
                  >
                    {textBgContrast !== null ? `${textBgContrast.toFixed(2)} : 1` : '—'}
                  </span>
                  <span className="text-[var(--color-text-tertiary)]"> (need 4.5+)</span>
                </span>
              </div>
              {inlineErrors.textBg && (
                <p
                  role="alert"
                  aria-live="polite"
                  className="text-[11px] text-[var(--color-danger)] ms-[22px]"
                >
                  {inlineErrors.textBg}
                </p>
              )}

              {/* Row 2: Primary on background */}
              <div className="flex items-center gap-2">
                {primaryBgContrast !== null && primaryBgPassing ? (
                  <Check size={14} className="text-[var(--color-success)] shrink-0" aria-hidden />
                ) : primaryBgContrast !== null ? (
                  <AlertCircle
                    size={14}
                    className="text-[var(--color-danger)] shrink-0"
                    aria-hidden
                  />
                ) : null}
                <span className="text-[12px] text-[var(--color-text-secondary)]">
                  Primary on background:{' '}
                  <span
                    className={
                      primaryBgContrast === null
                        ? 'text-[var(--color-text-tertiary)]'
                        : primaryBgPassing
                          ? 'text-[var(--color-success)] font-semibold'
                          : 'text-[var(--color-danger)] font-semibold'
                    }
                  >
                    {primaryBgContrast !== null ? `${primaryBgContrast.toFixed(2)} : 1` : '—'}
                  </span>
                  <span className="text-[var(--color-text-tertiary)]"> (need 3.0+)</span>
                </span>
              </div>
              {inlineErrors.primaryBg && (
                <p
                  role="alert"
                  aria-live="polite"
                  className="text-[11px] text-[var(--color-danger)] ms-[22px]"
                >
                  {inlineErrors.primaryBg}
                </p>
              )}
            </div>
          </div>

          {/* Font dropdowns */}
          <div className="space-y-3">
            <p className="text-[13px] font-semibold text-[var(--color-text)]">Fonts</p>
            <Select
              label="Heading font"
              value={form.heading_font}
              onChange={(e) => setForm((prev) => ({ ...prev, heading_font: e.target.value }))}
              aria-label="Heading font"
            >
              {FONT_OPTIONS.map((f) => (
                <option key={f} value={f} style={{ fontFamily: f }}>
                  {f}
                </option>
              ))}
            </Select>
            <Select
              label="Body font"
              value={form.body_font}
              onChange={(e) => setForm((prev) => ({ ...prev, body_font: e.target.value }))}
              aria-label="Body font"
            >
              {FONT_OPTIONS.map((f) => (
                <option key={f} value={f} style={{ fontFamily: f }}>
                  {f}
                </option>
              ))}
            </Select>
          </div>

          {/* Radius scale */}
          <div>
            <p className="text-[13px] font-semibold text-[var(--color-text)] mb-2">Corner radius</p>
            <PillGroup segmented>
              {RADIUS_OPTIONS.map(({ value, label }) => (
                <Pill
                  key={value}
                  active={form.radius_scale === value}
                  size="sm"
                  onClick={() => setForm((prev) => ({ ...prev, radius_scale: value }))}
                  aria-label={`Corner radius: ${label}`}
                >
                  {label}
                </Pill>
              ))}
            </PillGroup>
          </div>

          {/* Support email */}
          <Input
            label="Support email"
            type="email"
            placeholder="support@yourclinic.com"
            value={form.support_email}
            onChange={(e) => setForm((prev) => ({ ...prev, support_email: e.target.value }))}
            onBlur={(e) => {
              if (
                e.target.value.trim().length > 0 &&
                !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.target.value.trim())
              ) {
                setEmailError('Enter a valid email address.');
              } else {
                setEmailError(null);
              }
            }}
            error={emailError ?? undefined}
            aria-label="Support email address"
          />

          {/* Save button */}
          <div className="flex items-center gap-3 pt-1">
            <Button
              variant="primary"
              disabled={saveDisabled}
              aria-busy={submitting}
              onClick={() => void handleSave()}
            >
              {submitting ? 'Saving…' : 'Save branding'}
            </Button>
          </div>
        </div>

        {/* Right column: preview (sticky md+) */}
        <div className="w-full md:w-[340px] md:max-w-[420px] md:shrink-0 md:sticky md:top-24 space-y-3">
          {/* Preview defaults toggle */}
          <div className="flex items-center justify-between">
            <p className="text-[12px] font-semibold text-[var(--color-text-secondary)] uppercase tracking-wide">
              Live preview
            </p>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setPreviewDefaults((v) => !v)}
              aria-label={
                previewDefaults
                  ? 'Show clinic theme in preview'
                  : 'Show LeanShot defaults in preview'
              }
            >
              {previewDefaults ? (
                <>
                  <EyeOff className="size-3.5 me-1" aria-hidden />
                  Preview clinic theme
                </>
              ) : (
                <>
                  <Eye className="size-3.5 me-1" aria-hidden />
                  Preview defaults
                </>
              )}
            </Button>
          </div>
          <PreviewPane tokens={previewTokens} showingDefaults={previewDefaults} />
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// UploadZone sub-component
// ---------------------------------------------------------------------------

interface UploadZoneProps {
  kind: 'logo' | 'favicon';
  currentUrl: string | null;
  uploading: boolean;
  reducedMotion: boolean;
  accept: string;
  size: string;
  hint: string;
  onUpload: (file: File) => void;
  onRemove: () => void;
}

function UploadZone({
  kind,
  currentUrl,
  uploading,
  reducedMotion,
  accept,
  size,
  hint,
  onUpload,
  onRemove,
}: UploadZoneProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const kindLabel = kind === 'logo' ? 'Logo' : 'Favicon';

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    onUpload(file);
    // Reset so the same file can be re-selected
    e.target.value = '';
  };

  if (uploading) {
    return (
      <div
        role="status"
        aria-busy
        aria-label={`Uploading ${kindLabel}…`}
        className={[
          'flex items-center justify-center rounded-xl border border-dashed border-[var(--color-border)]',
          kind === 'logo' ? 'h-20 w-40' : 'h-16 w-16',
          !reducedMotion ? 'animate-pulse' : '',
          'bg-[var(--color-surface-elevated)]',
        ].join(' ')}
      >
        <span className="text-[12px] text-[var(--color-text-tertiary)]">Uploading…</span>
      </div>
    );
  }

  if (currentUrl) {
    return (
      <div
        className="relative inline-flex"
        aria-label={`${kindLabel} uploaded. Click Remove to clear.`}
      >
        <img
          src={currentUrl}
          alt={`${kindLabel} preview`}
          className={[
            'rounded-xl border border-[var(--color-border)] object-contain bg-[var(--color-surface-elevated)]',
            kind === 'logo' ? 'h-20 w-40' : 'h-16 w-16',
          ].join(' ')}
        />
        <button
          type="button"
          onClick={onRemove}
          className="absolute -top-1.5 -right-1.5 size-5 rounded-full bg-[var(--color-danger)] text-white flex items-center justify-center hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-danger)]"
          aria-label={`Remove ${kindLabel}`}
        >
          <X size={10} aria-hidden />
        </button>
      </div>
    );
  }

  return (
    <div>
      <button
        type="button"
        aria-label={`${kindLabel} upload zone. Click to upload or drag and drop.`}
        onClick={() => fileInputRef.current?.click()}
        className={[
          'flex flex-col items-center justify-center rounded-xl border border-dashed border-[var(--color-border)] bg-[var(--color-surface)] cursor-pointer',
          'hover:border-[var(--color-primary)] hover:bg-[var(--color-primary-soft)]',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]',
          'transition-colors',
          kind === 'logo' ? 'h-20 w-40' : 'h-16 w-16',
        ].join(' ')}
      >
        <Upload
          size={kind === 'logo' ? 18 : 14}
          className="text-[var(--color-text-tertiary)] mb-1"
          aria-hidden
        />
        <span className="text-[11px] text-[var(--color-text-tertiary)] text-center px-2 leading-tight">
          {kind === 'logo' ? `Upload logo\n${size}px` : `${size}px`}
        </span>
      </button>
      <p className="text-[11px] text-[var(--color-text-tertiary)] mt-1">{hint}</p>
      <input
        ref={fileInputRef}
        type="file"
        accept={accept}
        onChange={handleFileChange}
        className="sr-only"
        aria-hidden
        tabIndex={-1}
      />
    </div>
  );
}

export default BrandingTab;
