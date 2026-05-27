/**
 * Phase 60 Plan 60-10 Task 5 — RefusalCard component.
 *
 * Renders a distinct refusal UX for G1 PHARMA-02 / G3-G4 out-of-corpus /
 * G5 citation-validation-failed paths per UI-SPEC §5.
 *
 * CRITICAL INVARIANTS:
 *   - ZERO citation markers ([N]) in ANY RefusalCard output (UI-SPEC invariant 2)
 *   - ZERO Sources footer in ANY RefusalCard output (UI-SPEC invariant 2)
 *   - PHARMA-02 copy is BYTE-EXACT to Phase 39 39-02 D-06 locked string (invariant 3)
 *     The locked string MUST match: "That topic requires clinician guidance — please ask your doctor."
 *
 * Icon mapping per UI-SPEC §5:
 *   pharma_02               → AlertTriangle (medical safety — most severe)
 *   out_of_corpus           → Info (knowledge-gap — informational)
 *   citation_validation_failed → AlertCircle (evidence-quality — caution)
 *
 * Disclaimer: rendered for out_of_corpus + citation_validation_failed ONLY.
 * NOT rendered for pharma_02 (the refusal IS the safety intervention — UI-SPEC §5).
 */

import { AlertTriangle, Info, AlertCircle, type LucideIcon } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { cn } from '@/lib/helpers';
import { useRagTranslation, RAG_REFUSAL_KIND_TO_KEY, type RefusalKind } from '@/lib/rag/i18n';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface RefusalCardProps {
  kind: RefusalKind;
}

// ─── Icon + tone mapping ──────────────────────────────────────────────────────

const KIND_ICON: Record<RefusalKind, LucideIcon> = {
  pharma_02: AlertTriangle,
  out_of_corpus: Info,
  citation_validation_failed: AlertCircle,
};

const KIND_ICON_CLASS: Record<RefusalKind, string> = {
  pharma_02: 'text-[var(--color-warning)]',
  out_of_corpus: 'text-[var(--color-info)]',
  citation_validation_failed: 'text-[var(--color-warning)]',
};

// ─── Component ────────────────────────────────────────────────────────────────

export function RefusalCard({ kind }: RefusalCardProps) {
  const { t } = useRagTranslation();
  const Icon = KIND_ICON[kind];
  const iconClass = KIND_ICON_CLASS[kind];

  // Pull copy from i18n — PHARMA-02 value is the locked string from Phase 39 39-02 D-06
  const refusalText = t(RAG_REFUSAL_KIND_TO_KEY[kind]);

  // Disclaimer shown for out_of_corpus + citation_validation_failed ONLY
  // pharma_02 omits disclaimer (the refusal IS the safety intervention — UI-SPEC §5)
  const showDisclaimer = kind !== 'pharma_02';

  return (
    <Card variant="flat" padding="sm">
      <div className="flex items-start gap-3">
        <Icon
          className={cn('size-4 shrink-0 mt-0.5', iconClass)}
          aria-hidden
        />
        <div className="space-y-1.5 min-w-0">
          <p className="text-[13px] text-[var(--color-text)] leading-relaxed">
            {refusalText}
          </p>
          {showDisclaimer && (
            <p className="text-[11px] text-[var(--color-text-tertiary)]">
              {t('disclaimer')}
            </p>
          )}
        </div>
      </div>
    </Card>
  );
}
