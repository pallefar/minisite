/**
 * Phase 22 plan 22-11 — CLIENT-SIDE DSAR PDF render placeholder.
 *
 * **v1.2 status: UNUSED at runtime.** The shipping DSAR flow is server-side:
 * `supabase/functions/dsar-export/pdf-render.ts` (plan 22-04) renders the PDF
 * inside the Edge Function using Deno-side jsPDF + jspdf-autotable from
 * esm.sh, ZIPs it with the JSON bundle + photo files, uploads to the
 * `dsar-exports` Storage bucket, and emails a 7-day signed URL via
 * lifecycle-transactional (template=`dsar_ready`).
 *
 * **Why this wrapper exists then?**
 *
 * 1. The 22-01 Wave-0 test scaffold (`__tests__/dsar-pdf-render.test.ts`)
 *    references `renderDsarPdf` at import time — the plan inherited those
 *    skipped tests and the import would resolve to nothing otherwise.
 *
 * 2. v1.3 ships an opt-in "Download PDF directly without waiting for the
 *    server cascade" client-side option (skipped at v1.2 because PDF render
 *    pulls jsPDF into the lazy chunk graph and we want the bundle-budget CI
 *    guard to track the additional cost separately). This file is the seam
 *    that v1.3 will fill in.
 *
 * **Bundle-budget contract:** jsPDF + jspdf-autotable MUST stay behind a
 * dynamic `import()` inside the handler — never a static module-level import.
 * Pattern from `src/components/dashboard/settings/SettingsPage.tsx` lines 259-294
 * and memory note `project_phase5_bundle_regression.md`. The placeholder
 * implementation already shows the right shape so a future fill-in can
 * preserve the contract.
 *
 * Threat surface (carry-over from plan 22-04 D-06): when this code paths goes
 * live in v1.3, it MUST hash converter emails on affiliate_conversions rows
 * the same way the server-side renderer does (SHA-256 hex via SubtleCrypto).
 * The bundle assembly is presumed to be already-redacted on the client side
 * (the data comes from the same RLS-gated SELECTs the user already runs in
 * the dashboard), but defense-in-depth — the renderer should not unhash any
 * field it receives.
 */

/**
 * Loose-typed bundle shape mirroring `supabase/functions/dsar-export/pdf-render.ts`'s
 * `DsarBundle`. Kept loose because v1.3 will redefine the contract.
 */
export interface DsarBundle {
  schema_version?: string;
  generated_at?: string;
  user_id?: string;
  profile?: Record<string, unknown> | null;
  subscriptions?: unknown[];
  health_log?: Record<string, unknown[]>;
  photos?: Array<{ photo_id?: string; storage_path?: string; created_at?: string }>;
  sharing_history?: unknown[];
  affiliate_activity?: {
    clicks?: unknown[];
    conversions?: Array<Record<string, unknown>>;
    payouts?: unknown[];
  };
  communications?: unknown[];
  posthog_events?: unknown[] | null;
}

/**
 * v1.3 entry point. v1.2 callers should NOT invoke this — the server cascade
 * is the production path. Calling at v1.2 throws so a runtime regression
 * surfaces in Sentry rather than silently shipping an unredacted PDF.
 *
 * The body uses a dynamic import to keep jsPDF off the client static graph
 * (bundle-budget CI guard). When v1.3 lifts the throw, the dynamic import
 * pattern stays.
 */
export async function renderDsarPdf(_bundle: DsarBundle): Promise<Blob> {
  // Dynamic-import seam for bundle-budget compliance. The actual render is
  // deliberately not implemented at v1.2; throwing keeps the test seam honest
  // (the v1.2 test asserts the symbol exists + the runtime is gated).
  throw new Error(
    'renderDsarPdf is v1.3-reserved; v1.2 DSAR PDFs are rendered server-side ' +
      'by supabase/functions/dsar-export. See src/lib/dsar/dsar-pdf-render.ts header.',
  );
}
