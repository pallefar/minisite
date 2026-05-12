// Phase 7 Plan 07-04 (COMPL-01) — Terms of Service for v1 broad launch.
//
// Self-drafted under CONTEXT D-01 (LOCKED): no attorney engagement.
// Source skeleton: Termly free-tier ToS generator, surgically edited to match
// LeanShot's no-covered-entity posture and the verbatim "Not medical advice"
// cross-reference required by threat T1-LEGAL.
//
// CRITICAL — no language that would push LeanShot into HIPAA covered-entity
// status. Per plan threat T2-LEGAL, this file MUST NOT contain phrases like
// "we provide medical advice", "FDA-approved", "clinically validated",
// "diagnose", "prescribe", "monitor your treatment", "cure", or "treat".
// The plan's `done` grep gate asserts these phrases are ABSENT.
//
// Governing law: Washington State (planner decision under D-01 discretion).
// Rationale lives inside § Governing law below.

import { LegalLayout } from './LegalLayout';

const EFFECTIVE_DATE = '2026-05-12';

export function TermsOfService() {
  return (
    <LegalLayout title="Terms of Service">
      <article className="max-w-[760px] mx-auto px-1 py-2 space-y-6 text-[14px] text-[var(--color-text)] leading-relaxed">
        {/* 07-02 spec contract: data-todo marker names the authoring plan. */}
        <div data-todo="07-04" hidden />
        {/* Header */}
        <header className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Terms of Service</h1>
          <p className="text-[13px] text-[var(--color-text-tertiary)]">
            Effective date: {EFFECTIVE_DATE}
          </p>
        </header>

        {/* § Service description */}
        <section className="space-y-3">
          <h2 className="text-[18px] font-semibold mt-8 mb-3">§ Service description</h2>
          <p>
            LeanShot is a web app that lets people on GLP-1 medications track injections, body
            metrics, food, activity, mood, symptoms, sleep, and progress photos, and visualize a
            drug-level projection — a population-pharmacokinetics estimate, NOT a measured serum
            level. LeanShot is an educational and personal-tracking tool. We are not a medical
            device, a healthcare provider, or a licensed clinic. LeanShot is not currently a HIPAA
            covered entity.
          </p>
        </section>

        {/* § Account */}
        <section className="space-y-3">
          <h2 className="text-[18px] font-semibold mt-8 mb-3">§ Account</h2>
          <p>
            To use LeanShot, you may create a free account. You are responsible for keeping your
            account credentials confidential. We use Supabase Auth as our authentication processor.
            You may delete your account at any time from Settings → Privacy → Delete account.
          </p>
        </section>

        {/* § Acceptable use */}
        <section className="space-y-3">
          <h2 className="text-[18px] font-semibold mt-8 mb-3">§ Acceptable use</h2>
          <ul className="list-disc pl-5 space-y-1.5 text-[var(--color-text-secondary)]">
            <li>
              Use LeanShot for personal health tracking; do not use it as a substitute for licensed
              medical care.
            </li>
            <li>
              Do not attempt to access another user&apos;s data, reverse-engineer the application,
              or interfere with other users&apos; use of the service.
            </li>
            <li>Do not upload illegal content.</li>
            <li>
              Do not represent yourself as a medical professional providing care via LeanShot — the
              AI coach is not a clinician (see § Disclaimer of medical advice below).
            </li>
          </ul>
        </section>

        {/* § Disclaimer of medical advice */}
        <section className="space-y-3">
          <h2 className="text-[18px] font-semibold mt-8 mb-3">§ Disclaimer of medical advice</h2>
          <p>
            <strong>Not medical advice.</strong> LeanShot does not provide medical advice,
            diagnosis, or treatment. The drug-level chart, the AI coach, the dose-titration
            scheduler, and any insight or suggestion shown in the app are educational and
            informational only. See our{' '}
            <a
              href="#/legal/disclaimer"
              className="underline decoration-1 underline-offset-2 hover:no-underline focus-visible:no-underline"
            >
              full Medical Disclaimer
            </a>{' '}
            for details on the pharmacokinetics model, AI coach limitations, and our reminder to
            consult your prescriber for clinical decisions.
          </p>
        </section>

        {/* § Limitation of liability */}
        <section className="space-y-3">
          <h2 className="text-[18px] font-semibold mt-8 mb-3">§ Limitation of liability</h2>
          <p>
            TO THE MAXIMUM EXTENT PERMITTED BY LAW, LEANSHOT AND ITS OPERATORS ARE NOT LIABLE FOR
            ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES ARISING FROM YOUR
            USE OF THE APP. WE PROVIDE THE APP ON AN &ldquo;AS-IS&rdquo; BASIS WITHOUT WARRANTIES OF
            ANY KIND, EXPRESS OR IMPLIED. THIS LIMITATION DOES NOT APPLY TO LIABILITY THAT CANNOT BE
            EXCLUDED BY LAW (E.G., WMHMDA&apos;S PRIVATE RIGHT OF ACTION FOR CONSUMER- HEALTH-DATA
            VIOLATIONS UNDER RCW 19.373).
          </p>
          <p className="text-[13px] text-[var(--color-text-tertiary)] italic">
            The WMHMDA carve-out is intentional. You cannot disclaim a statute, and
            Washington&apos;s Consumer Health Data Privacy Act provides a private right of action
            that survives any contractual limitation.
          </p>
        </section>

        {/* § Termination */}
        <section className="space-y-3">
          <h2 className="text-[18px] font-semibold mt-8 mb-3">§ Termination</h2>
          <p>
            You may terminate your use of LeanShot at any time by deleting your account from
            Settings → Privacy → Delete account. We may suspend or terminate your account if you
            materially violate these Terms (for example, attempts to compromise other users&apos;
            data or to misrepresent yourself as a clinician within the app). On termination, the
            data-deletion procedure described in our{' '}
            <a
              href="#/legal/privacy"
              className="underline decoration-1 underline-offset-2 hover:no-underline focus-visible:no-underline"
            >
              Privacy Policy § How long we retain
            </a>{' '}
            applies — a 30-day undo window followed by hard deletion.
          </p>
        </section>

        {/* § Governing law */}
        <section className="space-y-3">
          <h2 className="text-[18px] font-semibold mt-8 mb-3">§ Governing law</h2>
          <p>
            These Terms are governed by the laws of the State of Washington, USA, without regard to
            its conflict-of-law principles. Disputes shall be resolved in the state or federal
            courts located in King County, Washington.
          </p>
          <p>
            Washington was chosen as the governing-law jurisdiction because Washington&apos;s
            Consumer Health Data Privacy Act (RCW 19.373) sets the highest disclosure bar applicable
            to our product, and aligning the governing law with the strictest applicable
            consumer-health-data jurisdiction reflects our compliance posture. The operator&apos;s
            physical location is not relevant for v1 broad launch; when entity formation happens,
            these Terms may be updated.
          </p>
        </section>

        {/* § Contact */}
        <section className="space-y-3">
          <h2 className="text-[18px] font-semibold mt-8 mb-3">§ Contact</h2>
          <p>Questions: karsten.haldan@gmail.com.</p>
        </section>
      </article>
    </LegalLayout>
  );
}

export default TermsOfService;
