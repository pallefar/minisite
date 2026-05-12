// Phase 7 Plan 07-03 (COMPL-02) — WMHMDA Consumer Health Data Privacy Notice.
//
// Hand-rolled from RCW 19.373.030 primary source per D-01 (LOCKED self-draft,
// no counsel) and Researcher Key Finding #7 (Termly/iubenda free tiers skip
// some statute-required anchors). The cross-reference rationale lives in
// .planning/decisions/COMPL-02-TEMPLATE-COMPARISON.md.
//
// The five H2 anchors below are the structurally-mandated disclosures under
// RCW 19.373.030(1)(b)(i)–(v). The e2e spec asserts each H2 verbatim AND
// asserts every DATA_CATEGORIES[i].label appears in the rendered DOM —
// that's the manifest-to-policy drift gate (T-07-03-03 mitigation).
//
// The hidden `data-todo="07-03"` element is retained for legal-pages.spec.ts
// Test B compatibility (07-02's contract); a follow-on plan can sweep it
// once the spec's TODO regex is updated.

import { DATA_CATEGORIES } from '@/lib/legal/data-categories';
import { LegalLayout } from './LegalLayout';

const LAST_UPDATED_ISO = '2026-05-12';

const CHD_CATEGORIES = DATA_CATEGORIES.filter((c) => c.isConsumerHealthData);
const NON_CHD_CATEGORIES = DATA_CATEGORIES.filter((c) => !c.isConsumerHealthData);

export function ConsumerHealthData() {
  return (
    <LegalLayout title="Consumer Health Data">
      <article className="prose prose-sm max-w-none text-[var(--color-text)]">
        <h1 className="text-2xl font-semibold tracking-tight mb-2">Consumer Health Data</h1>
        <p className="text-[13px] text-[var(--color-text-tertiary)] mb-6">
          Privacy notice for <strong>Washington</strong> residents · Last updated {LAST_UPDATED_ISO}
        </p>
        <div data-todo="07-03" hidden />

        <p className="leading-relaxed mb-6">
          This notice is provided to consumers in <strong>Washington</strong> under the{' '}
          <em>My Health My Data Act</em> (RCW 19.373). It supplements our general Privacy Policy and
          explains how LeanShot handles <strong>consumer health data</strong> as defined in RCW
          19.373.020(8). If you are not a Washington resident, the general Privacy Policy still
          applies; this notice describes the additional disclosures Washington law requires.
        </p>

        {/* §1 — Categories collected */}
        <h2 className="text-xl font-semibold mt-8 mb-3">
          Categories of consumer health data we collect
        </h2>
        <p className="leading-relaxed mb-3">
          We collect the following categories of <strong>consumer health data</strong>:
        </p>
        <ul className="list-disc pl-6 space-y-2 mb-5">
          {CHD_CATEGORIES.map((c) => (
            <li key={c.key} className="leading-relaxed">
              <strong>{c.label}.</strong> {c.description}
            </li>
          ))}
        </ul>
        <p className="leading-relaxed mb-3">
          We also retain the following non–consumer-health data:
        </p>
        <ul className="list-disc pl-6 space-y-2 mb-5">
          {NON_CHD_CATEGORIES.map((c) => (
            <li key={c.key} className="leading-relaxed">
              <strong>{c.label}.</strong> {c.description}
            </li>
          ))}
        </ul>
        <p className="leading-relaxed mb-4">
          <strong>Purpose.</strong> We collect this consumer health data so the app can show you
          your medication curve, your body changes over time, your symptoms, your nutrition and
          activity patterns, and so the in-app AI coach can give you context-aware feedback. We do
          not use your consumer health data for advertising. We do not sell your consumer health
          data.
        </p>

        {/* §2 — Sources */}
        <h2 className="text-xl font-semibold mt-8 mb-3">
          Sources from which we collect consumer health data
        </h2>
        <ul className="list-disc pl-6 space-y-2 mb-4">
          <li className="leading-relaxed">
            <strong>Directly from you.</strong> Every consumer-health category above is data you
            enter into the app yourself — typing, tapping, picking dates, uploading photos, or
            chatting with the AI coach. LeanShot does not buy, scrape, or import consumer health
            data from data brokers, ad networks, electronic health record systems, pharmacies,
            wearables, or any other source.
          </li>
          <li className="leading-relaxed">
            <strong>Derived from your inputs.</strong> Pharmacology curves, weekly averages,
            insights, streaks, and AI coach summaries are computed from data you provided. No
            consumer health data is purchased, inferred from third-party trackers, or fingerprinted
            from your device.
          </li>
          <li className="leading-relaxed">
            <strong>Operational metadata from your device.</strong> Sign-in timestamps, the offline
            write queue, audit-log entries, and rate-limit counters are generated automatically when
            you use the app. These items are operational and are flagged as non-consumer-health data
            above.
          </li>
        </ul>

        {/* §3 — Categories shared */}
        <h2 className="text-xl font-semibold mt-8 mb-3">
          Categories of consumer health data we share
        </h2>
        <p className="leading-relaxed mb-3">
          We do <strong>not</strong> sell consumer health data. RCW 19.373.030 requires a written
          authorization before any sale of CHD; we have no commercial reason to sell it and have
          authorized no third party to sell it on our behalf. No &ldquo;signed authorization to
          sell&rdquo; form exists because the practice does not exist.
        </p>
        <p className="leading-relaxed mb-3">
          We <strong>share</strong> the following categories with the processors named in §4
          strictly to operate the app:
        </p>
        <ul className="list-disc pl-6 space-y-2 mb-4">
          <li className="leading-relaxed">
            All categories of consumer health data listed above are stored on our behalf by our
            database and storage processor (Supabase). Photos are stored as image bytes in Storage;
            all other categories are stored as rows in Postgres tables protected by per-user
            row-level security.
          </li>
          <li className="leading-relaxed">
            AI coach conversation history and any consumer health data you type into a coach prompt
            are transmitted to our LLM inference processor (Moonshot AI) on a per-request basis
            through our server-side ai-chat Edge Function, which generates the coach response. We
            send only the active conversation — we do not bulk-export your data to the LLM provider,
            and the provider is not authorized to train on your inputs.
          </li>
          <li className="leading-relaxed">
            Bounded product-analytics events (for example, &ldquo;user opened the medication
            tab&rdquo;) are sent to PostHog. PostHog receives event names, timestamps, and a stable
            pseudonymous user identifier. PostHog does <strong>not</strong> receive injection logs,
            weights, measurements, photos, symptoms, AI conversation content, or any free-text
            field.
          </li>
          <li className="leading-relaxed">
            Application error reports are sent to Sentry when the app crashes or hits a handled
            error. Sentry receives an error stack trace, the app version, and a pseudonymous session
            identifier. We strip personal identifiers and free-text fields before transmission;
            Sentry does not receive consumer health data fields, photos, or AI conversation content.
          </li>
          <li className="leading-relaxed">
            The hosting provider for the marketing site and the SPA shell (Vercel) sees standard
            HTTP request metadata (IP address, user agent, request path) at the edge. Consumer
            health data is never sent through Vercel — the SPA talks directly to Supabase and to the
            ai-chat Edge Function from your browser.
          </li>
        </ul>

        {/* §4 — Third parties */}
        <h2 className="text-xl font-semibold mt-8 mb-3">
          Third parties and affiliates with whom we share consumer health data
        </h2>
        <p className="leading-relaxed mb-3">
          LeanShot has no affiliates. We share consumer health data with the following third-party
          processors, each acting on our written instructions:
        </p>
        <ul className="list-disc pl-6 space-y-2 mb-4">
          <li className="leading-relaxed">
            <strong>Supabase Inc.</strong> — managed Postgres database, authentication, and object
            storage. Receives all categories of consumer health data listed in §1. Subject to
            Supabase&apos;s published security controls (encryption in transit and at rest,
            row-level security enforcing per-user isolation). Free-tier Supabase Storage is not
            covered by a HIPAA Business Associate Agreement; LeanShot is not a HIPAA covered entity
            (see <em>Important context</em> below).
          </li>
          <li className="leading-relaxed">
            <strong>Moonshot AI Ltd.</strong> — the upstream large-language-model inference provider
            for our AI coach. Receives only the text of the active coach conversation when you
            actively chat with the coach, routed through our server-side ai-chat Edge Function so
            your browser never holds an LLM API key. Subject to Moonshot&apos;s terms of service. We
            do not authorize Moonshot to train models on your data.
          </li>
          <li className="leading-relaxed">
            <strong>PostHog Inc.</strong> — bounded product analytics. Receives event names,
            timestamps, and a pseudonymous user identifier. Does <strong>not</strong> receive
            consumer health data fields, free-text notes, photos, or AI conversation content.
          </li>
          <li className="leading-relaxed">
            <strong>Functional Software, Inc. d/b/a Sentry</strong> — application error monitoring.
            Receives error stack traces, app version, and a pseudonymous session identifier. Does{' '}
            <strong>not</strong> receive consumer health data fields, photos, or AI conversation
            content; we strip user identifiers and free-text before transmission.
          </li>
          <li className="leading-relaxed">
            <strong>Vercel Inc.</strong> — static hosting and edge functions for the marketing site
            and SPA shell. Sees HTTP request metadata only; consumer health data does not transit
            Vercel servers.
          </li>
        </ul>
        <p className="leading-relaxed mb-4">
          We do not share consumer health data with advertisers, data brokers, insurers, employers,
          government agencies (except as required by valid legal process), or any other third party
          not named above.
        </p>

        {/* §5 — Rights mechanism */}
        <h2 className="text-xl font-semibold mt-8 mb-3">
          How Washington residents exercise their rights
        </h2>
        <p className="leading-relaxed mb-3">
          RCW 19.373.040 gives consumers in Washington the right to (a) confirm whether we collect,
          share, or sell their consumer health data, (b) access a copy of that data, (c) withdraw
          consent to its collection and sharing, and (d) have it deleted. The My Health My Data Act
          also provides a <strong>private right of action</strong> — Washington residents can sue us
          directly under the Washington Consumer Protection Act if we violate this notice (see RCW
          19.373.900).
        </p>
        <p className="leading-relaxed mb-3">
          You can exercise these rights yourself, immediately, from inside the app:
        </p>
        <ul className="list-disc pl-6 space-y-2 mb-4">
          <li className="leading-relaxed">
            <strong>Confirm and access.</strong> Open <em>Settings → Data → Export</em> to download
            a complete copy of every data category listed above, in JSON plus a human-readable PDF.
          </li>
          <li className="leading-relaxed">
            <strong>Withdraw consent.</strong> Stop using the app at any time. Local logs stay on
            your device until you clear them, and cloud sync pauses automatically the moment you
            sign out from <em>Settings → Account → Sign out</em>.
          </li>
          <li className="leading-relaxed">
            <strong>Delete.</strong> Open <em>Settings → Account → Delete my account</em>, type the
            confirmation phrase, and confirm. We mark the account deleted immediately, sign you out
            of every session, and move your photos to a locked location. You have a 30-day window in
            which you can email us to undo the deletion. After 30 days, the per-user encryption key
            for your data is destroyed, every row of your consumer health data is cascade-deleted,
            and your photos are permanently erased — that operation is irreversible by design. If
            you sign up again with the same email during the 30-day window, that is treated as a
            brand-new account; your prior data remains pending shred and is not restored.
          </li>
          <li className="leading-relaxed">
            <strong>Appeal.</strong> If you believe we have not honored a rights request, email{' '}
            <a
              href="mailto:privacy@leanshot.app"
              className="underline hover:no-underline focus-visible:no-underline"
            >
              privacy@leanshot.app
            </a>{' '}
            with the subject &ldquo;WMHMDA appeal&rdquo;. We will respond within 45 days.
          </li>
        </ul>

        {/* Important context */}
        <h2 className="text-xl font-semibold mt-8 mb-3">Important context</h2>
        <ul className="list-disc pl-6 space-y-2 mb-4">
          <li className="leading-relaxed">
            LeanShot is <strong>not</strong> a HIPAA covered entity and is <strong>not</strong> your
            medical provider. Our service is consumer-directed wellness tracking; you should bring
            questions about your treatment to your prescribing clinician.
          </li>
          <li className="leading-relaxed">
            We do not <strong>sell</strong> consumer health data and we have not authorized any
            third party to sell it on our behalf.
          </li>
          <li className="leading-relaxed">
            We apply data minimization: every field listed in §1 is data you explicitly chose to
            enter. We do not silently collect consumer health data from your device sensors, browser
            fingerprint, third-party trackers, or any external source.
          </li>
          <li className="leading-relaxed">
            <strong>Encryption.</strong> Consumer health data is encrypted in transit (TLS) between
            your browser and Supabase, and at rest in Supabase Postgres and Storage. Per-user
            row-level security policies prevent any other LeanShot user from accessing your rows.
          </li>
          <li className="leading-relaxed">
            <strong>Retention.</strong> Consumer health data is retained until you delete your
            account. After deletion plus the 30-day undo window, your data is unrecoverable. A
            skeleton audit row (timestamp plus irreversibly hashed user identifier and IP) is
            retained indefinitely to comply with breach-investigation and incident-response
            obligations under the FTC Health Breach Notification Rule. The skeleton never contains
            plaintext consumer health data.
          </li>
        </ul>

        {/* Contact */}
        <h2 className="text-xl font-semibold mt-8 mb-3">Contact</h2>
        <p className="leading-relaxed mb-4">
          Questions, rights requests, or appeals:{' '}
          <a
            href="mailto:privacy@leanshot.app"
            className="underline hover:no-underline focus-visible:no-underline"
          >
            privacy@leanshot.app
          </a>
          .
        </p>
        <p className="text-[12px] text-[var(--color-text-tertiary)] mb-2">
          This notice is published pursuant to RCW 19.373.030. Primary source:{' '}
          <a
            href="https://app.leg.wa.gov/RCW/default.aspx?cite=19.373&full=true"
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:no-underline focus-visible:no-underline"
          >
            Washington Revised Code 19.373
          </a>
          .
        </p>
      </article>
    </LegalLayout>
  );
}

export default ConsumerHealthData;
