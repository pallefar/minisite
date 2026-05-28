// Phase 7 Plan 07-04 (COMPL-01) — Privacy Policy for v1 broad launch.
// Phase 64 Plan 04 (LEGAL-01 + LEGAL-04) — Extended with 5 state-privacy addendums,
//   live SubprocessorList, TOC, and "What changed" banner.
//
// Self-drafted under CONTEXT D-01 (LOCKED): no attorney engagement.
// Cross-sourced (per D-01 "at least two sources cross-referenced"):
//   (1) Termly free-tier privacy-policy generator output as the section
//       skeleton.
//   (2) DATA_CATEGORIES manifest in src/lib/legal/data-categories.ts — the
//       single source of truth for what we collect. (See ConsumerHealthData.tsx
//       for the WMHMDA-specific notice; this Privacy Policy enumerates the
//       FULL set of categories for any visitor regardless of jurisdiction.)
//
// The "Last updated" date drives the change-notification clock. Material
// changes (new processors, new categories, no-sale-commitment changes) MUST
// bump this and announce in-app per § Changes.
//
// Pure presentational component — no imports from @/lib/store, @/lib/storage,
// @/lib/ai, @/lib/analytics, @/lib/sentry-defer, or chart.js — so this page
// renders for signed-out visitors even when the data layer is broken.

import { DATA_CATEGORIES } from '@/lib/legal/data-categories';
import { LegalLayout } from './LegalLayout';
import { SubprocessorList } from './SubprocessorList';

const EFFECTIVE_DATE = '2026-05-12';
const LAST_UPDATED = '2026-05-27';

// State-addendum sections per LEGAL-01 / D-State-Privacy-Addendums.
// Each section includes: rights enumeration + exercise instructions + state contact.
// T-64-04-04 mitigation: all sections include draft disclaimer pending Phase 70 counsel review.

export function PrivacyPolicy() {
  return (
    <LegalLayout title="Privacy Policy">
      <article className="max-w-[760px] mx-auto px-1 py-2 space-y-6 text-[14px] text-[var(--color-text)] leading-relaxed">
        {/* 07-02 spec contract: data-todo marker names the authoring plan. */}
        <div data-todo="07-04" hidden />

        {/* Phase 64 Plan 04 — "What changed" sticky banner (T-64-04-04) */}
        <div
          className="rounded-lg p-4 bg-[var(--color-warning-soft)] border border-[var(--color-border)] space-y-2"
          role="note"
          aria-label="Policy update notice"
        >
          <p className="text-[13px] text-[var(--color-text)]">
            <strong>Last updated:</strong> {LAST_UPDATED} · <strong>What changed:</strong> Added
            state-specific privacy disclosures for California, Virginia, Colorado, Connecticut, and
            Utah residents. Updated subprocessor list to include OpenRouter, Cohere, Mux, Stripe
            Connect, Sentry, and the pgvector recommender. New Do Not Sell or Share opt-out page.
          </p>
          <p className="text-[11px] text-[var(--color-text-secondary)]">
            <a
              href="#what-changed"
              className="underline decoration-1 underline-offset-2 hover:no-underline focus-visible:no-underline"
            >
              See full change log →
            </a>
          </p>
        </div>

        {/* Phase 64 Plan 04 — Table of contents (sticky on lg+) */}
        <nav
          aria-label="Policy table of contents"
          className="lg:sticky lg:top-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-elevated)] p-4 space-y-2"
        >
          <p className="text-[13px] font-semibold text-[var(--color-text)]">Jump to:</p>
          <ul className="space-y-1">
            {[
              { href: '#overview', label: 'Privacy overview' },
              { href: '#categories-collected', label: 'Information we collect' },
              { href: '#how-we-use', label: 'How we use your info' },
              { href: '#subprocessors', label: 'Subprocessors' },
              { href: '#california', label: 'California (CCPA/CPRA)' },
              { href: '#virginia', label: 'Virginia (CDPA)' },
              { href: '#colorado', label: 'Colorado (CPA)' },
              { href: '#connecticut', label: 'Connecticut (CTDPA)' },
              { href: '#utah', label: 'Utah (UCPA)' },
              { href: '#what-changed', label: 'What changed' },
              { href: '#contact', label: 'Contact us' },
            ].map(({ href, label }) => (
              <li key={href}>
                <a
                  href={href}
                  className="text-[11px] font-normal text-[var(--color-text-secondary)] hover:underline focus-visible:underline"
                >
                  {label}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        {/* Header */}
        <header id="overview" className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Privacy Policy</h1>
          <p className="text-[13px] text-[var(--color-text-tertiary)]">
            Effective date: {EFFECTIVE_DATE}
          </p>
          <p className="text-[13px] text-[var(--color-text-tertiary)]">
            Last updated: {LAST_UPDATED}
          </p>
        </header>

        {/* Intro */}
        <p className="leading-relaxed">
          LeanShot is a web app that helps people on GLP-1 medications track injections, body
          metrics, food, activity, mood, symptoms, sleep, and progress photos, and visualize a
          drug-level projection. This Privacy Policy explains what data LeanShot collects, why we
          collect it, who we share it with, and how you can exercise your rights over it. Washington
          State residents — see also our{' '}
          <a
            href="#/legal/consumer-health"
            className="underline decoration-1 underline-offset-2 hover:no-underline focus-visible:no-underline"
          >
            Consumer Health Data Privacy notice
          </a>
          .
        </p>

        {/* § Categories collected */}
        <section id="categories-collected" className="space-y-3">
          <h2 className="text-[18px] font-semibold mt-8 mb-3">§ Categories collected</h2>
          <p>
            We collect the following <strong>health-data categories</strong> when you log them in
            the app:
          </p>
          <ul className="list-disc ps-5 space-y-1.5 text-[var(--color-text-secondary)]">
            {DATA_CATEGORIES.filter((c) => c.isConsumerHealthData).map((c) => (
              <li key={c.key}>
                <strong className="text-[var(--color-text)]">{c.label}.</strong> {c.description}
              </li>
            ))}
          </ul>
          <p>
            We also retain the following <strong>operational / metadata categories</strong>:
          </p>
          <ul className="list-disc ps-5 space-y-1.5 text-[var(--color-text-secondary)]">
            {DATA_CATEGORIES.filter((c) => !c.isConsumerHealthData).map((c) => (
              <li key={c.key}>
                <strong className="text-[var(--color-text)]">{c.label}.</strong> {c.description}
              </li>
            ))}
          </ul>
          <p className="text-[13px] text-[var(--color-text-tertiary)] italic">
            This enumeration is the single source of truth and is the load-bearing legal claim under
            WMHMDA §1 and the FTC HBNR&apos;s &ldquo;identifiable health information&rdquo;
            disclosure expectations. If a future product change adds a new persisted data slice,
            this list is updated in the same commit and a CI gate fails any drift.
          </p>
        </section>

        {/* § How we use it */}
        <section id="how-we-use" className="space-y-3">
          <h2 className="text-[18px] font-semibold mt-8 mb-3">§ How we use it</h2>
          <ul className="list-disc ps-5 space-y-1.5 text-[var(--color-text-secondary)]">
            <li>
              <strong className="text-[var(--color-text)]">Showing your data back to you.</strong>{' '}
              Charts, summaries, streaks, and the home dashboard render directly from what you have
              logged.
            </li>
            <li>
              <strong className="text-[var(--color-text)]">
                Generating the drug-level projection.
              </strong>{' '}
              The medication-tab pharmacokinetics curve is computed from your injection log using a
              literature-derived population PK model. It is not a measured serum level — see our{' '}
              <a
                href="#/legal/disclaimer"
                className="underline decoration-1 underline-offset-2 hover:no-underline focus-visible:no-underline"
              >
                Medical Disclaimer
              </a>{' '}
              for details.
            </li>
            <li>
              <strong className="text-[var(--color-text)]">AI coach prompts.</strong> When you ask
              the in-app AI coach a question, recent health data is included as context so the coach
              can give a relevant answer. The conversation history is retained so future replies can
              reference earlier topics.
            </li>
            <li>
              <strong className="text-[var(--color-text)]">Doctor-share reports.</strong> When you
              generate a doctor-share report from Settings, the same data is rendered into a
              shareable view (Phase 8) or exported as a PDF (Phase 7 Plan 07-06).
            </li>
            <li>
              <strong className="text-[var(--color-text)]">
                Reliability and error monitoring.
              </strong>{' '}
              Application crashes and handled errors are reported to Sentry so we can fix bugs.
              Sentry is named in § How we share below.
            </li>
          </ul>
        </section>

        {/* § How we share */}
        <section className="space-y-3">
          <h2 className="text-[18px] font-semibold mt-8 mb-3">§ How we share</h2>
          <p>
            We share data only with the operational subprocessors named below. We do not share data
            with advertisers, data brokers, insurers, employers, or government agencies (except as
            required by valid legal process). We do not sell your data.
          </p>
          <p>
            <strong className="text-[var(--color-text)]">Supabase</strong> — our managed Postgres
            database, authentication, object storage, and edge-functions provider. All of your
            health-data rows and your progress photos are stored on Supabase infrastructure in the
            us-east-1 region. Supabase acts as a data processor on our behalf, not a data
            controller. Per-user row-level security policies prevent any other LeanShot user from
            reading your rows; we verify this with cross-tenant RLS proof tests in CI.
          </p>
          <p>
            <strong className="text-[var(--color-text)]">Vercel</strong> — our hosting and
            edge-routing provider for the marketing site, the SPA shell, and the Vercel AI Gateway.
            Vercel sees standard HTTP request metadata (IP address, user agent, request path) at the
            edge. Per Vercel&apos;s AI Gateway data-handling policy at the time of this
            policy&apos;s effective date, Vercel does not retain the content of AI prompts or
            responses that route through the gateway.
          </p>
          <p>
            <strong className="text-[var(--color-text)]">Anthropic / Moonshot</strong> — our AI
            coach inference subprocessor. Your AI coach prompts and responses are routed via the
            Vercel AI Gateway to Moonshot&apos;s Kimi K2 model. (The &ldquo;Anthropic&rdquo; name
            appears here because the AI Gateway exposes a unified Anthropic-style client API; the
            upstream inference is performed by Moonshot.) The browser never sees an LLM API key
            directly — every request flows through our server-side ai-chat Edge Function on
            Supabase. The content of your AI conversation reaches Moonshot&apos;s inference servers
            for the duration of the request; Moonshot is not authorized to train models on your
            inputs.
          </p>
          <p>
            <strong className="text-[var(--color-text)]">Sentry</strong> — browser error monitoring,
            invoked only when an error occurs in the app. Sentry receives an error stack trace, the
            app version, and the JS console buffer. Per our Sentry configuration in{' '}
            <code>src/lib/sentry-defer.ts</code>, we strip user identifiers and free-text content
            before transmission so no health data is captured in error payloads.
          </p>
          <p>
            <strong className="text-[var(--color-text)]">PostHog</strong> — cookieless product
            analytics. PostHog is <strong>conditional</strong>: it is enabled only when the{' '}
            <code>VITE_ANALYTICS_ENABLED</code> build flag is on. As of the effective date of this
            policy ({EFFECTIVE_DATE}), PostHog is OFF in production. We disclose it here so that the
            operator can flip the flag on in the future without requiring a policy republish. When
            enabled, PostHog receives event names, timestamps, and a stable pseudonymous user
            identifier. PostHog does <strong>not</strong> receive health-data field values,
            free-text notes, progress photos, or AI conversation content.
          </p>
          <p className="font-medium">
            Statement of no-sale: We do not sell your data. We do not share data with advertisers.
            The above processors are operational subprocessors, not third-party recipients in the
            WMHMDA §3 sale-of-data sense.
          </p>
        </section>

        {/* § Subprocessors — live-fetched from Phase 25 pipeline (LEGAL-04) */}
        <section id="subprocessors" className="space-y-3">
          <h2 className="text-[18px] font-semibold mt-8 mb-3">§ Subprocessors</h2>
          <p className="text-[13px] text-[var(--color-text-secondary)]">
            The following table is live-fetched from our subprocessor monitoring pipeline. It
            reflects the most recent snapshot captured by our automated subprocessor-diff cron job
            (Phase 25). We do not maintain a static vendor list — this ensures the information is
            always current.
          </p>
          <SubprocessorList />
        </section>

        {/* § How long we retain */}
        <section className="space-y-3">
          <h2 className="text-[18px] font-semibold mt-8 mb-3">§ How long we retain</h2>
          <ul className="list-disc ps-5 space-y-1.5 text-[var(--color-text-secondary)]">
            <li>
              While your account is active, your data is retained indefinitely. We do not auto-prune
              your health data — you decide when to delete it.
            </li>
            <li>
              When you delete your account from{' '}
              <strong className="text-[var(--color-text)]">
                Settings → Privacy → Delete account
              </strong>
              , a 7-day undo window applies. At day 7, your data is hard-deleted: the per-user
              encryption key for your photos is destroyed, every row of your data in our 9 sync
              tables is cascade-deleted, and your photos in Supabase Storage are erased. A minimal
              audit-log skeleton (timestamps and SHA-256 hashes of your user ID — no plaintext PII)
              survives indefinitely for FTC HBNR breach-tracking compliance.
            </li>
            <li>
              Per-write audit logs (which records were inserted, updated, or deleted, with
              cryptographic before/after hashes only — no field contents) are retained for 13
              months. The 13-month retention covers an annual reporting cycle plus a one-month
              buffer.
            </li>
          </ul>
        </section>

        {/* § Your rights */}
        <section className="space-y-3">
          <h2 className="text-[18px] font-semibold mt-8 mb-3">§ Your rights</h2>
          <ul className="list-disc ps-5 space-y-1.5 text-[var(--color-text-secondary)]">
            <li>
              <strong className="text-[var(--color-text)]">Export your data.</strong> Settings →
              Data → Export JSON downloads every health-data row plus your AI conversation history.
              Settings → Data → Export PDF generates a patient-facing readable summary suitable for
              sharing with your prescriber.
            </li>
            <li>
              <strong className="text-[var(--color-text)]">Delete your account.</strong> Settings →
              Privacy → Delete account → type DELETE MY ACCOUNT to confirm. A 7-day undo window is
              available via an HMAC-signed cancel link emailed to you at the time of deletion (and
              an in-app banner). After 7 days the deletion is irreversible by design.
            </li>
            <li>
              <strong className="text-[var(--color-text)]">Correct your data.</strong> Every entry
              in the app is editable directly from the surface that created it. You can correct or
              remove entries at any time.
            </li>
            <li>
              <strong className="text-[var(--color-text)]">Withdraw consent for cloud sync.</strong>{' '}
              Sign out of your account. Your data continues to be readable locally on this device.
              (Local-first storage means cloud sync is opt-in; LeanShot remains functional offline.)
            </li>
            <li>
              <strong className="text-[var(--color-text)]">Washington State residents:</strong>{' '}
              additional rights under RCW 19.373 — including the right to confirm, access, delete,
              withdraw consent, and appeal — are detailed in our{' '}
              <a
                href="#/legal/consumer-health"
                className="underline decoration-1 underline-offset-2 hover:no-underline focus-visible:no-underline"
              >
                Consumer Health Data Privacy notice
              </a>
              .
            </li>
            <li>
              <strong className="text-[var(--color-text)]">Contact us to exercise rights:</strong>{' '}
              karsten.haldan@gmail.com.
            </li>
          </ul>
        </section>

        {/* § Children */}
        <section className="space-y-3">
          <h2 className="text-[18px] font-semibold mt-8 mb-3">§ Children</h2>
          <p>
            LeanShot is intended for users 18 years of age or older. We do not knowingly collect
            data from anyone under 18. If you believe a minor has created an account, please contact
            us at karsten.haldan@gmail.com and we will delete the account.
          </p>
        </section>

        {/* § Changes */}
        <section className="space-y-3">
          <h2 className="text-[18px] font-semibold mt-8 mb-3">§ Changes to this policy</h2>
          <p>
            We may update this policy as the product evolves. The &ldquo;Last updated&rdquo; date at
            the top of this page indicates the most recent change. Material changes — new
            processors, new data categories, or changes to the no-sale commitment — will be
            announced via a banner in the app on next sign-in. By continuing to use LeanShot after a
            policy update, you accept the updated policy.
          </p>
        </section>

        {/* § Contact */}
        <section id="contact" className="space-y-3">
          <h2 className="text-[18px] font-semibold mt-8 mb-3">§ Contact</h2>
          <p>
            Privacy questions: karsten.haldan@gmail.com. For Washington State consumer-health-data
            -specific questions, see also our{' '}
            <a
              href="#/legal/consumer-health"
              className="underline decoration-1 underline-offset-2 hover:no-underline focus-visible:no-underline"
            >
              Consumer Health Data Privacy notice
            </a>
            .
          </p>
        </section>

        {/* ============================================================
            Phase 64 Plan 04 — STATE-PRIVACY ADDENDUMS (LEGAL-01)
            Each section: anchored H2 + 3 subsections (rights / how to
            exercise / state-specific contact) + draft disclaimer.
            T-64-04-04: Each section opens with italic draft notice.
            T-64-04-03: All colors via var(--color-*) bracket syntax.
            Typography: text-[18px]/600 h2, text-[13px]/400 body,
                        text-[11px]/400 meta — within UI-SPEC ceiling.
            ============================================================ */}

        {/* § California (CCPA / CPRA) */}
        <section
          id="california"
          className="mt-12 pt-8 border-t border-[var(--color-border)] space-y-4"
        >
          <h2 className="text-[18px] font-semibold">California (CCPA / CPRA)</h2>
          <em className="block text-[13px] text-[var(--color-text-secondary)]">
            This addendum is in draft pending legal counsel review (Phase 70 UAT).
          </em>

          <div className="space-y-3">
            <h3 className="text-[13px] font-semibold text-[var(--color-text)]">Your rights</h3>
            <p className="text-[13px] text-[var(--color-text-secondary)]">
              The California Consumer Privacy Act (CCPA) and the California Privacy Rights Act
              (CPRA) grant California residents the following rights over their personal
              information:
            </p>
            <ul className="list-disc ps-5 space-y-1.5 text-[13px] text-[var(--color-text-secondary)]">
              <li>
                <strong className="text-[var(--color-text)]">Right to know.</strong> You may request
                disclosure of the categories and specific pieces of personal information we have
                collected about you, the sources, our business or commercial purposes for collecting
                it, and the categories of third parties with whom we share it.
              </li>
              <li>
                <strong className="text-[var(--color-text)]">Right to delete.</strong> You may
                request deletion of personal information we have collected from you, subject to
                certain exceptions (e.g., completing a transaction, detecting security incidents,
                complying with legal obligations).
              </li>
              <li>
                <strong className="text-[var(--color-text)]">Right to correct.</strong> You may
                request correction of inaccurate personal information we maintain about you.
              </li>
              <li>
                <strong className="text-[var(--color-text)]">
                  Right to opt out of sale or sharing.
                </strong>{' '}
                You may direct us not to sell or share your personal information with third parties.
                LeanShot does not sell personal information. To exercise this right formally, visit
                our{' '}
                <a
                  href="#/privacy/do-not-sell"
                  className="underline decoration-1 underline-offset-2"
                >
                  Do Not Sell or Share
                </a>{' '}
                page.
              </li>
              <li>
                <strong className="text-[var(--color-text)]">
                  Right to limit sensitive personal information use.
                </strong>{' '}
                Under CPRA, you may direct us to limit use of sensitive personal information
                (including health data) to purposes necessary to perform the services you request.
                Submit a request via{' '}
                <a
                  href="#/account/data-rights"
                  className="underline decoration-1 underline-offset-2"
                >
                  your data-rights portal
                </a>
                .
              </li>
              <li>
                <strong className="text-[var(--color-text)]">Right to non-discrimination.</strong>{' '}
                You will not receive discriminatory treatment for exercising your CCPA/CPRA rights.
                We will not deny you services, charge different prices, or provide a different
                quality of service as a result.
              </li>
            </ul>
          </div>

          <div className="space-y-2">
            <h3 className="text-[13px] font-semibold text-[var(--color-text)]">
              How to exercise these rights
            </h3>
            <p className="text-[13px] text-[var(--color-text-secondary)]">
              Submit a request via our{' '}
              <a href="#/account/data-rights" className="underline decoration-1 underline-offset-2">
                Data Rights portal
              </a>{' '}
              or the{' '}
              <a href="#/privacy/do-not-sell" className="underline decoration-1 underline-offset-2">
                Do Not Sell or Share page
              </a>
              . We will respond within 45 days of receipt. If we need more time, we will notify you
              with the reason and the extension period (up to an additional 45 days).
            </p>
          </div>

          <div className="space-y-2">
            <h3 className="text-[13px] font-semibold text-[var(--color-text)]">
              State-specific contact
            </h3>
            <p className="text-[13px] text-[var(--color-text-secondary)]">
              Email{' '}
              <a
                href="mailto:privacy@leanshot.app?subject=[CA Privacy]"
                className="underline decoration-1 underline-offset-2"
              >
                privacy@leanshot.app
              </a>{' '}
              with subject line <code>[CA Privacy]</code> for California-specific inquiries.
            </p>
          </div>
        </section>

        {/* § Virginia (CDPA) */}
        <section
          id="virginia"
          className="mt-12 pt-8 border-t border-[var(--color-border)] space-y-4"
        >
          <h2 className="text-[18px] font-semibold">Virginia (CDPA)</h2>
          <em className="block text-[13px] text-[var(--color-text-secondary)]">
            This addendum is in draft pending legal counsel review (Phase 70 UAT).
          </em>

          <div className="space-y-3">
            <h3 className="text-[13px] font-semibold text-[var(--color-text)]">Your rights</h3>
            <p className="text-[13px] text-[var(--color-text-secondary)]">
              Virginia&apos;s Consumer Data Protection Act (CDPA) grants Virginia residents the
              following rights:
            </p>
            <ul className="list-disc ps-5 space-y-1.5 text-[13px] text-[var(--color-text-secondary)]">
              <li>
                <strong className="text-[var(--color-text)]">Right to access.</strong> Confirm
                whether we process your personal data and access that data.
              </li>
              <li>
                <strong className="text-[var(--color-text)]">Right to delete.</strong> Delete
                personal data you have provided or that we have collected about you.
              </li>
              <li>
                <strong className="text-[var(--color-text)]">Right to correct.</strong> Correct
                inaccuracies in your personal data.
              </li>
              <li>
                <strong className="text-[var(--color-text)]">Right to portability.</strong> Obtain a
                copy of your personal data in a portable, readily usable format where technically
                feasible.
              </li>
              <li>
                <strong className="text-[var(--color-text)]">Right to opt out.</strong> Opt out of
                the processing of your personal data for purposes of targeted advertising, sale of
                personal data, or profiling in furtherance of decisions producing legal or similarly
                significant effects.
              </li>
            </ul>
          </div>

          <div className="space-y-2">
            <h3 className="text-[13px] font-semibold text-[var(--color-text)]">
              How to exercise these rights
            </h3>
            <p className="text-[13px] text-[var(--color-text-secondary)]">
              Submit a request via our{' '}
              <a href="#/account/data-rights" className="underline decoration-1 underline-offset-2">
                Data Rights portal
              </a>{' '}
              or the{' '}
              <a href="#/privacy/do-not-sell" className="underline decoration-1 underline-offset-2">
                Do Not Sell or Share page
              </a>
              . We will respond within 45 days. You may appeal our decision by emailing{' '}
              <a
                href="mailto:privacy@leanshot.app?subject=[VA Privacy Appeal]"
                className="underline decoration-1 underline-offset-2"
              >
                privacy@leanshot.app
              </a>
              .
            </p>
          </div>

          <div className="space-y-2">
            <h3 className="text-[13px] font-semibold text-[var(--color-text)]">
              State-specific contact
            </h3>
            <p className="text-[13px] text-[var(--color-text-secondary)]">
              Email{' '}
              <a
                href="mailto:privacy@leanshot.app?subject=[VA Privacy]"
                className="underline decoration-1 underline-offset-2"
              >
                privacy@leanshot.app
              </a>{' '}
              with subject line <code>[VA Privacy]</code>.
            </p>
          </div>
        </section>

        {/* § Colorado (CPA) */}
        <section
          id="colorado"
          className="mt-12 pt-8 border-t border-[var(--color-border)] space-y-4"
        >
          <h2 className="text-[18px] font-semibold">Colorado (CPA)</h2>
          <em className="block text-[13px] text-[var(--color-text-secondary)]">
            This addendum is in draft pending legal counsel review (Phase 70 UAT).
          </em>

          <div className="space-y-3">
            <h3 className="text-[13px] font-semibold text-[var(--color-text)]">Your rights</h3>
            <p className="text-[13px] text-[var(--color-text-secondary)]">
              Colorado&apos;s Privacy Act (CPA) grants Colorado residents the following rights:
            </p>
            <ul className="list-disc ps-5 space-y-1.5 text-[13px] text-[var(--color-text-secondary)]">
              <li>
                <strong className="text-[var(--color-text)]">Right to access.</strong> Confirm
                whether we process your personal data and access that data.
              </li>
              <li>
                <strong className="text-[var(--color-text)]">Right to delete.</strong> Delete
                personal data you have provided or that we have collected about you.
              </li>
              <li>
                <strong className="text-[var(--color-text)]">Right to correct.</strong> Correct
                inaccuracies in your personal data.
              </li>
              <li>
                <strong className="text-[var(--color-text)]">Right to portability.</strong> Obtain a
                copy of your personal data in a portable, readily usable format.
              </li>
              <li>
                <strong className="text-[var(--color-text)]">Right to opt out.</strong> Opt out of
                targeted advertising, sale, or profiling that produces legal or similarly
                significant effects.
              </li>
              <li>
                <strong className="text-[var(--color-text)]">Universal opt-out signals.</strong>{' '}
                Colorado recognizes universal opt-out mechanisms, including the Global Privacy
                Control (GPC) browser signal. If your browser sends a GPC signal, we treat it as an
                opt-out request for sale and targeted advertising.
              </li>
            </ul>
          </div>

          <div className="space-y-2">
            <h3 className="text-[13px] font-semibold text-[var(--color-text)]">
              How to exercise these rights
            </h3>
            <p className="text-[13px] text-[var(--color-text-secondary)]">
              Submit a request via our{' '}
              <a href="#/account/data-rights" className="underline decoration-1 underline-offset-2">
                Data Rights portal
              </a>{' '}
              or the{' '}
              <a href="#/privacy/do-not-sell" className="underline decoration-1 underline-offset-2">
                Do Not Sell or Share page
              </a>
              . We respond within 45 days (up to 90 days with notice).
            </p>
          </div>

          <div className="space-y-2">
            <h3 className="text-[13px] font-semibold text-[var(--color-text)]">
              State-specific contact
            </h3>
            <p className="text-[13px] text-[var(--color-text-secondary)]">
              Email{' '}
              <a
                href="mailto:privacy@leanshot.app?subject=[CO Privacy]"
                className="underline decoration-1 underline-offset-2"
              >
                privacy@leanshot.app
              </a>{' '}
              with subject line <code>[CO Privacy]</code>.
            </p>
          </div>
        </section>

        {/* § Connecticut (CTDPA) */}
        <section
          id="connecticut"
          className="mt-12 pt-8 border-t border-[var(--color-border)] space-y-4"
        >
          <h2 className="text-[18px] font-semibold">Connecticut (CTDPA)</h2>
          <em className="block text-[13px] text-[var(--color-text-secondary)]">
            This addendum is in draft pending legal counsel review (Phase 70 UAT).
          </em>

          <div className="space-y-3">
            <h3 className="text-[13px] font-semibold text-[var(--color-text)]">Your rights</h3>
            <p className="text-[13px] text-[var(--color-text-secondary)]">
              Connecticut&apos;s Data Privacy Act (CTDPA) grants Connecticut residents the following
              rights:
            </p>
            <ul className="list-disc ps-5 space-y-1.5 text-[13px] text-[var(--color-text-secondary)]">
              <li>
                <strong className="text-[var(--color-text)]">Right to access.</strong> Confirm
                whether we process your personal data and access that data.
              </li>
              <li>
                <strong className="text-[var(--color-text)]">Right to delete.</strong> Delete
                personal data you have provided or that we have collected about you.
              </li>
              <li>
                <strong className="text-[var(--color-text)]">Right to correct.</strong> Correct
                inaccuracies in your personal data.
              </li>
              <li>
                <strong className="text-[var(--color-text)]">Right to portability.</strong> Obtain a
                copy of your personal data in a portable, readily usable format.
              </li>
              <li>
                <strong className="text-[var(--color-text)]">Right to opt out.</strong> Opt out of
                targeted advertising, sale, or profiling with significant effects.
              </li>
              <li>
                <strong className="text-[var(--color-text)]">Universal opt-out signals.</strong>{' '}
                Connecticut recognizes the Global Privacy Control (GPC) browser signal as a valid
                opt-out mechanism.
              </li>
            </ul>
          </div>

          <div className="space-y-2">
            <h3 className="text-[13px] font-semibold text-[var(--color-text)]">
              How to exercise these rights
            </h3>
            <p className="text-[13px] text-[var(--color-text-secondary)]">
              Submit a request via our{' '}
              <a href="#/account/data-rights" className="underline decoration-1 underline-offset-2">
                Data Rights portal
              </a>{' '}
              or the{' '}
              <a href="#/privacy/do-not-sell" className="underline decoration-1 underline-offset-2">
                Do Not Sell or Share page
              </a>
              . We respond within 45 days (up to 90 days with notice). You may appeal our decision
              within 60 days of receiving our response.
            </p>
          </div>

          <div className="space-y-2">
            <h3 className="text-[13px] font-semibold text-[var(--color-text)]">
              State-specific contact
            </h3>
            <p className="text-[13px] text-[var(--color-text-secondary)]">
              Email{' '}
              <a
                href="mailto:privacy@leanshot.app?subject=[CT Privacy]"
                className="underline decoration-1 underline-offset-2"
              >
                privacy@leanshot.app
              </a>{' '}
              with subject line <code>[CT Privacy]</code>.
            </p>
          </div>
        </section>

        {/* § Utah (UCPA) */}
        <section id="utah" className="mt-12 pt-8 border-t border-[var(--color-border)] space-y-4">
          <h2 className="text-[18px] font-semibold">Utah (UCPA)</h2>
          <em className="block text-[13px] text-[var(--color-text-secondary)]">
            This addendum is in draft pending legal counsel review (Phase 70 UAT).
          </em>

          <div className="space-y-3">
            <h3 className="text-[13px] font-semibold text-[var(--color-text)]">Your rights</h3>
            <p className="text-[13px] text-[var(--color-text-secondary)]">
              Utah&apos;s Consumer Privacy Act (UCPA) grants Utah residents a narrower set of rights
              compared to some other state laws. Specifically, the UCPA does not include rights to
              correction or portability. Utah residents have the following rights:
            </p>
            <ul className="list-disc ps-5 space-y-1.5 text-[13px] text-[var(--color-text-secondary)]">
              <li>
                <strong className="text-[var(--color-text)]">Right to access.</strong> Confirm
                whether we process your personal data and access that data.
              </li>
              <li>
                <strong className="text-[var(--color-text)]">Right to deletion.</strong> Delete
                personal data you have provided to us.
              </li>
              <li>
                <strong className="text-[var(--color-text)]">Right to opt out.</strong> Opt out of
                the sale of personal data or the processing of personal data for targeted
                advertising.
              </li>
            </ul>
            <p className="text-[13px] text-[var(--color-text-secondary)] italic">
              Note: The UCPA does not grant rights to correction or data portability. If you are a
              Utah resident seeking to correct data, you may do so directly within the LeanShot app
              — every entry is editable from the surface that created it.
            </p>
          </div>

          <div className="space-y-2">
            <h3 className="text-[13px] font-semibold text-[var(--color-text)]">
              How to exercise these rights
            </h3>
            <p className="text-[13px] text-[var(--color-text-secondary)]">
              Submit a request via our{' '}
              <a href="#/account/data-rights" className="underline decoration-1 underline-offset-2">
                Data Rights portal
              </a>{' '}
              or the{' '}
              <a href="#/privacy/do-not-sell" className="underline decoration-1 underline-offset-2">
                Do Not Sell or Share page
              </a>
              . We respond within 45 days of receipt.
            </p>
          </div>

          <div className="space-y-2">
            <h3 className="text-[13px] font-semibold text-[var(--color-text)]">
              State-specific contact
            </h3>
            <p className="text-[13px] text-[var(--color-text-secondary)]">
              Email{' '}
              <a
                href="mailto:privacy@leanshot.app?subject=[UT Privacy]"
                className="underline decoration-1 underline-offset-2"
              >
                privacy@leanshot.app
              </a>{' '}
              with subject line <code>[UT Privacy]</code>.
            </p>
          </div>
        </section>

        {/* § What changed (change log anchor) */}
        <section
          id="what-changed"
          className="mt-12 pt-8 border-t border-[var(--color-border)] space-y-4"
        >
          <h2 className="text-[18px] font-semibold">What changed</h2>
          <p className="text-[13px] text-[var(--color-text-secondary)]">
            Chronological change log for this policy:
          </p>
          <div className="space-y-4">
            <div>
              <p className="text-[13px] font-semibold text-[var(--color-text)]">
                2026-05-27 — Phase 64 Legal Refresh
              </p>
              <ul className="list-disc ps-5 mt-1 space-y-1 text-[13px] text-[var(--color-text-secondary)]">
                <li>
                  Added state-specific privacy addendums for California (CCPA/CPRA), Virginia
                  (CDPA), Colorado (CPA), Connecticut (CTDPA), and Utah (UCPA) residents.
                </li>
                <li>
                  Replaced static subprocessor list with live-fetched <code>SubprocessorList</code>{' '}
                  component drawing from the Phase 25 subprocessor-diff snapshot pipeline. Current
                  vendors include: Supabase, Vercel, Anthropic/Moonshot, Sentry, PostHog, Mux,
                  Stripe Connect, OpenRouter, Cohere, Resend.
                </li>
                <li>
                  Launched new{' '}
                  <a
                    href="#/privacy/do-not-sell"
                    className="underline decoration-1 underline-offset-2"
                  >
                    Do Not Sell or Share
                  </a>{' '}
                  opt-out page (Plan 64-05).
                </li>
                <li>Updated DSAR portal with state-residency intake (Plan 64-06).</li>
              </ul>
            </div>
            <div>
              <p className="text-[13px] font-semibold text-[var(--color-text)]">
                2026-05-12 — Phase 7 Initial Policy
              </p>
              <ul className="list-disc ps-5 mt-1 space-y-1 text-[13px] text-[var(--color-text-secondary)]">
                <li>Initial policy published for v1 launch.</li>
              </ul>
            </div>
          </div>
        </section>
      </article>
    </LegalLayout>
  );
}

export default PrivacyPolicy;
