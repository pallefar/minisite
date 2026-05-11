import { motion } from 'framer-motion';
import {
  ArrowRight,
  Sun,
  Moon,
  Check,
  Zap,
  Brain,
  ChartLine,
  Sparkles,
  ChevronDown,
  Shield,
  Lock,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Button, IconButton } from '@/components/ui/Button';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { useTheme } from '@/hooks/useTheme';
import { AIAvatar } from '@/illustrations/AIAvatar';
import { ConnectData } from '@/illustrations/ConnectData';
import { HeroOrbital } from '@/illustrations/HeroOrbital';

interface LandingProps {
  onStart: () => void;
}

export function Landing({ onStart }: LandingProps) {
  const { theme, toggle } = useTheme();
  return (
    <div className="min-h-screen bg-[var(--color-bg)] overflow-x-hidden">
      <Nav theme={theme} toggle={toggle} onStart={onStart} />
      <Hero onStart={onStart} />
      <Features />
      <Testimonials />
      <Pricing onStart={onStart} />
      <FAQ />
      <Footer />
    </div>
  );
}

function Nav({
  theme,
  toggle,
  onStart,
}: {
  theme: 'light' | 'dark';
  toggle: () => void;
  onStart: () => void;
}) {
  return (
    <nav className="max-w-[1200px] mx-auto px-5 py-4 flex items-center justify-between">
      <div className="flex items-center gap-2 text-[20px] font-extrabold tracking-tight text-[var(--color-primary)]">
        <span className="size-7 rounded-lg bg-[var(--color-primary)] text-[var(--color-primary-foreground)] inline-flex items-center justify-center">
          <Zap className="size-4" strokeWidth={2.6} />
        </span>
        LeanShot
      </div>
      <div className="flex items-center gap-2">
        <IconButton
          aria-label={theme === 'light' ? 'Dark mode' : 'Light mode'}
          variant="ghost"
          size="sm"
          onClick={toggle}
        >
          {theme === 'light' ? <Moon className="size-5" /> : <Sun className="size-5" />}
        </IconButton>
        <Button onClick={onStart} size="sm" trailingIcon={<ArrowRight className="size-4" />}>
          Get started
        </Button>
      </div>
    </nav>
  );
}

function Hero({ onStart }: { onStart: () => void }) {
  return (
    <section className="relative px-5 pt-12 pb-24 md:pt-20 md:pb-32 max-w-[1200px] mx-auto">
      <div className="grid md:grid-cols-2 gap-10 md:gap-16 items-center">
        <div className="motion-safe:animate-rise">
          <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-pill bg-[var(--color-primary-soft)] text-[var(--color-primary)] text-[12px] font-semibold border border-[var(--color-primary-soft)]">
            <Zap className="size-3.5" /> Built for serious GLP-1 users
          </span>
          <h1 className="mt-5 text-[clamp(38px,6vw,72px)] font-extrabold leading-[0.96] tracking-[-0.03em]">
            Maximize your{' '}
            <span className="font-display italic font-normal text-[var(--color-primary)]">
              GLP-1 journey.
            </span>
            <br />
            Lose fat. Keep muscle.
          </h1>
          <p className="mt-5 text-[16px] md:text-[17px] leading-relaxed text-[var(--color-text-secondary)] max-w-[44ch]">
            Clinical tracking for Ozempic, Wegovy, Mounjaro, and Zepbound. Med-level curves, vial
            supply, AI food logging, doctor reports, and an expert chat — all in one warm, calm
            place.
          </p>
          <div className="mt-7 flex gap-3 flex-wrap">
            <Button size="lg" onClick={onStart} trailingIcon={<ArrowRight className="size-4" />}>
              Start free
            </Button>
            <Button
              size="lg"
              variant="secondary"
              onClick={() =>
                document.getElementById('features')?.scrollIntoView({ behavior: 'smooth' })
              }
            >
              See features
            </Button>
          </div>
          <div className="mt-8 flex items-center gap-5 text-[13px] text-[var(--color-text-secondary)]">
            <span className="inline-flex items-center gap-1.5">
              <Lock className="size-4" /> Local-only data
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Check className="size-4" /> No card needed
            </span>
          </div>
        </div>
        <HeroVisual />
      </div>
    </section>
  );
}

/** Animated GLP-1 level curve as the hero centerpiece. */
function HeroVisual() {
  const reduced = useReducedMotion();
  const ref = useRef<SVGPathElement | null>(null);
  const [t, setT] = useState(0);

  useEffect(() => {
    if (reduced) {
      setT(1);
      return;
    }
    let raf = 0;
    const start = performance.now();
    const tick = (now: number): void => {
      const u = Math.min(1, (now - start) / 1600);
      setT(1 - Math.pow(1 - u, 4)); // ease-out-quart
      if (u < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [reduced]);

  // Bi-exponential curve: rapid rise + slow decay
  const points: { x: number; y: number }[] = [];
  for (let i = 0; i <= 64; i++) {
    const x = i;
    // peak around 8, then half-life decay
    const rise = 1 - Math.exp(-i / 4);
    const decay = Math.exp(-Math.max(0, i - 8) / 28);
    const y = rise * decay;
    points.push({ x, y });
  }
  const path = points
    .map((p, i) => {
      const x = (p.x / 64) * 320;
      const yPx = 180 - p.y * 140;
      return i === 0 ? `M${x},${yPx}` : `L${x},${yPx}`;
    })
    .join(' ');
  const visiblePath = path; // chart-line path
  // Length-based reveal via stroke-dashoffset
  const dashLen = 800;
  const offset = dashLen * (1 - t);

  return (
    <div className="relative motion-safe:animate-rise">
      <div className="relative aspect-square max-w-[440px] mx-auto rounded-[32px] bg-gradient-to-br from-[var(--color-hero-bg)] to-[var(--color-hero-bg-2)] shadow-hero overflow-hidden p-7">
        <div className="absolute inset-0 opacity-90">
          <HeroOrbital className="absolute -right-12 -top-12 w-[110%] h-[110%]" />
        </div>
        <div className="relative h-full flex flex-col justify-between text-white">
          <div>
            <p className="text-[12px] font-semibold uppercase tracking-[0.1em] opacity-80">
              GLP-1 LEVEL · 7-day
            </p>
            <p className="mt-1 text-[28px] font-bold leading-tight">
              Peak <span className="font-display italic font-normal opacity-90">→ trough</span>
            </p>
          </div>
          <svg viewBox="0 0 320 200" className="w-full h-32 self-end">
            <defs>
              <linearGradient id="hero-fill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="white" stopOpacity="0.32" />
                <stop offset="100%" stopColor="white" stopOpacity="0" />
              </linearGradient>
            </defs>
            <path d={`${visiblePath} L 320,180 L 0,180 Z`} fill="url(#hero-fill)" opacity={t} />
            <path
              ref={ref}
              d={visiblePath}
              fill="none"
              stroke="white"
              strokeWidth="2.4"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeDasharray={dashLen}
              strokeDashoffset={offset}
            />
            {/* Dose markers along the curve */}
            {[0, 32].map((x) => {
              const idx = ((x / 64) * points.length) | 0;
              const p = points[Math.min(points.length - 1, idx)];
              if (!p) return null;
              const cx = (p.x / 64) * 320;
              const cy = 180 - p.y * 140;
              return (
                <g key={x} opacity={Math.max(0, t * 1.2 - 0.5)}>
                  <circle cx={cx} cy={cy} r="6" fill="white" opacity="0.2" />
                  <circle cx={cx} cy={cy} r="3" fill="white" />
                </g>
              );
            })}
          </svg>
          <div className="grid grid-cols-3 gap-2 mt-4">
            {[
              { label: 'Half-life', val: '7d' },
              { label: 'Phase', val: 'Titration' },
              { label: 'Adherence', val: '92%' },
            ].map((s) => (
              <div
                key={s.label}
                className="rounded-xl bg-white/10 border border-white/15 px-3 py-2"
              >
                <div className="text-[10px] font-semibold uppercase tracking-[0.08em] opacity-70">
                  {s.label}
                </div>
                <div className="text-[15px] font-bold mt-0.5">{s.val}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function Features() {
  const features = [
    {
      Icon: ChartLine,
      title: 'Real pharmacology',
      body: 'Half-life curves modelled to your specific medication, not a generic line. Know peak vs trough.',
      Illustration: HeroOrbital,
    },
    {
      Icon: Brain,
      title: 'AI that knows your data',
      body: 'Context-aware coach that has read your week — not a generic LLM that makes up advice.',
      Illustration: AIAvatar,
    },
    {
      Icon: Sparkles,
      title: 'Doctor-ready in one tap',
      body: 'Auto-generated PDF summarizes your dose, sites, side effects, and trends. Bring it to every visit.',
      Illustration: ConnectData,
    },
  ];
  return (
    <section id="features" className="px-5 py-20 md:py-28 max-w-[1200px] mx-auto">
      <div className="text-center max-w-[640px] mx-auto mb-16">
        <h2 className="text-[clamp(28px,4vw,40px)] font-extrabold tracking-tight">
          What no other tracker{' '}
          <span className="font-display italic font-normal text-[var(--color-primary)]">does</span>
        </h2>
        <p className="text-[15px] text-[var(--color-text-secondary)] mt-3">
          Built around the science of GLP-1 — not retrofitted from a generic habit app.
        </p>
      </div>
      <div className="grid md:grid-cols-3 gap-5">
        {features.map(({ Icon, title, body, Illustration }, i) => (
          <motion.div
            key={title}
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-50px' }}
            transition={{ delay: i * 0.08, duration: 0.5, ease: [0.25, 1, 0.5, 1] }}
            className="rounded-card border border-[var(--color-border)] bg-[var(--color-surface)] p-7 flex flex-col gap-3 hover:shadow-md hover:-translate-y-[2px] transition-[transform,box-shadow]"
          >
            <div className="relative h-[120px] mb-2 overflow-hidden rounded-2xl bg-gradient-to-br from-[var(--color-primary-soft)] to-[var(--color-surface-elevated)]">
              <div className="absolute inset-0 flex items-center justify-center">
                {Illustration === HeroOrbital ? (
                  <Illustration className="w-[180px] h-[180px]" staticOnly />
                ) : Illustration === AIAvatar ? (
                  <Illustration size={96} />
                ) : (
                  <Illustration className="w-[160px]" />
                )}
              </div>
            </div>
            <span className="size-9 rounded-xl bg-[var(--color-primary-soft)] text-[var(--color-primary)] inline-flex items-center justify-center">
              <Icon className="size-5" strokeWidth={1.8} />
            </span>
            <h3 className="text-[18px] font-bold tracking-tight">{title}</h3>
            <p className="text-[14px] text-[var(--color-text-secondary)] leading-relaxed">{body}</p>
          </motion.div>
        ))}
      </div>
    </section>
  );
}

function Testimonials() {
  const quotes = [
    {
      body: 'Finally a tracker that knows the difference between a half-life and a streak. The med-level curve alone is worth it.',
      name: 'Karsten B.',
      role: 'Mounjaro · 14 weeks',
    },
    {
      body: 'I bring the doctor report to every visit. My endo asked which app it was so she could recommend it.',
      name: 'Priya S.',
      role: 'Wegovy · 9 months',
    },
    {
      body: 'Site rotation reminders saved me from another nasty bruise. The app respects how serious this is.',
      name: 'Daniel R.',
      role: 'Ozempic · 6 months',
    },
  ];
  return (
    <section className="px-5 py-20 md:py-28 max-w-[1200px] mx-auto">
      <div className="text-center max-w-[640px] mx-auto mb-12">
        <h2 className="text-[clamp(28px,4vw,40px)] font-extrabold tracking-tight">
          From real{' '}
          <span className="font-display italic font-normal text-[var(--color-primary)]">
            patients.
          </span>
        </h2>
        <p className="text-[15px] text-[var(--color-text-secondary)] mt-3">
          Names changed at request. Reviews from public communities of GLP-1 users.
        </p>
      </div>
      <div className="grid md:grid-cols-3 gap-5">
        {quotes.map((q, i) => (
          <motion.figure
            key={q.name}
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-50px' }}
            transition={{ delay: i * 0.08, duration: 0.5, ease: [0.25, 1, 0.5, 1] }}
            className="rounded-card border border-[var(--color-border)] bg-[var(--color-surface)] p-7 flex flex-col gap-4"
          >
            <div
              aria-hidden
              className="size-7 rounded-lg bg-[var(--color-primary-soft)] text-[var(--color-primary)] inline-flex items-center justify-center font-display italic text-[22px] font-light leading-none"
            >
              &ldquo;
            </div>
            <blockquote className="text-[15px] leading-relaxed text-[var(--color-text)]">
              {q.body}
            </blockquote>
            <figcaption className="mt-auto pt-2 border-t border-[var(--color-border)]">
              <p className="text-[13px] font-bold">{q.name}</p>
              <p className="text-[12px] text-[var(--color-text-secondary)]">{q.role}</p>
            </figcaption>
          </motion.figure>
        ))}
      </div>
    </section>
  );
}

function Pricing({ onStart }: { onStart: () => void }) {
  const tiers = [
    {
      name: 'Free',
      price: '$0',
      cadence: '/forever',
      description: 'Everything most people need.',
      features: [
        'All 9 dashboard tabs',
        'Med-level curves',
        'Vial & supply tracking',
        'Doctor-ready report',
        'Local-only data',
        '1 progress card template',
      ],
      cta: 'Start free',
      featured: false,
    },
    {
      name: 'Pro',
      price: '$5',
      cadence: '/month',
      description: 'For people serious about their journey.',
      features: [
        'Everything in Free',
        'AI coach with full context',
        '3 progress card templates',
        'Apple Health import',
        'Priority support',
        'Cancel anytime',
      ],
      cta: 'Try Pro',
      featured: true,
    },
  ];
  return (
    <section className="px-5 py-20 md:py-28 max-w-[1100px] mx-auto">
      <div className="text-center max-w-[640px] mx-auto mb-12">
        <h2 className="text-[clamp(28px,4vw,40px)] font-extrabold tracking-tight">
          Honest{' '}
          <span className="font-display italic font-normal text-[var(--color-primary)]">
            pricing.
          </span>
        </h2>
        <p className="text-[15px] text-[var(--color-text-secondary)] mt-3">
          No data harvesting. No ads. Optional Pro pays for the AI.
        </p>
      </div>
      <div className="grid md:grid-cols-2 gap-5 max-w-[820px] mx-auto">
        {tiers.map((t) => (
          <div
            key={t.name}
            className={`rounded-card p-7 border ${t.featured ? 'bg-[var(--color-hero-bg)] text-white border-transparent shadow-hero' : 'bg-[var(--color-surface)] border-[var(--color-border)]'}`}
          >
            <div className="flex items-baseline justify-between gap-2 mb-1">
              <h3 className="text-[18px] font-bold">{t.name}</h3>
              {t.featured && (
                <span className="text-[10px] font-bold uppercase tracking-[0.1em] bg-white/20 text-white px-2 py-1 rounded-pill">
                  Most popular
                </span>
              )}
            </div>
            <div className="flex items-baseline gap-1">
              <span className="text-[44px] font-extrabold tracking-tight">{t.price}</span>
              <span
                className={`text-[14px] ${t.featured ? 'text-white/70' : 'text-[var(--color-text-secondary)]'}`}
              >
                {t.cadence}
              </span>
            </div>
            <p
              className={`text-[13px] mt-1 ${t.featured ? 'text-white/80' : 'text-[var(--color-text-secondary)]'}`}
            >
              {t.description}
            </p>
            <ul className="mt-6 space-y-2.5">
              {t.features.map((f) => (
                <li key={f} className="flex items-start gap-2 text-[14px]">
                  <Check
                    className={`size-4 mt-[3px] shrink-0 ${t.featured ? 'text-white' : 'text-[var(--color-primary)]'}`}
                  />
                  <span className={t.featured ? 'text-white/95' : 'text-[var(--color-text)]'}>
                    {f}
                  </span>
                </li>
              ))}
            </ul>
            <Button
              onClick={onStart}
              variant={t.featured ? 'inverse' : 'primary'}
              block
              className="mt-7"
            >
              {t.cta}
            </Button>
          </div>
        ))}
      </div>
    </section>
  );
}

function FAQ() {
  const items = [
    {
      q: 'Is my data shared with anyone?',
      a: "No. Everything lives in your browser's localStorage. We never send your weight, dose, or notes to any server. The only exception is the AI coach, which sends just your prompt + the relevant context to Anthropic through our secure server using your account (you never share an API key).",
    },
    {
      q: 'Will this replace my doctor?',
      a: 'No. LeanShot is an educational tracking tool. It surfaces patterns and produces a doctor-ready summary you can bring to visits. Always defer to your prescriber for clinical decisions.',
    },
    {
      q: 'How accurate are the medication-level curves?',
      a: 'They use peer-reviewed half-life values for each medication and your actual dose log. Real plasma levels vary with body composition, injection site, and timing — treat the curve as a clinically-grounded estimate, not lab data.',
    },
    {
      q: 'Does AI cost extra?',
      a: 'AI coaching is included — no separate API key, no extra setup. Pro adds priority support and unlimited progress card templates.',
    },
    {
      q: 'Can I export my data?',
      a: 'Yes. Settings → Data → Export gives you a complete JSON file. Re-import it later or take it to another tool.',
    },
  ];
  return (
    <section className="px-5 py-20 md:py-28 max-w-[820px] mx-auto">
      <div className="text-center mb-12">
        <h2 className="text-[clamp(28px,4vw,40px)] font-extrabold tracking-tight">
          Common{' '}
          <span className="font-display italic font-normal text-[var(--color-primary)]">
            questions.
          </span>
        </h2>
      </div>
      <div className="space-y-2">
        {items.map((it) => (
          <FAQItem key={it.q} q={it.q} a={it.a} />
        ))}
      </div>
    </section>
  );
}

function FAQItem({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] overflow-hidden">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="w-full px-5 py-4 flex items-center justify-between gap-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-bg)]"
      >
        <span className="text-[15px] font-semibold">{q}</span>
        <ChevronDown
          className={`size-5 text-[var(--color-text-secondary)] transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>
      {open && (
        <div className="px-5 pb-5 text-[14px] text-[var(--color-text-secondary)] leading-relaxed border-t border-[var(--color-border)] pt-4">
          {a}
        </div>
      )}
    </div>
  );
}

function Footer() {
  return (
    <footer className="border-t border-[var(--color-border)] mt-12">
      <div className="max-w-[1200px] mx-auto px-5 py-10 grid md:grid-cols-3 gap-6 items-start">
        <div>
          <div className="flex items-center gap-2 text-[18px] font-extrabold tracking-tight text-[var(--color-primary)]">
            <span className="size-7 rounded-lg bg-[var(--color-primary)] text-[var(--color-primary-foreground)] inline-flex items-center justify-center">
              <Zap className="size-4" strokeWidth={2.6} />
            </span>
            LeanShot
          </div>
          <p className="text-[12px] text-[var(--color-text-secondary)] mt-2 max-w-[40ch] leading-snug">
            An educational tracking tool. Not medical advice. Always consult your prescriber.
          </p>
        </div>
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--color-text-tertiary)] mb-2">
            Trust
          </p>
          <ul className="space-y-1.5 text-[13px] text-[var(--color-text-secondary)]">
            <li className="flex items-center gap-2">
              <Lock className="size-3.5" /> Local-only by default
            </li>
            <li className="flex items-center gap-2">
              <Shield className="size-3.5" /> No third-party analytics
            </li>
            <li className="flex items-center gap-2">
              <Check className="size-3.5" /> Open data export
            </li>
          </ul>
        </div>
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--color-text-tertiary)] mb-2">
            Legal
          </p>
          <ul className="space-y-1.5 text-[13px] text-[var(--color-text-secondary)]">
            <li>Privacy policy</li>
            <li>Terms of service</li>
            <li>Medical disclaimer</li>
          </ul>
        </div>
      </div>
      <div className="border-t border-[var(--color-border)] py-4 text-center text-[11px] text-[var(--color-text-tertiary)]">
        © 2026 LeanShot · Your data lives on your device
      </div>
    </footer>
  );
}
