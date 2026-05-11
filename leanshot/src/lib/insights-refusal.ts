/**
 * Phase 4 D-04: thin re-export so Phase 3's `insights.ts → scrubInsights`
 * call site is unchanged. The CR-01 multi-occurrence walk + CR-02 expanded
 * STEM_PATTERN now live in `shared/refusal.ts` (Deno + browser compatible).
 *
 * Browser-side consumers (insights pipeline, future Settings AI usage panel)
 * keep importing `@/lib/insights-refusal`; the underlying implementation is
 * the same module the Edge Function imports via `import_map.json`.
 */
export {
  ADVERSARIAL_CORPUS,
  isDoseChangeAdvice,
  scrubInsights,
  tokenize,
  type CorpusRow,
} from '../../../shared/refusal';
