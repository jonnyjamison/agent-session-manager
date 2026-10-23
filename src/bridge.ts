import type { Checkpoint, CheckpointRequest, CliInfo, ContextState, ExternalSnapshot, Provider, Session, TerminalEvent, Workspace } from '../electron/types';
export interface Bridge {
  external(): Promise<ExternalSnapshot>;
  workspace(): Promise<Workspace>; clis(): Promise<CliInfo>; pickFolder(): Promise<string | null>;
  create(provider: Provider, name: string, cwd: string): Promise<Session>;
  restart(id: string): Promise<Session>; stop(id: string): Promise<void>; remove(id: string): Promise<Workspace>;
  rename(id: string, name: string): Promise<void>; select(id: string): Promise<void>; snapshot(id: string): Promise<{ data: string; sequence: number }>;
  input(id: string, data: string): void; resize(id: string, cols: number, rows: number): void;
  onData(callback: (event: TerminalEvent) => void): () => void;
  onSession(callback: (session: Session) => void): () => void;
  context(): Promise<ContextState>; flag(sourceId: string, reason: string): Promise<ContextState>;
  copyHandoverPrompt(): Promise<void>;
  rememberSource(id: string): Promise<void>;
  resolveAttention(id: string): Promise<void>; notifications(enabled: boolean): Promise<void>;
  saveCheckpoint(request: CheckpointRequest): Promise<Checkpoint>;
  copyCheckpoint(id: string): Promise<void>; exportCheckpoint(id: string, format: 'markdown' | 'json'): Promise<boolean>;
  importCheckpoint(): Promise<Checkpoint | null>;
  onContext(callback: (state: ContextState) => void): () => void; onAttentionOpen(callback: () => void): () => void;
}
declare global { interface Window { sessions: Bridge } }
export const api = window.sessions;
