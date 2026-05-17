// Secondary tabs (Medication, simple placeholder pattern for others)

const { useState: useStateMed } = React;

function MedicationTab({ openLog }) {
  return (
    <div className="bento" data-screen-label="Medication">
      <div className="card span-7">
        <div className="card-header">
          <div className="card-header-l">
            <span className="card-icon-chip"><Icon d={I.syringe} sw={1.8} size={16} /></span>
            <h2 className="card-title">Doses · last 4 weeks</h2>
          </div>
          <button className="btn btn-primary" onClick={() => openLog('dose')}>
            Log dose <Icon d={I.plus} sw={2.2} size={14} />
          </button>
        </div>

        <div style={{display:'flex', flexDirection:'column', gap:0}}>
          {[
            { d: 'Mon · Nov 9',  dose: '5 mg',   site: 'Abdomen LL', tag: ['success','Logged'] },
            { d: 'Mon · Nov 2',  dose: '5 mg',   site: 'Thigh L',    tag: ['success','Logged'] },
            { d: 'Mon · Oct 26', dose: '5 mg',   site: 'Abdomen UR', tag: ['success','Logged'] },
            { d: 'Mon · Oct 19', dose: '2.5 mg', site: 'Abdomen LR', tag: ['neutral','Titration'] },
          ].map((row, i) => (
            <div key={i} style={{
              display:'grid', gridTemplateColumns:'1fr auto auto auto',
              gap:14, alignItems:'center',
              padding:'14px 4px',
              borderTop: i === 0 ? 'none' : '1px solid var(--color-border)',
            }}>
              <div>
                <p style={{fontSize:13, fontWeight:600}}>{row.d}</p>
                <p style={{fontSize:11, color:'var(--color-text-tertiary)'}}>{row.site}</p>
              </div>
              <span className="tnum" style={{fontSize:18, fontWeight:700, letterSpacing:'-0.02em', whiteSpace:'nowrap'}}>{row.dose}</span>
              <span className={`badge badge-${row.tag[0]}`}>{row.tag[1]}</span>
              <button className="btn btn-ghost" aria-label="More"><Icon d={I.arrowUR} sw={1.8} size={16}/></button>
            </div>
          ))}
        </div>
      </div>

      <div className="card span-5">
        <div className="card-header">
          <div className="card-header-l">
            <span className="card-icon-chip"><Icon d={I.pill} sw={1.8} size={16} /></span>
            <h2 className="card-title">Vial supply</h2>
          </div>
          <span className="badge badge-warning">Refill in 9d</span>
        </div>
        <div style={{display:'flex', gap:14, alignItems:'center'}}>
          <img src="assets/pen-injector.svg" width="64" height="192" alt="auto-injector pen" />
          <div style={{flex:1}}>
            <p className="tnum" style={{fontSize:36, fontWeight:800, letterSpacing:'-0.03em', lineHeight:1}}>
              2.0<span style={{fontSize:14, color:'var(--color-text-secondary)', marginLeft:4, fontWeight:500}}>ml left</span>
            </p>
            <p style={{fontSize:12, color:'var(--color-text-secondary)', marginTop:4}}>
              Lot <span className="tnum">A24F-301</span> · expires 2026-08-14
            </p>
            <div style={{marginTop:14, height:8, borderRadius:99, background:'var(--color-surface-elevated)', overflow:'hidden'}}>
              <div style={{width:'62%', height:'100%', background:'linear-gradient(90deg, var(--color-primary), var(--color-teal-400, #4a8b81))'}}/>
            </div>
            <p className="eyebrow" style={{marginTop:6}}>62% remaining</p>
          </div>
        </div>
      </div>

      <SiteRotationCard />

      <div className="card span-8">
        <div className="card-header">
          <div className="card-header-l">
            <span className="card-icon-chip"><Icon d={I.chartLine} sw={1.8} size={16} /></span>
            <h2 className="card-title">Titration plan · Mounjaro</h2>
          </div>
          <span className="badge badge-info">Wk 8 of 16</span>
        </div>
        <div style={{display:'flex', alignItems:'flex-start', gap:8}}>
          {[
            ['2.5 mg', '1–4',  'done'],
            ['5 mg',   '5–8',  'current'],
            ['7.5 mg', '9–12', 'pending'],
            ['10 mg',  '13–16','pending'],
            ['12.5 mg','17+',  'pending'],
          ].map(([d, w, state], i, arr) => (
            <React.Fragment key={d}>
              <div style={{display:'flex', flexDirection:'column', alignItems:'center', gap:6, flex:'1 1 0', minWidth:0}}>
                <div style={{display:'flex', alignItems:'center', width:'100%', gap:4}}>
                  {/* left connector */}
                  <span style={{
                    flex:1, height:2,
                    background: i === 0 ? 'transparent' : (i <= 1 ? 'var(--color-primary)' : 'var(--color-border)'),
                  }} aria-hidden></span>
                  <span style={{
                    width:36, height:36, borderRadius:12,
                    flexShrink:0,
                    background: state === 'current' ? 'var(--color-primary)'
                              : state === 'done'    ? 'var(--color-primary-soft)'
                                                    : 'var(--color-surface-elevated)',
                    color: state === 'current' ? '#fff'
                         : state === 'done'    ? 'var(--color-primary)'
                                                : 'var(--color-text-tertiary)',
                    display:'inline-flex', alignItems:'center', justifyContent:'center',
                    fontSize:12, fontWeight:700,
                    boxShadow: state === 'current' ? '0 4px 12px rgba(27,72,66,0.25)' : 'none',
                  }}>
                    {state === 'done' ? <Icon d={'<path d=\"M20 6 9 17l-5-5\"/>'} sw={2.4} size={16} /> : i+1}
                  </span>
                  {/* right connector */}
                  <span style={{
                    flex:1, height:2,
                    background: i === arr.length - 1 ? 'transparent' : (i < 1 ? 'var(--color-primary)' : 'var(--color-border)'),
                  }} aria-hidden></span>
                </div>
                <p className="tnum" style={{
                  fontSize:13, fontWeight:700,
                  whiteSpace:'nowrap',
                  textDecoration: state === 'done' ? 'line-through' : 'none',
                  opacity: state === 'pending' ? 0.5 : 1,
                }}>{d}</p>
                <p className="eyebrow" style={{whiteSpace:'nowrap'}}>Wk {w}</p>
              </div>
            </React.Fragment>
          ))}
        </div>
      </div>
    </div>
  );
}

function GenericTab({ current }) {
  const meta = TAB_TITLES[current];
  const tab = (TABS_FOR_ICON.find(t => t.id === current) || {});
  return (
    <div className="bento" data-screen-label={meta?.title || current}>
      <div className="span-12 tab-placeholder">
        <span className="tab-placeholder-icon">
          <Icon d={tab.d || I.sparkles} sw={1.8} size={28} />
        </span>
        <div>
          <h2 style={{fontSize:22, fontWeight:700, letterSpacing:'-0.02em'}}>
            {meta?.title || current} <span className="fr">in progress.</span>
          </h2>
          <p style={{fontSize:14, color:'var(--color-text-secondary)', marginTop:6, maxWidth:'42ch'}}>
            This is a placeholder. In the real app this tab carries its own bento grid of cards. See the source kit for full implementation.
          </p>
        </div>
      </div>
    </div>
  );
}

// Mirror the tab definitions from shell.jsx so GenericTab can find the icon
const TABS_FOR_ICON = [
  { id: 'home',        d: I.home },
  { id: 'medication',  d: I.syringe },
  { id: 'symptoms',    d: I.shield },
  { id: 'body',        d: I.user },
  { id: 'nutrition',   d: I.apple },
  { id: 'activity',    d: I.activity },
  { id: 'supplements', d: I.pill },
  { id: 'mood',        d: I.smile },
  { id: 'insights',    d: I.trophy },
];

Object.assign(window, { MedicationTab, GenericTab });
