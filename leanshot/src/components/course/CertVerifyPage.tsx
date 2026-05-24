/**
 * Phase 46 Plan 10 — Public no-auth certificate verification page.
 *
 * Route: `https://app.leanshot.app/verify/<cert_id>?t=<hmac_token>`
 *
 * Mounted by `src/App.tsx` via a pathname pre-check that runs BEFORE the
 * TabId / marketing / onboarding / dashboard view branching:
 *
 *   if (window.location.pathname.startsWith('/verify/')) return <CertVerifyPage />;
 *
 * This route is fully anonymous — no session required. Security comes from
 * the HMAC printed on the certificate PDF, not from auth. The flow:
 *
 *   1. Parse `cert_id` from the URL path; parse `t` from the query string.
 *   2. SELECT the certificate row (RLS allows anon read when
 *      `verification_token IS NOT NULL` per Plan 46-01).
 *   3. Constant-time compare `t` against `certificates.verification_token`
 *      via `compareCertToken` (Plan 46-03, extended by Plan 46-10 Task 1).
 *   4. On mismatch / missing row / missing input → "Certificate not found".
 *   5. On match → proof card with full_name, course title, completed date,
 *      "Verified by LeanShot" badge.
 *
 * Why constant-time compare (not verifyCertToken):
 *   verifyCertToken requires CERT_VERIFICATION_SECRET, which must NEVER reach
 *   the browser (T-46-03 — surface exposure). The Edge Fn that issues the
 *   cert (Plan 46-07) writes the canonical HMAC into the DB; this page
 *   simply re-fetches that canonical value and compares it byte-for-byte to
 *   what the URL claims.
 *
 * Navigation note: this component is mounted by the literal-pathname
 * pre-check in App.tsx. Returning to the app root requires a full reload
 * (e.g. an `<a href="/">` link triggers a navigation, not a SPA push). This
 * is intentional — the verify page is a leaf surface like the share/legal
 * static pages, not a SPA navigation target.
 *
 * noindex: a `<meta name="robots" content="noindex">` element is appended
 * to `document.head` on mount and removed on unmount (per 46-CONTEXT D-14
 * — verification pages must not be crawled).
 *
 * Threat refs: T-46-03 (forged URL with random token → "Certificate not
 * found" with no oracle leaking which validation step failed).
 */
import { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { compareCertToken } from '@/lib/course/cert-verify-token';
import { supabase } from '@/lib/supabase';

type VerifyStatus = 'loading' | 'verified' | 'not_found' | 'error';

interface VerifiedData {
  userName: string;
  courseTitle: string;
  completedAt: string;
}

function parseCertIdFromPathname(): string {
  if (typeof window === 'undefined') return '';
  // pathname is /verify/<id> or /verify/<id>/ — strip the prefix and any trailing slash.
  const raw = window.location.pathname.replace(/^\/verify\//, '');
  const trimmed = raw.split('?')[0]?.split('#')[0] ?? '';
  return trimmed.replace(/\/$/, '');
}

function parseTokenFromQuery(): string {
  if (typeof window === 'undefined') return '';
  return new URLSearchParams(window.location.search).get('t') ?? '';
}

function formatCompletedAt(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  } catch {
    return iso;
  }
}

export default function CertVerifyPage() {
  const [status, setStatus] = useState<VerifyStatus>('loading');
  const [data, setData] = useState<VerifiedData | null>(null);

  // Set <meta name="robots" content="noindex"> on mount; remove on unmount.
  // index.html serves all routes (SPA), so the noindex must be injected at
  // runtime by the verify branch only — other surfaces remain indexable.
  useEffect(() => {
    const meta = document.createElement('meta');
    meta.name = 'robots';
    meta.content = 'noindex';
    document.head.appendChild(meta);
    return () => {
      meta.remove();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function verify(): Promise<void> {
      const certId = parseCertIdFromPathname();
      const urlToken = parseTokenFromQuery();

      if (!certId || !urlToken) {
        if (!cancelled) setStatus('not_found');
        return;
      }

      try {
        const { data: cert, error: certErr } = await supabase
          .from('certificates')
          .select('id, user_id, course_id, issued_at, verification_token')
          .eq('id', certId)
          .maybeSingle();

        if (certErr) {
          if (!cancelled) setStatus('error');
          return;
        }

        if (!cert || typeof cert.verification_token !== 'string') {
          if (!cancelled) setStatus('not_found');
          return;
        }

        if (!compareCertToken(urlToken, cert.verification_token)) {
          // Constant-time mismatch — render generic "not_found" to avoid
          // leaking whether the row exists vs the HMAC differs (T-46-03 oracle).
          if (!cancelled) setStatus('not_found');
          return;
        }

        // Optimistically resolve user + course; failures still render verified.
        const [profileResp, courseResp] = await Promise.all([
          supabase
            .from('profiles')
            .select('full_name')
            .eq('id', cert.user_id)
            .maybeSingle(),
          supabase
            .from('courses')
            .select('title')
            .eq('id', cert.course_id)
            .maybeSingle(),
        ]);

        if (cancelled) return;

        const profileRow = profileResp.data as { full_name?: string | null } | null;
        const courseRow = courseResp.data as { title?: string | null } | null;

        setData({
          userName: profileRow?.full_name ?? 'A learner',
          courseTitle: courseRow?.title ?? 'this course',
          completedAt: formatCompletedAt(cert.issued_at),
        });
        setStatus('verified');
      } catch {
        if (!cancelled) setStatus('error');
      }
    }

    void verify();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main
      className="min-h-screen flex items-center justify-center px-4 py-12"
      data-testid="cert-verify-page"
    >
      <div className="w-full max-w-md">
        {status === 'loading' && (
          <Card variant="elevated" className="p-8 text-center">
            <p
              role="status"
              aria-live="polite"
              className="text-sm text-[var(--text-muted)]"
            >
              Verifying certificate…
            </p>
          </Card>
        )}

        {(status === 'not_found' || status === 'error') && (
          <Card variant="elevated" className="p-8 text-center space-y-3">
            <h1 className="text-xl font-semibold">Certificate not found</h1>
            <p className="text-sm text-[var(--text-muted)]">
              This certificate could not be verified.
            </p>
            <p className="text-xs text-[var(--text-muted)]">
              <a href="/" className="underline">
                Return to LeanShot
              </a>
            </p>
          </Card>
        )}

        {status === 'verified' && data && (
          <Card variant="elevated" className="p-8 text-center space-y-4">
            <div className="flex justify-center">
              <Badge tone="success">Verified by LeanShot</Badge>
            </div>
            <h1 className="text-2xl font-semibold leading-tight">
              {data.userName}
            </h1>
            <p className="text-sm text-[var(--text-muted)]">
              completed
            </p>
            <p className="text-lg font-medium">{data.courseTitle}</p>
            <p className="text-xs text-[var(--text-muted)]">
              on {data.completedAt}
            </p>
            <p className="pt-4 text-xs text-[var(--text-muted)]">
              <a href="/" className="underline">
                Return to LeanShot
              </a>
            </p>
          </Card>
        )}
      </div>
    </main>
  );
}
