/**
 * Phase 19 Plan 19-05 — `<AffiliateApplyForm>`.
 *
 * Public anonymous-visitor apply form. Posts to the `affiliate-apply`
 * Edge Function (verify_jwt=false) via `supabase.functions.invoke`.
 *
 * UI-SPEC §C.1 lock contract — copy + field-order + tone are verbatim
 * from the spec. No new tokens, no new sizes. 4 sizes per surface:
 *   text-3xl heading · text-base body · text-sm label · text-xs caption.
 *
 * Validation runs both client- AND server-side (the Edge Function
 * mirrors every check). The client validation here is UX-only; the
 * Edge Function is the security boundary.
 *
 * Submit-state ladder: idle → submitting → success (the card body is
 * replaced by the success-state heading + body; the form does NOT
 * re-render after success).
 *
 * Honeypot: an off-screen `<input name="honeypot">` is always sent
 * empty by humans. Bot submissions get a silent 200 from the Edge
 * Function (T-19-05-S mitigation).
 */
import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { FieldShell, Input, Textarea } from '@/components/ui/Input';
import { useToast } from '@/hooks/useToast';
import { cn } from '@/lib/helpers';
import { supabase } from '@/lib/supabase';

const AUDIENCE_TYPES = [
  'Instagram',
  'TikTok',
  'YouTube',
  'Newsletter',
  'Coaching',
  'Other',
] as const;

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const WHY_US_MAX = 500;

interface Errors {
  email?: string;
  name?: string;
  audience_size?: string;
  audience_type?: string;
  why_us?: string;
}

export function AffiliateApplyForm() {
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [audienceSize, setAudienceSize] = useState<string>('');
  const [audienceType, setAudienceType] = useState<string>('');
  const [whyUs, setWhyUs] = useState('');
  // Honeypot field — never displayed; bots fill any visible input.
  const [honeypot, setHoneypot] = useState('');
  const [errors, setErrors] = useState<Errors>({});
  const [submitting, setSubmitting] = useState(false);
  const [submittedEmail, setSubmittedEmail] = useState<string | null>(null);
  const toast = useToast();

  const validate = (): Errors => {
    const next: Errors = {};
    const e = email.trim();
    const n = name.trim();
    if (!e || !EMAIL_RE.test(e)) {
      next.email = 'Please enter a valid email address';
    }
    if (!n) {
      next.name = 'Please add your name';
    }
    const sizeNum = Number(audienceSize);
    if (
      audienceSize === '' ||
      !Number.isFinite(sizeNum) ||
      !Number.isInteger(sizeNum) ||
      sizeNum < 0
    ) {
      next.audience_size = 'Approximate is fine — even "1000" works';
    }
    if (!(AUDIENCE_TYPES as readonly string[]).includes(audienceType)) {
      next.audience_type = 'Please choose your primary audience';
    }
    if (whyUs.trim().length === 0) {
      next.why_us = 'Tell us a sentence or two about your audience';
    } else if (whyUs.length > WHY_US_MAX) {
      next.why_us = `Keep it under 500 characters (${whyUs.length}/${WHY_US_MAX})`;
    }
    return next;
  };

  const onSubmit = async (ev: React.FormEvent<HTMLFormElement>): Promise<void> => {
    ev.preventDefault();
    const next = validate();
    setErrors(next);
    if (Object.keys(next).length > 0) return;

    setSubmitting(true);
    try {
      const { data, error } = await supabase.functions.invoke<{
        ok?: boolean;
        already_applied?: boolean;
        email_warning?: boolean;
        error?: string;
      }>('affiliate-apply', {
        body: {
          email: email.trim(),
          name: name.trim(),
          audience_size: Number(audienceSize),
          audience_type: audienceType,
          why_us: whyUs.trim(),
          honeypot,
        },
      });

      if (error) {
        toast("Couldn't send your application. Check your connection and try again.", 'error');
        return;
      }
      if (data && data.ok) {
        // Success — both fresh and `already_applied` show the same success
        // state to the user (V11: never reveal duplicate / rejected state).
        setSubmittedEmail(email.trim());
        toast('Application received', 'success');
        return;
      }
      // Unexpected response shape → treat as transient error.
      toast("Couldn't send your application. Check your connection and try again.", 'error');
    } catch {
      toast("Couldn't send your application. Check your connection and try again.", 'error');
    } finally {
      setSubmitting(false);
    }
  };

  // Success state — replaces the form body. Form does NOT re-render
  // (UI-SPEC §"Submit-state ladder").
  if (submittedEmail !== null) {
    return (
      <Card variant="default" padding="lg">
        <div className="flex flex-col gap-3 text-center">
          <h2 className="text-3xl font-semibold tracking-tight text-[var(--color-text)]">
            Application received
          </h2>
          <p className="text-base text-[var(--color-text-secondary)] leading-relaxed">
            Thanks! We&apos;ll review your application in 3-5 business days and email you at{' '}
            <span className="font-semibold text-[var(--color-text)]">{submittedEmail}</span>.
          </p>
        </div>
      </Card>
    );
  }

  const whyUsCount = whyUs.length;
  const whyUsCounterDanger = whyUsCount > WHY_US_MAX;

  return (
    <Card variant="default" padding="lg">
      <form
        onSubmit={onSubmit}
        className="flex flex-col gap-5"
        noValidate
        aria-describedby="apply-form-subhead"
      >
        <header className="flex flex-col gap-2">
          <h1 className="text-3xl font-semibold tracking-tight text-[var(--color-text)]">
            Apply to the LeanShot affiliate program
          </h1>
          <p
            id="apply-form-subhead"
            className="text-base text-[var(--color-text-secondary)] leading-relaxed"
          >
            Earn $10 for every paid LeanShot subscription that comes from your audience. Manual
            review in 3-5 business days.
          </p>
        </header>

        {/* Honeypot — hidden from humans + screen readers; bots fill it. */}
        <div aria-hidden="true" className="absolute -left-[9999px] w-px h-px overflow-hidden">
          <label>
            Website (do not fill)
            <input
              type="text"
              name="website"
              tabIndex={-1}
              autoComplete="off"
              value={honeypot}
              onChange={(e) => setHoneypot(e.target.value)}
            />
          </label>
        </div>

        <Input
          label="Your email"
          type="email"
          autoComplete="email"
          required
          placeholder="you@example.com"
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            if (errors.email) setErrors((prev) => ({ ...prev, email: undefined }));
          }}
          error={errors.email}
          disabled={submitting}
        />

        <Input
          label="Your name"
          type="text"
          autoComplete="name"
          required
          placeholder="Full name as you'd like it shown"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            if (errors.name) setErrors((prev) => ({ ...prev, name: undefined }));
          }}
          error={errors.name}
          disabled={submitting}
        />

        <Input
          label="Audience size"
          type="number"
          min={0}
          required
          placeholder="Approximate followers / subscribers"
          value={audienceSize}
          onChange={(e) => {
            setAudienceSize(e.target.value);
            if (errors.audience_size) setErrors((prev) => ({ ...prev, audience_size: undefined }));
          }}
          error={errors.audience_size}
          disabled={submitting}
        />

        {/* Native <select> styled to match Input — UI-SPEC line 163 forbids a Combobox lib. */}
        <FieldShell label="Primary audience" required error={errors.audience_type}>
          <select
            aria-label="Primary audience"
            required
            disabled={submitting}
            value={audienceType}
            onChange={(e) => {
              setAudienceType(e.target.value);
              if (errors.audience_type)
                setErrors((prev) => ({ ...prev, audience_type: undefined }));
            }}
            className={cn(
              'flex-1 bg-transparent border-none outline-none appearance-none px-4 py-3 pe-10 text-[14px] cursor-pointer disabled:cursor-not-allowed bg-no-repeat bg-[length:18px_18px] bg-[right_14px_center]',
            )}
            style={{
              backgroundImage:
                "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E\")",
            }}
          >
            <option value="" disabled>
              Choose one
            </option>
            {AUDIENCE_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </FieldShell>

        <div className="flex flex-col gap-1.5">
          <Textarea
            label="Why us?"
            rows={5}
            required
            placeholder="Tell us about your audience and why LeanShot is a fit (max 500 chars)"
            value={whyUs}
            onChange={(e) => {
              setWhyUs(e.target.value);
              if (errors.why_us) setErrors((prev) => ({ ...prev, why_us: undefined }));
            }}
            error={errors.why_us}
            disabled={submitting}
          />
          <p
            className={cn(
              'text-xs leading-snug text-end tabular-nums',
              whyUsCounterDanger
                ? 'text-[var(--color-danger)]'
                : 'text-[var(--color-text-tertiary)]',
            )}
            aria-live="polite"
          >
            {whyUsCount}/{WHY_US_MAX}
          </p>
        </div>

        <Button
          type="submit"
          variant="primary"
          size="lg"
          block
          loading={submitting}
          aria-busy={submitting}
        >
          {submitting ? 'Sending...' : 'Submit application'}
        </Button>
      </form>
    </Card>
  );
}

export default AffiliateApplyForm;
