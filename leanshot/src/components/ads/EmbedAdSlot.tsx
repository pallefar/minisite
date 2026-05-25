/**
 * Phase 56 Plan 03 — EmbedAdSlot: sandboxed iframe for embed-code placements (T-56-09).
 *
 * Renders advertiser-supplied HTML inside a sandboxed iframe to prevent XSS.
 * Sandbox is empty string (no tokens) so the iframe runs with a null origin —
 * it cannot access parent cookies, localStorage, or sessionStorage.
 * allow-same-origin MUST NOT be set: combining it with srcDoc gives the
 * embedded document the parent's origin, enabling PHI/key exfiltration.
 * FIREWALL: MUST NOT import native/health.
 */

interface EmbedAdSlotProps {
  embedHtml: string;
  placementId: string;
}

export function EmbedAdSlot({ embedHtml, placementId }: EmbedAdSlotProps) {
  if (!embedHtml) return null;

  const srcDoc = `<!DOCTYPE html><html><body style="margin:0">${embedHtml}</body></html>`;

  return (
    <iframe
      title={`ad-embed-${placementId}`}
      srcDoc={srcDoc}
      sandbox=""
      style={{ border: 'none', width: '100%', height: '90px' }}
      aria-label="Advertisement"
    />
  );
}
