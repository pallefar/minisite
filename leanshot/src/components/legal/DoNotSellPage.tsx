/**
 * Phase 64 Plan 05 (LEGAL-02) — Do Not Sell or Share My Personal Information.
 *
 * Route: #/privacy/do-not-sell (added to App.tsx by Plan 64-07)
 *
 * CCPA/CPRA opt-out form. Posts to /functions/v1/privacy-optout-process
 * (deployed by Plan 64-02). Uses a pre-submit confirmation Modal per
 * UI-SPEC §Copywriting destructive confirmation pattern.
 *
 * SLA: 24h propagation across PostHog + ad-network + email-lifecycle per CONTEXT.md.
 *
 * Token compliance: uses ONLY @theme-defined CSS custom properties per Phase 60 BLOCKER rule.
 *
 * Draft disclaimer: This form is in draft pending Phase 70 legal counsel review.
 */
import { useState, type FormEvent } from 'react';
import { Helmet } from 'react-helmet-async';
import { LegalLayout } from './LegalLayout';
import { Input, Select } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Badge } from '@/components/ui/Badge';

interface FormState {
  name: string;
  email: string;
  state_residency: string;
  opt_out_advertising: boolean;
  opt_out_sale: boolean;
  opt_out_sharing: boolean;
}

interface FormErrors {
  name?: string;
  email?: string;
}

const SUPABASE_URL = import.meta.env['VITE_SUPABASE_URL'] as string | undefined;
const FN_URL = SUPABASE_URL
  ? `${SUPABASE_URL}/functions/v1/privacy-optout-process`
  : '/functions/v1/privacy-optout-process';

export function DoNotSellPage() {
  const [form, setForm] = useState<FormState>({
    name: '',
    email: '',
    state_residency: '',
    opt_out_advertising: false,
    opt_out_sale: false,
    opt_out_sharing: false,
  });
  const [errors, setErrors] = useState<FormErrors>({});
  const [modalOpen, setModalOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  function validate(): FormErrors {
    const errs: FormErrors = {};
    if (!form.name.trim()) errs.name = 'Name is required.';
    if (!form.email.trim()) {
      errs.email = 'Email is required.';
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) {
      errs.email = 'Enter a valid email address.';
    }
    return errs;
  }

  function handleChange(field: keyof FormState, value: string | boolean) {
    setForm((prev) => ({ ...prev, [field]: value }));
    if (field in errors) {
      setErrors((prev) => ({ ...prev, [field]: undefined }));
    }
  }

  function handleSubmitClick(e: FormEvent) {
    e.preventDefault();
    const errs = validate();
    if (Object.keys(errs).length > 0) {
      setErrors(errs);
      return;
    }
    setModalOpen(true);
  }

  async function handleConfirm() {
    setLoading(true);
    setModalOpen(false);
    setErrorMsg(null);
    try {
      const res = await fetch(FN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name.trim(),
          email: form.email.trim(),
          state_residency: form.state_residency || 'OTHER',
          opt_out_advertising: form.opt_out_advertising,
          opt_out_sale: form.opt_out_sale,
          opt_out_sharing: form.opt_out_sharing,
        }),
      });
      if (!res.ok) {
        setErrorMsg(
          'Try again — if the problem persists, email privacy@leanshot.app',
        );
      } else {
        setSubmitted(true);
      }
    } catch {
      setErrorMsg(
        'Try again — if the problem persists, email privacy@leanshot.app',
      );
    } finally {
      setLoading(false);
    }
  }

  if (submitted) {
    return (
      <LegalLayout title="Do Not Sell or Share My Personal Information">
        <Helmet>
          <title>Do Not Sell or Share My Personal Information · LeanShot</title>
          <meta
            name="description"
            content="Exercise your CCPA/CPRA right to opt out of the sale or sharing of your personal information."
          />
        </Helmet>
        <div className="space-y-4 text-[13px] text-[var(--color-text)]">
          <Badge tone="success">Submitted</Badge>
          <p>
            We&rsquo;ve received your request. Confirmation email sent to{' '}
            <strong>{form.email}</strong>. Allow 24 hours for propagation across our systems.
          </p>
          <em className="block text-[var(--color-text-tertiary)]">
            This form is in draft pending Phase 70 legal counsel review.
          </em>
        </div>
      </LegalLayout>
    );
  }

  return (
    <LegalLayout title="Do Not Sell or Share My Personal Information">
      <Helmet>
        <title>Do Not Sell or Share My Personal Information · LeanShot</title>
        <meta
          name="description"
          content="Exercise your CCPA/CPRA right to opt out of the sale or sharing of your personal information."
        />
      </Helmet>

      <p className="text-[13px] text-[var(--color-text-secondary)] leading-relaxed mb-6">
        Use this form to exercise your right under CCPA/CPRA to opt out of the sale or sharing of
        your personal information. We will process your request and propagate across our systems
        within 24 hours.
      </p>

      <em className="block text-[11px] text-[var(--color-text-tertiary)] mb-6">
        This form is in draft pending Phase 70 legal counsel review.
      </em>

      <form onSubmit={handleSubmitClick} className="space-y-5" noValidate>
        <Input
          label="Your name"
          name="name"
          required
          maxLength={200}
          value={form.name}
          onChange={(e) => handleChange('name', e.target.value)}
          error={errors.name}
          aria-label="Your name"
        />

        <Input
          label="Your email"
          name="email"
          type="email"
          required
          value={form.email}
          onChange={(e) => handleChange('email', e.target.value)}
          error={errors.email}
          aria-label="Your email"
        />

        <Select
          label="State residency"
          name="state_residency"
          value={form.state_residency}
          onChange={(e) => handleChange('state_residency', e.target.value)}
          aria-label="State residency"
        >
          <option value="">Select your state</option>
          <option value="CA">California (CCPA/CPRA)</option>
          <option value="VA">Virginia (CDPA)</option>
          <option value="CO">Colorado (CPA)</option>
          <option value="CT">Connecticut (CTDPA)</option>
          <option value="UT">Utah (UCPA)</option>
          <option value="OTHER">Other / Not listed</option>
        </Select>

        {/* Opt-out scope checkboxes */}
        <fieldset className="space-y-3">
          <legend className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--color-text-secondary)] mb-2">
            Opt-out scope (select all that apply)
          </legend>

          <label className="flex items-start gap-3 cursor-pointer text-[13px] text-[var(--color-text)]">
            <input
              type="checkbox"
              name="opt_out_advertising"
              checked={form.opt_out_advertising}
              onChange={(e) => handleChange('opt_out_advertising', e.target.checked)}
              className="mt-0.5 h-4 w-4 accent-[var(--color-primary)]"
              aria-label="Opt out of targeted advertising"
            />
            <span>Opt out of targeted advertising</span>
          </label>

          <label className="flex items-start gap-3 cursor-pointer text-[13px] text-[var(--color-text)]">
            <input
              type="checkbox"
              name="opt_out_sale"
              checked={form.opt_out_sale}
              onChange={(e) => handleChange('opt_out_sale', e.target.checked)}
              className="mt-0.5 h-4 w-4 accent-[var(--color-primary)]"
              aria-label="Opt out of sale of personal information"
            />
            <span>Opt out of sale of personal information</span>
          </label>

          <label className="flex items-start gap-3 cursor-pointer text-[13px] text-[var(--color-text)]">
            <input
              type="checkbox"
              name="opt_out_sharing"
              checked={form.opt_out_sharing}
              onChange={(e) => handleChange('opt_out_sharing', e.target.checked)}
              className="mt-0.5 h-4 w-4 accent-[var(--color-primary)]"
              aria-label="Opt out of sharing with third parties"
            />
            <span>Opt out of sharing with third parties</span>
          </label>
        </fieldset>

        {errorMsg && (
          <p role="alert" className="text-[13px] text-[var(--color-danger)]">
            {errorMsg}
          </p>
        )}

        <div className="flex gap-3 pt-2">
          <Button
            type="submit"
            variant="destructive"
            loading={loading}
            aria-busy={loading || undefined}
          >
            Submit opt-out request
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={() => window.history.back()}
          >
            Keep my information as-is
          </Button>
        </div>
      </form>

      {/* Pre-submit confirmation Modal — verbatim copy from UI-SPEC §Copywriting */}
      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title="Confirm opt-out request"
        size="sm"
      >
        <div className="space-y-4 text-[13px] text-[var(--color-text)] leading-relaxed">
          <p>
            Submit this opt-out request? You can change your mind later by emailing{' '}
            <a
              href="mailto:privacy@leanshot.app"
              className="underline decoration-1 underline-offset-2"
            >
              privacy@leanshot.app
            </a>
            . Allow 24 hours for propagation across our systems.
          </p>
          <div className="flex gap-3 justify-end pt-1">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => setModalOpen(false)}
            >
              Keep my information as-is
            </Button>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              onClick={() => { void handleConfirm(); }}
            >
              Submit opt-out request
            </Button>
          </div>
        </div>
      </Modal>
    </LegalLayout>
  );
}

export default DoNotSellPage;
