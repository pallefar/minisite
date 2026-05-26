/**
 * Phase 60 Plan 60-10 — RAG i18n helpers.
 *
 * Provides a thin `useRagTranslation()` hook wrapper so consumers don't
 * repeat the 'rag' namespace literal, plus a typed key constants list for
 * exhaustiveness tests (Task 1 Test 1) and a refusal-kind → i18n-key map
 * consumed by RefusalCard (Task 5).
 *
 * Locale files: public/locales/{en,es}/rag.json
 * Loaded automatically by the Phase 32 i18next HttpBackend when any
 * component calls useTranslation('rag').
 */

import { useTranslation } from 'react-i18next';

export type RefusalKind = 'pharma_02' | 'out_of_corpus' | 'citation_validation_failed';

/** Map from refusal sentinel kind to i18n leaf key (within 'rag' namespace). */
export const RAG_REFUSAL_KIND_TO_KEY: Record<RefusalKind, string> = {
  pharma_02: 'refusal.pharma_02',
  out_of_corpus: 'refusal.out_of_corpus',
  citation_validation_failed: 'refusal.citation_validation_failed',
};

/**
 * All i18n keys used by the RAG UI layer.
 * Exhaustiveness test (Task 1 Test 1) iterates this list and verifies each
 * key is present in both en/rag.json and es/rag.json.
 *
 * Format: dot-path within the 'rag' namespace (no leading 'rag.').
 */
export const RAG_I18N_KEYS: readonly string[] = [
  'attribution',
  'disclaimer',
  'tier.A.label',
  'tier.A.aria',
  'tier.B.label',
  'tier.B.aria',
  'tier.C.label',
  'tier.C.aria',
  'popover.open_source',
  'popover.read_full_chunk',
  'popover.may_be_outdated',
  'popover.last_reviewed',
  'popover.close_aria',
  'popover.leanshot_research_disclosure',
  'sources_footer.label',
  'sources_footer.aria',
  'citation_marker.aria',
  'refusal.out_of_corpus',
  'refusal.pharma_02',
  'refusal.citation_validation_failed',
];

/**
 * Thin hook wrapper around useTranslation('rag').
 * Keeps callers from repeating the namespace string.
 */
export function useRagTranslation() {
  return useTranslation('rag');
}
