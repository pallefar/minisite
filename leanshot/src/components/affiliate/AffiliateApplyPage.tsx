/**
 * Phase 19 Plan 19-05 — `/affiliate` apply page wrapper.
 *
 * Layout (UI-SPEC §"/affiliate"):
 *   - Container: max-w-[480px] mx-auto py-16 px-4 md:px-6
 *   - Top: inline brand word-mark linking to `/`
 *   - Body: <AffiliateApplyForm />
 *   - Footer: "Already approved? Sign in →" link
 *
 * Default-export so the route-registry `componentLoader` `.default`
 * resolves correctly (BL-4 — Plan 19-09 imports via dynamic `import()`).
 */
import { AffiliateApplyForm } from '@/components/affiliate/AffiliateApplyForm';

export function AffiliateApplyPage() {
  return (
    <main className="min-h-screen bg-[var(--color-bg)]">
      <div className="max-w-[480px] mx-auto py-16 px-4 md:px-6 flex flex-col gap-6">
        <a
          href="/"
          className="inline-flex items-center gap-2 text-xs text-[var(--color-text-secondary)] hover:text-[var(--color-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] focus-visible:ring-offset-2 rounded-pill px-2 py-1 -ms-2 self-start"
        >
          <span
            className="text-sm font-bold tracking-tight text-[var(--color-primary)] font-[var(--font-display)]"
            aria-label="LeanShot"
          >
            LeanShot
          </span>
        </a>

        <AffiliateApplyForm />

        <p className="text-xs text-center text-[var(--color-text-secondary)]">
          Already approved?{' '}
          <a
            href="#/auth/signin"
            className="text-[var(--color-primary)] font-semibold hover:underline"
          >
            Sign in →
          </a>
        </p>
      </div>
    </main>
  );
}

export default AffiliateApplyPage;
