/**
 * cert-render.ts — Phase 46 Plan 07 Task 3.
 *
 * Renders the LeanShot course completion certificate as a PDF in Deno Edge
 * Runtime. Single fixed template per D-15: landscape 11×8.5 inch with
 * brand-themed centered text + QR-coded verification URL in the lower-right.
 *
 * ─── Task 1 (qr-smoke-test.ts) verdict ──────────────────────────────────────
 *
 *   {
 *     "verdict": "PNG_OK",
 *     "pngOk": true,
 *     "svgOk": true,
 *     "decision_for_cert_render":
 *       "cert-render.ts: use QRCode.toDataURL → doc.addImage(..., \"PNG\", ...)"
 *   }
 *
 *   QR path: PNG_OK — `QRCode.toDataURL(url, { width: 200 })` returns a
 *   `data:image/png;base64,…` data URL that jsPDF v3's `addImage()` consumes
 *   natively. The SVG fallback (`QRCode.toString(..., { type: 'svg' })`)
 *   also worked in Deno but is unused — kept commented for emergency
 *   recovery if a future esm.sh build regresses the PNG path.
 *
 * ─── Library import pattern ─────────────────────────────────────────────────
 *
 * jsPDF v3 + jspdf-autotable v5 + qrcode v1.5.4 are imported as direct esm.sh
 * URLs with the `?target=denonext` build. The `npm:` prefix path is NOT used
 * because:
 *
 *   1. Per memory reference_supabase_functions_deploy_import_map_flag, CLI
 *      v2.101.0 silently ignores `--import-map` so bare aliases drop on
 *      deploy. Direct URLs survive.
 *   2. jspdf@3 (NOT @4 — per Pitfall 6) bundles cleanly via esm.sh; the v4
 *      branch's tree-shake split breaks Deno's URL resolver for autotable.
 *
 * The dsar-export/pdf-render.ts file uses the same import pattern; this
 * module mirrors it exactly for analog consistency.
 *
 * ─── jsPDF output choice ────────────────────────────────────────────────────
 *
 * `doc.output('arraybuffer')` → `new Uint8Array(ab)` is preferred over
 * `doc.output('blob')` because Supabase Storage's `.upload()` in Deno accepts
 * both `ArrayBuffer | Uint8Array | Blob`; passing Uint8Array bypasses the
 * Blob shim path entirely and is the most interoperable across SDK versions.
 *
 * ─── No autoTable for v1 ────────────────────────────────────────────────────
 *
 * The cert is a single-page brand document — no tabular data. `autoTable`
 * import is preserved for analog parity with dsar-export/pdf-render.ts and
 * forward-compat with a future v2 template (e.g., per-module breakdown
 * appendix); the unused-import lint is suppressed locally.
 */

// deno-lint-ignore-file no-explicit-any no-unused-vars
import { jsPDF } from 'https://esm.sh/jspdf@3?target=denonext';
import autoTable from 'https://esm.sh/jspdf-autotable@5?target=denonext';
import QRCode from 'https://esm.sh/qrcode@1.5.4?target=denonext';

export interface CertRenderInput {
  userName: string;
  courseTitle: string;
  completedAt: string; // 'YYYY-MM-DD' (already formatted by caller — index.ts)
  verificationUrl: string; // 'https://app.leanshot.app/verify/<cert_id>?t=<token>'
}

// Centered helper — jsPDF text width measure for x-centering on page mid-line.
function centered(doc: any, text: string, y: number, pageWidth: number): void {
  const textWidth = doc.getStringUnitWidth(text) * doc.internal.getFontSize() / doc.internal.scaleFactor;
  doc.text(text, (pageWidth - textWidth) / 2, y);
}

export async function renderCertPdf(input: CertRenderInput): Promise<Uint8Array> {
  const { userName, courseTitle, completedAt, verificationUrl } = input;

  // Landscape US-letter: 11 × 8.5 inches (D-15).
  const doc = new jsPDF({ orientation: 'landscape', unit: 'in', format: [11, 8.5] });
  const pageWidth = 11;

  // ── Title ─────────────────────────────────────────────────────────────────
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(36);
  centered(doc, 'Certificate of Completion', 2.0, pageWidth);

  // ── Awardee name ──────────────────────────────────────────────────────────
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(24);
  centered(doc, userName, 3.2, pageWidth);

  // ── Course title ──────────────────────────────────────────────────────────
  doc.setFont('helvetica', 'italic');
  doc.setFontSize(16);
  centered(doc, courseTitle, 4.2, pageWidth);

  // ── Completion date ───────────────────────────────────────────────────────
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(12);
  centered(doc, `Completed: ${completedAt}`, 5.0, pageWidth);

  // ── Verification URL (also encoded as QR below) ──────────────────────────
  doc.setFontSize(10);
  centered(doc, verificationUrl, 5.5, pageWidth);

  // ── QR code in the lower-right corner (Task 1 verdict: PNG_OK) ───────────
  //
  // Coordinates: 1.5×1.5 inch square at (x=8.5, y=6.5) — leaves 1.0 inch
  // right + 0.5 inch bottom margin on the 11×8.5 page.
  try {
    const qrDataUrl: string = await (QRCode as any).toDataURL(verificationUrl, {
      width: 200,
      margin: 1,
      errorCorrectionLevel: 'M',
    });
    doc.addImage(qrDataUrl, 'PNG', 8.5, 6.5, 1.5, 1.5);
  } catch (e) {
    // Defensive: if QR ever fails in production, the cert still ships with
    // the verification URL printed in plain text above (still a usable cert).
    // Log + continue — do NOT throw; certs should not be blocked by QR.
    //
    // Emergency SVG fallback (manual): swap the above for:
    //   const svg = await QRCode.toString(verificationUrl, { type: 'svg' });
    //   const svgDataUrl = 'data:image/svg+xml;base64,' + btoa(svg);
    //   doc.addImage(svgDataUrl, 'SVG', 8.5, 6.5, 1.5, 1.5);
    // (jsPDF v3's SVG support is opportunistic — test in staging first.)
    console.warn('[cert-render] QR render failed; cert ships without QR', e instanceof Error ? e.message : 'unknown');
  }

  // ── Footer attribution ────────────────────────────────────────────────────
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  centered(doc, 'Verified by LeanShot', 7.5, pageWidth);

  // Uint8Array output (preferred for Supabase Storage upload — see header doc).
  const ab = doc.output('arraybuffer') as ArrayBuffer;
  return new Uint8Array(ab);
}
