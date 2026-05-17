// LogModal — for Dose / Weight / Meal / Water
const { useState } = React;

function LogModal({ kind, onClose, onSave }) {
  const [dose,   setDose]   = useState('5');
  const [unit,   setUnit]   = useState('mg');
  const [site,   setSite]   = useState('abdomen-ll');
  const [weight, setWeight] = useState('74.3');
  const [meal,   setMeal]   = useState('chicken & rice');
  const [protein,setProtein]= useState('42');
  const [glasses,setGlasses]= useState(6);

  const titles = {
    dose:   ['Log a dose',   'Tap the site, confirm the amount.'],
    weight: ['Log weight',   'Morning, post-bathroom, same scale.'],
    meal:   ['Log a meal',   'Estimate protein — close beats perfect.'],
    water:  ['Log water',    'Tap each glass you finished.'],
  };
  const [title, sub] = titles[kind] || titles.dose;

  const submit = (e) => {
    e.preventDefault();
    onSave({ kind, dose, unit, site, weight, meal, protein, glasses });
  };

  return (
    <div className="scrim" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="log-title">
        <div className="modal-head">
          <div>
            <span className="eyebrow">Quick log</span>
            <h3 className="modal-title" id="log-title">{title}</h3>
            <p className="modal-sub">{sub}</p>
          </div>
          <button className="modal-close" onClick={onClose} aria-label="Close">
            <Icon d={I.cross} sw={1.8} size={18} />
          </button>
        </div>

        <form onSubmit={submit}>
          {kind === 'dose' && (
            <React.Fragment>
              <div className="field">
                <label className="field-label">DOSE</label>
                <div className="field-input">
                  <span style={{paddingLeft:14,color:'var(--color-text-tertiary)'}}>
                    <Icon d={I.syringe} sw={1.8} size={16} />
                  </span>
                  <input value={dose} onChange={e => setDose(e.target.value)} aria-label="Dose amount" />
                  <span className="unit">mg</span>
                </div>
              </div>
              <div className="field">
                <label className="field-label">SITE</label>
                <div className="pill-group">
                  {[
                    ['abdomen-ul', 'Abdomen UL'],
                    ['abdomen-ur', 'Abdomen UR'],
                    ['abdomen-ll', 'Abdomen LL'],
                    ['abdomen-lr', 'Abdomen LR'],
                    ['thigh-l',    'Left thigh'],
                    ['thigh-r',    'Right thigh'],
                  ].map(([id, label]) => (
                    <button type="button" key={id} className="pill-toggle"
                            data-active={site === id} onClick={() => setSite(id)}>
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            </React.Fragment>
          )}

          {kind === 'weight' && (
            <div className="field">
              <label className="field-label">WEIGHT</label>
              <div className="field-input">
                <span style={{paddingLeft:14,color:'var(--color-text-tertiary)'}}>
                  <Icon d={I.scale} sw={1.8} size={16} />
                </span>
                <input value={weight} onChange={e => setWeight(e.target.value)} aria-label="Weight" />
                <span className="unit">kg</span>
              </div>
            </div>
          )}

          {kind === 'meal' && (
            <React.Fragment>
              <div className="field">
                <label className="field-label">WHAT YOU ATE</label>
                <div className="field-input">
                  <input value={meal} onChange={e => setMeal(e.target.value)} aria-label="Meal" style={{padding:'12px 16px'}}/>
                </div>
              </div>
              <div className="field">
                <label className="field-label">PROTEIN</label>
                <div className="field-input">
                  <span style={{paddingLeft:14,color:'var(--color-text-tertiary)'}}>
                    <Icon d={I.beef} sw={1.8} size={16} />
                  </span>
                  <input value={protein} onChange={e => setProtein(e.target.value)} aria-label="Protein grams" />
                  <span className="unit">g</span>
                </div>
              </div>
            </React.Fragment>
          )}

          {kind === 'water' && (
            <div className="field">
              <label className="field-label">GLASSES TODAY</label>
              <div style={{display:'flex', gap:8, flexWrap:'wrap', marginTop:4}}>
                {Array.from({length: 8}).map((_, i) => (
                  <button type="button" key={i}
                          onClick={() => setGlasses(i + 1)}
                          aria-label={`Glass ${i+1}`}
                          style={{
                            width:44, height:54, borderRadius:12,
                            background: i < glasses ? 'var(--color-info-soft)' : 'var(--color-surface-elevated)',
                            color: i < glasses ? 'var(--color-info)' : 'var(--color-text-tertiary)',
                            border:'1px solid var(--color-border)',
                            display:'inline-flex', alignItems:'center', justifyContent:'center',
                            transition:'all 200ms var(--ease-out-quart)',
                          }}>
                    <Icon d={I.droplet} sw={1.8} size={20} />
                  </button>
                ))}
              </div>
              <p style={{fontSize:12, color:'var(--color-text-tertiary)', marginTop:6}}>
                <span className="tnum" style={{color:'var(--color-text-secondary)', fontWeight:600}}>{glasses}/8</span> today
              </p>
            </div>
          )}

          <button type="submit" className="btn btn-primary" style={{width:'100%', marginTop:20, height:44, fontSize:14}}>
            Save log <Icon d={I.arrowRight} sw={2} size={14} />
          </button>
        </form>
      </div>
    </div>
  );
}

function Toast({ msg, onDone }) {
  React.useEffect(() => {
    const t = setTimeout(onDone, 2800);
    return () => clearTimeout(t);
  }, [onDone]);
  return (
    <div className="toast">
      <Icon d={I.sparkles} sw={2} size={14} /> {msg}
    </div>
  );
}

Object.assign(window, { LogModal, Toast });
