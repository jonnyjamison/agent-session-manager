import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { ExternalSession, ExternalSnapshot, Provider } from './types';

export interface ProcessRecord { ProcessId: number; ParentProcessId: number; Name: string; CommandLine?: string | null; CreationDate?: string | null }
const execute = promisify(execFile);
function providerOf(p: ProcessRecord): Provider | null {
  const name = p.Name.toLowerCase();
  const command = p.CommandLine ?? '';
  if (/\s(?:app-server|mcp-server|--version|--help)(?:\s|$)/i.test(command)) return null;
  if (name === 'claude.exe') return 'claude';
  if (name === 'codex.exe') return 'codex';
  if (name !== 'node.exe') return null;
  if (/@anthropic-ai[\\/]claude-code[\\/](?:cli|bin[\\/]claude)\.js/i.test(command)) return 'claude';
  if (/@openai[\\/]codex[\\/]bin[\\/]codex\.js/i.test(command)) return 'codex';
  return null;
}
function explicitFolder(command: string): string | null {
  // Windows does not expose another process's cwd through Win32_Process.
  // Only show a folder when the CLI explicitly received an absolute -C/--cd argument.
  const match = command.match(/(?:^|\s)(?:-C|--cd)(?:\s+|=)(?:"([^"]+)"|([^\s"]+))/);
  const folder = match?.[1] ?? match?.[2];
  return folder && /^(?:[a-z]:[\\/]|\\\\)/i.test(folder) ? folder : null;
}
export function discoverExternal(records: ProcessRecord[], managedPids: Set<number>, ownPid: number): ExternalSession[] {
  const byPid = new Map(records.map(p => [p.ProcessId, p]));
  const candidates = new Map(records.filter(p => providerOf(p)).map(p => [p.ProcessId, p]));
  function ancestors(p: ProcessRecord): number[] {
    const result: number[] = []; const seen = new Set<number>([p.ProcessId]);
    let parent = p.ParentProcessId;
    while (parent && !seen.has(parent)) { result.push(parent); seen.add(parent); parent = byPid.get(parent)?.ParentProcessId ?? 0; }
    return result;
  }
  return [...candidates.values()].filter(p => {
    const parents = ancestors(p);
    return ![p.ProcessId, ...parents].some(pid => pid === ownPid || managedPids.has(pid)) && !parents.some(pid => candidates.has(pid));
  }).map(p => ({
    id: `external-${p.ProcessId}-${p.CreationDate ?? 'unknown'}`, pid: p.ProcessId,
    provider: providerOf(p)!, name: `${providerOf(p) === 'claude' ? 'Claude Code' : 'Codex'} · ${p.ProcessId}`,
    status: 'running' as const, startedAt: p.CreationDate ?? null, projectFolder: explicitFolder(p.CommandLine ?? '')
  })).sort((a, b) => a.pid - b.pid);
}

export class ExternalMonitor {
  private previous: ExternalSession[] = [];
  private pending: Promise<ExternalSnapshot> | null = null;
  private cached: ExternalSnapshot = { sessions: [], checkedAt: null, error: null };
  constructor(private managedPids: () => Set<number>) {}
  scan(): Promise<ExternalSnapshot> {
    if (this.pending) return this.pending;
    if (this.cached.checkedAt && Date.now() - Date.parse(this.cached.checkedAt) < 2000) return Promise.resolve(this.cached);
    this.pending = this.collect().finally(() => { this.pending = null; });
    return this.pending;
  }
  private async collect(): Promise<ExternalSnapshot> {
    try {
      const script = "$ErrorActionPreference='Stop'; [Console]::OutputEncoding=[System.Text.UTF8Encoding]::new(); @(Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,CommandLine,@{Name='CreationDate';Expression={if ($_.CreationDate) {$_.CreationDate.ToUniversalTime().ToString('o')}}}) | ConvertTo-Json -Compress";
      const { stdout } = await execute(`${process.env.SystemRoot ?? 'C:\\Windows'}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`, ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, timeout: 15000, maxBuffer: 8 * 1024 * 1024, encoding: 'utf8' });
      const parsed = JSON.parse(stdout.replace(/^\uFEFF/, ''));
      if (!Array.isArray(parsed)) throw new Error('Unexpected process inventory');
      const running = discoverExternal(parsed, this.managedPids(), process.pid);
      const ids = new Set(running.map(s => s.id));
      // Keep recently observed exits during this app run; cap history to avoid growth.
      const stopped = this.previous.filter(s => !ids.has(s.id)).map(s => ({ ...s, status: 'stopped' as const })).slice(-100);
      this.previous = [...running, ...stopped];
      this.cached = { sessions: this.previous, checkedAt: new Date().toISOString(), error: null };
    } catch {
      this.cached = { ...this.cached, error: 'Unable to read Windows processes. Last known results are shown; retry shortly.' };
    }
    return this.cached;
  }
}
