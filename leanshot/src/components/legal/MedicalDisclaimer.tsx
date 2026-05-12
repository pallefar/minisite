// Phase 7 Plan 07-04 (COMPL-01) — Medical Disclaimer for v1 broad launch.
//
// Self-drafted under CONTEXT D-01 (LOCKED): no attorney engagement.
//
// Paragraph 1 BYTE-REPLICATES the Phase 2 DisclaimerModal "Not medical advice"
// copy from src/components/dashboard/DisclaimerModal.tsx:18-22 — verbatim, so
// a defense attorney cannot exploit a wording gap between the legal page and
// the in-product overlay (mitigates threat T1-LEGAL).
//
// Paragraph 2 from the original Phase 2 modal ("Your data stays on this
// device unless you choose to sync. We do not share your health data with
// third parties") was accurate pre-cloud-sync but became factually misleading
// when Phase 6 shipped cloud sync. The IN-APP overlay drift is flagged for a
// follow-up cleanup (07-04 SUMMARY tracks it); the LEGAL page (litigation-
// relevant surface) is corrected immediately below.

import { LegalLayout } from './LegalLayout';

const EFFECTIVE_DATE = '2026-05-12';

export function MedicalDisclaimer() {
  return (
    <LegalLayout title="Medical Disclaimer">
      <article className="max-w-[760px] mx-auto px-1 py-2 space-y-6 text-[14px] text-[var(--color-text)] leading-relaxed">
        {/* 07-02 spec contract: data-todo marker names the authoring plan. */}
        <div data-todo="07-04" hidden />
        {/* Header */}
        <header className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Medical Disclaimer</h1>
          <p className="text-[13px] text-[var(--color-text-tertiary)]">
            Effective date: {EFFECTIVE_DATE}
          </p>
        </header>

        {/* Verbatim Phase 2 paragraph 1 (byte-replicated from DisclaimerModal.tsx:18-22) */}
        <p className="text-[14px] text-[var(--color-text)] leading-relaxed">
          <strong>Not medical advice.</strong> LeanShot helps you track GLP-1 medications, body
          metrics, food, activity, and symptoms. The drug-level chart shows a modeled estimate based
          on population pharmacokinetics — not a measured serum level. Always consult your
          healthcare provider for clinical decisions.
        </p>

        {/* Updated paragraph 2 (replaces Phase 2's now-misleading sentence). */}
        <p className="text-[14px] text-[var(--color-text-secondary)] leading-relaxed">
          Your data is encrypted at rest with Supabase as our data processor. We do not sell your
          health data. The processors we share data with are listed in our{' '}
          <a
            href="#/legal/privacy"
            className="underline decoration-1 underline-offset-2 hover:no-underline focus-visible:no-underline"
          >
            Privacy Policy
          </a>
          .
        </p>

        {/* § GLP-1 guidance is informational */}
        <section className="space-y-3">
          <h2 className="text-[18px] font-semibold mt-8 mb-3">§ GLP-1 guidance is informational</h2>
          <p>
            The titration schedule, dose-rotation reminders, and injection-site cycling suggestions
            shown in LeanShot are based on publicly available manufacturer labeling and general
            GLP-1 clinical guidance. They are NOT prescribing instructions. Your clinician has the
            authority on dosage, frequency, and titration — follow their guidance over
            LeanShot&apos;s defaults.
          </p>
        </section>

        {/* § PK chart is an estimate, not a dose recommendation */}
        <section className="space-y-3">
          <h2 className="text-[18px] font-semibold mt-8 mb-3">
            § PK chart is an estimate, not a dose recommendation
          </h2>
          <p>
            The drug-level projection chart in the Medication tab is generated from a
            population-pharmacokinetics model (literature-derived half-lives and absorption
            constants for semaglutide, tirzepatide, and related peptides). It estimates an average
            patient&apos;s drug level given the doses you have logged. It is NOT a measured serum
            concentration, it does NOT account for your individual metabolism or body composition,
            and it MUST NOT be used to decide whether to take or skip a dose. The chart&apos;s
            purpose is visualization — to help you see your dosing pattern over time — not clinical
            decision-making.
          </p>
        </section>

        {/* § AI coach is rule-based + AI-assisted, NOT a clinician */}
        <section className="space-y-3">
          <h2 className="text-[18px] font-semibold mt-8 mb-3">
            § AI coach is rule-based + AI-assisted, NOT a clinician
          </h2>
          <p>
            LeanShot&apos;s AI coach combines deterministic rule-based insights (generated from your
            data on the client) with optional AI-assisted responses (routed via Vercel AI Gateway to
            Moonshot&apos;s Kimi K2 model). The AI coach: (a) is not a licensed healthcare provider,
            (b) does not have access to your medical history beyond what you have logged in the app,
            (c) may produce factually inaccurate or out-of-date information (large language models
            hallucinate), and (d) MUST NOT be used as a substitute for talking to your clinician,
            your pharmacist, or your therapist about any health concern, dose question, side effect,
            or change in symptoms.
          </p>
        </section>

        {/* § Consult your healthcare provider */}
        <section className="space-y-3">
          <h2 className="text-[18px] font-semibold mt-8 mb-3">
            § Consult your healthcare provider
          </h2>
          <p>
            For any clinical decision — including whether to take or skip a dose, adjust your
            titration schedule, manage side effects, or address new symptoms — consult your
            clinician, pharmacist, or other licensed healthcare provider. If you experience a
            medical emergency, call your local emergency number (911 in the US) or go to the nearest
            emergency department. LeanShot is not designed to detect or alert on medical
            emergencies.
          </p>
        </section>

        {/* § Contact */}
        <section className="space-y-3">
          <h2 className="text-[18px] font-semibold mt-8 mb-3">§ Contact</h2>
          <p>
            Questions about this disclaimer: karsten.haldan@gmail.com. See also our{' '}
            <a
              href="#/legal/privacy"
              className="underline decoration-1 underline-offset-2 hover:no-underline focus-visible:no-underline"
            >
              Privacy Policy
            </a>{' '}
            and{' '}
            <a
              href="#/legal/terms"
              className="underline decoration-1 underline-offset-2 hover:no-underline focus-visible:no-underline"
            >
              Terms of Service
            </a>
            .
          </p>
        </section>
      </article>
    </LegalLayout>
  );
}

export default MedicalDisclaimer;
