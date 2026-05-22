/**
 * Phase 36 Plan 36-04 Task 3 — CtaCatalogPage (Surface F).
 *
 * Read-only table of the 5-row review_cta_catalog seed (Wave 1).
 * Rows with requires_mobile_shell=true (Apple App Store / Google Play) get the
 * "v1.4 — needs mobile shell" warning pill (D-13).
 *
 * No Add button — catalog is migration-seeded in v1.3; inline editor ships in v1.4.
 */
import { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { useToast } from '@/hooks/useToast';
import { supabase } from '@/lib/supabase';

interface CatalogRow {
  slug: string;
  display_name: string;
  available_for_org_type: string | null;
  url_pattern: string;
  requires_mobile_shell: boolean;
  claimed: boolean;
}

export default function CtaCatalogPage(): React.JSX.Element {
  const toast = useToast();
  const [rows, setRows] = useState<CatalogRow[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { data, error } = await supabase.rpc('list_review_cta_catalog');
      if (cancelled) return;
      if (error) {
        toast(`Could not load catalog: ${error.message}`, 'error');
        setRows([]);
        return;
      }
      setRows((data ?? []) as CatalogRow[]);
    })();
    return () => {
      cancelled = true;
    };
  }, [toast]);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-semibold">Review CTA Catalog</h1>
        <p className="text-sm text-[var(--color-text-secondary)]">
          External review destinations resolved per user cohort.
        </p>
      </header>

      <Card variant="default" padding="md">
        {rows === null ? (
          <p className="text-sm text-[var(--color-text-secondary)]" aria-busy>
            Loading…
          </p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-[var(--color-text-tertiary)]">
            Catalog empty — check seed migration.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-start text-[12px] uppercase tracking-wide text-[var(--color-text-tertiary)]">
                  <th className="text-start py-2 pe-3">Slug</th>
                  <th className="text-start py-2 pe-3">Display name</th>
                  <th className="text-start py-2 pe-3">Cohort</th>
                  <th className="text-start py-2 pe-3">URL pattern</th>
                  <th className="text-start py-2 pe-3">Available now</th>
                  <th className="text-start py-2">Claimed</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-border)]">
                {rows.map((row) => (
                  <tr key={row.slug}>
                    <td className="py-2 pe-3 font-mono text-[12px]">{row.slug}</td>
                    <td className="py-2 pe-3 font-semibold">{row.display_name}</td>
                    <td className="py-2 pe-3 text-[var(--color-text-secondary)]">
                      {row.available_for_org_type ?? '—'}
                    </td>
                    <td className="py-2 pe-3 font-mono text-[12px] text-[var(--color-text-secondary)] truncate max-w-[260px]">
                      {row.url_pattern}
                    </td>
                    <td className="py-2 pe-3">
                      {row.requires_mobile_shell ? (
                        <Badge tone="warning">v1.4 — needs mobile shell</Badge>
                      ) : (
                        <Badge tone="success">Live (web)</Badge>
                      )}
                    </td>
                    <td className="py-2">
                      <span
                        aria-label={row.claimed ? 'Claimed' : 'Pending claim'}
                        title={
                          row.claimed
                            ? 'Profile claimed.'
                            : 'Profile must be claimed before live fires.'
                        }
                        className={
                          row.claimed
                            ? 'inline-block w-2.5 h-2.5 rounded-full bg-[var(--color-success)]'
                            : 'inline-block w-2.5 h-2.5 rounded-full bg-[var(--color-warning)]'
                        }
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <p className="text-[13px] text-[var(--color-text-tertiary)]">
        Catalog managed via migration in v1.3. Inline editor ships in v1.4.
      </p>
    </div>
  );
}
