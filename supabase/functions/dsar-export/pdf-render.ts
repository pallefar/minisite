/**
 * `pdf-render.ts` — Deno-side jsPDF + jspdf-autotable renderer for DSAR export.
 *
 * Phase 22 Plan 22-04 (GDPR-03). Analog: `leanshot/src/lib/export-data.ts`
 * (the browser-side jsPDF dynamic-import pattern).
 *
 * Bundle-budget note: this file runs in the Supabase Edge Runtime (Deno), NOT
 * in the web bundle. Static `import` of jspdf/jspdf-autotable via esm.sh is
 * fine — the 50 kB index gz ceiling enforced by
 * `scripts/assert-bundle-budget.sh` is for the browser bundle and does not
 * apply here.
 *
 * Per D-06, the PDF contains 7 sections in order:
 *   1. Profile
 *   2. Subscriptions
 *   3. Health Log
 *   4. Photos          (file list only — actual photos delivered in the ZIP)
 *   5. Sharing History
 *   6. Affiliate Activity (uses converter_email_sha256 — never plaintext)
 *   7. Communications  (user-side ai_messages only — D-06 redaction contract)
 *
 * Per Pitfall 10 (reference_supabase_edge_function_deploy.md): the gateway
 * overrides response Content-Type to text/plain + injects `CSP: sandbox`.
 * The PDF is NEVER returned inline from the Edge Function — it is uploaded
 * to the `dsar-exports` Storage bucket and delivered via a 7-day signed URL.
 */
// deno-lint-ignore-file no-explicit-any
import { jsPDF } from 'https://esm.sh/jspdf@3?target=denonext';
import autoTable from 'https://esm.sh/jspdf-autotable@5?target=denonext';

export interface DsarBundle {
  schema_version: string;
  generated_at: string;
  user_id: string;
  profile: Record<string, unknown> | null;
  subscriptions: unknown[];
  health_log: Record<string, unknown[]>;
  photos: Array<{ photo_id?: string; storage_path?: string; created_at?: string }>;
  sharing_history: unknown[];
  affiliate_activity: {
    clicks: unknown[];
    conversions: Array<Record<string, unknown>>;
    payouts: unknown[];
  };
  communications: unknown[];
  posthog_events: unknown[] | null;
}

function safeRows(rows: unknown[] | null | undefined, cols: string[]): string[][] {
  if (!Array.isArray(rows) || rows.length === 0) return [['(no rows)']];
  return rows.map((r) => {
    const rec = (r ?? {}) as Record<string, unknown>;
    return cols.map((c) => {
      const v = rec[c];
      if (v === null || v === undefined) return '';
      if (typeof v === 'object') return JSON.stringify(v).slice(0, 200);
      return String(v).slice(0, 500);
    });
  });
}

function section(doc: any, title: string, head: string[], body: string[][], startY: number): number {
  doc.setFontSize(14);
  doc.text(title, 14, startY);
  autoTable(doc, {
    head: [head],
    body: body.length > 0 ? body : [['(no rows)']],
    startY: startY + 4,
    styles: { fontSize: 8, cellPadding: 2 },
    headStyles: { fillColor: [33, 53, 71] },
    margin: { left: 14, right: 14 },
  });
  const finalY = (doc as any).lastAutoTable?.finalY ?? startY + 20;
  return finalY + 8;
}

export async function renderDsarPdf(bundle: DsarBundle): Promise<Blob> {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });

  // Title page
  doc.setFontSize(20);
  doc.text('LeanShot — Data Subject Access Request', 14, 24);
  doc.setFontSize(10);
  doc.text(`User ID: ${bundle.user_id}`, 14, 32);
  doc.text(`Generated: ${bundle.generated_at}`, 14, 38);
  doc.text(`Schema: ${bundle.schema_version}`, 14, 44);
  doc.text(
    'This document contains your personal data on file with LeanShot per GDPR Article 15.',
    14,
    52,
    { maxWidth: 180 },
  );

  let y = 64;

  // Section 1 — Profile
  const p = bundle.profile ?? {};
  y = section(
    doc,
    '1. Profile',
    ['Field', 'Value'],
    Object.entries(p).map(([k, v]) => [
      k,
      typeof v === 'object' ? JSON.stringify(v).slice(0, 200) : String(v ?? '').slice(0, 200),
    ]),
    y,
  );

  // Section 2 — Subscriptions
  y = section(
    doc,
    '2. Subscriptions',
    ['Provider', 'Status', 'Tier', 'Period End'],
    safeRows(bundle.subscriptions, ['provider', 'status', 'ux_tier', 'current_period_end']),
    y,
  );

  // Section 3 — Health Log (one sub-table per source table; compact summary)
  doc.setFontSize(14);
  doc.text('3. Health Log', 14, y);
  y += 4;
  const healthEntries = Object.entries(bundle.health_log);
  const healthSummary = healthEntries.map(([table, rows]) => [
    table,
    String(Array.isArray(rows) ? rows.length : 0),
  ]);
  autoTable(doc, {
    head: [['Table', 'Row count']],
    body: healthSummary.length > 0 ? healthSummary : [['(none)', '0']],
    startY: y,
    styles: { fontSize: 9 },
    margin: { left: 14, right: 14 },
  });
  y = ((doc as any).lastAutoTable?.finalY ?? y) + 8;

  // Section 4 — Photos (file list ONLY; photos themselves ride in the ZIP)
  y = section(
    doc,
    '4. Photos (manifest)',
    ['Photo ID', 'Storage Path', 'Created'],
    safeRows(bundle.photos as unknown[], ['photo_id', 'storage_path', 'created_at']),
    y,
  );

  // Section 5 — Sharing History
  y = section(
    doc,
    '5. Sharing History',
    ['ID', 'Label', 'Expires', 'Revoked'],
    safeRows(bundle.sharing_history as unknown[], ['id', 'label', 'expires_at', 'revoked_at']),
    y,
  );

  // Section 6 — Affiliate Activity (hashed converter emails per D-06)
  doc.setFontSize(14);
  doc.text('6. Affiliate Activity', 14, y);
  y += 4;
  autoTable(doc, {
    head: [['Clicks', 'Conversions', 'Payouts']],
    body: [
      [
        String(bundle.affiliate_activity.clicks.length),
        String(bundle.affiliate_activity.conversions.length),
        String(bundle.affiliate_activity.payouts.length),
      ],
    ],
    startY: y,
    styles: { fontSize: 9 },
    margin: { left: 14, right: 14 },
  });
  y = ((doc as any).lastAutoTable?.finalY ?? y) + 4;
  y = section(
    doc,
    '6a. Conversions (converter email pseudonymized per D-06)',
    ['ID', 'Converter SHA-256', 'Commission ¢', 'Status', 'Created'],
    safeRows(bundle.affiliate_activity.conversions as unknown[], [
      'id',
      'converter_email_sha256',
      'commission_cents',
      'status',
      'created_at',
    ]),
    y,
  );

  // Section 7 — Communications (user-side only)
  y = section(
    doc,
    '7. Communications (user-side AI messages only)',
    ['Created', 'Role', 'Content (truncated)'],
    safeRows(bundle.communications as unknown[], ['created_at', 'role', 'content']),
    y,
  );

  // jspdf .output('blob') returns a Blob.
  return doc.output('blob') as Blob;
}
