import { app, BrowserWindow, clipboard, dialog, ipcMain, Notification } from 'electron';
import { existsSync, readFileSync, mkdirSync, renameSync, writeFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import * as pty from 'node-pty';
import type { AttentionOrigin, CheckpointRequest, CliInfo, ContextSource, GitContext, Session, Workspace } from './types';
import { ExternalMonitor } from './external';
import { checkpointMarkdown, ContextStore, plainText, PromptDetector, validateCheckpoint, validateFields } from './context';

let win: BrowserWindow;
let workspace: Workspace = { sessions: [], activeId: null };
const terminals = new Map<string, pty.IPty>();
const buffers = new Map<string, string>();
const sequences = new Map<string, number>();
const externalMonitor = new ExternalMonitor(() => new Set([...terminals.values()].map(terminal => terminal.pid)));
let metadataFile: string;
let clis: CliInfo;
let context: ContextStore;
const detectors = new Map<string, PromptDetector>();
const execute = promisify(execFile);
function contextChanged() { if (!win.isDestroyed()) win.webContents.send('context:changed', context.state); }
function managedSource(session: Session): ContextSource { return { id: session.id, kind: 'managed', name: session.name, provider: session.provider, cwd: session.cwd }; }
async function sourceFor(id: unknown): Promise<ContextSource> {
  if (typeof id !== 'string' || id.length > 200) throw new Error('Invalid source');
  const managed = workspace.sessions.find(s => s.id === id);
  if (managed) return managedSource(managed);
  const external = (await externalMonitor.scan()).sessions.find(s => s.id === id);
  if (external) return { id: external.id, kind: 'external', name: external.name, provider: external.provider, cwd: external.projectFolder };
  const archived = context.state.sources.find(s => s.id === id) ?? context.state.attention.find(a => a.source.id === id)?.source ?? context.state.checkpoints.find(c => c.source.id === id)?.source;
  if (archived) return archived;
  throw new Error('Session is no longer available. Existing checkpoints remain in the context library.');
}
function attention(source: ContextSource, reason: string, origin: AttentionOrigin) {
  try {
    const item = context.addAttention(source, reason, origin);
    if (!item) return;
    contextChanged();
    if (context.state.notifications && !win.isFocused() && Notification.isSupported()) {
      const notification = new Notification({ title: `${source.name} needs you`, body: reason, silent: true });
      notification.on('click', () => { if (win.isDestroyed()) return; win.restore(); win.show(); win.focus(); win.webContents.send('attention:open'); });
      notification.show();
    }
  } catch (error) { if (origin === 'manual') throw error; console.error('Unable to save attention queue:', error); }
}
async function gitContext(cwd: string | null): Promise<GitContext> {
  const capturedAt = new Date().toISOString();
  if (!cwd) return { branch: '', commit: '', status: '', capturedAt, error: 'Project folder is unavailable.' };
  try {
    const git = async (args: string[]) => (await execute('git', ['--no-optional-locks', '-c', 'core.fsmonitor=false', '-C', cwd, ...args], { windowsHide: true, timeout: 5000, maxBuffer: 100000, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } })).stdout.trim();
    const [branch, commit, status] = await Promise.all([git(['rev-parse', '--abbrev-ref', 'HEAD']), git(['rev-parse', 'HEAD']), git(['status', '--short', '--untracked-files=normal'])]);
    return { branch, commit, status: status.slice(0, 30000), capturedAt, error: null };
  } catch { return { branch: '', commit: '', status: '', capturedAt, error: 'Git snapshot unavailable (not a repository, no commits, or Git could not run).' }; }
}
function resolveCli(name: string): string | null {
  try {
    const found = execFileSync('where.exe', [name], { encoding: 'utf8', windowsHide: true }).trim().split(/\r?\n/);
    return found.find(file => /\.(exe|cmd|bat)$/i.test(file)) ?? null;
  } catch { return null; }
}
function save() {
  const temp = metadataFile + '.tmp';
  writeFileSync(temp, JSON.stringify(workspace, null, 2), 'utf8');
  renameSync(temp, metadataFile);
}
function changed(session: Session) { save(); if (!win.isDestroyed()) win.webContents.send('session:changed', session); }
function getSession(id: unknown): Session {
  if (typeof id !== 'string') throw new Error('Invalid session ID');
  const session = workspace.sessions.find(item => item.id === id);
  if (!session) throw new Error('Session not found');
  return session;
}
function launch(session: Session) {
  if (terminals.has(session.id)) throw new Error('Session is already running');
  const executable = clis[session.provider];
  if (!executable) throw new Error(`${session.provider} CLI is not on PATH. Install it, then restart the app.`);
  if (!existsSync(session.cwd) || !statSync(session.cwd).isDirectory()) throw new Error('Project folder does not exist');
  let command = executable;
  let args: string[] = [];
  if (/\.(cmd|bat)$/i.test(executable)) {
    // Invoke the installed npm CLI entry point directly; never interpolate a shell command.
    const entry = path.join(path.dirname(executable), 'node_modules', '@openai', 'codex', 'bin', 'codex.js');
    if (session.provider !== 'codex' || !existsSync(entry)) throw new Error('Unsupported CLI shim. Install the native CLI executable.');
    command = resolveCli('node') ?? 'node.exe';
    args = [entry];
  }
  // Scoped to this process: receive Codex's documented terminal notification events.
  if (session.provider === 'codex') args.push('-c', 'tui.notifications=true', '-c', 'tui.notification_method="osc9"', '-c', 'tui.notification_condition="always"');
  const env: NodeJS.ProcessEnv = { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor' };
  delete env.ELECTRON_RUN_AS_NODE;
  const terminal = pty.spawn(command, args, { name: 'xterm-256color', cols: 100, rows: 30, cwd: session.cwd, env, useConpty: true });
  terminals.set(session.id, terminal);
  detectors.set(session.id, new PromptDetector());
  if (context.resolveAutomatic(session.id)) contextChanged();
  buffers.set(session.id, '');
  const resetSequence = (sequences.get(session.id) ?? 0) + 1;
  sequences.set(session.id, resetSequence);
  win.webContents.send('terminal:data', { id: session.id, data: '\x1bc', sequence: resetSequence });
  session.status = 'running'; delete session.exitCode; delete session.error;
  terminal.onData(data => {
    const signal = detectors.get(session.id)?.feed(data);
    if (signal) attention(managedSource(session), signal.reason, signal.origin);
    const sequence = (sequences.get(session.id) ?? 0) + 1;
    sequences.set(session.id, sequence);
    buffers.set(session.id, ((buffers.get(session.id) ?? '') + data).slice(-2_000_000));
    if (!win.isDestroyed()) win.webContents.send('terminal:data', { id: session.id, data, sequence });
  });
  terminal.onExit(({ exitCode }) => {
    if (terminals.get(session.id) !== terminal) return;
    terminals.delete(session.id); session.status = exitCode === 0 ? 'stopped' : 'error'; session.exitCode = exitCode; changed(session);
    detectors.delete(session.id);
    if (context.resolveAutomatic(session.id)) contextChanged();
    attention(managedSource(session), `Session exited with code ${exitCode}. Review the result and save a handover.`, 'process-exit');
  });
  changed(session);
}
app.whenReady().then(() => {
  app.setAppUserModelId('local.agent-session-manager');
  metadataFile = path.join(app.getPath('userData'), 'workspace.json');
  mkdirSync(path.dirname(metadataFile), { recursive: true });
  try { context = new ContextStore(path.join(app.getPath('userData'), 'context-library.json')); }
  catch (error) { dialog.showErrorBox('Context library needs recovery', String(error)); app.quit(); return; }
  try {
    const saved = JSON.parse(readFileSync(metadataFile, 'utf8'));
    if (Array.isArray(saved.sessions)) workspace.sessions = saved.sessions.filter((s: Session) => s && typeof s.id === 'string' && typeof s.name === 'string' && typeof s.cwd === 'string' && ['claude', 'codex'].includes(s.provider)).map((s: Session) => ({ ...s, status: 'stopped' }));
    workspace.activeId = workspace.sessions.some(s => s.id === saved.activeId) ? saved.activeId : null;
  } catch { /* First launch or invalid metadata: start with an empty workspace. */ }
  clis = { claude: resolveCli('claude'), codex: resolveCli('codex') };
  win = new BrowserWindow({ show: !process.argv.includes('--smoke-test'), width: 1380, height: 900, minWidth: 850, minHeight: 560, backgroundColor: '#101318', title: 'Agent Session Manager', webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true } });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', event => event.preventDefault());
  // Every IPC endpoint accepts calls only from our own main frame.
  const handle = (channel: string, callback: (...args: any[]) => unknown) => ipcMain.handle(channel, (event, ...args) => {
    if (event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame) throw new Error('Unauthorized sender');
    return callback(...args);
  });
  handle('workspace:get', () => workspace);
  handle('clis:get', () => clis);
  handle('external:scan', () => externalMonitor.scan());
  handle('context:get', () => context.state);
  handle('context:remember-source', async id => { const source = await sourceFor(id); context.rememberSource(source); contextChanged(); });
  handle('context:handover-prompt', () => clipboard.writeText('Prepare a self-contained handover for this coding session so another person or agent can continue safely. Use these headings: Goal; Progress; Decisions and constraints; Blockers / needs attention; Next steps; Verification; References and files. Preserve the original requirements, rationale, relevant file paths, exact checks run and their outcomes, unresolved questions, and the first concrete action to take next. Distinguish completed work from proposals and unverified claims. Include a conversation/session ID or resume command only if you know it; do not invent one. Do not include secrets. Do not change any files or run extra commands just to prepare this summary.'));
  handle('attention:flag', async value => { const source = await sourceFor(value?.sourceId); if (typeof value?.reason !== 'string') throw new Error('Enter an attention reason'); attention(source, value.reason, 'manual'); return context.state; });
  handle('attention:resolve', id => { if (typeof id !== 'string') throw new Error('Invalid attention ID'); context.resolve(id); contextChanged(); });
  handle('context:notifications', enabled => { if (typeof enabled !== 'boolean') throw new Error('Invalid notification setting'); context.notifications(enabled); contextChanged(); });
  handle('checkpoint:save', async (request: CheckpointRequest) => {
    const fields = validateFields(request?.fields);
    if (typeof request.includeGit !== 'boolean' || typeof request.includeTerminal !== 'boolean') throw new Error('Invalid capture settings');
    const parent = request.parentId ? context.state.checkpoints.find(c => c.id === request.parentId) : null;
    if (request.parentId && (!parent || parent.source.id !== request.sourceId)) throw new Error('Previous checkpoint does not match this session');
    const source = parent?.source ?? await sourceFor(request.sourceId);
    const checkpoint = context.addCheckpoint({ ...fields, id: randomUUID(), source, createdAt: new Date().toISOString(), parentId: parent?.id ?? null, git: request.includeGit ? await gitContext(source.cwd) : null, terminalExcerpt: request.includeTerminal && source.kind === 'managed' ? plainText(buffers.get(source.id) ?? '').slice(-12000) || null : null });
    contextChanged(); return checkpoint;
  });
  const checkpointById = (id: unknown) => { const c = context.state.checkpoints.find(c => c.id === id); if (!c) throw new Error('Checkpoint not found'); return c; };
  handle('checkpoint:copy', id => { clipboard.writeText(checkpointMarkdown(checkpointById(id))); });
  handle('checkpoint:export', async value => {
    const checkpoint = checkpointById(value?.id);
    if (!['markdown', 'json'].includes(value?.format)) throw new Error('Invalid export format');
    const json = value.format === 'json';
    const result = await dialog.showSaveDialog(win, { defaultPath: `handover-${checkpoint.id.slice(0, 8)}.${json ? 'json' : 'md'}`, filters: [{ name: json ? 'Portable checkpoint' : 'Markdown handover', extensions: [json ? 'json' : 'md'] }] });
    if (result.canceled || !result.filePath) return false;
    writeFileSync(result.filePath, json ? JSON.stringify({ format: 'agent-session-checkpoint', version: 1, checkpoint }, null, 2) : checkpointMarkdown(checkpoint), 'utf8'); return true;
  });
  handle('checkpoint:import', async () => {
    const result = await dialog.showOpenDialog(win, { properties: ['openFile'], filters: [{ name: 'Portable checkpoint', extensions: ['json'] }] });
    if (result.canceled) return null;
    const filename = result.filePaths[0];
    if (statSync(filename).size > 300000) throw new Error('Checkpoint file exceeds 300 KB');
    const data = JSON.parse(readFileSync(filename, 'utf8'));
    if (data.format !== 'agent-session-checkpoint' || data.version !== 1) throw new Error('Unsupported checkpoint format');
    const checkpoint = validateCheckpoint(data.checkpoint);
    const choice = await dialog.showMessageBox(win, { type: 'question', title: 'Import checkpoint', message: checkpoint.title, detail: `From ${checkpoint.source.name} (${checkpoint.source.provider})\n\n${checkpoint.goal.slice(0, 1500)}\n\nImports a handover into your library. It does not execute commands or change project files.`, buttons: ['Import checkpoint', 'Cancel'], defaultId: 1, cancelId: 1 });
    if (choice.response !== 0) return null;
    const imported = context.addCheckpoint({ ...checkpoint, id: randomUUID(), parentId: null }); contextChanged(); return imported;
  });
  handle('folder:pick', async () => { const result = await dialog.showOpenDialog(win, { properties: ['openDirectory'] }); return result.canceled ? null : result.filePaths[0]; });
  handle('session:create', (value) => {
    if (!value || !['claude', 'codex'].includes(value.provider) || typeof value.name !== 'string' || !value.name.trim() || value.name.length > 100 || typeof value.cwd !== 'string') throw new Error('Invalid session details');
    const session: Session = { id: randomUUID(), provider: value.provider, name: value.name.trim(), cwd: value.cwd, status: 'stopped', createdAt: new Date().toISOString() };
    workspace.sessions.push(session);
    try { launch(session); } catch (error) { workspace.sessions.pop(); throw error; }
    workspace.activeId = session.id; save(); return session;
  });
  handle('session:restart', id => { const s = getSession(id); launch(s); return s; });
  handle('session:stop', id => { const s = getSession(id); const terminal = terminals.get(s.id); terminals.delete(s.id); detectors.delete(s.id); terminal?.kill(); s.status = 'stopped'; if (context.resolveAutomatic(s.id)) contextChanged(); changed(s); });
  handle('session:remove', id => { const s = getSession(id); if (terminals.has(s.id)) throw new Error('Stop the session before removing it'); workspace.sessions = workspace.sessions.filter(item => item.id !== s.id); buffers.delete(s.id); if (workspace.activeId === s.id) workspace.activeId = workspace.sessions[0]?.id ?? null; save(); return workspace; });
  handle('session:rename', value => { const s = getSession(value?.id); if (typeof value.name !== 'string' || !value.name.trim() || value.name.length > 100) throw new Error('Name must contain 1–100 characters'); s.name = value.name.trim(); changed(s); });
  handle('session:select', id => { getSession(id); workspace.activeId = id; save(); });
  handle('terminal:snapshot', id => { getSession(id); return { data: buffers.get(id) ?? '', sequence: sequences.get(id) ?? 0 }; });
  for (const channel of ['terminal:input', 'terminal:resize']) ipcMain.on(channel, (event, value) => {
    if (event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame || !value || typeof value.id !== 'string') return;
    const terminal = terminals.get(value.id); if (!terminal) return;
    if (channel === 'terminal:input' && typeof value.data === 'string' && value.data.length <= 65536) {
      // Do not treat xterm's device replies or focus reports as a human response.
      if (!value.data.startsWith('\x1b[') && !value.data.startsWith('\x1b]')) {
        detectors.get(value.id)?.input();
        if (context.resolveAutomatic(value.id)) contextChanged();
      }
      terminal.write(value.data);
    }
    if (channel === 'terminal:resize' && Number.isInteger(value.cols) && Number.isInteger(value.rows) && value.cols >= 2 && value.cols <= 500 && value.rows >= 1 && value.rows <= 300) terminal.resize(value.cols, value.rows);
  });
  win.loadFile(path.join(__dirname, '../dist/index.html'));
});
app.on('before-quit', () => { for (const terminal of terminals.values()) terminal.kill(); });
app.on('window-all-closed', () => app.quit());
