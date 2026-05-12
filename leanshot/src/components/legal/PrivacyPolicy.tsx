// Phase 7 Plan 07-04 (COMPL-01) — Privacy Policy for v1 broad launch.
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

const EFFECTIVE_DATE = '2026-05-12';
const LAST_UPDATED = '2026-05-12';

export function PrivacyPolicy() {
  return (
    <LegalLayout title="Privacy Policy">
      <article className="max-w-[760px] mx-auto px-1 py-2 space-y-6 text-[14px] text-[var(--color-text)] leading-relaxed">
        {/* 07-02 spec contract: data-todo marker names the authoring plan. */}
        <div data-todo="07-04" hidden />
        {/* Header */}
        <header className="space-y-1">
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
          drug-level projection. This Privacy Policy explains what data LeanShot collects, why
          we collect it, who we share it with, and how you can exercise your rights over it.
          Washington State residents — see also our{' '}
          <a
            href="#/legal/consumer-health"
            className="underline decoration-1 underline-offset-2 hover:no-underline focus-visible:no-underline"
          >
            Consumer Health Data Privacy notice
          </a>
          .
        </p>

        {/* § Categories collected */}
        <section className="space-y-3">
          <h2 className="text-[18px] font-semibold mt-8 mb-3">§ Categories collected</h2>
          <p>
            We collect the following <strong>health-data categories</strong> when you log them in
            the app:
          </p>
          <ul className="list-disc pl-5 space-y-1.5 text-[var(--color-text-secondary)]">
            {DATA_CATEGORIES.filter((c) => c.isConsumerHealthData).map((c) => (
              <li key={c.key}>
                <strong className="text-[var(--color-text)]">{c.label}.</strong> {c.description}
              </li>
            ))}
          </ul>
          <p>
            We also retain the following <strong>operational / metadata categories</strong>:
          </p>
          <ul className="list-disc pl-5 space-y-1.5 text-[var(--color-text-secondary)]">
            {DATA_CATEGORIES.filter((c) => !c.isConsumerHealthData).map((c) => (
              <li key={c.key}>
                <strong className="text-[var(--color-text)]">{c.label}.</strong> {c.description}
              </li>
            ))}
          </ul>
          <p className="text-[13px] text-[var(--color-text-tertiary)] italic">
            This enumeration is the single source of truth and is the load-bearing legal claim
            under WMHMDA §1 and the FTC HBNR&apos;s &ldquo;identifiable health information&rdquo;
            disclosure
            expectations. If a future product change adds a new persisted data slice, this list
            is updated in the same commit and a CI gate fails any drift.
          </p>
        </section>

        {/* § How we use it */}
        <section className="space-y-3">
          <h2 className="text-[18px] font-semibold mt-8 mb-3">§ How we use it</h2>
          <ul className="list-disc pl-5 space-y-1.5 text-[var(--color-text-secondary)]">
            <li>
              <strong className="text-[var(--color-text)]">Showing your data back to you.</strong>{' '}
              Charts, summaries, streaks, and the home dashboard render directly from what you
              have logged.
            </li>
            <li>
              <strong className="text-[var(--color-text)]">
                Generating the drug-level projection.
              </strong>{' '}
              The medication-tab pharmacokinetics curve is computed from your injection log using
              a literature-derived population PK model. It is not a measured serum level — see
              our{' '}
              <a
                href="#/legal/disclaimer"
                className="underline decoration-1 underline-offset-2 hover:no-underline focus-visible:no-underline"
              >
                Medical Disclaimer
              </a>{' '}
              for details.
            </li>
            <li>
              <strong className="text-[var(--color-text)]">AI coach prompts.</strong> When you
              ask the in-app AI coach a question, recent health data is included as context so
              the coach can give a relevant answer. The conversation history is retained so
              future replies can reference earlier topics.
            </li>
            <li>
              <strong className="text-[var(--color-text)]">Doctor-share reports.</strong> When
              you generate a doctor-share report from Settings, the same data is rendered into a
              shareable view (Phase 8) or exported as a PDF (Phase 7 Plan 07-06).
            </li>
            <li>
              <strong className="text-[var(--color-text)]">Reliability and error monitoring.</strong>{' '}
              Application crashes and handled errors are reported to Sentry so we can fix bugs.
              Sentry is named in § How we share below.
            </li>
          </ul>
        </section>

        {/* § How we share */}
        <section className="space-y-3">
          <h2 className="text-[18px] font-semibold mt-8 mb-3">§ How we share</h2>
          <p>
            We share data only with the operational subprocessors named below. We do not share
            data with advertisers, data brokers, insurers, employers, or government agencies
            (except as required by valid legal process). We do not sell your data.
          </p>
          <p>
            <strong className="text-[var(--color-text)]">Supabase</strong> — our managed Postgres
            database, authentication, object storage, and edge-functions provider. All of your
            health-data rows and your progress photos are stored on Supabase infrastructure in
            the us-east-1 region. Supabase acts as a data processor on our behalf, not a data
            controller. Per-user row-level security policies prevent any other LeanShot user
            from reading your rows; we verify this with cross-tenant RLS proof tests in CI.
          </p>
          <p>
            <strong className="text-[var(--color-text)]">Vercel</strong> — our hosting and
            edge-routing provider for the marketing site, the SPA shell, and the Vercel AI
            Gateway. Vercel sees standard HTTP request metadata (IP address, user agent, request
            path) at the edge. Per Vercel&apos;s AI Gateway data-handling policy at the time of
            this policy&apos;s effective date, Vercel does not retain the content of AI prompts or
            responses that route through the gateway.
          </p>
          <p>
            <strong className="text-[var(--color-text)]">Anthropic / Moonshot</strong> — our AI
            coach inference subprocessor. Your AI coach prompts and responses are routed via the
            Vercel AI Gateway to Moonshot&apos;s Kimi K2 model. (The &ldquo;Anthropic&rdquo; name
            appears here because the AI Gateway exposes a unified Anthropic-style client API; the
            upstream inference is performed by Moonshot.) The browser never sees an LLM API key
            directly — every request flows through our server-side ai-chat Edge Function on
            Supabase. The content of your AI conversation reaches Moonshot&apos;s inference
            servers for the
            duration of the request; Moonshot is not authorized to train models on your inputs.
          </p>
          <p>
            <strong className="text-[var(--color-text)]">Sentry</strong> — browser error
            monitoring, invoked only when an error occurs in the app. Sentry receives an error
            stack trace, the app version, and the JS console buffer. Per our Sentry
            configuration in <code>src/lib/sentry-defer.ts</code>, we strip user identifiers and
            free-text content before transmission so no health data is captured in error
            payloads.
          </p>
          <p>
            <strong className="text-[var(--color-text)]">PostHog</strong> — cookieless product
            analytics. PostHog is <strong>conditional</strong>: it is enabled only when the{' '}
            <code>VITE_ANALYTICS_ENABLED</code> build flag is on. As of the effective date of
            this policy ({EFFECTIVE_DATE}), PostHog is OFF in production. We disclose it here so
            that the operator can flip the flag on in the future without requiring a policy
            republish. When enabled, PostHog receives event names, timestamps, and a stable
            pseudonymous user identifier. PostHog does <strong>not</strong> receive health-data
            field values, free-text notes, progress photos, or AI conversation content.
          </p>
          <p className="font-medium">
            Statement of no-sale: We do not sell your data. We do not share data with advertisers.
            The above processors are operational subprocessors, not third-party recipients in the
            WMHMDA §3 sale-of-data sense.
          </p>
        </section>

        {/* § How long we retain */}
        <section className="space-y-3">
          <h2 className="text-[18px] font-semibold mt-8 mb-3">§ How long we retain</h2>
          <ul className="list-disc pl-5 space-y-1.5 text-[var(--color-text-secondary)]">
            <li>
              While your account is active, your data is retained indefinitely. We do not
              auto-prune your health data — you decide when to delete it.
            </li>
            <li>
              When you delete your account from{' '}
              <strong className="text-[var(--color-text)]">Settings → Privacy → Delete account</strong>
              , a 30-day undo window applies. At day 30, your data is hard-deleted: the per-user
              encryption key for your photos is destroyed, every row of your data in our 9 sync
              tables is cascade-deleted, and your photos in Supabase Storage are erased. A
              minimal audit-log skeleton (timestamps and SHA-256 hashes of your user ID — no
              plaintext PII) survives indefinitely for FTC HBNR breach-tracking compliance.
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
          <ul className="list-disc pl-5 space-y-1.5 text-[var(--color-text-secondary)]">
            <li>
              <strong className="text-[var(--color-text)]">Export your data.</strong> Settings →
              Data → Export JSON downloads every health-data row plus your AI conversation
              history. Settings → Data → Export PDF generates a patient-facing readable summary
              suitable for sharing with your prescriber.
            </li>
            <li>
              <strong className="text-[var(--color-text)]">Delete your account.</strong> Settings
              → Privacy → Delete account → type your email to confirm. A 30-day undo window is
              available via a magic link emailed to you at the time of deletion. After 30 days
              the deletion is irreversible by design.
            </li>
            <li>
              <strong className="text-[var(--color-text)]">Correct your data.</strong> Every
              entry in the app is editable directly from the surface that created it. You can
              correct or remove entries at any time.
            </li>
            <li>
              <strong className="text-[var(--color-text)]">Withdraw consent for cloud sync.</strong>{' '}
              Sign out of your account. Your data continues to be readable locally on this
              device. (Local-first storage means cloud sync is opt-in; LeanShot remains
              functional offline.)
            </li>
            <li>
              <strong className="text-[var(--color-text)]">Washington State residents:</strong>{' '}
              additional rights under RCW 19.373 — including the right to confirm, access,
              delete, withdraw consent, and appeal — are detailed in our{' '}
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
            data from anyone under 18. If you believe a minor has created an account, please
            contact us at karsten.haldan@gmail.com and we will delete the account.
          </p>
        </section>

        {/* § Changes */}
        <section className="space-y-3">
          <h2 className="text-[18px] font-semibold mt-8 mb-3">§ Changes to this policy</h2>
          <p>
            We may update this policy as the product evolves. The &ldquo;Last updated&rdquo; date
            at the top
            of this page indicates the most recent change. Material changes — new processors,
            new data categories, or changes to the no-sale commitment — will be announced via a
            banner in the app on next sign-in. By continuing to use LeanShot after a policy
            update, you accept the updated policy.
          </p>
        </section>

        {/* § Contact */}
        <section className="space-y-3">
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
      </article>
    </LegalLayout>
  );
}

export default PrivacyPolicy;
