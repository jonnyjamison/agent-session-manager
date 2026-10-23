import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import './style.css';
import type { CliInfo, ContextSource, ContextState, ExternalSnapshot, Provider, Session, TerminalEvent, Workspace } from '../electron/types';
import { api } from './bridge';
import { AttentionHub, ContextHub, originLabel, type EditorTarget } from './ContextHub';
const providerName = (p: Provider) => p === 'claude' ? 'Claude Code' : 'Codex';

function TerminalPane({ session, active }: { session: Session; active: boolean }) {
  const host = useRef<HTMLDivElement>(null);
  const instance = useRef<{ terminal: Terminal; fit: FitAddon } | null>(null);
  useEffect(() => {
    const terminal = new Terminal({ cursorBlink: true, fontSize: 14, fontFamily: 'Cascadia Code, Consolas, monospace', scrollback: 10000, theme: { background: '#101318', foreground: '#dfe5ed', cursor: '#b9e89e', selectionBackground: '#3f515c' }, allowProposedApi: false });
    const fit = new FitAddon(); terminal.loadAddon(fit); terminal.open(host.current!);
    instance.current = { terminal, fit };
    // Subscribe before requesting history; queue output until the snapshot arrives.
    let ready = false; let disposed = false; let queued: TerminalEvent[] = [];
    const unsubscribe = api.onData(event => { if (event.id === session.id) { if (ready) terminal.write(event.data); else queued.push(event); } });
    api.snapshot(session.id).then(snapshot => { if (disposed) return; terminal.write(snapshot.data); for (const event of queued) if (event.sequence > snapshot.sequence) terminal.write(event.data); queued = []; ready = true; }).catch(() => { if (disposed) return; ready = true; for (const event of queued) terminal.write(event.data); });
    const input = terminal.onData(data => api.input(session.id, data));
    const resize = () => { if (host.current && host.current.clientWidth > 0) { fit.fit(); api.resize(session.id, terminal.cols, terminal.rows); } };
    const observer = new ResizeObserver(resize); observer.observe(host.current!);
    return () => { disposed = true; unsubscribe(); observer.disconnect(); input.dispose(); terminal.dispose(); instance.current = null; };
  }, [session.id]);
  useEffect(() => { if (active && instance.current) { const { terminal, fit } = instance.current; requestAnimationFrame(() => { fit.fit(); api.resize(session.id, terminal.cols, terminal.rows); terminal.focus(); }); } }, [active, session.status]);
  return <div className={`terminal-pane ${active ? 'visible' : ''}`} ref={host} aria-label={`${session.name} terminal`} />;
}

function App() {
  const [view, setView] = useState<'sessions' | 'attention' | 'context'>('sessions');
  const [context, setContext] = useState<ContextState>({ version: 1, attention: [], checkpoints: [], sources: [], notifications: false });
  const [editorTarget, setEditorTarget] = useState<EditorTarget | null>(null);
  const [flagging, setFlagging] = useState(false); const [flagReason, setFlagReason] = useState('');
  const [external, setExternal] = useState<ExternalSnapshot>({ sessions: [], checkedAt: null, error: null });
  const [externalId, setExternalId] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const selectedExternal = external.sessions.find(s => s.id === externalId);
  const [workspace, setWorkspace] = useState<Workspace>({ sessions: [], activeId: null });
  const [clis, setClis] = useState<CliInfo>({ claude: null, codex: null });
  const [provider, setProvider] = useState<Provider>('claude');
  const [name, setName] = useState(''); const [folder, setFolder] = useState('');
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false); const [rename, setRename] = useState(false); const [newName, setNewName] = useState('');
  const active = workspace.sessions.find(s => s.id === workspace.activeId);
  const source: ContextSource | null = selectedExternal ? { id: selectedExternal.id, kind: 'external', provider: selectedExternal.provider, name: selectedExternal.name, cwd: selectedExternal.projectFolder } : active ? { id: active.id, kind: 'managed', provider: active.provider, name: active.name, cwd: active.cwd } : null;
  const openAttention = context.attention.filter(a => !a.resolvedAt);
  const sourceAttention = openAttention.filter(a => a.source.id === source?.id);
  function checkpoint(target: EditorTarget) { void run(async () => { await api.rememberSource(target.source.id); setEditorTarget(target); setView('context'); }); }
  function openSource(target: ContextSource) {
    if (target.kind === 'managed') { const session = workspace.sessions.find(s => s.id === target.id); if (session) { void run(() => select(session)); return; } }
    else if (external.sessions.some(s => s.id === target.id)) { setExternalId(target.id); setView('sessions'); setCreating(false); setFlagging(false); return; }
    setError('This session is no longer available. Its saved context remains in the library.');
  }
  useEffect(() => {
    api.context().then(setContext).catch(e => setError(String(e)));
    const offContext = api.onContext(setContext);
    const offOpen = api.onAttentionOpen(() => setView('attention'));
    return () => { offContext(); offOpen(); };
  }, []);
  useEffect(() => {
    Promise.all([api.workspace(), api.clis()]).then(([w, c]) => { setWorkspace(w); setClis(c); setCreating(w.sessions.length === 0); }).catch(e => setError(String(e)));
    return api.onSession(session => setWorkspace(w => ({ ...w, sessions: w.sessions.some(s => s.id === session.id) ? w.sessions.map(s => s.id === session.id ? session : s) : [...w.sessions, session] })));
  }, []);
  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try { const snapshot = await api.external(); if (!disposed) setExternal(snapshot); }
      catch { if (!disposed) setExternal(s => ({ ...s, error: 'External process monitoring is unavailable.' })); }
      if (!disposed) timer = setTimeout(poll, 5000);
    }
    void poll();
    return () => { disposed = true; clearTimeout(timer); };
  }, []);
  async function refreshExternal() { setScanning(true); try { setExternal(await api.external()); } finally { setScanning(false); } }
  async function run(action: () => Promise<unknown>) { setBusy(true); setError(''); try { await action(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); } }
  async function select(session: Session) { await api.select(session.id); setWorkspace(w => ({ ...w, activeId: session.id })); setExternalId(null); setCreating(false); setRename(false); setView('sessions'); setFlagging(false); }
  return <div className="app">
    <aside>
      <div className="brand"><span className="brand-icon">⌘</span><div>Session Manager<small>YOUR LOCAL AGENT WORKSPACE</small></div></div>
      <button className="new-session" onClick={() => { setCreating(true); setView('sessions'); }}>＋ New session <kbd>LOCAL</kbd></button>
      <div className="workspace-tools"><button className={view === 'attention' ? 'tool-selected' : ''} onClick={() => setView('attention')}>Needs me <span className={openAttention.length ? 'attention-count' : ''}>{openAttention.length}</span></button><button className={view === 'context' ? 'tool-selected' : ''} onClick={() => { setEditorTarget(null); setView('context'); }}>Context library <span>{context.checkpoints.length}</span></button></div>
      <div className="sidebar-label">WORKSPACE <span>{workspace.sessions.length}</span></div>
      <nav aria-label="Sessions grouped by status">
        {(['running', 'stopped', 'error'] as const).map(status => {
          const sessions = workspace.sessions.filter(s => s.status === status);
          return <section className="group" key={status}><h2><i className={`dot ${status}`} />{status}<span>{sessions.length}</span></h2>
            {sessions.map(session => <button className={`session ${view === 'sessions' && !externalId && active?.id === session.id ? 'selected' : ''}`} key={session.id} onClick={() => void run(() => select(session))}>
              <span className={`badge ${session.provider}`}>{session.provider === 'claude' ? 'C' : 'O'}</span><span className="session-text"><strong>{session.name}</strong><small>{session.cwd.split(/[\\/]/).filter(Boolean).pop()}</small></span><span className="session-arrow">{openAttention.some(a => a.source.id === session.id) ? '●' : '›'}</span>
            </button>)}
            {!sessions.length && <p className="empty-group">No {status} sessions</p>}
          </section>;
        })}
        <section className="group external-group"><h2>External sessions<span>{external.sessions.filter(s => s.status === 'running').length} live</span></h2>
          <p className="external-hint">Monitor only · checks every 5 seconds</p>
          <button className="refresh-external" disabled={scanning} onClick={() => void run(refreshExternal)}>{scanning ? 'Checking…' : 'Refresh processes'}</button>
          {external.error && <p className="external-warning" role="status">{external.error}</p>}
          {!external.sessions.length && <p className="empty-group">{external.checkedAt ? 'No external agents detected' : 'Scanning Windows processes…'}</p>}
          {external.sessions.map(session => <button key={session.id} className={`session ${view === 'sessions' && externalId === session.id && !creating ? 'selected' : ''}`} onClick={() => { setExternalId(session.id); setCreating(false); setView('sessions'); setFlagging(false); }}><span className={`badge ${session.provider}`}>{session.provider === 'claude' ? 'C' : 'O'}</span><span className="session-text"><strong>{session.name}</strong><small>{session.status === 'running' ? 'Running' : 'Exited'} · PID {session.pid}</small></span><i className={`dot ${session.status}`}/></button>)}
        </section>
      </nav>
      <div className="local-status"><span className="dot running"/> Local execution<small>Terminals run on this computer</small></div>
    </aside>
    <main>
      <header><div className="breadcrumb">Workspace <span>/</span> {view === 'attention' ? 'Needs me' : view === 'context' ? 'Context library' : creating ? 'New session' : selectedExternal?.name ?? active?.name ?? 'Overview'}</div><span className="local-pill">● WINDOWS / LOCAL</span></header>
      {error && <div className="app-error" role="alert">{error}<button onClick={() => setError('')} aria-label="Dismiss error">×</button></div>}
      {view === 'attention' && <AttentionHub state={context} onOpen={openSource} onCheckpoint={checkpoint} onError={setError}/>}
      {view === 'context' && <ContextHub state={context} target={editorTarget} setTarget={setEditorTarget} onError={setError}/>}
      {view === 'sessions' && !creating && source && <><div className="source-tools"><button onClick={() => checkpoint({ source })}>Save checkpoint</button><button onClick={() => { setFlagging(!flagging); setFlagReason(''); }}>Flag needs me</button><button onClick={() => { setEditorTarget(null); setView('context'); }}>View handovers</button></div>{flagging && <form className="flag-form" onSubmit={e => { e.preventDefault(); void run(async () => { await api.flag(source.id, flagReason); setFlagging(false); }); }}><input aria-label="Why does this session need you?" placeholder="What needs a decision or follow-up?" value={flagReason} maxLength={1000} required onChange={e => setFlagReason(e.target.value)} autoFocus/><button disabled={busy}>Add to queue</button></form>}{sourceAttention.map(a => <div className="attention-banner" key={a.id}><div><strong>{a.reason}</strong><small>{originLabel[a.origin]}</small></div><button onClick={() => void run(() => api.resolveAttention(a.id))}>Resolve</button></div>)}</>}
      {view === 'sessions' && selectedExternal && !creating && <section className="external-details"><div className="eyebrow">EXTERNAL SESSION · MONITOR ONLY</div><h1>{selectedExternal.name}</h1><p>This agent was launched outside Session Manager. Continue interacting with it in its original terminal.</p><dl><dt>Provider</dt><dd>{providerName(selectedExternal.provider)}</dd><dt>Process</dt><dd>{selectedExternal.pid}</dd><dt>Status</dt><dd>{external.error ? 'Unknown · last known ' : ''}{selectedExternal.status === 'running' ? 'Running' : 'Exited'}</dd><dt>Started</dt><dd>{selectedExternal.startedAt ? new Date(selectedExternal.startedAt).toLocaleString() : 'Unavailable'}</dd><dt>Project folder</dt><dd>{selectedExternal.projectFolder ?? 'Unavailable · Windows does not report its working directory'}</dd><dt>Last successful check</dt><dd>{external.checkedAt ? new Date(external.checkedAt).toLocaleTimeString() : 'Not yet checked'}</dd></dl><p>Process status does not indicate whether the agent is thinking or awaiting input. External terminals cannot be attached, controlled, or stopped here. Closing this app leaves them running.</p><button disabled={scanning} onClick={() => void run(refreshExternal)}>Refresh status</button></section>}
      <div className="terminal-workspace" style={{ display: view !== 'sessions' || creating || !active || !!selectedExternal ? 'none' : 'flex' }}>
        <div className="session-header"><div><div className="eyebrow">{active ? providerName(active.provider) : ''}<span className={`status-label ${active?.status}`}>{active?.status}</span></div><h1>{active?.name}</h1><p title={active?.cwd}>{active?.cwd}</p></div>
          {active && <div className="actions"><button disabled={busy} onClick={() => { setRename(!rename); setNewName(active.name); }}>Rename</button>{active.status === 'running' ? <button disabled={busy} onClick={() => void run(() => api.stop(active.id))}>Stop session</button> : <><button disabled={busy} onClick={() => void run(() => api.restart(active.id))}>Start again</button><button disabled={busy} onClick={() => void run(async () => { const w = await api.remove(active.id); setWorkspace(w); if (!w.sessions.length) setCreating(true); })}>Remove</button></>}</div>}
        </div>
        {rename && active && <form className="rename" onSubmit={e => { e.preventDefault(); void run(async () => { await api.rename(active.id, newName); setRename(false); }); }}><input aria-label="Session name" value={newName} maxLength={100} onChange={e => setNewName(e.target.value)} autoFocus/><button disabled={busy}>Save name</button></form>}
        <div className="terminal-toolbar"><span>›_ TERMINAL</span><span>Persistent while switching sessions</span></div>
        <div className="terminals">{workspace.sessions.map(session => <TerminalPane key={session.id} session={session} active={view === 'sessions' && !creating && !selectedExternal && session.id === active?.id}/>)}</div>
        <footer><span><i className={`dot ${active?.status}`}/>{active?.status === 'running' ? 'CLI process running' : `Process stopped${active?.exitCode !== undefined ? ` · exit ${active.exitCode}` : ''}`}</span><span>ConPTY · xterm.js</span></footer>
      </div>
      {view === 'sessions' && (creating || (!active && !selectedExternal)) && <div className="setup"><div className="setup-heading"><div className="eyebrow">ONE WORKSPACE. BOTH AGENTS.</div><h1>Start something good.</h1><p>Choose an agent and a project. Your terminal stays with you.</p></div>
        <form onSubmit={e => { e.preventDefault(); void run(async () => { const s = await api.create(provider, name.trim() || `${providerName(provider)} session`, folder); setWorkspace(w => ({ sessions: w.sessions.some(x => x.id === s.id) ? w.sessions.map(x => x.id === s.id ? s : x) : [...w.sessions, s], activeId: s.id })); setExternalId(null); setCreating(false); setName(''); }); }}>
          <label>01 <span>CHOOSE YOUR AGENT</span></label><div className="providers">{(['claude', 'codex'] as const).map(p => <button type="button" className={`provider-card ${p === provider ? 'chosen' : ''}`} key={p} onClick={() => setProvider(p)}><span className={`badge ${p}`}>{p === 'claude' ? 'C' : 'O'}</span><strong>{providerName(p)}</strong><small>{clis[p] ? '● Installed locally' : '○ Not found on PATH'}</small></button>)}</div>
          <label htmlFor="session-name">02 <span>SESSION NAME</span></label><input id="session-name" value={name} onChange={e => setName(e.target.value)} maxLength={100} placeholder="e.g. API refactor"/>
          <label>03 <span>PROJECT FOLDER</span></label><div className="folder-picker"><div title={folder}>{folder || 'Select a project directory'}</div><button type="button" disabled={busy} onClick={() => void run(async () => { const f = await api.pickFolder(); if (f) setFolder(f); })}>Browse…</button></div>
          <button className="launch" disabled={busy || !folder || !clis[provider]}>{busy ? 'Starting…' : 'Launch session'} <span>↗</span></button>
          {active && <button type="button" className="cancel" onClick={() => setCreating(false)}>Back to terminal</button>}
        </form><p className="setup-note">Uses your installed CLI and existing authentication.<br/>Workspace details are saved. Processes stop when the app closes.</p>
      </div>}
    </main>
  </div>;
}
createRoot(document.getElementById('root')!).render(<App/>);
