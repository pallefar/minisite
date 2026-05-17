// App entry — wires shell + tabs + log modal + theme

const { useState: useStateApp } = React;

function App() {
  const [current, setCurrent] = useStateApp('home');
  const [logKind, setLogKind] = useStateApp(null);
  const [toast,   setToast]   = useStateApp(null);
  const [theme,   setTheme]   = useStateApp('light');
  const [expanded, setExpanded] = useStateApp(() => {
    try { return localStorage.getItem('leanshot_kit_sidebar') === 'expanded'; }
    catch (_) { return false; }
  });

  React.useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  React.useEffect(() => {
    document.body.setAttribute('data-sidebar', expanded ? 'expanded' : 'collapsed');
    try { localStorage.setItem('leanshot_kit_sidebar', expanded ? 'expanded' : 'collapsed'); }
    catch (_) {}
  }, [expanded]);

  const openLog = (kind) => setLogKind(kind);
  const closeLog = () => setLogKind(null);
  const saveLog = (data) => {
    const kindLabels = { dose: 'Dose logged', weight: 'Weight logged', meal: 'Meal logged', water: 'Water logged' };
    setLogKind(null);
    setToast(kindLabels[data.kind] || 'Saved');
  };

  let body;
  if (current === 'home')             body = <TodayTab openLog={openLog} />;
  else if (current === 'medication')  body = <MedicationTab openLog={openLog} />;
  else                                body = <GenericTab current={current} />;

  return (
    <div className="app-shell">
      <Sidebar
        current={current}
        onChange={setCurrent}
        onTheme={() => setTheme(t => t === 'light' ? 'dark' : 'light')}
        theme={theme}
        onSettings={() => setToast('Settings — coming soon')}
        expanded={expanded}
        onToggle={() => setExpanded(e => !e)} />
      <main className="app-main">
        <Topbar
          current={current}
          onLogDose={() => openLog('dose')}
          onTheme={() => setTheme(t => t === 'light' ? 'dark' : 'light')}
          theme={theme} />
        {body}
      </main>
      <MobileNav current={current} onChange={setCurrent} />
      {logKind && <LogModal kind={logKind} onClose={closeLog} onSave={saveLog} />}
      {toast && <Toast msg={toast} onDone={() => setToast(null)} />}
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
