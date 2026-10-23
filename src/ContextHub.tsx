import { useEffect, useState } from 'react';
import type { AttentionOrigin, Checkpoint, CheckpointFields, ContextSource, ContextState } from '../electron/types';
import { api } from './bridge';

export const originLabel: Record<AttentionOrigin, string> = { manual: 'You flagged this', inferred: 'Inferred from terminal text', 'terminal-notification': 'CLI terminal notification', 'process-exit': 'Process exit' };
export interface EditorTarget { source: ContextSource; parent?: Checkpoint }
const empty: CheckpointFields = { title: '', goal: '', progress: '', decisions: '', blockers: '', nextSteps: '', references: '', verification: '' };
const fields: [keyof CheckpointFields, string, string][] = [
  ['goal', 'Goal', 'What are we trying to achieve? Include the original request and acceptance criteria.'],
  ['progress', 'Progress', 'What is complete? What is still in progress?'],
  ['decisions', 'Decisions and constraints', 'Why this approach? Preserve tradeoffs, requirements, and rejected options that matter.'],
  ['blockers', 'Blockers / needs attention', 'What needs a decision, approval, or investigation?'],
  ['nextSteps', 'Next steps', 'What should the next person or agent do first?'],
  ['verification', 'Verification', 'Which checks ran, what passed, and what remains unverified?'],
  ['references', 'References and files', 'Relevant paths, issue links, commands, and provider conversation IDs if you know them.']
];
const draftPrefix = 'asm-checkpoint-draft:';
interface Draft { source: ContextSource; parent?: Checkpoint; fields: CheckpointFields; includeGit: boolean; includeTerminal: boolean; updatedAt: string }
function readDrafts(): { key: string; draft: Draft }[] {
  const drafts: { key: string; draft: Draft }[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) { const key = localStorage.key(i)!; if (key.startsWith(draftPrefix)) { const draft = JSON.parse(localStorage.getItem(key)!); if (draft?.source?.id && draft.fields) drafts.push({ key, draft }); } }
  } catch { /* The editor will report a failed draft save. */ }
  return drafts.sort((a, b) => b.draft.updatedAt.localeCompare(a.draft.updatedAt));
}

export function AttentionHub({ state, onOpen, onCheckpoint, onError }: { state: ContextState; onOpen: (source: ContextSource) => void; onCheckpoint: (target: EditorTarget) => void; onError: (message: string) => void }) {
  const [history, setHistory] = useState(false);
  const items = state.attention.filter(a => history ? !!a.resolvedAt : !a.resolvedAt).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const run = (action: () => Promise<unknown>) => { void action().catch(e => onError(String(e))); };
  return <section className="context-page"><div className="eyebrow">YOUR ATTENTION, IN ONE PLACE</div><h1>Needs me</h1><p className="page-intro">Pick up a decision, check a result, or preserve the context before moving on.</p>
    <div className="context-controls"><button className={!history ? 'active-control' : ''} onClick={() => setHistory(false)}>Open ({state.attention.filter(a => !a.resolvedAt).length})</button><button className={history ? 'active-control' : ''} onClick={() => setHistory(true)}>Resolved</button><label className="checkbox-label"><input type="checkbox" checked={state.notifications} onChange={e => run(() => api.notifications(e.target.checked))}/>Windows notifications when app is unfocused</label></div>
    <p className="context-note">Terminal notifications are messages emitted by the CLI. Inferred prompts may be wrong; check the terminal before responding. External sessions support manual flags.</p>
    {!items.length && <div className="context-empty">{history ? 'No resolved items yet.' : 'Nothing needs your attention. You can flag any session manually.'}</div>}
    {items.map(item => <article className="attention-card" key={item.id}><div className="card-top"><strong>{item.source.name}</strong><span className={`origin ${item.origin}`}>{originLabel[item.origin]}</span></div><p>{item.reason}</p><small>{item.source.provider} · {item.source.kind} · {new Date(item.createdAt).toLocaleString()}</small><div className="card-actions"><button onClick={() => onOpen(item.source)}>Open session</button><button onClick={() => onCheckpoint({ source: item.source })}>Save context</button>{!item.resolvedAt && <button onClick={() => run(() => api.resolveAttention(item.id))}>Mark resolved</button>}</div></article>)}
  </section>;
}

function CheckpointEditor({ target, onSaved, onCancel }: { target: EditorTarget; onSaved: (checkpoint: Checkpoint) => void; onCancel: () => void }) {
  const draftKey = `${draftPrefix}${target.source.id}:${target.parent?.id ?? 'new'}`;
  const [initial] = useState(() => { try { return JSON.parse(localStorage.getItem(draftKey) ?? 'null') as Draft | null; } catch { return null; } });
  const [form, setForm] = useState<CheckpointFields>(initial?.fields ?? (target.parent ? Object.fromEntries(Object.keys(empty).map(key => [key, target.parent![key as keyof CheckpointFields]])) as unknown as CheckpointFields : { ...empty, title: `${target.source.name} — handover` }));
  const [includeGit, setIncludeGit] = useState(initial?.includeGit ?? true);
  const [includeTerminal, setIncludeTerminal] = useState(initial?.includeTerminal ?? false);
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const [draftStatus, setDraftStatus] = useState('');
  const [promptCopied, setPromptCopied] = useState(false);
  useEffect(() => {
    try { localStorage.setItem(draftKey, JSON.stringify({ source: target.source, parent: target.parent, fields: form, includeGit, includeTerminal, updatedAt: new Date().toISOString() } satisfies Draft)); setDraftStatus('Draft saved on this computer'); }
    catch { setDraftStatus('Draft could not be saved. Save a checkpoint before closing.'); }
  }, [form, includeGit, includeTerminal, draftKey, target]);
  function update(key: keyof CheckpointFields, value: string) {
    // Save synchronously with typing, including the last keystroke before closing.
    const next = { ...form, [key]: value }; setForm(next);
    try { localStorage.setItem(draftKey, JSON.stringify({ source: target.source, parent: target.parent, fields: next, includeGit, includeTerminal, updatedAt: new Date().toISOString() } satisfies Draft)); } catch { setDraftStatus('Draft could not be saved. Save a checkpoint before closing.'); }
  }
  return <form className="checkpoint-editor" onSubmit={e => { e.preventDefault(); setBusy(true); setError(''); api.saveCheckpoint({ sourceId: target.source.id, fields: form, parentId: target.parent?.id, includeGit, includeTerminal }).then(checkpoint => { localStorage.removeItem(draftKey); onSaved(checkpoint); }).catch(e => setError(String(e))).finally(() => setBusy(false)); }}>
    <div className="eyebrow">{target.parent ? 'NEW REVISION · PREVIOUS CHECKPOINT KEPT' : 'PRESERVE THE HANDOVER'}</div><h1>Session checkpoint</h1><p className="page-intro">{target.source.name} · {target.source.cwd ?? 'Project folder unavailable'}</p><p className="context-note" role="status">{draftStatus}. Notes are written by you; the app does not invent a conversation summary.</p>
    <div className="handover-helper"><button type="button" onClick={() => { api.copyHandoverPrompt().then(() => setPromptCopied(true)).catch(e => setError(String(e))); }}>Copy handover prompt</button><p className="context-note">{promptCopied ? 'Prompt copied. Paste it into the original CLI, then bring its summary back into these fields.' : 'Ask the current agent to summarize what it knows. Review its response and preserve the useful details here.'}</p></div>
    <label htmlFor="checkpoint-title">Checkpoint title</label><input id="checkpoint-title" value={form.title} maxLength={160} required onChange={e => update('title', e.target.value)}/>
    {fields.map(([key, title, placeholder]) => <div key={key}><label htmlFor={`checkpoint-${key}`}>{title}</label><textarea id={`checkpoint-${key}`} value={form[key]} placeholder={placeholder} maxLength={20000} rows={key === 'goal' || key === 'nextSteps' ? 4 : 3} onChange={e => update(key, e.target.value)}/></div>)}
    <div className="capture-options"><label className="checkbox-label"><input type="checkbox" checked={includeGit} onChange={e => setIncludeGit(e.target.checked)}/>Capture Git branch, commit, and changed-file names</label>{target.source.kind === 'managed' && <label className="checkbox-label"><input type="checkbox" checked={includeTerminal} onChange={e => setIncludeTerminal(e.target.checked)}/>Include recent terminal output (up to 12,000 characters)</label>}<p className="context-note">Review captured paths and terminal output before sharing. A checkpoint records context; it does not commit files or restore a provider conversation.</p></div>
    {error && <p className="context-error" role="alert">{error}</p>}<div className="card-actions"><button className="primary-action" disabled={busy}>{busy ? 'Saving…' : 'Save checkpoint'}</button><button type="button" disabled={busy} onClick={onCancel}>Back to library</button></div>
  </form>;
}

export function ContextHub({ state, target, setTarget, onError }: { state: ContextState; target: EditorTarget | null; setTarget: (target: EditorTarget | null) => void; onError: (message: string) => void }) {
  const [selectedId, setSelectedId] = useState<string | null>(null); const [query, setQuery] = useState('');
  const [notice, setNotice] = useState(''); const [working, setWorking] = useState(false);
  const selected = state.checkpoints.find(c => c.id === selectedId);
  const checkpoints = state.checkpoints.filter(c => `${c.title} ${c.source.name} ${c.source.cwd ?? ''} ${c.goal} ${c.nextSteps}`.toLowerCase().includes(query.toLowerCase()));
  const drafts = readDrafts();
  async function run(action: () => Promise<void>) { setWorking(true); setNotice(''); try { await action(); } catch (e) { onError(String(e)); } finally { setWorking(false); } }
  if (target) return <section className="context-page"><CheckpointEditor key={`${target.source.id}:${target.parent?.id ?? 'new'}`} target={target} onCancel={() => setTarget(null)} onSaved={checkpoint => { setSelectedId(checkpoint.id); setTarget(null); setNotice('Checkpoint saved. The handover is ready to review and share.'); }}/></section>;
  return <section className="context-page"><div className="eyebrow">CONTEXT THAT OUTLIVES THE TERMINAL</div><h1>Context library</h1><p className="page-intro">Review, revise, and share handovers across sessions and providers. Saved checkpoints remain here after a session is removed.</p>
    <div className="context-controls"><input aria-label="Search checkpoints" placeholder="Search by task, project, or next step…" value={query} onChange={e => setQuery(e.target.value)}/><button disabled={working} onClick={() => void run(async () => { const c = await api.importCheckpoint(); if (c) { setSelectedId(c.id); setNotice('Checkpoint imported.'); } })}>Import checkpoint</button></div>
    {!!drafts.length && <div className="draft-list"><strong>Unfinished drafts</strong>{drafts.map(({ key, draft }) => <button key={key} onClick={() => setTarget({ source: draft.source, parent: draft.parent })}>Continue: {draft.fields.title || draft.source.name}</button>)}</div>}
    {notice && <p className="context-notice" role="status">{notice}</p>}
    {selected ? <article className="checkpoint-preview"><button onClick={() => setSelectedId(null)}>← All checkpoints</button><h2>{selected.title}</h2><p className="context-note">{selected.source.name} · {selected.source.provider} · {new Date(selected.createdAt).toLocaleString()}<br/>{selected.source.cwd}{selected.parentId && <><br/>Revision of checkpoint {selected.parentId.slice(0, 8)}</>}</p><div className="card-actions"><button disabled={working} onClick={() => void run(async () => { await api.copyCheckpoint(selected.id); setNotice('Markdown handover copied. Paste it into a new session or share it with a teammate.'); })}>Copy handover</button><button disabled={working} onClick={() => void run(async () => { if (await api.exportCheckpoint(selected.id, 'markdown')) setNotice('Markdown handover exported.'); })}>Export Markdown</button><button disabled={working} onClick={() => void run(async () => { if (await api.exportCheckpoint(selected.id, 'json')) setNotice('Portable checkpoint exported. It can be imported into another workspace.'); })}>Export checkpoint</button><button onClick={() => setTarget({ source: selected.source, parent: selected })}>Create revision</button></div>
      {fields.map(([key, label]) => <section className="checkpoint-section" key={key}><h3>{label}</h3><p>{selected[key] || 'Not recorded.'}</p></section>)}
      {selected.git && <section className="checkpoint-section"><h3>Git snapshot</h3><p>{selected.git.error ?? `${selected.git.branch} · ${selected.git.commit}`}</p><small>{selected.git.capturedAt}</small><pre>{selected.git.status || 'No changed files recorded.'}</pre></section>}
      {selected.terminalExcerpt && <section className="checkpoint-section"><h3>Terminal excerpt</h3><p className="context-note">Raw screen output; it may contain redraws and is not a conversation transcript.</p><pre>{selected.terminalExcerpt}</pre></section>}
    </article> : <div className="checkpoint-list">{!checkpoints.length && <div className="context-empty">{query ? 'No matching checkpoints.' : 'Save a checkpoint from any session to preserve its context here.'}</div>}{checkpoints.map(c => <button key={c.id} onClick={() => setSelectedId(c.id)}><strong>{c.title}</strong><span>{c.source.name} · {c.source.provider} · {new Date(c.createdAt).toLocaleString()}</span><p>{c.nextSteps || c.goal || c.progress}</p></button>)}</div>}
  </section>;
}
