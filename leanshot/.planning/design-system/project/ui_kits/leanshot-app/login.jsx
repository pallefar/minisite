// Login page — split-screen sign-in / sign-up
// Right: form. Left: brand hero with content + illustration.

const { useState: useStateAuth, useEffect: useEffectAuth } = React;

/* ----- Icons (subset; relies on global I + Icon) ----- */
const AI = {
  mail:    '<rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>',
  eye:     '<path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"/><circle cx="12" cy="12" r="3"/>',
  eyeOff:  '<path d="M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49"/><path d="M14.084 14.158a3 3 0 0 1-4.242-4.242"/><path d="M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143"/><path d="m2 2 20 20"/>',
  lock:    '<rect width="18" height="11" x="3" y="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  google:  '<path d="M21.35 11.1H12v3.2h5.35c-.23 1.51-1.69 4.43-5.35 4.43A6.18 6.18 0 0 1 5.83 12 6.18 6.18 0 0 1 12 5.83c1.95 0 3.26.83 4.01 1.55l2.74-2.64A9.96 9.96 0 0 0 12 2a10 10 0 0 0 0 20c5.77 0 9.6-4.05 9.6-9.76 0-.66-.07-1.16-.16-1.6Z" fill="currentColor"/>',
  apple:   '<path d="M16.36 12.34c.02-2.04 1.66-3.01 1.73-3.06-.94-1.39-2.4-1.58-2.92-1.6-1.25-.13-2.42.73-3.05.73-.62 0-1.6-.71-2.64-.69-1.36.02-2.62.79-3.32 2-1.42 2.45-.36 6.07 1.02 8.06.68.97 1.49 2.06 2.55 2.02 1.02-.04 1.41-.66 2.65-.66 1.23 0 1.59.66 2.67.64 1.1-.02 1.8-.99 2.47-1.97.78-1.13 1.1-2.23 1.12-2.29-.02-.01-2.15-.83-2.18-3.28zM14.06 6.46c.56-.68.94-1.62.84-2.55-.81.04-1.79.54-2.37 1.21-.52.6-.97 1.55-.85 2.47.9.07 1.82-.46 2.38-1.13z" fill="currentColor"/>',
  arrowR:  '<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>',
  zap:     '<path d="M13 2L3 14h7l-1 8 11-14h-7l1-6z"/>',
  shield:  '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/>',
  check:   '<path d="M20 6 9 17l-5-5"/>',
  hospital:'<path d="M12 6v4"/><path d="M14 14h-4"/><path d="M14 18h-4"/><path d="M14 8h-4"/><path d="M18 12h2a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-6a2 2 0 0 1 2-2h2"/><path d="M18 22V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v18"/>',
};

function AuthHero() {
  return (
    <section className="auth-hero">
      <div className="auth-brand">
        <span className="auth-brand-mark">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
            <path d="M13 2L3 14h7l-1 8 11-14h-7l1-6z"/>
          </svg>
        </span>
        LeanShot
      </div>

      <img src="assets/login-hero.svg" className="auth-hero-art" alt="" />

      <div className="auth-headline">
        <p className="auth-eyebrow">Clinical GLP-1 tracking</p>
        <h1 className="auth-title">
          Every dose, site, and pound. <span className="fr">One place.</span>
        </h1>
        <p className="auth-sub">
          The pharmacology curve, vial supply, and doctor-ready summaries —
          built around how GLP-1 actually works in your body.
        </p>

        <div className="auth-trust">
          <span className="auth-trust-item">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" dangerouslySetInnerHTML={{__html: AI.lock}} />
            Local-only data
          </span>
          <span className="auth-trust-item">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" dangerouslySetInnerHTML={{__html: AI.shield}} />
            No third-party analytics
          </span>
          <span className="auth-trust-item">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" dangerouslySetInnerHTML={{__html: AI.check}} />
            Open data export
          </span>
        </div>
      </div>

      <div className="auth-testimonial">
        <p className="auth-testimonial-quote">
          Finally a tracker that knows the difference between a half-life and a streak.
        </p>
        <div className="auth-testimonial-cite">
          <span className="auth-testimonial-avatar">K</span>
          <div>
            <p className="auth-testimonial-name">Karsten B.</p>
            <p className="auth-testimonial-role">Mounjaro · 14 weeks</p>
          </div>
        </div>
      </div>
    </section>
  );
}

function AuthForm() {
  const [mode, setMode]     = useStateAuth('signin');   // 'signin' | 'signup'
  const [email, setEmail]   = useStateAuth('');
  const [pwd,   setPwd]     = useStateAuth('');
  const [show,  setShow]    = useStateAuth(false);
  const [remember, setRemember] = useStateAuth(true);
  const [loading, setLoading]   = useStateAuth(false);
  const [done,    setDone]      = useStateAuth(false);

  const submit = (e) => {
    e.preventDefault();
    setLoading(true);
    setTimeout(() => { setLoading(false); setDone(true); }, 900);
  };

  if (done) {
    return (
      <section className="auth-form-wrap">
        <div className="auth-form-inner" style={{textAlign:'center'}}>
          <div style={{
            width:64, height:64, borderRadius:20,
            background:'var(--color-success-soft)', color:'var(--color-success)',
            display:'inline-flex', alignItems:'center', justifyContent:'center',
            margin:'0 auto',
          }}>
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                 strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
                 dangerouslySetInnerHTML={{__html: AI.check}} />
          </div>
          <h2 className="auth-form-title" style={{marginTop:18}}>
            You're <span className="fr">in.</span>
          </h2>
          <p className="auth-form-sub" style={{marginTop:6}}>
            Loading your dashboard…
          </p>
          <a href="index.html" className="auth-submit" style={{marginTop:24, textDecoration:'none'}}>
            Continue
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                 strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                 dangerouslySetInnerHTML={{__html: AI.arrowR}} />
          </a>
        </div>
      </section>
    );
  }

  return (
    <section className="auth-form-wrap">
      <div className="auth-form-inner">
        <div className="auth-tabs" role="tablist">
          <button className="auth-tab" data-active={mode === 'signin'} onClick={() => setMode('signin')}>Sign in</button>
          <button className="auth-tab" data-active={mode === 'signup'} onClick={() => setMode('signup')}>Sign up</button>
        </div>

        <p className="auth-form-eyebrow">{mode === 'signin' ? 'Welcome back' : 'Get started'}</p>
        <h2 className="auth-form-title">
          {mode === 'signin' ? (
            <React.Fragment>Pick up where you <span className="fr">left off.</span></React.Fragment>
          ) : (
            <React.Fragment>Start your <span className="fr">journey.</span></React.Fragment>
          )}
        </h2>
        <p className="auth-form-sub">
          {mode === 'signin'
            ? 'Sign in to see your curve, last dose, and today\'s focus.'
            : 'Free forever. Local-first. No card required.'}
        </p>

        <div className="auth-sso">
          <button type="button" aria-label="Continue with Google">
            <svg width="18" height="18" viewBox="0 0 24 24" dangerouslySetInnerHTML={{__html: AI.google}} />
            Google
          </button>
          <button type="button" aria-label="Continue with Apple">
            <svg width="18" height="18" viewBox="0 0 24 24" dangerouslySetInnerHTML={{__html: AI.apple}} />
            Apple
          </button>
        </div>

        <div className="auth-divider">or with email</div>

        <form onSubmit={submit} noValidate>
          <div className="auth-field">
            <label className="auth-field-label" htmlFor="auth-email">Email</label>
            <div className="auth-input">
              <span className="auth-input-icon">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                     strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"
                     dangerouslySetInnerHTML={{__html: AI.mail}} />
              </span>
              <input id="auth-email" type="email" autoComplete="email"
                     placeholder="you@leanshot.app"
                     value={email} onChange={e => setEmail(e.target.value)} />
            </div>
          </div>
          <div className="auth-field">
            <label className="auth-field-label" htmlFor="auth-pwd">
              Password
              {mode === 'signin' && <a href="#forgot" className="auth-field-link">Forgot?</a>}
            </label>
            <div className="auth-input">
              <span className="auth-input-icon">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                     strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"
                     dangerouslySetInnerHTML={{__html: AI.lock}} />
              </span>
              <input id="auth-pwd" type={show ? 'text' : 'password'}
                     autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
                     placeholder={mode === 'signin' ? 'Your password' : 'At least 8 characters'}
                     value={pwd} onChange={e => setPwd(e.target.value)} />
              <button type="button" className="auth-input-icon"
                      aria-label={show ? 'Hide password' : 'Show password'}
                      onClick={() => setShow(s => !s)}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                     strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"
                     dangerouslySetInnerHTML={{__html: show ? AI.eyeOff : AI.eye}} />
              </button>
            </div>
          </div>
          <label className="auth-checkbox">
            <input type="checkbox" checked={remember} onChange={e => setRemember(e.target.checked)} />
            <span className="auth-checkbox-box"></span>
            {mode === 'signin' ? 'Keep me signed in on this device' : 'I agree to the Terms & Privacy notice'}
          </label>

          <button type="submit" className="auth-submit" disabled={loading}>
            {loading
              ? <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" style={{animation:'spin 0.8s linear infinite'}}><path d="M21 12a9 9 0 1 1-6.2-8.6"/></svg>
              : (mode === 'signin' ? 'Sign in' : 'Create account')}
            {!loading && (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                   strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                   dangerouslySetInnerHTML={{__html: AI.arrowR}} />
            )}
          </button>
        </form>

        <p className="auth-footer">
          {mode === 'signin' ? (
            <React.Fragment>New here? <a href="#" onClick={(e) => { e.preventDefault(); setMode('signup'); }}>Create an account</a></React.Fragment>
          ) : (
            <React.Fragment>Already have an account? <a href="#" onClick={(e) => { e.preventDefault(); setMode('signin'); }}>Sign in</a></React.Fragment>
          )}
        </p>

        <p className="auth-meta">
          <a href="#privacy">Privacy</a>
          <a href="#terms">Terms</a>
          <a href="#help">Help</a>
        </p>
      </div>
    </section>
  );
}

function AuthApp() {
  return (
    <div className="auth">
      <AuthHero />
      <AuthForm />
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<AuthApp />);
