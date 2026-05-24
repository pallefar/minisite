/**
 * Phase 39 Plan 39-05 Task 2 — PharmaContentBlock (Surface F).
 *
 * Tiered pharma content render — used both as a page-builder block AND as
 * a standalone surface (see 39-CONTEXT Surface F). Wraps the free-tier
 * branch in PaywallGate so all THREE D-06 phaCheck layers stack:
 *   - Layer 1: ESLint AST rule (no-paywall-on-safety-category.cjs)
 *   - Layer 2: phaCheck() runtime helper (invoked inside PaywallGate via
 *              safety-carveout.ts)
 *   - Layer 3: PharmaContentBlock cascade — branch on the safety helper
 *              BEFORE evaluating the free-tier paywall branch.
 *
 * Cascade order (D-07 → D-05 → tier → paywall):
 *   1. isPharmaRegionBlocked() === true → FULL content (no badge, no gate)
 *      WA/CT carveout, silent to user per UI-SPEC.
 *   2. helper says "is safety-info" → FULL content + SafetyInfoBadge
 *      (NEVER paywalled per D-05; badge ALWAYS shown alongside per UI-SPEC).
 *   3. tier === 'pro' → FULL content (no badge unless ALSO safety, but
 *      that case is already handled by branch 2).
 *   4. tier === 'free' + non-safety + non-region → SUMMARY + inline upgrade
 *      CTA wrapped in <PaywallGate surface="pharma">.
 *
 * Why is the D-05 sentinel-column READ extracted into
 * ./safety-render-helper.ts? The D-06 layer 3 CI grep gate flags any
 * source file containing BOTH a Paywall* identifier and the sentinel
 * column name (comment-stripped). Mirrors the same carveout
 * PaywallGate.tsx uses via ./safety-carveout.ts. The sentinel name MUST
 * NOT appear in this file — not in comments, not in type declarations,
 * not in destructuring — see [[feedback_negation_grep_defeated_by_comment_string]].
 *
 * Why useEffect for tier? getContentTier() is async (reads tier_effective
 * via supabase). UI-SPEC Hard Constraint #5 forbids useQuery/useMutation;
 * we use the same pattern as PaywallGate: useEffect + setState + cancel
 * flag. There is NO loading state per UI-SPEC Interaction States — the
 * render decision IS the loading state; until the tier resolves we render
 * the safe baseline (treat as free; the cascade re-renders when tier lands).
 */
import { useEffect, useState } from 'react';
import { PaywallGate } from '@/components/paywall/PaywallGate';
import { Button } from '@/components/ui/Button';
import { getContentTier } from '@/lib/pharma/get-content-tier';
import { isPharmaRegionBlocked } from '@/lib/pharma/region-detect';
import {
  describesSafetyInfo,
  getSafetyCategoryLabel,
  type SafetyDescribable,
} from './safety-render-helper';
import { SafetyInfoBadge } from './SafetyInfoBadge';

/**
 * Local content shape PharmaContentBlock consumes. The D-05 sentinel
 * column is inherited from SafetyDescribable (sibling helper file) so this
 * source file never references it directly — keeps the D-06 layer 3 CI
 * grep gate green. The index signature lets it satisfy PaywallGate's
 * `content: PharmaContent` prop (which accepts `[k: string]: unknown`
 * per phaCheck's contract — see src/lib/pharma/phaCheck.ts).
 */
export interface PharmaContent extends SafetyDescribable {
  id: string;
  slug: string;
  summary: string;
  full_content: string;
  /** Category surfaced in the upgrade CTA copy ("Upgrade to Pro for full {category} details"). */
  category?: string;
  [k: string]: unknown;
}

export interface PharmaContentBlockProps {
  content: PharmaContent;
}

export function PharmaContentBlock({ content }: PharmaContentBlockProps) {
  // Branch 1 (D-07) — synchronous, profile/cookie read. Cheapest first.
  const regionBlocked = isPharmaRegionBlocked();

  // Branch 2 (D-05) — synchronous helper read (kept in sibling file per grep-gate carveout).
  const safetyInfo = describesSafetyInfo(content);

  // Branch 3 (tier) — async; defer to effect, default to 'free' until resolved.
  const [tier, setTier] = useState<'pro' | 'free'>('free');

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const resolved = await getContentTier();
        if (!cancelled) setTier(resolved);
      } catch {
        if (!cancelled) setTier('free');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [content.id]);

  // Cascade — earliest branch wins.
  if (regionBlocked) {
    return (
      <article className="pharma-content-block">
        <FullContent text={content.full_content} />
      </article>
    );
  }

  if (safetyInfo.isSafety) {
    return (
      <article className="pharma-content-block flex flex-col gap-2">
        <SafetyInfoBadge category={safetyInfo.label} />
        <FullContent text={content.full_content} />
      </article>
    );
  }

  if (tier === 'pro') {
    return (
      <article className="pharma-content-block">
        <FullContent text={content.full_content} />
      </article>
    );
  }

  // Free + non-safety + non-region → summary + inline upgrade CTA, wrapped in the gate.
  const ctaCategory = content.category ?? getSafetyCategoryLabel(content) ?? 'content';
  return (
    <PaywallGate content={content} surface="pharma">
      <article className="pharma-content-block flex flex-col gap-2">
        <p className="text-base">{content.summary}</p>
        <p className="text-sm text-text-tertiary">
          (1-2 sentence summary; Pro members see full content)
        </p>
        <div className="mt-2">
          <Button variant="primary">{`Upgrade to Pro for full ${ctaCategory} details`}</Button>
        </div>
      </article>
    </PaywallGate>
  );
}

function FullContent({ text }: { text: string }) {
  return (
    <div className="pharma-full-content">
      <p className="text-base whitespace-pre-line">{text}</p>
    </div>
  );
}
