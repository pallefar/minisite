/**
 * Phase 19 Plan 19-06b — /partner/links page.
 *
 * Two-column desktop layout (UI-SPEC §/partner/links):
 *   Left  span=6: Referral URL display + Copy button
 *   Right span=6: 3-template picker (coach / story / method)
 *   Bottom span=12: PartnerCustomizeForm (5 fields + Save)
 *
 * Live-preview render is deferred to Plan 19-08 (landing renderers — TODO).
 *
 * Consumes usePartnerContext() (from PartnerLayout, 19-06a) for the
 * authenticated affiliate's profile.
 */
import { Copy } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { PartnerCustomizeForm } from '@/components/partner/PartnerCustomizeForm';
import { usePartnerContext } from '@/components/partner/PartnerLayout';
import {
  PartnerTemplatePicker,
  type TemplateChoice,
} from '@/components/partner/PartnerTemplatePicker';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { useToast } from '@/hooks/useToast';

const REFERRAL_ROOT = 'https://leanshot.app/r/';

export function PartnerLinksPage(): ReactNode {
  const { profile, refreshAll } = usePartnerContext();
  const toast = useToast();
  const userIdAsId = profile.id; // affiliate.id — used as Storage path prefix
  const [template, setTemplate] = useState<TemplateChoice>('coach');

  const referralUrl = profile.referral_code ? `${REFERRAL_ROOT}${profile.referral_code}` : '';

  const onCopy = async (): Promise<void> => {
    if (!referralUrl) return;
    try {
      await navigator.clipboard.writeText(referralUrl);
      toast('Link copied to clipboard', 'success');
    } catch {
      toast('Copy failed — long-press the link instead', 'error');
    }
  };

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-[26px] font-semibold text-[var(--color-text)]">Your referral link</h1>
        <p className="text-[14px] text-[var(--color-text-secondary)] mt-1">
          Send this anywhere — every click is attributed to you for 30 days.
        </p>
      </header>

      <div className="grid grid-cols-12 gap-4 md:gap-6">
        {/* Left: referral URL + copy */}
        <Card span={6} padding="lg">
          <h2 className="text-[14px] font-semibold text-[var(--color-text)] mb-3">
            Copy your link
          </h2>
          <div
            className="font-mono text-[15px] bg-[var(--color-surface-elevated)] border border-[var(--color-border)] rounded-card px-3 py-3 mb-4 break-all select-all"
            data-testid="referral-url"
          >
            {referralUrl || 'Pending referral code…'}
          </div>
          <Button
            variant="primary"
            leadingIcon={<Copy className="size-4" aria-hidden />}
            onClick={() => {
              void onCopy();
            }}
            disabled={!referralUrl}
          >
            Copy link
          </Button>
        </Card>

        {/* Right: template picker */}
        <Card span={6} padding="lg">
          <PartnerTemplatePicker selected={template} onChange={setTemplate} />
        </Card>

        {/* Bottom: customize form */}
        <Card span={12} padding="lg">
          <PartnerCustomizeForm
            userId={userIdAsId}
            selectedTemplate={template}
            initial={{
              display_name: profile.display_name ?? '',
              photo_path: '',
              blurb: '',
              calendly_url: '',
              testimonial_quote: '',
            }}
            onSaved={refreshAll}
          />
        </Card>

        {/* Live preview — Plan 19-08 owns this surface. */}
        <Card span={12} padding="lg" variant="flat">
          <p className="text-[13px] text-[var(--color-text-tertiary)] italic">
            Live preview coming soon — landing-page renderers ship in Plan 19-08.
          </p>
        </Card>
      </div>
    </div>
  );
}

export default PartnerLinksPage;
