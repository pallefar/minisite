// Phase 7 Plan 07-04 (COMPL-01) — Terms of Service for v1 broad launch.
// Phase 64 Plan 04 (LEGAL-08) — Extended with community UGC content-license,
//   Community Rules, and DMCA takedown cross-reference.
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
const LAST_UPDATED = '2026-05-27';

export function TermsOfService() {
  return (
    <LegalLayout title="Terms of Service">
      <article className="max-w-[760px] mx-auto px-1 py-2 space-y-6 text-[14px] text-[var(--color-text)] leading-relaxed">
        {/* 07-02 spec contract: data-todo marker names the authoring plan. */}
        <div data-todo="07-04" hidden />

        {/* Phase 64 Plan 04 — "Last updated" banner */}
        <div
          className="rounded-lg p-4 bg-[var(--color-warning-soft)] border border-[var(--color-border)]"
          role="note"
          aria-label="Terms update notice"
        >
          <p className="text-[13px] text-[var(--color-text)]">
            <strong>Last updated:</strong> {LAST_UPDATED} ·{' '}
            <strong>What changed:</strong> Added Community Content &amp; User-Generated Content
            section (LEGAL-08), Community Rules, and DMCA takedown cross-reference.
          </p>
        </div>

        {/* Header */}
        <header className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Terms of Service</h1>
          <p className="text-[13px] text-[var(--color-text-tertiary)]">
            Effective date: {EFFECTIVE_DATE}
          </p>
          <p className="text-[13px] text-[var(--color-text-tertiary)]">
            Last updated: {LAST_UPDATED}
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
          <ul className="list-disc ps-5 space-y-1.5 text-[var(--color-text-secondary)]">
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
            applies — a 7-day undo window followed by hard deletion.
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

        {/* ============================================================
            Phase 64 Plan 04 — COMMUNITY UGC SECTION (LEGAL-08)
            Content license + Community Rules + DMCA cross-reference.
            T-64-04-04: draft disclaimer at section top.
            Typography: text-[18px]/600 h2, text-[13px]/400 body,
                        text-[11px]/400 meta — within UI-SPEC ceiling.
            ============================================================ */}

        {/* § Community Content & User-Generated Content */}
        <section id="community-ugc" className="mt-12 pt-8 border-t border-[var(--color-border)] space-y-4">
          <h2 className="text-[18px] font-semibold">
            Community Content &amp; User-Generated Content
          </h2>
          <em className="block text-[13px] text-[var(--color-text-secondary)]">
            This UGC section is in draft pending legal counsel review (Phase 70 UAT).
          </em>

          {/* Content license */}
          <div className="space-y-3">
            <h3 className="text-[13px] font-semibold text-[var(--color-text)]">Content license</h3>
            <p className="text-[13px] text-[var(--color-text-secondary)]">
              You retain ownership of any content you post in LeanShot Community Spaces (posts,
              replies, images, and other contributions — collectively, &ldquo;User Content&rdquo;).
              By posting User Content, you grant LeanShot a non-exclusive, worldwide, royalty-free,
              sublicensable license to host, display, reproduce, and distribute your User Content
              solely for the purpose of operating and improving the Community Spaces feature. This
              license is limited to the minimum necessary to provide the service.
            </p>
            <p className="text-[13px] text-[var(--color-text-secondary)]">
              This license terminates when you delete your User Content or your account, subject to
              reasonable propagation delays and any legal retention obligations. Deleted content will
              be removed from active display within 24 hours of deletion; backup propagation may
              take up to 30 days.
            </p>
          </div>

          {/* Community Rules cross-link */}
          <div className="space-y-3">
            <h3 className="text-[13px] font-semibold text-[var(--color-text)]">Community Rules</h3>
            <p className="text-[13px] text-[var(--color-text-secondary)]">
              All Community Spaces content is subject to our{' '}
              <a
                href="#community-rules"
                className="underline decoration-1 underline-offset-2"
              >
                Community Rules
              </a>{' '}
              below. Violations may result in content removal, account warnings, or account
              suspension.
            </p>
          </div>

          {/* DMCA cross-reference */}
          <div className="space-y-3">
            <h3 className="text-[13px] font-semibold text-[var(--color-text)]">
              Copyright takedown (DMCA)
            </h3>
            <p className="text-[13px] text-[var(--color-text-secondary)]">
              For copyright takedown notices, see our{' '}
              <a
                href="#/legal/dmca"
                className="underline decoration-1 underline-offset-2"
              >
                DMCA page
              </a>
              . We respond to valid DMCA takedown requests within 14 business days. Counter-notice
              procedures are described on the DMCA page.
            </p>
          </div>

          {/* Moderation rights reservation */}
          <div className="space-y-3">
            <h3 className="text-[13px] font-semibold text-[var(--color-text)]">
              Moderation rights
            </h3>
            <p className="text-[13px] text-[var(--color-text-secondary)]">
              LeanShot reserves the right to review, remove, or restrict access to any User Content
              that violates these Terms, our Community Rules, or applicable law. We may suspend or
              terminate accounts of users who repeatedly violate these Terms. We are not obligated to
              review all User Content but may do so at our discretion.
            </p>
          </div>
        </section>

        {/* § Community Rules (anchored sub-section per LEGAL-08) */}
        <section
          id="community-rules"
          className="mt-8 pt-6 border-t border-[var(--color-border)] space-y-4"
        >
          <h2 className="text-[18px] font-semibold">Community Rules</h2>
          <em className="block text-[13px] text-[var(--color-text-secondary)]">
            This section is in draft pending legal counsel review (Phase 70 UAT).
          </em>
          <p className="text-[13px] text-[var(--color-text-secondary)]">
            To keep the LeanShot community safe and supportive, the following rules apply to all
            Community Spaces content:
          </p>
          <ul className="list-disc ps-5 space-y-1.5 text-[13px] text-[var(--color-text-secondary)]">
            <li>
              <strong className="text-[var(--color-text)]">No medical advice to others.</strong>{' '}
              Do not post content that constitutes medical advice, diagnosis, or treatment
              recommendations directed at other users or third parties.
            </li>
            <li>
              <strong className="text-[var(--color-text)]">No protected health information.</strong>{' '}
              Do not share identifiable health information about third parties (family members,
              friends, or other patients) without their explicit consent.
            </li>
            <li>
              <strong className="text-[var(--color-text)]">No harassment or hate speech.</strong>{' '}
              Do not harass, threaten, or demean other users. Content targeting individuals or
              groups on the basis of race, gender, religion, disability, or other protected
              characteristics is prohibited.
            </li>
            <li>
              <strong className="text-[var(--color-text)]">No spam or self-promotion.</strong>{' '}
              Do not post unsolicited commercial messages, affiliate links, or repetitive content
              designed to promote external products or services.
            </li>
            <li>
              <strong className="text-[var(--color-text)]">No impersonation.</strong> Do not
              impersonate LeanShot staff, healthcare professionals, or other users.
            </li>
            <li>
              <strong className="text-[var(--color-text)]">Stay on topic.</strong> Keep posts
              relevant to GLP-1 treatment tracking, health journeys, and related topics. Off-topic
              content may be removed without notice.
            </li>
            <li>
              <strong className="text-[var(--color-text)]">No illegal activity.</strong> Do not
              post content that promotes or facilitates illegal activity, including but not limited
              to the unauthorized sale or distribution of prescription medications.
            </li>
            <li>
              <strong className="text-[var(--color-text)]">Respect copyright.</strong> Do not post
              copyrighted material (text, images, video) without the permission of the copyright
              holder or a valid fair-use basis. For takedown requests, see our{' '}
              <a
                href="#/legal/dmca"
                className="underline decoration-1 underline-offset-2"
              >
                DMCA page
              </a>
              .
            </li>
          </ul>
          <p className="text-[11px] text-[var(--color-text-tertiary)]">
            Rule violations can be reported via the in-app report button on each post, or by
            emailing{' '}
            <a
              href="mailto:privacy@leanshot.app?subject=[Community Report]"
              className="underline decoration-1 underline-offset-2"
            >
              privacy@leanshot.app
            </a>
            .
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
