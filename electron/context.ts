import { existsSync, readFileSync, writeFileSync, renameSync, copyFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import type { AttentionOrigin, Checkpoint, CheckpointFields, ContextSource, ContextState } from './types';

export function plainText(value: string): string {
  return value.replace(/\x1b\][\s\S]*?(?:\x07|\x1b\\)/g, '').replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '').replace(/\x1b[()][0-2A-Z]/g, '').replace(/\x1b[@-_]/g, '').replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '').replace(/\r\n?/g, '\n');
}
export const fieldNames: (keyof CheckpointFields)[] = ['title', 'goal', 'progress', 'decisions', 'blockers', 'nextSteps', 'references', 'verification'];
export function validateFields(input: unknown): CheckpointFields {
  if (!input || typeof input !== 'object') throw new Error('Invalid checkpoint fields');
  const output = {} as CheckpointFields;
  for (const key of fieldNames) {
    const value = (input as Record<string, unknown>)[key];
    if (typeof value !== 'string' || value.length > (key === 'title' ? 160 : 20000)) throw new Error(`Invalid or oversized ${key}`);
    output[key] = value.trim();
  }
  if (!output.title) throw new Error('Give this checkpoint a title');
  if (!output.goal && !output.progress && !output.nextSteps) throw new Error('Add a goal, progress, or next step to preserve useful context');
  return output;
}
function validateSource(value: any): ContextSource {
  if (!value || typeof value.id !== 'string' || value.id.length > 200 || !['managed', 'external'].includes(value.kind) || !['claude', 'codex'].includes(value.provider) || typeof value.name !== 'string' || value.name.length > 200 || !(value.cwd === null || typeof value.cwd === 'string' && value.cwd.length <= 4000)) throw new Error('Invalid checkpoint source');
  return { id: value.id, kind: value.kind, provider: value.provider, name: value.name, cwd: value.cwd };
}
function validDate(value: unknown): value is string { return typeof value === 'string' && Number.isFinite(Date.parse(value)); }
export function validateCheckpoint(value: any): Checkpoint {
  const fields = validateFields(value);
  if (typeof value.id !== 'string' || value.id.length > 200 || !validDate(value.createdAt) || !(value.parentId === null || typeof value.parentId === 'string' && value.parentId.length <= 200)) throw new Error('Invalid checkpoint metadata');
  if (!(value.terminalExcerpt === null || typeof value.terminalExcerpt === 'string' && value.terminalExcerpt.length <= 12000)) throw new Error('Invalid terminal excerpt');
  let git = null;
  if (value.git !== null) {
    const g = value.git;
    if (!g || typeof g.branch !== 'string' || g.branch.length > 1000 || typeof g.commit !== 'string' || g.commit.length > 100 || typeof g.status !== 'string' || g.status.length > 30000 || !validDate(g.capturedAt) || !(g.error === null || typeof g.error === 'string' && g.error.length < 2000)) throw new Error('Invalid Git context');
    git = { branch: g.branch, commit: g.commit, status: g.status, capturedAt: g.capturedAt, error: g.error };
  }
  return { ...fields, id: value.id, source: validateSource(value.source), createdAt: value.createdAt, parentId: value.parentId, git, terminalExcerpt: value.terminalExcerpt === null ? null : plainText(value.terminalExcerpt) };
}
export function checkpointMarkdown(checkpoint: Checkpoint): string {
  const c = checkpoint;
  const sections: [string, string][] = [['Goal', c.goal], ['Progress', c.progress], ['Decisions and constraints', c.decisions], ['Blockers / needs attention', c.blockers], ['Next steps', c.nextSteps], ['Verification', c.verification], ['References and files', c.references]];
  const quote = (s: string) => s.replace(/\r?\n/g, ' ');
  return `# ${quote(c.title)}\n\nSaved: ${c.createdAt}\nSession: ${quote(c.source.name)} (${c.source.provider}, ${c.source.kind})\nProject: ${quote(c.source.cwd ?? 'Unavailable')}\nCheckpoint: ${c.id}\n${c.parentId ? `Previous checkpoint: ${c.parentId}\n` : ''}\nThis is a handover snapshot. Verify the current working tree and test results before continuing.\n\n` + sections.map(([heading, body]) => `## ${heading}\n\n${body || 'Not recorded.'}\n`).join('\n') + (c.git ? `\n## Git snapshot\n\nCaptured: ${c.git.capturedAt}\nBranch: ${quote(c.git.branch)}\nCommit: ${quote(c.git.commit)}\n${c.git.error ?? ''}\n\n${c.git.status.split('\n').map(line => `    ${line}`).join('\n')}\n` : '') + (c.terminalExcerpt ? `\n## Optional terminal excerpt (raw screen output, not a conversation transcript)\n\n${c.terminalExcerpt.split('\n').map(line => `    ${line}`).join('\n')}\n` : '');
}

export class ContextStore {
  state: ContextState = { version: 1, attention: [], checkpoints: [], sources: [], notifications: false };
  constructor(private file: string) {
    const load = (filename: string) => {
      const saved = JSON.parse(readFileSync(filename, 'utf8'));
      if (saved.version !== 1 || !Array.isArray(saved.checkpoints) || !Array.isArray(saved.attention)) throw new Error('Invalid context library');
      const checkpoints = saved.checkpoints.map(validateCheckpoint);
      const attention = saved.attention.map((a: any) => {
        if (typeof a.id !== 'string' || typeof a.reason !== 'string' || a.reason.length > 1000 || !['manual', 'inferred', 'terminal-notification', 'process-exit'].includes(a.origin) || !validDate(a.createdAt) || !(a.resolvedAt === null || validDate(a.resolvedAt))) throw new Error('Invalid attention queue');
        return { id: a.id, source: validateSource(a.source), reason: a.reason, origin: a.origin, createdAt: a.createdAt, resolvedAt: a.resolvedAt };
      });
      const sources = Array.isArray(saved.sources) ? saved.sources.map(validateSource) : [];
      this.state = { version: 1, checkpoints, attention, sources, notifications: saved.notifications === true };
    };
    if (existsSync(file)) {
      try { load(file); } catch {
        // Preserve damaged data for recovery, then try the last good library.
        copyFileSync(file, `${file}.damaged-${Date.now()}`);
        if (existsSync(`${file}.bak`)) { load(`${file}.bak`); writeFileSync(`${file}.tmp`, JSON.stringify(this.state, null, 2), 'utf8'); renameSync(`${file}.tmp`, file); }
        else throw new Error('Context library could not be read. A recovery copy was saved.');
      }
    }
  }
  private commit(next: ContextState) {
    writeFileSync(`${this.file}.tmp`, JSON.stringify(next, null, 2), 'utf8');
    if (existsSync(this.file)) copyFileSync(this.file, `${this.file}.bak`);
    renameSync(`${this.file}.tmp`, this.file); this.state = next;
  }
  notifications(enabled: boolean) { this.commit({ ...this.state, notifications: enabled }); }
  rememberSource(source: ContextSource) {
    const validated = validateSource(source);
    this.commit({ ...this.state, sources: [...this.state.sources.filter(s => s.id !== source.id), validated] });
  }
  addAttention(source: ContextSource, reason: string, origin: AttentionOrigin) {
    if (typeof reason !== 'string' || !reason.trim() || reason.length > 1000) throw new Error('Enter a reason of 1–1000 characters');
    const existing = this.state.attention.find(a => a.source.id === source.id && a.reason === reason.trim() && a.origin === origin && !a.resolvedAt);
    if (existing) return null;
    const item = { id: randomUUID(), source, reason: reason.trim(), origin, createdAt: new Date().toISOString(), resolvedAt: null };
    const open = this.state.attention.filter(a => !a.resolvedAt);
    const history = this.state.attention.filter(a => a.resolvedAt).slice(-200);
    this.commit({ ...this.state, attention: [...open, ...history, item] }); return item;
  }
  resolve(id: string) {
    if (!this.state.attention.some(a => a.id === id)) throw new Error('Attention item not found');
    this.commit({ ...this.state, attention: this.state.attention.map(a => a.id === id ? { ...a, resolvedAt: new Date().toISOString() } : a) });
  }
  resolveAutomatic(sourceId: string) {
    const items = this.state.attention.filter(a => a.source.id === sourceId && !a.resolvedAt && (a.origin === 'inferred' || a.origin === 'terminal-notification'));
    if (!items.length) return false;
    const ids = new Set(items.map(a => a.id));
    this.commit({ ...this.state, attention: this.state.attention.map(a => ids.has(a.id) ? { ...a, resolvedAt: new Date().toISOString() } : a) }); return true;
  }
  addCheckpoint(checkpoint: Checkpoint) {
    const validated = validateCheckpoint(checkpoint);
    this.commit({ ...this.state, checkpoints: [validated, ...this.state.checkpoints] }); return validated;
  }
}

export interface AttentionSignal { reason: string; origin: 'inferred' | 'terminal-notification' }
export class PromptDetector {
  private tail = '';
  private seen = new Set<string>();
  reset() { this.tail = ''; this.seen.clear(); }
  input() { this.reset(); }
  feed(chunk: string): AttentionSignal | null {
    this.tail = (this.tail + chunk).slice(-10000);
    const notifications = [...this.tail.matchAll(/\x1b\]9;([^\x07\x1b]{1,500})(?:\x07|\x1b\\)/g)];
    let signal: AttentionSignal | null = null;
    if (notifications.length) {
      const message = plainText(notifications[notifications.length - 1][1]).trim();
      const reason = `CLI notification: ${message}`.slice(0, 1000);
      if (message && !/^\d+(?:;|$)/.test(message) && !this.seen.has(reason)) signal = { reason, origin: 'terminal-notification' };
    }
    if (!signal) {
      const text = plainText(this.tail).slice(-4000);
      if (/would you like to (?:run|execute) (?:the )?following command\?|do you want to (?:proceed|allow|make this edit)\?|allow (?:this|claude) to .{0,120}\?/i.test(text)) signal = { reason: 'Possible approval prompt — check the terminal', origin: 'inferred' };
      else if (/press (?:enter|return) to (?:confirm|continue)|enter to select|waiting for your (?:input|response|approval)/i.test(text)) signal = { reason: 'Possible input prompt — check the terminal', origin: 'inferred' };
    }
    if (!signal || this.seen.has(signal.reason)) return null;
    this.seen.add(signal.reason); return signal;
  }
}
