/**
 * Phase 64 Plan 05 (LEGAL-06) — DMCA Notice & Takedown.
 *
 * Route: #/legal/dmca (added to App.tsx by Plan 64-07)
 *
 * Lists the designated DMCA agent (pending U.S. Copyright Office filing),
 * takedown procedure (17 U.S.C. § 512(c)(3)), counter-notice procedure
 * (17 U.S.C. § 512(g)), and safe-harbor disclaimer (§ 512).
 *
 * OPERATOR ACTION REQUIRED at Phase 70 UAT:
 *   Register the designated agent at https://ecfs.copyright.gov/
 *   and update the agent name/address placeholder below.
 *
 * Token compliance: uses ONLY @theme-defined CSS custom properties.
 * No undefined Tailwind v4 tokens (Phase 60 BLOCKER rule).
 *
 * Draft disclaimer: This page is in draft pending Phase 70 legal counsel review.
 */
import { Helmet } from 'react-helmet-async';
import { LegalLayout } from './LegalLayout';

export function DMCAPage() {
  return (
    <LegalLayout title="DMCA Notice & Takedown">
      <Helmet>
        <title>DMCA Notice &amp; Takedown · LeanShot</title>
        <meta
          name="description"
          content="LeanShot's DMCA takedown procedure, counter-notice procedure, and safe-harbor disclaimer under 17 U.S.C. § 512."
        />
      </Helmet>

      <article className="space-y-8 text-[13px] text-[var(--color-text)] leading-relaxed">
        <em className="block text-[var(--color-text-tertiary)]">
          This page is in draft pending legal counsel review (Phase 70 UAT).
        </em>

        {/* 1. Designated DMCA Agent */}
        <section className="space-y-3">
          <h2 className="text-[18px] font-semibold text-[var(--color-text)]">
            Designated DMCA Agent
          </h2>
          <p className="text-[var(--color-text-secondary)] italic">
            Agent registration with U.S. Copyright Office pending — operator action required at
            Phase 70 UAT. Until then, send notices to{' '}
            <a
              href="mailto:abuse@leanshot.app"
              className="underline decoration-1 underline-offset-2 hover:no-underline not-italic text-[var(--color-text)]"
            >
              abuse@leanshot.app
            </a>
            .
          </p>
          <address className="not-italic text-[var(--color-text-secondary)] border border-[var(--color-border)] rounded-xl p-4 text-[13px]">
            <p>
              <strong className="text-[var(--color-text)]">[Agent Name — pending registration]</strong>
            </p>
            <p>LeanShot</p>
            <p>[Address — pending registration]</p>
            <p>
              Email:{' '}
              <a
                href="mailto:abuse@leanshot.app"
                className="underline decoration-1 underline-offset-2"
              >
                abuse@leanshot.app
              </a>
            </p>
          </address>
        </section>

        {/* 2. How to submit a takedown notice */}
        <section className="space-y-3">
          <h2 className="text-[18px] font-semibold text-[var(--color-text)]">
            How to submit a takedown notice
          </h2>
          <p>
            To submit a DMCA takedown notice under 17 U.S.C. § 512(c)(3), your written
            communication must include all of the following:
          </p>
          <ol className="list-decimal ps-5 space-y-2 text-[var(--color-text-secondary)]">
            <li>
              <strong className="text-[var(--color-text)]">Identification of the copyrighted work.</strong>{' '}
              A description of the copyrighted work you claim has been infringed, or if multiple
              works are covered, a representative list.
            </li>
            <li>
              <strong className="text-[var(--color-text)]">Identification of infringing material.</strong>{' '}
              A description of the material you claim is infringing, with enough detail for us to
              locate it — including the URL or specific location on LeanShot.
            </li>
            <li>
              <strong className="text-[var(--color-text)]">Your contact information.</strong>{' '}
              Your name, mailing address, telephone number, and email address.
            </li>
            <li>
              <strong className="text-[var(--color-text)]">Good-faith statement.</strong>{' '}
              A statement that you have a good-faith belief that use of the material in the manner
              complained of is not authorized by the copyright owner, its agent, or the law.
            </li>
            <li>
              <strong className="text-[var(--color-text)]">Accuracy statement.</strong>{' '}
              A statement, made under penalty of perjury, that the information in your
              notification is accurate and that you are the copyright owner or authorized to act
              on the owner&rsquo;s behalf.
            </li>
            <li>
              <strong className="text-[var(--color-text)]">Physical or electronic signature.</strong>{' '}
              Your physical or electronic signature (typing your full legal name constitutes an
              electronic signature).
            </li>
          </ol>
          <p>
            Send completed takedown notices to{' '}
            <a
              href="mailto:abuse@leanshot.app?subject=DMCA%20Takedown%20Notice"
              className="underline decoration-1 underline-offset-2 hover:no-underline"
            >
              abuse@leanshot.app
            </a>
            .
          </p>
        </section>

        {/* 3. Counter-notice procedure */}
        <section className="space-y-3">
          <h2 className="text-[18px] font-semibold text-[var(--color-text)]">
            Counter-notice procedure
          </h2>
          <p>
            If you believe your content was removed or disabled by mistake or misidentification,
            you may submit a counter-notice under 17 U.S.C. § 512(g). Your written counter-notice
            must include:
          </p>
          <ol className="list-decimal ps-5 space-y-2 text-[var(--color-text-secondary)]">
            <li>
              <strong className="text-[var(--color-text)]">Identification of removed material.</strong>{' '}
              A description of the material that was removed and where it appeared before removal,
              with enough detail for us to locate it.
            </li>
            <li>
              <strong className="text-[var(--color-text)]">Good-faith statement.</strong>{' '}
              A statement under penalty of perjury that you have a good-faith belief the material
              was removed or disabled as a result of mistake or misidentification.
            </li>
            <li>
              <strong className="text-[var(--color-text)]">Consent to jurisdiction.</strong>{' '}
              Your name, address, telephone number, and a statement consenting to the jurisdiction
              of the Federal District Court for the judicial district where your address is located
              (or, if outside the US, any judicial district in which LeanShot may be found).
            </li>
            <li>
              <strong className="text-[var(--color-text)]">Physical or electronic signature.</strong>{' '}
              Your physical or electronic signature.
            </li>
          </ol>
          <p>
            Send completed counter-notices to{' '}
            <a
              href="mailto:abuse@leanshot.app"
              className="underline decoration-1 underline-offset-2 hover:no-underline"
            >
              abuse@leanshot.app
            </a>
            . Upon receipt of a valid counter-notice we will restore the removed content within
            10–14 business days unless the original complainant notifies us they have filed a
            court action.
          </p>
        </section>

        {/* 4. Safe-harbor disclaimer */}
        <section className="space-y-3">
          <h2 className="text-[18px] font-semibold text-[var(--color-text)]">
            Safe-harbor disclaimer
          </h2>
          <p>
            LeanShot operates as a service provider within the meaning of the DMCA § 512
            safe-harbor provisions. We do not monitor user-generated content for copyright
            infringement, but we respond to valid notices of alleged infringement as described
            above.
          </p>
          <p>
            Per § 512(i), LeanShot reserves the right to terminate the accounts of users who are
            repeat infringers under appropriate circumstances.
          </p>
        </section>

        {/* 5. Cross-reference */}
        <section className="space-y-3">
          <h2 className="text-[18px] font-semibold text-[var(--color-text)]">Related policies</h2>
          <p>
            For LeanShot&rsquo;s rules governing user-generated content, including community posts,
            see{' '}
            <a
              href="#/legal/terms#community-ugc"
              className="underline decoration-1 underline-offset-2 hover:no-underline"
            >
              Terms of Service § Community &amp; UGC
            </a>
            .
          </p>
        </section>

        {/* 6. CTA */}
        <section className="space-y-3">
          <p>
            <a
              href="mailto:abuse@leanshot.app?subject=DMCA%20Takedown%20Notice"
              className="inline-flex items-center gap-1.5 text-[var(--color-primary)] underline decoration-1 underline-offset-2 hover:no-underline font-semibold"
            >
              Submit DMCA notice
            </a>
          </p>
        </section>
      </article>
    </LegalLayout>
  );
}

export default DMCAPage;
