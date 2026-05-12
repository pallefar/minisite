// Phase 7 Plan 07-02 — Task 1 stub. Real implementation lands in Task 3.
//
// Why two stages: Task 1 (RED) only needs the LEGAL_LINKS const to be exported
// so the e2e spec can import the single source of truth for link text + hash
// routes (anti-link-rot — Landing.tsx, AppShell.tsx, and the spec all drive
// off this same array). The visual <LegalFooter /> rendering is wired in
// Task 3 to keep this commit small and the RED failure surface obvious
// (Landing.tsx still has its plain-text <li> placeholders; AppShell has no
// footer at all).

export interface LegalLink {
  label: string;
  hash: string;
}

export const LEGAL_LINKS: readonly LegalLink[] = [
  { label: 'Privacy policy', hash: '#/legal/privacy' },
  { label: 'Consumer health data (WA residents)', hash: '#/legal/consumer-health' },
  { label: 'Terms of service', hash: '#/legal/terms' },
  { label: 'Medical disclaimer', hash: '#/legal/disclaimer' },
] as const;

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function LegalFooter(_props: { variant?: 'marketing' | 'app' } = {}): null {
  return null;
}
