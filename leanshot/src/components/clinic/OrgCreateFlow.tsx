/**
 * Phase 9 Plan 09-02 — OrgCreateFlow.
 *
 * Wizard with two visible states: Step 1 (form) and Success.
 *
 *   Step 1
 *     - Workspace-name Input (auto-focused)
 *     - Slug Input (auto-derives from name on keystroke; locks once
 *       the user manually edits it)
 *     - Slug uniqueness check on blur (debounced)
 *     - Optional logo upload (PNG/JPEG ≤ 2 MB → 64×64 preview)
 *     - "Create workspace" CTA disabled until name + slug pass
 *
 *   Success
 *     - Fraunces italic "Workspace created" heading
 *     - Workspace URL display
 *     - Dual CTAs:
 *         · "Invite first patient" → routes to `/clinic/{slug}` AND
 *           opens InvitePatientModal in the same transition
 *         · "Go to workspace" → routes to `/clinic/{slug}`
 *
 * On submit:
 *   createOrg() → if success, uploadOrgLogo() if logo set →
 *   updateOrg({logo_storage_path}) → enter success state.
 */

import { Image as ImageIcon, X as XIcon } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { useToast } from '@/hooks/useToast';
import { checkSlugAvailable, createOrg, updateOrg, uploadOrgLogo } from '@/lib/clinic';

export interface OrgCreateFlowProps {
  /**
   * Called when the user chooses an action on the success screen.
   *   - `slug` is the final org slug.
   *   - `openInviteModal` is true if the user clicked "Invite first patient".
   * Default behavior (when not provided) navigates with `history.pushState`
   * and dispatches a `popstate` event so App.tsx's selectView picks it up.
   */
  onComplete?: (slug: string, openInviteModal: boolean) => void;
  onCancel?: () => void;
}

interface FormState {
  name: string;
  slug: string;
  slugManuallyEdited: boolean;
  logoFile: File | null;
  logoPreviewUrl: string | null;
  slugError: string | null;
  logoError: string | null;
  submitting: boolean;
  serverError: string | null;
  success: { slug: string } | null;
}

const SLUG_INVALID = 'Use lowercase letters, numbers, and hyphens only.';
const SLUG_RESERVED = 'That URL is reserved. Try another.';
const SLUG_TAKEN = 'That URL is already taken. Try another.';
const LOGO_TOO_LARGE = 'That file is over 2 MB. Try a smaller image.';
const LOGO_WRONG_TYPE = 'Use a PNG or JPEG image.';

const SLUG_DEBOUNCE_MS = 400;
const MAX_NAME_LEN = 60;
const MAX_SLUG_LEN = 60;
const LOGO_MAX_BYTES = 2 * 1024 * 1024;

function deriveSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_SLUG_LEN);
}

function defaultNavigate(slug: string, openInviteModal: boolean): void {
  const url = `/clinic/${slug}${openInviteModal ? '?invite=1' : ''}`;
  try {
    window.history.pushState({}, '', url);
    window.dispatchEvent(new PopStateEvent('popstate'));
  } catch {
    // No-op for jsdom test environments without history support.
  }
}

export function OrgCreateFlow({ onComplete, onCancel }: OrgCreateFlowProps) {
  const nameRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const toast = useToast();

  const [state, setState] = useState<FormState>({
    name: '',
    slug: '',
    slugManuallyEdited: false,
    logoFile: null,
    logoPreviewUrl: null,
    slugError: null,
    logoError: null,
    submitting: false,
    serverError: null,
    success: null,
  });

  // Auto-focus name on mount.
  useEffect(() => {
    nameRef.current?.focus();
  }, []);

  // Debounced slug availability check.
  const slugCheckTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const runSlugCheck = useCallback(async (slug: string) => {
    const r = await checkSlugAvailable(slug);
    setState((s) => {
      // Only apply if slug hasn't changed in the meantime.
      if (s.slug !== slug) return s;
      if (r.available) return { ...s, slugError: null };
      const reasonToCopy = {
        invalid: SLUG_INVALID,
        reserved: SLUG_RESERVED,
        taken: SLUG_TAKEN,
      } as const;
      return { ...s, slugError: reasonToCopy[r.reason] };
    });
  }, []);

  function scheduleSlugCheck(slug: string): void {
    if (slugCheckTimer.current) clearTimeout(slugCheckTimer.current);
    if (!slug) return;
    slugCheckTimer.current = setTimeout(() => runSlugCheck(slug), SLUG_DEBOUNCE_MS);
  }

  function handleNameChange(e: React.ChangeEvent<HTMLInputElement>): void {
    const newName = e.target.value.slice(0, MAX_NAME_LEN);
    setState((s) => {
      const newSlug = s.slugManuallyEdited ? s.slug : deriveSlug(newName);
      if (newSlug !== s.slug) scheduleSlugCheck(newSlug);
      return { ...s, name: newName, slug: newSlug, slugError: null };
    });
  }

  function handleSlugChange(e: React.ChangeEvent<HTMLInputElement>): void {
    const raw = e.target.value.slice(0, MAX_SLUG_LEN).toLowerCase();
    setState((s) => ({
      ...s,
      slug: raw,
      slugManuallyEdited: true,
      slugError: null,
    }));
    scheduleSlugCheck(raw);
  }

  function handleSlugBlur(): void {
    if (state.slug) runSlugCheck(state.slug);
  }

  function handleLogoChange(file: File | null): void {
    if (!file) {
      setState((s) => ({
        ...s,
        logoFile: null,
        logoPreviewUrl: null,
        logoError: null,
      }));
      return;
    }
    if (file.size > LOGO_MAX_BYTES) {
      setState((s) => ({
        ...s,
        logoFile: null,
        logoPreviewUrl: null,
        logoError: LOGO_TOO_LARGE,
      }));
      return;
    }
    if (file.type !== 'image/png' && file.type !== 'image/jpeg') {
      setState((s) => ({
        ...s,
        logoFile: null,
        logoPreviewUrl: null,
        logoError: LOGO_WRONG_TYPE,
      }));
      return;
    }
    let preview: string | null = null;
    try {
      preview = URL.createObjectURL(file);
    } catch {
      preview = null;
    }
    setState((s) => ({
      ...s,
      logoFile: file,
      logoPreviewUrl: preview,
      logoError: null,
    }));
  }

  const canSubmit =
    !state.submitting &&
    state.name.trim().length > 0 &&
    state.slug.length > 0 &&
    !state.slugError &&
    !state.logoError;

  async function handleSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (!canSubmit) return;
    setState((s) => ({ ...s, submitting: true, serverError: null }));

    const createR = await createOrg({
      name: state.name.trim(),
      slug: state.slug,
    });
    if (!createR.ok) {
      const errCopy =
        createR.error === 'slug_taken'
          ? SLUG_TAKEN
          : createR.error === 'unauthenticated'
            ? 'You need to be signed in.'
            : "Couldn't create workspace. Check your connection and try again.";
      setState((s) => ({
        ...s,
        submitting: false,
        slugError: createR.error === 'slug_taken' ? errCopy : s.slugError,
        serverError: createR.error === 'slug_taken' ? null : errCopy,
      }));
      return;
    }

    const orgId = createR.data.org_id;
    const finalSlug = createR.data.slug;

    if (state.logoFile) {
      const uploadR = await uploadOrgLogo(orgId, state.logoFile);
      if (uploadR.ok) {
        await updateOrg({ org_id: orgId, logo_storage_path: uploadR.path });
      } else {
        // Logo upload failure is non-fatal — workspace is still created.
        toast("Couldn't upload logo. You can try again from Settings.", 'error');
      }
    }

    setState((s) => ({
      ...s,
      submitting: false,
      success: { slug: finalSlug },
    }));
  }

  function complete(openInviteModal: boolean): void {
    const slug = state.success?.slug ?? state.slug;
    if (onComplete) {
      onComplete(slug, openInviteModal);
    } else {
      defaultNavigate(slug, openInviteModal);
    }
  }

  // ----- Success state -----------------------------------------------
  if (state.success) {
    const url = `app.leanshot.app/clinic/${state.success.slug}`;
    return (
      <div className="max-w-xl mx-auto p-6 space-y-6" data-testid="org-create-success">
        <h2
          className="font-serif italic text-[28px] md:text-[36px] text-[var(--color-text)] leading-tight"
          style={{ fontFamily: 'Fraunces, ui-serif, Georgia, serif' }}
        >
          Workspace created
        </h2>
        <p className="text-[14px] text-[var(--color-text-secondary)] leading-relaxed">
          Your workspace is live at <span className="font-semibold">{url}</span>. Invite your
          first patient to get started.
        </p>
        <div className="flex flex-col-reverse md:flex-row gap-3">
          <Button variant="ghost" onClick={() => complete(false)}>
            Go to workspace
          </Button>
          <Button variant="primary" onClick={() => complete(true)}>
            Invite first patient
          </Button>
        </div>
      </div>
    );
  }

  // ----- Step 1 form -------------------------------------------------
  return (
    <form
      onSubmit={handleSubmit}
      className="max-w-xl mx-auto p-6 space-y-5"
      data-testid="org-create-flow"
    >
      <header className="space-y-1.5">
        <h1 className="text-[22px] md:text-[26px] font-bold text-[var(--color-text)]">
          Name your workspace
        </h1>
        <p className="text-[14px] text-[var(--color-text-secondary)] leading-relaxed">
          Patients see this name when you invite them. You can change it later.
        </p>
      </header>

      <Input
        ref={nameRef}
        label="Workspace name"
        placeholder="e.g. Northside Endocrinology"
        hint="1–60 characters. Use the clinic, practice, or coach name."
        value={state.name}
        onChange={handleNameChange}
        required
        autoComplete="off"
      />

      <div className="space-y-1.5">
        <label
          htmlFor="workspace-slug"
          className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--color-text-secondary)]"
        >
          Workspace URL
        </label>
        <div
          className={`flex items-center rounded-xl border bg-[var(--color-surface)] focus-within:border-[var(--color-primary)] focus-within:shadow-[0_0_0_3px_var(--color-primary-soft)] ${
            state.slugError ? 'border-[var(--color-danger)]' : 'border-[var(--color-border)]'
          }`}
        >
          <span className="pl-3 text-[13px] text-[var(--color-text-tertiary)] whitespace-nowrap">
            app.leanshot.app/clinic/
          </span>
          <input
            id="workspace-slug"
            type="text"
            value={state.slug}
            onChange={handleSlugChange}
            onBlur={handleSlugBlur}
            placeholder="northside-endo"
            aria-invalid={state.slugError ? true : undefined}
            className="flex-1 bg-transparent border-none outline-none px-2 py-3 text-[14px] placeholder:text-[var(--color-text-tertiary)]"
            autoComplete="off"
          />
        </div>
        <p
          className={`text-[12px] leading-snug ${
            state.slugError ? 'text-[var(--color-danger)]' : 'text-[var(--color-text-tertiary)]'
          }`}
        >
          {state.slugError ??
            "Lowercase letters, numbers, and hyphens. We picked one from your name — edit if you'd like."}
        </p>
      </div>

      {/* Logo upload --------------------------------------------------- */}
      <div className="space-y-1.5" role="group" aria-labelledby="logo-label">
        <span
          id="logo-label"
          className="block text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--color-text-secondary)]"
        >
          Workspace logo
        </span>
        <div className="flex items-center gap-3">
          <div
            className="size-16 rounded-md bg-[var(--color-surface-elevated)] border border-[var(--color-border)] inline-flex items-center justify-center overflow-hidden"
            data-testid="logo-preview"
          >
            {state.logoPreviewUrl ? (
               
              <img
                src={state.logoPreviewUrl}
                alt="Logo preview"
                className="size-full object-cover"
              />
            ) : (
              <ImageIcon
                className="size-6 text-[var(--color-text-tertiary)]"
                aria-hidden
              />
            )}
          </div>
          <div className="flex flex-col gap-1.5">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg"
              className="sr-only"
              aria-label="Workspace logo file"
              onChange={(e) => handleLogoChange(e.target.files?.[0] ?? null)}
            />
            <div className="flex gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => fileInputRef.current?.click()}
              >
                {state.logoFile ? 'Replace logo' : 'Upload logo'}
              </Button>
              {state.logoFile && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => handleLogoChange(null)}
                  leadingIcon={<XIcon className="size-3.5" />}
                >
                  Remove
                </Button>
              )}
            </div>
            <p
              className={`text-[12px] leading-snug ${
                state.logoError
                  ? 'text-[var(--color-danger)]'
                  : 'text-[var(--color-text-tertiary)]'
              }`}
            >
              {state.logoError ?? "PNG or JPEG, square, up to 2 MB. We'll show a monogram if you skip this."}
            </p>
          </div>
        </div>
      </div>

      {state.serverError && (
        <p role="alert" className="text-[13px] text-[var(--color-danger)]">
          {state.serverError}
        </p>
      )}

      <div className="flex flex-col-reverse md:flex-row gap-2 md:justify-end pt-2">
        {onCancel && (
          <Button type="button" variant="ghost" onClick={onCancel} disabled={state.submitting}>
            Cancel
          </Button>
        )}
        <Button type="submit" variant="primary" disabled={!canSubmit} loading={state.submitting}>
          Create workspace
        </Button>
      </div>
    </form>
  );
}

export default OrgCreateFlow;
