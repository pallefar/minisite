// App shell: Sidebar (80 px rail), Topbar, MobileNav.
// Reads Icon, I from window.

const { useState } = React;

const TABS = [
  { id: 'home',        label: 'Today',       short: 'Today', d: I.home },
  { id: 'medication',  label: 'Medication',  short: 'Shot',  d: I.syringe },
  { id: 'symptoms',    label: 'Side effects',short: 'Sx',    d: I.shield },
  { id: 'body',        label: 'Body',        short: 'Body',  d: I.user },
  { id: 'nutrition',   label: 'Nutrition',   short: 'Food',  d: I.apple },
  { id: 'activity',    label: 'Activity',    short: 'Move',  d: I.activity },
  { id: 'supplements', label: 'Stack',       short: 'Stack', d: I.pill },
  { id: 'mood',        label: 'Mood',        short: 'Mood',  d: I.smile },
  { id: 'insights',    label: 'Wins',        short: 'Wins',  d: I.trophy },
];

const TAB_TITLES = {
  home:       { title: 'Today',            sub: 'Your daily focus and live status' },
  medication: { title: 'Medication',       sub: 'Doses, sites, supply, titration' },
  symptoms:   { title: 'Side effects',     sub: 'Track what you feel · severity & timing' },
  body:       { title: 'Body',             sub: 'Weight, measurements, photos' },
  nutrition:  { title: 'Nutrition',        sub: 'Protein, calories, water' },
  activity:   { title: 'Activity',         sub: 'Steps, workouts, lifting' },
  supplements:{ title: 'Stack',            sub: 'Supplements you take, when' },
  mood:       { title: 'Mood',             sub: 'Sleep, energy, focus' },
  insights:   { title: 'Wins',             sub: 'Streaks, milestones, AI insights' },
};

function Sidebar({ current, onChange, onTheme, theme, onSettings, expanded, onToggle }) {
  return (
    <React.Fragment>
      <aside className="sidebar" aria-label="Primary navigation">
        <div className="sb-head">
          <button className="sb-brand" aria-label="LeanShot home" onClick={() => onChange('home')}>
            <Icon d={I.zap} sw={2} size={18} />
          </button>
          <span className="sb-brand-label">LeanShot</span>
        </div>
        <nav className="sb-tabs">
          {TABS.map(t => (
            <button
              key={t.id}
              className="sb-tab"
              data-active={current === t.id}
              aria-label={t.label}
              aria-current={current === t.id ? 'page' : undefined}
              onClick={() => onChange(t.id)}>
              <Icon d={t.d} sw={current === t.id ? 2.2 : 1.8} size={20} />
              <span className="sb-tab-label">{t.label}</span>
              <span className="sb-tooltip">{t.label}</span>
            </button>
          ))}
        </nav>
        <div className="sb-footer">
          <button className="sb-tab" aria-label="AI coach">
            <Icon d={I.bot} sw={1.8} size={20} />
            <span className="sb-tab-label">AI coach</span>
            <span className="sb-tooltip">AI coach</span>
          </button>
          <button className="sb-tab" aria-label="Theme" onClick={onTheme}>
            <Icon d={theme === 'light' ? I.moon : I.sun} sw={1.8} size={20} />
            <span className="sb-tab-label">{theme === 'light' ? 'Dark mode' : 'Light mode'}</span>
            <span className="sb-tooltip">{theme === 'light' ? 'Dark mode' : 'Light mode'}</span>
          </button>
          <button className="sb-tab" aria-label="Settings" onClick={onSettings}>
            <Icon d={I.settings} sw={1.8} size={20} />
            <span className="sb-tab-label">Settings</span>
            <span className="sb-tooltip">Settings</span>
          </button>
          <div className="sb-avatar-row">
            <span className="sb-avatar" aria-label="Account">K</span>
            <div className="sb-avatar-meta">
              <span className="sb-avatar-name">Karsten B.</span>
              <span className="sb-avatar-sub">Mounjaro · Wk 8</span>
            </div>
          </div>
        </div>
      </aside>
      {/* Floating toggle — sibling of the sidebar so it sits on the border seam,
          half-overlapping the sidebar and half on the main pane. */}
      <button
        className="sb-toggle"
        aria-label={expanded ? 'Collapse sidebar' : 'Expand sidebar'}
        aria-expanded={expanded}
        onClick={onToggle}>
        <Icon d={I.chevRight} sw={2.4} size={14} />
      </button>
    </React.Fragment>
  );
}

function Topbar({ current, onLogDose, onTheme, theme }) {
  const meta = TAB_TITLES[current] ?? TAB_TITLES.home;
  return (
    <header className="topbar">
      <div className="topbar-titles">
        <h1 className="topbar-h1">{meta.title}</h1>
        <p className="topbar-sub">{meta.sub}</p>
      </div>
      <div className="topbar-actions">
        <div className="search-bar">
          <Icon d={I.search} sw={1.8} size={16} />
          <input placeholder="Jump to weight, food, mood…" aria-label="Search" />
        </div>
        <button className="btn btn-ghost" aria-label="Toggle theme" onClick={onTheme}>
          <Icon d={theme === 'light' ? I.moon : I.sun} sw={1.8} size={18} />
        </button>
        <button className="btn btn-secondary" aria-label="Export report">
          <Icon d={I.fileDown} sw={1.8} size={14} /><span>Export</span>
        </button>
        <button className="btn btn-primary" onClick={onLogDose} aria-label="Log dose">
          Log dose <Icon d={I.plus} sw={2.2} size={14} />
        </button>
      </div>
    </header>
  );
}

function MobileNav({ current, onChange }) {
  return (
    <nav className="mobile-nav" aria-label="Primary navigation">
      <div className="mobile-nav-inner">
        {TABS.map(t => (
          <button key={t.id} data-active={current === t.id} onClick={() => onChange(t.id)}
                  aria-label={t.label}>
            <Icon d={t.d} sw={current === t.id ? 2.2 : 1.8} size={20} />
            <span className="mn-label">{t.short}</span>
          </button>
        ))}
      </div>
    </nav>
  );
}

Object.assign(window, { Sidebar, Topbar, MobileNav, TAB_TITLES });
