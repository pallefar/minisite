// Dashboard cards — recreations of components/dashboard/cards/*

const { useState, useEffect, useMemo } = React;

/* ------ HeroCard — the editorial Lost / Gained surface ------ */
function HeroCard() {
  // Initialize at final value so the count is correct even if RAF hasn't
  // run yet (during initial paint, screenshot tooling, reduced-motion).
  const [count, setCount] = useState(4.2);
  useEffect(() => {
    setCount(0);
    const start = performance.now();
    let raf = 0;
    const tick = (now) => {
      const u = Math.min(1, (now - start) / 900);
      setCount(4.2 * (1 - Math.pow(1 - u, 4)));
      if (u < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
  const titration = [
    { dose: '2.5 mg', wks: '1–4' },
    { dose: '5 mg',   wks: '5–8' },
    { dose: '7.5 mg', wks: '9–12' },
    { dose: '10 mg',  wks: '13–16' },
    { dose: '12.5 mg',wks: '17+' },
  ];
  const currentIdx = 1;
  return (
    <div className="hero-card span-7" data-tour="hero">
      <div className="hero-mesh" aria-hidden></div>
      <img src="assets/hero-orbital.svg" className="hero-art" alt="" />
      <div className="hero-top">
        <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
          <span className="badge badge-inverse">Mounjaro</span>
          <span className="badge badge-inverse">5 mg</span>
        </div>
        <span className="badge badge-inverse-solid">Rx · Mounjaro</span>
      </div>
      <div className="hero-headline">
        <p className="hero-direction fr-w">Lost</p>
        <p className="hero-number tnum">
          {count.toFixed(1)}<span className="hero-unit">kg</span>
        </p>
        <p className="hero-phase">Week 8 · Titration phase · Stay protein-focused.</p>
      </div>
      <div className="hero-stats">
        <div className="hero-stat">
          <span className="hero-stat-v tnum">62%</span>
          <span className="hero-stat-l">Goal</span>
        </div>
        <span className="hero-stat-div" aria-hidden></span>
        <div className="hero-stat">
          <span className="hero-stat-v tnum">14</span>
          <span className="hero-stat-l">Injections</span>
        </div>
        <span className="hero-stat-div" aria-hidden></span>
        <div className="hero-stat">
          <span className="hero-stat-v tnum">86<span style={{fontSize:'0.55em',opacity:0.7}}>/128g</span></span>
          <span className="hero-stat-l">Protein today</span>
        </div>
      </div>
      <div className="hero-titration">
        <div className="hero-titration-head">
          <p className="hero-orb-eyebrow">TITRATION TIMELINE</p>
          <p className="hero-titration-tip">Tap a step in the medication tab to learn more</p>
        </div>
        <div className="hero-titration-track">
          {titration.map((s, i) => (
            <div key={s.dose} className={'titration-step' + (i === currentIdx ? ' current' : '') + (i < currentIdx ? ' done' : '')}>
              <span className="titration-dot" aria-hidden>
                {i === currentIdx && <span className="titration-ping"></span>}
              </span>
              <span className="titration-dose">{s.dose}</span>
              <span className="titration-wks">{i === currentIdx ? 'Now · ' : ''}Wk {s.wks}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ------ GLPCurveCard — the pharmacology curve ------ */
function GLPCurveCard() {
  // synthesize 7-day curve with two injections to show peak→trough cycle
  const W = 320, H = 110, totalH = 7 * 24;
  const halfLife = 130;
  // shot at h=24 (6 days ago) and h=144 (24h ago) within the 168h window
  const shots = [24, 144];
  const points = [];
  for (let h = 0; h <= totalH; h += 2) {
    let lvl = 0;
    for (const s of shots) {
      if (h >= s) {
        const dt = h - s;
        const rise = 1 - Math.exp(-dt / 6);
        lvl += rise * Math.pow(0.5, dt / halfLife);
      }
    }
    points.push({ h, lvl });
  }
  const max = Math.max(0.001, ...points.map(p => p.lvl));
  const xy = points.map(p => ({
    x: (p.h / totalH) * W,
    y: H - (p.lvl / max) * (H - 6) - 2,
  }));
  const path = xy.map((p,i) => (i===0 ? `M${p.x.toFixed(1)},${p.y.toFixed(1)}` : `L${p.x.toFixed(1)},${p.y.toFixed(1)}`)).join(' ');
  const area = `${path} L ${W},${H} L 0,${H} Z`;
  const dotMarkers = shots.map(s => {
    const idx = Math.round((s / totalH) * (xy.length - 1));
    return xy[idx];
  });

  return (
    <div className="card span-5" style={{display:'flex', flexDirection:'column', minHeight: 380}}>
      <div className="card-header">
        <div className="card-header-l">
          <span className="card-icon-chip"><Icon d={I.chartLine} sw={1.8} size={16} /></span>
          <h2 className="card-title">GLP-1 level</h2>
        </div>
        <span className="badge badge-success">
          <span className="badge-dot"></span>Peak now
        </span>
      </div>
      <div>
        <div style={{display:'flex', alignItems:'baseline', gap:6}}>
          <span className="tnum" style={{fontSize:44, fontWeight:800, letterSpacing:'-0.04em', lineHeight:1}}>82</span>
          <span style={{fontSize:18, opacity:0.7, fontWeight:700}}>%</span>
          <span style={{marginLeft:4, fontSize:12, color:'var(--color-text-tertiary)'}}>est.</span>
        </div>
        <div style={{marginTop:6, display:'inline-flex', alignItems:'center', gap:6, fontSize:12, color:'var(--color-text-secondary)', whiteSpace:'nowrap'}}>
          <Icon d={I.clock} sw={1.8} size={14} />
          <span>Next shot in <strong className="tnum" style={{color:'var(--color-text)'}}>2d 14h</strong></span>
        </div>
      </div>
      <div style={{display:'flex', justifyContent:'space-between', marginTop:18, marginBottom:4}}>
        {['Now','Day 3','Day 6'].map(l => <span key={l} className="eyebrow">{l}</span>)}
      </div>
      <div style={{position:'relative', flex:1, minHeight:110}}>
        <svg viewBox={`0 0 ${W} ${H}`} className="curve-svg" preserveAspectRatio="none">
          <defs>
            <linearGradient id="glp-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--color-primary)" stopOpacity="0.22" />
              <stop offset="100%" stopColor="var(--color-primary)" stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={area} fill="url(#glp-fill)" />
          <path d={path} fill="none" stroke="var(--color-primary)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
          {dotMarkers.map((d, i) => (
            <g key={i}>
              <circle cx={d.x} cy={d.y} r="6" fill="var(--color-primary)" opacity="0.18" />
              <circle cx={d.x} cy={d.y} r="3" fill="var(--color-primary)" stroke="var(--color-surface)" strokeWidth="1.4" />
            </g>
          ))}
          <line x1={W-2} y1="0" x2={W-2} y2={H} stroke="var(--color-rose, #f2a893)" strokeWidth="1.5" strokeDasharray="3 3" opacity="0.6" />
        </svg>
      </div>
      <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:8, marginTop:12}}>
        <div className="peak-chip peak-info">
          <p className="eyebrow" style={{color:'inherit',opacity:0.75}}>Peak</p>
          <p style={{fontSize:14, fontWeight:700, marginTop:2}}>Day 1–2</p>
          <p style={{fontSize:11, opacity:0.8}}>Eat slow</p>
        </div>
        <div className="peak-chip peak-warning">
          <p className="eyebrow" style={{color:'inherit',opacity:0.75}}>Trough</p>
          <p style={{fontSize:14, fontWeight:700, marginTop:2}}>Day 6–7</p>
          <p style={{fontSize:11, opacity:0.8}}>Hunger rises</p>
        </div>
      </div>
    </div>
  );
}

/* ------ FocusCard — pale-teal CTA ------ */
function FocusCard({ onCta }) {
  return (
    <div className="focus-card span-12">
      <span className="focus-chip">
        <Icon d={I.beef} sw={1.9} size={22} />
      </span>
      <div className="focus-body">
        <p className="focus-eyebrow">Today's focus</p>
        <h2 className="focus-title">Hit 128 g protein before 7 PM</h2>
        <p className="focus-sub">You're 42 g short — a 6 oz chicken thigh or a protein shake closes the gap.</p>
      </div>
      <button className="btn btn-primary focus-cta" onClick={onCta}>
        Log meal <Icon d={I.arrowRight} sw={2} size={14} />
      </button>
    </div>
  );
}

/* ------ SiteRotationCard ------ */
function SiteRotationCard() {
  return (
    <div className="card span-4">
      <div className="card-header">
        <div className="card-header-l">
          <span className="card-icon-chip"><Icon d={I.syringe} sw={1.8} size={16} /></span>
          <h2 className="card-title">Injection site</h2>
        </div>
        <button className="btn btn-ghost" aria-label="Open medication tab">
          <Icon d={I.arrowUR} sw={1.8} size={16} />
        </button>
      </div>
      <div style={{display:'flex', justifyContent:'center', padding:'4px 0 8px'}}>
        <img src="assets/body-diagram.svg" width="170" height="278" alt="Body diagram with numbered rotation" />
      </div>
      <div style={{display:'flex', flexWrap:'wrap', gap:'4px 14px', justifyContent:'center', fontSize:12, color:'var(--color-text-secondary)'}}>
        <span style={{display:'inline-flex', alignItems:'center', gap:6}}>
          <span style={{width:10,height:10,borderRadius:99,background:'var(--color-success)', border:'2px solid var(--color-surface)', boxShadow: 'var(--shadow-xs)'}}/>Next
        </span>
        <span style={{display:'inline-flex', alignItems:'center', gap:6}}>
          <span style={{width:10,height:10,borderRadius:99,background:'#e07346', border:'2px solid var(--color-surface)'}}/>Recent · avoid
        </span>
        <span style={{display:'inline-flex', alignItems:'center', gap:6}}>
          <span style={{width:10,height:10,borderRadius:99,background:'#dba844', border:'2px solid var(--color-surface)'}}/>2 weeks ago
        </span>
      </div>
    </div>
  );
}

/* ------ StreaksCard ------ */
function StreaksCard() {
  const rows = [
    { label: 'Weight log',  n: 14, tier: 'bronze' },
    { label: 'Protein hit', n: 32, tier: 'silver' },
    { label: 'Stack run',   n: 92, tier: 'gold'   },
    { label: 'Active days', n: 5,  tier: 'locked' },
  ];
  return (
    <div className="card span-12">
      <div className="card-header">
        <div className="card-header-l">
          <span className="card-icon-chip"><Icon d={I.flame} sw={1.8} size={16} /></span>
          <h2 className="card-title">Your streaks</h2>
        </div>
        <span className="badge badge-info">Keep it going</span>
      </div>
      <div style={{display:'grid', gridTemplateColumns:'repeat(4, 1fr)', gap:12}}>
        {rows.map(r => (
          <div key={r.label} className="card-flat" style={{display:'flex', alignItems:'center', gap:12, padding:14}}>
            <img src={`assets/streak-${r.tier}.svg`} width="52" height="52" alt="" />
            <div>
              <p className="tnum" style={{fontSize:22, fontWeight:800, lineHeight:1, letterSpacing:'-0.02em'}}>
                {r.n}<span style={{fontSize:12, color:'var(--color-text-secondary)', fontWeight:500, marginLeft:4}}>days</span>
              </p>
              <p className="eyebrow" style={{marginTop:3}}>{r.label}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ------ QuickLogCard ------ */
function QuickLogCard({ onLogDose, onLogWeight, onLogMeal, onLogWater }) {
  const items = [
    { d: I.syringe,  label: 'Dose',    onClick: onLogDose },
    { d: I.scale,    label: 'Weight',  onClick: onLogWeight },
    { d: I.beef,     label: 'Meal',    onClick: onLogMeal },
    { d: I.droplet,  label: 'Water',   onClick: onLogWater },
  ];
  return (
    <div className="card span-4">
      <div className="card-header">
        <div className="card-header-l">
          <span className="card-icon-chip"><Icon d={I.plus} sw={2} size={16} /></span>
          <h2 className="card-title">Quick log</h2>
        </div>
        <span className="badge badge-neutral">2 taps</span>
      </div>
      <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:8}}>
        {items.map(it => (
          <button key={it.label} className="quick-log-btn" onClick={it.onClick}>
            <span className="quick-log-icon"><Icon d={it.d} sw={1.8} size={20} /></span>
            <span className="quick-log-label">{it.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/* ------ Today tab — assembles the bento ------ */
function TodayTab({ openLog }) {
  return (
    <div className="bento" data-screen-label="Today">
      <FocusCard onCta={() => openLog('meal')} />
      <HeroCard />
      <GLPCurveCard />
      <SiteRotationCard />
      <QuickLogCard
        onLogDose={() => openLog('dose')}
        onLogWeight={() => openLog('weight')}
        onLogMeal={() => openLog('meal')}
        onLogWater={() => openLog('water')} />
      <StreaksCard />
    </div>
  );
}

Object.assign(window, {
  HeroCard, GLPCurveCard, FocusCard, SiteRotationCard,
  StreaksCard, QuickLogCard, TodayTab,
});
