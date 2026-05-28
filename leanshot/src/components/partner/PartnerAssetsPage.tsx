/**
 * Phase 19 Plan 19-06b — /partner/assets page.
 *
 * Grid of admin-seeded marketing assets (logos, banners, swipe-copy).
 * Per CONTEXT D-13/D-14, assets live at the platform-level Storage bucket
 * `marketing-assets/v1/`. Plan 19-08 populates the bucket; this plan ships
 * the UI shell + a hardcoded asset manifest. When the bucket has no objects
 * yet, the shell falls through to the empty state (UI-SPEC).
 *
 * Download flow: createSignedUrl(path, 3600) — 1-hour TTL signed URLs.
 *
 * Spec: 19-UI-SPEC.md §/partner/assets + Copywriting Contract.
 */
import { Download } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { useToast } from '@/hooks/useToast';
import { supabase } from '@/lib/supabase';

interface MarketingAsset {
  id: string;
  /** Path inside the `marketing-assets` bucket. e.g. `v1/logo-200.png`. */
  path: string;
  name: string;
  /** Human-readable metadata line: e.g. "PNG · 728×90 · 24 KB". */
  meta: string;
  /** Optional thumbnail path (defaults to `path` if not provided). */
  thumbnailPath?: string;
}

// D-14 seed manifest — Plan 19-08 populates the actual files. UI is forward-
// compatible: when files are missing, download fails gracefully (toast).
const ASSETS: MarketingAsset[] = [
  { id: 'logo-svg', path: 'v1/logo.svg', name: 'Logo (SVG)', meta: 'SVG · vector · 4 KB' },
  { id: 'logo-200', path: 'v1/logo-200.png', name: 'Logo 200×200', meta: 'PNG · 200×200 · 18 KB' },
  {
    id: 'logo-1200',
    path: 'v1/logo-1200.png',
    name: 'Logo 1200×1200',
    meta: 'PNG · 1200×1200 · 86 KB',
  },
  {
    id: 'banner-728',
    path: 'v1/banner-728x90.png',
    name: 'Banner 728×90',
    meta: 'PNG · 728×90 · 24 KB',
  },
  {
    id: 'banner-300',
    path: 'v1/banner-300x250.png',
    name: 'Banner 300×250',
    meta: 'PNG · 300×250 · 19 KB',
  },
  {
    id: 'banner-1080',
    path: 'v1/banner-1080x1080.png',
    name: 'Banner 1080×1080',
    meta: 'PNG · 1080×1080 · 68 KB',
  },
  {
    id: 'email-template',
    path: 'v1/swipe-email.txt',
    name: 'Swipe email copy',
    meta: 'TXT · 2 KB',
  },
  {
    id: 'social-template',
    path: 'v1/swipe-social.txt',
    name: 'Swipe social copy',
    meta: 'TXT · 1 KB',
  },
];

export function PartnerAssetsPage(): ReactNode {
  const toast = useToast();
  const [downloading, setDownloading] = useState<string | null>(null);

  const onDownload = async (asset: MarketingAsset): Promise<void> => {
    if (downloading) return;
    setDownloading(asset.id);
    try {
      const res = await supabase.storage.from('marketing-assets').createSignedUrl(asset.path, 3600);
      if (res.error || !res.data?.signedUrl) {
        // Plan 19-08 hasn't seeded the bucket yet — surface a friendly message.
        toast('This asset isn’t ready yet — check back in a day or two.', 'info');
        return;
      }
      window.open(res.data.signedUrl, '_blank', 'noopener,noreferrer');
    } catch {
      toast('Couldn’t generate download link.', 'error');
    } finally {
      setDownloading(null);
    }
  };

  // If the manifest is empty (future-proof), render the empty state.
  if (ASSETS.length === 0) {
    return (
      <div className="space-y-6">
        <header>
          <h1 className="text-[26px] font-semibold text-[var(--color-text)]">Marketing assets</h1>
          <p className="text-[14px] text-[var(--color-text-secondary)] mt-1">
            Logos, banners, swipe-copy. Use these in your content; they’re licensed for affiliate
            use only.
          </p>
        </header>
        <Card span={12} padding="lg">
          <EmptyState
            inline
            title="Assets coming soon"
            body="We’re preparing logo packs, banner sets, and swipe-copy. Check back in a day or two."
          />
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-[26px] font-semibold text-[var(--color-text)]">Marketing assets</h1>
        <p className="text-[14px] text-[var(--color-text-secondary)] mt-1">
          Logos, banners, swipe-copy. Use these in your content; they’re licensed for affiliate use
          only.
        </p>
      </header>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {ASSETS.map((asset) => (
          <Card key={asset.id} variant="default" padding="md">
            <div
              aria-hidden
              className="aspect-video rounded-card bg-[var(--color-surface-elevated)] border border-[var(--color-border)] mb-3 flex items-center justify-center"
            >
              <span className="text-[12px] text-[var(--color-text-tertiary)] font-mono">
                {asset.path.split('/').pop()}
              </span>
            </div>
            <div className="text-[14px] font-semibold text-[var(--color-text)]">{asset.name}</div>
            <div className="text-[12px] text-[var(--color-text-secondary)] mb-3">{asset.meta}</div>
            <Button
              variant="secondary"
              size="sm"
              leadingIcon={<Download className="size-4" aria-hidden />}
              block
              loading={downloading === asset.id}
              onClick={() => {
                void onDownload(asset);
              }}
            >
              Download
            </Button>
          </Card>
        ))}
      </div>
    </div>
  );
}

export default PartnerAssetsPage;
