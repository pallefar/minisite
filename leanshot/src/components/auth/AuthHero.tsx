/**
 * Phase 13 Plan 13-04 — AuthHero: decorative hero column for the split-screen auth view.
 *
 * Visual contract (login.css / login.jsx in design bundle):
 *   - Dark-teal gradient backdrop (`--color-hero-bg` → `…-bg-2` → `…-bg-3`)
 *   - LoginHero illustration centered behind content
 *   - Brand wordmark top-left (Zap mark + "LeanShot")
 *   - Eyebrow + headline with Fraunces italic accent + sub-copy
 *   - Trust strip (lock / shield / check) below headline
 *   - Glassmorphic testimonial card pinned bottom-right
 *
 * a11y: the entire aside is `aria-hidden="true"` — it's a decorative marketing
 * panel, not navigable content. The escape-hatch "Back to LeanShot home"
 * button lives in AuthFormShell so it stays reachable at <md viewports where
 * this aside is hidden via `hidden md:flex`.
 */
import { Check, Lock, Shield, Zap } from 'lucide-react';
import { LoginHero } from '@/illustrations/LoginHero';

export function AuthHero() {
  return (
    <aside
      aria-hidden="true"
      className="hidden md:flex relative h-screen overflow-hidden p-12 flex-col bg-[linear-gradient(135deg,var(--color-hero-bg)_0%,var(--color-hero-bg-2)_50%,var(--color-hero-bg-3)_100%)] text-white"
    >
      {/* Decorative hero illustration — sits behind the content layer */}
      <LoginHero className="absolute right-[-120px] top-1/2 -translate-y-1/2 w-[720px] h-[720px] opacity-85 pointer-events-none" />

      {/* Brand wordmark (visual only — real escape-hatch lives in AuthFormShell) */}
      <div className="relative inline-flex items-center gap-2 text-[20px] font-extrabold tracking-tight">
        <span className="size-7 rounded-lg bg-white/15 inline-flex items-center justify-center">
          <Zap className="size-4" strokeWidth={2.6} />
        </span>
        LeanShot
      </div>

      {/* Headline block — pushed toward the testimonial via mt-auto */}
      <div className="relative mt-auto max-w-[36ch]">
        <p className="text-[11px] tracking-[0.18em] uppercase opacity-70 font-medium">
          Clinical GLP-1 tracking
        </p>
        <h1 className="mt-3 font-sans font-extrabold tracking-tight text-[clamp(36px,4vw,56px)] leading-[1.02]">
          Your treatment.{' '}
          <span className="font-display font-light italic text-white/90">One place.</span>
        </h1>
        <p className="mt-[22px] text-base leading-[1.55] opacity-80">
          Track doses, body metrics, food, activity, and mood — then share a clean picture with
          your doctor or coach.
        </p>

        {/* Trust strip */}
        <ul className="mt-6 flex flex-wrap gap-x-5 gap-y-2 text-[13px] opacity-85">
          <li className="inline-flex items-center gap-1.5">
            <Lock className="size-4" aria-hidden="true" />
            Local-only data
          </li>
          <li className="inline-flex items-center gap-1.5">
            <Shield className="size-4" aria-hidden="true" />
            No third-party analytics
          </li>
          <li className="inline-flex items-center gap-1.5">
            <Check className="size-4" aria-hidden="true" />
            Open data export
          </li>
        </ul>
      </div>

      {/* Testimonial card — pinned bottom-right with glass blur */}
      <figure className="absolute right-12 bottom-12 max-w-[260px] px-4 py-3.5 rounded-2xl bg-white/[0.08] border border-white/15 backdrop-blur-[14px] text-white">
        <blockquote className="text-[13px] leading-[1.5] opacity-95">
          “Finally a tracker that knows the difference between a half-life and a streak.”
        </blockquote>
        <figcaption className="mt-2.5 flex items-center gap-2 text-[11px] opacity-75">
          <span className="size-6 rounded-full bg-white/20 inline-flex items-center justify-center font-semibold">
            K
          </span>
          <span>
            Karsten B. — Mounjaro · <span className="opacity-80">14 weeks</span>
          </span>
        </figcaption>
      </figure>
    </aside>
  );
}
