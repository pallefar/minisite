// Marketing landing components — match leanshot/src/components/marketing/Landing.tsx
// Plain JSX with React 18 + Babel standalone. No imports.

const { useState, useEffect, useRef } = React;

/* ----------------- Icons (Lucide inline) ----------------- */
const Icon = ({ d, sw = 1.8, size = 20, ...rest }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
       stroke="currentColor" strokeWidth={sw} strokeLinecap="round"
       strokeLinejoin="round" aria-hidden="true" {...rest}
       dangerouslySetInnerHTML={{ __html: d }} />
);
const I = {
  zap:        '<path d="M13 2L3 14h7l-1 8 11-14h-7l1-6z"/>',
  arrowRight: '<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>',
  sun:        '<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/>',
  moon:       '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>',
  check:      '<path d="M20 6 9 17l-5-5"/>',
  lock:       '<rect width="18" height="11" x="3" y="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  shield:     '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/>',
  zapBold:    '<path d="M13 2L3 14h7l-1 8 11-14h-7l1-6z"/>',
  brain:      '<path d="M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z"/><path d="M9 13a4.5 4.5 0 0 1 3-4"/><path d="M6.003 5.125A3 3 0 0 0 6.401 6.5"/><path d="M3.477 10.896a4 4 0 0 1 .585-.396"/><path d="M6 18a4 4 0 0 1-1.967-.516"/><path d="M12 13h4"/><path d="M12 18h6a2 2 0 0 1 2 2v1"/><path d="M12 8h8"/><path d="M16 8V5a2 2 0 0 1 2-2"/><circle cx="16" cy="13" r=".5"/><circle cx="18" cy="3" r=".5"/><circle cx="20" cy="21" r=".5"/><circle cx="20" cy="8" r=".5"/>',
  chartLine:  '<path d="M3 3v18h18"/><path d="m19 9-5 5-4-4-3 3"/>',
  sparkles:   '<path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.582a.5.5 0 0 1 0 .962L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"/>',
  chevDown:   '<path d="m6 9 6 6 6-6"/>',
};

/* ----------------- Theme hook ----------------- */
function useTheme() {
  const [theme, setTheme] = useState(
    () => document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light'
  );
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);
  return { theme, toggle: () => setTheme(t => t === 'light' ? 'dark' : 'light') };
}

/* ----------------- Nav ----------------- */
function Nav({ onStart }) {
  const { theme, toggle } = useTheme();
  return (
    <nav className="nav shell" role="navigation">
      <div className="brand">
        <span className="brand-mark"><Icon d={I.zapBold} sw={2.6} size={16} /></span>
        LeanShot
      </div>
      <div className="nav-right">
        <button className="btn-ghost-icon" onClick={toggle} aria-label="Toggle theme">
          <Icon d={theme === 'light' ? I.moon : I.sun} sw={1.8} size={18} />
        </button>
        <a href="#signin" className="nav-link">Sign in</a>
        <button className="btn btn-primary btn-sm" onClick={onStart}>
          Get started <Icon d={I.arrowRight} sw={2} size={14} />
        </button>
      </div>
    </nav>
  );
}

/* ----------------- Animated curve in hero visual ----------------- */
function HeroVisual() {
  const [t, setT] = useState(0);
  useEffect(() => {
    let raf = 0;
    const start = performance.now();
    const tick = (now) => {
      const u = Math.min(1, (now - start) / 1600);
      setT(1 - Math.pow(1 - u, 4));
      if (u < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const points = [];
  for (let i = 0; i <= 64; i++) {
    const rise = 1 - Math.exp(-i / 4);
    const decay = Math.exp(-Math.max(0, i - 8) / 28);
    points.push({ x: i, y: rise * decay });
  }
  const path = points.map((p, i) => {
    const x = (p.x / 64) * 320;
    const yPx = 180 - p.y * 140;
    return i === 0 ? `M${x},${yPx}` : `L${x},${yPx}`;
  }).join(' ');
  const dashLen = 800, offset = dashLen * (1 - t);

  return (
    <div className="hero-visual rise">
      <div className="hero-orb-card">
        <img src="assets/hero-orbital.svg" className="hero-orb-bg" alt="" />
        <div className="hero-orb-content">
          <p className="hero-orb-eyebrow">GLP-1 LEVEL · 7-DAY</p>
          <p className="hero-orb-title">
            Peak <span className="fr-white">→ trough</span>
          </p>
          <svg viewBox="0 0 320 200" className="hero-orb-svg">
            <defs>
              <linearGradient id="hero-fill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="white" stopOpacity="0.32" />
                <stop offset="100%" stopColor="white" stopOpacity="0" />
              </linearGradient>
            </defs>
            <path d={`${path} L 320,180 L 0,180 Z`} fill="url(#hero-fill)" opacity={t} />
            <path d={path} fill="none" stroke="white" strokeWidth="2.4"
                  strokeLinecap="round" strokeLinejoin="round"
                  strokeDasharray={dashLen} strokeDashoffset={offset} />
            {[0, 32].map(x => {
              const idx = Math.floor((x / 64) * points.length);
              const p = points[Math.min(points.length - 1, idx)];
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
          <div className="hero-orb-stats">
            {[
              { label: 'Half-life', val: '7d' },
              { label: 'Phase', val: 'Titration' },
              { label: 'Adherence', val: '92%' },
            ].map(s => (
              <div key={s.label} className="hero-orb-stat">
                <div className="hero-orb-stat-label">{s.label}</div>
                <div className="hero-orb-stat-val">{s.val}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ----------------- Hero ----------------- */
function Hero({ onStart }) {
  return (
    <section className="hero shell">
      <div className="hero-grid">
        <div className="hero-text rise">
          <span className="eyebrow-chip">
            <Icon d={I.zapBold} sw={2.4} size={14} /> Built for serious GLP-1 users
          </span>
          <h1 className="hero-title">
            Maximize your <span className="fr">GLP-1 journey.</span>
            <br/>Lose fat. Keep muscle.
          </h1>
          <p className="hero-sub">
            Clinical tracking for Ozempic, Wegovy, Mounjaro, and Zepbound. Med-level
            curves, vial supply, AI food logging, doctor reports, and an expert chat —
            all in one warm, calm place.
          </p>
          <div className="hero-ctas">
            <button className="btn btn-primary btn-lg" onClick={onStart}>
              Start free <Icon d={I.arrowRight} sw={2} size={16} />
            </button>
            <a className="btn btn-secondary btn-lg" href="#features">See features</a>
          </div>
          <div className="hero-trust">
            <span className="chip-trust"><Icon d={I.lock} sw={1.8} size={16} /> Local-only data</span>
            <span className="chip-trust"><Icon d={I.check} sw={2} size={16} /> No card needed</span>
          </div>
        </div>
        <HeroVisual />
      </div>
    </section>
  );
}

/* ----------------- Features ----------------- */
function Features() {
  const list = [
    { iconD: I.chartLine, title: 'Real pharmacology',
      body: 'Half-life curves modelled to your specific medication, not a generic line. Know peak vs trough.',
      art: 'assets/hero-orbital.svg' },
    { iconD: I.brain, title: 'AI that knows your data',
      body: 'Context-aware coach that has read your week — not a generic LLM that makes up advice.',
      art: 'assets/ai-avatar.svg' },
    { iconD: I.sparkles, title: 'Doctor-ready in one tap',
      body: 'Auto-generated PDF summarizes your dose, sites, side effects, and trends. Bring it to every visit.',
      art: 'assets/connect-data.svg' },
  ];
  return (
    <section id="features" className="features shell" data-screen-label="Marketing/Features">
      <header className="section-head">
        <h2 className="section-title">
          What no other tracker <span className="fr">does</span>
        </h2>
        <p className="section-sub">
          Built around the science of GLP-1 — not retrofitted from a generic habit app.
        </p>
      </header>
      <div className="features-grid">
        {list.map((f, i) => (
          <div key={f.title} className="feature card card-interactive">
            <div className="feature-art">
              <img src={f.art} alt="" />
            </div>
            <span className="feature-icon-chip">
              <Icon d={f.iconD} sw={1.8} size={20} />
            </span>
            <h3 className="feature-title">{f.title}</h3>
            <p className="feature-body">{f.body}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

/* ----------------- Testimonials ----------------- */
function Testimonials() {
  const quotes = [
    { body: 'Finally a tracker that knows the difference between a half-life and a streak. The med-level curve alone is worth it.', name: 'Karsten B.', role: 'Mounjaro · 14 weeks' },
    { body: 'I bring the doctor report to every visit. My endo asked which app it was so she could recommend it.', name: 'Priya S.', role: 'Wegovy · 9 months' },
    { body: 'Site rotation reminders saved me from another nasty bruise. The app respects how serious this is.', name: 'Daniel R.', role: 'Ozempic · 6 months' },
  ];
  return (
    <section className="testimonials shell" data-screen-label="Marketing/Testimonials">
      <header className="section-head">
        <h2 className="section-title">From real <span className="fr">patients.</span></h2>
        <p className="section-sub">Names changed at request. Reviews from public communities of GLP-1 users.</p>
      </header>
      <div className="t-grid">
        {quotes.map(q => (
          <figure key={q.name} className="t-card card">
            <div className="t-quote-mark" aria-hidden>&ldquo;</div>
            <blockquote className="t-body">{q.body}</blockquote>
            <figcaption className="t-cite">
              <p className="t-name">{q.name}</p>
              <p className="t-role">{q.role}</p>
            </figcaption>
          </figure>
        ))}
      </div>
    </section>
  );
}

/* ----------------- Pricing ----------------- */
function Pricing({ onStart }) {
  const tiers = [
    { name: 'Free', price: '$0', cadence: '/forever', description: 'Everything most people need.',
      features: ['All 9 dashboard tabs','Med-level curves','Vial & supply tracking','Doctor-ready report','Local-only data','1 progress card template'],
      cta: 'Start free', featured: false },
    { name: 'Pro', price: '$5', cadence: '/month', description: 'For people serious about their journey.',
      features: ['Everything in Free','AI coach with full context','3 progress card templates','Apple Health import','Priority support','Cancel anytime'],
      cta: 'Try Pro', featured: true },
  ];
  return (
    <section className="pricing shell" data-screen-label="Marketing/Pricing">
      <header className="section-head">
        <h2 className="section-title">Honest <span className="fr">pricing.</span></h2>
        <p className="section-sub">No data harvesting. No ads. Optional Pro pays for the AI.</p>
      </header>
      <div className="pricing-grid">
        {tiers.map(t => (
          <div key={t.name} className={`p-card ${t.featured ? 'p-card-featured' : ''}`}>
            <div className="p-head">
              <h3 className="p-name">{t.name}</h3>
              {t.featured && <span className="p-popular">Most popular</span>}
            </div>
            <div className="p-price">
              <span className="p-amount tnum">{t.price}</span>
              <span className="p-cadence">{t.cadence}</span>
            </div>
            <p className="p-desc">{t.description}</p>
            <ul className="p-features">
              {t.features.map(f => (
                <li key={f}><Icon d={I.check} sw={2.2} size={16} />{f}</li>
              ))}
            </ul>
            <button onClick={onStart}
                    className={`btn ${t.featured ? 'btn-inverse' : 'btn-primary'}`}
                    style={{ width: '100%', marginTop: 24 }}>
              {t.cta}
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}

/* ----------------- FAQ ----------------- */
function FAQ() {
  const items = [
    { q: 'Is my data shared with anyone?',
      a: "No. Everything lives in your browser's localStorage. We never send your weight, dose, or notes to any server. The only exception is the AI coach, which sends just your prompt + relevant context through our secure server using your account." },
    { q: 'Will this replace my doctor?',
      a: 'No. LeanShot is an educational tracking tool. It surfaces patterns and produces a doctor-ready summary you can bring to visits. Always defer to your prescriber for clinical decisions.' },
    { q: 'How accurate are the medication-level curves?',
      a: 'They use peer-reviewed half-life values for each medication and your actual dose log. Real plasma levels vary with body composition, injection site, and timing — treat the curve as a clinically-grounded estimate, not lab data.' },
    { q: 'Does AI cost extra?',
      a: 'AI coaching is included — no separate API key, no extra setup. Pro adds priority support and unlimited progress card templates.' },
    { q: 'Can I export my data?',
      a: 'Yes. Settings → Data → Export gives you a complete JSON file. Re-import it later or take it to another tool.' },
  ];
  return (
    <section className="faq shell" data-screen-label="Marketing/FAQ">
      <header className="section-head">
        <h2 className="section-title">Common <span className="fr">questions.</span></h2>
      </header>
      <div className="faq-list">
        {items.map(it => <FAQItem key={it.q} {...it} />)}
      </div>
    </section>
  );
}
function FAQItem({ q, a }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="faq-item">
      <button className="faq-q" aria-expanded={open} onClick={() => setOpen(o => !o)}>
        <span>{q}</span>
        <Icon d={I.chevDown} sw={2} size={18}
              style={{ transition: 'transform 200ms', transform: open ? 'rotate(180deg)' : 'none' }} />
      </button>
      {open && <div className="faq-a">{a}</div>}
    </div>
  );
}

/* ----------------- Footer ----------------- */
function Footer() {
  return (
    <footer className="site-footer">
      <div className="shell footer-grid">
        <div>
          <div className="brand">
            <span className="brand-mark"><Icon d={I.zapBold} sw={2.6} size={16} /></span>
            LeanShot
          </div>
          <p className="footer-tag">An educational tracking tool. Not medical advice. Always consult your prescriber.</p>
        </div>
        <div>
          <p className="eyebrow">Trust</p>
          <ul className="footer-list">
            <li><Icon d={I.lock} sw={1.8} size={14} /> Local-only by default</li>
            <li><Icon d={I.shield} sw={1.8} size={14} /> No third-party analytics</li>
            <li><Icon d={I.check} sw={2} size={14} /> Open data export</li>
          </ul>
        </div>
        <div>
          <p className="eyebrow">Legal</p>
          <ul className="footer-list">
            <li>Privacy</li>
            <li>Terms</li>
            <li>Disclaimer</li>
          </ul>
        </div>
      </div>
      <div className="footer-copy">© 2026 LeanShot · Your data lives on your device</div>
    </footer>
  );
}

/* ----------------- Modal ----------------- */
function StartModal({ open, onClose }) {
  if (!open) return null;
  return (
    <div className="modal-scrim fade-in" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <span className="eyebrow">Welcome</span>
        <h3 style={{fontSize:22, fontWeight:800, letterSpacing:'-0.02em', marginTop:6}}>
          Pick your <span className="fr" style={{fontWeight:300}}>medication.</span>
        </h3>
        <p style={{fontSize:13, color:'var(--color-text-secondary)', marginTop:6}}>
          We tailor the curve and titration timeline to your specific GLP-1.
        </p>
        <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:8, marginTop:14}}>
          {['Ozempic','Wegovy','Mounjaro','Zepbound'].map((m,i) => (
            <button key={m} className="med-pill" data-active={i===2}>{m}</button>
          ))}
        </div>
        <button className="btn btn-primary" onClick={onClose} style={{width:'100%', marginTop:18}}>
          Continue <Icon d={I.arrowRight} sw={2} size={14} />
        </button>
      </div>
    </div>
  );
}

/* ----------------- App ----------------- */
function App() {
  const [modal, setModal] = useState(false);
  return (
    <div className="page">
      <Nav onStart={() => setModal(true)} />
      <Hero onStart={() => setModal(true)} />
      <Features />
      <Testimonials />
      <Pricing onStart={() => setModal(true)} />
      <FAQ />
      <Footer />
      <StartModal open={modal} onClose={() => setModal(false)} />
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
