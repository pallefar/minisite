/**
 * QR-code-in-Deno smoke test — Phase 46 Plan 07 Task 1.
 *
 * WHY this file exists (and why it is NOT named *.test.ts):
 *
 * Plan 46-07 ships a certificate PDF rendered server-side in the
 * `generate-course-certificate` Edge Function (Deno runtime). The cert design
 * (D-15) includes a QR code that encodes the public `/verify/<cert_id>` URL.
 *
 * The `qrcode` package (npm) is canonically a Node module that ships TWO public
 * paths:
 *
 *   1. `QRCode.toDataURL(text)` → PNG data URL via the `canvas` native module.
 *      In Deno on Supabase Edge Runtime, the native `canvas` binary is NOT
 *      available. esm.sh's `?target=denonext` build typically shims canvas
 *      with a pure-JS fallback — but we MUST prove this empirically before
 *      writing cert-render.ts.
 *
 *   2. `QRCode.toString(text, { type: 'svg' })` → SVG markup, pure JS, no
 *      canvas dependency. Reliable in Deno but jsPDF v3's image embedding for
 *      SVG is finicky.
 *
 * This smoke test runs both paths against a sample verification URL and prints
 * a verdict JSON so Task 3 (cert-render.ts) can branch on the result:
 *
 *   - "PNG_OK"        → use toDataURL + doc.addImage(..., 'PNG', ...)
 *   - "SVG_FALLBACK"  → use toString + base64-encoded SVG addImage
 *   - "BOTH_FAILED"   → block plan; QR cannot ship in Deno; surface in SUMMARY
 *
 * NAMED qr-smoke-test.ts (not .test.ts) on purpose:
 *   - `deno test` discovers *.test.ts and would run this with no test scaffold.
 *   - This is a one-shot CLI script, not part of the test suite.
 *
 * Run:
 *   $HOME/.deno/bin/deno run --allow-net --allow-env \
 *     supabase/functions/generate-course-certificate/qr-smoke-test.ts \
 *     | tee /tmp/p46-qr-verdict.json
 */

// deno-lint-ignore-file no-explicit-any
import QRCode from 'https://esm.sh/qrcode@1.5.4?target=denonext';

const SAMPLE_URL = 'https://app.leanshot.app/verify/00000000-0000-0000-0000-000000000000?t=abc';

interface Verdict {
  verdict: 'PNG_OK' | 'SVG_FALLBACK' | 'BOTH_FAILED';
  pngOk: boolean;
  svgOk: boolean;
  pngErr: string | null;
  svgErr: string | null;
  decision_for_cert_render: string;
}

let pngOk = false;
let svgOk = false;
let pngErr: string | null = null;
let svgErr: string | null = null;
let pngSample = '';
let svgSample = '';

try {
  const dataUrl: string = await (QRCode as any).toDataURL(SAMPLE_URL, { width: 100 });
  if (typeof dataUrl === 'string' && dataUrl.startsWith('data:image/png;base64,')) {
    pngOk = true;
    pngSample = dataUrl.slice(0, 60);
  } else {
    pngErr = `unexpected output prefix: ${(dataUrl ?? '').toString().slice(0, 60)}`;
  }
} catch (e) {
  pngErr = e instanceof Error ? `${e.name}: ${e.message}` : 'unknown';
}

try {
  const svg: string = await (QRCode as any).toString(SAMPLE_URL, { type: 'svg' });
  if (typeof svg === 'string' && svg.trimStart().startsWith('<svg')) {
    svgOk = true;
    svgSample = svg.slice(0, 60);
  } else {
    svgErr = `unexpected output prefix: ${(svg ?? '').toString().slice(0, 60)}`;
  }
} catch (e) {
  svgErr = e instanceof Error ? `${e.name}: ${e.message}` : 'unknown';
}

let verdict: Verdict['verdict'];
let decision: string;
if (pngOk) {
  verdict = 'PNG_OK';
  decision = 'cert-render.ts: use QRCode.toDataURL → doc.addImage(..., "PNG", ...)';
} else if (svgOk) {
  verdict = 'SVG_FALLBACK';
  decision =
    'cert-render.ts: use QRCode.toString({type:"svg"}) → base64-encoded SVG via doc.addImage(..., "SVG", ...)';
} else {
  verdict = 'BOTH_FAILED';
  decision =
    'BLOCK plan: neither PNG nor SVG path works in Deno; cert PDF cannot ship a QR code. Document in SUMMARY.';
}

const out: Verdict & { png_sample?: string; svg_sample?: string } = {
  verdict,
  pngOk,
  svgOk,
  pngErr,
  svgErr,
  decision_for_cert_render: decision,
  png_sample: pngSample || undefined,
  svg_sample: svgSample || undefined,
};

console.log(JSON.stringify(out, null, 2));
