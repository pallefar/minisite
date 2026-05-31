// Phase 7 Plan 07-02 — Single source of truth for legal-page footer links.
//
// Both surfaces that need to render the conspicuous-link list (the marketing
// Landing footer AND the authenticated AppShell footer) import this file,
// along with the e2e spec — so the four labels + hash routes cannot drift
// (T-07-02-03 mitigation in plan threat model).
//
// `variant` decides chrome only:
//   marketing  → bare <ul>; slots into Landing.tsx's existing 3-column footer
//                grid under the "Legal" heading and reuses its surrounding
//                <footer>. ALSO used by LegalLayout to give legal-page readers
//                a sibling-nav strip at the bottom of each policy page.
//   app        → standalone <footer aria-label="Legal"> with its own border,
//                positioned below MobileNav on mobile (mb-[80px] to clear the
//                fixed bottom-nav) and inline at the bottom on desktop.
//
// Accessibility: each <a> uses the link's label as the accessible name; no
// extra aria-label needed. Focus ring follows the global focus-visible token.

export interface LegalLink {
  label: string;
  hash: string;
}

// Phase 64 Plan 64-07 — Extended to 8 entries (4 existing + 4 new).
// Note: 'Data rights (DSAR)' uses a pathname route (/settings/privacy/dsar) because
// the DSAR portal is auth-required; Phase 22 Plan 22-11 wired it as a PATH route,
// not a hash route. LegalFooter renders it as a normal <a href> which selectView picks up.
export const LEGAL_LINKS: readonly LegalLink[] = [
  { label: 'Privacy policy', hash: '#/legal/privacy' },
  { label: 'Consumer health data (WA residents)', hash: '#/legal/consumer-health' },
  { label: 'Terms of service', hash: '#/legal/terms' },
  { label: 'Medical disclaimer', hash: '#/legal/disclaimer' },
  { label: 'Accessibility', hash: '#/legal/accessibility' },
  { label: 'DMCA', hash: '#/legal/dmca' },
  { label: 'Do Not Sell or Share', hash: '#/privacy/do-not-sell' },
  { label: 'Data rights (DSAR)', hash: '/settings/privacy/dsar' },
] as const;

export interface LegalFooterProps {
  variant?: 'marketing' | 'app';
}

export function LegalFooter({ variant = 'marketing' }: LegalFooterProps) {
  if (variant === 'app') {
    return (
      <footer
        className="px-4 md:px-7 py-6 mt-12 mb-[80px] md:mb-0 border-t border-[var(--color-border)]"
        aria-label="Legal"
      >
        <ul className="flex flex-wrap gap-x-5 gap-y-2 text-[13px] text-[var(--color-text-secondary)]">
          {LEGAL_LINKS.map((link) => (
            <li key={link.hash}>
              <a
                href={link.hash}
                className="hover:underline focus-visible:underline focus-visible:outline-none"
              >
                {link.label}
              </a>
            </li>
          ))}
        </ul>
      </footer>
    );
  }

  // marketing variant — slots into Landing.tsx's existing footer grid AND is
  // reused by LegalLayout's bottom sibling-nav strip.
  return (
    <ul className="space-y-1.5 text-[13px] text-[var(--color-text-secondary)]">
      {LEGAL_LINKS.map((link) => (
        <li key={link.hash}>
          <a
            href={link.hash}
            className="hover:underline focus-visible:underline focus-visible:outline-none"
          >
            {link.label}
          </a>
        </li>
      ))}
    </ul>
  );
}
