/**
 * Phase 41 Plan 41-05 — CustomIframeBlock (new block component for the
 * `custom_iframe` BlockType added in Plan 41-02).
 *
 * Validation pipeline:
 *   1. embedUrl empty   → UI-SPEC §Surface C "Embed URL is required" error.
 *   2. protocol mismatch → "URL must start with https://" error.
 *   3. hostname mismatch → "Hostname [host] is not on the allowlist..." error.
 *   4. valid             → render ConsentGatedEmbed with FIXED sandbox D-16.
 *
 * D-16 sandbox FIXED to `'allow-scripts allow-same-origin'` — this literal is
 * passed at the call site (NOT forwarded from block.content) so admin cannot
 * override (T-41-05-07 mitigation).
 *
 * D-07 categories FIXED to `['marketing']` for custom_iframe.
 *
 * Allowlist is fetched once on mount via listHostnames(supabase). While
 * loading, render a Skeleton (no error, no iframe).
 */
import { useEffect, useState, type JSX } from 'react';
import { Card } from '@/components/ui/Card';
import { Skeleton } from '@/components/ui/Skeleton';
import { listHostnames } from '@/lib/admin/iframe-allowlist';
import type { BlockNode } from '@/lib/page-builder/block-schema';
import {
  EMBED_IFRAME_TITLES,
  validateCustomIframeUrl,
  type CustomIframeContent,
} from '@/lib/page-builder/embed-src';
import { supabase } from '@/lib/supabase';
import { backgroundToneClass, paddingForDensity } from './block-style-helpers';
import { ConsentGatedEmbed } from './ConsentGatedEmbed';

export interface CustomIframeBlockProps {
  block: BlockNode;
}

interface CustomIframeContentShape {
  embedUrl?: unknown;
  iframeTitle?: unknown;
  widthMode?: unknown;
}

type ValidationError =
  | { kind: 'empty' }
  | { kind: 'protocol' }
  | { kind: 'allowlist'; hostname: string };

function classifyError(
  raw: string,
  allowlistHostnames: ReadonlyArray<string>,
): ValidationError | null {
  if (raw.trim() === '') return { kind: 'empty' };
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return { kind: 'protocol' };
  }
  if (parsed.protocol !== 'https:') return { kind: 'protocol' };
  if (!allowlistHostnames.includes(parsed.hostname)) {
    return { kind: 'allowlist', hostname: parsed.hostname };
  }
  return null;
}

function renderInlineError(err: ValidationError): JSX.Element {
  let msg: string;
  switch (err.kind) {
    case 'empty':
      msg = 'Embed URL is required';
      break;
    case 'protocol':
      msg = 'URL must start with https://';
      break;
    case 'allowlist':
      msg = `Hostname [${err.hostname}] is not on the allowlist. Ask a superadmin to add it at /admin/embeds/allowlist.`;
      break;
  }
  return (
    <Card
      variant="default"
      padding="md"
      aria-invalid={true}
      className="border-2 border-[var(--color-danger)]"
    >
      <p className="text-[13px] text-[var(--color-danger)]">{msg}</p>
    </Card>
  );
}

export function CustomIframeBlock({ block }: CustomIframeBlockProps): JSX.Element {
  const rawContent = (block.content ?? {}) as CustomIframeContentShape;
  const embedUrl = typeof rawContent.embedUrl === 'string' ? rawContent.embedUrl : '';
  const iframeTitle = typeof rawContent.iframeTitle === 'string' ? rawContent.iframeTitle : '';
  const widthMode = rawContent.widthMode === false ? false : true;

  const tone = block.style.backgroundTone ?? 'default';
  const density = block.style.spacingDensity ?? 'default';
  const hideOnMobile = !!block.style.hideOnMobile;

  // Fetch allowlist once on mount. `null` while loading; `string[]` once ready.
  const [allowlist, setAllowlist] = useState<string[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const rows = await listHostnames(supabase);
        if (cancelled) return;
        setAllowlist(rows.map((r) => r.hostname));
      } catch {
        // On fetch failure, treat as empty allowlist — fail closed so URLs
        // fall through to the inline error (defends T-41-05-03).
        if (!cancelled) setAllowlist([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const wrapperClassName =
    backgroundToneClass(tone) +
    ' w-full px-6 ' +
    (hideOnMobile ? 'hidden md:block ' : '');

  const innerWrapperClassName = widthMode ? '' : 'max-w-[900px] mx-auto';

  return (
    <section
      className={wrapperClassName}
      style={{ paddingTop: paddingForDensity(density), paddingBottom: paddingForDensity(density) }}
    >
      <div className={innerWrapperClassName + ' max-w-3xl mx-auto'}>
        {allowlist === null ? (
          <Skeleton className="w-full" style={{ minHeight: 400 }} />
        ) : (() => {
          const err = classifyError(embedUrl, allowlist);
          if (err) return renderInlineError(err);
          const validated = validateCustomIframeUrl(embedUrl, allowlist);
          if (!validated) {
            // Should not happen — classifyError ran above — but fail closed.
            return renderInlineError({ kind: 'allowlist', hostname: 'unknown' });
          }
          const content: CustomIframeContent = { embedUrl, iframeTitle, widthMode };
          const titleAttr =
            typeof content.iframeTitle === 'string' && content.iframeTitle.length >= 3
              ? content.iframeTitle
              : EMBED_IFRAME_TITLES.custom_iframe;
          return (
            <ConsentGatedEmbed
              provider="custom_iframe"
              categories={['marketing']}
              minHeight={400}
              // D-16 FIXED sandbox literal — admin cannot override via block.content.
              sandbox="allow-scripts allow-same-origin"
              title={titleAttr}
              src={validated}
            />
          );
        })()}
      </div>
    </section>
  );
}
