/**
 * Phase 61 Plan 07 Task 3 — Public /protocols/<slug> read-only protocol view.
 *
 * Auth-gated: signed-in users only. selectView returns 'auth' when opts.user is null.
 * Only review_state='published' protocols are resolvable via get_protocol_by_slug RPC.
 *
 * SEO: noindex per T-61-07-01 — clinical content should not be crawled/cached.
 *
 * Typography ceiling: 28/18/13/11 px + 400/600 weights only.
 */

import { useEffect, useState } from 'react';
import { Helmet } from 'react-helmet-async';
import { EmptyState } from '@/components/ui/EmptyState';
import { Skeleton } from '@/components/ui/Skeleton';
import { supabase } from '@/lib/supabase';
import type { ProtocolStep, ProtocolEvidence } from '@/types/protocols';

// ─── Types ────────────────────────────────────────────────────────────────────

interface ProtocolMeta {
  id: string;
  version: number;
  name: string;
  compound: string;
  audience: string[];
  slug: string;
  base_slug: string;
  published_at: string | null;
}

interface ProtocolViewData {
  protocol: ProtocolMeta;
  steps: ProtocolStep[];
  evidence: ProtocolEvidence[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Extract the base slug from the current pathname: /protocols/<slug>[/] */
function getSlugFromPathname(): string | null {
  const m = window.location.pathname.match(/^\/protocols\/([^/]+)\/?$/);
  return m ? m[1]! : null;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function PublicProtocolPage() {
  const slug = getSlugFromPathname();

  const [data, setData] = useState<ProtocolViewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (!slug) {
      setNotFound(true);
      setLoading(false);
      return;
    }

    let cancelled = false;

    (async () => {
      // RPC get_protocol_by_slug returns the published protocol with its steps + evidence.
      // The RPC was provided by Plan 61-02 — do NOT add a new RPC.
      const { data: rpcResult, error } = await supabase.rpc('get_protocol_by_slug', {
        p_base_slug: slug,
      });

      if (cancelled) return;

      if (error || !rpcResult) {
        setNotFound(true);
        setLoading(false);
        return;
      }

      // RPC may return an array or a single object depending on call shape
      const row = Array.isArray(rpcResult)
        ? (rpcResult[0] as Record<string, unknown> | undefined)
        : (rpcResult as Record<string, unknown>);

      if (!row?.id) {
        setNotFound(true);
        setLoading(false);
        return;
      }

      setData({
        protocol: {
          id: row.id as string,
          version: row.version as number,
          name: row.name as string,
          compound: row.compound as string,
          audience: (row.audience as string[]) ?? [],
          slug: (row.slug as string) ?? slug,
          base_slug: (row.base_slug as string) ?? slug,
          published_at: (row.published_at as string | null) ?? null,
        },
        steps: (row.steps as ProtocolStep[]) ?? [],
        evidence: (row.evidence as ProtocolEvidence[]) ?? [],
      });
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [slug]);

  return (
    <>
      <Helmet>
        {/* T-61-07-01: noindex — clinical content should not be crawled or cached */}
        <meta name="robots" content="noindex" />
        {data && <title>{data.protocol.name} — LeanShot</title>}
      </Helmet>

      <main className="max-w-[680px] mx-auto px-6 py-12">
        {loading && (
          <div className="space-y-4">
            <Skeleton className="h-8 w-2/3" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-32 w-full" />
          </div>
        )}

        {!loading && notFound && (
          <EmptyState title="Protocol not found" body="This protocol is not available." />
        )}

        {data && (
          <>
            {/* ── Header ─────────────────────────────────────────────── */}
            <h1 className="text-[28px] font-semibold leading-snug mb-2">{data.protocol.name}</h1>
            <div className="flex flex-wrap items-center gap-2 text-[13px] text-[var(--color-text-secondary)] mb-6">
              <span>{data.protocol.compound}</span>
              <span aria-hidden="true">•</span>
              {data.protocol.audience.map((a) => (
                <span
                  key={a}
                  className="inline-flex items-center px-2 py-0.5 rounded-pill text-[11px] bg-[var(--color-surface-elevated)] border border-[var(--color-border)] text-[var(--color-text-secondary)]"
                >
                  {a}
                </span>
              ))}
              <span aria-hidden="true">•</span>
              <span className="text-[11px] font-mono">v{data.protocol.version}</span>
              {data.protocol.published_at && (
                <>
                  <span aria-hidden="true">•</span>
                  <span className="text-[11px]">
                    {new Date(data.protocol.published_at).toLocaleDateString()}
                  </span>
                </>
              )}
            </div>

            {/* ── Steps table ────────────────────────────────────────── */}
            {data.steps.length > 0 && (
              <table className="w-full text-[13px] mb-8" aria-label="Protocol steps">
                <thead>
                  <tr className="text-[11px] text-[var(--color-text-secondary)] border-b border-[var(--color-border)]">
                    <th className="text-left py-2 font-semibold">Week</th>
                    <th className="text-left py-2 font-semibold">Dose</th>
                    <th className="text-left py-2 font-semibold">Frequency</th>
                    <th className="text-left py-2 font-semibold">Monitoring</th>
                  </tr>
                </thead>
                <tbody>
                  {data.steps.map((step) => (
                    <tr key={step.id} className="border-t border-[var(--color-border)]">
                      <td className="py-2 font-mono tabular-nums">{step.week}</td>
                      <td className="py-2 font-mono tabular-nums">{step.dose_mg}mg</td>
                      <td className="py-2">{step.frequency}</td>
                      <td className="py-2 text-[var(--color-text-secondary)]">
                        {step.monitoring.join(', ')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {/* ── Evidence footnotes ─────────────────────────────────── */}
            {data.evidence.length > 0 && (
              <section>
                <h2 className="text-[18px] font-semibold mb-3">Supporting Evidence</h2>
                <ol className="space-y-2 list-none p-0">
                  {data.evidence.map((e, i) => (
                    <li key={e.id} className="text-[13px]">
                      <sup className="text-[11px] text-[var(--color-text-secondary)]">
                        [{i + 1}]
                      </sup>{' '}
                      {e.citation_text}
                    </li>
                  ))}
                </ol>
              </section>
            )}
          </>
        )}
      </main>
    </>
  );
}
