/**
 * Phase 64 Plan 05 (LEGAL-05) — Accessibility Statement.
 *
 * Route: #/legal/accessibility (added to App.tsx by Plan 64-07)
 *
 * States WCAG 2.2 AA conformance target + ADA Title III posture +
 * 30-day remediation SLA + accessibility@leanshot.app contact.
 *
 * Token compliance: uses ONLY @theme-defined CSS custom properties.
 * No undefined Tailwind v4 tokens (Phase 60 BLOCKER rule).
 *
 * Draft disclaimer: This statement is in draft pending Phase 70 legal counsel review.
 */
import { Helmet } from 'react-helmet-async';
import { LegalLayout } from './LegalLayout';

export function AccessibilityPage() {
  return (
    <LegalLayout title="Accessibility Statement">
      <Helmet>
        <title>Accessibility Statement · LeanShot</title>
        <meta
          name="description"
          content="LeanShot's accessibility statement — WCAG 2.2 AA conformance target, ADA Title III posture, and 30-day remediation SLA."
        />
      </Helmet>

      <article className="space-y-8 text-[13px] text-[var(--color-text)] leading-relaxed">
        <em className="block text-[var(--color-text-tertiary)]">
          This accessibility statement is in draft pending legal counsel review (Phase 70 UAT).
        </em>

        {/* 1. Our commitment */}
        <section className="space-y-3">
          <h2 className="text-[18px] font-semibold text-[var(--color-text)]">Our commitment</h2>
          <p>
            LeanShot is committed to making our web application accessible to everyone, including
            people with disabilities. Our conformance target is <strong>WCAG 2.2 Level AA</strong>{' '}
            as established by the World Wide Web Consortium (W3C). We audit our UI against these
            guidelines on a continuous basis as new features ship.
          </p>
        </section>

        {/* 2. ADA Title III posture */}
        <section className="space-y-3">
          <h2 className="text-[18px] font-semibold text-[var(--color-text)]">
            ADA Title III posture
          </h2>
          <p>
            LeanShot is a place of public accommodation under ADA Title III. We treat full digital
            accessibility as a compliance obligation, not a feature. Our development process
            includes accessibility review at the design and implementation stages for every new
            patient-facing surface.
          </p>
        </section>

        {/* 3. Conformance status */}
        <section className="space-y-3">
          <h2 className="text-[18px] font-semibold text-[var(--color-text)]">Conformance status</h2>
          <p>We aim to conform with WCAG 2.2 Level AA across all patient-facing surfaces.</p>
          <ul className="list-disc ps-5 space-y-1.5 text-[var(--color-text-secondary)]">
            <li>
              <strong className="text-[var(--color-text)]">Keyboard navigation.</strong> All
              interactive controls are reachable and operable via keyboard alone.
            </li>
            <li>
              <strong className="text-[var(--color-text)]">Screen-reader labels.</strong> All
              non-text content and icon-only buttons carry descriptive <code>aria-label</code>{' '}
              attributes.
            </li>
            <li>
              <strong className="text-[var(--color-text)]">Color contrast.</strong> Text meets WCAG
              2.2 AA contrast ratios (4.5:1 for body, 3:1 for large text) in both light and dark
              themes.
            </li>
            <li>
              <strong className="text-[var(--color-text)]">Reduced motion.</strong> Animations are
              suppressed when the user&rsquo;s OS has <code>prefers-reduced-motion: reduce</code>{' '}
              set, via <code>useReducedMotion()</code> hook and CSS media queries.
            </li>
          </ul>
        </section>

        {/* 4. Known limitations */}
        <section className="space-y-3">
          <h2 className="text-[18px] font-semibold text-[var(--color-text)]">Known limitations</h2>
          <ul className="list-disc ps-5 space-y-1.5 text-[var(--color-text-secondary)]">
            <li>
              <strong className="text-[var(--color-text)]">Chart.js dashboards.</strong> Time-series
              charts (medication curves, weight, etc.) have lower screen-reader fidelity; we provide
              equivalent data via the data-export (JSON/PDF) and the doctor-report features as
              alternatives.
            </li>
          </ul>
        </section>

        {/* 5. Remediation timeline */}
        <section className="space-y-3">
          <h2 className="text-[18px] font-semibold text-[var(--color-text)]">
            Remediation timeline
          </h2>
          <p>
            When you report an accessibility issue, we commit to a{' '}
            <strong>30-day response SLA</strong>. Critical barriers that prevent core functionality
            (logging an injection, viewing your dashboard) will be escalated for immediate
            remediation.
          </p>
        </section>

        {/* 6. Contact */}
        <section className="space-y-3">
          <h2 className="text-[18px] font-semibold text-[var(--color-text)]">Contact us</h2>
          <p>
            If you encounter an accessibility barrier or have questions about our accessibility
            posture, please contact us at{' '}
            <a
              href="mailto:accessibility@leanshot.app"
              className="underline decoration-1 underline-offset-2 hover:no-underline"
            >
              accessibility@leanshot.app
            </a>
            .
          </p>
          <p>
            <a
              href="mailto:accessibility@leanshot.app"
              className="inline-flex items-center gap-1.5 text-[var(--color-primary)] underline decoration-1 underline-offset-2 hover:no-underline font-semibold"
            >
              Report an accessibility issue
            </a>
          </p>
        </section>
      </article>
    </LegalLayout>
  );
}

export default AccessibilityPage;
